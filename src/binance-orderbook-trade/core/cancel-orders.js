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
    const timeJoinedMatch = /^\d{1,2}([A-Z][A-Z0-9]*(?:USDT|USDC))$/.exec(normalized);
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
  const pattern = /([A-Z0-9]{2,30}(?:USDT|USDC))\s*永续/g;
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

export function isOpenOrdersScopeConfirmedForSymbolText(text, symbol, filterChecked) {
  if (filterChecked !== true) return false;
  const visibleSymbols = readVisibleOpenOrderSymbolsText(text);
  if (visibleSymbols.length > 0) return isOpenOrdersScopeLimitedToSymbolText(text, symbol);
  return true;
}

/**
 * The active scope must already be confirmed for the current symbol. A zero
 * account count is stronger than stale rendered rows, while a non-zero count
 * may belong entirely to other symbols hidden by the active filter.
 */
export function isCurrentSymbolOpenOrdersClearCandidate({ scopeText, symbol, openOrdersCount }) {
  const visibleSymbols = readVisibleOpenOrderSymbolsText(scopeText);
  if (visibleSymbols.length > 0 && !isOpenOrdersScopeLimitedToSymbolText(scopeText, symbol)) {
    return false;
  }
  if (openOrdersCount === 0) return true;
  return visibleSymbols.length === 0;
}

export function isCurrentSymbolOpenOrdersDefinitivelyClear({ scopeText, symbol, openOrdersCount }) {
  return openOrdersCount === 0 && isCurrentSymbolOpenOrdersClearCandidate({
    scopeText,
    symbol,
    openOrdersCount,
  });
}

export function updateOpenOrdersClearStability({
  clearCandidate,
  clearCandidateSince,
  nowMs,
  settleMs,
}) {
  if (!clearCandidate) return { clearCandidateSince: null, cleared: false };
  const nextCandidateSince = clearCandidateSince ?? nowMs;
  return {
    clearCandidateSince: nextCandidateSince,
    cleared: nowMs - nextCandidateSince >= settleMs,
  };
}

/**
 * A blocked main thread can resume after the wall-clock deadline without ever
 * observing the cleared DOM. Let a post-stall clear candidate finish the
 * stability window instead of returning the last pre-stall state.
 */
export function shouldContinueOpenOrdersClearObservation({
  nowMs,
  deadlineMs,
  clearCandidate,
}) {
  return nowMs < deadlineMs || clearCandidate;
}

export function resolveCancelSymbolButtonPresentation({
  ladderRunning,
  cancelRunning,
  noOrdersFeedback,
}) {
  return {
    disabled: Boolean(ladderRunning || cancelRunning),
    label: cancelRunning
      ? '撤单处理中'
      : noOrdersFeedback && !ladderRunning
        ? '无挂单'
        : '撤本币挂单',
  };
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
