import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compoundHash } from '../../../src/binance-strategy27-events/core/compound-candidate-contract.js';
import { CompoundCandidateLifecycle } from '../../../src/binance-strategy27-events/core/compound-candidate-lifecycle.js';

const fixtures = JSON.parse(readFileSync(new URL('../../fixtures/strategy27-compound-candidates.json', import.meta.url), 'utf8'));
const EPOCH = 'a'.repeat(32);
const envelope = (payload = structuredClone(fixtures[0]), sequence = 2, epoch = EPOCH) => ({
  schema_version: 1, projection_kind: 'compound_candidate', runtime_epoch: epoch,
  sequence, message_kind: 'candidate', symbol: payload.symbol, observed_at_ms: payload.decision.end_ms, payload,
});
const control = (sequence, kind = 'heartbeat', epoch = EPOCH) => ({
  ...envelope(fixtures[0], sequence, epoch), message_kind: kind, symbol: null,
  payload: kind === 'heartbeat' ? { state: 'ready' } : { state: 'ready', reason: 'startup' },
});
const lifecycle = (maxCandidates = 80, maxAgeMs = 7200000) => new CompoundCandidateLifecycle('BTC/USDT:USDT', { maxCandidates, maxAgeMs });

async function shiftedCandidate(seconds) {
  const value = structuredClone(fixtures[0]);
  for (const field of ['context', 'seed', 'confirmation', 'decision']) {
    value[field].start_ms += seconds * 1000;
    value[field].end_ms += seconds * 1000;
  }
  const { candidate_id, ...record } = value;
  value.candidate_id = await compoundHash(record);
  return value;
}

test('independent high/low records coexist at one second and exact replay is immutable', async () => {
  const state = lifecycle();
  const high = await state.apply(envelope(), 7000);
  const low = await state.apply(envelope(structuredClone(fixtures[1]), 5), 7000);
  assert.equal(high.type, 'candidate');
  assert.equal(low.type, 'candidate');
  assert.equal(state.size, 2);
  assert.notEqual(high.candidate.candidate_id, low.candidate.candidate_id);
  const replay = await state.apply(envelope(structuredClone(fixtures[0]), 8), 8000);
  assert.equal(replay.type, 'replay');
  assert.equal(state.size, 2);
  assert.throws(() => { high.candidate.seed.buy_notional = '999'; }, TypeError);
  const altered = envelope(structuredClone(fixtures[0]), 9);
  altered.payload.seed.buy_notional = '999';
  await assert.rejects(state.apply(altered, 8000), /candidate hash mismatch/);
  assert.equal(state.lastSequence, 8);
});

test('heartbeat retains history, epoch reset clears it, and sequence jumps are valid', async () => {
  const state = lifecycle();
  assert.equal((await state.apply(control(1, 'stream_state'), 7000)).type, 'stream_reset');
  await state.apply(envelope(), 7000);
  assert.equal((await state.apply(control(7), 7000)).type, 'heartbeat');
  assert.equal(state.size, 1);
  await assert.rejects(state.apply(control(7), 7000), /sequence regression/);
  await assert.rejects(state.apply(control(8, 'stream_state'), 7000), /Unexpected stream_state/);
  await assert.rejects(state.apply(envelope(fixtures[0], 1, 'b'.repeat(32)), 7000), /epoch changed without stream_state/);
  const reset = await state.apply(control(1, 'stream_state', 'b'.repeat(32)), 7000);
  assert.deepEqual(reset.removedCandidateIds, [fixtures[0].candidate_id]);
  assert.equal(state.size, 0);
  assert.equal(state.runtimeEpoch, 'b'.repeat(32));
});

test('age is based on the original decision, not replay or heartbeat delivery', async () => {
  const state = lifecycle(80, 1000);
  await state.apply(envelope(), 7000);
  assert.equal((await state.apply(envelope(fixtures[0], 3), 8000)).type, 'replay');
  const heartbeat = await state.apply(control(4), 8001);
  assert.deepEqual(heartbeat.removedCandidateIds, [fixtures[0].candidate_id]);
  assert.equal(state.size, 0);
  const old = await state.apply(envelope(fixtures[0], 5), 8001);
  assert.equal(old.type, 'expired');
  assert.equal(state.size, 0);
});

test('capacity eviction keeps the newest decisions and does not resurrect evicted replay', async () => {
  const state = lifecycle(2);
  const candidates = await Promise.all([shiftedCandidate(0), shiftedCandidate(1), shiftedCandidate(2)]);
  await state.apply(envelope(candidates[0], 2), 9000);
  await state.apply(envelope(candidates[1], 3), 9000);
  const latest = await state.apply(envelope(candidates[2], 4), 9000);
  assert.deepEqual(latest.removedCandidateIds, [candidates[0].candidate_id]);
  assert.equal(state.size, 2);
  assert.equal((await state.apply(envelope(candidates[0], 5), 9000)).type, 'expired');
  assert.equal(state.size, 2);
  assert.deepEqual(state.prune(7209001), candidates.slice(1).map((value) => value.candidate_id));
  assert.equal(state.size, 0);
});

test('same-time independent family is not deduplicated by direction or timestamp', async () => {
  const state = lifecycle();
  const passive = structuredClone(fixtures[0]);
  passive.family = 'passive_support_loss';
  const { candidate_id, ...record } = passive;
  passive.candidate_id = await compoundHash(record);
  await state.apply(envelope(), 7000);
  const action = await state.apply(envelope(passive, 3), 7000);
  assert.equal(action.type, 'candidate');
  assert.equal(state.size, 2);
});

test('a reset during async validation invalidates the in-flight application', async () => {
  const state = lifecycle();
  const pending = state.apply(envelope(), 7000);
  state.reset('unavailable');
  assert.equal((await pending).type, 'cancelled');
  assert.equal(state.size, 0);
  assert.equal(state.runtimeEpoch, null);
  const raw = envelope();
  const applying = state.apply(raw, 7000);
  raw.payload.seed.buy_notional = '999';
  const action = await applying;
  assert.equal(action.type, 'candidate');
  assert.equal(action.candidate.seed.buy_notional, fixtures[0].seed.buy_notional);
});

test('wrong-symbol data cannot mutate stream state', async () => {
  const state = new CompoundCandidateLifecycle('ETH/USDT:USDT', { maxCandidates: 2, maxAgeMs: 1000 });
  await assert.rejects(state.apply(envelope(), 7000), /symbol does not match/);
  assert.equal(state.size, 0);
  assert.equal(state.runtimeEpoch, null);
});
