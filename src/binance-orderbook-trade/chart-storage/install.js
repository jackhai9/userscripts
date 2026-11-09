import { observeOrderLineSaves } from './order-line-saves.js';
import { installUnchangedChartWriteFilter } from './unchanged-write-filter.js';
import { isTopLevelTradingPage } from '../top-trading-page.js';

/**
 * Run before Binance code so its first chart writes already pass through the filter.
 * `onOrderLineContractBreak` receives each dependency mismatch of the order-line
 * filter once; Binance's native save stays in effect for it.
 */
export function installChartWriteFilter({ onOrderLineContractBreak }) {
  if (!isTopLevelTradingPage() || Object.hasOwn(self, '__BINANCE_CHART_STORAGE__')) return;
  const writeFilter = installUnchangedChartWriteFilter(self);
  const orderLineSaves = observeOrderLineSaves(self.document, {
    onContractBreak: onOrderLineContractBreak,
    setTimeout: self.setTimeout.bind(self),
    now: () => self.performance.now(),
  });
  Object.defineProperty(self, '__BINANCE_CHART_STORAGE__', {
    value: Object.freeze({ ...writeFilter, orderLineSaves }), configurable: true,
  });
}
