import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { LiveEventLifecycle, validateGatewayBootstrapResponse, validateLiveEnvelope } from '../../../src/binance-strategy27-events/core/live-event-contract.js';
import { createCompoundCandidateClient } from '../../../src/binance-strategy27-events/core/compound-candidate-client.js';
import { compoundHash, validateCompoundCandidate } from '../../../src/binance-strategy27-events/core/compound-candidate-contract.js';
import { CompoundCandidateLifecycle } from '../../../src/binance-strategy27-events/core/compound-candidate-lifecycle.js';
import { buildCompoundCandidateAnnotation } from '../../../src/binance-strategy27-events/core/compound-candidate-annotation.js';
import { buildEventAnnotation, formatNotional, stabilizeCandidatePresentation } from '../../../src/binance-strategy27-events/core/event-annotation.js';
import { Strategy27GatewayTransportError } from '../../../src/binance-strategy27-events/core/live-event-client.js';
import { createStrategy29RequestHost } from '../../helpers/strategy29-runtime-boundary-host.js';
import { captureStrategyError, createStrategyDigestGate, observeStrategyCondition } from '../../helpers/strategy-migration-boundaries.js';

const candidates = JSON.parse(await readFile(new URL('../../fixtures/strategy27-compound-candidates.json', import.meta.url)));
const epoch = 'a'.repeat(32);
const eventId = 'b'.repeat(64);

function ordinarySnapshot(start = 1000) {
  return {
    bucket_start_ms: start, bucket_end_ms: start + 250, source_bucket_count: 1,
    bucket_trigger_reasons: ['aggressive_buy'], candidate_observations: [],
    aggressive_buy: { notional: '1200', trade_count: 3, to_opposite_depth: '0.4' },
    aggressive_sell: { notional: '200', trade_count: 1, to_opposite_depth: '0.1' },
    bid: { observed_addition_notional: '300', observed_decrease_notional: '100', best_price_migration_bps: '0.2', addition_to_depth: '0.3', decrease_to_depth: '0.1' },
    ask: { observed_addition_notional: '100', observed_decrease_notional: '500', best_price_migration_bps: '-0.4', addition_to_depth: '0.1', decrease_to_depth: '0.5' },
    price_response: { mid: '1.25', mid_return_bps: '2.5', spread_bps: '1.2', spread_change_bps: '-0.2' },
  };
}

function ordinaryEvent(closed = false) {
  return {
    event_kind: 'orderflow_event', analysis_start_at_ms: 0, triggered_at_ms: 1000,
    active_end_at_ms: closed ? 2000 : null, event_status: closed ? 'complete' : 'active',
    close_reason: closed ? 'quiet_period' : null, trigger_reasons: ['aggressive_buy'],
    trigger_snapshot: ordinarySnapshot(), latest_snapshot: ordinarySnapshot(closed ? 1750 : 1000),
  };
}

function ordinaryEnvelope(sequence, { id = eventId, closed = false, outcome = null, observedAtMs = 2000 } = {}) {
  return {
    schema_version: 2, strategy_id: '27', spec_version: '27_2_spec_v10', runtime_epoch: epoch,
    sequence, message_kind: outcome ? 'event_outcome' : closed ? 'event_closed' : 'event_opened',
    symbol: 'BTR/USDT:USDT', event_id: id, observed_at_ms: observedAtMs,
    event_time_ms: outcome ? outcome.outcome_boundary_at_ms : closed ? 2000 : 1000,
    data_status: outcome ? outcome.outcome_status : closed ? 'complete' : 'active',
    payload: outcome ? { event: ordinaryEvent(true), outcome } : { event: ordinaryEvent(closed) },
  };
}

function incompleteOutcome(windowSeconds, status = 'input_gap') {
  return {
    window_seconds: windowSeconds, outcome_boundary_at_ms: 2000 + windowSeconds * 1000,
    outcome_status: status, terminated_at_ms: status === 'terminated' ? 2500 : null,
    termination_reason: status === 'terminated' ? 'monitor_stopped' : null,
    boundary_mid: null, return_from_trigger_bps: null, return_from_active_end_bps: null,
    maximum_upward_excursion_bps: null, maximum_downward_excursion_bps: null,
    pre_event_range_break_up: null, pre_event_range_break_down: null,
    spread_change_from_active_end_bps: null, eligible_orderbook_observation_count: 0,
    impulse_direction: null, directional_outcome: null,
  };
}

function compoundEnvelope(candidate = candidates[0], sequence = 2, observedAtMs = candidate.decision.end_ms) {
  return {
    schema_version: 1, projection_kind: 'compound_candidate', runtime_epoch: epoch,
    sequence, message_kind: 'candidate', symbol: candidate.symbol, observed_at_ms: observedAtMs, payload: candidate,
  };
}

function bootstrap(nextCursor = '7-9', records = []) {
  return {
    schema_version: 1, status: 'bootstrap', projection_kind: 'compound_candidates', requested_cursor: null,
    next_cursor: nextCursor, runtime_epoch: epoch, last_sequence: 4, bootstrap_observed_at_ms: 7000, records,
  };
}

function compoundClientFixture() {
  const host = createStrategy29RequestHost();
  const received = [];
  const states = [];
  const controller = new AbortController();
  const client = createCompoundCandidateClient({
    request: options => host.request(options), gatewayBaseUrl: 'http://127.0.0.1:18765',
    authSecret: 'fixture-only-not-a-credential', canonicalSymbol: 'BTC/USDT:USDT', reconnectDelayMs: 2000,
    onResponse: payload => received.push(payload), onConnectionStateChange: state => states.push(state),
  });
  return { host, received, states, controller, client };
}

test('user retains incomplete and terminated outcome horizons without fabricating prices or directional conclusions', () => {
  // Given a real lifecycle containing an opened and closed event.
  const lifecycle = new LiveEventLifecycle('BTR/USDT:USDT', { maxEvents: 80, maxAgeMs: 7200000 });
  lifecycle.apply(ordinaryEnvelope(1));
  lifecycle.apply(ordinaryEnvelope(2, { closed: true }));
  const gap = incompleteOutcome(5);
  const terminated = incompleteOutcome(15, 'terminated');

  // When valid missing-input and terminated wire outcomes arrive in increasing horizon order.
  const first = lifecycle.apply(ordinaryEnvelope(3, { outcome: gap, observedAtMs: 7100 }));
  const second = lifecycle.apply(ordinaryEnvelope(4, { outcome: terminated, observedAtMs: 17100 }));

  // Then exact outcome facts are retained and optional evidence remains null.
  assert.deepEqual(first.outcomes, [gap]);
  assert.deepEqual(second.outcomes, [gap, terminated]);
  assert.equal(second.phase, 'closed');
  assert.equal(second.eventId, eventId);
  assert.equal(second.outcomes[0].boundary_mid, null);
  assert.equal(second.outcomes[0].directional_outcome, null);
  assert.equal(second.outcomes[1].termination_reason, 'monitor_stopped');
  assert.equal(lifecycle.size, 1);
});

for (const [label, fields] of [
  ['termination time', { terminated_at_ms: 2500 }],
  ['termination reason', { termination_reason: 'monitor_stopped' }],
]) {
  test(`user rejects an input-gap outcome carrying a ${label} without storing it`, () => {
    // Given a closed lifecycle and a wire input-gap outcome with contradictory termination evidence.
    const lifecycle = new LiveEventLifecycle('BTR/USDT:USDT', { maxEvents: 80, maxAgeMs: 7200000 });
    lifecycle.apply(ordinaryEnvelope(1));
    lifecycle.apply(ordinaryEnvelope(2, { closed: true }));
    const malformed = ordinaryEnvelope(3, { outcome: { ...incompleteOutcome(5), ...fields }, observedAtMs: 7100 });

    // When the real lifecycle validates that external envelope.
    const apply = () => lifecycle.apply(malformed);

    // Then no invalid outcome or sequence is committed.
    assert.throws(apply, { message: 'input-gap outcome cannot contain termination fields' });
    assert.equal(lifecycle.lastSequence, 2);
    assert.equal(lifecycle.events.get(eventId).outcomes.size, 0);
    assert.equal(lifecycle.size, 1);
  });
}

test('user rejects out-of-order outcome horizons after accepting an earlier missing-input outcome', () => {
  // Given a closed event whose fifteen-second outcome was already observed.
  const lifecycle = new LiveEventLifecycle('BTR/USDT:USDT', { maxEvents: 80, maxAgeMs: 7200000 });
  lifecycle.apply(ordinaryEnvelope(1));
  lifecycle.apply(ordinaryEnvelope(2, { closed: true }));
  lifecycle.apply(ordinaryEnvelope(3, { outcome: incompleteOutcome(15), observedAtMs: 17100 }));

  // When an otherwise valid later-delivered five-second outcome arrives.
  const apply = () => lifecycle.apply(ordinaryEnvelope(4, { outcome: incompleteOutcome(5), observedAtMs: 17200 }));

  // Then the horizon regression is explicit and the acknowledged outcome remains the only retained one.
  assert.throws(apply, { message: 'Event outcome horizons must increase' });
  assert.deepEqual([...lifecycle.events.get(eventId).outcomes.keys()], [15]);
  assert.equal(lifecycle.size, 1);
});

test('user preserves available partial outcome measurements while its directional conclusion remains absent', () => {
  // Given a missing-input outcome with some valid measurements already available.
  const outcome = {
    ...incompleteOutcome(5), boundary_mid: '1.2', return_from_trigger_bps: '-4',
    return_from_active_end_bps: '-3', maximum_upward_excursion_bps: '1', maximum_downward_excursion_bps: '4',
    pre_event_range_break_up: false, pre_event_range_break_down: true, spread_change_from_active_end_bps: '0.2',
    eligible_orderbook_observation_count: 4, impulse_direction: 'up',
  };
  const wire = ordinaryEnvelope(1, { outcome, observedAtMs: 7100 });

  // When the public wire validator reads the incomplete but measured outcome.
  const validated = validateLiveEnvelope(wire);

  // Then concrete partial evidence is preserved without inferring a completed directional result.
  assert.deepEqual(validated.payload.outcome, outcome);
  assert.equal(validated.payload.outcome.outcome_status, 'input_gap');
  assert.equal(validated.payload.outcome.directional_outcome, null);
  assert.equal(validated.payload.outcome.boundary_mid, '1.2');
});

test('user prunes expired ordinary-event tombstones while repeated explicit eviction remains idempotent', () => {
  // Given a bounded lifecycle with one acknowledged event.
  const lifecycle = new LiveEventLifecycle('BTR/USDT:USDT', { maxEvents: 2, maxAgeMs: 1000 });
  lifecycle.apply(ordinaryEnvelope(1));

  // When the event is explicitly evicted twice and the eviction age passes its retention bound.
  const first = lifecycle.evict(eventId, 2000);
  const repeated = lifecycle.evict(eventId, 2001);
  const atBoundary = lifecycle.prune(3000);
  const rememberedAtBoundary = lifecycle.evictedEvents.size;
  const expired = lifecycle.prune(3001);

  // Then only the first eviction succeeds and the exact age boundary controls tombstone removal.
  assert.deepEqual({ first, repeated }, { first: true, repeated: false });
  assert.deepEqual(atBoundary, []);
  assert.equal(rememberedAtBoundary, 1);
  assert.deepEqual(expired, []);
  assert.equal(lifecycle.evictedEvents.size, 0);
  assert.equal(lifecycle.size, 0);
});

test('user accepts the ordinary gateway unauthorized bootstrap body only with its declared HTTP status', () => {
  // Given a protocol error returned before any ordinary event snapshot can be read.
  const body = { schema_version: 1, status: 'error', error_code: 'unauthorized' };

  // When the real bootstrap validator checks the documented authorization response.
  const validated = validateGatewayBootstrapResponse(body, 401);

  // Then the typed protocol error is preserved and an inconsistent status is rejected.
  assert.deepEqual(validated, body);
  assert.throws(() => validateGatewayBootstrapResponse(body, 503), { message: 'Gateway bootstrap error response is invalid' });
});

test('user keeps the newer compound decision when an older candidate arrives late at capacity', async () => {
  // Given one retained recent candidate in a one-record lifecycle.
  const newer = structuredClone(candidates[0]);
  for (const field of ['context', 'seed', 'confirmation', 'decision']) {
    newer[field].start_ms += 1000;
    newer[field].end_ms += 1000;
  }
  const { candidate_id: originalId, ...record } = newer;
  newer.candidate_id = await compoundHash(record);
  const lifecycle = new CompoundCandidateLifecycle('BTC/USDT:USDT', { maxCandidates: 1, maxAgeMs: 7200000 });
  const accepted = await lifecycle.apply(compoundEnvelope(newer, 1, 8000), 8000);

  // When an older but valid candidate and its later replay arrive within the retention age.
  const late = await lifecycle.apply(compoundEnvelope(candidates[0], 2, 8000), 8000);
  const replay = await lifecycle.apply(compoundEnvelope(candidates[0], 3, 8000), 8000);
  const retained = await lifecycle.apply(compoundEnvelope(newer, 4, 8000), 8000);

  // Then capacity rejects the older decision immediately and the eviction boundary prevents its resurrection.
  assert.equal(accepted.type, 'candidate');
  assert.notEqual(newer.candidate_id, originalId);
  assert.deepEqual(late, { type: 'expired', removedCandidateIds: [candidates[0].candidate_id] });
  assert.deepEqual(replay, { type: 'expired', removedCandidateIds: [] });
  assert.deepEqual(retained, { type: 'replay', removedCandidateIds: [] });
  assert.equal(lifecycle.size, 1);
});

test('user sees low reinforcement peak and pullback evidence with its validated parent identity', async () => {
  // Given a low candidate with a later validated reinforcement record.
  const source = structuredClone(candidates[1]);
  source.family = 'failed_rebound';
  source.parent_candidate_id = source.candidate_id;
  source.trough = { ...source.confirmation, start_ms: 7000, end_ms: 8000 };
  source.rebound = { ...source.confirmation, start_ms: 8000, end_ms: 9000 };
  source.decision = { ...source.confirmation, start_ms: 9000, end_ms: 10000 };
  const { candidate_id: parentId, ...record } = source;
  source.candidate_id = await compoundHash(record);
  await validateCompoundCandidate(source);

  // When the public annotation builder formats the validated low reinforcement in English.
  const annotation = buildCompoundCandidateAnnotation(source, { locale: 'en' });

  // Then peak and pullback labels match the mirrored direction without changing its causal marker time.
  assert.equal(annotation.markerLabel, 'Low candidate');
  assert.equal(annotation.markerShape, 'arrow_up');
  assert.equal(annotation.markerTime, 9);
  assert.equal(annotation.summary, 'Low candidate · Failed pullback reinforcement');
  assert.deepEqual(annotation.detailRows.slice(8, 12).map(row => row.label), ['Peak second', 'Pullback second', 'Reinforcement confirmation', 'Related candidate']);
  assert.equal(annotation.detailRows.find(row => row.label === 'Related candidate').value, parentId);
  assert.deepEqual(annotation.notices, ['Exploratory candidate; predictive ability not validated', 'Mirrored rule; not independently validated']);
});

test('user rejects a compound cursor whose Redis sequence component moves backwards within the same millisecond', async () => {
  // Given an acknowledged compound bootstrap at a nonzero Redis sequence.
  const fixture = compoundClientFixture();
  fixture.host.respond(bootstrap());
  fixture.host.respond({ schema_version: 1, status: 'ok', requested_cursor: '7-9', next_cursor: '7-8', messages: [] });

  // When the real long-polling client reads the regressed incremental response.
  const pending = fixture.client.run(fixture.controller.signal);

  // Then the inconsistency stops polling before publishing the bad response.
  await assert.rejects(pending, { message: 'Compound gateway response cursor mismatch/regression' });
  assert.deepEqual(fixture.states, ['connected']);
  assert.deepEqual(fixture.received, [bootstrap()]);
  assert.equal(new URL(fixture.host.requests[1].url).searchParams.get('cursor'), '7-9');
  assert.equal(fixture.host.requests.length, 2);
});

test('user stops a scheduled compound reconnect immediately when the page owner cancels', async (t) => {
  // Given a typed transport failure and the designed two-second reconnect delay.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fixture = compoundClientFixture();
  fixture.host.reject(new Strategy27GatewayTransportError('declared native failure'));
  const pending = fixture.client.run(fixture.controller.signal);
  await observeStrategyCondition(() => fixture.states.length === 1, 'compound reconnect timer is scheduled');

  // When cancellation arrives just before the reconnect deadline.
  t.mock.timers.tick(1999);
  const requestsBeforeAbort = fixture.host.requests.length;
  fixture.controller.abort();

  // Then the pending wait rejects with cancellation and no further native request is issued.
  await assert.rejects(pending, { name: 'AbortError', message: 'Compound request aborted' });
  t.mock.timers.tick(1);
  assert.equal(requestsBeforeAbort, 1);
  assert.equal(fixture.host.requests.length, 1);
  assert.deepEqual(fixture.states, ['reconnecting']);
  assert.deepEqual(fixture.received, []);
});

test('user ignores a compound bootstrap that finishes real hash validation after cancellation', async (t) => {
  // Given a valid compound bootstrap whose real WebCrypto digest completion is externally held.
  const fixture = compoundClientFixture();
  const gate = createStrategyDigestGate(globalThis.crypto.subtle, 1);
  const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { subtle: gate.subtle } });
  t.after(() => Object.defineProperty(globalThis, 'crypto', originalCrypto));
  fixture.host.respond(bootstrap('7-9', [compoundEnvelope()]));
  const pending = fixture.client.run(fixture.controller.signal);
  await gate.entered;

  // When the page owner cancels before the validated digest result is released.
  fixture.controller.abort();
  gate.release();
  await pending;

  // Then the already-read bootstrap cannot publish connected state, candidates or another request.
  assert.equal(gate.calls.length, 2);
  assert.deepEqual(fixture.states, []);
  assert.deepEqual(fixture.received, []);
  assert.equal(fixture.host.requests.length, 1);
});

for (const raw of [null, { status: '200', responseText: '{}' }]) {
  test(`user rejects a compound native transport response ${raw === null ? 'that is absent' : 'with an invalid status type'}`, async () => {
    // Given an explicitly malformed response at the native request boundary.
    const fixture = compoundClientFixture();
    fixture.host.respondRaw(raw);

    // When the real compound client awaits that initial response.
    const pending = fixture.client.run(fixture.controller.signal);

    // Then a concrete transport-contract error stops polling without declaring a connected state.
    await assert.rejects(pending, { message: 'Compound gateway returned an invalid response' });
    assert.deepEqual(fixture.states, []);
    assert.deepEqual(fixture.received, []);
    assert.equal(fixture.host.requests.length, 1);
  });
}

for (const [label, changed, message] of [
  ['request callback', { request: null }, 'Compound client callbacks are required'],
  ['response callback', { onResponse: null }, 'Compound client callbacks are required'],
  ['connection callback', { onConnectionStateChange: null }, 'Compound client callbacks are required'],
  ['unconfigured credential', { authSecret: '' }, 'Compound gateway secret is not configured'],
  ['route-form symbol', { canonicalSymbol: 'BTCUSDT' }, 'Compound canonical symbol is invalid'],
  ['negative reconnect delay', { reconnectDelayMs: -1 }, 'Compound reconnect delay is invalid'],
]) {
  test(`user rejects a compound ${label} before starting transport and can correct that configuration`, async () => {
    // Given an invalid public configuration and a declared external request boundary.
    const host = createStrategy29RequestHost();
    const responses = [];
    const states = [];
    const configuration = {
      request: options => host.request(options), gatewayBaseUrl: 'http://127.0.0.1:18765',
      authSecret: 'fixture-only-not-a-credential', canonicalSymbol: 'BTC/USDT:USDT', reconnectDelayMs: 0,
      onResponse: value => responses.push(value), onConnectionStateChange: value => states.push(value),
    };

    // When the real public constructor checks the caller's configuration.
    const error = captureStrategyError(() => createCompoundCandidateClient({ ...configuration, ...changed }));

    // Then the precise configuration error occurs before any native request or state publication.
    assert.equal(error.message, message);
    assert.deepEqual(host.requests, []);
    assert.deepEqual(responses, []);
    assert.deepEqual(states, []);

    // When corrected configuration receives a gateway that does not yet expose the optional route.
    host.respondRaw({ status: 404, responseText: '<html>route unavailable</html>' });
    const client = createCompoundCandidateClient(configuration);
    await client.run(new AbortController().signal);

    // Then the client follows the documented unsupported-route behavior with exactly one request.
    assert.equal(host.requests.length, 1);
    assert.deepEqual(states, ['unsupported']);
    assert.deepEqual(responses, []);
  });
}

test('user rejects a directional annotation when a valid live envelope reports conflicting candidate directions', () => {
  // Given valid opened and updated envelopes whose latest full-second evidence contains both directions.
  const lifecycle = new LiveEventLifecycle('BTR/USDT:USDT', { maxEvents: 80, maxAgeMs: 7200000 });
  const opened = ordinaryEnvelope(1);
  opened.payload.event.trigger_reasons = ['aggressive_buy_to_ask_depth'];
  lifecycle.apply(opened);
  const updated = structuredClone(opened);
  updated.sequence = 2;
  updated.message_kind = 'event_updated';
  updated.event_time_ms = 2000;
  updated.payload.event.latest_snapshot.bucket_end_ms = 2000;
  updated.payload.event.latest_snapshot.source_bucket_count = 4;
  updated.payload.event.latest_snapshot.candidate_observations = ['bearish_buy_impact_failure', 'bullish_sell_impact_failure'];
  const action = lifecycle.apply(updated);

  // When the real annotation builder resolves a directional marker from that accepted wire evidence.
  const error = captureStrategyError(() => buildEventAnnotation({ ...action, locale: 'en' }));

  // Then contradictory directions produce an explicit display failure instead of choosing one arbitrarily.
  assert.equal(error.message, 'Strategy 27 candidate observations contain conflicting directions');
  assert.equal(action.type, 'event');
  assert.equal(action.messageKind, 'event_updated');
  assert.deepEqual(action.event.latest_snapshot.candidate_observations, ['bearish_buy_impact_failure', 'bullish_sell_impact_failure']);
  assert.equal(lifecycle.lastSequence, 2);
});

test('user leaves neutral ordinary-event annotations unpinned until actual candidate evidence arrives', () => {
  // Given a valid ordinary event with no candidate direction in its live snapshot.
  const lifecycle = new LiveEventLifecycle('BTR/USDT:USDT', { maxEvents: 80, maxAgeMs: 7200000 });
  const opened = ordinaryEnvelope(1);
  opened.payload.event.trigger_reasons = ['aggressive_buy_to_ask_depth'];
  const action = lifecycle.apply(opened);
  const annotation = buildEventAnnotation({ ...action, locale: 'en' });
  const presentations = new Map();

  // When the public stabilization function receives the real neutral annotation.
  const result = stabilizeCandidatePresentation(presentations, eventId, annotation);

  // Then no directional marker or persistent presentation is invented.
  assert.equal(result, annotation);
  assert.equal(result.markerShape, null);
  assert.equal(result.candidateText, null);
  assert.equal(result.title, 'Order-flow observation');
  assert.equal(presentations.size, 0);
});

test('user receives an explicit notional formatting error instead of displaying a non-finite amount', () => {
  // Given a public notional formatter input that cannot represent a finite observed amount.
  const value = 'Infinity';

  // When the formatter validates the display amount.
  const error = captureStrategyError(() => formatNotional(value, 'observed buy notional'));

  // Then invalid numeric evidence is named and finite amounts still render normally.
  assert.equal(error.message, 'Invalid Strategy 27 display number: observed buy notional');
  assert.equal(formatNotional('1200', 'observed buy notional'), '1.2K');
});
