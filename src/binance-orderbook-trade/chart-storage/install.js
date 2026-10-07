import { startChartStorageOptimizer } from './runtime.js';
import { isChartStoragePage } from './scope.js';

/** Run before orderbook initialization without widening its frame or route policy. */
export function installChartStorageOptimizer() {
  if (!isChartStoragePage() || Object.hasOwn(self, '__BINANCE_CHART_STORAGE__')) return;
  Object.defineProperty(self, '__BINANCE_CHART_STORAGE__', {
    value: startChartStorageOptimizer(), configurable: true,
  });
}
