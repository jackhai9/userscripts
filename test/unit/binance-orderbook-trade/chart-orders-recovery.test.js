import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createChartOrdersRecoveryRecord,
  parseChartOrdersRecoveryRecord,
} from '../../../src/binance-orderbook-trade/core/chart-orders-recovery.js';

test('creates and parses an exact chart orders reload recovery record', () => {
  const raw = createChartOrdersRecoveryRecord(1_000);
  assert.deepEqual(JSON.parse(raw), {
    version: 2,
    originalChecked: true,
    createdAtMs: 1_000,
  });
  assert.deepEqual(parseChartOrdersRecoveryRecord(raw, 2_000), {
    status: 'valid',
    record: { version: 2, originalChecked: true, createdAtMs: 1_000 },
  });
});

test('distinguishes missing, invalid, and future recovery records', () => {
  assert.deepEqual(parseChartOrdersRecoveryRecord(null, 2_000), {
    status: 'missing',
    record: null,
  });
  assert.deepEqual(parseChartOrdersRecoveryRecord('{', 2_000), {
    status: 'invalid',
    record: null,
  });
  assert.deepEqual(parseChartOrdersRecoveryRecord(JSON.stringify({
    version: 2,
    originalChecked: false,
    createdAtMs: 1_000,
  }), 2_000), {
    status: 'invalid',
    record: null,
  });
  assert.deepEqual(parseChartOrdersRecoveryRecord(JSON.stringify({
    version: 2,
    originalChecked: true,
    createdAtMs: 3_000,
  }), 2_000), {
    status: 'invalid',
    record: null,
  });
});

test('valid recovery records do not expire before the hidden chart state is restored', () => {
  const oldRecord = { version: 2, originalChecked: true, createdAtMs: 1_000 };
  assert.deepEqual(parseChartOrdersRecoveryRecord(
    JSON.stringify(oldRecord),
    1_000 + (365 * 24 * 60 * 60 * 1000),
  ), {
    status: 'valid',
    record: oldRecord,
  });
});

test('recovery records reject extra fields and invalid timestamps', () => {
  assert.throws(() => createChartOrdersRecoveryRecord(Number.NaN), /图表委托线恢复时间无效/);
  assert.throws(
    () => parseChartOrdersRecoveryRecord('{}', Number.NaN),
    /图表委托线恢复当前时间无效/,
  );
  assert.deepEqual(parseChartOrdersRecoveryRecord(JSON.stringify({
    version: 2,
    originalChecked: true,
    createdAtMs: 1_000,
    symbol: 'HYPEUSDT',
  }), 2_000), {
    status: 'invalid',
    record: null,
  });
});
