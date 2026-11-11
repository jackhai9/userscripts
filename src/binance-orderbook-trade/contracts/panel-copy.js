import { localizedText } from '../../shared/ui-locale.js';

const freezeCopy = (copy) => Object.freeze(copy);

export const PANEL_COPY = Object.freeze({
  section: freezeCopy({
    singleOrder: localizedText('单击下单', 'Single Order'),
    ladder: localizedText('阶梯下单 · 吃单', 'Ladder Orders · Taker'),
  }),
  field: freezeCopy({
    clickOrderbook: localizedText('单击订单簿时', 'On click'),
    minimumOrderQuantity: localizedText('最小下单量的', 'Minimum order qty'),
    minimumOpenQuantity: localizedText('最小开仓量的', 'Minimum open qty'),
    minimumCloseQuantity: localizedText('最小平仓量的', 'Minimum close qty'),
    ratio: localizedText('比例', 'Ratio'),
    orderCount: localizedText('笔数', 'Orders'),
    interval: localizedText('间距', 'Gap'),
    takerOff: localizedText('关', 'Off'),
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
    waitingPrecisionOptions: localizedText('等待精度档位', 'Waiting for options'),
    loadingPrecisionOptions: localizedText('读取精度档位', 'Loading options'),
    minimumQuantityLoading: localizedText('最小量读取中', 'Loading minimum qty'),
    positiveIntegerMultiplier: localizedText('请输入正整数倍数', 'Enter a positive integer'),
    noClosablePosition: localizedText('暂无可平仓位', 'No position to close'),
  }),
  status: freezeCopy({
    precisionUpdated: localizedText('精度推荐已更新', 'Precision recommendation updated'),
    precisionOptionsUnavailable: localizedText('档位读取失败，请刷新', 'Options unavailable. Refresh.'),
    precisionInsufficient: localizedText(
      '近期价格变化不足，请稍后重试',
      'Recent price movement is insufficient. Try again later.',
    ),
  }),
  aria: freezeCopy({
    decrementMultiplier: localizedText('减少倍数', 'Decrease multiplier'),
    incrementMultiplier: localizedText('增加倍数', 'Increase multiplier'),
  }),
  rebalanceDialog: freezeCopy({
    accountHeading: localizedText('账户', 'Account'),
    currentHeading: localizedText('当前 (USDT)', 'Current (USDT)'),
    targetHeading: localizedText('目标 (USDT)', 'Target (USDT)'),
    transferHeading: localizedText('划转计划', 'Transfer Plan'),
    cancel: localizedText('取消', 'Cancel'),
    confirm: localizedText('确认再平衡', 'Confirm Rebalance'),
  }),
  automaticRebalance: freezeCopy({
    waitingForFlat: localizedText('自动再平衡：等待账户持续无持仓、无挂单', 'Automatic USDT transfer: waiting for stable flat account'),
    waitingForAccess: localizedText('自动再平衡：等待账户操作完成', 'Automatic USDT transfer: waiting for account access'),
    checkingAccount: localizedText('自动再平衡：正在检查账户', 'Automatic USDT transfer: checking account'),
    blocked: localizedText('自动再平衡已阻止：请先核实上次划转结果', 'Automatic USDT transfer blocked: previous outcome requires account review'),
    completed: localizedText('已自动进行账户再平衡', 'Account automatically rebalanced'),
    notRepeated: localizedText('本轮不再自动执行账户再平衡', 'No further automatic rebalance in this round'),
    noTransfer: localizedText('自动再平衡：无需划转', 'Automatic account rebalance: no transfer needed'),
    paused: localizedText('自动再平衡已暂停：执行条件已变化', 'Automatic USDT transfer paused: eligibility changed'),
    stopped: localizedText('自动再平衡已停止：', 'Automatic USDT transfer stopped: '),
    eligibilityFailed: localizedText('自动再平衡资格检查失败：', 'Automatic USDT eligibility check failed: '),
    accountBusy: localizedText('账户操作已阻止：其他标签页正在划转资金', 'Account operation blocked: another tab is transferring funds'),
  }),
  rebalanceErrors: freezeCopy({
    pageIneligible: localizedText('当前合约页面不符合账户划转条件', 'Current futures page is not eligible for account transfers'),
    ordinaryAccountRequired: localizedText('自动划转仅支持普通 U 本位合约账户', 'Automatic transfers require an ordinary USD-M Futures account'),
    eligibilityChanged: localizedText('划转前账户执行条件已变化', 'Account eligibility changed before transfer'),
    tradingTaskRunning: localizedText('当前仍有交易任务运行', 'A trading task is still running'),
    identityUnverified: localizedText('账户身份或模式不受支持或尚未核实', 'Unsupported or unverified account identity'),
    identityChanged: localizedText('账户身份已变化', 'Account identity changed'),
    identityChangedAfterConfirmation: localizedText('确认后账户身份已变化', 'Account identity changed after confirmation'),
    reviewRequired: localizedText('请先核实上次划转结果', 'Previous transfer outcome requires account review'),
    flatRequired: localizedText('全账户持仓和当前委托必须为零', 'Account-wide positions and open orders must be zero'),
    accountNotFlat: localizedText('全账户仍有持仓或当前委托', 'Positions or open orders still exist in the account'),
    invalidOutcome: localizedText('自动再平衡结果记录无效', 'Invalid automatic rebalance episode outcome'),
  }),
  tooltip: freezeCopy({
    singleOrder: localizedText(
      '单击订单簿中的某个价格，按当前方向和数量设置提交一笔订单。',
      'Click a price in the order book to submit one order using the current side and quantity settings.',
    ),
    ladder: localizedText(
      '根据当前比例、笔数、间距和价格精度设置，依次提交阶梯订单。右侧选择每轮以市价吃单的比例：关 = 全部只做 Maker；选中比例时，每轮先按比例提交市价单，再把其余笔数挂只做 Maker 单。连续平仓按比例累计到后续轮次，单轮下单至少吃单 1 笔。',
      'Submit ladder orders sequentially using the current ratio, order count, gap, and precision. The options on the right set the share of each round sent as market orders: Off keeps every order Post Only; otherwise each round first sends that share as market orders, then places the rest as Post Only. Continuous close carries fractions to later rounds; a one-round ladder takes at least one.',
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
  }),
});

/**
 * Rebalance copy is built from the orderbook's validated allocation instead of this
 * shared map, so changing the allocation does not alter the other bundled scripts.
 */
export function formatUsdtRebalanceTooltip(ratio) {
  return localizedText(
    `将资金、现货和 U 本位账户的 USDT 按 ${ratio} 分配`,
    `Allocate USDT across Funding, Spot, and USDⓈ-M Futures accounts at a ${ratio} ratio`,
  );
}

export function formatUsdtRebalanceTargetSummary(percents) {
  return localizedText(
    `目标分配：资金 ${percents.FUNDING}% / 现货 ${percents.MAIN}% / U本位 ${percents.UMFUTURE}%`,
    `Target allocation: Funding ${percents.FUNDING}% / Spot ${percents.MAIN}% / USDⓈ-M Futures ${percents.UMFUTURE}%`,
  );
}

export function formatUsdtRebalanceAllocatedStatus(ratio) {
  return localizedText(`USDT 已按 ${ratio} 分配`, `USDT is already allocated at ${ratio}`);
}

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

/** Each area is one hook into Binance or TradingView internals, with what breaks for the user. */
const DEPENDENCY_AREAS = Object.freeze({
  'chart-save': Object.freeze({
    label: localizedText('挂单线保存过滤', 'Order-line save filter'),
    consequence: localizedText(
      '已回退币安原生保存，挂单线每次变化都会保存整张图，连续挂单可能再次造成 IndexedDB 积压',
      "Binance's native save is back in effect; every order-line change saves the whole chart, so continuous orders may stall IndexedDB again",
    ),
    reasons: Object.freeze({
      bootstrap: localizedText('图表启动钩子', 'chart bootstrap hook'),
      'api-shape': localizedText('图表接口结构', 'chart API shape'),
      'subscription-batch': localizedText('保存监听注册顺序', 'save listener registration order'),
      'listener-shape': localizedText('保存监听函数结构', 'save listener body'),
      'removal-hook': localizedText('挂单线移除钩子', 'order-line removal hook'),
      'removal-capture': localizedText('挂单线移除路径', 'order-line removal path'),
      'chart-model': localizedText('图表模型接口', 'chart model API'),
      'lookup-error': localizedText('图表查询接口', 'chart lookup API'),
      'order-tool-name': localizedText('挂单线类型名', 'order-line tool name'),
      'event-type': localizedText('画线事件类型', 'drawing event type'),
    }),
  }),
  'chart-write': Object.freeze({
    label: localizedText('图表重复写入过滤', 'Unchanged chart write filter'),
    consequence: localizedText(
      '每次图表保存都会重写全部币种的画线记录，磁盘写入和 IndexedDB 压力回升',
      'every chart save rewrites the drawings of every symbol again, raising disk writes and IndexedDB load',
    ),
    reasons: Object.freeze({
      'write-layout': localizedText('图表存储布局', 'chart storage layout'),
    }),
  }),
  'i18n-usage': Object.freeze({
    label: localizedText('翻译统计拦截', 'Translation usage block'),
    consequence: localizedText(
      '币安的翻译使用统计又会写入 IndexedDB，长时间交易后刷新页面可能一次排队上万个事务',
      "Binance's translation usage telemetry writes to IndexedDB again; after long trading sessions a reload may queue thousands of transactions at once",
    ),
    reasons: Object.freeze({
      'usage-db-name': localizedText('统计数据库名称', 'usage database name'),
      'usage-db-missing': localizedText('统计数据库未出现', 'usage database not opened'),
    }),
  }),
  'trade-sound': Object.freeze({
    label: localizedText('成交提示音分币种', 'Per-symbol trade sound'),
    consequence: localizedText(
      '其他币种成交时，所有标签页都会响提示音',
      'every tab plays the trade sound when any symbol fills',
    ),
    reasons: Object.freeze({
      'sound-stream': localizedText('账户订单推送', 'account order stream'),
      'sound-asset': localizedText('提示音文件', 'trade sound file'),
    }),
  }),
});

export const DEPENDENCY_ALERT = localizedText(
  '⚠ 币安依赖已变化，需更新脚本',
  '⚠ Binance dependency changed; update the script',
);

/**
 * Explains which Binance/TradingView dependencies no longer match, what that
 * means for the user, and the raw details. Unknown areas or reasons are a
 * programming error, not a display fallback.
 */
export function formatDependencyAlertTooltip(entries) {
  if (!Array.isArray(entries) || !entries.length) throw new Error('Dependency alert requires at least one break');
  const groups = new Map();
  for (const { area, reason, detail } of entries) {
    const definition = DEPENDENCY_AREAS[area];
    if (!definition) throw new Error(`Unknown dependency area: ${area}`);
    const label = definition.reasons[reason];
    if (!label) throw new Error(`Unknown ${area} dependency break: ${reason}`);
    if (!groups.has(area)) groups.set(area, { definition, labels: [], details: [] });
    const group = groups.get(area);
    group.labels.push(label);
    group.details.push(detail);
  }
  const lines = locale => [...groups.values()].map(({ definition, labels, details }) => (locale === 'zhCN'
    ? `${definition.label.zhCN}失效（${labels.map(label => label.zhCN).join('、')}）：${definition.consequence.zhCN}。细节：${details.join('; ')}`
    : `${definition.label.en} broken (${labels.map(label => label.en).join(', ')}): ${definition.consequence.en}. Details: ${details.join('; ')}`));
  return localizedText(lines('zhCN').join('\n'), lines('en').join('\n'));
}
