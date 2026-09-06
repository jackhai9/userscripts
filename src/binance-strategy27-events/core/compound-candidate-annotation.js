import { createStrategy27Translator, createLocalizedAnnotation } from './ui-copy.js';
import { formatNotional } from './event-annotation.js';

function clock(ms) {
  const date = new Date(ms);
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map((value) => String(value).padStart(2, '0')).join(':');
}

function priceWindow(value) {
  return `${clock(value.start_ms)}–${clock(value.end_ms)} · ${value.opening_mid} → ${value.closing_mid}`;
}

function flow(value, count, label, t) {
  return value === '0' && count === 0 ? t('无主动成交', 'No aggressive trades') : `${formatNotional(value, label)} USDT · ${count} ${t('笔', 'trades')}`;
}

/** Format server-confirmed evidence only; do not infer additional stages. */
function formatCompoundCandidateAnnotation(candidate, locale) {
  const t = createStrategy27Translator(locale);
  const DIRECTIONS = Object.freeze({
    high: Object.freeze({ title: t('复合候选高', 'Compound high candidate'), label: t('候选高', 'High candidate'), shape: 'arrow_down', color: '#B71C3B' }),
    low: Object.freeze({ title: t('复合候选低', 'Compound low candidate'), label: t('候选低', 'Low candidate'), shape: 'arrow_up', color: '#087F5B' }),
  });
  const FAMILY_LABELS = Object.freeze({
    high: Object.freeze({ impact_failure: t('买入推动失效', 'Buy impact failure'), passive_support_loss: t('被动承接转弱', 'Weakening passive support'), failed_rebound: t('反弹失败强化', 'Failed rebound reinforcement') }),
    low: Object.freeze({ impact_failure: t('卖出推动失效', 'Sell impact failure'), passive_support_loss: t('被动抛压转弱', 'Weakening passive selling pressure'), failed_rebound: t('回落失败强化', 'Failed pullback reinforcement') }),
  });

  const direction = DIRECTIONS[candidate.direction];
  const family = FAMILY_LABELS[candidate.direction]?.[candidate.family];
  if (!direction || !family) throw new Error('Strategy 27 compound display rule is invalid');
  const reinforcement = candidate.family === 'failed_rebound';
  const detailRows = [
    { label: t('规则', 'Rule'), value: family },
    { label: t('背景', 'Context'), value: priceWindow(candidate.context) },
    { label: t('触发秒', 'Trigger second'), value: priceWindow(candidate.seed) },
    { label: t('主动买', 'Aggressive buy'), value: flow(candidate.seed.buy_notional, candidate.seed.buy_count, 'seed buy', t) },
    { label: t('主动卖', 'Aggressive sell'), value: flow(candidate.seed.sell_notional, candidate.seed.sell_count, 'seed sell', t) },
    { label: 'bid', value: `${t('增', 'Added')} ${formatNotional(candidate.seed.bid_addition, 'bid addition')} · ${t('减', 'Removed')} ${formatNotional(candidate.seed.bid_decrease, 'bid decrease')} USDT` },
    { label: 'ask', value: `${t('增', 'Added')} ${formatNotional(candidate.seed.ask_addition, 'ask addition')} · ${t('减', 'Removed')} ${formatNotional(candidate.seed.ask_decrease, 'ask decrease')} USDT` },
    { label: t('基础确认', 'Base confirmation'), value: priceWindow(candidate.confirmation) },
  ];
  if (reinforcement) {
    detailRows.push(
      { label: candidate.direction === 'high' ? t('低点秒', 'Trough second') : t('高点秒', 'Peak second'), value: priceWindow(candidate.trough) },
      { label: candidate.direction === 'high' ? t('反弹秒', 'Rebound second') : t('回落秒', 'Pullback second'), value: priceWindow(candidate.rebound) },
      { label: t('强化确认', 'Reinforcement confirmation'), value: priceWindow(candidate.decision) },
      { label: t('关联候选', 'Related candidate'), value: candidate.parent_candidate_id },
    );
  }
  detailRows.push({ label: t('参数版本', 'Parameter revision'), value: candidate.profile.revision });
  const notices = [t('探索候选，尚未验证预测能力', 'Exploratory candidate; predictive ability not validated')];
  if (candidate.direction === 'low') notices.push(t('镜像规则，尚未独立验证', 'Mirrored rule; not independently validated'));
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

export function buildCompoundCandidateAnnotation(candidate, { locale = 'zh-CN' } = {}) {
  return createLocalizedAnnotation((nextLocale) => formatCompoundCandidateAnnotation(candidate, nextLocale), locale);
}
