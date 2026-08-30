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
    throw new Error(`不支持的价格精度方向：${direction}`);
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

export function getOrderbookPrecisionShortcutOptions(options, limit = 4) {
  const normalizedLimit = Number(limit);
  if (!Number.isInteger(normalizedLimit) || normalizedLimit < 1) {
    throw new Error(`价格精度快捷项数量无效：${limit}`);
  }
  return Array.from(new Set(sortedPositiveDecimals(options))).slice(0, normalizedLimit);
}

export function formatOrderbookPrecisionShortcutLabel(value) {
  const normalized = normalizeDecimalString(value);
  if (!normalized || !isPositiveDecimalString(normalized)) {
    throw new Error(`价格精度快捷值无效：${value}`);
  }
  if (normalized.length <= 5) return normalized;
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric)) {
    throw new Error(`价格精度快捷值不是有限数值：${value}`);
  }
  return numeric.toExponential().replace('e+', 'e');
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

export function recommendOrderbookPrecisionWithExpandingWindow({
  prices,
  options,
  initialLimit = 10,
  expansionStep = 10,
  minSamples = 5,
  minBucketShare = 0.25,
}) {
  if (!Array.isArray(prices)) {
    throw new Error('价格精度成交价样本必须为数组');
  }
  if (!Number.isInteger(initialLimit) || initialLimit < 2) {
    throw new Error(`价格精度初始样本数无效：${initialLimit}`);
  }
  if (!Number.isInteger(expansionStep) || expansionStep < 1) {
    throw new Error(`价格精度样本扩展步长无效：${expansionStep}`);
  }
  if (!Number.isInteger(minSamples) || minSamples < 1) {
    throw new Error(`价格精度最小样本数无效：${minSamples}`);
  }

  let usedCount = Math.min(initialLimit, prices.length);
  let samples = [];
  let recommendation = null;
  while (true) {
    samples = collectNonZeroPriceMoves(prices.slice(0, usedCount));
    recommendation = recommendOrderbookPrecision({
      samples,
      options,
      minSamples,
      minBucketShare,
    });
    if (recommendation || usedCount >= prices.length) break;
    usedCount = Math.min(usedCount + expansionStep, prices.length);
  }
  return { samples, usedCount, recommendation };
}
