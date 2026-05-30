export function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function isOpenOrdersTabText(text) {
  const normalized = normalizeText(text);
  return /^当前\s*委托(?:\(|\s|$)/.test(normalized) || /^Open Orders(?:\(|\s|$)/i.test(normalized);
}

export function parseOpenOrdersTabCount(text) {
  const normalized = normalizeText(text);
  const match = /(?:当前\s*委托|Open Orders)\s*\(?\s*(\d+)\s*\)?/i.exec(normalized);
  return match ? Number(match[1]) : null;
}

export function readVisibleOpenOrderSymbolsText(text) {
  const normalized = String(text || '').toUpperCase();
  const symbols = new Set();
  const pattern = /\b([A-Z0-9]{2,30}USDT)\s*永续/g;
  let match = pattern.exec(normalized);
  while (match) {
    symbols.add(match[1]);
    match = pattern.exec(normalized);
  }
  return Array.from(symbols);
}

export function isOpenOrdersScopeLimitedToSymbolText(text, symbol) {
  const normalizedSymbol = String(symbol || '').toUpperCase();
  if (!normalizedSymbol) return false;
  const visibleSymbols = readVisibleOpenOrderSymbolsText(text);
  return visibleSymbols.length > 0 && visibleSymbols.every((visibleSymbol) => visibleSymbol === normalizedSymbol);
}

export function hasCurrentSymbolOpenOrdersEvidence({
  scopeText,
  symbol,
  symbolFilterOk,
  openOrdersCount,
}) {
  const normalizedSymbol = String(symbol || '').toUpperCase();
  if (!normalizedSymbol) return false;

  const visibleSymbols = readVisibleOpenOrderSymbolsText(scopeText);
  if (visibleSymbols.some((visibleSymbol) => visibleSymbol === normalizedSymbol)) return true;
  if (visibleSymbols.length > 0) return false;

  return Boolean(symbolFilterOk && openOrdersCount !== null && openOrdersCount > 0);
}
