import test from 'node:test';
import assert from 'node:assert/strict';

import { formatStatusBaseAsset } from '../../../src/binance-orderbook-trade/core/status-symbol.js';

test('status symbols omit supported futures quote assets', () => {
  assert.equal(formatStatusBaseAsset('HYPEUSDT'), 'HYPE');
  assert.equal(formatStatusBaseAsset('BTCUSDC'), 'BTC');
  assert.equal(formatStatusBaseAsset('1000SHIBUSDT'), '1000SHIB');
});

test('status symbols reject unknown contracts instead of guessing a suffix', () => {
  assert.throws(() => formatStatusBaseAsset('BTCUSD'), /Unsupported futures status symbol/);
  assert.throws(() => formatStatusBaseAsset('USDT'), /Unsupported futures status symbol/);
  assert.throws(() => formatStatusBaseAsset(''), /Unsupported futures status symbol/);
});
