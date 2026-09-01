import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createGmJsonRequest,
  createLiveEventClient,
  normalizeGatewayBaseUrl,
} from '../../../src/binance-strategy27-events/core/live-event-client.js';

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
        status: 'reset',
        reason: 'initial_cursor',
        requested_cursor: null,
        next_cursor: '5-0',
        messages: [],
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
    onResponse: async () => {
      if (urls.length === 2) controller.abort();
    },
  });

  await client.run(controller.signal);
  assert.equal(new URL(urls[0]).searchParams.has('cursor'), false);
  assert.equal(new URL(urls[1]).searchParams.get('cursor'), '5-0');
});

test('long polling rejects a response for a different requested cursor', async () => {
  const client = createLiveEventClient({
    request: async () => ({
      status: 200,
      responseText: JSON.stringify({
        schema_version: 1,
        status: 'ok',
        requested_cursor: '9-0',
        next_cursor: '10-0',
        messages: [],
      }),
    }),
    gatewayBaseUrl: 'http://127.0.0.1:18765',
    authSecret: 'secret',
    canonicalSymbol: 'BTR/USDT:USDT',
    onResponse: async () => {},
  });
  await assert.rejects(client.run(new AbortController().signal), /response cursor/);
});
