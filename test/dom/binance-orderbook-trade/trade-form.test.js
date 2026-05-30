import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectTradeButtonsFromScopes,
  isTradeModeTab,
} from '../../../src/binance-orderbook-trade/dom/trade-form.js';
import { isVisibleElement, loadFixtureDom } from '../../helpers/dom.js';

const tradeFormHtml = await readFile(new URL('../../fixtures/binance-orderbook-trade/right-trade-form.html', import.meta.url), 'utf8');

test('detects open and close mode tabs in the trade form only', () => {
  const { window } = loadFixtureDom(tradeFormHtml);
  const tabs = Array.from(window.document.querySelectorAll('[role="tab"]'));

  assert.equal(isTradeModeTab(tabs[0], { panelId: 'jh-binance-close-qty-multiplier-panel' }), true);
  assert.equal(isTradeModeTab(tabs[1], { panelId: 'jh-binance-close-qty-multiplier-panel' }), true);
});

test('collects trade action buttons from explicit trade scopes and ignores own panel buttons', () => {
  const { window } = loadFixtureDom(tradeFormHtml);
  const tradeScope = window.document.querySelector('#trade-form');
  const ownPanel = window.document.querySelector('#jh-binance-close-qty-multiplier-panel');

  const openButtons = collectTradeButtonsFromScopes([tradeScope, ownPanel], 'OPEN', {
    panelId: 'jh-binance-close-qty-multiplier-panel',
    isVisibleElement,
  });

  assert.deepEqual(openButtons.map((button) => button.textContent.trim()), ['开多', '开空']);
});
