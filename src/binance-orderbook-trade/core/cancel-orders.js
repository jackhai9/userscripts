import {
  BINANCE_PAGE_TEXT,
  buildBinanceTextAlternation,
  hasBinanceCurrentSymbolOpenOrdersEmptyText,
  parseBinanceTabCount,
  startsWithBinancePageText,
} from '../contracts/binance-page-text.js';
import { PANEL_COPY } from '../contracts/panel-copy.js';
import { BINANCE_SYMBOL_CHARACTERS } from '../../shared/binance-symbol.js';

const PERPETUAL_LABEL_PATTERN = buildBinanceTextAlternation(
  BINANCE_PAGE_TEXT.accountOrders.perpetual,
);
const ORDER_CONTRACT_PATTERN = `[${BINANCE_SYMBOL_CHARACTERS}]+(?:USDT|USDC)`;
const ORDER_SYMBOL_CELL_PATTERN = new RegExp(
  `^(${ORDER_CONTRACT_PATTERN})(?:\\s*(?:${PERPETUAL_LABEL_PATTERN}))?$`,
  'iu',
);

export function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function isOpenOrdersTabText(text) {
  return startsWithBinancePageText(text, BINANCE_PAGE_TEXT.accountOrders.openOrdersTab);
}

export function parseOpenOrdersTabCount(text) {
  return parseBinanceTabCount(text, BINANCE_PAGE_TEXT.accountOrders.openOrdersTab);
}

export function parseOpenOrderContractSymbol(text) {
  const normalized = normalizeText(text);
  const match = normalized.match(ORDER_SYMBOL_CELL_PATTERN);
  return match && match[0] === normalized ? match[1].toUpperCase() : null;
}

export function isOpenOrderRowCurrentSymbol(symbolText, symbol) {
  return parseOpenOrderContractSymbol(symbolText) === String(symbol || '').toUpperCase();
}

export function readVisibleOpenOrderSymbolsText(text) {
  const normalized = String(text || '').toUpperCase();
  const symbols = new Set();
  /**
   * Strip time only at this contract's own HH:mm[:ss] boundary. Numeric asset
   * prefixes are identity, and a bare contract is evidence only on its own line.
   */
  const pattern = new RegExp(
    `(?:^|[^${BINANCE_SYMBOL_CHARACTERS}])(?:\\d{1,2}:\\d{2}(?::\\d{2})?)?`
      + `(${ORDER_CONTRACT_PATTERN})\\s*(?:${PERPETUAL_LABEL_PATTERN})(?=\\s|$)`
      + `|^[\\t ]*(${ORDER_CONTRACT_PATTERN})[\\t ]*$`,
    'gimu',
  );
  let match = pattern.exec(normalized);
  while (match) {
    symbols.add(match[1] ?? match[2]);
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

export function isOpenOrdersScopeConfirmedForSymbolText(text, symbol, filterChecked) {
  if (filterChecked !== true) return false;
  const visibleSymbols = readVisibleOpenOrderSymbolsText(text);
  if (visibleSymbols.length > 0) return isOpenOrdersScopeLimitedToSymbolText(text, symbol);
  return true;
}

/**
 * React commits the checkbox state before replacing the filtered order rows.
 * Treat only current-symbol rows or Binance's explicit empty state as settled.
 */
export function isCurrentSymbolOpenOrdersFilterReady({
  scopeText,
  symbol,
  filterChecked,
  cancelAllAvailable,
}) {
  if (filterChecked !== true) return false;
  const visibleSymbols = readVisibleOpenOrderSymbolsText(scopeText);
  if (visibleSymbols.length > 0) {
    return isOpenOrdersScopeLimitedToSymbolText(scopeText, symbol);
  }
  return (
    !cancelAllAvailable &&
    hasBinanceCurrentSymbolOpenOrdersEmptyText(scopeText)
  );
}

/**
 * Binance renders this explicit empty state only after the active basic-order
 * pane has resolved its current filter. Account-wide order counts are not
 * current-symbol evidence because other symbols can still have open orders.
 */
export function isFilteredCurrentSymbolOpenOrdersEmpty({
  scopeText,
  symbol,
  filterChecked,
  cancelAllAvailable,
}) {
  if (!String(symbol || '').trim()) return false;
  if (filterChecked !== true || cancelAllAvailable) return false;
  if (!hasBinanceCurrentSymbolOpenOrdersEmptyText(scopeText)) return false;
  return readVisibleOpenOrderSymbolsText(scopeText).length === 0;
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
      ? PANEL_COPY.action.cancelRunning
      : noOrdersFeedback && !ladderRunning
        ? PANEL_COPY.action.noOrders
        : PANEL_COPY.action.cancel,
  };
}

export function hasCurrentSymbolOpenOrdersEvidence({
  scopeText,
  symbol,
  symbolFilterOk,
  cancelAllAvailable,
}) {
  const normalizedSymbol = String(symbol || '').toUpperCase();
  if (!normalizedSymbol) return false;

  const visibleSymbols = readVisibleOpenOrderSymbolsText(scopeText);
  if (visibleSymbols.includes(normalizedSymbol)) return true;
  if (visibleSymbols.length > 0) return false;

  return Boolean(symbolFilterOk && cancelAllAvailable);
}
