const FUTURES_TRADING_PATH_RE = /^\/(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?futures\/([^/]+)\/?$/;
const TRADING_SYMBOL_RE = /^[\p{L}\p{N}_]{3,}$/u;

export function parseFuturesTradingSymbolFromPathname(pathname) {
  const normalized = String(pathname || '').split(/[?#]/, 1)[0];
  const match = normalized.match(FUTURES_TRADING_PATH_RE);
  if (!match || match[0] !== normalized) return null;
  let symbol;
  try {
    // Browsers percent-encode Unicode segments; malformed paths are not trading routes.
    symbol = decodeURIComponent(match[1]);
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }
  const symbolMatch = symbol.match(TRADING_SYMBOL_RE);
  return symbolMatch && symbolMatch[0] === symbol ? symbol.toUpperCase() : null;
}

export function isFuturesTradingPathname(pathname) {
  return Boolean(parseFuturesTradingSymbolFromPathname(pathname));
}
