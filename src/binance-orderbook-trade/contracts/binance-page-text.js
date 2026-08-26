const freezeLabels = (labels) => Object.freeze(labels);

export const BINANCE_PAGE_TEXT = Object.freeze({
  tradeMode: Object.freeze({
    OPEN: freezeLabels(['开仓', 'Open']),
    CLOSE: freezeLabels(['平仓', 'Close']),
  }),
  tradeAction: Object.freeze({
    OPEN_LONG: freezeLabels(['开多', 'Open Long']),
    OPEN_SHORT: freezeLabels(['开空', 'Open Short']),
    CLOSE_LONG: freezeLabels(['平多', 'Close Long']),
    CLOSE_SHORT: freezeLabels(['平空', 'Close Short']),
  }),
  availableBalance: freezeLabels(['可用', 'Avbl']),
  postOnly: freezeLabels(['只做Maker', 'Post Only']),
  submitBusy: freezeLabels(['提交中', 'Placing', 'Loading']),
  openableQuantity: freezeLabels(['可开']),
  closeableQuantity: freezeLabels(['可平']),
  cancelAllDialog: freezeLabels(['确定取消全部订单', 'Cancel all orders']),
  accountOrders: Object.freeze({
    positionTab: freezeLabels(['仓位', 'Positions']),
    openOrdersTab: freezeLabels(['当前委托', 'Open Orders']),
    historyTab: freezeLabels([
      '历史委托',
      'Order History',
      '历史成交',
      'Trade History',
      '资金流水',
      'Transaction History',
    ]),
    basicSubTab: freezeLabels(['基础单', 'Basic']),
    conditionalSubTab: freezeLabels(['条件委托', 'Conditional']),
    panelEvidence: freezeLabels([
      '基础单',
      'Basic',
      '条件委托',
      'Conditional',
      'Open Orders',
      '成交数量',
      '只减仓',
      '只做Maker',
      'Post Only',
      '生效时间',
      '追单',
      'Chase',
    ]),
    currentSymbolEmpty: freezeLabels([
      '暂无当前委托。',
      'You have no open orders.',
    ]),
    cancelAll: freezeLabels([
      '全撤',
      '全部撤单',
      '撤销全部',
      'Cancel All',
    ]),
    hideOtherSymbols: freezeLabels(['隐藏其他合约', 'Hide Other Symbols']),
    rowCancel: freezeLabels(['撤销挂单', 'Cancel Order']),
    perpetual: freezeLabels(['永续', 'Perp']),
  }),
});

export function normalizeBinancePageText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeForComparison(value) {
  return normalizeBinancePageText(value).toLocaleLowerCase();
}

export function matchesBinancePageText(value, labels) {
  const normalized = normalizeForComparison(value);
  return labels.some((label) => normalizeForComparison(label) === normalized);
}

export function includesBinancePageText(value, labels) {
  const normalized = normalizeForComparison(value);
  return labels.some((label) => normalized.includes(normalizeForComparison(label)));
}

export function includesCompactBinancePageText(value, labels) {
  const normalized = normalizeForComparison(value).replace(/\s+/g, '');
  return labels.some((label) => (
    normalized.includes(normalizeForComparison(label).replace(/\s+/g, ''))
  ));
}

export function startsWithBinancePageText(value, labels) {
  const normalized = normalizeForComparison(value);
  return labels.some((label) => {
    const normalizedLabel = normalizeForComparison(label);
    return normalized === normalizedLabel
      || normalized.startsWith(`${normalizedLabel}(`)
      || normalized.startsWith(`${normalizedLabel} (`);
  });
}

export function parseBinanceTabCount(value, labels) {
  const normalized = normalizeForComparison(value);
  for (const label of labels) {
    const normalizedLabel = normalizeForComparison(label);
    if (!normalized.startsWith(normalizedLabel)) continue;
    const suffix = normalized.slice(normalizedLabel.length);
    const match = /^\s*\(\s*(\d+)\s*\)$/.exec(suffix);
    return match ? Number(match[1]) : null;
  }
  return null;
}

export function buildBinanceTextAlternation(labels) {
  return labels
    .map((label) => String(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
}

export function hasBinanceCurrentSymbolOpenOrdersEmptyText(value) {
  return includesBinancePageText(value, BINANCE_PAGE_TEXT.accountOrders.currentSymbolEmpty);
}

export function isBinanceCancelAllText(value) {
  return matchesBinancePageText(value, BINANCE_PAGE_TEXT.accountOrders.cancelAll);
}
