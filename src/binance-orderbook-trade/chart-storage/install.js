import { startChartStorageOptimizer } from './runtime.js';
import { isChartStoragePage } from './scope.js';
import { createOrderNotificationScope } from '../order-notifications/runtime.js';

/** Run before orderbook initialization without widening its frame or route policy. */
export function installChartStorageOptimizer() {
  if (!isChartStoragePage() || Object.hasOwn(self, '__BINANCE_CHART_STORAGE__')) return;
  const notifications = createOrderNotificationScope();
  Object.defineProperty(self, '__BINANCE_ORDER_NOTIFICATIONS__', {
    value: Object.freeze({ snapshot: notifications.snapshot }), configurable: true,
  });
  Object.defineProperty(self, '__BINANCE_CHART_STORAGE__', {
    value: startChartStorageOptimizer({ additionalTargets: notifications.targets }), configurable: true,
  });
}
