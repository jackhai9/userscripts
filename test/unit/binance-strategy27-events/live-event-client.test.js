import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createGmJsonRequest,
  createLiveEventClient,
  normalizeGatewayBaseUrl,
  Strategy27GatewayTransportError,
} from '../../../src/binance-strategy27-events/core/live-event-client.js';

const bootstrap = (next = '5-0') => ({
  schema_version: 1, status: 'bootstrap', projection_kind: 'strategy27_events',
  requested_cursor: null, next_cursor: next, runtime_epoch: 'a'.repeat(32),
  last_sequence: 4, bootstrap_observed_at_ms: 7000, records: [],
});

test('user accepts only an explicit loopback HTTP gateway origin', () => {
  // Given the ordinary gateway transport and response sequence
  const scenarioInput = 'http://127.0.0.1:18765/';
  // When normalizeGatewayBaseUrl processes the configured inputs
  const observedResult = normalizeGatewayBaseUrl(scenarioInput);
  // Then user accepts only an explicit loopback HTTP gateway origin
  assert.equal(observedResult, 'http://127.0.0.1:18765');
  assert.throws(() => normalizeGatewayBaseUrl('https://example.com'), /loopback/);
  assert.throws(() => normalizeGatewayBaseUrl('http://localhost:18765'), /loopback/);
  assert.throws(() => normalizeGatewayBaseUrl('http://127.0.0.1:18765/path'), /origin only/);
});

test('user observes that GM JSON request sends the secret only in the authorization header and supports abort', async () => {
  // Given the ordinary gateway transport and response sequence
  let captured;
  let aborted = false;
  const gmRequest = (options) => {
    captured = options;
    return { abort: () => { aborted = true; options.onabort(); } };
  };
  const request = createGmJsonRequest(gmRequest);
  const controller = new AbortController();
  // When request processes the configured inputs
  const pending = request({
    url: 'http://127.0.0.1:18765/v1/strategy27/events?symbol=BTR%2FUSDT%3AUSDT',
    authSecret: 'local-secret',
    signal: controller.signal,
  });
  // Then user observes that GM JSON request sends the secret only in the authorization header and supports abort
  assert.equal(captured.method, 'GET');
  assert.deepEqual(captured.headers, { Authorization: 'Bearer local-secret' });
  assert.equal(captured.url.includes('local-secret'), false);

  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(aborted, true);
});

test('user observes that long polling binds each response to its requested cursor', async () => {
  // Given the ordinary gateway transport and response sequence
  const urls = [];
  const responses = [
    {
      status: 200,
      responseText: JSON.stringify({
        schema_version: 1,
        ...bootstrap(),
      }),
    },
    {
      status: 200,
      responseText: JSON.stringify({
        schema_version: 1,
        status: 'ok',
        requested_cursor: '5-0',
        next_cursor: '8-0',
        messages: [],
      }),
    },
  ];
  const controller = new AbortController();
  const client = createLiveEventClient({
    request: async ({ url }) => {
      urls.push(url);
      return responses.shift();
    },
    gatewayBaseUrl: 'http://127.0.0.1:18765',
    authSecret: 'secret',
    canonicalSymbol: 'BTR/USDT:USDT',
    onConnectionStateChange: () => {},
    onResponse: async () => {
      if (urls.length === 2) controller.abort();
    },
  });

  // When client.run processes the configured inputs
  await client.run(controller.signal);
  // Then user observes that long polling binds each response to its requested cursor
  assert.equal(new URL(urls[0]).pathname, '/v1/strategy27/events/bootstrap');
  assert.equal(new URL(urls[0]).searchParams.has('cursor'), false);
  assert.equal(new URL(urls[1]).pathname, '/v1/strategy27/events');
  assert.equal(new URL(urls[1]).searchParams.get('cursor'), '5-0');
});

test('user observes that long polling rejects a response for a different requested cursor', async () => {
  // Given the ordinary gateway transport and response sequence
  let requestCount = 0;
  const client = createLiveEventClient({
    request: async () => {
      requestCount += 1;
      return {
        status: 200,
        responseText: JSON.stringify(requestCount === 1 ? bootstrap() : {
        schema_version: 1,
        status: 'ok',
        requested_cursor: '9-0',
        next_cursor: '10-0',
        messages: [],
        }),
      };
    },
    gatewayBaseUrl: 'http://127.0.0.1:18765',
    authSecret: 'secret',
    canonicalSymbol: 'BTR/USDT:USDT',
    onConnectionStateChange: () => {},
    onResponse: async () => {},
  });
  // When client.run processes the configured inputs
  const observedResult = client.run(new AbortController().signal);
  // Then user observes that long polling rejects a response for a different requested cursor
  await assert.rejects(observedResult, /response cursor/);
});

test('user reconnects after a GM transport failure and keeps the requested cursor', async () => {
  // Given the ordinary gateway transport and response sequence
  const attempts = [];
  const connectionStates = [];
  const controller = new AbortController();
  let requestCount = 0;
  const request = createGmJsonRequest((options) => {
    requestCount += 1;
    attempts.push(options.url);
    queueMicrotask(() => {
      if (requestCount === 2) {
        options.onerror();
        return;
      }
      options.onload({
        status: 200,
        responseText: JSON.stringify(requestCount === 1 ? bootstrap() : {
          schema_version: 1, status: 'ok', requested_cursor: '5-0',
          next_cursor: '8-0', messages: [],
        }),
      });
    });
    return { abort: () => options.onabort() };
  });
  const client = createLiveEventClient({
    request,
    gatewayBaseUrl: 'http://127.0.0.1:18765',
    authSecret: 'secret',
    canonicalSymbol: 'BTR/USDT:USDT',
    reconnectDelayMs: 0,
    onConnectionStateChange: (state) => connectionStates.push(state),
    onResponse: async () => {
      if (requestCount === 3) controller.abort();
    },
  });

  // When client.run processes the configured inputs
  await client.run(controller.signal);
  // Then user reconnects after a GM transport failure and keeps the requested cursor
  assert.equal(attempts.length, 3);
  assert.equal(new URL(attempts[1]).searchParams.get('cursor'), '5-0');
  assert.equal(new URL(attempts[2]).searchParams.get('cursor'), '5-0');
  assert.deepEqual(connectionStates, ['reconnecting', 'connected']);
});

test('user does not retry response contract failures', async () => {
  // Given the ordinary gateway transport and response sequence
  let requestCount = 0;
  const client = createLiveEventClient({
    request: async () => {
      requestCount += 1;
      return { status: 200, responseText: 'not-json' };
    },
    gatewayBaseUrl: 'http://127.0.0.1:18765',
    authSecret: 'secret',
    canonicalSymbol: 'BTR/USDT:USDT',
    reconnectDelayMs: 0,
    onConnectionStateChange: () => {},
    onResponse: async () => {},
  });

  // When client.run processes the configured inputs
  const observedResult = client.run(new AbortController().signal);
  // Then user does not retry response contract failures
  await assert.rejects(observedResult, /invalid JSON/);
  assert.equal(requestCount, 1);
});

test('user observes that validated 503 retains the bootstrap phase and the live cursor until recovery', async () => {
  // Given the ordinary gateway transport and response sequence
  const urls = [];
  const states = [];
  const published = [];
  const controller = new AbortController();
  const unavailable = { status: 503, responseText: JSON.stringify({ schema_version: 1, status: 'error', error_code: 'redis_unavailable' }) };
  const responses = [unavailable, { status: 200, responseText: JSON.stringify(bootstrap()) }, unavailable, unavailable,
    { status: 200, responseText: JSON.stringify({ schema_version: 1, status: 'ok', requested_cursor: '5-0', next_cursor: '8-0', messages: [] }) }];
  const client = createLiveEventClient({
    request: async ({ url }) => { urls.push(new URL(url)); assert.ok(responses.length > 0); return responses.shift(); },
    gatewayBaseUrl: 'http://127.0.0.1:18765', authSecret: 'synthetic-test-value', canonicalSymbol: 'BTR/USDT:USDT',
    reconnectDelayMs: 0, onConnectionStateChange: (state) => states.push(state),
    onResponse: async (payload) => { published.push(payload.status); if (published.length === 2) controller.abort(); },
  });
  // When client.run processes the configured inputs
  await client.run(controller.signal);
  // Then user observes that validated 503 retains the bootstrap phase and the live cursor until recovery
  assert.deepEqual(urls.map((url) => url.pathname.endsWith('/bootstrap')), [true, true, false, false, false]);
  assert.deepEqual(urls.map((url) => url.searchParams.get('cursor')), [null, null, '5-0', '5-0', '5-0']);
  assert.deepEqual(published, ['bootstrap', 'ok']);
  assert.deepEqual(states, ['reconnecting', 'connected', 'reconnecting', 'connected']);
});

test('user observes that a stopped request cannot publish a late response or connection status', async () => {
  // Given the ordinary gateway transport and response sequence
  const controller = new AbortController();
  const states = [];
  const published = [];
  const client = createLiveEventClient({
    request: async () => { controller.abort(); return { status: 200, responseText: JSON.stringify(bootstrap()) }; },
    gatewayBaseUrl: 'http://127.0.0.1:18765', authSecret: 'synthetic-test-value', canonicalSymbol: 'BTR/USDT:USDT',
    onConnectionStateChange: (state) => states.push(state), onResponse: async (payload) => published.push(payload),
  });
  // When client.run processes the configured inputs
  await client.run(controller.signal);
  // Then user observes that a stopped request cannot publish a late response or connection status
  assert.deepEqual(states, []);
  assert.deepEqual(published, []);
});

for (const lateFailure of ['503', 'transport']) {
  test(`user observes that aborting before a late ${lateFailure} suppresses reconnecting state`, async () => {
    // Given the ordinary gateway transport and response sequence
    const controller = new AbortController();
    const states = [];
    const client = createLiveEventClient({
      request: async () => {
        controller.abort();
        if (lateFailure === 'transport') throw new Strategy27GatewayTransportError('synthetic transport failure');
        return { status: 503, responseText: JSON.stringify({ schema_version: 1, status: 'error', error_code: 'redis_unavailable' }) };
      },
      gatewayBaseUrl: 'http://127.0.0.1:18765', authSecret: 'synthetic-test-value', canonicalSymbol: 'BTR/USDT:USDT',
      onConnectionStateChange: (state) => states.push(state), onResponse: async () => assert.fail('Stopped response was published'),
    });
    // When client.run processes the configured inputs
    await client.run(controller.signal);
    // Then user observes that aborting before a late the selected case suppresses reconnecting state
    assert.deepEqual(states, []);
  });
}

test('user observes that a validated authorization error remains terminal after live polling starts', async () => {
  // Given the ordinary gateway transport and response sequence
  let attempts = 0;
  const states = [];
  const client = createLiveEventClient({
    request: async () => ++attempts === 1
      ? { status: 200, responseText: JSON.stringify(bootstrap()) }
      : { status: 401, responseText: JSON.stringify({ schema_version: 1, status: 'error', error_code: 'unauthorized' }) },
    gatewayBaseUrl: 'http://127.0.0.1:18765', authSecret: 'synthetic-test-value', canonicalSymbol: 'BTR/USDT:USDT',
    onConnectionStateChange: (state) => states.push(state), onResponse: async () => {},
  });
  // When client.run processes the configured inputs
  const observedResult = client.run(new AbortController().signal);
  // Then user observes that a validated authorization error remains terminal after live polling starts
  await assert.rejects(observedResult, /gateway error: unauthorized/);
  assert.equal(attempts, 2);
  assert.deepEqual(states, []);
});
