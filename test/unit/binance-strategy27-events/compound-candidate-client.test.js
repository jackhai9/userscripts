import assert from 'node:assert/strict';
import test from 'node:test';
import { createCompoundCandidateClient } from '../../../src/binance-strategy27-events/core/compound-candidate-client.js';
import { Strategy27GatewayTransportError } from '../../../src/binance-strategy27-events/core/live-event-client.js';
import { validateCompoundBootstrapResponse, validateCompoundGatewayResponse } from '../../../src/binance-strategy27-events/core/compound-candidate-contract.js';

const initial = (next = '5-0') => ({ schema_version: 1, status: 'reset', reason: 'initial_cursor', requested_cursor: null, next_cursor: next, messages: [] });
const bootstrap = (next = '5-0') => ({ schema_version: 1, status: 'bootstrap', projection_kind: 'compound_candidates', requested_cursor: null, next_cursor: next, runtime_epoch: 'a'.repeat(32), last_sequence: 4, bootstrap_observed_at_ms: 7000, records: [] });
const ok = (requested = '5-0', next = '8-0') => ({ schema_version: 1, status: 'ok', requested_cursor: requested, next_cursor: next, messages: [] });
const response = (body, status = 200) => ({ status, responseText: JSON.stringify(body) });
const unavailable = (code = 'compound_unavailable') => response({ schema_version: 1, status: 'error', error_code: code }, 503);

function harness(steps, { onResponse = () => {}, onState = () => {}, canonicalSymbol = 'BTR/USDT:USDT' } = {}) {
  const controller = new AbortController();
  const calls = [];
  const states = [];
  const received = [];
  const client = createCompoundCandidateClient({
    gatewayBaseUrl: 'http://127.0.0.1:18765',
    authSecret: 'fixture-only-not-a-credential',
    canonicalSymbol,
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

test('user observes that compound route owns its cursor and accepts stale-cursor resets', async () => {
  // Given the compound gateway responses and request cursor
  const stale = { ...initial('12-0'), reason: 'stale_cursor', requested_cursor: '8-0' };
  const h = harness([response(bootstrap()), response(ok()), response(stale, 409)], {
    onResponse: (payload, controller) => { if (payload.next_cursor === '12-0') controller.abort(); },
  });
  // When h.run processes the configured inputs
  await h.run();
  // Then user observes that compound route owns its cursor and accepts stale-cursor resets
  assert.deepEqual(h.calls.map((url) => url.pathname), ['/v1/strategy27/compound-candidates/bootstrap', '/v1/strategy27/compound-candidates', '/v1/strategy27/compound-candidates']);
  assert.deepEqual(h.calls.map((url) => url.searchParams.get('cursor')), [null, '5-0', '8-0']);
  assert.deepEqual(h.calls.map((url) => url.searchParams.get('symbol')), Array(3).fill('BTR/USDT:USDT'));
  assert.deepEqual(h.received, [bootstrap(), ok(), stale]);
  assert.deepEqual(h.states, ['connected']);
});

test('user observes that 404 disables compound without parsing HTML or retrying', async () => {
  // Given the compound gateway responses and request cursor
  const h = harness([{ status: 404, responseText: '<html>Not Found</html>' }]);
  // When h.run processes the configured inputs
  await h.run();
  // Then user observes that 404 disables compound without parsing HTML or retrying
  assert.deepEqual(h.states, ['unsupported']);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.received, []);
});

for (const code of ['compound_unavailable', 'redis_unavailable']) {
  test(`user observes that explicit unavailable responses reset only this cursor before recovery (code=${JSON.stringify(code)})`, async () => {
    // Given the compound gateway responses and request cursor
    const h = harness([response(bootstrap()), unavailable(code), response(bootstrap('20-0'))], {
      onResponse: (payload, controller) => { if (payload.next_cursor === '20-0') controller.abort(); },
    });
    // When h.run processes the configured inputs
    await h.run();
    // Then user observes that explicit unavailable responses reset only this cursor before recovery (code=the selected case)
    assert.deepEqual(h.states, ['connected', 'unavailable', 'connected']);
    assert.deepEqual(h.calls.map((url) => url.searchParams.get('cursor')), [null, '5-0', null]);
    assert.deepEqual(h.received, [bootstrap(), bootstrap('20-0')]);

  });
}

test('user observes that typed network failures retain the cursor and recover without replaying reset', async () => {
  // Given the compound gateway responses and request cursor
  const h = harness([response(bootstrap()), new Strategy27GatewayTransportError('fixture transport failure'), response(ok())], {
    onResponse: (payload, controller) => { if (payload.status === 'ok') controller.abort(); },
  });
  // When h.run processes the configured inputs
  await h.run();
  // Then user observes that typed network failures retain the cursor and recover without replaying reset
  assert.deepEqual(h.states, ['connected', 'reconnecting', 'connected']);
  assert.deepEqual(h.calls.map((url) => url.searchParams.get('cursor')), [null, '5-0', '5-0']);
  assert.deepEqual(h.received, [bootstrap(), ok()]);
});

test('user observes that protocol failures stop instead of being classified as transient transport failures', async () => {
  // Given the compound gateway responses and request cursor
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
  const h = harness([response(bootstrap()), response(ok('5-0', '4-9'))]);
  // When h.run processes the configured inputs
  const observedResult = h.run();
  // Then user observes that protocol failures stop instead of being classified as transient transport failures
  await assert.rejects(observedResult, /cursor mismatch\/regression/);
  assert.deepEqual(h.received, [bootstrap()]);
});

for (const late of [{ status: 404, responseText: 'missing' }, unavailable(), response(bootstrap())]) {
  test(`user observes that aborted requests cannot publish late unsupported or unavailable states (late=${JSON.stringify(late)})`, async () => {
    // Given the compound gateway responses and request cursor
    const h = harness([(controller) => { controller.abort(); return late; }]);
    // When h.run processes the configured inputs
    await h.run();
    // Then user observes that aborted requests cannot publish late unsupported or unavailable states (late=the selected case)
    assert.deepEqual(h.states, []);
    assert.deepEqual(h.received, []);
    assert.equal(h.calls.length, 1);

  });
}

test('user observes that abort interrupts the designed unavailable retry without issuing another request', async () => {
  // Given the compound gateway responses and request cursor
  const h = harness([unavailable()], { onState: (_, controller) => controller.abort() });
  // When h.run processes the configured inputs
  const observedResult = h.run();
  // Then user observes that abort interrupts the designed unavailable retry without issuing another request
  await assert.rejects(observedResult, { name: 'AbortError' });
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.states, ['unavailable']);
});

test('user observes that gateway response wrapper validates exact status, cursor and message bounds', async () => {
  // Given the compound gateway responses and request cursor
  const scenarioInput = initial();
  // When validateCompoundGatewayResponse processes the configured inputs
  const observedResult = await validateCompoundGatewayResponse(scenarioInput, 200);
  // Then user observes that gateway response wrapper validates exact status, cursor and message bounds
  assert.deepEqual(observedResult, initial());
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

test('user observes that bootstrap wrapper validates its exact metadata and record bound', async () => {
  // Given the compound gateway responses and request cursor
  const scenarioInput = bootstrap();
  // When validateCompoundBootstrapResponse processes the configured inputs
  const observedResult = await validateCompoundBootstrapResponse(scenarioInput, 200);
  // Then user observes that bootstrap wrapper validates its exact metadata and record bound
  assert.deepEqual(observedResult, bootstrap());
  await assert.rejects(validateCompoundBootstrapResponse({ ...bootstrap(), extra: true }, 200));
  await assert.rejects(validateCompoundBootstrapResponse({ ...bootstrap(), records: Array(81).fill({}) }, 200));
});


test('user observes that Unicode canonical symbol is encoded in bootstrap and live requests', async () => {
  // Given the compound gateway responses and request cursor
  const symbol = '币安人生/USDT:USDT';
  const h = harness([response(bootstrap()), response(ok())], {
    canonicalSymbol: symbol,
    onResponse: (payload, controller) => { if (payload.status === 'ok') controller.abort(); },
  });
  // When h.run processes the configured inputs
  await h.run();
  // Then user observes that Unicode canonical symbol is encoded in bootstrap and live requests
  assert.deepEqual(h.calls.map((url) => url.searchParams.get('symbol')), [symbol, symbol]);
  assert.ok(h.calls.every((url) => url.href.includes('%E5%B8%81')));
});
