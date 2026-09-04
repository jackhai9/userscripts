import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import test from 'node:test';
import { loadFixtureDom } from '../../helpers/dom.js';

const fixtures = JSON.parse(readFileSync(new URL('../../fixtures/strategy27-compound-candidates.json', import.meta.url), 'utf8'));
let importNumber = 0;

async function until(predicate) {
  const deadline = performance.now() + 2000;
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error('Entrypoint condition deadline exceeded');
    await new Promise(setImmediate);
  }
}

async function harness(t, { generated = false } = {}) {
  const dom = loadFixtureDom('<div class="chart-widget-root"><iframe></iframe></div>');
  dom.reconfigure({ url: 'https://www.binance.com/zh-CN/futures/BTCUSDT' });
  const page = dom.window;
  const shapes = new Map([['user-owned', {}]]);
  let resolution = '1S';
  let shapeSequence = 0;
  const chart = {
    resolution: () => resolution, symbol: () => 'BTCUSDT',
    createShape: async (point, options) => {
      const id = `entry-owned-${++shapeSequence}`;
      shapes.set(id, { getPoints: () => [point], getProperties: () => ({ ...options.overrides, icon: options.icon, text: options.text }) });
      return id;
    },
    getShapeById: (id) => shapes.get(id),
    removeEntity: (id) => { assert.notEqual(id, 'user-owned'); assert.equal(shapes.delete(id), true); },
    getSeries: () => ({ data: () => ({ valueAt: (time) => [time, 100, 101, 99, 100] }) }),
    _chartWidget: { model: () => ({ model: () => ({
      timeScale: () => ({ timePointToIndex: (time) => time }),
      mainSeries: () => ({
        firstValue: () => 100,
        priceScale: () => ({ priceToCoordinate: (price) => 2000 - price * 10, coordinateToPrice: (y) => (2000 - y) / 10 }),
        dataUpdated: () => ({ subscribe() {}, unsubscribe() {} }),
      }),
    }) }) },
  };
  page.document.querySelector('iframe').contentWindow.tradingViewApi = { activeChart: () => chart };
  const timers = new Map();
  const menus = new Map();
  const requests = [];
  let now = 7000;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(page, 'setInterval', (callback, delay) => { assert.equal(delay, 1000); timers.set(1, callback); return 1; });
  t.mock.method(page, 'clearInterval', (id) => timers.delete(id));
  const globals = {
    unsafeWindow: page,
    GM_getValue: (key, initial) => key === 'strategy27GatewayAuthSecret' ? 'synthetic-test-value' : initial,
    GM_setValue: () => { throw new Error('Unexpected settings write'); },
    GM_registerMenuCommand: (name, callback) => menus.set(name, callback),
    GM_xmlhttpRequest: (options) => {
      const path = new URL(options.url).pathname;
      const request = { kind: path.endsWith('/compound-candidates') ? 'compound' : 'ordinary', options, settled: false, aborted: false };
      requests.push(request);
      return { abort() { request.aborted = true; request.settled = true; options.onabort(); } };
    },
  };
  for (const [name, value] of Object.entries(globals)) {
    assert.equal(Object.hasOwn(globalThis, name), false);
    globalThis[name] = value;
  }
  t.after(async () => {
    page.dispatchEvent(new page.Event('beforeunload'));
    await new Promise(setImmediate);
    for (const name of Object.keys(globals)) delete globalThis[name];
    dom.window.close();
  });
  if (generated) {
    const artifact = new URL('../../../scripts/binance-strategy27-events.user.js', import.meta.url);
    runInThisContext(readFileSync(artifact, 'utf8'), { filename: artifact.pathname });
  } else {
    await import(`../../../src/binance-strategy27-events/index.user.js?entry-test=${++importNumber}`);
  }
  const pending = (kind) => requests.filter((request) => request.kind === kind && !request.settled);
  async function respond(kind, body, status = 200) {
    await until(() => pending(kind).length > 0);
    assert.equal(pending(kind).length, 1);
    const request = pending(kind)[0];
    request.settled = true;
    request.options.onload({ status, responseText: typeof body === 'string' ? body : JSON.stringify(body) });
  }
  async function candidate(sequence = 1, cursor = '1-0', next = '2-0') {
    await respond('compound', {
      schema_version: 1, status: 'ok', requested_cursor: cursor, next_cursor: next,
      messages: [{ schema_version: 1, projection_kind: 'compound_candidate', runtime_epoch: 'a'.repeat(32),
        sequence, message_kind: 'candidate', symbol: fixtures[0].symbol, observed_at_ms: 7000, payload: fixtures[0] }],
    });
    await until(() => pending('compound').length === 1);
  }
  return {
    page, shapes, requests, pending, respond, candidate, timers,
    reset: () => respond('compound', { schema_version: 1, status: 'reset', reason: 'initial_cursor', requested_cursor: null, next_cursor: '1-0', messages: [] }),
    rows: () => page.document.querySelectorAll('[data-role="compound-row"]').length,
    tick: () => timers.get(1)(),
    clear: () => menus.get('清除 Strategy 27 图表标注')(),
    setNow: (value) => { now = value; },
    setResolution: (value) => { resolution = value; },
  };
}

test('real entrypoint starts independent clients and manual clear preserves compound replay identity', async (t) => {
  const h = await harness(t);
  assert.equal(h.timers.size, 1);
  assert.equal(h.pending('ordinary').length, 1);
  await h.reset();
  await h.candidate();
  assert.equal(h.rows(), 1);
  assert.equal(h.shapes.size, 3);
  h.clear();
  assert.equal(h.rows(), 0);
  assert.deepEqual([...h.shapes.keys()], ['user-owned']);
  await h.candidate(2, '2-0', '3-0');
  assert.equal(h.rows(), 0);
  assert.equal(h.shapes.size, 1);
  assert.equal(h.pending('ordinary').length, 1);
});

test('ordinary failure does not stop compound; the existing timer expires candidates and interval changes abort both', async (t) => {
  const h = await harness(t);
  await h.respond('ordinary', 'invalid JSON');
  await h.reset();
  await h.candidate();
  assert.equal(h.rows(), 1);
  h.setNow(7207001);
  h.tick();
  assert.equal(h.rows(), 0);
  assert.equal(h.shapes.size, 1);
  assert.equal(h.pending('compound').length, 1);
  h.setResolution('1');
  h.tick();
  assert.equal(h.pending('compound').length, 0);
  assert.equal(h.requests.at(-1).aborted, true);
  assert.equal(h.page.document.querySelector('[data-role="compound-status"]'), null);
  assert.equal(h.shapes.size, 1);
});

test('an unsupported compound route leaves ordinary polling alive without restarting on each context tick', async (t) => {
  const h = await harness(t);
  await h.respond('compound', '<html>missing route</html>', 404);
  await until(() => h.page.document.querySelector('[data-role="compound-status"]')?.textContent === '网关尚未启用复合候选');
  h.tick();
  h.tick();
  assert.equal(h.requests.filter((request) => request.kind === 'compound').length, 1);
  assert.equal(h.pending('ordinary').length, 1);
  h.page.history.pushState({}, '', '/zh-CN/markets');
  assert.equal(h.pending('ordinary').length, 0);
  assert.equal(h.page.document.querySelector('[data-role="compound-status"]'), null);
  assert.equal(h.shapes.size, 1);
});

test('a disappearing chart root retires both clients and removes only owned entities', async (t) => {
  const h = await harness(t);
  await h.reset();
  await h.candidate();
  h.page.document.querySelector('.chart-widget-root').setAttribute('data-hidden', '');
  h.tick();
  assert.equal(h.pending('ordinary').length, 0);
  assert.equal(h.pending('compound').length, 0);
  assert.equal(h.rows(), 0);
  assert.deepEqual([...h.shapes.keys()], ['user-owned']);
});

test('generated install artifact receives a candidate and cleans up its paired entities without affecting ordinary polling', async (t) => {
  const h = await harness(t, { generated: true });
  await h.reset();
  await h.candidate();
  assert.equal(h.rows(), 1);
  assert.equal(h.shapes.size, 3);
  const properties = [...h.shapes.entries()].filter(([id]) => id !== 'user-owned').map(([, shape]) => shape.getProperties());
  assert.equal(properties[0].icon, 0xf063);
  assert.equal(properties[0].size, 36);
  assert.equal(properties[1].text, '候选高');
  assert.equal(h.pending('ordinary').length, 1);
  h.clear();
  assert.equal(h.rows(), 0);
  assert.deepEqual([...h.shapes.keys()], ['user-owned']);
  assert.equal(h.pending('ordinary').length, 1);
  h.setResolution('1');
  h.tick();
  assert.equal(h.pending('ordinary').length, 0);
  assert.equal(h.pending('compound').length, 0);
});
