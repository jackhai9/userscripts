import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyDepthProfileSnapshot,
  buildDepthProfile,
  createDepthProfileBook,
  DepthProfileSequenceError,
  pushDepthProfileUpdate,
} from '../../../src/binance-orderbook-trade/core/depth-profile-book.js';

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

function snapshot(overrides = {}) {
  return {
    lastUpdateId: 101,
    bids: [['100', '1'], ['99', '2']],
    asks: [['101', '3'], ['102', '4']],
    ...overrides,
  };
}

test('buffers updates until a snapshot and applies the first covering event', () => {
  const book = createDepthProfileBook('BTCUSDT');
  assert.equal(pushDepthProfileUpdate(book, update()), false);
  assert.equal(applyDepthProfileSnapshot(book, snapshot()), true);

  assert.equal(book.ready, true);
  assert.equal(book.previousFinalUpdateId, 102);
  assert.equal(book.bids.get('100'), '2');
  assert.equal(book.asks.get('101'), '4');
});

test('drops stale buffered updates before the first snapshot-covering event', () => {
  const book = createDepthProfileBook('BTCUSDT');
  pushDepthProfileUpdate(book, update({ U: 90, u: 95, pu: 89 }));
  pushDepthProfileUpdate(book, update({ U: 99, u: 103, pu: 95 }));

  assert.equal(applyDepthProfileSnapshot(book, snapshot({ lastUpdateId: 100 })), true);
  assert.equal(book.previousFinalUpdateId, 103);
});

test('applies absolute quantities and removes zero-quantity levels', () => {
  const book = createDepthProfileBook('BTCUSDT');
  pushDepthProfileUpdate(book, update());
  applyDepthProfileSnapshot(book, snapshot());

  pushDepthProfileUpdate(book, update({
    U: 103,
    u: 104,
    pu: 102,
    b: [['100', '0'], ['98', '7']],
    a: [['101', '8']],
  }));

  assert.equal(book.bids.has('100'), false);
  assert.equal(book.bids.get('98'), '7');
  assert.equal(book.asks.get('101'), '8');
});

test('rejects a sequence gap after synchronization', () => {
  const book = createDepthProfileBook('BTCUSDT');
  pushDepthProfileUpdate(book, update());
  applyDepthProfileSnapshot(book, snapshot());

  assert.throws(
    () => pushDepthProfileUpdate(book, update({ U: 105, u: 106, pu: 104 })),
    DepthProfileSequenceError,
  );
});

test('rejects a snapshot that cannot connect to buffered updates', () => {
  const book = createDepthProfileBook('BTCUSDT');
  pushDepthProfileUpdate(book, update({ U: 110, u: 112, pu: 109 }));

  assert.throws(
    () => applyDepthProfileSnapshot(book, snapshot({ lastUpdateId: 100 })),
    /Depth snapshot gap/,
  );
});

test('rejects data for another symbol or a non-USD-M contract', () => {
  const book = createDepthProfileBook('BTCUSDT');
  assert.throws(
    () => pushDepthProfileUpdate(book, update({ s: 'ETHUSDT' })),
    /symbol mismatch/,
  );
  assert.throws(
    () => pushDepthProfileUpdate(book, update({ st: 2 })),
    /non-USD-M data/,
  );
});

test('builds a symmetric vertical price range with cumulative depth', () => {
  const book = createDepthProfileBook('BTCUSDT');
  pushDepthProfileUpdate(book, update({
    b: [['100', '2'], ['99', '3'], ['98', '5']],
    a: [['101', '4'], ['102', '6'], ['103', '10']],
  }));
  applyDepthProfileSnapshot(book, snapshot());

  const profile = buildDepthProfile(book);

  assert.equal(profile.midPrice, 100.5);
  assert.equal(profile.minPrice, 98);
  assert.equal(profile.maxPrice, 103);
  assert.deepEqual(profile.bids.map((level) => level.cumulative), [2, 5, 10]);
  assert.deepEqual(profile.asks.map((level) => level.cumulative), [4, 10, 20]);
  assert.equal(profile.maxCumulative, 20);
});

test('preserves every active price level accumulated from the native depth stream', () => {
  const book = createDepthProfileBook('BTCUSDT');
  book.ready = true;
  for (let index = 0; index < 1001; index += 1) {
    book.bids.set(String(100 - index / 1000), '1');
    book.asks.set(String(101 + index / 1000), '1');
  }

  const profile = buildDepthProfile(book);

  assert.equal(profile.bids.length, 1001);
  assert.equal(profile.asks.length, 1001);
  assert.equal(profile.bids.at(-1).price, 99);
  assert.equal(profile.asks.at(-1).price, 102);
  assert.equal(profile.bids.at(-1).cumulative, 1001);
  assert.equal(profile.asks.at(-1).cumulative, 1001);
});
