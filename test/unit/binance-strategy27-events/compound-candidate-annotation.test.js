import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildCompoundCandidateAnnotation } from '../../../src/binance-strategy27-events/core/compound-candidate-annotation.js';

const fixtures = JSON.parse(readFileSync(new URL('../../fixtures/strategy27-compound-candidates.json', import.meta.url), 'utf8'));

test('compound high and mirrored low carry explicit rule identity and causal candle time', () => {
  for (const [index, expected] of [[0, ['候选高', 'arrow_down', '#B71C3B']], [1, ['候选低', 'arrow_up', '#087F5B']]]) {
    const candidate = fixtures[index];
    const value = buildCompoundCandidateAnnotation(candidate);
    assert.deepEqual([value.markerLabel, value.markerShape, value.markerColor], expected);
    assert.equal(value.eventTimeMs, candidate.decision.end_ms - 1);
    assert.equal(value.markerTime, 6);
    assert.equal(value.ruleIdentity, `impact_failure/${candidate.direction}/${candidate.profile_id}`);
    assert.equal(value.candidateId, candidate.candidate_id);
    assert.equal(value.reinforcement, false);
    assert.deepEqual(value.detailRows.map((row) => row.label), ['规则', '背景', '触发秒', '主动买', '主动卖', 'bid', 'ask', '基础确认', '参数版本']);
    assert.equal(value.notices.includes('镜像规则，尚未独立验证'), index === 1);
    assert.equal(value.notices.includes('探索候选，尚未验证预测能力'), true);
    assert.equal(Object.isFrozen(value.detailRows[0]), true);
    assert.doesNotMatch(JSON.stringify(value), /15\/60|outcome|confidence/);
  }
});

test('reinforcement describes only its own later confirmation and linked parent', () => {
  const base = buildCompoundCandidateAnnotation(fixtures[0]);
  const source = structuredClone(fixtures[0]);
  source.family = 'failed_rebound';
  source.parent_candidate_id = source.candidate_id;
  source.candidate_id = 'b'.repeat(64);
  source.trough = { ...source.confirmation, start_ms: 7000, end_ms: 8000 };
  source.rebound = { ...source.confirmation, start_ms: 8000, end_ms: 9000 };
  source.decision = { ...source.confirmation, start_ms: 9000, end_ms: 10000 };
  const later = buildCompoundCandidateAnnotation(source);
  assert.equal(later.markerTime, 9);
  assert.equal(later.reinforcement, true);
  assert.equal(later.ruleIdentity, `failed_rebound/high/${source.profile_id}/${source.parent_candidate_id}`);
  assert.equal(later.summary, '候选高 · 反弹失败强化');
  assert.deepEqual(later.detailRows.filter((row) => ['低点秒', '反弹秒', '强化确认', '关联候选'].includes(row.label)).map((row) => row.label), ['低点秒', '反弹秒', '强化确认', '关联候选']);
  assert.equal(later.detailRows.find((row) => row.label === '关联候选').value, fixtures[0].candidate_id);
  assert.equal(base.markerTime, 6);
  assert.equal(base.summary, '候选高 · 买入推动失效');
});

test('zero active trades are explained and large quantities remain compact', () => {
  const source = structuredClone(fixtures[0]);
  source.seed.sell_notional = '0';
  source.seed.sell_count = 0;
  source.seed.buy_notional = '1200000';
  source.seed.buy_count = 200;
  const value = buildCompoundCandidateAnnotation(source);
  assert.equal(value.detailRows.find((row) => row.label === '主动卖').value, '无主动成交');
  assert.equal(value.detailRows.find((row) => row.label === '主动买').value, '1.2M USDT · 200 笔');
  source.seed.bid_addition = '0.01234';
  source.seed.bid_decrease = '0.00000678';
  const tiny = buildCompoundCandidateAnnotation(source);
  assert.equal(tiny.detailRows.find((row) => row.label === 'bid').value, '增 0.012 · 减 0.0000068 USDT');
});
