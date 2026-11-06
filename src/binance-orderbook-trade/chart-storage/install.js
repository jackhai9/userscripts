import { observeOrderLineSaves } from './order-line-saves.js';
import { installUnchangedChartWriteFilter } from './unchanged-write-filter.js';
import { isTopLevelTradingPage } from '../top-trading-page.js';

/** Run before Binance code so its first chart writes already pass through the filter. */
export function installChartWriteFilter() {
  if (!isTopLevelTradingPage() || Object.hasOwn(self, '__BINANCE_CHART_STORAGE__')) return;
  const writeFilter = installUnchangedChartWriteFilter(self);
  const orderLineSaves = observeOrderLineSaves(self.document);
  Object.defineProperty(self, '__BINANCE_CHART_STORAGE__', {
    value: Object.freeze({ ...writeFilter, orderLineSaves }), configurable: true,
  });
}
