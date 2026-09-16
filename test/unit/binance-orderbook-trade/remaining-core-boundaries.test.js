import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isChartMutationBlocked,
  registerChartMutationOwner,
} from '../../../src/shared/chart-mutation-owners.js';
import { installBinanceNativeDepthSource } from '../../../src/binance-orderbook-trade/core/binance-native-depth-source.js';
import {
  createTradingViewContinuousSaveController,
  createTradingViewRemovalSaveController,
} from '../../../src/binance-orderbook-trade/core/chart-save-coalescer.js';

const OWNER_SLOT = Symbol.for('jh-userscripts.chart-mutation-owners');
const SNAPSHOT = { lastUpdateId: 101, bids: [['10', '1']], asks: [['11', '2']] };

/** Model transport delivery with native EventTarget and Response implementations. */
function createNativeDepthHost() {
  const requests = [];
  const sockets = [];
  const state = { response: Response.json(SNAPSHOT), failure: null };
  class NativeSocket extends EventTarget {
    constructor(url) {
      super();
      this.url = url;
      sockets.push(this);
    }
  }
  function nativeFetch(...args) {
    const request = { receiver: this, args, result: null };
    requests.push(request);
    if (state.failure !== null) throw state.failure;
    request.result = Promise.resolve(state.response);
    return request.result;
  }
  const globalObject = {
    fetch: nativeFetch,
    WebSocket: NativeSocket,
    location: { href: 'https://www.binance.com/en/futures/BTCUSDT' },
  };
  return { globalObject, state, nativeFetch, NativeSocket, requests, sockets };
}

/** The native chart boundary owns event delivery, shape metadata, and save calls. */
function createNativeChartHost() {
  const listeners = new Map();
  const shapes = new Map();
  const saved = [];
  const api = {
    activeChart() {
      return { getShapeById: id => shapes.get(String(id)) };
    },
    saveChart(...args) {
      saved.push({ receiver: this, args });
    },
    subscribe(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
    },
    unsubscribe(name, listener) {
      listeners.get(name)?.delete(listener);
    },
    emit(name, ...args) {
      for (const listener of listeners.get(name) || []) listener(...args);
    },
  };
  return {
    api,
    saved,
    listeners,
    shapes,
    holdCurrentSave() {
      const held = api.saveChart;
      const attempted = [];
      Object.defineProperty(api, 'saveChart', {
        configurable: true,
        get: () => held,
        set: value => { attempted.push(value); },
      });
      return attempted;
    },
  };
}

test('user receives exact native response, socket, and transport failure behavior from the host', async () => {
  // Given an offline transport host uses the native response and event implementations.
  const host = createNativeDepthHost();
  const receiver = {};
  const init = { cache: 'no-store' };
  const messages = [];
  const socket = new host.NativeSocket('wss://native.example/ws');
  const listener = event => messages.push(event.data);
  socket.addEventListener('message', listener);

  // When the host receives one fetch and two native message deliveries around unsubscription.
  const promise = Reflect.apply(host.nativeFetch, receiver, ['/native-snapshot', init]);
  socket.dispatchEvent(new MessageEvent('message', { data: 'first' }));
  socket.removeEventListener('message', listener);
  socket.dispatchEvent(new MessageEvent('message', { data: 'second' }));
  const response = await promise;

  // Then receiver, arguments, promise identity, response data, and listener lifetime stay exact.
  assert.equal(host.requests[0].receiver, receiver);
  assert.deepEqual(host.requests[0].args, ['/native-snapshot', init]);
  assert.equal(host.requests[0].result, promise);
  assert.equal(response, host.state.response);
  assert.deepEqual(await response.clone().json(), SNAPSHOT);
  assert.deepEqual(messages, ['first']);
  assert.deepEqual(host.sockets, [socket]);
  assert.equal(socket.url, 'wss://native.example/ws');
  host.state.failure = 'Native transport refused the request';
  assert.throws(() => host.nativeFetch('/refused'), error => error === host.state.failure);
});

test('user receives native chart event, save, metadata, and held-property behavior from the host', () => {
  // Given one native chart listener and one known order drawing.
  const host = createNativeChartHost();
  const received = [];
  const listener = (...args) => received.push(args);
  host.shapes.set('42', { lineDataSource: () => ({ toolname: 'LineToolOrder' }) });
  host.api.subscribe('drawing_event', listener);
  const receiver = {};

  // When events and saves are delivered before and after removing the native listener.
  host.api.emit('drawing_event', '42', 'properties_changed');
  host.api.unsubscribe('drawing_event', listener);
  host.api.emit('drawing_event', '42', 'remove');
  Reflect.apply(host.api.saveChart, receiver, ['snapshot', 2]);
  const original = host.api.saveChart;
  const attempted = host.holdCurrentSave();
  const replacement = () => 'replacement';
  host.api.saveChart = replacement;

  // Then the boundary preserves each native operation and explicitly refuses held-property replacement.
  assert.deepEqual(received, [['42', 'properties_changed']]);
  assert.deepEqual(host.saved, [{ receiver, args: ['snapshot', 2] }]);
  assert.equal(host.listeners.get('drawing_event').size, 0);
  assert.equal(host.api.activeChart().getShapeById(42).lineDataSource().toolname, 'LineToolOrder');
  assert.equal(host.api.activeChart().getShapeById('absent'), undefined);
  assert.equal(host.api.saveChart, original);
  assert.deepEqual(attempted, [replacement]);
});

test('user releases a chart owner without allowing an old disposer to remove its replacement', () => {
  // Given an initially unblocked shared page registers one active chart owner.
  const view = { Map };
  assert.equal(isChartMutationBlocked(view), false);
  const releaseOriginal = registerChartMutationOwner(view, 'ladder', () => true);
  assert.equal(isChartMutationBlocked(view), true);

  // When that owner is released and a new active owner reuses the same name.
  releaseOriginal();
  assert.equal(isChartMutationBlocked(view), false);
  const releaseCurrent = registerChartMutationOwner(view, 'ladder', () => true);
  releaseOriginal();

  // Then the old disposer cannot release the current operation.
  assert.equal(isChartMutationBlocked(view), true);

  // When the current owner releases its own registration twice.
  releaseCurrent();
  releaseCurrent();

  // Then mutation is unblocked with an empty shared registry.
  assert.equal(isChartMutationBlocked(view), false);
  assert.equal(view[OWNER_SLOT].predicates.size, 0);
});

test('user cannot replace a registered chart owner or register an invalid predicate', () => {
  // Given a chart operation already owns its shared name.
  const view = { Map };
  const release = registerChartMutationOwner(view, 'orders', () => true);

  // When another registration uses the same name or a non-function predicate.
  const duplicate = () => registerChartMutationOwner(view, 'orders', () => false);
  const invalid = () => registerChartMutationOwner(view, 'invalid', false);

  // Then explicit errors preserve the active owner and do not reserve the invalid name.
  assert.throws(duplicate, { message: 'Duplicate chart mutation owner' });
  assert.throws(invalid, { message: 'Chart mutation owner requires a predicate' });
  assert.deepEqual([...view[OWNER_SLOT].predicates.keys()], ['orders']);
  assert.equal(isChartMutationBlocked(view), true);
  release();
});

test('user stops evaluating later chart predicates once an active owner blocks mutation', () => {
  // Given two chart owners expose separate current activity.
  const view = { Map };
  let firstActive = true;
  let laterReads = 0;
  const releaseFirst = registerChartMutationOwner(view, 'first', () => firstActive);
  const releaseLater = registerChartMutationOwner(view, 'later', () => { laterReads += 1; return false; });

  // When the first owner blocks the shared mutation check.
  const blocked = isChartMutationBlocked(view);

  // Then no later predicate is consulted until the first owner becomes idle.
  assert.equal(blocked, true);
  assert.equal(laterReads, 0);
  firstActive = false;
  assert.equal(isChartMutationBlocked(view), false);
  assert.equal(laterReads, 1);
  releaseFirst();
  releaseLater();
});

for (const variant of [
  { name: 'a different protocol version', record: () => ({ version: 2, predicates: new Map() }) },
  { name: 'an incompatible predicate registry', record: () => ({ version: 1, predicates: new Set() }) },
]) {
  test(`user rejects shared chart state with ${variant.name}`, () => {
    // Given another userscript published an incompatible shared protocol.
    const view = { Map, [OWNER_SLOT]: variant.record() };

    // When reading or registering against the shared record.
    const read = () => isChartMutationBlocked(view);
    const register = () => registerChartMutationOwner(view, 'orders', () => false);

    // Then both public operations require the scripts to agree on their protocol.
    const message = 'Incompatible chart mutation protocol; update both scripts and reload';
    assert.throws(read, { message });
    assert.throws(register, { message });
  });
}

test('user rejects a chart registry without its owning realm Map constructor', () => {
  // Given a shared record is present but the owning realm cannot validate its Map.
  const view = { [OWNER_SLOT]: { version: 1, predicates: new Map() } };

  // When a script reads the shared mutation boundary.
  const read = () => isChartMutationBlocked(view);

  // Then the incompatible realm is explicit rather than appearing unblocked.
  assert.throws(read, { message: 'Incompatible chart mutation protocol; update both scripts and reload' });
});

test('user requires synchronous boolean chart ownership and receives predicate failures unchanged', () => {
  // Given one owner returns an asynchronous result instead of the shared boolean contract.
  const view = { Map };
  const releaseAsync = registerChartMutationOwner(view, 'async-owner', () => Promise.resolve(false));
  const failure = new Error('Native chart owner failed');

  // When the shared boundary reads the invalid owner.
  const readAsync = () => isChartMutationBlocked(view);

  // Then asynchronous truthiness cannot authorize or block another operation silently.
  assert.throws(readAsync, { message: 'Chart mutation owner must return a boolean' });
  releaseAsync();

  // When another native predicate throws during its ownership check.
  const releaseFailure = registerChartMutationOwner(view, 'failing-owner', () => { throw failure; });

  // Then its exact failure propagates to the caller.
  assert.throws(() => isChartMutationBlocked(view), error => error === failure);
  releaseFailure();
});

for (const variant of [
  { name: 'an absent global object', input: () => null, message: 'Invalid native depth global object' },
  { name: 'a missing fetch function', input: host => ({ ...host.globalObject, fetch: null }), message: 'Invalid native depth fetch function' },
  { name: 'a missing socket constructor', input: host => ({ ...host.globalObject, WebSocket: null }), message: 'Invalid native depth WebSocket constructor' },
  { name: 'a socket without event listeners', input: host => ({ ...host.globalObject, WebSocket: class Socket {} }), message: 'Invalid native depth WebSocket event listener' },
  { name: 'a missing native page URL', input: host => ({ ...host.globalObject, location: {} }), message: 'Invalid native depth page URL' },
]) {
  test(`user rejects native depth installation with ${variant.name}`, () => {
    // Given one required native transport contract is absent.
    const host = createNativeDepthHost();
    const input = variant.input(host);

    // When the real passive adapter attempts to install.
    const install = () => installBinanceNativeDepthSource(input);

    // Then it reports the exact missing dependency without issuing network or socket operations.
    assert.throws(install, { message: variant.message });
    assert.deepEqual(host.requests, []);
    assert.deepEqual(host.sockets, []);
  });
}

test('user receives a connecting depth state only after a valid symbol subscription', t => {
  // Given a newly installed passive source has no known symbols.
  const host = createNativeDepthHost();
  const source = installBinanceNativeDepthSource(host.globalObject);
  t.after(() => source.restore());
  const statuses = [];
  const profiles = [];
  assert.equal(source.getState('BTCUSDT'), null);

  // When invalid subscription contracts precede one valid observer.
  assert.throws(() => source.subscribe(), { message: 'Invalid native depth symbol' });
  assert.throws(() => source.subscribe({ symbol: 'BTCUSDT', onProfile: null, onStatus: status => statuses.push(status) }), { message: 'Invalid native depth profile listener' });
  assert.throws(() => source.subscribe({ symbol: 'BTCUSDT', onProfile: profile => profiles.push(profile), onStatus: null }), { message: 'Invalid native depth status listener' });
  const unsubscribe = source.subscribe({
    symbol: 'BTCUSDT',
    onProfile: profile => profiles.push(profile),
    onStatus: status => statuses.push(status),
  });

  // Then the observer sees exact pending state without fabricated prices or partial invalid listeners.
  const status = { symbol: 'BTCUSDT', status: 'connecting', detail: '' };
  assert.deepEqual(statuses, [status]);
  assert.deepEqual(profiles, []);
  assert.deepEqual(source.getState('BTCUSDT'), { status, bidCount: 0, askCount: 0, minPrice: null, maxPrice: null });
  unsubscribe();
});

test('user receives the original native fetch failure while only its matching depth symbol fails', t => {
  // Given a passive source observes a native fetch that throws a non-Error value.
  const host = createNativeDepthHost();
  const source = installBinanceNativeDepthSource(host.globalObject);
  t.after(() => source.restore());
  const statuses = [];
  source.subscribe({ symbol: 'BTCUSDT', onProfile: () => true, onStatus: status => statuses.push(status) });
  host.state.failure = 'Native request aborted';

  // When an unrelated request fails before the symbol-specific native depth request fails.
  assert.throws(() => host.globalObject.fetch('/unrelated'), error => error === host.state.failure);
  const afterUnrelated = [...statuses];
  assert.throws(() => host.globalObject.fetch('/fapi/v1/rpiDepth?symbol=BTCUSDT&limit=1000'), error => error === host.state.failure);

  // Then unrelated failure leaves depth connecting and the matching failure preserves its exact detail.
  assert.deepEqual(afterUnrelated, [{ symbol: 'BTCUSDT', status: 'connecting', detail: '' }]);
  assert.deepEqual(statuses, [
    { symbol: 'BTCUSDT', status: 'connecting', detail: '' },
    { symbol: 'BTCUSDT', status: 'synchronizing', detail: '' },
    { symbol: 'BTCUSDT', status: 'failed', detail: 'Native request aborted' },
  ]);
  assert.equal(host.requests.length, 2);
  assert.equal(source.getState('BTCUSDT').status.detail, 'Native request aborted');
});

test('user drops an unobserved old depth symbol without reviving it when its native socket closes', { timeout: 2000 }, async t => {
  // Given one native socket has seen an old symbol without any remaining subscriber.
  const host = createNativeDepthHost();
  const source = installBinanceNativeDepthSource(host.globalObject);
  t.after(() => source.restore());
  const socket = new host.globalObject.WebSocket('wss://native.example/ws');
  socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
    stream: 'btcusdt@rpiDepth@500ms',
    data: { e: 'depthUpdate', s: 'BTCUSDT', st: 1, U: 100, u: 102, pu: 99, b: [['10', '2']], a: [['11', '3']] },
  }) }));
  assert.equal(source.getState('BTCUSDT').status.status, 'synchronizing');
  const statuses = [];
  const delivered = Promise.withResolvers();
  let synchronizingCount = 0;
  source.subscribe({
    symbol: 'ETHUSDT',
    onProfile: () => true,
    onStatus(status) {
      statuses.push(status);
      if (status.status === 'synchronizing' && ++synchronizingCount === 2) delivered.resolve();
    },
  });

  // When Binance requests another symbol and the old native socket then closes.
  const response = await host.globalObject.fetch('/fapi/v1/rpiDepth?symbol=ETHUSDT&limit=1000');
  await delivered.promise;
  socket.dispatchEvent(new Event('close'));

  // Then the unused old record stays absent and the current symbol retains its own synchronization state.
  assert.equal(response, host.state.response);
  assert.equal(source.getState('BTCUSDT'), null);
  assert.deepEqual(statuses, [
    { symbol: 'ETHUSDT', status: 'connecting', detail: '' },
    { symbol: 'ETHUSDT', status: 'synchronizing', detail: '' },
    { symbol: 'ETHUSDT', status: 'synchronizing', detail: '' },
  ]);
  assert.equal(source.getState('ETHUSDT').status.status, 'synchronizing');
  assert.equal(host.requests.length, 1);
  assert.equal(host.sockets.length, 1);
});

test('user persists the newer burst only when save ownership changes after an older deferred snapshot', async t => {
  // Given one completed order capture has deferred its older cumulative chart snapshot.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const host = createNativeChartHost();
  host.shapes.set('order-1', { lineDataSource: () => ({ toolname: 'LineToolOrder' }) });
  host.shapes.set('order-2', { lineDataSource: () => ({ toolname: 'LineToolOrder' }) });
  const controller = createTradingViewContinuousSaveController(host.api);
  const round = controller.beginRound();
  const first = controller.beginSubmitCapture(round);
  host.api.emit('drawing_event', 'order-1', 'properties_changed');
  host.api.saveChart('older-snapshot');
  t.mock.timers.tick(120);
  assert.deepEqual(await controller.completeSubmitCapture(first), { matched: true, status: 'captured' });
  assert.deepEqual(host.saved, []);

  // When another owner replaces saving during the newer captured burst.
  const second = controller.beginSubmitCapture(round);
  host.api.emit('drawing_event', 'order-2', 'properties_changed');
  const receiver = { caller: 'native-chart' };
  Reflect.apply(host.api.saveChart, receiver, ['newer-snapshot']);
  const foreignSaves = [];
  const foreignSave = (...args) => foreignSaves.push(args);
  host.api.saveChart = foreignSave;
  t.mock.timers.tick(120);
  const captured = await controller.completeSubmitCapture(second);
  controller.endRound(round);
  const stats = controller.stop();

  // Then only the newer captured snapshot reaches its original owner and stale data is never replayed.
  assert.deepEqual(captured, { matched: true, status: 'save-chart-replaced' });
  assert.deepEqual(host.saved, [{ receiver, args: ['newer-snapshot'] }]);
  assert.deepEqual(foreignSaves, []);
  assert.equal(host.api.saveChart, foreignSave);
  assert.equal(host.listeners.get('drawing_event').size, 0);
  assert.deepEqual(stats, {
    deferredSubmitSaveCount: 1, fullSaveCount: 1, orderEventCount: 2, removeEventCount: 0, saveRequestCount: 2,
  });
});

test('user leaves saves synchronous when a native shape has no order-tool metadata', async t => {
  // Given a submit capture observes a native shape whose optional tool metadata is absent.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const host = createNativeChartHost();
  host.shapes.set('unknown-shape', {});
  const originalSave = host.api.saveChart;
  const controller = createTradingViewContinuousSaveController(host.api);
  const round = controller.beginRound();
  const capture = controller.beginSubmitCapture(round);

  // When the shape event arrives and discovery has one millisecond left.
  host.api.emit('drawing_event', 'unknown-shape', 'properties_changed');
  host.api.saveChart('native-unrelated-snapshot');
  t.mock.timers.tick(249);

  // Then no order event or save wrapper is invented from missing metadata.
  assert.equal(capture.status, null);
  assert.equal(host.api.saveChart, originalSave);
  assert.deepEqual(host.saved.map(save => save.args), [['native-unrelated-snapshot']]);

  // When the full native event discovery window expires.
  t.mock.timers.tick(1);
  const result = await controller.completeSubmitCapture(capture);
  controller.endRound(round);
  const stats = controller.stop();

  // Then the capture reports no matching order while saving remains synchronous.
  assert.deepEqual(result, { matched: false, status: 'no-order-event' });
  assert.deepEqual(stats, {
    deferredSubmitSaveCount: 0, fullSaveCount: 0, orderEventCount: 0, removeEventCount: 0, saveRequestCount: 0,
  });
  assert.equal(host.listeners.get('drawing_event').size, 0);
});

test('user completes a removal burst without creating a save request that the native chart never made', async t => {
  // Given the chart removes a drawing without requesting a serialized snapshot.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const host = createNativeChartHost();
  const originalSave = host.api.saveChart;
  const controller = createTradingViewRemovalSaveController(host.api, { eventDiscoveryMs: 0 });

  // When the real removal burst settles through its normal quiet window.
  host.api.emit('drawing_event', 'order-1', 'remove');
  const completion = controller.finish();
  t.mock.timers.tick(140);
  const stats = await completion;

  // Then lifecycle completion restores saving with no fabricated snapshot.
  assert.deepEqual(stats, { fullSaveCount: 0, removeEventCount: 1, saveRequestCount: 0, synchronousSaveCount: 0 });
  assert.deepEqual(host.saved, []);
  assert.equal(host.api.saveChart, originalSave);
  assert.equal(host.listeners.get('drawing_event').size, 0);
});

test('user receives the first explicit save-wrapper refusal after repeated native removals release their monitor', async () => {
  // Given the native host holds the current monitor function instead of accepting a burst wrapper.
  const host = createNativeChartHost();
  const originalSave = host.api.saveChart;
  const controller = createTradingViewRemovalSaveController(host.api, { eventDiscoveryMs: 0 });
  const attempted = host.holdCurrentSave();

  // When two native removal events encounter the held save property and cleanup follows.
  host.api.emit('drawing_event', 'order-1', 'remove');
  host.api.emit('drawing_event', 'order-2', 'remove');
  const completion = controller.finish();

  // Then the original refusal remains explicit while method ownership and event resources are restored.
  await assert.rejects(completion, { message: '图表保存接口无法启用删除事件合并' });
  assert.equal(attempted.length, 2);
  assert.equal(host.api.saveChart, originalSave);
  assert.equal(host.listeners.get('drawing_event').size, 0);
  assert.deepEqual(host.saved, []);
  assert.deepEqual(controller.getStats(), { fullSaveCount: 0, removeEventCount: 2, saveRequestCount: 0, synchronousSaveCount: 0 });
});

test('user preserves the first ownership conflict across repeated native removal events', async () => {
  // Given another chart operation replaces saving before removal capture starts.
  const host = createNativeChartHost();
  const controller = createTradingViewRemovalSaveController(host.api, { eventDiscoveryMs: 0 });
  const foreignSaves = [];
  const foreignSave = (...args) => foreignSaves.push(args);
  host.api.saveChart = foreignSave;

  // When multiple native removals encounter the same foreign owner before final cleanup.
  host.api.emit('drawing_event', 'order-1', 'remove');
  host.api.emit('drawing_event', 'order-2', 'remove');
  host.api.saveChart('foreign-snapshot');
  const completion = controller.finish();

  // Then the first conflict is preserved and cleanup cannot overwrite the current save owner.
  await assert.rejects(completion, { message: '图表保存接口正被其他操作占用' });
  assert.equal(host.api.saveChart, foreignSave);
  assert.deepEqual(foreignSaves, [['foreign-snapshot']]);
  assert.deepEqual(host.saved, []);
  assert.equal(host.listeners.get('drawing_event').size, 0);
});
