import test from 'node:test';
import assert from 'node:assert/strict';

import { isVisibleElement, loadFixtureDom } from '../../helpers/dom.js';
import {
  assertSameBinanceChartOrdersTarget,
  findActiveBinanceChartOrdersPopover,
  getBinanceChartOrdersTarget,
} from '../../../src/binance-orderbook-trade/dom/chart-orders.js';

function createChartMarkup() {
  return `
    <div class="chart-widget-root">
      <div class="bn-flex h-full flex-col">
        <header>
          <div class="flex items-center gap-[--space-m]">
            <div class="flex items-center gap-[--space-m]">
              <span>intervals</span>
              <span class="bn-tooltips-wrap bn-tooltips-web" data-testid="orders-trigger">orders</span>
              <span class="contents" data-testid="latest-price">latest</span>
            </div>
            <div class="draggableHandle"></div>
          </div>
        </header>
        <div id="chart_futures-tradingview">
          <iframe id="tradingview_fixture"></iframe>
        </div>
      </div>
    </div>
  `;
}

function createPopoverMarkup({ label = '当前委托', checked = 'true' } = {}) {
  const labels = ['快捷下单', label, '持有仓位', '历史委托', '损益两平价', '强平价格', '价格提醒', '订单预览线'];
  return `
    <div class="bn-bubble active">
      ${labels.map((item, index) => `
        <div role="checkbox" aria-checked="${index === 1 ? checked : 'false'}">${item}</div>
      `).join('')}
    </div>
  `;
}

test('locates the Binance chart frame and the structural OpenOrders menu trigger', () => {
  const dom = loadFixtureDom(createChartMarkup());
  const target = getBinanceChartOrdersTarget(dom.window.document);

  assert.equal(target.frame.id, 'tradingview_fixture');
  assert.equal(target.chartRoot.className, 'chart-widget-root');
  assert.equal(target.trigger.getAttribute('data-testid'), 'orders-trigger');
});

test('chart target discovery rejects missing or ambiguous structural contracts', () => {
  const missingDom = loadFixtureDom('<div></div>');
  assert.throws(
    () => getBinanceChartOrdersTarget(missingDom.window.document),
    /Binance chart orders target is unavailable/,
  );

  const duplicateDom = loadFixtureDom(`${createChartMarkup()}${createChartMarkup()}`);
  assert.throws(
    () => getBinanceChartOrdersTarget(duplicateDom.window.document),
    /Expected one Binance chart iframe, found 2/,
  );
});

test('finds only the active eight-item Binance OpenOrders popover and reads exact state', () => {
  const chineseDom = loadFixtureDom(createPopoverMarkup());
  const chinese = findActiveBinanceChartOrdersPopover(chineseDom.window.document, isVisibleElement);
  assert.equal(chinese.checkbox.textContent.trim(), '当前委托');
  assert.equal(chinese.checked, true);

  const englishDom = loadFixtureDom(createPopoverMarkup({ label: 'Open Orders', checked: 'false' }));
  const english = findActiveBinanceChartOrdersPopover(englishDom.window.document, isVisibleElement);
  assert.equal(english.checkbox.textContent.trim(), 'Open Orders');
  assert.equal(english.checked, false);
});

test('rejects lookalike popovers with a wrong second label or item count', () => {
  const wrongLabelDom = loadFixtureDom(createPopoverMarkup({ label: 'Positions' }));
  assert.equal(
    findActiveBinanceChartOrdersPopover(wrongLabelDom.window.document, isVisibleElement),
    null,
  );

  const wrongCountDom = loadFixtureDom(`
    <div class="bn-bubble active">
      <div role="checkbox" aria-checked="true">快捷下单</div>
      <div role="checkbox" aria-checked="true">当前委托</div>
    </div>
  `);
  assert.equal(
    findActiveBinanceChartOrdersPopover(wrongCountDom.window.document, isVisibleElement),
    null,
  );
});

test('invalid OpenOrders state and multiple matching popovers fail explicitly', () => {
  const invalidStateDom = loadFixtureDom(createPopoverMarkup({ checked: 'mixed' }));
  assert.throws(
    () => findActiveBinanceChartOrdersPopover(invalidStateDom.window.document, isVisibleElement),
    /OpenOrders state is mixed/,
  );

  const duplicateDom = loadFixtureDom(`${createPopoverMarkup()}${createPopoverMarkup()}`);
  assert.throws(
    () => findActiveBinanceChartOrdersPopover(duplicateDom.window.document, isVisibleElement),
    /Expected at most one Binance chart OpenOrders popover, found 2/,
  );
});

test('a replaced chart frame or root is rejected before restoration', () => {
  const oldDom = loadFixtureDom(createChartMarkup());
  const newDom = loadFixtureDom(createChartMarkup());
  const oldTarget = getBinanceChartOrdersTarget(oldDom.window.document);
  const newTarget = getBinanceChartOrdersTarget(newDom.window.document);

  assert.throws(
    () => assertSameBinanceChartOrdersTarget(oldTarget, newTarget),
    /Binance chart orders target changed/,
  );
});
