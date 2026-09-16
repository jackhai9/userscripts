import test from 'node:test';
import assert from 'node:assert/strict';
import { captureThrownError } from '../../helpers/orderbook-migration-errors.js';

import { installBinanceNativeDepthSource } from '../../../src/binance-orderbook-trade/core/binance-native-depth-source.js';
import { createDepthProfileSession } from '../../../src/binance-orderbook-trade/core/depth-profile-session.js';
import { parseFuturesTradingSymbolFromPathname } from '../../../src/shared/binance-futures-route.js';

class FakeResponse {
  constructor(payload, { ok = true, status = 200, jsonError = null } = {}) {
    this.payload = payload;
    this.ok = ok;
    this.status = status;
    this.jsonError = jsonError;
  }

  clone() {
    return new FakeResponse(this.payload, { ok: this.ok, status: this.status, jsonError: this.jsonError });
  }

  async json() {
    if (this.jsonError) throw this.jsonError;
    return this.payload;
  }
}

class FakeNativeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  constructor(...args) {
    this.args = args;
    this.listeners = new Map();
    FakeNativeSocket.instances.push(this);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }

  message(payload) {
    this.emit('message', { data: JSON.stringify(payload) });
  }
}

function snapshot(overrides = {}) {
  return {
    lastUpdateId: 101,
    bids: [['100', '1'], ['99', '2']],
    asks: [['101', '3'], ['102', '4']],
    ...overrides,
  };
}

function update(overrides = {}) {
  return {
    e: 'depthUpdate',
    s: 'BTCUSDT',
    st: 1,
    U: 100,
    u: 102,
    pu: 99,
    b: [['100', '2'], ['99', '3']],
    a: [['101', '4'], ['102', '5']],
    ...overrides,
  };
}

function rpiMessage(payload = update()) {
  return { stream: 'btcusdt@rpiDepth@500ms', data: payload };
}

function createHarness(response = new FakeResponse(snapshot())) {
  FakeNativeSocket.instances = [];
  const fetchCalls = [];
  const originalFetch = function originalFetch(...args) {
    const call = { receiver: this, args, result: null };
    fetchCalls.push(call);
    const result = Promise.resolve(typeof response === 'function' ? response() : response);
    call.result = result;
    return result;
  };
  const globalObject = {
    fetch: originalFetch,
    WebSocket: FakeNativeSocket,
    location: { href: 'https://www.binance.com/zh-CN/futures/BTCUSDT' },
  };
  const source = installBinanceNativeDepthSource(globalObject);
  return { fetchCalls, globalObject, originalFetch, source };
}

function recordDepthEvents(source, symbol = 'BTCUSDT') {
  const profiles = [];
  const statuses = [];
  const waiters = new Set();
  const notify = () => {
    for (const waiter of waiters) {
      if (!waiter.matches({ profiles, statuses })) continue;
      waiters.delete(waiter);
      waiter.resolve();
    }
  };
  const unsubscribe = source.subscribe({
    symbol,
    onProfile(profile) { profiles.push(profile); notify(); },
    onStatus(status) { statuses.push(status); notify(); },
  });
  return {
    profiles, statuses, unsubscribe,
    waitFor(matches) {
      if (matches({ profiles, statuses })) return Promise.resolve();
      const completion = Promise.withResolvers();
      waiters.add({ matches, resolve: completion.resolve });
      return completion.promise;
    },
  };
}

test("user observes the native RPI snapshot and stream without creating another socket", async () => {
  // Given the native transport and depth subscription are initialized
  const { fetchCalls, globalObject, source } = createHarness();
  const profiles = [];
  const statuses = [];
  source.subscribe({
    symbol: 'BTCUSDT',
    onProfile: (profile) => profiles.push(profile),
    onStatus: (status) => statuses.push(status),
  });

  const nativeSocket = new globalObject.WebSocket('wss://native-binance-stream.example/ws');
  const responsePromise = globalObject.fetch('/fapi/v1/rpiDepth?symbol=BTCUSDT&limit=1000');
  nativeSocket.message(rpiMessage());
  const response = await responsePromise;
  // When Binance delivers the observed depth event
  await new Promise((resolve) => setImmediate(resolve));

  // Then observes the native RPI snapshot and stream without creating another socket
  assert.equal(response.ok, true);
  assert.equal(FakeNativeSocket.instances.length, 1);
  assert.equal(nativeSocket.args[0], 'wss://native-binance-stream.example/ws');
  assert.equal(fetchCalls.length, 1);
  assert.equal(profiles.length, 1, JSON.stringify({ statuses, state: source.getState('BTCUSDT') }));
  assert.equal(profiles[0].symbol, 'BTCUSDT');
  assert.equal(profiles[0].bids.at(-1).price, 99);
  assert.equal(profiles[0].asks.at(-1).price, 102);
  assert.equal(statuses.at(-1).status, 'ready');

  source.restore();
});

test("user retains distant active prices delivered after the 1000-level native snapshot", async () => {
  // Given the native transport and depth subscription are initialized
  const denseSnapshot = snapshot({
    bids: Array.from({ length: 1000 }, (_, index) => [String(100 - index / 1000), '1']),
    asks: Array.from({ length: 1000 }, (_, index) => [String(101 + index / 1000), '1']),
  });
  const { globalObject, source } = createHarness(new FakeResponse(denseSnapshot));
  const profiles = [];
  source.subscribe({
    symbol: 'BTCUSDT',
    onProfile: (profile) => profiles.push(profile),
    onStatus: () => {},
  });

  const nativeSocket = new globalObject.WebSocket('wss://native-binance-stream.example/ws');
  const responsePromise = globalObject.fetch('/fapi/v1/rpiDepth?symbol=BTCUSDT&limit=1000');
  nativeSocket.message(rpiMessage());
  await responsePromise;
  await new Promise((resolve) => setImmediate(resolve));
  // When Binance delivers the observed depth event
  nativeSocket.message(rpiMessage(update({
    U: 103,
    u: 104,
    pu: 102,
    b: [['50', '7']],
    a: [['150', '8']],
  })));

  const profile = profiles.at(-1);
  // Then retains distant active prices delivered after the 1000-level native snapshot
  assert.equal(profile.bids.length, 1002);
  assert.equal(profile.asks.length, 1002);
  assert.equal(profile.bids.at(-1).price, 50);
  assert.equal(profile.asks.at(-1).price, 150);
  source.restore();
});

test("user preserves native fetch, WebSocket prototype, instanceof, and static constants", async () => {
  // Given the native transport and depth subscription are initialized
  const {
    fetchCalls,
    globalObject,
    originalFetch,
    source,
  } = createHarness();
  const wrappedFetch = globalObject.fetch;
  const WrappedWebSocket = globalObject.WebSocket;
  const receiver = { marker: 'receiver' };

  const fetchResult = Reflect.apply(wrappedFetch, receiver, ['/unrelated']);
  // When Binance delivers the observed depth event
  await fetchResult;
  const socket = new WrappedWebSocket('wss://native-binance-stream.example/ws', ['json']);

  // Then preserves native fetch, WebSocket prototype, instanceof, and static constants
  assert.equal(socket instanceof FakeNativeSocket, true);
  assert.equal(socket instanceof WrappedWebSocket, true);
  assert.equal(wrappedFetch.name, originalFetch.name);
  assert.equal(wrappedFetch.length, originalFetch.length);
  assert.equal(WrappedWebSocket.name, FakeNativeSocket.name);
  assert.equal(WrappedWebSocket.OPEN, FakeNativeSocket.OPEN);
  assert.deepEqual(socket.args, ['wss://native-binance-stream.example/ws', ['json']]);
  assert.equal(fetchResult, fetchCalls[0].result);

  source.restore();
  assert.equal(globalObject.fetch, originalFetch);
  assert.equal(globalObject.WebSocket, FakeNativeSocket);
});

test("user reports a changed native snapshot contract without blocking the Binance fetch", async () => {
  // Given the native transport and depth subscription are initialized
  const { fetchCalls, globalObject, source } = createHarness();
  const statuses = [];
  // When Binance delivers the observed depth event
  source.subscribe({
    symbol: 'BTCUSDT',
    onProfile: () => {},
    onStatus: (status) => statuses.push(status),
  });

  const response = await globalObject.fetch('/fapi/v1/rpiDepth?symbol=BTCUSDT&limit=500');

  // Then reports a changed native snapshot contract without blocking the Binance fetch
  assert.equal(response.ok, true);
  assert.equal(fetchCalls.length, 1);
  assert.equal(statuses.at(-1).status, 'failed');
  assert.match(statuses.at(-1).detail, /snapshot limit/);
  source.restore();
});

test("user does not block a malformed native snapshot request", async () => {
  // Given the native transport and depth subscription are initialized
  const { fetchCalls, globalObject, source } = createHarness();
  const statuses = [];
  // When Binance delivers the observed depth event
  source.subscribe({
    symbol: 'BTCUSDT',
    onProfile: () => {},
    onStatus: (status) => statuses.push(status),
  });

  const response = await globalObject.fetch('/fapi/v1/rpiDepth?limit=1000');

  // Then does not block a malformed native snapshot request
  assert.equal(response.ok, true);
  assert.equal(fetchCalls.length, 1);
  assert.equal(statuses.at(-1).status, 'failed');
  assert.match(statuses.at(-1).detail, /symbol/);
  source.restore();
});

test("user keeps the latest native profile for subscribers that start after page initialization", async () => {
  // Given the native transport and depth subscription are initialized
  const { globalObject, source } = createHarness();
  const nativeSocket = new globalObject.WebSocket('wss://native-binance-stream.example/ws');
  const responsePromise = globalObject.fetch('/fapi/v1/rpiDepth?symbol=BTCUSDT&limit=1000');
  nativeSocket.message(rpiMessage());
  await responsePromise;
  await new Promise((resolve) => setImmediate(resolve));

  const profiles = [];
  const statuses = [];
  // When Binance delivers the observed depth event
  source.subscribe({
    symbol: 'BTCUSDT',
    onProfile: (profile) => profiles.push(profile),
    onStatus: (status) => statuses.push(status),
  });

  // Then keeps the latest native profile for subscribers that start after page initialization
  assert.equal(profiles.length, 1, JSON.stringify({ statuses, state: source.getState('BTCUSDT') }));
  assert.equal(profiles[0].symbol, 'BTCUSDT');
  assert.equal(statuses.at(-1).status, 'ready');
  source.restore();
});

test("user ignores unrelated native fetches and WebSocket streams", async () => {
  // Given the native transport and depth subscription are initialized
  const { globalObject, source } = createHarness();
  const profiles = [];
  source.subscribe({
    symbol: 'BTCUSDT',
    onProfile: (profile) => profiles.push(profile),
    onStatus: () => {},
  });
  const nativeSocket = new globalObject.WebSocket('wss://native-binance-stream.example/ws');

  nativeSocket.message({ stream: 'btcusdt@depth@100ms', data: update() });
  await globalObject.fetch('/fapi/v1/depth?symbol=BTCUSDT&limit=1000');
  // When Binance delivers the observed depth event
  await Promise.resolve();

  // Then ignores unrelated native fetches and WebSocket streams
  assert.equal(profiles.length, 0);
  source.restore();
});

test("user waits for Binance native resynchronization after a sequence gap", async () => {
  // Given the native transport and depth subscription are initialized
  const { globalObject, source } = createHarness();
  const profiles = [];
  const statuses = [];
  source.subscribe({
    symbol: 'BTCUSDT',
    onProfile: (profile) => profiles.push(profile),
    onStatus: (status) => statuses.push(status),
  });
  const nativeSocket = new globalObject.WebSocket('wss://native-binance-stream.example/ws');
  const responsePromise = globalObject.fetch('/fapi/v1/rpiDepth?symbol=BTCUSDT&limit=1000');
  nativeSocket.message(rpiMessage());
  await responsePromise;
  // When Binance delivers the observed depth event
  await new Promise((resolve) => setImmediate(resolve));
  // Then waits for Binance native resynchronization after a sequence gap
  assert.equal(profiles.length, 1, JSON.stringify({ statuses, state: source.getState('BTCUSDT') }));

  nativeSocket.message(rpiMessage(update({ U: 105, u: 106, pu: 104 })));
  assert.equal(statuses.at(-1).status, 'resyncing');

  nativeSocket.message(rpiMessage(update({ U: 106, u: 107, pu: 106 })));
  assert.equal(profiles.length, 1);
  source.restore();
});

test("user recovers when Binance performs its next native snapshot synchronization", async () => {
  // Given the native transport and depth subscription are initialized
  let currentResponse = new FakeResponse(snapshot());
  const { globalObject, source } = createHarness(() => currentResponse);
  const profiles = [];
  const statuses = [];
  source.subscribe({
    symbol: 'BTCUSDT',
    onProfile: (profile) => profiles.push(profile),
    onStatus: (status) => statuses.push(status),
  });
  const nativeSocket = new globalObject.WebSocket('wss://native-binance-stream.example/ws');

  let responsePromise = globalObject.fetch('/fapi/v1/rpiDepth?symbol=BTCUSDT&limit=1000');
  nativeSocket.message(rpiMessage());
  await responsePromise;
  await new Promise((resolve) => setImmediate(resolve));
  // When Binance delivers the observed depth event
  nativeSocket.message(rpiMessage(update({ U: 105, u: 106, pu: 104 })));
  // Then a sequence gap leaves the profile waiting for native resynchronization
  assert.equal(statuses.at(-1).status, 'resyncing');

  currentResponse = new FakeResponse(snapshot({ lastUpdateId: 106 }));
  responsePromise = globalObject.fetch('/fapi/v1/rpiDepth?symbol=BTCUSDT&limit=1000');
  nativeSocket.message(rpiMessage(update({ U: 106, u: 107, pu: 106 })));
  await responsePromise;
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(profiles.length, 2);
  assert.equal(statuses.at(-1).status, 'ready');
  source.restore();
});

for (const symbol of ['龙虾USDT', '币安人生USDT', '4USDT', '1INCHUSDT', '1000龙虾USDT']) {
  test(`user connects the encoded ${symbol} route to native snapshot, stream, and session`, async () => {
    // Given the native transport and depth subscription are initialized
    const { globalObject, source, fetchCalls } = createHarness();
    const route = new URL(`https://www.binance.com/zh-CN/futures/${symbol}`);
    const profiles = [];
    const statuses = [];
    const session = createDepthProfileSession({
      symbol: parseFuturesTradingSymbolFromPathname(route.pathname), source,
      onProfile: (profile) => profiles.push(profile), onStatus: (status) => statuses.push(status),
    });
    session.start();
    const socket = new globalObject.WebSocket('wss://native-binance-stream.example/ws');
    const params = new URLSearchParams({ symbol, limit: '1000' });
    const response = globalObject.fetch(`/fapi/v1/rpiDepth?${params}`);
    socket.message({ stream: `${symbol.toLowerCase()}@rpiDepth@500ms`, data: update({ s: symbol }) });
    await response;
    // When Binance delivers the observed depth event
    await new Promise((resolve) => setImmediate(resolve));

    // Then the encoded symbol has one ready native profile and stops delivering after cleanup
    assert.equal(profiles.length, 1);
    assert.equal(profiles[0].symbol, symbol);
    assert.equal(profiles[0].bids[0].price, 100);
    assert.equal(profiles[0].bids[0].cumulative, 2);
    assert.equal(profiles[0].asks[0].price, 101);
    assert.equal(profiles[0].asks[0].cumulative, 4);
    assert.equal(statuses.at(-1).status, 'ready');
    assert.equal(fetchCalls.length, 1);
    assert.equal(FakeNativeSocket.instances.length, 1);
    session.stop();
    socket.message({ stream: `${symbol.toLowerCase()}@rpiDepth@500ms`, data: update({ s: symbol, U: 103, u: 104, pu: 102 }) });
    assert.equal(profiles.length, 1);
    source.restore();
  });
}

test('user retains native response cloning, JSON failure, and socket event semantics in the transport fixture', async () => {
  // Given a response clone, a JSON failure, and a socket with two event listeners
  const payload = snapshot();
  const jsonError = new SyntaxError('invalid native JSON');
  const response = new FakeResponse(payload, { status: 206 });
  const invalidResponse = new FakeResponse(null, { jsonError });
  const socket = new FakeNativeSocket('wss://fixture.example/ws', ['json']);
  const events = [];
  socket.addEventListener('message', (event) => events.push(['first', event.data]));
  socket.addEventListener('message', (event) => events.push(['second', event.data]));

  // When clones are consumed and the native socket dispatches its message
  const clone = response.clone();
  const clonedPayload = await clone.json();
  const failedJson = invalidResponse.clone().json();
  socket.message({ stream: 'btcusdt@rpiDepth@500ms', data: { u: 42 } });

  // Then cloning preserves response fields and listeners receive the same encoded event
  assert.notEqual(clone, response);
  assert.equal(clonedPayload, payload);
  assert.equal(clone.status, 206);
  await assert.rejects(failedJson, (error) => error === jsonError);
  assert.deepEqual(socket.args, ['wss://fixture.example/ws', ['json']]);
  assert.deepEqual(events, [
    ['first', '{"stream":"btcusdt@rpiDepth@500ms","data":{"u":42}}'],
    ['second', '{"stream":"btcusdt@rpiDepth@500ms","data":{"u":42}}'],
  ]);
});

test('user observes a Request-based native snapshot and waits for its first covering update', { timeout: 2000 }, async () => {
  // Given an active subscription and a native Request object
  const { globalObject, source, fetchCalls } = createHarness();
  const events = recordDepthEvents(source);
  const request = new Request('https://www.binance.com/fapi/v1/rpiDepth?symbol=BTCUSDT&limit=1000');

  // When Binance delivers the snapshot before any covering stream event
  const response = await globalObject.fetch(request);
  await events.waitFor(({ statuses }) => statuses.length === 3);

  // Then the snapshot remains synchronizing without publishing an unconfirmed profile
  assert.equal(response.ok, true);
  assert.equal(fetchCalls[0].args[0], request);
  assert.deepEqual(events.profiles, []);
  assert.equal(source.getState('BTCUSDT').status.status, 'synchronizing');

  // When the native socket supplies the first covering depth event
  const socket = new globalObject.WebSocket('wss://native-binance-stream.example/ws');
  socket.message(rpiMessage());

  // Then exactly one ready profile reflects the stream's absolute quantities
  assert.equal(events.profiles.length, 1);
  assert.equal(events.profiles[0].bids[0].quantity, 2);
  assert.equal(events.statuses.at(-1).status, 'ready');
  source.restore();
});

test('user sees reconnection only for symbols observed on the native socket that closes', { timeout: 2000 }, async () => {
  // Given a synchronized native BTC stream and an unrelated ETH subscription
  const { globalObject, source } = createHarness();
  const bitcoin = recordDepthEvents(source);
  const ether = recordDepthEvents(source, 'ETHUSDT');
  const socket = new globalObject.WebSocket('wss://native-binance-stream.example/ws');
  globalObject.fetch('/fapi/v1/rpiDepth?symbol=BTCUSDT&limit=1000');
  socket.message(rpiMessage());
  await bitcoin.waitFor(({ statuses }) => statuses.at(-1).status === 'ready');

  // When the observed native socket closes
  socket.emit('close');

  // Then BTC requests native reconnection while ETH retains its previous state
  assert.equal(bitcoin.statuses.at(-1).status, 'reconnecting');
  assert.equal(bitcoin.statuses.at(-1).detail, 'Binance native depth socket closed');
  assert.equal(ether.statuses.at(-1).status, 'connecting');
  assert.equal(bitcoin.profiles.length, 1);
  source.restore();
});

for (const { label, response, expected } of [
  { label: 'HTTP rejection', response: new FakeResponse(snapshot(), { ok: false, status: 503 }), expected: 'Binance native RPI depth snapshot HTTP 503' },
  { label: 'JSON rejection', response: new FakeResponse(null, { jsonError: new SyntaxError('native JSON incomplete') }), expected: 'native JSON incomplete' },
  { label: 'malformed depth snapshot', response: new FakeResponse(snapshot({ bids: null })), expected: 'Invalid depth profile snapshot bids' },
]) {
  test(`user sees an explicit native depth failure after ${label}`, { timeout: 2000 }, async () => {
    // Given the native response cannot supply a valid depth snapshot
    const { globalObject, source, fetchCalls } = createHarness(response);
    const events = recordDepthEvents(source);

    // When Binance completes the native snapshot request
    const received = await globalObject.fetch('/fapi/v1/rpiDepth?symbol=BTCUSDT&limit=1000');
    await events.waitFor(({ statuses }) => statuses.at(-1).status === 'failed');

    // Then the original response is preserved and the visualization exposes the specific failure
    assert.equal(received, response);
    assert.equal(fetchCalls.length, 1);
    assert.deepEqual(events.profiles, []);
    assert.equal(source.getState('BTCUSDT').bidCount, 0);
    if (typeof expected === 'string') assert.equal(events.statuses.at(-1).detail, expected);
    else assert.match(events.statuses.at(-1).detail, expected);
    source.restore();
  });
}

test('user retains the original asynchronous native fetch rejection while depth becomes failed', { timeout: 2000 }, async () => {
  // Given the native fetch rejects with its own network error
  const networkError = new TypeError('native transport unavailable');
  const { globalObject, source, fetchCalls } = createHarness(() => Promise.reject(networkError));
  const events = recordDepthEvents(source);

  // When the native snapshot request rejects
  const request = globalObject.fetch('/fapi/v1/rpiDepth?symbol=BTCUSDT&limit=1000');
  await assert.rejects(request, (error) => error === networkError);
  await events.waitFor(({ statuses }) => statuses.at(-1).status === 'failed');

  // Then callers keep the original promise and no synthetic profile is published
  assert.equal(request, fetchCalls[0].result);
  assert.equal(events.statuses.at(-1).detail, 'native transport unavailable');
  assert.deepEqual(events.profiles, []);
  source.restore();
});

test('user retains a synchronous native fetch failure without a retry request', () => {
  // Given native request construction throws before producing a response promise
  const nativeError = new TypeError('native request construction failed');
  const { globalObject, source, fetchCalls } = createHarness(() => { throw nativeError; });
  const events = recordDepthEvents(source);

  // When the observed native request is invoked
  const failure = captureThrownError(() => globalObject.fetch('/fapi/v1/rpiDepth?symbol=BTCUSDT&limit=1000'));

  // Then the exact native error propagates and the source reports failure once
  assert.equal(failure, nativeError);
  assert.equal(fetchCalls.length, 1);
  assert.equal(events.statuses.at(-1).status, 'failed');
  assert.equal(events.statuses.at(-1).detail, nativeError.message);
  source.restore();
});

for (const { label, event } of [
  { label: 'invalid JSON', event: { data: '{@rpiDepth@500ms' } },
  { label: 'uppercase stream name', event: { data: JSON.stringify({ stream: 'BTCUSDT@rpiDepth@500ms', data: update() }) } },
  { label: 'missing stream data', event: { data: JSON.stringify({ stream: 'btcusdt@rpiDepth@500ms', data: null }) } },
  { label: 'trailing stream newline', event: { data: JSON.stringify({ stream: 'btcusdt@rpiDepth@500ms\n', data: update() }) } },
]) {
  test(`user sees a failed depth contract for ${label}`, () => {
    // Given an active native depth subscription receives the malformed envelope
    const { globalObject, source } = createHarness();
    const events = recordDepthEvents(source);
    const socket = new globalObject.WebSocket('wss://native-binance-stream.example/ws');

    // When the socket dispatches the malformed native event
    socket.emit('message', event);

    // Then the failure remains explicit and no partial profile reaches the subscriber
    assert.equal(events.statuses.at(-1).status, 'failed');
    assert.deepEqual(events.profiles, []);
    assert.equal(source.getState('BTCUSDT').askCount, 0);
    source.restore();
  });
}

test('user ignores non-text and unrelated socket events and unsupported request objects', async () => {
  // Given a subscribed source and a native socket carrying other event formats
  const { globalObject, source, fetchCalls } = createHarness();
  const events = recordDepthEvents(source);
  const socket = new globalObject.WebSocket('wss://native-binance-stream.example/ws');

  // When unrelated native traffic is dispatched
  socket.emit('message');
  socket.emit('message', { data: new Uint8Array([1, 2]) });
  socket.message({ stream: 'btcusdt@aggTrade', data: { p: '100' } });
  await globalObject.fetch(new URL('https://www.binance.com/unrelated'));

  // Then the adapter passes the request through and leaves depth discovery unchanged
  assert.equal(fetchCalls.length, 1);
  assert.deepEqual(events.statuses, [{ symbol: 'BTCUSDT', status: 'connecting', detail: '' }]);
  assert.deepEqual(events.profiles, []);
  assert.equal(source.getState('ETHUSDT'), null);
  source.restore();
});

test('user rejects depth updates for a different symbol without publishing their quantities', () => {
  // Given the subscribed stream claims BTC while the event payload belongs to ETH
  const { globalObject, source } = createHarness();
  const events = recordDepthEvents(source);
  const socket = new globalObject.WebSocket('wss://native-binance-stream.example/ws');

  // When the inconsistent native depth message arrives
  socket.message(rpiMessage(update({ s: 'ETHUSDT' })));

  // Then the current symbol fails explicitly without exposing another contract's book
  assert.equal(events.statuses.at(-1).status, 'failed');
  assert.match(events.statuses.at(-1).detail, /symbol/);
  assert.deepEqual(events.profiles, []);
  source.restore();
});

test('user releases unsubscribed symbol state when the next native snapshot starts', { timeout: 2000 }, async () => {
  // Given BTC no longer has a subscriber and ETH becomes the active native snapshot
  const { globalObject, source } = createHarness();
  const bitcoin = recordDepthEvents(source);
  const ether = recordDepthEvents(source, 'ETHUSDT');
  bitcoin.unsubscribe();

  // When the next symbol synchronizes from its own native snapshot and stream
  globalObject.fetch('/fapi/v1/rpiDepth?symbol=ETHUSDT&limit=1000');
  const socket = new globalObject.WebSocket('wss://native-binance-stream.example/ws');
  socket.message({ stream: 'ethusdt@rpiDepth@500ms', data: update({ s: 'ETHUSDT' }) });
  await ether.waitFor(({ statuses }) => statuses.at(-1).status === 'ready');

  // Then only the subscribed symbol retains a ready profile
  assert.equal(source.getState('BTCUSDT'), null);
  assert.equal(source.getState('ETHUSDT').status.status, 'ready');
  assert.equal(ether.profiles[0].symbol, 'ETHUSDT');
  assert.deepEqual(bitcoin.profiles, []);
  source.restore();
});

test('user keeps later native transport owners when the depth source is restored twice', () => {
  // Given another page owner has replaced both instrumented transports
  const { globalObject, source } = createHarness();
  const nextFetch = () => Promise.resolve(new FakeResponse(snapshot()));
  class NextSocket extends FakeNativeSocket {}
  globalObject.fetch = nextFetch;
  globalObject.WebSocket = NextSocket;

  // When the old depth observation is restored and restoration repeats
  source.restore();
  source.restore();
  const failure = captureThrownError(() => source.subscribe({
    symbol: 'BTCUSDT', onProfile() {}, onStatus() {},
  }));

  // Then the later owner remains installed and a stopped source rejects new subscriptions
  assert.equal(globalObject.fetch, nextFetch);
  assert.equal(globalObject.WebSocket, NextSocket);
  assert.equal(failure.message, 'Binance native depth source has been restored');
});

test('user receives no later profile or reconnect event after source restoration', { timeout: 2000 }, async () => {
  // Given a native snapshot request is pending while a socket already has a BTC update
  const pendingResponse = Promise.withResolvers();
  const { globalObject, source } = createHarness(() => pendingResponse.promise);
  const events = recordDepthEvents(source);
  const socket = new globalObject.WebSocket('wss://native-binance-stream.example/ws');
  const request = globalObject.fetch('/fapi/v1/rpiDepth?symbol=BTCUSDT&limit=1000');
  socket.message(rpiMessage());
  const recordedStatuses = events.statuses.length;

  // When the source is restored before the native response and socket close arrive
  source.restore();
  pendingResponse.resolve(new FakeResponse(snapshot()));
  await request;
  socket.message(rpiMessage(update({ U: 103, u: 104, pu: 102 })));
  socket.emit('close');
  await new Promise((resolve) => setImmediate(resolve));

  // Then old transport events cannot revive the stopped visualization
  assert.equal(source.getState('BTCUSDT'), null);
  assert.equal(events.statuses.length, recordedStatuses);
  assert.deepEqual(events.profiles, []);
});

for (const { label, settlement, resultField, expectedStatus, nativeResult } of [
  {
    label: 'successful snapshot', settlement: 'resolve', resultField: 'value', expectedStatus: 'fulfilled',
    nativeResult: new FakeResponse(snapshot()),
  },
  {
    label: 'HTTP failure', settlement: 'resolve', resultField: 'value', expectedStatus: 'fulfilled',
    nativeResult: new FakeResponse(snapshot(), { ok: false, status: 503 }),
  },
  {
    label: 'JSON failure', settlement: 'resolve', resultField: 'value', expectedStatus: 'fulfilled',
    nativeResult: new FakeResponse(null, { jsonError: new SyntaxError('late native JSON failure') }),
  },
  {
    label: 'network rejection', settlement: 'reject', resultField: 'reason', expectedStatus: 'rejected',
    nativeResult: new TypeError('late native network rejection'),
  },
]) {
  test(`user keeps a restored source empty when a pending native request completes with ${label}`, async () => {
    // Given a native snapshot is pending while the depth subscriber is active
    const pendingResponse = Promise.withResolvers();
    const { globalObject, source, fetchCalls } = createHarness(() => pendingResponse.promise);
    const events = recordDepthEvents(source);
    const request = globalObject.fetch('/fapi/v1/rpiDepth?symbol=BTCUSDT&limit=1000');
    const statusesBeforeRestore = [...events.statuses];

    // When the source is restored before the original native promise settles
    source.restore();
    pendingResponse[settlement](nativeResult);
    const [result] = await Promise.allSettled([request]);
    await new Promise((resolve) => setImmediate(resolve));

    // Then callers retain native results and late observation cannot revive source state
    assert.equal(request, pendingResponse.promise);
    assert.equal(request, fetchCalls[0].result);
    assert.equal(fetchCalls.length, 1);
    assert.equal(result.status, expectedStatus);
    assert.equal(result[resultField], nativeResult);
    assert.equal(source.getState('BTCUSDT'), null);
    assert.deepEqual(events.statuses, statusesBeforeRestore);
    assert.deepEqual(events.profiles, []);
  });
}

for (const { label, limit, rejects } of [
  { label: 'successful response', limit: '1000', rejects: false },
  { label: 'native promise rejection', limit: '1000', rejects: true },
  { label: 'changed snapshot limit', limit: '500', rejects: false },
]) {
  test(`user invokes a cached fetch after restoration with ${label} and no depth observation`, async () => {
    // Given page code cached the wrapper before its source was restored
    const response = new FakeResponse(snapshot());
    const nativeError = new TypeError('cached native fetch rejection');
    const { globalObject, source, fetchCalls } = createHarness(
      () => rejects ? Promise.reject(nativeError) : response,
    );
    const cachedFetch = globalObject.fetch;
    const events = recordDepthEvents(source);
    const statusesBeforeRestore = [...events.statuses];
    source.restore();
    const receiver = { name: 'native request owner' };
    const request = new Request(`https://www.binance.com/fapi/v1/rpiDepth?symbol=BTCUSDT&limit=${limit}`);
    const options = { cache: 'no-store' };

    // When page code invokes its cached fetch with the original receiver and arguments
    const nativePromise = Reflect.apply(cachedFetch, receiver, [request, options]);
    const [result] = await Promise.allSettled([nativePromise]);
    await new Promise((resolve) => setImmediate(resolve));

    // Then the wrapper only delegates once and preserves the native promise and outcome
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].receiver, receiver);
    assert.equal(fetchCalls[0].args[0], request);
    assert.equal(fetchCalls[0].args[1], options);
    assert.equal(nativePromise, fetchCalls[0].result);
    assert.equal(result.status, rejects ? 'rejected' : 'fulfilled');
    assert.equal(result[rejects ? 'reason' : 'value'], rejects ? nativeError : response);
    assert.equal(source.getState('BTCUSDT'), null);
    assert.deepEqual(events.statuses, statusesBeforeRestore);
    assert.deepEqual(events.profiles, []);
  });
}

test('user retains a synchronous cached fetch failure after restoration without reviving depth state', () => {
  // Given the cached wrapper's native host throws during request construction
  const nativeError = new TypeError('restored native request construction failed');
  const { globalObject, source, fetchCalls } = createHarness(() => { throw nativeError; });
  const cachedFetch = globalObject.fetch;
  const events = recordDepthEvents(source);
  const statusesBeforeRestore = [...events.statuses];
  source.restore();
  const receiver = { name: 'cached request owner' };
  const input = '/fapi/v1/rpiDepth?symbol=BTCUSDT&limit=1000';
  const options = { cache: 'no-store' };

  // When page code calls its cached wrapper after restoration
  const failure = captureThrownError(() => Reflect.apply(cachedFetch, receiver, [input, options]));

  // Then the host error propagates unchanged and no observer record is recreated
  assert.equal(failure, nativeError);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].receiver, receiver);
  assert.equal(fetchCalls[0].args[0], input);
  assert.equal(fetchCalls[0].args[1], options);
  assert.equal(fetchCalls[0].result, null);
  assert.equal(source.getState('BTCUSDT'), null);
  assert.deepEqual(events.statuses, statusesBeforeRestore);
  assert.deepEqual(events.profiles, []);
});

test('user cannot recreate a depth record by subscribing after source restoration', () => {
  // Given restoration cleared a source that previously had an active subscriber
  const { source } = createHarness();
  const events = recordDepthEvents(source);
  const statusesBeforeRestore = [...events.statuses];
  source.restore();
  const laterProfiles = [];
  const laterStatuses = [];

  // When another consumer tries to subscribe to the restored source
  const failure = captureThrownError(() => source.subscribe({
    symbol: 'BTCUSDT',
    onProfile: (profile) => laterProfiles.push(profile),
    onStatus: (status) => laterStatuses.push(status),
  }));

  // Then the explicit lifecycle error leaves every source record and notification empty
  assert.equal(failure.message, 'Binance native depth source has been restored');
  assert.equal(source.getState('BTCUSDT'), null);
  assert.deepEqual(events.statuses, statusesBeforeRestore);
  assert.deepEqual(events.profiles, []);
  assert.deepEqual(laterStatuses, []);
  assert.deepEqual(laterProfiles, []);
});

test('user constructs native sockets through a cached constructor after restoration without observers', () => {
  // Given page code cached the wrapped constructor before observation was restored
  const { globalObject, source } = createHarness();
  const CachedWebSocket = globalObject.WebSocket;
  const events = recordDepthEvents(source);
  const statusesBeforeRestore = [...events.statuses];
  source.restore();
  const socketUrl = 'wss://native-binance-stream.example/ws';
  const protocols = ['json'];

  // When the cached constructor creates the next page-owned native socket
  const socket = new CachedWebSocket(socketUrl, protocols);

  // Then the original instance and arguments survive without adding depth listeners
  assert.equal(socket, FakeNativeSocket.instances[0]);
  assert.equal(FakeNativeSocket.instances.length, 1);
  assert.equal(socket instanceof FakeNativeSocket, true);
  assert.equal(socket instanceof CachedWebSocket, true);
  assert.equal(socket.constructor, FakeNativeSocket);
  assert.deepEqual(socket.args, [socketUrl, protocols]);
  assert.equal(socket.args[1], protocols);
  assert.equal(socket.listeners.size, 0);
  assert.equal(source.getState('BTCUSDT'), null);
  assert.deepEqual(events.statuses, statusesBeforeRestore);
  assert.deepEqual(events.profiles, []);
});
