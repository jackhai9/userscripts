import test from 'node:test';
import assert from 'node:assert/strict';
import { readAutomaticRebalanceEpisode, observeAutomaticRebalanceActivity, assertCompleteOpenOrders } from '../../../src/binance-orderbook-trade/core/automatic-usdt-rebalance.js';

test('user can qualify an initial or freshly active account episode', () => {
  // Given a completed flat episode
  const completed = { version: 1, status: 'consumed' };
  // When authoritative activity is observed
  const next = observeAutomaticRebalanceActivity(completed, false);
  // Then the next flat episode can qualify
  assert.deepEqual(next, { version: 1, status: 'active' });
  assert.deepEqual(readAutomaticRebalanceEpisode(null), { version: 1, status: 'active' });
});

for (const status of ['in_flight', 'blocked', 'consumed']) {
  test(`user retains ${status} protection across repeated flat observations`, () => {
    // Given a persisted protected episode
    const record = { version: 1, status };
    // When a reload reads it and observes flat state
    const next = observeAutomaticRebalanceActivity(readAutomaticRebalanceEpisode(JSON.stringify(record)), true);
    // Then the protection remains durable
    assert.deepEqual(next, record);
  });
}

test('user retains automatic completion across reloads and flat observations', () => {
  // Given a persisted automatically completed episode
  const record = { version: 1, status: 'consumed', outcome: 'automatic_completed' };
  const serialized = JSON.stringify(record);
  // When a reload reads it and observes the account still flat
  const restored = readAutomaticRebalanceEpisode(serialized);
  const next = observeAutomaticRebalanceActivity(restored, true);
  // Then both the persisted outcome and consumed protection remain intact
  assert.deepEqual(restored, record);
  assert.deepEqual(next, record);
});

test('user clears automatic completion when a new active account episode starts', () => {
  // Given an automatically completed episode restored from storage
  const completed = readAutomaticRebalanceEpisode(JSON.stringify({
    version: 1,
    status: 'consumed',
    outcome: 'automatic_completed',
  }));
  // When authoritative nonflat activity begins a new episode
  const next = observeAutomaticRebalanceActivity(completed, false);
  // Then the active episode contains no stale completion outcome
  assert.deepEqual(next, { version: 1, status: 'active' });
});

for (const outcome of [null, '', 'null', 'undefined', 'manual_completed', false, 0, [], {}]) {
  test(`user rejects ${JSON.stringify(outcome)} as a persisted automatic rebalance outcome`, () => {
    // Given a consumed episode with an unsupported explicit outcome
    const serialized = JSON.stringify({ version: 1, status: 'consumed', outcome });
    // When qualification reads the stored episode
    const read = () => readAutomaticRebalanceEpisode(serialized);
    // Then the invalid outcome is surfaced without resetting protection
    assert.throws(read, { message: 'Invalid automatic rebalance episode outcome' });
  });
}

for (const status of ['active', 'in_flight', 'blocked']) {
  test(`user rejects automatic completion on a persisted ${status} episode`, () => {
    // Given a completion outcome attached to an uncompleted episode
    const serialized = JSON.stringify({ version: 1, status, outcome: 'automatic_completed' });
    // When qualification reads the stored episode
    const read = () => readAutomaticRebalanceEpisode(serialized);
    // Then the conflicting outcome is surfaced without changing the episode
    assert.throws(read, { message: 'Invalid automatic rebalance episode outcome' });
  });
}

for (const status of ['in_flight', 'blocked']) {
  test(`user cannot clear ${status} transfer uncertainty by opening another position`, () => {
    // Given an uncertain financial operation
    const record = { version: 1, status };
    // When authoritative nonflat activity arrives
    const next = observeAutomaticRebalanceActivity(record, false);
    // Then no new automatic attempt is armed
    assert.deepEqual(next, record);
  });
}

test('user stops when persisted episode state is invalid', () => {
  // Given an incompatible stored record
  const value = JSON.stringify({ version: 0, status: 'active' });
  // When qualification reads it
  const read = () => readAutomaticRebalanceEpisode(value);
  // Then invalid state is surfaced without replacement
  assert.throws(read, /Invalid automatic rebalance episode/);
});

test('user qualifies only from complete successful open order arrays', () => {
  // Given successful complete and incompatible paginated replies
  const empty = { success: true, data: [] };
  const paginated = { success: true, data: { rows: [], total: 0 } };
  // When the authoritative order contract is checked
  const count = assertCompleteOpenOrders(empty);
  // Then complete empty evidence is accepted and pagination is rejected
  assert.equal(count, 0);
  assert.throws(() => assertCompleteOpenOrders(paginated), /complete open-order/);
  assert.throws(() => assertCompleteOpenOrders({ success: false, data: [] }), /complete open-order/);
});
