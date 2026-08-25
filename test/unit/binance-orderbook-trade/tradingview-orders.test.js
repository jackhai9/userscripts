import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyTradingViewOrdersVisibility,
  assertTradingViewOrdersTarget,
  captureTradingViewOrdersVisibility,
  hideTradingViewOrders,
  readTradingViewOrdersVisibility,
  restoreTradingViewOrders,
} from '../../../src/binance-orderbook-trade/core/tradingview-orders.js';

function createTradingViewApi(initialVisible, { apply = true } = {}) {
  let visible = initialVisible;
  const overrides = [];
  const chart = {
    properties() {
      return {
        tradingProperties: {
          showOrders: {
            value: () => visible,
          },
        },
      };
    },
    applyOverrides(nextOverrides) {
      overrides.push(nextOverrides);
      if (apply) visible = nextOverrides['tradingProperties.showOrders'];
    },
  };

  return {
    api: { activeChart: () => chart },
    chart,
    overrides,
    visible: () => visible,
  };
}

test('visible chart orders are hidden and restored to their exact original state', () => {
  const tradingView = createTradingViewApi(true);
  const state = captureTradingViewOrdersVisibility(tradingView.api);

  hideTradingViewOrders(tradingView.api, state);
  assert.equal(readTradingViewOrdersVisibility(tradingView.api), false);
  restoreTradingViewOrders(tradingView.api, state);

  assert.equal(state.chart, tradingView.chart);
  assert.equal(state.originalVisible, true);
  assert.equal(state.changed, true);
  assert.deepEqual(tradingView.overrides, [
    { 'tradingProperties.showOrders': false },
    { 'tradingProperties.showOrders': true },
  ]);
  assert.equal(tradingView.visible(), true);
});

test('an already-hidden chart is left unchanged', () => {
  const tradingView = createTradingViewApi(false);
  const state = captureTradingViewOrdersVisibility(tradingView.api);

  hideTradingViewOrders(tradingView.api, state);
  restoreTradingViewOrders(tradingView.api, state);

  assert.equal(state.originalVisible, false);
  assert.equal(state.changed, false);
  assert.deepEqual(tradingView.overrides, []);
  assert.equal(tradingView.visible(), false);
});

test('a rejected hide remains marked for cleanup', () => {
  const tradingView = createTradingViewApi(true, { apply: false });
  const state = captureTradingViewOrdersVisibility(tradingView.api);

  assert.throws(
    () => hideTradingViewOrders(tradingView.api, state),
    /TradingView showOrders remained true/,
  );
  assert.equal(state.changed, true);
});

test('invalid TradingView contracts and targets fail explicitly', () => {
  assert.throws(() => captureTradingViewOrdersVisibility(null), /API is unavailable/);
  assert.throws(
    () => captureTradingViewOrdersVisibility({ activeChart: () => ({}) }),
    /active chart API is unavailable/,
  );
  assert.throws(
    () => captureTradingViewOrdersVisibility(createTradingViewApi('true').api),
    /property is not boolean/,
  );
  assert.throws(
    () => applyTradingViewOrdersVisibility(createTradingViewApi(true).api, 'false'),
    /target is not boolean/,
  );
});

test('a replaced active chart is rejected without writing the replacement', () => {
  const oldTradingView = createTradingViewApi(true);
  const newTradingView = createTradingViewApi(false);
  const state = captureTradingViewOrdersVisibility(oldTradingView.api);

  oldTradingView.api.activeChart = () => newTradingView.chart;

  assert.throws(
    () => hideTradingViewOrders(oldTradingView.api, state),
    /active chart changed/,
  );
  assert.deepEqual(newTradingView.overrides, []);
  assert.equal(newTradingView.visible(), false);
});

test('target validation follows the active chart instead of surrounding toolbar DOM', () => {
  const tradingView = createTradingViewApi(true);
  const state = captureTradingViewOrdersVisibility(tradingView.api);

  assert.doesNotThrow(() => assertTradingViewOrdersTarget(tradingView.api, state));

  const replacement = createTradingViewApi(true);
  assert.throws(
    () => assertTradingViewOrdersTarget(replacement.api, state),
    /active chart changed/,
  );
});
