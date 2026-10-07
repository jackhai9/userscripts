import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { startNativeMirrorPreflight } from '../../experiments/binance-chart-storage/native-preflight-core.js';
import { compileNativePreflight } from '../../experiments/binance-chart-storage/build-native-preflight.js';
import { createNativeMirrorFactory } from '../fixtures/binance-chart-storage/mirror-scoped-callback.js';

const PAGE = 'https://www.binance.com/zh-CN/futures/USUSDT';
const QUEUE = 'webpackChunkfutures_trade_ui';

/** Browser globals are the external boundary; storage access is forbidden in every scenario. */
function installPage(t, { url = PAGE, framed = false, queue } = {}) {
  const events = new EventTarget();
  const keys = ['location', 'self', 'top', 'addEventListener', 'removeEventListener', 'indexedDB', 'localStorage', QUEUE];
  const saved = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let storageAccesses = 0;
  const values = {
    location: new URL(url), self: globalThis, top: framed ? {} : globalThis,
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
  };
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { value, configurable: true });
  for (const key of ['indexedDB', 'localStorage']) Object.defineProperty(globalThis, key, {
    get() { storageAccesses += 1; throw new Error('Storage access is forbidden'); }, configurable: true,
  });
  if (queue) Object.defineProperty(globalThis, QUEUE, { value: queue, configurable: true, writable: true });
  else delete globalThis[QUEUE];
  t.after(() => {
    events.dispatchEvent(new Event('pagehide'));
    assert.equal(storageAccesses, 0);
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return { events };
}

function start(t) {
  const session = startNativeMirrorPreflight();
  t.after(() => session.stop());
  return session;
}

test('user keeps the original native array and one synchronous invocation without inspecting chart values', t => {
  // Given the real preflight starts before an untouched page runtime and chart entries prohibit value reads.
  installPage(t);
  const session = start(t);
  const entries = new Array(2);
  Object.defineProperty(entries, 0, { get() { throw new Error('Chart values must remain unread'); } });
  const nativeResult = [Promise.resolve('native')];
  let calls = 0;

  // When the host dispatches one mirror through the native-only service.
  const result = session.dispatch({}, entries, () => { calls += 1; return nativeResult; });

  // Then the original array returns immediately with exactly one invocation and only aggregate counts.
  assert.equal(result, nativeResult);
  assert.equal(calls, 1);
  assert.equal(session.snapshot().dispatches, 1);
  assert.equal(session.snapshot().entryCount, 2);
  assert.equal(session.snapshot().active, true);
});

test('user receives the identical synchronous native exception without diagnostic wrapping', t => {
  // Given an active preflight and a native operation that rejects synchronously.
  installPage(t);
  const session = start(t);
  const failure = new Error('Native failure identity');
  let calls = 0;

  // When the native thunk throws through the observed dispatch.
  const invoke = () => session.dispatch({}, [], () => { calls += 1; throw failure; });

  // Then the exact exception escapes once while observation does not misclassify it as a diagnostic failure.
  assert.throws(invoke, error => error === failure);
  assert.equal(calls, 1);
  assert.equal(session.snapshot().failure, null);
  assert.equal(session.snapshot().dispatches, 1);
});

test('user stops counting while retained native callbacks remain synchronous and unchanged', t => {
  // Given an active preflight owns the previously absent runtime queue.
  installPage(t);
  const session = start(t);
  const nativeResult = [];
  let calls = 0;

  // When observation stops and the host later invokes the retained dispatcher.
  session.stop();
  const result = session.dispatch({}, [['unread', {}]], () => { calls += 1; return nativeResult; });

  // Then stop removes the unused queue, freezes counters and preserves native return identity.
  assert.equal(result, nativeResult);
  assert.equal(calls, 1);
  assert.equal(Object.hasOwn(globalThis, QUEUE), false);
  assert.equal(session.snapshot().active, false);
  assert.equal(session.snapshot().stopReason, 'manual');
  assert.equal(session.snapshot().dispatches, 0);
  assert.equal(session.snapshot().entryCount, 0);
});

test('user automatically stops observation exactly at the thirty second deadline', t => {
  // Given the preflight uses the controlled browser deadline clock.
  installPage(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const session = start(t);

  // When elapsed time reaches the observation deadline from its final active millisecond.
  t.mock.timers.tick(29_999);
  const before = session.snapshot();
  t.mock.timers.tick(1);
  const result = session.dispatch({}, [], () => 'native-after-deadline');

  // Then counting stops at the boundary and later native calls remain enabled.
  assert.equal(before.active, true);
  assert.equal(session.snapshot().active, false);
  assert.equal(session.snapshot().stopReason, 'deadline');
  assert.equal(session.snapshot().dispatches, 0);
  assert.equal(result, 'native-after-deadline');
  assert.equal(Object.hasOwn(globalThis, QUEUE), false);
});

test('user retires observation on pagehide without changing later native errors', t => {
  // Given the preflight owns a page lifecycle listener.
  const page = installPage(t);
  const session = start(t);
  const failure = new Error('Native after pagehide');

  // When the page leaves and the retained native thunk subsequently fails.
  page.events.dispatchEvent(new Event('pagehide'));
  const invoke = () => session.dispatch({}, [], () => { throw failure; });

  // Then cleanup precedes the native failure and neither counting nor queue interception remains active.
  assert.throws(invoke, error => error === failure);
  assert.equal(session.snapshot().active, false);
  assert.equal(session.snapshot().stopReason, 'pagehide');
  assert.equal(session.snapshot().dispatches, 0);
  assert.equal(Object.hasOwn(globalThis, QUEUE), false);
});

test('user retires counters after a route change while preserving the pending native mirror', t => {
  // Given the experiment began on its only supported top-level URL.
  installPage(t);
  const session = start(t);
  const nativeResult = [];

  // When a retained mirror callback runs after an SPA route change.
  location.pathname = '/zh-CN/futures/DIAUSDT';
  const result = session.dispatch({}, [], () => nativeResult);

  // Then the new route receives no diagnostic admission while its original callback still executes.
  assert.equal(result, nativeResult);
  assert.equal(session.snapshot().active, false);
  assert.equal(session.snapshot().stopReason, 'scope_changed');
  assert.equal(session.snapshot().dispatches, 0);
});

test('user keeps the native result when entry-count observation fails without exposing the thrown message', t => {
  // Given only the diagnostic length read fails and its exception includes an untrusted message.
  installPage(t);
  const session = start(t);
  const entries = new Proxy([], { get() { throw new Error('Untrusted diagnostic detail'); } });
  const nativeResult = [];
  let calls = 0;

  // When the diagnostic boundary encounters the failed count read before native execution.
  const result = session.dispatch({}, entries, () => { calls += 1; return nativeResult; });

  // Then the original thunk runs once and the public failure contains only fixed name and code fields.
  assert.equal(result, nativeResult);
  assert.equal(calls, 1);
  assert.deepEqual(session.snapshot().failure, { name: 'PreflightError', code: 'entry_count_unavailable' });
  assert.equal(session.snapshot().active, false);
  assert.equal(JSON.stringify(session.snapshot()).includes('Untrusted diagnostic detail'), false);
});

test('user rejects source drift before registration while preserving the original host factory', async t => {
  // Given a real bootstrap observes an unsupported host factory source.
  installPage(t);
  const session = start(t);
  const original = function changedHost(module) { module.exports = 'native-source-drift'; };
  const chunk = [['source-drift'], { 70940: original }];

  // When the host registers its changed factory and then executes the preserved registration.
  globalThis[QUEUE].push(chunk);
  await Promise.resolve();
  const module = { exports: {} };
  globalThis[QUEUE][0][1][70940](module);

  // Then matching fails visibly while the unchanged host module remains executable.
  assert.equal(globalThis[QUEUE][0][1][70940], original);
  assert.equal(module.exports, 'native-source-drift');
  assert.equal(session.snapshot().attempts, 1);
  assert.equal(session.snapshot().matches, 0);
  assert.deepEqual(session.snapshot().failure, { name: 'PreflightError', code: 'source_mismatch' });
  assert.equal(session.snapshot().active, false);
});

test('user matches the exact public factory and restores registration when stopping before execution', t => {
  // Given the complete pinned public factory accompanies a real pre-runtime bootstrap.
  installPage(t);
  const session = start(t);
  const original = createNativeMirrorFactory();

  // When the exact source registers and the user stops before the host executes it.
  globalThis[QUEUE].push([['pinned-source'], { 70940: original }]);
  const accepted = session.snapshot();
  session.stop();

  // Then one exact match is recorded and cleanup restores the original registration without executing it.
  assert.equal(accepted.attempts, 1);
  assert.equal(accepted.matches, 1);
  assert.equal(accepted.executions, 0);
  assert.equal(globalThis[QUEUE][0][1][70940], original);
  assert.equal(Object.hasOwn(globalThis[QUEUE], 'push'), false);
});

test('user retains host execution errors after the exact full factory enters its original dependency boundary', async t => {
  // Given the exact full factory is accepted and its external module resolver rejects a dependency.
  installPage(t);
  const session = start(t);
  const original = createNativeMirrorFactory();
  globalThis[QUEUE].push([['pinned-execution'], { 70940: original }]);
  const wrapped = globalThis[QUEUE][0][1][70940];
  const failure = new Error('Native dependency unavailable');
  const require = () => { throw failure; };
  require.m = { 70940: wrapped };
  require.r = exports => { Object.defineProperty(exports, '__esModule', { value: true }); };
  require.d = (exports, getters) => {
    for (const [key, get] of Object.entries(getters)) Object.defineProperty(exports, key, { get });
  };

  // When the original first dependency request fails inside the statically replaced factory.
  assert.throws(() => wrapped({ exports: {} }, {}, require), error => error === failure);
  await Promise.resolve();

  // Then the host receives its own error while observation records one attempted execution and a fixed failure.
  assert.equal(session.snapshot().executions, 1);
  assert.equal(session.snapshot().completed, false);
  assert.equal(require.m[70940], original);
  assert.deepEqual(session.snapshot().failure, { name: 'PreflightError', code: 'module_execution_failed' });
});

test('user rejects a late bootstrap without replacing the existing runtime dispatcher', t => {
  // Given the page runtime already owns the queue dispatcher.
  const queue = [];
  const push = function runtimePush(chunk) { return Array.prototype.push.call(this, chunk); };
  queue.push = push;
  installPage(t, { queue });

  // When the preflight starts after runtime ownership has been established.
  const session = start(t);

  // Then rejection is diagnostic only and leaves the host queue untouched.
  assert.equal(queue.push, push);
  assert.equal(queue.length, 0);
  assert.equal(session.snapshot().active, false);
  assert.deepEqual(session.snapshot().failure, { name: 'PreflightError', code: 'bootstrap_rejected' });
});

for (const [url, framed] of [
  [PAGE + '?changed=1', false], [PAGE + '#changed', false], [PAGE, true],
  ['https://chart-storage.test', false], ['https://www.binance.com/zh-CN/futures/DIAUSDT', false],
]) {
  test(`user cannot activate native preflight outside its exact top-level URL at ${url} framed=${framed}`, t => {
    // Given the execution context differs from the one explicitly supported incident page.
    installPage(t, { url, framed });

    // When the native-only entrypoint attempts to start.
    const session = start(t);

    // Then scope rejection happens without creating the runtime queue or accessing storage.
    assert.equal(session.snapshot().active, false);
    assert.deepEqual(session.snapshot().failure, { name: 'PreflightError', code: 'unsupported_page' });
    assert.equal(Object.hasOwn(globalThis, QUEUE), false);
  });
}

test('user receives a deterministic static artifact with only the intended native-only dependencies', async () => {
  // Given the checked-in local artifact and its dedicated in-memory compiler share one metadata source.
  const artifact = await readFile(new URL('../../experiments/binance-chart-storage/native-preflight.user.js', import.meta.url), 'utf8');

  // When the standalone experiment is compiled without writing files.
  const built = await compileNativePreflight();

  // Then its metadata, static dependency graph and generated bytes contain no writer or remote loader.
  assert.equal(built.code, artifact);
  assert.match(artifact, /@version\s+0\.0\.1\n/);
  assert.match(artifact, /@match\s+https:\/\/www\.binance\.com\/zh-CN\/futures\/USUSDT\n/);
  for (const directive of ['@sandbox raw', '@grant none', '@noframes', '@run-at document-start']) {
    assert.equal(artifact.split('\n').some(line => line.replace(/\s+/g, ' ').trim() === '// ' + directive), true);
  }
  assert.doesNotMatch(artifact, /@(?:require|updateURL|downloadURL|resource)\b|\beval\s*\(|\bnew\s+Function\s*\(/);
  assert.deepEqual(built.inputs.sort(), [
    'experiments/binance-chart-storage/bootstrap.js',
    'experiments/binance-chart-storage/mirror-module.js',
    'experiments/binance-chart-storage/native-preflight-core.js',
    'experiments/binance-chart-storage/native-preflight-entry.user.js',
  ]);
});

test('user receives only snapshot and stop controls from the generated userscript', async t => {
  // Given an isolated page realm and the exact local generated artifact.
  const artifact = await readFile(new URL('../../experiments/binance-chart-storage/native-preflight.user.js', import.meta.url), 'utf8');
  const events = new EventTarget();
  const page = { location: new URL(PAGE), setTimeout, clearTimeout,
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) };
  page.self = page;
  page.top = page;
  t.after(() => page.__BINANCE_MIRROR_PREFLIGHT__.stop());

  // When the userscript executes and its public stop control is used.
  runInNewContext(artifact, page);
  const api = page.__BINANCE_MIRROR_PREFLIGHT__;
  const before = api.snapshot();
  api.stop();
  runInNewContext(artifact, page);

  // Then only two frozen controls are exposed and repeated injection preserves the existing owner.
  assert.deepEqual(Object.keys(api), ['snapshot', 'stop']);
  assert.equal(Object.isFrozen(api), true);
  assert.equal(before.active, true);
  assert.equal(api.snapshot().active, false);
  assert.equal(api.snapshot().stopReason, 'manual');
  assert.equal(page.__BINANCE_MIRROR_PREFLIGHT__, api);
  assert.equal(Object.hasOwn(page, QUEUE), false);
});
