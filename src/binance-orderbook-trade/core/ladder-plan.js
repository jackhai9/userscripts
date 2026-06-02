import {
  compareDecimalStrings,
  formatDecimalParts,
  maxDecimalString,
  multiplyDecimalByRatio,
  parseDecimalString,
} from './decimal.js';
import { allocateLadderQuantities, decimalToStepCount, formatStepCount } from './quantity.js';

const LADDER_ACTION_SPECS = {
  OPEN_LONG: {
    mode: 'OPEN',
    label: '阶梯开多',
    priceSide: 'BID',
    orderSide: 'BUY',
    side: 'LONG',
  },
  OPEN_SHORT: {
    mode: 'OPEN',
    label: '阶梯开空',
    priceSide: 'ASK',
    orderSide: 'SELL',
    side: 'SHORT',
  },
  CLOSE_LONG: {
    mode: 'CLOSE',
    label: '阶梯平多',
    priceSide: 'ASK',
    orderSide: 'SELL',
    side: 'LONG',
  },
  CLOSE_SHORT: {
    mode: 'CLOSE',
    label: '阶梯平空',
    priceSide: 'BID',
    orderSide: 'BUY',
    side: 'SHORT',
  },
};

export function getLadderActionSpec(actionType) {
  const spec = LADDER_ACTION_SPECS[actionType];
  return spec ? { ...spec } : null;
}

export function getLadderPercentForMode(mode, openPercent, closePercent) {
  if (mode === 'OPEN') return openPercent;
  if (mode === 'CLOSE') return closePercent;
  return null;
}

function pow10(exp) {
  let result = 1n;
  for (let i = 0; i < exp; i += 1) result *= 10n;
  return result;
}

function computeMinimumLadderPercent(baseQty, minRequiredQty, levels, stepSize) {
  const base = parseDecimalString(baseQty);
  const requestedLevels = Number(levels);
  const minSteps = decimalToStepCount(minRequiredQty, stepSize, 'ceil');
  if (!base || base.digits <= 0n || !minSteps || minSteps <= 0n || requestedLevels <= 0) return null;
  const requiredQty = formatStepCount(minSteps * BigInt(requestedLevels), stepSize);
  const required = parseDecimalString(requiredQty);
  if (!required || required.digits <= 0n) return null;
  const numerator = required.digits * 100n * pow10(base.scale + 2);
  const denominator = base.digits * pow10(required.scale);
  const scaledPercent = (numerator + denominator - 1n) / denominator;
  return formatDecimalParts(scaledPercent, 2);
}

function getMinRequiredQtyForLevels(minRequiredQty, minRequiredQtyByLevel, levels) {
  if (!Array.isArray(minRequiredQtyByLevel) || minRequiredQtyByLevel.length === 0) return minRequiredQty;
  const candidateMinRequiredQty = minRequiredQtyByLevel
    .slice(0, levels)
    .filter(Boolean)
    .reduce((maxQty, qty) => maxDecimalString(maxQty, qty), null);
  return candidateMinRequiredQty || minRequiredQty;
}

export function fitLadderPlanForMinimumQty(options) {
  const { baseQty, minRequiredQty, minRequiredQtyByLevel, percent, levels, stepSize, maxPercent } = options;
  const requestedLevels = Number(levels);
  let minimumPercent = null;
  if (!maxPercent || !Number.isInteger(requestedLevels) || requestedLevels <= 0) {
    return { allocation: null, minimumPercent, maxPercent };
  }

  for (let candidateLevels = requestedLevels; candidateLevels >= 1; candidateLevels -= 1) {
    const candidateMinRequiredQty = getMinRequiredQtyForLevels(minRequiredQty, minRequiredQtyByLevel, candidateLevels);
    const candidatePercent = computeMinimumLadderPercent(baseQty, candidateMinRequiredQty, candidateLevels, stepSize);
    if (candidateLevels === requestedLevels) minimumPercent = candidatePercent;
    if (!candidatePercent || compareDecimalStrings(candidatePercent, maxPercent) > 0) continue;

    const fitPercent = compareDecimalStrings(candidatePercent, percent) > 0 ? candidatePercent : String(percent);
    const fitTotalQty = multiplyDecimalByRatio(baseQty, fitPercent, 100);
    const allocation = allocateLadderQuantities(fitTotalQty, candidateLevels, stepSize, candidateMinRequiredQty);
    if (allocation && allocation.actualLevels >= candidateLevels) {
      return {
        allocation,
        levels: candidateLevels,
        minRequiredQty: candidateMinRequiredQty,
        minimumPercent,
        maxPercent,
        percent: fitPercent,
      };
    }
  }

  return { allocation: null, minimumPercent, maxPercent };
}
