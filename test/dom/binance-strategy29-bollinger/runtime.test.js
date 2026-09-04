import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { installStrategy29 } from '../../../src/binance-strategy29-bollinger/runtime.js';

function fixture() {
  const dom = new JSDOM('<body></body>', { url: 'https://www.binance.com/en/futures/BTRUSDT' });
  const view = dom.window;
  let hidden = false, next = 0;
  const timers = new Map();
  Object.defineProperty(view.document, 'hidden', { get: () => hidden });
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
