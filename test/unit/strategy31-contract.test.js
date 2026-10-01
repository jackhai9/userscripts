import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStrategy31Events } from '../../src/binance-strategy31-volume-reversal/event-contract.js';
import { validateSignalGatewayPath } from '../../src/shared/signal-gateway-bridge.js';

test('user receives a green arrow at the confirmed candle low', () => {
  // Given a confirmed backend signal for the selected unit
  const symbol = 'ARK/USDT:USDT';
  const event = { id: `31_2_spec_v1:${symbol}:5m:300000`, symbol, timeframe: '5m', bar_open_ms: 300000,
    bar_close_ms: 600000, open: 10, high: 13, low: 9, close: 12, volume: 101, previous_volume: 100 };
  const payload = { schema_version: 1, strategy_id: '31', spec_version: '31_2_spec_v1', symbol,
    timeframe: '5m', observed_at_ms: 600000, events: [event] };
  // When the client validates and adapts the event
  const signals = parseStrategy31Events(payload, symbol, '5m');
  // Then the marker uses the green candle open and low, and duplicate events fail
  assert.deepEqual(signals, [{ id: event.id, direction: 'bullish', type: 'confirmed', time: 300, markerPrice: 9 }]);
  assert.throws(() => parseStrategy31Events({ ...payload, events: [event, event] }, symbol, '5m'));
  assert.throws(() => parseStrategy31Events(payload, symbol, '15m'));
  assert.throws(() => parseStrategy31Events({ ...payload, events: [{ ...event, volume: 100 }] }, symbol, '5m'));
});

test('user can request only a bounded Strategy31 projection', () => {
  // Given the exact supported read projection
  const path = '/v1/strategy31/events?symbol=ARK%2FUSDT%3AUSDT&timeframe=5m&limit=200';
  // When the shared capability validates it
  const accepted = validateSignalGatewayPath(path);
  // Then the fixed limit is accepted and arbitrary limits are rejected
  assert.equal(accepted, path);
  assert.throws(() => validateSignalGatewayPath(path.replace('200', '201')));
});
