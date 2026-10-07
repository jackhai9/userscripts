import { isFuturesTradingPathname } from '../shared/binance-futures-route.js';

/** Storage admission follows the same concrete contract routes as the trading tools. */
export function isChartStoragePage() {
  return self === top && location.origin === 'https://www.binance.com'
    && isFuturesTradingPathname(location.pathname);
}
