import test from 'node:test';
import assert from 'node:assert/strict';
import * as subject from '../../../src/shared/chart-marker-save-controller.js';

function fixture() {
  let now = 0;
  let sequence = 0;
  let serializations = 0;
  const timers = new Map();
  const errors = [];
  const calls = [];
  const state = { drawings: [{ id: 'user-channel', color: 'blue' }] };
  const api = {
    saveChart(callback, options) {
      serializations += 1;
      calls.push({ receiver: this, options });
      return callback?.(JSON.parse(JSON.stringify(state)));
    },
  };
  const native = api.saveChart;
  const controller = subject.installTradingViewMarkerSaveController(api, {
    onError: (error) => errors.push(error),
    setTimeoutFn(callback, delay) {
      const id = ++sequence;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeoutFn: (id) => timers.delete(id),
  });
  function advance(ms) {
    const end = now + ms;
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      const [id, timer] = next;
      timers.delete(id);
      now = timer.at;
      timer.callback();
    }
    now = end;
  }
  return { api, native, controller, advance, errors, state, calls, timers,
    get serializations() { return serializations; } };
}

test('idle marker controller preserves synchronous callback, receiver, and return', () => {
  const f = fixture();
  let seen;
  const result = f.api.saveChart((state) => { seen = state; return 42; });
  assert.equal(result, 42);
  assert.deepEqual(seen, f.state);
  assert.equal(f.serializations, 1);
  assert.equal(f.calls[0].receiver, f.api);
  assert.equal(f.timers.size, 0);
});

test('marker burst serializes once and delivers a separate complete snapshot to every callback', () => {
  const f = fixture();
  f.controller.beginMutation()();
  f.advance(100);
  const snapshots = [];
  for (let i = 0; i < 100; i += 1) {
    assert.equal(f.api.saveChart((value) => {
      assert.equal(value.drawings[0].color, 'blue');
      snapshots.push(value);
      value.drawings[0].color = `callback-${i}`;
    }), undefined);
  }
  assert.equal(f.serializations, 0);
  f.advance(150);
  assert.equal(f.serializations, 1);
  assert.equal(snapshots.length, 100);
  assert.equal(new Set(snapshots).size, 100);
  assert.equal(snapshots[0].drawings[0].color, 'callback-0');
  assert.equal(snapshots[99].drawings[0].color, 'callback-99');
  assert.equal(f.state.drawings[0].color, 'blue');
  assert.equal(f.controller.getStats().pendingCallbacks, 0);
  assert.equal(f.controller.getStats().busy, false);
  assert.equal(f.timers.size, 0);
});

test('callback errors do not skip later callbacks or interrupt explicit save options', () => {
  const f = fixture();
  f.controller.beginMutation()();
  let completed = 0;
  f.api.saveChart(() => { throw new Error('first callback failed'); });
  f.api.saveChart(() => { completed += 1; });
  const options = { includeDrawings: false };
  assert.equal(f.api.saveChart(() => 'explicit-result', options), 'explicit-result');
  assert.equal(completed, 1);
  assert.equal(f.serializations, 2);
  assert.equal(f.calls[1].options, options);
  f.advance(0);
  assert.equal(f.errors.length, 1);
  assert.equal(f.errors[0].errors[0].message, 'first callback failed');
});

test('foreign receiver, options and non-callback arguments stay synchronous', () => {
  const f = fixture();
  for (const options of [{}, { includeDrawings: false }]) {
    f.controller.beginMutation()();
    assert.equal(f.api.saveChart(() => 7, options), 7);
    assert.equal(f.calls.at(-1).options, options);
  }
  f.controller.beginMutation()();
  const receiver = {};
  assert.equal(f.api.saveChart.call(receiver, () => 8), 8);
  assert.equal(f.calls.at(-1).receiver, receiver);
  f.controller.beginMutation()();
  assert.equal(f.api.saveChart(), undefined);
  assert.equal(f.serializations, 4);
});

test('base wrapper never captures or restores across an outer save owner', () => {
  const f = fixture();
  const base = f.api.saveChart;
  f.controller.beginMutation()();
  f.api.saveChart(() => 1);
  function outer(...args) { return base.apply(this, args); }
  f.api.saveChart = outer;
  assert.equal(f.api.saveChart(() => 2), 2);
  assert.equal(f.api.saveChart, outer);
  assert.equal(f.serializations, 2);
  assert.equal(f.controller.canMutate(), false);
});

test('maximum burst window bounds serialization under a continuous event stream', () => {
  const f = fixture();
  for (let i = 0; i < 10; i += 1) {
    f.controller.beginMutation()();
    f.api.saveChart(() => {});
    f.advance(100);
  }
  assert.equal(f.serializations, 1);
  f.advance(50);
  assert.equal(f.controller.getStats().busy, false);
});

test('an explicit save cannot end the mutation tail before the native delayed callback', async () => {
  const f = fixture();
  f.controller.beginMutation()();
  f.advance(10);
  assert.equal(f.api.saveChart(() => 3, {}), 3);
  let starts = 0;
  const drain = f.controller.runAfterIdle(() => { starts += 1; });
  f.advance(90);
  assert.equal(f.api.saveChart(() => 4), 4);
  await Promise.resolve();
  assert.equal(starts, 0);
  f.advance(50);
  await drain;
  assert.equal(starts, 1);
  assert.equal(f.serializations, 2);
});

test('drain blocks new mutations and waits for asynchronous creation and its delayed saves', async () => {
  const f = fixture();
  const finish = f.controller.beginMutation();
  let ownerStarted = false;
  const drain = f.controller.runAfterIdle(() => { ownerStarted = true; return 17; });
  assert.equal(f.controller.canMutate(), false);
  f.advance(500);
  await Promise.resolve();
  assert.equal(ownerStarted, false);
  finish();
  f.advance(100);
  f.api.saveChart(() => {});
  f.advance(149);
  await Promise.resolve();
  assert.equal(ownerStarted, false);
  f.advance(1);
  assert.equal(await drain, 17);
  assert.equal(ownerStarted, true);
  assert.equal(f.serializations, 1);
  assert.equal(f.controller.canMutate(), true);
  assert.equal(f.timers.size, 0);
});

test('stalled native creation rejects bounded drain without starting the outer action', async () => {
  const f = fixture();
  const finish = f.controller.beginMutation();
  let starts = 0;
  const drain = f.controller.runAfterIdle(() => { starts += 1; });
  const rejected = assert.rejects(drain, { name: 'TradingViewMarkerSaveDrainTimeoutError' });
  f.advance(2000);
  await rejected;
  assert.equal(starts, 0);
  finish();
  f.advance(150);
  assert.equal(f.controller.canMutate(), true);
  assert.equal(f.timers.size, 0);
});

test('one API installs one base wrapper and another API has independent state', () => {
  const f = fixture();
  const base = f.api.saveChart;
  assert.equal(subject.installTradingViewMarkerSaveController(f.api), f.controller);
  assert.equal(f.api.saveChart, base);
  const other = fixture();
  f.controller.beginMutation()();
  assert.equal(other.controller.getStats().busy, false);
  f.advance(150);
});

test('stop aborts a pending drain immediately without starting an outer owner', async () => {
  const f = fixture();
  f.controller.beginMutation()();
  const abort = new AbortController();
  const reason = new Error('Stopped');
  let starts = 0;
  const drain = f.controller.runAfterIdle(() => { starts += 1; }, { signal: abort.signal });
  abort.abort(reason);
  await assert.rejects(drain, (error) => error === reason);
  assert.equal(starts, 0);
  assert.equal(f.controller.getStats().draining, 0);
  f.advance(150);
  assert.equal(f.timers.size, 0);
});
