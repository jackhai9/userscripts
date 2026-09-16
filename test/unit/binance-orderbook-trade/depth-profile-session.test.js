import test from 'node:test';
import assert from 'node:assert/strict';
import { captureThrownError } from '../../helpers/orderbook-migration-errors.js';

import { createDepthProfileSession } from '../../../src/binance-orderbook-trade/core/depth-profile-session.js';

class FakeNativeDepthSource {
  constructor() {
    this.subscriptions = [];
    this.unsubscribeCalls = 0;
  }

  subscribe(subscription) {
    this.subscriptions.push(subscription);
    return () => {
      this.unsubscribeCalls += 1;
      this.subscriptions = this.subscriptions.filter((item) => item !== subscription);
    };
  }

  profile(profile) {
    for (const subscription of this.subscriptions) subscription.onProfile(profile);
  }

  status(status) {
    for (const subscription of this.subscriptions) subscription.onStatus(status);
  }
}

test("user subscribes to the existing Binance native depth source", () => {
  // Given the native source and symbol callbacks are configured
  const statuses = [];
  const profiles = [];
  const source = new FakeNativeDepthSource();
  const session = createDepthProfileSession({
    symbol: 'BTCUSDT',
    source,
    onProfile: (profile) => profiles.push(profile),
    onStatus: (status) => statuses.push(status),
  });

  session.start();
  source.status({ symbol: 'BTCUSDT', status: 'synchronizing', detail: '' });
  // When the depth session lifecycle advances
  source.profile({ symbol: 'BTCUSDT', bids: [], asks: [] });

  // Then subscribes to the existing Binance native depth source
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].symbol, 'BTCUSDT');
  assert.equal(statuses.at(-1).status, 'synchronizing');
  session.stop();
  assert.equal(source.subscriptions.length, 0);
  assert.equal(session.isActive(), false);
});

test("user stops receiving later native source events after ending a session", () => {
  // Given the native source and symbol callbacks are configured
  const profiles = [];
  const source = new FakeNativeDepthSource();
  const session = createDepthProfileSession({
    symbol: 'BTCUSDT',
    source,
    onProfile: (profile) => profiles.push(profile),
    onStatus: () => {},
  });

  session.start();
  session.stop();
  // When the depth session lifecycle advances
  source.profile({ symbol: 'BTCUSDT', bids: [], asks: [] });
  // Then stopped sessions ignore later native source events
  assert.equal(profiles.length, 0);
});

test("user rejects mismatched native profile symbols", () => {
  // Given the native source and symbol callbacks are configured
  const source = new FakeNativeDepthSource();
  const session = createDepthProfileSession({
    symbol: 'BTCUSDT',
    source,
    onProfile: () => {},
    onStatus: () => {},
  });

  session.start();

  // When the source publishes another symbol through the active subscription
  const failure = captureThrownError(() => source.profile({ symbol: 'ETHUSDT', bids: [], asks: [] }));

  // Then rejects mismatched native profile symbols
  assert.equal(failure.message, 'Depth profile profile symbol mismatch: expected BTCUSDT, received ETHUSDT');
  session.stop();
});

test("user rejects duplicate starts", () => {
  // Given the native source and symbol callbacks are configured
  const source = new FakeNativeDepthSource();
  const session = createDepthProfileSession({
    symbol: 'BTCUSDT',
    source,
    onProfile: () => {},
    onStatus: () => {},
  });

  session.start();

  // When the consumer starts the same active session again
  const failure = captureThrownError(() => session.start());

  // Then rejects duplicate starts
  assert.equal(failure.message, 'Depth profile session already started');
  assert.equal(source.subscriptions.length, 1);
  session.stop();
});

for (const symbol of ['龙虾USDT', '币安人生USDT', '4USDT']) {
  test(`user subscribes to ${symbol} and preserves exact symbol ownership`, () => {
    // Given the native source and symbol callbacks are configured
    const source = new FakeNativeDepthSource();
    const profiles = [];
    const statuses = [];
    const session = createDepthProfileSession({
      symbol, source, onProfile: (profile) => profiles.push(profile), onStatus: (status) => statuses.push(status),
    });
    // When the depth session lifecycle advances
    session.start();
    // Then the subscription and status keep the full symbol unchanged
    assert.equal(source.subscriptions.length, 1);
    assert.equal(source.subscriptions[0].symbol, symbol);
    assert.deepEqual(statuses, [{ symbol, status: 'connecting', detail: '' }]);
    const profile = { symbol, bids: [{ price: 1, cumulative: 2 }], asks: [{ price: 2, cumulative: 3 }] };
    source.profile(profile);
    assert.deepEqual(profiles, [profile]);
    assert.throws(() => source.profile({ ...profile, symbol: `其他${symbol}` }), /symbol mismatch/);
    session.stop();
    assert.equal(source.subscriptions.length, 0);
  });
}

test('user receives fixture source events by identity and removes only the unsubscribed consumer', () => {
  // Given two independent subscriptions share the native-source boundary fixture
  const source = new FakeNativeDepthSource();
  const firstEvents = [];
  const secondEvents = [];
  const first = {
    symbol: 'BTCUSDT',
    onProfile: (value) => firstEvents.push(value),
    onStatus: (value) => firstEvents.push(value),
  };
  const second = {
    symbol: 'BTCUSDT',
    onProfile: (value) => secondEvents.push(value),
    onStatus: (value) => secondEvents.push(value),
  };
  const unsubscribeFirst = source.subscribe(first);
  source.subscribe(second);
  const profile = { symbol: 'BTCUSDT', bids: [{ price: 100, cumulative: 2 }], asks: [{ price: 101, cumulative: 3 }] };
  const status = { symbol: 'BTCUSDT', status: 'ready', detail: '' };

  // When both receive a profile and the first unsubscribes before the status event
  source.profile(profile);
  unsubscribeFirst();
  source.status(status);

  // Then event identity is preserved and the unrelated subscriber remains active
  assert.deepEqual(firstEvents, [profile]);
  assert.deepEqual(secondEvents, [profile, status]);
  assert.equal(firstEvents[0], profile);
  assert.equal(secondEvents[0], profile);
  assert.equal(secondEvents[1], status);
  assert.deepEqual(source.subscriptions, [second]);
  assert.equal(source.unsubscribeCalls, 1);
});

test('user ignores cached native callbacks after a depth session stops', () => {
  // Given the native source may already have queued callbacks for its subscription
  const source = new FakeNativeDepthSource();
  const profiles = [];
  const statuses = [];
  const session = createDepthProfileSession({
    symbol: 'BTCUSDT', source,
    onProfile: (value) => profiles.push(value),
    onStatus: (value) => statuses.push(value),
  });
  session.start();
  const cachedSubscription = source.subscriptions[0];
  session.stop();

  // When already queued profile and status callbacks arrive after cleanup
  cachedSubscription.onProfile({ symbol: 'BTCUSDT', bids: [], asks: [] });
  cachedSubscription.onStatus({ symbol: 'BTCUSDT', status: 'ready', detail: '' });
  cachedSubscription.onProfile(null);
  cachedSubscription.onStatus(null);

  // Then stopped callbacks cannot publish or validate obsolete page data
  assert.equal(session.isActive(), false);
  assert.deepEqual(profiles, []);
  assert.deepEqual(statuses, [{ symbol: 'BTCUSDT', status: 'connecting', detail: '' }]);
  assert.equal(source.subscriptions.length, 0);
  assert.equal(source.unsubscribeCalls, 1);
});

test('user can stop before starting and repeatedly stop without duplicating unsubscribe work', () => {
  // Given an initialized depth session has not started its native subscription
  const source = new FakeNativeDepthSource();
  const statuses = [];
  const session = createDepthProfileSession({
    symbol: 'BTCUSDT', source, onProfile() {}, onStatus: (value) => statuses.push(value),
  });

  // When cleanup runs before startup and twice after a normal start
  session.stop();
  const callsBeforeStart = source.unsubscribeCalls;
  session.start();
  const activeAfterStart = session.isActive();
  session.stop();
  session.stop();

  // Then only the active subscription is removed and cleanup finishes inactive
  assert.equal(callsBeforeStart, 0);
  assert.equal(activeAfterStart, true);
  assert.equal(session.isActive(), false);
  assert.equal(source.unsubscribeCalls, 1);
  assert.equal(source.subscriptions.length, 0);
  assert.deepEqual(statuses, [{ symbol: 'BTCUSDT', status: 'connecting', detail: '' }]);
});

for (const { label, value, expected } of [
  { label: 'another symbol', value: { symbol: 'ETHUSDT', status: 'ready', detail: '' }, expected: 'ETHUSDT' },
  { label: 'missing status', value: null, expected: 'undefined' },
]) {
  test(`user rejects ${label} delivered as an active session status`, () => {
    // Given a BTC session is subscribed and has only its initial connecting status
    const source = new FakeNativeDepthSource();
    const statuses = [];
    const session = createDepthProfileSession({
      symbol: 'BTCUSDT', source, onProfile() {}, onStatus: (status) => statuses.push(status),
    });
    session.start();

    // When the native source violates the status symbol contract
    const failure = captureThrownError(() => source.status(value));

    // Then mismatched status data is rejected before reaching the visualization
    assert.equal(failure.message, `Depth profile status symbol mismatch: expected BTCUSDT, received ${expected}`);
    assert.deepEqual(statuses, [{ symbol: 'BTCUSDT', status: 'connecting', detail: '' }]);
    session.stop();
  });
}

for (const { label, changes, expected } of [
  { label: 'invalid symbol', changes: { symbol: 'btcusdt' }, expected: 'Invalid depth profile session symbol' },
  { label: 'missing source', changes: { source: null }, expected: 'Invalid depth profile source' },
  { label: 'primitive source', changes: { source: 42 }, expected: 'Invalid depth profile source' },
  { label: 'missing subscriber', changes: { source: {} }, expected: 'Invalid depth profile source subscriber' },
  { label: 'missing profile listener', changes: { onProfile: null }, expected: 'Invalid depth profile profile listener' },
  { label: 'missing status listener', changes: { onStatus: null }, expected: 'Invalid depth profile status listener' },
]) {
  test(`user rejects session options with ${label} before subscribing`, () => {
    // Given otherwise valid dependencies contain one invalid session contract field
    const source = new FakeNativeDepthSource();
    const options = { symbol: 'BTCUSDT', source, onProfile() {}, onStatus() {}, ...changes };

    // When the consumer creates the session
    const failure = captureThrownError(() => createDepthProfileSession(options));

    // Then the field-specific error occurs before any native source subscription
    assert.equal(failure.message, expected);
    assert.equal(source.subscriptions.length, 0);
  });
}

test('user cannot create a depth session without options', () => {
  // Given the caller has not provided a session configuration
  const options = undefined;

  // When session initialization validates its symbol ownership
  const failure = captureThrownError(() => createDepthProfileSession(options));

  // Then the missing symbol is rejected explicitly
  assert.equal(failure.message, 'Invalid depth profile session symbol');
});

test('user receives an explicit error when the native source does not return unsubscribe', () => {
  // Given a broken source accepts subscriptions without providing its cleanup function
  const subscriptions = [];
  const source = { subscribe(value) { subscriptions.push(value); return null; } };
  const session = createDepthProfileSession({ symbol: 'BTCUSDT', source, onProfile() {}, onStatus() {} });

  // When the session starts against that invalid source boundary
  const failure = captureThrownError(() => session.start());
  session.stop();

  // Then the invalid cleanup contract is reported after exactly one subscribe call
  assert.equal(failure.message, 'Invalid depth profile unsubscribe function');
  assert.equal(subscriptions.length, 1);
  assert.equal(subscriptions[0].symbol, 'BTCUSDT');
  assert.equal(session.isActive(), false);
});
