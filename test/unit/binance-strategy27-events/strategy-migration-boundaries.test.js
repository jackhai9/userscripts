import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import {
  captureStrategyError, createStrategyDigestGate, createStrategyGmBoundary, createStrategyPromptBoundary, createStrategyShapeBoundary, installStrategyClock,
  observeStrategyCondition, observeStrategyQueries,
} from '../../helpers/strategy-migration-boundaries.js';

for (const [label, config] of [
  ['valid', { shapeId: 'native-shape', points: [{ time: 10, price: 1.25 }], listedShapes: [{ id: 'native-shape' }] }],
  ['missing', { shapeId: null, points: null, listedShapes: null }],
  ['malformed', { shapeId: '', points: [], listedShapes: [{ id: 42 }] }],
]) {
  test(`user observes ${label} native shape outputs without fixture normalization`, async () => {
    // Given a host boundary is configured with the exact native return values
    const boundary = createStrategyShapeBoundary(config);
    const point = { time: 10, price: 1.25 };
    const options = { shape: 'arrow_up' };

    // When the host creates, reads, lists, and removes a shape
    const id = await boundary.chart.createShape(point, options);
    const points = boundary.chart.getShapeById(id).getPoints();
    const list = boundary.chart.getAllShapes();
    boundary.chart.removeEntity('requested-removal');

    // Then every native value and caller-owned operation is preserved exactly
    assert.equal(id, config.shapeId);
    assert.equal(points, config.points);
    assert.equal(list, config.listedShapes);
    assert.equal(boundary.created.length, 1);
    assert.equal(boundary.created[0].point, point);
    assert.equal(boundary.created[0].options, options);
    assert.deepEqual(boundary.removed, ['requested-removal']);
  });
}

test('user observes native interval cadence, arguments, independent ownership and cancellation under the virtual clock', (t) => {
  // Given two native browser intervals and a shared virtual Date
  const dom = new JSDOM('<body></body>');
  t.after(() => dom.window.close());
  const clock = installStrategyClock(t, dom.window, 7000);
  const calls = [];
  const first = dom.window.setInterval(function (value) {
    calls.push({ value, time: Date.now(), receiver: this === dom.window });
  }, 1000, 'first');
  const second = dom.window.setInterval(() => calls.push({ value: 'second', time: Date.now() }), 2000);

  // When the clock approaches the first interval deadline
  clock.advance(999);

  // Then no interval runs early and both native handles remain distinct
  assert.deepEqual(calls, []);
  assert.notEqual(first, second);
  assert.deepEqual([...clock.intervals.values()], [{ milliseconds: 1000 }, { milliseconds: 2000 }]);

  // When the first interval fires and is cancelled before the second deadline
  clock.advance(1);
  dom.window.clearInterval(first);
  clock.advance(1000);

  // Then cancellation preserves the independent interval and native receiver
  assert.deepEqual(calls, [{ value: 'first', time: 8000, receiver: true }, { value: 'second', time: 9000 }]);
  assert.deepEqual([...clock.intervals.keys()], [second]);

  // When the remaining interval is cleared before a later clock advance
  dom.window.clearInterval(second);
  clock.setTime(10000);
  clock.advance(2000);

  // Then neither callback is resurrected and Date follows the controlled clock
  assert.equal(calls.length, 2);
  assert.equal(clock.intervals.size, 0);
  assert.equal(Date.now(), 12000);
});

test('user receives native DOM selections and selector errors while query counts remain inspectable', () => {
  // Given a real document and query instrumentation
  const dom = new JSDOM('<body><div class="chart-widget-root"></div><span></span></body>');
  const document = dom.window.document;
  const original = document.querySelectorAll;
  const queries = observeStrategyQueries(document);

  // When selectors execute through the native document implementation
  const selected = document.querySelectorAll('.chart-widget-root');
  const spans = document.querySelectorAll('span');

  // Then NodeList identity, invalid-selector errors and per-selector counts are preserved
  assert.equal(selected instanceof dom.window.NodeList, true);
  assert.equal(selected[0], document.querySelector('div'));
  assert.equal(spans.length, 1);
  assert.throws(() => document.querySelectorAll('['), { name: 'SyntaxError' });
  assert.equal(queries.count('.chart-widget-root'), 1);
  assert.equal(queries.count('span'), 1);
  assert.equal(queries.count('['), 1);
  queries.restore();
  assert.equal(document.querySelectorAll, original);
  dom.window.close();
});

test('user cancels sandbox prompts while any page-realm prompt is rejected and recorded', () => {
  // Given separate prompt entry points for sandbox and page contexts
  const prompts = createStrategyPromptBoundary();

  // When the sandbox asks for a setting
  const answer = prompts.sandboxPrompt('Synthetic configuration question');

  // Then cancellation is returned and the page entry point refuses private input
  assert.equal(answer, null);
  assert.deepEqual(prompts.messages, ['Synthetic configuration question']);
  assert.throws(() => prompts.pagePrompt('Synthetic page question'), /Page prompt must not receive private input/);
  assert.deepEqual(prompts.pageAttempts, [['Synthetic page question']]);
});

test('user receives the real SHA-256 result only after the selected digest gate is released', async () => {
  // Given an independently computed digest and a gate on the first real calculation
  const bytes = new TextEncoder().encode('abc');
  const gate = createStrategyDigestGate(globalThis.crypto.subtle, 1);
  let completed = false;

  // When WebCrypto computes the selected digest but its completion remains gated
  const pending = gate.subtle.digest('SHA-256', bytes).then(result => { completed = true; return result; });
  await gate.entered;

  // Then the caller has not received the result and the original arguments are intact
  assert.equal(completed, false);
  assert.equal(gate.calls[0][0], 'SHA-256');
  assert.equal(gate.calls[0][1], bytes);

  // When the boundary explicitly releases completion
  gate.release();
  const digest = await pending;

  // Then the standard digest bytes and native validation failures remain unchanged
  assert.equal(Buffer.from(digest).toString('hex'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  await assert.rejects(gate.subtle.digest('NOT-A-DIGEST', bytes), { name: 'NotSupportedError' });
  await assert.rejects(gate.subtle.digest('SHA-256', 'abc'), TypeError);
  assert.equal(gate.calls.length, 3);
});

test('user waits for the observed condition instead of assuming that one asynchronous turn completed it', async () => {
  // Given a completion condition that changes only after two host jobs
  let state = 'pending';
  setImmediate(() => setImmediate(() => { state = 'complete'; }));

  // When the completion observer follows the condition across those jobs
  await observeStrategyCondition(() => state === 'complete', 'contract fixture completion');

  // Then the explicitly requested completion has occurred
  assert.equal(state, 'complete');
});

test('user inspects the original thrown failure and cannot mistake a successful operation for a rejection', () => {
  // Given a specific failure object thrown by an operation
  const expected = new TypeError('Synthetic rejected input');

  // When the failure boundary executes that operation
  const actual = captureStrategyError(() => { throw expected; });

  // Then error identity is preserved and an operation that succeeds is refused
  assert.equal(actual, expected);
  assert.throws(() => captureStrategyError(() => 42), /Expected the strategy operation to reject/);
});

test('user controls exact Tampermonkey callback delivery without the boundary suppressing repeated host events', () => {
  // Given a Tampermonkey boundary and independently recorded host callbacks
  const boundary = createStrategyGmBoundary();
  const calls = [];
  const options = {
    onload: value => calls.push(['load', value]),
    onerror: () => calls.push(['error']),
    ontimeout: () => calls.push(['timeout']),
    onabort: () => calls.push(['abort']),
  };
  const response = { status: 200, responseText: 'synthetic response' };
  // When the host emits callbacks and the returned handle is aborted
  const handle = boundary.request(options);
  boundary.requests[0].load(response);
  boundary.requests[0].error();
  boundary.requests[0].timeout();
  handle.abort();
  boundary.requests[0].load(response);
  // Then all original callback events arrive and only the actual caller can settle its promise once
  assert.equal(boundary.requests[0].options, options);
  assert.deepEqual(calls, [['load', response], ['error'], ['timeout'], ['abort'], ['load', response]]);
  assert.equal(boundary.requests[0].abortCalls, 1);
});
