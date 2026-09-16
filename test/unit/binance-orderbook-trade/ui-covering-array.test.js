import test from 'node:test';
import assert from 'node:assert/strict';
import { captureThrownError } from '../../helpers/orderbook-migration-errors.js';

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

test("user sees that covering array deterministically covers every valid pair with fewer scenarios", () => {
  // Given the scenario axes and valid combinations are declared
  const first = generateCoveringArray({ axes: AXES });
  // When the UI scenario coverage is calculated
  const second = generateCoveringArray({ axes: AXES });



  // Then sees that covering array deterministically covers every valid pair with fewer scenarios
  assert.deepEqual(second, first);
  assert.deepEqual(findMissingCoverage({ axes: AXES, scenarios: first }), []);
  assert.ok(first.length < enumerateCartesian(AXES).length);
});

test("user sees that covering array derives requirements only from valid constrained scenarios", () => {
  // Given the scenario axes and valid combinations are declared
  const isValid = (scenario) => scenario.orders !== 'none' || scenario.outcome === 'cancel';
  const scenarios = generateCoveringArray({ axes: AXES, strength: 3, isValid });

  // When the UI scenario coverage is calculated
  const observed = scenarios.every(isValid);

  // Then sees that covering array derives requirements only from valid constrained scenarios
  assert.ok(observed);
  assert.deepEqual(findMissingCoverage({
    axes: AXES,
    scenarios,
    strength: 3,
    isValid,
  }), []);
});

test("user sees that covering array rejects malformed axes and impossible constraints", () => {
  // Given empty axes, an impossible validity constraint, and excessive pair strength
  const configurations = [
    { axes: { empty: [] } },
    { axes: AXES, isValid: () => false },
    { axes: AXES, strength: 5 },
  ];

  // When scenario generation evaluates each invalid input contract
  const failures = configurations.map((options) => captureThrownError(() => generateCoveringArray(options)));

  // Then every invalid matrix is rejected for its specific reason
  assert.match(failures[0].message, /non-empty/);
  assert.match(failures[1].message, /rejected every/);
  assert.match(failures[2].message, /Invalid/);
});

test("user sees that cancel UI matrix covers every declared pair without the Cartesian product", () => {
  // Given the scenario axes and valid combinations are declared
  const vectors = CANCEL_COVERING_SCENARIOS.map((entry) => entry.vector);

  // When the UI scenario coverage is calculated
  const observed = findMissingCoverage({ axes: CANCEL_MATRIX_AXES, scenarios: vectors });

  // Then sees that cancel UI matrix covers every declared pair without the Cartesian product
  assert.deepEqual(observed, []);
  assert.equal(vectors.length, 19);
  assert.ok(vectors.length < enumerateCartesian(CANCEL_MATRIX_AXES).length);
});
