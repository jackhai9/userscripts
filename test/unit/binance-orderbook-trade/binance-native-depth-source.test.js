import test from 'node:test';
import assert from 'node:assert/strict';

import { installBinanceNativeDepthSource } from '../../../src/binance-orderbook-trade/core/binance-native-depth-source.js';

class FakeResponse {
  constructor(payload, { ok = true, status = 200 } = {}) {
    this.payload = payload;
    this.ok = ok;
    this.status = status;
  }

  clone() {
    return new FakeResponse(this.payload, { ok: this.ok, status: this.status });
  }

  async json() {
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
    const result = Promise.resolve(typeof response === 'function' ? response() : response);
    fetchCalls.push({ receiver: this, args, result });
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

test('observes the native RPI snapshot and stream without creating another socket', async () => {
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
  await new Promise((resolve) => setImmediate(resolve));

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

test('retains distant active prices delivered after the 1000-level native snapshot', async () => {
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
  nativeSocket.message(rpiMessage(update({
    U: 103,
    u: 104,
    pu: 102,
    b: [['50', '7']],
    a: [['150', '8']],
  })));

  const profile = profiles.at(-1);
  assert.equal(profile.bids.length, 1002);
  assert.equal(profile.asks.length, 1002);
  assert.equal(profile.bids.at(-1).price, 50);
  assert.equal(profile.asks.at(-1).price, 150);
  source.restore();
});

test('preserves native fetch, WebSocket prototype, instanceof, and static constants', async () => {
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
  await fetchResult;
  const socket = new WrappedWebSocket('wss://native-binance-stream.example/ws', ['json']);

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

test('reports a changed native snapshot contract without blocking the Binance fetch', async () => {
  const { fetchCalls, globalObject, source } = createHarness();
  const statuses = [];
  source.subscribe({
    symbol: 'BTCUSDT',
    onProfile: () => {},
    onStatus: (status) => statuses.push(status),
  });

  const response = await globalObject.fetch('/fapi/v1/rpiDepth?symbol=BTCUSDT&limit=500');

  assert.equal(response.ok, true);
  assert.equal(fetchCalls.length, 1);
  assert.equal(statuses.at(-1).status, 'failed');
  assert.match(statuses.at(-1).detail, /snapshot limit/);
  source.restore();
});

test('does not block a malformed native snapshot request', async () => {
  const { fetchCalls, globalObject, source } = createHarness();
  const statuses = [];
  source.subscribe({
    symbol: 'BTCUSDT',
    onProfile: () => {},
    onStatus: (status) => statuses.push(status),
  });

  const response = await globalObject.fetch('/fapi/v1/rpiDepth?limit=1000');

  assert.equal(response.ok, true);
  assert.equal(fetchCalls.length, 1);
  assert.equal(statuses.at(-1).status, 'failed');
  assert.match(statuses.at(-1).detail, /symbol/);
  source.restore();
});

test('keeps the latest native profile for subscribers that start after page initialization', async () => {
  const { globalObject, source } = createHarness();
  const nativeSocket = new globalObject.WebSocket('wss://native-binance-stream.example/ws');
  const responsePromise = globalObject.fetch('/fapi/v1/rpiDepth?symbol=BTCUSDT&limit=1000');
  nativeSocket.message(rpiMessage());
  await responsePromise;
  await new Promise((resolve) => setImmediate(resolve));

  const profiles = [];
  const statuses = [];
  source.subscribe({
    symbol: 'BTCUSDT',
    onProfile: (profile) => profiles.push(profile),
    onStatus: (status) => statuses.push(status),
  });

  assert.equal(profiles.length, 1, JSON.stringify({ statuses, state: source.getState('BTCUSDT') }));
  assert.equal(profiles[0].symbol, 'BTCUSDT');
  assert.equal(statuses.at(-1).status, 'ready');
  source.restore();
});

test('ignores unrelated native fetches and WebSocket streams', async () => {
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
  await Promise.resolve();

  assert.equal(profiles.length, 0);
  source.restore();
});

test('waits for Binance native resynchronization after a sequence gap', async () => {
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
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(profiles.length, 1, JSON.stringify({ statuses, state: source.getState('BTCUSDT') }));

  nativeSocket.message(rpiMessage(update({ U: 105, u: 106, pu: 104 })));
  assert.equal(statuses.at(-1).status, 'resyncing');

  nativeSocket.message(rpiMessage(update({ U: 106, u: 107, pu: 106 })));
  assert.equal(profiles.length, 1);
  source.restore();
});

test('recovers when Binance performs its next native snapshot synchronization', async () => {
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
  nativeSocket.message(rpiMessage(update({ U: 105, u: 106, pu: 104 })));
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
