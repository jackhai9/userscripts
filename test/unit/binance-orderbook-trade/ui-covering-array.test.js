import test from 'node:test';
import assert from 'node:assert/strict';

import {
  enumerateCartesian,
  findMissingCoverage,
  generateCoveringArray,
} from '../../../e2e/binance-orderbook/helpers/covering-array.js';
import {
  CANCEL_COVERING_SCENARIOS,
  CANCEL_MATRIX_AXES,
} from '../../../e2e/binance-orderbook/scenarios/cancel-covering-matrix.js';

const AXES = Object.freeze({
  position: ['none', 'current', 'both'],
  orders: ['none', 'current', 'both'],
  hidden: [false, true],
  outcome: ['cancel', 'confirm'],
});

test('covering array deterministically covers every valid pair with fewer scenarios', () => {
  const first = generateCoveringArray({ axes: AXES });
  const second = generateCoveringArray({ axes: AXES });

  assert.deepEqual(second, first);
  assert.deepEqual(findMissingCoverage({ axes: AXES, scenarios: first }), []);
  assert.ok(first.length < enumerateCartesian(AXES).length);
});

test('covering array derives requirements only from valid constrained scenarios', () => {
  const isValid = (scenario) => scenario.orders !== 'none' || scenario.outcome === 'cancel';
  const scenarios = generateCoveringArray({ axes: AXES, strength: 3, isValid });

  assert.ok(scenarios.every(isValid));
  assert.deepEqual(findMissingCoverage({
    axes: AXES,
    scenarios,
    strength: 3,
    isValid,
  }), []);
});

test('covering array rejects malformed axes and impossible constraints', () => {
  assert.throws(() => generateCoveringArray({ axes: { empty: [] } }), /non-empty/);
  assert.throws(() => generateCoveringArray({ axes: AXES, isValid: () => false }), /rejected every/);
  assert.throws(() => generateCoveringArray({ axes: AXES, strength: 5 }), /Invalid/);
});

test('cancel UI matrix covers every declared pair without the Cartesian product', () => {
  const vectors = CANCEL_COVERING_SCENARIOS.map((entry) => entry.vector);

  assert.deepEqual(findMissingCoverage({ axes: CANCEL_MATRIX_AXES, scenarios: vectors }), []);
  assert.equal(vectors.length, 19);
  assert.ok(vectors.length < enumerateCartesian(CANCEL_MATRIX_AXES).length);
});
