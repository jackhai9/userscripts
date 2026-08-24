import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findTradePanelInsertionPoint,
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
