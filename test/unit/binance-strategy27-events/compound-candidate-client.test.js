import assert from 'node:assert/strict';
import test from 'node:test';
import { createCompoundCandidateClient } from '../../../src/binance-strategy27-events/core/compound-candidate-client.js';
import { Strategy27GatewayTransportError } from '../../../src/binance-strategy27-events/core/live-event-client.js';
import { validateCompoundGatewayResponse } from '../../../src/binance-strategy27-events/core/compound-candidate-contract.js';

const initial = (next = '5-0') => ({ schema_version: 1, status: 'reset', reason: 'initial_cursor', requested_cursor: null, next_cursor: next, messages: [] });
const ok = (requested = '5-0', next = '8-0') => ({ schema_version: 1, status: 'ok', requested_cursor: requested, next_cursor: next, messages: [] });
const response = (body, status = 200) => ({ status, responseText: JSON.stringify(body) });
const unavailable = (code = 'compound_unavailable') => response({ schema_version: 1, status: 'error', error_code: code }, 503);

function harness(steps, { onResponse = () => {}, onState = () => {} } = {}) {
  const controller = new AbortController();
  const calls = [];
  const states = [];
  const received = [];
  const client = createCompoundCandidateClient({
    gatewayBaseUrl: 'http://127.0.0.1:18765',
    authSecret: 'fixture-only-not-a-credential',
    canonicalSymbol: 'BTR/USDT:USDT',
    reconnectDelayMs: 0,
    request: async ({ url }) => {
      calls.push(new URL(url));
      assert.ok(steps.length > 0, 'unexpected extra request');
      const step = steps.shift();
      if (step instanceof Error) throw step;
      return typeof step === 'function' ? step(controller) : step;
    },
    onConnectionStateChange: (state) => { states.push(state); onState(state, controller); },
    onResponse: (payload) => { received.push(payload); onResponse(payload, controller); },
  });
  return { controller, calls, states, received, run: () => client.run(controller.signal) };
}

test('compound route owns its cursor and accepts stale-cursor resets', async () => {
  const stale = { ...initial('12-0'), reason: 'stale_cursor', requested_cursor: '8-0' };
  const h = harness([response(initial()), response(ok()), response(stale, 409)], {
    onResponse: (payload, controller) => { if (payload.next_cursor === '12-0') controller.abort(); },
  });
  await h.run();
  assert.deepEqual(h.calls.map((url) => url.pathname), Array(3).fill('/v1/strategy27/compound-candidates'));
  assert.deepEqual(h.calls.map((url) => url.searchParams.get('cursor')), [null, '5-0', '8-0']);
  assert.deepEqual(h.calls.map((url) => url.searchParams.get('symbol')), Array(3).fill('BTR/USDT:USDT'));
  assert.deepEqual(h.received, [initial(), ok(), stale]);
  assert.deepEqual(h.states, ['connected']);
});

test('404 disables compound without parsing HTML or retrying', async () => {
  const h = harness([{ status: 404, responseText: '<html>Not Found</html>' }]);
  await h.run();
  assert.deepEqual(h.states, ['unsupported']);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.received, []);
});

test('explicit unavailable responses reset only this cursor before recovery', async () => {
  for (const code of ['compound_unavailable', 'redis_unavailable']) {
    const h = harness([response(initial()), unavailable(code), response(initial('20-0'))], {
      onResponse: (payload, controller) => { if (payload.next_cursor === '20-0') controller.abort(); },
    });
    await h.run();
    assert.deepEqual(h.states, ['connected', 'unavailable', 'connected']);
    assert.deepEqual(h.calls.map((url) => url.searchParams.get('cursor')), [null, '5-0', null]);
    assert.deepEqual(h.received, [initial(), initial('20-0')]);
  }
});

test('typed network failures retain the cursor and recover without replaying reset', async () => {
  const h = harness([response(initial()), new Strategy27GatewayTransportError('fixture transport failure'), response(ok())], {
    onResponse: (payload, controller) => { if (payload.status === 'ok') controller.abort(); },
  });
  await h.run();
  assert.deepEqual(h.states, ['connected', 'reconnecting', 'connected']);
  assert.deepEqual(h.calls.map((url) => url.searchParams.get('cursor')), [null, '5-0', '5-0']);
  assert.deepEqual(h.received, [initial(), ok()]);
});

test('protocol failures stop instead of being classified as transient transport failures', async () => {
  for (const bad of [
    { status: 200, responseText: 'not JSON' },
    unavailable('unknown_error'),
    response({ schema_version: 1, status: 'error', error_code: 'unauthorized' }, 401),
    response(ok('9-0')),
    new Error('fixture internal failure'),
  ]) {
    const h = harness([bad]);
    await assert.rejects(h.run());
    assert.equal(h.calls.length, 1);
    assert.deepEqual(h.received, []);
    assert.deepEqual(h.states, []);
  }
  const h = harness([response(initial()), response(ok('5-0', '4-9'))]);
  await assert.rejects(h.run(), /cursor mismatch\/regression/);
  assert.deepEqual(h.received, [initial()]);
});

test('aborted requests cannot publish late unsupported or unavailable states', async () => {
  for (const late of [{ status: 404, responseText: 'missing' }, unavailable(), response(initial())]) {
    const h = harness([(controller) => { controller.abort(); return late; }]);
    await h.run();
    assert.deepEqual(h.states, []);
    assert.deepEqual(h.received, []);
    assert.equal(h.calls.length, 1);
  }
});

test('abort interrupts the designed unavailable retry without issuing another request', async () => {
  const h = harness([unavailable()], { onState: (_, controller) => controller.abort() });
  await assert.rejects(h.run(), { name: 'AbortError' });
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.states, ['unavailable']);
});

test('gateway response wrapper validates exact status, cursor and message bounds', async () => {
  assert.deepEqual(await validateCompoundGatewayResponse(initial(), 200), initial());
  assert.deepEqual(await validateCompoundGatewayResponse(ok(), 200), ok());
  for (const [body, status] of [
    [{ ...initial(), extra: true }, 200],
    [{ ...initial(), requested_cursor: '1-0' }, 200],
    [{ ...initial(), messages: [{}] }, 200],
    [{ ...ok(), next_cursor: '01-0' }, 200],
    [{ ...ok(), messages: Array(129).fill({}) }, 200],
    [ok(), 409],
    [{ ...initial(), reason: 'stale_cursor', requested_cursor: '1-0' }, 200],
  ]) await assert.rejects(validateCompoundGatewayResponse(body, status));
});
