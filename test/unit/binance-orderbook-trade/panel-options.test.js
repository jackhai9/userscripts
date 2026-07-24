import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isSymbolScopedSideStorageKey,
  loadSymbolSide,
  saveSymbolSide,
  symbolSideStorageKey,
} from '../../../src/binance-orderbook-trade/core/panel-options.js';

const OPEN_SIDE_KEY = 'jh_binance_open_side';
const CLOSE_SIDE_KEY = 'jh_binance_close_side';

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    entries() {
      return [...values.entries()];
    },
  };
}

test('open side is stored independently for each symbol', () => {
  const storage = createStorage();

  saveSymbolSide(storage, OPEN_SIDE_KEY, 'btcusdt', 'SHORT');
  saveSymbolSide(storage, OPEN_SIDE_KEY, 'ETHUSDT', 'LONG');

  assert.equal(loadSymbolSide(storage, OPEN_SIDE_KEY, 'BTCUSDT', 'LONG'), 'SHORT');
  assert.equal(loadSymbolSide(storage, OPEN_SIDE_KEY, 'ethusdt', 'SHORT'), 'LONG');
});

test('close side is stored independently for each symbol', () => {
  const storage = createStorage();

  saveSymbolSide(storage, CLOSE_SIDE_KEY, 'BTCUSDT', 'SHORT');

  assert.equal(loadSymbolSide(storage, CLOSE_SIDE_KEY, 'BTCUSDT', 'LONG'), 'SHORT');
  assert.equal(loadSymbolSide(storage, CLOSE_SIDE_KEY, 'ETHUSDT', 'LONG'), 'LONG');
});

test('open and close sides use separate storage namespaces', () => {
  const storage = createStorage();

  saveSymbolSide(storage, OPEN_SIDE_KEY, 'BTCUSDT', 'SHORT');
  saveSymbolSide(storage, CLOSE_SIDE_KEY, 'BTCUSDT', 'LONG');

  assert.deepEqual(storage.entries(), [
    ['jh_binance_open_side:BTCUSDT', 'SHORT'],
    ['jh_binance_close_side:BTCUSDT', 'LONG'],
  ]);
});

test('missing symbol reads the fallback without writing a global key', () => {
  const storage = createStorage();

  assert.equal(symbolSideStorageKey(OPEN_SIDE_KEY, ''), null);
  assert.equal(loadSymbolSide(storage, OPEN_SIDE_KEY, '', 'LONG'), 'LONG');
  assert.equal(saveSymbolSide(storage, OPEN_SIDE_KEY, '', 'SHORT'), false);
  assert.deepEqual(storage.entries(), []);
});

test('symbol-scoped side keys are recognized for storage event refreshes', () => {
  assert.equal(isSymbolScopedSideStorageKey('jh_binance_open_side:BTCUSDT', [OPEN_SIDE_KEY, CLOSE_SIDE_KEY]), true);
  assert.equal(isSymbolScopedSideStorageKey('jh_binance_close_side:ETHUSDT', [OPEN_SIDE_KEY, CLOSE_SIDE_KEY]), true);
  assert.equal(isSymbolScopedSideStorageKey('jh_binance_open_side', [OPEN_SIDE_KEY, CLOSE_SIDE_KEY]), false);
  assert.equal(isSymbolScopedSideStorageKey('jh_binance_ladder_expanded', [OPEN_SIDE_KEY, CLOSE_SIDE_KEY]), false);
});
