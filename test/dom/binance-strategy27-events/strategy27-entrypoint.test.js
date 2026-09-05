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

async function harness(t, { generated = false, beforeCreate } = {}) {
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
      if (beforeCreate) await beforeCreate();
      shapes.set(id, { getPoints: () => [point], getProperties: () => ({ ...options.overrides, icon: options.icon, text: options.text }) });
      return id;
    },
    getShapeById: (id) => shapes.get(id),
    getAllShapes: () => [...shapes.keys()].map((id) => ({ id })),
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
      const request = { kind: path.includes('/compound-candidates') ? 'compound' : 'ordinary', options, settled: false, aborted: false };
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
  async function candidate(sequence = 2, cursor = '1-0', next = '2-0') {
    await respond('compound', {
      schema_version: 1, status: 'ok', requested_cursor: cursor, next_cursor: next,
      messages: [{ schema_version: 1, projection_kind: 'compound_candidate', runtime_epoch: 'a'.repeat(32),
        sequence, message_kind: 'candidate', symbol: fixtures[0].symbol, observed_at_ms: 7000, payload: fixtures[0] }],
    });
    await until(() => pending('compound').length === 1);
  }
  return {
    page, shapes, requests, pending, respond, candidate, timers,
    reset: () => respond('compound', { schema_version: 1, status: 'bootstrap', projection_kind: 'compound_candidates', requested_cursor: null, next_cursor: '1-0', runtime_epoch: 'a'.repeat(32), last_sequence: 1, bootstrap_observed_at_ms: 7000, records: [] }),
    ordinaryBootstrap: () => respond('ordinary', { schema_version: 1, status: 'bootstrap', projection_kind: 'strategy27_events', requested_cursor: null, next_cursor: '1-0', runtime_epoch: 'a'.repeat(32), last_sequence: 1, bootstrap_observed_at_ms: 7000, records: [] }),
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
  await h.candidate(3, '2-0', '3-0');
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

for (const generated of [false, true]) {
  test(`${generated ? 'generated' : 'source'} context timer restores externally evicted candidates without gateway traffic`, async (t) => {
    const h = await harness(t, { generated });
    await h.reset();
    await h.candidate();
    const oldIds = [...h.shapes.keys()].filter((id) => id !== 'user-owned');
    for (const id of oldIds) h.shapes.delete(id);
    h.tick();
    await until(() => h.shapes.size === 3);
    assert.equal(h.rows(), 1);
    assert.equal(oldIds.some((id) => h.shapes.has(id)), false);
    const repairedIds = [...h.shapes.keys()];
    h.tick();
    await new Promise(setImmediate);
    assert.deepEqual([...h.shapes.keys()], repairedIds);
    h.clear();
    h.tick();
    await new Promise(setImmediate);
    assert.equal(h.shapes.size, 1);
    assert.equal(h.rows(), 0);
    await h.candidate(3, '2-0', '3-0');
    assert.equal(h.rows(), 0);
    assert.deepEqual([...h.shapes.keys()], ['user-owned']);
  });
}

function ordinaryMessage() {
  const snapshot = {
    bucket_start_ms: 1000, bucket_end_ms: 1250, source_bucket_count: 1,
    bucket_trigger_reasons: ['aggressive_buy_to_ask_depth'],
    candidate_observations: ['bullish_sell_impact_failure'],
    aggressive_buy: { notional: '1200', trade_count: 3, to_opposite_depth: '0.4' },
    aggressive_sell: { notional: '200', trade_count: 1, to_opposite_depth: '0.1' },
    bid: { observed_addition_notional: '300', observed_decrease_notional: '100', best_price_migration_bps: '0.2', addition_to_depth: '0.3', decrease_to_depth: '0.1' },
    ask: { observed_addition_notional: '100', observed_decrease_notional: '500', best_price_migration_bps: '-0.4', addition_to_depth: '0.1', decrease_to_depth: '0.5' },
    price_response: { mid: '100', mid_return_bps: '2.5', spread_bps: '1.2', spread_change_bps: '-0.2' },
  };
  return {
    schema_version: 2, strategy_id: '27', spec_version: '27_2_spec_v10', runtime_epoch: 'a'.repeat(32),
    sequence: 2, message_kind: 'event_updated', symbol: 'BTC/USDT:USDT', event_id: 'b'.repeat(64),
    observed_at_ms: 2000, event_time_ms: 2000, data_status: 'active',
    payload: { event: {
      event_kind: 'orderflow_event', analysis_start_at_ms: 0, triggered_at_ms: 1000,
      active_end_at_ms: null, event_status: 'active', close_reason: null,
      trigger_reasons: ['aggressive_buy_to_ask_depth'],
      trigger_snapshot: { ...snapshot, candidate_observations: [] },
      latest_snapshot: { ...snapshot, source_bucket_count: 4, bucket_end_ms: 2000 },
    } },
  };
}

function ordinaryOutcomeMessage() {
  const ordinary = ordinaryMessage();
  return {
    ...ordinary,
    sequence: 3,
    message_kind: 'event_outcome',
    event_id: ordinary.event_id,
    observed_at_ms: 7000,
    event_time_ms: 7000,
    data_status: 'complete',
    payload: {
      event: {
        ...ordinary.payload.event,
        active_end_at_ms: 2000,
        event_status: 'complete',
        close_reason: 'quiet_period',
      },
      outcome: {
        window_seconds: 5,
        outcome_boundary_at_ms: 7000,
        outcome_status: 'complete',
        terminated_at_ms: null,
        termination_reason: null,
        boundary_mid: '99',
        return_from_trigger_bps: '-100',
        return_from_active_end_bps: '-100',
        maximum_upward_excursion_bps: '0',
        maximum_downward_excursion_bps: '100',
        pre_event_range_break_up: false,
        pre_event_range_break_down: true,
        spread_change_from_active_end_bps: '0.1',
        eligible_orderbook_observation_count: 4,
        impulse_direction: 'down',
        directional_outcome: 'continuation',
      },
    },
  };
}

function compoundMessage() {
  return {
    schema_version: 1,
    projection_kind: 'compound_candidate',
    runtime_epoch: 'a'.repeat(32),
    sequence: 2,
    message_kind: 'candidate',
    symbol: fixtures[0].symbol,
    observed_at_ms: 7000,
    payload: fixtures[0],
  };
}

for (const generated of [false, true]) {
  test(`${generated ? 'generated' : 'source'} refresh bootstrap rebuilds ordinary and compound markers before live polling`, async (t) => {
    const h = await harness(t, { generated });
    const ordinary = ordinaryMessage();
    const outcome = ordinaryOutcomeMessage();
    await h.respond('ordinary', {
      schema_version: 1,
      status: 'bootstrap',
      projection_kind: 'strategy27_events',
      requested_cursor: null,
      next_cursor: '3-0',
      runtime_epoch: ordinary.runtime_epoch,
      last_sequence: outcome.sequence,
      bootstrap_observed_at_ms: 7000,
      records: [{
        event_id: ordinary.event_id,
        event_envelope: ordinary,
        marker_envelope: ordinary,
        outcome_envelope: null,
      }, {
        event_id: outcome.event_id,
        event_envelope: outcome,
        marker_envelope: null,
        outcome_envelope: outcome,
      }],
    });
    await h.respond('compound', {
      schema_version: 1,
      status: 'bootstrap',
      projection_kind: 'compound_candidates',
      requested_cursor: null,
      next_cursor: '2-0',
      runtime_epoch: 'a'.repeat(32),
      last_sequence: 2,
      bootstrap_observed_at_ms: 7000,
      records: [compoundMessage()],
    });
    await until(() => h.shapes.size === 4);
    assert.equal(h.page.document.querySelectorAll('[data-role="event-row"]').length, 1);
    assert.equal(h.rows(), 1);
    assert.equal(h.pending('ordinary').length, 1);
    assert.equal(h.pending('compound').length, 1);
    assert.deepEqual(
      h.requests.slice(0, 2).map(({ options }) => new URL(options.url).pathname).sort(),
      ['/v1/strategy27/compound-candidates/bootstrap', '/v1/strategy27/events/bootstrap'],
    );
  });
}

for (const generated of [false, true]) {
  test(`${generated ? 'generated' : 'source'} timer restores ordinary drawings and prunes both lifecycles before repair`, async (t) => {
    const h = await harness(t, { generated });
    await h.ordinaryBootstrap();
    await h.respond('ordinary', { schema_version: 1, status: 'ok', requested_cursor: '1-0', next_cursor: '2-0', messages: [ordinaryMessage()] });
    await until(() => h.shapes.size === 2 || h.page.document.getElementById('jh-strategy27-event-status')?.dataset.state === 'error');
    assert.equal(h.shapes.size, 2, h.page.document.getElementById('jh-strategy27-event-status')?.textContent);
    const oldOrdinary = [...h.shapes.keys()].find((id) => id !== 'user-owned');
    h.shapes.delete(oldOrdinary);
    h.tick();
    await until(() => h.shapes.size === 2);
    assert.equal(h.shapes.has(oldOrdinary), false);
    assert.equal(h.pending('ordinary').length, 1);
    await h.reset();
    await h.candidate();
    assert.equal(h.shapes.size, 4);
    for (const id of [...h.shapes.keys()]) if (id !== 'user-owned') h.shapes.delete(id);
    h.setNow(7207001);
    h.tick();
    await new Promise(setImmediate);
    assert.equal(h.rows(), 0);
    assert.equal(h.page.document.querySelectorAll('[data-role="event-row"]').length, 0);
    assert.deepEqual([...h.shapes.keys()], ['user-owned']);
  });
}

test('timer expiry cancels an ordinary first creation that is still awaiting TradingView', async (t) => {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const h = await harness(t, { beforeCreate: async () => { entered.resolve(); await release.promise; } });
  await h.ordinaryBootstrap();
  await h.respond('ordinary', { schema_version: 1, status: 'ok', requested_cursor: '1-0', next_cursor: '2-0', messages: [ordinaryMessage()] });
  await entered.promise;
  h.setNow(7207001);
  h.tick();
  release.resolve();
  await until(() => h.pending('ordinary').length === 1);
  assert.deepEqual([...h.shapes.keys()], ['user-owned']);
  assert.equal(h.page.document.querySelectorAll('[data-role="event-row"]').length, 0);
});
