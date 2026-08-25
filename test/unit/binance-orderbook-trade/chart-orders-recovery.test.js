import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TRADINGVIEW_ORDERS_RECOVERY_MAX_AGE_MS,
  createTradingViewOrdersRecoveryRecord,
  parseTradingViewOrdersRecoveryRecord,
} from '../../../src/binance-orderbook-trade/core/tradingview-orders-recovery.js';

test('creates and parses an exact TradingView orders reload recovery record', () => {
  const raw = createTradingViewOrdersRecoveryRecord(1_000);
  assert.deepEqual(JSON.parse(raw), {
    version: 1,
    originalVisible: true,
    createdAtMs: 1_000,
  });
  assert.deepEqual(parseTradingViewOrdersRecoveryRecord(raw, 2_000), {
    status: 'valid',
    record: { version: 1, originalVisible: true, createdAtMs: 1_000 },
  });
});

test('distinguishes missing, invalid, future, and expired recovery records', () => {
  assert.deepEqual(parseTradingViewOrdersRecoveryRecord(null, 2_000), {
    status: 'missing',
    record: null,
  });
  assert.deepEqual(parseTradingViewOrdersRecoveryRecord('{', 2_000), {
    status: 'invalid',
    record: null,
  });
  assert.deepEqual(parseTradingViewOrdersRecoveryRecord(JSON.stringify({
    version: 1,
    originalVisible: false,
    createdAtMs: 1_000,
  }), 2_000), {
    status: 'invalid',
    record: null,
  });
  assert.deepEqual(parseTradingViewOrdersRecoveryRecord(JSON.stringify({
    version: 1,
    originalVisible: true,
    createdAtMs: 3_000,
  }), 2_000), {
    status: 'invalid',
    record: null,
  });

  const expiredRecord = { version: 1, originalVisible: true, createdAtMs: 1_000 };
  assert.deepEqual(parseTradingViewOrdersRecoveryRecord(
    JSON.stringify(expiredRecord),
    1_000 + TRADINGVIEW_ORDERS_RECOVERY_MAX_AGE_MS + 1,
  ), {
    status: 'expired',
    record: expiredRecord,
  });
});

test('recovery records reject extra fields and invalid timestamps', () => {
  assert.throws(() => createTradingViewOrdersRecoveryRecord(Number.NaN), /timestamp is invalid/);
  assert.throws(
    () => parseTradingViewOrdersRecoveryRecord('{}', Number.NaN),
    /current time is invalid/,
  );
  assert.deepEqual(parseTradingViewOrdersRecoveryRecord(JSON.stringify({
    version: 1,
    originalVisible: true,
    createdAtMs: 1_000,
    symbol: 'HYPEUSDT',
  }), 2_000), {
    status: 'invalid',
    record: null,
  });
});
