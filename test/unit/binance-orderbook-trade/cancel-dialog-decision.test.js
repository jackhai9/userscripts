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

test('a pre-captured fast confirm is preserved after the dialog closes', () => {
  assert.equal(resolve({ seenDialog: true, action: 'confirmed' }), 'confirmed');
});

test('cancel, Escape, backdrop, and empty-area closure resolve as cancelled', () => {
  assert.equal(resolve({ seenDialog: true, action: 'cancelled' }), 'cancelled');
  assert.equal(resolve({ seenDialog: true, action: null }), 'cancelled');
});

test('a visible dialog keeps waiting regardless of elapsed user decision time', () => {
  assert.equal(resolve({
    seenDialog: true,
    action: 'confirmed',
    dialogVisible: true,
  }), 'waiting');
  assert.equal(resolve({
    seenDialog: true,
    action: 'confirmed',
    dialogVisible: true,
    nowMs: 3_600_000,
  }), 'waiting');
});

test('page lifecycle abort is distinct from a dialog contract failure', () => {
  assert.equal(resolve({
    seenDialog: true,
    dialogVisible: true,
    aborted: true,
  }), 'aborted');
});

test('an unseen dialog fails only after its discovery deadline', () => {
  assert.equal(resolve(), 'waiting');
  assert.equal(resolve({ nowMs: 2_000 }), 'not_found');
});
