import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveCancelDialogDecision } from '../../../src/binance-orderbook-trade/core/cancel-dialog-decision.js';

function resolve(overrides = {}) {
  return resolveCancelDialogDecision({
    seenDialog: false,
    action: null,
    dialogVisible: false,
    aborted: false,
    nowMs: 1_000,
    discoveryDeadlineMs: 2_000,
    ...overrides,
  });
}

test('user retains a captured confirmation after the dialog closes', () => {
  // Given confirmation was captured before the native dialog disappeared
  const state = { seenDialog: true, action: 'confirmed' };

  // When the completed dialog decision is resolved
  const decision = resolve(state);

  // Then the native confirmation remains the completed outcome
  assert.equal(decision, 'confirmed');
});

test('user cancels when the dialog closes with a cancellation or without confirmation', () => {
  // Given the seen dialog closes after cancellation or an unconfirmed dismissal
  const states = [{ seenDialog: true, action: 'cancelled' }, { seenDialog: true, action: null }];

  // When each dismissal is resolved
  const decisions = states.map(resolve);

  // Then neither dismissal authorizes cancellation of exchange orders
  assert.deepEqual(decisions, ['cancelled', 'cancelled']);
});

test('user can leave the native confirmation visible without a decision timeout', () => {
  // Given a visible dialog has an earlier captured click and can remain open for an hour
  const states = [{
    seenDialog: true,
    action: 'confirmed',
    dialogVisible: true,
  }, {
    seenDialog: true,
    action: 'confirmed',
    dialogVisible: true,
    nowMs: 3_600_000,
  }];

  // When the pending decision is read before and after that hour
  const decisions = states.map(resolve);

  // Then the dialog remains pending while Binance still displays it
  assert.deepEqual(decisions, ['waiting', 'waiting']);
});

test('user sees an aborted decision when the page lifecycle ends', () => {
  // Given the page is aborted with the native dialog still visible
  const state = {
    seenDialog: true,
    dialogVisible: true,
    aborted: true,
  };

  // When the dialog decision is resolved
  const decision = resolve(state);

  // Then the result identifies lifecycle abort instead of missing confirmation
  assert.equal(decision, 'aborted');
});

test('user sees a missing dialog only after its discovery deadline', () => {
  // Given the dialog has never appeared before or exactly at its discovery deadline
  const states = [{ nowMs: 1_999 }, { nowMs: 2_000 }];

  // When discovery is evaluated at both deadline boundaries
  const decisions = states.map(resolve);

  // Then discovery stays pending before the deadline and fails exactly at it
  assert.deepEqual(decisions, ['waiting', 'not_found']);
});
