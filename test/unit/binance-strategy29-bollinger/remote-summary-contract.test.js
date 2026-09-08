import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  STRATEGY29_SPEC_VERSION,
  canonicalSymbolToRoute,
  routeSymbolToCanonical,
  validateStrategy29EventsResponse,
  validateStrategy29GatewayError,
  validateStrategy29StatusResponse,
} from '../../../src/binance-strategy29-bollinger/core/remote-summary-contract.js';

const status = JSON.parse(await readFile(new URL('../../fixtures/strategy29-gateway-status.json', import.meta.url)));
const events = JSON.parse(await readFile(new URL('../../fixtures/strategy29-gateway-events.json', import.meta.url)));

test('unified gateway module errors require exact identity and state fields', () => {
  const disabled = { schema_version: 1, error: 'module_disabled', strategy_id: '29', status: 'disabled' };
  const unavailable = { schema_version: 1, error: 'gateway_unavailable', strategy_id: '29' };
  assert.equal(validateStrategy29GatewayError(disabled, 503), disabled);
  assert.equal(validateStrategy29GatewayError(unavailable, 503), unavailable);
  for (const body of [
    { ...disabled, strategy_id: '27' }, { ...disabled, status: 'running' },
    { ...unavailable, status: 'disabled' }, { ...disabled, extra: 1 },
    { schema_version: 1, error: 'module_disabled' },
  ]) assert.throws(() => validateStrategy29GatewayError(body, 503), TypeError);
});

const METADATA_KEYS = ['generation', 'refreshed_at_ms', 'last_successful_refreshed_at_ms', 'last_success_age_seconds', 'last_refresh_error_at_ms', 'selection_expires_at_ms'];
const SUCCESS_KEYS = ['last_successful_refreshed_at_ms', 'last_success_age_seconds', 'selection_expires_at_ms'];

function universeForReason(reason) {
  const universe = { ...status.universe, reason };
  universe.refresh_status = reason === 'current' ? 'fresh'
    : reason === 'using_stale_selection_after_refresh_error' ? 'stale_if_error' : 'fail_closed';
  if (universe.refresh_status === 'fail_closed') Object.assign(universe, {
    selected_markets: [], selected_unit_count: 0, ready_unit_count: 0, pending_unit_count: 0,
  });
  if (reason === 'selection_fail_closed' || universe.refresh_status === 'stale_if_error') {
    universe.last_refresh_error_at_ms = status.observed_at_ms;
  }
  if (reason === 'missing_current_universe_facts' || reason === 'incompatible_current_universe_facts') {
    for (const key of METADATA_KEYS) universe[key] = null;
    universe.configured_timeframes = [];
  }
  return universe;
}

test('requires metadata belonging to the reported refresh state', () => {
  const required = {
    current: ['generation', 'refreshed_at_ms', ...SUCCESS_KEYS],
    using_stale_selection_after_refresh_error: METADATA_KEYS,
    selection_fail_closed: ['generation', 'refreshed_at_ms', 'last_refresh_error_at_ms'],
    selection_expired_or_unusable: ['generation', 'refreshed_at_ms', ...SUCCESS_KEYS],
  };
  for (const [reason, keys] of Object.entries(required)) {
    const universe = universeForReason(reason);
    const candidate = { ...status, universe };
    assert.equal(validateStrategy29StatusResponse(candidate, 200), candidate);
    for (const key of keys) assert.throws(() => validateStrategy29StatusResponse({
      ...status, universe: { ...universe, [key]: null },
    }, 200), /universe/, `${reason} requires ${key}`);
  }
  const freshWithoutSuccess = universeForReason('current');
  for (const key of SUCCESS_KEYS) freshWithoutSuccess[key] = null;
  assert.throws(() => validateStrategy29StatusResponse({ ...status, universe: freshWithoutSuccess }, 200), /universe/);
  const failedWithoutSuccess = universeForReason('selection_fail_closed');
  for (const key of SUCCESS_KEYS) failedWithoutSuccess[key] = null;
  const failed = { ...status, universe: failedWithoutSuccess };
  assert.equal(validateStrategy29StatusResponse(failed, 200), failed);
  for (const key of SUCCESS_KEYS) assert.throws(() => validateStrategy29StatusResponse({
    ...failed, universe: { ...failedWithoutSuccess, [key]: status.universe[key] },
  }, 200), /universe/);
  for (const reason of ['missing_current_universe_facts', 'incompatible_current_universe_facts']) {
    const universe = universeForReason(reason);
    const candidate = { ...status, universe };
    assert.equal(validateStrategy29StatusResponse(candidate, 200), candidate);
    for (const key of METADATA_KEYS) assert.throws(() => validateStrategy29StatusResponse({
      ...status, universe: { ...universe, [key]: 1 },
    }, 200), /universe/);
  }
  assert.throws(() => validateStrategy29StatusResponse({ ...status, universe: {
    ...status.universe, last_refresh_error_at_ms: status.observed_at_ms,
  } }, 200), /universe/);
  const expiredStale = { ...status, universe: {
    ...universeForReason('selection_expired_or_unusable'), last_refresh_error_at_ms: status.observed_at_ms,
  } };
  assert.equal(validateStrategy29StatusResponse(expiredStale, 200), expiredStale);
  const clockBack = { ...status, observed_at_ms: status.universe.refreshed_at_ms - 1000,
    universe: { ...status.universe, last_success_age_seconds: 0 } };
  assert.equal(validateStrategy29StatusResponse(clockBack, 200), clockBack);
});

test('accepts stored ready processing while current live admission is pending', () => {
  const candidate = { ...status, universe: {
    ...status.universe, ready_unit_count: 0, pending_unit_count: status.universe.selected_unit_count,
  } };
  assert.equal(candidate.units[0].status, 'ready');
  assert.equal(validateStrategy29StatusResponse(candidate, 200), candidate);
});

test('rejects malformed or contradictory universe status fields', () => {
  for (const change of [
    { generation: '1' }, { refresh_status: 'unknown' }, { unexpected: true },
    { selected_markets: ['BTC'] }, { configured_timeframes: ['1s'] },
    { ready_unit_count: 2 }, { selected_unit_count: 129 },
    { last_success_age_seconds: -1 }, { last_successful_refreshed_at_ms: null },
    { refresh_status: 'fail_closed' },
  ]) {
    assert.throws(() => validateStrategy29StatusResponse({ ...status, universe: { ...status.universe, ...change } }, 200), /universe/);
  }
});

test('canonical Strategy29 symbols round-trip without server-side normalization', () => {
  assert.equal(routeSymbolToCanonical('BTRUSDT'), 'BTR/USDT:USDT');
  assert.equal(canonicalSymbolToRoute('BTR/USDT:USDT'), 'BTRUSDT');
  assert.throws(() => routeSymbolToCanonical('BTRUSD'), /route symbol/);
  assert.throws(() => routeSymbolToCanonical('btrUSDT'), /route symbol/);
  assert.throws(() => canonicalSymbolToRoute('BTR/USDT'), /canonical symbol/);
});

test('accepts only coherent universe refresh state and reason combinations', () => {
  const reasons = {
    fresh: ['current'],
    stale_if_error: ['using_stale_selection_after_refresh_error'],
    fail_closed: ['selection_fail_closed', 'selection_expired_or_unusable', 'missing_current_universe_facts', 'incompatible_current_universe_facts'],
  };
  for (const refreshState of Object.keys(reasons)) {
    for (const reason of Object.values(reasons).flat()) {
      const universe = { ...universeForReason(reason), refresh_status: refreshState };
      const candidate = { ...status, universe };
      if (reasons[refreshState].includes(reason)) assert.equal(validateStrategy29StatusResponse(candidate, 200), candidate);
      else assert.throws(() => validateStrategy29StatusResponse(candidate, 200), /universe/);
    }
  }
});

test('projects only validated identity when status belongs to an incompatible spec', () => {
  const identity = { schema_version: 1, spec_version: 'other_spec', observed_at_ms: status.observed_at_ms };
  const incompatible = { ...identity, get units() { throw new Error('incompatible payload must not be read'); } };
  assert.deepEqual(validateStrategy29StatusResponse(incompatible, 200), identity);
  for (const invalid of [{ schema_version: 2 }, { spec_version: '' }, { observed_at_ms: '1' }]) {
    assert.throws(() => validateStrategy29StatusResponse({ ...identity, ...invalid }, 200), /status/);
  }
});

test('validates exact status fields while preserving visible spec mismatch', () => {
  assert.equal(STRATEGY29_SPEC_VERSION, '29_2_spec_v2');
  assert.equal(validateStrategy29StatusResponse(status, 200), status);
  const mismatch = structuredClone(status);
  mismatch.spec_version = 'other_spec';
  assert.deepEqual(validateStrategy29StatusResponse(mismatch, 200), {
    schema_version: mismatch.schema_version, spec_version: mismatch.spec_version, observed_at_ms: mismatch.observed_at_ms,
  });
  assert.throws(
    () => validateStrategy29StatusResponse({ ...status, unexpected: true }, 200),
    /exact keys/,
  );
  const invalid = structuredClone(status);
  invalid.units[0].last_data_at_ms = '1788580800000';
  assert.throws(() => validateStrategy29StatusResponse(invalid, 200), /last_data_at_ms/);
  for (const unitStatus of ['insufficient_history', 'data_gap', 'failed']) {
    const valid = structuredClone(status);
    valid.units[0].status = unitStatus;
    assert.equal(validateStrategy29StatusResponse(valid, 200), valid);
  }
  const oversized = structuredClone(status);
  oversized.units = Array.from({ length: 129 }, () => status.units[0]);
  assert.throws(() => validateStrategy29StatusResponse(oversized, 200), /128-unit bound/);
});

test('validates exact event identity, direction and cursor progress fields', () => {
  assert.equal(validateStrategy29EventsResponse(events, 200), events);
  const invalidIdentity = structuredClone(events);
  invalidIdentity.events[0].strategy_id = '30';
  assert.throws(() => validateStrategy29EventsResponse(invalidIdentity, 200), /strategy_id/);
  const invalidSide = structuredClone(events);
  invalidSide.events[1].signal_side = 'long';
  assert.throws(() => validateStrategy29EventsResponse(invalidSide, 200), /signal_side/);
  const extra = structuredClone(events);
  extra.events[0].extra = true;
  assert.throws(() => validateStrategy29EventsResponse(extra, 200), /exact keys/);
  const historicalWeekly = structuredClone(events);
  historicalWeekly.events[0].origin = 'historical';
  historicalWeekly.events[0].timeframe = '1w';
  assert.equal(validateStrategy29EventsResponse(historicalWeekly, 200), historicalWeekly);
  const unsupportedSecond = structuredClone(events);
  unsupportedSecond.events[0].timeframe = '1s';
  assert.throws(() => validateStrategy29EventsResponse(unsupportedSecond, 200), /timeframe/);
  const finiteNonPositivePrices = structuredClone(events);
  finiteNonPositivePrices.events[0].close_price = 0;
  finiteNonPositivePrices.events[0].marker_price = -1;
  finiteNonPositivePrices.events[0].warning_high = 0;
  finiteNonPositivePrices.events[0].warning_low = -2;
  assert.equal(validateStrategy29EventsResponse(finiteNonPositivePrices, 200), finiteNonPositivePrices);
  const oversized = structuredClone(events);
  oversized.events = Array.from({ length: 201 }, () => events.events[0]);
  assert.throws(() => validateStrategy29EventsResponse(oversized, 200), /200-event page bound/);
});

test('validates Strategy29 error bodies using error rather than error_code', () => {
  assert.deepEqual(
    validateStrategy29GatewayError(
      { schema_version: 1, error: 'cursor_expired', oldest_cursor: 42 },
      409,
    ),
    { schema_version: 1, error: 'cursor_expired', oldest_cursor: 42 },
  );
  assert.deepEqual(
    validateStrategy29GatewayError({ schema_version: 1, error: 'database_unavailable' }, 503),
    { schema_version: 1, error: 'database_unavailable' },
  );
  assert.throws(
    () => validateStrategy29GatewayError({ schema_version: 1, error_code: 'cursor_expired' }, 409),
    /exact keys/,
  );
});
