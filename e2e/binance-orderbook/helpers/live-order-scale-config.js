const PROFILE_FIELDS = [
  'schemaVersion',
  'profileName',
  'sampleCount',
  'maxOrderCount',
  'scaleRatios',
];
const LIVE_CONTEXT_FIELDS = [
  'testBudget',
  'currentLeverage',
  'perOrderPrice',
  'perOrderQuantity',
  'safetyFactor',
  'liveMaxNumOrdersLimit',
  'existingCurrentSymbolOpenOrders',
  'outstandingTestOwnedOrders',
];
export const CAPACITY_EVIDENCE_FIELDS = Object.freeze([
  ...LIVE_CONTEXT_FIELDS,
  'perOrderNotional',
  'maxNewOrdersBySlots',
  'maxNewOrdersByMargin',
]);

function assertRecord(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
}

function assertExactKeys(record, expectedKeys, path) {
  const actual = Object.keys(record).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${path} keys must be exactly: ${expected.join(', ')}`);
  }
}

function parsePositiveDecimal(value, path) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new Error(`${path} must be an unsigned decimal string`);
  }
  const [whole, fraction = ''] = value.split('.');
  const numerator = BigInt(`${whole}${fraction}`);
  if (numerator <= 0n) throw new Error(`${path} must be greater than zero`);
  return { numerator, scale: 10n ** BigInt(fraction.length) };
}

function normalizeFraction(numerator, scale) {
  let value = numerator;
  let divisor = scale;
  while (divisor > 1n && value % 10n === 0n) {
    value /= 10n;
    divisor /= 10n;
  }
  if (divisor === 1n) return value.toString();
  const digits = divisor.toString().length - 1;
  return `${value / divisor}.${(value % divisor).toString().padStart(digits, '0')}`;
}

function multiplyDecimalStrings(left, right, path) {
  const a = parsePositiveDecimal(left, `${path}.left`);
  const b = parsePositiveDecimal(right, `${path}.right`);
  return normalizeFraction(a.numerator * b.numerator, a.scale * b.scale);
}

function floorAffordableOrders({
  testBudget,
  currentLeverage,
  safetyFactor,
  perOrderNotional,
}) {
  const budget = parsePositiveDecimal(testBudget, 'liveContext.testBudget');
  const safety = parsePositiveDecimal(safetyFactor, 'liveContext.safetyFactor');
  const notional = parsePositiveDecimal(perOrderNotional, 'capacity.perOrderNotional');
  const numerator = budget.numerator * BigInt(currentLeverage) * safety.numerator * notional.scale;
  const denominator = budget.scale * safety.scale * notional.numerator;
  return Number(numerator / denominator);
}

export function validateLiveOrderScaleProfile(profile) {
  assertRecord(profile, 'profile');
  assertExactKeys(profile, PROFILE_FIELDS, 'profile');
  if (profile.schemaVersion !== 1) throw new Error('profile.schemaVersion must equal 1');
  if (typeof profile.profileName !== 'string' || profile.profileName.length === 0) {
    throw new Error('profile.profileName must be a non-empty string');
  }
  for (const field of ['sampleCount', 'maxOrderCount']) {
    if (!Number.isInteger(profile[field]) || profile[field] < 3) {
      throw new Error(`profile.${field} must be an integer of at least 3`);
    }
  }
  assertRecord(profile.scaleRatios, 'profile.scaleRatios');
  assertExactKeys(profile.scaleRatios, ['small', 'medium', 'large'], 'profile.scaleRatios');
  const ratios = ['small', 'medium', 'large'].map((label) => profile.scaleRatios[label]);
  if (!ratios.every((ratio) => Number.isFinite(ratio) && ratio > 0 && ratio <= 1)) {
    throw new Error('profile.scaleRatios must contain ratios in (0, 1]');
  }
  if (!(ratios[0] < ratios[1] && ratios[1] < ratios[2] && ratios[2] === 1)) {
    throw new Error('profile.scaleRatios must be strictly increasing and large must equal 1');
  }
  return profile;
}

function validateLiveContext(context) {
  assertRecord(context, 'liveContext');
  assertExactKeys(context, LIVE_CONTEXT_FIELDS, 'liveContext');
  for (const field of ['testBudget', 'perOrderPrice', 'perOrderQuantity', 'safetyFactor']) {
    parsePositiveDecimal(context[field], `liveContext.${field}`);
  }
  const safety = parsePositiveDecimal(context.safetyFactor, 'liveContext.safetyFactor');
  if (safety.numerator > safety.scale) {
    throw new Error('liveContext.safetyFactor must not exceed 1');
  }
  for (const field of [
    'currentLeverage',
    'liveMaxNumOrdersLimit',
    'existingCurrentSymbolOpenOrders',
    'outstandingTestOwnedOrders',
  ]) {
    if (!Number.isInteger(context[field]) || context[field] < 0) {
      throw new Error(`liveContext.${field} must be a non-negative integer`);
    }
  }
  if (context.currentLeverage === 0) throw new Error('liveContext.currentLeverage must be positive');
  if (context.liveMaxNumOrdersLimit < 2) {
    throw new Error('liveContext.liveMaxNumOrdersLimit must be at least 2');
  }
  return context;
}

function deriveScaleCount(capacity, ratio, minimum) {
  return Math.max(minimum, Math.round(capacity * ratio));
}

/**
 * Builds serializable capacity evidence from a caller-allocated test budget.
 * The caller must keep the budget within the verified live balance so persisted
 * evidence proves capacity without disclosing the account's exact balance.
 */
export function createLiveOrderCapacityEvidence(liveContext) {
  validateLiveContext(liveContext);
  const perOrderNotional = multiplyDecimalStrings(
    liveContext.perOrderPrice,
    liveContext.perOrderQuantity,
    'capacity.perOrderNotional',
  );
  const maxNewOrdersBySlots = Math.max(
    0,
    Math.min(liveContext.liveMaxNumOrdersLimit - 1, 199)
      - liveContext.existingCurrentSymbolOpenOrders
      - liveContext.outstandingTestOwnedOrders,
  );
  const maxNewOrdersByMargin = floorAffordableOrders({
    ...liveContext,
    perOrderNotional,
  });
  return Object.freeze({
    ...liveContext,
    perOrderNotional,
    maxNewOrdersBySlots,
    maxNewOrdersByMargin,
  });
}

export function createLiveOrderScalePlan(profile, liveContext) {
  validateLiveOrderScaleProfile(profile);
  const capacityEvidence = createLiveOrderCapacityEvidence(liveContext);
  const effectiveCapacity = Math.min(
    profile.maxOrderCount,
    capacityEvidence.maxNewOrdersBySlots,
    capacityEvidence.maxNewOrdersByMargin,
  );
  if (effectiveCapacity < 3) {
    throw new Error(`Live order capacity ${effectiveCapacity} cannot form three distinct scales`);
  }

  const labels = ['small', 'medium', 'large'];
  const counts = labels.map((label, index) => deriveScaleCount(
    effectiveCapacity,
    profile.scaleRatios[label],
    index + 1,
  ));
  if (new Set(counts).size !== counts.length || counts[2] !== effectiveCapacity) {
    throw new Error(`Scale ratios collapse at effective capacity ${effectiveCapacity}`);
  }

  return Object.freeze({
    profileName: profile.profileName,
    sampleCount: profile.sampleCount,
    effectiveCapacity,
    capacityEvidence,
    scales: labels.map((label, index) => Object.freeze({
      label,
      preferredTargetOrderCount: deriveScaleCount(
        profile.maxOrderCount,
        profile.scaleRatios[label],
        index + 1,
      ),
      effectiveTargetOrderCount: counts[index],
    })),
  });
}

export function validateLiveOrderCapacityEvidence(evidence, path = 'capacityEvidence') {
  assertRecord(evidence, path);
  assertExactKeys(evidence, CAPACITY_EVIDENCE_FIELDS, path);
  const context = Object.fromEntries(LIVE_CONTEXT_FIELDS.map((field) => [field, evidence[field]]));
  const expected = createLiveOrderCapacityEvidence(context);
  if (evidence.perOrderNotional !== expected.perOrderNotional) {
    throw new Error(`${path}.perOrderNotional does not match price x quantity`);
  }
  for (const field of ['maxNewOrdersBySlots', 'maxNewOrdersByMargin']) {
    if (evidence[field] !== expected[field]) {
      throw new Error(`${path}.${field} does not match its inputs`);
    }
  }
  return evidence;
}
