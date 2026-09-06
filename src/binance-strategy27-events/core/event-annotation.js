import { createStrategy27Translator, createLocalizedAnnotation } from './ui-copy.js';
import { eventTimeToChartSecond } from './live-event-contract.js';

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

export function formatNotional(value, label) {
  const numeric = finiteNumber(value, label);
  const absolute = Math.abs(numeric);
  if (absolute > 0 && absolute < 0.1) return numeric.toLocaleString('en-US', { maximumSignificantDigits: 2, useGrouping: false });
  if (absolute >= 1_000_000) return `${compactDecimal(numeric / 1_000_000, { digits: 2, label })}M`;
  if (absolute >= 1_000) return `${compactDecimal(numeric / 1_000, { digits: 1, label })}K`;
  return compactDecimal(numeric, { digits: 1, label });
}

function formatForce(label, oppositeSide, force, t) {
  const notional = finiteNumber(force.notional, `${label}.notional`);
  if (notional === 0 && force.trade_count === 0) {
    return Object.freeze({ label, value: t('无主动成交', 'No aggressive trades'), detail: '' });
  }
  return Object.freeze({
    label,
    value: `${formatNotional(force.notional, `${label}.notional`)} USDT · ${force.trade_count} ${t('笔', 'trades')}`,
    detail: `${t('吃', 'Consumed')} ${oppositeSide} ${t('深度', 'depth')} ${formatRatio(force.to_opposite_depth, `${label}.to_opposite_depth`)}`,
  });
}

function formatBook(label, side, t) {
  return Object.freeze({
    label,
    value: `${t('增', 'Added')} ${formatNotional(side.observed_addition_notional, `${label}.addition`)} · ${t('减', 'Removed')} ${formatNotional(side.observed_decrease_notional, `${label}.decrease`)}`,
    detail: `${t('迁移', 'Migration')} ${formatBps(side.best_price_migration_bps, `${label}.migration`)} bps`,
  });
}

function formatTriggerReasons(reasons, t) {
  const TRIGGER_LABELS = Object.freeze({
    aggressive_buy_to_ask_depth: t('主动买', 'Aggressive buy'),
    aggressive_sell_to_bid_depth: t('主动卖', 'Aggressive sell'),
    bid_addition_to_bid_depth: t('bid 增', 'bid additions'),
    bid_decrease_to_bid_depth: t('bid 减', 'bid decreases'),
    ask_addition_to_ask_depth: t('ask 增', 'ask additions'),
    ask_decrease_to_ask_depth: t('ask 减', 'ask decreases'),
    bid_best_price_migration_bps: t('bid 迁移', 'bid migration'),
    ask_best_price_migration_bps: t('ask 迁移', 'ask migration'),
    mid_return_bps: t('价格响应', 'Price response'),
    spread_change_bps: t('点差变化', 'Spread change'),
  });
  return reasons.map((reason) => {
    const label = TRIGGER_LABELS[reason];
    if (!label) throw new Error(`Unknown Strategy 27 trigger reason: ${reason}`);
    return label;
  }).join(t('、', ', '));
}

function formatCloseReason(reason, t) {
  const CLOSE_REASON_LABELS = Object.freeze({
    quiet_period: t('安静期结束', 'Quiet period ended'),
    maximum_duration: t('达到最长持续时间', 'Maximum duration reached'),
    input_gap: t('输入缺口', 'Input gap'),
    universe_removed: t('移出监控范围', 'Removed from monitoring'),
    monitor_stopped: t('监控停止', 'Monitoring stopped'),
  });
  if (reason === null) return null;
  const label = CLOSE_REASON_LABELS[reason];
  if (!label) throw new Error(`Unknown Strategy 27 close reason: ${reason}`);
  return label;
}

function candidatePresentation(observations, t) {
  const CANDIDATE_PRESENTATIONS = Object.freeze({
    bearish_buy_impact_failure: Object.freeze({
      label: t('买入推动失效 · 承接转弱', 'Buy impact failure · Weakening support'),
      markerShape: 'arrow_down',
      markerColor: '#F6465D',
    }),
    bearish_passive_book_shift: Object.freeze({
      label: t('主动成交弱 · 承接转弱', 'Weak aggressive flow · Weakening support'),
      markerShape: 'arrow_down',
      markerColor: '#F6465D',
    }),
    bullish_sell_impact_failure: Object.freeze({
      label: t('卖出推动失效 · 抛压转弱', 'Sell impact failure · Weakening selling pressure'),
      markerShape: 'arrow_up',
      markerColor: '#0ECB81',
    }),
    bullish_passive_book_shift: Object.freeze({
      label: t('主动成交弱 · 抛压转弱', 'Weak aggressive flow · Weakening selling pressure'),
      markerShape: 'arrow_up',
      markerColor: '#0ECB81',
    }),
  });
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
    label: presentations.map((presentation) => presentation.label).join(t('、', ', ')),
    markerShape,
    markerColor: presentations[0].markerColor,
  });
}

function formatWindowDuration(snapshot, t) {
  const durationMs = snapshot.bucket_end_ms - snapshot.bucket_start_ms;
  if (durationMs % 1_000 === 0) return `${durationMs / 1_000} ${t('秒', 's')}`;
  return `${trimmedFixed(durationMs / 1_000, 2)} ${t('秒', 's')}`;
}

function formatEventAnnotation({
  event,
  rehydrated,
  locale,
}) {
  const t = createStrategy27Translator(locale);
  const snapshot = event.latest_snapshot;
  const response = snapshot.price_response;
  const candidate = candidatePresentation(snapshot.candidate_observations, t);
  const incomplete = event.event_status === 'incomplete';
  const notices = [];
  if (rehydrated) notices.push(t('此前投影历史不可用', 'Earlier projection history unavailable'));
  if (incomplete) notices.push(t('数据不完整，不作方向结论', 'Incomplete data; no directional conclusion'));

  const title = event.event_kind === 'orderflow_event' ? t('订单流观察', 'Order-flow observation') : t('价格响应观察', 'Price-response observation');
  const summary = `${t('价格', 'Price')} ${formatBps(response.mid_return_bps, 'price_response.mid_return_bps')} bps · ${t('点差', 'Spread')} ${formatBps(response.spread_bps, 'price_response.spread_bps', { signed: false })} bps`;
  return Object.freeze({
    title,
    locale,
    eventTimeMs: snapshot.bucket_end_ms - 1,
    status: event.event_status,
    windowText: `${t('统计', 'Window')} ${formatWindowDuration(snapshot, t)} · ${snapshot.source_bucket_count} ${t('桶', 'buckets')}`,
    candidateText: candidate?.label ?? null,
    summary,
    forceRows: Object.freeze([
      formatForce(t('主动买', 'Aggressive buy'), 'ask', snapshot.aggressive_buy, t),
      formatForce(t('主动卖', 'Aggressive sell'), 'bid', snapshot.aggressive_sell, t),
      formatBook('bid', snapshot.bid, t),
      formatBook('ask', snapshot.ask, t),
    ]),
    priceDetail: `${t('点差变化', 'Spread change')} ${formatBps(response.spread_change_bps, 'price_response.spread_change_bps')} bps`,
    triggerText: formatTriggerReasons(event.trigger_reasons, t),
    closeText: formatCloseReason(event.close_reason, t),
    notices: Object.freeze(notices),
    markerShape: candidate?.markerShape ?? null,
    markerColor: candidate?.markerColor ?? null,
    markerTime: eventTimeToChartSecond(snapshot.bucket_end_ms - 1),
    markerPrice: finiteNumber(response.mid, 'price_response.mid'),
    liveStatus: `Strategy 27 ${candidate?.label ?? title}｜${summary}`,
  });
}

export function buildEventAnnotation({ event, rehydrated, locale = 'zh-CN' }) {
  return createLocalizedAnnotation((nextLocale) => formatEventAnnotation({ event, rehydrated, locale: nextLocale }), locale);
}

export function stabilizeCandidatePresentation(presentations, eventId, annotation) {
  const existing = presentations.get(eventId);
  if (existing) {
    const localizedCopy = Object.freeze(Object.fromEntries(Object.entries(annotation.localizedCopy).map(([locale, copy]) => [
      locale, Object.freeze({ ...copy, ...existing.marker, candidateText: existing.candidateText[locale] }),
    ])));
    return Object.freeze({ ...annotation, ...existing.marker, candidateText: existing.candidateText[annotation.locale], localizedCopy });
  }
  if (!annotation.markerShape) return annotation;
  const presentation = Object.freeze({
    candidateText: Object.freeze({ 'zh-CN': annotation.localizedCopy['zh-CN'].candidateText, en: annotation.localizedCopy.en.candidateText }),
    marker: Object.freeze({
      markerShape: annotation.markerShape,
      markerColor: annotation.markerColor,
      markerTime: annotation.markerTime,
      markerPrice: annotation.markerPrice,
    }),
  });
  presentations.set(eventId, presentation);
  return annotation;
}
