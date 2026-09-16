import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  createLiveOrderCapacityEvidence,
  createLiveOrderScalePlan,
  validateLiveOrderCapacityEvidence,
  validateLiveOrderScaleProfile,
} from '../../e2e/binance-orderbook/helpers/live-order-scale-config.js';

const profile = JSON.parse(await readFile(
  new URL('../../e2e/binance-orderbook/live-configs/smoke.json', import.meta.url),
));

function liveContext(overrides = {}) {
  return {
    testBudget: '13.28',
    currentLeverage: 5,
    perOrderPrice: '2',
    perOrderQuantity: '2.5',
    safetyFactor: '0.8',
    liveMaxNumOrdersLimit: 200,
    existingCurrentSymbolOpenOrders: 0,
    outstandingTestOwnedOrders: 0,
    ...overrides,
  };
}

test('user observes that smoke profile derives three internal scales from live capacity', () => {
  // Given the supplied input retains its original contract values
  const scenarioInput = profile;
  // When the real operation processes that input
  const observed = validateLiveOrderScaleProfile(scenarioInput).profileName;
  // Then smoke profile derives three internal scales from live capacity
  assert.equal(observed, 'smoke');
  const plan = createLiveOrderScalePlan(profile, liveContext());

  assert.equal(plan.effectiveCapacity, 3);
  assert.deepEqual(plan.scales, [
    { label: 'small', preferredTargetOrderCount: 1, effectiveTargetOrderCount: 1 },
    { label: 'medium', preferredTargetOrderCount: 2, effectiveTargetOrderCount: 2 },
    { label: 'large', preferredTargetOrderCount: 3, effectiveTargetOrderCount: 3 },
  ]);
  assert.equal(plan.capacityEvidence.perOrderNotional, '5');
  assert.equal(plan.capacityEvidence.maxNewOrdersBySlots, 199);
  assert.equal(plan.capacityEvidence.maxNewOrdersByMargin, 10);
});

test('user observes that scale counts are configuration-driven rather than fixed to smoke values', () => {
  // Given the supplied input describes this data scenario
  const scenarioInput = { ...profile, maxOrderCount: 40 };
  // When the scale counts are configuration-driven rather than fixed to smoke values
  const plan = createLiveOrderScalePlan(scenarioInput, liveContext({
    testBudget: '100',
  }));

  // Then scale counts are configuration-driven rather than fixed to smoke values
  assert.deepEqual(plan.scales.map((scale) => scale.effectiveTargetOrderCount), [10, 20, 40]);
});

test('user observes that insufficient live capacity fails instead of silently collapsing scale labels', () => {
  // Given the rejected input preserves the specific invalid condition
  const scenarioInput = liveContext({ testBudget: '0.4' });
  let failure;
  // When the real operation evaluates the rejected input
  try {
    createLiveOrderScalePlan(profile, scenarioInput);
  } catch (error) {
    failure = error;
  }
  // Then insufficient live capacity fails instead of silently collapsing scale labels
  assert.ok(failure instanceof Error);
  assert.match(failure.message, /cannot form three distinct scales/);
});

test('user observes that capacity evidence validates actual notional and slot arithmetic', () => {
  // Given the supplied input describes this data scenario
  const scenarioInput = profile;
  // When the capacity evidence validates actual notional and slot arithmetic
  const evidence = createLiveOrderScalePlan(scenarioInput, liveContext()).capacityEvidence;
  // Then capacity evidence validates actual notional and slot arithmetic
  assert.equal(validateLiveOrderCapacityEvidence(evidence).perOrderNotional, '5');
  assert.throws(
    () => validateLiveOrderCapacityEvidence({ ...evidence, perOrderNotional: '4.9' }),
    /does not match price x quantity/,
  );
});

test('user observes that one-order smoke capacity is valid without requiring three scale levels', () => {
  // Given the supplied input describes this data scenario
  const scenarioInput = liveContext({
    testBudget: '1.25',
    currentLeverage: 1,
    perOrderPrice: '1',
    perOrderQuantity: '1',
  });
  // When the one-order smoke capacity is valid without requiring three scale levels
  const evidence = createLiveOrderCapacityEvidence(scenarioInput);

  // Then one-order smoke capacity is valid without requiring three scale levels
  assert.equal(evidence.maxNewOrdersByMargin, 1);
  assert.equal(validateLiveOrderCapacityEvidence(evidence), evidence);
  assert.throws(
    () => createLiveOrderScalePlan(profile, liveContext({
      testBudget: '1.25',
      currentLeverage: 1,
      perOrderPrice: '1',
      perOrderQuantity: '1',
    })),
    /cannot form three distinct scales/,
  );
});

test('user observes that live order slots subtract existing and outstanding test-owned orders', () => {
  // Given the supplied input describes this data scenario
  const scenarioInput = profile;
  // When the live order slots subtract existing and outstanding test-owned orders
  const plan = createLiveOrderScalePlan(scenarioInput, liveContext({
    liveMaxNumOrdersLimit: 8,
    existingCurrentSymbolOpenOrders: 2,
    outstandingTestOwnedOrders: 1,
  }));

  // Then live order slots subtract existing and outstanding test-owned orders
  assert.equal(plan.capacityEvidence.maxNewOrdersBySlots, 4);
  assert.equal(plan.effectiveCapacity, 3);
});

test('user observes that zero leverage fails instead of inventing test capacity', () => {
  // Given the rejected input preserves the specific invalid condition
  const scenarioInput = liveContext({ currentLeverage: 0 });
  let failure;
  // When the real operation evaluates the rejected input
  try {
    createLiveOrderScalePlan(profile, scenarioInput);
  } catch (error) {
    failure = error;
  }
  // Then zero leverage fails instead of inventing test capacity
  assert.ok(failure instanceof Error);
  assert.match(failure.message, /currentLeverage must be positive/);
});
