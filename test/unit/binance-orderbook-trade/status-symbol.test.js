import test from 'node:test';
import assert from 'node:assert/strict';

import { formatStatusBaseAsset } from '../../../src/binance-orderbook-trade/core/status-symbol.js';

test('status symbols omit supported futures quote assets', () => {
  assert.equal(formatStatusBaseAsset('HYPEUSDT'), 'HYPE');
  assert.equal(formatStatusBaseAsset('BTCUSDC'), 'BTC');
  assert.equal(formatStatusBaseAsset('1000SHIBUSDT'), '1000SHIB');
});

test('status symbols reject unknown contracts instead of guessing a suffix', () => {
  assert.throws(() => formatStatusBaseAsset('BTCUSD'), /不支持的合约状态交易对/);
  assert.throws(() => formatStatusBaseAsset('USDT'), /不支持的合约状态交易对/);
  assert.throws(() => formatStatusBaseAsset(''), /不支持的合约状态交易对/);
});
