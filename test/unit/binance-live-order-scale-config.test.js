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
    availableBalance: '13.28',
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

test('smoke profile derives three internal scales from live capacity', () => {
  assert.equal(validateLiveOrderScaleProfile(profile).profileName, 'smoke');
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

test('scale counts are configuration-driven rather than fixed to smoke values', () => {
  const plan = createLiveOrderScalePlan({ ...profile, maxOrderCount: 40 }, liveContext({
    availableBalance: '100',
  }));

  assert.deepEqual(plan.scales.map((scale) => scale.effectiveTargetOrderCount), [10, 20, 40]);
});

test('insufficient live capacity fails instead of silently collapsing scale labels', () => {
  assert.throws(
    () => createLiveOrderScalePlan(profile, liveContext({ availableBalance: '0.4' })),
    /cannot form three distinct scales/,
  );
});

test('capacity evidence validates actual notional and slot arithmetic', () => {
  const evidence = createLiveOrderScalePlan(profile, liveContext()).capacityEvidence;
  assert.equal(validateLiveOrderCapacityEvidence(evidence).perOrderNotional, '5');
  assert.throws(
    () => validateLiveOrderCapacityEvidence({ ...evidence, perOrderNotional: '4.9' }),
    /does not match price x quantity/,
  );
});

test('one-order smoke capacity is valid without requiring three scale levels', () => {
  const evidence = createLiveOrderCapacityEvidence(liveContext({
    availableBalance: '1.25',
    currentLeverage: 1,
    perOrderPrice: '1',
    perOrderQuantity: '1',
  }));

  assert.equal(evidence.maxNewOrdersByMargin, 1);
  assert.equal(validateLiveOrderCapacityEvidence(evidence), evidence);
  assert.throws(
    () => createLiveOrderScalePlan(profile, liveContext({
      availableBalance: '1.25',
      currentLeverage: 1,
      perOrderPrice: '1',
      perOrderQuantity: '1',
    })),
    /cannot form three distinct scales/,
  );
});

test('live order slots subtract existing and outstanding test-owned orders', () => {
  const plan = createLiveOrderScalePlan(profile, liveContext({
    liveMaxNumOrdersLimit: 8,
    existingCurrentSymbolOpenOrders: 2,
    outstandingTestOwnedOrders: 1,
  }));

  assert.equal(plan.capacityEvidence.maxNewOrdersBySlots, 4);
  assert.equal(plan.effectiveCapacity, 3);
});

test('zero leverage fails instead of inventing test capacity', () => {
  assert.throws(
    () => createLiveOrderScalePlan(profile, liveContext({ currentLeverage: 0 })),
    /currentLeverage must be positive/,
  );
});
