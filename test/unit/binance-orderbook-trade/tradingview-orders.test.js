import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyTradingViewOrdersVisibility,
  assertSameTradingViewOrdersTarget,
  captureTradingViewOrdersVisibility,
  hideTradingViewOrders,
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
    overrides,
    visible: () => visible,
  };
}

test('an already-hidden chart is left unchanged', () => {
  const tradingView = createTradingViewApi(false);
  const state = captureTradingViewOrdersVisibility(tradingView.api);

  hideTradingViewOrders(tradingView.api, state);
  restoreTradingViewOrders(tradingView.api, state);

  assert.deepEqual(state, { originalVisible: false, changed: false });
  assert.deepEqual(tradingView.overrides, []);
  assert.equal(tradingView.visible(), false);
});

test('visible chart orders are hidden and restored to their exact original state', () => {
  const tradingView = createTradingViewApi(true);
  const state = captureTradingViewOrdersVisibility(tradingView.api);

  hideTradingViewOrders(tradingView.api, state);
  assert.equal(tradingView.visible(), false);
  restoreTradingViewOrders(tradingView.api, state);

  assert.deepEqual(state, { originalVisible: true, changed: true });
  assert.deepEqual(tradingView.overrides, [
    { 'tradingProperties.showOrders': false },
    { 'tradingProperties.showOrders': true },
  ]);
  assert.equal(tradingView.visible(), true);
});

test('a rejected hide remains marked for cleanup', () => {
  const tradingView = createTradingViewApi(true, { apply: false });
  const state = captureTradingViewOrdersVisibility(tradingView.api);

  assert.throws(
    () => hideTradingViewOrders(tradingView.api, state),
    /TradingView showOrders remained true/
  );
  assert.deepEqual(state, { originalVisible: true, changed: true });
});

test('invalid TradingView contracts and targets fail explicitly', () => {
  assert.throws(() => captureTradingViewOrdersVisibility(null), /API is unavailable/);
  assert.throws(
    () => captureTradingViewOrdersVisibility({ activeChart: () => ({}) }),
    /active chart API is unavailable/
  );
  assert.throws(
    () => captureTradingViewOrdersVisibility(createTradingViewApi('true').api),
    /property is not boolean/
  );
  assert.throws(
    () => applyTradingViewOrdersVisibility(createTradingViewApi(true).api, 'false'),
    /target is not boolean/
  );
});

test('a replaced TradingView target is rejected without writing the new chart', () => {
  const oldTradingView = createTradingViewApi(true);
  const newTradingView = createTradingViewApi(false);
  const oldTarget = {
    frame: {},
    contentWindow: {},
    tradingViewApi: oldTradingView.api,
    chart: oldTradingView.api.activeChart(),
  };
  const newTarget = {
    frame: {},
    contentWindow: {},
    tradingViewApi: newTradingView.api,
    chart: newTradingView.api.activeChart(),
  };

  assert.throws(
    () => assertSameTradingViewOrdersTarget(oldTarget, newTarget),
    /TradingView target changed/
  );
  assert.deepEqual(newTradingView.overrides, []);
  assert.equal(newTradingView.visible(), false);
});
