import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addDecimalStrings,
  ceilQtyByNotional,
  compareDecimalStrings,
  floorDecimalToStep,
  maxDecimalString,
  multiplyDecimalByInt,
  multiplyDecimalByRatio,
  normalizeDecimalString,
  subtractDecimalStrings,
} from '../../../src/binance-orderbook-trade/core/decimal.js';

test('normalizes unsigned decimal strings without losing precision', () => {
  assert.equal(normalizeDecimalString('001.2300'), '1.23');
  assert.equal(normalizeDecimalString('0.000'), '0');
  assert.equal(normalizeDecimalString('1,234.5000'), '1234.5');
  assert.equal(normalizeDecimalString('-1'), null);
  assert.equal(normalizeDecimalString('abc'), null);
});

test('compares decimal strings at different scales', () => {
  assert.equal(compareDecimalStrings('1.2', '1.20'), 0);
  assert.equal(compareDecimalStrings('1.21', '1.2'), 1);
  assert.equal(compareDecimalStrings('0.9', '1'), -1);
  assert.equal(compareDecimalStrings('bad', '1'), null);
});

test('adds and subtracts decimal strings exactly', () => {
  assert.equal(addDecimalStrings('0.1', '0.02'), '0.12');
  assert.equal(addDecimalStrings('1.005', '2.005'), '3.01');
  assert.equal(subtractDecimalStrings('1.00', '0.25'), '0.75');
  assert.equal(subtractDecimalStrings('0.25', '1.00'), null);
});

test('rounds quantity requirements to exchange step size', () => {
  assert.equal(ceilQtyByNotional('5', '3', '0.1'), '1.7');
  assert.equal(ceilQtyByNotional('10', '4', '0.001'), '2.5');
  assert.equal(floorDecimalToStep('1.239', '0.01'), '1.23');
  assert.equal(floorDecimalToStep('1.239', '0.1'), '1.2');
});

test('multiplies decimal strings by integer or ratio', () => {
  assert.equal(multiplyDecimalByInt('0.005', '3'), '0.015');
  assert.equal(multiplyDecimalByInt('1.20', '10'), '12');
  assert.equal(multiplyDecimalByRatio('1.000', 1, 3), '0.333');
  assert.equal(multiplyDecimalByRatio('10', 3, 4), '7');
  assert.equal(multiplyDecimalByRatio('0.01', 60, 100), '0.006');
});

test('multiplies decimal strings by decimal ratio without floating point conversion', () => {
  assert.equal(multiplyDecimalByRatio('5.64', 0.3, 100), '0.01692');
  assert.equal(multiplyDecimalByRatio('10', 0.3, 100), '0.03');
});

test('selects the maximum normalized decimal string', () => {
  assert.equal(maxDecimalString('1.20', '1.2'), '1.2');
  assert.equal(maxDecimalString('1.19', '1.2'), '1.2');
  assert.equal(maxDecimalString(null, '0.0100'), '0.01');
});
