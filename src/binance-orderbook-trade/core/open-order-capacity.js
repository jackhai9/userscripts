import {
  compareDecimalStrings,
  isPositiveDecimalString,
  normalizeDecimalString,
  subtractDecimalStrings,
} from './decimal.js';

function getDecimalDistance(left, right) {
  const comparison = compareDecimalStrings(left, right);
  if (comparison == null) throw new Error('Open-order distance input is invalid');
  return comparison >= 0
    ? subtractDecimalStrings(left, right)
    : subtractDecimalStrings(right, left);
}

/**
 * Returns the farthest orders without mutating the DOM-derived input order.
 * Equal distances retain their original list order so duplicate Binance rows
 * can still be cancelled one at a time through their occurrence count.
 */
export function selectFarthestOpenOrders(rows, referencePrice, limit) {
  const normalizedReference = normalizeDecimalString(referencePrice);
  if (!isPositiveDecimalString(normalizedReference)) {
    throw new Error('Open-order reference price is invalid');
  }
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error('Open-order cancellation limit is invalid');
  }
  if (!Array.isArray(rows)) throw new Error('Open-order rows are invalid');

  const ranked = rows.map((row, index) => {
    if (!row || typeof row.key !== 'string' || row.key === '') {
      throw new Error('Open-order row key is invalid');
    }
    const price = normalizeDecimalString(row.price);
    if (!isPositiveDecimalString(price)) throw new Error('Open-order row price is invalid');
    return {
      row,
      index,
      distance: getDecimalDistance(price, normalizedReference),
    };
  });

  ranked.sort((left, right) => {
    const distanceComparison = compareDecimalStrings(left.distance, right.distance);
    if (distanceComparison == null) throw new Error('Open-order distance comparison failed');
    return distanceComparison === 0 ? left.index - right.index : -distanceComparison;
  });
  return ranked.slice(0, limit).map(({ row }) => row);
}
