import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  Strategy29GatewayTransportError,
  createStrategy29SummaryClient,
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
    canonicalSymbol: 'BTC/USDT:USDT',
    maxPagesPerPoll: 2,
    onStatus: (value) => snapshots.push(value),
    onEvents: (value) => received.push(...value),
    onCursorReset: (value) => resets.push(value),
    ...overrides,
  });
  return { client, requests, snapshots, received, resets };
}

test('bootstraps recent events once then follows the global high-water cursor', async () => {
  const fixture = clientFixture([
    response(status), response({ ...events, next_cursor: 100_000, has_more: false }),
    response(status), response({ ...events, events: [], next_cursor: 100_200, has_more: false }),
  ]);
  await fixture.client.poll(new AbortController().signal);
  const firstUrl = new URL(fixture.requests[1].path, 'https://gateway.invalid');
  assert.equal(firstUrl.searchParams.get('mode'), 'latest');
  assert.equal(firstUrl.searchParams.get('limit'), '20');
  assert.equal(firstUrl.searchParams.has('cursor'), false);
  assert.deepEqual(fixture.received.map(event => event.sequence), [41, 42]);
  await fixture.client.poll(new AbortController().signal);
  const nextUrl = new URL(fixture.requests[3].path, 'https://gateway.invalid');
  assert.equal(nextUrl.searchParams.get('cursor'), '100000');
  assert.equal(nextUrl.searchParams.has('mode'), false);
  assert.equal(fixture.client.diagnostics.cursor, 100_200);
});

test('a cancelled response cannot advance a resumed client cursor or publish events', async () => {
  let completeOld;
  const oldResponse = new Promise(resolve => { completeOld = resolve; });
  const fixture = clientFixture([
    response(status), oldResponse,
    response(status), response({ ...events, next_cursor: 100_000, has_more: false }),
  ]);
  const oldController = new AbortController();
  const oldPoll = fixture.client.poll(oldController.signal);
  await new Promise(resolve => setImmediate(resolve));
  oldController.abort(new DOMException('hidden', 'AbortError'));
  await fixture.client.poll(new AbortController().signal);
  completeOld(response({ ...events, next_cursor: 500, has_more: false }));
  await assert.rejects(oldPoll, error => error.name === 'AbortError');
  assert.equal(fixture.client.diagnostics.cursor, 100_000);
  assert.deepEqual(fixture.received.map(event => event.sequence), [41, 42]);
});

test('rejects incomplete or oversized latest snapshots', async () => {
  for (const latest of [
    { ...events, has_more: true },
    { ...events, has_more: false, events: Array(21).fill(events.events[0]) },
  ]) {
    const fixture = clientFixture([response(status), response(latest)]);
    await assert.rejects(fixture.client.poll(new AbortController().signal), /complete and bounded/);
    assert.equal(fixture.client.diagnostics.cursor, null);
    assert.deepEqual(fixture.received, []);
  }
});

test('a cancelled status response cannot publish status or start another request', async () => {
  let complete;
  const fixture = clientFixture([new Promise(resolve => { complete = resolve; })]);
  const controller = new AbortController();
  const poll = fixture.client.poll(controller.signal);
  controller.abort(new DOMException('retired', 'AbortError'));
  complete(response(status));
  await assert.rejects(poll, error => error.name === 'AbortError');
  assert.deepEqual(fixture.snapshots, []);
  assert.equal(fixture.requests.length, 1);
});

test('polls status then bounded event pages and accepts filtered empty progress', async () => {
  const first = { ...events, events: [], next_cursor: 20, has_more: true };
  const second = { ...events, next_cursor: 42, has_more: false };
  const fixture = clientFixture([
    response(status), response({ ...events, events: [], next_cursor: 0, has_more: false }),
    response(status), response(first), response(second),
  ]);
  await fixture.client.poll(new AbortController().signal);
  const result = await fixture.client.poll(new AbortController().signal);
  assert.deepEqual(result, { state: 'connected', pages: 2, hasMore: false });
  assert.equal(fixture.requests[0].path, '/v1/strategy29/status');
  assert.match(fixture.requests[1].path, /symbol=BTC%2FUSDT%3AUSDT/);
  assert.doesNotMatch(fixture.requests[1].path, /secret|Authorization/i);
  assert.match(fixture.requests[4].path, /cursor=20/);
  assert.deepEqual(fixture.received.map((event) => event.sequence), [41, 42]);
  assert.equal(fixture.client.diagnostics.cursor, 42);
});

test('409 replaces retained history with a recent snapshot without clearing local chart state', async () => {
  const fixture = clientFixture([
    response(status), response({ ...events, events: [], next_cursor: 0, has_more: false }),
    response(status),
    response({ schema_version: 1, error: 'cursor_expired', oldest_cursor: 40 }, 409),
    response({ ...events, next_cursor: 42, has_more: false }),
  ]);
  await fixture.client.poll(new AbortController().signal);
  const result = await fixture.client.poll(new AbortController().signal);
  assert.deepEqual(result, { state: 'connected', pages: 2, hasMore: false });
  assert.deepEqual(fixture.resets, [40]);
  assert.match(fixture.requests[4].path, /mode=latest/);
  assert.doesNotMatch(fixture.requests[4].path, /cursor=/);
});

test('rejects has_more without cursor progress and does not loop', async () => {
  const stalled = { ...events, events: [], next_cursor: 0, has_more: true };
  const fixture = clientFixture([
    response(status), response({ ...events, events: [], next_cursor: 0, has_more: false }),
    response(status), response(stalled),
  ]);
  await fixture.client.poll(new AbortController().signal);
  await assert.rejects(
    fixture.client.poll(new AbortController().signal),
    /cursor did not advance/,
  );
  assert.equal(fixture.requests.length, 4);
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

for (const error of ['module_disabled', 'gateway_unavailable']) {
  for (const endpoint of ['status', 'events']) {
    test(`${endpoint} preserves the typed ${error} state without requesting extra pages`, async () => {
      const body = { schema_version: 1, error, strategy_id: '29', ...(error === 'module_disabled' ? { status: 'disabled' } : {}) };
      const fixture = clientFixture(endpoint === 'status' ? [response(body, 503)] : [response(status), response(body, 503)]);
      assert.deepEqual(await fixture.client.poll(new AbortController().signal), {
        state: error, pages: endpoint === 'status' ? 0 : 1, hasMore: false,
      });
      assert.equal(fixture.requests.length, endpoint === 'status' ? 1 : 2);
      assert.deepEqual(fixture.resets, []);
      assert.deepEqual(fixture.received, []);
    });
  }
}

test('exposes remote/local spec mismatch before requesting event history', async () => {
  const mismatch = { ...status, spec_version: 'other_spec' };
  delete mismatch.universe;
  const fixture = clientFixture([response(mismatch)]);
  assert.deepEqual(
    await fixture.client.poll(new AbortController().signal),
    { state: 'incompatible', pages: 0, hasMore: false },
  );
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.snapshots[0].spec_version, 'other_spec');
});


test('Unicode selected markets and events preserve canonical identity through polling', async () => {
  const unicodeStatus = JSON.parse(JSON.stringify(status).replaceAll('BTC/USDT:USDT', '牛来/USDT:USDT'));
  const unicodeEvents = JSON.parse(JSON.stringify(events).replaceAll('BTC/USDT:USDT', '牛来/USDT:USDT'));
  const fixture = clientFixture([response(unicodeStatus), response(unicodeEvents)], {
    canonicalSymbol: '牛来/USDT:USDT',
  });
  await fixture.client.poll(new AbortController().signal);
  assert.equal(new URL(fixture.requests[1].path, 'https://gateway.invalid').searchParams.get('symbol'), '牛来/USDT:USDT');
  assert.deepEqual(fixture.received.map(event => event.symbol), ['牛来/USDT:USDT', '牛来/USDT:USDT']);
  assert.equal(fixture.snapshots.length, 1);
});
