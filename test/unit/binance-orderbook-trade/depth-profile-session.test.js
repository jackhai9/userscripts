import test from 'node:test';
import assert from 'node:assert/strict';

import { createDepthProfileSession } from '../../../src/binance-orderbook-trade/core/depth-profile-session.js';

class FakeNativeDepthSource {
  constructor() {
    this.subscriptions = [];
  }

  subscribe(subscription) {
    this.subscriptions.push(subscription);
    return () => {
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

test('subscribes to the existing Binance native depth source', () => {
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
  source.profile({ symbol: 'BTCUSDT', bids: [], asks: [] });

  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].symbol, 'BTCUSDT');
  assert.equal(statuses.at(-1).status, 'synchronizing');
  session.stop();
  assert.equal(source.subscriptions.length, 0);
  assert.equal(session.isActive(), false);
});

test('stopped sessions ignore later native source events', () => {
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
  source.profile({ symbol: 'BTCUSDT', bids: [], asks: [] });
  assert.equal(profiles.length, 0);
});

test('rejects mismatched native profile symbols', () => {
  const source = new FakeNativeDepthSource();
  const session = createDepthProfileSession({
    symbol: 'BTCUSDT',
    source,
    onProfile: () => {},
    onStatus: () => {},
  });

  session.start();
  assert.throws(
    () => source.profile({ symbol: 'ETHUSDT', bids: [], asks: [] }),
    /symbol mismatch/,
  );
});

test('rejects duplicate starts', () => {
  const source = new FakeNativeDepthSource();
  const session = createDepthProfileSession({
    symbol: 'BTCUSDT',
    source,
    onProfile: () => {},
    onStatus: () => {},
  });

  session.start();
  assert.throws(() => session.start(), /already started/);
});
