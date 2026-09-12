import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isFuturesTradingPathname,
  parseFuturesTradingSymbolFromPathname,
} from '../../../src/shared/binance-futures-route.js';

test('parses futures trading page paths', () => {
  assert.equal(parseFuturesTradingSymbolFromPathname('/futures/HYPEUSDT'), 'HYPEUSDT');
  assert.equal(parseFuturesTradingSymbolFromPathname('/zh-CN/futures/HYPEUSDT'), 'HYPEUSDT');
  assert.equal(parseFuturesTradingSymbolFromPathname('/en/futures/btcusdc'), 'BTCUSDC');
});

test('rejects Binance futures non-trading paths', () => {
  assert.equal(parseFuturesTradingSymbolFromPathname('/zh-CN/my/wallet/futures/balance'), null);
  assert.equal(parseFuturesTradingSymbolFromPathname('/zh-CN/futures/funding-history/perpetual/index'), null);
});

test('identifies only futures trading page paths', () => {
  assert.equal(isFuturesTradingPathname('/zh-CN/futures/HYPEUSDT'), true);
  assert.equal(isFuturesTradingPathname('/en/futures/btcusdc'), true);
  assert.equal(isFuturesTradingPathname('/zh-CN/my/wallet/futures/balance'), false);
});


test('parses Unicode futures symbols from actual URL pathnames', () => {
  for (const symbol of ['币安人生USDT', '龙虾USDT', '4USDT', 'WUSDT', '1INCHUSDT', '1000PEPEUSDT']) {
    assert.equal(parseFuturesTradingSymbolFromPathname('/zh-CN/futures/' + symbol), symbol);
    assert.equal(parseFuturesTradingSymbolFromPathname(new URL('https://www.binance.com/zh-CN/futures/' + symbol).pathname), symbol);
  }
  for (const path of ['/futures/%ZZUSDT', '/futures/BTC%2FUSDT', '/futures/BTC%20USDT', '/futures/BTCUSDT%0A']) {
    assert.equal(parseFuturesTradingSymbolFromPathname(path), null);
  }
});
