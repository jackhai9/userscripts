import { captureThrownError } from '../../helpers/orderbook-migration-errors.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createChartOrdersRecoveryRecord,
  parseChartOrdersRecoveryRecord,
} from '../../../src/binance-orderbook-trade/core/chart-orders-recovery.js';

test("user creates and parses an exact chart orders reload recovery record", () => {
  // Given the persisted chart recovery record is available
  const raw = createChartOrdersRecoveryRecord(1_000);
  // When the chart recovery contract is evaluated
  const observed = JSON.parse(raw);

  // Then creates and parses an exact chart orders reload recovery record
  assert.deepEqual(observed, {
    version: 2,
    originalChecked: true,
    createdAtMs: 1_000,
  });
  assert.deepEqual(parseChartOrdersRecoveryRecord(raw, 2_000), {
    status: 'valid',
    record: { version: 2, originalChecked: true, createdAtMs: 1_000 },
  });
});

test("user distinguishes missing, invalid, and future recovery records", () => {
  // Given the persisted chart recovery record is available
  const scenarioInputs = [null, 2_000];

  // When the chart recovery contract is evaluated
  const observed = parseChartOrdersRecoveryRecord(...scenarioInputs);

  // Then distinguishes missing, invalid, and future recovery records
  assert.deepEqual(observed, {
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

test("user sees that valid recovery records do not expire before the hidden chart state is restored", () => {
  // Given the persisted chart recovery record is available
  const oldRecord = { version: 2, originalChecked: true, createdAtMs: 1_000 };
  // When the chart recovery contract is evaluated
  const observed = parseChartOrdersRecoveryRecord(
    JSON.stringify(oldRecord),
    1_000 + (365 * 24 * 60 * 60 * 1000),
  );

  // Then sees that valid recovery records do not expire before the hidden chart state is restored
  assert.deepEqual(observed, {
    status: 'valid',
    record: oldRecord,
  });
});

test("user sees that recovery records reject extra fields and invalid timestamps", () => {
  // Given the persisted chart recovery record is available
  const scenarioInputs = [Number.NaN];

  // When the chart recovery contract is evaluated
  const observedFailure = captureThrownError(() => createChartOrdersRecoveryRecord(...scenarioInputs));

  // Then sees that recovery records reject extra fields and invalid timestamps
  assert.match(observedFailure.message, /图表委托线恢复时间无效/);
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
