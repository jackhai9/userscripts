import {
  compareDecimalStrings,
  isPositiveDecimalString,
  normalizeDecimalString,
  subtractDecimalStrings,
} from './decimal.js';

export function collectNonZeroPriceMoves(prices) {
  const moves = [];
  let previous = null;
  for (const price of prices) {
    const current = normalizeDecimalString(price);
    if (!current) continue;
    if (previous) {
      const diff = subtractDecimalStrings(current, previous) || subtractDecimalStrings(previous, current);
      const normalizedDiff = normalizeDecimalString(diff);
      if (normalizedDiff && isPositiveDecimalString(normalizedDiff)) moves.push(normalizedDiff);
    }
    previous = current;
  }
  return moves;
}

export function mergePrecisionSamples(existingSamples, newSamples, maxSamples = 64) {
  const merged = [...(existingSamples || []), ...(newSamples || [])]
    .map((sample) => normalizeDecimalString(sample))
    .filter((sample) => sample && isPositiveDecimalString(sample));
  return merged.slice(Math.max(0, merged.length - maxSamples));
}

function sortedPositiveDecimals(values) {
  return (values || [])
    .map((value) => normalizeDecimalString(value))
    .filter((value) => value && isPositiveDecimalString(value))
    .sort((a, b) => compareDecimalStrings(a, b));
}

function percentileDecimal(values, percentile) {
  const sorted = sortedPositiveDecimals(values);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentile) - 1));
  return sorted[index];
}

function logDistance(a, b) {
  const left = Number(a);
  const right = Number(b);
  if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) return Number.POSITIVE_INFINITY;
  return Math.abs(Math.log10(left) - Math.log10(right));
}

export function recommendOrderbookPrecision({
  samples,
  options,
  minSamples = 5,
  percentile = 0.6,
}) {
  const usableSamples = sortedPositiveDecimals(samples);
  const usableOptions = sortedPositiveDecimals(options);
  if (!usableOptions.length) return null;

  const movement = usableSamples.length >= minSamples
    ? percentileDecimal(usableSamples, percentile)
    : null;
  if (!movement) return null;

  let bestOption = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const option of usableOptions) {
    const distance = logDistance(movement, option);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestOption = option;
    }
  }
  return bestOption;
}
