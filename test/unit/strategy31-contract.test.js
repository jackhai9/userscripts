import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStrategy31Events } from '../../src/binance-strategy31-volume-reversal/event-contract.js';
import { validateSignalGatewayPath } from '../../src/shared/signal-gateway-bridge.js';

test('user receives a green arrow at the confirmed candle low', () => {
  // Given a confirmed backend signal for the selected unit
  const symbol = 'ARK/USDT:USDT';
  const event = { id: `31_2_spec_v1:${symbol}:15m:900000`, symbol, timeframe: '15m', bar_open_ms: 900000,
    bar_close_ms: 1800000, open: 10, high: 13, low: 9, close: 12, volume: 101, previous_volume: 100 };
  const payload = { schema_version: 1, strategy_id: '31', spec_version: '31_2_spec_v1', symbol,
    timeframe: '15m', observed_at_ms: 1800000, events: [event] };
  // When the client validates and adapts the event
  const signals = parseStrategy31Events(payload, symbol, '15m');
  // Then the marker uses the green candle open and low, and duplicate events fail
  assert.deepEqual(signals, [{ id: event.id, direction: 'bullish', type: 'confirmed', time: 900, markerPrice: 9 }]);
  assert.throws(() => parseStrategy31Events({ ...payload, events: [event, event] }, symbol, '15m'));
  assert.throws(() => parseStrategy31Events(payload, symbol, '30m'));
  assert.throws(() => parseStrategy31Events({ ...payload, events: [{ ...event, volume: 100 }] }, symbol, '15m'));
});

test('user can request only a bounded Strategy31 projection', () => {
  // Given the exact supported read projection
  const path = '/v1/strategy31/events?symbol=ARK%2FUSDT%3AUSDT&timeframe=15m&limit=200';
  // When the shared capability validates it
  const accepted = validateSignalGatewayPath(path);
  // Then the fixed limit is accepted and arbitrary limits are rejected
  assert.equal(accepted, path);
  assert.throws(() => validateSignalGatewayPath(path.replace('200', '201')));
});

for (const [timeframe, seconds] of [
  ['15m', 900], ['30m', 1800], ['1h', 3600], ['2h', 7200], ['4h', 14400],
  ['6h', 21600], ['8h', 28800], ['12h', 43200], ['1d', 86400], ['3d', 259200], ['1w', 604800],
]) {
  test(`user receives a validated Strategy31 projection on ${timeframe}`, () => {
    // Given a closed green candle aligned to a supported period, including Monday for weekly bars
    const symbol = 'ARK/USDT:USDT';
    const open = (seconds + (timeframe === '1w' ? 345600 : 0)) * 1000;
    const event = { id: `31_2_spec_v1:${symbol}:${timeframe}:${open}`, symbol, timeframe,
      bar_open_ms: open, bar_close_ms: open + seconds * 1000,
      open: 10, high: 13, low: 9, close: 12, volume: 101, previous_volume: 100 };
    const payload = { schema_version: 1, strategy_id: '31', spec_version: '31_2_spec_v1', symbol,
      timeframe, observed_at_ms: event.bar_close_ms, events: [event] };
    const path = `/v1/strategy31/events?${new URLSearchParams({ symbol, timeframe, limit: '200' })}`;

    // When the shared gateway and chart parser accept the same supported period
    const accepted = validateSignalGatewayPath(path);
    const signals = parseStrategy31Events(payload, symbol, timeframe);

    // Then the exact bounded query and server-owned candle coordinate remain available
    assert.equal(accepted, path);
    assert.deepEqual(signals, [{ id: event.id, direction: 'bullish', type: 'confirmed', time: open / 1000, markerPrice: 9 }]);
  });
}

for (const [timeframe, seconds] of [['1m', 60], ['3m', 180], ['5m', 300]]) {
  test(`user cannot parse a Strategy31 arrow on the unsupported ${timeframe} period`, () => {
    // Given an otherwise valid closed signal shorter than fifteen minutes
    const symbol = 'ARK/USDT:USDT';
    const event = { id: `31_2_spec_v1:${symbol}:${timeframe}:${seconds * 1000}`, symbol, timeframe,
      bar_open_ms: seconds * 1000, bar_close_ms: seconds * 2000,
      open: 10, high: 13, low: 9, close: 12, volume: 101, previous_volume: 100 };
    const payload = { schema_version: 1, strategy_id: '31', spec_version: '31_2_spec_v1', symbol,
      timeframe, observed_at_ms: event.bar_close_ms, events: [event] };

    // When the chart parser receives the unsupported signal projection
    const parse = () => parseStrategy31Events(payload, symbol, timeframe);

    // Then the unsupported interval fails before producing any arrow
    assert.throws(parse, { name: 'TypeError', message: 'Invalid Strategy31 event snapshot' });
  });

  test(`user cannot request Strategy31 signals on the unsupported ${timeframe} period`, () => {
    // Given a bounded Strategy31 query for a period shorter than fifteen minutes
    const path = `/v1/strategy31/events?symbol=ARK%2FUSDT%3AUSDT&timeframe=${timeframe}&limit=200`;

    // When page code passes that path to the shared gateway capability
    const validate = () => validateSignalGatewayPath(path);

    // Then the capability rejects it before dispatching authenticated transport
    assert.throws(validate, { name: 'TypeError', message: 'Signal gateway Strategy31 query is invalid' });
  });
}
