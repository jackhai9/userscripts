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

async function harness(t, { generated = false, beforeCreate, locale = 'zh-CN', migrationRecord, routeSymbol = 'BTCUSDT', candidateFixture = fixtures[0] } = {}) {
  const dom = loadFixtureDom('<div class="chart-widget-root"><iframe></iframe></div>');
  dom.reconfigure({ url: `https://www.binance.com/${locale}/futures/${routeSymbol}` });
  const page = dom.window;
  if (migrationRecord !== undefined) Object.defineProperty(page, Symbol.for('jh-userscripts.strategy29-preferences-migration'), { value: migrationRecord });
  const shapes = new Map([['user-owned', {}]]);
  let resolution = '1S';
  let shapeSequence = 0;
  const chart = {
    resolution: () => resolution, symbol: () => routeSymbol,
    createShape: async (point, options) => {
      const id = `entry-owned-${++shapeSequence}`;
      if (beforeCreate) await beforeCreate();
      shapes.set(id, { getPoints: () => [point], getProperties: () => ({ ...options.overrides, icon: options.icon, text: options.text }), setProperties: (properties) => Object.assign(options, properties) });
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
  const menuIds = new Map();
  const requests = [];
  const prompts = [];
  let now = 7000;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(page, 'setInterval', (callback, delay) => { assert.equal(delay, 1000); timers.set(1, callback); return 1; });
  t.mock.method(page, 'clearInterval', (id) => timers.delete(id));
  const globals = {
    unsafeWindow: page,
    prompt: (...args) => { prompts.push(args[0]); return null; },
    GM_getValue: (key, initial) => key === 'strategy27GatewayAuthSecret' ? 'synthetic-test-value' : initial,
    GM_setValue: () => { throw new Error('Unexpected settings write'); },
    GM_registerMenuCommand: (name, callback, options = {}) => {
      const id = options.id ?? menuIds.size + 1;
      if (menuIds.has(id)) menus.delete(menuIds.get(id));
      menuIds.set(id, name);
      menus.set(name, callback);
      return id;
    },
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
        sequence, message_kind: 'candidate', symbol: candidateFixture.symbol, observed_at_ms: 7000, payload: candidateFixture }],
    });
    await until(() => pending('compound').length === 1);
  }
  return {
    page, chart, shapes, requests, pending, respond, candidate, timers, menus, prompts,
    reset: () => respond('compound', { schema_version: 1, status: 'bootstrap', projection_kind: 'compound_candidates', requested_cursor: null, next_cursor: '1-0', runtime_epoch: 'a'.repeat(32), last_sequence: 1, bootstrap_observed_at_ms: 7000, records: [] }),
    ordinaryBootstrap: () => respond('ordinary', { schema_version: 1, status: 'bootstrap', projection_kind: 'strategy27_events', requested_cursor: null, next_cursor: '1-0', runtime_epoch: 'a'.repeat(32), last_sequence: 1, bootstrap_observed_at_ms: 7000, records: [] }),
    rows: () => page.document.querySelectorAll('[data-role="compound-row"]').length,
    tick: () => timers.get(1)(),
    clear: () => menus.get('清除 Strategy 27 图表标注')(),
    restart: () => menus.get('重新连接 Strategy 27 并恢复历史')(),
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

test('each context tick discovers the chart root once without restarting healthy clients', async (t) => {
  const h = await harness(t);
  let chartRootQueries = 0;
  const query = h.page.document.querySelectorAll.bind(h.page.document);
  t.mock.method(h.page.document, 'querySelectorAll', selector => {
    if (selector === '.chart-widget-root') chartRootQueries += 1;
    return query(selector);
  });
  for (let index = 0; index < 10; index += 1) h.tick();
  assert.equal(chartRootQueries, 10);
  assert.equal(h.pending('ordinary').length, 1);
  assert.equal(h.pending('compound').length, 1);
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

function compoundMessage(payload = fixtures[0], sequence = 2, epoch = 'a'.repeat(32)) {
  return {
    schema_version: 1,
    projection_kind: 'compound_candidate',
    runtime_epoch: epoch,
    sequence,
    message_kind: 'candidate',
    symbol: payload.symbol,
    observed_at_ms: 7000,
    payload,
  };
}

for (const generated of [false, true]) {
  test(`${generated ? 'generated' : 'source'} compound recovery retains exact paired entities across epochs, stale cursors and 503`, async (t) => {
    const h = await harness(t, { generated });
    await h.ordinaryBootstrap();
    await h.respond('ordinary', { schema_version: 1, status: 'ok', requested_cursor: '1-0', next_cursor: '2-0', messages: [ordinaryMessage()] });
    await until(() => h.pending('ordinary').length === 1);
    await h.reset();
    await h.respond('compound', { schema_version: 1, status: 'ok', requested_cursor: '1-0', next_cursor: '2-0', messages: [compoundMessage(fixtures[0], 2), compoundMessage(fixtures[1], 3)] });
    await until(() => h.pending('compound').length === 1);
    const ids = [...h.shapes.keys()];
    const points = ids.slice(1).map((id) => h.shapes.get(id).getPoints());
    assert.equal(ids.length, 6);
    assert.equal(h.rows(), 2);
    const epoch = 'b'.repeat(32);
    await h.respond('compound', { schema_version: 1, status: 'ok', requested_cursor: '2-0', next_cursor: '3-0', messages: [
      { ...compoundMessage(fixtures[0], 1, epoch), message_kind: 'stream_state', symbol: null, payload: { state: 'ready', reason: 'transport_recovered' } },
      compoundMessage(fixtures[0], 2, epoch), compoundMessage(fixtures[1], 3, epoch),
    ] });
    await until(() => h.pending('compound').length === 1);
    assert.deepEqual([...h.shapes.keys()], ids);
    assert.equal(h.rows(), 2);
    await h.respond('compound', { schema_version: 1, status: 'reset', reason: 'stale_cursor', requested_cursor: '3-0', next_cursor: '5-0', messages: [] }, 409);
    await until(() => h.pending('compound').length === 1);
    assert.equal(new URL(h.pending('compound')[0].options.url).pathname, '/v1/strategy27/compound-candidates/bootstrap');
    assert.deepEqual([...h.shapes.keys()], ids);
    await h.respond('compound', { schema_version: 1, status: 'bootstrap', projection_kind: 'compound_candidates', requested_cursor: null, next_cursor: '5-0', runtime_epoch: 'c'.repeat(32), last_sequence: 4, bootstrap_observed_at_ms: 7000, records: [compoundMessage(fixtures[0], 3, 'c'.repeat(32))] });
    await until(() => h.pending('compound').length === 1);
    assert.deepEqual([...h.shapes.keys()], ids);
    assert.equal(h.rows(), 2, 'the candidate absent from the new snapshot remains visible');
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await h.respond('compound', { schema_version: 1, status: 'error', error_code: 'redis_unavailable' }, 503);
    await until(() => h.page.document.querySelector('[data-role="compound-status"]').dataset.state === 'inactive');
    assert.deepEqual([...h.shapes.keys()], ids);
    assert.equal(h.pending('compound').length, 0);
    t.mock.timers.tick(2000);
    await until(() => h.pending('compound').length === 1);
    assert.equal(new URL(h.pending('compound')[0].options.url).pathname, '/v1/strategy27/compound-candidates/bootstrap');
    await h.respond('compound', { schema_version: 1, status: 'bootstrap', projection_kind: 'compound_candidates', requested_cursor: null, next_cursor: '8-0', runtime_epoch: 'd'.repeat(32), last_sequence: 1, bootstrap_observed_at_ms: 7000, records: [] });
    await until(() => h.pending('compound').length === 1);
    assert.deepEqual([...h.shapes.keys()], ids);
    assert.deepEqual(ids.slice(1).map((id) => h.shapes.get(id).getPoints()), points);
    assert.equal(h.rows(), 2);
    assert.equal(h.pending('ordinary').length, 1);
    h.setNow(7207001);
    h.tick();
    assert.deepEqual([...h.shapes.keys()], ['user-owned']);
    assert.equal(h.rows(), 0);
  });

  test(`${generated ? 'generated' : 'source'} compound repair failure freezes surviving pairs until clear or context retirement`, async (t) => {
    const h = await harness(t, { generated });
    await h.reset();
    await h.respond('compound', { schema_version: 1, status: 'ok', requested_cursor: '1-0', next_cursor: '2-0', messages: [compoundMessage(fixtures[0], 2), compoundMessage(fixtures[1], 3)] });
    await until(() => h.pending('compound').length === 1);
    const ids = [...h.shapes.keys()];
    assert.equal(ids.length, 5);
    h.shapes.delete(ids[1]);
    const create = h.chart.createShape;
    h.chart.createShape = (point, options) => create({ ...point, time: point.time - 1 }, options);
    h.tick();
    await until(() => h.page.document.querySelector('[data-role="compound-status"]').dataset.state === 'error');
    const surviving = [ids[0], ...ids.slice(2)];
    assert.deepEqual([...h.shapes.keys()], surviving);
    assert.equal(h.rows(), 2);
    assert.equal(h.pending('compound').length, 0);
    assert.equal(h.pending('ordinary').length, 1);
    assert.match(h.page.document.querySelector('[data-role="compound-status"]').textContent, /历史记录已保留.*time alignment failed/);
    h.tick();
    await new Promise(setImmediate);
    assert.deepEqual([...h.shapes.keys()], surviving);
    h.clear();
    assert.deepEqual([...h.shapes.keys()], ['user-owned']);
    assert.equal(h.rows(), 0);
    assert.match(h.page.document.querySelector('[data-role="compound-status"]').textContent, /time alignment failed/);
    h.chart.createShape = create;
    h.restart();
    await h.reset();
    await h.candidate();
    assert.equal(h.rows(), 1);
    assert.equal(h.shapes.size, 3);
    await h.respond('compound', 'invalid JSON');
    await until(() => h.page.document.querySelector('[data-role="compound-status"]').dataset.state === 'error');
    h.setResolution('1');
    h.tick();
    assert.deepEqual([...h.shapes.keys()], ['user-owned']);
    assert.equal(h.rows(), 0);
    assert.equal(h.pending('compound').length, 0);
  });

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

for (const generated of [false, true]) {
  test(`${generated ? 'generated' : 'source'} live 503 retains ordinary history and resumes at the same cursor`, async (t) => {
    const h = await harness(t, { generated });
    await h.ordinaryBootstrap();
    await h.respond('ordinary', { schema_version: 1, status: 'ok', requested_cursor: '1-0', next_cursor: '2-0', messages: [ordinaryMessage()] });
    await until(() => h.pending('ordinary').length === 1);
    const ids = [...h.shapes.keys()];
    assert.equal(ids.length, 2);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    await h.respond('ordinary', { schema_version: 1, status: 'error', error_code: 'redis_unavailable' }, 503);
    await until(() => h.page.document.getElementById('jh-strategy27-event-status') !== null);
    assert.equal(h.page.document.getElementById('jh-strategy27-event-status').dataset.state, 'inactive');
    h.tick();
    assert.deepEqual([...h.shapes.keys()], ids);
    assert.equal(h.page.document.querySelectorAll('[data-role="event-row"]').length, 1);
    t.mock.timers.tick(1999);
    assert.equal(h.pending('ordinary').length, 0);
    t.mock.timers.tick(1);
    await until(() => h.pending('ordinary').length === 1);
    assert.equal(new URL(h.pending('ordinary')[0].options.url).searchParams.get('cursor'), '2-0');
    await h.respond('ordinary', { schema_version: 1, status: 'ok', requested_cursor: '2-0', next_cursor: '3-0', messages: [{ ...ordinaryMessage(), sequence: 3 }] });
    await until(() => h.pending('ordinary').length === 1);
    assert.deepEqual([...h.shapes.keys()], ids);
    assert.equal(h.page.document.querySelectorAll('[data-role="event-row"]').length, 1);
    assert.equal(h.page.document.getElementById('jh-strategy27-event-status'), null);
  });

  test(`${generated ? 'generated' : 'source'} fatal repair preserves surviving history until expiry or explicit restart`, async (t) => {
    const h = await harness(t, { generated });
    await h.ordinaryBootstrap();
    const first = ordinaryMessage();
    const second = { ...ordinaryMessage(), event_id: 'c'.repeat(64), sequence: 3 };
    await h.respond('ordinary', { schema_version: 1, status: 'ok', requested_cursor: '1-0', next_cursor: '3-0', messages: [first, second] });
    await until(() => h.pending('ordinary').length === 1);
    assert.equal(h.shapes.size, 3);
    const ids = [...h.shapes.keys()].filter((id) => id !== 'user-owned');
    h.shapes.delete(ids[0]);
    const create = h.chart.createShape;
    h.chart.createShape = async (point, options) => create({ ...point, time: point.time - 1 }, options);
    h.tick();
    await until(() => h.page.document.getElementById('jh-strategy27-event-status')?.dataset.state === 'error');
    assert.match(h.page.document.getElementById('jh-strategy27-event-status').textContent, /time alignment failed/);
    assert.deepEqual([...h.shapes.keys()], ['user-owned', ids[1]]);
    assert.equal(h.page.document.querySelectorAll('[data-role="event-row"]').length, 2);
    assert.equal(h.pending('ordinary').length, 0);
    h.tick();
    await new Promise(setImmediate);
    assert.deepEqual([...h.shapes.keys()], ['user-owned', ids[1]]);
    h.setNow(7207001);
    h.tick();
    assert.deepEqual([...h.shapes.keys()], ['user-owned']);
    assert.equal(h.page.document.querySelectorAll('[data-role="event-row"]').length, 0);
    h.chart.createShape = create;
    h.setNow(7000);
    h.restart();
    assert.equal(h.pending('ordinary').length, 1);
    assert.equal(new URL(h.pending('ordinary')[0].options.url).pathname, '/v1/strategy27/events/bootstrap');
    await h.ordinaryBootstrap();
    await h.respond('ordinary', { schema_version: 1, status: 'ok', requested_cursor: '1-0', next_cursor: '2-0', messages: [first] });
    await until(() => h.pending('ordinary').length === 1);
    assert.equal(h.shapes.size, 2);
    assert.equal(h.page.document.querySelectorAll('[data-role="event-row"]').length, 1);
  });
}

function ordinaryStreamReset(epoch = 'c'.repeat(32)) {
  return { ...ordinaryMessage(), runtime_epoch: epoch, sequence: 1,
    message_kind: 'stream_state', symbol: null, event_id: null,
    observed_at_ms: 7000, event_time_ms: 7000, data_status: 'ready',
    payload: { state: 'ready', reason: 'transport_recovered' } };
}

for (const generated of [false, true]) {
  test(`${generated ? 'generated' : 'source'} transport epoch reset retains historical arrows and rehydrates without duplication`, async (t) => {
    const h = await harness(t, { generated });
    await h.ordinaryBootstrap();
    await h.respond('ordinary', { schema_version: 1, status: 'ok', requested_cursor: '1-0', next_cursor: '2-0', messages: [ordinaryMessage()] });
    await until(() => h.pending('ordinary').length === 1);
    const ids = [...h.shapes.keys()];
    assert.equal(ids.length, 2);
    await h.respond('ordinary', { schema_version: 1, status: 'ok', requested_cursor: '2-0', next_cursor: '3-0', messages: [ordinaryStreamReset()] });
    await until(() => h.pending('ordinary').length === 1);
    assert.deepEqual([...h.shapes.keys()], ids);
    assert.equal(h.page.document.querySelectorAll('[data-role="event-row"]').length, 1);
    assert.match(h.page.document.body.textContent, /历史记录/);
    const replay = { ...ordinaryMessage(), runtime_epoch: 'c'.repeat(32), sequence: 2 };
    await h.respond('ordinary', { schema_version: 1, status: 'ok', requested_cursor: '3-0', next_cursor: '4-0', messages: [replay] });
    await until(() => h.pending('ordinary').length === 1);
    assert.deepEqual([...h.shapes.keys()], ids);
    assert.equal(h.page.document.querySelectorAll('[data-role="event-row"]').length, 1);
    assert.doesNotMatch(h.page.document.body.textContent, /历史记录/);
    await h.respond('ordinary', { schema_version: 1, status: 'ok', requested_cursor: '4-0', next_cursor: '5-0', messages: [ordinaryStreamReset('d'.repeat(32))] });
    await until(() => h.pending('ordinary').length === 1);
    h.setNow(7207001);
    h.tick();
    await new Promise(setImmediate);
    assert.deepEqual([...h.shapes.keys()], ['user-owned']);
    assert.equal(h.page.document.querySelectorAll('[data-role="event-row"]').length, 0);
  });
}

for (const generated of [false, true]) {
  test(`${generated ? 'generated' : 'source'} stale cursor bootstrap merges retained history and context exit removes it`, async (t) => {
    const h = await harness(t, { generated });
    await h.ordinaryBootstrap();
    const ordinary = ordinaryMessage();
    await h.respond('ordinary', { schema_version: 1, status: 'ok', requested_cursor: '1-0', next_cursor: '2-0', messages: [ordinary] });
    await until(() => h.pending('ordinary').length === 1);
    const ids = [...h.shapes.keys()];
    await h.respond('ordinary', { schema_version: 1, status: 'reset', reason: 'stale_cursor', requested_cursor: '2-0', next_cursor: '5-0', messages: [] }, 409);
    await until(() => h.pending('ordinary').length === 1);
    assert.deepEqual([...h.shapes.keys()], ids);
    await h.respond('ordinary', { schema_version: 1, status: 'bootstrap', projection_kind: 'strategy27_events', requested_cursor: null,
      next_cursor: '6-0', runtime_epoch: ordinary.runtime_epoch, last_sequence: 2, bootstrap_observed_at_ms: 7000,
      records: [{ event_id: ordinary.event_id, event_envelope: ordinary, marker_envelope: ordinary, outcome_envelope: null }] });
    await until(() => h.pending('ordinary').length === 1);
    assert.deepEqual([...h.shapes.keys()], ids);
    assert.equal(h.page.document.querySelectorAll('[data-role="event-row"]').length, 1);
    h.setResolution('1');
    h.tick();
    assert.deepEqual([...h.shapes.keys()], ['user-owned']);
    assert.equal(h.page.document.querySelectorAll('[data-role="event-row"]').length, 0);
  });

  test(`${generated ? 'generated' : 'source'} retained display history stays bounded across epochs and manual clear removes it`, async (t) => {
    const h = await harness(t, { generated });
    await h.ordinaryBootstrap();
    const messages = Array.from({ length: 80 }, (_, i) => ({ ...ordinaryMessage(), sequence: i + 2, event_id: i.toString(16).padStart(64, '0') }));
    await h.respond('ordinary', { schema_version: 1, status: 'ok', requested_cursor: '1-0', next_cursor: '81-0', messages });
    await until(() => h.pending('ordinary').length === 1);
    assert.equal(h.shapes.size, 81);
    const firstId = [...h.shapes.keys()][1];
    await h.respond('ordinary', { schema_version: 1, status: 'ok', requested_cursor: '81-0', next_cursor: '82-0', messages: [ordinaryStreamReset()] });
    await until(() => h.pending('ordinary').length === 1);
    assert.equal(h.shapes.size, 81);
    await h.respond('ordinary', { schema_version: 1, status: 'ok', requested_cursor: '82-0', next_cursor: '83-0', messages: [{ ...ordinaryMessage(), runtime_epoch: 'c'.repeat(32), sequence: 2 }] });
    await until(() => h.pending('ordinary').length === 1);
    assert.equal(h.shapes.size, 81);
    assert.equal(h.shapes.has(firstId), false);
    assert.equal(h.page.document.querySelectorAll('[data-role="event-row"]').length, 8);
    h.clear();
    assert.deepEqual([...h.shapes.keys()], ['user-owned']);
    h.tick();
    await new Promise(setImmediate);
    assert.deepEqual([...h.shapes.keys()], ['user-owned']);
    assert.equal(h.page.document.querySelectorAll('[data-role="event-row"]').length, 0);
  });
}

test('display capacity uses last observation rather than insertion order after epoch rehydration', async (t) => {
  const h = await harness(t);
  await h.ordinaryBootstrap();
  const events = Array.from({ length: 80 }, (_, i) => ({ ...ordinaryMessage(), sequence: i + 2, event_id: i.toString(16).padStart(64, '0') }));
  await h.respond('ordinary', { schema_version: 1, status: 'ok', requested_cursor: '1-0', next_cursor: '81-0', messages: events });
  await until(() => h.pending('ordinary').length === 1);
  const ids = [...h.shapes.keys()];
  await h.respond('ordinary', { schema_version: 1, status: 'ok', requested_cursor: '81-0', next_cursor: '82-0', messages: [ordinaryStreamReset(), { ...events[0], runtime_epoch: 'c'.repeat(32), sequence: 2, observed_at_ms: 7000 }] });
  await until(() => h.pending('ordinary').length === 1);
  await h.respond('ordinary', { schema_version: 1, status: 'ok', requested_cursor: '82-0', next_cursor: '83-0', messages: [{ ...ordinaryMessage(), runtime_epoch: 'c'.repeat(32), sequence: 3, observed_at_ms: 7000 }] });
  await until(() => h.pending('ordinary').length === 1);
  assert.equal(h.shapes.size, 81);
  assert.equal(h.shapes.has(ids[1]), true);
  assert.equal(h.shapes.has(ids[2]), false);
  h.setNow(7202001);
  h.tick();
  await new Promise(setImmediate);
  assert.equal(h.shapes.size, 3);
  assert.equal(h.shapes.has(ids[1]), true);
});

test('older bootstrap replay cannot shorten the retained display lifetime', async (t) => {
  const h = await harness(t);
  await h.ordinaryBootstrap();
  await h.respond('ordinary', { schema_version: 1, status: 'ok', requested_cursor: '1-0', next_cursor: '2-0', messages: [{ ...ordinaryMessage(), observed_at_ms: 7000 }] });
  await until(() => h.pending('ordinary').length === 1);
  const ids = [...h.shapes.keys()];
  await h.respond('ordinary', { schema_version: 1, status: 'reset', reason: 'stale_cursor', requested_cursor: '2-0', next_cursor: '5-0', messages: [] }, 409);
  await until(() => h.pending('ordinary').length === 1);
  const old = ordinaryMessage();
  await h.respond('ordinary', { schema_version: 1, status: 'bootstrap', projection_kind: 'strategy27_events', requested_cursor: null,
    next_cursor: '6-0', runtime_epoch: old.runtime_epoch, last_sequence: 2, bootstrap_observed_at_ms: 7000,
    records: [{ event_id: old.event_id, event_envelope: old, marker_envelope: old, outcome_envelope: null }] });
  await until(() => h.pending('ordinary').length === 1);
  h.setNow(7202001);
  h.tick();
  await new Promise(setImmediate);
  assert.deepEqual([...h.shapes.keys()], ids);
  assert.equal(h.page.document.querySelectorAll('[data-role="event-row"]').length, 1);
  h.setNow(7207001);
  h.tick();
  await new Promise(setImmediate);
  assert.deepEqual([...h.shapes.keys()], ['user-owned']);
  assert.equal(h.page.document.querySelectorAll('[data-role="event-row"]').length, 0);
});

for (const generated of [false, true]) {
  test(`${generated ? 'generated' : 'source'} removed-symbol bootstrap exposes monitoring status across stream reset`, async (t) => {
    const h = await harness(t, { generated });
    const removed = { ...ordinaryMessage(), message_kind: 'event_closed', data_status: 'incomplete',
      payload: { event: { ...ordinaryOutcomeMessage().payload.event, event_status: 'incomplete', close_reason: 'universe_removed' } } };
    await h.respond('ordinary', { schema_version: 1, status: 'bootstrap', projection_kind: 'strategy27_events', requested_cursor: null,
      next_cursor: '2-0', runtime_epoch: removed.runtime_epoch, last_sequence: 2, bootstrap_observed_at_ms: 7000,
      records: [{ event_id: removed.event_id, event_envelope: removed, marker_envelope: removed, outcome_envelope: null }] });
    await until(() => h.pending('ordinary').length === 1);
    const status = h.page.document.querySelector('[data-role="ordinary-monitoring-status"]');
    assert.equal(status?.dataset.state, 'removed');
    assert.match(status.textContent, /已移出监控范围/);
    await h.respond('ordinary', { schema_version: 1, status: 'ok', requested_cursor: '2-0', next_cursor: '3-0', messages: [ordinaryStreamReset()] });
    await until(() => h.pending('ordinary').length === 1);
    assert.equal(status.dataset.state, 'removed');
    const connection = h.page.document.querySelector('[data-role="ordinary-connection-status"]');
    assert.match(connection.textContent, /已连接/);
    assert.equal(h.shapes.size, 2);
    h.setResolution('1'); h.tick();
    assert.equal(h.page.document.querySelector('[data-role="ordinary-monitoring-status"]'), null);
  });
}

for (const generated of [false, true]) {
  test(`${generated ? 'generated' : 'source'} outcome-only bootstrap restores removed-symbol status`, async (t) => {
    const h = await harness(t, { generated });
    const outcome = ordinaryOutcomeMessage();
    outcome.data_status = 'terminated';
    outcome.payload.event.event_status = 'incomplete';
    outcome.payload.event.close_reason = 'universe_removed';
    Object.assign(outcome.payload.outcome, { outcome_status: 'terminated', terminated_at_ms: 2000, termination_reason: 'universe_removed', directional_outcome: null });
    await h.respond('ordinary', { schema_version: 1, status: 'bootstrap', projection_kind: 'strategy27_events', requested_cursor: null,
      next_cursor: '3-0', runtime_epoch: outcome.runtime_epoch, last_sequence: 3, bootstrap_observed_at_ms: 7000,
      records: [{ event_id: outcome.event_id, event_envelope: outcome, marker_envelope: null, outcome_envelope: outcome }] });
    await until(() => h.pending('ordinary').length === 1);
    assert.equal(h.page.document.querySelector('[data-role="ordinary-monitoring-status"]').dataset.state, 'removed');
    assert.equal(h.page.document.querySelector('[data-role="ordinary-connection-status"]').dataset.state, 'connected');
  });
}

for (const generated of [false, true]) {
  test(`${generated ? 'generated' : 'source'} English route localizes ordinary and compound content and language switching updates menus`, async (t) => {
    const h = await harness(t, { generated, locale: 'en' });
    await h.ordinaryBootstrap();
    await h.respond('ordinary', { schema_version: 1, status: 'ok', requested_cursor: '1-0', next_cursor: '2-0', messages: [ordinaryMessage()] });
    await until(() => h.pending('ordinary').length === 1);
    await h.reset(); await h.candidate();
    const panel = () => h.page.document.getElementById('jh-strategy27-event-panel');
    assert.doesNotMatch(panel().textContent, /\p{Script=Han}/u);
    assert.match(panel().textContent, /Compound|candidate/i);
    h.page.document.querySelector('[data-role="event-row"]').click();
    assert.match(panel().textContent, /Order-flow observation/);
    assert.doesNotMatch(panel().textContent, /\p{Script=Han}/u);
    assert.equal(h.menus.size, 4);
    assert.equal([...h.menus.keys()].some(text => /\p{Script=Han}/u.test(text)), false);
    const priorPanel = panel();
    const ordinaryRequest = h.pending('ordinary')[0];
    const compoundRequest = h.pending('compound')[0];
    const shapeIds = [...h.shapes.keys()];
    assert.equal([...h.shapes.values()].filter(shape => shape.getProperties?.().text === 'High candidate').length, 1);
    h.page.history.pushState({}, '', '/zh-CN/futures/BTCUSDT');
    await until(() => h.menus.has('重新连接 Strategy 27 并恢复历史'));
    assert.equal(panel(), priorPanel);
    assert.equal(h.pending('ordinary')[0], ordinaryRequest);
    assert.equal(h.pending('compound')[0], compoundRequest);
    assert.deepEqual([...h.shapes.keys()], shapeIds);
    assert.equal([...h.shapes.values()].filter(shape => shape.getProperties?.().text === '候选高').length, 1);
    assert.match(panel().textContent, /已收到观察记录/);
    assert.doesNotMatch(panel().textContent, /Monitoring|Connected|Historical/);
    assert.equal(h.menus.size, 4);
    assert.equal(h.menus.has('重新连接 Strategy 27 并恢复历史'), true);
    h.page.history.pushState({}, '', '/en/futures/BTCUSDT');
    await until(() => h.menus.has('Reconnect Strategy 27 and restore history'));
    assert.equal(panel(), priorPanel);
    assert.equal(h.pending('ordinary')[0], ordinaryRequest);
    assert.equal(h.pending('compound')[0], compoundRequest);
    assert.deepEqual([...h.shapes.keys()], shapeIds);
    assert.doesNotMatch(panel().textContent, /\p{Script=Han}/u);
    assert.equal(h.menus.size, 4);
  });
}

for (const generated of [false, true]) {
  test(`${generated ? 'generated' : 'source'} ignores retired preference records and provides only the shared transport`, async (t) => {
    const h = await harness(t, { generated, migrationRecord: { version: 1, enabled: true, position: null, secret: 'synthetic-rejected-value' } });
    assert.equal(h.page[Symbol.for('jh-userscripts.signal-gateway')].version, 1);
    assert.equal(h.page.__TM_SIGNAL_CLIENT_DEBUG__, undefined);
    assert.equal(h.pending('ordinary').length, 1);
    assert.equal(h.pending('compound').length, 1);
    await h.ordinaryBootstrap();
    await until(() => h.pending('ordinary').length === 1);
    assert.equal(h.pending('ordinary').length, 1);
    assert.equal(h.page.document.querySelectorAll('#jh-strategy29-summary-panel').length, 0);
  });

  test(`${generated ? 'generated' : 'source'} locale switch updates stopped status and prompts without reconnecting`, async (t) => {
    const h = await harness(t, { generated, locale: 'en' });
    const prompts = h.prompts;
    t.mock.method(h.page, 'prompt', () => { throw new Error('Page prompt must not receive private input'); });
    h.menus.get('Set CorsairQuant gateway secret')();
    h.menus.get('Set CorsairQuant local gateway URL')();
    assert.equal(prompts.length, 2);
    assert.doesNotMatch(prompts.join(' '), /\p{Script=Han}/u);
    await h.respond('ordinary', 'invalid JSON');
    await until(() => h.page.document.querySelector('[data-role="ordinary-connection-status"]').dataset.state === 'stopped');
    const count = h.requests.length;
    const status = h.page.document.getElementById('jh-strategy27-event-status');
    assert.match(status.textContent, /stopped; history retained/);
    h.page.history.pushState({}, '', '/zh-CN/futures/BTCUSDT');
    assert.equal(h.requests.length, count);
    assert.match(status.textContent, /已停止，历史记录已保留/);
    assert.equal(h.page.document.querySelector('[data-role="ordinary-connection-status"]').textContent, '事件数据：已停止');
    h.menus.get('设置 CorsairQuant 网关密钥')();
    h.menus.get('设置 CorsairQuant 本机网关地址')();
    assert.match(prompts[2], /输入 CorsairQuant/);
    assert.match(prompts[3], /输入 SSH/);
    assert.equal(h.menus.size, 4);
  });
}


for (const generated of [false, true]) {
test(`${generated ? 'generated' : 'source'} Unicode URL and chart symbol start both clients and draw the Python candidate`, async (t) => {
  const candidateFixture = JSON.parse(readFileSync(new URL('../../fixtures/strategy27-unicode-candidate.json', import.meta.url), 'utf8'));
  const h = await harness(t, {generated, routeSymbol: '币安人生USDT', candidateFixture});
  assert.equal(h.pending('ordinary').length, 1);
  assert.equal(h.pending('compound').length, 1);
  await h.reset();
  await h.candidate();
  assert.equal(h.rows(), 1);
  assert.equal(h.shapes.size, 3);
  assert.ok(h.requests.every((request) => new URL(request.options.url).searchParams.get('symbol') === candidateFixture.symbol));
});
}
