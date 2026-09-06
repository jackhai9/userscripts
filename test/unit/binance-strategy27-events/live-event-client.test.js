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

test('accepts only an explicit loopback HTTP gateway origin', () => {
  assert.equal(normalizeGatewayBaseUrl('http://127.0.0.1:18765/'), 'http://127.0.0.1:18765');
  assert.throws(() => normalizeGatewayBaseUrl('https://example.com'), /loopback/);
  assert.throws(() => normalizeGatewayBaseUrl('http://localhost:18765'), /loopback/);
  assert.throws(() => normalizeGatewayBaseUrl('http://127.0.0.1:18765/path'), /origin only/);
});

test('GM JSON request sends the secret only in the authorization header and supports abort', async () => {
  let captured;
  let aborted = false;
  const gmRequest = (options) => {
    captured = options;
    return { abort: () => { aborted = true; options.onabort(); } };
  };
  const request = createGmJsonRequest(gmRequest);
  const controller = new AbortController();
  const pending = request({
    url: 'http://127.0.0.1:18765/v1/strategy27/events?symbol=BTR%2FUSDT%3AUSDT',
    authSecret: 'local-secret',
    signal: controller.signal,
  });
  assert.equal(captured.method, 'GET');
  assert.deepEqual(captured.headers, { Authorization: 'Bearer local-secret' });
  assert.equal(captured.url.includes('local-secret'), false);

  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(aborted, true);
});

test('long polling binds each response to its requested cursor', async () => {
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

  await client.run(controller.signal);
  assert.equal(new URL(urls[0]).pathname, '/v1/strategy27/events/bootstrap');
  assert.equal(new URL(urls[0]).searchParams.has('cursor'), false);
  assert.equal(new URL(urls[1]).pathname, '/v1/strategy27/events');
  assert.equal(new URL(urls[1]).searchParams.get('cursor'), '5-0');
});

test('long polling rejects a response for a different requested cursor', async () => {
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
  await assert.rejects(client.run(new AbortController().signal), /response cursor/);
});

test('reconnects after a GM transport failure and keeps the requested cursor', async () => {
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

  await client.run(controller.signal);
  assert.equal(attempts.length, 3);
  assert.equal(new URL(attempts[1]).searchParams.get('cursor'), '5-0');
  assert.equal(new URL(attempts[2]).searchParams.get('cursor'), '5-0');
  assert.deepEqual(connectionStates, ['reconnecting', 'connected']);
});

test('does not retry response contract failures', async () => {
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

  await assert.rejects(client.run(new AbortController().signal), /invalid JSON/);
  assert.equal(requestCount, 1);
});

test('validated 503 retains the bootstrap phase and the live cursor until recovery', async () => {
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
  await client.run(controller.signal);
  assert.deepEqual(urls.map((url) => url.pathname.endsWith('/bootstrap')), [true, true, false, false, false]);
  assert.deepEqual(urls.map((url) => url.searchParams.get('cursor')), [null, null, '5-0', '5-0', '5-0']);
  assert.deepEqual(published, ['bootstrap', 'ok']);
  assert.deepEqual(states, ['reconnecting', 'connected', 'reconnecting', 'connected']);
});

test('a stopped request cannot publish a late response or connection status', async () => {
  const controller = new AbortController();
  const states = [];
  const published = [];
  const client = createLiveEventClient({
    request: async () => { controller.abort(); return { status: 200, responseText: JSON.stringify(bootstrap()) }; },
    gatewayBaseUrl: 'http://127.0.0.1:18765', authSecret: 'synthetic-test-value', canonicalSymbol: 'BTR/USDT:USDT',
    onConnectionStateChange: (state) => states.push(state), onResponse: async (payload) => published.push(payload),
  });
  await client.run(controller.signal);
  assert.deepEqual(states, []);
  assert.deepEqual(published, []);
});

for (const lateFailure of ['503', 'transport']) {
  test(`aborting before a late ${lateFailure} suppresses reconnecting state`, async () => {
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
    await client.run(controller.signal);
    assert.deepEqual(states, []);
  });
}

test('a validated authorization error remains terminal after live polling starts', async () => {
  let attempts = 0;
  const states = [];
  const client = createLiveEventClient({
    request: async () => ++attempts === 1
      ? { status: 200, responseText: JSON.stringify(bootstrap()) }
      : { status: 401, responseText: JSON.stringify({ schema_version: 1, status: 'error', error_code: 'unauthorized' }) },
    gatewayBaseUrl: 'http://127.0.0.1:18765', authSecret: 'synthetic-test-value', canonicalSymbol: 'BTR/USDT:USDT',
    onConnectionStateChange: (state) => states.push(state), onResponse: async () => {},
  });
  await assert.rejects(client.run(new AbortController().signal), /gateway error: unauthorized/);
  assert.equal(attempts, 2);
  assert.deepEqual(states, []);
});
