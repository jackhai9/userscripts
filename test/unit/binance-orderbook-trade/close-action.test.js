import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveCloseDisplayQuantities,
  resolveConfirmedCloseDirection,
} from '../../../src/binance-orderbook-trade/core/close-action.js';

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

test('pending close transition keeps the previous close snapshot and rejects stale open quantities', () => {
  assert.deepEqual(resolveCloseDisplayQuantities({
    rawLongQty: 4.07,
    rawShortQty: 4.06,
    cachedLongQty: 0.42,
    cachedShortQty: 0,
    transitionPending: true,
  }), {
    longQty: 0.42,
    shortQty: 0,
    isUsingCache: true,
    shouldCommit: false,
  });
});

test('first confirmed close snapshot accepts a legitimate zero immediately', () => {
  assert.deepEqual(resolveCloseDisplayQuantities({
    rawLongQty: 0.42,
    rawShortQty: 0,
    cachedLongQty: 0.42,
    cachedShortQty: 4.06,
    transitionPending: false,
  }), {
    longQty: 0.42,
    shortQty: 0,
    isUsingCache: false,
    shouldCommit: true,
  });
});
