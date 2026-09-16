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

test("user sees that open side is stored independently for each symbol", () => {
  // Given the symbol and stored side preferences are available
  const storage = createStorage();

  saveSymbolSide(storage, OPEN_SIDE_KEY, 'btcusdt', 'SHORT');
  // When the symbol-scoped side preference is read or written
  saveSymbolSide(storage, OPEN_SIDE_KEY, 'ETHUSDT', 'LONG');

  // Then sees that open side is stored independently for each symbol
  assert.equal(loadSymbolSide(storage, OPEN_SIDE_KEY, 'BTCUSDT', 'LONG'), 'SHORT');
  assert.equal(loadSymbolSide(storage, OPEN_SIDE_KEY, 'ethusdt', 'SHORT'), 'LONG');
});

test("user sees that close side is stored independently for each symbol", () => {
  // Given the symbol and stored side preferences are available
  const storage = createStorage();

  // When the symbol-scoped side preference is read or written
  saveSymbolSide(storage, CLOSE_SIDE_KEY, 'BTCUSDT', 'SHORT');

  // Then sees that close side is stored independently for each symbol
  assert.equal(loadSymbolSide(storage, CLOSE_SIDE_KEY, 'BTCUSDT', 'LONG'), 'SHORT');
  assert.equal(loadSymbolSide(storage, CLOSE_SIDE_KEY, 'ETHUSDT', 'LONG'), 'LONG');
});

test("user sees that open and close sides use separate storage namespaces", () => {
  // Given the symbol and stored side preferences are available
  const storage = createStorage();

  saveSymbolSide(storage, OPEN_SIDE_KEY, 'BTCUSDT', 'SHORT');
  // When the symbol-scoped side preference is read or written
  saveSymbolSide(storage, CLOSE_SIDE_KEY, 'BTCUSDT', 'LONG');

  // Then sees that open and close sides use separate storage namespaces
  assert.deepEqual(storage.entries(), [
    ['jh_binance_open_side:BTCUSDT', 'SHORT'],
    ['jh_binance_close_side:BTCUSDT', 'LONG'],
  ]);
});

test("user sees that missing symbol reads the fallback without writing a global key", () => {
  // Given the symbol and stored side preferences are available
  const storage = createStorage();

  // When the symbol-scoped side preference is read or written
  const observed = symbolSideStorageKey(OPEN_SIDE_KEY, '');

  // Then sees that missing symbol reads the fallback without writing a global key
  assert.equal(observed, null);
  assert.equal(loadSymbolSide(storage, OPEN_SIDE_KEY, '', 'LONG'), 'LONG');
  assert.equal(saveSymbolSide(storage, OPEN_SIDE_KEY, '', 'SHORT'), false);
  assert.deepEqual(storage.entries(), []);
});

test("user sees that symbol-scoped side keys are recognized for storage event refreshes", () => {
  // Given the symbol and stored side preferences are available
  const scenarioInputs = ['jh_binance_open_side:BTCUSDT', [OPEN_SIDE_KEY, CLOSE_SIDE_KEY]];

  // When the symbol-scoped side preference is read or written
  const observed = isSymbolScopedSideStorageKey(...scenarioInputs);

  // Then sees that symbol-scoped side keys are recognized for storage event refreshes
  assert.equal(observed, true);
  assert.equal(isSymbolScopedSideStorageKey('jh_binance_close_side:ETHUSDT', [OPEN_SIDE_KEY, CLOSE_SIDE_KEY]), true);
  assert.equal(isSymbolScopedSideStorageKey('jh_binance_open_side', [OPEN_SIDE_KEY, CLOSE_SIDE_KEY]), false);
  assert.equal(isSymbolScopedSideStorageKey('jh_binance_ladder_expanded', [OPEN_SIDE_KEY, CLOSE_SIDE_KEY]), false);
});
