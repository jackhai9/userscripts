import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalSymbolToRoute,
  eventTimeToChartSecond,
  LiveEventLifecycle,
  routeSymbolToCanonical,
  validateGatewayBootstrapResponse,
  validateGatewayResponse,
  validateLiveEnvelope,
} from '../../../src/binance-strategy27-events/core/live-event-contract.js';

const epoch = '0123456789abcdef0123456789abcdef';
const eventId = 'a'.repeat(64);
const lifecycleOptions = { maxEvents: 80, maxAgeMs: 2 * 60 * 60 * 1_000 };

function snapshot({ start = 1_000, end = 1_250, mid = '1.25' } = {}) {
  return {
    bucket_start_ms: start,
    bucket_end_ms: end,
    source_bucket_count: 1,
    bucket_trigger_reasons: ['aggressive_buy'],
    candidate_observations: [],
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
      mid,
      mid_return_bps: '2.5',
      spread_bps: '1.2',
      spread_change_bps: '-0.2',
    },
  };
}

function event({ status = 'active', activeEnd = null } = {}) {
  const trigger = snapshot();
  const latest = activeEnd === null
    ? trigger
    : snapshot({ start: activeEnd - 250, end: activeEnd });
  return {
    event_kind: 'orderflow_event',
    analysis_start_at_ms: 0,
    triggered_at_ms: 1_000,
    active_end_at_ms: activeEnd,
    event_status: status,
    close_reason: status === 'active' ? null : 'quiet_period',
    trigger_reasons: ['aggressive_buy'],
    trigger_snapshot: trigger,
    latest_snapshot: latest,
  };
}

function envelope({
  sequence = 1,
  kind = 'event_opened',
  payload = { event: event() },
  symbol = 'BTR/USDT:USDT',
  id = eventId,
  status = 'active',
  eventTime = 1_000,
} = {}) {
  return {
    schema_version: 2,
    strategy_id: '27',
    spec_version: '27_2_spec_v10',
    runtime_epoch: epoch,
    sequence,
    message_kind: kind,
    symbol,
    event_id: id,
    observed_at_ms: 2_000,
    event_time_ms: eventTime,
    data_status: status,
    payload,
  };
}

test('canonical and route symbols round-trip exactly', () => {
  assert.equal(canonicalSymbolToRoute('BTR/USDT:USDT'), 'BTRUSDT');
  assert.equal(routeSymbolToCanonical('BTRUSDT'), 'BTR/USDT:USDT');
  assert.throws(() => canonicalSymbolToRoute('BTR/USDT'), /canonical Strategy 27 symbol/);
  assert.throws(() => routeSymbolToCanonical('BTRUSD'), /Binance futures route symbol/);
});

test('event time maps by exact integer-second floor', () => {
  assert.equal(eventTimeToChartSecond(1_999), 1);
  assert.throws(() => eventTimeToChartSecond(1.5), /integer milliseconds/);
});

test('validates the exact gateway reset and success bodies', () => {
  assert.deepEqual(validateGatewayResponse({
    schema_version: 1,
    status: 'reset',
    reason: 'initial_cursor',
    requested_cursor: null,
    next_cursor: '0-0',
    messages: [],
  }, 200), {
    schema_version: 1,
    status: 'reset',
    reason: 'initial_cursor',
    requested_cursor: null,
    next_cursor: '0-0',
    messages: [],
  });

  const opened = envelope();
  const response = validateGatewayResponse({
    schema_version: 1,
    status: 'ok',
    requested_cursor: '0-0',
    next_cursor: '2-0',
    messages: [opened],
  }, 200);
  assert.equal(response.messages[0], opened);
  assert.throws(() => validateGatewayResponse({ ...response, extra: true }, 200), /exact keys/);
});

test('validates live envelopes without coercing decimal strings or extra keys', () => {
  const opened = envelope();
  assert.equal(validateLiveEnvelope(opened), opened);
  assert.throws(
    () => validateLiveEnvelope({ ...opened, payload: { event: { ...opened.payload.event, extra: 1 } } }),
    /exact keys/,
  );
  assert.throws(
    () => validateLiveEnvelope({
      ...opened,
      payload: {
        event: {
          ...opened.payload.event,
          trigger_snapshot: {
            ...opened.payload.event.trigger_snapshot,
            aggressive_buy: {
              ...opened.payload.event.trigger_snapshot.aggressive_buy,
              notional: 1200,
            },
          },
        },
      },
    }),
    /canonical decimal string/,
  );
  assert.throws(
    () => validateLiveEnvelope({
      ...opened,
      payload: {
        event: {
          ...opened.payload.event,
          trigger_snapshot: snapshot({ start: 750, end: 1_000 }),
        },
      },
    }),
    /trigger snapshot must start at triggered_at_ms/,
  );

  const triggerCandidate = envelope();
  triggerCandidate.payload.event.trigger_snapshot.candidate_observations = ['bearish_buy_impact_failure'];
  assert.throws(() => validateLiveEnvelope(triggerCandidate), /uncategorized research bucket/);

  const partialCandidate = envelope();
  partialCandidate.payload.event.latest_snapshot = structuredClone(
    partialCandidate.payload.event.latest_snapshot,
  );
  partialCandidate.payload.event.latest_snapshot.candidate_observations = ['bearish_buy_impact_failure'];
  assert.throws(() => validateLiveEnvelope(partialCandidate), /one complete second/);

  const oversizedNeutral = envelope({ kind: 'event_updated' });
  oversizedNeutral.payload.event.latest_snapshot = snapshot({ start: 1_000, end: 2_250 });
  oversizedNeutral.event_time_ms = 2_250;
  assert.throws(() => validateLiveEnvelope(oversizedNeutral), /must not exceed one second/);

  const aggregatedOpen = envelope();
  aggregatedOpen.payload.event.latest_snapshot = snapshot({ start: 1_000, end: 2_000 });
  aggregatedOpen.payload.event.latest_snapshot.source_bucket_count = 4;
  assert.throws(() => validateLiveEnvelope(aggregatedOpen), /latest snapshot must equal trigger snapshot/);

  const inconsistentCount = envelope({ kind: 'event_updated', eventTime: 2_000 });
  inconsistentCount.payload.event.latest_snapshot = snapshot({ start: 1_000, end: 2_000 });
  assert.throws(() => validateLiveEnvelope(inconsistentCount), /source bucket count must match duration/);

  const indivisibleWidth = envelope({ kind: 'event_updated', eventTime: 1_999 });
  indivisibleWidth.payload.event.trigger_snapshot = snapshot({ start: 1_000, end: 1_333 });
  indivisibleWidth.payload.event.latest_snapshot = snapshot({ start: 1_000, end: 1_999 });
  indivisibleWidth.payload.event.latest_snapshot.source_bucket_count = 3;
  assert.throws(() => validateLiveEnvelope(indivisibleWidth), /trigger bucket duration must divide one second/);

  const misalignedLatest = envelope({ kind: 'event_updated', eventTime: 1_350 });
  misalignedLatest.payload.event.latest_snapshot = snapshot({ start: 1_100, end: 1_350 });
  assert.throws(() => validateLiveEnvelope(misalignedLatest), /must align to trigger bucket grid/);

  const pretriggerLatest = envelope({ kind: 'event_updated', eventTime: 1_000 });
  pretriggerLatest.payload.event.latest_snapshot = snapshot({ start: 750, end: 1_000 });
  assert.throws(() => validateLiveEnvelope(pretriggerLatest), /must not precede trigger bucket/);

  const postCloseEvent = event({ status: 'complete', activeEnd: 2_000 });
  const postCloseLatest = envelope({
    kind: 'event_closed',
    payload: { event: postCloseEvent },
    status: 'complete',
    eventTime: 2_000,
  });
  postCloseLatest.payload.event.latest_snapshot = snapshot({ start: 2_000, end: 2_250 });
  assert.throws(() => validateLiveEnvelope(postCloseLatest), /must not follow active end/);
});

test('allows a closed event to retain the last eligible snapshot before its lifecycle boundary', () => {
  const closedEvent = {
    ...event({ status: 'complete', activeEnd: 2_000 }),
    latest_snapshot: snapshot({ start: 1_500, end: 1_750 }),
  };
  const closedEnvelope = envelope({
    kind: 'event_closed',
    payload: { event: closedEvent },
    status: 'complete',
    eventTime: 2_000,
  });

  assert.equal(validateLiveEnvelope(closedEnvelope), closedEnvelope);
  assert.throws(
    () => validateLiveEnvelope({ ...closedEnvelope, event_time_ms: 1_999 }),
    /event_closed time is invalid/,
  );
});

test('tracks exact sequence and event lifecycle while allowing reset rehydration', () => {
  const lifecycle = new LiveEventLifecycle('BTR/USDT:USDT', lifecycleOptions);
  const opened = lifecycle.apply(envelope());
  assert.equal(opened.type, 'event');
  assert.equal(opened.rehydrated, false);

  const closedEvent = event({ status: 'complete', activeEnd: 2_000 });
  const closed = lifecycle.apply(envelope({
    sequence: 2,
    kind: 'event_closed',
    payload: { event: closedEvent },
    status: 'complete',
    eventTime: 2_000,
  }));
  assert.equal(closed.phase, 'closed');

  const filteredGap = lifecycle.apply(envelope({
    sequence: 4,
    kind: 'event_outcome',
    payload: {
      event: closedEvent,
      outcome: {
        window_seconds: 1,
        outcome_boundary_at_ms: 3_000,
        outcome_status: 'complete',
        terminated_at_ms: null,
        termination_reason: null,
        boundary_mid: '1.2',
        return_from_trigger_bps: '-4',
        return_from_active_end_bps: '-3',
        maximum_upward_excursion_bps: '1',
        maximum_downward_excursion_bps: '4',
        pre_event_range_break_up: false,
        pre_event_range_break_down: true,
        spread_change_from_active_end_bps: '0.2',
        eligible_orderbook_observation_count: 4,
        impulse_direction: 'up',
        directional_outcome: 'reversal',
      },
    },
    status: 'complete',
    eventTime: 3_000,
  }));
  assert.equal(filteredGap.outcomes.length, 1);
  assert.throws(() => lifecycle.apply(envelope({ sequence: 4 })), /sequence regression/);

  lifecycle.reset('stale_cursor');
  const rehydrated = lifecycle.apply(envelope({
    sequence: 9,
    kind: 'event_closed',
    payload: { event: closedEvent },
    status: 'complete',
    eventTime: 2_000,
  }));
  assert.equal(rehydrated.rehydrated, true);
});

test('bootstrap restores a sparse retained subsequence and advances to the live tail', () => {
  const retained = envelope({ sequence: 4, kind: 'event_updated', eventTime: 1_250 });
  const body = {
    schema_version: 1,
    status: 'bootstrap',
    projection_kind: 'strategy27_events',
    requested_cursor: null,
    next_cursor: '12-0',
    runtime_epoch: epoch,
    last_sequence: 7,
    bootstrap_observed_at_ms: 7000,
    records: [{
      event_id: eventId,
      event_envelope: retained,
      marker_envelope: null,
      outcome_envelope: null,
    }],
  };
  assert.equal(validateGatewayBootstrapResponse(body, 200), body);
  assert.throws(
    () => validateGatewayBootstrapResponse({
      ...body,
      records: [{ ...body.records[0], event_envelope: null }],
    }, 200),
    /event envelope is required/,
  );
  const closedEvent = event({ status: 'complete', activeEnd: 2_000 });
  const outcomeOnly = envelope({
    sequence: 6,
    kind: 'event_outcome',
    payload: {
      event: closedEvent,
      outcome: {
        window_seconds: 1,
        outcome_boundary_at_ms: 3_000,
        outcome_status: 'complete',
        terminated_at_ms: null,
        termination_reason: null,
        boundary_mid: '1.2',
        return_from_trigger_bps: '-4',
        return_from_active_end_bps: '-3',
        maximum_upward_excursion_bps: '1',
        maximum_downward_excursion_bps: '4',
        pre_event_range_break_up: false,
        pre_event_range_break_down: true,
        spread_change_from_active_end_bps: '0.2',
        eligible_orderbook_observation_count: 4,
        impulse_direction: 'up',
        directional_outcome: 'reversal',
      },
    },
    status: 'complete',
    eventTime: 3_000,
  });
  const outcomeOnlyBody = {
    ...body,
    records: [{
      event_id: eventId,
      event_envelope: outcomeOnly,
      marker_envelope: null,
      outcome_envelope: outcomeOnly,
    }],
  };
  assert.equal(validateGatewayBootstrapResponse(outcomeOnlyBody, 200), outcomeOnlyBody);
  assert.throws(
    () => validateGatewayBootstrapResponse({
      ...outcomeOnlyBody,
      records: [{ ...outcomeOnlyBody.records[0], outcome_envelope: retained }],
    }, 200),
    /event envelope is invalid/,
  );
  const sparseLifecycle = new LiveEventLifecycle('BTR/USDT:USDT', lifecycleOptions);
  sparseLifecycle.beginBootstrap({
    runtimeEpoch: body.runtime_epoch,
    observedAtMs: body.bootstrap_observed_at_ms,
  });
  assert.equal(sparseLifecycle.apply(retained).phase, 'active');
  const sparseOutcome = sparseLifecycle.apply(outcomeOnly);
  assert.equal(sparseOutcome.phase, 'closed');
  assert.equal(sparseOutcome.outcomes.length, 1);
  sparseLifecycle.finishBootstrap(body.last_sequence);
  const strictLifecycle = new LiveEventLifecycle('BTR/USDT:USDT', lifecycleOptions);
  strictLifecycle.apply(envelope());
  assert.throws(
    () => strictLifecycle.apply(envelope({
      sequence: 2,
      kind: 'event_outcome',
      payload: outcomeOnly.payload,
      status: 'complete',
      eventTime: 3_000,
    })),
    /requires a closed event/,
  );
  const lifecycle = new LiveEventLifecycle('BTR/USDT:USDT', lifecycleOptions);
  lifecycle.beginBootstrap({ runtimeEpoch: body.runtime_epoch, observedAtMs: body.bootstrap_observed_at_ms });
  assert.equal(lifecycle.apply(retained).type, 'event');
  lifecycle.finishBootstrap(body.last_sequence);
  assert.equal(lifecycle.apply(envelope({ sequence: 8, kind: 'event_updated', eventTime: 1_250 })).type, 'event');
  assert.equal(lifecycle.lastSequence, 8);
});

test('rejects unknown lifecycle transitions without a reset', () => {
  const lifecycle = new LiveEventLifecycle('BTR/USDT:USDT', lifecycleOptions);
  lifecycle.apply(envelope());
  const lateSnapshot = snapshot({ start: 3_000, end: 3_250 });
  const lateEvent = {
    ...event(),
    triggered_at_ms: 3_000,
    trigger_snapshot: lateSnapshot,
    latest_snapshot: lateSnapshot,
  };
  assert.throws(
    () => lifecycle.apply(envelope({
      sequence: 2,
      id: 'b'.repeat(64),
      kind: 'event_updated',
      payload: { event: lateEvent },
      eventTime: 3_250,
    })),
    /unknown event/,
  );
});

test('rejects a repeated stream_state inside the same epoch before any event', () => {
  const lifecycle = new LiveEventLifecycle('BTR/USDT:USDT', lifecycleOptions);
  const streamState = envelope({
    kind: 'stream_state',
    symbol: null,
    id: null,
    status: 'ready',
    eventTime: 2_000,
    payload: { state: 'ready', reason: 'startup' },
  });
  assert.equal(lifecycle.apply(streamState).type, 'stream_reset');
  assert.throws(
    () => lifecycle.apply({ ...streamState, sequence: 2 }),
    /Unexpected stream_state inside an active epoch/,
  );
});

test('bounds retained lifecycle events and reports exact count and age evictions', () => {
  const lifecycle = new LiveEventLifecycle('BTR/USDT:USDT', { maxEvents: 2, maxAgeMs: 1_000 });
  const eventB = 'b'.repeat(64);
  const eventC = 'c'.repeat(64);
  lifecycle.apply(envelope({ id: eventId, sequence: 1 }));
  lifecycle.apply(envelope({ id: eventB, sequence: 2 }));

  const inserted = lifecycle.apply(envelope({ id: eventC, sequence: 3 }));
  assert.deepEqual(inserted.evictedEventIds, [eventId]);
  assert.equal(lifecycle.size, 2);

  assert.deepEqual(lifecycle.prune(3_001), [eventB, eventC]);
  assert.equal(lifecycle.size, 0);
  const ignored = lifecycle.apply(envelope({
    id: eventB,
    sequence: 4,
    kind: 'event_updated',
    eventTime: 1_250,
  }));
  assert.equal(ignored.type, 'event_evicted');
  assert.equal(lifecycle.size, 0);
});
