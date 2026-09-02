import { eventTimeToChartSecond } from './live-event-contract.js';

const CANDIDATE_PRESENTATIONS = Object.freeze({
  bearish_buy_impact_failure: Object.freeze({
    label: '买入推动失效 · 承接转弱',
    markerShape: 'arrow_down',
    markerColor: '#F6465D',
  }),
  bearish_passive_book_shift: Object.freeze({
    label: '主动成交弱 · 承接转弱',
    markerShape: 'arrow_down',
    markerColor: '#F6465D',
  }),
  bullish_sell_impact_failure: Object.freeze({
    label: '卖出推动失效 · 抛压转弱',
    markerShape: 'arrow_up',
    markerColor: '#0ECB81',
  }),
  bullish_passive_book_shift: Object.freeze({
    label: '主动成交弱 · 抛压转弱',
    markerShape: 'arrow_up',
    markerColor: '#0ECB81',
  }),
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
  const notional = finiteNumber(force.notional, `${label}.notional`);
  if (notional === 0 && force.trade_count === 0) {
    return Object.freeze({ label, value: '无主动成交', detail: '' });
  }
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

function candidatePresentation(observations) {
  if (!observations.length) return null;
  const presentations = observations.map((observation) => {
    const presentation = CANDIDATE_PRESENTATIONS[observation];
    if (!presentation) throw new Error(`Unknown Strategy 27 candidate observation: ${observation}`);
    return presentation;
  });
  const markerShape = presentations[0].markerShape;
  if (presentations.some((presentation) => presentation.markerShape !== markerShape)) {
    throw new Error('Strategy 27 candidate observations contain conflicting directions');
  }
  return Object.freeze({
    label: presentations.map((presentation) => presentation.label).join('、'),
    markerShape,
    markerColor: presentations[0].markerColor,
  });
}

function formatWindowDuration(snapshot) {
  const durationMs = snapshot.bucket_end_ms - snapshot.bucket_start_ms;
  if (durationMs % 1_000 === 0) return `${durationMs / 1_000} 秒`;
  return `${trimmedFixed(durationMs / 1_000, 2)} 秒`;
}

export function buildEventAnnotation({
  event,
  rehydrated,
}) {
  const snapshot = event.latest_snapshot;
  const response = snapshot.price_response;
  const candidate = candidatePresentation(snapshot.candidate_observations);
  const incomplete = event.event_status === 'incomplete';
  const notices = [];
  if (rehydrated) notices.push('此前投影历史不可用');
  if (incomplete) notices.push('数据不完整，不作方向结论');

  const title = event.event_kind === 'orderflow_event' ? '订单流观察' : '价格响应观察';
  const summary = `价格 ${formatBps(response.mid_return_bps, 'price_response.mid_return_bps')} bps · 点差 ${formatBps(response.spread_bps, 'price_response.spread_bps', { signed: false })} bps`;
  return Object.freeze({
    title,
    eventTimeMs: snapshot.bucket_end_ms - 1,
    status: event.event_status,
    windowText: `统计 ${formatWindowDuration(snapshot)} · ${snapshot.source_bucket_count} 桶`,
    candidateText: candidate?.label ?? null,
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
    notices: Object.freeze(notices),
    markerShape: candidate?.markerShape ?? null,
    markerColor: candidate?.markerColor ?? null,
    markerTime: eventTimeToChartSecond(snapshot.bucket_end_ms - 1),
    markerPrice: finiteNumber(response.mid, 'price_response.mid'),
    liveStatus: `Strategy 27 ${candidate?.label ?? title}｜${summary}`,
  });
}

export function stabilizeCandidatePresentation(presentations, eventId, annotation) {
  const existing = presentations.get(eventId);
  if (existing) return Object.freeze({ ...annotation, ...existing });
  if (!annotation.markerShape) return annotation;
  const presentation = Object.freeze({
    candidateText: annotation.candidateText,
    markerShape: annotation.markerShape,
    markerColor: annotation.markerColor,
    markerTime: annotation.markerTime,
    markerPrice: annotation.markerPrice,
  });
  presentations.set(eventId, presentation);
  return annotation;
}
