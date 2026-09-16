import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createGmJsonRequest, createLiveEventClient, normalizeGatewayBaseUrl, Strategy27GatewayTransportError,
} from '../../../src/binance-strategy27-events/core/live-event-client.js';
import {
  captureStrategyError, createStrategyGmBoundary, observeStrategyCondition,
} from '../../helpers/strategy-migration-boundaries.js';

const bootstrap = next => ({
  schema_version: 1, status: 'bootstrap', projection_kind: 'strategy27_events',
  requested_cursor: null, next_cursor: next, runtime_epoch: 'a'.repeat(32),
  last_sequence: 4, bootstrap_observed_at_ms: 7000, records: [],
});
const response = payload => ({ status: 200, responseText: JSON.stringify(payload) });
const options = overrides => ({
  gatewayBaseUrl: 'http://127.0.0.1:18765', authSecret: 'synthetic-fixture-value', canonicalSymbol: 'BTR/USDT:USDT',
  request: async () => response(bootstrap('5-0')), onResponse() {}, onConnectionStateChange() {}, ...overrides,
});

for (const origin of ['http://127.0.0.1', 'http://guest@127.0.0.1:18765', 'http://127.0.0.1:18765?cursor=5', 'http://127.0.0.1:18765#fragment']) {
  test(`user rejects gateway origin decorations or an implicit port: ${origin}`, () => {
    // Given a loopback address that is not an explicit bare origin
    const configured = origin;
    // When gateway configuration validates the origin
    const failure = captureStrategyError(() => normalizeGatewayBaseUrl(configured));
    // Then no decorated or implicit-port address is accepted
    assert.match(failure.message, /loopback origin only/);
  });
}

for (const [field, value, message] of [
  ['request', null, /request function is required/],
  ['authSecret', '', /secret is not configured/],
  ['canonicalSymbol', '', /canonical symbol is required/],
  ['onResponse', null, /response listener is required/],
  ['onConnectionStateChange', null, /connection state listener is required/],
  ['reconnectDelayMs', -1, /reconnect delay is invalid/],
  ['reconnectDelayMs', 0.5, /reconnect delay is invalid/],
]) {
  test(`user receives an explicit client configuration error for ${field}=${value}`, () => {
    // Given a client configuration containing one invalid required field
    const configured = options({ [field]: value });
    // When the real live client validates that configuration
    const failure = captureStrategyError(() => createLiveEventClient(configured));
    // Then the exact invalid dependency or value is reported before a request
    assert.match(failure.message, message);
  });
}

test('user cannot create a GM request adapter without the native transport', () => {
  // Given an installation with no Tampermonkey request function
  const nativeRequest = undefined;
  // When the adapter is created
  const failure = captureStrategyError(() => createGmJsonRequest(nativeRequest));
  // Then the unavailable transport is reported explicitly
  assert.match(failure.message, /GM request adapter is unavailable/);
});

test('user starts no native request after its signal has already been cancelled', async () => {
  // Given a cancelled request signal and an independently controlled GM boundary
  const boundary = createStrategyGmBoundary();
  const controller = new AbortController();
  controller.abort();
  const request = createGmJsonRequest(boundary.request);
  // When the adapter receives a request for the cancelled operation
  const pending = request({ url: 'http://127.0.0.1:18765/v1/strategy27/events', authSecret: 'synthetic-fixture-value', signal: controller.signal });
  // Then cancellation is reported without invoking the host transport
  await assert.rejects(pending, { name: 'AbortError' });
  assert.deepEqual(boundary.requests, []);
});

test('user retains the first native result and aborting its completed signal does not abort the host handle', async () => {
  // Given a pending request with a host boundary that forwards every callback
  const boundary = createStrategyGmBoundary();
  const controller = new AbortController();
  const request = createGmJsonRequest(boundary.request);
  const pending = request({ url: 'http://127.0.0.1:18765/v1/strategy27/events', authSecret: 'synthetic-fixture-value', signal: controller.signal });
  const host = boundary.requests[0];
  const expected = response(bootstrap('5-0'));
  // When the host delivers a result followed by an error and timeout
  host.load(expected);
  host.error();
  host.timeout();
  const result = await pending;
  controller.abort();
  // Then the real adapter keeps the first result and removes its abort subscription
  assert.equal(result, expected);
  assert.equal(host.abortCalls, 0);
  assert.equal(host.options.timeout, 25000);
});

for (const event of ['error', 'timeout']) {
  test(`user receives a typed transport failure from native ${event} delivery`, async () => {
    // Given a pending native gateway request
    const boundary = createStrategyGmBoundary();
    const controller = new AbortController();
    const request = createGmJsonRequest(boundary.request);
    const pending = request({ url: 'http://127.0.0.1:18765/v1/strategy27/events', authSecret: 'synthetic-fixture-value', signal: controller.signal });
    // When the native host emits the selected transport failure
    boundary.requests[0][event]();
    // Then the failure retains the recoverable gateway transport type
    await assert.rejects(pending, error => error instanceof Strategy27GatewayTransportError
      && error.message === `Strategy 27 gateway request ${event === 'timeout' ? 'timed out' : 'failed'}`);
  });
}

for (const invalid of [null, { status: 200.5, responseText: '{}' }, { status: 200, responseText: {} }]) {
  test(`user rejects malformed native response structure ${JSON.stringify(invalid)}`, async () => {
    // Given a native response outside the documented GM status/text contract
    let requests = 0;
    const client = createLiveEventClient(options({ request: async () => { requests += 1; return invalid; } }));
    // When the live client receives the malformed native response
    const pending = client.run(new AbortController().signal);
    // Then response validation stops before a retry or publication
    await assert.rejects(pending, /invalid GM response/);
    assert.equal(requests, 1);
  });
}

for (const [initial, next, accepted] of [['5-0', '5-0', true], ['5-0', '5-1', true], ['5-1', '5-0', false], ['5-0', '4-9', false]]) {
  test(`user ${accepted ? 'accepts' : 'rejects'} live cursor transition ${initial} to ${next}`, async () => {
    // Given an established bootstrap cursor and an exact live request echo
    const controller = new AbortController();
    const published = [];
    let requests = 0;
    const client = createLiveEventClient(options({
      request: async () => response(++requests === 1 ? bootstrap(initial) : {
        schema_version: 1, status: 'ok', requested_cursor: initial, next_cursor: next, messages: [],
      }),
      onResponse(payload) { published.push(payload.status); if (payload.status === 'ok') controller.abort(); },
    }));
    // When the real stream client compares both cursor components
    const pending = client.run(controller.signal);
    // Then only equal or increasing cursors reach the consumer
    if (accepted) await pending;
    else await assert.rejects(pending, /cursor regressed/);
    assert.deepEqual(published, accepted ? ['bootstrap', 'ok'] : ['bootstrap']);
    assert.equal(requests, 2);
  });
}

test('user retries repeated transport failures only at the configured deadline and reports reconnection once', async (t) => {
  // Given a client whose first two native requests fail and whose retry deadline is two seconds
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController();
  const states = [];
  let requests = 0;
  const client = createLiveEventClient(options({
    request: async () => { requests += 1; if (requests < 3) throw new Strategy27GatewayTransportError('Synthetic outage'); return response(bootstrap('5-0')); },
    onConnectionStateChange: state => states.push(state),
    onResponse: () => controller.abort(),
  }));
  // When the first failure reaches its retry wait
  const pending = client.run(controller.signal);
  await observeStrategyCondition(() => states.length === 1, 'first transport failure');
  t.mock.timers.tick(1999);
  // Then no retry occurs before the deadline
  assert.equal(requests, 1);
  assert.deepEqual(states, ['reconnecting']);
  // When two explicit retry deadlines pass
  t.mock.timers.tick(1);
  await observeStrategyCondition(() => requests === 2, 'second transport failure');
  t.mock.timers.tick(2000);
  await pending;
  // Then repeated outages share one reconnecting notice and successful recovery is delivered once
  assert.equal(requests, 3);
  assert.deepEqual(states, ['reconnecting', 'connected']);
});

for (const when of ['immediate', 'during wait']) {
  test(`user cancels ${when} reconnect delay without making another request`, async (t) => {
    // Given a recoverable transport failure and a cancellable retry clock
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const controller = new AbortController();
    let requests = 0;
    const states = [];
    const client = createLiveEventClient(options({
      request: async () => { requests += 1; throw new Strategy27GatewayTransportError('Synthetic outage'); },
      onConnectionStateChange(state) { states.push(state); if (when === 'immediate') controller.abort(); },
    }));
    // When cancellation occurs at the selected retry boundary
    const pending = client.run(controller.signal);
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    if (when === 'during wait') {
      await observeStrategyCondition(() => states.length === 1, 'entered reconnect delay');
      controller.abort();
    }
    await rejected;
    t.mock.timers.tick(2000);
    // Then the cancelled client makes no additional request
    assert.equal(requests, 1);
    assert.deepEqual(states, ['reconnecting']);
  });
}

test('user can cancel from the recovery notice before any recovered payload is published', async () => {
  // Given a transport that recovers after one typed failure
  const controller = new AbortController();
  const published = [], states = [];
  let requests = 0;
  const client = createLiveEventClient(options({
    reconnectDelayMs: 0,
    request: async () => { if (++requests === 1) throw new Strategy27GatewayTransportError('Synthetic outage'); return response(bootstrap('5-0')); },
    onConnectionStateChange(state) { states.push(state); if (state === 'connected') controller.abort(); },
    onResponse: payload => published.push(payload),
  }));
  // When the recovery notice cancels the current operation
  await client.run(controller.signal);
  // Then the recovered response is not published after ownership was retired
  assert.deepEqual(states, ['reconnecting', 'connected']);
  assert.deepEqual(published, []);
  assert.equal(requests, 2);
});

test('user receives an internal request failure unchanged without transport retries', async () => {
  // Given a request dependency throwing a non-transport programming failure
  const expected = new TypeError('Synthetic adapter contract failure');
  let requests = 0;
  const client = createLiveEventClient(options({ request: async () => { requests += 1; throw expected; } }));
  // When the live client executes that request
  const pending = client.run(new AbortController().signal);
  // Then the original failure propagates and no retry is attempted
  await assert.rejects(pending, error => error === expected);
  assert.equal(requests, 1);
});
