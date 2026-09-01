const CANONICAL_SYMBOL_PATTERN = /^([A-Z0-9]+)\/USDT:USDT$/;
const ROUTE_SYMBOL_PATTERN = /^([A-Z0-9]+)USDT$/;
const STREAM_ID_PATTERN = /^(0|[1-9]\d*)-(0|[1-9]\d*)$/;
const EPOCH_PATTERN = /^[0-9a-f]{32}$/;
const EVENT_ID_PATTERN = /^[0-9a-f]{64}$/;
const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

const MESSAGE_KINDS = new Set([
  'stream_state',
  'event_opened',
  'event_updated',
  'event_closed',
  'event_outcome',
]);
const DATA_STATUSES = new Set(['ready', 'active', 'complete', 'incomplete', 'input_gap', 'terminated']);
const EVENT_KINDS = new Set(['orderflow_event', 'price_response_event']);
const EVENT_STATUSES = new Set(['active', 'complete', 'incomplete']);
const OUTCOME_STATUSES = new Set(['complete', 'input_gap', 'terminated']);
const IMPULSE_DIRECTIONS = new Set(['up', 'down', 'flat']);
const DIRECTIONAL_OUTCOMES = new Set([
  'continuation',
  'recovery',
  'reversal',
  'partial_retracement',
  'not_applicable',
]);

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function assertExactKeys(value, keys, label) {
  assertCondition(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assertCondition(
    actual.length === expected.length && actual.every((key, index) => key === expected[index]),
    `${label} must contain exact keys: ${expected.join(', ')}`,
  );
}

function assertInteger(value, label, { minimum = 0 } = {}) {
  assertCondition(Number.isInteger(value) && value >= minimum, `${label} must be an integer >= ${minimum}`);
}

function assertNullableInteger(value, label) {
  if (value !== null) assertInteger(value, label);
}

function assertDecimal(value, label, { positive = false, nonNegative = false } = {}) {
  assertCondition(typeof value === 'string' && DECIMAL_PATTERN.test(value), `${label} must be a canonical decimal string`);
  assertCondition(value !== '-0', `${label} must be a canonical decimal string`);
  const numeric = Number(value);
  assertCondition(Number.isFinite(numeric), `${label} must be a finite canonical decimal string`);
  if (positive) assertCondition(numeric > 0, `${label} must be positive`);
  if (nonNegative) assertCondition(numeric >= 0, `${label} must be non-negative`);
}

function assertNullableDecimal(value, label) {
  if (value !== null) assertDecimal(value, label);
}

function assertSortedUniqueStrings(value, label, { nonEmpty = false } = {}) {
  assertCondition(Array.isArray(value), `${label} must be an array`);
  assertCondition(value.every((item) => typeof item === 'string' && item.length > 0), `${label} must contain non-empty strings`);
  const sorted = [...new Set(value)].sort();
  assertCondition(sorted.length === value.length && sorted.every((item, index) => item === value[index]), `${label} must be sorted and unique`);
  if (nonEmpty) assertCondition(value.length > 0, `${label} must not be empty`);
}

function validateAggressiveSide(value, label) {
  assertExactKeys(value, ['notional', 'trade_count', 'to_opposite_depth'], label);
  assertDecimal(value.notional, `${label}.notional`, { nonNegative: true });
  assertInteger(value.trade_count, `${label}.trade_count`);
  assertDecimal(value.to_opposite_depth, `${label}.to_opposite_depth`, { nonNegative: true });
}

function validateBookSide(value, label) {
  assertExactKeys(value, [
    'observed_addition_notional',
    'observed_decrease_notional',
    'best_price_migration_bps',
    'addition_to_depth',
    'decrease_to_depth',
  ], label);
  assertDecimal(value.observed_addition_notional, `${label}.observed_addition_notional`, { nonNegative: true });
  assertDecimal(value.observed_decrease_notional, `${label}.observed_decrease_notional`, { nonNegative: true });
  assertDecimal(value.best_price_migration_bps, `${label}.best_price_migration_bps`);
  assertDecimal(value.addition_to_depth, `${label}.addition_to_depth`, { nonNegative: true });
  assertDecimal(value.decrease_to_depth, `${label}.decrease_to_depth`, { nonNegative: true });
}

function validatePriceResponse(value, label) {
  assertExactKeys(value, ['mid', 'mid_return_bps', 'spread_bps', 'spread_change_bps'], label);
  assertDecimal(value.mid, `${label}.mid`, { positive: true });
  assertDecimal(value.mid_return_bps, `${label}.mid_return_bps`);
  assertDecimal(value.spread_bps, `${label}.spread_bps`, { nonNegative: true });
  assertDecimal(value.spread_change_bps, `${label}.spread_change_bps`);
}

function validateSnapshot(value, label) {
  assertExactKeys(value, [
    'bucket_start_ms',
    'bucket_end_ms',
    'bucket_trigger_reasons',
    'aggressive_buy',
    'aggressive_sell',
    'bid',
    'ask',
    'price_response',
  ], label);
  assertInteger(value.bucket_start_ms, `${label}.bucket_start_ms`);
  assertInteger(value.bucket_end_ms, `${label}.bucket_end_ms`);
  assertCondition(value.bucket_end_ms > value.bucket_start_ms, `${label} bucket end must follow start`);
  assertSortedUniqueStrings(value.bucket_trigger_reasons, `${label}.bucket_trigger_reasons`);
  validateAggressiveSide(value.aggressive_buy, `${label}.aggressive_buy`);
  validateAggressiveSide(value.aggressive_sell, `${label}.aggressive_sell`);
  validateBookSide(value.bid, `${label}.bid`);
  validateBookSide(value.ask, `${label}.ask`);
  validatePriceResponse(value.price_response, `${label}.price_response`);
}

function validateEvent(value) {
  assertExactKeys(value, [
    'event_kind',
    'analysis_start_at_ms',
    'triggered_at_ms',
    'active_end_at_ms',
    'event_status',
    'close_reason',
    'trigger_reasons',
    'trigger_snapshot',
    'latest_snapshot',
  ], 'payload.event');
  assertCondition(EVENT_KINDS.has(value.event_kind), 'payload.event.event_kind is invalid');
  assertInteger(value.analysis_start_at_ms, 'payload.event.analysis_start_at_ms');
  assertInteger(value.triggered_at_ms, 'payload.event.triggered_at_ms');
  assertCondition(value.analysis_start_at_ms <= value.triggered_at_ms, 'event analysis must not start after trigger');
  assertNullableInteger(value.active_end_at_ms, 'payload.event.active_end_at_ms');
  assertCondition(EVENT_STATUSES.has(value.event_status), 'payload.event.event_status is invalid');
  assertSortedUniqueStrings(value.trigger_reasons, 'payload.event.trigger_reasons', { nonEmpty: true });
  validateSnapshot(value.trigger_snapshot, 'payload.event.trigger_snapshot');
  validateSnapshot(value.latest_snapshot, 'payload.event.latest_snapshot');
  assertCondition(value.trigger_snapshot.bucket_start_ms === value.triggered_at_ms, 'trigger snapshot must start at triggered_at_ms');
  if (value.event_status === 'active') {
    assertCondition(value.active_end_at_ms === null && value.close_reason === null, 'active event close fields must be null');
  } else {
    assertInteger(value.active_end_at_ms, 'payload.event.active_end_at_ms');
    assertCondition(value.active_end_at_ms >= value.triggered_at_ms, 'event active end must not precede trigger');
    assertCondition([
      'quiet_period',
      'maximum_duration',
      'input_gap',
      'universe_removed',
      'monitor_stopped',
    ].includes(value.close_reason), 'closed event close_reason is invalid');
    assertCondition(value.latest_snapshot.bucket_end_ms === value.active_end_at_ms, 'closed latest snapshot must end at active_end_at_ms');
  }
}

function validateOutcome(value) {
  assertExactKeys(value, [
    'window_seconds',
    'outcome_boundary_at_ms',
    'outcome_status',
    'terminated_at_ms',
    'termination_reason',
    'boundary_mid',
    'return_from_trigger_bps',
    'return_from_active_end_bps',
    'maximum_upward_excursion_bps',
    'maximum_downward_excursion_bps',
    'pre_event_range_break_up',
    'pre_event_range_break_down',
    'spread_change_from_active_end_bps',
    'eligible_orderbook_observation_count',
    'impulse_direction',
    'directional_outcome',
  ], 'payload.outcome');
  assertInteger(value.window_seconds, 'payload.outcome.window_seconds', { minimum: 1 });
  assertInteger(value.outcome_boundary_at_ms, 'payload.outcome.outcome_boundary_at_ms');
  assertCondition(OUTCOME_STATUSES.has(value.outcome_status), 'payload.outcome.outcome_status is invalid');
  assertNullableInteger(value.terminated_at_ms, 'payload.outcome.terminated_at_ms');
  assertCondition(value.termination_reason === null || ['universe_removed', 'monitor_stopped'].includes(value.termination_reason), 'payload.outcome.termination_reason is invalid');
  if (value.boundary_mid !== null) assertDecimal(value.boundary_mid, 'payload.outcome.boundary_mid', { positive: true });
  assertNullableDecimal(value.return_from_trigger_bps, 'payload.outcome.return_from_trigger_bps');
  assertNullableDecimal(value.return_from_active_end_bps, 'payload.outcome.return_from_active_end_bps');
  if (value.maximum_upward_excursion_bps !== null) assertDecimal(value.maximum_upward_excursion_bps, 'payload.outcome.maximum_upward_excursion_bps', { nonNegative: true });
  if (value.maximum_downward_excursion_bps !== null) assertDecimal(value.maximum_downward_excursion_bps, 'payload.outcome.maximum_downward_excursion_bps', { nonNegative: true });
  assertCondition(value.pre_event_range_break_up === null || typeof value.pre_event_range_break_up === 'boolean', 'payload.outcome.pre_event_range_break_up is invalid');
  assertCondition(value.pre_event_range_break_down === null || typeof value.pre_event_range_break_down === 'boolean', 'payload.outcome.pre_event_range_break_down is invalid');
  assertNullableDecimal(value.spread_change_from_active_end_bps, 'payload.outcome.spread_change_from_active_end_bps');
  assertInteger(value.eligible_orderbook_observation_count, 'payload.outcome.eligible_orderbook_observation_count');
  assertCondition(value.impulse_direction === null || IMPULSE_DIRECTIONS.has(value.impulse_direction), 'payload.outcome.impulse_direction is invalid');
  assertCondition(value.directional_outcome === null || DIRECTIONAL_OUTCOMES.has(value.directional_outcome), 'payload.outcome.directional_outcome is invalid');
  if (value.outcome_status === 'complete') {
    for (const field of [
      'boundary_mid',
      'return_from_trigger_bps',
      'return_from_active_end_bps',
      'maximum_upward_excursion_bps',
      'maximum_downward_excursion_bps',
      'pre_event_range_break_up',
      'pre_event_range_break_down',
      'spread_change_from_active_end_bps',
      'impulse_direction',
      'directional_outcome',
    ]) {
      assertCondition(value[field] !== null, `complete outcome requires ${field}`);
    }
    assertCondition(value.terminated_at_ms === null && value.termination_reason === null, 'complete outcome cannot contain termination fields');
  } else {
    assertCondition(value.directional_outcome === null, 'incomplete outcome cannot have a directional conclusion');
    if (value.outcome_status === 'terminated') {
      assertInteger(value.terminated_at_ms, 'payload.outcome.terminated_at_ms');
      assertCondition(['universe_removed', 'monitor_stopped'].includes(value.termination_reason), 'terminated outcome requires termination_reason');
    } else {
      assertCondition(value.terminated_at_ms === null && value.termination_reason === null, 'input-gap outcome cannot contain termination fields');
    }
  }
}

export function routeSymbolToCanonical(routeSymbol) {
  const match = String(routeSymbol).match(ROUTE_SYMBOL_PATTERN);
  assertCondition(match && match[1].length > 0, 'Invalid Binance futures route symbol');
  return `${match[1]}/USDT:USDT`;
}

export function canonicalSymbolToRoute(canonicalSymbol) {
  const match = String(canonicalSymbol).match(CANONICAL_SYMBOL_PATTERN);
  assertCondition(match && match[1].length > 0, 'Invalid canonical Strategy 27 symbol');
  const routeSymbol = `${match[1]}USDT`;
  assertCondition(routeSymbolToCanonical(routeSymbol) === canonicalSymbol, 'Canonical Strategy 27 symbol does not round-trip');
  return routeSymbol;
}

export function eventTimeToChartSecond(eventTimeMs) {
  assertCondition(Number.isInteger(eventTimeMs) && eventTimeMs >= 0, 'Event time must be non-negative integer milliseconds');
  return Math.floor(eventTimeMs / 1_000);
}

export function validateLiveEnvelope(value) {
  assertExactKeys(value, [
    'schema_version',
    'strategy_id',
    'spec_version',
    'runtime_epoch',
    'sequence',
    'message_kind',
    'symbol',
    'event_id',
    'observed_at_ms',
    'event_time_ms',
    'data_status',
    'payload',
  ], 'live envelope');
  assertCondition(value.schema_version === 1, 'Live envelope schema_version must be 1');
  assertCondition(value.strategy_id === '27', 'Live envelope strategy_id must be 27');
  assertCondition(value.spec_version === '27_2_spec_v10', 'Live envelope spec_version is invalid');
  assertCondition(typeof value.runtime_epoch === 'string' && EPOCH_PATTERN.test(value.runtime_epoch), 'Live envelope runtime_epoch is invalid');
  assertInteger(value.sequence, 'Live envelope sequence', { minimum: 1 });
  assertCondition(MESSAGE_KINDS.has(value.message_kind), 'Live envelope message_kind is invalid');
  assertInteger(value.observed_at_ms, 'Live envelope observed_at_ms');
  assertInteger(value.event_time_ms, 'Live envelope event_time_ms');
  assertCondition(DATA_STATUSES.has(value.data_status), 'Live envelope data_status is invalid');

  if (value.message_kind === 'stream_state') {
    assertCondition(value.symbol === null && value.event_id === null, 'stream_state identity must be null');
    assertCondition(value.data_status === 'ready', 'stream_state data_status must be ready');
    assertCondition(value.event_time_ms === value.observed_at_ms, 'stream_state event time must equal observation time');
    assertExactKeys(value.payload, ['state', 'reason'], 'stream_state payload');
    assertCondition(value.payload.state === 'ready', 'stream_state payload.state must be ready');
    assertCondition(['startup', 'transport_recovered', 'queue_recovered'].includes(value.payload.reason), 'stream_state reason is invalid');
    return value;
  }

  canonicalSymbolToRoute(value.symbol);
  assertCondition(typeof value.event_id === 'string' && EVENT_ID_PATTERN.test(value.event_id), 'Live envelope event_id is invalid');
  const payloadKeys = value.message_kind === 'event_outcome' ? ['event', 'outcome'] : ['event'];
  assertExactKeys(value.payload, payloadKeys, 'event payload');
  validateEvent(value.payload.event);

  if (value.message_kind === 'event_opened' || value.message_kind === 'event_updated') {
    assertCondition(value.data_status === 'active' && value.payload.event.event_status === 'active', 'active message status is invalid');
  } else {
    assertCondition(value.payload.event.event_status !== 'active', 'closed message requires a closed event');
    assertCondition(value.data_status === value.payload.event.event_status || value.message_kind === 'event_outcome', 'closed message data_status is invalid');
  }

  if (value.message_kind === 'event_opened') {
    assertCondition(value.event_time_ms === value.payload.event.triggered_at_ms, 'event_opened time is invalid');
  } else if (value.message_kind === 'event_updated') {
    assertCondition(value.event_time_ms === value.payload.event.latest_snapshot.bucket_end_ms, 'event_updated time is invalid');
  } else if (value.message_kind === 'event_closed') {
    assertCondition(value.event_time_ms === value.payload.event.active_end_at_ms, 'event_closed time is invalid');
  } else {
    validateOutcome(value.payload.outcome);
    assertCondition(value.data_status === value.payload.outcome.outcome_status, 'event_outcome data_status is invalid');
    assertCondition(value.event_time_ms === value.payload.outcome.outcome_boundary_at_ms, 'event_outcome time is invalid');
  }
  return value;
}

export function validateGatewayResponse(value, httpStatus) {
  if (value?.status === 'ok') {
    assertCondition(httpStatus === 200, 'Gateway success must use HTTP 200');
    assertExactKeys(value, ['schema_version', 'status', 'requested_cursor', 'next_cursor', 'messages'], 'gateway success response');
    assertCondition(value.schema_version === 1, 'Gateway response schema_version must be 1');
    assertCondition(typeof value.requested_cursor === 'string' && STREAM_ID_PATTERN.test(value.requested_cursor), 'Gateway requested_cursor is invalid');
    assertCondition(typeof value.next_cursor === 'string' && STREAM_ID_PATTERN.test(value.next_cursor), 'Gateway next_cursor is invalid');
    assertCondition(Array.isArray(value.messages), 'Gateway messages must be an array');
    value.messages.forEach(validateLiveEnvelope);
    return value;
  }
  if (value?.status === 'reset') {
    assertExactKeys(value, ['schema_version', 'status', 'reason', 'requested_cursor', 'next_cursor', 'messages'], 'gateway reset response');
    assertCondition(value.schema_version === 1, 'Gateway response schema_version must be 1');
    assertCondition(['initial_cursor', 'stale_cursor'].includes(value.reason), 'Gateway reset reason is invalid');
    assertCondition(httpStatus === (value.reason === 'initial_cursor' ? 200 : 409), 'Gateway reset HTTP status is invalid');
    assertCondition(value.reason === 'initial_cursor' ? value.requested_cursor === null : typeof value.requested_cursor === 'string' && STREAM_ID_PATTERN.test(value.requested_cursor), 'Gateway reset requested_cursor is invalid');
    assertCondition(typeof value.next_cursor === 'string' && STREAM_ID_PATTERN.test(value.next_cursor), 'Gateway reset next_cursor is invalid');
    assertCondition(Array.isArray(value.messages) && value.messages.length === 0, 'Gateway reset messages must be empty');
    return value;
  }
  if (value?.status === 'error') {
    assertExactKeys(value, ['schema_version', 'status', 'error_code'], 'gateway error response');
    assertCondition(value.schema_version === 1, 'Gateway response schema_version must be 1');
    const expected = { 400: 'invalid_request', 401: 'unauthorized', 503: 'redis_unavailable' }[httpStatus];
    assertCondition(value.error_code === expected, 'Gateway error status and code do not match');
    return value;
  }
  throw new Error('Gateway response status is invalid');
}

export class LiveEventLifecycle {
  constructor(canonicalSymbol, { maxEvents, maxAgeMs }) {
    canonicalSymbolToRoute(canonicalSymbol);
    assertCondition(Number.isInteger(maxEvents) && maxEvents >= 1, 'Lifecycle maxEvents is invalid');
    assertCondition(Number.isInteger(maxAgeMs) && maxAgeMs >= 1, 'Lifecycle maxAgeMs is invalid');
    this.canonicalSymbol = canonicalSymbol;
    this.maxEvents = maxEvents;
    this.maxAgeMs = maxAgeMs;
    this.reset('initial_cursor');
  }

  reset(reason) {
    assertCondition(['initial_cursor', 'stale_cursor', 'route_changed', 'interval_changed'].includes(reason), 'Lifecycle reset reason is invalid');
    this.runtimeEpoch = null;
    this.lastSequence = null;
    this.epochEnvelopeAccepted = false;
    this.events = new Map();
    this.evictedEvents = new Map();
    this.allowUnknownRehydrate = true;
    this.rehydrationCutoffMs = null;
  }

  rememberEviction(eventId, observedAtMs) {
    this.evictedEvents.delete(eventId);
    this.evictedEvents.set(eventId, observedAtMs);
    while (this.evictedEvents.size > this.maxEvents) {
      this.evictedEvents.delete(this.evictedEvents.keys().next().value);
    }
  }

  evict(eventId, observedAtMs) {
    if (!this.events.delete(eventId)) return false;
    this.rememberEviction(eventId, observedAtMs);
    return true;
  }

  prune(observedAtMs) {
    assertInteger(observedAtMs, 'Lifecycle prune observedAtMs');
    const evictedEventIds = [];
    for (const [eventId, state] of this.events) {
      if (observedAtMs - state.observedAtMs > this.maxAgeMs && this.evict(eventId, observedAtMs)) {
        evictedEventIds.push(eventId);
      }
    }
    for (const [eventId, evictedAtMs] of this.evictedEvents) {
      if (observedAtMs - evictedAtMs > this.maxAgeMs) this.evictedEvents.delete(eventId);
    }
    return evictedEventIds;
  }

  makeRoomForNewEvent(observedAtMs) {
    const evictedEventIds = [];
    while (this.events.size >= this.maxEvents) {
      const eventId = this.events.keys().next().value;
      if (this.evict(eventId, observedAtMs)) evictedEventIds.push(eventId);
    }
    return evictedEventIds;
  }

  apply(rawEnvelope) {
    const envelope = validateLiveEnvelope(rawEnvelope);
    if (envelope.message_kind !== 'stream_state') {
      assertCondition(envelope.symbol === this.canonicalSymbol, 'Envelope symbol does not match requested symbol');
    }

    let epochChanged = false;
    if (this.runtimeEpoch === null) {
      this.runtimeEpoch = envelope.runtime_epoch;
      this.lastSequence = envelope.sequence;
      this.rehydrationCutoffMs = envelope.observed_at_ms;
    } else if (envelope.runtime_epoch !== this.runtimeEpoch) {
      assertCondition(envelope.message_kind === 'stream_state', 'Runtime epoch changed without stream_state');
      this.runtimeEpoch = envelope.runtime_epoch;
      this.lastSequence = envelope.sequence;
      this.events.clear();
      this.evictedEvents.clear();
      this.allowUnknownRehydrate = true;
      this.rehydrationCutoffMs = envelope.observed_at_ms;
      epochChanged = true;
    } else {
      // The gateway omits other-symbol envelopes while advancing the Redis cursor, so a
      // requested-symbol client observes a strictly increasing subsequence, not +1 adjacency.
      assertCondition(envelope.sequence > this.lastSequence, 'Live projection sequence regression');
      this.lastSequence = envelope.sequence;
    }

    if (envelope.message_kind === 'stream_state') {
      assertCondition(epochChanged || !this.epochEnvelopeAccepted, 'Unexpected stream_state inside an active epoch');
      this.epochEnvelopeAccepted = true;
      return { type: 'stream_reset', envelope };
    }
    this.epochEnvelopeAccepted = true;

    const evictedEventIds = this.prune(envelope.observed_at_ms);
    if (this.evictedEvents.has(envelope.event_id)) {
      assertCondition(envelope.message_kind !== 'event_opened', 'Duplicate event_opened for an evicted event');
      return {
        type: 'event_evicted',
        eventId: envelope.event_id,
        evictedEventIds,
      };
    }

    const existing = this.events.get(envelope.event_id);
    let rehydrated = false;
    if (!existing) {
      if (envelope.message_kind !== 'event_opened') {
        assertCondition(this.allowUnknownRehydrate, 'Received an unknown event lifecycle transition without reset');
        assertCondition(
          envelope.payload.event.triggered_at_ms <= this.rehydrationCutoffMs,
          'Received an unknown event lifecycle transition without reset',
        );
        rehydrated = true;
      }
      evictedEventIds.push(...this.makeRoomForNewEvent(envelope.observed_at_ms));
      this.events.set(envelope.event_id, {
        phase: envelope.message_kind === 'event_opened' || envelope.message_kind === 'event_updated' ? 'active' : 'closed',
        event: envelope.payload.event,
        outcomes: new Map(),
        rehydrated,
        observedAtMs: envelope.observed_at_ms,
      });
    } else {
      assertCondition(envelope.message_kind !== 'event_opened', 'Duplicate event_opened');
      assertCondition(existing.phase !== 'closed' || envelope.message_kind === 'event_outcome', 'Closed event received an invalid lifecycle transition');
      assertCondition(envelope.message_kind !== 'event_closed' || existing.phase === 'active', 'Duplicate event_closed');
      existing.event = envelope.payload.event;
      existing.observedAtMs = envelope.observed_at_ms;
      if (envelope.message_kind === 'event_closed') existing.phase = 'closed';
    }

    const current = this.events.get(envelope.event_id);
    if (envelope.message_kind === 'event_outcome') {
      assertCondition(current.phase === 'closed', 'event_outcome requires a closed event');
      const horizon = envelope.payload.outcome.window_seconds;
      const previousHorizons = [...current.outcomes.keys()];
      assertCondition(!current.outcomes.has(horizon), 'Duplicate event outcome horizon');
      assertCondition(previousHorizons.length === 0 || horizon > Math.max(...previousHorizons), 'Event outcome horizons must increase');
      current.outcomes.set(horizon, envelope.payload.outcome);
    }

    return {
      type: 'event',
      phase: current.phase,
      messageKind: envelope.message_kind,
      eventId: envelope.event_id,
      eventTimeMs: envelope.event_time_ms,
      observedAtMs: envelope.observed_at_ms,
      event: current.event,
      outcomes: [...current.outcomes.values()],
      rehydrated: current.rehydrated,
      evictedEventIds,
    };
  }

  get size() {
    return this.events.size;
  }
}
