import {
  addDecimalStrings,
  compareDecimalStrings,
  isPositiveDecimalString,
  normalizeDecimalString,
  subtractDecimalStrings,
} from './decimal.js';

export function inferOrderbookDisplayStep(prices) {
  let displayStep = null;
  for (let i = 1; i < prices.length; i += 1) {
    const prev = prices[i - 1];
    const current = prices[i];
    let diff = subtractDecimalStrings(current, prev) || subtractDecimalStrings(prev, current);
    diff = normalizeDecimalString(diff);
    if (!diff || !isPositiveDecimalString(diff)) continue;
    if (!displayStep || compareDecimalStrings(diff, displayStep) < 0) displayStep = diff;
  }
  return displayStep;
}

export function calculateDisplayStepPrice(bestPrice, displayStep, side, offsetRows) {
  let price = bestPrice;
  for (let i = 0; i < offsetRows; i += 1) {
    price = side === 'ASK'
      ? addDecimalStrings(price, displayStep)
      : subtractDecimalStrings(price, displayStep);
    if (!price || !isPositiveDecimalString(price)) return null;
  }
  return price;
}

export function planBufferedMakerPrices({
  prices,
  side,
  levels,
  ladderStep,
  bufferLevels = 1,
  defaultStep = 1,
  minStep = 1,
  maxStep = 5,
}) {
  const step = Math.max(minStep, Math.min(Number(ladderStep) || defaultStep, maxStep));
  const bestPrice = prices[0] || null;
  const displayStep = inferOrderbookDisplayStep(prices);
  const result = [];
  for (let i = 0; i < levels; i += 1) {
    const offsetRows = bufferLevels + i * step;
    const price = prices[offsetRows] || (
      bestPrice && displayStep
        ? calculateDisplayStepPrice(bestPrice, displayStep, side, offsetRows)
        : null
    );
    if (price) result.push(price);
  }
  return result;
}
