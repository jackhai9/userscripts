import test from 'node:test';
import assert from 'node:assert/strict';

import { isBinanceSymbol } from '../../src/shared/binance-symbol.js';
import { parseFuturesTradingSymbolFromPathname } from '../../src/shared/binance-futures-route.js';
import { canonicalUsdtToRoute, isCanonicalUsdtSymbol, usdtRouteToCanonical } from '../../src/shared/canonical-symbol.js';

test('Binance identifiers support Unicode letters, numbers, and underscores without normalization', () => {
  for (const symbol of ['BTCUSDT', '龙虾USDT', '币安人生USDC', '4', '4USDT', 'WUSDT', '1INCHUSDT', '1000PEPEUSDT', 'A_BTCUSDT']) {
    assert.equal(isBinanceSymbol(symbol), true, symbol);
  }
  for (const symbol of ['', 'btcusdt', '龙虾usdt', '龙虾USDT\n', ' BTCUSDT', 'BTCUSDT ', '龙 虾USDT', 'BTC/USDT', 'BTC-USDT', null, 4]) {
    assert.equal(isBinanceSymbol(symbol), false, String(symbol));
  }
});

test('route length remains a Unicode code-point contract', () => {
  assert.equal(parseFuturesTradingSymbolFromPathname('/futures/𐐀𐐀'), null);
  assert.equal(parseFuturesTradingSymbolFromPathname('/futures/𐐀𐐀𐐀'), '𐐀𐐀𐐀');
});

test('shared gateway symbol conversion preserves Chinese and numeric asset identity', () => {
  for (const base of ['龙虾', '币安人生', '4', 'W', '1INCH', '1000PEPE']) {
    const route = `${base}USDT`;
    const canonical = `${base}/USDT:USDT`;
    assert.equal(usdtRouteToCanonical(route), canonical);
    assert.equal(isCanonicalUsdtSymbol(canonical), true);
    assert.equal(canonicalUsdtToRoute(canonical), route);
  }
});
