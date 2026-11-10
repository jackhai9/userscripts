import { observeOrderLineSaves } from './order-line-saves.js';
import { installUnchangedChartWriteFilter } from './unchanged-write-filter.js';
import { isTopLevelTradingPage } from '../top-trading-page.js';

/**
 * Run before Binance code so its first chart writes already pass through the filter.
 * Each handler receives every dependency mismatch of its filter once; Binance's
 * native behavior stays in effect for it.
 */
export function installChartWriteFilter({ onOrderLineContractBreak, onWriteFilterContractBreak }) {
  if (!isTopLevelTradingPage() || Object.hasOwn(self, '__BINANCE_CHART_STORAGE__')) return;
  const { snapshot, breaks: writeFilterBreaks, noteNativeSave } = installUnchangedChartWriteFilter(self, { onContractBreak: onWriteFilterContractBreak });
  const orderLineSaves = observeOrderLineSaves(self.document, {
    onContractBreak: onOrderLineContractBreak,
    setTimeout: self.setTimeout.bind(self),
    now: () => self.performance.now(),
    onNativeSave: noteNativeSave,
  });
  Object.defineProperty(self, '__BINANCE_CHART_STORAGE__', {
    value: Object.freeze({ snapshot, writeFilterBreaks, orderLineSaves }), configurable: true,
  });
}
