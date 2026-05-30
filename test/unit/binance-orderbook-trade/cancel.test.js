import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hasCurrentSymbolOpenOrdersEvidence,
  isOpenOrdersScopeLimitedToSymbolText,
  isOpenOrdersTabText,
  normalizeText,
  parseOpenOrdersTabCount,
  readVisibleOpenOrderSymbolsText,
} from '../../../src/binance-orderbook-trade/core/cancel-orders.js';

test('normalizes text and recognizes open-orders tab labels', () => {
  assert.equal(normalizeText(' 当前\n委托 (2) '), '当前 委托 (2)');
  assert.equal(isOpenOrdersTabText('当前委托(2)'), true);
  assert.equal(isOpenOrdersTabText('Open Orders (3)'), true);
  assert.equal(isOpenOrdersTabText('历史委托'), false);
});

test('parses open-orders count from localized tab text', () => {
  assert.equal(parseOpenOrdersTabCount('当前委托(2)'), 2);
  assert.equal(parseOpenOrdersTabCount('Open Orders (12)'), 12);
  assert.equal(parseOpenOrdersTabCount('当前委托'), null);
});

test('visible current-symbol rows are direct open-order evidence', () => {
  assert.deepEqual(readVisibleOpenOrderSymbolsText('HYPEUSDT 永续 价格 数量 BTCUSDT 永续'), ['HYPEUSDT', 'BTCUSDT']);
  assert.equal(hasCurrentSymbolOpenOrdersEvidence({
    scopeText: '价格 HYPEUSDT 永续 数量',
    symbol: 'HYPEUSDT',
    symbolFilterOk: false,
    openOrdersCount: 0,
  }), true);
});

test('open-orders tab count is evidence only after symbol filter is confirmed', () => {
  assert.equal(hasCurrentSymbolOpenOrdersEvidence({
    scopeText: '隐藏其他合约 当前委托',
    symbol: 'HYPEUSDT',
    symbolFilterOk: true,
    openOrdersCount: 2,
  }), true);
  assert.equal(hasCurrentSymbolOpenOrdersEvidence({
    scopeText: '隐藏其他合约 当前委托',
    symbol: 'HYPEUSDT',
    symbolFilterOk: false,
    openOrdersCount: 2,
  }), false);
});

test('enabled cancel-all is evidence after current-symbol filter is confirmed', () => {
  assert.equal(hasCurrentSymbolOpenOrdersEvidence({
    scopeText: '隐藏其他合约 当前委托 价格 数量',
    symbol: 'HYPEUSDT',
    symbolFilterOk: true,
    openOrdersCount: null,
    cancelAllAvailable: true,
  }), true);
  assert.equal(hasCurrentSymbolOpenOrdersEvidence({
    scopeText: '隐藏其他合约 当前委托 价格 数量',
    symbol: 'HYPEUSDT',
    symbolFilterOk: false,
    openOrdersCount: null,
    cancelAllAvailable: true,
  }), false);
});

test('zero tab count or other visible symbols do not authorize current-symbol cancel', () => {
  assert.equal(hasCurrentSymbolOpenOrdersEvidence({
    scopeText: '隐藏其他合约 当前委托',
    symbol: 'HYPEUSDT',
    symbolFilterOk: true,
    openOrdersCount: 0,
  }), false);
  assert.equal(hasCurrentSymbolOpenOrdersEvidence({
    scopeText: 'BTCUSDT 永续',
    symbol: 'HYPEUSDT',
    symbolFilterOk: true,
    openOrdersCount: 2,
  }), false);
  assert.equal(hasCurrentSymbolOpenOrdersEvidence({
    scopeText: 'BTCUSDT 永续',
    symbol: 'HYPEUSDT',
    symbolFilterOk: true,
    openOrdersCount: null,
    cancelAllAvailable: true,
  }), false);
});

test('scope is limited only when all visible symbols match current symbol', () => {
  assert.equal(isOpenOrdersScopeLimitedToSymbolText('HYPEUSDT 永续 HYPEUSDT 永续', 'HYPEUSDT'), true);
  assert.equal(isOpenOrdersScopeLimitedToSymbolText('HYPEUSDT 永续 BTCUSDT 永续', 'HYPEUSDT'), false);
  assert.equal(isOpenOrdersScopeLimitedToSymbolText('隐藏其他合约', 'HYPEUSDT'), false);
});
