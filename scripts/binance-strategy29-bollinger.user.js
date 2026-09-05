// ==UserScript==
// @name         【自写】Binance Strategy 29 布林带信号
// @namespace    binance.strategy29.bollinger
// @icon         data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%23f0b90b%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2249%22%20text-anchor%3D%22middle%22%20font-family%3D%22Arial%2C%20sans-serif%22%20font-size%3D%2242%22%20font-weight%3D%22800%22%20fill%3D%22%23111827%22%3EJ%3C%2Ftext%3E%3C%2Fsvg%3E
// @icon64       data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%23f0b90b%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2249%22%20text-anchor%3D%22middle%22%20font-family%3D%22Arial%2C%20sans-serif%22%20font-size%3D%2242%22%20font-weight%3D%22800%22%20fill%3D%22%23111827%22%3EJ%3C%2Ftext%3E%3C%2Fsvg%3E
// @version      0.2.0
// @author       jackhai9
// @description  Native Bollinger/SMA60 markers with an optional read-only cross-timeframe summary
// @match        https://www.binance.com/*/futures/*
// @match        https://www.binance.com/futures/*
// @exclude      https://www.binance.com/*/my/wallet/futures/*
// @exclude      https://www.binance.com/my/wallet/futures/*
// @connect      127.0.0.1
// @updateURL    https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-strategy29-bollinger.user.js
// @downloadURL  https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-strategy29-bollinger.user.js
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==
(() => {
  // src/binance-strategy29-bollinger/core/remote-summary-contract.js
  var STRATEGY29_SCHEMA_VERSION = 1;
  var STRATEGY29_SPEC_VERSION = "29_2_spec_v1";
  var STRATEGY29_REFERENCE_SHA256 = "eece8cf16e58340910587962f3bfbb19acb72155c09a52b4b6c0570cc979ef8d";
  var TIMEFRAMES = /* @__PURE__ */ new Set(["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "1w"]);
  var UNIT_STATUSES = /* @__PURE__ */ new Set(["warming", "ready", "stale", "insufficient_history", "data_gap", "failed"]);
  var DIRECTIONS = /* @__PURE__ */ new Set(["bearish", "bullish"]);
  var SIGNAL_TYPES = /* @__PURE__ */ new Set(["warning", "confirmed", "reversal"]);
  var SIGNAL_SIDES = /* @__PURE__ */ new Set(["short", "long"]);
  var ORIGINS = /* @__PURE__ */ new Set(["historical", "catch_up", "live"]);
  var DELIVERY_STATES = /* @__PURE__ */ new Set(["pending", "sending", "sent", "unknown", "expired", "failed"]);
  var DELIVERY_COUNT_KEYS = ["pending", "sending", "sent", "unknown", "expired", "failed"];
  var STATUS_KEYS = ["schema_version", "spec_version", "observed_at_ms", "units", "delivery_counts"];
  var UNIT_KEYS = [
    "symbol",
    "timeframe",
    "status",
    "reason",
    "last_processed_open_ms",
    "last_data_at_ms",
    "last_event_id"
  ];
  var EVENTS_KEYS = ["schema_version", "spec_version", "observed_at_ms", "next_cursor", "has_more", "events"];
  var EVENT_KEYS = [
    "sequence",
    "event_id",
    "schema_version",
    "strategy_id",
    "spec_version",
    "symbol",
    "timeframe",
    "setup_direction",
    "signal_type",
    "signal_side",
    "setup_open_ms",
    "bar_open_ms",
    "bar_close_ms",
    "detected_at_ms",
    "close_price",
    "marker_price",
    "warning_open_ms",
    "warning_high",
    "warning_low",
    "origin",
    "delivery_state",
    "delivery_failure_reason"
  ];
  var EVENT_ID_PATTERN = /^[0-9a-f]{64}$/;
  var ROUTE_SYMBOL_PATTERN = /^([A-Z0-9]+)USDT$/;
  var CANONICAL_SYMBOL_PATTERN = /^([A-Z0-9]+)\/USDT:USDT$/;
  function assertObject(value, name) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  }
  function assertExactKeys(value, keys, name) {
    assertObject(value, name);
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
      throw new TypeError(`${name} must contain exact keys: ${expected.join(", ")}`);
    }
  }
  function assertInteger(value, name, { nullable = false, minimum = 0 } = {}) {
    if (nullable && value === null) return;
    if (!Number.isSafeInteger(value) || value < minimum) throw new TypeError(`${name} must be an integer >= ${minimum}`);
  }
  function assertString(value, name, { nullable = false, maximumLength = 256 } = {}) {
    if (nullable && value === null) return;
    if (typeof value !== "string" || value.length === 0) throw new TypeError(`${name} must be a non-empty string`);
    if (value.length > maximumLength) throw new TypeError(`${name} exceeds ${maximumLength} characters`);
  }
  function assertEnum(value, allowed, name, { nullable = false } = {}) {
    if (nullable && value === null) return;
    if (!allowed.has(value)) throw new TypeError(`${name} is invalid`);
  }
  function assertFiniteNumber(value, name) {
    if (!Number.isFinite(value)) throw new TypeError(`${name} must be a finite number`);
  }
  function assertSchema(value, name) {
    if (value !== STRATEGY29_SCHEMA_VERSION) throw new TypeError(`${name} must equal ${STRATEGY29_SCHEMA_VERSION}`);
  }
  function assertCanonicalSymbol(value, name) {
    if (typeof value !== "string" || !CANONICAL_SYMBOL_PATTERN.test(value)) {
      throw new TypeError(`${name} must use canonical symbol format`);
    }
  }
  function routeSymbolToCanonical(value) {
    if (typeof value !== "string") throw new TypeError("route symbol must be a string");
    const match = ROUTE_SYMBOL_PATTERN.exec(value);
    if (!match || match[1] === "") throw new TypeError("route symbol must end in USDT and use uppercase canonical route syntax");
    return `${match[1]}/USDT:USDT`;
  }
  function validateUnit(value, index) {
    const name = `status.units[${index}]`;
    assertExactKeys(value, UNIT_KEYS, name);
    assertCanonicalSymbol(value.symbol, `${name}.symbol`);
    assertEnum(value.timeframe, TIMEFRAMES, `${name}.timeframe`);
    assertEnum(value.status, UNIT_STATUSES, `${name}.status`);
    assertString(value.reason, `${name}.reason`);
    assertInteger(value.last_processed_open_ms, `${name}.last_processed_open_ms`, { nullable: true });
    assertInteger(value.last_data_at_ms, `${name}.last_data_at_ms`, { nullable: true });
    if (value.last_event_id !== null && (typeof value.last_event_id !== "string" || !EVENT_ID_PATTERN.test(value.last_event_id))) {
      throw new TypeError(`${name}.last_event_id must be null or a lowercase hexadecimal event id`);
    }
  }
  function validateStrategy29StatusResponse(value, httpStatus) {
    if (httpStatus !== 200) throw new TypeError(`status response requires HTTP 200, received ${httpStatus}`);
    assertExactKeys(value, STATUS_KEYS, "status response");
    assertSchema(value.schema_version, "status.schema_version");
    assertString(value.spec_version, "status.spec_version");
    assertInteger(value.observed_at_ms, "status.observed_at_ms");
    if (!Array.isArray(value.units)) throw new TypeError("status.units must be an array");
    if (value.units.length > 128) throw new TypeError("status.units exceeds the 128-unit bound");
    value.units.forEach(validateUnit);
    assertExactKeys(value.delivery_counts, DELIVERY_COUNT_KEYS, "status.delivery_counts");
    for (const key of DELIVERY_COUNT_KEYS) {
      assertInteger(value.delivery_counts[key], `status.delivery_counts.${key}`);
    }
    return value;
  }
  function expectedSignalSide(direction, signalType) {
    if (signalType === "reversal") return direction === "bearish" ? "long" : "short";
    return direction === "bearish" ? "short" : "long";
  }
  function validateEvent(value, index) {
    const name = `events.events[${index}]`;
    assertExactKeys(value, EVENT_KEYS, name);
    assertInteger(value.sequence, `${name}.sequence`, { minimum: 1 });
    if (typeof value.event_id !== "string" || !EVENT_ID_PATTERN.test(value.event_id)) {
      throw new TypeError(`${name}.event_id must be a lowercase hexadecimal event id`);
    }
    assertSchema(value.schema_version, `${name}.schema_version`);
    if (value.strategy_id !== "29") throw new TypeError(`${name}.strategy_id must equal 29`);
    if (value.spec_version !== STRATEGY29_SPEC_VERSION) {
      throw new TypeError(`${name}.spec_version must equal ${STRATEGY29_SPEC_VERSION}`);
    }
    assertCanonicalSymbol(value.symbol, `${name}.symbol`);
    assertEnum(value.timeframe, TIMEFRAMES, `${name}.timeframe`);
    assertEnum(value.setup_direction, DIRECTIONS, `${name}.setup_direction`);
    assertEnum(value.signal_type, SIGNAL_TYPES, `${name}.signal_type`);
    assertEnum(value.signal_side, SIGNAL_SIDES, `${name}.signal_side`);
    if (value.signal_side !== expectedSignalSide(value.setup_direction, value.signal_type)) {
      throw new TypeError(`${name}.signal_side does not match direction and signal type`);
    }
    for (const field of ["setup_open_ms", "bar_open_ms", "bar_close_ms", "detected_at_ms", "warning_open_ms"]) {
      assertInteger(value[field], `${name}.${field}`);
    }
    if (value.bar_close_ms <= value.bar_open_ms) throw new TypeError(`${name}.bar_close_ms must follow bar_open_ms`);
    for (const field of ["close_price", "marker_price", "warning_high", "warning_low"]) {
      assertFiniteNumber(value[field], `${name}.${field}`);
    }
    if (value.warning_high < value.warning_low) throw new TypeError(`${name}.warning_high must not be below warning_low`);
    assertEnum(value.origin, ORIGINS, `${name}.origin`);
    assertEnum(value.delivery_state, DELIVERY_STATES, `${name}.delivery_state`, { nullable: true });
    assertString(value.delivery_failure_reason, `${name}.delivery_failure_reason`, { nullable: true, maximumLength: 512 });
  }
  function validateStrategy29EventsResponse(value, httpStatus) {
    if (httpStatus !== 200) throw new TypeError(`events response requires HTTP 200, received ${httpStatus}`);
    assertExactKeys(value, EVENTS_KEYS, "events response");
    assertSchema(value.schema_version, "events.schema_version");
    if (value.spec_version !== STRATEGY29_SPEC_VERSION) {
      throw new TypeError(`events.spec_version must equal ${STRATEGY29_SPEC_VERSION}`);
    }
    assertInteger(value.observed_at_ms, "events.observed_at_ms");
    assertInteger(value.next_cursor, "events.next_cursor");
    if (typeof value.has_more !== "boolean") throw new TypeError("events.has_more must be boolean");
    if (!Array.isArray(value.events)) throw new TypeError("events.events must be an array");
    if (value.events.length > 200) throw new TypeError("events.events exceeds the 200-event page bound");
    value.events.forEach(validateEvent);
    return value;
  }
  function validateStrategy29GatewayError(value, httpStatus) {
    if (httpStatus === 409) {
      assertExactKeys(value, ["schema_version", "error", "oldest_cursor"], "gateway error");
      assertSchema(value.schema_version, "gateway error.schema_version");
      if (value.error !== "cursor_expired") throw new TypeError("gateway error.error must equal cursor_expired");
      assertInteger(value.oldest_cursor, "gateway error.oldest_cursor");
      return value;
    }
    const expected = /* @__PURE__ */ new Map([[400, "invalid_request"], [401, "unauthorized"], [503, "database_unavailable"]]);
    if (!expected.has(httpStatus)) throw new TypeError(`unsupported gateway HTTP status ${httpStatus}`);
    assertExactKeys(value, ["schema_version", "error"], "gateway error");
    assertSchema(value.schema_version, "gateway error.schema_version");
    if (value.error !== expected.get(httpStatus)) {
      throw new TypeError(`gateway error.error must equal ${expected.get(httpStatus)}`);
    }
    return value;
  }

  // src/binance-strategy29-bollinger/core/remote-summary-client.js
  var Strategy29GatewayTransportError = class extends Error {
    constructor(message) {
      super(message);
      this.name = "Strategy29GatewayTransportError";
    }
  };
  function gatewayAbortError() {
    return new DOMException("Strategy29 gateway request aborted", "AbortError");
  }
  function normalizeStrategy29GatewayOrigin(value) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new TypeError("Strategy29 gateway must be an explicit loopback origin");
    }
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.port === "" || url.username !== "" || url.password !== "" || url.pathname !== "/" || url.search !== "" || url.hash !== "") throw new TypeError("Strategy29 gateway must be an explicit loopback origin");
    return url.origin;
  }
  function parseJsonResponse(response, label) {
    if (!response || !Number.isInteger(response.status) || typeof response.responseText !== "string") {
      throw new Strategy29GatewayTransportError(`${label} returned an invalid transport response`);
    }
    try {
      return JSON.parse(response.responseText);
    } catch {
      throw new TypeError(`${label} returned invalid JSON`);
    }
  }
  function assertConfiguration({ request, authSecret, canonicalSymbol, maxPagesPerPoll, onStatus, onEvents, onCursorReset }) {
    if (typeof request !== "function") throw new TypeError("request must be a function");
    if (typeof authSecret !== "string" || authSecret.length === 0) throw new TypeError("authSecret must be non-empty");
    if (typeof canonicalSymbol !== "string" || !/^[A-Z0-9]+\/USDT:USDT$/.test(canonicalSymbol)) {
      throw new TypeError("canonicalSymbol must use canonical symbol format");
    }
    if (!Number.isInteger(maxPagesPerPoll) || maxPagesPerPoll < 1 || maxPagesPerPoll > 10) {
      throw new TypeError("maxPagesPerPoll must be between 1 and 10");
    }
    for (const [name, callback] of Object.entries({ onStatus, onEvents, onCursorReset })) {
      if (typeof callback !== "function") throw new TypeError(`${name} must be a function`);
    }
  }
  function buildEventsUrl(origin, canonicalSymbol, cursor) {
    const url = new URL("/v1/strategy29/events", origin);
    url.searchParams.set("symbol", canonicalSymbol);
    if (cursor !== null) url.searchParams.set("cursor", String(cursor));
    return url.href;
  }
  function createStrategy29SummaryClient({
    request,
    gatewayOrigin,
    authSecret,
    canonicalSymbol,
    maxPagesPerPoll = 2,
    onStatus,
    onEvents,
    onCursorReset
  }) {
    const origin = normalizeStrategy29GatewayOrigin(gatewayOrigin);
    assertConfiguration({ request, authSecret, canonicalSymbol, maxPagesPerPoll, onStatus, onEvents, onCursorReset });
    let cursor = null;
    async function perform(url, signal) {
      if (!signal || typeof signal.aborted !== "boolean" || typeof signal.addEventListener !== "function") {
        throw new TypeError("poll requires an AbortSignal");
      }
      if (signal.aborted) throw signal.reason;
      return request({ url, authSecret, signal });
    }
    async function poll(signal) {
      const statusResponse = await perform(`${origin}/v1/strategy29/status`, signal);
      const statusBody = parseJsonResponse(statusResponse, "Strategy29 status");
      if (statusResponse.status === 503) {
        validateStrategy29GatewayError(statusBody, 503);
        return { state: "unavailable", pages: 0, hasMore: false };
      }
      if (statusResponse.status !== 200) {
        validateStrategy29GatewayError(statusBody, statusResponse.status);
        throw new Error(`Strategy29 status request failed with HTTP ${statusResponse.status}`);
      }
      const status = validateStrategy29StatusResponse(statusBody, 200);
      onStatus(status);
      if (status.spec_version !== STRATEGY29_SPEC_VERSION) {
        return { state: "incompatible", pages: 0, hasMore: false };
      }
      let pages = 0;
      let hasMore = false;
      while (pages < maxPagesPerPoll) {
        const requestedCursor = cursor;
        const eventsResponse = await perform(buildEventsUrl(origin, canonicalSymbol, cursor), signal);
        const eventsBody = parseJsonResponse(eventsResponse, "Strategy29 events");
        pages += 1;
        if (eventsResponse.status === 409) {
          const error = validateStrategy29GatewayError(eventsBody, 409);
          cursor = error.oldest_cursor;
          onCursorReset(cursor);
          hasMore = true;
          continue;
        }
        if (eventsResponse.status === 503) {
          validateStrategy29GatewayError(eventsBody, 503);
          return { state: "unavailable", pages, hasMore: false };
        }
        if (eventsResponse.status !== 200) {
          validateStrategy29GatewayError(eventsBody, eventsResponse.status);
          throw new Error(`Strategy29 events request failed with HTTP ${eventsResponse.status}`);
        }
        const page = validateStrategy29EventsResponse(eventsBody, 200);
        if (requestedCursor !== null && page.next_cursor < requestedCursor) {
          throw new TypeError("Strategy29 event cursor moved backwards");
        }
        if (page.has_more && (requestedCursor === null ? page.next_cursor <= 0 : page.next_cursor <= requestedCursor)) {
          throw new TypeError("Strategy29 event cursor did not advance while has_more is true");
        }
        let previousSequence = requestedCursor;
        for (const event of page.events) {
          if (event.symbol !== canonicalSymbol) throw new TypeError("Strategy29 event symbol does not match the requested symbol");
          if (previousSequence !== null && event.sequence <= previousSequence) {
            throw new TypeError("Strategy29 event sequences must advance strictly");
          }
          if (event.sequence > page.next_cursor) throw new TypeError("Strategy29 event sequence exceeds next_cursor");
          previousSequence = event.sequence;
        }
        onEvents(page.events, page.observed_at_ms);
        cursor = page.next_cursor;
        hasMore = page.has_more;
        if (!hasMore) break;
      }
      return { state: "connected", pages, hasMore };
    }
    return Object.freeze({
      poll,
      get diagnostics() {
        return Object.freeze({ cursor });
      }
    });
  }
  function createStrategy29GmJsonRequest(gmXmlHttpRequest, timeoutMs = 1e4) {
    if (typeof gmXmlHttpRequest !== "function") throw new TypeError("GM_xmlhttpRequest must be a function");
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new TypeError("timeoutMs must be a positive integer");
    return ({ url, authSecret, signal }) => new Promise((resolve, reject) => {
      let settled = false;
      function finish(callback, value) {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        callback(value);
      }
      let request;
      function onAbort() {
        request.abort();
        finish(reject, signal.reason ?? gatewayAbortError());
      }
      try {
        request = gmXmlHttpRequest({
          method: "GET",
          url,
          headers: { Authorization: `Bearer ${authSecret}` },
          timeout: timeoutMs,
          onload: (response) => finish(resolve, response),
          onerror: () => finish(reject, new Strategy29GatewayTransportError("Strategy29 gateway transport failure")),
          ontimeout: () => finish(reject, new Strategy29GatewayTransportError("Strategy29 gateway transport timeout")),
          onabort: () => finish(reject, signal.reason ?? gatewayAbortError())
        });
      } catch {
        finish(reject, new Strategy29GatewayTransportError("Strategy29 gateway transport initialization failed"));
        return;
      }
      if (settled) return;
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
  }

  // src/binance-strategy29-bollinger/core/bearish-bollinger-pattern.js
  var BOLLINGER_PATTERN = Object.freeze({
    bollingerPeriod: 20,
    bollingerStdDev: 2,
    maPeriod: 60,
    preCrossBars: 8,
    minPreCrossChannelCloses: 4,
    maxPreCrossAboveMiddleCloses: 1,
    maxPreCrossBelowLowerCloses: 3,
    trendLookbackBars: 3,
    minMiddleDeclineBandFraction: 0.01,
    postCrossBars: 20,
    middleApproachBandFraction: 0.12,
    maxPostCrossCloseAboveMiddleBandFraction: 0.05,
    lowerTouchBandFraction: 0.05,
    reversalFollowBars: 60
  });
  var TradingViewBarSnapshotInconsistentError = class extends Error {
    constructor(message) {
      super(message);
      this.name = "TradingViewBarSnapshotInconsistentError";
    }
  };
  function isTradingViewBarSnapshotInconsistentError(error) {
    return error instanceof TradingViewBarSnapshotInconsistentError;
  }
  function applyBollingerAlertTaskFailure(context, error) {
    if (!context || typeof context !== "object" || typeof context.failed !== "boolean" || typeof context.cleanupPending !== "boolean") {
      throw new Error("Bollinger alert task context is invalid");
    }
    if (isTradingViewBarSnapshotInconsistentError(error)) return "retry";
    context.failed = true;
    context.cleanupPending = true;
    return "fatal";
  }
  function assertFiniteNumber2(value, label) {
    if (!Number.isFinite(value)) throw new Error(`${label} is invalid`);
  }
  function assertBars(bars, directionLabel) {
    if (!Array.isArray(bars)) throw new Error(`${directionLabel} Bollinger bars must be an array`);
    let previousTime = -Infinity;
    for (const [index, bar] of bars.entries()) {
      if (!bar || typeof bar !== "object") {
        throw new Error(`${directionLabel} Bollinger bar ${index} is invalid`);
      }
      if (!Number.isInteger(bar.time)) {
        throw new Error(`${directionLabel} Bollinger bar time ${index} is invalid`);
      }
      if (bar.time <= previousTime) {
        throw new TradingViewBarSnapshotInconsistentError(
          `${directionLabel} Bollinger bar time ${index} is invalid`
        );
      }
      for (const field of ["open", "high", "low", "close"]) {
        assertFiniteNumber2(bar[field], `${directionLabel} Bollinger bar ${index} ${field}`);
      }
      if (bar.high < bar.low || bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close)) {
        throw new TradingViewBarSnapshotInconsistentError(
          `${directionLabel} Bollinger bar ${index} OHLC range is invalid`
        );
      }
      previousTime = bar.time;
    }
  }
  function assertIndicatorBars(indicatorBars, directionLabel) {
    if (!Array.isArray(indicatorBars)) {
      throw new Error(`${directionLabel} Bollinger indicator bars must be an array`);
    }
    assertBars(indicatorBars, directionLabel);
    for (const [index, bar] of indicatorBars.entries()) {
      const fields = ["middle", "upper", "lower", "ma60"];
      const nullFields = fields.filter((field) => bar[field] === null);
      if (nullFields.length !== 0 && nullFields.length !== fields.length) {
        throw new Error(`${directionLabel} Bollinger indicator bar ${index} is incomplete`);
      }
      for (const field of fields) {
        if (bar[field] !== null) {
          assertFiniteNumber2(
            bar[field],
            `${directionLabel} Bollinger indicator bar ${index} ${field}`
          );
        }
      }
    }
  }
  function calculateBollingerIndicatorBars(bars, directionLabel) {
    assertBars(bars, directionLabel);
    const config = BOLLINGER_PATTERN;
    return bars.map((bar, index) => {
      if (index < config.maPeriod - 1) {
        return { ...bar, middle: null, upper: null, lower: null, ma60: null };
      }
      const start = index - config.bollingerPeriod + 1;
      let closeSum = 0;
      for (let cursor = start; cursor <= index; cursor += 1) closeSum += bars[cursor].close;
      const middle = closeSum / config.bollingerPeriod;
      let squaredDeviationSum = 0;
      for (let cursor = start; cursor <= index; cursor += 1) {
        squaredDeviationSum += (bars[cursor].close - middle) ** 2;
      }
      const deviation = Math.sqrt(squaredDeviationSum / config.bollingerPeriod) * config.bollingerStdDev;
      let maSum = 0;
      for (let cursor = index - config.maPeriod + 1; cursor <= index; cursor += 1) maSum += bars[cursor].close;
      return {
        ...bar,
        middle,
        upper: middle + deviation,
        lower: middle - deviation,
        ma60: maSum / config.maPeriod
      };
    });
  }
  function bandWidth(bar) {
    const width = bar.upper - bar.lower;
    if (!(width > 0)) throw new Error(`Bollinger band width is invalid at ${bar.time}`);
    return width;
  }
  function hasDownwardBandCenter(indicatorBars, index) {
    const { trendLookbackBars, minMiddleDeclineBandFraction } = BOLLINGER_PATTERN;
    const current = indicatorBars[index];
    const earlier = indicatorBars[index - trendLookbackBars];
    const averageWidth = (bandWidth(current) + bandWidth(earlier)) / 2;
    return (earlier.middle - current.middle) / averageWidth >= minMiddleDeclineBandFraction;
  }
  function isRejectedAboveMiddleClose(indicatorBars, index) {
    const next = indicatorBars[index + 1];
    return next.close < next.middle && next.close < next.open;
  }
  function matchesPreCrossCompression(indicatorBars, crossIndex) {
    const config = BOLLINGER_PATTERN;
    const start = crossIndex - config.preCrossBars;
    const preCross = indicatorBars.slice(start, crossIndex);
    const channelCloses = preCross.filter(
      (bar) => bar.close >= bar.lower && bar.close <= bar.middle
    ).length;
    const aboveMiddleIndexes = [];
    let belowLowerCloses = 0;
    for (let offset = 0; offset < preCross.length; offset += 1) {
      const bar = preCross[offset];
      if (bar.close > bar.middle) aboveMiddleIndexes.push(start + offset);
      if (bar.close < bar.lower) belowLowerCloses += 1;
    }
    return channelCloses >= config.minPreCrossChannelCloses && aboveMiddleIndexes.length <= config.maxPreCrossAboveMiddleCloses && belowLowerCloses <= config.maxPreCrossBelowLowerCloses && aboveMiddleIndexes.every((index) => isRejectedAboveMiddleClose(indicatorBars, index));
  }
  function isDownwardCross(previous, current) {
    return previous.middle >= previous.ma60 && current.middle < current.ma60;
  }
  function buildSignal(type, setup, bar) {
    const width = bandWidth(bar);
    const markerGapFraction = type === "warning" ? 0.06 : 0.1;
    return Object.freeze({
      id: `${setup.time}:${type}`,
      type,
      setupTime: setup.time,
      time: bar.time,
      markerPrice: type === "reversal" ? bar.low - width * markerGapFraction : bar.high + width * markerGapFraction
    });
  }
  function detectReversalSignal(indicatorBars, setup, warningIndex) {
    const { reversalFollowBars } = BOLLINGER_PATTERN;
    const warning = indicatorBars[warningIndex];
    const endIndex = Math.min(
      indicatorBars.length - 1,
      warningIndex + reversalFollowBars
    );
    for (let index = warningIndex + 1; index <= endIndex; index += 1) {
      const bar = indicatorBars[index];
      if (bar.close > warning.high) return buildSignal("reversal", setup, bar);
    }
    return null;
  }
  function detectSetupSignals(indicatorBars, crossIndex) {
    const config = BOLLINGER_PATTERN;
    const setup = indicatorBars[crossIndex];
    const signals = [];
    let warningIndex = null;
    let pendingMiddleRejection = false;
    let aboveMiddleCloseCount = 0;
    const endIndex = Math.min(
      indicatorBars.length - 1,
      crossIndex + config.postCrossBars
    );
    for (let index = crossIndex + 1; index <= endIndex; index += 1) {
      const bar = indicatorBars[index];
      const width = bandWidth(bar);
      if (pendingMiddleRejection) {
        if (!(bar.close < bar.middle && bar.close < bar.open)) break;
        pendingMiddleRejection = false;
      }
      if (bar.close > bar.middle) {
        aboveMiddleCloseCount += 1;
        if (aboveMiddleCloseCount > 1 || bar.close > bar.middle + width * config.maxPostCrossCloseAboveMiddleBandFraction || bar.close > bar.upper) break;
        pendingMiddleRejection = true;
        continue;
      }
      const bandStillDown = bar.middle < setup.middle && hasDownwardBandCenter(indicatorBars, index);
      if (!bandStillDown) continue;
      if (warningIndex === null && bar.high >= bar.middle - width * config.middleApproachBandFraction) {
        warningIndex = index;
        signals.push(buildSignal("warning", setup, bar));
        continue;
      }
      if (warningIndex !== null && index > warningIndex && bar.close < bar.open && bar.low <= bar.lower + width * config.lowerTouchBandFraction) {
        signals.push(buildSignal("confirmed", setup, bar));
        break;
      }
    }
    if (warningIndex !== null) {
      const reversal = detectReversalSignal(indicatorBars, setup, warningIndex);
      if (reversal) signals.push(reversal);
    }
    return signals;
  }
  function appendSetupSignals(signals, setupSignals) {
    for (const signal of setupSignals) {
      if (signal.type !== "reversal") {
        signals.push(signal);
        continue;
      }
      const duplicateIndex = signals.findIndex(
        (existing) => existing.type === "reversal" && existing.time === signal.time
      );
      if (duplicateIndex === -1) {
        signals.push(signal);
        continue;
      }
      if (signal.setupTime > signals[duplicateIndex].setupTime) {
        signals[duplicateIndex] = signal;
      }
    }
  }
  function detectBearishBollingerSignalsFromIndicatorBarsInternal(indicatorBars) {
    const config = BOLLINGER_PATTERN;
    const firstCrossIndex = Math.max(
      config.maPeriod,
      config.maPeriod - 1 + config.preCrossBars,
      config.trendLookbackBars
    );
    const signals = [];
    for (let index = firstCrossIndex; index < indicatorBars.length; index += 1) {
      const previous = indicatorBars[index - 1];
      const current = indicatorBars[index];
      if (!isDownwardCross(previous, current)) continue;
      if (!hasDownwardBandCenter(indicatorBars, index)) continue;
      if (!matchesPreCrossCompression(indicatorBars, index)) continue;
      appendSetupSignals(signals, detectSetupSignals(indicatorBars, index));
    }
    const typeOrder = { warning: 0, confirmed: 1, reversal: 2 };
    return signals.sort(
      (left, right) => left.time - right.time || typeOrder[left.type] - typeOrder[right.type]
    );
  }
  function mirrorIndicatorBar(bar) {
    return {
      ...bar,
      open: -bar.open,
      high: -bar.low,
      low: -bar.high,
      close: -bar.close,
      middle: bar.middle === null ? null : -bar.middle,
      upper: bar.upper === null ? null : -bar.lower,
      lower: bar.lower === null ? null : -bar.upper,
      ma60: bar.ma60 === null ? null : -bar.ma60
    };
  }
  function mapMirroredBullishSignal(signal) {
    return Object.freeze({
      ...signal,
      id: `${signal.setupTime}:bullish:${signal.type}`,
      direction: "bullish",
      markerPrice: -signal.markerPrice
    });
  }
  function detectBullishBollingerSignalsFromIndicatorBarsInternal(indicatorBars) {
    return detectBearishBollingerSignalsFromIndicatorBarsInternal(
      indicatorBars.map(mirrorIndicatorBar)
    ).map(mapMirroredBullishSignal);
  }
  function compareBollingerSignals(left, right) {
    const directionOrder = { bearish: 0, bullish: 1 };
    const typeOrder = { warning: 0, confirmed: 1, reversal: 2 };
    const leftDirectionOrder = directionOrder[left.direction];
    const rightDirectionOrder = directionOrder[right.direction];
    if (leftDirectionOrder === void 0 || rightDirectionOrder === void 0) {
      throw new Error("Bollinger signal direction is invalid");
    }
    return left.time - right.time || leftDirectionOrder - rightDirectionOrder || typeOrder[left.type] - typeOrder[right.type];
  }
  function detectBollingerSignalsFromIndicatorBars(indicatorBars) {
    assertIndicatorBars(indicatorBars, "Bollinger");
    const bearishSignals = detectBearishBollingerSignalsFromIndicatorBarsInternal(indicatorBars).map((signal) => Object.freeze({ ...signal, direction: "bearish" }));
    const bullishSignals = detectBullishBollingerSignalsFromIndicatorBarsInternal(indicatorBars);
    return [...bearishSignals, ...bullishSignals].sort(compareBollingerSignals);
  }
  function detectBollingerSignals(bars) {
    return detectBollingerSignalsFromIndicatorBars(
      calculateBollingerIndicatorBars(bars, "Bollinger")
    );
  }

  // src/shared/tradingview-target.js
  var CHART_ROOT_SELECTOR = ".chart-widget-root";
  function hasVisibleBox(element2) {
    if (!element2?.getClientRects().length) return false;
    const rect = element2.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  function findBinanceTradingViewTarget(document) {
    const chartRoots = Array.from(document.querySelectorAll(CHART_ROOT_SELECTOR)).filter(hasVisibleBox);
    if (!chartRoots.length) return null;
    if (chartRoots.length > 1) {
      throw new Error(`可见图表区域数量异常：${chartRoots.length}`);
    }
    const chartRoot = chartRoots[0];
    const tradingViewApis = Array.from(chartRoot.querySelectorAll("iframe")).map((frame) => frame.contentWindow?.tradingViewApi).filter(Boolean);
    if (!tradingViewApis.length) return null;
    if (tradingViewApis.length > 1) {
      throw new Error(`图表接口数量异常：${tradingViewApis.length}`);
    }
    return { chartRoot, tradingViewApi: tradingViewApis[0] };
  }

  // src/shared/abort.js
  function getAbortReason(signal) {
    if (signal?.reason instanceof Error) return signal.reason;
    const error = new Error("Operation aborted");
    error.name = "AbortError";
    return error;
  }
  function throwIfAborted(signal) {
    if (signal?.aborted) throw getAbortReason(signal);
  }
  function waitForPromiseOrAbort(task, signal) {
    if (!signal) return Promise.resolve(task);
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        callback(value);
      };
      const onAbort = () => finish(reject, getAbortReason(signal));
      signal.addEventListener("abort", onAbort, { once: true });
      Promise.resolve(task).then(
        (value) => finish(resolve, value),
        (error) => finish(reject, error)
      );
    });
  }

  // src/shared/chart-marker-save-controller.js
  var CONTROLLER_SLOT = Symbol.for("jh-userscripts.chart-marker-save-controller");
  var PROTOCOL_VERSION = 1;
  function readController(api) {
    const record = api[CONTROLLER_SLOT];
    if (record === void 0) return null;
    if (record.version !== PROTOCOL_VERSION || typeof record.controller?.runAfterIdle !== "function") {
      throw new Error("Incompatible TradingView marker save protocol; update both scripts and reload");
    }
    return record.controller;
  }
  var QUIET_MS = 150;
  var MAX_BURST_MS = 1e3;
  var DRAIN_TIMEOUT_MS = 2e3;
  function installTradingViewMarkerSaveController(api, {
    onError = (error) => {
      throw error;
    },
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout
  } = {}) {
    const existing = readController(api);
    if (existing) return existing;
    if (typeof api?.saveChart !== "function") {
      throw new Error("TradingView marker save API is unavailable");
    }
    const originalSaveChart = api.saveChart;
    let burst = null;
    let tailTimer = null;
    let mutations = 0;
    let draining = 0;
    let saveRequests = 0;
    let serializations = 0;
    let callbackCount = 0;
    let failureCount = 0;
    const idleWaiters = /* @__PURE__ */ new Set();
    const busy = () => burst !== null || mutations !== 0 || tailTimer !== null;
    function notifyIdle() {
      if (busy()) return;
      for (const resolve of idleWaiters) resolve();
      idleWaiters.clear();
    }
    function reportErrors(errors) {
      if (errors.length === 0) return;
      failureCount += errors.length;
      setTimeoutFn(() => onError(new AggregateError(errors, "TradingView marker save burst failed")), 0);
    }
    function flush() {
      const pending = burst;
      if (!pending) return;
      burst = null;
      clearTimeoutFn(pending.quietTimer);
      clearTimeoutFn(pending.maxTimer);
      const errors = [];
      try {
        if (pending.callbacks.length > 0) {
          serializations += 1;
          originalSaveChart.call(api, (snapshot) => {
            const json = JSON.stringify(snapshot);
            for (const callback of pending.callbacks) {
              try {
                callbackCount += 1;
                callback(JSON.parse(json));
              } catch (error) {
                errors.push(error);
              }
            }
          });
        }
      } catch (error) {
        errors.push(error);
      } finally {
        pending.callbacks.length = 0;
        notifyIdle();
        reportErrors(errors);
      }
    }
    function scheduleQuiet() {
      clearTimeoutFn(burst.quietTimer);
      burst.quietTimer = setTimeoutFn(flush, QUIET_MS);
    }
    function markMutation() {
      if (tailTimer !== null) clearTimeoutFn(tailTimer);
      tailTimer = setTimeoutFn(() => {
        tailTimer = null;
        notifyIdle();
      }, QUIET_MS);
      if (!burst) {
        burst = { callbacks: [], quietTimer: null, maxTimer: setTimeoutFn(flush, MAX_BURST_MS) };
      }
      scheduleQuiet();
    }
    function markerSaveChart(...args) {
      const defaultCall = this === api && args.length <= 2 && typeof args[0] === "function" && args[1] === void 0;
      if (api.saveChart !== markerSaveChart || !defaultCall) {
        flush();
        return originalSaveChart.apply(this, args);
      }
      if (!burst) return originalSaveChart.apply(this, args);
      saveRequests += 1;
      burst.callbacks.push(args[0]);
      scheduleQuiet();
      return void 0;
    }
    api.saveChart = markerSaveChart;
    if (api.saveChart !== markerSaveChart) {
      throw new Error("TradingView marker save wrapper could not be installed");
    }
    const controller = Object.freeze({
      canMutate: () => draining === 0 && api.saveChart === markerSaveChart,
      beginMutation() {
        if (!controller.canMutate()) {
          throw new Error("TradingView marker mutation overlaps a chart save owner");
        }
        mutations += 1;
        markMutation();
        let finished = false;
        return () => {
          if (finished) throw new Error("TradingView marker mutation finished twice");
          finished = true;
          mutations -= 1;
          markMutation();
        };
      },
      async runAfterIdle(action, { signal } = {}) {
        throwIfAborted(signal);
        draining += 1;
        let timeout = null;
        let wake = null;
        try {
          if (busy()) {
            await waitForPromiseOrAbort(new Promise((resolve, reject) => {
              wake = resolve;
              idleWaiters.add(wake);
              timeout = setTimeoutFn(() => {
                const error = new Error("TradingView marker saves did not finish before the chart operation");
                error.name = "TradingViewMarkerSaveDrainTimeoutError";
                reject(error);
              }, DRAIN_TIMEOUT_MS);
            }), signal);
          }
          if (busy()) throw new Error("TradingView marker save drain was invalidated");
          throwIfAborted(signal);
          return await action();
        } finally {
          if (timeout !== null) clearTimeoutFn(timeout);
          if (wake !== null) idleWaiters.delete(wake);
          draining -= 1;
        }
      },
      getStats: () => ({
        busy: busy(),
        mutations,
        draining,
        saveRequests,
        serializations,
        callbackCount,
        failureCount,
        pendingCallbacks: burst?.callbacks.length || 0
      })
    });
    Object.defineProperty(api, CONTROLLER_SLOT, { value: Object.freeze({ version: PROTOCOL_VERSION, controller }) });
    return controller;
  }

  // src/binance-strategy29-bollinger/dom/tradingview-bearish-alerts.js
  var MAX_BOLLINGER_MARKERS_PER_DIRECTION = 1e3;
  var MAX_BOLLINGER_MARKERS = MAX_BOLLINGER_MARKERS_PER_DIRECTION * 2;
  function routeSymbolFromChartSymbol(value) {
    return String(value || "").split("@", 1)[0];
  }
  function assertChartContract(chart) {
    for (const method of [
      "createShape",
      "dataReady",
      "exportData",
      "getAllShapes",
      "getShapeById",
      "hasModel",
      "onDataLoaded",
      "onIntervalChanged",
      "removeEntity",
      "resolution",
      "symbol"
    ]) {
      if (typeof chart?.[method] !== "function") {
        throw new Error(`TradingView Bollinger alert method is unavailable: ${method}`);
      }
    }
  }
  function readLiveShapes(chart) {
    const shapes = chart.getAllShapes();
    if (!Array.isArray(shapes)) {
      throw new Error("TradingView Bollinger alert shape list is invalid");
    }
    const ids = /* @__PURE__ */ new Map();
    for (const [index, shape] of shapes.entries()) {
      if (typeof shape?.id !== "string" || shape.id.length === 0 || typeof shape.name !== "string") {
        throw new Error(`TradingView Bollinger alert shape ${index} id is invalid`);
      }
      ids.set(shape.id, shape.name);
    }
    return ids;
  }
  function tradingViewResolutionToSeconds(resolution) {
    const value = String(resolution || "").toUpperCase();
    const units = [
      { pattern: /^(\d+)S$/, seconds: 1 },
      { pattern: /^(\d+)$/, seconds: 60 },
      { pattern: /^(\d+)H$/, seconds: 60 * 60 },
      { pattern: /^(\d+)D$/, seconds: 24 * 60 * 60 },
      { pattern: /^(\d+)W$/, seconds: 7 * 24 * 60 * 60 }
    ];
    for (const { pattern, seconds } of units) {
      const match = value.match(pattern);
      if (!match) continue;
      const count = Number(match[1]);
      if (Number.isSafeInteger(count) && count > 0) return count * seconds;
    }
    throw new Error(`TradingView Bollinger alert resolution is unsupported: ${resolution}`);
  }
  function bollingerIntervalVisibility(resolution) {
    const seconds = tradingViewResolutionToSeconds(resolution);
    const value = String(resolution).toUpperCase();
    const visibility = {
      ticks: false,
      seconds: false,
      minutes: false,
      hours: false,
      days: false,
      weeks: false,
      months: false,
      ranges: false
    };
    let unit;
    let count;
    if (value.endsWith("W")) {
      unit = "weeks";
      count = seconds / 604800;
    } else if (value.endsWith("D")) {
      unit = "days";
      count = seconds / 86400;
    } else if (seconds < 60) {
      unit = "seconds";
      count = seconds;
    } else if (value.endsWith("S") || seconds < 3600) {
      unit = "minutes";
      count = Math.floor(seconds / 60);
    } else {
      unit = "hours";
      count = Math.floor(seconds / 3600);
    }
    visibility[unit] = true;
    visibility[`${unit}From`] = count;
    visibility[`${unit}To`] = count;
    return visibility;
  }
  function createBollingerIntervalSession(chart) {
    const intervalChanged = chart.onIntervalChanged();
    const dataLoaded = chart.onDataLoaded();
    for (const subscription of [intervalChanged, dataLoaded]) {
      if (typeof subscription?.subscribe !== "function" || typeof subscription.unsubscribe !== "function") {
        throw new Error("TradingView Bollinger interval subscription is unavailable");
      }
    }
    let revision = 0;
    let disposed = false;
    let awaitingData = !chart.dataReady();
    const owner = {};
    function invalidate() {
      revision += 1;
      awaitingData = true;
    }
    function complete() {
      awaitingData = false;
    }
    intervalChanged.subscribe(owner, invalidate);
    dataLoaded.subscribe(owner, complete);
    return Object.freeze({
      get revision() {
        return revision;
      },
      isCurrent(candidate) {
        return !disposed && !awaitingData && candidate === revision && chart.dataReady();
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        revision += 1;
        intervalChanged.unsubscribe(owner, invalidate);
        dataLoaded.unsubscribe(owner, complete);
      }
    });
  }
  function findBearishBollingerChartTarget(document, expectedRouteSymbol) {
    const baseTarget = findBinanceTradingViewTarget(document);
    if (!baseTarget) return null;
    const chart = baseTarget.tradingViewApi.activeChart?.();
    if (!chart) return null;
    assertChartContract(chart);
    if (!chart.hasModel()) return null;
    const resolution = chart.resolution();
    const resolutionSeconds = tradingViewResolutionToSeconds(resolution);
    const routeSymbol = routeSymbolFromChartSymbol(chart.symbol());
    if (routeSymbol !== expectedRouteSymbol) {
      throw new Error(
        `TradingView Bollinger alert symbol mismatch: expected ${expectedRouteSymbol}, received ${routeSymbol}`
      );
    }
    return {
      ...baseTarget,
      chart,
      resolution,
      resolutionSeconds,
      routeSymbol
    };
  }
  function isBearishBollingerChartTargetCurrent(document, target) {
    const baseTarget = findBinanceTradingViewTarget(document);
    if (!baseTarget) return false;
    const chart = baseTarget.tradingViewApi.activeChart?.();
    if (!chart) return false;
    assertChartContract(chart);
    if (!chart.hasModel()) return false;
    return baseTarget.chartRoot === target.chartRoot && baseTarget.tradingViewApi === target.tradingViewApi && chart === target.chart && chart.resolution() === target.resolution && routeSymbolFromChartSymbol(chart.symbol()) === target.routeSymbol;
  }
  function assertExportSchema(schema) {
    if (!Array.isArray(schema)) throw new Error("TradingView Bollinger alert export schema is invalid");
    const fields = schema.map((column) => column.plotTitle || column.type);
    const expected = ["time", "open", "high", "low", "close"];
    if (fields.length !== expected.length || fields.some((field, index) => field !== expected[index])) {
      throw new Error(`TradingView Bollinger alert export schema mismatch: ${fields.join(",")}`);
    }
  }
  function parseExportRow(row, index) {
    if (!row || typeof row !== "object") {
      throw new Error(`TradingView Bollinger alert export row ${index} is invalid`);
    }
    const bar = {
      time: row[0],
      open: row[1],
      high: row[2],
      low: row[3],
      close: row[4]
    };
    if (!Number.isInteger(bar.time)) {
      throw new Error(`TradingView Bollinger alert export time ${index} is invalid`);
    }
    for (const field of ["open", "high", "low", "close"]) {
      if (!Number.isFinite(bar[field])) {
        throw new Error(`TradingView Bollinger alert export ${field} ${index} is invalid`);
      }
    }
    return bar;
  }
  function parseClosedTradingViewBars(exported, { resolutionSeconds, observedAtSeconds, resolution }) {
    if (!Number.isSafeInteger(resolutionSeconds) || resolutionSeconds < 1) {
      throw new Error("TradingView Bollinger alert resolution seconds are invalid");
    }
    if (!Number.isFinite(observedAtSeconds)) {
      throw new Error("TradingView Bollinger alert observation time is invalid");
    }
    assertExportSchema(exported?.schema);
    if (!Array.isArray(exported.data)) {
      throw new Error("TradingView Bollinger alert export data is invalid");
    }
    const bars = exported.data.map(parseExportRow);
    const gridSeconds = Math.min(resolutionSeconds, 86400);
    for (const [index, bar] of bars.entries()) {
      if (bar.time % gridSeconds !== 0 || String(resolution).toUpperCase().endsWith("W") && new Date(bar.time * 1e3).getUTCDay() !== 1) {
        throw new TradingViewBarSnapshotInconsistentError(
          `TradingView Bollinger alert export interval grid is invalid at ${index}`
        );
      }
    }
    for (let index = 1; index < bars.length; index += 1) {
      if (bars[index].time <= bars[index - 1].time) {
        throw new TradingViewBarSnapshotInconsistentError(
          `TradingView Bollinger alert export order is invalid at ${index}`
        );
      }
      if ((bars[index].time - bars[index - 1].time) % resolutionSeconds !== 0) {
        throw new TradingViewBarSnapshotInconsistentError(
          `TradingView Bollinger alert export interval spacing is invalid at ${index}`
        );
      }
    }
    return bars.filter((bar) => bar.time + resolutionSeconds <= observedAtSeconds);
  }
  function buildClosedBarsWindowKey(bars) {
    if (!Array.isArray(bars) || bars.length === 0) {
      throw new Error("TradingView Bollinger alert closed-bar window is empty");
    }
    return `${bars.length}:${bars[0].time}:${bars.at(-1).time}`;
  }
  function writeClosedBarToSnapshot(values, offset, bar, index) {
    if (!bar || typeof bar !== "object") {
      throw new Error(`TradingView Bollinger closed bar ${index} is invalid`);
    }
    if (!Number.isInteger(bar.time)) {
      throw new Error(`TradingView Bollinger closed bar time ${index} is invalid`);
    }
    const fields = ["open", "high", "low", "close"];
    for (const field of fields) {
      if (!Number.isFinite(bar[field])) {
        throw new Error(`TradingView Bollinger closed bar ${field} ${index} is invalid`);
      }
    }
    values[offset] = bar.time;
    values[offset + 1] = bar.open;
    values[offset + 2] = bar.high;
    values[offset + 3] = bar.low;
    values[offset + 4] = bar.close;
  }
  function buildClosedBarsContentSnapshot(bars) {
    const windowKey = buildClosedBarsWindowKey(bars);
    const values = new Float64Array(bars.length * 5);
    for (let index = 0; index < bars.length; index += 1) {
      writeClosedBarToSnapshot(values, index * 5, bars[index], index);
    }
    return { windowKey, values };
  }
  function matchesClosedBarsContentSnapshot(bars, snapshot) {
    if (!snapshot || typeof snapshot !== "object" || typeof snapshot.windowKey !== "string" || !(snapshot.values instanceof Float64Array)) {
      throw new Error("TradingView Bollinger closed-bar snapshot is invalid");
    }
    if (buildClosedBarsWindowKey(bars) !== snapshot.windowKey) return false;
    if (snapshot.values.length !== bars.length * 5) return false;
    const candidate = new Float64Array(5);
    for (let index = 0; index < bars.length; index += 1) {
      writeClosedBarToSnapshot(candidate, 0, bars[index], index);
      const offset = index * 5;
      for (let fieldIndex = 0; fieldIndex < candidate.length; fieldIndex += 1) {
        if (!Object.is(snapshot.values[offset + fieldIndex], candidate[fieldIndex])) return false;
      }
    }
    return true;
  }
  async function reconcileBearishBollingerAlertWindow({
    bars,
    cachedWindowKey,
    cachedContentSnapshot = null,
    cachedSignals,
    detectSignals,
    renderSignals
  }) {
    if (typeof detectSignals !== "function") {
      throw new Error("TradingView Bollinger alert detector is unavailable");
    }
    if (typeof renderSignals !== "function") {
      throw new Error("TradingView Bollinger alert renderer is unavailable");
    }
    const closedBarsWindowKey = buildClosedBarsWindowKey(bars);
    const contentUnchanged = closedBarsWindowKey === cachedWindowKey && cachedContentSnapshot !== null && matchesClosedBarsContentSnapshot(bars, cachedContentSnapshot);
    const signals = contentUnchanged ? cachedSignals : detectSignals(bars);
    if (!Array.isArray(signals)) {
      throw new Error("Bollinger signal cache is invalid");
    }
    const rendered = await renderSignals(signals);
    if (typeof rendered !== "boolean") {
      throw new Error("TradingView Bollinger alert render result is invalid");
    }
    return {
      rendered,
      closedBarsWindowKey,
      closedBarsContentSnapshot: contentUnchanged ? cachedContentSnapshot : buildClosedBarsContentSnapshot(bars),
      signals
    };
  }
  async function exportClosedTradingViewBars(target, session, observedAtMs = Date.now()) {
    const revision = session.revision;
    const isCurrent = () => session.isCurrent(revision) && target.chart.resolution() === target.resolution && routeSymbolFromChartSymbol(target.chart.symbol()) === target.routeSymbol;
    if (!isCurrent()) return null;
    const exported = await target.chart.exportData({ includedStudies: [] });
    if (!isCurrent()) return null;
    return parseClosedTradingViewBars(exported, {
      resolutionSeconds: target.resolutionSeconds,
      resolution: target.resolution,
      observedAtSeconds: observedAtMs / 1e3
    });
  }
  function markerOptions(signal, resolution) {
    const direction = signal.direction;
    if (direction !== "bearish" && direction !== "bullish") {
      throw new Error(`TradingView Bollinger alert signal direction is invalid: ${direction}`);
    }
    const isBullish = direction === "bullish";
    const common = {
      lock: true,
      disableSave: true,
      disableSelection: true,
      disableUndo: true,
      showInObjectsTree: false
    };
    if (signal.type === "warning") {
      return {
        ...common,
        shape: "icon",
        icon: 61713,
        overrides: {
          visible: true,
          intervalsVisibilities: bollingerIntervalVisibility(resolution),
          color: isBullish ? "#0ECB81" : "#F6465D",
          size: 10
        }
      };
    }
    if (signal.type === "confirmed") {
      return {
        ...common,
        shape: isBullish ? "arrow_up" : "arrow_down",
        overrides: {
          visible: true,
          intervalsVisibilities: bollingerIntervalVisibility(resolution),
          color: isBullish ? "#0ECB81" : "#F6465D",
          arrowColor: isBullish ? "#0ECB81" : "#F6465D"
        }
      };
    }
    if (signal.type === "reversal") {
      return {
        ...common,
        shape: isBullish ? "arrow_down" : "arrow_up",
        overrides: {
          visible: true,
          intervalsVisibilities: bollingerIntervalVisibility(resolution),
          color: isBullish ? "#F6465D" : "#0ECB81",
          arrowColor: isBullish ? "#F6465D" : "#0ECB81"
        }
      };
    }
    throw new Error(`TradingView Bollinger alert signal type is invalid: ${signal.type}`);
  }
  function readMarkerPoint(shape) {
    const points = shape?.getPoints?.();
    if (!Array.isArray(points) || points.length !== 1 || !Number.isInteger(points[0].time) || !Number.isFinite(points[0].price)) {
      throw new Error("TradingView Bollinger alert marker point is invalid");
    }
    return points[0];
  }
  function markerPropertiesMatch(shape, options) {
    const properties = shape.getProperties();
    if (!properties || typeof properties !== "object") {
      throw new Error("TradingView Bollinger alert marker properties are invalid");
    }
    if (options.icon !== void 0 && properties.icon !== options.icon) return false;
    for (const [key, expected] of Object.entries(options.overrides)) {
      if (key === "intervalsVisibilities") {
        if (!properties[key] || Object.entries(expected).some(([unit, value]) => properties[key][unit] !== value)) return false;
      } else if (properties[key] !== expected) return false;
    }
    return true;
  }
  function normalizeSignal(signal, index, defaultDirection) {
    if (!signal || typeof signal !== "object") {
      throw new Error(`TradingView Bollinger alert signal ${index} is invalid`);
    }
    if (typeof signal.id !== "string" || signal.id.length === 0) {
      throw new Error(`TradingView Bollinger alert signal ${index} id is invalid`);
    }
    const direction = signal.direction === void 0 ? defaultDirection : signal.direction;
    if (direction !== "bearish" && direction !== "bullish") {
      throw new Error(`TradingView Bollinger alert signal ${index} direction is invalid: ${direction}`);
    }
    return signal.direction === direction ? signal : { ...signal, direction };
  }
  function createMarkerLayer(target, defaultDirection, {
    canMutate: canMutateExternally = () => true,
    onSaveError,
    yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0))
  } = {}) {
    const { chart } = target;
    const saveController = installTradingViewMarkerSaveController(target.tradingViewApi, { onError: onSaveError });
    const canMutate = () => canMutateExternally() && saveController.canMutate();
    const registry = /* @__PURE__ */ new Map();
    const pendingMarkers = /* @__PURE__ */ new Set();
    let generation = 0;
    let creating = 0;
    function mutate(action) {
      const finish = saveController.beginMutation();
      try {
        return action();
      } finally {
        finish();
      }
    }
    function removePendingMarkers() {
      if (pendingMarkers.size === 0 || !canMutate()) return;
      const liveShapeIds = readLiveShapes(chart);
      for (const id of pendingMarkers) {
        if (liveShapeIds.has(id)) mutate(() => chart.removeEntity(id));
        pendingMarkers.delete(id);
      }
    }
    function discardMissingSignals(liveShapeIds) {
      for (const [signalId, record] of registry) {
        if (!liveShapeIds.has(record.markerId)) registry.delete(signalId);
      }
    }
    function removeSignal(signalId, liveShapeIds) {
      const record = registry.get(signalId);
      if (!record) return;
      if (liveShapeIds.has(record.markerId)) {
        mutate(() => chart.removeEntity(record.markerId));
        liveShapeIds.delete(record.markerId);
      }
      registry.delete(signalId);
    }
    return Object.freeze({
      async render(signals, { isCurrent }) {
        if (!Array.isArray(signals)) throw new Error("TradingView Bollinger alert signals are invalid");
        if (signals.length > MAX_BOLLINGER_MARKERS) {
          throw new Error(
            `TradingView Bollinger alert marker limit exceeded: ${signals.length}`
          );
        }
        if (typeof isCurrent !== "function") {
          throw new Error("TradingView Bollinger alert current-target validator is unavailable");
        }
        const normalizedSignals = signals.map((signal, index) => normalizeSignal(signal, index, defaultDirection));
        const directionCounts = { bearish: 0, bullish: 0 };
        for (const signal of normalizedSignals) {
          directionCounts[signal.direction] += 1;
          if (directionCounts[signal.direction] > MAX_BOLLINGER_MARKERS_PER_DIRECTION) {
            throw new Error(
              `TradingView Bollinger alert ${signal.direction} marker limit exceeded: ` + directionCounts[signal.direction]
            );
          }
        }
        const requestedGeneration = generation;
        if (!isCurrent() || !canMutate()) return false;
        removePendingMarkers();
        let liveShapeIds = readLiveShapes(chart);
        discardMissingSignals(liveShapeIds);
        const nextIds = new Set(normalizedSignals.map((signal) => signal.id));
        for (const signalId of [...registry.keys()]) {
          if (!nextIds.has(signalId)) removeSignal(signalId, liveShapeIds);
        }
        let batchStartedAt = performance.now();
        let batchOps = 0;
        for (const signal of normalizedSignals) {
          if (batchOps > 0 && (batchOps >= 32 || performance.now() - batchStartedAt >= 8)) {
            await yieldToBrowser();
            if (requestedGeneration !== generation || !isCurrent() || !canMutate()) return false;
            liveShapeIds = readLiveShapes(chart);
            discardMissingSignals(liveShapeIds);
            batchStartedAt = performance.now();
            batchOps = 0;
          }
          if (requestedGeneration !== generation || !isCurrent() || !canMutate()) return false;
          batchOps += 1;
          const options = markerOptions(signal, target.resolution);
          const existing = registry.get(signal.id);
          if (existing) {
            const shape = chart.getShapeById(existing.markerId);
            const point = readMarkerPoint(shape);
            if (point.time === signal.time && point.price === existing.resolvedPrice && existing.markerPrice === signal.markerPrice && existing.type === signal.type && existing.direction === signal.direction && liveShapeIds.get(existing.markerId) === options.shape && markerPropertiesMatch(shape, options)) continue;
            removeSignal(signal.id, liveShapeIds);
          }
          const finishCreation = saveController.beginMutation();
          creating += 1;
          try {
            const markerId = await chart.createShape({ time: signal.time, price: signal.markerPrice }, {
              ...options,
              overrides: { ...options.overrides, visible: false }
            });
            if (typeof markerId !== "string" || markerId.length === 0) {
              throw new Error("TradingView returned an invalid Bollinger alert shape id");
            }
            pendingMarkers.add(markerId);
            if (requestedGeneration !== generation || !isCurrent() || !canMutate()) return false;
            const shape = chart.getShapeById(markerId);
            const point = readMarkerPoint(shape);
            if (point.time !== signal.time) {
              throw new Error(`TradingView Bollinger alert time alignment failed for ${signal.time}`);
            }
            if (requestedGeneration !== generation || !isCurrent() || !canMutate()) return false;
            mutate(() => shape.setProperties(options.overrides, false));
            if (!markerPropertiesMatch(shape, options)) {
              throw new Error("TradingView Bollinger alert marker properties were not applied");
            }
            registry.set(signal.id, {
              markerId,
              resolvedPrice: point.price,
              markerPrice: signal.markerPrice,
              type: signal.type,
              direction: signal.direction
            });
            pendingMarkers.delete(markerId);
          } finally {
            finishCreation();
            creating -= 1;
            removePendingMarkers();
          }
        }
        return true;
      },
      clear() {
        generation += 1;
        if (!canMutate()) return false;
        removePendingMarkers();
        const liveShapeIds = readLiveShapes(chart);
        discardMissingSignals(liveShapeIds);
        for (const signalId of [...registry.keys()]) removeSignal(signalId, liveShapeIds);
        return creating === 0 && pendingMarkers.size === 0;
      },
      get size() {
        return registry.size;
      },
      get saveStats() {
        return saveController.getStats();
      }
    });
  }
  function createBollingerMarkerLayer(target, options) {
    return createMarkerLayer(target, void 0, options);
  }

  // src/binance-strategy29-bollinger/monitor.js
  function createBollingerMonitor({
    document,
    getCurrentSymbol,
    isFuturesTradingPage,
    isTradingViewDrawingMutationBusy,
    err,
    warn
  }) {
    let bearishBollingerAlertTask = null;
    let bearishBollingerAlertContext = null;
    let bollingerIntervalSession = null;
    const retiredBollingerLayers = /* @__PURE__ */ new Set();
    function clearBearishBollingerAlertContext() {
      if (bearishBollingerAlertContext) {
        retiredBollingerLayers.add(bearishBollingerAlertContext.layer);
        bearishBollingerAlertContext = null;
      }
      return clearRetiredBollingerLayers();
    }
    function clearRetiredBollingerLayers() {
      if (isTradingViewDrawingMutationBusy()) return false;
      for (const layer of retiredBollingerLayers) {
        if (layer.clear()) retiredBollingerLayers.delete(layer);
      }
      return retiredBollingerLayers.size === 0;
    }
    function disposeBollingerIntervalSession() {
      if (bollingerIntervalSession) {
        bollingerIntervalSession.session.dispose();
        bollingerIntervalSession = null;
      }
    }
    function isBearishBollingerAlertContextCurrent(context) {
      return bearishBollingerAlertContext === context && context.intervalSession === bollingerIntervalSession?.session && context.intervalSession.isCurrent(context.intervalRevision) && !document.hidden && isFuturesTradingPage() && !isTradingViewDrawingMutationBusy() && getCurrentSymbol() === context.routeSymbol && isBearishBollingerChartTargetCurrent(document, context.target);
    }
    async function synchronizeBearishBollingerAlerts() {
      if (document.hidden || !isFuturesTradingPage()) return;
      const routeSymbol = getCurrentSymbol();
      if (!routeSymbol) return;
      let target;
      try {
        target = findBearishBollingerChartTarget(document, routeSymbol);
      } catch (error) {
        disposeBollingerIntervalSession();
        clearBearishBollingerAlertContext();
        err("Bollinger chart lookup failed for this sample:", error);
        return;
      }
      if (!target) {
        disposeBollingerIntervalSession();
        clearBearishBollingerAlertContext();
        return;
      }
      if (!bollingerIntervalSession || bollingerIntervalSession.chart !== target.chart || bollingerIntervalSession.routeSymbol !== routeSymbol) {
        disposeBollingerIntervalSession();
        bollingerIntervalSession = {
          chart: target.chart,
          routeSymbol,
          session: createBollingerIntervalSession(target.chart)
        };
      }
      const intervalSession = bollingerIntervalSession.session;
      const contextMatches = bearishBollingerAlertContext && bearishBollingerAlertContext.target.chart === target.chart && bearishBollingerAlertContext.target.chartRoot === target.chartRoot && bearishBollingerAlertContext.target.tradingViewApi === target.tradingViewApi && bearishBollingerAlertContext.routeSymbol === routeSymbol && bearishBollingerAlertContext.resolution === target.resolution && bearishBollingerAlertContext.intervalSession === intervalSession && bearishBollingerAlertContext.intervalRevision === intervalSession.revision;
      if (!contextMatches) {
        if (!clearBearishBollingerAlertContext()) return;
        if (!intervalSession.isCurrent(intervalSession.revision) || isTradingViewDrawingMutationBusy()) return;
        bearishBollingerAlertContext = {
          routeSymbol,
          resolution: target.resolution,
          intervalSession,
          intervalRevision: intervalSession.revision,
          target,
          layer: createBollingerMarkerLayer(target, {
            canMutate: () => !isTradingViewDrawingMutationBusy(),
            onSaveError: (error) => err("Bollinger chart save failed:", error)
          }),
          failed: false,
          cleanupPending: false,
          lastProcessedClosedBarsWindowKey: null,
          lastProcessedClosedBarsContentSnapshot: null,
          lastProcessedSignals: null
        };
      }
      if (isTradingViewDrawingMutationBusy() || !clearRetiredBollingerLayers()) return;
      const context = bearishBollingerAlertContext;
      if (context.cleanupPending) {
        context.layer.clear();
        context.cleanupPending = false;
      }
      if (context.failed || bearishBollingerAlertTask) return;
      const task = (async () => {
        const bars = await exportClosedTradingViewBars(context.target, context.intervalSession);
        if (!bars || !isBearishBollingerAlertContextCurrent(context)) return;
        if (bars.length === 0) return;
        const result = await reconcileBearishBollingerAlertWindow({
          bars,
          cachedWindowKey: context.lastProcessedClosedBarsWindowKey,
          cachedContentSnapshot: context.lastProcessedClosedBarsContentSnapshot,
          cachedSignals: context.lastProcessedSignals,
          detectSignals: detectBollingerSignals,
          renderSignals: (signals) => context.layer.render(signals, {
            isCurrent: () => isBearishBollingerAlertContextCurrent(context)
          })
        });
        if (result.rendered && isBearishBollingerAlertContextCurrent(context)) {
          context.lastProcessedClosedBarsWindowKey = result.closedBarsWindowKey;
          context.lastProcessedClosedBarsContentSnapshot = result.closedBarsContentSnapshot;
          context.lastProcessedSignals = result.signals;
        }
      })();
      bearishBollingerAlertTask = task;
      task.catch((error) => {
        if (bearishBollingerAlertContext !== context || context.intervalSession !== bollingerIntervalSession?.session || context.intervalRevision !== context.intervalSession.revision) return;
        const failureKind = applyBollingerAlertTaskFailure(context, error);
        if (failureKind === "retry") {
          warn("布林带形态预警本轮快照不一致，保留现有标记并等待下一次采样:", error);
          return;
        }
        err("布林带形态预警已停止:", error);
      }).finally(() => {
        if (bearishBollingerAlertTask === task) bearishBollingerAlertTask = null;
      });
    }
    function stopBearishBollingerAlertMonitor() {
      disposeBollingerIntervalSession();
      clearBearishBollingerAlertContext();
    }
    function getBollingerAlertDiagnostics() {
      const context = bearishBollingerAlertContext;
      const session = bollingerIntervalSession?.session || null;
      const chart = bollingerIntervalSession?.chart || context?.target.chart || null;
      const nativeModelReady = chart ? chart.hasModel() : null;
      return {
        taskPending: bearishBollingerAlertTask !== null,
        contextPresent: context !== null,
        failed: context ? context.failed : null,
        cleanupPending: context ? context.cleanupPending : null,
        cachedSignalCount: context?.lastProcessedSignals === null || !context ? null : context.lastProcessedSignals.length,
        layerSize: context ? context.layer.size : null,
        markerSaveStats: context ? context.layer.saveStats : null,
        retiredCount: retiredBollingerLayers.size,
        sessionPresent: session !== null,
        sessionRevision: session ? session.revision : null,
        contextIntervalRevision: context ? context.intervalRevision : null,
        sessionMatchesContext: context && session ? context.intervalSession === session : null,
        sessionCurrent: session && nativeModelReady ? session.isCurrent(session.revision) : null,
        nativeModelReady,
        nativeDataReady: nativeModelReady ? chart.dataReady() : null,
        mutationBlocked: isTradingViewDrawingMutationBusy()
      };
    }
    return Object.freeze({
      tick: synchronizeBearishBollingerAlerts,
      stop: stopBearishBollingerAlertMonitor,
      get diagnostics() {
        return getBollingerAlertDiagnostics();
      }
    });
  }

  // src/shared/chart-mutation-owners.js
  var OWNER_SLOT = Symbol.for("jh-userscripts.chart-mutation-owners");
  var VERSION = 1;
  function owners(view) {
    if (typeof view?.Map !== "function") {
      throw new TypeError("Chart mutation protocol requires the page Map constructor");
    }
    if (view[OWNER_SLOT] === void 0) {
      Object.defineProperty(view, OWNER_SLOT, {
        // The record lives on the page window, so its collection must belong to
        // that realm too. Both page-context and userscript-sandbox bundles then
        // validate the same constructor regardless of installation load order.
        value: Object.freeze({ version: VERSION, predicates: new view.Map() })
      });
    }
    const record = view[OWNER_SLOT];
    if (record.version !== VERSION || !(record.predicates instanceof view.Map)) {
      throw new Error("Incompatible chart mutation protocol; update both scripts and reload");
    }
    return record.predicates;
  }
  function isChartMutationBlocked(view) {
    for (const predicate of owners(view).values()) {
      const blocked = predicate();
      if (typeof blocked !== "boolean") throw new Error("Chart mutation owner must return a boolean");
      if (blocked) return true;
    }
    return false;
  }

  // src/shared/binance-futures-route.js
  var FUTURES_TRADING_PATH_RE = /^\/(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?futures\/([A-Za-z0-9_]{3,})\/?$/;
  function parseFuturesTradingSymbolFromPathname(pathname) {
    const normalized = String(pathname || "").split(/[?#]/, 1)[0];
    const match = normalized.match(FUTURES_TRADING_PATH_RE);
    return match?.[1] ? match[1].toUpperCase() : null;
  }
  function isFuturesTradingPathname(pathname) {
    return Boolean(parseFuturesTradingSymbolFromPathname(pathname));
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

  // src/binance-strategy29-bollinger/dom/strategy29-summary-panel.js
  var PANEL_ID = "jh-strategy29-summary-panel";
  var STATE_COLORS = Object.freeze({
    connected: "#0ECB81",
    connecting: "#F0B90B",
    unavailable: "#F0B90B",
    disconnected: "#F6465D",
    stopped: "#F6465D",
    incompatible: "#F6465D",
    configuration_required: "#F0B90B"
  });
  var STATUS_COLORS = Object.freeze({
    ready: "#0ECB81",
    warming: "#F0B90B",
    stale: "#F6465D",
    insufficient_history: "#F0B90B",
    data_gap: "#F6465D",
    failed: "#F6465D"
  });
  var TYPE_LABELS = Object.freeze({
    "bearish:warning": "Bearish warning",
    "bearish:confirmed": "Bearish confirmed",
    "bearish:reversal": "Long reversal",
    "bullish:warning": "Bullish warning",
    "bullish:confirmed": "Bullish confirmed",
    "bullish:reversal": "Short reversal"
  });
  var CLOCK_FORMATTER = new Intl.DateTimeFormat("en-GB", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai"
  });
  function element(document, tagName, { text = "", role = null, styles = null } = {}) {
    const node = document.createElement(tagName);
    node.textContent = text;
    if (role) node.dataset.role = role;
    if (styles) Object.assign(node.style, styles);
    return node;
  }
  function formatClock(timestampMs) {
    const date = new Date(timestampMs);
    const parts = CLOCK_FORMATTER.formatToParts(date);
    const part = (name) => parts.find((item) => item.type === name)?.value;
    return `${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")} UTC+08`;
  }
  function signalLabel(event) {
    return TYPE_LABELS[`${event.setup_direction}:${event.signal_type}`];
  }
  function createStrategy29SummaryPanel(document, canonicalSymbol, { maxEvents = 20 } = {}) {
    if (!document?.body) throw new Error("Strategy 29 summary panel requires document.body");
    if (typeof canonicalSymbol !== "string" || canonicalSymbol.length === 0) throw new Error("Strategy 29 panel symbol is invalid");
    if (!Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > 100) throw new Error("Strategy 29 panel maxEvents is invalid");
    document.getElementById(PANEL_ID)?.remove();
    const panel = element(document, "section", {
      styles: {
        position: "fixed",
        zIndex: "999995",
        top: "68px",
        right: "84px",
        width: "340px",
        boxSizing: "border-box",
        maxWidth: "calc(100vw - 112px)",
        maxHeight: "calc(100vh - 92px)",
        overflow: "hidden",
        border: "1px solid rgba(132,142,156,.30)",
        borderRadius: "9px",
        background: "rgba(24,26,32,.96)",
        boxShadow: "0 5px 18px rgba(0,0,0,.30)",
        color: "#EAECEF",
        font: "12px/17px BinancePlex,ui-sans-serif,system-ui,sans-serif",
        pointerEvents: "auto",
        userSelect: "none"
      }
    });
    panel.id = PANEL_ID;
    const header = element(document, "header", {
      styles: { display: "flex", alignItems: "center", gap: "7px", padding: "8px 10px", borderBottom: "1px solid rgba(132,142,156,.20)" }
    });
    header.appendChild(element(document, "strong", { text: "Strategy 29 Summary", styles: { flex: "1", fontSize: "13px" } }));
    const collapse = element(document, "button", {
      text: "Collapse",
      role: "collapse",
      styles: { border: "0", borderRadius: "5px", padding: "2px 7px", background: "rgba(132,142,156,.18)", color: "#EAECEF", cursor: "pointer" }
    });
    collapse.type = "button";
    header.appendChild(collapse);
    const body = element(document, "div", { role: "body", styles: { maxHeight: "calc(100vh - 150px)", overflow: "auto" } });
    const overview = element(document, "div", { styles: { display: "grid", gap: "4px", padding: "9px 10px" } });
    overview.appendChild(element(document, "div", { text: canonicalSymbol, role: "symbol", styles: { fontWeight: "700" } }));
    const connection = element(document, "div", { text: "Waiting", role: "connection", styles: { color: "#848E9C", fontSize: "11px" } });
    const spec = element(document, "div", { text: `Local spec ${STRATEGY29_SPEC_VERSION}`, role: "spec", styles: { color: "#848E9C", fontSize: "11px" } });
    const reference = element(document, "div", { text: `Local reference ${STRATEGY29_REFERENCE_SHA256}`, role: "reference", styles: { color: "#848E9C", fontSize: "10px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", userSelect: "text" } });
    const statusFreshness = element(document, "div", { text: "Status not received", role: "status-freshness", styles: { color: "#848E9C", fontSize: "11px" } });
    const eventsFreshness = element(document, "div", { text: "Events not checked", role: "events-freshness", styles: { color: "#848E9C", fontSize: "11px" } });
    overview.append(connection, spec, reference, statusFreshness, eventsFreshness);
    const unitsTitle = element(document, "div", { text: "Watched timeframes", styles: { padding: "7px 10px 4px", borderTop: "1px solid rgba(132,142,156,.18)", color: "#848E9C", fontWeight: "600" } });
    const units = element(document, "div", { role: "units", styles: { display: "grid", gap: "3px", padding: "0 7px 8px" } });
    const delivery = element(document, "div", { text: "Global delivery — waiting", role: "delivery", styles: { padding: "7px 10px", borderTop: "1px solid rgba(132,142,156,.18)", color: "#848E9C", fontSize: "11px" } });
    const eventsTitle = element(document, "div", { text: "Recent cross-timeframe signals", styles: { padding: "7px 10px 4px", borderTop: "1px solid rgba(132,142,156,.18)", color: "#848E9C", fontWeight: "600" } });
    const events = element(document, "div", { role: "events", styles: { display: "grid", gap: "3px", padding: "0 7px 8px" } });
    body.append(overview, unitsTitle, units, delivery, eventsTitle, events);
    panel.append(header, body);
    document.body.appendChild(panel);
    const eventRecords = /* @__PURE__ */ new Map();
    let destroyed = false;
    function assertLive() {
      if (destroyed) throw new Error("Strategy 29 summary panel is destroyed");
    }
    function renderEvents() {
      events.replaceChildren();
      const ordered = [...eventRecords.values()].sort((left, right) => right.detected_at_ms - left.detected_at_ms || right.sequence - left.sequence);
      for (const event of ordered) {
        const row = element(document, "div", {
          role: "remote-event",
          styles: { display: "grid", gridTemplateColumns: "36px minmax(0,1fr) 116px", gap: "6px", alignItems: "center", padding: "5px 6px", borderRadius: "5px", background: "rgba(132,142,156,.08)" }
        });
        row.dataset.eventId = event.event_id;
        row.appendChild(element(document, "strong", { text: event.timeframe, styles: { color: "#F0B90B" } }));
        row.appendChild(element(document, "span", {
          text: signalLabel(event),
          styles: { color: event.signal_side === "long" ? "#0ECB81" : "#F6465D", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }
        }));
        row.appendChild(element(document, "span", { text: `Close ${formatClock(event.bar_close_ms)}`, styles: { color: "#848E9C", fontSize: "10px", textAlign: "right" } }));
        events.appendChild(row);
      }
      if (ordered.length === 0) events.appendChild(element(document, "span", { text: "No recent signals", styles: { color: "#848E9C", padding: "4px" } }));
    }
    collapse.addEventListener("click", () => {
      const collapsed = body.style.display !== "none";
      body.style.display = collapsed ? "none" : "block";
      collapse.textContent = collapsed ? "Expand" : "Collapse";
    });
    renderEvents();
    return Object.freeze({
      setConnection(state, message) {
        assertLive();
        if (!(state in STATE_COLORS) || typeof message !== "string") throw new Error("Strategy 29 panel connection state is invalid");
        connection.dataset.state = state;
        connection.style.color = STATE_COLORS[state];
        connection.textContent = message;
      },
      renderStatus(snapshot) {
        assertLive();
        const matched = snapshot.spec_version === STRATEGY29_SPEC_VERSION;
        spec.dataset.state = matched ? "matched" : "error";
        spec.style.color = matched ? "#0ECB81" : "#F6465D";
        spec.textContent = matched ? `Spec version matched · ${STRATEGY29_SPEC_VERSION}` : `Spec mismatch · local ${STRATEGY29_SPEC_VERSION} · server ${snapshot.spec_version}`;
        statusFreshness.textContent = `Status ${formatClock(snapshot.observed_at_ms)}`;
        units.replaceChildren();
        const matching = snapshot.units.filter((unit) => unit.symbol === canonicalSymbol);
        for (const unit of matching) {
          const row = element(document, "div", {
            role: "unit",
            styles: { display: "grid", gridTemplateColumns: "42px 64px minmax(0,1fr)", gap: "6px", padding: "4px 6px", borderRadius: "5px", background: "rgba(132,142,156,.08)" }
          });
          row.appendChild(element(document, "strong", { text: unit.timeframe, styles: { color: "#EAECEF" } }));
          row.appendChild(element(document, "span", { text: unit.status, styles: { color: STATUS_COLORS[unit.status] } }));
          row.appendChild(element(document, "span", { text: unit.reason, styles: { color: "#848E9C", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }));
          units.appendChild(row);
        }
        if (matching.length === 0) units.appendChild(element(document, "span", { text: "Symbol is not watched by the server", styles: { color: "#F0B90B", padding: "4px" } }));
        const counts = snapshot.delivery_counts;
        delivery.textContent = `Global delivery · Pending ${counts.pending} · Sending ${counts.sending} · Sent ${counts.sent} · Unknown ${counts.unknown} · Expired ${counts.expired} · Failed ${counts.failed}`;
      },
      addEvents(incoming, observedAtMs = null) {
        assertLive();
        for (const event of incoming) eventRecords.set(event.event_id, event);
        const ordered = [...eventRecords.values()].sort((left, right) => right.detected_at_ms - left.detected_at_ms || right.sequence - left.sequence);
        while (ordered.length > maxEvents) eventRecords.delete(ordered.pop().event_id);
        if (observedAtMs !== null) eventsFreshness.textContent = `Events checked ${formatClock(observedAtMs)}`;
        renderEvents();
      },
      clearEvents() {
        assertLive();
        eventRecords.clear();
        renderEvents();
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        eventRecords.clear();
        panel.remove();
      },
      get size() {
        return eventRecords.size;
      }
    });
  }

  // src/binance-strategy29-bollinger/remote-summary.js
  var STRATEGY29_REMOTE_ENABLED_KEY = "strategy29RemoteSummaryEnabled";
  var STRATEGY29_GATEWAY_ORIGIN_KEY = "strategy29GatewayOrigin";
  var STRATEGY29_GATEWAY_SECRET_KEY = "strategy29GatewayAuthSecret";
  var STRATEGY29_DEFAULT_GATEWAY_ORIGIN = "http://127.0.0.1:8729";
  var STRATEGY29_REMOTE_POLL_INTERVAL_MS = 5e3;
  function abortError(view, message) {
    const ErrorConstructor = view.DOMException ?? DOMException;
    return new ErrorConstructor(message, "AbortError");
  }
  function assertAdapters({ view, request, getValue, setValue, registerMenuCommand, promptUser: promptUser2, createPanel, createClient }) {
    if (!view?.document || !view?.location) throw new TypeError("Strategy 29 remote summary requires a page window");
    for (const [name, value] of Object.entries({
      request,
      getValue,
      setValue,
      registerMenuCommand,
      promptUser: promptUser2,
      createPanel,
      createClient
    })) {
      if (typeof value !== "function") throw new TypeError(`Strategy 29 remote summary ${name} is invalid`);
    }
  }
  function createStrategy29RemoteSummary({
    view,
    request,
    getValue,
    setValue,
    registerMenuCommand,
    promptUser: promptUser2,
    createPanel = createStrategy29SummaryPanel,
    createClient = createStrategy29SummaryClient,
    pollIntervalMs = STRATEGY29_REMOTE_POLL_INTERVAL_MS
  }) {
    assertAdapters({ view, request, getValue, setValue, registerMenuCommand, promptUser: promptUser2, createPanel, createClient });
    if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 1e3) throw new TypeError("Strategy 29 remote poll interval is invalid");
    let enabled = getValue(STRATEGY29_REMOTE_ENABLED_KEY, false) === true;
    let active = null;
    let disposed = false;
    let unsupportedRoute = null;
    function isCurrent(context) {
      return !disposed && active === context && !context.abortController.signal.aborted;
    }
    function stopActive(reason = "Strategy 29 remote context retired") {
      if (!active) return;
      const context = active;
      active = null;
      context.abortController.abort(abortError(view, reason));
      context.panel.destroy();
    }
    function configuredSettings() {
      const authSecret = getValue(STRATEGY29_GATEWAY_SECRET_KEY, "");
      if (typeof authSecret !== "string") throw new TypeError("Strategy 29 gateway secret storage is invalid");
      const gatewayOrigin = normalizeStrategy29GatewayOrigin(
        getValue(STRATEGY29_GATEWAY_ORIGIN_KEY, STRATEGY29_DEFAULT_GATEWAY_ORIGIN)
      );
      return { authSecret, gatewayOrigin };
    }
    function startContext(routeSymbol) {
      const canonicalSymbol = routeSymbolToCanonical(routeSymbol);
      const panel = createPanel(view.document, canonicalSymbol, { maxEvents: 20 });
      const AbortControllerConstructor = view.AbortController ?? AbortController;
      const context = {
        routeSymbol,
        canonicalSymbol,
        gatewayOrigin: null,
        panel,
        abortController: new AbortControllerConstructor(),
        client: null,
        inFlight: false,
        failed: false,
        nextPollAtMs: 0,
        state: "idle",
        lastError: null,
        lastResult: null
      };
      active = context;
      let settings;
      try {
        settings = configuredSettings();
        context.gatewayOrigin = settings.gatewayOrigin;
      } catch (error) {
        context.failed = true;
        context.state = "stopped";
        context.lastError = error.message;
        panel.setConnection("stopped", `Remote summary stopped: ${error.message}`);
        view.console.warn("[Strategy29 remote]", error.message);
        return context;
      }
      const { authSecret, gatewayOrigin } = settings;
      if (authSecret.length === 0) {
        context.state = "configuration_required";
        panel.setConnection("configuration_required", "Gateway secret is not configured");
        return context;
      }
      try {
        context.client = createClient({
          request,
          gatewayOrigin,
          authSecret,
          canonicalSymbol,
          maxPagesPerPoll: 2,
          onStatus: (snapshot) => {
            if (isCurrent(context)) context.panel.renderStatus(snapshot);
          },
          onEvents: (events, observedAtMs) => {
            if (isCurrent(context)) context.panel.addEvents(events, observedAtMs);
          },
          onCursorReset: () => {
            if (isCurrent(context)) context.panel.clearEvents();
          }
        });
      } catch (error) {
        context.failed = true;
        context.state = "stopped";
        context.lastError = error.message;
        panel.setConnection("stopped", `Remote summary stopped: ${error.message}`);
        view.console.warn("[Strategy29 remote]", error.message);
      }
      return context;
    }
    function synchronizeContext() {
      if (!enabled || !view.document.body) {
        unsupportedRoute = null;
        stopActive("Strategy 29 remote summary disabled");
        return null;
      }
      const routeSymbol = parseFuturesTradingSymbolFromPathname(view.location.pathname);
      if (!routeSymbol) {
        unsupportedRoute = null;
        stopActive("Strategy 29 route changed");
        return null;
      }
      if (active?.routeSymbol === routeSymbol) return active;
      if (unsupportedRoute === routeSymbol) return null;
      unsupportedRoute = null;
      stopActive("Strategy 29 route changed");
      try {
        return startContext(routeSymbol);
      } catch (error) {
        unsupportedRoute = routeSymbol;
        stopActive("Strategy 29 remote context initialization failed");
        view.console.warn("[Strategy29 remote]", error.message);
        return null;
      }
    }
    function sample(nowMs = Date.now()) {
      if (disposed) return;
      const context = synchronizeContext();
      if (!context || !context.client || context.inFlight || context.failed || nowMs < context.nextPollAtMs) return;
      context.nextPollAtMs = nowMs + pollIntervalMs;
      context.inFlight = true;
      context.state = "connecting";
      context.panel.setConnection("connecting", "Connecting to Strategy 29 gateway");
      return context.client.poll(context.abortController.signal).then((result) => {
        if (!isCurrent(context)) return;
        context.lastResult = result;
        context.lastError = null;
        context.state = result.state;
        const presentation = {
          connected: ["connected", result.hasMore ? "Connected · more history pending" : "Connected"],
          unavailable: ["unavailable", "Gateway database unavailable"],
          incompatible: ["incompatible", "Server and local specs are incompatible"]
        }[result.state];
        if (!presentation) throw new Error(`Strategy 29 remote state is invalid: ${result.state}`);
        context.panel.setConnection(...presentation);
      }).catch((error) => {
        if (!isCurrent(context) || error?.name === "AbortError") return;
        context.lastError = error.message;
        if (error instanceof Strategy29GatewayTransportError) {
          context.state = "disconnected";
          context.panel.setConnection("disconnected", "Gateway connection failed; next scheduled poll will retry");
        } else {
          context.state = "stopped";
          context.failed = true;
          context.panel.setConnection("stopped", `Remote summary stopped: ${error.message}`);
        }
        view.console.warn("[Strategy29 remote]", error.message);
      }).finally(() => {
        context.inFlight = false;
      });
    }
    function restart() {
      unsupportedRoute = null;
      stopActive("Strategy 29 remote settings changed");
      if (!disposed) void sample(Date.now());
    }
    registerMenuCommand("Toggle Strategy 29 cross-timeframe summary", () => {
      enabled = !enabled;
      setValue(STRATEGY29_REMOTE_ENABLED_KEY, enabled);
      restart();
    });
    registerMenuCommand("Set Strategy 29 gateway secret", () => {
      const value = promptUser2("Enter the local Strategy 29 gateway secret. It is stored only in this userscript storage.");
      if (value === null) return;
      if (value.length === 0) throw new Error("Strategy 29 gateway secret cannot be empty");
      setValue(STRATEGY29_GATEWAY_SECRET_KEY, value);
      restart();
    });
    registerMenuCommand("Set Strategy 29 gateway origin", () => {
      const current = getValue(STRATEGY29_GATEWAY_ORIGIN_KEY, STRATEGY29_DEFAULT_GATEWAY_ORIGIN);
      const value = promptUser2("Enter the loopback gateway origin (http://127.0.0.1:<port>)", current);
      if (value === null) return;
      setValue(STRATEGY29_GATEWAY_ORIGIN_KEY, normalizeStrategy29GatewayOrigin(value));
      restart();
    });
    return Object.freeze({
      sample,
      pause() {
        stopActive("Strategy 29 remote summary paused");
      },
      restart,
      dispose() {
        if (disposed) return;
        disposed = true;
        stopActive("Strategy 29 remote summary disposed");
      },
      get diagnostics() {
        return Object.freeze({
          enabled,
          contextPresent: active !== null,
          canonicalSymbol: active?.canonicalSymbol ?? null,
          gatewayOrigin: active?.gatewayOrigin ?? null,
          state: active?.state ?? (unsupportedRoute ? "unsupported_route" : enabled ? "waiting_for_route" : "disabled"),
          inFlight: active?.inFlight ?? false,
          stopped: active?.failed ?? false,
          lastError: active?.lastError ?? null,
          lastResult: active?.lastResult ?? null,
          cursor: active?.client?.diagnostics.cursor ?? null,
          specVersion: STRATEGY29_SPEC_VERSION,
          referenceSha256: STRATEGY29_REFERENCE_SHA256
        });
      }
    });
  }

  // src/binance-strategy29-bollinger/runtime.js
  var INSTANCE = Symbol.for("jh-userscripts.strategy29-bollinger");
  var RUNTIME_VERSION = 2;
  var CONFLICT = "Strategy 29 stopped: update Orderbook to 2.7.199 or disable its embedded Bollinger version, then reload this page.";
  function hasEmbeddedBollinger(view) {
    const debug = view.__TM_CLOSE_LONG_DEBUG__;
    return !!debug && Object.getOwnPropertyDescriptor(debug, "bollingerAlertState") !== void 0;
  }
  function installStrategy29(view, remoteAdapters = null) {
    if (view[INSTANCE] !== void 0) {
      if (view[INSTANCE].version !== RUNTIME_VERSION) throw new Error("Incompatible Strategy 29 runtime; reload the page");
      return view[INSTANCE].runtime;
    }
    const document = view.document;
    let timer = null;
    let failed = null;
    let disposed = false;
    let removeRouteListener = null;
    const remoteSummary = remoteAdapters === null ? null : createStrategy29RemoteSummary({ view, ...remoteAdapters });
    const noticeId = "jh-strategy29-bollinger-status";
    function showFailure() {
      if (!failed || !document.body) return;
      let notice = document.getElementById(noticeId);
      if (!notice) {
        notice = document.createElement("div");
        notice.id = noticeId;
        notice.setAttribute("role", "status");
        notice.style.cssText = "position:fixed;left:16px;bottom:16px;z-index:10000;max-width:420px;padding:10px;background:#332b16;color:#ffcf67;font:13px sans-serif;pointer-events:none";
        document.body.append(notice);
      }
      notice.textContent = failed;
    }
    const monitor = createBollingerMonitor({
      document,
      getCurrentSymbol: () => parseFuturesTradingSymbolFromPathname(view.location.pathname),
      isFuturesTradingPage: () => !disposed && !failed && isFuturesTradingPathname(view.location.pathname),
      isTradingViewDrawingMutationBusy: () => hasEmbeddedBollinger(view) || isChartMutationBlocked(view),
      err: (...args) => view.console.error("[Strategy29]", ...args),
      warn: (...args) => view.console.warn("[Strategy29]", ...args)
    });
    function pause() {
      if (timer !== null) view.clearInterval(timer);
      timer = null;
      monitor.stop();
      remoteSummary?.pause();
    }
    function fail(message) {
      failed = message;
      pause();
      showFailure();
    }
    function sample() {
      if (disposed || failed || document.hidden) return;
      if (hasEmbeddedBollinger(view)) {
        fail(CONFLICT);
        return;
      }
      ensureSpaRouteChangePatched(view);
      void remoteSummary?.sample(Date.now());
      if (!isFuturesTradingPathname(view.location.pathname)) {
        monitor.stop();
        return;
      }
      void monitor.tick().catch((error) => fail(`Strategy 29 stopped: ${error.message}`));
    }
    function resume() {
      if (disposed || failed || document.hidden) return;
      sample();
      if (!failed && timer === null) timer = view.setInterval(sample, 1e3);
    }
    function onVisibility() {
      if (document.hidden) pause();
      else resume();
    }
    function onPageHide(event) {
      if (event.persisted) pause();
      else runtime.dispose();
    }
    function onPageShow() {
      resume();
    }
    const runtime = Object.freeze({
      get diagnostics() {
        return {
          ...monitor.diagnostics,
          runtimeFailure: failed,
          disposed,
          timerRunning: timer !== null,
          remoteSummary: remoteSummary?.diagnostics ?? Object.freeze({ enabled: false, state: "unavailable_in_this_installation" })
        };
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        pause();
        remoteSummary?.dispose();
        removeRouteListener();
        document.removeEventListener("visibilitychange", onVisibility);
        document.removeEventListener("DOMContentLoaded", showFailure);
        view.removeEventListener("pagehide", onPageHide);
        view.removeEventListener("pageshow", onPageShow);
        document.getElementById(noticeId)?.remove();
      }
    });
    Object.defineProperty(view, INSTANCE, { value: Object.freeze({ version: RUNTIME_VERSION, runtime }) });
    Object.defineProperty(view, "__TM_STRATEGY29_DEBUG__", { value: runtime });
    removeRouteListener = installSpaRouteChangeListener(view, sample);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("DOMContentLoaded", showFailure, { once: true });
    view.addEventListener("pagehide", onPageHide);
    view.addEventListener("pageshow", onPageShow);
    resume();
    return runtime;
  }

  // src/binance-strategy29-bollinger/index.user.js
  var promptUser = globalThis.prompt.bind(globalThis);
  installStrategy29(unsafeWindow, {
    request: createStrategy29GmJsonRequest(GM_xmlhttpRequest),
    getValue: GM_getValue,
    setValue: GM_setValue,
    registerMenuCommand: GM_registerMenuCommand,
    promptUser
  });
})();
