import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectTradeButtonsFromScopes,
  findCurrentLeverageButtonFromScopes,
  isTradeModeTab,
  parseLeverageButtonText,
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

test('reads the unique split leverage button from the active trade scope', () => {
  const { window } = loadFixtureDom(`
    <section id="trade-form">
      <button>全仓</button>
      <button>5x</button>
      <button>开多</button>
    </section>
    <aside><button>20x</button></aside>
  `);
  const scope = window.document.querySelector('#trade-form');
  const button = findCurrentLeverageButtonFromScopes([scope], {
    panelId: 'jh-binance-close-qty-multiplier-panel',
    isVisibleElement,
  });

  assert.equal(button?.textContent.trim(), '5x');
  assert.equal(parseLeverageButtonText(button?.textContent), 5);
  assert.equal(parseLeverageButtonText('全仓 5x'), null);
});

test('rejects ambiguous leverage buttons in the active trade scope', () => {
  const { window } = loadFixtureDom(`
    <section id="trade-form">
      <button>5x</button>
      <button>10x</button>
    </section>
  `);
  const scope = window.document.querySelector('#trade-form');

  assert.equal(findCurrentLeverageButtonFromScopes([scope], {
    panelId: 'jh-binance-close-qty-multiplier-panel',
    isVisibleElement,
  }), null);
});
