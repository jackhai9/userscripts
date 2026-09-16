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

test("user sees that detects open and close mode tabs in the trade form only", () => {
  // Given the current trade fields and requested values are available
  const { window } = loadFixtureDom(tradeFormHtml);
  const tabs = Array.from(window.document.querySelectorAll('[role="tab"]'));

  // When the trade form state is read or synchronized
  const observed = isTradeModeTab(tabs[0], { panelId: 'jh-binance-close-qty-multiplier-panel' });

  // Then sees that detects open and close mode tabs in the trade form only
  assert.equal(observed, true);
  assert.equal(isTradeModeTab(tabs[1], { panelId: 'jh-binance-close-qty-multiplier-panel' }), true);
});

test("user collects trade action buttons from explicit trade scopes and ignores own panel buttons", () => {
  // Given the current trade fields and requested values are available
  const { window } = loadFixtureDom(tradeFormHtml);
  const tradeScope = window.document.querySelector('#trade-form');
  const ownPanel = window.document.querySelector('#jh-binance-close-qty-multiplier-panel');

  // When the trade form state is read or synchronized
  const openButtons = collectTradeButtonsFromScopes([tradeScope, ownPanel], 'OPEN', {
    panelId: 'jh-binance-close-qty-multiplier-panel',
    isVisibleElement,
  });

  // Then collects trade action buttons from explicit trade scopes and ignores own panel buttons
  assert.deepEqual(openButtons.map((button) => button.textContent.trim()), ['开多', '开空']);
});

test("user collects the verified English trade action labels", () => {
  // Given the current trade fields and requested values are available
  const { window } = loadFixtureDom(`
    <section id="trade-form">
      <button>Open Long</button>
      <button>Open Short</button>
      <button>Close Long</button>
      <button>Close Short</button>
    </section>
  `);
  const scope = window.document.querySelector('#trade-form');

  const openButtons = collectTradeButtonsFromScopes([scope], 'OPEN', {
    panelId: 'jh-binance-close-qty-multiplier-panel',
    isVisibleElement,
  });
  // When the trade form state is read or synchronized
  const closeButtons = collectTradeButtonsFromScopes([scope], 'CLOSE', {
    panelId: 'jh-binance-close-qty-multiplier-panel',
    isVisibleElement,
  });

  // Then collects the verified English trade action labels
  assert.deepEqual(openButtons.map((button) => button.textContent.trim()), ['Open Long', 'Open Short']);
  assert.deepEqual(closeButtons.map((button) => button.textContent.trim()), ['Close Long', 'Close Short']);
});

test("user reads the unique split leverage button from the active trade scope", () => {
  // Given the current trade fields and requested values are available
  const { window } = loadFixtureDom(`
    <section id="trade-form">
      <button>全仓</button>
      <button>5x</button>
      <button>开多</button>
    </section>
    <aside><button>20x</button></aside>
  `);
  const scope = window.document.querySelector('#trade-form');
  // When the trade form state is read or synchronized
  const button = findCurrentLeverageButtonFromScopes([scope], {
    panelId: 'jh-binance-close-qty-multiplier-panel',
    isVisibleElement,
  });

  // Then reads the unique split leverage button from the active trade scope
  assert.equal(button?.textContent.trim(), '5x');
  assert.equal(parseLeverageButtonText(button?.textContent), 5);
  assert.equal(parseLeverageButtonText('全仓 5x'), null);
});

test("user rejects ambiguous leverage buttons in the active trade scope", () => {
  // Given the current trade fields and requested values are available
  const { window } = loadFixtureDom(`
    <section id="trade-form">
      <button>5x</button>
      <button>10x</button>
    </section>
  `);
  const scope = window.document.querySelector('#trade-form');

  // When the trade form state is read or synchronized
  const observed = findCurrentLeverageButtonFromScopes([scope], {
    panelId: 'jh-binance-close-qty-multiplier-panel',
    isVisibleElement,
  });

  // Then rejects ambiguous leverage buttons in the active trade scope
  assert.equal(observed, null);
});
