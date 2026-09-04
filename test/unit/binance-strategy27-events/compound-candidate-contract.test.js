import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  canonicalCompoundJson,
  compoundHash,
  validateCompoundCandidate,
  validateCompoundEnvelope,
} from '../../../src/binance-strategy27-events/core/compound-candidate-contract.js';

// Synthetic Python detector output locks cross-language canonical bytes/hashes.
const fixtures = JSON.parse(readFileSync(new URL('../../fixtures/strategy27-compound-candidates.json', import.meta.url), 'utf8'));
const candidate = (index = 0) => structuredClone(fixtures[index]);
const envelope = (payload = candidate()) => ({
  schema_version: 1, projection_kind: 'compound_candidate', runtime_epoch: 'a'.repeat(32),
  sequence: 2, message_kind: 'candidate', symbol: payload.symbol, observed_at_ms: 8000, payload,
});

test('Python high/low records validate with identical canonical hashes', async () => {
  assert.equal(fixtures[0].candidate_id, 'e9695ec55fc07c3882d80e91235e04f37ebd02d16967f30e5913c63486c12dcf');
  assert.equal(fixtures[1].candidate_id, 'd41dfdb6add66f1ee6a2f5457db3535facfc2ddb74459b98ac4c826ff0a61f58');
  for (const fixture of fixtures) {
    assert.deepEqual(await validateCompoundCandidate(fixture), fixture);
    assert.deepEqual(await validateCompoundEnvelope(envelope(fixture)), envelope(fixture));
    const reordered = Object.fromEntries(Object.entries(fixture).reverse());
    assert.equal(canonicalCompoundJson(reordered), canonicalCompoundJson(fixture));
    assert.deepEqual(await validateCompoundCandidate(reordered), fixture);
  }
});

test('changed evidence cannot retain an old candidate identity', async () => {
  const changed = candidate();
  changed.seed.buy_notional = '7';
  await assert.rejects(validateCompoundCandidate(changed), /candidate hash mismatch/);
  const profile = candidate();
  profile.profile.significant_flow_ratio = '0.06';
  await assert.rejects(validateCompoundCandidate(profile), /profile hash mismatch/);
});

test('canonical decimal grammar and exact endpoint comparisons reject invalid evidence', async () => {
  for (const invalid of ['-0', '01', '1e-5', '1.0', 'NaN']) {
    const value = candidate();
    value.seed.buy_notional = invalid;
    await assert.rejects(validateCompoundCandidate(value), /canonical decimal/);
  }
  const precise = candidate();
  precise.seed.minimum_mid = '100.0900000000000000000001';
  await assert.rejects(validateCompoundCandidate(precise), /extrema/);
  const unsafe = envelope();
  unsafe.sequence = Number.MAX_SAFE_INTEGER + 1;
  await assert.rejects(validateCompoundEnvelope(unsafe), /safe integer/);
});

test('mirror disclosure, causal order, frozen extreme and exact keys are required', async () => {
  const low = candidate(1);
  low.validation_status = 'exploratory';
  await assert.rejects(validateCompoundCandidate(low), /validation status/);
  const earlier = candidate();
  earlier.confirmation = structuredClone(earlier.seed);
  await assert.rejects(validateCompoundCandidate(earlier), /evidence ordering/);
  const extreme = candidate();
  extreme.established_extreme = '1000';
  await assert.rejects(validateCompoundCandidate(extreme), /frozen extreme/);
  const extra = candidate();
  extra.confidence = '0.9';
  await assert.rejects(validateCompoundCandidate(extra), /keys must be exact/);
});

test('self-contained reinforcement keeps its distinct identity and later decision', async () => {
  const value = candidate();
  value.parent_candidate_id = value.candidate_id;
  value.family = 'failed_rebound';
  value.trough = { ...value.confirmation, start_ms: 7000, end_ms: 8000 };
  value.rebound = { ...value.confirmation, start_ms: 8000, end_ms: 9000 };
  value.decision = { ...value.confirmation, start_ms: 9000, end_ms: 10000 };
  const { candidate_id: baseId, ...record } = value;
  value.candidate_id = await compoundHash(record);
  const validated = await validateCompoundCandidate(value);
  assert.notEqual(validated.candidate_id, baseId);
  assert.equal(validated.parent_candidate_id, baseId);
  assert.equal(validated.decision.end_ms, 10000);
  value.rebound = structuredClone(value.trough);
  await assert.rejects(validateCompoundCandidate(value), /reinforcement evidence ordering/);
});

test('heartbeat and reset use separate exact control payloads', async () => {
  const value = { ...envelope(), message_kind: 'heartbeat', symbol: null, payload: { state: 'ready' } };
  assert.deepEqual(await validateCompoundEnvelope(value), value);
  value.payload.reason = 'startup';
  await assert.rejects(validateCompoundEnvelope(value), /keys must be exact/);
  value.message_kind = 'stream_state';
  assert.deepEqual(await validateCompoundEnvelope(value), value);
  value.symbol = 'BTC/USDT:USDT';
  await assert.rejects(validateCompoundEnvelope(value), /state identity/);
});

test('envelope cannot claim a decision before it is available or on a different symbol', async () => {
  const early = envelope();
  early.observed_at_ms = 6999;
  await assert.rejects(validateCompoundEnvelope(early), /identity\/time/);
  const other = envelope();
  other.symbol = 'ETH/USDT:USDT';
  await assert.rejects(validateCompoundEnvelope(other), /identity\/time/);
});
