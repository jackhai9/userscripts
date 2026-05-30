import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findOpenOrdersTab,
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
