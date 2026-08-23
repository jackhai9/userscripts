import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveCancelDialogDecision } from '../../../src/binance-orderbook-trade/core/cancel-dialog-decision.js';

function resolve(overrides = {}) {
  return resolveCancelDialogDecision({
    seenDialog: false,
    action: null,
    dialogVisible: false,
    nowMs: 1_000,
    discoveryDeadlineMs: 2_000,
    closeDeadlineMs: null,
    ...overrides,
  });
}

test('a pre-captured fast confirm is preserved after the dialog closes', () => {
  assert.equal(resolve({ seenDialog: true, action: 'confirmed' }), 'confirmed');
});

test('cancel, Escape, backdrop, and empty-area closure resolve as cancelled', () => {
  assert.equal(resolve({ seenDialog: true, action: 'cancelled' }), 'cancelled');
  assert.equal(resolve({ seenDialog: true, action: null }), 'cancelled');
});

test('a clicked primary action must still wait for dialog closure', () => {
  assert.equal(resolve({
    seenDialog: true,
    action: 'confirmed',
    dialogVisible: true,
    closeDeadlineMs: 61_000,
  }), 'waiting');
  assert.equal(resolve({
    seenDialog: true,
    action: 'confirmed',
    dialogVisible: true,
    nowMs: 61_000,
    closeDeadlineMs: 61_000,
  }), 'dialog_not_closed');
});

test('an unseen dialog fails only after its discovery deadline', () => {
  assert.equal(resolve(), 'waiting');
  assert.equal(resolve({ nowMs: 2_000 }), 'not_found');
});
