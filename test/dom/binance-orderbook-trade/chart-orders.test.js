import test from 'node:test';
import assert from 'node:assert/strict';

import { isVisibleElement, loadFixtureDom } from '../../helpers/dom.js';
import {
  assertSameBinanceChartOrdersTarget,
  findActiveBinanceChartOrdersPopover,
  findBinanceChartOrdersTarget,
  getBinanceChartOrdersTarget,
} from '../../../src/binance-orderbook-trade/dom/chart-orders.js';

function createChartMarkup({
  mode = 'tradingview',
  popoverId = 'chart-orders-menu',
  latestPriceLabel = '最新价格',
  wrapLatestPrice = false,
} = {}) {
  const chartBody = mode === 'tradingview'
    ? '<div id="chart_futures-tradingview"><iframe id="tradingview_fixture"></iframe></div>'
    : '<div data-testid="basic-chart"><iframe id="basic_fixture"></iframe></div>';
  const latestPriceControl = `
    <span class="bn-tooltips-wrap bn-tooltips-web w-full cursor-pointer" data-testid="latest-price">
      ${latestPriceLabel}
    </span>
  `;
  const latestPriceSlot = wrapLatestPrice
    ? `<span class="contents">${latestPriceControl}</span>`
    : latestPriceControl;
  return `
    <div class="chart-widget-root">
      <div class="flex items-center gap-[--space-m]" data-testid="chart-toolbar">
        <span>intervals</span>
        <span class="bn-tooltips-wrap bn-tooltips-web" data-testid="screenshot-trigger">shot</span>
        <span class="bn-tooltips-wrap bn-tooltips-web" data-testid="orders-trigger">
          <span class="bn-tooltips-ele" aria-describedby="${popoverId}">orders</span>
        </span>
        ${latestPriceSlot}
      </div>
      ${chartBody}
    </div>
  `;
}

function createPopoverMarkup({
  labels = ['快捷下单', '当前委托', '持有仓位', '历史委托'],
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

function loadChartTarget(options = {}) {
  const dom = loadFixtureDom(createChartMarkup(options));
  const tradingViewApi = { saveChart() {}, subscribe() {}, unsubscribe() {} };
  dom.window.document.querySelector('iframe').contentWindow.tradingViewApi = tradingViewApi;
  return { dom, tradingViewApi };
}

test('locates the current chart Open Orders target in TradingView and Basic modes', () => {
  for (const mode of ['tradingview', 'basic']) {
    const { dom, tradingViewApi } = loadChartTarget({ mode });
    const target = getBinanceChartOrdersTarget(dom.window.document);

    assert.equal(target.chartRoot.className, 'chart-widget-root');
    assert.equal(target.toolbar.getAttribute('data-testid'), 'chart-toolbar');
    assert.equal(target.trigger.getAttribute('data-testid'), 'orders-trigger');
    assert.equal(target.popoverId, 'chart-orders-menu');
    assert.equal(target.tradingViewApi, tradingViewApi);
  }
});

test('supports the English current-price label without broad text scanning', () => {
  const { dom } = loadChartTarget({ latestPriceLabel: 'Last Price' });
  assert.equal(
    getBinanceChartOrdersTarget(dom.window.document).trigger.getAttribute('data-testid'),
    'orders-trigger',
  );
});

test('supports Binance wrapping the current-price control in a contents slot', () => {
  const { dom } = loadChartTarget({ wrapLatestPrice: true });
  assert.equal(
    getBinanceChartOrdersTarget(dom.window.document).trigger.getAttribute('data-testid'),
    'orders-trigger',
  );
});

test('find waits for a visible complete and unambiguous chart contract', () => {
  const missingDom = loadFixtureDom('<div></div>');
  assert.equal(findBinanceChartOrdersTarget(missingDom.window.document), null);

  const hidden = loadChartTarget();
  hidden.dom.window.document.querySelector('.chart-widget-root').setAttribute('data-hidden', '');
  assert.equal(findBinanceChartOrdersTarget(hidden.dom.window.document), null);

  const incomplete = loadChartTarget();
  incomplete.dom.window.document.querySelector('[aria-describedby]').removeAttribute('aria-describedby');
  assert.throws(
    () => getBinanceChartOrdersTarget(incomplete.dom.window.document),
    /Expected one Binance chart orders popover reference, found 0/,
  );

  const first = loadChartTarget();
  const duplicateRoot = first.dom.window.document.createElement('div');
  duplicateRoot.innerHTML = createChartMarkup();
  first.dom.window.document.body.append(duplicateRoot.firstElementChild);
  assert.throws(
    () => getBinanceChartOrdersTarget(first.dom.window.document),
    /Expected one visible Binance chart root, found 2/,
  );
});

test('finds the trigger-linked Chinese or English Open Orders checkbox', () => {
  for (const label of ['当前委托', 'Open Orders']) {
    const { dom } = loadChartTarget();
    dom.window.document.body.insertAdjacentHTML(
      'beforeend',
      createPopoverMarkup({ labels: ['快捷下单', label, '持有仓位'], openOrdersChecked: 'false' }),
    );
    const target = getBinanceChartOrdersTarget(dom.window.document);
    const result = findActiveBinanceChartOrdersPopover(
      dom.window.document,
      target,
      isVisibleElement,
    );

    assert.equal(result.checkbox.textContent.trim(), label);
    assert.equal(result.checked, false);
  }
});

test('ignores active lookalike popovers not linked to the chart trigger', () => {
  const { dom } = loadChartTarget();
  dom.window.document.body.insertAdjacentHTML(
    'beforeend',
    createPopoverMarkup({ popoverId: 'another-menu' }),
  );
  const target = getBinanceChartOrdersTarget(dom.window.document);

  assert.equal(
    findActiveBinanceChartOrdersPopover(dom.window.document, target, isVisibleElement),
    null,
  );
});

test('invalid or duplicate Open Orders checkboxes fail explicitly', () => {
  const invalid = loadChartTarget();
  invalid.dom.window.document.body.insertAdjacentHTML(
    'beforeend',
    createPopoverMarkup({ openOrdersChecked: 'mixed' }),
  );
  assert.throws(
    () => findActiveBinanceChartOrdersPopover(
      invalid.dom.window.document,
      getBinanceChartOrdersTarget(invalid.dom.window.document),
      isVisibleElement,
    ),
    /OpenOrders state is mixed/,
  );

  const duplicate = loadChartTarget();
  duplicate.dom.window.document.body.insertAdjacentHTML(
    'beforeend',
    createPopoverMarkup({ labels: ['当前委托', 'Open Orders'] }),
  );
  assert.throws(
    () => findActiveBinanceChartOrdersPopover(
      duplicate.dom.window.document,
      getBinanceChartOrdersTarget(duplicate.dom.window.document),
      isVisibleElement,
    ),
    /Expected one Binance chart OpenOrders checkbox, found 2/,
  );
});

test('rejects a replaced chart root toolbar trigger or runtime', () => {
  const first = loadChartTarget();
  const second = loadChartTarget();
  const oldTarget = getBinanceChartOrdersTarget(first.dom.window.document);
  const newTarget = getBinanceChartOrdersTarget(second.dom.window.document);

  assert.throws(
    () => assertSameBinanceChartOrdersTarget(oldTarget, newTarget),
    /Binance chart orders target changed/,
  );
  assert.throws(
    () => assertSameBinanceChartOrdersTarget(oldTarget, {
      ...oldTarget,
      toolbar: newTarget.toolbar,
    }),
    /Binance chart orders target changed/,
  );
  assert.throws(
    () => assertSameBinanceChartOrdersTarget(oldTarget, {
      ...oldTarget,
      trigger: newTarget.trigger,
    }),
    /Binance chart orders target changed/,
  );
  assert.throws(
    () => assertSameBinanceChartOrdersTarget(oldTarget, {
      ...oldTarget,
      tradingViewApi: newTarget.tradingViewApi,
    }),
    /Binance chart orders target changed/,
  );
});
