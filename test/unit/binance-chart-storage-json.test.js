import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

import { equalJsonClones } from '../../src/binance-orderbook-trade/chart-storage/json.js';

test('user skips a chart write only when the stored and new trees are identical JSON', () => {
  // Given a stored drawing record and its structured clone from a later save
  const stored = { symbol: 'BTCUSDT', lines: [{ id: 'a', points: [1, -0, 2.5], visible: true, note: null }] };
  const identical = structuredClone(stored);

  // When the filter compares the identical save and saves with one changed field
  const same = equalJsonClones(stored, identical);
  const changedPrice = equalJsonClones(stored, { ...identical, lines: [{ ...identical.lines[0], points: [1, -0, 2.6] }] });
  const addedLine = equalJsonClones(stored, { ...identical, lines: [...identical.lines, { id: 'b' }] });

  // Then only the identical tree is treated as unchanged
  assert.equal(same, true);
  assert.equal(changedPrice, false);
  assert.equal(addedLine, false);
});

test('user keeps property order and signed zero significant when comparing chart records', () => {
  // Given stored records whose observable native reads expose order and signed zero
  const ordered = { a: 1, b: 2 };
  const zero = { price: 0 };

  // When later saves reorder keys or change zero to negative zero
  const reordered = equalJsonClones(ordered, { b: 2, a: 1 });
  const negativeZero = equalJsonClones(zero, { price: -0 });

  // Then both saves are written
  assert.equal(reordered, false);
  assert.equal(negativeZero, false);
});

for (const scenario of [
  { name: 'a stored Date against an empty object', stored: new Date(0), next: {} },
  { name: 'a stored Map against an empty object', stored: new Map(), next: {} },
  { name: 'a sparse stored array against a dense array', stored: [1, , 3], next: [1, undefined, 3] },
  { name: 'a stored array with an extra property', stored: Object.assign([1], { extra: 2 }), next: [1] },
  { name: 'a null-prototype stored object', stored: Object.assign(Object.create(null), { a: 1 }), next: { a: 1 } },
  { name: 'an array against an object with index keys', stored: [1], next: { 0: 1 } },
  { name: 'a stored undefined against null', stored: undefined, next: null },
]) {
  test(`user rewrites a chart record when comparing ${scenario.name}`, () => {
    // Given a stored value that is not the same JSON tree as the new value
    const { stored, next } = scenario;

    // When the filter compares them in both directions
    const forward = equalJsonClones(stored, next);
    const backward = equalJsonClones(next, stored);

    // Then the record is never considered unchanged
    assert.equal(forward, false);
    assert.equal(backward, false);
  });
}

test('user compares plain chart records created in the chart iframe realm', () => {
  // Given a stored record and an identical record created by another JavaScript realm
  const stored = { revision: 3, points: [{ price: 1 }, { price: 2 }] };
  const foreign = vm.runInNewContext('({ revision: 3, points: [{ price: 1 }, { price: 2 }] })');

  // When the filter compares them
  const same = equalJsonClones(stored, foreign);

  // Then realm identity does not force a rewrite
  assert.equal(same, true);
});
