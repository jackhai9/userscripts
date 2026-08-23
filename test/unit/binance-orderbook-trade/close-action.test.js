import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveConfirmedCloseDirection } from '../../../src/binance-orderbook-trade/core/close-action.js';

test('close direction requires both position sides to be freshly known', () => {
  assert.equal(resolveConfirmedCloseDirection({
    knowsLong: true,
    knowsShort: false,
    hasLong: true,
    hasShort: false,
  }, 'LONG'), null);
  assert.equal(resolveConfirmedCloseDirection({
    knowsLong: false,
    knowsShort: true,
    hasLong: false,
    hasShort: true,
  }, 'SHORT'), null);
});

test('close direction follows confirmed positions and the explicit dual-side selection', () => {
  assert.equal(resolveConfirmedCloseDirection({
    knowsLong: true,
    knowsShort: true,
    hasLong: true,
    hasShort: false,
  }, 'SHORT'), 'LONG');
  assert.equal(resolveConfirmedCloseDirection({
    knowsLong: true,
    knowsShort: true,
    hasLong: false,
    hasShort: true,
  }, 'LONG'), 'SHORT');
  assert.equal(resolveConfirmedCloseDirection({
    knowsLong: true,
    knowsShort: true,
    hasLong: true,
    hasShort: true,
  }, 'SHORT'), 'SHORT');
  assert.equal(resolveConfirmedCloseDirection({
    knowsLong: true,
    knowsShort: true,
    hasLong: false,
    hasShort: false,
  }, 'LONG'), null);
});
