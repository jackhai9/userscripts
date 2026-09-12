import test from 'node:test';
import assert from 'node:assert/strict';

import { loadFixtureDom } from '../../helpers/dom.js';
import {
  findOpenOrderRowElements,
  getOpenOrderRowCells,
  readOpenOrdersScopeText,
} from '../../../src/binance-orderbook-trade/dom/open-order-rows.js';
import {
  isCurrentSymbolOpenOrdersClearCandidate,
  isCurrentSymbolOpenOrdersFilterReady,
  isOpenOrdersScopeLimitedToSymbolText,
  readVisibleOpenOrderSymbolsText,
} from '../../../src/binance-orderbook-trade/core/cancel-orders.js';

function isVisibleElement(element) {
  return Boolean(element?.isConnected && !element.closest('[data-hidden]'));
}

function createCells({ symbol, side, quantity }) {
  const values = [
    '2026-08-26 10:24:05',
    `${symbol}永续`,
    '限价委托',
    side,
    '82.00000',
    `${quantity} HYPE`,
    '0.00 HYPE',
    '否',
    '是',
    '–',
    '--',
    '-',
  ];
  return values.map((value) => `<div class="cell">${value}</div>`).join('');
}

function createRow({ symbol = 'HYPEUSDT', side = '开空', quantity = '0.07' } = {}) {
  return `
    <div class="flex items-center typography-caption2 text-PrimaryText w-full h-[48px]">
      ${createCells({ symbol, side, quantity })}
      <div class="actions">
        <svg aria-label="修改订单"></svg>
        <svg aria-label="撤销挂单"></svg>
      </div>
    </div>
  `;
}

test('finds current Binance open-order rows from their semantic cancel action', () => {
  const dom = loadFixtureDom(`
    <section id="OPEN_ORDERS">
      <div class="header">${createCells({ symbol: '合约', side: '方向', quantity: '数量' })}</div>
      <div class="rows">${createRow()}${createRow({ side: '平空', quantity: '0.02' })}</div>
    </section>
  `);
  const root = dom.window.document.querySelector('#OPEN_ORDERS');
  const rows = findOpenOrderRowElements(root, {
    isVisibleElement,
    isRowCancelIcon: (icon) => icon.getAttribute('aria-label') === '撤销挂单',
  });

  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => getOpenOrderRowCells(row, { isVisibleElement })[3].textContent.trim()),
    ['开空', '平空'],
  );
  assert.deepEqual(
    rows.map((row) => getOpenOrderRowCells(row, { isVisibleElement })[5].textContent.trim()),
    ['0.07 HYPE', '0.02 HYPE'],
  );
});

test('ignores hidden and unrelated SVG actions instead of treating list wrappers as rows', () => {
  const dom = loadFixtureDom(`
    <section id="OPEN_ORDERS">
      <div class="rows">
        ${createRow()}
        <div class="not-an-order">${createCells({ symbol: 'HYPEUSDT', side: '开空', quantity: '9' })}<svg aria-label="帮助"></svg></div>
        <div data-hidden>${createRow()}</div>
      </div>
    </section>
  `);
  const root = dom.window.document.querySelector('#OPEN_ORDERS');
  const rows = findOpenOrderRowElements(root, {
    isVisibleElement,
    isRowCancelIcon: (icon) => icon.getAttribute('aria-label') === '撤销挂单',
  });

  assert.equal(rows.length, 1);
  assert.equal(getOpenOrderRowCells(rows[0], { isVisibleElement })[1].textContent.trim(), 'HYPEUSDT永续');
});

const scopeOptions = {
  isVisibleElement,
  isRowCancelIcon: (icon) => icon.getAttribute('aria-label') === '撤销挂单',
};

test('scope evidence preserves Unicode symbol cells beside concatenated order columns', () => {
  for (const symbol of ['龙虾USDT', '4USDT']) {
    const dom = loadFixtureDom(`<section>${createRow({ symbol })}${createRow({ symbol: 'BTCUSDT' })}</section>`);
    const root = dom.window.document.querySelector('section');
    assert.equal(root.textContent.includes(`${symbol}永续限价委托`), true);
    const scopeText = readOpenOrdersScopeText(root, scopeOptions);
    assert.deepEqual(readVisibleOpenOrderSymbolsText(scopeText), [symbol, 'BTCUSDT']);
    assert.equal(isOpenOrdersScopeLimitedToSymbolText(scopeText, 'BTCUSDT'), false);
    assert.equal(isCurrentSymbolOpenOrdersFilterReady({
      scopeText, symbol: 'BTCUSDT', filterChecked: true, cancelAllAvailable: true,
    }), false);
    assert.equal(isCurrentSymbolOpenOrdersClearCandidate({ scopeText, symbol, openOrdersCount: 2 }), false);
  }
});

test('scope evidence retains bare symbol cells and text split into nested spans', () => {
  for (const cell of ['龙虾USDT', '<span>龙虾</span><span>USDT</span><span>永续</span>']) {
    const row = createRow({ symbol: '龙虾USDT' }).replace('龙虾USDT永续', cell);
    const dom = loadFixtureDom(`<section>${row}${createRow({ symbol: 'BTCUSDT' })}</section>`);
    const scopeText = readOpenOrdersScopeText(dom.window.document.querySelector('section'), scopeOptions);
    assert.deepEqual(readVisibleOpenOrderSymbolsText(scopeText), ['龙虾USDT', 'BTCUSDT']);
    assert.equal(isOpenOrdersScopeLimitedToSymbolText(scopeText, 'BTCUSDT'), false);
  }
  const dom = loadFixtureDom(`<section>${createRow({ symbol: '龙虾USDT' }).replace('龙虾USDT永续', '龙虾USDT')}</section>`);
  const scopeText = readOpenOrdersScopeText(dom.window.document.querySelector('section'), scopeOptions);
  assert.deepEqual(readVisibleOpenOrderSymbolsText(scopeText), ['龙虾USDT']);
  assert.equal(isCurrentSymbolOpenOrdersFilterReady({ scopeText, symbol: '龙虾USDT', filterChecked: true, cancelAllAvailable: true }), true);
  assert.equal(isCurrentSymbolOpenOrdersClearCandidate({ scopeText, symbol: '龙虾USDT', openOrdersCount: 1 }), false);
});

test('scope evidence keeps contracts surrounded by Unicode whitespace', () => {
  for (const [symbol, cell] of [
    ['龙虾USDT', '\u00a0龙虾USDT\u00a0'],
    ['4USDT', '\u202f4USDT\u202f'],
  ]) {
    const row = createRow({ symbol }).replace(`${symbol}永续`, cell);
    const mixedDom = loadFixtureDom(`<section>${row}${createRow({ symbol: 'BTCUSDT' })}</section>`);
    const mixedScopeText = readOpenOrdersScopeText(mixedDom.window.document.querySelector('section'), scopeOptions);
    assert.deepEqual(readVisibleOpenOrderSymbolsText(mixedScopeText), [symbol, 'BTCUSDT']);
    assert.equal(isOpenOrdersScopeLimitedToSymbolText(mixedScopeText, 'BTCUSDT'), false);
    assert.equal(isCurrentSymbolOpenOrdersFilterReady({
      scopeText: mixedScopeText, symbol: 'BTCUSDT', filterChecked: true, cancelAllAvailable: true,
    }), false);
    assert.equal(isCurrentSymbolOpenOrdersClearCandidate({
      scopeText: mixedScopeText, symbol: 'BTCUSDT', openOrdersCount: 2,
    }), false);

    const singleDom = loadFixtureDom(`<section>${row}</section>`);
    const singleScopeText = readOpenOrdersScopeText(singleDom.window.document.querySelector('section'), scopeOptions);
    assert.deepEqual(readVisibleOpenOrderSymbolsText(singleScopeText), [symbol]);
    assert.equal(isCurrentSymbolOpenOrdersFilterReady({
      scopeText: singleScopeText, symbol, filterChecked: true, cancelAllAvailable: true,
    }), true);
    assert.equal(isCurrentSymbolOpenOrdersClearCandidate({
      scopeText: singleScopeText, symbol, openOrdersCount: 1,
    }), false);
  }
});

test('scope evidence rejects an unidentified visible row instead of dropping it', () => {
  const invalidRow = createRow({ symbol: '龙虾USDT' }).replace('龙虾USDT永续', 'unidentified contract');
  const dom = loadFixtureDom(`<section>${invalidRow}${createRow({ symbol: 'BTCUSDT' })}</section>`);
  assert.throws(() => readOpenOrdersScopeText(dom.window.document.querySelector('section'), scopeOptions), /Invalid visible open-order symbol/);
});

test('scope text preserves the existing empty-state contract', () => {
  const dom = loadFixtureDom('<section><span>隐藏其他合约</span><div>暂无当前委托。</div></section>');
  assert.equal(readOpenOrdersScopeText(dom.window.document.querySelector('section'), scopeOptions), '隐藏其他合约暂无当前委托。');
  assert.equal(readOpenOrdersScopeText(null, scopeOptions), '');
});
