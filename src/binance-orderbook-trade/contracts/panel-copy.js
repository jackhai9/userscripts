export const UI_LOCALE_ZH_CN = 'zh-CN';
export const UI_LOCALE_EN = 'en';

export const SUPPORTED_UI_LOCALES = Object.freeze([
  UI_LOCALE_ZH_CN,
  UI_LOCALE_EN,
]);

export function localizedText(zhCN, en) {
  if (typeof zhCN !== 'string' || zhCN === '' || typeof en !== 'string' || en === '') {
    throw new Error('Localized UI text requires non-empty Chinese and English values');
  }
  return Object.freeze({ zhCN, en });
}

export function isLocalizedText(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof value.zhCN === 'string'
    && typeof value.en === 'string',
  );
}

export function formatLocalizedText(value, locale) {
  if (typeof value === 'string') return value;
  if (!isLocalizedText(value)) throw new Error('Invalid localized UI text');
  if (locale === UI_LOCALE_ZH_CN) return value.zhCN;
  if (locale === UI_LOCALE_EN) return value.en;
  throw new Error(`Unsupported UI locale: ${locale}`);
}

export function combineLocalizedText(parts, separator = '') {
  if (!Array.isArray(parts) || typeof separator !== 'string') {
    throw new Error('Invalid localized UI text composition');
  }
  return localizedText(
    parts.map((part) => formatLocalizedText(part, UI_LOCALE_ZH_CN)).join(separator),
    parts.map((part) => formatLocalizedText(part, UI_LOCALE_EN)).join(separator),
  );
}

export function resolveUiLocaleFromPathname(pathname) {
  const firstSegment = String(pathname || '').split(/[?#]/, 1)[0].split('/').filter(Boolean)[0];
  return firstSegment?.toLowerCase() === 'zh-cn' ? UI_LOCALE_ZH_CN : UI_LOCALE_EN;
}

const freezeCopy = (copy) => Object.freeze(copy);

export const PANEL_COPY = Object.freeze({
  section: freezeCopy({
    singleOrder: localizedText('单击下单', 'Single Order'),
    ladderMaker: localizedText('阶梯下单 · Maker', 'Ladder Orders · Maker'),
  }),
  field: freezeCopy({
    clickOrderbook: localizedText('单击订单簿时', 'On click'),
    minimumOrderQuantity: localizedText('最小下单量的', 'Minimum order qty'),
    minimumOpenQuantity: localizedText('最小开仓量的', 'Minimum open qty'),
    minimumCloseQuantity: localizedText('最小平仓量的', 'Minimum close qty'),
    ratio: localizedText('比例', 'Ratio'),
    orderCount: localizedText('笔数', 'Orders'),
    interval: localizedText('间距', 'Gap'),
    pricePrecision: localizedText('精度', 'Precision'),
    multiplierUnit: localizedText('倍', '×'),
  }),
  action: freezeCopy({
    openLong: localizedText('阶梯开多', 'Open Long'),
    openShort: localizedText('阶梯开空', 'Open Short'),
    closeLong: localizedText('阶梯平多', 'Close Long'),
    closeShort: localizedText('阶梯平空', 'Close Short'),
    cancel: localizedText('撤单', 'Cancel'),
    cancelRunning: localizedText('撤单处理中', 'Cancelling'),
    noOrders: localizedText('无挂单', 'No Orders'),
    accountRebalance: localizedText('账户再平衡', 'Account Rebalance'),
    stopLadderByAction: freezeCopy({
      OPEN_LONG: localizedText('停止开多', 'Stop Open Long'),
      OPEN_SHORT: localizedText('停止开空', 'Stop Open Short'),
      CLOSE_LONG: localizedText('停止平多', 'Stop Close Long'),
      CLOSE_SHORT: localizedText('停止平空', 'Stop Close Short'),
    }),
  }),
  side: freezeCopy({
    long: localizedText('多', 'Long'),
    short: localizedText('空', 'Short'),
    openLong: localizedText('开多', 'Open Long'),
    openShort: localizedText('开空', 'Open Short'),
    closeLong: localizedText('平多', 'Close Long'),
    closeShort: localizedText('平空', 'Close Short'),
  }),
  state: freezeCopy({
    idle: localizedText('空闲', 'Idle'),
    allPositionsClosed: localizedText('已全部平仓', 'All positions closed'),
    waitingTradeMode: localizedText('等待开仓/平仓状态', 'Waiting for trade mode'),
    waitingPricePrecision: localizedText('等待价格精度', 'Waiting for precision'),
    minimumQuantityLoading: localizedText('最小量读取中', 'Loading minimum qty'),
    positiveIntegerMultiplier: localizedText('请输入正整数倍数', 'Enter a positive integer'),
    noClosablePosition: localizedText('暂无可平仓位', 'No position to close'),
  }),
  status: freezeCopy({
    precisionUpdated: localizedText('精度推荐已更新', 'Precision recommendation updated'),
    precisionInsufficient: localizedText(
      '近期价格变化不足，请稍后重试',
      'Recent price movement is insufficient. Try again later.',
    ),
  }),
  aria: freezeCopy({
    decrementMultiplier: localizedText('减少倍数', 'Decrease multiplier'),
    incrementMultiplier: localizedText('增加倍数', 'Increase multiplier'),
  }),
  tooltip: freezeCopy({
    singleOrder: localizedText(
      '单击订单簿中的某个价格，按当前方向和数量设置提交一笔订单。',
      'Click a price in the order book to submit one order using the current side and quantity settings.',
    ),
    ladderMaker: localizedText(
      '根据当前比例、笔数、间距和价格精度设置，依次提交只做 Maker 的阶梯订单。',
      'Submit Post Only ladder orders sequentially using the current ratio, order count, gap, and precision.',
    ),
    ratio: localizedText(
      '本次阶梯下单使用可开/可平数量的百分比。',
      'Percentage of the available open or close quantity used by this ladder.',
    ),
    orderCount: localizedText(
      '计划拆分成多少笔阶梯订单。',
      'Number of orders in the ladder.',
    ),
    interval: localizedText(
      '相邻订单跨越多少个订单簿价格级别。',
      'Number of order-book price levels between adjacent orders.',
    ),
    pricePrecision: localizedText(
      '与订单簿中的价格精度联动。黄点表示推荐值。比例、笔数、间距会随所选精度恢复对应设置。',
      'Linked to the order-book price precision. The yellow dot marks the recommendation. Ratio, orders, and gap restore their saved values for the selected precision.',
    ),
    continuousClose: localizedText(
      'Option/Alt + 单击：连续交易',
      'Option/Alt + click: continuous trading',
    ),
    accountRebalance: localizedText(
      '将资金、现货和 U 本位账户的 USDT 按 5:4:1 分配',
      'Allocate USDT across Funding, Spot, and USDⓈ-M Futures accounts at a 5:4:1 ratio',
    ),
  }),
});

export function formatPrecisionRefreshTooltip(tradeCount) {
  const count = Number(tradeCount);
  if (!Number.isInteger(count) || count <= 1) {
    throw new Error(`价格精度成交样本数无效：${tradeCount}`);
  }
  return localizedText(
    `优先根据最新 ${count} 条成交价；价格变化不足时自动扩大范围，重新计算推荐精度。`,
    `Use the latest ${count} trades first; expand the range when price movement is insufficient and recalculate the recommended precision.`,
  );
}
