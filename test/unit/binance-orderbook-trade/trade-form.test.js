import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findTradeFormRoot,
  findTradePanelInsertionPoint,
  isTradeModeTab,
  mutationTouchesCloseQuantity,
  parseTradeModeLabel,
  placeTradePanelSpacer,
} from '../../../src/binance-orderbook-trade/dom/trade-form.js';
import { loadFixtureDom } from '../../helpers/dom.js';

const fixture = await readFile(
  new URL('../../fixtures/binance-orderbook-trade/right-trade-form.html', import.meta.url),
  'utf8',
);

test('panel insertion point is immediately before the native trade-mode row', () => {
  const dom = loadFixtureDom(fixture);
  const insertionPoint = findTradePanelInsertionPoint(dom.window.document);

  assert.equal(insertionPoint.parent.className, 'trade-header');
  assert.equal(insertionPoint.before.className, 'trade-mode-row');
  assert.equal(insertionPoint.before.previousElementSibling.className, 'quick-controls');
});

test('English trade-mode labels use the same panel insertion contract', () => {
  const dom = loadFixtureDom(
    fixture.replace('>开仓<', '>Open<').replace('>平仓<', '>Close<'),
  );
  const { document } = dom.window;
  const insertionPoint = findTradePanelInsertionPoint(document);
  const tabs = Array.from(document.querySelectorAll('#position-direction [role="tab"]'));

  assert.equal(insertionPoint.parent.className, 'trade-header');
  assert.equal(insertionPoint.before.className, 'trade-mode-row');
  assert.equal(parseTradeModeLabel('Open'), 'OPEN');
  assert.equal(parseTradeModeLabel('Close'), 'CLOSE');
  assert.equal(isTradeModeTab(tabs[0], { panelId: 'jh-binance-close-qty-multiplier-panel' }), true);
  assert.equal(isTradeModeTab(tabs[1], { panelId: 'jh-binance-close-qty-multiplier-panel' }), true);
});

test('trade-mode parsing rejects action labels instead of guessing a mode', () => {
  assert.equal(parseTradeModeLabel('Open Long'), null);
  assert.equal(parseTradeModeLabel('Close Short'), null);
  assert.equal(parseTradeModeLabel('开多'), null);
  assert.equal(parseTradeModeLabel('平空'), null);
});

test('panel spacer is restored before native trade mode after a rerender moves it', () => {
  const dom = loadFixtureDom(fixture);
  const { document } = dom.window;
  const spacer = document.createElement('div');
  spacer.id = 'jh-binance-close-qty-multiplier-spacer';
  const insertionPoint = findTradePanelInsertionPoint(document);

  assert.equal(placeTradePanelSpacer(spacer, insertionPoint), true);
  assert.equal(spacer.nextElementSibling, insertionPoint.before);

  document.querySelector('.order-entry').appendChild(spacer);
  assert.notEqual(spacer.nextElementSibling, insertionPoint.before);

  assert.equal(placeTradePanelSpacer(spacer, findTradePanelInsertionPoint(document)), true);
  assert.equal(spacer.parentElement, insertionPoint.parent);
  assert.equal(spacer.nextElementSibling, insertionPoint.before);
});

test('unexpected trade-mode structure is rejected instead of inserting at a guessed location', () => {
  const dom = loadFixtureDom(`
    <main>
      <div id="position-direction">
        <div role="tab">开仓</div>
        <div role="tab">平仓</div>
      </div>
    </main>
  `);

  assert.equal(findTradePanelInsertionPoint(dom.window.document), null);
});

test('trade form root ignores duplicated Binance tab-pane IDs', () => {
  const dom = loadFixtureDom(`
    <section id="bn-tab-pane-0"><button>平空</button></section>
    <section id="bn-tab-pane-0"><button>平空</button></section>
    <section id="trade-form">
      <div id="position-direction">
        <div role="tab" aria-controls="bn-tab-pane-0" aria-selected="true">平仓</div>
      </div>
      <div data-testid="max-buy-amount">0.00 HYPE</div>
      <input id="unitAmount-close" />
      <button>平多</button>
      <button>平空</button>
    </section>
  `);
  const { document } = dom.window;
  const activeTab = document.querySelector('#position-direction [aria-selected="true"]');
  const qtyInput = document.querySelector('#unitAmount-close');

  const root = findTradeFormRoot(activeTab, qtyInput);

  assert.equal(root?.id, 'trade-form');
  assert.notEqual(root, document.getElementById('bn-tab-pane-0'));
  assert.equal(root.querySelector('[data-testid="max-buy-amount"]')?.textContent, '0.00 HYPE');
});

test('trade form root observes live position state after React replaces descendants', async () => {
  const dom = loadFixtureDom(`
    <section id="trade-form">
      <div id="position-direction">
        <div role="tab" aria-selected="true">平仓</div>
      </div>
      <div class="trade-fields">
        <div data-testid="max-buy-amount">0.42 HYPE</div>
        <input id="unitAmount-close" />
      </div>
    </section>
  `);
  const { document, MutationObserver } = dom.window;
  const activeTab = document.querySelector('#position-direction [aria-selected="true"]');
  const qtyInput = document.querySelector('#unitAmount-close');
  const root = findTradeFormRoot(activeTab, qtyInput);
  const observedTexts = [];
  const observer = new MutationObserver(() => {
    observedTexts.push(root.querySelector('[data-testid="max-buy-amount"]')?.textContent);
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true });

  document.querySelector('.trade-fields').replaceChildren();
  const maxBuy = document.createElement('div');
  maxBuy.dataset.testid = 'max-buy-amount';
  maxBuy.textContent = '0.00 HYPE';
  document.querySelector('.trade-fields').append(maxBuy);
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  observer.disconnect();

  assert.equal(root.isConnected, true);
  assert.equal(root.querySelector('[data-testid="max-buy-amount"]')?.textContent, '0.00 HYPE');
  assert.ok(observedTexts.includes('0.00 HYPE'));
});

test('recognizes only close-quantity mutations as a confirmed close snapshot', async () => {
  const dom = loadFixtureDom(`
    <section id="trade-form">
      <div data-testid="max-buy-amount">4.06 HYPE</div>
      <div class="unrelated">unchanged</div>
    </section>
  `);
  const { document, MutationObserver } = dom.window;
  const mutationBatches = [];
  const observer = new MutationObserver((mutations) => mutationBatches.push(mutations));
  observer.observe(document.querySelector('#trade-form'), {
    subtree: true,
    childList: true,
    characterData: true,
  });

  document.querySelector('.unrelated').textContent = 'changed';
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  document.querySelector('[data-testid="max-buy-amount"]').textContent = '0.00 HYPE';
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  observer.disconnect();

  assert.equal(mutationBatches.length, 2);
  assert.equal(mutationBatches[0].some(mutationTouchesCloseQuantity), false);
  assert.equal(mutationBatches[1].some(mutationTouchesCloseQuantity), true);
});
