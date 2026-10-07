import test from 'node:test';
import assert from 'node:assert/strict';
import { installChartStoragePrototype } from '../../experiments/binance-chart-storage/adapter.js';
import { observeChartStorageModule } from '../../experiments/binance-chart-storage/capture.js';
import { observeChartStorageBootstrap } from '../../experiments/binance-chart-storage/bootstrap.js';
import { startChartStoragePreflight } from '../../experiments/binance-chart-storage/preflight.js';
import { createChartMirrorWriter } from '../../experiments/binance-chart-storage/mirror-writer.js';

for (const origin of ['https://www.binance.com', 'https://outside-storage.test', 'http://chart-storage.test']) {
  test(`user cannot activate storage experiments on ${origin}`, () => {
    // Given an environment outside the isolated HTTPS lab and untouched host entrypoints.
    const previousLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
    Object.defineProperty(globalThis, 'location', { value: { origin }, configurable: true });
    const localforage = { createInstance() { throw new Error('Host factory must not execute'); } };
    const createInstance = localforage.createInstance;
    const queue = [];
    const push = queue.push;
    try {
      // When the lab-only public entrypoints are invoked outside their allowed origin.
      assert.throws(() => installChartStoragePrototype(localforage), /isolated lab origin/);
      assert.throws(() => observeChartStorageModule(queue), /isolated lab origin/);
      assert.throws(() => createChartMirrorWriter(), /isolated lab origin/);

      // Then neither the host instance factory nor the module registration queue is changed.
      assert.equal(localforage.createInstance, createInstance);
      assert.equal(queue.push, push);
      assert.equal(queue.length, 0);
    } finally {
      if (previousLocation) Object.defineProperty(globalThis, 'location', previousLocation);
      else delete globalThis.location;
    }
  });
}

for (const [url, framed, scope, accepted] of [
  ['https://chart-storage.test', false, 'lab', true],
  ['https://www.binance.com/zh-CN/futures/USUSDT', false, 'isolated-ususdt-probe', true],
  ['https://www.binance.com/zh-CN/futures/USUSDT', false, undefined, false],
  ['https://www.binance.com/zh-CN/futures/USUSDT', true, 'isolated-ususdt-probe', false],
  ['https://www.binance.com/zh-CN/futures/home', false, 'isolated-ususdt-probe', false],
  ['https://www.binance.com/zh-CN/futures/DIAUSDT', false, 'isolated-ususdt-probe', false],
  ['http://www.binance.com/zh-CN/futures/USUSDT', false, 'isolated-ususdt-probe', false],
  ['https://outside-storage.test/zh-CN/futures/USUSDT', false, 'isolated-ususdt-probe', false],
  ['https://chart-storage.test', false, 'isolated-ususdt-probe', false],
  ['https://chart-storage.test', false, 'unknown', false],
]) {
  test(`user ${accepted ? 'can initialize' : 'cannot initialize'} the mirror writer for ${url} framed=${framed} scope=${scope}`, async () => {
    // Given an explicit page scope and a storage boundary that must remain untouched at initialization.
    const saved = new Map(['location', 'self', 'top', 'indexedDB'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    Object.defineProperty(globalThis, 'location', { value: new URL(url), configurable: true });
    Object.defineProperty(globalThis, 'self', { value: globalThis, configurable: true });
    Object.defineProperty(globalThis, 'top', { value: framed ? {} : globalThis, configurable: true });
    let storageAccesses = 0;
    Object.defineProperty(globalThis, 'indexedDB', { get() { storageAccesses += 1; throw new Error('Unexpected storage access'); }, configurable: true });
    try {
      // When the caller requests only the selected scope without dispatching any records.
      const create = () => createChartMirrorWriter({ scope });
      let writer;
      if (accepted) writer = create();

      // Then only the explicit valid scope admits an empty writer and no scope initializes a database.
      if (accepted) {
        assert.equal(writer.getStats().acceptedBatches, 0);
        assert.equal(writer.getStats().transactions, 0);
        await writer.stop();
        assert.equal(writer.getStats().pendingBatches, 0);
      } else {
        assert.throws(create, /Chart mirror writer requires|Unknown chart mirror scope/);
      }
      assert.equal(storageAccesses, 0);
    } finally {
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    }
  });
}

for (const [url, framed] of [
  ['https://outside-storage.test/zh-CN/futures/USUSDT', false],
  ['http://www.binance.com/zh-CN/futures/USUSDT', false],
  ['https://www.binance.com/zh-CN/futures/home', false],
  ['https://www.binance.com/zh-CN/my/wallet/futures', false],
  ['https://www.binance.com/zh-CN/futures/USUSDT', true],
]) {
  test(`user cannot observe chart startup outside the pinned top-level page at ${url} framed=${framed}`, () => {
    // Given a wrong origin, route or frame and no owned bootstrap queue.
    const saved = new Map(['location', 'self', 'top'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    Object.defineProperty(globalThis, 'location', { value: new URL(url), configurable: true });
    Object.defineProperty(globalThis, 'self', { value: globalThis, configurable: true });
    Object.defineProperty(globalThis, 'top', { value: framed ? {} : globalThis, configurable: true });
    try {
      // When either observation entrypoint attempts to initialize on that page.
      assert.throws(() => observeChartStorageBootstrap(), /top-level USUSDT incident page/);
      assert.throws(() => startChartStoragePreflight(), /top-level USUSDT incident page/);

      // Then rejection precedes the creation of the page's runtime queue.
      assert.equal(Object.hasOwn(globalThis, 'webpackChunkfutures_trade_ui'), false);
    } finally {
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    }
  });
}
