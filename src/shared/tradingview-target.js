const CHART_ROOT_SELECTOR = '.chart-widget-root';

function hasVisibleBox(element) {
  if (!element?.getClientRects().length) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function findBinanceTradingViewTarget(document) {
  const chartRoots = Array.from(document.querySelectorAll(CHART_ROOT_SELECTOR))
    .filter(hasVisibleBox);
  if (!chartRoots.length) return null;
  if (chartRoots.length > 1) {
    throw new Error(`可见图表区域数量异常：${chartRoots.length}`);
  }

  const chartRoot = chartRoots[0];
  const tradingViewApis = Array.from(chartRoot.querySelectorAll('iframe'))
    .map((frame) => frame.contentWindow?.tradingViewApi)
    .filter(Boolean);
  if (!tradingViewApis.length) return null;
  if (tradingViewApis.length > 1) {
    throw new Error(`图表接口数量异常：${tradingViewApis.length}`);
  }

  return { chartRoot, tradingViewApi: tradingViewApis[0] };
}

export function getBinanceTradingViewTarget(document) {
  const target = findBinanceTradingViewTarget(document);
  if (!target) throw new Error('未找到可用图表接口');
  return target;
}
