import test from 'node:test';
import assert from 'node:assert/strict';

import { isVisibleElement, loadFixtureDom } from '../../helpers/dom.js';
import {
  assertSameBinanceChartOrdersTarget,
  findActiveBinanceChartOrdersPopover,
  getBinanceChartOrdersTarget,
} from '../../../src/binance-orderbook-trade/dom/chart-orders.js';

function createChartMarkup({ mode = 'tradingview', popoverId = 'chart-orders-menu' } = {}) {
  const chartBody = mode === 'tradingview'
    ? '<div id="chart_futures-tradingview"><iframe id="tradingview_fixture"></iframe></div>'
    : '<div data-testid="basic-chart"></div>';
  return `
    <div class="chart-widget-root">
      <div class="bn-flex h-full flex-col">
        <header>
          <div class="flex items-center gap-[--space-m]">
            <div class="flex items-center gap-[--space-m]">
              <span>intervals</span>
              <span class="bn-tooltips-wrap bn-tooltips-web" data-testid="orders-trigger">
                <span class="bn-tooltips-ele" aria-describedby="${popoverId}">orders</span>
              </span>
              <span class="contents" data-testid="latest-price">latest</span>
            </div>
            <div class="draggableHandle"></div>
          </div>
        </header>
        ${chartBody}
      </div>
    </div>
  `;
}

function createPopoverMarkup({
  labels = ['快捷下单', '当前委托', '持有仓位', '历史委托', '损益两平价', '强平价格', '价格提醒', '订单预览线'],
  openOrdersChecked = 'true',
  popoverId = 'chart-orders-menu',
} = {}) {
  return `
    <div id="${popoverId}" role="tooltip" class="bn-bubble active">
      ${labels.map((label) => `
        <div role="checkbox" aria-checked="${/^(?:当前委托|Open Orders)$/i.test(label) ? openOrdersChecked : 'false'}">${label}</div>
      `).join('')}
    </div>
  `;
}

function getContract(dom) {
  const { document } = dom.window;
  return {
    document,
    target: getBinanceChartOrdersTarget(document),
  };
}

function makeLatestPriceSlotBoxless(document) {
  const latestPriceSlot = document.querySelector('[data-testid="latest-price"]');
  latestPriceSlot.getClientRects = () => [];
  latestPriceSlot.getBoundingClientRect = () => ({
    width: 0,
    height: 0,
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  });
}

test('locates the shared Binance chart OpenOrders target in TradingView and Basic modes', () => {
  for (const mode of ['tradingview', 'basic']) {
    const dom = loadFixtureDom(createChartMarkup({ mode }));
    makeLatestPriceSlotBoxless(dom.window.document);
    const target = getBinanceChartOrdersTarget(dom.window.document);

    assert.equal(target.chartRoot.className, 'chart-widget-root');
    assert.equal(target.trigger.getAttribute('data-testid'), 'orders-trigger');
    assert.equal(target.popoverId, 'chart-orders-menu');
  }
});

test('chart target discovery rejects missing, hidden, ambiguous, or incomplete structural contracts', () => {
  const missingDom = loadFixtureDom('<div></div>');
  assert.throws(
    () => getBinanceChartOrdersTarget(missingDom.window.document),
    /Binance chart orders target is unavailable/,
  );

  const hiddenDom = loadFixtureDom(createChartMarkup());
  hiddenDom.window.document.querySelector('.chart-widget-root').setAttribute('data-hidden', '');
  assert.throws(
    () => getBinanceChartOrdersTarget(hiddenDom.window.document),
    /Binance chart orders target is unavailable/,
  );

  const duplicateDom = loadFixtureDom(`${createChartMarkup()}${createChartMarkup()}`);
  assert.throws(
    () => getBinanceChartOrdersTarget(duplicateDom.window.document),
    /Expected one visible Binance chart root, found 2/,
  );

  const incompleteDom = loadFixtureDom(createChartMarkup());
  incompleteDom.window.document.querySelector('.bn-tooltips-ele').removeAttribute('aria-describedby');
  assert.throws(
    () => getBinanceChartOrdersTarget(incompleteDom.window.document),
    /Expected one Binance chart orders popover reference, found 0/,
  );
});

test('finds the trigger-linked OpenOrders checkbox in TradingView and ten-item Basic popovers', () => {
  const tradingViewDom = loadFixtureDom(`${createChartMarkup()}${createPopoverMarkup()}`);
  const tradingView = getContract(tradingViewDom);
  const tradingViewResult = findActiveBinanceChartOrdersPopover(
    tradingView.document,
    tradingView.target,
    isVisibleElement,
  );
  assert.equal(tradingViewResult.checkbox.textContent.trim(), '当前委托');
  assert.equal(tradingViewResult.checked, true);

  const basicLabels = [
    '快捷下单',
    'Open Orders',
    '持有仓位',
    '历史委托',
    '损益两平价',
    '强平价格',
    '价格提醒',
    '价格线',
    '刻度',
    '订单预览线',
  ];
  const basicDom = loadFixtureDom(`
    ${createChartMarkup({ mode: 'basic' })}
    ${createPopoverMarkup({ labels: basicLabels, openOrdersChecked: 'false' })}
  `);
  const basic = getContract(basicDom);
  const basicResult = findActiveBinanceChartOrdersPopover(
    basic.document,
    basic.target,
    isVisibleElement,
  );
  assert.equal(basicResult.checkbox.textContent.trim(), 'Open Orders');
  assert.equal(basicResult.checked, false);
});

test('ignores active lookalike popovers that are not linked to the chart trigger', () => {
  const dom = loadFixtureDom(`
    ${createChartMarkup()}
    ${createPopoverMarkup({ popoverId: 'another-menu' })}
  `);
  const { document, target } = getContract(dom);

  assert.equal(
    findActiveBinanceChartOrdersPopover(document, target, isVisibleElement),
    null,
  );
});

test('waits when the linked popover has not rendered an OpenOrders checkbox yet', () => {
  const dom = loadFixtureDom(`
    ${createChartMarkup()}
    ${createPopoverMarkup({ labels: ['快捷下单', '持有仓位'] })}
  `);
  const { document, target } = getContract(dom);

  assert.equal(
    findActiveBinanceChartOrdersPopover(document, target, isVisibleElement),
    null,
  );
});

test('invalid or duplicate OpenOrders checkboxes fail explicitly', () => {
  const invalidStateDom = loadFixtureDom(`
    ${createChartMarkup()}
    ${createPopoverMarkup({ openOrdersChecked: 'mixed' })}
  `);
  const invalidState = getContract(invalidStateDom);
  assert.throws(
    () => findActiveBinanceChartOrdersPopover(
      invalidState.document,
      invalidState.target,
      isVisibleElement,
    ),
    /OpenOrders state is mixed/,
  );

  const duplicateLabels = [
    '快捷下单',
    '当前委托',
    'Open Orders',
    '持有仓位',
    '历史委托',
    '损益两平价',
    '强平价格',
    '价格提醒',
  ];
  const duplicateDom = loadFixtureDom(`
    ${createChartMarkup()}
    ${createPopoverMarkup({ labels: duplicateLabels })}
  `);
  const duplicate = getContract(duplicateDom);
  assert.throws(
    () => findActiveBinanceChartOrdersPopover(
      duplicate.document,
      duplicate.target,
      isVisibleElement,
    ),
    /Expected one Binance chart OpenOrders checkbox, found 2/,
  );
});

test('a replaced chart root, toolbar, or trigger is rejected before restoration', () => {
  const dom = loadFixtureDom(createChartMarkup());
  const oldTarget = getBinanceChartOrdersTarget(dom.window.document);

  const replacement = loadFixtureDom(createChartMarkup());
  const newTarget = getBinanceChartOrdersTarget(replacement.window.document);
  assert.throws(
    () => assertSameBinanceChartOrdersTarget(oldTarget, newTarget),
    /Binance chart orders target changed/,
  );

  const sameRootTarget = { ...oldTarget, toolbar: newTarget.toolbar };
  assert.throws(
    () => assertSameBinanceChartOrdersTarget(oldTarget, sameRootTarget),
    /Binance chart orders target changed/,
  );

  const sameToolbarTarget = { ...oldTarget, trigger: newTarget.trigger };
  assert.throws(
    () => assertSameBinanceChartOrdersTarget(oldTarget, sameToolbarTarget),
    /Binance chart orders target changed/,
  );

  const changedPopoverTarget = { ...oldTarget, popoverId: 'replacement-menu' };
  assert.throws(
    () => assertSameBinanceChartOrdersTarget(oldTarget, changedPopoverTarget),
    /Binance chart orders target changed/,
  );
});
