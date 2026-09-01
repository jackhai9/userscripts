import assert from 'node:assert/strict';
import test from 'node:test';

import { buildEventAnnotation } from '../../../src/binance-strategy27-events/core/event-annotation.js';

function snapshot(midReturn = '4.2') {
  return {
    bucket_start_ms: 1_000,
    bucket_end_ms: 1_250,
    bucket_trigger_reasons: ['aggressive_buy_to_ask_depth', 'ask_decrease_to_ask_depth'],
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
    latest_snapshot: snapshot(),
  };
  const result = buildEventAnnotation({ event, outcomes: [], rehydrated: false });

  assert.equal(result.markerShape, 'arrow_up');
  assert.equal(result.title, '订单流事件');
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
  assert.deepEqual(result.outcomeLines, []);
  assert.equal('noteText' in result, false);
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
    outcomes: [{ window_seconds: 5, outcome_status: 'input_gap', directional_outcome: null }],
  });
  assert.equal(result.markerShape, 'arrow_down');
  assert.equal(result.triggerText, '价格响应');
  assert.equal(result.closeText, '输入缺口');
  assert.deepEqual(result.notices, ['此前投影历史不可用', '数据不完整，不作方向结论']);
  assert.deepEqual(result.outcomeLines, []);
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
    outcomes: [{
      window_seconds: 5,
      outcome_status: 'complete',
      directional_outcome: 'continuation',
      return_from_active_end_bps: '-0.07891',
    }],
  });

  assert.equal(result.summary, '价格 +0.04 bps · 点差 1.2 bps');
  assert.equal(result.forceRows[0].value, '1.25M USDT · 3 笔');
  assert.equal(result.triggerText, '价格响应、点差变化');
  assert.equal(result.closeText, '达到最长持续时间');
  assert.deepEqual(result.outcomeLines, ['5 秒：延续，收盘响应 -0.08 bps']);
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
    () => buildEventAnnotation({ event, outcomes: [], rehydrated: false }),
    /Unknown Strategy 27 trigger reason/,
  );
});
