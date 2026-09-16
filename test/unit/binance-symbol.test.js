import test from 'node:test';
import assert from 'node:assert/strict';

import { isBinanceSymbol } from '../../src/shared/binance-symbol.js';
import { parseFuturesTradingSymbolFromPathname } from '../../src/shared/binance-futures-route.js';
import { canonicalUsdtToRoute, isCanonicalUsdtSymbol, usdtRouteToCanonical } from '../../src/shared/canonical-symbol.js';

test('user observes that Binance identifiers support Unicode letters, numbers, and underscores without normalization', () => {
  // Given valid and invalid identifiers keep their original characters and types
  const valid = ['BTCUSDT', '龙虾USDT', '币安人生USDC', '4', '4USDT', 'WUSDT', '1INCHUSDT', '1000PEPEUSDT', 'A_BTCUSDT'];
  const invalid = ['', 'btcusdt', '龙虾usdt', '龙虾USDT\n', ' BTCUSDT', 'BTCUSDT ', '龙 虾USDT', 'BTC/USDT', 'BTC-USDT', null, 4];
  // When the identifier contract evaluates both tables
  const accepted = valid.map(isBinanceSymbol);
  const rejected = invalid.map(isBinanceSymbol);
  // Then only valid identifiers are accepted without normalization
  for (const [index, symbol] of valid.entries()) {
    assert.equal(accepted[index], true, symbol);
  }
  for (const [index, symbol] of invalid.entries()) {
    assert.equal(rejected[index], false, String(symbol));
  }
});

test('user observes that route length remains a Unicode code-point contract', () => {
  // Given the supplied input retains its original contract values
  const scenarioInput = '/futures/𐐀𐐀';
  // When the real operation processes that input
  const observed = parseFuturesTradingSymbolFromPathname(scenarioInput);
  // Then route length remains a Unicode code-point contract
  assert.equal(observed, null);
  assert.equal(parseFuturesTradingSymbolFromPathname('/futures/𐐀𐐀𐐀'), '𐐀𐐀𐐀');
});

test('user observes that shared gateway symbol conversion preserves Chinese and numeric asset identity', () => {
  // Given canonical and route symbols represent the same Unicode or numeric asset
  const bases = ['龙虾', '币安人生', '4', 'W', '1INCH', '1000PEPE'];
  // When each asset is converted through the shared gateway contract
  const converted = bases.map(base => {
    const route = `${base}USDT`;
    const canonical = `${base}/USDT:USDT`;
    return { route, canonical, encoded: usdtRouteToCanonical(route), valid: isCanonicalUsdtSymbol(canonical), decoded: canonicalUsdtToRoute(canonical) };
  });
  // Then conversions preserve the exact route and canonical asset identities
  for (const value of converted) {
    assert.equal(value.encoded, value.canonical);
    assert.equal(value.valid, true);
    assert.equal(value.decoded, value.route);
  }
});
