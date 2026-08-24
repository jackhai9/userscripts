import {
  compareDecimalStrings,
  isPositiveDecimalString,
  multiplyDecimalByInt,
  multiplyDecimalByRatio,
  normalizeDecimalString,
  subtractDecimalStrings,
} from './decimal.js';

/**
 * Accept only an exact decade step that Binance exposes for the current symbol.
 * This prevents the shortcut from synthesizing a precision that the native menu cannot select.
 */
export function getOrderbookPrecisionDecadeTarget(options, current, direction) {
  if (direction !== 'DECREASE' && direction !== 'INCREASE') {
    throw new Error(`Unsupported orderbook precision direction: ${direction}`);
  }
  const normalizedCurrent = normalizeDecimalString(current);
  if (!normalizedCurrent || !isPositiveDecimalString(normalizedCurrent)) return null;
  const target = direction === 'INCREASE'
    ? multiplyDecimalByInt(normalizedCurrent, 10)
    : multiplyDecimalByRatio(normalizedCurrent, 1, 10);
  if (!target) return null;
  const available = new Set((options || [])
    .map((value) => normalizeDecimalString(value))
    .filter((value) => value && isPositiveDecimalString(value)));
  if (!available.has(normalizedCurrent)) return null;
  return available.has(target) ? target : null;
}

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

export function resolveOrderbookPrecisionSampleState({
  sampling,
  scheduled,
  status,
  recommendation,
}) {
  const busy = Boolean(sampling || scheduled);
  if (busy) {
    return {
      busy,
      status: status === '刷新中' ? '刷新中' : '采样中',
    };
  }
  if (status && /^(未定位|未找到|数据不足)/.test(status)) {
    return { busy, status };
  }
  return {
    busy,
    status: recommendation ? 'ready' : '数据不足',
  };
}

function sortedPositiveDecimals(values) {
  return (values || [])
    .map((value) => normalizeDecimalString(value))
    .filter((value) => value && isPositiveDecimalString(value))
    .sort((a, b) => compareDecimalStrings(a, b));
}

function logDistance(a, b) {
  const left = Number(a);
  const right = Number(b);
  if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) return Number.POSITIVE_INFINITY;
  return Math.abs(Math.log10(left) - Math.log10(right));
}

function closestPrecisionOption(sample, options) {
  let bestOption = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const option of options) {
    const distance = logDistance(sample, option);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestOption = option;
    }
  }
  return bestOption;
}

export function recommendOrderbookPrecision({
  samples,
  options,
  minSamples = 5,
  minBucketShare = 0.25,
}) {
  const usableSamples = sortedPositiveDecimals(samples);
  const usableOptions = sortedPositiveDecimals(options);
  if (!usableOptions.length) return null;
  if (usableSamples.length < minSamples) return null;

  const bucketCounts = new Map(usableOptions.map((option) => [option, 0]));
  for (const sample of usableSamples) {
    const option = closestPrecisionOption(sample, usableOptions);
    if (option) bucketCounts.set(option, (bucketCounts.get(option) || 0) + 1);
  }

  const minimumBucketCount = Math.max(minSamples, Math.ceil(usableSamples.length * minBucketShare));
  let selectedOption = null;
  let selectedCount = 0;
  for (const option of usableOptions) {
    const count = bucketCounts.get(option) || 0;
    if (count < minimumBucketCount) continue;
    if (
      count > selectedCount ||
      (count === selectedCount && selectedOption && compareDecimalStrings(option, selectedOption) < 0)
    ) {
      selectedOption = option;
      selectedCount = count;
    }
  }
  return selectedOption;
}
