import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fitLadderPlanForMinimumQty,
  getLadderActionSpec,
  getLadderPercentForMode,
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

test('auto-fits ladder percent before reducing requested levels', () => {
  const fit = fitLadderPlanForMinimumQty({
    baseQty: '10',
    minRequiredQty: '1',
    percent: 30,
    levels: 5,
    stepSize: '0.1',
    maxPercent: '70',
  });

  assert.equal(fit.percent, '50');
  assert.equal(fit.levels, 5);
  assert.deepEqual(fit.allocation.quantities, ['1', '1', '1', '1', '1']);
});

test('auto-fits ladder levels when keeping requested levels needs too much percent', () => {
  const fit = fitLadderPlanForMinimumQty({
    baseQty: '10',
    minRequiredQty: '1',
    percent: 30,
    levels: 9,
    stepSize: '0.1',
    maxPercent: '70',
  });

  assert.equal(fit.percent, '70');
  assert.equal(fit.levels, 7);
  assert.deepEqual(fit.allocation.quantities, ['1', '1', '1', '1', '1', '1', '1']);
});

test('auto-fit recomputes the minimum quantity for retained open ladder levels', () => {
  const fit = fitLadderPlanForMinimumQty({
    baseQty: '10',
    minRequiredQty: '3',
    minRequiredQtyByLevel: ['2', '2', '2', '3', '3'],
    percent: 30,
    levels: 5,
    stepSize: '1',
    maxPercent: '70',
  });

  assert.equal(fit.percent, '60');
  assert.equal(fit.levels, 3);
  assert.equal(fit.minRequiredQty, '2');
  assert.deepEqual(fit.allocation.quantities, ['2', '2', '2']);
});
