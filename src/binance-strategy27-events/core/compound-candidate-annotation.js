import { formatNotional } from './event-annotation.js';

const DIRECTIONS = Object.freeze({
  high: Object.freeze({ title: '复合候选高', label: '候选高', shape: 'arrow_down', color: '#B71C3B' }),
  low: Object.freeze({ title: '复合候选低', label: '候选低', shape: 'arrow_up', color: '#087F5B' }),
});
const FAMILY_LABELS = Object.freeze({
  high: Object.freeze({ impact_failure: '买入推动失效', passive_support_loss: '被动承接转弱', failed_rebound: '反弹失败强化' }),
  low: Object.freeze({ impact_failure: '卖出推动失效', passive_support_loss: '被动抛压转弱', failed_rebound: '回落失败强化' }),
});

function clock(ms) {
  const date = new Date(ms);
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map((value) => String(value).padStart(2, '0')).join(':');
}

function priceWindow(value) {
  return `${clock(value.start_ms)}–${clock(value.end_ms)} · ${value.opening_mid} → ${value.closing_mid}`;
}

function flow(value, count, label) {
  return value === '0' && count === 0 ? '无主动成交' : `${formatNotional(value, label)} USDT · ${count} 笔`;
}

/** Format server-confirmed evidence only; do not infer additional stages. */
export function buildCompoundCandidateAnnotation(candidate) {
  const direction = DIRECTIONS[candidate.direction];
  const family = FAMILY_LABELS[candidate.direction]?.[candidate.family];
  if (!direction || !family) throw new Error('Strategy 27 compound display rule is invalid');
  const reinforcement = candidate.family === 'failed_rebound';
  const detailRows = [
    { label: '规则', value: family },
    { label: '背景', value: priceWindow(candidate.context) },
    { label: '触发秒', value: priceWindow(candidate.seed) },
    { label: '主动买', value: flow(candidate.seed.buy_notional, candidate.seed.buy_count, 'seed buy') },
    { label: '主动卖', value: flow(candidate.seed.sell_notional, candidate.seed.sell_count, 'seed sell') },
    { label: 'bid', value: `增 ${formatNotional(candidate.seed.bid_addition, 'bid addition')} · 减 ${formatNotional(candidate.seed.bid_decrease, 'bid decrease')} USDT` },
    { label: 'ask', value: `增 ${formatNotional(candidate.seed.ask_addition, 'ask addition')} · 减 ${formatNotional(candidate.seed.ask_decrease, 'ask decrease')} USDT` },
    { label: '基础确认', value: priceWindow(candidate.confirmation) },
  ];
  if (reinforcement) {
    detailRows.push(
      { label: candidate.direction === 'high' ? '低点秒' : '高点秒', value: priceWindow(candidate.trough) },
      { label: candidate.direction === 'high' ? '反弹秒' : '回落秒', value: priceWindow(candidate.rebound) },
      { label: '强化确认', value: priceWindow(candidate.decision) },
      { label: '关联候选', value: candidate.parent_candidate_id },
    );
  }
  detailRows.push({ label: '参数版本', value: candidate.profile.revision });
  const notices = ['探索候选，尚未验证预测能力'];
  if (candidate.direction === 'low') notices.push('镜像规则，尚未独立验证');
  return Object.freeze({
    kind: 'compound',
    title: direction.title,
    titleColor: candidate.direction === 'high' ? '#FF718A' : '#53DDB1',
    eventTimeMs: candidate.decision.end_ms - 1,
    markerTime: Math.floor((candidate.decision.end_ms - 1) / 1000),
    markerPrice: Number(candidate.decision.closing_mid),
    markerShape: direction.shape,
    markerColor: direction.color,
    markerLabel: direction.label,
    summary: `${direction.label} · ${family}`,
    ruleIdentity: `${candidate.family}/${candidate.direction}/${candidate.profile_id}${reinforcement ? `/${candidate.parent_candidate_id}` : ''}`,
    candidateId: candidate.candidate_id,
    profileId: candidate.profile_id,
    reinforcement,
    detailRows: Object.freeze(detailRows.map(Object.freeze)),
    notices: Object.freeze(notices),
  });
}
