import test from 'node:test';
import assert from 'node:assert/strict';

import { createDepthProfileSession } from '../../../src/binance-orderbook-trade/core/depth-profile-session.js';

class FakeSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.listeners = new Map();
    FakeSocket.instances.push(this);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }

  open() {
    this.readyState = 1;
    this.emit('open');
  }

  message(payload) {
    this.emit('message', { data: JSON.stringify(payload) });
  }

  close() {
    if (this.readyState >= 2) return;
    this.readyState = 3;
    this.emit('close');
  }
}

function depthUpdate(overrides = {}) {
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

function depthSnapshot(overrides = {}) {
  return {
    lastUpdateId: 101,
    bids: [['100', '1'], ['99', '2']],
    asks: [['101', '3'], ['102', '4']],
    ...overrides,
  };
}

function createTimerHarness() {
  const timers = [];
  return {
    timers,
    setTimer(callback, delay) {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer(timer) {
      timer.cleared = true;
    },
  };
}

test('opens the official public stream, synchronizes a snapshot, and emits a profile', async () => {
  FakeSocket.instances = [];
  const statuses = [];
  const profiles = [];
  const timer = createTimerHarness();
  const fetchCalls = [];
  const session = createDepthProfileSession({
    symbol: 'BTCUSDT',
    WebSocketCtor: FakeSocket,
    fetchFn: async (url) => {
      fetchCalls.push(url);
      return { ok: true, json: async () => depthSnapshot() };
    },
    onProfile: (profile) => profiles.push(profile),
    onStatus: (status) => statuses.push(status),
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
  });

  session.start();
  const socket = FakeSocket.instances[0];
  assert.equal(socket.url, 'wss://fstream.binance.com/public/ws/btcusdt@depth@100ms');
  socket.message(depthUpdate());
  socket.open();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(fetchCalls[0], 'https://fapi.binance.com/fapi/v1/depth?symbol=BTCUSDT&limit=1000');
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].symbol, 'BTCUSDT');
  assert.equal(statuses.at(-1).status, 'ready');

  session.stop();
  assert.equal(socket.readyState, 3);
  assert.equal(session.isActive(), false);
});

test('stopped sessions ignore a late snapshot', async () => {
  FakeSocket.instances = [];
  let resolveSnapshot;
  const profiles = [];
  const session = createDepthProfileSession({
    symbol: 'BTCUSDT',
    WebSocketCtor: FakeSocket,
    fetchFn: () => new Promise((resolve) => { resolveSnapshot = resolve; }),
    onProfile: (profile) => profiles.push(profile),
    onStatus: () => {},
  });

  session.start();
  const socket = FakeSocket.instances[0];
  socket.message(depthUpdate());
  socket.open();
  session.stop();
  resolveSnapshot({ ok: true, json: async () => depthSnapshot() });
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(profiles.length, 0);
});

test('a sequence gap resets the book and performs one delayed resync', async () => {
  FakeSocket.instances = [];
  const statuses = [];
  const profiles = [];
  const timer = createTimerHarness();
  let snapshotCount = 0;
  const session = createDepthProfileSession({
    symbol: 'BTCUSDT',
    WebSocketCtor: FakeSocket,
    fetchFn: async () => {
      snapshotCount += 1;
      return { ok: true, json: async () => depthSnapshot() };
    },
    onProfile: (profile) => profiles.push(profile),
    onStatus: (status) => statuses.push(status),
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
  });

  session.start();
  const socket = FakeSocket.instances[0];
  socket.message(depthUpdate());
  socket.open();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(profiles.length, 1);

  socket.message(depthUpdate({ U: 105, u: 106, pu: 104 }));
  assert.equal(statuses.at(-1).status, 'resyncing');
  assert.equal(timer.timers.at(-1).delay, 1000);

  socket.message(depthUpdate({ U: 100, u: 103, pu: 99 }));
  timer.timers.at(-1).callback();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(snapshotCount, 2);
  assert.equal(profiles.length, 2);
  assert.equal(statuses.at(-1).status, 'ready');
  session.stop();
});

test('unexpected close uses bounded reconnect scheduling', () => {
  FakeSocket.instances = [];
  const statuses = [];
  const timer = createTimerHarness();
  const session = createDepthProfileSession({
    symbol: 'BTCUSDT',
    WebSocketCtor: FakeSocket,
    fetchFn: async () => ({ ok: true, json: async () => depthSnapshot() }),
    onProfile: () => {},
    onStatus: (status) => statuses.push(status),
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
  });

  session.start();
  FakeSocket.instances[0].close();

  assert.equal(statuses.at(-1).status, 'reconnecting');
  assert.equal(timer.timers.at(-1).delay, 1000);
  session.stop();
  assert.equal(timer.timers.at(-1).cleared, true);
});
