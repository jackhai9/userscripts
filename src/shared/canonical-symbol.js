const CANONICAL_SYMBOL_PATTERN = /^([\p{L}\p{N}]+)\/USDT:USDT$/u;
const ROUTE_SYMBOL_PATTERN = /^([\p{L}\p{N}]+)USDT$/u;

/** Match the server's Unicode letter/number base and exact uppercase wire form. */
export function isCanonicalUsdtSymbol(value) {
  if (typeof value !== 'string') return false;
  const match = value.match(CANONICAL_SYMBOL_PATTERN);
  return Boolean(match && match[0] === value && match[1] === match[1].toUpperCase());
}

export function usdtRouteToCanonical(value) {
  const match = typeof value === 'string' && value.match(ROUTE_SYMBOL_PATTERN);
  if (!match || match[0] !== value || match[1] !== match[1].toUpperCase()) {
    throw new TypeError('Invalid Binance futures route symbol');
  }
  return `${match[1]}/USDT:USDT`;
}

export function canonicalUsdtToRoute(value) {
  if (!isCanonicalUsdtSymbol(value)) throw new TypeError('Invalid canonical USDT symbol');
  return `${value.slice(0, -10)}USDT`;
}
