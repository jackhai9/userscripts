import test from 'node:test';
import assert from 'node:assert/strict';
import { coalesceTradingViewDrawingSaves, createTradingViewContinuousSaveController, createTradingViewRemovalSaveController } from '../../../src/binance-orderbook-trade/core/chart-save-coalescer.js';

import { createTradingViewApi as host, createManualTimers } from './chart-save-test-host.js';

for (const mode of ['continuous', 'removal', 'action']) {
  test(`user receives every ${mode} save callback even when the same function is requested twice`, async (t) => {
    // Given real callback-style native serialization and a pending chart-save lifecycle.
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const h = host();
    const original = h.api.saveChart;
    const received = [];
    const callback = snapshot => { received.push(snapshot); snapshot.drawings[0].points.push(99); };
    let controller;
    let completion;
    if (mode === 'continuous') controller = createTradingViewContinuousSaveController(h.api, { settleQuietMs: 1 });
    if (mode === 'removal') controller = createTradingViewRemovalSaveController(h.api, { settleQuietMs: 1, eventDiscoveryMs: 0 });
    if (mode === 'action') completion = coalesceTradingViewDrawingSaves(h.api, () => h.event(), { settleQuietMs: 1 });
    else h.event();

    // When three accepted requests settle, including a duplicate callback function.
    h.api.saveChart(callback);
    h.api.saveChart(callback);
    h.api.saveChart(value => received.push(value));
    await Promise.resolve();
    if (mode === 'removal') completion = controller.finish();
    t.mock.timers.tick(1);
    if (completion) await completion;
    if (mode === 'continuous') controller.stop();

    // Then one serialization completes every request with independently owned JSON data.
    assert.equal(h.calls.length, 1);
    assert.equal(received.length, 3);
    assert.deepEqual(received.map(value => value.drawings[0].points), [[1, 2, 99], [1, 2, 99], [1, 2]]);
    assert.notEqual(received[0], received[1]);
    assert.equal(h.api.saveChart, original);
    assert.equal(h.listeners.get('drawing_event').size, 0);
  });
}

function start(mode, h, timers, options = {}) {
  const config = { settleQuietMs: 10, maxWaitMs: 40, timeoutMs: 80, eventDiscoveryMs: 0, eventDiscoveryTimeoutMs: 0, ...timers, ...options };
  let controller;
  let completion;
  if (mode === 'continuous') controller = createTradingViewContinuousSaveController(h.api, config);
  if (mode === 'removal') controller = createTradingViewRemovalSaveController(h.api, config);
  if (mode === 'action') completion = coalesceTradingViewDrawingSaves(h.api, () => h.event(), config);
  else h.event();
  return { controller, async finish() {
    await Promise.resolve();
    if (mode === 'removal') completion = controller.finish();
    timers.advance(10);
    if (mode === 'continuous') return controller.stop();
    return await completion;
  } };
}

for (const mode of ['continuous', 'removal', 'action']) {
  test(`user receives remaining ${mode} callbacks after one fails without leaking that failure into an explicit save`, async () => {
    // Given accepted callbacks including one host callback that throws.
    const h = host(), timers = createManualTimers(), failures = [], received = [];
    const failure = new Error('Host callback failed');
    const lifecycle = start(mode, h, timers, { onCallbackError: error => failures.push(error) });
    h.api.saveChart(() => { throw failure; });
    h.api.saveChart(value => received.push(value));

    // When an explicit save flushes callbacks before running with its native options and return value.
    const result = h.api.saveChart(value => { assert.deepEqual(value, { drawings: [] }); return 73; }, { includeDrawings: false });
    await lifecycle.finish();
    timers.advance(0);

    // Then all callbacks finish and their failure is reported only at the separate asynchronous boundary.
    assert.equal(result, 73);
    assert.deepEqual(received, [h.snapshot]);
    assert.equal(failures.length, 1);
    assert.deepEqual(failures[0].errors, [failure]);
    assert.equal(h.calls.length, 2);
    assert.equal(h.calls[1].args[1].includeDrawings, false);
  });

  test(`user preserves synchronous receiver return and throw semantics for nondefault ${mode} save calls`, async () => {
    // Given a live save burst and a foreign receiver.
    const h = host(), timers = createManualTimers(), receiver = {};
    const lifecycle = start(mode, h, timers);
    let delivered = 0;
    h.api.saveChart(() => { delivered += 1; });

    // When a foreign receiver save and an invalid native signature bypass batching.
    const result = h.api.saveChart.call(receiver, () => 91);
    assert.throws(() => h.api.saveChart('invalid native signature'), /Native callback required/);
    await lifecycle.finish();

    // Then the earlier callback is delivered and the original API owns both synchronous outcomes.
    assert.equal(result, 91);
    assert.equal(delivered, 1);
    assert.equal(h.calls[1].receiver, receiver);
    assert.deepEqual(h.calls[2].args, ['invalid native signature']);
  });

  test(`user saves reentrantly from a ${mode} callback without rejoining the detached batch`, async () => {
    // Given two callbacks where the first requests another native save.
    const h = host(), timers = createManualTimers(), received = [];
    const original = h.api.saveChart;
    const lifecycle = start(mode, h, timers);
    h.api.saveChart(() => {
      assert.equal(h.api.saveChart, original);
      h.api.saveChart(() => { received.push('nested'); });
      received.push('first');
    });
    h.api.saveChart(() => { received.push('second'); });

    // When the lifecycle restores ownership and delivers the detached callback batch.
    await lifecycle.finish();

    // Then nested saving completes synchronously and does not consume the second callback.
    assert.deepEqual(received, ['nested', 'first', 'second']);
    assert.equal(h.calls.length, 2);
    assert.equal(h.api.saveChart, original);
  });

  test(`user retains accepted ${mode} callbacks when another save wrapper takes ownership`, async () => {
    // Given two accepted callbacks and an independently installed outer save owner.
    const h = host(), timers = createManualTimers(), received = [], foreignCalls = [];
    const lifecycle = start(mode, h, timers);
    h.api.saveChart(value => received.push(value));
    h.api.saveChart(value => received.push(value));
    const foreign = (...args) => { foreignCalls.push(args); };
    h.api.saveChart = foreign;

    // When lifecycle cleanup encounters the replacement owner.
    const finish = lifecycle.finish();
    if (mode === 'continuous') await finish;
    else await assert.rejects(finish, /图表保存接口在/);

    // Then accepted callbacks complete using the known serializer without replacing the foreign method.
    assert.deepEqual(received, [h.snapshot, h.snapshot]);
    assert.equal(h.calls.length, 1);
    assert.equal(h.api.saveChart, foreign);
    assert.deepEqual(foreignCalls, []);
    assert.equal(h.listeners.get('drawing_event').size, 0);
  });
}

for (const mode of ['continuous', 'removal', 'action']) {
  test(`user can keep saving through a foreign wrapper that retained the finished ${mode} wrapper`, async () => {
    // Given a foreign owner delegating through the captured in-flight save method.
    const h = host(), timers = createManualTimers(), received = [];
    const lifecycle = start(mode, h, timers);
    h.api.saveChart(() => received.push('accepted'));
    const captured = h.api.saveChart;
    const foreign = function (...args) { return captured.apply(this, args); };
    h.api.saveChart = foreign;

    // When cleanup finishes and the foreign owner receives a later save request.
    if (mode === 'continuous') await lifecycle.finish();
    else await assert.rejects(lifecycle.finish(), /图表保存接口在/);
    const returned = h.api.saveChart(() => { received.push('later'); return 27; });

    // Then the retired wrapper delegates normally rather than retaining an unreachable callback queue.
    assert.deepEqual(received, ['accepted', 'later']);
    assert.equal(returned, 27);
    assert.equal(h.calls.length, 2);
    assert.equal(h.api.saveChart, foreign);
  });
}

test('user keeps an explicit save synchronous through a foreign wrapper during a drawing action', async () => {
  // Given a pending callback and an outer owner that delegates to the active coalescer.
  const h = host(), timers = createManualTimers(), received = [];
  const lifecycle = start('action', h, timers);
  h.api.saveChart(() => received.push('pending'));
  const captured = h.api.saveChart;
  const foreign = function (...args) { return captured.apply(this, args); };
  h.api.saveChart = foreign;

  // When that foreign owner invokes an explicit native save before cleanup.
  const returned = h.api.saveChart(() => { received.push('explicit'); return 52; }, { includeDrawings: false });
  await assert.rejects(lifecycle.finish(), /图表保存接口在/);

  // Then the pending callback is delivered without replacing the outer owner or changing synchronous return.
  assert.equal(returned, 52);
  assert.deepEqual(received, ['pending', 'explicit']);
  assert.equal(h.api.saveChart, foreign);
  assert.equal(h.calls.length, 2);
});

test('user receives the native callback return and current JSON state from the save host', () => {
  // Given the callback-style host with an independently mutable chart state.
  const h = host();
  h.snapshot.drawings.push({ id: 'second', points: [3] });
  const received = [];

  // When the native host is called with default and explicit drawing options.
  const first = h.api.saveChart(value => { received.push(value); return 5; });
  const second = h.api.saveChart(value => { received.push(value); return 6; }, { includeDrawings: false });
  received[0].drawings[0].points.push(42);

  // Then synchronous results and copy ownership match the inspected native contract.
  assert.deepEqual([first, second], [5, 6]);
  assert.deepEqual(received[0].drawings[1], { id: 'second', points: [3] });
  assert.deepEqual(received[1], { drawings: [] });
  assert.deepEqual(h.snapshot.drawings[0].points, [1, 2]);
  assert.equal(h.calls[0].receiver, h.api);
});

for (const mode of ['continuous', 'removal', 'action']) {
  test(`user keeps extra-argument ${mode} calls synchronous while default undefined options can be deferred`, async () => {
    // Given one default callback with explicit undefined options during a save burst.
    const h = host(), timers = createManualTimers(), received = [];
    const lifecycle = start(mode, h, timers);
    const deferred = h.api.saveChart(() => received.push('default'), undefined);

    // When a nondefault three-argument call passes through the wrapper.
    const token = { extra: true };
    const direct = h.api.saveChart(() => { received.push('extra'); return 33; }, undefined, token);
    await lifecycle.finish();

    // Then only the default call loses synchronous return semantics and all native arguments survive.
    assert.equal(deferred, undefined);
    assert.equal(direct, 33);
    assert.deepEqual(received, ['default', 'extra']);
    assert.equal(h.calls[1].args.length, 3);
    assert.equal(h.calls[1].args[2], token);
  });
}

test('user receives deferred callback errors through the default asynchronous error boundary', () => {
  // Given a continuous-save burst with one failed and one successful callback.
  const h = host(), timers = createManualTimers(), failure = new Error('Callback failed');
  const controller = createTradingViewContinuousSaveController(h.api, timers);
  h.event();
  let delivered = 0;
  h.api.saveChart(() => { throw failure; });
  h.api.saveChart(() => { delivered += 1; });

  // When stopping delivers both callbacks before the error-reporting timer runs.
  controller.stop();

  // Then the successful callback is preserved and the later job reports the exact callback error.
  assert.equal(delivered, 1);
  assert.throws(() => timers.advance(0), error => error instanceof AggregateError && error.errors[0] === failure);
  assert.equal(timers.timers.size, 0);
});

for (const reason of ['error-object', 'null']) {
  test(`user retains the ${reason} action failure and final serialization failure without retrying`, async () => {
    // Given one accepted callback and independent action and native serialization failures.
    const h = host(), timers = createManualTimers();
    const actionFailure = reason === 'null' ? null : new Error('Native action failed');
    const saveFailure = new Error('Native final serialization failed');
    const original = h.api.saveChart;
    h.setSaveFailure(saveFailure);
    let delivered = 0;

    // When the action fails and cleanup cannot serialize its already accepted callback.
    const completion = coalesceTradingViewDrawingSaves(h.api, () => {
      h.event();
      h.api.saveChart(() => { delivered += 1; });
      throw actionFailure;
    }, timers);

    // Then both original failures survive in order and serialization is attempted exactly once.
    await assert.rejects(completion, error => error instanceof AggregateError
      && error.errors.length === 2 && error.errors[0] === actionFailure && error.errors[1] === saveFailure);
    assert.equal(h.calls.length, 1);
    assert.equal(delivered, 0);
    assert.equal(h.api.saveChart, original);
    assert.equal(h.listeners.get('drawing_event').size, 0);
    assert.equal(timers.timers.size, 0);
  });
}
