export const BINANCE_ACCOUNT_ORDERS_TEXT = Object.freeze({
  currentSymbolEmpty: Object.freeze([
    '暂无当前委托。',
    'You have no open orders.',
  ]),
  cancelAll: Object.freeze([
    '全撤',
    '全部撤单',
    '撤销全部',
    'Cancel All',
  ]),
});

export function hasBinanceCurrentSymbolOpenOrdersEmptyText(value) {
  const text = String(value || '');
  return BINANCE_ACCOUNT_ORDERS_TEXT.currentSymbolEmpty.some((label) => text.includes(label));
}

export function isBinanceCancelAllText(value) {
  const normalized = String(value || '').trim().toLocaleLowerCase();
  return BINANCE_ACCOUNT_ORDERS_TEXT.cancelAll.some(
    (label) => label.toLocaleLowerCase() === normalized,
  );
}
