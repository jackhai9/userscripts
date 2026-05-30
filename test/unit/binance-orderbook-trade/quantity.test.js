import test from 'node:test';
import assert from 'node:assert/strict';

import {
  allocateLadderQuantities,
  decimalToStepCount,
  formatStepCount,
  isDecimalAtLeast,
  isPositiveDecimalString,
} from '../../../src/binance-orderbook-trade/core/quantity.js';

test('converts decimal quantities to exchange step counts', () => {
  assert.equal(decimalToStepCount('1.29', '0.1', 'floor'), 12n);
  assert.equal(decimalToStepCount('1.21', '0.1', 'ceil'), 13n);
  assert.equal(formatStepCount(13n, '0.1'), '1.3');
  assert.equal(formatStepCount(2500n, '0.001'), '2.5');
});

test('allocates exact ladder quantity splits', () => {
  assert.deepEqual(allocateLadderQuantities('1.0', 5, '0.1', '0.1'), {
    requestedLevels: 5,
    actualLevels: 5,
    totalQty: '1',
    quantities: ['0.2', '0.2', '0.2', '0.2', '0.2'],
  });
});

test('reduces ladder level count when total quantity cannot satisfy desired levels', () => {
  assert.deepEqual(allocateLadderQuantities('0.3', 5, '0.1', '0.1'), {
    requestedLevels: 5,
    actualLevels: 3,
    totalQty: '0.3',
    quantities: ['0.1', '0.1', '0.1'],
  });
});

test('returns null when even one ladder level cannot satisfy minimum quantity', () => {
  assert.equal(allocateLadderQuantities('0.09', 3, '0.01', '0.1'), null);
  assert.equal(allocateLadderQuantities('1', 3, '0', '0.1'), null);
});

test('checks decimal positivity and minimum thresholds', () => {
  assert.equal(isPositiveDecimalString('0.001'), true);
  assert.equal(isPositiveDecimalString('0'), false);
  assert.equal(isPositiveDecimalString('bad'), false);
  assert.equal(isDecimalAtLeast('1.20', '1.2'), true);
  assert.equal(isDecimalAtLeast('1.19', '1.2'), false);
});
