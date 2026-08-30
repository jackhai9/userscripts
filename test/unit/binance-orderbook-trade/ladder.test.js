import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_AUTO_FIT_LADDER_PERCENT,
  fitLadderPlanForMinimumQty,
  getLadderActionSpec,
  getLadderPercentForMode,
  getUnavailableLadderQuantityMessage,
} from '../../../src/binance-orderbook-trade/core/ladder-plan.js';

test('maps open and close ladder actions to order direction specs', () => {
  assert.deepEqual(getLadderActionSpec('OPEN_LONG'), {
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

test('rejects unknown ladder actions and resolves percent source by mode', () => {
  assert.equal(getLadderActionSpec('BAD_ACTION'), null);
  assert.equal(getLadderPercentForMode('OPEN', 30, 50), 30);
  assert.equal(getLadderPercentForMode('CLOSE', 30, 50), 50);
  assert.equal(getLadderPercentForMode('UNKNOWN', 30, 50), null);
});

test('unavailable ladder quantity messages preserve the observed failure reason', () => {
  assert.equal(getUnavailableLadderQuantityMessage('OPEN', null), '未读取到可开数量');
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

test('auto-fits ladder percent before reducing requested levels', () => {
  const fit = fitLadderPlanForMinimumQty({
    baseQty: '10',
    minRequiredQty: '1',
    percent: 30,
    levels: 5,
    stepSize: '0.1',
  });

  assert.equal(fit.percent, '50');
  assert.equal(fit.levels, 5);
  assert.deepEqual(fit.allocation.quantities, ['1', '1', '1', '1', '1']);
});

test('auto-fits up to 100 percent without depending on panel percent presets', () => {
  const fit = fitLadderPlanForMinimumQty({
    baseQty: '9',
    minRequiredQty: '0.8',
    percent: 30,
    levels: 9,
    stepSize: '0.01',
  });

  assert.equal(MAX_AUTO_FIT_LADDER_PERCENT, '100');
  assert.equal(fit.maxPercent, '100');
  assert.equal(fit.percent, '80');
  assert.equal(fit.levels, 9);
  assert.deepEqual(fit.allocation.quantities, Array(9).fill('0.8'));
});

test('reduces requested levels only when they need more than 100 percent', () => {
  const fit = fitLadderPlanForMinimumQty({
    baseQty: '10',
    minRequiredQty: '2.1',
    percent: 30,
    levels: 9,
    stepSize: '0.1',
  });

  assert.equal(fit.percent, '84');
  assert.equal(fit.levels, 4);
  assert.deepEqual(fit.allocation.quantities, ['2.1', '2.1', '2.1', '2.1']);
});

test('never lowers the saved percent while auto-reducing levels', () => {
  const fit = fitLadderPlanForMinimumQty({
    baseQty: '10',
    minRequiredQty: '2.1',
    percent: 90,
    levels: 9,
    stepSize: '0.1',
  });

  assert.equal(fit.percent, '90');
  assert.equal(fit.levels, 4);
  assert.deepEqual(fit.allocation.quantities, ['2.2', '2.2', '2.2', '2.4']);
});

test('rejects the ladder only when even one order needs more than 100 percent', () => {
  const fit = fitLadderPlanForMinimumQty({
    baseQty: '10',
    minRequiredQty: '10.1',
    percent: 30,
    levels: 3,
    stepSize: '0.1',
  });

  assert.equal(fit.allocation, null);
  assert.equal(fit.maxPercent, '100');
});

test('auto-fit recomputes the minimum quantity for retained open ladder levels', () => {
  const fit = fitLadderPlanForMinimumQty({
    baseQty: '10',
    minRequiredQty: '3',
    minRequiredQtyByLevel: ['2', '2', '2', '3', '3'],
    percent: 30,
    levels: 5,
    stepSize: '1',
  });

  assert.equal(fit.percent, '60');
  assert.equal(fit.levels, 3);
  assert.equal(fit.minRequiredQty, '2');
  assert.deepEqual(fit.allocation.quantities, ['2', '2', '2']);
});
