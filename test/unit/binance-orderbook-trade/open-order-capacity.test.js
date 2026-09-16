import { captureThrownError } from '../../helpers/orderbook-migration-errors.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import { selectFarthestOpenOrders } from '../../../src/binance-orderbook-trade/core/open-order-capacity.js';

test("user selects the farthest open orders from the live reference price", () => {
  // Given the current open orders and reference price are available
  const rows = [
    { key: 'near-high', price: '0.1610' },
    { key: 'far-high', price: '0.18596' },
    { key: 'far-low', price: '0.1400' },
    { key: 'near-low', price: '0.1605' },
  ];

  // When capacity recovery selects the applicable orders
  const observed = selectFarthestOpenOrders(rows, '0.1608', 2).map(({ key }) => key);

  // Then selects the farthest open orders from the live reference price
  assert.deepEqual(
    observed,
    ['far-high', 'far-low'],
  );
  assert.deepEqual(rows.map(({ key }) => key), [
    'near-high',
    'far-high',
    'far-low',
    'near-low',
  ]);
});

test("user retains list order for equal distances and caps the selection", () => {
  // Given the current open orders and reference price are available
  const rows = [
    { key: 'first', price: '11' },
    { key: 'second', price: '9' },
    { key: 'third', price: '12' },
  ];

  // When capacity recovery selects the applicable orders
  const observed = selectFarthestOpenOrders(rows, '10', 2).map(({ key }) => key);

  // Then retains list order for equal distances and caps the selection
  assert.deepEqual(
    observed,
    ['third', 'first'],
  );
});

test("user keeps the nearest order when releasing one hundred slots", () => {
  // Given the current open orders and reference price are available
  const rows = Array.from({ length: 101 }, (_, index) => ({
    key: `row-${index}`,
    price: String(100 + index),
  }));

  // When capacity recovery selects the applicable orders
  const selected = selectFarthestOpenOrders(rows, '100', 100);

  // Then keeps the nearest order when releasing one hundred slots
  assert.equal(selected.length, 100);
  assert.equal(selected[0].key, 'row-100');
  assert.equal(selected.at(-1).key, 'row-1');
  assert.equal(selected.some(({ key }) => key === 'row-0'), false);
});

test("user rejects incomplete capacity-recovery inputs", () => {
  // Given the current open orders and reference price are available
  const scenarioInputs = [[], '', 100];

  // When capacity recovery selects the applicable orders
  const observedFailure = captureThrownError(() => selectFarthestOpenOrders(...scenarioInputs));

  // Then rejects incomplete capacity-recovery inputs
  assert.match(observedFailure.message, /reference price/);
  assert.throws(() => selectFarthestOpenOrders([], '1', 0), /cancellation limit/);
  assert.throws(() => selectFarthestOpenOrders([{ key: '', price: '1' }], '1', 1), /row key/);
  assert.throws(() => selectFarthestOpenOrders([{ key: 'row', price: '-' }], '1', 1), /row price/);
});
