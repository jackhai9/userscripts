import test from 'node:test';
import assert from 'node:assert/strict';

import { loadFixtureDom } from '../../helpers/dom.js';
import {
  findBinanceTradingViewTarget,
  getBinanceTradingViewTarget,
} from '../../../src/binance-orderbook-trade/dom/tradingview-target.js';

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

test('locates the one TradingView API used by TradingView and Basic chart modes', () => {
  for (const mode of ['tradingview', 'basic']) {
    const { dom, api } = loadChartTarget({ mode });
    const target = getBinanceTradingViewTarget(dom.window.document);

    assert.equal(target.chartRoot.className, 'chart-widget-root');
    assert.equal(target.tradingViewApi, api);
  }
});

test('target discovery does not depend on the native chart settings menu', () => {
  const { dom, api } = loadChartTarget();
  assert.equal(dom.window.document.querySelector('[aria-describedby]'), null);
  assert.equal(getBinanceTradingViewTarget(dom.window.document).tradingViewApi, api);
});

test('find waits for the visible chart root and TradingView API', () => {
  const missingDom = loadFixtureDom('<div></div>');
  assert.equal(findBinanceTradingViewTarget(missingDom.window.document), null);

  const hiddenDom = loadFixtureDom(createChartMarkup());
  hiddenDom.window.document.querySelector('.chart-widget-root').setAttribute('data-hidden', '');
  assert.equal(findBinanceTradingViewTarget(hiddenDom.window.document), null);

  const apiPendingDom = loadFixtureDom(createChartMarkup());
  assert.equal(findBinanceTradingViewTarget(apiPendingDom.window.document), null);
});

test('get rejects an unavailable TradingView target', () => {
  const dom = loadFixtureDom(createChartMarkup());
  assert.throws(
    () => getBinanceTradingViewTarget(dom.window.document),
    /未找到可用图表接口/,
  );
});

test('target discovery rejects ambiguous chart roots or TradingView APIs', () => {
  const duplicateRootDom = loadFixtureDom(`${createChartMarkup()}${createChartMarkup()}`);
  assert.throws(
    () => findBinanceTradingViewTarget(duplicateRootDom.window.document),
    /可见图表区域数量异常：2/,
  );

  const { dom } = loadChartTarget();
  const secondFrame = dom.window.document.createElement('iframe');
  dom.window.document.querySelector('.chart-widget-root').append(secondFrame);
  secondFrame.contentWindow.tradingViewApi = { activeChart() {} };
  assert.throws(
    () => findBinanceTradingViewTarget(dom.window.document),
    /图表接口数量异常：2/,
  );
});
