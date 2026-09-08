import assert from 'node:assert/strict';
import test from 'node:test';
import { SIGNAL_GATEWAY_BRIDGE, installSignalGatewayBridge, validateSignalGatewayPath } from '../../src/shared/signal-gateway-bridge.js';
import { createSharedGatewayClient } from '../../src/binance-strategy29-bollinger/core/shared-gateway-client.js';
import { Strategy29GatewayTransportError } from '../../src/binance-strategy29-bollinger/core/remote-summary-client.js';

function fixture(implementation) {
  const values = new Map([['strategy27GatewayAuthSecret', 'synthetic-private-value']]);
  const requests = [], timers = new Map();
  let sequence = 0;
  const view = { DOMException, setTimeout(fn) { const id = ++sequence; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); } };
  const owner = installSignalGatewayBridge(view, {
    getValue: (key, initial) => values.has(key) ? values.get(key) : initial,
    gmXmlHttpRequest(options) {
      requests.push(options);
      return implementation ? implementation(options) : { abort() { options.onabort(); } };
    },
  });
  return { view, owner, values, requests, timers, api: view[SIGNAL_GATEWAY_BRIDGE], client: createSharedGatewayClient(view) };
}

test('public capability accepts only exact bounded Strategy29 read paths', () => {
  for (const path of ['/v1/strategy29/status', '/v1/strategy29/events?symbol=BTC%2FUSDT%3AUSDT&mode=latest&limit=20',
    '/v1/strategy29/events?symbol=%E7%89%9B%E6%9D%A5%2FUSDT%3AUSDT&cursor=42']) {
    assert.equal(validateSignalGatewayPath(path), path);
  }
  for (const path of ['https://127.0.0.1:18765/v1/strategy29/status', '//127.0.0.1/v1/strategy29/status',
    '/v1/strategy29/status?x=1', '/v1/strategy29/status#x', '/v1/strategy29/../strategy29/status',
    '/v1/strategy29/status/', '/v1/strategy29/events?symbol=BTC%2FUSDT%3AUSDT&mode=latest&limit=200',
    '/v1/strategy29/events?symbol=BTC%2FUSDT%3AUSDT&cursor=0&cursor=1',
    '/v1/strategy29/events?symbol=BTC%2FUSDT%3AUSDT&cursor=9007199254740992',
    '/v1/strategy29/events?symbol=btc%2FUSDT%3AUSDT&cursor=0',
    '/v1/strategy29/events?symbol=BTC%2FUSDT%3AUSDT&cursor=0&headers=x']) {
    assert.throws(() => validateSignalGatewayPath(path), TypeError);
  }
});

test('only provider headers receive private authentication; public responses are stripped', async () => {
  const f = fixture();
  const signal = new AbortController().signal;
  const pending = f.client.request({ path: '/v1/strategy29/status', signal });
  const request = f.requests[0];
  assert.equal(request.method, 'GET');
  assert.equal(request.url, 'http://127.0.0.1:18765/v1/strategy29/status');
  assert.deepEqual(request.headers, { Authorization: 'Bearer synthetic-private-value' });
  assert.equal(request.redirect, 'error');
  assert.equal(request.anonymous, true);
  request.onload({ status: 200, responseText: '{}', responseHeaders: 'synthetic-private-header', context: 'private' });
  assert.deepEqual(await pending, { status: 200, responseText: '{}' });
  assert.deepEqual(Object.keys(f.api).sort(), ['getState', 'request', 'version']);
  assert.deepEqual(f.api.getState(), { available: true, configured: true, settingsRevision: 0 });
  assert.equal(f.timers.size, 0);
  f.owner.dispose();
});

test('settings changes abort old work and cannot publish an obsolete response', async () => {
  const f = fixture();
  const pending = f.client.request({ path: '/v1/strategy29/status', signal: new AbortController().signal });
  f.owner.settingsChanged();
  f.requests[0].onload({ status: 200, responseText: '{"late":true}' });
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(f.client.getGatewayState().settingsRevision, 1);
  assert.equal(f.timers.size, 0);
  f.owner.dispose();
});

test('caller abort, transport timeout, initialization failure and synchronous completion are bounded', async () => {
  const f = fixture();
  const controller = new AbortController();
  const aborted = f.client.request({ path: '/v1/strategy29/status', signal: controller.signal });
  controller.abort();
  await assert.rejects(aborted, error => error.name === 'AbortError');
  const timed = f.client.request({ path: '/v1/strategy29/status', signal: new AbortController().signal });
  [...f.timers.values()][0]();
  await assert.rejects(timed, Strategy29GatewayTransportError);
  assert.equal(f.timers.size, 0);
  f.owner.dispose();
  const failed = fixture(() => { throw new Error('synthetic private host failure'); });
  await assert.rejects(failed.client.request({ path: '/v1/strategy29/status', signal: new AbortController().signal }),
    error => error instanceof Strategy29GatewayTransportError && !error.message.includes('private'));
  const done = fixture(options => { options.onload({ status: 503, responseText: '{}' }); return { abort() { throw new Error('settled request aborted'); } }; });
  assert.deepEqual(await done.client.request({ path: '/v1/strategy29/status', signal: new AbortController().signal }), { status: 503, responseText: '{}' });
  assert.equal(done.timers.size, 0);
  failed.owner.dispose(); done.owner.dispose();
});

test('missing configuration, invalid origin and excessive public concurrency make no extra requests', async () => {
  const f = fixture();
  f.values.set('strategy27GatewayAuthSecret', '');
  assert.equal(f.client.getGatewayState().configured, false);
  assert.deepEqual(await f.api.request('/v1/strategy29/status', new AbortController().signal), { kind: 'configuration_required' });
  assert.equal(f.requests.length, 0);
  f.values.set('strategy27GatewayAuthSecret', 'synthetic-private-value');
  f.values.set('strategy27GatewayOrigin', 'https://example.test');
  assert.throws(() => f.api.request('/v1/strategy29/status', new AbortController().signal), /loopback/);
  assert.equal(f.requests.length, 0);
  f.values.delete('strategy27GatewayOrigin');
  const pending = Array.from({ length: 4 }, () => f.api.request('/v1/strategy29/status', new AbortController().signal));
  assert.deepEqual(await f.api.request('/v1/strategy29/status', new AbortController().signal), { kind: 'transport_error' });
  assert.equal(f.requests.length, 4);
  f.owner.dispose();
  assert.deepEqual(await Promise.all(pending), Array(4).fill({ kind: 'aborted' }));
  assert.equal(f.timers.size, 0);
  assert.equal(f.client.getGatewayState().available, false);
});
