import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateDisplayStepPrice,
  inferOrderbookDisplayStep,
  planBufferedMakerPrices,
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
