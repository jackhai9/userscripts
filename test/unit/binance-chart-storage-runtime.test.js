import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import { observeChartStorageBootstrap } from '../../src/binance-orderbook-trade/chart-storage/bootstrap.js';
import { startChartStorageOptimizer } from '../../src/binance-orderbook-trade/chart-storage/runtime.js';
import { createNativeMirrorFactory } from '../fixtures/binance-chart-storage/mirror-scoped-callback.js';
import { createNativeDrawingSaveFactory } from '../fixtures/binance-chart-storage/drawing-save-scoped.js';
import { createNativeOrderNotificationFactory } from '../fixtures/binance-order-notifications/original-factories.js';
import { createOrderNotificationScope } from '../../src/binance-orderbook-trade/order-notifications/runtime.js';

const PAGE = 'https://www.binance.com/zh-CN/futures/BTCUSDT';
const QUEUE = 'webpackChunkfutures_trade_ui';
const HOST_RUNTIME = readFileSync(new URL('../fixtures/binance-chart-storage/webpack-runtime.js', import.meta.url), 'utf8');
const HOST_PERSISTENCE = readFileSync(new URL('../fixtures/binance-chart-storage/host-persistence.js', import.meta.url), 'utf8');
const WAITING_DRAWING = { status: 'waiting', reason: null, attempts: 0, matches: 0, executions: 0 };
const EMPTY_WRITER = {
  acceptedBatches: 0, rejectedBatches: 0, failedBatches: 0,
  pendingBatches: 0, pendingBytes: 0, peakPendingBatches: 0, peakPendingBytes: 0,
  transactions: 0, committedTransactions: 0, abortedTransactions: 0,
  committedWrites: 0, skippedWrites: 0, nativePassthroughBatches: 0,
};

/**
 * Only evaluate the pinned factories: component bodies and lazy chunks stay idle.
 * Captured persistence helpers run unchanged. Explicit inert imports cover the UI
 * dependencies whose exports the factories do not call until a component renders.
 */
function registerPinnedChartFactories({ mismatchId } = {}) {
  const originals = { 70940: createNativeMirrorFactory(), 76535: createNativeDrawingSaveFactory() };
  if (mismatchId) originals[mismatchId] = module => { module.exports = { nativeDrift: mismatchId }; };
  const inactiveIds = [31085, 43917, 19020, 13067, 78441, 53837, 4260, 80817, 92873, 6868,
    81936, 76469, 27571, 87646, 26531, 17409, 94652, 76830, 48651, 79344, 51029, 36307,
    25379, 44745, 15727, 45358, 82071, 85411, 94889, 94547, 80686, 61875, 35630, 12055,
    79515, 80737, 40545, 98107, 51846, 74069, 90664, 36077, 42902, 90170, 63345, 48210,
    51289, 24326, 90922, 34235, 63762, 31542, 17855, 58656, 47354, 87017, 99168, 3742,
    43335, 15540, 20163, 47255, 36488, 48018, 82911, 69578, 53208, 19862, 8874, 26679,
    66547, 78142, 16238, 98087, 55009, 56477, 71730, 36620, 75510, 82508, 91025];
  const modules = Object.fromEntries(inactiveIds.map(id => [id, module => { module.exports = Object.freeze({}); }]));
  const lazyLoaders = [];
  modules[41594] = module => {
    module.exports = { lazy(load) { lazyLoaders.push(load); return { load }; } };
  };
  modules[45250] = module => {
    module.exports = { range(start, end) { return Array.from({ length: end - start }, (_, index) => start + index); } };
  };
  modules[17409] = module => { module.exports = { bt: { TRADING: 'TRADING', DELIVERING: 'DELIVERING' } }; };
  runInThisContext(HOST_PERSISTENCE);
  let require;
  globalThis[QUEUE].push([['pinned-runtime-host'], { ...modules, ...originals }, hostRequire => { require = hostRequire; }]);
  runInThisContext(HOST_RUNTIME);
  return { require, originals, lazyLoaders };
}

/** Only browser globals are substituted; startup must never open native storage. */
function installPage(t, { url = PAGE, framed = false, queue } = {}) {
  const events = new EventTarget();
  const sessions = [];
  const observers = [];
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
      events.dispatchEvent(new Event('pagehide'));
      for (const observer of observers) observer.stop();
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
    observe(configuration) {
      const observer = observeChartStorageBootstrap(configuration);
      observers.push(observer);
      return observer;
    },
    start(options) {
      const session = startChartStorageOptimizer(options);
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

    // Then fixed counters show a stopped mirror while drawing capture retains the bounded queue ownership.
    assert.deepEqual(waiting, { status: 'waiting', reason: null, attempts: 0, matches: 0, executions: 0, phase: 'active', writer: EMPTY_WRITER, drawingScope: WAITING_DRAWING });
    assert.equal(listening, 1);
    assert.deepEqual(stopped, { status: 'native', reason: 'manual', attempts: 0, matches: 0, executions: 0, phase: 'stopped', writer: EMPTY_WRITER, drawingScope: WAITING_DRAWING });
    assert.equal(Object.hasOwn(globalThis, QUEUE), true);
    assert.equal(getEventListeners(page.events, 'pagehide').length, 1);
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
    assert.deepEqual(stopped, { status: 'native', reason: 'bootstrap_unavailable', attempts: 0, matches: 0, executions: 0, phase: 'stopped', writer: EMPTY_WRITER, drawingScope: { ...WAITING_DRAWING, status: 'unavailable', reason: 'bootstrap_unavailable' } });
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
  assert.equal(typeof Object.getOwnPropertyDescriptor(globalThis[QUEUE], 'push').get, 'function');
  assert.deepEqual(module.exports, { chart: 'native-value' });
  assert.deepEqual(stopped, { status: 'native', reason: 'source_mismatch', attempts: 1, matches: 0, executions: 0, phase: 'stopped', writer: EMPTY_WRITER, drawingScope: WAITING_DRAWING });
});

/** Render-free factory execution proves the shared real Rspack registration path. */
function registerNotificationFactories({ mismatchId } = {}) {
  const originals = Object.fromEntries([['30877', '37511'], ['39116', '3314'], ['55401', '29042']]
    .map(([id, chunk]) => [id, createNativeOrderNotificationFactory(id, chunk,
      id === '39116' ? '5362a54e61f022714e673e166b62e3c22997084ca7a9f4e676475ec91cfcfaa8' : undefined)]));
  if (mismatchId) originals[mismatchId] = module => { module.exports = { nativeDrift: mismatchId }; };
  const inactiveIds = [61523, 64041, 51471, 40477, 16921, 72363, 70020];
  const inactive = Object.fromEntries(inactiveIds.map(id => [id, module => { module.exports = Object.freeze({}); }]));
  globalThis[QUEUE].push([['notification-registration'], { ...inactive, ...originals }]);
  return originals;
}

for (const stopMirrorFirst of [false, true]) {
  test(`user captures notification modules independently when mirror stopped=${stopMirrorFirst}`, async t => {
    // Given one shared observer owns chart and notification targets before the real host runtime.
    const page = installPage(t);
    const notifications = createOrderNotificationScope();
    const session = page.start({ additionalTargets: notifications.targets });
    if (stopMirrorFirst) await session.stop();
    const host = registerPinnedChartFactories();
    registerNotificationFactories();

    // When native notification factories execute before the remaining chart factories.
    host.require(55401);
    host.require(30877);
    host.require(76535);
    host.require(70940);
    const status = notifications.snapshot();

    // Then both notification paths activate and native queue ownership is restored exactly once.
    assert.equal(status.toastActive, true);
    assert.equal(status.soundActive, true);
    assert.deepEqual(Object.values(status.modules).map(target => target.status), ['active', 'active', 'active']);
    assert.equal(session.snapshot().drawingScope.status, 'active');
    assert.equal(session.snapshot().status, stopMirrorFirst ? 'native' : 'active');
    assert.equal(Object.hasOwn(Object.getOwnPropertyDescriptor(globalThis[QUEUE], 'push'), 'value'), true);
  });
}

for (const mismatchId of ['30877', '39116', '55401']) {
  test(`user keeps storage and native source drift isolated for notification module ${mismatchId}`, t => {
    // Given one notification factory changed upstream while all chart factories still match.
    const page = installPage(t);
    const notifications = createOrderNotificationScope();
    const session = page.start({ additionalTargets: notifications.targets });
    const host = registerPinnedChartFactories();
    const originals = registerNotificationFactories({ mismatchId });

    // When all three notification factories and the chart factories execute.
    for (const id of ['39116', '55401', '30877', '70940']) host.require(id);
    const status = notifications.snapshot();

    // Then only the changed notification target rejects and both storage protections stay active.
    assert.deepEqual(status.modules[mismatchId], { status: 'source_mismatch', reason: 'source_mismatch', attempts: 1, matches: 0 });
    assert.equal(status.toastActive, mismatchId !== '30877');
    assert.equal(status.soundActive, mismatchId === '30877');
    assert.deepEqual(host.require(mismatchId), { nativeDrift: mismatchId });
    assert.equal(host.require.m[mismatchId], originals[mismatchId]);
    assert.equal(session.snapshot().status, 'active');
    assert.equal(session.snapshot().drawingScope.status, 'active');
  });
}

test('user sees independent notification expiry at the original shared capture deadline', async t => {
  // Given the notification targets have not registered and the mirror was stopped early.
  const page = installPage(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const notifications = createOrderNotificationScope();
  const session = page.start({ additionalTargets: notifications.targets });
  t.mock.timers.tick(20_000);
  await session.stop();

  // When the remaining ten seconds expire without resetting the shared deadline.
  t.mock.timers.tick(10_000);
  const status = notifications.snapshot();

  // Then no notification target activates or touches storage and the queue observer retires.
  assert.equal(status.toastActive, false);
  assert.equal(status.soundActive, false);
  for (const target of Object.values(status.modules)) {
    assert.deepEqual(target, { status: 'unavailable', reason: 'capture_deadline', attempts: 0, matches: 0 });
  }
  assert.equal(Object.hasOwn(globalThis, QUEUE), false);
  assert.equal(session.snapshot().reason, 'manual');
});

test('user gets explicit notification unavailability when injection is too late', async t => {
  // Given the host has already registered a chunk before installation.
  const page = installPage(t, { queue: [[['existing'], {}]] });
  const notifications = createOrderNotificationScope();

  // When the normal installer tries to attach the shared capture targets.
  const session = page.start({ additionalTargets: notifications.targets });
  await session.stop();

  // Then all notifications stay native with a clear late-bootstrap outcome.
  for (const target of Object.values(notifications.snapshot().modules)) {
    assert.deepEqual(target, { status: 'unavailable', reason: 'bootstrap_unavailable', attempts: 0, matches: 0 });
  }
  assert.equal(globalThis[QUEUE].length, 1);
  assert.equal(Object.hasOwn(globalThis[QUEUE], 'push'), false);
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
  assert.deepEqual(accepted, { status: 'waiting', reason: null, attempts: 1, matches: 1, executions: 0, phase: 'active', writer: EMPTY_WRITER, drawingScope: WAITING_DRAWING });
  assert.equal(globalThis[QUEUE][0][1][70940], original);
  assert.equal(typeof Object.getOwnPropertyDescriptor(globalThis[QUEUE], 'push').get, 'function');
  assert.deepEqual(stopped, { status: 'native', reason: 'manual', attempts: 1, matches: 1, executions: 0, phase: 'stopped', writer: EMPTY_WRITER, drawingScope: WAITING_DRAWING });
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
  assert.deepEqual(stopped, { status: 'native', reason: 'capture_deadline', attempts: 0, matches: 0, executions: 0, phase: 'stopped', writer: EMPTY_WRITER, drawingScope: { ...WAITING_DRAWING, status: 'unavailable', reason: 'capture_deadline' } });
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
  assert.deepEqual(stopped, { status: 'native', reason: 'pagehide', attempts: 1, matches: 1, executions: 0, phase: 'stopped', writer: EMPTY_WRITER, drawingScope: { ...WAITING_DRAWING, status: 'unavailable', reason: 'pagehide' } });
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
  assert.deepEqual(stopped, { status: 'native', reason: 'capture_failed', attempts: 1, matches: 1, executions: 1, phase: 'stopped', writer: EMPTY_WRITER, drawingScope: WAITING_DRAWING });
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
  assert.deepEqual(stopped, { status: 'native', reason: 'scope_changed', attempts: 0, matches: 0, executions: 0, phase: 'stopped', writer: EMPTY_WRITER, drawingScope: { ...WAITING_DRAWING, status: 'unavailable', reason: 'scope_changed' } });
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
  assert.deepEqual(fresh, { status: 'waiting', reason: null, attempts: 1, matches: 1, executions: 0, phase: 'active', writer: EMPTY_WRITER, drawingScope: WAITING_DRAWING });
});

test('user retains drawing capture after stopping mirror optimization before either module registers', async t => {
  // Given an early trading page awaits both chart storage factories.
  const page = installPage(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const session = page.start();

  // When mirror optimization stops before the bounded drawing capture deadline.
  const stopped = await session.stop();
  const ownedWhileWaiting = Object.hasOwn(globalThis, QUEUE);
  t.mock.timers.tick(30_000);

  // Then drawing capture stays available until its deadline while the mirror writer stays stopped.
  assert.equal(ownedWhileWaiting, true);
  assert.equal(stopped.phase, 'stopped');
  assert.equal(stopped.drawingScope.status, 'waiting');
  assert.equal(session.snapshot().drawingScope.reason, 'capture_deadline');
  assert.equal(Object.hasOwn(globalThis, QUEUE), false);
});

for (const early of [true, false]) {
  for (const order of [['70940', '76535'], ['76535', '70940']]) {
    for (const nested of [false, true]) {
      test(`user captures both chart modules with registration order ${order.join('-')} early=${early} nested=${nested}`, t => {
        // Given the production observer owns one empty queue before the retained real Rspack runtime.
        const page = installPage(t);
        const captured = [];
        const failed = [];
        const completed = [];
        const originals = {
          70940(module, exports, require) {
            module.exports = { kind: 'mirror', child: nested ? require(76535) : null };
          },
          76535(module) { module.exports = { kind: 'drawing' }; },
        };
        const targets = Object.fromEntries(Object.entries(originals).map(([id, original]) => [id, factory => {
          assert.equal(factory, original);
          return function (module, exports, require) {
            factory.call(this, module, exports, require);
            module.exports.protected = true;
          };
        }]));
        page.observe({
          targets,
          onCapture: id => { captured.push(id); },
          onFailure: (id, reason) => { failed.push([id, reason]); },
          onComplete: reason => { completed.push(reason); },
        });
        let require;

        // When both registration orders execute sequentially or through the mirror's drawing dependency.
        if (!early) runInThisContext(HOST_RUNTIME);
        for (const id of order) {
          globalThis[QUEUE].push([[id], { [id]: originals[id] }, hostRequire => { require = hostRequire; }]);
        }
        if (early) runInThisContext(HOST_RUNTIME);
        const executionOrder = nested ? ['70940', '76535'] : order;
        const exported = Object.fromEntries(executionOrder.map(id => [id, require(id)]));
        const cached = require(70940);

        // Then both effects persist in cached exports while the original factories and native dispatcher are restored.
        assert.deepEqual(exported['76535'], { kind: 'drawing', protected: true });
        assert.deepEqual(exported['70940'], { kind: 'mirror', child: nested ? exported['76535'] : null, protected: true });
        assert.equal(cached, exported['70940']);
        assert.deepEqual(captured, nested ? ['76535', '70940'] : order);
        assert.deepEqual(failed, []);
        assert.deepEqual(completed, [null]);
        assert.equal(require.m[70940], originals[70940]);
        assert.equal(require.m[76535], originals[76535]);
        assert.equal(Object.hasOwn(Object.getOwnPropertyDescriptor(globalThis[QUEUE], 'push'), 'value'), true);
        assert.equal(globalThis[QUEUE].length, 2);
      });
    }
  }
}

for (const failedId of ['70940', '76535']) {
  test(`user preserves cached native errors from module ${failedId} while the other target captures`, t => {
    // Given two observed factories share the retained Rspack module cache and one native error.
    const page = installPage(t);
    const nativeFailure = new Error('Native chart module dependency failed');
    const otherId = failedId === '70940' ? '76535' : '70940';
    let attempts = 0;
    const originals = {
      [failedId]() { attempts += 1; throw nativeFailure; },
      [otherId](module) { module.exports = { retained: 'native-success' }; },
    };
    const captured = [];
    const failed = [];
    const completed = [];
    page.observe({
      targets: Object.fromEntries(Object.entries(originals).map(([id, factory]) => [id, original => {
        assert.equal(original, factory);
        return original;
      }])),
      onCapture: id => { captured.push(id); },
      onFailure: (id, reason) => { failed.push([id, reason]); },
      onComplete: reason => { completed.push(reason); },
    });
    let require;
    globalThis[QUEUE].push([['native-errors'], originals, hostRequire => { require = hostRequire; }]);
    runInThisContext(HOST_RUNTIME);

    // When one factory throws twice through the host cache and the independent target executes.
    assert.throws(() => require(failedId), error => error === nativeFailure);
    assert.throws(() => require(failedId), error => error === nativeFailure);
    const exported = require(otherId);

    // Then native exception identity and cache behavior survive without canceling the successful target.
    assert.equal(attempts, 1);
    assert.deepEqual(exported, { retained: 'native-success' });
    assert.deepEqual(captured, [otherId]);
    assert.deepEqual(failed, [[failedId, 'execution_failed']]);
    assert.deepEqual(completed, [null]);
    assert.equal(require.m[failedId], originals[failedId]);
    assert.equal(require.m[otherId], originals[otherId]);
  });
}

for (const mismatchId of ['70940', '76535']) {
  test(`user retains the matching target when module ${mismatchId} rejects its source pin`, t => {
    // Given one complete-source matcher rejects while the other accepts its native factory.
    const page = installPage(t);
    const otherId = mismatchId === '70940' ? '76535' : '70940';
    const originals = {
      [mismatchId](module) { module.exports = { mode: 'native-drift' }; },
      [otherId](module) { module.exports = { mode: 'native-matched' }; },
    };
    const captured = [];
    const failed = [];
    const completed = [];
    page.observe({
      targets: {
        [mismatchId]() { throw new Error('Complete source mismatch'); },
        [otherId]: original => function (module, exports, require) {
          original.call(this, module, exports, require);
          module.exports.mode = 'protected';
        },
      },
      onCapture: id => { captured.push(id); },
      onFailure: (id, reason) => { failed.push([id, reason]); },
      onComplete: reason => { completed.push(reason); },
    });
    let require;

    // When the native runtime registers the drifted module before the matching module.
    globalThis[QUEUE].push([['drift'], { [mismatchId]: originals[mismatchId] }]);
    globalThis[QUEUE].push([['matched'], { [otherId]: originals[otherId] }, hostRequire => { require = hostRequire; }]);
    runInThisContext(HOST_RUNTIME);
    const native = require(mismatchId);
    const protectedModule = require(otherId);

    // Then only the rejected target remains native and the shared observer finishes after the accepted target.
    assert.deepEqual(native, { mode: 'native-drift' });
    assert.deepEqual(protectedModule, { mode: 'protected' });
    assert.deepEqual(captured, [otherId]);
    assert.deepEqual(failed, [[mismatchId, 'source_mismatch']]);
    assert.deepEqual(completed, [null]);
    assert.equal(require.m[mismatchId], originals[mismatchId]);
    assert.equal(require.m[otherId], originals[otherId]);
  });
}

test('user keeps a later queue owner when the original observer is retired', t => {
  // Given a registered target waits while the production observer still owns its queue accessor.
  const page = installPage(t);
  const failures = [];
  const completed = [];
  const original = module => { module.exports = 'native'; };
  const observer = page.observe({
    targets: { 70940: factory => factory, 76535: factory => factory },
    onCapture: id => { completed.push(id); },
    onFailure: (id, reason) => { failures.push([id, reason]); },
    onComplete: reason => { completed.push(reason); },
  });
  globalThis[QUEUE].push([['pending-native'], { 70940: original }]);
  const newOwner = function newPush(chunk) { return Array.prototype.push.call(this, chunk); };
  Object.defineProperty(globalThis[QUEUE], 'push', { value: newOwner, writable: true, configurable: true });

  // When cleanup encounters a push property explicitly owned by another integration.
  observer.stop('stopped');

  // Then it restores its unexecuted factory without overwriting the later queue owner.
  assert.equal(globalThis[QUEUE].push, newOwner);
  assert.equal(globalThis[QUEUE][0][1][70940], original);
  assert.deepEqual(failures, [['70940', 'stopped'], ['76535', 'stopped']]);
  assert.deepEqual(completed, ['ownership_lost']);
});

test('user cannot stack a second observer on a pending chart queue', t => {
  // Given one observer already owns the early page queue.
  const page = installPage(t);
  const completed = [];
  const configuration = {
    targets: { 70940: factory => factory, 76535: factory => factory },
    onCapture: id => { completed.push(id); },
    onFailure: (id, reason) => { completed.push([id, reason]); },
    onComplete: reason => { completed.push(reason); },
  };
  const observer = page.observe(configuration);
  const owned = Object.getOwnPropertyDescriptor(globalThis[QUEUE], 'push');

  // When a second observation request reaches the same still-owned boundary.
  const second = () => page.observe(configuration);

  // Then the second request rejects and the first observer alone releases its queue.
  assert.throws(second, /before runtime on a native empty queue/);
  assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis[QUEUE], 'push'), owned);
  observer.stop();
  assert.equal(Object.hasOwn(globalThis, QUEUE), false);
  assert.deepEqual(completed, [['70940', 'stopped'], ['76535', 'stopped'], null]);
});

test('user evaluates the complete native chart factories without rendering lazy UI or opening storage', t => {
  // Given the retained runtime and persistence helpers supply the complete native factories.
  installPage(t);
  const host = registerPinnedChartFactories();

  // When the original mirror factory requires the original drawing factory during module initialization.
  const mirror = host.require(70940);
  const drawing = host.require(76535);

  // Then public component exports and lazy loader registration exist without running any component body.
  assert.deepEqual(Object.keys(mirror), ['TradingView', 'default']);
  assert.equal(typeof mirror.TradingView, 'function');
  assert.equal(mirror.default, mirror.TradingView);
  assert.deepEqual(Object.keys(drawing), ['A', 'X']);
  assert.equal(typeof drawing.A, 'function');
  assert.equal(typeof drawing.X, 'function');
  assert.equal(host.lazyLoaders.length, 1);
  assert.equal(typeof host.lazyLoaders[0], 'function');
  assert.equal(host.require(45250).range(2, 5).join(','), '2,3,4');
  assert.deepEqual(host.require(17409).bt, { TRADING: 'TRADING', DELIVERING: 'DELIVERING' });
});

for (const stopAt of ['before-registration', 'between-modules', 'after-modules']) {
  test(`user retains installed drawing protection when mirror stops ${stopAt}`, async t => {
    // Given both complete source pins are available behind the real early runtime entrypoint.
    const page = installPage(t);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const session = page.start();
    if (stopAt === 'before-registration') await session.stop();
    const host = registerPinnedChartFactories();

    // When the caller stops before registration, between executions, or after nested module initialization.
    let drawing;
    if (stopAt === 'between-modules') {
      drawing = host.require(76535);
      await session.stop();
    }
    const mirror = host.require(70940);
    drawing = host.require(76535);
    await session.stop();
    const stopped = session.snapshot();
    t.mock.timers.tick(60_000);

    // Then drawing protection stays active in the cached export and all observation timers and ownership are released.
    const matched = stopAt === 'before-registration' ? 0 : 1;
    const executed = stopAt === 'after-modules' ? 1 : 0;
    assert.deepEqual(stopped, {
      status: 'native', reason: 'manual', attempts: matched, matches: matched, executions: executed,
      phase: 'stopped', writer: EMPTY_WRITER,
      drawingScope: { status: 'active', reason: null, attempts: 1, matches: 1, executions: 1 },
    });
    assert.deepEqual(session.snapshot(), stopped);
    assert.equal(host.require(76535), drawing);
    assert.equal(host.require(70940), mirror);
    assert.equal(typeof drawing.A, 'function');
    assert.equal(typeof mirror.TradingView, 'function');
    assert.equal(host.require.m[70940], host.originals[70940]);
    assert.equal(host.require.m[76535], host.originals[76535]);
    assert.equal(host.lazyLoaders.length, 1);
    assert.equal(Object.hasOwn(Object.getOwnPropertyDescriptor(globalThis[QUEUE], 'push'), 'value'), true);
    assert.equal(getEventListeners(page.events, 'pagehide').length, 0);
  });
}

for (const mismatchId of ['70940', '76535']) {
  test(`user captures the matching complete factory when the runtime rejects source pin ${mismatchId}`, async t => {
    // Given one upstream factory has drifted and the other retains its complete verified source.
    const page = installPage(t);
    const session = page.start();
    const host = registerPinnedChartFactories({ mismatchId });

    // When both modules execute through the real Rspack cache after independent source matching.
    const mirror = host.require(70940);
    const drawing = host.require(76535);
    if (mismatchId === '70940') await session.stop();
    const active = session.snapshot();

    // Then only the mismatched target stays native while the matching target has one completed execution.
    if (mismatchId === '70940') {
      assert.deepEqual(mirror, { nativeDrift: '70940' });
      assert.equal(typeof drawing.A, 'function');
      assert.deepEqual(active, {
        status: 'native', reason: 'source_mismatch', attempts: 1, matches: 0, executions: 0,
        phase: 'stopped', writer: EMPTY_WRITER,
        drawingScope: { status: 'active', reason: null, attempts: 1, matches: 1, executions: 1 },
      });
    } else {
      assert.equal(typeof mirror.TradingView, 'function');
      assert.deepEqual(drawing, { nativeDrift: '76535' });
      assert.deepEqual(active, {
        status: 'active', reason: null, attempts: 1, matches: 1, executions: 1,
        phase: 'active', writer: EMPTY_WRITER,
        drawingScope: { status: 'source_mismatch', reason: 'source_mismatch', attempts: 1, matches: 0, executions: 0 },
      });
    }
    assert.equal(host.require.m[mismatchId], host.originals[mismatchId]);
    assert.equal(Object.hasOwn(Object.getOwnPropertyDescriptor(globalThis[QUEUE], 'push'), 'value'), true);
  });
}

test('user keeps the original drawing capture deadline when mirror stops partway through startup', async t => {
  // Given startup has already used twenty seconds of its finite registration window.
  const page = installPage(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const session = page.start();
  t.mock.timers.tick(20_000);

  // When mirror stops and the remaining drawing capture window reaches the original deadline.
  await session.stop();
  t.mock.timers.tick(9_999);
  const waiting = session.snapshot();
  t.mock.timers.tick(1);
  const expired = session.snapshot();

  // Then manual stop preserves the remaining window without granting another thirty seconds.
  assert.deepEqual(waiting.drawingScope, WAITING_DRAWING);
  assert.deepEqual(expired.drawingScope, { ...WAITING_DRAWING, status: 'unavailable', reason: 'capture_deadline' });
  assert.equal(expired.reason, 'manual');
  assert.equal(expired.phase, 'stopped');
  assert.equal(Object.hasOwn(globalThis, QUEUE), false);
  assert.equal(getEventListeners(page.events, 'pagehide').length, 0);
});

test('user keeps installed drawing protection when an unexecuted mirror reaches the capture deadline', async t => {
  // Given the drawing factory has executed while the accepted mirror factory still waits.
  const page = installPage(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const session = page.start();
  const host = registerPinnedChartFactories();
  const drawing = host.require(76535);

  // When the original capture deadline retires the remaining unexecuted mirror target.
  t.mock.timers.tick(30_000);
  await session.stop();
  const stopped = session.snapshot();

  // Then only mirror optimization retires and the installed drawing export stays cached and active.
  assert.deepEqual(stopped, {
    status: 'native', reason: 'capture_deadline', attempts: 1, matches: 1, executions: 0,
    phase: 'stopped', writer: EMPTY_WRITER,
    drawingScope: { status: 'active', reason: null, attempts: 1, matches: 1, executions: 1 },
  });
  assert.equal(host.require(76535), drawing);
  assert.equal(host.require.m[70940], host.originals[70940]);
  assert.equal(Object.hasOwn(Object.getOwnPropertyDescriptor(globalThis[QUEUE], 'push'), 'value'), true);
  assert.equal(getEventListeners(page.events, 'pagehide').length, 0);
});

test('user drains the mirror writer on pagehide after both chart factories have captured', async t => {
  // Given both complete factories have executed and interception has restored the native queue.
  const page = installPage(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const session = page.start();
  const host = registerPinnedChartFactories();
  host.require(70940);
  const active = session.snapshot();
  const listening = getEventListeners(page.events, 'pagehide').length;

  // When pagehide arrives after capture has canceled the registration deadline.
  page.events.dispatchEvent(new Event('pagehide'));
  const stopped = await session.stop();
  t.mock.timers.tick(60_000);

  // Then pagehide still drains the active mirror without withdrawing installed drawing protection.
  assert.equal(active.status, 'active');
  assert.equal(active.drawingScope.status, 'active');
  assert.equal(listening, 1);
  assert.deepEqual(stopped, {
    status: 'native', reason: 'pagehide', attempts: 1, matches: 1, executions: 1,
    phase: 'stopped', writer: EMPTY_WRITER,
    drawingScope: { status: 'active', reason: null, attempts: 1, matches: 1, executions: 1 },
  });
  assert.deepEqual(session.snapshot(), stopped);
  assert.equal(getEventListeners(page.events, 'pagehide').length, 0);
});
