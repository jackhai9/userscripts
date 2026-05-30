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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeContractCandidate(candidate, separator) {
  const normalized = String(candidate || '').toUpperCase();
  if (separator === ':') {
    const timeJoinedMatch = /^\d{1,2}([A-Z][A-Z0-9]*USDT)$/.exec(normalized);
    if (timeJoinedMatch) return timeJoinedMatch[1];
  }
  return normalized;
}

function isTimestampJoinedCandidate(candidate, symbol) {
  const normalizedCandidate = String(candidate || '').toUpperCase();
  const normalizedSymbol = String(symbol || '').toUpperCase();
  if (!normalizedCandidate || !normalizedSymbol || !normalizedCandidate.endsWith(normalizedSymbol)) {
    return false;
  }
  const prefix = normalizedCandidate.slice(0, -normalizedSymbol.length);
  return /^\d{1,2}$/.test(prefix);
}

function hasVisibleContractText(text, symbol) {
  const normalizedSymbol = String(symbol || '').toUpperCase();
  if (!normalizedSymbol) return false;
  const symbolPattern = escapeRegExp(normalizedSymbol);
  return new RegExp(`(?:^|[^A-Z0-9]|\\d{1,2}:\\d{2})${symbolPattern}\\s*永续`, 'i')
    .test(String(text || ''));
}

export function readVisibleOpenOrderSymbolsText(text) {
  const normalized = String(text || '').toUpperCase();
  const symbols = new Set();
  const pattern = /([A-Z0-9]{2,30}USDT)\s*永续/g;
  let match = pattern.exec(normalized);
  while (match) {
    const separator = normalized[match.index - 1] || '';
    if (!/[A-Z0-9]/.test(separator)) {
      symbols.add(normalizeContractCandidate(match[1], separator));
    }
    match = pattern.exec(normalized);
  }
  return Array.from(symbols);
}

export function isOpenOrdersScopeLimitedToSymbolText(text, symbol) {
  const normalizedSymbol = String(symbol || '').toUpperCase();
  if (!normalizedSymbol) return false;
  const visibleSymbols = readVisibleOpenOrderSymbolsText(text);
  return visibleSymbols.length > 0 && visibleSymbols.every((visibleSymbol) => (
    visibleSymbol === normalizedSymbol ||
    (hasVisibleContractText(text, normalizedSymbol) && isTimestampJoinedCandidate(visibleSymbol, normalizedSymbol))
  ));
}

export function hasCurrentSymbolOpenOrdersEvidence({
  scopeText,
  symbol,
  symbolFilterOk,
  openOrdersCount,
  cancelAllAvailable,
}) {
  const normalizedSymbol = String(symbol || '').toUpperCase();
  if (!normalizedSymbol) return false;

  const visibleSymbols = readVisibleOpenOrderSymbolsText(scopeText);
  if (visibleSymbols.some((visibleSymbol) => (
    visibleSymbol === normalizedSymbol ||
    (hasVisibleContractText(scopeText, normalizedSymbol) && isTimestampJoinedCandidate(visibleSymbol, normalizedSymbol))
  ))) return true;
  if (visibleSymbols.length > 0) return false;

  return Boolean(symbolFilterOk && (
    (openOrdersCount !== null && openOrdersCount > 0) ||
    cancelAllAvailable
  ));
}
