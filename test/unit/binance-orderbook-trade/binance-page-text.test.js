import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BINANCE_PAGE_TEXT,
  includesBinancePageText,
  includesCompactBinancePageText,
  matchesBinancePageText,
  parseBinanceTabCount,
  startsWithBinancePageText,
} from '../../../src/binance-orderbook-trade/contracts/binance-page-text.js';

test('centralizes the verified Chinese and English Binance page labels', () => {
  assert.equal(matchesBinancePageText('开仓', BINANCE_PAGE_TEXT.tradeMode.OPEN), true);
  assert.equal(matchesBinancePageText('Open', BINANCE_PAGE_TEXT.tradeMode.OPEN), true);
  assert.equal(matchesBinancePageText('可用', BINANCE_PAGE_TEXT.availableBalance), true);
  assert.equal(matchesBinancePageText('Avbl', BINANCE_PAGE_TEXT.availableBalance), true);
  assert.equal(matchesBinancePageText('撤销挂单', BINANCE_PAGE_TEXT.accountOrders.rowCancel), true);
  assert.equal(matchesBinancePageText('Cancel Order', BINANCE_PAGE_TEXT.accountOrders.rowCancel), true);
});

test('matches current account-order tabs without retaining stale English labels', () => {
  assert.equal(startsWithBinancePageText('基础单(29)', BINANCE_PAGE_TEXT.accountOrders.basicSubTab), true);
  assert.equal(startsWithBinancePageText('Basic(31)', BINANCE_PAGE_TEXT.accountOrders.basicSubTab), true);
  assert.equal(startsWithBinancePageText('条件委托(0)', BINANCE_PAGE_TEXT.accountOrders.conditionalSubTab), true);
  assert.equal(startsWithBinancePageText('Conditional(0)', BINANCE_PAGE_TEXT.accountOrders.conditionalSubTab), true);
  assert.equal(startsWithBinancePageText('Basic Orders(31)', BINANCE_PAGE_TEXT.accountOrders.basicSubTab), false);
});

test('parses localized tab counts through the shared page-text contract', () => {
  assert.equal(parseBinanceTabCount('当前委托(4)', BINANCE_PAGE_TEXT.accountOrders.openOrdersTab), 4);
  assert.equal(parseBinanceTabCount('Open Orders (12)', BINANCE_PAGE_TEXT.accountOrders.openOrdersTab), 12);
  assert.equal(parseBinanceTabCount('Positions(1)', BINANCE_PAGE_TEXT.accountOrders.positionTab), 1);
  assert.equal(parseBinanceTabCount('Open Orders', BINANCE_PAGE_TEXT.accountOrders.openOrdersTab), null);
});

test('contains only explicitly verified Binance fragments', () => {
  assert.equal(includesBinancePageText('只做Ｍaker (Post Only)', BINANCE_PAGE_TEXT.postOnly), true);
  assert.equal(includesBinancePageText('HYPEUSDT Perp', BINANCE_PAGE_TEXT.accountOrders.perpetual), true);
  assert.equal(includesBinancePageText('Hide Other Symbols', BINANCE_PAGE_TEXT.accountOrders.hideOtherSymbols), true);
  assert.equal(includesBinancePageText('Available', BINANCE_PAGE_TEXT.availableBalance), false);
  assert.equal(includesCompactBinancePageText('Open Long / Limit', BINANCE_PAGE_TEXT.tradeAction.OPEN_LONG), true);
});
