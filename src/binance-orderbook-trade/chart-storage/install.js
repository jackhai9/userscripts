import { installUnchangedChartWriteFilter } from './unchanged-write-filter.js';
import { isTopLevelTradingPage } from '../top-trading-page.js';

/** Run before Binance code so its first chart writes already pass through the filter. */
export function installChartWriteFilter() {
  if (!isTopLevelTradingPage() || Object.hasOwn(self, '__BINANCE_CHART_STORAGE__')) return;
  Object.defineProperty(self, '__BINANCE_CHART_STORAGE__', {
    value: installUnchangedChartWriteFilter(self), configurable: true,
  });
}
