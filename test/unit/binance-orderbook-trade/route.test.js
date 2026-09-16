import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isFuturesTradingPathname,
  parseFuturesTradingSymbolFromPathname,
} from '../../../src/shared/binance-futures-route.js';

test("user parses futures trading page paths", () => {
  // Given the current Binance pathname is available
  const scenarioInputs = ['/futures/HYPEUSDT'];

  // When the trading route and symbol are resolved
  const observed = parseFuturesTradingSymbolFromPathname(...scenarioInputs);

  // Then parses futures trading page paths
  assert.equal(observed, 'HYPEUSDT');
  assert.equal(parseFuturesTradingSymbolFromPathname('/zh-CN/futures/HYPEUSDT'), 'HYPEUSDT');
  assert.equal(parseFuturesTradingSymbolFromPathname('/en/futures/btcusdc'), 'BTCUSDC');
});

test("user rejects Binance futures non-trading paths", () => {
  // Given the current Binance pathname is available
  const scenarioInputs = ['/zh-CN/my/wallet/futures/balance'];

  // When the trading route and symbol are resolved
  const observed = parseFuturesTradingSymbolFromPathname(...scenarioInputs);

  // Then rejects Binance futures non-trading paths
  assert.equal(observed, null);
  assert.equal(parseFuturesTradingSymbolFromPathname('/zh-CN/futures/funding-history/perpetual/index'), null);
});

test("user identifies only futures trading page paths", () => {
  // Given the current Binance pathname is available
  const scenarioInputs = ['/zh-CN/futures/HYPEUSDT'];

  // When the trading route and symbol are resolved
  const observed = isFuturesTradingPathname(...scenarioInputs);

  // Then identifies only futures trading page paths
  assert.equal(observed, true);
  assert.equal(isFuturesTradingPathname('/en/futures/btcusdc'), true);
  assert.equal(isFuturesTradingPathname('/zh-CN/my/wallet/futures/balance'), false);
});


test("user parses Unicode futures symbols from actual URL pathnames", () => {
  // Given Unicode and short contracts plus malformed or encoded separators
  const symbols = ['币安人生USDT', '龙虾USDT', '4USDT', 'WUSDT', '1INCHUSDT', '1000PEPEUSDT'];
  const invalidPaths = ['/futures/%ZZUSDT', '/futures/BTC%2FUSDT', '/futures/BTC%20USDT', '/futures/BTCUSDT%0A'];

  // When raw and browser-encoded paths are parsed
  const raw = symbols.map((symbol) => parseFuturesTradingSymbolFromPathname('/zh-CN/futures/' + symbol));
  const encoded = symbols.map((symbol) => parseFuturesTradingSymbolFromPathname(new URL('https://www.binance.com/zh-CN/futures/' + symbol).pathname));
  const invalid = invalidPaths.map(parseFuturesTradingSymbolFromPathname);

  // Then complete contract identities survive encoding and malformed routes are rejected
  assert.deepEqual(raw, symbols);
  assert.deepEqual(encoded, symbols);
  assert.deepEqual(invalid, [null, null, null, null]);
});
