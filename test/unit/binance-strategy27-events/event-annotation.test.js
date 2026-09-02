import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildEventAnnotation,
  stabilizeCandidatePresentation,
} from '../../../src/binance-strategy27-events/core/event-annotation.js';

function snapshot(midReturn = '4.2', candidateObservations = []) {
  const hasCandidate = candidateObservations.length > 0;
  return {
    bucket_start_ms: 1_000,
    bucket_end_ms: hasCandidate ? 2_000 : 1_250,
    source_bucket_count: hasCandidate ? 4 : 1,
    bucket_trigger_reasons: ['aggressive_buy_to_ask_depth', 'ask_decrease_to_ask_depth'],
    candidate_observations: candidateObservations,
    aggressive_buy: { notional: '12345.6789000000001', trade_count: 3, to_opposite_depth: '0.412345' },
    aggressive_sell: { notional: '200.00000000001', trade_count: 1, to_opposite_depth: '0.1' },
    bid: {
      observed_addition_notional: '300.00000001',
      observed_decrease_notional: '100.00000001',
      best_price_migration_bps: '0.234567',
      addition_to_depth: '0.3',
      decrease_to_depth: '0.1',
    },
    ask: {
      observed_addition_notional: '100.00000001',
      observed_decrease_notional: '500.00000001',
      best_price_migration_bps: '-0.412345',
      addition_to_depth: '0.1',
      decrease_to_depth: '0.5',
    },
    price_response: {
      mid: '1.25',
      mid_return_bps: midReturn,
      spread_bps: '1.234567',
      spread_change_bps: '-0.234567',
    },
  };
}

test('formats objective four-force facts without hindsight labels', () => {
  const event = {
    event_kind: 'orderflow_event',
    analysis_start_at_ms: 0,
    triggered_at_ms: 1_000,
    active_end_at_ms: 2_000,
    event_status: 'complete',
    close_reason: 'quiet_period',
    trigger_reasons: ['aggressive_buy_to_ask_depth', 'ask_decrease_to_ask_depth'],
    trigger_snapshot: snapshot(),
    latest_snapshot: snapshot('4.2', ['bullish_sell_impact_failure']),
  };
  const result = buildEventAnnotation({ event, rehydrated: false });

  assert.equal(result.markerShape, 'arrow_up');
  assert.equal(result.title, '订单流观察');
  assert.equal(result.windowText, '统计 1 秒 · 4 桶');
  assert.equal(result.candidateText, '卖出推动失效 · 抛压转弱');
  assert.equal(result.summary, '价格 +4.2 bps · 点差 1.2 bps');
  assert.deepEqual(result.forceRows, [
    { label: '主动买', value: '12.3K USDT · 3 笔', detail: '吃 ask 深度 0.41' },
    { label: '主动卖', value: '200 USDT · 1 笔', detail: '吃 bid 深度 0.1' },
    { label: 'bid', value: '增 300 · 减 100', detail: '迁移 +0.23 bps' },
    { label: 'ask', value: '增 100 · 减 500', detail: '迁移 -0.41 bps' },
  ]);
  assert.equal(result.triggerText, '主动买、ask 减');
  assert.equal(result.closeText, '安静期结束');
  assert.deepEqual(result.notices, []);
  assert.doesNotMatch(JSON.stringify(result), /局部高点|局部低点|阻力|支撑|12345\.6789/);
});

test('marks rehydrated and input-gap events without a directional conclusion', () => {
  const event = {
    event_kind: 'price_response_event',
    analysis_start_at_ms: 0,
    triggered_at_ms: 1_000,
    active_end_at_ms: 2_000,
    event_status: 'incomplete',
    close_reason: 'input_gap',
    trigger_reasons: ['mid_return_bps'],
    trigger_snapshot: snapshot('-3'),
    latest_snapshot: snapshot('-3'),
  };
  const result = buildEventAnnotation({
    event,
    rehydrated: true,
  });
  assert.equal(result.markerShape, null);
  assert.equal(result.markerColor, null);
  assert.equal(result.triggerText, '价格响应');
  assert.equal(result.closeText, '输入缺口');
  assert.deepEqual(result.notices, ['此前投影历史不可用', '数据不完整，不作方向结论']);
  assert.doesNotMatch(JSON.stringify(result), /延续|恢复|反转|部分回撤/);
});

test('formats small bps and large notionals without exposing raw decimal tails', () => {
  const large = snapshot('0.04321');
  large.aggressive_buy.notional = '1250000.9988';
  const event = {
    event_kind: 'price_response_event',
    analysis_start_at_ms: 0,
    triggered_at_ms: 1_000,
    active_end_at_ms: 2_000,
    event_status: 'complete',
    close_reason: 'maximum_duration',
    trigger_reasons: ['mid_return_bps', 'spread_change_bps'],
    trigger_snapshot: large,
    latest_snapshot: large,
  };
  const result = buildEventAnnotation({
    event,
    rehydrated: false,
  });

  assert.equal(result.summary, '价格 +0.04 bps · 点差 1.2 bps');
  assert.equal(result.forceRows[0].value, '1.25M USDT · 3 笔');
  assert.equal(result.triggerText, '价格响应、点差变化');
  assert.equal(result.closeText, '达到最长持续时间');
});

test('labels a zero one-second trade total as no aggressive trades', () => {
  const empty = snapshot();
  empty.aggressive_buy = { notional: '0', trade_count: 0, to_opposite_depth: '0' };
  const event = {
    event_kind: 'orderflow_event',
    analysis_start_at_ms: 0,
    triggered_at_ms: 1_000,
    active_end_at_ms: null,
    event_status: 'active',
    close_reason: null,
    trigger_reasons: ['ask_decrease_to_ask_depth'],
    trigger_snapshot: snapshot(),
    latest_snapshot: empty,
  };

  const result = buildEventAnnotation({ event, rehydrated: false });

  assert.deepEqual(result.forceRows[0], {
    label: '主动买',
    value: '无主动成交',
    detail: '',
  });
});

test('rejects an unmapped user-visible trigger instead of exposing an internal key', () => {
  const event = {
    event_kind: 'orderflow_event',
    analysis_start_at_ms: 0,
    triggered_at_ms: 1_000,
    active_end_at_ms: null,
    event_status: 'active',
    close_reason: null,
    trigger_reasons: ['unknown_internal_key'],
    trigger_snapshot: snapshot(),
    latest_snapshot: snapshot(),
  };

  assert.throws(
    () => buildEventAnnotation({ event, rehydrated: false }),
    /Unknown Strategy 27 trigger reason/,
  );
});

test('freezes the first red or green candidate presentation for an event', () => {
  const presentations = new Map();
  const first = {
    candidateText: '买入推动失效 · 承接转弱',
    markerShape: 'arrow_down',
    markerColor: '#F6465D',
    markerTime: 10,
    markerPrice: 1.2,
    summary: 'first',
  };
  const later = {
    candidateText: '卖出推动失效 · 抛压转弱',
    markerShape: 'arrow_up',
    markerColor: '#0ECB81',
    markerTime: 11,
    markerPrice: 1.3,
    summary: 'later',
  };

  assert.equal(stabilizeCandidatePresentation(presentations, 'event', first), first);
  assert.deepEqual(stabilizeCandidatePresentation(presentations, 'event', later), {
    ...later,
    candidateText: first.candidateText,
    markerShape: first.markerShape,
    markerColor: first.markerColor,
    markerTime: first.markerTime,
    markerPrice: first.markerPrice,
  });
});
