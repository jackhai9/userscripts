import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateDisplayStepPrice,
  inferOrderbookDisplayStep,
  planBufferedMakerPrices,
  repriceRemainingLadderOrders,
} from '../../../src/binance-orderbook-trade/core/orderbook.js';

test('infers orderbook display step from adjacent visible prices', () => {
  assert.equal(inferOrderbookDisplayStep(['100', '99.5', '99']), '0.5');
  assert.equal(inferOrderbookDisplayStep(['100', '100', '99.8', '99.7']), '0.1');
  assert.equal(inferOrderbookDisplayStep(['100']), null);
});

test('calculates missing display-step prices by side', () => {
  assert.equal(calculateDisplayStepPrice('100', '0.5', 'ASK', 2), '101');
  assert.equal(calculateDisplayStepPrice('100', '0.5', 'BID', 2), '99');
  assert.equal(calculateDisplayStepPrice('0.1', '0.5', 'BID', 1), null);
});

test('plans buffered maker prices from displayed depth and inferred display step', () => {
  assert.deepEqual(planBufferedMakerPrices({
    prices: ['100', '99.5'],
    side: 'BID',
    levels: 3,
    ladderStep: 1,
    bufferLevels: 1,
  }), ['99.5', '99', '98.5']);

  assert.deepEqual(planBufferedMakerPrices({
    prices: ['100', '100.5'],
    side: 'ASK',
    levels: 3,
    ladderStep: 1,
    bufferLevels: 1,
  }), ['100.5', '101', '101.5']);
});

test('uses UI display step instead of exchange tick size assumptions', () => {
  assert.deepEqual(planBufferedMakerPrices({
    prices: ['100', '99.5', '99', '98.5'],
    side: 'BID',
    levels: 2,
    ladderStep: 2,
    bufferLevels: 1,
  }), ['99.5', '98.5']);
});

test('reprices only remaining ladder orders and preserves quantities', () => {
  const orders = [
    { price: '100', qty: '0.01' },
    { price: '101', qty: '0.02' },
    { price: '102', qty: '0.03' },
  ];

  assert.deepEqual(repriceRemainingLadderOrders({
    orders,
    completedCount: 1,
    prices: ['103', '104'],
  }), [
    { price: '100', qty: '0.01' },
    { price: '103', qty: '0.02' },
    { price: '104', qty: '0.03' },
  ]);
  assert.deepEqual(orders, [
    { price: '100', qty: '0.01' },
    { price: '101', qty: '0.02' },
    { price: '102', qty: '0.03' },
  ]);
});

test('remaining ladder repricing rejects incomplete or invalid progress', () => {
  const orders = [
    { price: '100', qty: '0.01' },
    { price: '101', qty: '0.02' },
  ];

  assert.throws(() => repriceRemainingLadderOrders({
    orders,
    completedCount: 1,
    prices: [],
  }), /Expected 1 replacement prices/);
  assert.throws(() => repriceRemainingLadderOrders({
    orders,
    completedCount: 3,
    prices: [],
  }), /Invalid completed ladder count/);
});
