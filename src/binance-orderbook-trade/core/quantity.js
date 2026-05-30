import {
  formatDecimalParts,
  isDecimalAtLeast,
  isPositiveDecimalString,
  parseDecimalString,
} from './decimal.js';

function pow10(exp) {
  let result = 1n;
  for (let i = 0; i < exp; i += 1) result *= 10n;
  return result;
}

export function decimalToStepCount(decimalValue, stepSize, rounding = 'floor') {
  const value = parseDecimalString(decimalValue);
  const step = parseDecimalString(stepSize);
  if (!value || !step || step.digits <= 0n) return null;
  const scale = Math.max(value.scale, step.scale);
  const valueDigits = value.digits * pow10(scale - value.scale);
  const stepDigits = step.digits * pow10(scale - step.scale);
  if (rounding === 'ceil') return (valueDigits + stepDigits - 1n) / stepDigits;
  return valueDigits / stepDigits;
}

export function formatStepCount(stepCount, stepSize) {
  const step = parseDecimalString(stepSize);
  if (!step || step.digits <= 0n || stepCount == null || stepCount < 0n) return null;
  return formatDecimalParts(stepCount * step.digits, step.scale);
}

export function allocateLadderQuantities(totalQty, desiredLevels, stepSize, minRequiredQty) {
  const totalSteps = decimalToStepCount(totalQty, stepSize, 'floor');
  const minSteps = decimalToStepCount(minRequiredQty, stepSize, 'ceil');
  const requestedLevels = Number(desiredLevels);
  if (!totalSteps || !minSteps || totalSteps <= 0n || minSteps <= 0n || requestedLevels <= 0) {
    return null;
  }

  const maxExecutableLevels = totalSteps / minSteps;
  const actualLevels = Math.min(requestedLevels, Number(maxExecutableLevels));
  if (actualLevels < 1) return null;

  const levelCount = BigInt(actualLevels);
  const baseSteps = totalSteps / levelCount;
  if (baseSteps < minSteps) return null;

  const quantities = [];
  let remainingSteps = totalSteps;
  for (let i = 0; i < actualLevels; i += 1) {
    const isLast = i === actualLevels - 1;
    const steps = isLast ? remainingSteps : baseSteps;
    if (steps < minSteps) {
      if (quantities.length === 0) return null;
      const previous = decimalToStepCount(quantities.pop(), stepSize, 'floor');
      const merged = previous + steps;
      if (merged < minSteps) return null;
      quantities.push(formatStepCount(merged, stepSize));
      remainingSteps = 0n;
      break;
    }
    quantities.push(formatStepCount(steps, stepSize));
    remainingSteps -= steps;
  }

  return {
    requestedLevels,
    actualLevels: quantities.length,
    totalQty: formatStepCount(totalSteps, stepSize),
    quantities,
  };
}

export { isDecimalAtLeast, isPositiveDecimalString };
