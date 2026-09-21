import { captureThrownError } from '../../helpers/orderbook-migration-errors.js';
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

test("user buffers updates until a snapshot and applies the first covering event", () => {
  // Given the symbol book and native depth messages are available
  const book = createDepthProfileBook('BTCUSDT');
  // When the snapshot or stream update is processed
  const observed = pushDepthProfileUpdate(book, update());
  const synchronized = applyDepthProfileSnapshot(book, snapshot());

  // Then buffers updates until a snapshot and applies the first covering event
  assert.equal(observed, false);
  assert.equal(synchronized, true);

  assert.equal(book.ready, true);
  assert.equal(book.previousFinalUpdateId, 102);
  assert.equal(book.bids.get('100'), '2');
  assert.equal(book.asks.get('101'), '4');
});

test("user drops stale buffered updates before the first snapshot-covering event", () => {
  // Given the symbol book and native depth messages are available
  const book = createDepthProfileBook('BTCUSDT');
  pushDepthProfileUpdate(book, update({ U: 90, u: 95, pu: 89 }));
  // When the snapshot or stream update is processed
  pushDepthProfileUpdate(book, update({ U: 99, u: 103, pu: 95 }));
  const synchronized = applyDepthProfileSnapshot(book, snapshot({ lastUpdateId: 100 }));

  // Then drops stale buffered updates before the first snapshot-covering event
  assert.equal(synchronized, true);
  assert.equal(book.previousFinalUpdateId, 103);
});

test("user applies absolute quantities and removes zero-quantity levels", () => {
  // Given the symbol book and native depth messages are available
  const book = createDepthProfileBook('BTCUSDT');
  pushDepthProfileUpdate(book, update());
  applyDepthProfileSnapshot(book, snapshot());

  // When the snapshot or stream update is processed
  pushDepthProfileUpdate(book, update({
    U: 103,
    u: 104,
    pu: 102,
    b: [['100', '0'], ['98', '7']],
    a: [['101', '8']],
  }));

  // Then applies absolute quantities and removes zero-quantity levels
  assert.equal(book.bids.has('100'), false);
  assert.equal(book.bids.get('98'), '7');
  assert.equal(book.asks.get('101'), '8');
});

test("user rejects a sequence gap after synchronization", () => {
  // Given the symbol book and native depth messages are available
  const book = createDepthProfileBook('BTCUSDT');
  pushDepthProfileUpdate(book, update());
  applyDepthProfileSnapshot(book, snapshot());

  // When the next stream event skips the synchronized sequence
  const failure = captureThrownError(() => pushDepthProfileUpdate(book, update({ U: 105, u: 106, pu: 104 })));

  // Then rejects a sequence gap after synchronization
  assert.equal(failure instanceof DepthProfileSequenceError, true);
  assert.equal(failure.message, 'Depth update sequence gap: expected pu 102, received 104');
});

test("user rejects a snapshot that cannot connect to buffered updates", () => {
  // Given the symbol book and native depth messages are available
  const book = createDepthProfileBook('BTCUSDT');
  pushDepthProfileUpdate(book, update({ U: 110, u: 112, pu: 109 }));

  // When the native snapshot cannot cover the earliest buffered event
  const failure = captureThrownError(() => applyDepthProfileSnapshot(book, snapshot({ lastUpdateId: 100 })));

  // Then rejects a snapshot that cannot connect to buffered updates
  assert.equal(failure instanceof DepthProfileSequenceError, true);
  assert.equal(failure.message, 'Depth snapshot gap: snapshot 100, first update 110');
});

test("user rejects data for another symbol or a non-USD-M contract", () => {
  // Given the symbol book and native depth messages are available
  const book = createDepthProfileBook('BTCUSDT');
  // When the snapshot or stream update is processed
  const observedFailure = captureThrownError(() => pushDepthProfileUpdate(book, update({ s: 'ETHUSDT' })));
  const marketFailure = captureThrownError(() => pushDepthProfileUpdate(book, update({ st: 2 })));

  // Then rejects data for another symbol or a non-USD-M contract
  assert.match(observedFailure.message, /symbol mismatch/);
  assert.equal(marketFailure.message, 'Depth profile received non-USD-M data: 2');
});

test("user builds a symmetric vertical price range with cumulative depth", () => {
  // Given the symbol book and native depth messages are available
  const book = createDepthProfileBook('BTCUSDT');
  pushDepthProfileUpdate(book, update({
    b: [['100', '2'], ['99', '3'], ['98', '5']],
    a: [['101', '4'], ['102', '6'], ['103', '10']],
  }));
  applyDepthProfileSnapshot(book, snapshot());

  // When the snapshot or stream update is processed
  const profile = buildDepthProfile(book);

  // Then builds a symmetric vertical price range with cumulative depth
  assert.equal(profile.midPrice, 100.5);
  assert.equal(profile.minPrice, 98);
  assert.equal(profile.maxPrice, 103);
  assert.deepEqual(profile.bids.map((level) => level.cumulative), [2, 5, 10]);
  assert.deepEqual(profile.asks.map((level) => level.cumulative), [4, 10, 20]);
  assert.equal(profile.maxCumulative, 20);
});

test("user preserves every active price level accumulated from the native depth stream", () => {
  // Given the symbol book and native depth messages are available
  const book = createDepthProfileBook('BTCUSDT');
  applyDepthProfileSnapshot(book, snapshot({
    bids: Array.from({ length: 1001 }, (_, index) => [String(100 - index / 1000), '1']),
    asks: Array.from({ length: 1001 }, (_, index) => [String(101 + index / 1000), '1']),
  }));
  pushDepthProfileUpdate(book, update({ b: [], a: [] }));

  // When the snapshot or stream update is processed
  const profile = buildDepthProfile(book);

  // Then preserves every active price level accumulated from the native depth stream
  assert.equal(profile.bids.length, 1001);
  assert.equal(profile.asks.length, 1001);
  assert.equal(profile.bids.at(-1).price, 99);
  assert.equal(profile.asks.at(-1).price, 102);
  assert.equal(profile.bids.at(-1).cumulative, 1001);
  assert.equal(profile.asks.at(-1).cumulative, 1001);
});

for (const symbol of ['龙虾USDT', '币安人生USDT', '4USDT', '1INCHUSDT', '1000龙虾USDT']) {
  test(`user synchronizes ${symbol} without changing quantity or sequence semantics`, () => {
    // Given the symbol book and native depth messages are available
    const book = createDepthProfileBook(symbol);
    // When the snapshot or stream update is processed
    const observed = pushDepthProfileUpdate(book, update({ s: symbol }));
    const synchronized = applyDepthProfileSnapshot(book, snapshot());
    const profile = buildDepthProfile(book);

    // Then the exact symbol keeps its quantities and sequence ownership
    assert.equal(observed, false);
    assert.equal(synchronized, true);
    assert.equal(profile.symbol, symbol);
    assert.deepEqual(profile.bids.map(({ price, cumulative }) => ({ price, cumulative })), [
      { price: 100, cumulative: 2 }, { price: 99, cumulative: 5 },
    ]);
    assert.deepEqual(profile.asks.map(({ price, cumulative }) => ({ price, cumulative })), [
      { price: 101, cumulative: 4 }, { price: 102, cumulative: 9 },
    ]);
    assert.throws(() => pushDepthProfileUpdate(book, update({ s: `其他${symbol}` })), /symbol mismatch/);
    assert.throws(() => pushDepthProfileUpdate(book, update({ s: symbol, U: 105, u: 106, pu: 104 })), DepthProfileSequenceError);
  });
}

test('user synchronizes a snapshot that arrives before its first covering stream event', () => {
  // Given a fresh symbol book receives its snapshot before the WebSocket update
  const book = createDepthProfileBook('BTCUSDT');
  const snapshotReady = applyDepthProfileSnapshot(book, snapshot());

  // When the first stream event covers the snapshot update id
  const updateReady = pushDepthProfileUpdate(book, update({ st: undefined }));
  const profile = buildDepthProfile(book);

  // Then the snapshot waits for synchronization and the covering event establishes exact quantities
  assert.equal(snapshotReady, false);
  assert.equal(updateReady, true);
  assert.equal(book.previousFinalUpdateId, 102);
  assert.equal(profile.bids[0].quantity, 2);
  assert.equal(profile.asks[0].quantity, 4);
});

test('user synchronizes a buffered RPI update from its snapshot predecessor', () => {
  // Given the first buffered RPI event names the coming snapshot as its predecessor
  const book = createDepthProfileBook('BTCUSDT');
  pushDepthProfileUpdate(book, update({
    U: 103,
    u: 104,
    pu: 101,
    b: [['100', '7']],
    a: [['101', '8']],
  }));

  // When the snapshot arrives behind that event's first update id
  const ready = applyDepthProfileSnapshot(book, snapshot());
  const profile = buildDepthProfile(book);

  // Then the predecessor bridge synchronizes the exact event quantities
  assert.equal(ready, true);
  assert.equal(book.previousFinalUpdateId, 104);
  assert.deepEqual(book.bufferedUpdates, []);
  assert.equal(profile.bids[0].quantity, 7);
  assert.equal(profile.asks[0].quantity, 8);
});

test('user keeps strict update sequencing after an RPI snapshot predecessor bridge', () => {
  // Given the snapshot arrives before an RPI event that directly follows it
  const book = createDepthProfileBook('BTCUSDT');
  const snapshotReady = applyDepthProfileSnapshot(book, snapshot());

  // When the first event advances beyond the snapshot while naming it as the predecessor
  const bridgeReady = pushDepthProfileUpdate(book, update({ U: 103, u: 104, pu: 101 }));

  // Then the snapshot waits and the direct predecessor bridge becomes ready
  assert.equal(snapshotReady, false);
  assert.equal(bridgeReady, true);
  assert.equal(book.previousFinalUpdateId, 104);

  // When a consecutive event names the bridged final update id
  const nextReady = pushDepthProfileUpdate(book, update({ U: 105, u: 106, pu: 104 }));

  // Then the synchronized sequence advances normally
  assert.equal(nextReady, true);
  assert.equal(book.previousFinalUpdateId, 106);

  // When a later new event skips that synchronized predecessor
  const failure = captureThrownError(() => pushDepthProfileUpdate(
    book,
    update({ U: 107, u: 108, pu: 107 }),
  ));

  // Then the ordinary strict predecessor guard still rejects the gap
  assert.equal(failure instanceof DepthProfileSequenceError, true);
  assert.equal(failure.message, 'Depth update sequence gap: expected pu 106, received 107');
});

test('user drains consecutive buffered events while ignoring a duplicate final update', () => {
  // Given the native stream queued a covering event, its duplicate, and the next update
  const book = createDepthProfileBook('BTCUSDT');
  pushDepthProfileUpdate(book, update());
  pushDepthProfileUpdate(book, update({ U: 100, u: 102, pu: 99, b: [['100', '90']] }));
  pushDepthProfileUpdate(book, update({ U: 103, u: 104, pu: 102, b: [['100', '7']], a: [['101', '8']] }));

  // When the snapshot connects the buffered sequence
  const ready = applyDepthProfileSnapshot(book, snapshot());
  const profile = buildDepthProfile(book);

  // Then the final event owns the quantities and no buffered messages remain
  assert.equal(ready, true);
  assert.equal(book.previousFinalUpdateId, 104);
  assert.deepEqual(book.bufferedUpdates, []);
  assert.equal(profile.bids[0].quantity, 7);
  assert.equal(profile.asks[0].quantity, 8);
});

test('user discards an entirely stale buffer while waiting for a current covering event', () => {
  // Given the native stream only buffered an event older than the coming snapshot
  const book = createDepthProfileBook('BTCUSDT');
  pushDepthProfileUpdate(book, update({ U: 90, u: 95, pu: 89 }));

  // When the newer snapshot arrives without a covering update
  const ready = applyDepthProfileSnapshot(book, snapshot());
  const failure = captureThrownError(() => buildDepthProfile(book));

  // Then stale events are discarded and the unconfirmed snapshot cannot be displayed
  assert.equal(ready, false);
  assert.deepEqual(book.bufferedUpdates, []);
  assert.equal(book.previousFinalUpdateId, null);
  assert.equal(failure.message, 'Depth profile book is not ready');
});

test('user ignores a stale update after synchronization without replacing current quantities', () => {
  // Given the book already synchronized through update 102
  const book = createDepthProfileBook('BTCUSDT');
  applyDepthProfileSnapshot(book, snapshot());
  pushDepthProfileUpdate(book, update());

  // When a duplicate final update carries obsolete quantities and a stale predecessor
  const ready = pushDepthProfileUpdate(book, update({ pu: 1, b: [['100', '90']], a: [['101', '91']] }));
  const profile = buildDepthProfile(book);

  // Then the synchronized id and exact quantities stay unchanged
  assert.equal(ready, true);
  assert.equal(book.previousFinalUpdateId, 102);
  assert.equal(profile.bids[0].quantity, 2);
  assert.equal(profile.asks[0].quantity, 4);
});

test('user receives a sequence error when the native update buffer exceeds 500 events', () => {
  // Given 500 valid native updates are waiting for their first snapshot
  const book = createDepthProfileBook('BTCUSDT');
  for (let index = 0; index < 500; index += 1) pushDepthProfileUpdate(book, update());
  const bufferedCount = book.bufferedUpdates.length;

  // When the next native update exceeds the finite synchronization buffer
  const failure = captureThrownError(() => pushDepthProfileUpdate(book, update()));

  // Then the boundary is explicit and no unsynchronized book is reported ready
  assert.equal(bufferedCount, 500);
  assert.equal(failure instanceof DepthProfileSequenceError, true);
  assert.equal(failure.name, 'DepthProfileSequenceError');
  assert.equal(failure.message, 'Depth update buffer exceeded its limit');
  assert.equal(book.ready, false);
});

test('user excludes zero-quantity snapshot levels before computing cumulative depth', () => {
  // Given a snapshot includes deleted prices on both sides of the book
  const book = createDepthProfileBook('BTCUSDT');
  applyDepthProfileSnapshot(book, snapshot({
    bids: [['100', '0'], ['99', '2']], asks: [['101', '0'], ['102', '3']],
  }));

  // When an empty covering event confirms the snapshot sequence
  pushDepthProfileUpdate(book, update({ b: [], a: [] }));
  const profile = buildDepthProfile(book);

  // Then only active prices contribute to the displayed range and cumulative quantity
  assert.deepEqual(profile.bids, [{ price: 99, quantity: 2, cumulative: 2 }]);
  assert.deepEqual(profile.asks, [{ price: 102, quantity: 3, cumulative: 3 }]);
  assert.equal(profile.maxCumulative, 3);
});

for (const symbol of ['', 'btcusdt', 'BTCUSDT\n']) {
  test(`user rejects the invalid depth book symbol ${JSON.stringify(symbol)}`, () => {
    // Given a symbol that does not satisfy the native contract
    const input = symbol;

    // When the source requests a book for that symbol
    const failure = captureThrownError(() => createDepthProfileBook(input));

    // Then the invalid ownership is rejected before any book is created
    assert.equal(failure.message, 'Invalid depth profile symbol');
  });
}

for (const { label, payload, expected } of [
  { label: 'missing payload', payload: null, expected: 'Invalid depth profile snapshot' },
  { label: 'primitive payload', payload: 42, expected: 'Invalid depth profile snapshot' },
  { label: 'negative update id', payload: snapshot({ lastUpdateId: -1 }), expected: 'Invalid depth profile snapshot update id' },
  { label: 'fractional update id', payload: snapshot({ lastUpdateId: 1.5 }), expected: 'Invalid depth profile snapshot update id' },
  { label: 'missing bid levels', payload: snapshot({ bids: null }), expected: 'Invalid depth profile snapshot bids' },
  { label: 'non-array level', payload: snapshot({ bids: [null] }), expected: 'Invalid depth profile snapshot bids level' },
  { label: 'incomplete level', payload: snapshot({ asks: [['101']] }), expected: 'Invalid depth profile snapshot asks level' },
  { label: 'zero price', payload: snapshot({ bids: [['0', '1']] }), expected: 'Invalid depth profile snapshot bids price' },
  { label: 'non-numeric price', payload: snapshot({ asks: [['unknown', '1']] }), expected: 'Invalid depth profile snapshot asks price' },
  { label: 'negative quantity', payload: snapshot({ bids: [['100', '-1']] }), expected: 'Invalid depth profile snapshot bids quantity' },
  { label: 'infinite quantity', payload: snapshot({ asks: [['101', 'Infinity']] }), expected: 'Invalid depth profile snapshot asks quantity' },
]) {
  test(`user rejects a native snapshot with ${label}`, () => {
    // Given a new book and an invalid native snapshot field
    const book = createDepthProfileBook('BTCUSDT');

    // When the snapshot is parsed through the public book operation
    const failure = captureThrownError(() => applyDepthProfileSnapshot(book, payload));

    // Then the precise contract failure leaves the book unsynchronized and empty
    assert.equal(failure.message, expected);
    assert.equal(book.ready, false);
    assert.equal(book.bids.size, 0);
    assert.equal(book.asks.size, 0);
    assert.equal(book.snapshotUpdateId, null);
  });
}

for (const { label, payload, expected } of [
  { label: 'missing payload', payload: null, expected: 'Invalid depth profile update' },
  { label: 'primitive payload', payload: 'depthUpdate', expected: 'Invalid depth profile update' },
  { label: 'other event type', payload: update({ e: 'bookTicker' }), expected: 'Invalid depth profile update' },
  { label: 'negative first id', payload: update({ U: -1 }), expected: 'Invalid depth profile first update id' },
  { label: 'fractional final id', payload: update({ u: 102.5 }), expected: 'Invalid depth profile final update id' },
  { label: 'unsafe predecessor id', payload: update({ pu: Number.MAX_SAFE_INTEGER + 1 }), expected: 'Invalid depth profile previous final update id' },
  { label: 'descending update id range', payload: update({ U: 103, u: 102 }), expected: 'Invalid depth profile update id range' },
]) {
  test(`user rejects a native depth update with ${label}`, () => {
    // Given a new book and an invalid native stream event
    const book = createDepthProfileBook('BTCUSDT');

    // When the stream update is parsed through the public operation
    const failure = captureThrownError(() => pushDepthProfileUpdate(book, payload));

    // Then the field failure cannot enter the synchronization buffer
    assert.equal(failure.message, expected);
    assert.deepEqual(book.bufferedUpdates, []);
    assert.equal(book.ready, false);
  });
}

for (const { label, bids, asks, expected } of [
  { label: 'missing bids', bids: [], asks: [['101', '1']], expected: 'Depth profile requires bids and asks' },
  { label: 'missing asks', bids: [['100', '1']], asks: [], expected: 'Depth profile requires bids and asks' },
  { label: 'zero price range', bids: [['100', '1']], asks: [['100', '1']], expected: 'Depth profile price range is empty' },
]) {
  test(`user cannot display a synchronized depth profile with ${label}`, () => {
    // Given valid native messages produce an unusable visible price range
    const book = createDepthProfileBook('BTCUSDT');
    applyDepthProfileSnapshot(book, snapshot({ bids, asks }));
    pushDepthProfileUpdate(book, update({ b: [], a: [] }));

    // When the visualization requests the confirmed depth profile
    const failure = captureThrownError(() => buildDepthProfile(book));

    // Then the unusable range is rejected explicitly despite a connected sequence
    assert.equal(book.ready, true);
    assert.equal(failure.message, expected);
  });
}
