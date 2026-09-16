import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  Strategy29GatewayTransportError,
  createStrategy29SummaryClient,
} from '../../../src/binance-strategy29-bollinger/core/remote-summary-client.js';

const status = JSON.parse(await readFile(new URL('../../fixtures/strategy29-gateway-status.json', import.meta.url)));
const events = JSON.parse(await readFile(new URL('../../fixtures/strategy29-gateway-events.json', import.meta.url)));
const withoutSelection = { ...status, units: [], universe: {
  ...status.universe, generation: null, refresh_status: 'fail_closed', reason: 'missing_current_universe_facts',
  selected_markets: [], configured_timeframes: [], selected_unit_count: 0, ready_unit_count: 0, pending_unit_count: 0,
  refreshed_at_ms: null, last_successful_refreshed_at_ms: null, last_success_age_seconds: null,
  last_refresh_error_at_ms: null, selection_expires_at_ms: null,
} };

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

test('user bootstraps recent events once then follows the global high-water cursor', async () => {
  // Given the Strategy 29 status, event pages and retained cursor
  const fixture = clientFixture([
    response(status), response({ ...events, next_cursor: 100_000, has_more: false }),
    response(status), response({ ...events, events: [], next_cursor: 100_200, has_more: false }),
  ]);
  // When fixture.client.poll processes the configured inputs
  await fixture.client.poll(new AbortController().signal);
  const firstUrl = new URL(fixture.requests[1].path, 'https://gateway.invalid');
  // Then user bootstraps recent events once then follows the global high-water cursor
  assert.equal(firstUrl.searchParams.get('mode'), 'latest_per_timeframe');
  assert.equal(firstUrl.searchParams.get('limit'), '3');
  assert.equal(firstUrl.searchParams.has('cursor'), false);
  assert.deepEqual(fixture.received.map(event => event.sequence), [41, 42]);
  await fixture.client.poll(new AbortController().signal);
  const nextUrl = new URL(fixture.requests[3].path, 'https://gateway.invalid');
  assert.equal(nextUrl.searchParams.get('cursor'), '100000');
  assert.equal(nextUrl.searchParams.has('mode'), false);
  assert.equal(fixture.client.diagnostics.cursor, 100_200);
});

test('user observes that only known timeframe-set changes resynchronize snapshots, including initialization after missing facts', async () => {
  // Given reordered, unavailable and genuinely changed timeframe configurations
  const reordered = { ...status, universe: { ...status.universe, generation: 2, configured_timeframes: [...status.universe.configured_timeframes].reverse() } };
  const changed = { ...status, universe: { ...status.universe, configured_timeframes: ['1d'] } };
  const observations = [];
  // When the real client polls each configuration transition
  for (const { states, modes, resets } of [
    { states: [status, reordered, withoutSelection, status], modes: ['latest_per_timeframe', null, null, null], resets: [] },
    { states: [status, withoutSelection, changed], modes: ['latest_per_timeframe', null, 'latest_per_timeframe'], resets: [null] },
    { states: [withoutSelection, status], modes: ['latest_per_timeframe', 'latest_per_timeframe'], resets: [null] },
  ]) {
    const fixture = clientFixture(states.flatMap((snapshot, index) => [response(snapshot), response({ ...events, events: [], next_cursor: 100 + index })]));
    for (const snapshot of states) await fixture.client.poll(new AbortController().signal);
    observations.push({ fixture, modes, resets, count: states.length });
  }
  // Then only an actual known timeframe change or first initialization resets the cursor
  for (const { fixture, modes, resets, count } of observations) {
    assert.deepEqual(fixture.requests.filter((_, index) => index % 2 === 1).map(request => new URL(request.path, 'https://gateway.invalid').searchParams.get('mode')), modes);
    assert.deepEqual(fixture.resets, resets);
    assert.equal(fixture.client.diagnostics.cursor, 99 + count);
  }
});

test('user observes that failed configuration resynchronization keeps the cursor empty until a new snapshot succeeds', async () => {
  // Given the Strategy 29 status, event pages and retained cursor
  const changed = { ...status, universe: { ...status.universe, configured_timeframes: ['1d'] } };
  const fixture = clientFixture([
    response(status), response({ ...events, events: [], next_cursor: 100 }),
    response(changed), response({ schema_version: 1, error: 'gateway_unavailable', strategy_id: '29' }, 503),
    response(changed), response({ ...events, events: [], next_cursor: 200 }),
  ]);
  // When fixture.client.poll processes the configured inputs
  await fixture.client.poll(new AbortController().signal);
  // Then user observes that failed configuration resynchronization keeps the cursor empty until a new snapshot succeeds
  assert.equal((await fixture.client.poll(new AbortController().signal)).state, 'gateway_unavailable');
  assert.equal(fixture.client.diagnostics.cursor, null);
  await fixture.client.poll(new AbortController().signal);
  assert.equal(new URL(fixture.requests[5].path, 'https://gateway.invalid').searchParams.get('mode'), 'latest_per_timeframe');
  assert.deepEqual(fixture.resets, [null]);
  assert.equal(fixture.client.diagnostics.cursor, 200);
});

test('user observes that snapshot quota validation is independent of the preceding status configuration', async () => {
  // Given the Strategy 29 status, event pages and retained cursor
  const timeframes = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '1w'];
  // When timeframes.flatMap processes the configured inputs
  const all = timeframes.flatMap((timeframe, group) => Array.from({ length: 3 }, (_, index) => ({
    ...events.events[0], timeframe, sequence: group * 3 + index + 1, event_id: String(group * 3 + index + 1).padStart(64, '0'),
  })));
  const fixture = clientFixture([response(status), response({ ...events, events: all })]);
  await fixture.client.poll(new AbortController().signal);
  // Then user observes that snapshot quota validation is independent of the preceding status configuration
  assert.equal(fixture.received.length, 39);
  assert.equal(fixture.client.diagnostics.cursor, events.next_cursor);
});

test('user observes that a cancelled response cannot advance a resumed client cursor or publish events', async () => {
  // Given the Strategy 29 status, event pages and retained cursor
  let completeOld;
  const oldResponse = new Promise(resolve => { completeOld = resolve; });
  const fixture = clientFixture([
    response(status), oldResponse,
    response(status), response({ ...events, next_cursor: 100_000, has_more: false }),
  ]);
  const oldController = new AbortController();
  // When fixture.client.poll processes the configured inputs
  const oldPoll = fixture.client.poll(oldController.signal);
  await new Promise(resolve => setImmediate(resolve));
  oldController.abort(new DOMException('hidden', 'AbortError'));
  await fixture.client.poll(new AbortController().signal);
  completeOld(response({ ...events, next_cursor: 500, has_more: false }));
  // Then user observes that a cancelled response cannot advance a resumed client cursor or publish events
  await assert.rejects(oldPoll, error => error.name === 'AbortError');
  assert.equal(fixture.client.diagnostics.cursor, 100_000);
  assert.deepEqual(fixture.received.map(event => event.sequence), [41, 42]);
});

for (const latest of [
    { ...events, has_more: true },
    { ...events, has_more: false, events: Array.from({ length: 4 }, (_, index) => ({ ...events.events[0], event_id: String(index + 1).padStart(64, '0'), sequence: index + 1 })) },
  ]) {
  test(`user rejects incomplete or oversized latest snapshots (${latest.has_more ? 'incomplete' : 'oversized'} page)`, async () => {
    // Given an incomplete or over-limit latest-per-timeframe response
    const fixture = clientFixture([response(status), response(latest)]);
    // When the real client requests its initial snapshot
    const pending = fixture.client.poll(new AbortController().signal);
    // Then no incomplete history or cursor is committed
    await assert.rejects(pending, /complete and bounded/);
    assert.equal(fixture.client.diagnostics.cursor, null);
    assert.deepEqual(fixture.received, []);

  });
}

test('user observes that a cancelled status response cannot publish status or start another request', async () => {
  // Given the Strategy 29 status, event pages and retained cursor
  let complete;
  const fixture = clientFixture([new Promise(resolve => { complete = resolve; })]);
  const controller = new AbortController();
  // When fixture.client.poll processes the configured inputs
  const poll = fixture.client.poll(controller.signal);
  controller.abort(new DOMException('retired', 'AbortError'));
  complete(response(status));
  // Then user observes that a cancelled status response cannot publish status or start another request
  await assert.rejects(poll, error => error.name === 'AbortError');
  assert.deepEqual(fixture.snapshots, []);
  assert.equal(fixture.requests.length, 1);
});

test('user receives status and bounded event pages while accepting filtered cursor progress', async () => {
  // Given the Strategy 29 status, event pages and retained cursor
  const first = { ...events, events: [], next_cursor: 20, has_more: true };
  const second = { ...events, next_cursor: 42, has_more: false };
  const fixture = clientFixture([
    response(status), response({ ...events, events: [], next_cursor: 0, has_more: false }),
    response(status), response(first), response(second),
  ]);
  // When fixture.client.poll processes the configured inputs
  await fixture.client.poll(new AbortController().signal);
  const result = await fixture.client.poll(new AbortController().signal);
  // Then user receives status and bounded event pages while accepting filtered cursor progress
  assert.deepEqual(result, { state: 'connected', pages: 2, hasMore: false });
  assert.equal(fixture.requests[0].path, '/v1/strategy29/status');
  assert.match(fixture.requests[1].path, /symbol=BTC%2FUSDT%3AUSDT/);
  assert.doesNotMatch(fixture.requests[1].path, /secret|Authorization/i);
  assert.match(fixture.requests[4].path, /cursor=20/);
  assert.deepEqual(fixture.received.map((event) => event.sequence), [41, 42]);
  assert.equal(fixture.client.diagnostics.cursor, 42);
});

test('user observes that 409 replaces retained history with a recent snapshot without clearing local chart state', async () => {
  // Given the Strategy 29 status, event pages and retained cursor
  const fixture = clientFixture([
    response(status), response({ ...events, events: [], next_cursor: 0, has_more: false }),
    response(status),
    response({ schema_version: 1, error: 'cursor_expired', oldest_cursor: 40 }, 409),
    response({ ...events, next_cursor: 42, has_more: false }),
  ]);
  // When fixture.client.poll processes the configured inputs
  await fixture.client.poll(new AbortController().signal);
  const result = await fixture.client.poll(new AbortController().signal);
  // Then user observes that 409 replaces retained history with a recent snapshot without clearing local chart state
  assert.deepEqual(result, { state: 'connected', pages: 2, hasMore: false });
  assert.deepEqual(fixture.resets, [40]);
  assert.equal(new URL(fixture.requests[4].path, 'https://gateway.invalid').searchParams.get('mode'), 'latest_per_timeframe');
  assert.doesNotMatch(fixture.requests[4].path, /cursor=/);
});

test('user rejects has_more without cursor progress and does not loop', async () => {
  // Given the Strategy 29 status, event pages and retained cursor
  const stalled = { ...events, events: [], next_cursor: 0, has_more: true };
  const fixture = clientFixture([
    response(status), response({ ...events, events: [], next_cursor: 0, has_more: false }),
    response(status), response(stalled),
  ]);
  // When fixture.client.poll processes the configured inputs
  await fixture.client.poll(new AbortController().signal);
  // Then user rejects has_more without cursor progress and does not loop
  await assert.rejects(
    fixture.client.poll(new AbortController().signal),
    /cursor did not advance/,
  );
  assert.equal(fixture.requests.length, 4);
});

test('user rejects an event for a symbol other than the strict requested identity', async () => {
  // Given a response containing a different symbol from the requested market
  const wrongSymbol = structuredClone(events);
  wrongSymbol.events[0].symbol = 'ETH/USDT:USDT';
  const fixture = clientFixture([response(status), response(wrongSymbol)]);
  // When the current-symbol client validates the delivered events
  const pending = fixture.client.poll(new AbortController().signal);
  // Then the foreign market response is rejected
  await assert.rejects(pending, /requested symbol/);
});

test('user sees unavailable status separately from fatal HTTP and contract errors', async () => {
  // Given a gateway explicitly reporting database unavailability
  const unavailable = clientFixture([
    response({ schema_version: 1, error: 'database_unavailable' }, 503),
  ]);
  // When the summary client polls the unavailable gateway
  const result = await unavailable.client.poll(new AbortController().signal);
  // Then unavailability is reported while unauthorized, malformed and transport failures retain their contracts
  assert.deepEqual(
    result,
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
    test(`user observes that ${endpoint} preserves the typed ${error} state without requesting extra pages`, async () => {
      // Given an exact typed module error from the selected summary endpoint
      const body = { schema_version: 1, error, strategy_id: '29', ...(error === 'module_disabled' ? { status: 'disabled' } : {}) };
      const fixture = clientFixture(endpoint === 'status' ? [response(body, 503)] : [response(status), response(body, 503)]);
      // When the real summary client processes that endpoint response
      const result = await fixture.client.poll(new AbortController().signal);
      // Then the typed state is retained without publishing history or extra requests
      assert.deepEqual(result, {
        state: error, pages: endpoint === 'status' ? 0 : 1, hasMore: false,
      });
      assert.equal(fixture.requests.length, endpoint === 'status' ? 1 : 2);
      assert.deepEqual(fixture.resets, []);
      assert.deepEqual(fixture.received, []);
    });
  }
}

test('user sees remote/local spec mismatch before requesting event history', async () => {
  // Given a status envelope declaring an incompatible observer specification
  const mismatch = { ...status, spec_version: 'other_spec' };
  delete mismatch.universe;
  const fixture = clientFixture([response(mismatch)]);
  // When the client validates the status identity
  const result = await fixture.client.poll(new AbortController().signal);
  // Then the incompatibility is visible before any event-history request
  assert.deepEqual(
    result,
    { state: 'incompatible', pages: 0, hasMore: false },
  );
  assert.equal(fixture.requests.length, 1);
  assert.equal(fixture.snapshots[0].spec_version, 'other_spec');
});

test('user observes that a v3 backend is incompatible before requesting the per-timeframe snapshot', async () => {
  // Given a backend still advertising the previous status API version
  const fixture = clientFixture([
    response({ ...status, spec_version: '29_2_spec_v3' }), response(events),
  ]);
  // When the current client reads the backend status
  const result = await fixture.client.poll(new AbortController().signal);
  // Then version mismatch leaves event history and cursor untouched
  assert.deepEqual(result, {
    state: 'incompatible', pages: 0, hasMore: false,
  });
  assert.deepEqual(fixture.requests.map(request => request.path), ['/v1/strategy29/status']);
  assert.deepEqual(fixture.received, []);
  assert.equal(fixture.client.diagnostics.cursor, null);
});

test('user observes that a rollback between status and events cannot publish a v3 snapshot or advance its cursor', async () => {
  // Given a current status response followed by a rolled-back event envelope
  const fixture = clientFixture([
    response(status), response({ ...events, spec_version: '29_2_spec_v3' }),
  ]);
  // When the client reads the mismatched event snapshot
  const pending = fixture.client.poll(new AbortController().signal);
  // Then the event version failure prevents publication and cursor advancement
  await assert.rejects(pending, /events.spec_version/);
  assert.deepEqual(fixture.received, []);
  assert.equal(fixture.client.diagnostics.cursor, null);
});


test('user observes that Unicode selected markets and events preserve canonical identity through polling', async () => {
  // Given the Strategy 29 status, event pages and retained cursor
  const unicodeStatus = JSON.parse(JSON.stringify(status).replaceAll('BTC/USDT:USDT', '牛来/USDT:USDT'));
  const unicodeEvents = JSON.parse(JSON.stringify(events).replaceAll('BTC/USDT:USDT', '牛来/USDT:USDT'));
  const fixture = clientFixture([response(unicodeStatus), response(unicodeEvents)], {
    canonicalSymbol: '牛来/USDT:USDT',
  });
  // When fixture.client.poll processes the configured inputs
  await fixture.client.poll(new AbortController().signal);
  // Then user observes that Unicode selected markets and events preserve canonical identity through polling
  assert.equal(new URL(fixture.requests[1].path, 'https://gateway.invalid').searchParams.get('symbol'), '牛来/USDT:USDT');
  assert.deepEqual(fixture.received.map(event => event.symbol), ['牛来/USDT:USDT', '牛来/USDT:USDT']);
  assert.equal(fixture.snapshots.length, 1);
});
