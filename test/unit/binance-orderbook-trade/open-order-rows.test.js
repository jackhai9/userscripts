import test from 'node:test';
import assert from 'node:assert/strict';

import { loadFixtureDom } from '../../helpers/dom.js';
import {
  findOpenOrderRowElements,
  getOpenOrderRowCells,
} from '../../../src/binance-orderbook-trade/dom/open-order-rows.js';

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
