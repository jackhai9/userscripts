export const STRATEGY29_SCHEMA_VERSION = 1;
export const STRATEGY29_SPEC_VERSION = '29_2_spec_v1';
export const STRATEGY29_REFERENCE_SHA256 = 'eece8cf16e58340910587962f3bfbb19acb72155c09a52b4b6c0570cc979ef8d';

const TIMEFRAMES = new Set(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '1w']);
const UNIT_STATUSES = new Set(['warming', 'ready', 'stale', 'insufficient_history', 'data_gap', 'failed']);
const DIRECTIONS = new Set(['bearish', 'bullish']);
const SIGNAL_TYPES = new Set(['warning', 'confirmed', 'reversal']);
const SIGNAL_SIDES = new Set(['short', 'long']);
const ORIGINS = new Set(['historical', 'catch_up', 'live']);
const DELIVERY_STATES = new Set(['pending', 'sending', 'sent', 'unknown', 'expired', 'failed']);
const DELIVERY_COUNT_KEYS = ['pending', 'sending', 'sent', 'unknown', 'expired', 'failed'];
const STATUS_KEYS = ['schema_version', 'spec_version', 'observed_at_ms', 'units', 'delivery_counts'];
const UNIT_KEYS = [
  'symbol', 'timeframe', 'status', 'reason', 'last_processed_open_ms', 'last_data_at_ms', 'last_event_id',
];
const EVENTS_KEYS = ['schema_version', 'spec_version', 'observed_at_ms', 'next_cursor', 'has_more', 'events'];
const EVENT_KEYS = [
  'sequence', 'event_id', 'schema_version', 'strategy_id', 'spec_version', 'symbol', 'timeframe',
  'setup_direction', 'signal_type', 'signal_side', 'setup_open_ms', 'bar_open_ms', 'bar_close_ms',
  'detected_at_ms', 'close_price', 'marker_price', 'warning_open_ms', 'warning_high', 'warning_low',
  'origin', 'delivery_state', 'delivery_failure_reason',
];
const EVENT_ID_PATTERN = /^[0-9a-f]{64}$/;
const ROUTE_SYMBOL_PATTERN = /^([A-Z0-9]+)USDT$/;
const CANONICAL_SYMBOL_PATTERN = /^([A-Z0-9]+)\/USDT:USDT$/;

function assertObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
}

function assertExactKeys(value, keys, name) {
  assertObject(value, name);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${name} must contain exact keys: ${expected.join(', ')}`);
  }
}

function assertInteger(value, name, { nullable = false, minimum = 0 } = {}) {
  if (nullable && value === null) return;
  if (!Number.isSafeInteger(value) || value < minimum) throw new TypeError(`${name} must be an integer >= ${minimum}`);
}

function assertString(value, name, { nullable = false, maximumLength = 256 } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be a non-empty string`);
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
  if (typeof value !== 'string' || !CANONICAL_SYMBOL_PATTERN.test(value)) {
    throw new TypeError(`${name} must use canonical symbol format`);
  }
}

export function routeSymbolToCanonical(value) {
  if (typeof value !== 'string') throw new TypeError('route symbol must be a string');
  const match = ROUTE_SYMBOL_PATTERN.exec(value);
  if (!match || match[1] === '') throw new TypeError('route symbol must end in USDT and use uppercase canonical route syntax');
  return `${match[1]}/USDT:USDT`;
}

export function canonicalSymbolToRoute(value) {
  if (typeof value !== 'string') throw new TypeError('canonical symbol must be a string');
  const match = CANONICAL_SYMBOL_PATTERN.exec(value);
  if (!match || match[1] === '') throw new TypeError('canonical symbol must use BASE/USDT:USDT syntax');
  return `${match[1]}USDT`;
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
  if (value.last_event_id !== null && (typeof value.last_event_id !== 'string' || !EVENT_ID_PATTERN.test(value.last_event_id))) {
    throw new TypeError(`${name}.last_event_id must be null or a lowercase hexadecimal event id`);
  }
}

export function validateStrategy29StatusResponse(value, httpStatus) {
  if (httpStatus !== 200) throw new TypeError(`status response requires HTTP 200, received ${httpStatus}`);
  assertExactKeys(value, STATUS_KEYS, 'status response');
  assertSchema(value.schema_version, 'status.schema_version');
  assertString(value.spec_version, 'status.spec_version');
  assertInteger(value.observed_at_ms, 'status.observed_at_ms');
  if (!Array.isArray(value.units)) throw new TypeError('status.units must be an array');
  if (value.units.length > 128) throw new TypeError('status.units exceeds the 128-unit bound');
  value.units.forEach(validateUnit);
  assertExactKeys(value.delivery_counts, DELIVERY_COUNT_KEYS, 'status.delivery_counts');
  for (const key of DELIVERY_COUNT_KEYS) {
    assertInteger(value.delivery_counts[key], `status.delivery_counts.${key}`);
  }
  return value;
}

function expectedSignalSide(direction, signalType) {
  if (signalType === 'reversal') return direction === 'bearish' ? 'long' : 'short';
  return direction === 'bearish' ? 'short' : 'long';
}

function validateEvent(value, index) {
  const name = `events.events[${index}]`;
  assertExactKeys(value, EVENT_KEYS, name);
  assertInteger(value.sequence, `${name}.sequence`, { minimum: 1 });
  if (typeof value.event_id !== 'string' || !EVENT_ID_PATTERN.test(value.event_id)) {
    throw new TypeError(`${name}.event_id must be a lowercase hexadecimal event id`);
  }
  assertSchema(value.schema_version, `${name}.schema_version`);
  if (value.strategy_id !== '29') throw new TypeError(`${name}.strategy_id must equal 29`);
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
  for (const field of ['setup_open_ms', 'bar_open_ms', 'bar_close_ms', 'detected_at_ms', 'warning_open_ms']) {
    assertInteger(value[field], `${name}.${field}`);
  }
  if (value.bar_close_ms <= value.bar_open_ms) throw new TypeError(`${name}.bar_close_ms must follow bar_open_ms`);
  for (const field of ['close_price', 'marker_price', 'warning_high', 'warning_low']) {
    assertFiniteNumber(value[field], `${name}.${field}`);
  }
  if (value.warning_high < value.warning_low) throw new TypeError(`${name}.warning_high must not be below warning_low`);
  assertEnum(value.origin, ORIGINS, `${name}.origin`);
  assertEnum(value.delivery_state, DELIVERY_STATES, `${name}.delivery_state`, { nullable: true });
  assertString(value.delivery_failure_reason, `${name}.delivery_failure_reason`, { nullable: true, maximumLength: 512 });
}

export function validateStrategy29EventsResponse(value, httpStatus) {
  if (httpStatus !== 200) throw new TypeError(`events response requires HTTP 200, received ${httpStatus}`);
  assertExactKeys(value, EVENTS_KEYS, 'events response');
  assertSchema(value.schema_version, 'events.schema_version');
  if (value.spec_version !== STRATEGY29_SPEC_VERSION) {
    throw new TypeError(`events.spec_version must equal ${STRATEGY29_SPEC_VERSION}`);
  }
  assertInteger(value.observed_at_ms, 'events.observed_at_ms');
  assertInteger(value.next_cursor, 'events.next_cursor');
  if (typeof value.has_more !== 'boolean') throw new TypeError('events.has_more must be boolean');
  if (!Array.isArray(value.events)) throw new TypeError('events.events must be an array');
  if (value.events.length > 200) throw new TypeError('events.events exceeds the 200-event page bound');
  value.events.forEach(validateEvent);
  return value;
}

export function validateStrategy29GatewayError(value, httpStatus) {
  if (httpStatus === 409) {
    assertExactKeys(value, ['schema_version', 'error', 'oldest_cursor'], 'gateway error');
    assertSchema(value.schema_version, 'gateway error.schema_version');
    if (value.error !== 'cursor_expired') throw new TypeError('gateway error.error must equal cursor_expired');
    assertInteger(value.oldest_cursor, 'gateway error.oldest_cursor');
    return value;
  }
  const expected = new Map([[400, 'invalid_request'], [401, 'unauthorized'], [503, 'database_unavailable']]);
  if (!expected.has(httpStatus)) throw new TypeError(`unsupported gateway HTTP status ${httpStatus}`);
  assertExactKeys(value, ['schema_version', 'error'], 'gateway error');
  assertSchema(value.schema_version, 'gateway error.schema_version');
  if (value.error !== expected.get(httpStatus)) {
    throw new TypeError(`gateway error.error must equal ${expected.get(httpStatus)}`);
  }
  return value;
}
