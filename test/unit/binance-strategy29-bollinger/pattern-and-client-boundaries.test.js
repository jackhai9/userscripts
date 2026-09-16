import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  calculateBearishBollingerIndicatorBars, detectBearishBollingerSignals,
  detectBollingerSignals, detectBullishBollingerSignals,
} from '../../../src/binance-strategy29-bollinger/core/bearish-bollinger-pattern.js';
import {
  createStrategy29SummaryClient, Strategy29GatewayTransportError,
} from '../../../src/binance-strategy29-bollinger/core/remote-summary-client.js';
import { createSharedGatewayClient } from '../../../src/binance-strategy29-bollinger/core/shared-gateway-client.js';
import { createOscillatingStrategyBars, createStrategy29RequestHost } from '../../helpers/strategy29-runtime-boundary-host.js';

const status = JSON.parse(await readFile(new URL('../../fixtures/strategy29-gateway-status.json', import.meta.url)));
const events = JSON.parse(await readFile(new URL('../../fixtures/strategy29-gateway-events.json', import.meta.url)));

function summaryFixture() {
  const host = createStrategy29RequestHost();
  const statuses = [];
  const received = [];
  const resets = [];
  const client = createStrategy29SummaryClient({
    request: options => host.request(options), canonicalSymbol: 'BTC/USDT:USDT', maxPagesPerPoll: 2,
    onStatus: value => statuses.push(value),
    onEvents: (value, observedAtMs) => received.push({ value, observedAtMs }),
    onCursorReset: value => resets.push(value),
  });
  return { host, client, statuses, received, resets };
}

test('user receives the same directional signals from raw candles through both public detector entrypoints', () => {
  // Given an unmodified native OHLC series with both market directions.
  const bars = createOscillatingStrategyBars();
  const original = structuredClone(bars);

  // When the public bearish, bullish and combined detectors calculate their own indicators.
  const bearish = detectBearishBollingerSignals(bars);
  const bullish = detectBullishBollingerSignals(bars);
  const combined = detectBollingerSignals(bars);

  // Then setup identities, marker direction and ordering remain exact across the public entrypoints.
  assert.deepEqual(bearish.map(signal => [signal.id, signal.time]), [['6780:warning', 7440], ['6780:confirmed', 7500], ['6780:reversal', 7740]]);
  assert.deepEqual(bullish.map(signal => [signal.id, signal.time]), [['8820:bullish:warning', 9360], ['8820:bullish:reversal', 9900]]);
  assert.deepEqual(combined, [...bearish.map(signal => ({ ...signal, direction: 'bearish' })), ...bullish]);
  const byTime = new Map(bars.map(bar => [bar.time, bar]));
  assert.equal(bearish[0].markerPrice > byTime.get(7440).high, true);
  assert.equal(bearish[2].markerPrice < byTime.get(7740).low, true);
  assert.equal(bullish[0].markerPrice < byTime.get(9360).low, true);
  assert.equal(bullish[1].markerPrice > byTime.get(9900).high, true);
  assert.deepEqual(bars, original);
});

test('user retains already observed signals while later raw candles extend the detector history', () => {
  // Given an OHLC prefix ending before its first reversal and a later native history.
  const prefix = createOscillatingStrategyBars(125);
  const extended = createOscillatingStrategyBars(400);

  // When the real detector processes the successive history windows.
  const before = detectBollingerSignals(prefix);
  const after = detectBollingerSignals(extended);
  const indicators = calculateBearishBollingerIndicatorBars(prefix);

  // Then later candles add decisions without changing already emitted warning and confirmation prices.
  assert.deepEqual(before.map(signal => signal.id), ['6780:warning', '6780:confirmed']);
  assert.deepEqual(after.filter(signal => signal.time <= prefix.at(-1).time), before);
  assert.equal(after.some(signal => signal.id === '6780:reversal'), true);
  assert.deepEqual(indicators.slice(0, 59).map(bar => [bar.middle, bar.upper, bar.lower, bar.ma60]), Array.from({ length: 59 }, () => [null, null, null, null]));
  assert.equal(indicators[59].middle > indicators[59].lower && indicators[59].middle < indicators[59].upper, true);
});

for (const [label, bars, message] of [
  ['a non-array candle window', { data: [] }, 'Bollinger Bollinger bars must be an array'],
  ['an absent candle record', [null], 'Bollinger Bollinger bar 0 is invalid'],
  ['duplicate candle times', [createOscillatingStrategyBars(1)[0], createOscillatingStrategyBars(1)[0]], 'Bollinger Bollinger bar time 1 is invalid'],
]) {
  test(`user receives a precise detector rejection for ${label}`, () => {
    // Given a raw candle boundary that cannot represent a valid ordered market window.
    const input = bars;

    // When the public detector validates that window before calculating signals.
    const detect = () => detectBollingerSignals(input);

    // Then the rejection identifies the invalid input and retryable time races retain their error type.
    assert.throws(detect, { message, name: label === 'duplicate candle times' ? 'TradingViewBarSnapshotInconsistentError' : 'Error' });
  });
}

for (const response of [null, { status: '200', responseText: '{}' }, { status: 200, responseText: null }]) {
  test(`user rejects malformed native gateway transport ${response === null ? 'without a response' : typeof response.status === 'string' ? 'with a nonnumeric status' : 'without response text'}`, async () => {
    // Given a raw host response that has not passed the gateway transport boundary.
    const fixture = summaryFixture();
    fixture.host.respondRaw(response);

    // When the real client requests its initial status.
    const pending = fixture.client.poll(new AbortController().signal);

    // Then the transport error is explicit and no status, events or cursor is published.
    await assert.rejects(pending, { name: 'Strategy29GatewayTransportError', message: 'Strategy29 status returned an invalid transport response' });
    assert.deepEqual(fixture.statuses, []);
    assert.deepEqual(fixture.received, []);
    assert.equal(fixture.client.diagnostics.cursor, null);
    assert.equal(fixture.host.requests.length, 1);
  });
}

test('user makes no gateway request when cancellation precedes the poll', async () => {
  // Given a genuine AbortSignal already cancelled by its owner.
  const fixture = summaryFixture();
  const controller = new AbortController();
  const reason = new DOMException('page retired before poll', 'AbortError');
  controller.abort(reason);

  // When the public client is asked to start a new polling cycle.
  const pending = fixture.client.poll(controller.signal);

  // Then the original cancellation is propagated and transport remains untouched.
  await assert.rejects(pending, error => error === reason);
  assert.deepEqual(fixture.host.requests, []);
  assert.equal(fixture.client.diagnostics.cursor, null);
  assert.deepEqual(fixture.received, []);
});

for (const [label, page, message] of [
  ['a backwards cursor', { ...events, events: [], next_cursor: 41 }, 'Strategy29 event cursor moved backwards'],
  ['a repeated sequence', { ...events, events: [events.events[1]], next_cursor: 43 }, 'Strategy29 event sequences must advance strictly'],
  ['a sequence above the page cursor', { ...events, events: [{ ...events.events[0], sequence: 44 }], next_cursor: 43 }, 'Strategy29 event sequence exceeds next_cursor'],
  ['an unordered increment', { ...events, events: [{ ...events.events[0], sequence: 44 }, { ...events.events[1], sequence: 43 }], next_cursor: 44 }, 'Strategy29 event sequences must advance strictly'],
]) {
  test(`user preserves committed history after receiving ${label} and can resume from the original cursor`, async () => {
    // Given an acknowledged latest snapshot followed by a structurally valid but inconsistent increment.
    const fixture = summaryFixture();
    fixture.host.respond(status);
    fixture.host.respond(events);
    await fixture.client.poll(new AbortController().signal);
    fixture.host.respond(status);
    fixture.host.respond(page);

    // When the real incremental client rejects the next page.
    const rejected = fixture.client.poll(new AbortController().signal);

    // Then no partial event callback or cursor update is committed.
    await assert.rejects(rejected, { name: 'TypeError', message });
    assert.equal(fixture.client.diagnostics.cursor, 42);
    assert.deepEqual(fixture.received.map(item => item.value.map(event => event.sequence)), [[41, 42]]);
    assert.deepEqual(fixture.resets, []);

    // When the gateway next provides a valid filtered increment.
    fixture.host.respond(status);
    fixture.host.respond({ ...events, events: [], next_cursor: 50 });
    const resumed = await fixture.client.poll(new AbortController().signal);

    // Then the client requests the original cursor and advances only to the accepted page.
    assert.equal(new URL(fixture.host.requests[5].path, 'https://gateway.invalid').searchParams.get('cursor'), '42');
    assert.deepEqual(resumed, { state: 'connected', pages: 1, hasMore: false });
    assert.equal(fixture.client.diagnostics.cursor, 50);
    assert.deepEqual(fixture.received.map(item => item.value.map(event => event.sequence)), [[41, 42], []]);
  });
}

test('user preserves the event cursor when the database becomes unavailable after a successful status response', async () => {
  // Given an accepted snapshot and a later events-stage database outage.
  const fixture = summaryFixture();
  fixture.host.respond(status);
  fixture.host.respond(events);
  await fixture.client.poll(new AbortController().signal);
  fixture.host.respond(status);
  fixture.host.respond({ schema_version: 1, error: 'database_unavailable' }, 503);

  // When the next real poll reaches the unavailable events endpoint.
  const result = await fixture.client.poll(new AbortController().signal);

  // Then availability is reported without committing an empty snapshot or discarding history.
  assert.deepEqual(result, { state: 'unavailable', pages: 1, hasMore: false });
  assert.equal(fixture.client.diagnostics.cursor, 42);
  assert.deepEqual(fixture.received.map(item => item.value.map(event => event.sequence)), [[41, 42]]);
  assert.equal(fixture.statuses.length, 2);
});

for (const [httpStatus, error] of [[400, 'invalid_request'], [401, 'unauthorized']]) {
  test(`user receives the validated events HTTP ${httpStatus} failure without advancing history`, async () => {
    // Given a valid server status followed by the declared protocol error body.
    const fixture = summaryFixture();
    fixture.host.respond(status);
    fixture.host.respond({ schema_version: 1, error }, httpStatus);

    // When the real client receives the events endpoint failure.
    const pending = fixture.client.poll(new AbortController().signal);

    // Then the HTTP failure is surfaced and no event page or cursor is accepted.
    await assert.rejects(pending, { name: 'Error', message: `Strategy29 events request failed with HTTP ${httpStatus}` });
    assert.equal(fixture.client.diagnostics.cursor, null);
    assert.deepEqual(fixture.received, []);
    assert.equal(fixture.statuses.length, 1);
  });
}

test('user rejects a missing shared gateway instead of attempting a request through an absent bridge', async () => {
  // Given a page where the shared gateway provider has not been installed.
  const client = createSharedGatewayClient({ DOMException });

  // When its public state and request interfaces are used.
  const state = client.getGatewayState();
  const pending = client.request({ path: '/v1/strategy29/status', signal: new AbortController().signal });

  // Then absence remains explicit and the request fails with a transport-specific error.
  assert.deepEqual(state, { available: false, configured: false, settingsRevision: null });
  await assert.rejects(pending, error => error instanceof Strategy29GatewayTransportError && error.message === 'Shared signal gateway is unavailable');
});
