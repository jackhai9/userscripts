import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CHART_ORDERS_RECOVERY_MAX_AGE_MS,
  createChartOrdersRecoveryRecord,
  parseChartOrdersRecoveryRecord,
} from '../../../src/binance-orderbook-trade/core/chart-orders-recovery.js';

test('creates and parses an exact chart-orders reload recovery record', () => {
  const raw = createChartOrdersRecoveryRecord(1_000);
  assert.deepEqual(JSON.parse(raw), {
    version: 1,
    originalChecked: true,
    createdAtMs: 1_000,
  });
  assert.deepEqual(parseChartOrdersRecoveryRecord(raw, 2_000), {
    status: 'valid',
    record: { version: 1, originalChecked: true, createdAtMs: 1_000 },
  });
});

test('distinguishes missing, invalid, future, and expired recovery records', () => {
  assert.deepEqual(parseChartOrdersRecoveryRecord(null, 2_000), {
    status: 'missing',
    record: null,
  });
  assert.deepEqual(parseChartOrdersRecoveryRecord('{', 2_000), {
    status: 'invalid',
    record: null,
  });
  assert.deepEqual(parseChartOrdersRecoveryRecord(JSON.stringify({
    version: 1,
    originalChecked: false,
    createdAtMs: 1_000,
  }), 2_000), {
    status: 'invalid',
    record: null,
  });
  assert.deepEqual(parseChartOrdersRecoveryRecord(JSON.stringify({
    version: 1,
    originalChecked: true,
    createdAtMs: 3_000,
  }), 2_000), {
    status: 'invalid',
    record: null,
  });

  const expiredRecord = { version: 1, originalChecked: true, createdAtMs: 1_000 };
  assert.deepEqual(parseChartOrdersRecoveryRecord(
    JSON.stringify(expiredRecord),
    1_000 + CHART_ORDERS_RECOVERY_MAX_AGE_MS + 1,
  ), {
    status: 'expired',
    record: expiredRecord,
  });
});

test('recovery records reject extra fields and invalid timestamps', () => {
  assert.throws(() => createChartOrdersRecoveryRecord(Number.NaN), /timestamp is invalid/);
  assert.throws(
    () => parseChartOrdersRecoveryRecord('{}', Number.NaN),
    /current time is invalid/,
  );
  assert.deepEqual(parseChartOrdersRecoveryRecord(JSON.stringify({
    version: 1,
    originalChecked: true,
    createdAtMs: 1_000,
    symbol: 'HYPEUSDT',
  }), 2_000), {
    status: 'invalid',
    record: null,
  });
});
