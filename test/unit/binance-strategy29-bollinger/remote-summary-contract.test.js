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

test('canonical Strategy29 symbols round-trip without server-side normalization', () => {
  assert.equal(routeSymbolToCanonical('BTRUSDT'), 'BTR/USDT:USDT');
  assert.equal(canonicalSymbolToRoute('BTR/USDT:USDT'), 'BTRUSDT');
  assert.throws(() => routeSymbolToCanonical('BTRUSD'), /route symbol/);
  assert.throws(() => routeSymbolToCanonical('btrUSDT'), /route symbol/);
  assert.throws(() => canonicalSymbolToRoute('BTR/USDT'), /canonical symbol/);
});

test('validates exact status fields while preserving visible spec mismatch', () => {
  assert.equal(STRATEGY29_SPEC_VERSION, '29_2_spec_v1');
  assert.equal(validateStrategy29StatusResponse(status, 200), status);
  const mismatch = structuredClone(status);
  mismatch.spec_version = '29_2_spec_v2';
  assert.equal(validateStrategy29StatusResponse(mismatch, 200), mismatch);
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
