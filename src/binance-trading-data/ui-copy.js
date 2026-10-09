import {
  localizedText, formatLocalizedText,
} from '../binance-orderbook-trade/contracts/panel-copy.js';

const COPY = Object.freeze({
  title: localizedText('交易数据', 'Trading data'),
  metric: localizedText('指标', 'Metric'),
  history: localizedText('历史趋势', 'History'),
  historyNote: localizedText('趋势按5分钟采样；费率曲线为历史结算。', 'History: 5m samples; funding shows settlements.'),
  value: localizedText('数值', 'Value'),
  collapse: localizedText('收起面板', 'Collapse panel'),
  expand: localizedText('展开面板', 'Expand panel'),
  close: localizedText('关闭', 'Close'),
  loading: localizedText('加载中', 'Loading'),
  missing: localizedText('数据缺失', 'Data unavailable'),
  loadFailed: localizedText('加载失败', 'Load failed'),
  cached: localizedText('缓存', 'Cached'),
  cachedFailure: localizedText('缓存 · 更新失败', 'Cached · refresh failed'),
  intervalCached: localizedText('周期缓存', 'Cached interval'),
  intervalCachedFailure: localizedText('周期缓存 · 更新失败', 'Cached interval · refresh failed'),
  intervalLoadFailed: localizedText('周期加载失败', 'Interval load failed'),
  refreshFailed: localizedText('更新失败', 'Refresh failed'),
  noHistory: localizedText('暂无历史', 'No history'),
  inspect: localizedText('查看历史数据', 'Inspect history'),
  keyboard: localizedText('左右方向键切换历史点；Esc 关闭明细', 'Use left and right arrows to inspect points; Esc closes details'),
  historyRecord: localizedText('历史数据', 'Historical data'),
  settledRecord: localizedText('历史结算', 'Settled funding'),
  last: localizedText('上次', 'Last'),
  current: localizedText('当前', 'Current'),
  intervalPending: localizedText('周期待确认', 'Interval pending'),
  countdown: localizedText('倒计时', 'Countdown'),
  clockUnavailable: localizedText('校时不可用', 'Clock unavailable'),
  waitingUpdate: localizedText('等待更新', 'Waiting for update'),
  buy: localizedText('买', 'Buy'),
  sell: localizedText('卖', 'Sell'),
  buySellRatio: localizedText('买/卖比', 'Buy/sell ratio'),
  basisRate: localizedText('比率', 'Rate'),
  composite: localizedText('综合信号', 'Composite signal'),
  long: localizedText('偏多', 'Bullish'),
  short: localizedText('偏空', 'Bearish'),
  neutral: localizedText('中性', 'Neutral'),
  fundingNote: localizedText(
    '当前费率在结算前仍可能变化；历史曲线只含已结算记录。',
    'The current rate may change before settlement. History contains settled rates only.',
  ),
  simplifiedNote: localizedText(
    '简化规则；资金费率投票使用最新已结算值。缓存及未平仓量与市值比率不参与投票。',
    'Simplified rules; the funding vote uses the latest settled rate. Cached data and the open-interest-to-market-cap ratio do not vote.',
  ),
});

const METRICS = Object.freeze({
  oi: {
    name: localizedText('合约持仓量', 'Open Interest'),
    detail: localizedText(
      '尚未平仓的合约规模，以当前交易币种计量。持仓量是存量，成交量是一段时间内的交易量。',
      'Outstanding contract quantity in the current asset. Open interest measures open contracts; volume measures trading during a period.',
    ),
  },
  'top-accounts': {
    name: localizedText('大户账户数多空比', 'Top Trader Long/Short Ratio (Accounts)'),
    detail: localizedText(
      '大户净多头账户数 ÷ 净空头账户数。大户按保证金余额前 20% 定义。',
      'Top-trader net-long accounts divided by net-short accounts. Top traders are the top 20% by margin balance.',
    ),
  },
  'top-positions': {
    name: localizedText('大户持仓量多空比', 'Top Trader Long/Short Ratio (Positions)'),
    detail: localizedText(
      '大户多头持仓量 ÷ 空头持仓量，按仓位规模统计。',
      'Top-trader long position quantity divided by short position quantity, weighted by position size.',
    ),
  },
  'global-accounts': {
    name: localizedText('多空账户数比', 'Long/Short Ratio'),
    detail: localizedText(
      '统计账户中的净多头账户数 ÷ 净空头账户数。',
      'Net-long accounts divided by net-short accounts across the reported trading population.',
    ),
  },
  taker: {
    name: localizedText('合约主动买卖量', 'Taker Buy/Sell Volume'),
    detail: localizedText(
      '柱图分别显示主动买入量与主动卖出量；右侧数值是买入量 ÷ 卖出量。',
      'Bars show taker buy and sell volumes separately. The value at right is buy volume divided by sell volume.',
    ),
  },
  basis: {
    name: localizedText('基差', 'Basis'),
    detail: localizedText(
      '以比率展示：（合约价格 − 现货指数价格）÷ 现货指数价格。',
      'Shown as a rate: (futures price minus spot index price) divided by spot index price.',
    ),
  },
  funding: {
    name: localizedText('资金费率', 'Funding Rate'),
    detail: COPY.fundingNote,
  },
  'oi-supply': {
    name: localizedText('未平仓量与市值比率', 'Open Interest to Market Cap Ratio'),
    detail: localizedText(
      '未平仓币数 ÷ CMC 流通供应量，分子与分母按同一币种计量。这一项不参与综合信号投票。',
      'Open-interest token quantity divided by CMC circulating supply, measured in the same asset. This row does not vote in the composite signal.',
    ),
  },
});

export function tradingText(key, locale) {
  return formatLocalizedText(COPY[key], locale);
}

export function tradingMetricText(id, key, locale) {
  return formatLocalizedText(METRICS[id][key], locale);
}

export function formatFundingPeriod(hours, locale) {
  const period = hours === null
    ? COPY.intervalPending
    : localizedText(`${hours}小时`, `${hours}h`);
  return `${tradingText('current', locale)} · ${formatLocalizedText(period, locale)}`;
}

export function formatHistoryCount(id, count, locale) {
  return formatLocalizedText(id === 'funding'
    ? localizedText(`已结算 · ${count}次`, `Settled · ${count} points`)
    : localizedText(`5分钟 · ${count}点`, `5m · ${count} points`), locale);
}

export function formatVotes({ longCount, shortCount, total }, locale) {
  const neutral = total - longCount - shortCount;
  return formatLocalizedText(localizedText(
    `指标票数：${longCount}多 · ${shortCount}空 · ${neutral}中性`,
    `Votes: ${longCount} long · ${shortCount} short · ${neutral} neutral`,
  ), locale);
}

export function formatHistoryTime(timestamp, locale) {
  return new Intl.DateTimeFormat(locale === 'zh-CN' ? 'zh-CN' : 'en-GB', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23', timeZoneName: 'short',
  }).format(timestamp);
}
