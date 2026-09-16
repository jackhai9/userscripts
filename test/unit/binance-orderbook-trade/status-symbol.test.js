import { captureThrownError } from '../../helpers/orderbook-migration-errors.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import { formatStatusBaseAsset } from '../../../src/binance-orderbook-trade/core/status-symbol.js';

test("user sees that status symbols omit supported futures quote assets", () => {
  // Given the futures contract identifier is available
  const scenarioInputs = ['HYPEUSDT'];

  // When its display symbol is resolved
  const observed = formatStatusBaseAsset(...scenarioInputs);

  // Then sees that status symbols omit supported futures quote assets
  assert.equal(observed, 'HYPE');
  assert.equal(formatStatusBaseAsset('BTCUSDC'), 'BTC');
  assert.equal(formatStatusBaseAsset('1000SHIBUSDT'), '1000SHIB');
});

test("user sees that status symbols reject unknown contracts instead of guessing a suffix", () => {
  // Given the futures contract identifier is available
  const scenarioInputs = ['BTCUSD'];

  // When its display symbol is resolved
  const observedFailure = captureThrownError(() => formatStatusBaseAsset(...scenarioInputs));

  // Then sees that status symbols reject unknown contracts instead of guessing a suffix
  assert.match(observedFailure.message, /不支持的合约状态交易对/);
  assert.throws(() => formatStatusBaseAsset('USDT'), /不支持的合约状态交易对/);
  assert.throws(() => formatStatusBaseAsset(''), /不支持的合约状态交易对/);
});
