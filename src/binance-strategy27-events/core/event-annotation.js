import { eventTimeToChartSecond } from './live-event-contract.js';

const OUTCOME_LABELS = Object.freeze({
  continuation: '延续',
  recovery: '恢复',
  reversal: '反转',
  partial_retracement: '部分回撤',
  not_applicable: '不适用',
});

const TRIGGER_LABELS = Object.freeze({
  aggressive_buy_to_ask_depth: '主动买',
  aggressive_sell_to_bid_depth: '主动卖',
  bid_addition_to_bid_depth: 'bid 增',
  bid_decrease_to_bid_depth: 'bid 减',
  ask_addition_to_ask_depth: 'ask 增',
  ask_decrease_to_ask_depth: 'ask 减',
  bid_best_price_migration_bps: 'bid 迁移',
  ask_best_price_migration_bps: 'ask 迁移',
  mid_return_bps: '价格响应',
  spread_change_bps: '点差变化',
});

const CLOSE_REASON_LABELS = Object.freeze({
  quiet_period: '安静期结束',
  maximum_duration: '达到最长持续时间',
  input_gap: '输入缺口',
  universe_removed: '移出监控范围',
  monitor_stopped: '监控停止',
});

function finiteNumber(value, label) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error(`Invalid Strategy 27 display number: ${label}`);
  return numeric;
}

function trimmedFixed(numeric, digits) {
  return numeric.toFixed(digits).replace(/(\.\d*?[1-9])0+$|\.0+$/u, '$1');
}

function compactDecimal(value, { digits, signed = false, label }) {
  const numeric = finiteNumber(value, label);
  const magnitude = trimmedFixed(Math.abs(numeric), digits);
  if (numeric < 0) return `-${magnitude}`;
  if (signed && numeric > 0) return `+${magnitude}`;
  return magnitude;
}

function formatBps(value, label, { signed = true } = {}) {
  const numeric = finiteNumber(value, label);
  return compactDecimal(value, {
    digits: Math.abs(numeric) < 1 ? 2 : 1,
    signed,
    label,
  });
}

function formatRatio(value, label) {
  return compactDecimal(value, { digits: 2, label });
}

function formatNotional(value, label) {
  const numeric = finiteNumber(value, label);
  const absolute = Math.abs(numeric);
  if (absolute >= 1_000_000) return `${compactDecimal(numeric / 1_000_000, { digits: 2, label })}M`;
  if (absolute >= 1_000) return `${compactDecimal(numeric / 1_000, { digits: 1, label })}K`;
  return compactDecimal(numeric, { digits: 1, label });
}

function formatForce(label, oppositeSide, force) {
  return Object.freeze({
    label,
    value: `${formatNotional(force.notional, `${label}.notional`)} USDT · ${force.trade_count} 笔`,
    detail: `吃 ${oppositeSide} 深度 ${formatRatio(force.to_opposite_depth, `${label}.to_opposite_depth`)}`,
  });
}

function formatBook(label, side) {
  return Object.freeze({
    label,
    value: `增 ${formatNotional(side.observed_addition_notional, `${label}.addition`)} · 减 ${formatNotional(side.observed_decrease_notional, `${label}.decrease`)}`,
    detail: `迁移 ${formatBps(side.best_price_migration_bps, `${label}.migration`)} bps`,
  });
}

function formatTriggerReasons(reasons) {
  return reasons.map((reason) => {
    const label = TRIGGER_LABELS[reason];
    if (!label) throw new Error(`Unknown Strategy 27 trigger reason: ${reason}`);
    return label;
  }).join('、');
}

function formatCloseReason(reason) {
  if (reason === null) return null;
  const label = CLOSE_REASON_LABELS[reason];
  if (!label) throw new Error(`Unknown Strategy 27 close reason: ${reason}`);
  return label;
}

function outcomeLine(outcome) {
  if (outcome.outcome_status !== 'complete') return null;
  const directional = OUTCOME_LABELS[outcome.directional_outcome];
  if (!directional) throw new Error(`Unknown Strategy 27 directional outcome: ${outcome.directional_outcome}`);
  return `${outcome.window_seconds} 秒：${directional}，收盘响应 ${formatBps(outcome.return_from_active_end_bps, 'outcome.return')} bps`;
}

export function buildEventAnnotation({
  event,
  outcomes,
  rehydrated,
  eventTimeMs = event.triggered_at_ms,
  messageKind = event.event_status === 'active' ? 'event_updated' : 'event_closed',
}) {
  const snapshot = messageKind === 'event_opened' ? event.trigger_snapshot : event.latest_snapshot;
  const response = snapshot.price_response;
  const midReturn = finiteNumber(response.mid_return_bps, 'price_response.mid_return_bps');
  const markerShape = midReturn > 0 ? 'arrow_up' : midReturn < 0 ? 'arrow_down' : 'flag';
  const markerColor = midReturn > 0 ? '#0ECB81' : midReturn < 0 ? '#F6465D' : '#F0B90B';
  const incomplete = event.event_status === 'incomplete'
    || outcomes.some((item) => item.outcome_status !== 'complete');
  const notices = [];
  if (rehydrated) notices.push('此前投影历史不可用');
  if (incomplete) notices.push('数据不完整，不作方向结论');

  const title = event.event_kind === 'orderflow_event' ? '订单流事件' : '价格响应事件';
  const summary = `价格 ${formatBps(response.mid_return_bps, 'price_response.mid_return_bps')} bps · 点差 ${formatBps(response.spread_bps, 'price_response.spread_bps', { signed: false })} bps`;
  return Object.freeze({
    title,
    eventTimeMs: event.triggered_at_ms,
    status: event.event_status,
    summary,
    forceRows: Object.freeze([
      formatForce('主动买', 'ask', snapshot.aggressive_buy),
      formatForce('主动卖', 'bid', snapshot.aggressive_sell),
      formatBook('bid', snapshot.bid),
      formatBook('ask', snapshot.ask),
    ]),
    priceDetail: `点差变化 ${formatBps(response.spread_change_bps, 'price_response.spread_change_bps')} bps`,
    triggerText: formatTriggerReasons(event.trigger_reasons),
    closeText: formatCloseReason(event.close_reason),
    outcomeLines: Object.freeze(incomplete ? [] : outcomes.map(outcomeLine).filter(Boolean)),
    notices: Object.freeze(notices),
    markerShape,
    markerColor,
    markerTime: eventTimeToChartSecond(eventTimeMs),
    markerPrice: finiteNumber(response.mid, 'price_response.mid'),
    liveStatus: `Strategy 27 ${title}｜${summary}`,
  });
}
