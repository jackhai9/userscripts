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

test('user observes that Python high/low records validate with identical canonical hashes', async () => {
  // Given detector records with independently fixed Python candidate hashes
  assert.equal(fixtures[0].candidate_id, 'e9695ec55fc07c3882d80e91235e04f37ebd02d16967f30e5913c63486c12dcf');
  assert.equal(fixtures[1].candidate_id, 'd41dfdb6add66f1ee6a2f5457db3535facfc2ddb74459b98ac4c826ff0a61f58');
  // When each complete record passes through the real canonical validator
  const validated = await Promise.all(fixtures.map(fixture => validateCompoundCandidate(fixture)));
  // Then the original detector records and their envelope identities are preserved
  assert.deepEqual(validated, fixtures);
  for (const fixture of fixtures) {
    assert.deepEqual(await validateCompoundCandidate(fixture), fixture);
    assert.deepEqual(await validateCompoundEnvelope(envelope(fixture)), envelope(fixture));
    const reordered = Object.fromEntries(Object.entries(fixture).reverse());
    assert.equal(canonicalCompoundJson(reordered), canonicalCompoundJson(fixture));
    assert.deepEqual(await validateCompoundCandidate(reordered), fixture);
  }
});

test('user observes that changed evidence cannot retain an old candidate identity', async () => {
  // Given the compound candidate identity and evidence schema
  const changed = candidate();
  changed.seed.buy_notional = '7';
  await assert.rejects(validateCompoundCandidate(changed), /candidate hash mismatch/);
  // When candidate processes the configured inputs
  const profile = candidate();
  profile.profile.significant_flow_ratio = '0.06';
  // Then user observes that changed evidence cannot retain an old candidate identity
  await assert.rejects(validateCompoundCandidate(profile), /profile hash mismatch/);
});

test('user observes that canonical decimal grammar and exact endpoint comparisons reject invalid evidence', async () => {
  // Given the compound candidate identity and evidence schema
  for (const invalid of ['-0', '01', '1e-5', '1.0', 'NaN']) {
    const value = candidate();
    value.seed.buy_notional = invalid;
    await assert.rejects(validateCompoundCandidate(value), /canonical decimal/);
  }
  // When candidate processes the configured inputs
  const precise = candidate();
  precise.seed.minimum_mid = '100.0900000000000000000001';
  // Then user observes that canonical decimal grammar and exact endpoint comparisons reject invalid evidence
  await assert.rejects(validateCompoundCandidate(precise), /extrema/);
  const unsafe = envelope();
  unsafe.sequence = Number.MAX_SAFE_INTEGER + 1;
  await assert.rejects(validateCompoundEnvelope(unsafe), /safe integer/);
});

test('user observes that mirror disclosure, causal order, frozen extreme and exact keys are required', async () => {
  // Given the compound candidate identity and evidence schema
  const low = candidate(1);
  low.validation_status = 'exploratory';
  await assert.rejects(validateCompoundCandidate(low), /validation status/);
  // When candidate processes the configured inputs
  const earlier = candidate();
  earlier.confirmation = structuredClone(earlier.seed);
  // Then user observes that mirror disclosure, causal order, frozen extreme and exact keys are required
  await assert.rejects(validateCompoundCandidate(earlier), /evidence ordering/);
  const extreme = candidate();
  extreme.established_extreme = '1000';
  await assert.rejects(validateCompoundCandidate(extreme), /frozen extreme/);
  const extra = candidate();
  extra.confidence = '0.9';
  await assert.rejects(validateCompoundCandidate(extra), /keys must be exact/);
});

test('user observes that self-contained reinforcement keeps its distinct identity and later decision', async () => {
  // Given the compound candidate identity and evidence schema
  const value = candidate();
  value.parent_candidate_id = value.candidate_id;
  value.family = 'failed_rebound';
  value.trough = { ...value.confirmation, start_ms: 7000, end_ms: 8000 };
  value.rebound = { ...value.confirmation, start_ms: 8000, end_ms: 9000 };
  value.decision = { ...value.confirmation, start_ms: 9000, end_ms: 10000 };
  const { candidate_id: baseId, ...record } = value;
  value.candidate_id = await compoundHash(record);
  // When validateCompoundCandidate processes the configured inputs
  const validated = await validateCompoundCandidate(value);
  // Then user observes that self-contained reinforcement keeps its distinct identity and later decision
  assert.notEqual(validated.candidate_id, baseId);
  assert.equal(validated.parent_candidate_id, baseId);
  assert.equal(validated.decision.end_ms, 10000);
  value.rebound = structuredClone(value.trough);
  await assert.rejects(validateCompoundCandidate(value), /reinforcement evidence ordering/);
});

test('user observes that heartbeat and reset use separate exact control payloads', async () => {
  // Given the compound candidate identity and evidence schema
  const value = { ...envelope(), message_kind: 'heartbeat', symbol: null, payload: { state: 'ready' } };
  // When validateCompoundEnvelope processes the configured inputs
  const observedResult = await validateCompoundEnvelope(value);
  // Then user observes that heartbeat and reset use separate exact control payloads
  assert.deepEqual(observedResult, value);
  value.payload.reason = 'startup';
  await assert.rejects(validateCompoundEnvelope(value), /keys must be exact/);
  value.message_kind = 'stream_state';
  assert.deepEqual(await validateCompoundEnvelope(value), value);
  value.symbol = 'BTC/USDT:USDT';
  await assert.rejects(validateCompoundEnvelope(value), /state identity/);
});

test('user observes that envelope cannot claim a decision before it is available or on a different symbol', async () => {
  // Given the compound candidate identity and evidence schema
  const early = envelope();
  early.observed_at_ms = 6999;
  await assert.rejects(validateCompoundEnvelope(early), /identity\/time/);
  // When envelope processes the configured inputs
  const other = envelope();
  other.symbol = 'ETH/USDT:USDT';
  // Then user observes that envelope cannot claim a decision before it is available or on a different symbol
  await assert.rejects(validateCompoundEnvelope(other), /identity\/time/);
});


test('user observes that Unicode canonical JSON uses the same UTF-8 digest as Python', async () => {
  // Given the compound candidate identity and evidence schema
  const scenarioInput = {symbol: '币安人生/USDT:USDT'};
  // When compoundHash processes the configured inputs
  const observedResult = await compoundHash(scenarioInput);
  // Then user observes that Unicode canonical JSON uses the same UTF-8 digest as Python
  assert.equal(observedResult, '3ab4f4a7e5017943dedd5caae3bd17996392a32d843a0cad485f39fba7f96759');
  const value = candidate();
  value.symbol = '币安人生/USDT:USDT';
  const {candidate_id, ...record} = value;
  value.candidate_id = await compoundHash(record);
  assert.deepEqual(await validateCompoundEnvelope(envelope(value)), envelope(value));
});


test('user observes that Python Unicode detector fixture validates with its original candidate hash', async () => {
  // Given the original Unicode detector fixture and its Python candidate hash
  const fixture = JSON.parse(readFileSync(new URL('../../fixtures/strategy27-unicode-candidate.json', import.meta.url), 'utf8'));
  assert.equal(fixture.candidate_id, '07bd5eb977953eb1256784ac14f6cff262c0a2bddfa8928e6c4ab2ddc092b0a1');
  // When the real candidate validator hashes the UTF-8 projection
  const validated = await validateCompoundCandidate(fixture);
  // Then the exact original candidate is accepted without symbol normalization
  assert.deepEqual(validated, fixture);
});
