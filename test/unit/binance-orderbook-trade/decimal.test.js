import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addDecimalStrings,
  ceilQtyByNotional,
  compareDecimalStrings,
  floorDecimalToStep,
  formatDecimalParts,
  isDecimalAtLeast,
  isPositiveDecimalString,
  maxDecimalString,
  multiplyDecimalByInt,
  multiplyDecimalByRatio,
  normalizeDecimalString,
  parseDecimalString,
  subtractDecimalStrings,
} from '../../../src/binance-orderbook-trade/core/decimal.js';

test('user keeps exact decimal digits while normalizing display values', () => {
  // Given balances include padded, grouped, zero, and invalid unsigned values
  const inputs = ['001.2300', '0.000', 0, '1,234.5000', '-1', 'abc', null, undefined];

  // When each displayed balance is normalized
  const results = inputs.map(normalizeDecimalString);

  // Then valid balances retain precision and invalid balances stay unavailable
  assert.deepEqual(results, ['1.23', '0', '0', '1234.5', null, null, null, null]);
});

test('user compares balances exactly across different decimal scales', () => {
  // Given equal, greater, smaller, and unreadable balance pairs
  const pairs = [['1.2', '1.20'], ['1.21', '1.2'], ['0.9', '1'], ['bad', '1'], ['1', 'bad']];

  // When balance ordering is calculated
  const comparisons = pairs.map(([left, right]) => compareDecimalStrings(left, right));

  // Then trailing zeroes do not change equality and neither invalid side is ordered
  assert.deepEqual(comparisons, [0, 1, -1, null, null]);
});

test('user adds and subtracts balances without floating point loss', () => {
  // Given fractional balances and a subtraction exceeding the available balance
  const additions = [['0.1', '0.02'], ['1.005', '2.005']];
  const subtractions = [['1.00', '0.25'], ['0.25', '1.00'], ['1', '1']];

  // When balances are added and debited
  const added = additions.map(([left, right]) => addDecimalStrings(left, right));
  const subtracted = subtractions.map(([left, right]) => subtractDecimalStrings(left, right));

  // Then exact totals are returned and an overdraft is rejected
  assert.deepEqual(added, ['0.12', '3.01']);
  assert.deepEqual(subtracted, ['0.75', null, '0']);
});

test('user cannot calculate a balance change with an unreadable operand', () => {
  // Given either side of a balance operation is missing or malformed
  const pairs = [[null, '1'], ['1', null], ['bad', '1'], ['1', 'bad']];

  // When addition and subtraction are requested for every pair
  const additions = pairs.map(([left, right]) => addDecimalStrings(left, right));
  const subtractions = pairs.map(([left, right]) => subtractDecimalStrings(left, right));

  // Then no invalid balance becomes a usable amount
  assert.deepEqual(additions, [null, null, null, null]);
  assert.deepEqual(subtractions, [null, null, null, null]);
});

test('user rounds order quantities to the exact exchange step', () => {
  // Given minimum notionals and quantities straddling exchange step boundaries
  const notionals = [['5', '3', '0.1'], ['10', '4', '0.001'], ['0.001', '2', '1']];
  const quantities = [['1.239', '0.01'], ['1.239', '0.1'], ['0.01', '1']];

  // When minimum quantities are rounded up and available quantities rounded down
  const minimums = notionals.map((args) => ceilQtyByNotional(...args));
  const available = quantities.map((args) => floorDecimalToStep(...args));

  // Then minimum notional is met without allocating unavailable fractional steps
  assert.deepEqual(minimums, ['1.7', '2.5', '1']);
  assert.deepEqual(available, ['1.23', '1.2', '0']);
});

test('user receives no quantity when exchange price or step information is invalid', () => {
  // Given missing notional, price, quantity, or a zero exchange step
  const notionals = [[null, '1', '1'], ['1', null, '1'], ['1', '1', null], ['1', '0', '1'], ['1', '1', '0']];
  const quantities = [[null, '1'], ['1', null], ['1', '0']];

  // When quantities are calculated from incomplete exchange rules
  const minimums = notionals.map((args) => ceilQtyByNotional(...args));
  const available = quantities.map((args) => floorDecimalToStep(...args));

  // Then every unsupported calculation stays unavailable
  assert.deepEqual(minimums, [null, null, null, null, null]);
  assert.deepEqual(available, [null, null, null]);
});

test('user multiplies quantities by exact integer and fractional ratios', () => {
  // Given quantity multipliers include integers and ratios with repeating results
  const integers = [['0.005', '3'], ['1.20', '10'], ['2', '3'], ['0.5', '2']];
  const ratios = [['1.000', 1, 3], ['10', 3, 4], ['0.01', 60, 100]];

  // When the configured quantity multiplier is applied
  const multiplied = integers.map((args) => multiplyDecimalByInt(...args));
  const divided = ratios.map((args) => multiplyDecimalByRatio(...args));

  // Then decimal scale is preserved without binary rounding
  assert.deepEqual(multiplied, ['0.015', '12', '6', '1']);
  assert.deepEqual(divided, ['0.333', '7', '0.006']);
});

test('user applies a decimal percentage without converting balance arithmetic to floats', () => {
  // Given small configured percentages of two account balances
  const cases = [['5.64', 0.3, 100], ['10', 0.3, 100], ['1', '0.01', '0.2']];

  // When those percentages are applied exactly
  const amounts = cases.map((args) => multiplyDecimalByRatio(...args));

  // Then fractional percentages retain all supported digits
  assert.deepEqual(amounts, ['0.01692', '0.03', '0.05']);
});

test('user cannot multiply quantities by missing or nonpositive multipliers', () => {
  // Given invalid quantities, integer multipliers, and ratio denominators
  const integers = [[null, '2'], ['bad', '2'], ['1', '0'], ['1', null], ['1', '0.5']];
  const ratios = [[null, 1, 2], ['1', null, 2], ['1', 1, null], ['1', 0, 2], ['1', 1, 0]];

  // When the invalid multiplier settings are evaluated
  const multiplied = integers.map((args) => multiplyDecimalByInt(...args));
  const divided = ratios.map((args) => multiplyDecimalByRatio(...args));

  // Then none of the invalid settings yields a tradable quantity
  assert.deepEqual(multiplied, [null, null, null, null, null]);
  assert.deepEqual(divided, [null, null, null, null, null]);
});

test('user selects the largest usable normalized decimal balance', () => {
  // Given comparable balances and an unavailable alternative on either side
  const pairs = [['1.20', '1.2'], ['1.19', '1.2'], [null, '0.0100'], ['0.0100', null], ['bad', '1'], ['1', 'bad']];

  // When the maximum available balance is selected
  const selected = pairs.map(([left, right]) => maxDecimalString(left, right));

  // Then a valid alternative is retained and trailing zeroes are removed
  assert.deepEqual(selected, ['1.2', '1.2', '0.01', '0.01', '1', '1']);
});

test('user preserves signed result formatting and exact integer digits', () => {
  // Given parsed decimal digits and a signed arithmetic result
  const input = ' 001.2300 ';
  const parts = [[-12300n, 4], [-12n, 0], [0n, 3], [123n, 5]];

  // When decimal parts are parsed and formatted for display
  const parsed = parseDecimalString(input);
  const formatted = parts.map(([digits, scale]) => formatDecimalParts(digits, scale));

  // Then the scale and sign remain exact even below one unit
  assert.deepEqual(parsed, { digits: 12300n, scale: 4 });
  assert.deepEqual(formatted, ['-1.23', '-12', '0', '0.00123']);
});

test('user distinguishes a positive quantity from a quantity meeting the minimum', () => {
  // Given zero, invalid, below-minimum, and exact-minimum values
  const values = ['0', 'bad', '0.09', '0.10'];

  // When positivity and the minimum quantity are checked
  const positive = values.map(isPositiveDecimalString);
  const meetsMinimum = values.map((value) => isDecimalAtLeast(value, '0.1'));

  // Then zero and invalid values are rejected and the exact minimum is accepted
  assert.deepEqual(positive, [false, false, true, true]);
  assert.deepEqual(meetsMinimum, [false, false, false, true]);
});
