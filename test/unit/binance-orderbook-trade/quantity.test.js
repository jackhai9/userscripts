import test from 'node:test';
import assert from 'node:assert/strict';

import {
  allocateLadderQuantities,
  decimalToStepCount,
  formatStepCount,
  isDecimalAtLeast,
  isPositiveDecimalString,
} from '../../../src/binance-orderbook-trade/core/quantity.js';

for (const { name, value, step, rounding, expected } of [
  { name: 'rounds a submitted quantity down to the exchange step', value: '1.29', step: '0.1', rounding: 'floor', expected: 12n },
  { name: 'rounds a minimum quantity up to the exchange step', value: '1.21', step: '0.1', rounding: 'ceil', expected: 13n },
  { name: 'uses floor rounding when no rounding mode is supplied', value: '1.29', step: '0.1', expected: 12n },
  { name: 'preserves an exact minimum without adding another step', value: '1.2', step: '0.1', rounding: 'ceil', expected: 12n },
  { name: 'keeps fine steps exact for an integer quantity', value: '2', step: '0.001', expected: 2000n },
  { name: 'keeps a sub-step quantity at zero for order sizing', value: '0.0009', step: '0.001', expected: 0n },
  { name: 'rejects an unread quantity', value: null, step: '0.1', expected: null },
  { name: 'rejects a missing exchange step', value: '1', step: null, expected: null },
  { name: 'rejects a zero exchange step', value: '1', step: '0', expected: null },
]) {
  test(`user ${name}`, () => {
    // Given the requested quantity and the symbol's exchange step.
    const input = { value, step, rounding };

    // When the quantity is converted to an integer number of tradable steps.
    const count = decimalToStepCount(input.value, input.step, input.rounding);

    // Then the exact count respects the requested rounding or rejects invalid evidence.
    assert.equal(count, expected);
  });
}

for (const { name, count, step, expected } of [
  { name: 'formats thirteen tenths without trailing zeros', count: 13n, step: '0.1', expected: '1.3' },
  { name: 'formats two thousand five hundred fine steps exactly', count: 2500n, step: '0.001', expected: '2.5' },
  { name: 'formats an empty position as zero', count: 0n, step: '0.001', expected: '0' },
  { name: 'rejects a missing step count', count: null, step: '0.1', expected: null },
  { name: 'rejects a negative step count', count: -1n, step: '0.1', expected: null },
  { name: 'rejects an invalid formatting step', count: 1n, step: 'bad', expected: null },
  { name: 'rejects a zero formatting step', count: 1n, step: '0', expected: null },
]) {
  test(`user ${name}`, () => {
    // Given an allocated number of steps and its exchange step size.
    const input = { count, step };

    // When the order quantity is formatted for submission.
    const quantity = formatStepCount(input.count, input.step);

    // Then the quantity stays exact and invalid counts are refused.
    assert.equal(quantity, expected);
  });
}

for (const { name, total, levels, step, minimum, expected } of [
  {
    name: 'splits an exactly divisible quantity across all requested levels',
    total: '1.0', levels: 5, step: '0.1', minimum: '0.1',
    expected: { requestedLevels: 5, actualLevels: 5, totalQty: '1', quantities: ['0.2', '0.2', '0.2', '0.2', '0.2'] },
  },
  {
    name: 'gets fewer levels when the quantity only funds three minimum orders',
    total: '0.3', levels: 5, step: '0.1', minimum: '0.1',
    expected: { requestedLevels: 5, actualLevels: 3, totalQty: '0.3', quantities: ['0.1', '0.1', '0.1'] },
  },
  {
    name: 'keeps remaining exchange steps in the final ladder order',
    total: '1.09', levels: 3, step: '0.1', minimum: '0.21',
    expected: { requestedLevels: 3, actualLevels: 3, totalQty: '1', quantities: ['0.3', '0.3', '0.4'] },
  },
  { name: 'cannot create even one order below the minimum', total: '0.09', levels: 3, step: '0.01', minimum: '0.1', expected: null },
  { name: 'cannot allocate orders with a zero exchange step', total: '1', levels: 3, step: '0', minimum: '0.1', expected: null },
  { name: 'cannot allocate a sub-step total quantity', total: '0.09', levels: 3, step: '0.1', minimum: '0.1', expected: null },
  { name: 'cannot allocate orders without a valid minimum quantity', total: '1', levels: 3, step: '0.1', minimum: 'bad', expected: null },
  { name: 'cannot allocate orders against a zero minimum quantity', total: '1', levels: 3, step: '0.1', minimum: '0', expected: null },
  { name: 'cannot allocate a ladder with zero requested levels', total: '1', levels: 0, step: '0.1', minimum: '0.1', expected: null },
]) {
  test(`user ${name}`, () => {
    // Given the total quantity, requested levels, and symbol-specific order limits.
    const input = { total, levels, step, minimum };

    // When the ladder divides the quantity into executable orders.
    const allocation = allocateLadderQuantities(input.total, input.levels, input.step, input.minimum);

    // Then every reported quantity and the actual number of orders match the limits.
    assert.deepEqual(allocation, expected);
  });
}

test('user can distinguish positive quantities and exact minimum boundaries', () => {
  // Given valid, empty, and malformed quantities around the exchange minimum.
  const quantities = ['0.001', '0', 'bad'];
  const candidates = ['1.20', '1.19'];

  // When quantity validity and the minimum boundary are evaluated.
  const positive = quantities.map(isPositiveDecimalString);
  const atLeastMinimum = candidates.map((value) => isDecimalAtLeast(value, '1.2'));

  // Then equality meets the minimum while zero and malformed quantities stay invalid.
  assert.deepEqual(positive, [true, false, false]);
  assert.deepEqual(atLeastMinimum, [true, false]);
});

test('user keeps every tradable step while all ladder orders meet the minimum', () => {
  // Given small and uneven totals, exchange minimums, and configured or reduced ladder sizes.
  const cases = [];
  for (const total of [1, 2, 3, 5, 10, 19, 50, 101]) {
    for (const minimum of [1, 2, 3, 7, 20]) {
      for (const levels of [1, 2, 3, 5, 7, 9]) cases.push({ total, minimum, levels });
    }
  }

  // When real quantity allocation builds each plan on a one-hundredth exchange step.
  const results = cases.map((input) => ({ input, allocation: allocateLadderQuantities(
    (input.total / 100).toFixed(2), input.levels, '0.01', (input.minimum / 100).toFixed(2),
  ) }));

  // Then insufficient funds produce no plan and every executable plan conserves steps without undersized orders.
  for (const { input, allocation } of results) {
    const label = JSON.stringify(input);
    if (input.total < input.minimum) {
      assert.equal(allocation, null, label);
      continue;
    }
    const steps = allocation.quantities.map((quantity) => decimalToStepCount(quantity, '0.01'));
    assert.equal(allocation.actualLevels, Math.min(input.levels, Math.floor(input.total / input.minimum)), label);
    assert.equal(allocation.quantities.length, allocation.actualLevels, label);
    assert.equal(steps.reduce((sum, count) => sum + count, 0n), BigInt(input.total), label);
    assert.deepEqual(steps.filter((count) => count < BigInt(input.minimum)), [], label);
    assert.equal(decimalToStepCount(allocation.totalQty, '0.01'), BigInt(input.total), label);
  }
});
