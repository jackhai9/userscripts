import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { installStrategy29 } from '../../../src/binance-strategy29-bollinger/runtime.js';
import { STRATEGY29_REMOTE_ENABLED_KEY } from '../../../src/binance-strategy29-bollinger/remote-summary.js';

const gatewayStatus = JSON.parse(await readFile(new URL('../../fixtures/strategy29-gateway-status.json', import.meta.url)));

function fixture() {
  const dom = new JSDOM('<body></body>', { url: 'https://www.binance.com/en/futures/BTRUSDT' });
  const view = dom.window;
  let hidden = false, next = 0;
  const timers = new Map();
  Object.defineProperty(view.document, 'hidden', { get: () => hidden });
  view.console.warn = () => {};
  view.setInterval = callback => { timers.set(++next, callback); return next; };
  view.clearInterval = id => timers.delete(id);
  return { dom, view, timers,
    tick() { for (const callback of timers.values()) callback(); },
    hide(value) { hidden = value; view.document.dispatchEvent(new view.Event('visibilitychange')); } };
}

test('standalone injection is single-instance and pauses/resumes/disposes its only timer', () => {
  const f = fixture();
  const runtime = installStrategy29(f.view);
  assert.equal(installStrategy29(f.view), runtime);
  assert.equal(f.timers.size, 1);
  f.hide(true);
  assert.equal(f.timers.size, 0);
  f.hide(false);
  assert.equal(f.timers.size, 1);
  f.view.history.pushState({}, '', '/en/my/wallet/futures');
  assert.equal(runtime.diagnostics.contextPresent, false);
  runtime.dispose();
  assert.equal(f.timers.size, 0);
  f.hide(true); f.hide(false);
  assert.equal(f.timers.size, 0);
  f.dom.window.close();
});

test('remote transport failure never stops the local observer timer', async () => {
  const f = fixture();
  const values = new Map([
    [STRATEGY29_REMOTE_ENABLED_KEY, true],
    ['strategy29GatewayAuthSecret', 'synthetic-secret'],
    ['strategy29GatewayOrigin', 'http://127.0.0.1:8729'],
  ]);
  const runtime = installStrategy29(f.view, {
    request: async () => { throw new Error('synthetic remote failure'); },
    getValue: (key, fallback) => values.has(key) ? values.get(key) : fallback,
    setValue: (key, value) => values.set(key, value),
    registerMenuCommand() {},
    promptUser() { return null; },
  });
  await new Promise(resolve => f.view.setTimeout(resolve, 0));
  assert.equal(runtime.diagnostics.runtimeFailure, null);
  assert.equal(runtime.diagnostics.remoteSummary.state, 'stopped');
  assert.equal(f.timers.size, 1);
  runtime.dispose();
  f.dom.window.close();
});

for (const [name, remoteResponse, expectedState] of [
  ['HTTP 400', { status: 400, responseText: JSON.stringify({ schema_version: 1, error: 'invalid_request' }) }, 'stopped'],
  ['HTTP 401', { status: 401, responseText: JSON.stringify({ schema_version: 1, error: 'unauthorized' }) }, 'stopped'],
  ['HTTP 503', { status: 503, responseText: JSON.stringify({ schema_version: 1, error: 'database_unavailable' }) }, 'unavailable'],
  ['invalid JSON', { status: 200, responseText: '<html>' }, 'stopped'],
  ['spec mismatch', { status: 200, responseText: JSON.stringify({ ...gatewayStatus, spec_version: '29_2_spec_v2' }) }, 'incompatible'],
]) {
  test(`${name} remains a remote-only state while the local timer continues`, async () => {
    const f = fixture();
    const values = new Map([
      [STRATEGY29_REMOTE_ENABLED_KEY, true],
      ['strategy29GatewayAuthSecret', 'synthetic-secret'],
      ['strategy29GatewayOrigin', 'http://127.0.0.1:8729'],
    ]);
    const runtime = installStrategy29(f.view, {
      request: async () => remoteResponse,
      getValue: (key, fallback) => values.has(key) ? values.get(key) : fallback,
      setValue: (key, value) => values.set(key, value),
      registerMenuCommand() {},
      promptUser() { return null; },
    });
    await new Promise(resolve => f.view.setTimeout(resolve, 0));
    assert.equal(runtime.diagnostics.runtimeFailure, null);
    assert.equal(runtime.diagnostics.remoteSummary.state, expectedState);
    assert.equal(f.timers.size, 1);
    runtime.dispose();
    f.dom.window.close();
  });
}

test('hiding the page aborts the remote request and resumes with one shared runtime timer', async () => {
  const f = fixture();
  const values = new Map([
    [STRATEGY29_REMOTE_ENABLED_KEY, true],
    ['strategy29GatewayAuthSecret', 'synthetic-secret'],
    ['strategy29GatewayOrigin', 'http://127.0.0.1:8729'],
  ]);
  let aborts = 0;
  const runtime = installStrategy29(f.view, {
    request: ({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => { aborts += 1; reject(signal.reason); }, { once: true });
    }),
    getValue: (key, fallback) => values.has(key) ? values.get(key) : fallback,
    setValue: (key, value) => values.set(key, value),
    registerMenuCommand() {},
    promptUser() { return null; },
  });
  assert.equal(runtime.diagnostics.remoteSummary.inFlight, true);
  f.hide(true);
  await new Promise(resolve => f.view.setTimeout(resolve, 0));
  assert.equal(aborts, 1);
  assert.equal(f.timers.size, 0);
  assert.equal(runtime.diagnostics.remoteSummary.contextPresent, false);
  f.hide(false);
  assert.equal(f.timers.size, 1);
  assert.equal(runtime.diagnostics.remoteSummary.inFlight, true);
  runtime.dispose();
  f.dom.window.close();
});

for (const legacyFirst of [true, false]) {
  test(`legacy embedded observer refuses coexistence (legacy first=${legacyFirst})`, () => {
    const f = fixture();
    const legacy = {};
    Object.defineProperty(legacy, 'bollingerAlertState', { get() { throw new Error('Do not inspect legacy runtime data'); } });
    if (legacyFirst) f.view.__TM_CLOSE_LONG_DEBUG__ = legacy;
    const runtime = installStrategy29(f.view);
    if (!legacyFirst) { f.view.__TM_CLOSE_LONG_DEBUG__ = legacy; f.tick(); }
    assert.match(runtime.diagnostics.runtimeFailure, /update Orderbook to 2.7.199/);
    assert.equal(runtime.diagnostics.failed, null);
    assert.equal(f.timers.size, 0);
    assert.match(f.view.document.querySelector('[role=status]').textContent, /reload/);
    assert.equal(f.view.__TM_CLOSE_LONG_DEBUG__, legacy);
    runtime.dispose(); f.dom.window.close();
  });
}
