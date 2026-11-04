import { isFuturesTradingPathname } from '../shared/binance-futures-route.js';

/** Document-start hooks follow the same concrete contract routes as the trading tools. */
export function isTopLevelTradingPage() {
  return self === top && location.origin === 'https://www.binance.com'
    && isFuturesTradingPathname(location.pathname);
}
