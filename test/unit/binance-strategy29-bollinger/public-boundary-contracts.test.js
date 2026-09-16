import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createStrategy29SummaryClient } from '../../../src/binance-strategy29-bollinger/core/remote-summary-client.js';
import { createSharedGatewayClient } from '../../../src/binance-strategy29-bollinger/core/shared-gateway-client.js';
import { parseClosedTradingViewBars } from '../../../src/binance-strategy29-bollinger/dom/tradingview-bearish-alerts.js';
import { processingReason } from '../../../src/binance-strategy29-bollinger/ui-copy.js';
import {
  createStrategy29RequestHost, createStrategyGatewayProviderHost, exportStrategyBars,
} from '../../helpers/strategy29-runtime-boundary-host.js';
import { captureStrategyError } from '../../helpers/strategy-migration-boundaries.js';

const status = JSON.parse(await readFile(new URL('../../fixtures/strategy29-gateway-status.json', import.meta.url)));
const events = JSON.parse(await readFile(new URL('../../fixtures/strategy29-gateway-events.json', import.meta.url)));

function clientConfiguration(host, received) {
  return {
    request: options => host.request(options), canonicalSymbol: 'BTC/USDT:USDT', maxPagesPerPoll: 2,
    onStatus: value => received.push({ kind: 'status', value }),
    onEvents: value => received.push({ kind: 'events', value }),
    onCursorReset: value => received.push({ kind: 'reset', value }),
  };
}

for (const [label, changed, message] of [
  ['request adapter', { request: null }, 'request must be a function'],
  ['canonical symbol', { canonicalSymbol: 'BTCUSDT' }, 'canonicalSymbol must use canonical symbol format'],
  ['zero page budget', { maxPagesPerPoll: 0 }, 'maxPagesPerPoll must be between 1 and 10'],
  ['excessive page budget', { maxPagesPerPoll: 11 }, 'maxPagesPerPoll must be between 1 and 10'],
  ['fractional page budget', { maxPagesPerPoll: 1.5 }, 'maxPagesPerPoll must be between 1 and 10'],
  ['status consumer', { onStatus: null }, 'onStatus must be a function'],
  ['event consumer', { onEvents: null }, 'onEvents must be a function'],
  ['cursor-reset consumer', { onCursorReset: null }, 'onCursorReset must be a function'],
]) {
  test(`user rejects an invalid summary ${label} before making requests and can use corrected configuration`, async () => {
    // Given an invalid public client configuration and an untouched external transport.
    const host = createStrategy29RequestHost();
    const received = [];
    const configuration = clientConfiguration(host, received);

    // When the public constructor validates that configuration.
    const error = captureStrategyError(() => createStrategy29SummaryClient({ ...configuration, ...changed }));

    // Then the named contract failure occurs before any request or consumer side effect.
    assert.equal(error.name, 'TypeError');
    assert.equal(error.message, message);
    assert.deepEqual(host.requests, []);
    assert.deepEqual(received, []);

    // When the caller supplies the corrected configuration and a valid first snapshot.
    const client = createStrategy29SummaryClient(configuration);
    host.respond(status);
    host.respond(events);
    const result = await client.poll(new AbortController().signal);

    // Then normal polling publishes exactly the validated status and event page.
    assert.deepEqual(result, { state: 'connected', pages: 1, hasMore: false });
    assert.equal(client.diagnostics.cursor, 42);
    assert.deepEqual(received, [{ kind: 'status', value: status }, { kind: 'events', value: events.events }]);
    assert.equal(host.requests.length, 2);
  });
}

for (const signal of [null, { aborted: false }]) {
  test(`user must supply an AbortSignal ${signal === null ? 'instead of null' : 'with a cancellation event interface'}`, async () => {
    // Given a valid client with a missing or incomplete public cancellation capability.
    const host = createStrategy29RequestHost();
    const received = [];
    const client = createStrategy29SummaryClient(clientConfiguration(host, received));

    // When the caller starts polling without a usable cancellation interface.
    const pending = client.poll(signal);

    // Then polling fails before the request can become unowned.
    await assert.rejects(pending, { name: 'TypeError', message: 'poll requires an AbortSignal' });
    assert.deepEqual(host.requests, []);
    assert.deepEqual(received, []);
    assert.equal(client.diagnostics.cursor, null);
  });
}

test('user rejects an incompatible installed shared provider before invoking its transport', async () => {
  // Given a separately installed provider advertising an incompatible public protocol version.
  const view = { DOMException };
  const provider = createStrategyGatewayProviderHost(view);
  provider.setVersion(2);
  const client = createSharedGatewayClient(view);

  // When the consumer inspects availability and attempts its read request.
  const error = captureStrategyError(() => client.getGatewayState());
  const pending = client.request({ path: '/v1/strategy29/status', signal: new AbortController().signal });

  // Then both public entrypoints reject the version mismatch without contacting that provider.
  assert.equal(error.message, 'Shared signal gateway version is incompatible; update both scripts and reload');
  await assert.rejects(pending, { name: 'TypeError', message: error.message });
  assert.deepEqual(provider.transport.requests, []);
});

for (const state of [
  { available: 'yes', configured: true, settingsRevision: 1 },
  { available: true, configured: true, settingsRevision: -1 },
]) {
  test(`user rejects shared provider state with ${typeof state.available === 'string' ? 'coerced availability' : 'a negative revision'}`, () => {
    // Given an external provider state that does not satisfy the public protocol.
    const view = { DOMException };
    const provider = createStrategyGatewayProviderHost(view);
    provider.setState(state);
    const client = createSharedGatewayClient(view);

    // When the real consumer inspects the provider state.
    const error = captureStrategyError(() => client.getGatewayState());

    // Then the malformed values are not normalized into a working gateway.
    assert.equal(error.name, 'TypeError');
    assert.equal(error.message, 'Shared signal gateway state is invalid');
    assert.deepEqual(provider.transport.requests, []);
  });
}

for (const response of [
  { kind: 'response', status: 200, responseText: '{}', unexpected: true },
  { kind: 'response', status: '200', responseText: '{}' },
  { kind: 'response', status: 200, responseText: null },
]) {
  test(`user rejects a shared provider response ${Object.hasOwn(response, 'unexpected') ? 'with extra fields' : typeof response.status === 'string' ? 'with a nonnumeric status' : 'without response text'}`, async () => {
    // Given an available provider whose next public response violates its exact wire shape.
    const view = { DOMException };
    const provider = createStrategyGatewayProviderHost(view);
    provider.transport.respondRaw(response);
    const client = createSharedGatewayClient(view);
    const signal = new AbortController().signal;

    // When the real shared gateway consumer receives the native response.
    const pending = client.request({ path: '/v1/strategy29/status', signal });

    // Then the response is rejected after one exact request instead of being partially accepted.
    await assert.rejects(pending, { name: 'TypeError', message: 'Shared signal gateway response is invalid' });
    assert.deepEqual(provider.transport.requests, [{ path: '/v1/strategy29/status', signal }]);
  });
}

for (const [label, changed, message] of [
  ['nonintegral interval duration', { resolutionSeconds: 60.5 }, 'TradingView Bollinger alert resolution seconds are invalid'],
  ['invalid observation clock', { observedAtSeconds: NaN }, 'TradingView Bollinger alert observation time is invalid'],
]) {
  test(`user rejects a candle parse with ${label} before treating any candle as closed`, () => {
    // Given one valid native candle and an invalid caller-supplied closing-time boundary.
    const exported = exportStrategyBars([{ time: 60, open: 100, high: 102, low: 99, close: 101 }]);
    const options = { resolution: '1', resolutionSeconds: 60, observedAtSeconds: 120, ...changed };

    // When the public native-bar parser validates its interval and observation boundary.
    const error = captureStrategyError(() => parseClosedTradingViewBars(exported, options));

    // Then invalid timing is explicit while the valid exact close boundary remains accepted.
    assert.equal(error.message, message);
    assert.deepEqual(parseClosedTradingViewBars(exported, { resolution: '1', resolutionSeconds: 60, observedAtSeconds: 120 }), [{ time: 60, open: 100, high: 102, low: 99, close: 101 }]);
  });
}

test('user receives the required closed-candle count in the selected panel language', () => {
  // Given the observer reason describing the exact missing-history requirement.
  const reason = 'requires_67_closed_candles';

  // When the public formatter presents the reason in both supported languages.
  const english = processingReason(reason, 'en');
  const chinese = processingReason(reason, 'zh-CN');

  // Then the human-readable requirement keeps the exact candle count.
  assert.equal(english, 'Requires 67 closed candles');
  assert.equal(chinese, '需要 67 根已收盘 K 线');
});
