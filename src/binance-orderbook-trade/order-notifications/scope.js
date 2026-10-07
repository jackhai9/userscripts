import { isBinanceSymbol } from '../../shared/binance-symbol.js';
import { parseFuturesTradingSymbolFromPathname } from '../../shared/binance-futures-route.js';

const ORDINARY_TYPES = new Set([
  'LIMIT', 'MARKET', 'STOP', 'STOP_MARKET', 'TAKE_PROFIT',
  'TAKE_PROFIT_MARKET', 'TRAILING_STOP_MARKET',
]);
const ORDINARY_EXECUTIONS = new Set(['NEW', 'CANCELED', 'EXPIRED', 'TRADE', 'AMENDMENT']);
const UNSCOPED = Object.freeze({ symbol: null });

/**
 * Preserve system/unknown events. Native toast callbacks receive cached REST
 * orders, which need not contain the stream-only operate or origType fields.
 * Only the symbol survives the native debounce; no order identifiers are kept.
 */
export function createOrderNotificationToken(order) {
  if (!order || typeof order !== 'object' || !isBinanceSymbol(order.symbol)
      || !ORDINARY_TYPES.has(order.type)
      || typeof order.clientOrderId !== 'string' || order.clientOrderId.length === 0) return UNSCOPED;
  if (Object.hasOwn(order, 'origType') && !ORDINARY_TYPES.has(order.origType)) return UNSCOPED;
  if (Object.hasOwn(order, 'operate') && !ORDINARY_EXECUTIONS.has(order.operate)) return UNSCOPED;
  if (order.clientOrderId.startsWith('autoclose-')
      || order.clientOrderId.startsWith('adl_autoclose')
      || order.clientOrderId.startsWith('settlement_autoclose-')) return UNSCOPED;
  return Object.freeze({ symbol: order.symbol });
}

/**
 * Strings are accepted native queue entries from before the two sound factories
 * jointly activate. They have no reliable symbol and retain their native path.
 */
export function isOrderNotificationTokenAllowed(token, pathname) {
  if (typeof token === 'string') return true;
  if (!token || typeof token !== 'object' || (token.symbol !== null && !isBinanceSymbol(token.symbol))) {
    throw new TypeError('Notification scope requires a native string or a classified symbol token');
  }
  const currentSymbol = parseFuturesTradingSymbolFromPathname(pathname);
  return token.symbol === null || currentSymbol === null || token.symbol === currentSymbol;
}
