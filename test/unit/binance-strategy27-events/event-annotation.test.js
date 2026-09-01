import assert from 'node:assert/strict';
import test from 'node:test';

import { buildEventAnnotation } from '../../../src/binance-strategy27-events/core/event-annotation.js';

function snapshot(midReturn = '4.2') {
  return {
    bucket_start_ms: 1_000,
    bucket_end_ms: 1_250,
    bucket_trigger_reasons: ['aggressive_buy', 'ask_decrease'],
    aggressive_buy: { notional: '1200', trade_count: 3, to_opposite_depth: '0.4' },
    aggressive_sell: { notional: '200', trade_count: 1, to_opposite_depth: '0.1' },
    bid: {
      observed_addition_notional: '300',
      observed_decrease_notional: '100',
      best_price_migration_bps: '0.2',
      addition_to_depth: '0.3',
      decrease_to_depth: '0.1',
    },
    ask: {
      observed_addition_notional: '100',
      observed_decrease_notional: '500',
      best_price_migration_bps: '-0.4',
      addition_to_depth: '0.1',
      decrease_to_depth: '0.5',
    },
    price_response: {
      mid: '1.25',
      mid_return_bps: midReturn,
      spread_bps: '1.2',
      spread_change_bps: '-0.2',
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
    trigger_reasons: ['aggressive_buy', 'ask_decrease'],
    trigger_snapshot: snapshot(),
    latest_snapshot: snapshot(),
  };
  const result = buildEventAnnotation({ event, outcomes: [], rehydrated: false });

  assert.equal(result.markerShape, 'arrow_up');
  assert.match(result.noteText, /主动买 1200 USDT\/3 笔/);
  assert.match(result.noteText, /bid 增 300 减 100/);
  assert.match(result.noteText, /ask 增 100 减 500/);
  assert.match(result.noteText, /价格响应 \+4\.2 bps/);
  assert.doesNotMatch(result.noteText, /局部高点|局部低点|阻力|支撑/);
});

test('marks rehydrated and input-gap events without a directional conclusion', () => {
  const event = {
    event_kind: 'price_response_event',
    analysis_start_at_ms: 0,
    triggered_at_ms: 1_000,
    active_end_at_ms: 2_000,
    event_status: 'incomplete',
    close_reason: 'input_gap',
    trigger_reasons: ['price_response'],
    trigger_snapshot: snapshot('-3'),
    latest_snapshot: snapshot('-3'),
  };
  const result = buildEventAnnotation({
    event,
    rehydrated: true,
    outcomes: [{ window_seconds: 5, outcome_status: 'input_gap', directional_outcome: null }],
  });
  assert.equal(result.markerShape, 'arrow_down');
  assert.match(result.noteText, /此前投影历史不可用/);
  assert.match(result.noteText, /数据不完整/);
  assert.doesNotMatch(result.noteText, /延续|恢复|反转|部分回撤/);
});

