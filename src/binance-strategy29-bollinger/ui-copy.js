import { localizedText, formatLocalizedText, resolveUiLocaleFromPathname } from '../binance-orderbook-trade/contracts/panel-copy.js';

export { formatLocalizedText, resolveUiLocaleFromPathname };
const pair = localizedText;
export const SUMMARY_COPY = Object.freeze({
  upgradeClient: pair('Strategy 29 本地信号已加载。跨周期汇总需要更新或安装 Strategy 27 信号客户端，并刷新页面。', 'Strategy 29 local signals are loaded. Update or install the Strategy 27 signal client and reload for the cross-timeframe summary.'),
  disabled: pair('跨周期汇总未启用，可在 CorsairQuant 信号客户端菜单中开启。', 'Cross-timeframe summary is disabled. Enable it in the CorsairQuant signal client menu.'),
  moduleDisabled: pair('服务端尚未启用 Strategy 29 监控汇总', 'Strategy 29 monitoring summary is not enabled on the server'),
  gatewayUnavailable: pair('Strategy 29 后端暂不可用，等待恢复', 'Strategy 29 backend is unavailable; waiting for recovery'),
  noLiveStatus: pair('当前监控状态不可用；下方仅保留历史信号。', 'Current monitoring status is unavailable; only retained signals are shown below.'),
  title: pair('Strategy 29 汇总', 'Strategy 29 Summary'),
  drag: pair('拖动面板', 'Drag panel'),
  collapse: pair('收起', 'Collapse'),
  expand: pair('展开', 'Expand'),
  waiting: pair('等待中', 'Waiting'),
  observerSpec: value => pair(`观察器规格 ${value}`, `Observer spec ${value}`),
  reference: value => pair(`本地参考版本 ${value}`, `Local reference ${value}`),
  noStatus: pair('尚未收到状态', 'Status not received'),
  noEventsCheck: pair('尚未检查事件', 'Events not checked'),
  processing: pair('最近处理状态', 'Last processing status'),
  processingHint: pair('已保存的处理状态不代表当前实时数据已就绪。', 'Stored processing status does not confirm current live readiness.'),
  waitingDelivery: pair('全局通知 — 等待中', 'Global delivery — waiting'),
  recent: pair('最近跨周期信号', 'Recent cross-timeframe signals'),
  noEvents: pair('暂无最近信号', 'No recent signals'),
  close: value => pair(`收盘 ${value}`, `Close ${value}`),
  matched: value => pair(`规格版本一致 · ${value}`, `Spec version matched · ${value}`),
  mismatch: (local, server) => pair(`规格不一致 · 本地 ${local} · 服务端 ${server}`, `Spec mismatch · local ${local} · server ${server}`),
  statusAt: value => pair(`状态更新 ${value}`, `Status ${value}`),
  eventsAt: value => pair(`事件检查 ${value}`, `Events checked ${value}`),
  incompatibleSelection: pair('选币不可用：观察器规格不一致', 'Selection unavailable: observer specs are incompatible'),
  incompatibleDelivery: pair('全局通知状态不可用：观察器规格不一致', 'Global delivery unavailable: observer specs are incompatible'),
  pending: pair('等待中', 'pending'),
  generation: value => pair(`批次 ${value}`, `Generation ${value}`),
  markets: value => pair(`${value} 个币种`, `${value} markets`),
  ready: (ready, total) => pair(`${ready}/${total} 个实时监测单元已就绪`, `${ready}/${total} live units ready`),
  intervals: value => pair(`周期 ${value}`, `Intervals ${value}`),
  noSuccess: pair('尚无成功选币记录', 'No successful selection has been observed'),
  lastSuccess: (clock, age) => pair(`上次成功选币 ${clock} · ${age} 秒前`, `Last successful selection ${clock} · ${age}s ago`),
  unavailableSelection: pair('服务端选币不可用', 'Server selection is unavailable'),
  awaitingUnits: pair('币种已入选，等待监测单元状态', 'Symbol is selected; waiting for unit status'),
  notSelected: pair('当前服务端选币未监听此币种', 'Symbol is not watched by the current server selection'),
  delivery: c => pair(`全局通知 · 待发送 ${c.pending} · 发送中 ${c.sending} · 已发送 ${c.sent} · 结果未知 ${c.unknown} · 已过期 ${c.expired} · 失败 ${c.failed}`, `Global delivery · Pending ${c.pending} · Sending ${c.sending} · Sent ${c.sent} · Unknown ${c.unknown} · Expired ${c.expired} · Failed ${c.failed}`),
  configuration: pair('尚未配置网关密钥', 'Gateway secret is not configured'),
  connecting: pair('正在连接 Strategy 29 网关', 'Connecting to Strategy 29 gateway'),
  connected: pair('已连接', 'Connected'),
  moreHistory: pair('已连接 · 仍有历史记录待加载', 'Connected · more history pending'),
  unavailable: pair('网关数据库暂不可用', 'Gateway database unavailable'),
  incompatible: pair('服务端与本地规格不一致', 'Server and local specs are incompatible'),
  disconnected: pair('网关连接失败，将在下次定时检查时重试', 'Gateway connection failed; next scheduled poll will retry'),
  stopped: detail => pair(`远程汇总已停止。技术详情：${detail}`, `Remote summary stopped: ${detail}`),
  menuToggle: pair('切换 Strategy 29 跨周期汇总', 'Toggle Strategy 29 cross-timeframe summary'),
  localStopped: detail => pair(`Strategy 29 已停止。技术详情：${detail}`, `Strategy 29 stopped: ${detail}`),
  conflict: pair('Strategy 29 已停止：请将订单簿脚本更新至 2.7.199 或更高版本，或禁用内嵌布林带观察器的旧版本，然后刷新页面。', 'Strategy 29 stopped: update Orderbook to 2.7.199 or disable its embedded Bollinger version, then reload this page.'),
});
export const SELECTION_REASONS = Object.freeze({
  current: pair('当前选币有效', 'Selection is current'),
  using_stale_selection_after_refresh_error: pair('刷新失败，暂沿用上次选币直至过期', 'Refresh failed; using the previous selection until expiry'),
  selection_fail_closed: pair('刷新失败，选币不可用', 'Selection unavailable after refresh failure'),
  selection_expired_or_unusable: pair('选币已过期，等待成功刷新', 'Selection expired; waiting for a successful refresh'),
  missing_current_universe_facts: pair('等待服务端初始化选币', 'Waiting for server selection to initialize'),
  incompatible_current_universe_facts: pair('服务端选币规格不兼容', 'Server selection has an incompatible specification'),
});
export const STATUS_LABELS = Object.freeze({
  ready: pair('已处理', 'Processed'), warming: pair('预热中', 'Warming'),
  stale: pair('已过期', 'Stale'), insufficient_history: pair('历史不足', 'Insufficient history'),
  data_gap: pair('数据缺口', 'Data gap'), failed: pair('失败', 'Failed'),
});
export const SIGNAL_LABELS = Object.freeze({
  'bearish:warning': pair('看跌预警', 'Bearish warning'),
  'bearish:confirmed': pair('看跌确认', 'Bearish confirmed'),
  'bearish:reversal': pair('多头反转', 'Long reversal'),
  'bullish:warning': pair('看涨预警', 'Bullish warning'),
  'bullish:confirmed': pair('看涨确认', 'Bullish confirmed'),
  'bullish:reversal': pair('空头反转', 'Short reversal'),
});
const PROCESSING_REASONS = Object.freeze({
  current: pair('进度已更新', 'Progress current'),
  awaiting_producer_generation: pair('等待当前批次行情就绪', 'Awaiting producer generation'),
  awaiting_initial_baseline: pair('等待建立初始历史基线', 'Awaiting initial baseline'),
  awaiting_reentry_baseline: pair('等待重新入选的历史基线', 'Awaiting re-entry baseline'),
  latest_closed_candle_missing: pair('缺少最新已收盘 K 线', 'Latest closed candle missing'),
  observer_progress_stale: pair('观察器进度已过期', 'Observer progress stale'),
});
/** Server reasons also carry arbitrary diagnostic details, which remain verbatim. */
export function processingReason(reason, locale) {
  if (Object.hasOwn(PROCESSING_REASONS, reason)) return formatLocalizedText(PROCESSING_REASONS[reason], locale);
  const required = /^requires_(\d+)_closed_candles$/.exec(reason);
  if (required) return formatLocalizedText(pair(`需要 ${required[1]} 根已收盘 K 线`, `Requires ${required[1]} closed candles`), locale);
  return formatLocalizedText(pair(`技术详情：${reason}`, `Details: ${reason}`), locale);
}
