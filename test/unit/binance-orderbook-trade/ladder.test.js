import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_AUTO_FIT_LADDER_PERCENT,
  fitLadderPlanForMinimumQty,
  getLadderActionSpec,
  getLadderPercentForMode,
  getUnavailableLadderQuantityMessage,
} from '../../../src/binance-orderbook-trade/core/ladder-plan.js';

test("user maps open and close ladder actions to order direction specs", () => {
  // Given the requested ladder action and quantity constraints are available
  const scenarioInputs = ['OPEN_LONG'];

  // When the requested ladder plan is evaluated
  const observed = getLadderActionSpec(...scenarioInputs);

  // Then maps open and close ladder actions to order direction specs
  assert.deepEqual(observed, {
    mode: 'OPEN',
    label: '阶梯开多',
    priceSide: 'BID',
    orderSide: 'BUY',
    side: 'LONG',
  });
  assert.deepEqual(getLadderActionSpec('OPEN_SHORT'), {
    mode: 'OPEN',
    label: '阶梯开空',
    priceSide: 'ASK',
    orderSide: 'SELL',
    side: 'SHORT',
  });
  assert.deepEqual(getLadderActionSpec('CLOSE_LONG'), {
    mode: 'CLOSE',
    label: '阶梯平多',
    priceSide: 'ASK',
    orderSide: 'SELL',
    side: 'LONG',
  });
  assert.deepEqual(getLadderActionSpec('CLOSE_SHORT'), {
    mode: 'CLOSE',
    label: '阶梯平空',
    priceSide: 'BID',
    orderSide: 'BUY',
    side: 'SHORT',
  });
});

test("user rejects unknown ladder actions and resolves percent source by mode", () => {
  // Given the requested ladder action and quantity constraints are available
  const scenarioInputs = ['BAD_ACTION'];

  // When the requested ladder plan is evaluated
  const observed = getLadderActionSpec(...scenarioInputs);

  // Then rejects unknown ladder actions and resolves percent source by mode
  assert.equal(observed, null);
  assert.equal(getLadderPercentForMode('OPEN', 30, 50), 30);
  assert.equal(getLadderPercentForMode('CLOSE', 30, 50), 50);
  assert.equal(getLadderPercentForMode('UNKNOWN', 30, 50), null);
});

test("user sees that unavailable ladder quantity messages preserve the observed failure reason", () => {
  // Given the requested ladder action and quantity constraints are available
  const scenarioInputs = ['OPEN', null];

  // When the requested ladder plan is evaluated
  const observed = getUnavailableLadderQuantityMessage(...scenarioInputs);

  // Then sees that unavailable ladder quantity messages preserve the observed failure reason
  assert.equal(observed, '未读取到可开数量');
  assert.equal(getUnavailableLadderQuantityMessage('OPEN', '0'), '当前可开数量为 0');
  assert.equal(
    getUnavailableLadderQuantityMessage('OPEN', 0, true),
    '可用余额不足',
  );
  assert.equal(getUnavailableLadderQuantityMessage('OPEN', '1.25'), null);
  assert.equal(getUnavailableLadderQuantityMessage('CLOSE', null), '未读取到可平数量');
  assert.equal(getUnavailableLadderQuantityMessage('CLOSE', '0'), '当前方向没有可平仓位');
  assert.equal(getUnavailableLadderQuantityMessage('CLOSE', '1.25'), null);
  assert.throws(
    () => getUnavailableLadderQuantityMessage('UNKNOWN', '0'),
    /未知阶梯数量模式/,
  );
});

test("user auto-fits ladder percent before reducing requested levels", () => {
  // Given the requested ladder action and quantity constraints are available
  const scenarioInputs = [{
    baseQty: '10',
    minRequiredQty: '1',
    percent: 30,
    levels: 5,
    stepSize: '0.1',
  }];

  // When the requested ladder plan is evaluated
  const fit = fitLadderPlanForMinimumQty(...scenarioInputs);



  // Then auto-fits ladder percent before reducing requested levels
  assert.equal(fit.percent, '50');
  assert.equal(fit.levels, 5);
  assert.deepEqual(fit.allocation.quantities, ['1', '1', '1', '1', '1']);
});

test("user auto-fits up to 100 percent without depending on panel percent presets", () => {
  // Given the requested ladder action and quantity constraints are available
  const scenarioInputs = [{
    baseQty: '9',
    minRequiredQty: '0.8',
    percent: 30,
    levels: 9,
    stepSize: '0.01',
  }];

  // When the requested ladder plan is evaluated
  const fit = fitLadderPlanForMinimumQty(...scenarioInputs);



  // Then auto-fits up to 100 percent without depending on panel percent presets
  assert.equal(MAX_AUTO_FIT_LADDER_PERCENT, '100');
  assert.equal(fit.maxPercent, '100');
  assert.equal(fit.percent, '80');
  assert.equal(fit.levels, 9);
  assert.deepEqual(fit.allocation.quantities, Array(9).fill('0.8'));
});

test("user reduces requested levels only when they need more than 100 percent", () => {
  // Given the requested ladder action and quantity constraints are available
  const scenarioInputs = [{
    baseQty: '10',
    minRequiredQty: '2.1',
    percent: 30,
    levels: 9,
    stepSize: '0.1',
  }];

  // When the requested ladder plan is evaluated
  const fit = fitLadderPlanForMinimumQty(...scenarioInputs);



  // Then reduces requested levels only when they need more than 100 percent
  assert.equal(fit.percent, '84');
  assert.equal(fit.levels, 4);
  assert.deepEqual(fit.allocation.quantities, ['2.1', '2.1', '2.1', '2.1']);
});

test("user never lowers the saved percent while auto-reducing levels", () => {
  // Given the requested ladder action and quantity constraints are available
  const scenarioInputs = [{
    baseQty: '10',
    minRequiredQty: '2.1',
    percent: 90,
    levels: 9,
    stepSize: '0.1',
  }];

  // When the requested ladder plan is evaluated
  const fit = fitLadderPlanForMinimumQty(...scenarioInputs);



  // Then never lowers the saved percent while auto-reducing levels
  assert.equal(fit.percent, '90');
  assert.equal(fit.levels, 4);
  assert.deepEqual(fit.allocation.quantities, ['2.2', '2.2', '2.2', '2.4']);
});

test("user rejects the ladder only when even one order needs more than 100 percent", () => {
  // Given the requested ladder action and quantity constraints are available
  const scenarioInputs = [{
    baseQty: '10',
    minRequiredQty: '10.1',
    percent: 30,
    levels: 3,
    stepSize: '0.1',
  }];

  // When the requested ladder plan is evaluated
  const fit = fitLadderPlanForMinimumQty(...scenarioInputs);



  // Then rejects the ladder only when even one order needs more than 100 percent
  assert.equal(fit.allocation, null);
  assert.equal(fit.maxPercent, '100');
});

test("user sees that auto-fit recomputes the minimum quantity for retained open ladder levels", () => {
  // Given the requested ladder action and quantity constraints are available
  const scenarioInputs = [{
    baseQty: '10',
    minRequiredQty: '3',
    minRequiredQtyByLevel: ['2', '2', '2', '3', '3'],
    percent: 30,
    levels: 5,
    stepSize: '1',
  }];

  // When the requested ladder plan is evaluated
  const fit = fitLadderPlanForMinimumQty(...scenarioInputs);



  // Then sees that auto-fit recomputes the minimum quantity for retained open ladder levels
  assert.equal(fit.percent, '60');
  assert.equal(fit.levels, 3);
  assert.equal(fit.minRequiredQty, '2');
  assert.deepEqual(fit.allocation.quantities, ['2', '2', '2']);
});
