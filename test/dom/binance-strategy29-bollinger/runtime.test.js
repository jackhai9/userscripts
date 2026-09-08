import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { installStrategy29 } from '../../../src/binance-strategy29-bollinger/runtime.js';

const gatewayStatus = JSON.parse(await readFile(new URL('../../fixtures/strategy29-gateway-status.json', import.meta.url)));
const gatewayEvents = JSON.parse(await readFile(new URL('../../fixtures/strategy29-gateway-events.json', import.meta.url)));

function fixture() {
  const dom = new JSDOM('<body></body>', { url: 'https://www.binance.com/en/futures/BTRUSDT' });
  const view = dom.window;
  let hidden = false, next = 0;
  const timers = new Map();
  Object.defineProperty(view.document, 'hidden', { get: () => hidden });
  view.console.warn = () => {};
  view.setInterval = callback => { timers.set(++next, callback); return next; };
  view.clearInterval = id => timers.delete(id);
  return { dom, view, timers,
    tick() { for (const callback of timers.values()) callback(); },
    hide(value) { hidden = value; view.document.dispatchEvent(new view.Event('visibilitychange')); } };
}

test('standalone injection is single-instance and pauses/resumes/disposes its only timer', () => {
  const f = fixture();
  const runtime = installStrategy29(f.view);
  assert.equal(installStrategy29(f.view), runtime);
  assert.equal(f.timers.size, 1);
  f.hide(true);
  assert.equal(f.timers.size, 0);
  f.hide(false);
  assert.equal(f.timers.size, 1);
  f.view.history.pushState({}, '', '/en/my/wallet/futures');
  assert.equal(runtime.diagnostics.contextPresent, false);
  runtime.dispose();
  assert.equal(f.timers.size, 0);
  f.hide(true); f.hide(false);
  assert.equal(f.timers.size, 0);
  f.dom.window.close();
});

test('remote transport failure never stops the local observer timer', async () => {
  const f = fixture();
  const values = new Map([
    ['strategy29GatewayAuthSecret', 'synthetic-secret'],
    ['strategy29GatewayOrigin', 'http://127.0.0.1:8729'],
  ]);
  const runtime = installStrategy29(f.view, {
    request: async () => { throw new Error('synthetic remote failure'); },
    getValue: (key, fallback) => values.has(key) ? values.get(key) : fallback,
    setValue: (key, value) => values.set(key, value),
    registerMenuCommand() {},
    getGatewayState() { return { available: true, configured: true, settingsRevision: 0 }; },
  });
  await new Promise(resolve => f.view.setTimeout(resolve, 0));
  assert.equal(runtime.diagnostics.runtimeFailure, null);
  assert.equal(runtime.diagnostics.remoteSummary.state, 'stopped');
  assert.equal(f.timers.size, 1);
  runtime.dispose();
  f.dom.window.close();
});

for (const [name, remoteResponse, expectedState] of [
  ['HTTP 400', { status: 400, responseText: JSON.stringify({ schema_version: 1, error: 'invalid_request' }) }, 'stopped'],
  ['HTTP 401', { status: 401, responseText: JSON.stringify({ schema_version: 1, error: 'unauthorized' }) }, 'stopped'],
  ['HTTP 503', { status: 503, responseText: JSON.stringify({ schema_version: 1, error: 'database_unavailable' }) }, 'unavailable'],
  ['invalid JSON', { status: 200, responseText: '<html>' }, 'stopped'],
  ['spec mismatch', { status: 200, responseText: JSON.stringify({ ...gatewayStatus, spec_version: 'other_spec' }) }, 'incompatible'],
]) {
  test(`${name} remains a remote-only state while the local timer continues`, async () => {
    const f = fixture();
    const values = new Map([
      ['strategy29GatewayAuthSecret', 'synthetic-secret'],
      ['strategy29GatewayOrigin', 'http://127.0.0.1:8729'],
    ]);
    const runtime = installStrategy29(f.view, {
      request: async () => remoteResponse,
      getValue: (key, fallback) => values.has(key) ? values.get(key) : fallback,
      setValue: (key, value) => values.set(key, value),
      registerMenuCommand() {},
      getGatewayState() { return { available: true, configured: true, settingsRevision: 0 }; },
    });
    await new Promise(resolve => f.view.setTimeout(resolve, 0));
    assert.equal(runtime.diagnostics.runtimeFailure, null);
    assert.equal(runtime.diagnostics.remoteSummary.state, expectedState);
    assert.equal(f.timers.size, 1);
    runtime.dispose();
    f.dom.window.close();
  });
}

test('hiding the page aborts the remote request and resumes with one shared runtime timer', async () => {
  const f = fixture();
  const values = new Map([
    ['strategy29GatewayAuthSecret', 'synthetic-secret'],
    ['strategy29GatewayOrigin', 'http://127.0.0.1:8729'],
  ]);
  let aborts = 0;
  const runtime = installStrategy29(f.view, {
    request: ({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => { aborts += 1; reject(signal.reason); }, { once: true });
    }),
    getValue: (key, fallback) => values.has(key) ? values.get(key) : fallback,
    setValue: (key, value) => values.set(key, value),
    registerMenuCommand() {},
    getGatewayState() { return { available: true, configured: true, settingsRevision: 0 }; },
  });
  assert.equal(runtime.diagnostics.remoteSummary.inFlight, true);
  f.hide(true);
  await new Promise(resolve => f.view.setTimeout(resolve, 0));
  assert.equal(aborts, 1);
  assert.equal(f.timers.size, 0);
  assert.equal(runtime.diagnostics.remoteSummary.contextPresent, true);
  f.hide(false);
  assert.equal(f.timers.size, 1);
  assert.equal(runtime.diagnostics.remoteSummary.inFlight, true);
  runtime.dispose();
  f.dom.window.close();
});

test('actual remote client retains rows and cursor across visibility and bootstraps a new route', async () => {
  const f = fixture();
  const values = new Map([
    ['strategy29GatewayAuthSecret', 'synthetic-secret'],
  ]);
  const urls = [];
  const first = { ...gatewayEvents.events[0], symbol: 'BTR/USDT:USDT', sequence: 900 };
  const second = { ...gatewayEvents.events[1], symbol: 'BTR/USDT:USDT', sequence: 901 };
  const runtime = installStrategy29(f.view, {
    request: async ({ path: url }) => {
      const query = new URL(url, 'https://gateway.invalid');
      let body = gatewayStatus;
      if (query.pathname.endsWith('/events')) {
        urls.push(query);
        const records = query.searchParams.get('symbol') === 'ETH/USDT:USDT'
          ? [] : query.searchParams.has('cursor') ? [second] : [first];
        body = { ...gatewayEvents, events: records, next_cursor: urls.length === 1 ? 900 : 901, has_more: false };
      }
      return { status: 200, responseText: JSON.stringify(body) };
    },
    getValue: (key, fallback) => values.has(key) ? values.get(key) : fallback,
    setValue: (key, value) => values.set(key, value),
    registerMenuCommand() {}, getGatewayState() { return { available: true, configured: true, settingsRevision: 0 }; },
  });
  const settle = () => new Promise(resolve => f.view.setTimeout(resolve, 0));
  await settle();
  const panel = f.view.document.getElementById('jh-strategy29-summary-panel');
  assert.equal(urls[0].searchParams.get('mode'), 'latest');
  assert.equal(panel.querySelectorAll('[data-role=remote-event]').length, 1);
  f.hide(true);
  assert.equal(runtime.diagnostics.remoteSummary.cursor, 900);
  f.hide(false);
  await settle();
  assert.equal(f.view.document.getElementById('jh-strategy29-summary-panel'), panel);
  assert.equal(urls[1].searchParams.get('cursor'), '900');
  assert.equal(runtime.diagnostics.remoteSummary.cursor, 901);
  assert.deepEqual([...panel.querySelectorAll('[data-role=remote-event]')].map(row => row.dataset.eventId), [second.event_id, first.event_id]);
  f.view.history.pushState({}, '', '/en/futures/ETHUSDT');
  await settle();
  assert.equal(urls[2].searchParams.get('mode'), 'latest');
  assert.equal(urls[2].searchParams.has('cursor'), false);
  assert.equal(panel.isConnected, false);
  assert.equal(f.view.document.querySelectorAll('[data-role=remote-event]').length, 0);
  runtime.dispose();
  f.dom.window.close();
});

for (const failure of ['embedded conflict', 'interval subscription failure']) {
  test(`permanent ${failure} retires the populated remote panel and request`, async () => {
    const f = fixture();
    const values = new Map([
      ['strategy29GatewayAuthSecret', 'synthetic-secret'],
    ]);
    let requests = 0, aborts = 0;
    let releaseLate;
    const runtime = installStrategy29(f.view, {
      request: ({ path: url, signal }) => {
        requests += 1;
        if (requests > 2) return new Promise(resolve => {
          releaseLate = resolve;
          signal.addEventListener('abort', () => { aborts += 1; }, { once: true });
        });
        const body = url.includes('/status') ? gatewayStatus : {
          ...gatewayEvents,
          events: [{ ...gatewayEvents.events[0], symbol: 'BTR/USDT:USDT' }],
          has_more: false,
        };
        return Promise.resolve({ status: 200, responseText: JSON.stringify(body) });
      },
      getValue: (key, fallback) => values.has(key) ? values.get(key) : fallback,
      setValue: (key, value) => values.set(key, value),
      registerMenuCommand() {}, getGatewayState() { return { available: true, configured: true, settingsRevision: 0 }; },
    });
    const settle = () => new Promise(resolve => f.view.setTimeout(resolve, 0));
    try {
      await settle();
      const panel = f.view.document.getElementById('jh-strategy29-summary-panel');
      assert.equal(panel.querySelectorAll('[data-role=remote-event]').length, 1);
      assert.equal(runtime.diagnostics.remoteSummary.state, 'connected');
      f.hide(true); f.hide(false);
      assert.equal(requests, 3);
      if (failure === 'embedded conflict') {
        f.view.__TM_CLOSE_LONG_DEBUG__ = { bollingerAlertState: {} };
      } else {
        const root = f.view.document.createElement('div');
        root.className = 'chart-widget-root';
        root.innerHTML = '<iframe></iframe>';
        root.getClientRects = () => [{ width: 800, height: 600 }];
        root.getBoundingClientRect = () => ({ width: 800, height: 600 });
        f.view.document.body.append(root);
        const chart = {
          symbol: () => 'BTRUSDT@PRICETYPE=LAST', resolution: () => '1',
          hasModel: () => true, dataReady: () => true,
          onIntervalChanged() { throw new Error('synthetic interval subscription failure'); },
          onDataLoaded() {}, createShape() {}, exportData() {},
          getAllShapes() {}, getShapeById() {}, removeEntity() {},
        };
        root.querySelector('iframe').contentWindow.tradingViewApi = { activeChart: () => chart };
      }
      f.tick();
      await settle();
      assert.match(runtime.diagnostics.runtimeFailure, failure === 'embedded conflict' ? /update Orderbook/ : /synthetic interval subscription failure/);
      assert.equal(aborts, 1);
      assert.equal(panel.isConnected, false);
      assert.equal(runtime.diagnostics.remoteSummary.contextPresent, false);
      assert.equal(f.timers.size, 0);
      releaseLate({ status: 200, responseText: JSON.stringify(gatewayStatus) });
      f.hide(true); f.hide(false);
      f.view.dispatchEvent(new f.view.Event('pageshow'));
      await settle();
      assert.equal(requests, 3);
      assert.equal(f.view.document.getElementById('jh-strategy29-summary-panel'), null);
      assert.equal(f.timers.size, 0);
    } finally {
      runtime.dispose();
      f.dom.window.close();
    }
  });
}

for (const legacyFirst of [true, false]) {
  test(`legacy embedded observer refuses coexistence (legacy first=${legacyFirst})`, () => {
    const f = fixture();
    const legacy = {};
    Object.defineProperty(legacy, 'bollingerAlertState', { get() { throw new Error('Do not inspect legacy runtime data'); } });
    if (legacyFirst) f.view.__TM_CLOSE_LONG_DEBUG__ = legacy;
    const runtime = installStrategy29(f.view);
    if (!legacyFirst) { f.view.__TM_CLOSE_LONG_DEBUG__ = legacy; f.tick(); }
    assert.match(runtime.diagnostics.runtimeFailure, /update Orderbook to 2.7.199/);
    assert.equal(runtime.diagnostics.failed, null);
    assert.equal(f.timers.size, 0);
    assert.match(f.view.document.querySelector('[role=status]').textContent, /reload/);
    assert.equal(f.view.__TM_CLOSE_LONG_DEBUG__, legacy);
    runtime.dispose(); f.dom.window.close();
  });
}

test('invalid shared gateway state remains isolated from the local observer at startup', () => {
  const f = fixture();
  try {
    const runtime = installStrategy29(f.view, {
      request: async () => { throw new Error('must not request'); },
      getValue: (_key, fallback) => fallback,
      setValue() {},
      getGatewayState() { throw new TypeError('Shared signal gateway state is invalid'); },
    });
    assert.equal(runtime.diagnostics.runtimeFailure, null);
    assert.equal(runtime.diagnostics.remoteSummary.state, 'stopped');
    assert.equal(runtime.diagnostics.remoteSummary.lastError, 'Shared signal gateway state is invalid');
    assert.match(f.view.document.getElementById('jh-strategy29-summary-error').textContent, /Shared signal gateway state is invalid/);
    assert.equal(f.timers.size, 1);
    f.tick();
    assert.equal(f.timers.size, 1);
    runtime.dispose();
  } finally { f.dom.window.close(); }
});

test('a failed provider retires an active remote request and does not retry while local sampling continues', async () => {
  const f = fixture();
  let invalid = false;
  let stateReads = 0;
  let requestSignal;
  const runtime = installStrategy29(f.view, {
    request: ({ signal }) => new Promise((_resolve, reject) => {
      requestSignal = signal;
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
    getValue: (_key, fallback) => fallback,
    setValue() {},
    getGatewayState() {
      stateReads += 1;
      if (invalid) throw new TypeError('Shared signal gateway state is invalid');
      return { available: true, configured: true, settingsRevision: 0 };
    },
  });
  assert.equal(f.view.document.querySelectorAll('#jh-strategy29-summary-panel').length, 1);
  invalid = true;
  f.tick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requestSignal.aborted, true);
  assert.equal(f.view.document.querySelectorAll('#jh-strategy29-summary-panel').length, 0);
  assert.equal(runtime.diagnostics.remoteSummary.state, 'stopped');
  const readsAtFailure = stateReads;
  f.tick();
  assert.equal(stateReads, readsAtFailure);
  assert.equal(f.timers.size, 1);
  runtime.dispose();
  assert.equal(f.view.document.querySelectorAll('#jh-strategy29-summary-error').length, 0);
  f.dom.window.close();
});
