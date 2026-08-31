import test from 'node:test';
import assert from 'node:assert/strict';

import { selectFarthestOpenOrders } from '../../../src/binance-orderbook-trade/core/open-order-capacity.js';

test('selects the farthest open orders from the live reference price', () => {
  const rows = [
    { key: 'near-high', price: '0.1610' },
    { key: 'far-high', price: '0.18596' },
    { key: 'far-low', price: '0.1400' },
    { key: 'near-low', price: '0.1605' },
  ];

  assert.deepEqual(
    selectFarthestOpenOrders(rows, '0.1608', 2).map(({ key }) => key),
    ['far-high', 'far-low'],
  );
  assert.deepEqual(rows.map(({ key }) => key), [
    'near-high',
    'far-high',
    'far-low',
    'near-low',
  ]);
});

test('retains list order for equal distances and caps the selection', () => {
  const rows = [
    { key: 'first', price: '11' },
    { key: 'second', price: '9' },
    { key: 'third', price: '12' },
  ];

  assert.deepEqual(
    selectFarthestOpenOrders(rows, '10', 2).map(({ key }) => key),
    ['third', 'first'],
  );
});

test('keeps the nearest order when releasing one hundred slots', () => {
  const rows = Array.from({ length: 101 }, (_, index) => ({
    key: `row-${index}`,
    price: String(100 + index),
  }));

  const selected = selectFarthestOpenOrders(rows, '100', 100);

  assert.equal(selected.length, 100);
  assert.equal(selected[0].key, 'row-100');
  assert.equal(selected.at(-1).key, 'row-1');
  assert.equal(selected.some(({ key }) => key === 'row-0'), false);
});

test('rejects incomplete capacity-recovery inputs', () => {
  assert.throws(() => selectFarthestOpenOrders([], '', 100), /reference price/);
  assert.throws(() => selectFarthestOpenOrders([], '1', 0), /cancellation limit/);
  assert.throws(() => selectFarthestOpenOrders([{ key: '', price: '1' }], '1', 1), /row key/);
  assert.throws(() => selectFarthestOpenOrders([{ key: 'row', price: '-' }], '1', 1), /row price/);
});
