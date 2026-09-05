import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  Strategy29GatewayTransportError,
  createStrategy29GmJsonRequest,
  createStrategy29SummaryClient,
  normalizeStrategy29GatewayOrigin,
} from '../../../src/binance-strategy29-bollinger/core/remote-summary-client.js';

const status = JSON.parse(await readFile(new URL('../../fixtures/strategy29-gateway-status.json', import.meta.url)));
const events = JSON.parse(await readFile(new URL('../../fixtures/strategy29-gateway-events.json', import.meta.url)));

function response(body, httpStatus = 200) {
  return { status: httpStatus, responseText: JSON.stringify(body) };
}

function clientFixture(responses, overrides = {}) {
  const requests = [];
  const snapshots = [];
  const received = [];
  const resets = [];
  const client = createStrategy29SummaryClient({
    request: async (request) => {
      requests.push(request);
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next;
    },
    gatewayOrigin: 'http://127.0.0.1:8729',
    authSecret: 'synthetic-secret',
    canonicalSymbol: 'BTC/USDT:USDT',
    maxPagesPerPoll: 2,
    onStatus: (value) => snapshots.push(value),
    onEvents: (value) => received.push(...value),
    onCursorReset: (value) => resets.push(value),
    ...overrides,
  });
  return { client, requests, snapshots, received, resets };
}

test('normalizes only an explicit loopback HTTP origin', () => {
  assert.equal(normalizeStrategy29GatewayOrigin('http://127.0.0.1:8729'), 'http://127.0.0.1:8729');
  for (const value of [
    'https://127.0.0.1:8729', 'http://localhost:8729', 'http://127.0.0.1',
    'http://user@127.0.0.1:8729', 'http://127.0.0.1:8729/path',
  ]) assert.throws(() => normalizeStrategy29GatewayOrigin(value), /loopback origin/);
});

test('GM transport sends the secret only in Authorization and owns abort', async () => {
  let options;
  let aborted = false;
  const request = createStrategy29GmJsonRequest((value) => {
    options = value;
    return { abort() { aborted = true; value.onabort(); } };
  });
  const controller = new AbortController();
  const pending = request({
    url: 'http://127.0.0.1:8729/v1/strategy29/status',
    authSecret: 'synthetic-secret',
    signal: controller.signal,
  });
  assert.equal(options.method, 'GET');
  assert.deepEqual(options.headers, { Authorization: 'Bearer synthetic-secret' });
  assert.doesNotMatch(options.url, /synthetic-secret/);
  controller.abort(new DOMException('retired', 'AbortError'));
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(aborted, true);
});

test('GM transport classifies synchronous initialization failure and synchronous completion', async () => {
  const controller = new AbortController();
  const failure = createStrategy29GmJsonRequest(() => { throw new Error('host initialization failed'); });
  await assert.rejects(
    failure({ url: 'http://127.0.0.1:8729/v1/strategy29/status', authSecret: 'x', signal: controller.signal }),
    error => error instanceof Strategy29GatewayTransportError,
  );

  let aborts = 0;
  const success = createStrategy29GmJsonRequest((options) => {
    options.onload({ status: 200, responseText: '{}' });
    return { abort() { aborts += 1; } };
  });
  assert.deepEqual(
    await success({ url: 'http://127.0.0.1:8729/v1/strategy29/status', authSecret: 'x', signal: controller.signal }),
    { status: 200, responseText: '{}' },
  );
  controller.abort();
  assert.equal(aborts, 0);
});

test('polls status then bounded event pages and accepts filtered empty progress', async () => {
  const first = { ...events, events: [], next_cursor: 20, has_more: true };
  const second = { ...events, next_cursor: 42, has_more: false };
  const fixture = clientFixture([response(status), response(first), response(second)]);
  const result = await fixture.client.poll(new AbortController().signal);
  assert.deepEqual(result, { state: 'connected', pages: 2, hasMore: false });
  assert.equal(fixture.requests[0].url, 'http://127.0.0.1:8729/v1/strategy29/status');
  assert.match(fixture.requests[1].url, /symbol=BTC%2FUSDT%3AUSDT/);
  assert.doesNotMatch(fixture.requests[1].url, /secret|Authorization/i);
  assert.match(fixture.requests[2].url, /cursor=20/);
  assert.deepEqual(fixture.received.map((event) => event.sequence), [41, 42]);
  assert.equal(fixture.client.diagnostics.cursor, 42);
});

test('409 advances to the explicit recovery cursor without clearing local chart state', async () => {
  const fixture = clientFixture([
    response(status),
    response({ schema_version: 1, error: 'cursor_expired', oldest_cursor: 40 }, 409),
    response({ ...events, next_cursor: 42, has_more: false }),
  ]);
  const result = await fixture.client.poll(new AbortController().signal);
  assert.deepEqual(result, { state: 'connected', pages: 2, hasMore: false });
  assert.deepEqual(fixture.resets, [40]);
  assert.match(fixture.requests[2].url, /cursor=40/);
});

test('rejects has_more without cursor progress and does not loop', async () => {
  const stalled = { ...events, events: [], next_cursor: 0, has_more: true };
  const fixture = clientFixture([response(status), response(stalled)]);
  await assert.rejects(
    fixture.client.poll(new AbortController().signal),
    /cursor did not advance/,
  );
  assert.equal(fixture.requests.length, 2);
});

test('rejects an event for a symbol other than the strict requested identity', async () => {
  const wrongSymbol = structuredClone(events);
  wrongSymbol.events[0].symbol = 'ETH/USDT:USDT';
  const fixture = clientFixture([response(status), response(wrongSymbol)]);
  await assert.rejects(fixture.client.poll(new AbortController().signal), /requested symbol/);
});

test('reports unavailable status separately from fatal HTTP and contract errors', async () => {
  const unavailable = clientFixture([
    response({ schema_version: 1, error: 'database_unavailable' }, 503),
  ]);
  assert.deepEqual(
    await unavailable.client.poll(new AbortController().signal),
    { state: 'unavailable', pages: 0, hasMore: false },
  );

  for (const failing of [
    response({ schema_version: 1, error: 'unauthorized' }, 401),
    { status: 200, responseText: '<html>' },
  ]) {
    const fixture = clientFixture([failing]);
    await assert.rejects(fixture.client.poll(new AbortController().signal));
  }

  const transport = clientFixture([
    new Strategy29GatewayTransportError('synthetic transport failure'),
  ]);
  await assert.rejects(transport.client.poll(new AbortController().signal), /transport failure/);
});

test('exposes remote/local spec mismatch before requesting event history', async () => {
  const mismatch = { ...status, spec_version: '29_2_spec_v2' };
  const fixture = clientFixture([response(mismatch)]);
  assert.deepEqual(
    await fixture.client.poll(new AbortController().signal),
    { state: 'incompatible', pages: 0, hasMore: false },
  );
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.snapshots[0].spec_version, '29_2_spec_v2');
});
