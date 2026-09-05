/** Exact ADR 032 display contract; no market interpretation belongs here. */
const HASH = /^[a-f0-9]{64}$/;
const DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/;
const PROFILE_DECIMALS = ['context_move_bps', 'significant_flow_ratio', 'quiet_flow_ratio', 'confirmation_move_bps', 'rebound_move_bps'];
const PROFILE_TIMES = ['context_seconds', 'minimum_context_seconds', 'confirmation_seconds', 'reinforcement_seconds'];
const PRICES = ['opening_mid', 'closing_mid', 'minimum_mid', 'maximum_mid'];
const METRICS = ['buy_notional', 'sell_notional', 'bid_addition', 'bid_decrease', 'ask_addition', 'ask_decrease', 'bid_depth', 'ask_depth'];

function check(condition, message) {
  if (!condition) throw new Error(`Strategy 27 compound ${message}`);
}

function keys(value, expected, label) {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  check(actual.length === wanted.length && actual.every((key, i) => key === wanted[i]), `${label} keys must be exact`);
}

function integer(value, label, minimum = 0) {
  check(Number.isSafeInteger(value) && value >= minimum, `${label} must be a safe integer >= ${minimum}`);
}

function hash(value, label) {
  check(typeof value === 'string' && HASH.test(value), `${label} must be SHA-256`);
}

function decimal(value, label) {
  check(typeof value === 'string' && value.length <= 128 && DECIMAL.test(value) && value !== '-0', `${label} must be a canonical decimal`);
}

/** Compare wire decimals exactly, including prices beyond Number precision. */
function compare(left, right) {
  const scale = (value) => value.includes('.') ? value.length - value.indexOf('.') - 1 : 0;
  const leftScale = scale(left);
  const rightScale = scale(right);
  const a = BigInt(left.replace('.', '')) * (10n ** BigInt(rightScale));
  const b = BigInt(right.replace('.', '')) * (10n ** BigInt(leftScale));
  return a === b ? 0 : a > b ? 1 : -1;
}

export function canonicalCompoundJson(value) {
  if (value !== null && typeof value === 'object') {
    check(!Array.isArray(value), 'canonical record cannot contain arrays');
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalCompoundJson(value[key])}`).join(',')}}`;
  }
  check(value === null || typeof value === 'string' || Number.isSafeInteger(value), 'canonical value is invalid');
  if (typeof value === 'string') check(/^[\x00-\x7f]*$/.test(value), 'canonical text must be ASCII');
  return JSON.stringify(value);
}

export async function compoundHash(value) {
  const bytes = new TextEncoder().encode(canonicalCompoundJson(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function profile(value) {
  keys(value, ['revision', ...PROFILE_DECIMALS, ...PROFILE_TIMES], 'profile');
  check(typeof value.revision === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value.revision), 'profile revision is invalid');
  for (const field of PROFILE_TIMES) {
    integer(value[field], field, 1);
    check(value[field] <= 300, 'profile time exceeds 300 seconds');
  }
  check(value.minimum_context_seconds >= 2 && value.minimum_context_seconds <= value.context_seconds, 'profile context bounds are invalid');
  for (const field of PROFILE_DECIMALS) {
    decimal(value[field], field);
    check(compare(value[field], '0') > 0, `${field} must be positive`);
  }
  check(compare(value.quiet_flow_ratio, value.significant_flow_ratio) <= 0, 'quiet ratio exceeds significant ratio');
}

function priceRange(value, label) {
  for (const field of PRICES) {
    decimal(value[field], `${label}.${field}`);
    check(compare(value[field], '0') > 0, `${label} prices must be positive`);
  }
  for (const field of ['opening_mid', 'closing_mid']) {
    check(compare(value.minimum_mid, value[field]) <= 0 && compare(value[field], value.maximum_mid) <= 0, `${label} extrema do not contain endpoints`);
  }
  integer(value.start_ms, `${label}.start_ms`);
  integer(value.end_ms, `${label}.end_ms`);
  check(value.start_ms % 1000 === 0 && value.end_ms % 1000 === 0 && value.end_ms > value.start_ms, `${label} interval is invalid`);
}

function second(value, label) {
  keys(value, ['start_ms', 'end_ms', ...PRICES, ...METRICS, 'buy_count', 'sell_count'], label);
  priceRange(value, label);
  check(value.end_ms - value.start_ms === 1000, `${label} must span one second`);
  integer(value.buy_count, `${label}.buy_count`);
  integer(value.sell_count, `${label}.sell_count`);
  for (const field of METRICS) {
    decimal(value[field], `${label}.${field}`);
    check(compare(value[field], '0') >= 0, `${label}.${field} must be nonnegative`);
  }
  check(compare(value.bid_depth, '0') > 0 && compare(value.ask_depth, '0') > 0, `${label} depths must be positive`);
}

export async function validateCompoundCandidate(value) {
  keys(value, ['candidate_id', 'profile', 'profile_id', 'symbol', 'source_id', 'family', 'direction', 'validation_status', 'parent_candidate_id', 'context', 'established_extreme', 'seed', 'confirmation', 'trough', 'rebound', 'decision'], 'candidate');
  hash(value.candidate_id, 'candidate_id');
  hash(value.profile_id, 'profile_id');
  hash(value.source_id, 'source_id');
  profile(value.profile);
  check(typeof value.symbol === 'string' && /^[A-Z0-9]+\/USDT:USDT$/.test(value.symbol), 'symbol is invalid');
  check(['impact_failure', 'passive_support_loss', 'failed_rebound'].includes(value.family), 'family is invalid');
  check(['high', 'low'].includes(value.direction), 'direction is invalid');
  check(value.validation_status === (value.direction === 'high' ? 'exploratory' : 'unvalidated_mirror'), 'validation status does not match direction');
  keys(value.context, ['start_ms', 'end_ms', ...PRICES], 'context');
  priceRange(value.context, 'context');
  for (const field of ['seed', 'confirmation', 'decision']) second(value[field], field);
  decimal(value.established_extreme, 'established_extreme');
  const extremeField = value.direction === 'high' ? 'maximum_mid' : 'minimum_mid';
  const extremes = [value.context[extremeField], value.seed[extremeField]].sort(compare);
  check(value.established_extreme === extremes[value.direction === 'high' ? 1 : 0], 'frozen extreme does not match evidence');
  const duration = value.context.end_ms - value.context.start_ms;
  check(value.context.end_ms === value.seed.start_ms && value.seed.end_ms <= value.confirmation.start_ms && duration >= value.profile.minimum_context_seconds * 1000 && duration <= value.profile.context_seconds * 1000 && value.confirmation.end_ms - value.seed.end_ms <= value.profile.confirmation_seconds * 1000, 'base evidence ordering is invalid');
  if (value.family === 'failed_rebound') {
    hash(value.parent_candidate_id, 'parent_candidate_id');
    check(value.parent_candidate_id !== value.candidate_id, 'candidate cannot parent itself');
    second(value.trough, 'trough');
    second(value.rebound, 'rebound');
    check(value.confirmation.end_ms <= value.trough.start_ms && value.trough.end_ms <= value.rebound.start_ms && value.rebound.end_ms <= value.decision.start_ms && value.decision.end_ms - value.confirmation.end_ms <= value.profile.reinforcement_seconds * 1000, 'reinforcement evidence ordering is invalid');
  } else {
    check(value.parent_candidate_id === null && value.trough === null && value.rebound === null && canonicalCompoundJson(value.decision) === canonicalCompoundJson(value.confirmation), 'base cannot carry reinforcement evidence');
  }
  check(await compoundHash(value.profile) === value.profile_id, 'profile hash mismatch');
  const { candidate_id: candidateId, ...record } = value;
  check(await compoundHash(record) === candidateId, 'candidate hash mismatch');
  return value;
}

export async function validateCompoundEnvelope(value) {
  keys(value, ['schema_version', 'projection_kind', 'runtime_epoch', 'sequence', 'message_kind', 'symbol', 'observed_at_ms', 'payload'], 'envelope');
  check(value.schema_version === 1 && value.projection_kind === 'compound_candidate', 'envelope version is invalid');
  check(typeof value.runtime_epoch === 'string' && /^[a-f0-9]{32}$/.test(value.runtime_epoch), 'runtime epoch is invalid');
  integer(value.sequence, 'sequence', 1);
  integer(value.observed_at_ms, 'observed_at_ms');
  check(new TextEncoder().encode(canonicalCompoundJson(value)).length <= 16384, 'envelope exceeds byte bound');
  if (value.message_kind === 'candidate') {
    await validateCompoundCandidate(value.payload);
    check(value.symbol === value.payload.symbol && value.observed_at_ms >= value.payload.decision.end_ms, 'candidate identity/time mismatch');
  } else {
    check(['stream_state', 'heartbeat'].includes(value.message_kind), 'message kind is invalid');
    keys(value.payload, value.message_kind === 'stream_state' ? ['state', 'reason'] : ['state'], 'state');
    check(value.symbol === null && value.payload.state === 'ready', 'state identity is invalid');
    if (value.message_kind === 'stream_state') check(['startup', 'transport_recovered', 'queue_recovered'].includes(value.payload.reason), 'reset reason is invalid');
  }
  return value;
}

const STREAM_ID = /^(0|[1-9]\d*)-(0|[1-9]\d*)$/;

export async function validateCompoundGatewayResponse(value, httpStatus) {
  if (value?.status === 'error') {
    keys(value, ['schema_version', 'status', 'error_code'], 'gateway error');
    check(value.schema_version === 1, 'gateway schema is invalid');
    const codes = { 400: ['invalid_request'], 401: ['unauthorized'], 503: ['redis_unavailable', 'compound_unavailable'] };
    check(codes[httpStatus]?.includes(value.error_code), 'gateway error status/code mismatch');
    return value;
  }
  check(value?.status === 'ok' || value?.status === 'reset', 'gateway status is invalid');
  keys(value, ['schema_version', 'status', 'requested_cursor', 'next_cursor', 'messages', ...(value.status === 'reset' ? ['reason'] : [])], 'gateway response');
  check(value.schema_version === 1, 'gateway schema is invalid');
  check(typeof value.next_cursor === 'string' && STREAM_ID.test(value.next_cursor), 'next cursor is invalid');
  check(Array.isArray(value.messages) && value.messages.length <= 128, 'gateway message bound is invalid');
  if (value.status === 'reset') {
    check(['initial_cursor', 'stale_cursor'].includes(value.reason), 'gateway reset reason is invalid');
    check(value.messages.length === 0, 'gateway reset messages must be empty');
    check(httpStatus === (value.reason === 'initial_cursor' ? 200 : 409), 'gateway reset HTTP status is invalid');
    if (value.reason === 'initial_cursor') {
      check(value.requested_cursor === null, 'initial cursor must be null');
      return value;
    }
  } else {
    check(httpStatus === 200, 'gateway success must use HTTP 200');
    for (const message of value.messages) await validateCompoundEnvelope(message);
  }
  check(typeof value.requested_cursor === 'string' && STREAM_ID.test(value.requested_cursor), 'requested cursor is invalid');
  return value;
}

export async function validateCompoundBootstrapResponse(value, httpStatus) {
  if (value?.status === 'error') {
    keys(value, ['schema_version', 'status', 'error_code'], 'bootstrap gateway error');
    check(value.schema_version === 1, 'bootstrap gateway schema is invalid');
    const expected = { 401: ['unauthorized'], 503: ['compound_unavailable', 'redis_unavailable'] }[httpStatus];
    check(expected?.includes(value.error_code), 'bootstrap gateway error status/code mismatch');
    return value;
  }
  check(httpStatus === 200, 'bootstrap gateway success must use HTTP 200');
  keys(value, [
    'schema_version', 'status', 'projection_kind', 'requested_cursor', 'next_cursor',
    'runtime_epoch', 'last_sequence', 'bootstrap_observed_at_ms', 'records',
  ], 'bootstrap gateway response');
  check(value.schema_version === 1 && value.status === 'bootstrap', 'bootstrap gateway status is invalid');
  check(value.projection_kind === 'compound_candidates', 'bootstrap projection kind is invalid');
  check(value.requested_cursor === null, 'bootstrap requested cursor must be null');
  check(typeof value.next_cursor === 'string' && STREAM_ID.test(value.next_cursor), 'bootstrap next cursor is invalid');
  check(typeof value.runtime_epoch === 'string' && /^[a-f0-9]{32}$/.test(value.runtime_epoch), 'bootstrap epoch is invalid');
  integer(value.last_sequence, 'bootstrap last sequence', 1);
  integer(value.bootstrap_observed_at_ms, 'bootstrap observed time');
  check(Array.isArray(value.records) && value.records.length <= 80, 'bootstrap record bound is invalid');
  for (const envelope of value.records) {
    await validateCompoundEnvelope(envelope);
    check(envelope.message_kind === 'candidate', 'bootstrap record must be a candidate');
    check(envelope.runtime_epoch === value.runtime_epoch, 'bootstrap candidate epoch is inconsistent');
    check(envelope.sequence <= value.last_sequence, 'bootstrap candidate sequence exceeds tail');
  }
  return value;
}
