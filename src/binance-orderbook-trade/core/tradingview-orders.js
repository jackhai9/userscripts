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

  return { chart, visible };
}

function validateVisibilityState(state) {
  if (
    !state
    || typeof state.chart !== 'object'
    || typeof state.originalVisible !== 'boolean'
    || typeof state.changed !== 'boolean'
  ) {
    throw new Error('TradingView showOrders state is invalid');
  }
}

function assertSameChart(state, chart) {
  if (state.chart !== chart) {
    throw new Error('Binance TradingView active chart changed');
  }
}

export function assertTradingViewOrdersTarget(tradingViewApi, state) {
  validateVisibilityState(state);
  const { chart } = getTradingViewOrdersContract(tradingViewApi);
  assertSameChart(state, chart);
}

export function captureTradingViewOrdersVisibility(tradingViewApi) {
  const { chart, visible } = getTradingViewOrdersContract(tradingViewApi);
  return { chart, originalVisible: visible, changed: false };
}

export function readTradingViewOrdersVisibility(tradingViewApi) {
  return getTradingViewOrdersContract(tradingViewApi).visible;
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
  assertTradingViewOrdersTarget(tradingViewApi, state);
  if (!state.originalVisible) return;

  // Cleanup must restore the original visibility even if post-apply verification fails.
  state.changed = true;
  applyTradingViewOrdersVisibility(tradingViewApi, false);
}

export function restoreTradingViewOrders(tradingViewApi, state) {
  assertTradingViewOrdersTarget(tradingViewApi, state);
  if (!state.changed) return;

  applyTradingViewOrdersVisibility(tradingViewApi, state.originalVisible);
}
