import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { installStrategy29 } from '../../../src/binance-strategy29-bollinger/runtime.js';
import { installStrategyClock, observeStrategyCondition } from '../../helpers/strategy-migration-boundaries.js';

const gatewayStatus = JSON.parse(await readFile(new URL('../../fixtures/strategy29-gateway-status.json', import.meta.url)));
const gatewayEvents = JSON.parse(await readFile(new URL('../../fixtures/strategy29-gateway-events.json', import.meta.url)));

function fixture(t) {
  const dom = new JSDOM('<body></body>', { url: 'https://www.binance.com/en/futures/BTRUSDT' });
  const view = dom.window;
  let hidden = false;
  const clock = installStrategyClock(t, view);
  Object.defineProperty(view.document, 'hidden', { get: () => hidden });
  view.console.warn = () => {};
  return { dom, view, timers: clock.intervals,
    tick() { clock.advance(1000); },
    advance: clock.advance,
    setHidden(value) { hidden = value; },
    hide(value) { hidden = value; view.document.dispatchEvent(new view.Event('visibilitychange')); } };
}

function installFailingIntervalChart(view) {
  const root = view.document.createElement('div');
  root.className = 'chart-widget-root';
  root.innerHTML = '<iframe></iframe>';
  root.getClientRects = () => [{ width: 800, height: 600 }];
  root.getBoundingClientRect = () => ({ width: 800, height: 600 });
  view.document.body.append(root);
  const chart = {
    symbol: () => 'BTRUSDT@PRICETYPE=LAST', resolution: () => '1',
    hasModel: () => true, dataReady: () => true,
    onIntervalChanged() { throw new Error('synthetic interval subscription failure'); },
    onDataLoaded() {}, exportData() {},
  };
  root.querySelector('iframe').contentWindow.tradingViewApi = { activeChart: () => chart };
}

test('user observes that standalone injection is single-instance and pauses/resumes/disposes its only timer', (t) => {
  // Given the standalone Strategy 29 page and runtime dependencies
  const f = fixture(t);
  // When installStrategy29 processes the configured inputs
  const runtime = installStrategy29(f.view);
  const observedResult = installStrategy29(f.view);
  // Then user observes that standalone injection is single-instance and pauses/resumes/disposes its only timer
  assert.equal(observedResult, runtime);
  assert.equal(f.view[Symbol.for('jh-userscripts.strategy29-bollinger')] === runtime, true);
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

test('user observes that remote transport failure never stops the local observer timer', async (t) => {
  // Given the standalone Strategy 29 page and runtime dependencies
  const f = fixture(t);
  const values = new Map();
  // When installStrategy29 processes the configured inputs
  const runtime = installStrategy29(f.view, {
    request: async () => { throw new Error('synthetic remote failure'); },
    getValue: (key, fallback) => values.has(key) ? values.get(key) : fallback,
    setValue: (key, value) => values.set(key, value),
    registerMenuCommand() {},
    getGatewayState() { return { available: true, configured: true, settingsRevision: 0 }; },
  });
  await observeStrategyCondition(() => runtime.diagnostics.remoteSummary.state === 'stopped', 'remote transport failure');
  // Then user observes that remote transport failure never stops the local observer timer
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
  test(`user observes that ${name} remains a remote-only state while the local timer continues`, async (t) => {
    // Given the standalone Strategy 29 page and runtime dependencies
    const f = fixture(t);
    const values = new Map();
    // When installStrategy29 processes the configured inputs
    const runtime = installStrategy29(f.view, {
      request: async () => remoteResponse,
      getValue: (key, fallback) => values.has(key) ? values.get(key) : fallback,
      setValue: (key, value) => values.set(key, value),
      registerMenuCommand() {},
      getGatewayState() { return { available: true, configured: true, settingsRevision: 0 }; },
    });
    await observeStrategyCondition(() => runtime.diagnostics.remoteSummary.state === expectedState, `remote ${name} response`);
    // Then user observes that the selected case remains a remote-only state while the local timer continues
    assert.equal(runtime.diagnostics.runtimeFailure, null);
    assert.equal(runtime.diagnostics.remoteSummary.state, expectedState);
    assert.equal(f.timers.size, 1);
    runtime.dispose();
    f.dom.window.close();
  });
}

test('user observes that hiding the page aborts the remote request and resumes with one shared runtime timer', async (t) => {
  // Given the standalone Strategy 29 page and runtime dependencies
  const f = fixture(t);
  const values = new Map();
  let aborts = 0;
  // When installStrategy29 processes the configured inputs
  const runtime = installStrategy29(f.view, {
    request: ({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => { aborts += 1; reject(signal.reason); }, { once: true });
    }),
    getValue: (key, fallback) => values.has(key) ? values.get(key) : fallback,
    setValue: (key, value) => values.set(key, value),
    registerMenuCommand() {},
    getGatewayState() { return { available: true, configured: true, settingsRevision: 0 }; },
  });
  // Then user observes that hiding the page aborts the remote request and resumes with one shared runtime timer
  assert.equal(runtime.diagnostics.remoteSummary.inFlight, true);
  f.hide(true);
  await observeStrategyCondition(() => aborts === 1 && !runtime.diagnostics.remoteSummary.inFlight, 'hidden-page request abort');
  assert.equal(aborts, 1);
  assert.equal(f.timers.size, 0);
  assert.equal(runtime.diagnostics.remoteSummary.contextPresent, true);
  f.hide(false);
  assert.equal(f.timers.size, 1);
  assert.equal(runtime.diagnostics.remoteSummary.inFlight, true);
  runtime.dispose();
  f.dom.window.close();
});

test('user observes that actual remote client retains rows and cursor across visibility and bootstraps a new route', async (t) => {
  // Given the standalone Strategy 29 page and runtime dependencies
  const f = fixture(t);
  const values = new Map();
  const urls = [];
  const first = { ...gatewayEvents.events[0], symbol: 'BTR/USDT:USDT', sequence: 900 };
  const second = { ...gatewayEvents.events[1], symbol: 'BTR/USDT:USDT', sequence: 901 };
  // When installStrategy29 processes the configured inputs
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
  await observeStrategyCondition(() => runtime.diagnostics.remoteSummary.cursor === 900 && !runtime.diagnostics.remoteSummary.inFlight, 'initial remote event render');
  const panel = f.view.document.getElementById('jh-strategy29-summary-panel');
  // Then user observes that actual remote client retains rows and cursor across visibility and bootstraps a new route
  assert.equal(urls[0].searchParams.get('mode'), 'latest_per_timeframe');
  assert.equal(urls[0].searchParams.get('limit'), '3');
  assert.equal(panel.querySelectorAll('[data-role=remote-event]').length, 1);
  f.hide(true);
  assert.equal(runtime.diagnostics.remoteSummary.cursor, 900);
  f.hide(false);
  await observeStrategyCondition(() => runtime.diagnostics.remoteSummary.cursor === 901 && !runtime.diagnostics.remoteSummary.inFlight, 'resumed remote event render');
  assert.equal(f.view.document.getElementById('jh-strategy29-summary-panel'), panel);
  assert.equal(urls[1].searchParams.get('cursor'), '900');
  assert.equal(runtime.diagnostics.remoteSummary.cursor, 901);
  assert.deepEqual([...panel.querySelectorAll('[data-role=remote-event]')].map(row => row.dataset.eventId), [second.event_id, first.event_id]);
  f.view.history.pushState({}, '', '/en/futures/ETHUSDT');
  await observeStrategyCondition(() => runtime.diagnostics.remoteSummary.canonicalSymbol === 'ETH/USDT:USDT' && !runtime.diagnostics.remoteSummary.inFlight, 'replacement route bootstrap');
  assert.equal(urls[2].searchParams.get('mode'), 'latest_per_timeframe');
  assert.equal(urls[2].searchParams.get('limit'), '3');
  assert.equal(urls[2].searchParams.has('cursor'), false);
  assert.equal(panel.isConnected, false);
  assert.equal(f.view.document.querySelectorAll('[data-role=remote-event]').length, 0);
  runtime.dispose();
  f.dom.window.close();
});

test('user observes that a permanent interval subscription failure retires the populated remote panel and request', async (t) => {
  // Given the standalone Strategy 29 page and runtime dependencies
  const f = fixture(t);
  const values = new Map();
  let requests = 0, aborts = 0;
  let releaseLate;
  let lateDelivered = false;
  // When the actual runtime consumes a status and event snapshot
  const runtime = installStrategy29(f.view, {
    request: ({ path: url, signal }) => {
      requests += 1;
      if (requests > 2) return new Promise(resolve => {
        releaseLate = resolve;
        signal.addEventListener('abort', () => { aborts += 1; }, { once: true });
      }).then(response => {
        lateDelivered = true;
        return response;
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
    getGatewayState() { return { available: true, configured: true, settingsRevision: 0 }; },
  });
  try {
    await observeStrategyCondition(() => runtime.diagnostics.remoteSummary.state === 'connected' && !runtime.diagnostics.remoteSummary.inFlight, 'populated remote panel');
    const panel = f.view.document.getElementById('jh-strategy29-summary-panel');
    // Then the running remote context has retained signal rows before the local failure
    assert.equal(panel.querySelectorAll('[data-role=remote-event]').length, 1);
    assert.equal(runtime.diagnostics.remoteSummary.state, 'connected');
    f.hide(true); f.hide(false);
    assert.equal(requests, 3);

    // When a native chart appears whose interval subscription fails
    installFailingIntervalChart(f.view);
    f.tick();
    await observeStrategyCondition(() => runtime.diagnostics.runtimeFailure !== null && !runtime.diagnostics.remoteSummary.contextPresent, 'permanent runtime failure');

    // Then local failure retires the remote request and panel before any late response can publish
    assert.match(runtime.diagnostics.runtimeFailure, /synthetic interval subscription failure/);
    assert.equal(aborts, 1);
    assert.equal(panel.isConnected, false);
    assert.equal(runtime.diagnostics.remoteSummary.contextPresent, false);
    assert.equal(f.timers.size, 0);

    // When the retired response arrives and stale browser lifecycle events try to resume work
    releaseLate({ status: 200, responseText: JSON.stringify(gatewayStatus) });
    f.hide(true); f.hide(false);
    f.view.dispatchEvent(new f.view.Event('pageshow'));
    await observeStrategyCondition(() => lateDelivered, 'retired host response delivered');

    // Then no request, panel or observation timer is recreated
    assert.equal(requests, 3);
    assert.equal(f.view.document.getElementById('jh-strategy29-summary-panel'), null);
    assert.equal(f.timers.size, 0);
  } finally {
    runtime.dispose();
    f.dom.window.close();
  }
});

test('user observes that invalid shared gateway state remains isolated from the local observer at startup', (t) => {
  // Given the standalone Strategy 29 page and runtime dependencies
  const f = fixture(t);
  try {
    // When installStrategy29 processes the configured inputs
    const runtime = installStrategy29(f.view, {
      request: async () => { throw new Error('must not request'); },
      getValue: (_key, fallback) => fallback,
      setValue() {},
      getGatewayState() { throw new TypeError('Shared signal gateway state is invalid'); },
    });
    // Then user observes that invalid shared gateway state remains isolated from the local observer at startup
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

test('user observes that a failed provider retires an active remote request and does not retry while local sampling continues', async (t) => {
  // Given the standalone Strategy 29 page and runtime dependencies
  const f = fixture(t);
  let invalid = false;
  let stateReads = 0;
  let requestSignal;
  // When installStrategy29 processes the configured inputs
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
  // Then user observes that a failed provider retires an active remote request and does not retry while local sampling continues
  assert.equal(f.view.document.querySelectorAll('#jh-strategy29-summary-panel').length, 1);
  invalid = true;
  f.tick();
  await observeStrategyCondition(() => requestSignal.aborted && runtime.diagnostics.remoteSummary.state === 'stopped' && !runtime.diagnostics.remoteSummary.inFlight, 'failed provider request retirement');
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

test('user pauses for the browser back-forward cache and resumes exactly one native timer', (t) => {
  // Given an active runtime owns one real browser interval under the test clock
  const f = fixture(t);
  const runtime = installStrategy29(f.view);
  t.after(() => { runtime.dispose(); f.dom.window.close(); });
  const originalTimer = [...f.timers.keys()][0];

  // When the browser stores the page in its back-forward cache
  f.view.dispatchEvent(new f.view.PageTransitionEvent('pagehide', { persisted: true }));
  f.advance(5000);

  // Then sampling is paused without permanently disposing the runtime
  assert.equal(runtime.diagnostics.disposed, false);
  assert.equal(runtime.diagnostics.timerRunning, false);
  assert.equal(f.timers.size, 0);

  // When the browser restores the cached page and repeats its pageshow notification
  f.view.dispatchEvent(new f.view.PageTransitionEvent('pageshow', { persisted: true }));
  f.view.dispatchEvent(new f.view.PageTransitionEvent('pageshow', { persisted: true }));

  // Then exactly one fresh interval resumes with the declared one-second cadence
  assert.equal(runtime.diagnostics.disposed, false);
  assert.equal(runtime.diagnostics.timerRunning, true);
  assert.equal(f.timers.size, 1);
  assert.notEqual([...f.timers.keys()][0], originalTimer);
  assert.deepEqual([...f.timers.values()], [{ milliseconds: 1000 }]);
});

test('user permanently disposes observation when pagehide is not persisted', (t) => {
  // Given the active page contains a runtime timer and its upgrade notice
  const f = fixture(t);
  const runtime = installStrategy29(f.view);
  t.after(() => { runtime.dispose(); f.dom.window.close(); });
  assert.equal(f.view.document.querySelectorAll('#jh-strategy29-client-upgrade').length, 1);

  // When the browser leaves permanently and later dispatches stale lifecycle events
  f.view.dispatchEvent(new f.view.PageTransitionEvent('pagehide', { persisted: false }));
  f.view.dispatchEvent(new f.view.PageTransitionEvent('pageshow', { persisted: false }));
  f.hide(true);
  f.hide(false);
  f.view.history.pushState({}, '', '/en/futures/ETHUSDT');
  f.advance(3000);

  // Then neither the timer nor the removed presentation can be resurrected
  assert.equal(runtime.diagnostics.disposed, true);
  assert.equal(runtime.diagnostics.timerRunning, false);
  assert.equal(f.timers.size, 0);
  assert.equal(f.view.document.querySelectorAll('#jh-strategy29-client-upgrade').length, 0);
  assert.equal(f.view.document.querySelectorAll('#jh-strategy29-bollinger-status').length, 0);
});

test('user defers hidden-page route sampling until visibility returns', (t) => {
  // Given injection begins while the native document is hidden
  const f = fixture(t);
  f.setHidden(true);
  const runtime = installStrategy29(f.view);
  t.after(() => { runtime.dispose(); f.dom.window.close(); });

  // When a hidden route transition and pageshow occur before visibility returns
  f.view.history.pushState({}, '', '/zh-CN/futures/ETHUSDT');
  f.view.dispatchEvent(new f.view.PageTransitionEvent('pageshow', { persisted: true }));
  f.advance(3000);

  // Then hidden work neither installs a timer nor mounts route-specific presentation
  assert.equal(f.timers.size, 0);
  assert.equal(runtime.diagnostics.timerRunning, false);
  assert.equal(f.view.document.querySelectorAll('#jh-strategy29-client-upgrade').length, 0);

  // When the actual visibility-change event reports the page visible
  f.hide(false);

  // Then the current route is sampled and one shared timer starts
  assert.equal(f.timers.size, 1);
  assert.equal(runtime.diagnostics.timerRunning, true);
  assert.equal(f.view.document.querySelectorAll('#jh-strategy29-client-upgrade').length, 1);
});

test('user sees a stopped-runtime notice restored after the host replaces its DOM', async (t) => {
  // Given a native interval subscription failure has permanently stopped the runtime
  const f = fixture(t);
  installFailingIntervalChart(f.view);
  const runtime = installStrategy29(f.view);
  t.after(() => { runtime.dispose(); f.dom.window.close(); });
  await observeStrategyCondition(() => runtime.diagnostics.runtimeFailure !== null, 'native interval subscription failure');
  const notice = f.view.document.getElementById('jh-strategy29-bollinger-status');
  const originalText = notice.textContent;
  const originalFailure = runtime.diagnostics.runtimeFailure;
  notice.remove();

  // When the host's next route transition samples the still-stopped runtime
  f.view.history.pushState({}, '', '/zh-CN/futures/BTRUSDT');
  const restored = f.view.document.getElementById('jh-strategy29-bollinger-status');

  // Then the failure remains visible in the route language without restarting observation
  assert.notEqual(restored, notice);
  assert.equal(restored.getAttribute('role'), 'status');
  assert.notEqual(restored.textContent, originalText);
  assert.match(restored.textContent, /Strategy 29 已停止/);
  assert.match(restored.textContent, /synthetic interval subscription failure/);
  assert.equal(runtime.diagnostics.runtimeFailure, originalFailure);
  assert.equal(f.view.document.querySelectorAll('#jh-strategy29-bollinger-status').length, 1);
  assert.equal(f.timers.size, 0);
});

test('user sees a retained runtime failure when a replacement document body becomes available', async (t) => {
  // Given the host removes its body before an interval subscription failure is reported
  const f = fixture(t);
  installFailingIntervalChart(f.view);
  const runtime = installStrategy29(f.view);
  f.view.document.body.remove();
  t.after(() => { runtime.dispose(); f.dom.window.close(); });
  await observeStrategyCondition(() => runtime.diagnostics.runtimeFailure !== null, 'failure while the body is unavailable');
  assert.equal(f.view.document.getElementById('jh-strategy29-bollinger-status'), null);

  // When the host exposes its replacement body and changes the route locale
  f.view.document.documentElement.append(f.view.document.createElement('body'));
  f.view.history.pushState({}, '', '/zh-CN/futures/BTRUSDT');

  // Then the retained failure is presented once and sampling remains stopped
  const notice = f.view.document.getElementById('jh-strategy29-bollinger-status');
  assert.match(notice.textContent, /synthetic interval subscription failure/);
  assert.equal(notice.getAttribute('role'), 'status');
  assert.equal(f.view.document.querySelectorAll('#jh-strategy29-bollinger-status').length, 1);
  assert.equal(f.timers.size, 0);
});
