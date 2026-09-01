// ==UserScript==
// @name         【自写】Binance Strategy 27 事件标注
// @namespace    binance.strategy27.events
// @icon         data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%23f0b90b%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2249%22%20text-anchor%3D%22middle%22%20font-family%3D%22Arial%2C%20sans-serif%22%20font-size%3D%2242%22%20font-weight%3D%22800%22%20fill%3D%22%23111827%22%3EJ%3C%2Ftext%3E%3C%2Fsvg%3E
// @icon64       data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%23f0b90b%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2249%22%20text-anchor%3D%22middle%22%20font-family%3D%22Arial%2C%20sans-serif%22%20font-size%3D%2242%22%20font-weight%3D%22800%22%20fill%3D%22%23111827%22%3EJ%3C%2Ftext%3E%3C%2Fsvg%3E
// @version      0.1.0
// @author       jackhai9
// @description  在 Binance 一秒图表标注 VPS Strategy 27 的实时订单流事件和后续结果
// @match        https://www.binance.com/*/futures/*
// @match        https://www.binance.com/futures/*
// @exclude      https://www.binance.com/*/my/wallet/futures/*
// @exclude      https://www.binance.com/my/wallet/futures/*
// @connect      127.0.0.1
// @updateURL    https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-strategy27-events.user.js
// @downloadURL  https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-strategy27-events.user.js
// @run-at       document-idle
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==
(() => {
  // src/binance-strategy27-events/core/live-event-contract.js
  var CANONICAL_SYMBOL_PATTERN = /^([A-Z0-9]+)\/USDT:USDT$/;
  var ROUTE_SYMBOL_PATTERN = /^([A-Z0-9]+)USDT$/;
  var STREAM_ID_PATTERN = /^(0|[1-9]\d*)-(0|[1-9]\d*)$/;
  var EPOCH_PATTERN = /^[0-9a-f]{32}$/;
  var EVENT_ID_PATTERN = /^[0-9a-f]{64}$/;
  var DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
  var MESSAGE_KINDS = /* @__PURE__ */ new Set([
    "stream_state",
    "event_opened",
    "event_updated",
    "event_closed",
    "event_outcome"
  ]);
  var DATA_STATUSES = /* @__PURE__ */ new Set(["ready", "active", "complete", "incomplete", "input_gap", "terminated"]);
  var EVENT_KINDS = /* @__PURE__ */ new Set(["orderflow_event", "price_response_event"]);
  var EVENT_STATUSES = /* @__PURE__ */ new Set(["active", "complete", "incomplete"]);
  var OUTCOME_STATUSES = /* @__PURE__ */ new Set(["complete", "input_gap", "terminated"]);
  var IMPULSE_DIRECTIONS = /* @__PURE__ */ new Set(["up", "down", "flat"]);
  var DIRECTIONAL_OUTCOMES = /* @__PURE__ */ new Set([
    "continuation",
    "recovery",
    "reversal",
    "partial_retracement",
    "not_applicable"
  ]);
  function assertCondition(condition, message) {
    if (!condition) throw new Error(message);
  }
  function assertExactKeys(value, keys, label) {
    assertCondition(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    assertCondition(
      actual.length === expected.length && actual.every((key, index) => key === expected[index]),
      `${label} must contain exact keys: ${expected.join(", ")}`
    );
  }
  function assertInteger(value, label, { minimum = 0 } = {}) {
    assertCondition(Number.isInteger(value) && value >= minimum, `${label} must be an integer >= ${minimum}`);
  }
  function assertNullableInteger(value, label) {
    if (value !== null) assertInteger(value, label);
  }
  function assertDecimal(value, label, { positive = false, nonNegative = false } = {}) {
    assertCondition(typeof value === "string" && DECIMAL_PATTERN.test(value), `${label} must be a canonical decimal string`);
    assertCondition(value !== "-0", `${label} must be a canonical decimal string`);
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
    assertCondition(value.every((item) => typeof item === "string" && item.length > 0), `${label} must contain non-empty strings`);
    const sorted = [...new Set(value)].sort();
    assertCondition(sorted.length === value.length && sorted.every((item, index) => item === value[index]), `${label} must be sorted and unique`);
    if (nonEmpty) assertCondition(value.length > 0, `${label} must not be empty`);
  }
  function validateAggressiveSide(value, label) {
    assertExactKeys(value, ["notional", "trade_count", "to_opposite_depth"], label);
    assertDecimal(value.notional, `${label}.notional`, { nonNegative: true });
    assertInteger(value.trade_count, `${label}.trade_count`);
    assertDecimal(value.to_opposite_depth, `${label}.to_opposite_depth`, { nonNegative: true });
  }
  function validateBookSide(value, label) {
    assertExactKeys(value, [
      "observed_addition_notional",
      "observed_decrease_notional",
      "best_price_migration_bps",
      "addition_to_depth",
      "decrease_to_depth"
    ], label);
    assertDecimal(value.observed_addition_notional, `${label}.observed_addition_notional`, { nonNegative: true });
    assertDecimal(value.observed_decrease_notional, `${label}.observed_decrease_notional`, { nonNegative: true });
    assertDecimal(value.best_price_migration_bps, `${label}.best_price_migration_bps`);
    assertDecimal(value.addition_to_depth, `${label}.addition_to_depth`, { nonNegative: true });
    assertDecimal(value.decrease_to_depth, `${label}.decrease_to_depth`, { nonNegative: true });
  }
  function validatePriceResponse(value, label) {
    assertExactKeys(value, ["mid", "mid_return_bps", "spread_bps", "spread_change_bps"], label);
    assertDecimal(value.mid, `${label}.mid`, { positive: true });
    assertDecimal(value.mid_return_bps, `${label}.mid_return_bps`);
    assertDecimal(value.spread_bps, `${label}.spread_bps`, { nonNegative: true });
    assertDecimal(value.spread_change_bps, `${label}.spread_change_bps`);
  }
  function validateSnapshot(value, label) {
    assertExactKeys(value, [
      "bucket_start_ms",
      "bucket_end_ms",
      "bucket_trigger_reasons",
      "aggressive_buy",
      "aggressive_sell",
      "bid",
      "ask",
      "price_response"
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
      "event_kind",
      "analysis_start_at_ms",
      "triggered_at_ms",
      "active_end_at_ms",
      "event_status",
      "close_reason",
      "trigger_reasons",
      "trigger_snapshot",
      "latest_snapshot"
    ], "payload.event");
    assertCondition(EVENT_KINDS.has(value.event_kind), "payload.event.event_kind is invalid");
    assertInteger(value.analysis_start_at_ms, "payload.event.analysis_start_at_ms");
    assertInteger(value.triggered_at_ms, "payload.event.triggered_at_ms");
    assertCondition(value.analysis_start_at_ms <= value.triggered_at_ms, "event analysis must not start after trigger");
    assertNullableInteger(value.active_end_at_ms, "payload.event.active_end_at_ms");
    assertCondition(EVENT_STATUSES.has(value.event_status), "payload.event.event_status is invalid");
    assertSortedUniqueStrings(value.trigger_reasons, "payload.event.trigger_reasons", { nonEmpty: true });
    validateSnapshot(value.trigger_snapshot, "payload.event.trigger_snapshot");
    validateSnapshot(value.latest_snapshot, "payload.event.latest_snapshot");
    assertCondition(value.trigger_snapshot.bucket_end_ms === value.triggered_at_ms, "trigger snapshot must end at triggered_at_ms");
    if (value.event_status === "active") {
      assertCondition(value.active_end_at_ms === null && value.close_reason === null, "active event close fields must be null");
    } else {
      assertInteger(value.active_end_at_ms, "payload.event.active_end_at_ms");
      assertCondition(value.active_end_at_ms >= value.triggered_at_ms, "event active end must not precede trigger");
      assertCondition([
        "quiet_period",
        "maximum_duration",
        "input_gap",
        "universe_removed",
        "monitor_stopped"
      ].includes(value.close_reason), "closed event close_reason is invalid");
      assertCondition(value.latest_snapshot.bucket_end_ms === value.active_end_at_ms, "closed latest snapshot must end at active_end_at_ms");
    }
  }
  function validateOutcome(value) {
    assertExactKeys(value, [
      "window_seconds",
      "outcome_boundary_at_ms",
      "outcome_status",
      "terminated_at_ms",
      "termination_reason",
      "boundary_mid",
      "return_from_trigger_bps",
      "return_from_active_end_bps",
      "maximum_upward_excursion_bps",
      "maximum_downward_excursion_bps",
      "pre_event_range_break_up",
      "pre_event_range_break_down",
      "spread_change_from_active_end_bps",
      "eligible_orderbook_observation_count",
      "impulse_direction",
      "directional_outcome"
    ], "payload.outcome");
    assertInteger(value.window_seconds, "payload.outcome.window_seconds", { minimum: 1 });
    assertInteger(value.outcome_boundary_at_ms, "payload.outcome.outcome_boundary_at_ms");
    assertCondition(OUTCOME_STATUSES.has(value.outcome_status), "payload.outcome.outcome_status is invalid");
    assertNullableInteger(value.terminated_at_ms, "payload.outcome.terminated_at_ms");
    assertCondition(value.termination_reason === null || ["universe_removed", "monitor_stopped"].includes(value.termination_reason), "payload.outcome.termination_reason is invalid");
    if (value.boundary_mid !== null) assertDecimal(value.boundary_mid, "payload.outcome.boundary_mid", { positive: true });
    assertNullableDecimal(value.return_from_trigger_bps, "payload.outcome.return_from_trigger_bps");
    assertNullableDecimal(value.return_from_active_end_bps, "payload.outcome.return_from_active_end_bps");
    if (value.maximum_upward_excursion_bps !== null) assertDecimal(value.maximum_upward_excursion_bps, "payload.outcome.maximum_upward_excursion_bps", { nonNegative: true });
    if (value.maximum_downward_excursion_bps !== null) assertDecimal(value.maximum_downward_excursion_bps, "payload.outcome.maximum_downward_excursion_bps", { nonNegative: true });
    assertCondition(value.pre_event_range_break_up === null || typeof value.pre_event_range_break_up === "boolean", "payload.outcome.pre_event_range_break_up is invalid");
    assertCondition(value.pre_event_range_break_down === null || typeof value.pre_event_range_break_down === "boolean", "payload.outcome.pre_event_range_break_down is invalid");
    assertNullableDecimal(value.spread_change_from_active_end_bps, "payload.outcome.spread_change_from_active_end_bps");
    assertInteger(value.eligible_orderbook_observation_count, "payload.outcome.eligible_orderbook_observation_count");
    assertCondition(value.impulse_direction === null || IMPULSE_DIRECTIONS.has(value.impulse_direction), "payload.outcome.impulse_direction is invalid");
    assertCondition(value.directional_outcome === null || DIRECTIONAL_OUTCOMES.has(value.directional_outcome), "payload.outcome.directional_outcome is invalid");
    if (value.outcome_status === "complete") {
      for (const field of [
        "boundary_mid",
        "return_from_trigger_bps",
        "return_from_active_end_bps",
        "maximum_upward_excursion_bps",
        "maximum_downward_excursion_bps",
        "pre_event_range_break_up",
        "pre_event_range_break_down",
        "spread_change_from_active_end_bps",
        "impulse_direction",
        "directional_outcome"
      ]) {
        assertCondition(value[field] !== null, `complete outcome requires ${field}`);
      }
      assertCondition(value.terminated_at_ms === null && value.termination_reason === null, "complete outcome cannot contain termination fields");
    } else {
      assertCondition(value.directional_outcome === null, "incomplete outcome cannot have a directional conclusion");
      if (value.outcome_status === "terminated") {
        assertInteger(value.terminated_at_ms, "payload.outcome.terminated_at_ms");
        assertCondition(["universe_removed", "monitor_stopped"].includes(value.termination_reason), "terminated outcome requires termination_reason");
      } else {
        assertCondition(value.terminated_at_ms === null && value.termination_reason === null, "input-gap outcome cannot contain termination fields");
      }
    }
  }
  function routeSymbolToCanonical(routeSymbol) {
    const match = String(routeSymbol).match(ROUTE_SYMBOL_PATTERN);
    assertCondition(match && match[1].length > 0, "Invalid Binance futures route symbol");
    return `${match[1]}/USDT:USDT`;
  }
  function canonicalSymbolToRoute(canonicalSymbol) {
    const match = String(canonicalSymbol).match(CANONICAL_SYMBOL_PATTERN);
    assertCondition(match && match[1].length > 0, "Invalid canonical Strategy 27 symbol");
    const routeSymbol = `${match[1]}USDT`;
    assertCondition(routeSymbolToCanonical(routeSymbol) === canonicalSymbol, "Canonical Strategy 27 symbol does not round-trip");
    return routeSymbol;
  }
  function eventTimeToChartSecond(eventTimeMs) {
    assertCondition(Number.isInteger(eventTimeMs) && eventTimeMs >= 0, "Event time must be non-negative integer milliseconds");
    return Math.floor(eventTimeMs / 1e3);
  }
  function validateLiveEnvelope(value) {
    assertExactKeys(value, [
      "schema_version",
      "strategy_id",
      "spec_version",
      "runtime_epoch",
      "sequence",
      "message_kind",
      "symbol",
      "event_id",
      "observed_at_ms",
      "event_time_ms",
      "data_status",
      "payload"
    ], "live envelope");
    assertCondition(value.schema_version === 1, "Live envelope schema_version must be 1");
    assertCondition(value.strategy_id === "27", "Live envelope strategy_id must be 27");
    assertCondition(value.spec_version === "27_2_spec_v10", "Live envelope spec_version is invalid");
    assertCondition(typeof value.runtime_epoch === "string" && EPOCH_PATTERN.test(value.runtime_epoch), "Live envelope runtime_epoch is invalid");
    assertInteger(value.sequence, "Live envelope sequence", { minimum: 1 });
    assertCondition(MESSAGE_KINDS.has(value.message_kind), "Live envelope message_kind is invalid");
    assertInteger(value.observed_at_ms, "Live envelope observed_at_ms");
    assertInteger(value.event_time_ms, "Live envelope event_time_ms");
    assertCondition(DATA_STATUSES.has(value.data_status), "Live envelope data_status is invalid");
    if (value.message_kind === "stream_state") {
      assertCondition(value.symbol === null && value.event_id === null, "stream_state identity must be null");
      assertCondition(value.data_status === "ready", "stream_state data_status must be ready");
      assertCondition(value.event_time_ms === value.observed_at_ms, "stream_state event time must equal observation time");
      assertExactKeys(value.payload, ["state", "reason"], "stream_state payload");
      assertCondition(value.payload.state === "ready", "stream_state payload.state must be ready");
      assertCondition(["startup", "transport_recovered", "queue_recovered"].includes(value.payload.reason), "stream_state reason is invalid");
      return value;
    }
    canonicalSymbolToRoute(value.symbol);
    assertCondition(typeof value.event_id === "string" && EVENT_ID_PATTERN.test(value.event_id), "Live envelope event_id is invalid");
    const payloadKeys = value.message_kind === "event_outcome" ? ["event", "outcome"] : ["event"];
    assertExactKeys(value.payload, payloadKeys, "event payload");
    validateEvent(value.payload.event);
    if (value.message_kind === "event_opened" || value.message_kind === "event_updated") {
      assertCondition(value.data_status === "active" && value.payload.event.event_status === "active", "active message status is invalid");
    } else {
      assertCondition(value.payload.event.event_status !== "active", "closed message requires a closed event");
      assertCondition(value.data_status === value.payload.event.event_status || value.message_kind === "event_outcome", "closed message data_status is invalid");
    }
    if (value.message_kind === "event_opened") {
      assertCondition(value.event_time_ms === value.payload.event.triggered_at_ms, "event_opened time is invalid");
    } else if (value.message_kind === "event_updated") {
      assertCondition(value.event_time_ms === value.payload.event.latest_snapshot.bucket_end_ms, "event_updated time is invalid");
    } else if (value.message_kind === "event_closed") {
      assertCondition(value.event_time_ms === value.payload.event.active_end_at_ms, "event_closed time is invalid");
    } else {
      validateOutcome(value.payload.outcome);
      assertCondition(value.data_status === value.payload.outcome.outcome_status, "event_outcome data_status is invalid");
      assertCondition(value.event_time_ms === value.payload.outcome.outcome_boundary_at_ms, "event_outcome time is invalid");
    }
    return value;
  }
  function validateGatewayResponse(value, httpStatus) {
    if (value?.status === "ok") {
      assertCondition(httpStatus === 200, "Gateway success must use HTTP 200");
      assertExactKeys(value, ["schema_version", "status", "requested_cursor", "next_cursor", "messages"], "gateway success response");
      assertCondition(value.schema_version === 1, "Gateway response schema_version must be 1");
      assertCondition(typeof value.requested_cursor === "string" && STREAM_ID_PATTERN.test(value.requested_cursor), "Gateway requested_cursor is invalid");
      assertCondition(typeof value.next_cursor === "string" && STREAM_ID_PATTERN.test(value.next_cursor), "Gateway next_cursor is invalid");
      assertCondition(Array.isArray(value.messages), "Gateway messages must be an array");
      value.messages.forEach(validateLiveEnvelope);
      return value;
    }
    if (value?.status === "reset") {
      assertExactKeys(value, ["schema_version", "status", "reason", "requested_cursor", "next_cursor", "messages"], "gateway reset response");
      assertCondition(value.schema_version === 1, "Gateway response schema_version must be 1");
      assertCondition(["initial_cursor", "stale_cursor"].includes(value.reason), "Gateway reset reason is invalid");
      assertCondition(httpStatus === (value.reason === "initial_cursor" ? 200 : 409), "Gateway reset HTTP status is invalid");
      assertCondition(value.reason === "initial_cursor" ? value.requested_cursor === null : typeof value.requested_cursor === "string" && STREAM_ID_PATTERN.test(value.requested_cursor), "Gateway reset requested_cursor is invalid");
      assertCondition(typeof value.next_cursor === "string" && STREAM_ID_PATTERN.test(value.next_cursor), "Gateway reset next_cursor is invalid");
      assertCondition(Array.isArray(value.messages) && value.messages.length === 0, "Gateway reset messages must be empty");
      return value;
    }
    if (value?.status === "error") {
      assertExactKeys(value, ["schema_version", "status", "error_code"], "gateway error response");
      assertCondition(value.schema_version === 1, "Gateway response schema_version must be 1");
      const expected = { 400: "invalid_request", 401: "unauthorized", 503: "redis_unavailable" }[httpStatus];
      assertCondition(value.error_code === expected, "Gateway error status and code do not match");
      return value;
    }
    throw new Error("Gateway response status is invalid");
  }
  var LiveEventLifecycle = class {
    constructor(canonicalSymbol, { maxEvents, maxAgeMs }) {
      canonicalSymbolToRoute(canonicalSymbol);
      assertCondition(Number.isInteger(maxEvents) && maxEvents >= 1, "Lifecycle maxEvents is invalid");
      assertCondition(Number.isInteger(maxAgeMs) && maxAgeMs >= 1, "Lifecycle maxAgeMs is invalid");
      this.canonicalSymbol = canonicalSymbol;
      this.maxEvents = maxEvents;
      this.maxAgeMs = maxAgeMs;
      this.reset("initial_cursor");
    }
    reset(reason) {
      assertCondition(["initial_cursor", "stale_cursor", "route_changed", "interval_changed"].includes(reason), "Lifecycle reset reason is invalid");
      this.runtimeEpoch = null;
      this.lastSequence = null;
      this.epochEnvelopeAccepted = false;
      this.events = /* @__PURE__ */ new Map();
      this.evictedEvents = /* @__PURE__ */ new Map();
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
      assertInteger(observedAtMs, "Lifecycle prune observedAtMs");
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
      if (envelope.message_kind !== "stream_state") {
        assertCondition(envelope.symbol === this.canonicalSymbol, "Envelope symbol does not match requested symbol");
      }
      let epochChanged = false;
      if (this.runtimeEpoch === null) {
        this.runtimeEpoch = envelope.runtime_epoch;
        this.lastSequence = envelope.sequence;
        this.rehydrationCutoffMs = envelope.observed_at_ms;
      } else if (envelope.runtime_epoch !== this.runtimeEpoch) {
        assertCondition(envelope.message_kind === "stream_state", "Runtime epoch changed without stream_state");
        this.runtimeEpoch = envelope.runtime_epoch;
        this.lastSequence = envelope.sequence;
        this.events.clear();
        this.evictedEvents.clear();
        this.allowUnknownRehydrate = true;
        this.rehydrationCutoffMs = envelope.observed_at_ms;
        epochChanged = true;
      } else {
        assertCondition(envelope.sequence > this.lastSequence, "Live projection sequence regression");
        this.lastSequence = envelope.sequence;
      }
      if (envelope.message_kind === "stream_state") {
        assertCondition(epochChanged || !this.epochEnvelopeAccepted, "Unexpected stream_state inside an active epoch");
        this.epochEnvelopeAccepted = true;
        return { type: "stream_reset", envelope };
      }
      this.epochEnvelopeAccepted = true;
      const evictedEventIds = this.prune(envelope.observed_at_ms);
      if (this.evictedEvents.has(envelope.event_id)) {
        assertCondition(envelope.message_kind !== "event_opened", "Duplicate event_opened for an evicted event");
        return {
          type: "event_evicted",
          eventId: envelope.event_id,
          evictedEventIds
        };
      }
      const existing = this.events.get(envelope.event_id);
      let rehydrated = false;
      if (!existing) {
        if (envelope.message_kind !== "event_opened") {
          assertCondition(this.allowUnknownRehydrate, "Received an unknown event lifecycle transition without reset");
          assertCondition(
            envelope.payload.event.triggered_at_ms <= this.rehydrationCutoffMs,
            "Received an unknown event lifecycle transition without reset"
          );
          rehydrated = true;
        }
        evictedEventIds.push(...this.makeRoomForNewEvent(envelope.observed_at_ms));
        this.events.set(envelope.event_id, {
          phase: envelope.message_kind === "event_opened" || envelope.message_kind === "event_updated" ? "active" : "closed",
          event: envelope.payload.event,
          outcomes: /* @__PURE__ */ new Map(),
          rehydrated,
          observedAtMs: envelope.observed_at_ms
        });
      } else {
        assertCondition(envelope.message_kind !== "event_opened", "Duplicate event_opened");
        assertCondition(existing.phase !== "closed" || envelope.message_kind === "event_outcome", "Closed event received an invalid lifecycle transition");
        assertCondition(envelope.message_kind !== "event_closed" || existing.phase === "active", "Duplicate event_closed");
        existing.event = envelope.payload.event;
        existing.observedAtMs = envelope.observed_at_ms;
        if (envelope.message_kind === "event_closed") existing.phase = "closed";
      }
      const current = this.events.get(envelope.event_id);
      if (envelope.message_kind === "event_outcome") {
        assertCondition(current.phase === "closed", "event_outcome requires a closed event");
        const horizon = envelope.payload.outcome.window_seconds;
        const previousHorizons = [...current.outcomes.keys()];
        assertCondition(!current.outcomes.has(horizon), "Duplicate event outcome horizon");
        assertCondition(previousHorizons.length === 0 || horizon > Math.max(...previousHorizons), "Event outcome horizons must increase");
        current.outcomes.set(horizon, envelope.payload.outcome);
      }
      return {
        type: "event",
        phase: current.phase,
        messageKind: envelope.message_kind,
        eventId: envelope.event_id,
        eventTimeMs: envelope.event_time_ms,
        observedAtMs: envelope.observed_at_ms,
        event: current.event,
        outcomes: [...current.outcomes.values()],
        rehydrated: current.rehydrated,
        evictedEventIds
      };
    }
    get size() {
      return this.events.size;
    }
  };

  // src/binance-strategy27-events/core/live-event-client.js
  function abortError() {
    return new DOMException("Strategy 27 gateway request aborted", "AbortError");
  }
  function normalizeGatewayBaseUrl(value) {
    const url = new URL(String(value));
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
      throw new Error("Strategy 27 gateway must use an explicit HTTP loopback address");
    }
    if (!url.port || url.username || url.password || url.search || url.hash) {
      throw new Error("Strategy 27 gateway must be a loopback origin only");
    }
    if (url.pathname !== "/" && url.pathname !== "") {
      throw new Error("Strategy 27 gateway must be a loopback origin only");
    }
    return url.origin;
  }
  function createGmJsonRequest(gmRequest) {
    if (typeof gmRequest !== "function") throw new Error("GM request adapter is unavailable");
    return ({ url, authSecret, signal }) => new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(abortError());
        return;
      }
      let settled = false;
      const settle = (callback) => (value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);
        callback(value);
      };
      const resolveOnce = settle(resolve);
      const rejectOnce = settle(reject);
      const handle = gmRequest({
        method: "GET",
        url,
        headers: { Authorization: `Bearer ${authSecret}` },
        timeout: 25e3,
        onload: resolveOnce,
        onerror: () => rejectOnce(new Error("Strategy 27 gateway request failed")),
        ontimeout: () => rejectOnce(new Error("Strategy 27 gateway request timed out")),
        onabort: () => rejectOnce(abortError())
      });
      function abort() {
        handle.abort();
      }
      signal.addEventListener("abort", abort, { once: true });
    });
  }
  function parseResponseJson(response) {
    if (!Number.isInteger(response?.status) || typeof response.responseText !== "string") {
      throw new Error("Strategy 27 gateway returned an invalid GM response");
    }
    let payload;
    try {
      payload = JSON.parse(response.responseText);
    } catch {
      throw new Error("Strategy 27 gateway returned invalid JSON");
    }
    return validateGatewayResponse(payload, response.status);
  }
  function compareStreamIds(left, right) {
    const [leftMs, leftSequence] = left.split("-").map(BigInt);
    const [rightMs, rightSequence] = right.split("-").map(BigInt);
    if (leftMs !== rightMs) return leftMs > rightMs ? 1 : -1;
    if (leftSequence === rightSequence) return 0;
    return leftSequence > rightSequence ? 1 : -1;
  }
  function assertCursorContract(payload, cursor) {
    if (payload.status === "error") return;
    if (payload.requested_cursor !== cursor) {
      throw new Error("Strategy 27 gateway response cursor does not match the request");
    }
    if (cursor !== null && compareStreamIds(payload.next_cursor, cursor) < 0) {
      throw new Error("Strategy 27 gateway cursor regressed");
    }
  }
  function createLiveEventClient({
    request,
    gatewayBaseUrl,
    authSecret,
    canonicalSymbol,
    onResponse
  }) {
    if (typeof request !== "function") throw new Error("Strategy 27 request function is required");
    if (typeof authSecret !== "string" || authSecret.length === 0) throw new Error("Strategy 27 gateway secret is not configured");
    if (typeof canonicalSymbol !== "string" || canonicalSymbol.length === 0) throw new Error("Strategy 27 canonical symbol is required");
    if (typeof onResponse !== "function") throw new Error("Strategy 27 response listener is required");
    const origin = normalizeGatewayBaseUrl(gatewayBaseUrl);
    let cursor = null;
    return Object.freeze({
      async run(signal) {
        while (!signal.aborted) {
          const url = new URL("/v1/strategy27/events", origin);
          url.searchParams.set("symbol", canonicalSymbol);
          if (cursor !== null) url.searchParams.set("cursor", cursor);
          const response = await request({
            url: url.href,
            authSecret,
            signal
          });
          const payload = parseResponseJson(response);
          assertCursorContract(payload, cursor);
          if (payload.status === "error") {
            throw new Error(`Strategy 27 gateway error: ${payload.error_code}`);
          }
          await onResponse(payload);
          cursor = payload.next_cursor;
        }
      }
    });
  }

  // src/binance-strategy27-events/core/event-annotation.js
  var OUTCOME_LABELS = {
    continuation: "延续",
    recovery: "恢复",
    reversal: "反转",
    partial_retracement: "部分回撤",
    not_applicable: "不适用"
  };
  function signedDecimal(value) {
    const numeric = Number(value);
    if (numeric > 0) return `+${value}`;
    return value;
  }
  function formatForce(name, force) {
    return `${name} ${force.notional} USDT/${force.trade_count} 笔，吃对手深度 ${force.to_opposite_depth}`;
  }
  function formatBook(name, side) {
    return `${name} 增 ${side.observed_addition_notional} 减 ${side.observed_decrease_notional}，最优价迁移 ${signedDecimal(side.best_price_migration_bps)} bps`;
  }
  function outcomeLine(outcome) {
    if (outcome.outcome_status !== "complete") return `${outcome.window_seconds} 秒：数据不完整`;
    const directional = OUTCOME_LABELS[outcome.directional_outcome] ?? "无方向结论";
    return `${outcome.window_seconds} 秒：${directional}，收盘响应 ${signedDecimal(outcome.return_from_active_end_bps)} bps`;
  }
  function buildEventAnnotation({
    event,
    outcomes,
    rehydrated,
    eventTimeMs = event.triggered_at_ms,
    messageKind = event.event_status === "active" ? "event_updated" : "event_closed"
  }) {
    const snapshot = messageKind === "event_opened" ? event.trigger_snapshot : event.latest_snapshot;
    const response = snapshot.price_response;
    const midReturn = Number(response.mid_return_bps);
    const markerShape = midReturn > 0 ? "arrow_up" : midReturn < 0 ? "arrow_down" : "flag";
    const markerColor = midReturn > 0 ? "#0ECB81" : midReturn < 0 ? "#F6465D" : "#F0B90B";
    const incomplete = event.event_status === "incomplete" || outcomes.some((item) => item.outcome_status !== "complete");
    const lines = [
      `Strategy 27 ${event.event_kind === "orderflow_event" ? "订单流事件" : "价格响应事件"}`,
      formatForce("主动买", snapshot.aggressive_buy),
      formatForce("主动卖", snapshot.aggressive_sell),
      formatBook("bid", snapshot.bid),
      formatBook("ask", snapshot.ask),
      `价格响应 ${signedDecimal(response.mid_return_bps)} bps，点差 ${response.spread_bps} bps`,
      `触发：${event.trigger_reasons.join("、")}`
    ];
    if (event.event_status !== "active") lines.push(`结束：${event.close_reason}`);
    if (rehydrated) lines.push("此前投影历史不可用");
    if (incomplete) lines.push("数据不完整，不作方向结论");
    else lines.push(...outcomes.map(outcomeLine));
    const coordinateTime = eventTimeToChartSecond(eventTimeMs);
    const coordinatePrice = Number(response.mid);
    return Object.freeze({
      markerShape,
      markerColor,
      markerTime: coordinateTime,
      markerPrice: coordinatePrice,
      noteText: lines.join("\n"),
      noteTime: coordinateTime,
      notePrice: coordinatePrice,
      liveStatus: `${lines[0]}｜${lines[5]}`
    });
  }

  // src/binance-strategy27-events/dom/tradingview-event-layer.js
  var CHART_ROOT_SELECTOR = ".chart-widget-root";
  var STATUS_ID = "jh-strategy27-event-status";
  function hasVisibleBox(element) {
    if (!element?.getClientRects().length) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  function routeSymbolFromChartSymbol(value) {
    return String(value || "").split("@", 1)[0];
  }
  function assertChartContract(chart) {
    for (const method of ["createShape", "getShapeById", "removeEntity", "resolution", "symbol"]) {
      if (typeof chart?.[method] !== "function") throw new Error(`TradingView chart method is unavailable: ${method}`);
    }
  }
  function findStrategy27ChartTarget(document, expectedRouteSymbol) {
    const chartRoot = findStrategy27ChartRoot(document);
    if (!chartRoot) return null;
    const frames = Array.from(chartRoot.querySelectorAll("iframe")).filter(hasVisibleBox);
    if (!frames.length) return null;
    if (frames.length !== 1) throw new Error(`Visible Strategy 27 chart frame count is invalid: ${frames.length}`);
    const tradingViewApi = frames[0].contentWindow?.tradingViewApi;
    const chart = tradingViewApi?.activeChart?.();
    if (!chart) return null;
    assertChartContract(chart);
    const resolution = chart.resolution();
    if (resolution !== "1S") throw new Error(`Strategy 27 annotations require a one-second chart, received ${resolution}`);
    const routeSymbol = routeSymbolFromChartSymbol(chart.symbol());
    if (routeSymbol !== expectedRouteSymbol) {
      throw new Error(`Strategy 27 chart symbol mismatch: expected ${expectedRouteSymbol}, received ${routeSymbol}`);
    }
    return { chartRoot, frame: frames[0], tradingViewApi, chart, resolution, routeSymbol };
  }
  function findStrategy27ChartRoot(document) {
    const chartRoots = Array.from(document.querySelectorAll(CHART_ROOT_SELECTOR)).filter(hasVisibleBox);
    if (!chartRoots.length) return null;
    if (chartRoots.length !== 1) throw new Error(`Visible Strategy 27 chart root count is invalid: ${chartRoots.length}`);
    return chartRoots[0];
  }
  function shapeOptions(shape, color, text = "") {
    return {
      shape,
      text,
      lock: true,
      disableSave: true,
      disableSelection: true,
      disableUndo: true,
      showInObjectsTree: false,
      overrides: {
        color,
        fontsize: 12,
        fixedSize: true,
        wordWrap: true,
        wordWrapWidth: 220
      }
    };
  }
  function verifyResolvedTime(chart, id, requestedTime) {
    const shape = chart.getShapeById(id);
    const points = shape?.getPoints?.();
    if (!Array.isArray(points) || points.length !== 1 || points[0].time !== requestedTime) {
      throw new Error(`Strategy 27 chart time alignment failed for ${requestedTime}`);
    }
    return shape;
  }
  async function createAlignedShape(chart, point, options) {
    const id = await chart.createShape(point, options);
    if (typeof id !== "string" || id.length === 0) throw new Error("TradingView returned an invalid shape id");
    try {
      verifyResolvedTime(chart, id, point.time);
    } catch (error) {
      chart.removeEntity(id);
      throw error;
    }
    return id;
  }
  function updateAlignedShape(chart, id, point, properties) {
    const shape = chart.getShapeById(id);
    if (!shape || typeof shape.setPoints !== "function" || typeof shape.setProperties !== "function") {
      throw new Error("TradingView shape update contract is unavailable");
    }
    shape.setPoints([point]);
    shape.setProperties(properties);
    verifyResolvedTime(chart, id, point.time);
  }
  function createTradingViewEventLayer(target, { maxEvents, maxAgeMs }) {
    if (!Number.isInteger(maxEvents) || maxEvents < 1) throw new Error("Strategy 27 maxEvents is invalid");
    if (!Number.isInteger(maxAgeMs) || maxAgeMs < 1) throw new Error("Strategy 27 maxAgeMs is invalid");
    const { chart } = target;
    const registry = /* @__PURE__ */ new Map();
    function removeRecord(eventId) {
      const record = registry.get(eventId);
      if (!record) return;
      for (const id of [record.markerId, record.noteId]) {
        if (id) chart.removeEntity(id);
      }
      registry.delete(eventId);
    }
    function pruneAge(observedAtMs) {
      for (const [eventId, record] of registry) {
        if (observedAtMs - record.observedAtMs > maxAgeMs) removeRecord(eventId);
      }
    }
    function ensureCapacityForNew() {
      while (registry.size >= maxEvents) removeRecord(registry.keys().next().value);
    }
    async function ensureMarker(eventId, annotation, observedAtMs) {
      let record = registry.get(eventId);
      if (!record) {
        pruneAge(observedAtMs);
        ensureCapacityForNew();
        const markerId = await createAlignedShape(chart, {
          time: annotation.markerTime,
          price: annotation.markerPrice
        }, shapeOptions(annotation.markerShape, annotation.markerColor));
        record = { markerId, noteId: null, observedAtMs };
        registry.set(eventId, record);
      } else {
        updateAlignedShape(chart, record.markerId, {
          time: annotation.markerTime,
          price: annotation.markerPrice
        }, { color: annotation.markerColor });
        record.observedAtMs = observedAtMs;
      }
      return record;
    }
    async function ensureNote(eventId, annotation, observedAtMs) {
      const record = await ensureMarker(eventId, annotation, observedAtMs);
      const point = { time: annotation.noteTime, price: annotation.notePrice };
      if (!record.noteId) {
        record.noteId = await createAlignedShape(
          chart,
          point,
          shapeOptions("text", annotation.markerColor, annotation.noteText)
        );
      } else {
        updateAlignedShape(chart, record.noteId, point, {
          color: annotation.markerColor,
          text: annotation.noteText
        });
      }
    }
    return Object.freeze({
      renderOpened: (eventId, annotation, observedAtMs) => ensureMarker(eventId, annotation, observedAtMs),
      renderUpdated: (eventId, annotation, observedAtMs) => ensureMarker(eventId, annotation, observedAtMs),
      renderClosed: (eventId, annotation, observedAtMs) => ensureNote(eventId, annotation, observedAtMs),
      renderOutcome: (eventId, annotation, observedAtMs) => ensureNote(eventId, annotation, observedAtMs),
      remove: removeRecord,
      prune: pruneAge,
      clear() {
        for (const eventId of [...registry.keys()]) removeRecord(eventId);
      },
      get size() {
        return registry.size;
      }
    });
  }
  function ensureStrategy27StatusView(document, chartRoot) {
    const existing = document.getElementById(STATUS_ID);
    if (existing && existing.parentElement === chartRoot) return existing;
    existing?.remove();
    const status = document.createElement("div");
    status.id = STATUS_ID;
    status.setAttribute("aria-live", "polite");
    Object.assign(status.style, {
      position: "absolute",
      zIndex: "8",
      right: "84px",
      top: "42px",
      maxWidth: "520px",
      padding: "4px 8px",
      borderRadius: "6px",
      background: "rgba(24, 26, 32, .82)",
      color: "#EAECEF",
      font: "12px/18px BinancePlex, ui-sans-serif, system-ui, sans-serif",
      pointerEvents: "none",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    });
    chartRoot.appendChild(status);
    return status;
  }
  function setStrategy27Status(status, text, state = "normal") {
    status.textContent = text;
    status.title = text;
    status.dataset.state = state;
    status.style.color = state === "error" ? "#F6465D" : state === "inactive" ? "#848E9C" : "#EAECEF";
  }
  function removeStrategy27StatusView(document) {
    document.getElementById(STATUS_ID)?.remove();
  }

  // src/shared/binance-futures-route.js
  var FUTURES_TRADING_PATH_RE = /^\/(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?futures\/([A-Za-z0-9_]{3,})\/?$/;
  function parseFuturesTradingSymbolFromPathname(pathname) {
    const normalized = String(pathname || "").split(/[?#]/, 1)[0];
    const match = normalized.match(FUTURES_TRADING_PATH_RE);
    return match?.[1] ? match[1].toUpperCase() : null;
  }

  // src/shared/spa-route-change.js
  var ROUTE_CHANGE_EVENT = "jh-userscripts:spa-route-change";
  var ROUTE_PATCH_MARKER = Symbol.for("jh-userscripts.spa-route-change-patched");
  var ROUTE_DISPATCH_STATE = Symbol.for("jh-userscripts.spa-route-change-dispatch");
  function dispatchRouteChange(view) {
    const href = view.location.href;
    if (view[ROUTE_DISPATCH_STATE]?.href === href) return;
    const state = { href };
    view[ROUTE_DISPATCH_STATE] = state;
    view.dispatchEvent(new view.Event(ROUTE_CHANGE_EVENT));
    view.queueMicrotask(() => {
      if (view[ROUTE_DISPATCH_STATE] === state) delete view[ROUTE_DISPATCH_STATE];
    });
  }
  function patchHistoryMethod(view, methodName) {
    const current = view.history[methodName];
    if (current[ROUTE_PATCH_MARKER]) return;
    function routeAwareHistoryMethod(...args) {
      const previousHref = view.location.href;
      const result = Reflect.apply(current, this, args);
      if (view.location.href !== previousHref) dispatchRouteChange(view);
      return result;
    }
    Object.defineProperty(routeAwareHistoryMethod, ROUTE_PATCH_MARKER, { value: true });
    view.history[methodName] = routeAwareHistoryMethod;
  }
  function ensureSpaRouteChangePatched(view) {
    if (!view?.history) throw new Error("SPA route patch requires a window");
    patchHistoryMethod(view, "pushState");
    patchHistoryMethod(view, "replaceState");
  }
  function installSpaRouteChangeListener(view, listener) {
    if (!view?.history || typeof listener !== "function") {
      throw new Error("SPA route listener requires a window and callback");
    }
    ensureSpaRouteChangePatched(view);
    view.addEventListener(ROUTE_CHANGE_EVENT, listener);
    view.addEventListener("popstate", listener);
    view.addEventListener("hashchange", listener);
    return () => {
      view.removeEventListener(ROUTE_CHANGE_EVENT, listener);
      view.removeEventListener("popstate", listener);
      view.removeEventListener("hashchange", listener);
    };
  }

  // src/binance-strategy27-events/index.user.js
  (function() {
    "use strict";
    const DEFAULT_GATEWAY_ORIGIN = "http://127.0.0.1:18765";
    const GATEWAY_ORIGIN_KEY = "strategy27GatewayOrigin";
    const GATEWAY_SECRET_KEY = "strategy27GatewayAuthSecret";
    const CONTEXT_CHECK_INTERVAL_MS = 1e3;
    const MAX_RETAINED_EVENTS = 80;
    const MAX_EVENT_AGE_MS = 2 * 60 * 60 * 1e3;
    const page = unsafeWindow;
    const pageDocument = page.document;
    const request = createGmJsonRequest(GM_xmlhttpRequest);
    let active = null;
    let statusView = null;
    function stopActive(resetReason) {
      if (!active) return;
      active.controller.abort();
      active.lifecycle.reset(resetReason);
      active.layer.clear();
      active = null;
    }
    function showStatus(chartRoot, text, state = "normal") {
      statusView = ensureStrategy27StatusView(pageDocument, chartRoot);
      setStrategy27Status(statusView, text, state);
    }
    async function renderGatewayResponse(context, response) {
      if (active !== context) return;
      for (const eventId of context.lifecycle.prune(Date.now())) context.layer.remove(eventId);
      if (response.status === "reset") {
        context.lifecycle.reset(response.reason);
        context.layer.clear();
        showStatus(context.target.chartRoot, "Strategy 27 已连接，等待新事件");
        return;
      }
      for (const message of response.messages) {
        const action = context.lifecycle.apply(message);
        for (const eventId of action.evictedEventIds ?? []) context.layer.remove(eventId);
        if (action.type === "stream_reset") {
          context.layer.clear();
          showStatus(context.target.chartRoot, "Strategy 27 数据流已恢复，等待新事件");
          continue;
        }
        if (action.type === "event_evicted") continue;
        const annotation = buildEventAnnotation({
          event: action.event,
          outcomes: action.outcomes,
          rehydrated: action.rehydrated,
          eventTimeMs: action.eventTimeMs,
          messageKind: action.messageKind
        });
        const renderMethod = {
          event_opened: "renderOpened",
          event_updated: "renderUpdated",
          event_closed: "renderClosed",
          event_outcome: "renderOutcome"
        }[action.messageKind];
        await context.layer[renderMethod](action.eventId, annotation, action.observedAtMs);
        showStatus(context.target.chartRoot, annotation.liveStatus);
      }
    }
    function startContext({ routeSymbol, canonicalSymbol, target, gatewayOrigin, authSecret }) {
      const context = {
        signature: `${routeSymbol}|${target.resolution}`,
        routeSymbol,
        canonicalSymbol,
        target,
        controller: new AbortController(),
        lifecycle: new LiveEventLifecycle(canonicalSymbol, {
          maxEvents: MAX_RETAINED_EVENTS,
          maxAgeMs: MAX_EVENT_AGE_MS
        }),
        layer: createTradingViewEventLayer(target, {
          maxEvents: MAX_RETAINED_EVENTS,
          maxAgeMs: MAX_EVENT_AGE_MS
        }),
        failed: false
      };
      active = context;
      showStatus(target.chartRoot, "Strategy 27 正在连接");
      const client = createLiveEventClient({
        request,
        gatewayBaseUrl: gatewayOrigin,
        authSecret,
        canonicalSymbol,
        onResponse: (response) => renderGatewayResponse(context, response)
      });
      client.run(context.controller.signal).catch((error) => {
        if (error.name === "AbortError" || active !== context) return;
        context.failed = true;
        context.layer.clear();
        showStatus(target.chartRoot, `Strategy 27 已停止：${error.message}`, "error");
      });
    }
    function synchronizeContext() {
      const routeSymbol = parseFuturesTradingSymbolFromPathname(page.location.pathname);
      if (!routeSymbol) {
        stopActive("route_changed");
        removeStrategy27StatusView(pageDocument);
        statusView = null;
        return;
      }
      const chartRoot = findStrategy27ChartRoot(pageDocument);
      if (!chartRoot) return;
      let canonicalSymbol;
      try {
        canonicalSymbol = routeSymbolToCanonical(routeSymbol);
        if (canonicalSymbolToRoute(canonicalSymbol) !== routeSymbol) {
          throw new Error("Binance route symbol does not round-trip");
        }
      } catch (error) {
        stopActive("route_changed");
        showStatus(chartRoot, `Strategy 27 已停止：${error.message}`, "error");
        return;
      }
      let target;
      try {
        target = findStrategy27ChartTarget(pageDocument, routeSymbol);
      } catch (error) {
        stopActive("interval_changed");
        const inactive = error.message.includes("one-second chart");
        showStatus(
          chartRoot,
          inactive ? "Strategy 27 仅在 1 秒图表启用" : `Strategy 27 已停止：${error.message}`,
          inactive ? "inactive" : "error"
        );
        return;
      }
      if (!target) {
        stopActive("interval_changed");
        showStatus(chartRoot, "Strategy 27 正在等待图表接口", "inactive");
        return;
      }
      if (active && active.routeSymbol === routeSymbol && active.target.chart === target.chart && active.target.chartRoot === target.chartRoot) {
        return;
      }
      stopActive("route_changed");
      const authSecret = GM_getValue(GATEWAY_SECRET_KEY, "");
      if (typeof authSecret !== "string" || authSecret.length === 0) {
        showStatus(chartRoot, "Strategy 27 未配置网关密钥（请使用油猴菜单设置）", "inactive");
        return;
      }
      let gatewayOrigin;
      try {
        gatewayOrigin = normalizeGatewayBaseUrl(GM_getValue(GATEWAY_ORIGIN_KEY, DEFAULT_GATEWAY_ORIGIN));
      } catch (error) {
        showStatus(chartRoot, `Strategy 27 已停止：${error.message}`, "error");
        return;
      }
      startContext({ routeSymbol, canonicalSymbol, target, gatewayOrigin, authSecret });
    }
    function restart() {
      stopActive("route_changed");
      synchronizeContext();
    }
    GM_registerMenuCommand("设置 Strategy 27 网关密钥", () => {
      const value = page.prompt("输入本机 Strategy 27 网关密钥。该值只保存在此油猴脚本的私有存储中。");
      if (value === null) return;
      if (value.length === 0) throw new Error("Strategy 27 网关密钥不能为空");
      GM_setValue(GATEWAY_SECRET_KEY, value);
      restart();
    });
    GM_registerMenuCommand("设置 Strategy 27 本机网关地址", () => {
      const current = GM_getValue(GATEWAY_ORIGIN_KEY, DEFAULT_GATEWAY_ORIGIN);
      const value = page.prompt("输入 SSH 本地转发地址（仅允许 http://127.0.0.1:<端口>）", current);
      if (value === null) return;
      GM_setValue(GATEWAY_ORIGIN_KEY, normalizeGatewayBaseUrl(value));
      restart();
    });
    GM_registerMenuCommand("清除 Strategy 27 图表标注", () => {
      active?.layer.clear();
      if (statusView) setStrategy27Status(statusView, "Strategy 27 标注已清除，继续监听");
    });
    const removeRouteListener = installSpaRouteChangeListener(page, restart);
    const contextTimer = page.setInterval(synchronizeContext, CONTEXT_CHECK_INTERVAL_MS);
    page.addEventListener("beforeunload", () => {
      page.clearInterval(contextTimer);
      removeRouteListener();
      stopActive("route_changed");
    }, { once: true });
    synchronizeContext();
  })();
})();
