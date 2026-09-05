// ==UserScript==
// @name         【自写】Binance Strategy 27 事件标注
// @namespace    binance.strategy27.events
// @icon         data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%23f0b90b%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2249%22%20text-anchor%3D%22middle%22%20font-family%3D%22Arial%2C%20sans-serif%22%20font-size%3D%2242%22%20font-weight%3D%22800%22%20fill%3D%22%23111827%22%3EJ%3C%2Ftext%3E%3C%2Fsvg%3E
// @icon64       data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%23f0b90b%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2249%22%20text-anchor%3D%22middle%22%20font-family%3D%22Arial%2C%20sans-serif%22%20font-size%3D%2242%22%20font-weight%3D%22800%22%20fill%3D%22%23111827%22%3EJ%3C%2Ftext%3E%3C%2Fsvg%3E
// @version      0.4.2
// @author       jackhai9
// @description  在 Binance 一秒图表标注 VPS Strategy 27 的实时订单流候选观察
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
  var __typeError = (msg) => {
    throw TypeError(msg);
  };
  var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
  var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
  var __privateAdd = (obj, member, value) => member.has(obj) ? __typeError("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
  var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);
  var __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method);

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
  var CANDIDATE_OBSERVATIONS = /* @__PURE__ */ new Set([
    "bearish_buy_impact_failure",
    "bullish_sell_impact_failure",
    "bearish_passive_book_shift",
    "bullish_passive_book_shift"
  ]);
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
  function assertExactKeys(value, keys2, label) {
    assertCondition(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
    const actual = Object.keys(value).sort();
    const expected = [...keys2].sort();
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
      "source_bucket_count",
      "bucket_trigger_reasons",
      "candidate_observations",
      "aggressive_buy",
      "aggressive_sell",
      "bid",
      "ask",
      "price_response"
    ], label);
    assertInteger(value.bucket_start_ms, `${label}.bucket_start_ms`);
    assertInteger(value.bucket_end_ms, `${label}.bucket_end_ms`);
    assertInteger(value.source_bucket_count, `${label}.source_bucket_count`, { minimum: 1 });
    assertCondition(value.bucket_end_ms > value.bucket_start_ms, `${label} bucket end must follow start`);
    assertSortedUniqueStrings(value.bucket_trigger_reasons, `${label}.bucket_trigger_reasons`);
    assertSortedUniqueStrings(value.candidate_observations, `${label}.candidate_observations`);
    assertCondition(
      value.candidate_observations.every((item) => CANDIDATE_OBSERVATIONS.has(item)),
      `${label}.candidate_observations contains an unsupported value`
    );
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
    assertCondition(
      value.trigger_snapshot.source_bucket_count === 1 && value.trigger_snapshot.candidate_observations.length === 0,
      "trigger snapshot must remain one uncategorized research bucket"
    );
    const latestDurationMs = value.latest_snapshot.bucket_end_ms - value.latest_snapshot.bucket_start_ms;
    const triggerDurationMs = value.trigger_snapshot.bucket_end_ms - value.trigger_snapshot.bucket_start_ms;
    assertCondition(
      1e3 % triggerDurationMs === 0,
      "trigger bucket duration must divide one second"
    );
    assertCondition(
      latestDurationMs <= 1e3,
      "latest snapshot duration must not exceed one second"
    );
    assertCondition(
      latestDurationMs === triggerDurationMs * value.latest_snapshot.source_bucket_count,
      "latest snapshot source bucket count must match duration"
    );
    assertCondition(
      (value.latest_snapshot.bucket_start_ms - value.trigger_snapshot.bucket_start_ms) % triggerDurationMs === 0,
      "latest snapshot must align to trigger bucket grid"
    );
    assertCondition(
      value.latest_snapshot.bucket_end_ms >= value.trigger_snapshot.bucket_end_ms,
      "latest snapshot must not precede trigger bucket"
    );
    assertCondition(
      value.latest_snapshot.candidate_observations.length === 0 || latestDurationMs === 1e3,
      "latest snapshot candidates require one complete second"
    );
    assertCondition(value.trigger_snapshot.bucket_start_ms === value.triggered_at_ms, "trigger snapshot must start at triggered_at_ms");
    if (value.event_status === "active") {
      assertCondition(value.active_end_at_ms === null && value.close_reason === null, "active event close fields must be null");
    } else {
      assertInteger(value.active_end_at_ms, "payload.event.active_end_at_ms");
      assertCondition(value.active_end_at_ms >= value.triggered_at_ms, "event active end must not precede trigger");
      assertCondition(
        value.latest_snapshot.bucket_end_ms <= value.active_end_at_ms,
        "latest snapshot must not follow active end"
      );
      assertCondition([
        "quiet_period",
        "maximum_duration",
        "input_gap",
        "universe_removed",
        "monitor_stopped"
      ].includes(value.close_reason), "closed event close_reason is invalid");
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
    assertCondition(value.schema_version === 2, "Live envelope schema_version must be 2");
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
      assertCondition(
        JSON.stringify(value.payload.event.latest_snapshot) === JSON.stringify(value.payload.event.trigger_snapshot),
        "event_opened latest snapshot must equal trigger snapshot"
      );
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
  function validateGatewayBootstrapResponse(value, httpStatus) {
    if (value?.status === "error") {
      assertExactKeys(value, ["schema_version", "status", "error_code"], "gateway bootstrap error response");
      assertCondition(value.schema_version === 1, "Gateway bootstrap schema_version must be 1");
      const expected = { 401: "unauthorized", 503: ["bootstrap_unavailable", "redis_unavailable"] }[httpStatus];
      assertCondition(Array.isArray(expected) ? expected.includes(value.error_code) : value.error_code === expected, "Gateway bootstrap error response is invalid");
      return value;
    }
    assertCondition(httpStatus === 200, "Gateway bootstrap success must use HTTP 200");
    assertExactKeys(value, [
      "schema_version",
      "status",
      "projection_kind",
      "requested_cursor",
      "next_cursor",
      "runtime_epoch",
      "last_sequence",
      "bootstrap_observed_at_ms",
      "records"
    ], "gateway bootstrap response");
    assertCondition(value.schema_version === 1 && value.status === "bootstrap", "Gateway bootstrap status is invalid");
    assertCondition(value.projection_kind === "strategy27_events", "Gateway bootstrap projection kind is invalid");
    assertCondition(value.requested_cursor === null, "Gateway bootstrap requested_cursor must be null");
    assertCondition(typeof value.next_cursor === "string" && STREAM_ID_PATTERN.test(value.next_cursor), "Gateway bootstrap next cursor is invalid");
    assertCondition(typeof value.runtime_epoch === "string" && EPOCH_PATTERN.test(value.runtime_epoch), "Gateway bootstrap epoch is invalid");
    assertInteger(value.last_sequence, "Gateway bootstrap last_sequence", { minimum: 1 });
    assertInteger(value.bootstrap_observed_at_ms, "Gateway bootstrap observed time");
    assertCondition(Array.isArray(value.records) && value.records.length <= 80, "Gateway bootstrap record bound is invalid");
    for (const record of value.records) {
      assertExactKeys(record, ["event_id", "event_envelope", "marker_envelope", "outcome_envelope"], "gateway bootstrap event record");
      assertCondition(typeof record.event_id === "string" && EVENT_ID_PATTERN.test(record.event_id), "Gateway bootstrap event ID is invalid");
      assertCondition(record.event_envelope !== null, "Gateway bootstrap event envelope is required");
      const envelopes = [record.event_envelope, record.marker_envelope, record.outcome_envelope].filter((item) => item !== null);
      for (const envelope of envelopes) {
        validateLiveEnvelope(envelope);
        assertCondition(envelope.runtime_epoch === value.runtime_epoch, "Gateway bootstrap event epoch is inconsistent");
        assertCondition(envelope.event_id === record.event_id, "Gateway bootstrap event identity is inconsistent");
        assertCondition(envelope.sequence <= value.last_sequence, "Gateway bootstrap event sequence exceeds tail");
      }
      assertCondition(
        record.event_envelope.message_kind !== "event_outcome" || record.outcome_envelope !== null && JSON.stringify(record.event_envelope) === JSON.stringify(record.outcome_envelope),
        "Gateway bootstrap event envelope is invalid"
      );
      if (record.marker_envelope !== null) {
        assertCondition(record.marker_envelope.message_kind !== "event_outcome", "Gateway bootstrap marker envelope is invalid");
        assertCondition(record.marker_envelope.payload.event.latest_snapshot.candidate_observations.length > 0, "Gateway bootstrap marker evidence is missing");
      }
      if (record.outcome_envelope !== null) {
        assertCondition(record.outcome_envelope.message_kind === "event_outcome", "Gateway bootstrap outcome envelope is invalid");
      }
    }
    return value;
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
      this.bootstrapActive = false;
    }
    beginBootstrap({ runtimeEpoch, observedAtMs }) {
      assertCondition(typeof runtimeEpoch === "string" && EPOCH_PATTERN.test(runtimeEpoch), "Bootstrap runtime epoch is invalid");
      assertInteger(observedAtMs, "Bootstrap observed time");
      this.reset("initial_cursor");
      this.runtimeEpoch = runtimeEpoch;
      this.lastSequence = 0;
      this.epochEnvelopeAccepted = true;
      this.rehydrationCutoffMs = observedAtMs;
      this.bootstrapActive = true;
    }
    finishBootstrap(lastSequence) {
      assertInteger(lastSequence, "Bootstrap last sequence", { minimum: 1 });
      assertCondition(this.runtimeEpoch !== null && this.lastSequence !== null, "Bootstrap was not started");
      assertCondition(lastSequence >= this.lastSequence, "Bootstrap tail sequence precedes restored records");
      this.lastSequence = lastSequence;
      this.bootstrapActive = false;
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
        if (envelope.message_kind === "event_closed" || this.bootstrapActive && envelope.message_kind === "event_outcome") {
          existing.phase = "closed";
        }
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
  var DEFAULT_RECONNECT_DELAY_MS = 2e3;
  var Strategy27GatewayTransportError = class extends Error {
    constructor(message) {
      super(message);
      this.name = "Strategy27GatewayTransportError";
    }
  };
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
        onerror: () => rejectOnce(new Strategy27GatewayTransportError("Strategy 27 gateway request failed")),
        ontimeout: () => rejectOnce(new Strategy27GatewayTransportError("Strategy 27 gateway request timed out")),
        onabort: () => rejectOnce(abortError())
      });
      function abort() {
        handle.abort();
      }
      signal.addEventListener("abort", abort, { once: true });
    });
  }
  function waitForReconnect(delayMs, signal) {
    if (signal.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(finish, delayMs);
      function finish() {
        signal.removeEventListener("abort", abort);
        resolve();
      }
      function abort() {
        clearTimeout(timeoutId);
        reject(abortError());
      }
      signal.addEventListener("abort", abort, { once: true });
    });
  }
  function parseResponseJson(response, bootstrap) {
    if (!Number.isInteger(response?.status) || typeof response.responseText !== "string") {
      throw new Error("Strategy 27 gateway returned an invalid GM response");
    }
    let payload;
    try {
      payload = JSON.parse(response.responseText);
    } catch {
      throw new Error("Strategy 27 gateway returned invalid JSON");
    }
    return bootstrap ? validateGatewayBootstrapResponse(payload, response.status) : validateGatewayResponse(payload, response.status);
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
    onResponse,
    onConnectionStateChange,
    reconnectDelayMs = DEFAULT_RECONNECT_DELAY_MS
  }) {
    if (typeof request !== "function") throw new Error("Strategy 27 request function is required");
    if (typeof authSecret !== "string" || authSecret.length === 0) throw new Error("Strategy 27 gateway secret is not configured");
    if (typeof canonicalSymbol !== "string" || canonicalSymbol.length === 0) throw new Error("Strategy 27 canonical symbol is required");
    if (typeof onResponse !== "function") throw new Error("Strategy 27 response listener is required");
    if (typeof onConnectionStateChange !== "function") throw new Error("Strategy 27 connection state listener is required");
    if (!Number.isInteger(reconnectDelayMs) || reconnectDelayMs < 0) throw new Error("Strategy 27 reconnect delay is invalid");
    const origin = normalizeGatewayBaseUrl(gatewayBaseUrl);
    let cursor = null;
    let needsBootstrap = true;
    let reconnecting = false;
    return Object.freeze({
      async run(signal) {
        while (!signal.aborted) {
          const url = new URL(needsBootstrap ? "/v1/strategy27/events/bootstrap" : "/v1/strategy27/events", origin);
          url.searchParams.set("symbol", canonicalSymbol);
          if (!needsBootstrap) url.searchParams.set("cursor", cursor);
          let response;
          try {
            response = await request({
              url: url.href,
              authSecret,
              signal
            });
          } catch (error) {
            if (!(error instanceof Strategy27GatewayTransportError)) throw error;
            if (!reconnecting) {
              reconnecting = true;
              onConnectionStateChange("reconnecting");
            }
            await waitForReconnect(reconnectDelayMs, signal);
            continue;
          }
          const payload = parseResponseJson(response, needsBootstrap);
          if (!needsBootstrap) assertCursorContract(payload, cursor);
          if (payload.status === "error") {
            if (needsBootstrap && response.status === 503) {
              if (!reconnecting) {
                reconnecting = true;
                onConnectionStateChange("reconnecting");
              }
              await waitForReconnect(reconnectDelayMs, signal);
              continue;
            }
            throw new Error(`Strategy 27 gateway error: ${payload.error_code}`);
          }
          if (reconnecting) {
            reconnecting = false;
            onConnectionStateChange("connected");
          }
          await onResponse(payload);
          if (!needsBootstrap && payload.status === "reset") {
            cursor = null;
            needsBootstrap = true;
          } else {
            cursor = payload.next_cursor;
            needsBootstrap = false;
          }
        }
      }
    });
  }

  // src/binance-strategy27-events/core/event-annotation.js
  var CANDIDATE_PRESENTATIONS = Object.freeze({
    bearish_buy_impact_failure: Object.freeze({
      label: "买入推动失效 · 承接转弱",
      markerShape: "arrow_down",
      markerColor: "#F6465D"
    }),
    bearish_passive_book_shift: Object.freeze({
      label: "主动成交弱 · 承接转弱",
      markerShape: "arrow_down",
      markerColor: "#F6465D"
    }),
    bullish_sell_impact_failure: Object.freeze({
      label: "卖出推动失效 · 抛压转弱",
      markerShape: "arrow_up",
      markerColor: "#0ECB81"
    }),
    bullish_passive_book_shift: Object.freeze({
      label: "主动成交弱 · 抛压转弱",
      markerShape: "arrow_up",
      markerColor: "#0ECB81"
    })
  });
  var TRIGGER_LABELS = Object.freeze({
    aggressive_buy_to_ask_depth: "主动买",
    aggressive_sell_to_bid_depth: "主动卖",
    bid_addition_to_bid_depth: "bid 增",
    bid_decrease_to_bid_depth: "bid 减",
    ask_addition_to_ask_depth: "ask 增",
    ask_decrease_to_ask_depth: "ask 减",
    bid_best_price_migration_bps: "bid 迁移",
    ask_best_price_migration_bps: "ask 迁移",
    mid_return_bps: "价格响应",
    spread_change_bps: "点差变化"
  });
  var CLOSE_REASON_LABELS = Object.freeze({
    quiet_period: "安静期结束",
    maximum_duration: "达到最长持续时间",
    input_gap: "输入缺口",
    universe_removed: "移出监控范围",
    monitor_stopped: "监控停止"
  });
  function finiteNumber(value, label) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) throw new Error(`Invalid Strategy 27 display number: ${label}`);
    return numeric;
  }
  function trimmedFixed(numeric, digits) {
    return numeric.toFixed(digits).replace(/(\.\d*?[1-9])0+$|\.0+$/u, "$1");
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
      label
    });
  }
  function formatRatio(value, label) {
    return compactDecimal(value, { digits: 2, label });
  }
  function formatNotional(value, label) {
    const numeric = finiteNumber(value, label);
    const absolute = Math.abs(numeric);
    if (absolute > 0 && absolute < 0.1) return numeric.toLocaleString("en-US", { maximumSignificantDigits: 2, useGrouping: false });
    if (absolute >= 1e6) return `${compactDecimal(numeric / 1e6, { digits: 2, label })}M`;
    if (absolute >= 1e3) return `${compactDecimal(numeric / 1e3, { digits: 1, label })}K`;
    return compactDecimal(numeric, { digits: 1, label });
  }
  function formatForce(label, oppositeSide, force) {
    const notional = finiteNumber(force.notional, `${label}.notional`);
    if (notional === 0 && force.trade_count === 0) {
      return Object.freeze({ label, value: "无主动成交", detail: "" });
    }
    return Object.freeze({
      label,
      value: `${formatNotional(force.notional, `${label}.notional`)} USDT · ${force.trade_count} 笔`,
      detail: `吃 ${oppositeSide} 深度 ${formatRatio(force.to_opposite_depth, `${label}.to_opposite_depth`)}`
    });
  }
  function formatBook(label, side) {
    return Object.freeze({
      label,
      value: `增 ${formatNotional(side.observed_addition_notional, `${label}.addition`)} · 减 ${formatNotional(side.observed_decrease_notional, `${label}.decrease`)}`,
      detail: `迁移 ${formatBps(side.best_price_migration_bps, `${label}.migration`)} bps`
    });
  }
  function formatTriggerReasons(reasons) {
    return reasons.map((reason) => {
      const label = TRIGGER_LABELS[reason];
      if (!label) throw new Error(`Unknown Strategy 27 trigger reason: ${reason}`);
      return label;
    }).join("、");
  }
  function formatCloseReason(reason) {
    if (reason === null) return null;
    const label = CLOSE_REASON_LABELS[reason];
    if (!label) throw new Error(`Unknown Strategy 27 close reason: ${reason}`);
    return label;
  }
  function candidatePresentation(observations) {
    if (!observations.length) return null;
    const presentations = observations.map((observation) => {
      const presentation = CANDIDATE_PRESENTATIONS[observation];
      if (!presentation) throw new Error(`Unknown Strategy 27 candidate observation: ${observation}`);
      return presentation;
    });
    const markerShape = presentations[0].markerShape;
    if (presentations.some((presentation) => presentation.markerShape !== markerShape)) {
      throw new Error("Strategy 27 candidate observations contain conflicting directions");
    }
    return Object.freeze({
      label: presentations.map((presentation) => presentation.label).join("、"),
      markerShape,
      markerColor: presentations[0].markerColor
    });
  }
  function formatWindowDuration(snapshot) {
    const durationMs = snapshot.bucket_end_ms - snapshot.bucket_start_ms;
    if (durationMs % 1e3 === 0) return `${durationMs / 1e3} 秒`;
    return `${trimmedFixed(durationMs / 1e3, 2)} 秒`;
  }
  function buildEventAnnotation({
    event,
    rehydrated
  }) {
    const snapshot = event.latest_snapshot;
    const response = snapshot.price_response;
    const candidate = candidatePresentation(snapshot.candidate_observations);
    const incomplete = event.event_status === "incomplete";
    const notices = [];
    if (rehydrated) notices.push("此前投影历史不可用");
    if (incomplete) notices.push("数据不完整，不作方向结论");
    const title = event.event_kind === "orderflow_event" ? "订单流观察" : "价格响应观察";
    const summary = `价格 ${formatBps(response.mid_return_bps, "price_response.mid_return_bps")} bps · 点差 ${formatBps(response.spread_bps, "price_response.spread_bps", { signed: false })} bps`;
    return Object.freeze({
      title,
      eventTimeMs: snapshot.bucket_end_ms - 1,
      status: event.event_status,
      windowText: `统计 ${formatWindowDuration(snapshot)} · ${snapshot.source_bucket_count} 桶`,
      candidateText: candidate?.label ?? null,
      summary,
      forceRows: Object.freeze([
        formatForce("主动买", "ask", snapshot.aggressive_buy),
        formatForce("主动卖", "bid", snapshot.aggressive_sell),
        formatBook("bid", snapshot.bid),
        formatBook("ask", snapshot.ask)
      ]),
      priceDetail: `点差变化 ${formatBps(response.spread_change_bps, "price_response.spread_change_bps")} bps`,
      triggerText: formatTriggerReasons(event.trigger_reasons),
      closeText: formatCloseReason(event.close_reason),
      notices: Object.freeze(notices),
      markerShape: candidate?.markerShape ?? null,
      markerColor: candidate?.markerColor ?? null,
      markerTime: eventTimeToChartSecond(snapshot.bucket_end_ms - 1),
      markerPrice: finiteNumber(response.mid, "price_response.mid"),
      liveStatus: `Strategy 27 ${candidate?.label ?? title}｜${summary}`
    });
  }
  function stabilizeCandidatePresentation(presentations, eventId, annotation) {
    const existing = presentations.get(eventId);
    if (existing) return Object.freeze({ ...annotation, ...existing });
    if (!annotation.markerShape) return annotation;
    const presentation = Object.freeze({
      candidateText: annotation.candidateText,
      markerShape: annotation.markerShape,
      markerColor: annotation.markerColor,
      markerTime: annotation.markerTime,
      markerPrice: annotation.markerPrice
    });
    presentations.set(eventId, presentation);
    return annotation;
  }

  // src/binance-strategy27-events/dom/tradingview-event-layer.js
  var CHART_ROOT_SELECTOR = ".chart-widget-root";
  var STATUS_ID = "jh-strategy27-event-status";
  var DIRECTIONAL_MARKER_GAP_PX = 8;
  var DEFAULT_CANDLE_WAIT_MS = 3e3;
  var EXACT_TIME_MATCH_MODE = 0;
  var PREVIOUS_OR_EXACT_TIME_MATCH_MODE = 1;
  function hasVisibleBox(element) {
    if (!element?.getClientRects().length) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  function routeSymbolFromChartSymbol(value) {
    return String(value || "").split("@", 1)[0];
  }
  function assertChartContract(chart) {
    for (const method of ["createShape", "getAllShapes", "getShapeById", "removeEntity", "resolution", "symbol"]) {
      if (typeof chart?.[method] !== "function") throw new Error(`TradingView chart method is unavailable: ${method}`);
    }
  }
  function readLiveShapeIds(chart) {
    const shapes = chart.getAllShapes();
    if (!Array.isArray(shapes)) throw new Error("Strategy 27 chart shape list is invalid");
    return new Set(shapes.map((shape) => {
      if (typeof shape?.id !== "string" || shape.id.length === 0) throw new Error("Strategy 27 chart shape id is invalid");
      return shape.id;
    }));
  }
  function pinMarkerChartContext(chart) {
    const symbol = chart.symbol();
    const resolution = chart.resolution();
    return () => chart.symbol() === symbol && chart.resolution() === resolution;
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
  function shapeOptions(shape, color) {
    return {
      shape,
      lock: true,
      disableSave: true,
      disableSelection: true,
      disableUndo: true,
      showInObjectsTree: false,
      overrides: {
        color,
        fixedSize: true
      }
    };
  }
  function createMarkerPointResolver(chart) {
    const model = chart._chartWidget?.model?.()?.model?.();
    const timeScale = model?.timeScale?.();
    const seriesData = chart.getSeries?.()?.data?.();
    const mainSeries = model?.mainSeries?.();
    const priceScale = mainSeries?.priceScale?.();
    const dataUpdated = mainSeries?.dataUpdated?.();
    const requiredMethods = [
      [timeScale, "timePointToIndex"],
      [seriesData, "valueAt"],
      [mainSeries, "firstValue"],
      [priceScale, "priceToCoordinate"],
      [priceScale, "coordinateToPrice"],
      [dataUpdated, "subscribe"],
      [dataUpdated, "unsubscribe"]
    ];
    for (const [owner, method] of requiredMethods) {
      if (typeof owner?.[method] !== "function") {
        throw new Error(`TradingView marker placement method is unavailable: ${method}`);
      }
    }
    const resolve = (annotation, { allowPreviousCandle = false, gapPx = DIRECTIONAL_MARKER_GAP_PX } = {}) => {
      if (!Number.isFinite(gapPx)) throw new Error("Strategy 27 marker pixel gap is invalid");
      if (!["arrow_up", "arrow_down"].includes(annotation.markerShape)) {
        throw new Error(`Unsupported Strategy 27 marker shape: ${annotation.markerShape}`);
      }
      const matchMode = allowPreviousCandle ? PREVIOUS_OR_EXACT_TIME_MATCH_MODE : EXACT_TIME_MATCH_MODE;
      const barIndex = timeScale.timePointToIndex(annotation.markerTime, matchMode);
      if (!Number.isFinite(barIndex)) return null;
      const candle = seriesData.valueAt(barIndex);
      if (candle === null) return null;
      const candleTime = Array.isArray(candle) ? candle[0] : null;
      const timeMatches = allowPreviousCandle ? Number.isInteger(candleTime) && candleTime <= annotation.markerTime : candleTime === annotation.markerTime;
      if (!Array.isArray(candle) || candle.length < 5 || !timeMatches) {
        throw new Error(`Strategy 27 candle is invalid for ${annotation.markerTime}`);
      }
      const candleHigh = Number(candle[2]);
      const candleLow = Number(candle[3]);
      if (!Number.isFinite(candleHigh) || !Number.isFinite(candleLow)) {
        throw new Error(`Strategy 27 candle prices are invalid for ${annotation.markerTime}`);
      }
      const firstValue = mainSeries.firstValue();
      const candleEdge = annotation.markerShape === "arrow_up" ? candleLow : candleHigh;
      const edgeCoordinate = priceScale.priceToCoordinate(candleEdge, firstValue);
      if (!Number.isFinite(edgeCoordinate)) {
        throw new Error(`Strategy 27 candle coordinate is unavailable for ${annotation.markerTime}`);
      }
      const direction = annotation.markerShape === "arrow_up" ? 1 : -1;
      const markerPrice = priceScale.coordinateToPrice(
        edgeCoordinate + direction * gapPx,
        firstValue
      );
      if (!Number.isFinite(markerPrice)) {
        throw new Error(`Strategy 27 marker price is unavailable for ${annotation.markerTime}`);
      }
      return { time: candleTime, price: markerPrice };
    };
    function shift(point, deltaPixels) {
      if (!Number.isFinite(deltaPixels)) throw new Error("Strategy 27 marker pixel shift is invalid");
      const firstValue = mainSeries.firstValue();
      const y = priceScale.priceToCoordinate(point.price, firstValue);
      const price = priceScale.coordinateToPrice(y + deltaPixels, firstValue);
      if (!Number.isFinite(y) || !Number.isFinite(price)) throw new Error("Strategy 27 shifted marker coordinate is invalid");
      return { time: point.time, price };
    }
    return { dataUpdated, resolve, shift };
  }
  function verifyResolvedTime(chart, id, requestedTime) {
    const shape = chart.getShapeById(id);
    const points = shape?.getPoints?.();
    if (!Array.isArray(points) || points.length !== 1 || points[0].time !== requestedTime) {
      const actualTime = Array.isArray(points) && points.length === 1 ? points[0]?.time : null;
      const pointCount = Array.isArray(points) ? points.length : null;
      throw new Error(
        `Strategy 27 chart time alignment failed: expected ${requestedTime}, received ${actualTime} (point count ${pointCount})`
      );
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
  function createTradingViewMarkerPlacement(chart, {
    candleWaitMs = DEFAULT_CANDLE_WAIT_MS
  } = {}) {
    if (!Number.isInteger(candleWaitMs) || candleWaitMs < 1) {
      throw new Error("Strategy 27 candleWaitMs is invalid");
    }
    const { dataUpdated, resolve: resolveMarkerPoint, shift } = createMarkerPointResolver(chart);
    function wait2(annotation, { signal, gapPx = DIRECTIONAL_MARKER_GAP_PX }) {
      if (signal.aborted) return Promise.resolve(null);
      const immediate = resolveMarkerPoint(annotation, { gapPx });
      if (immediate) return Promise.resolve(immediate);
      return new Promise((resolve, reject) => {
        const owner = {};
        let settled = false;
        let timeoutId;
        const cleanup = () => {
          clearTimeout(timeoutId);
          dataUpdated.unsubscribe(owner, onDataUpdated);
          signal.removeEventListener("abort", cancel);
        };
        const finish = (value) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(value);
        };
        const fail = (error) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        };
        const cancel = () => finish(null);
        const onDataUpdated = () => {
          if (signal.aborted) {
            cancel();
            return;
          }
          try {
            const point = resolveMarkerPoint(annotation, { gapPx });
            if (point) finish(point);
          } catch (error) {
            fail(error);
          }
        };
        timeoutId = setTimeout(() => {
          try {
            const previousPoint = resolveMarkerPoint(annotation, { allowPreviousCandle: true, gapPx });
            if (previousPoint) {
              finish(previousPoint);
              return;
            }
            fail(new Error(
              `Strategy 27 candle did not arrive within ${candleWaitMs} ms for ${annotation.markerTime}`
            ));
          } catch (error) {
            fail(error);
          }
        }, candleWaitMs);
        signal.addEventListener("abort", cancel, { once: true });
        dataUpdated.subscribe(owner, onDataUpdated);
        onDataUpdated();
      });
    }
    return Object.freeze({ wait: wait2, shift });
  }
  function createTradingViewEventLayer(target, {
    maxEvents,
    maxAgeMs,
    candleWaitMs = DEFAULT_CANDLE_WAIT_MS
  }) {
    if (!Number.isInteger(maxEvents) || maxEvents < 1) throw new Error("Strategy 27 maxEvents is invalid");
    if (!Number.isInteger(maxAgeMs) || maxAgeMs < 1) throw new Error("Strategy 27 maxAgeMs is invalid");
    const { chart } = target;
    const placement = createTradingViewMarkerPlacement(chart, { candleWaitMs });
    const isChartCurrent = pinMarkerChartContext(chart);
    const registry = /* @__PURE__ */ new Map();
    const pendingRenders = /* @__PURE__ */ new Map();
    let renderGeneration = 0;
    let reconciliation = null;
    function removeRecord(eventId) {
      pendingRenders.get(eventId)?.abort();
      const record = registry.get(eventId);
      if (!record) return;
      registry.delete(eventId);
      if (readLiveShapeIds(chart).has(record.markerId)) chart.removeEntity(record.markerId);
    }
    function pruneAge(observedAtMs) {
      for (const [eventId, record] of registry) {
        if (observedAtMs - record.observedAtMs > maxAgeMs) removeRecord(eventId);
      }
    }
    function ensureCapacityForNew() {
      while (registry.size >= maxEvents) removeRecord(registry.keys().next().value);
    }
    function restoreMarker(eventId, record, liveIds) {
      if (record.restoring) return record.restoring;
      const current = () => registry.get(eventId) === record && isChartCurrent();
      if (!current()) return Promise.resolve(false);
      if (liveIds.has(record.markerId)) return Promise.resolve(true);
      record.restoring = (async () => {
        const markerId = await createAlignedShape(chart, record.markerPoint, record.options);
        if (!current()) {
          if (readLiveShapeIds(chart).has(markerId)) chart.removeEntity(markerId);
          return false;
        }
        record.markerId = markerId;
        return true;
      })().finally(() => {
        record.restoring = null;
      });
      return record.restoring;
    }
    function reconcile() {
      if (reconciliation) return reconciliation;
      reconciliation = (async () => {
        let liveIds = readLiveShapeIds(chart);
        for (const [eventId, record] of [...registry]) {
          if (registry.get(eventId) !== record || !isChartCurrent()) continue;
          if (!record.restoring && liveIds.has(record.markerId)) continue;
          await restoreMarker(eventId, record, liveIds);
          liveIds = readLiveShapeIds(chart);
        }
      })().finally(() => {
        reconciliation = null;
      });
      return reconciliation;
    }
    async function ensureMarker(eventId, annotation, observedAtMs) {
      let record = registry.get(eventId);
      if (record) {
        record.observedAtMs = observedAtMs;
        return restoreMarker(eventId, record, readLiveShapeIds(chart));
      }
      if (annotation.markerShape === null) return true;
      const requestedGeneration = renderGeneration;
      const controller = new AbortController();
      pendingRenders.set(eventId, controller);
      try {
        const markerPoint = await placement.wait(annotation, { signal: controller.signal });
        if (!markerPoint || controller.signal.aborted || requestedGeneration !== renderGeneration || !isChartCurrent()) return false;
        pruneAge(observedAtMs);
        ensureCapacityForNew();
        const options = shapeOptions(annotation.markerShape, annotation.markerColor);
        const markerId = await createAlignedShape(chart, markerPoint, options);
        if (controller.signal.aborted || requestedGeneration !== renderGeneration || !isChartCurrent()) {
          if (readLiveShapeIds(chart).has(markerId)) chart.removeEntity(markerId);
          return false;
        }
        record = { markerId, markerPoint, options, observedAtMs, restoring: null };
        registry.set(eventId, record);
        return true;
      } finally {
        if (pendingRenders.get(eventId) === controller) pendingRenders.delete(eventId);
      }
    }
    return Object.freeze({
      renderOpened: (eventId, annotation, observedAtMs) => ensureMarker(eventId, annotation, observedAtMs),
      renderUpdated: (eventId, annotation, observedAtMs) => ensureMarker(eventId, annotation, observedAtMs),
      renderClosed: (eventId, annotation, observedAtMs) => ensureMarker(eventId, annotation, observedAtMs),
      renderOutcome: (eventId, annotation, observedAtMs) => ensureMarker(eventId, annotation, observedAtMs),
      remove: removeRecord,
      prune: pruneAge,
      reconcile,
      clear() {
        renderGeneration += 1;
        for (const controller of pendingRenders.values()) controller.abort();
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

  // src/binance-strategy27-events/dom/strategy27-event-panel.js
  var PANEL_ID = "jh-strategy27-event-panel";
  var PANEL_WIDTH = 320;
  var DEFAULT_RIGHT_OFFSET = 84;
  var DEFAULT_TOP_OFFSET = 68;
  var STATUS_LABELS = Object.freeze({
    active: "进行中",
    complete: "已结束",
    incomplete: "数据不完整"
  });
  function setStyles(element, styles) {
    Object.assign(element.style, styles);
    return element;
  }
  function createElement(document, tagName, { text = "", role = null, styles = null } = {}) {
    const element = document.createElement(tagName);
    element.textContent = text;
    if (role) element.dataset.role = role;
    if (styles) setStyles(element, styles);
    return element;
  }
  function formatClock(timestampMs) {
    const date = new Date(timestampMs);
    const part = (value) => String(value).padStart(2, "0");
    return `${part(date.getHours())}:${part(date.getMinutes())}:${part(date.getSeconds())}`;
  }
  function buttonStyles() {
    return {
      border: "0",
      borderRadius: "5px",
      padding: "2px 7px",
      background: "rgba(132, 142, 156, .18)",
      color: "#EAECEF",
      font: "11px/18px BinancePlex, ui-sans-serif, system-ui, sans-serif",
      cursor: "pointer"
    };
  }
  function panelWindow(document) {
    const view = document.defaultView;
    if (!view) throw new Error("Strategy 27 panel window is unavailable");
    return view;
  }
  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(value, maximum));
  }
  function assertPanelPosition(position) {
    if (position === null) return null;
    if (!position || typeof position !== "object" || !Number.isFinite(position.left) || !Number.isFinite(position.top)) {
      throw new Error("Strategy 27 panel position is invalid");
    }
    return position;
  }
  function normalizePanelPosition(document, panel, position) {
    const view = panelWindow(document);
    const width = panel.offsetWidth || PANEL_WIDTH;
    const height = panel.offsetHeight || 48;
    return {
      left: clamp(position.left, 0, Math.max(0, view.innerWidth - width)),
      top: clamp(position.top, 0, Math.max(0, view.innerHeight - height))
    };
  }
  function applyPanelPosition(panel, position) {
    panel.style.left = `${position.left}px`;
    panel.style.top = `${position.top}px`;
    panel.style.right = "auto";
  }
  function createDefaultPosition(chartRoot) {
    const chartRect = chartRoot.getBoundingClientRect();
    return {
      left: chartRect.right - DEFAULT_RIGHT_OFFSET - PANEL_WIDTH,
      top: chartRect.top + DEFAULT_TOP_OFFSET
    };
  }
  function setupPanelDrag(document, panel, header, savePosition) {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    const onMouseDown = (event) => {
      if (event.button !== 0) return;
      if (event.target.closest("button,a")) return;
      const rect = panel.getBoundingClientRect();
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      event.preventDefault();
    };
    const onMouseMove = (event) => {
      if (!dragging) return;
      const position = normalizePanelPosition(document, panel, {
        left: startLeft + event.clientX - startX,
        top: startTop + event.clientY - startY
      });
      applyPanelPosition(panel, position);
    };
    const onMouseUp = () => {
      if (!dragging) return;
      dragging = false;
      const rect = panel.getBoundingClientRect();
      const position = normalizePanelPosition(document, panel, { left: rect.left, top: rect.top });
      applyPanelPosition(panel, position);
      savePosition(position);
    };
    header.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      dragging = false;
      header.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }
  function appendDetailLine(document, parent, label, value, color = "#EAECEF") {
    const line = createElement(document, "div", {
      styles: {
        display: "grid",
        gridTemplateColumns: "62px minmax(0, 1fr)",
        gap: "8px",
        alignItems: "start"
      }
    });
    line.appendChild(createElement(document, "span", {
      text: label,
      styles: { color: "#848E9C", whiteSpace: "nowrap" }
    }));
    line.appendChild(createElement(document, "span", {
      text: value,
      styles: { color, overflowWrap: "anywhere" }
    }));
    parent.appendChild(line);
  }
  function createStrategy27EventPanel(document, chartRoot, {
    maxEvents,
    maxCompoundEvents,
    loadPosition,
    savePosition
  }) {
    if (!Number.isInteger(maxEvents) || maxEvents < 1) throw new Error("Strategy 27 panel maxEvents is invalid");
    if (!Number.isInteger(maxCompoundEvents) || maxCompoundEvents < 1 || maxCompoundEvents > 8) throw new Error("Strategy 27 panel maxCompoundEvents is invalid");
    if (typeof loadPosition !== "function") throw new Error("Strategy 27 panel loadPosition is invalid");
    if (typeof savePosition !== "function") throw new Error("Strategy 27 panel savePosition is invalid");
    document.getElementById(PANEL_ID)?.remove();
    const panel = createElement(document, "section", {
      styles: {
        position: "fixed",
        zIndex: "999996",
        left: "0",
        top: "0",
        width: `${PANEL_WIDTH}px`,
        maxWidth: "calc(100% - 112px)",
        maxHeight: "calc(100% - 92px)",
        border: "1px solid rgba(132, 142, 156, .28)",
        borderRadius: "8px",
        background: "rgba(24, 26, 32, .94)",
        boxShadow: "0 4px 16px rgba(0, 0, 0, .28)",
        color: "#EAECEF",
        font: "12px/17px BinancePlex, ui-sans-serif, system-ui, sans-serif",
        pointerEvents: "auto",
        userSelect: "none",
        overflow: "hidden"
      }
    });
    panel.id = PANEL_ID;
    const header = createElement(document, "header", {
      styles: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        padding: "8px 9px",
        borderBottom: "1px solid rgba(132, 142, 156, .18)",
        cursor: "move"
      }
    });
    header.title = "拖动面板";
    const dragHandle = createElement(document, "span", {
      text: "☰",
      styles: { color: "#848E9C", fontSize: "13px", cursor: "move" }
    });
    const heading = createElement(document, "strong", {
      text: "Strategy 27 事件",
      styles: { flex: "1", fontSize: "13px", cursor: "move" }
    });
    const latestButton = createElement(document, "button", {
      text: "最新",
      role: "follow-latest",
      styles: buttonStyles()
    });
    latestButton.type = "button";
    const collapseButton = createElement(document, "button", {
      text: "收起",
      role: "collapse",
      styles: buttonStyles()
    });
    collapseButton.type = "button";
    header.append(dragHandle, heading, latestButton, collapseButton);
    panel.appendChild(header);
    const body = createElement(document, "div", {
      role: "panel-body",
      styles: { overflow: "auto", maxHeight: "calc(100vh - 190px)" }
    });
    const detail = createElement(document, "div", {
      role: "event-detail",
      styles: { display: "grid", gap: "5px", padding: "9px" }
    });
    const recentTitle = createElement(document, "div", {
      text: "最近事件",
      styles: {
        padding: "7px 9px 4px",
        borderTop: "1px solid rgba(132, 142, 156, .18)",
        color: "#848E9C",
        fontWeight: "600"
      }
    });
    const recent = createElement(document, "div", {
      role: "event-list",
      styles: { display: "grid", gap: "2px", padding: "0 6px 7px" }
    });
    const compoundTitle = createElement(document, "strong", {
      text: "复合候选",
      styles: { display: "block", padding: "7px 9px 4px", borderTop: "1px solid rgba(132, 142, 156, .18)" }
    });
    const compoundStatus = createElement(document, "div", {
      text: "复合候选等待连接",
      role: "compound-status",
      styles: { padding: "0 9px 5px", color: "#848E9C", fontSize: "11px", overflowWrap: "anywhere" }
    });
    const compoundRecent = createElement(document, "div", {
      role: "compound-list",
      styles: { display: "grid", gap: "2px", padding: "0 6px 7px" }
    });
    body.append(detail, compoundTitle, compoundStatus, compoundRecent, recentTitle, recent);
    panel.appendChild(body);
    document.body.appendChild(panel);
    const initialPosition = assertPanelPosition(loadPosition()) ?? createDefaultPosition(chartRoot);
    applyPanelPosition(panel, normalizePanelPosition(document, panel, initialPosition));
    const cleanupDrag = setupPanelDrag(document, panel, header, savePosition);
    const records = /* @__PURE__ */ new Map();
    const compoundRecords = /* @__PURE__ */ new Map();
    let selectedEventId = null;
    let selectedKind = "ordinary";
    let followLatest = true;
    let collapsed = false;
    function orderedEntries(collection = records) {
      return [...collection.entries()].sort((left, right) => right[1].annotation.eventTimeMs - left[1].annotation.eventTimeMs || right[1].observedAtMs - left[1].observedAtMs);
    }
    function selectedCollection() {
      return selectedKind === "compound" ? compoundRecords : records;
    }
    function selectLatest() {
      const all = [
        ...orderedEntries().map(([id, record]) => ({ id, record, kind: "ordinary" })),
        ...orderedEntries(compoundRecords).map(([id, record]) => ({ id, record, kind: "compound" }))
      ].sort((a, b) => b.record.annotation.eventTimeMs - a.record.annotation.eventTimeMs || b.record.observedAtMs - a.record.observedAtMs);
      selectedEventId = all[0]?.id ?? null;
      selectedKind = all[0]?.kind ?? "ordinary";
    }
    function reconcileSelection() {
      if (!selectedCollection().has(selectedEventId)) followLatest = true;
      if (followLatest) selectLatest();
    }
    function renderDetail() {
      detail.replaceChildren();
      const record = selectedCollection().get(selectedEventId);
      if (!record) {
        detail.appendChild(createElement(document, "span", {
          text: "等待新事件",
          styles: { color: "#848E9C" }
        }));
        return;
      }
      const { annotation } = record;
      const title = createElement(document, "div", {
        styles: { display: "flex", alignItems: "center", gap: "6px" }
      });
      title.appendChild(createElement(document, "span", {
        text: annotation.title,
        styles: { color: selectedKind === "compound" ? annotation.titleColor : annotation.markerColor ?? "#EAECEF", fontWeight: "700", flex: "1" }
      }));
      title.appendChild(createElement(document, "span", {
        text: selectedKind === "compound" ? "探索版" : STATUS_LABELS[annotation.status],
        styles: { color: "#848E9C", fontSize: "11px" }
      }));
      detail.appendChild(title);
      appendDetailLine(document, detail, "时间", formatClock(annotation.eventTimeMs));
      if (selectedKind === "compound") {
        for (const row of annotation.detailRows) appendDetailLine(document, detail, row.label, row.value);
        const identity = createElement(document, "details", { role: "compound-identity", styles: { color: "#848E9C" } });
        identity.appendChild(createElement(document, "summary", { text: "规则与候选 ID", styles: { cursor: "pointer" } }));
        identity.appendChild(createElement(document, "div", {
          text: `规则 ${annotation.ruleIdentity}
候选 ${annotation.candidateId}`,
          styles: { whiteSpace: "pre-wrap", overflowWrap: "anywhere", userSelect: "text", fontSize: "10px" }
        }));
        detail.appendChild(identity);
        for (const notice of annotation.notices) appendDetailLine(document, detail, "说明", notice, "#848E9C");
        return;
      }
      appendDetailLine(document, detail, "统计", annotation.windowText);
      if (annotation.candidateText) {
        appendDetailLine(document, detail, "候选观察", annotation.candidateText, annotation.markerColor);
      }
      appendDetailLine(document, detail, "即时响应", annotation.summary, annotation.markerColor ?? "#EAECEF");
      for (const row of annotation.forceRows) {
        appendDetailLine(document, detail, row.label, row.detail ? `${row.value}｜${row.detail}` : row.value);
      }
      appendDetailLine(document, detail, "点差", annotation.priceDetail);
      appendDetailLine(document, detail, "触发", annotation.triggerText);
      if (annotation.closeText) appendDetailLine(document, detail, "结束", annotation.closeText);
      for (const notice of annotation.notices) appendDetailLine(document, detail, "说明", notice, "#F0B90B");
    }
    function renderRecent(container, collection, kind) {
      container.replaceChildren();
      for (const [eventId, record] of orderedEntries(collection)) {
        const { annotation } = record;
        const row = createElement(document, "button", {
          role: kind === "compound" ? "compound-row" : "event-row",
          styles: {
            display: "grid",
            gridTemplateColumns: "7px 54px minmax(0, 1fr)",
            gap: "6px",
            alignItems: "center",
            width: "100%",
            border: "0",
            borderRadius: "5px",
            padding: "5px 6px",
            background: kind === selectedKind && eventId === selectedEventId ? "rgba(132, 142, 156, .18)" : "transparent",
            color: "#EAECEF",
            font: "11px/16px BinancePlex, ui-sans-serif, system-ui, sans-serif",
            textAlign: "left",
            cursor: "pointer"
          }
        });
        row.type = "button";
        row.dataset.eventId = eventId;
        row.title = `${annotation.title}｜${annotation.summary}`;
        row.appendChild(createElement(document, "span", {
          styles: {
            width: "7px",
            height: "7px",
            borderRadius: "50%",
            background: annotation.markerColor ?? "transparent",
            outline: kind === "compound" ? "1px solid #EAECEF" : "none"
          }
        }));
        row.appendChild(createElement(document, "span", {
          text: formatClock(annotation.eventTimeMs),
          styles: { color: "#848E9C" }
        }));
        row.appendChild(createElement(document, "span", {
          text: annotation.summary,
          styles: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }
        }));
        row.addEventListener("click", () => {
          selectedEventId = eventId;
          selectedKind = kind;
          followLatest = false;
          render();
        });
        container.appendChild(row);
      }
    }
    function render() {
      latestButton.style.color = followLatest ? "#F0B90B" : "#EAECEF";
      renderDetail();
      renderRecent(recent, records, "ordinary");
      renderRecent(compoundRecent, compoundRecords, "compound");
    }
    latestButton.addEventListener("click", () => {
      followLatest = true;
      selectLatest();
      render();
    });
    collapseButton.addEventListener("click", () => {
      collapsed = !collapsed;
      body.style.display = collapsed ? "none" : "block";
      collapseButton.textContent = collapsed ? "展开" : "收起";
    });
    render();
    function upsertRecord(collection, capacity, eventId, annotation, observedAtMs) {
      collection.set(eventId, { annotation, observedAtMs });
      const ordered = orderedEntries(collection);
      while (ordered.length > capacity) collection.delete(ordered.pop()[0]);
      reconcileSelection();
      render();
    }
    function removeRecord(collection, eventId) {
      collection.delete(eventId);
      reconcileSelection();
      render();
    }
    return Object.freeze({
      upsert(eventId, annotation, observedAtMs) {
        upsertRecord(records, maxEvents, eventId, annotation, observedAtMs);
      },
      upsertCompound(eventId, annotation, observedAtMs) {
        upsertRecord(compoundRecords, maxCompoundEvents, eventId, annotation, observedAtMs);
      },
      remove(eventId) {
        removeRecord(records, eventId);
      },
      removeCompound(eventId) {
        removeRecord(compoundRecords, eventId);
      },
      clear() {
        records.clear();
        reconcileSelection();
        render();
      },
      clearCompound() {
        compoundRecords.clear();
        reconcileSelection();
        render();
      },
      setCompoundStatus(text, state) {
        if (typeof text !== "string" || !["normal", "inactive", "error"].includes(state)) throw new Error("Strategy 27 compound panel status is invalid");
        compoundStatus.textContent = text;
        compoundStatus.dataset.state = state;
        compoundStatus.style.color = state === "error" ? "#F6465D" : "#848E9C";
      },
      destroy() {
        records.clear();
        compoundRecords.clear();
        cleanupDrag();
        panel.remove();
      },
      get size() {
        return records.size;
      },
      get compoundSize() {
        return compoundRecords.size;
      }
    });
  }

  // src/binance-strategy27-events/core/compound-candidate-annotation.js
  var DIRECTIONS = Object.freeze({
    high: Object.freeze({ title: "复合候选高", label: "候选高", shape: "arrow_down", color: "#B71C3B" }),
    low: Object.freeze({ title: "复合候选低", label: "候选低", shape: "arrow_up", color: "#087F5B" })
  });
  var FAMILY_LABELS = Object.freeze({
    high: Object.freeze({ impact_failure: "买入推动失效", passive_support_loss: "被动承接转弱", failed_rebound: "反弹失败强化" }),
    low: Object.freeze({ impact_failure: "卖出推动失效", passive_support_loss: "被动抛压转弱", failed_rebound: "回落失败强化" })
  });
  function clock(ms) {
    const date = new Date(ms);
    return [date.getHours(), date.getMinutes(), date.getSeconds()].map((value) => String(value).padStart(2, "0")).join(":");
  }
  function priceWindow(value) {
    return `${clock(value.start_ms)}–${clock(value.end_ms)} · ${value.opening_mid} → ${value.closing_mid}`;
  }
  function flow(value, count, label) {
    return value === "0" && count === 0 ? "无主动成交" : `${formatNotional(value, label)} USDT · ${count} 笔`;
  }
  function buildCompoundCandidateAnnotation(candidate) {
    const direction = DIRECTIONS[candidate.direction];
    const family = FAMILY_LABELS[candidate.direction]?.[candidate.family];
    if (!direction || !family) throw new Error("Strategy 27 compound display rule is invalid");
    const reinforcement = candidate.family === "failed_rebound";
    const detailRows = [
      { label: "规则", value: family },
      { label: "背景", value: priceWindow(candidate.context) },
      { label: "触发秒", value: priceWindow(candidate.seed) },
      { label: "主动买", value: flow(candidate.seed.buy_notional, candidate.seed.buy_count, "seed buy") },
      { label: "主动卖", value: flow(candidate.seed.sell_notional, candidate.seed.sell_count, "seed sell") },
      { label: "bid", value: `增 ${formatNotional(candidate.seed.bid_addition, "bid addition")} · 减 ${formatNotional(candidate.seed.bid_decrease, "bid decrease")} USDT` },
      { label: "ask", value: `增 ${formatNotional(candidate.seed.ask_addition, "ask addition")} · 减 ${formatNotional(candidate.seed.ask_decrease, "ask decrease")} USDT` },
      { label: "基础确认", value: priceWindow(candidate.confirmation) }
    ];
    if (reinforcement) {
      detailRows.push(
        { label: candidate.direction === "high" ? "低点秒" : "高点秒", value: priceWindow(candidate.trough) },
        { label: candidate.direction === "high" ? "反弹秒" : "回落秒", value: priceWindow(candidate.rebound) },
        { label: "强化确认", value: priceWindow(candidate.decision) },
        { label: "关联候选", value: candidate.parent_candidate_id }
      );
    }
    detailRows.push({ label: "参数版本", value: candidate.profile.revision });
    const notices = ["探索候选，尚未验证预测能力"];
    if (candidate.direction === "low") notices.push("镜像规则，尚未独立验证");
    return Object.freeze({
      kind: "compound",
      title: direction.title,
      titleColor: candidate.direction === "high" ? "#FF718A" : "#53DDB1",
      eventTimeMs: candidate.decision.end_ms - 1,
      markerTime: Math.floor((candidate.decision.end_ms - 1) / 1e3),
      markerPrice: Number(candidate.decision.closing_mid),
      markerShape: direction.shape,
      markerColor: direction.color,
      markerLabel: direction.label,
      summary: `${direction.label} · ${family}`,
      ruleIdentity: `${candidate.family}/${candidate.direction}/${candidate.profile_id}${reinforcement ? `/${candidate.parent_candidate_id}` : ""}`,
      candidateId: candidate.candidate_id,
      profileId: candidate.profile_id,
      reinforcement,
      detailRows: Object.freeze(detailRows.map(Object.freeze)),
      notices: Object.freeze(notices)
    });
  }

  // src/binance-strategy27-events/core/compound-candidate-contract.js
  var HASH = /^[a-f0-9]{64}$/;
  var DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/;
  var PROFILE_DECIMALS = ["context_move_bps", "significant_flow_ratio", "quiet_flow_ratio", "confirmation_move_bps", "rebound_move_bps"];
  var PROFILE_TIMES = ["context_seconds", "minimum_context_seconds", "confirmation_seconds", "reinforcement_seconds"];
  var PRICES = ["opening_mid", "closing_mid", "minimum_mid", "maximum_mid"];
  var METRICS = ["buy_notional", "sell_notional", "bid_addition", "bid_decrease", "ask_addition", "ask_decrease", "bid_depth", "ask_depth"];
  function check(condition, message) {
    if (!condition) throw new Error(`Strategy 27 compound ${message}`);
  }
  function keys(value, expected, label) {
    check(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
    const actual = Object.keys(value).sort();
    const wanted = [...expected].sort();
    check(actual.length === wanted.length && actual.every((key, i) => key === wanted[i]), `${label} keys must be exact`);
  }
  function integer(value, label, minimum = 0) {
    check(Number.isSafeInteger(value) && value >= minimum, `${label} must be a safe integer >= ${minimum}`);
  }
  function hash(value, label) {
    check(typeof value === "string" && HASH.test(value), `${label} must be SHA-256`);
  }
  function decimal(value, label) {
    check(typeof value === "string" && value.length <= 128 && DECIMAL.test(value) && value !== "-0", `${label} must be a canonical decimal`);
  }
  function compare(left, right) {
    const scale = (value) => value.includes(".") ? value.length - value.indexOf(".") - 1 : 0;
    const leftScale = scale(left);
    const rightScale = scale(right);
    const a = BigInt(left.replace(".", "")) * 10n ** BigInt(rightScale);
    const b = BigInt(right.replace(".", "")) * 10n ** BigInt(leftScale);
    return a === b ? 0 : a > b ? 1 : -1;
  }
  function canonicalCompoundJson(value) {
    if (value !== null && typeof value === "object") {
      check(!Array.isArray(value), "canonical record cannot contain arrays");
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalCompoundJson(value[key])}`).join(",")}}`;
    }
    check(value === null || typeof value === "string" || Number.isSafeInteger(value), "canonical value is invalid");
    if (typeof value === "string") check(/^[\x00-\x7f]*$/.test(value), "canonical text must be ASCII");
    return JSON.stringify(value);
  }
  async function compoundHash(value) {
    const bytes = new TextEncoder().encode(canonicalCompoundJson(value));
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  function profile(value) {
    keys(value, ["revision", ...PROFILE_DECIMALS, ...PROFILE_TIMES], "profile");
    check(typeof value.revision === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value.revision), "profile revision is invalid");
    for (const field of PROFILE_TIMES) {
      integer(value[field], field, 1);
      check(value[field] <= 300, "profile time exceeds 300 seconds");
    }
    check(value.minimum_context_seconds >= 2 && value.minimum_context_seconds <= value.context_seconds, "profile context bounds are invalid");
    for (const field of PROFILE_DECIMALS) {
      decimal(value[field], field);
      check(compare(value[field], "0") > 0, `${field} must be positive`);
    }
    check(compare(value.quiet_flow_ratio, value.significant_flow_ratio) <= 0, "quiet ratio exceeds significant ratio");
  }
  function priceRange(value, label) {
    for (const field of PRICES) {
      decimal(value[field], `${label}.${field}`);
      check(compare(value[field], "0") > 0, `${label} prices must be positive`);
    }
    for (const field of ["opening_mid", "closing_mid"]) {
      check(compare(value.minimum_mid, value[field]) <= 0 && compare(value[field], value.maximum_mid) <= 0, `${label} extrema do not contain endpoints`);
    }
    integer(value.start_ms, `${label}.start_ms`);
    integer(value.end_ms, `${label}.end_ms`);
    check(value.start_ms % 1e3 === 0 && value.end_ms % 1e3 === 0 && value.end_ms > value.start_ms, `${label} interval is invalid`);
  }
  function second(value, label) {
    keys(value, ["start_ms", "end_ms", ...PRICES, ...METRICS, "buy_count", "sell_count"], label);
    priceRange(value, label);
    check(value.end_ms - value.start_ms === 1e3, `${label} must span one second`);
    integer(value.buy_count, `${label}.buy_count`);
    integer(value.sell_count, `${label}.sell_count`);
    for (const field of METRICS) {
      decimal(value[field], `${label}.${field}`);
      check(compare(value[field], "0") >= 0, `${label}.${field} must be nonnegative`);
    }
    check(compare(value.bid_depth, "0") > 0 && compare(value.ask_depth, "0") > 0, `${label} depths must be positive`);
  }
  async function validateCompoundCandidate(value) {
    keys(value, ["candidate_id", "profile", "profile_id", "symbol", "source_id", "family", "direction", "validation_status", "parent_candidate_id", "context", "established_extreme", "seed", "confirmation", "trough", "rebound", "decision"], "candidate");
    hash(value.candidate_id, "candidate_id");
    hash(value.profile_id, "profile_id");
    hash(value.source_id, "source_id");
    profile(value.profile);
    check(typeof value.symbol === "string" && /^[A-Z0-9]+\/USDT:USDT$/.test(value.symbol), "symbol is invalid");
    check(["impact_failure", "passive_support_loss", "failed_rebound"].includes(value.family), "family is invalid");
    check(["high", "low"].includes(value.direction), "direction is invalid");
    check(value.validation_status === (value.direction === "high" ? "exploratory" : "unvalidated_mirror"), "validation status does not match direction");
    keys(value.context, ["start_ms", "end_ms", ...PRICES], "context");
    priceRange(value.context, "context");
    for (const field of ["seed", "confirmation", "decision"]) second(value[field], field);
    decimal(value.established_extreme, "established_extreme");
    const extremeField = value.direction === "high" ? "maximum_mid" : "minimum_mid";
    const extremes = [value.context[extremeField], value.seed[extremeField]].sort(compare);
    check(value.established_extreme === extremes[value.direction === "high" ? 1 : 0], "frozen extreme does not match evidence");
    const duration = value.context.end_ms - value.context.start_ms;
    check(value.context.end_ms === value.seed.start_ms && value.seed.end_ms <= value.confirmation.start_ms && duration >= value.profile.minimum_context_seconds * 1e3 && duration <= value.profile.context_seconds * 1e3 && value.confirmation.end_ms - value.seed.end_ms <= value.profile.confirmation_seconds * 1e3, "base evidence ordering is invalid");
    if (value.family === "failed_rebound") {
      hash(value.parent_candidate_id, "parent_candidate_id");
      check(value.parent_candidate_id !== value.candidate_id, "candidate cannot parent itself");
      second(value.trough, "trough");
      second(value.rebound, "rebound");
      check(value.confirmation.end_ms <= value.trough.start_ms && value.trough.end_ms <= value.rebound.start_ms && value.rebound.end_ms <= value.decision.start_ms && value.decision.end_ms - value.confirmation.end_ms <= value.profile.reinforcement_seconds * 1e3, "reinforcement evidence ordering is invalid");
    } else {
      check(value.parent_candidate_id === null && value.trough === null && value.rebound === null && canonicalCompoundJson(value.decision) === canonicalCompoundJson(value.confirmation), "base cannot carry reinforcement evidence");
    }
    check(await compoundHash(value.profile) === value.profile_id, "profile hash mismatch");
    const { candidate_id: candidateId, ...record } = value;
    check(await compoundHash(record) === candidateId, "candidate hash mismatch");
    return value;
  }
  async function validateCompoundEnvelope(value) {
    keys(value, ["schema_version", "projection_kind", "runtime_epoch", "sequence", "message_kind", "symbol", "observed_at_ms", "payload"], "envelope");
    check(value.schema_version === 1 && value.projection_kind === "compound_candidate", "envelope version is invalid");
    check(typeof value.runtime_epoch === "string" && /^[a-f0-9]{32}$/.test(value.runtime_epoch), "runtime epoch is invalid");
    integer(value.sequence, "sequence", 1);
    integer(value.observed_at_ms, "observed_at_ms");
    check(new TextEncoder().encode(canonicalCompoundJson(value)).length <= 16384, "envelope exceeds byte bound");
    if (value.message_kind === "candidate") {
      await validateCompoundCandidate(value.payload);
      check(value.symbol === value.payload.symbol && value.observed_at_ms >= value.payload.decision.end_ms, "candidate identity/time mismatch");
    } else {
      check(["stream_state", "heartbeat"].includes(value.message_kind), "message kind is invalid");
      keys(value.payload, value.message_kind === "stream_state" ? ["state", "reason"] : ["state"], "state");
      check(value.symbol === null && value.payload.state === "ready", "state identity is invalid");
      if (value.message_kind === "stream_state") check(["startup", "transport_recovered", "queue_recovered"].includes(value.payload.reason), "reset reason is invalid");
    }
    return value;
  }
  var STREAM_ID = /^(0|[1-9]\d*)-(0|[1-9]\d*)$/;
  async function validateCompoundGatewayResponse(value, httpStatus) {
    if (value?.status === "error") {
      keys(value, ["schema_version", "status", "error_code"], "gateway error");
      check(value.schema_version === 1, "gateway schema is invalid");
      const codes = { 400: ["invalid_request"], 401: ["unauthorized"], 503: ["redis_unavailable", "compound_unavailable"] };
      check(codes[httpStatus]?.includes(value.error_code), "gateway error status/code mismatch");
      return value;
    }
    check(value?.status === "ok" || value?.status === "reset", "gateway status is invalid");
    keys(value, ["schema_version", "status", "requested_cursor", "next_cursor", "messages", ...value.status === "reset" ? ["reason"] : []], "gateway response");
    check(value.schema_version === 1, "gateway schema is invalid");
    check(typeof value.next_cursor === "string" && STREAM_ID.test(value.next_cursor), "next cursor is invalid");
    check(Array.isArray(value.messages) && value.messages.length <= 128, "gateway message bound is invalid");
    if (value.status === "reset") {
      check(["initial_cursor", "stale_cursor"].includes(value.reason), "gateway reset reason is invalid");
      check(value.messages.length === 0, "gateway reset messages must be empty");
      check(httpStatus === (value.reason === "initial_cursor" ? 200 : 409), "gateway reset HTTP status is invalid");
      if (value.reason === "initial_cursor") {
        check(value.requested_cursor === null, "initial cursor must be null");
        return value;
      }
    } else {
      check(httpStatus === 200, "gateway success must use HTTP 200");
      for (const message of value.messages) await validateCompoundEnvelope(message);
    }
    check(typeof value.requested_cursor === "string" && STREAM_ID.test(value.requested_cursor), "requested cursor is invalid");
    return value;
  }
  async function validateCompoundBootstrapResponse(value, httpStatus) {
    if (value?.status === "error") {
      keys(value, ["schema_version", "status", "error_code"], "bootstrap gateway error");
      check(value.schema_version === 1, "bootstrap gateway schema is invalid");
      const expected = { 401: ["unauthorized"], 503: ["compound_unavailable", "redis_unavailable"] }[httpStatus];
      check(expected?.includes(value.error_code), "bootstrap gateway error status/code mismatch");
      return value;
    }
    check(httpStatus === 200, "bootstrap gateway success must use HTTP 200");
    keys(value, [
      "schema_version",
      "status",
      "projection_kind",
      "requested_cursor",
      "next_cursor",
      "runtime_epoch",
      "last_sequence",
      "bootstrap_observed_at_ms",
      "records"
    ], "bootstrap gateway response");
    check(value.schema_version === 1 && value.status === "bootstrap", "bootstrap gateway status is invalid");
    check(value.projection_kind === "compound_candidates", "bootstrap projection kind is invalid");
    check(value.requested_cursor === null, "bootstrap requested cursor must be null");
    check(typeof value.next_cursor === "string" && STREAM_ID.test(value.next_cursor), "bootstrap next cursor is invalid");
    check(typeof value.runtime_epoch === "string" && /^[a-f0-9]{32}$/.test(value.runtime_epoch), "bootstrap epoch is invalid");
    integer(value.last_sequence, "bootstrap last sequence", 1);
    integer(value.bootstrap_observed_at_ms, "bootstrap observed time");
    check(Array.isArray(value.records) && value.records.length <= 80, "bootstrap record bound is invalid");
    for (const envelope of value.records) {
      await validateCompoundEnvelope(envelope);
      check(envelope.message_kind === "candidate", "bootstrap record must be a candidate");
      check(envelope.runtime_epoch === value.runtime_epoch, "bootstrap candidate epoch is inconsistent");
      check(envelope.sequence <= value.last_sequence, "bootstrap candidate sequence exceeds tail");
    }
    return value;
  }

  // src/binance-strategy27-events/core/compound-candidate-client.js
  function wait(delay, signal) {
    const aborted = () => new DOMException("Compound request aborted", "AbortError");
    if (signal.aborted) return Promise.reject(aborted());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", cancel);
        resolve();
      }, delay);
      function cancel() {
        clearTimeout(timer);
        reject(aborted());
      }
      signal.addEventListener("abort", cancel, { once: true });
    });
  }
  function cursorRegressed(next, previous) {
    const [nextMs, nextSequence] = next.split("-").map(BigInt);
    const [previousMs, previousSequence] = previous.split("-").map(BigInt);
    return nextMs < previousMs || nextMs === previousMs && nextSequence < previousSequence;
  }
  function createCompoundCandidateClient({ request, gatewayBaseUrl, authSecret, canonicalSymbol, onResponse, onConnectionStateChange, reconnectDelayMs = 2e3 }) {
    if (typeof request !== "function" || typeof onResponse !== "function" || typeof onConnectionStateChange !== "function") throw new Error("Compound client callbacks are required");
    if (typeof authSecret !== "string" || authSecret.length === 0) throw new Error("Compound gateway secret is not configured");
    if (typeof canonicalSymbol !== "string" || !/^[A-Z0-9]+\/USDT:USDT$/.test(canonicalSymbol)) throw new Error("Compound canonical symbol is invalid");
    if (!Number.isSafeInteger(reconnectDelayMs) || reconnectDelayMs < 0) throw new Error("Compound reconnect delay is invalid");
    const origin = normalizeGatewayBaseUrl(gatewayBaseUrl);
    let cursor = null;
    let needsBootstrap = true;
    let state = null;
    function transition(next) {
      if (state === next) return;
      state = next;
      onConnectionStateChange(next);
    }
    return Object.freeze({
      async run(signal) {
        while (!signal.aborted) {
          const url = new URL(needsBootstrap ? "/v1/strategy27/compound-candidates/bootstrap" : "/v1/strategy27/compound-candidates", origin);
          url.searchParams.set("symbol", canonicalSymbol);
          if (!needsBootstrap) url.searchParams.set("cursor", cursor);
          let response;
          try {
            response = await request({ url: url.href, authSecret, signal });
          } catch (error) {
            if (signal.aborted) return;
            if (!(error instanceof Strategy27GatewayTransportError)) throw error;
            transition("reconnecting");
            await wait(reconnectDelayMs, signal);
            continue;
          }
          if (signal.aborted) return;
          if (!Number.isInteger(response?.status) || typeof response.responseText !== "string") throw new Error("Compound gateway returned an invalid response");
          if (response.status === 404) {
            transition("unsupported");
            return;
          }
          const payload = needsBootstrap ? await validateCompoundBootstrapResponse(JSON.parse(response.responseText), response.status) : await validateCompoundGatewayResponse(JSON.parse(response.responseText), response.status);
          if (signal.aborted) return;
          if (payload.status === "error") {
            if (response.status !== 503) throw new Error(`Compound gateway error: ${payload.error_code}`);
            cursor = null;
            needsBootstrap = true;
            transition("unavailable");
            await wait(reconnectDelayMs, signal);
            continue;
          }
          if (!needsBootstrap && (payload.requested_cursor !== cursor || cursorRegressed(payload.next_cursor, cursor))) throw new Error("Compound gateway response cursor mismatch/regression");
          if (signal.aborted) return;
          transition("connected");
          await onResponse(payload);
          if (!needsBootstrap && payload.status === "reset") {
            cursor = null;
            needsBootstrap = true;
          } else {
            cursor = payload.next_cursor;
            needsBootstrap = false;
          }
        }
      }
    });
  }

  // src/binance-strategy27-events/core/compound-candidate-lifecycle.js
  function check2(condition, message) {
    if (!condition) throw new Error(`Strategy 27 compound ${message}`);
  }
  function freezeRecord(value) {
    if (value !== null && typeof value === "object") {
      for (const child of Object.values(value)) freezeRecord(child);
      Object.freeze(value);
    }
    return value;
  }
  function orderOf(candidate) {
    return { time: candidate.decision.end_ms, id: candidate.candidate_id };
  }
  function compareOrder(a, b) {
    return a.time - b.time || (a.id === b.id ? 0 : a.id < b.id ? -1 : 1);
  }
  var _records, _evictionBoundary, _generation, _applying, _CompoundCandidateLifecycle_instances, evict_fn;
  var CompoundCandidateLifecycle = class {
    constructor(canonicalSymbol, { maxCandidates, maxAgeMs }) {
      __privateAdd(this, _CompoundCandidateLifecycle_instances);
      __privateAdd(this, _records, /* @__PURE__ */ new Map());
      __privateAdd(this, _evictionBoundary, null);
      __privateAdd(this, _generation, 0);
      __privateAdd(this, _applying, false);
      canonicalSymbolToRoute(canonicalSymbol);
      check2(Number.isSafeInteger(maxCandidates) && maxCandidates >= 1 && maxCandidates <= 80, "maxCandidates must be 1..80");
      check2(Number.isSafeInteger(maxAgeMs) && maxAgeMs >= 1 && maxAgeMs <= 72e5, "maxAgeMs must be 1..7200000");
      this.canonicalSymbol = canonicalSymbol;
      this.maxCandidates = maxCandidates;
      this.maxAgeMs = maxAgeMs;
      this.reset("initial_cursor");
    }
    reset(reason) {
      check2(["initial_cursor", "stale_cursor", "route_changed", "interval_changed", "unavailable", "stopped"].includes(reason), "reset reason is invalid");
      __privateSet(this, _generation, __privateGet(this, _generation) + 1);
      __privateGet(this, _records).clear();
      __privateSet(this, _evictionBoundary, null);
      this.runtimeEpoch = null;
      this.lastSequence = null;
    }
    beginBootstrap(runtimeEpoch) {
      check2(typeof runtimeEpoch === "string" && /^[a-f0-9]{32}$/.test(runtimeEpoch), "bootstrap epoch is invalid");
      this.reset("initial_cursor");
      this.runtimeEpoch = runtimeEpoch;
      this.lastSequence = 0;
    }
    finishBootstrap(lastSequence) {
      check2(Number.isSafeInteger(lastSequence) && lastSequence >= 1, "bootstrap last sequence is invalid");
      check2(this.runtimeEpoch !== null && this.lastSequence !== null, "bootstrap was not started");
      check2(lastSequence >= this.lastSequence, "bootstrap tail sequence precedes restored records");
      this.lastSequence = lastSequence;
    }
    prune(nowMs) {
      check2(Number.isSafeInteger(nowMs) && nowMs >= 0, "prune time is invalid");
      const removed = [];
      for (const [id, record] of __privateGet(this, _records)) {
        if (nowMs - record.candidate.decision.end_ms > this.maxAgeMs) {
          __privateMethod(this, _CompoundCandidateLifecycle_instances, evict_fn).call(this, id);
          removed.push(id);
        }
      }
      return removed;
    }
    async apply(rawEnvelope, nowMs) {
      check2(!__privateGet(this, _applying), "lifecycle applications must be serial");
      check2(Number.isSafeInteger(nowMs) && nowMs >= 0, "application time is invalid");
      __privateSet(this, _applying, true);
      const generation = __privateGet(this, _generation);
      try {
        const envelope = await validateCompoundEnvelope(structuredClone(rawEnvelope));
        if (generation !== __privateGet(this, _generation)) return { type: "cancelled", removedCandidateIds: [] };
        const isState = envelope.message_kind === "stream_state";
        if (envelope.message_kind === "candidate") check2(envelope.symbol === this.canonicalSymbol, "symbol does not match requested symbol");
        const changedEpoch = this.runtimeEpoch !== null && envelope.runtime_epoch !== this.runtimeEpoch;
        if (changedEpoch) check2(isState, "epoch changed without stream_state");
        if (this.runtimeEpoch === envelope.runtime_epoch) {
          check2(envelope.sequence > this.lastSequence, "sequence regression");
          check2(!isState, "Unexpected stream_state inside an active epoch");
        }
        this.runtimeEpoch = envelope.runtime_epoch;
        this.lastSequence = envelope.sequence;
        if (isState) {
          const removedCandidateIds2 = [...__privateGet(this, _records).keys()];
          __privateGet(this, _records).clear();
          __privateSet(this, _evictionBoundary, null);
          return { type: "stream_reset", removedCandidateIds: removedCandidateIds2 };
        }
        const removedCandidateIds = this.prune(nowMs);
        if (envelope.message_kind === "heartbeat") return { type: "heartbeat", removedCandidateIds };
        const candidate = envelope.payload;
        const id = candidate.candidate_id;
        const canonical = canonicalCompoundJson(candidate);
        const retained = __privateGet(this, _records).get(id);
        if (retained) {
          check2(retained.canonical === canonical, "candidate replay changed immutable content");
          return { type: "replay", removedCandidateIds };
        }
        if (nowMs - candidate.decision.end_ms > this.maxAgeMs || __privateGet(this, _evictionBoundary) !== null && compareOrder(orderOf(candidate), __privateGet(this, _evictionBoundary)) <= 0) {
          return { type: "expired", removedCandidateIds };
        }
        freezeRecord(candidate);
        __privateGet(this, _records).set(id, { candidate, canonical });
        if (__privateGet(this, _records).size > this.maxCandidates) {
          const oldest = [...__privateGet(this, _records).values()].sort((a, b) => compareOrder(orderOf(a.candidate), orderOf(b.candidate)))[0].candidate.candidate_id;
          __privateMethod(this, _CompoundCandidateLifecycle_instances, evict_fn).call(this, oldest);
          removedCandidateIds.push(oldest);
        }
        return __privateGet(this, _records).has(id) ? { type: "candidate", candidate, observedAtMs: envelope.observed_at_ms, removedCandidateIds } : { type: "expired", removedCandidateIds };
      } finally {
        __privateSet(this, _applying, false);
      }
    }
    get size() {
      return __privateGet(this, _records).size;
    }
  };
  _records = new WeakMap();
  _evictionBoundary = new WeakMap();
  _generation = new WeakMap();
  _applying = new WeakMap();
  _CompoundCandidateLifecycle_instances = new WeakSet();
  evict_fn = function(id) {
    const record = __privateGet(this, _records).get(id);
    const order = orderOf(record.candidate);
    if (__privateGet(this, _evictionBoundary) === null || compareOrder(order, __privateGet(this, _evictionBoundary)) > 0) __privateSet(this, _evictionBoundary, order);
    __privateGet(this, _records).delete(id);
  };

  // src/binance-strategy27-events/core/compound-candidate-controller.js
  var CONNECTION_STATUS = Object.freeze({
    connected: ["复合候选已连接", "normal"],
    reconnecting: ["复合候选连接中断，正在重连", "inactive"],
    unavailable: ["复合候选暂不可用，正在重连", "inactive"],
    unsupported: ["网关尚未启用复合候选", "inactive"]
  });
  function createCompoundCandidateController({
    request,
    gatewayBaseUrl,
    authSecret,
    canonicalSymbol,
    panel,
    createLayer,
    isCurrent,
    maxCandidates,
    maxAgeMs,
    nowMs = Date.now,
    reconnectDelayMs = 2e3
  }) {
    const lifecycle = new CompoundCandidateLifecycle(canonicalSymbol, { maxCandidates, maxAgeMs });
    const abortController = new AbortController();
    let layer = null;
    let started = false;
    let viewGeneration = 0;
    let pendingCandidateId = null;
    let lastError = null;
    const current = () => !abortController.signal.aborted && isCurrent();
    function clearView() {
      viewGeneration += 1;
      pendingCandidateId = null;
      let cleanupError = null;
      try {
        layer?.clear();
      } catch (error) {
        cleanupError = error;
      }
      panel.clearCompound();
      return cleanupError;
    }
    function remove(ids) {
      for (const id of ids) {
        if (id === pendingCandidateId) viewGeneration += 1;
        layer?.remove(id);
        panel.removeCompound(id);
      }
    }
    function prune(observedAtMs = nowMs()) {
      if (current()) remove(lifecycle.prune(observedAtMs));
    }
    function failJob(error, { clear = true } = {}) {
      lastError = error;
      if (!current()) return;
      abortController.abort();
      lifecycle.reset("stopped");
      const cleanupError = clear ? clearView() : null;
      if (cleanupError) lastError = new AggregateError([error, cleanupError], `${error.message}; ${cleanupError.message}`);
      panel.setCompoundStatus(`复合候选已停止：${lastError.message}`, "error");
    }
    function onConnectionStateChange(state) {
      if (!current()) return;
      const status = CONNECTION_STATUS[state];
      if (!status) throw new Error(`Unknown compound connection state: ${state}`);
      if (state === "unavailable" || state === "unsupported") {
        lifecycle.reset("unavailable");
        const error = clearView();
        if (error) {
          failJob(error, { clear: false });
          return;
        }
      }
      panel.setCompoundStatus(...status);
    }
    async function onResponse(response) {
      if (!current()) return;
      if (response.status === "reset") {
        lifecycle.reset(response.reason);
        const error = clearView();
        if (error) failJob(error, { clear: false });
        return;
      }
      let messages = response.messages;
      const applicationNowMs = response.status === "bootstrap" ? response.bootstrap_observed_at_ms : nowMs();
      if (response.status === "bootstrap") {
        lifecycle.beginBootstrap(response.runtime_epoch);
        const error = clearView();
        if (error) {
          failJob(error, { clear: false });
          return;
        }
        messages = [...response.records].sort((left, right) => left.sequence - right.sequence);
      }
      for (const message of messages) {
        if (!current()) return;
        const applicationGeneration = viewGeneration;
        const action = await lifecycle.apply(message, applicationNowMs);
        if (!current()) return;
        remove(action.removedCandidateIds);
        if (action.type === "stream_reset") {
          const error = clearView();
          if (error) {
            failJob(error, { clear: false });
            return;
          }
          continue;
        }
        if (action.type !== "candidate" || applicationGeneration !== viewGeneration) continue;
        const id = action.candidate.candidate_id;
        const annotation = buildCompoundCandidateAnnotation(action.candidate);
        if (layer === null) layer = createLayer();
        const renderGeneration = viewGeneration;
        pendingCandidateId = id;
        try {
          const rendered = await layer.renderCandidate(id, annotation, action.candidate.decision.end_ms);
          if (typeof rendered !== "boolean") throw new Error("Compound renderer must return a boolean");
          if (!current()) return;
          prune();
          if (rendered && renderGeneration === viewGeneration) {
            panel.upsertCompound(id, annotation, action.observedAtMs);
          }
        } finally {
          pendingCandidateId = null;
        }
      }
      if (response.status === "bootstrap" && current()) {
        lifecycle.finishBootstrap(response.last_sequence);
      }
    }
    return Object.freeze({
      run() {
        if (started) throw new Error("Compound controller already started");
        started = true;
        return (async () => {
          if (!current()) return;
          try {
            panel.setCompoundStatus("复合候选正在连接", "inactive");
            const client = createCompoundCandidateClient({
              request,
              gatewayBaseUrl,
              authSecret,
              canonicalSymbol,
              reconnectDelayMs,
              onResponse,
              onConnectionStateChange
            });
            await client.run(abortController.signal);
          } catch (error) {
            if (abortController.signal.aborted && error.name === "AbortError") return;
            failJob(error);
          }
        })();
      },
      clear() {
        if (!current()) return;
        const error = clearView();
        if (error) failJob(error, { clear: false });
      },
      prune() {
        try {
          prune();
        } catch (error) {
          failJob(error);
        }
      },
      async reconcile() {
        try {
          prune();
          if (current() && layer !== null) await layer.reconcile();
        } catch (error) {
          failJob(error);
        }
      },
      stop(reason) {
        if (abortController.signal.aborted) return;
        abortController.abort();
        lifecycle.reset(reason);
        const error = clearView();
        if (error) {
          lastError = error;
          panel.setCompoundStatus(`复合候选已停止：${error.message}`, "error");
        }
      },
      // A late drawing rejection remains inspectable without touching a retired panel.
      get lastError() {
        return lastError;
      }
    });
  }

  // src/binance-strategy27-events/dom/tradingview-compound-layer.js
  var ICON_SIZE_PX = 36;
  var CANDLE_GAP_PX = 8;
  var SLOT_STEP_PX = 64;
  var ICONS = Object.freeze({ arrow_down: 61539, arrow_up: 61538 });
  function drawingOptions(color) {
    return {
      lock: true,
      disableSave: true,
      disableSelection: true,
      disableUndo: true,
      showInObjectsTree: false,
      overrides: { color }
    };
  }
  function createTradingViewCompoundLayer(target, { maxCandidates, candleWaitMs = 3e3 }) {
    if (!Number.isSafeInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 80) throw new Error("Compound chart capacity must be 1..80");
    const { chart } = target;
    const placement = createTradingViewMarkerPlacement(chart, { candleWaitMs });
    const isChartCurrent = pinMarkerChartContext(chart);
    const records = /* @__PURE__ */ new Map();
    let pending = null;
    let reconciliation = null;
    function dispose(recordsToRemove) {
      const errors = [];
      const liveIds = readLiveShapeIds(chart);
      for (const record of recordsToRemove) {
        for (const id of record.ids.splice(0)) {
          if (!liveIds.has(id)) continue;
          try {
            chart.removeEntity(id);
          } catch (error) {
            errors.push(error);
          }
        }
      }
      if (errors.length) throw new AggregateError(errors, `Compound chart cleanup failed: ${errors.map((error) => error.message).join("; ")}`);
    }
    async function createDrawing(point, drawing) {
      const entityId = await createAlignedShape(chart, point, drawing);
      try {
        const properties = chart.getShapeById(entityId).getProperties();
        const matched = properties.color === drawing.overrides.color && (drawing.shape === "icon" ? properties.icon === drawing.icon && properties.size === ICON_SIZE_PX : properties.text === drawing.text && properties.fontsize === 12);
        if (!matched) throw new Error("Compound chart drawing properties did not match the requested icon/label");
      } catch (error) {
        try {
          dispose([{ ids: [entityId] }]);
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], `${error.message}; ${cleanupError.message}`);
        }
        throw error;
      }
      return entityId;
    }
    function restoreCandidate(id, record, liveIds) {
      if (record.restoring) return record.restoring;
      const current = () => records.get(id) === record && isChartCurrent();
      if (!current()) return Promise.resolve(false);
      if (record.ids.every((entityId) => liveIds.has(entityId))) return Promise.resolve(true);
      record.restoring = (async () => {
        for (let index = 0; index < record.drawings.length; index += 1) {
          if (!current()) return false;
          if (liveIds.has(record.ids[index])) continue;
          const [point, drawing] = record.drawings[index];
          const entityId = await createDrawing(point, drawing);
          if (!current()) {
            dispose([{ ids: [entityId] }]);
            return false;
          }
          record.ids[index] = entityId;
          liveIds = readLiveShapeIds(chart);
        }
        return true;
      })().finally(() => {
        record.restoring = null;
      });
      return record.restoring;
    }
    function reconcile() {
      if (reconciliation) return reconciliation;
      reconciliation = (async () => {
        let liveIds = readLiveShapeIds(chart);
        for (const [id, record] of [...records]) {
          if (records.get(id) !== record || !isChartCurrent()) continue;
          if (!record.restoring && record.ids.every((entityId) => liveIds.has(entityId))) continue;
          await restoreCandidate(id, record, liveIds);
          liveIds = readLiveShapeIds(chart);
        }
      })().finally(() => {
        reconciliation = null;
      });
      return reconciliation;
    }
    function remove(id) {
      const removals = [];
      if (pending?.id === id) {
        pending.controller.abort();
        removals.push(pending);
      }
      const record = records.get(id);
      if (record) {
        records.delete(id);
        removals.push(record);
      }
      dispose(removals);
    }
    function clear() {
      if (pending) pending.controller.abort();
      const removals = [...records.values()];
      records.clear();
      if (pending) removals.push(pending);
      dispose(removals);
    }
    async function renderCandidate(id, annotation, decisionAtMs) {
      const existing = records.get(id);
      if (existing) return restoreCandidate(id, existing, readLiveShapeIds(chart));
      if (pending !== null) throw new Error("Compound chart rendering must be serial");
      if (records.size >= maxCandidates) throw new Error("Compound chart capacity exceeded before eviction");
      if (typeof id !== "string" || id.length === 0 || !Number.isSafeInteger(decisionAtMs) || decisionAtMs < 1) throw new Error("Compound chart candidate identity/time is invalid");
      const icon = ICONS[annotation.markerShape];
      if (icon === void 0 || !["候选高", "候选低"].includes(annotation.markerLabel)) throw new Error("Compound chart direction/label is invalid");
      const operation = { id, controller: new AbortController(), ids: [] };
      pending = operation;
      try {
        const base = await placement.wait(annotation, {
          signal: operation.controller.signal,
          gapPx: CANDLE_GAP_PX + ICON_SIZE_PX / 2
        });
        if (!base || operation.controller.signal.aborted || !isChartCurrent()) return false;
        const group = `${base.time}/${annotation.markerShape}`;
        const occupied = new Set([...records.values()].filter((record) => record.group === group).map((record) => record.slot));
        let slot = 0;
        while (occupied.has(slot)) slot += 1;
        const sign = annotation.markerShape === "arrow_up" ? 1 : -1;
        const point = placement.shift(base, sign * slot * SLOT_STEP_PX);
        const labelPoint = placement.shift(point, sign > 0 ? 18 : -40);
        const options = drawingOptions(annotation.markerColor);
        const drawings = [
          [point, { ...options, shape: "icon", icon, overrides: { ...options.overrides, size: ICON_SIZE_PX } }],
          [labelPoint, { ...options, shape: "text", text: annotation.markerLabel, overrides: { ...options.overrides, fontsize: 12, bold: true, fillBackground: false, drawBorder: false } }]
        ];
        for (const [drawingPoint, drawing] of drawings) {
          const entityId = await createDrawing(drawingPoint, drawing);
          operation.ids.push(entityId);
          if (operation.controller.signal.aborted || !isChartCurrent()) {
            dispose([operation]);
            return false;
          }
        }
        records.set(id, { ids: operation.ids.splice(0), group, slot, decisionAtMs, drawings, restoring: null });
        return true;
      } catch (error) {
        try {
          dispose([operation]);
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], `${error.message}; ${cleanupError.message}`);
        }
        throw error;
      } finally {
        pending = null;
      }
    }
    return Object.freeze({ renderCandidate, reconcile, remove, clear, get size() {
      return records.size;
    } });
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
    const PANEL_POSITION_KEY = "strategy27EventPanelPosition";
    const CONTEXT_CHECK_INTERVAL_MS = 1e3;
    const MAX_RETAINED_EVENTS = 80;
    const MAX_PANEL_EVENTS = 8;
    const MAX_EVENT_AGE_MS = 2 * 60 * 60 * 1e3;
    const page = unsafeWindow;
    const pageDocument = page.document;
    const request = createGmJsonRequest(GM_xmlhttpRequest);
    let active = null;
    let statusView = null;
    function stopActive(resetReason) {
      if (!active) return;
      active.controller.abort();
      active.compound.stop(resetReason);
      active.lifecycle.reset(resetReason);
      active.layer.clear();
      active.panel.destroy();
      active = null;
    }
    function showStatus(chartRoot, text, state = "normal") {
      statusView = ensureStrategy27StatusView(pageDocument, chartRoot);
      setStrategy27Status(statusView, text, state);
    }
    function hideStatus() {
      removeStrategy27StatusView(pageDocument);
      statusView = null;
    }
    function pruneOrdinaryEvents(context) {
      for (const eventId of context.lifecycle.prune(Date.now())) {
        context.layer.remove(eventId);
        context.panel.remove(eventId);
        context.candidatePresentations.delete(eventId);
      }
    }
    function failOrdinary(context, error) {
      if (error.name === "AbortError" || active !== context || context.failed) return;
      context.failed = true;
      context.controller.abort();
      let failure = error;
      try {
        context.layer.clear();
      } catch (cleanupError) {
        failure = new AggregateError([error, cleanupError], `${error.message}; ${cleanupError.message}`);
      }
      context.panel.clear();
      showStatus(context.target.chartRoot, `Strategy 27 已停止：${failure.message}`, "error");
    }
    function reconcileOrdinary(context) {
      if (context.failed) return;
      try {
        pruneOrdinaryEvents(context);
        if (context.reconciliation) return;
        context.reconciliation = context.layer.reconcile().catch((error) => failOrdinary(context, error)).finally(() => {
          context.reconciliation = null;
        });
      } catch (error) {
        failOrdinary(context, error);
      }
    }
    async function renderGatewayResponse(context, response) {
      if (active !== context || context.failed) return;
      pruneOrdinaryEvents(context);
      if (response.status === "reset") {
        context.lifecycle.reset(response.reason);
        context.layer.clear();
        context.panel.clear();
        context.candidatePresentations.clear();
        hideStatus();
        return;
      }
      let messages = response.messages;
      if (response.status === "bootstrap") {
        context.lifecycle.beginBootstrap({
          runtimeEpoch: response.runtime_epoch,
          observedAtMs: response.bootstrap_observed_at_ms
        });
        context.layer.clear();
        context.panel.clear();
        context.candidatePresentations.clear();
        const bySequence = /* @__PURE__ */ new Map();
        for (const record of response.records) {
          for (const message of [record.marker_envelope, record.event_envelope, record.outcome_envelope]) {
            if (message === null) continue;
            const existing = bySequence.get(message.sequence);
            if (existing && JSON.stringify(existing) !== JSON.stringify(message)) {
              throw new Error("Strategy 27 bootstrap sequence identifies different envelopes");
            }
            bySequence.set(message.sequence, message);
          }
        }
        messages = [...bySequence.values()].sort((left, right) => left.sequence - right.sequence);
      }
      for (const message of messages) {
        if (active !== context || context.failed) return;
        const action = context.lifecycle.apply(message);
        for (const eventId of action.evictedEventIds ?? []) {
          context.layer.remove(eventId);
          context.panel.remove(eventId);
          context.candidatePresentations.delete(eventId);
        }
        if (action.type === "stream_reset") {
          context.layer.clear();
          context.panel.clear();
          context.candidatePresentations.clear();
          hideStatus();
          continue;
        }
        if (action.type === "event_evicted") continue;
        const annotation = stabilizeCandidatePresentation(
          context.candidatePresentations,
          action.eventId,
          buildEventAnnotation({
            event: action.event,
            rehydrated: action.rehydrated
          })
        );
        const renderMethod = {
          event_opened: "renderOpened",
          event_updated: "renderUpdated",
          event_closed: "renderClosed",
          event_outcome: "renderOutcome"
        }[action.messageKind];
        const rendered = await context.layer[renderMethod](action.eventId, annotation, action.observedAtMs);
        if (!rendered || active !== context || context.failed) continue;
        context.panel.upsert(action.eventId, annotation, action.observedAtMs);
        hideStatus();
      }
      if (response.status === "bootstrap") {
        context.lifecycle.finishBootstrap(response.last_sequence);
        hideStatus();
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
        panel: createStrategy27EventPanel(pageDocument, target.chartRoot, {
          maxEvents: MAX_PANEL_EVENTS,
          maxCompoundEvents: MAX_PANEL_EVENTS,
          loadPosition: () => GM_getValue(PANEL_POSITION_KEY, null),
          savePosition: (position) => GM_setValue(PANEL_POSITION_KEY, position)
        }),
        candidatePresentations: /* @__PURE__ */ new Map(),
        reconciliation: null,
        failed: false
      };
      active = context;
      context.compound = createCompoundCandidateController({
        request,
        gatewayBaseUrl: gatewayOrigin,
        authSecret,
        canonicalSymbol,
        panel: context.panel,
        isCurrent: () => active === context,
        maxCandidates: MAX_RETAINED_EVENTS,
        maxAgeMs: MAX_EVENT_AGE_MS,
        createLayer: () => createTradingViewCompoundLayer(target, { maxCandidates: MAX_RETAINED_EVENTS })
      });
      void context.compound.run();
      showStatus(target.chartRoot, "Strategy 27 正在连接");
      const client = createLiveEventClient({
        request,
        gatewayBaseUrl: gatewayOrigin,
        authSecret,
        canonicalSymbol,
        onConnectionStateChange: (state) => {
          if (active !== context) return;
          if (state === "reconnecting") {
            showStatus(context.target.chartRoot, "Strategy 27 网关连接中断，正在重连", "inactive");
          } else {
            hideStatus();
          }
        },
        onResponse: (response) => renderGatewayResponse(context, response)
      });
      client.run(context.controller.signal).catch((error) => failOrdinary(context, error));
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
      if (!chartRoot) {
        stopActive("interval_changed");
        hideStatus();
        return;
      }
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
        reconcileOrdinary(active);
        void active.compound.reconcile();
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
      active?.compound.clear();
      active?.layer.clear();
      active?.panel.clear();
      hideStatus();
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
