import { captureThrownError } from '../../helpers/orderbook-migration-errors.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadFixtureDom } from '../../helpers/dom.js';
import {
  findBinanceTradingViewTarget,
  getBinanceTradingViewTarget,
} from '../../../src/shared/tradingview-target.js';

function createChartMarkup({ mode = 'tradingview' } = {}) {
  const chartBody = mode === 'tradingview'
    ? '<div id="chart_futures-tradingview"><iframe id="tradingview_fixture"></iframe></div>'
    : '<div data-testid="basic-chart"><iframe id="basic_fixture"></iframe></div>';
  return `<div class="chart-widget-root">${chartBody}</div>`;
}

function loadChartTarget({ mode = 'tradingview' } = {}) {
  const dom = loadFixtureDom(createChartMarkup({ mode }));
  const api = { activeChart() {} };
  dom.window.document.querySelector('iframe').contentWindow.tradingViewApi = api;
  return { dom, api };
}

for (const [scenarioIndex, mode] of (['tradingview', 'basic']).entries()) {
  test(`user locates the one TradingView API used by TradingView and Basic chart modes (case ${scenarioIndex + 1})`, () => {
    // Given the native fixture represents this supported scenario
    const { dom, api } = loadChartTarget({ mode });
    // When the real adapter handles this fixture
    const target = getBinanceTradingViewTarget(dom.window.document);

    // Then the user locates the one TradingView API used by TradingView and Basic chart modes
    assert.equal(target.chartRoot.className, 'chart-widget-root');
    assert.equal(target.tradingViewApi, api);
  });
}

test("user sees that target discovery does not depend on the native chart settings menu", () => {
  // Given the native chart roots and APIs are mounted
  const { dom, api } = loadChartTarget();
  // When the active TradingView target is resolved
  const observed = dom.window.document.querySelector('[aria-describedby]');

  // Then sees that target discovery does not depend on the native chart settings menu
  assert.equal(observed, null);
  assert.equal(getBinanceTradingViewTarget(dom.window.document).tradingViewApi, api);
});

test("user sees that find waits for the visible chart root and TradingView API", () => {
  // Given the native chart roots and APIs are mounted
  const missingDom = loadFixtureDom('<div></div>');
  // When the active TradingView target is resolved
  const observed = findBinanceTradingViewTarget(missingDom.window.document);

  // Then sees that find waits for the visible chart root and TradingView API
  assert.equal(observed, null);

  const hiddenDom = loadFixtureDom(createChartMarkup());
  hiddenDom.window.document.querySelector('.chart-widget-root').setAttribute('data-hidden', '');
  assert.equal(findBinanceTradingViewTarget(hiddenDom.window.document), null);

  const apiPendingDom = loadFixtureDom(createChartMarkup());
  assert.equal(findBinanceTradingViewTarget(apiPendingDom.window.document), null);
});

test("user sees that get rejects an unavailable TradingView target", () => {
  // Given the native chart roots and APIs are mounted
  const dom = loadFixtureDom(createChartMarkup());
  // When the active TradingView target is resolved
  const observedFailure = captureThrownError(() => getBinanceTradingViewTarget(dom.window.document));

  // Then sees that get rejects an unavailable TradingView target
  assert.match(observedFailure.message, /未找到可用图表接口/);
});

test("user sees that target discovery rejects ambiguous chart roots or TradingView APIs", () => {
  // Given the native chart roots and APIs are mounted
  const duplicateRootDom = loadFixtureDom(`${createChartMarkup()}${createChartMarkup()}`);
  // When the active TradingView target is resolved
  const observedFailure = captureThrownError(() => findBinanceTradingViewTarget(duplicateRootDom.window.document));

  // Then sees that target discovery rejects ambiguous chart roots or TradingView APIs
  assert.match(observedFailure.message, /可见图表区域数量异常：2/);

  const { dom } = loadChartTarget();
  const secondFrame = dom.window.document.createElement('iframe');
  dom.window.document.querySelector('.chart-widget-root').append(secondFrame);
  secondFrame.contentWindow.tradingViewApi = { activeChart() {} };
  assert.throws(
    () => findBinanceTradingViewTarget(dom.window.document),
    /图表接口数量异常：2/,
  );
});
