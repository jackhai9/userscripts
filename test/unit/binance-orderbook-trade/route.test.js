import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isFuturesTradingPathname,
  parseFuturesTradingSymbolFromPathname,
} from '../../../src/shared/binance-futures-route.js';

test('parses futures trading page paths', () => {
  assert.equal(parseFuturesTradingSymbolFromPathname('/futures/HYPEUSDT'), 'HYPEUSDT');
  assert.equal(parseFuturesTradingSymbolFromPathname('/zh-CN/futures/HYPEUSDT'), 'HYPEUSDT');
});

test('rejects Binance futures non-trading paths', () => {
  assert.equal(parseFuturesTradingSymbolFromPathname('/zh-CN/my/wallet/futures/balance'), null);
  assert.equal(parseFuturesTradingSymbolFromPathname('/zh-CN/futures/funding-history/perpetual/index'), null);
});

test('identifies only futures trading page paths', () => {
  assert.equal(isFuturesTradingPathname('/zh-CN/futures/HYPEUSDT'), true);
  assert.equal(isFuturesTradingPathname('/zh-CN/my/wallet/futures/balance'), false);
});
