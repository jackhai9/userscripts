import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findOpenOrdersBasicSubTab,
  findOpenOrdersTab,
  findSelectedOpenOrdersSubTab,
  getActiveOpenOrdersScope,
} from '../../../src/binance-orderbook-trade/dom/account-orders.js';
import { isVisibleElement, loadFixtureDom } from '../../helpers/dom.js';

const openOrdersHtml = await readFile(new URL('../../fixtures/binance-orderbook-trade/account-orders-open-orders.html', import.meta.url), 'utf8');
const positionHtml = await readFile(new URL('../../fixtures/binance-orderbook-trade/account-orders-position.html', import.meta.url), 'utf8');

test('selects the bottom account-orders open-orders tab over unrelated tab groups', () => {
  const { window } = loadFixtureDom(openOrdersHtml);
  const tab = findOpenOrdersTab(window.document, { isVisibleElement });

  assert.equal(tab?.textContent.trim(), '当前委托(2)');
  assert.equal(tab?.closest('#account-orders') != null, true);
});

test('does not trust aria-controls alone when resolving current-orders pane', () => {
  const { window } = loadFixtureDom(openOrdersHtml);
  const scope = getActiveOpenOrdersScope(window.document, {
    isVisibleElement,
    findHideOtherSymbolCheckbox: (root) => root.querySelector('[role="checkbox"][name="hideOtherSymbol"]'),
    findCurrentSymbolCancelAllButton: (root) => Array.from(root.querySelectorAll('button')).find((button) => button.textContent.trim() === '全撤') || null,
  });

  assert.equal(scope?.id, 'account-orders');
  assert.equal(scope.querySelector('#wrong-pane') != null, true);
});

test('returns no active open-orders scope when current-orders tab is not active', () => {
  const { window } = loadFixtureDom(positionHtml);
  const scope = getActiveOpenOrdersScope(window.document, {
    isVisibleElement,
    findHideOtherSymbolCheckbox: (root) => root.querySelector('[role="checkbox"][name="hideOtherSymbol"]'),
    findCurrentSymbolCancelAllButton: (root) => Array.from(root.querySelectorAll('button')).find((button) => button.textContent.trim() === '全撤') || null,
  });

  assert.equal(scope, null);
});

test('does not treat stale position content as active open-orders scope', () => {
  const { window } = loadFixtureDom(`
    <section id="account-orders">
      <div class="account-tab-group">
        <div role="tab" aria-selected="false">仓位(1)</div>
        <div role="tab" aria-selected="true">当前委托(9)</div>
        <div role="tab" aria-selected="false">历史委托</div>
        <div role="tab" aria-selected="false">历史成交</div>
        <div role="tab" aria-selected="false">资金流水</div>
      </div>
      <div id="stale-position-pane">
        <label role="checkbox" name="hideOtherSymbol" aria-checked="false">隐藏其他合约</label>
        <button>市价全部平仓</button>
        <div>HYPEUSDT 永续 3x -5.64 HYPE</div>
      </div>
    </section>
  `);
  const scope = getActiveOpenOrdersScope(window.document, {
    isVisibleElement,
    findHideOtherSymbolCheckbox: (root) => root.querySelector('[role="checkbox"][name="hideOtherSymbol"]'),
    findCurrentSymbolCancelAllButton: (root) => Array.from(root.querySelectorAll('button')).find((button) => button.textContent.trim() === '全撤') || null,
  });

  assert.equal(scope, null);
});

test('finds basic open-orders sub tab when conditional sub tab is selected', () => {
  const { window } = loadFixtureDom(`
    <section id="account-orders">
      <div class="account-tab-group">
        <div role="tab" aria-selected="false">仓位(1)</div>
        <div role="tab" aria-selected="true">当前委托(5)</div>
        <div role="tab" aria-selected="false">历史委托</div>
        <div role="tab" aria-selected="false">历史成交</div>
        <div role="tab" aria-selected="false">资金流水</div>
      </div>
      <div id="open-orders-pane">
        <div role="tab" aria-selected="false">基础单(5)</div>
        <div role="tab" aria-selected="true">条件委托(0)</div>
        <label role="checkbox" name="hideOtherSymbol" aria-checked="true">隐藏其他合约</label>
        <button>全撤</button>
      </div>
    </section>
  `);
  const scope = getActiveOpenOrdersScope(window.document, {
    isVisibleElement,
    findHideOtherSymbolCheckbox: (root) => root.querySelector('[role="checkbox"][name="hideOtherSymbol"]'),
    findCurrentSymbolCancelAllButton: (root) => Array.from(root.querySelectorAll('button')).find((button) => button.textContent.trim() === '全撤') || null,
  });
  const basicTab = findOpenOrdersBasicSubTab(scope, { isVisibleElement });
  const selectedSubTab = findSelectedOpenOrdersSubTab(scope, { isVisibleElement });

  assert.equal(basicTab?.textContent.trim(), '基础单(5)');
  assert.equal(selectedSubTab?.textContent.trim(), '条件委托(0)');
});
