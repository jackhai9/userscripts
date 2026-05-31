const FUTURES_TRADING_PATH_RE = /^\/(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?futures\/([A-Z0-9_]{3,})\/?$/;

export function parseFuturesTradingSymbolFromPathname(pathname) {
  const normalized = String(pathname || '').split(/[?#]/, 1)[0];
  const match = normalized.match(FUTURES_TRADING_PATH_RE);
  return match?.[1] ? match[1].toUpperCase() : null;
}

export function isFuturesTradingPathname(pathname) {
  return Boolean(parseFuturesTradingSymbolFromPathname(pathname));
}
