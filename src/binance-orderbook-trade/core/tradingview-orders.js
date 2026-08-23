function getTradingViewOrdersContract(tradingViewApi) {
  if (!tradingViewApi || typeof tradingViewApi.activeChart !== 'function') {
    throw new Error('TradingView API is unavailable');
  }

  const chart = tradingViewApi.activeChart();
  if (!chart || typeof chart.properties !== 'function' || typeof chart.applyOverrides !== 'function') {
    throw new Error('TradingView active chart API is unavailable');
  }

  const showOrders = chart.properties()?.tradingProperties?.showOrders;
  if (!showOrders || typeof showOrders.value !== 'function') {
    throw new Error('TradingView showOrders property is unavailable');
  }

  const visible = showOrders.value();
  if (typeof visible !== 'boolean') {
    throw new Error('TradingView showOrders property is not boolean');
  }

  return { chart, showOrders, visible };
}

export function captureTradingViewOrdersVisibility(tradingViewApi) {
  const { visible } = getTradingViewOrdersContract(tradingViewApi);
  return { originalVisible: visible, changed: false };
}

export function assertSameTradingViewOrdersTarget(capturedTarget, currentTarget) {
  if (
    !capturedTarget ||
    !currentTarget ||
    capturedTarget.frame !== currentTarget.frame ||
    capturedTarget.contentWindow !== currentTarget.contentWindow ||
    capturedTarget.tradingViewApi !== currentTarget.tradingViewApi ||
    capturedTarget.chart !== currentTarget.chart
  ) {
    throw new Error('Binance TradingView target changed');
  }
}

export function applyTradingViewOrdersVisibility(tradingViewApi, visible) {
  if (typeof visible !== 'boolean') {
    throw new Error('TradingView showOrders target is not boolean');
  }

  const { chart } = getTradingViewOrdersContract(tradingViewApi);
  chart.applyOverrides({ 'tradingProperties.showOrders': visible });

  const applied = getTradingViewOrdersContract(tradingViewApi).visible;
  if (applied !== visible) {
    throw new Error(`TradingView showOrders remained ${applied}`);
  }
}

export function hideTradingViewOrders(tradingViewApi, state) {
  if (!state || typeof state.originalVisible !== 'boolean' || typeof state.changed !== 'boolean') {
    throw new Error('TradingView showOrders state is invalid');
  }
  if (!state.originalVisible) return;

  // Mark the state first so cleanup still restores it if the override applies
  // but the immediate verification path throws.
  state.changed = true;
  applyTradingViewOrdersVisibility(tradingViewApi, false);
}

export function restoreTradingViewOrders(tradingViewApi, state) {
  if (!state || typeof state.originalVisible !== 'boolean' || typeof state.changed !== 'boolean') {
    throw new Error('TradingView showOrders state is invalid');
  }
  if (!state.changed) return;

  applyTradingViewOrdersVisibility(tradingViewApi, state.originalVisible);
}
