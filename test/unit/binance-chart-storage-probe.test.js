import test from 'node:test';
import assert from 'node:assert/strict';
import { captureAnonymousMirrorBatch } from '../../experiments/binance-chart-storage/anonymous-probe-contract.js';

test('user sees route and snapshot admission failures even when the host later completes a healthy mirror', () => {
  // Given the probe owns its fixed top-level URL and has not accepted any records.
  const saved = new Map(['location', 'self', 'top'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, 'location', { value: new URL('https://www.binance.com/zh-CN/futures/USUSDT'), configurable: true });
  Object.defineProperty(globalThis, 'self', { value: globalThis, configurable: true });
  Object.defineProperty(globalThis, 'top', { value: globalThis, configurable: true });
  const target = {};
  const state = { failed: 0 };
  try {
    // When a same-document route change or invalid chart value reaches the diagnostic boundary.
    location.pathname = '/zh-CN/futures/DIAUSDT';
    assert.throws(() => captureAnonymousMirrorBatch(target, [], state), /left its fixed top-level URL/);
    location.pathname = '/zh-CN/futures/USUSDT';
    assert.throws(() => captureAnonymousMirrorBatch(target, [['myTradingView', new Date()]], state), /Chart values must be plain JSON/);
    const value = { revision: 2, nested: [1, 2] };
    const batch = captureAnonymousMirrorBatch(target, [['myTradingView', value]], state);
    value.nested.push(3);

    // Then both failures remain counted and the healthy batch retains its independent input snapshot.
    assert.equal(state.failed, 2);
    assert.equal(batch.target, target);
    assert.deepEqual(batch.entries, [['myTradingView', { revision: 2, nested: [1, 2] }]]);
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

for (const [url, framed] of [
  ['https://www.binance.com/zh-CN/futures/USUSDT?changed=1', false],
  ['https://www.binance.com/zh-CN/futures/USUSDT#changed', false],
  ['https://www.binance.com/zh-CN/futures/USUSDT', true],
]) {
  test(`user cannot capture a probe mirror after leaving its exact URL or frame at ${url} framed=${framed}`, () => {
    // Given a retained caller now belongs to a changed URL or a child frame.
    const saved = new Map(['location', 'self', 'top'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    Object.defineProperty(globalThis, 'location', { value: new URL(url), configurable: true });
    Object.defineProperty(globalThis, 'self', { value: globalThis, configurable: true });
    Object.defineProperty(globalThis, 'top', { value: framed ? {} : globalThis, configurable: true });
    const state = { failed: 0 };
    try {
      // When the retained callback attempts to prepare another mirror batch.
      const capture = () => captureAnonymousMirrorBatch({}, [], state);

      // Then admission fails before even an empty batch reaches the writer.
      assert.throws(capture, /left its fixed top-level URL/);
      assert.equal(state.failed, 1);
    } finally {
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    }
  });
}
