import { eventTimeToChartSecond } from './live-event-contract.js';

const OUTCOME_LABELS = {
  continuation: '延续',
  recovery: '恢复',
  reversal: '反转',
  partial_retracement: '部分回撤',
  not_applicable: '不适用',
};

function signedDecimal(value) {
  const numeric = Number(value);
  if (numeric > 0) return `+${value}`;
  return value;
}

function formatForce(name, force) {
  return `${name} ${force.notional} USDT/${force.trade_count} 笔，吃对手深度 ${force.to_opposite_depth}`;
}

function formatBook(name, side) {
  return `${name} 增 ${side.observed_addition_notional} 减 ${side.observed_decrease_notional}，最优价迁移 ${signedDecimal(side.best_price_migration_bps)} bps`;
}

function outcomeLine(outcome) {
  if (outcome.outcome_status !== 'complete') return `${outcome.window_seconds} 秒：数据不完整`;
  const directional = OUTCOME_LABELS[outcome.directional_outcome] ?? '无方向结论';
  return `${outcome.window_seconds} 秒：${directional}，收盘响应 ${signedDecimal(outcome.return_from_active_end_bps)} bps`;
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
  const midReturn = Number(response.mid_return_bps);
  const markerShape = midReturn > 0 ? 'arrow_up' : midReturn < 0 ? 'arrow_down' : 'flag';
  const markerColor = midReturn > 0 ? '#0ECB81' : midReturn < 0 ? '#F6465D' : '#F0B90B';
  const incomplete = event.event_status === 'incomplete' || outcomes.some((item) => item.outcome_status !== 'complete');
  const lines = [
    `Strategy 27 ${event.event_kind === 'orderflow_event' ? '订单流事件' : '价格响应事件'}`,
    formatForce('主动买', snapshot.aggressive_buy),
    formatForce('主动卖', snapshot.aggressive_sell),
    formatBook('bid', snapshot.bid),
    formatBook('ask', snapshot.ask),
    `价格响应 ${signedDecimal(response.mid_return_bps)} bps，点差 ${response.spread_bps} bps`,
    `触发：${event.trigger_reasons.join('、')}`,
  ];
  if (event.event_status !== 'active') lines.push(`结束：${event.close_reason}`);
  if (rehydrated) lines.push('此前投影历史不可用');
  if (incomplete) lines.push('数据不完整，不作方向结论');
  else lines.push(...outcomes.map(outcomeLine));

  const coordinateTime = eventTimeToChartSecond(eventTimeMs);
  const coordinatePrice = Number(response.mid);
  return Object.freeze({
    markerShape,
    markerColor,
    markerTime: coordinateTime,
    markerPrice: coordinatePrice,
    noteText: lines.join('\n'),
    noteTime: coordinateTime,
    notePrice: coordinatePrice,
    liveStatus: `${lines[0]}｜${lines[5]}`,
  });
}

