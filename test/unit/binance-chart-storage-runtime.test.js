import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { startChartStorageOptimizer } from '../../src/binance-orderbook-trade/chart-storage/runtime.js';
import { createNativeMirrorFactory } from '../fixtures/binance-chart-storage/mirror-scoped-callback.js';

const PAGE = 'https://www.binance.com/zh-CN/futures/BTCUSDT';
const QUEUE = 'webpackChunkfutures_trade_ui';
const EMPTY_WRITER = {
  acceptedBatches: 0, rejectedBatches: 0, failedBatches: 0,
  pendingBatches: 0, pendingBytes: 0, peakPendingBatches: 0, peakPendingBytes: 0,
  transactions: 0, committedTransactions: 0, abortedTransactions: 0,
  committedWrites: 0, skippedWrites: 0, nativePassthroughBatches: 0,
};

/** Only browser globals are substituted; startup must never open native storage. */
function installPage(t, { url = PAGE, framed = false, queue } = {}) {
  const events = new EventTarget();
  const sessions = [];
  const keys = ['location', 'self', 'top', 'addEventListener', 'removeEventListener', 'indexedDB', 'localStorage', QUEUE];
  const saved = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let storageAccesses = 0;
  const values = {
    location: new URL(url), self: globalThis, top: framed ? {} : globalThis,
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
  };
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { value, configurable: true });
  for (const key of ['indexedDB', 'localStorage']) Object.defineProperty(globalThis, key, {
    get() { storageAccesses += 1; throw new Error('Startup must not access native storage'); }, configurable: true,
  });
  if (queue !== undefined) Object.defineProperty(globalThis, QUEUE, { value: queue, configurable: true, writable: true });
  else delete globalThis[QUEUE];
  t.after(async () => {
    try {
      await Promise.all(sessions.map(session => session.stop()));
      assert.equal(storageAccesses, 0);
      assert.equal(getEventListeners(events, 'pagehide').length, 0);
    } finally {
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    }
  });
  return {
    events,
    start() {
      const session = startChartStorageOptimizer();
      sessions.push(session);
      return session;
    },
  };
}

for (const [url, framed] of [
  ['https://www.binance.com/', false],
  ['https://www.binance.com/zh-CN/futures', false],
  ['https://www.binance.com/zh-CN/futures/home', false],
  ['https://www.binance.com/zh-CN/futures/BTCUSD', false],
  ['https://www.binance.com/zh-CN/futures/BTCUSDT/details', false],
  ['https://www.binance.com/zh-CN/futures/%ZZ', false],
  ['https://www.binance.com/zh-CN/my/wallet/futures', false],
  ['https://outside-storage.test/zh-CN/futures/BTCUSDT', false],
  ['http://www.binance.com/zh-CN/futures/BTCUSDT', false],
  [PAGE, true],
]) {
  test(`user cannot initialize chart storage on ${url} framed=${framed}`, t => {
    // Given the page differs from the supported top-level perpetual trading routes.
    const page = installPage(t, { url, framed });

    // When the actual optimizer entrypoint checks its page scope.
    const start = () => page.start();

    // Then rejection leaves the page queue and lifecycle listeners untouched.
    assert.throws(start, { message: 'Chart storage requires a top-level Binance trading page' });
    assert.equal(Object.hasOwn(globalThis, QUEUE), false);
    assert.equal(getEventListeners(page.events, 'pagehide').length, 0);
  });
}

for (const url of [
  PAGE,
  'https://www.binance.com/en/futures/ETHUSDC',
  'https://www.binance.com/futures/BTCUSDT/',
  'https://www.binance.com/zh-CN/futures/币安人生USDT',
  'https://www.binance.com/zh-TW/futures/1000PEPEUSDT?type=perpetual#chart',
]) {
  test(`user can start and cleanly stop chart storage on ${url}`, async t => {
    // Given a supported trading route has no page runtime or database initialization.
    const page = installPage(t, { url });

    // When the real runtime starts observation and then finishes an explicit stop.
    const session = page.start();
    const waiting = session.snapshot();
    const listening = getEventListeners(page.events, 'pagehide').length;
    const stopped = await session.stop();

    // Then only fixed startup counters exist and all queue and listener ownership is released.
    assert.deepEqual(waiting, { status: 'waiting', reason: null, attempts: 0, matches: 0, executions: 0, phase: 'active', writer: EMPTY_WRITER });
    assert.equal(listening, 1);
    assert.deepEqual(stopped, { status: 'native', reason: 'manual', attempts: 0, matches: 0, executions: 0, phase: 'stopped', writer: EMPTY_WRITER });
    assert.equal(Object.hasOwn(globalThis, QUEUE), false);
    assert.equal(getEventListeners(page.events, 'pagehide').length, 0);
  });
}

for (const kind of ['populated', 'runtime-owned']) {
  test(`user preserves the native ${kind} queue when chart storage starts too late`, async t => {
    // Given the host already populated its chunk queue or installed its own dispatcher.
    const original = function nativeHost(module) { module.exports = 'native-late-start'; };
    const chunk = [['existing-host'], { 70940: original }];
    const queue = kind === 'populated' ? [chunk] : [];
    if (kind === 'runtime-owned') queue.push = function runtimePush(value) { return Array.prototype.push.call(this, value); };
    const push = queue.push;
    const before = Object.getOwnPropertyDescriptors(queue);
    const page = installPage(t, { queue });

    // When the optimizer encounters an already-owned registration boundary.
    const session = page.start();
    const stopped = await session.stop();
    const module = { exports: {} };
    original(module);

    // Then native host execution and every existing queue descriptor remain unchanged.
    assert.equal(globalThis[QUEUE], queue);
    assert.equal(queue.push, push);
    assert.deepEqual(Object.getOwnPropertyDescriptors(queue), before);
    assert.equal(module.exports, 'native-late-start');
    assert.deepEqual(stopped, { status: 'native', reason: 'bootstrap_unavailable', attempts: 0, matches: 0, executions: 0, phase: 'stopped', writer: EMPTY_WRITER });
  });
}

test('user keeps the original factory executable when strict source registration mismatches', async t => {
  // Given an early runtime observes a host factory that differs from the pinned module.
  const page = installPage(t);
  const session = page.start();
  const original = function changedHost(module) { module.exports = { chart: 'native-value' }; };
  const chunk = [['source-drift'], { 70940: original }];

  // When the unchanged host factory registers and executes after the optimizer retires.
  globalThis[QUEUE].push(chunk);
  const stopped = await session.stop();
  const module = { exports: {} };
  globalThis[QUEUE][0][1][70940](module);

  // Then registration and its data stay native while diagnostics expose only fixed mismatch counts.
  assert.equal(globalThis[QUEUE][0], chunk);
  assert.equal(globalThis[QUEUE][0][1][70940], original);
  assert.equal(Object.hasOwn(globalThis[QUEUE], 'push'), false);
  assert.deepEqual(module.exports, { chart: 'native-value' });
  assert.deepEqual(stopped, { status: 'native', reason: 'source_mismatch', attempts: 1, matches: 0, executions: 0, phase: 'stopped', writer: EMPTY_WRITER });
});

test('user restores the exact pinned factory when stopping before its first execution', async t => {
  // Given the real runtime owns an empty queue and receives the complete pinned factory.
  const page = installPage(t);
  const session = page.start();
  const original = createNativeMirrorFactory();

  // When strict registration accepts the factory and repeated stop requests share one completion.
  globalThis[QUEUE].push([['pinned-registration'], { 70940: original }]);
  const registered = globalThis[QUEUE][0][1][70940];
  const accepted = session.snapshot();
  const stopping = session.stop();
  const repeated = session.stop();
  const stopped = await stopping;

  // Then registration was transformed exactly once and cleanup restores the original unexecuted factory.
  assert.notEqual(registered, original);
  assert.equal(stopping, repeated);
  assert.deepEqual(accepted, { status: 'waiting', reason: null, attempts: 1, matches: 1, executions: 0, phase: 'active', writer: EMPTY_WRITER });
  assert.equal(globalThis[QUEUE][0][1][70940], original);
  assert.equal(Object.hasOwn(globalThis[QUEUE], 'push'), false);
  assert.deepEqual(stopped, { status: 'native', reason: 'manual', attempts: 1, matches: 1, executions: 0, phase: 'stopped', writer: EMPTY_WRITER });
});

test('user retires the capture hook exactly at thirty seconds without leaving a page listener', async t => {
  // Given the production capture deadline runs on Node's controlled timer boundary.
  const page = installPage(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const session = page.start();

  // When the final waiting millisecond passes and the deadline cleanup finishes.
  t.mock.timers.tick(29_999);
  const before = session.snapshot();
  const ownedBefore = Object.hasOwn(globalThis, QUEUE);
  t.mock.timers.tick(1);
  const stopped = await session.stop();
  t.mock.timers.tick(60_000);

  // Then capture remains available before the deadline and permanently restores native behavior at it.
  assert.equal(before.status, 'waiting');
  assert.equal(before.phase, 'active');
  assert.equal(ownedBefore, true);
  assert.deepEqual(stopped, { status: 'native', reason: 'capture_deadline', attempts: 0, matches: 0, executions: 0, phase: 'stopped', writer: EMPTY_WRITER });
  assert.deepEqual(session.snapshot(), stopped);
  assert.equal(Object.hasOwn(globalThis, QUEUE), false);
  assert.equal(getEventListeners(page.events, 'pagehide').length, 0);
});

test('user releases registration and cancels the capture deadline on pagehide', async t => {
  // Given a pinned but unexecuted factory waits behind the page lifecycle listener.
  const page = installPage(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const session = page.start();
  const original = createNativeMirrorFactory();
  globalThis[QUEUE].push([['leaving-page'], { 70940: original }]);

  // When the real page lifecycle event fires before the capture deadline.
  page.events.dispatchEvent(new Event('pagehide'));
  const stopped = await session.stop();
  t.mock.timers.tick(30_000);

  // Then the original factory and native push are restored and the deadline cannot replace the stop reason.
  assert.equal(globalThis[QUEUE][0][1][70940], original);
  assert.equal(Object.hasOwn(globalThis[QUEUE], 'push'), false);
  assert.equal(getEventListeners(page.events, 'pagehide').length, 0);
  assert.deepEqual(stopped, { status: 'native', reason: 'pagehide', attempts: 1, matches: 1, executions: 0, phase: 'stopped', writer: EMPTY_WRITER });
  assert.deepEqual(session.snapshot(), stopped);
});

test('user preserves the exact native dependency exception during pinned factory execution', async t => {
  // Given the original pinned factory and transformed factory share the same rejecting dependency boundary.
  const page = installPage(t);
  const session = page.start();
  const original = createNativeMirrorFactory();
  globalThis[QUEUE].push([['pinned-execution'], { 70940: original }]);
  const wrapped = globalThis[QUEUE][0][1][70940];
  const failure = new Error('Native dependency unavailable');
  const requested = [];
  const require = id => { requested.push(id); throw failure; };
  require.m = { 70940: wrapped };
  require.r = exports => { Object.defineProperty(exports, '__esModule', { value: true }); };
  require.d = (exports, getters) => {
    for (const [key, get] of Object.entries(getters)) Object.defineProperty(exports, key, { get });
  };
  const nativeModule = { exports: {} };
  assert.throws(() => original(nativeModule, nativeModule.exports, require), error => error === failure);

  // When the transformed full factory reaches the original first require and its capture rejection settles.
  const module = { exports: {} };
  assert.throws(() => wrapped(module, module.exports, require), error => error === failure);
  await Promise.resolve();
  const stopped = await session.stop();

  // Then host error identity and dependency ID survive while registration restores without exposing the error text.
  assert.deepEqual(requested, [49253, 49253]);
  assert.equal(require.m[70940], original);
  assert.equal(globalThis[QUEUE][0][1][70940], original);
  assert.deepEqual(stopped, { status: 'native', reason: 'capture_failed', attempts: 1, matches: 1, executions: 1, phase: 'stopped', writer: EMPTY_WRITER });
});

test('user retires a queued capture when navigation leaves the trading scope before registration', async t => {
  // Given startup began on a valid route before the host registered its pinned module.
  const page = installPage(t);
  const session = page.start();
  const original = createNativeMirrorFactory();
  const chunk = [['after-navigation'], { 70940: original }];

  // When SPA navigation changes the route before the factory reaches the queue.
  location.pathname = '/zh-CN/futures/home';
  globalThis[QUEUE].push(chunk);
  const stopped = await session.stop();

  // Then the new page keeps the original registration and no strict match or execution is attempted.
  assert.equal(globalThis[QUEUE][0], chunk);
  assert.equal(globalThis[QUEUE][0][1][70940], original);
  assert.equal(Object.hasOwn(globalThis[QUEUE], 'push'), false);
  assert.deepEqual(stopped, { status: 'native', reason: 'scope_changed', attempts: 0, matches: 0, executions: 0, phase: 'stopped', writer: EMPTY_WRITER });
});

test('user receives detached fixed-count snapshots through only two frozen runtime controls', async t => {
  // Given the actual runtime has accepted one pinned registration without reading chart data.
  const page = installPage(t);
  const session = page.start();
  globalThis[QUEUE].push([['snapshot-schema'], { 70940: createNativeMirrorFactory() }]);

  // When a consumer changes its returned snapshot and nested counters.
  const snapshot = session.snapshot();
  snapshot.matches = 99;
  snapshot.writer.acceptedBatches = 99;
  const fresh = session.snapshot();
  await session.stop();

  // Then only snapshot and stop are exposed and diagnostics retain the fixed data-free schema and actual counts.
  assert.equal(Object.isFrozen(session), true);
  assert.deepEqual(Object.keys(session).sort(), ['snapshot', 'stop']);
  assert.deepEqual(fresh, { status: 'waiting', reason: null, attempts: 1, matches: 1, executions: 0, phase: 'active', writer: EMPTY_WRITER });
});
