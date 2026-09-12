export const BINANCE_SYMBOL_CHARACTERS = '\\p{L}\\p{N}_';

const SYMBOL_PATTERN = new RegExp(`^[${BINANCE_SYMBOL_CHARACTERS}]+$`, 'u');

/** Preserve exchange identifiers, including Chinese and numeric-only asset names. */
export function isBinanceSymbol(value) {
  if (typeof value !== 'string' || value !== value.toUpperCase()) return false;
  const match = value.match(SYMBOL_PATTERN);
  return Boolean(match && match[0] === value);
}
