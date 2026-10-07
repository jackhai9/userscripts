import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { test, expect } from '../test.js';
import { openChartMirrorScoped, openMirrorBootstrapLab } from '../helpers/chart-storage-mirror-scoped.js';
import { STORAGE_LAB_ORIGIN } from '../helpers/chart-storage-lab.js';

test('user receives a statically generated mirror factory with exactly one pinned expression replacement', async ({ page }) => {
  // Given the generated candidate and its source provenance accompany the callback fixture.
  const root = new URL('../../../test/fixtures/binance-chart-storage/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('mirror-scoped-manifest.json', root), 'utf8'));
  await openMirrorBootstrapLab(page);

  // When strict registration validation accepts the exact original and rejects a source mismatch.
  const { original, changed, failure } = await page.evaluate(async () => {
    const module = await import('/mirror-module.js');
    const fixture = await import('/mirror-scoped-callback.js');
    const native = fixture.createNativeMirrorFactory();
    const replacement = module.replaceChartMirrorFactory(native, (_target, _entries, thunk) => thunk());
    let failure;
    try { module.replaceChartMirrorFactory(function mismatched() { return 1; }, () => []); }
    catch (error) { failure = error.message; }
    return { original: Function.prototype.toString.call(native), changed: Function.prototype.toString.call(replacement), failure };
  });
  const [start, end] = manifest.replacement.factory_utf16_range;
  const inserted = changed.slice(start, changed.length - (original.length - end));

  // Then reversing the single inserted dispatch reproduces every byte of the public factory.
  expect(createHash('sha256').update(original).digest('hex')).toBe(manifest.original_factory.sha256);
  expect(changed.slice(0, start) + original.slice(start, end) + changed.slice(start + inserted.length)).toBe(original);
  expect(inserted).toBe(`__dispatchChartMirror(Sr,fr,()=>${original.slice(start, end)})`);
  expect(failure).toBe('Mirror factory source does not match the pinned public module');
});

for (const mode of ['native', 'scoped']) {
  test(`user retains native same-stack set get remove and clear results with ${mode}`, async ({ page }) => {
    // Given a ready unmodified instance starts each operation matrix with one original value.
    await openChartMirrorScoped(page, { mode });
    await page.evaluate(async () => {
      const state = window.__MIRROR_SCOPED__;
      state.matrixStore = state.localforage.createInstance({ name: 'chart_futures' });
      await state.matrixStore.ready();
      state.matrixMethods = ['setItem', 'getItem', 'removeItem', 'clear'].map(name => state.matrixStore[name]);
    });

    // When each public operation sequence starts in one stack without waiting between its calls.
    const result = await page.evaluate(async () => {
      const state = window.__MIRROR_SCOPED__;
      const store = state.matrixStore;
      const outcomes = [];
      for (const operations of [['set', 'get'], ['set', 'remove', 'get'], ['set', 'clear', 'get'], ['get', 'remove', 'set', 'get']]) {
        await store.clear();
        await store.setItem('myTradingView', { revision: 'original' });
        const callbacks = [];
        const pending = operations.map((operation, index) => {
          const callback = (error, value) => callbacks.push({ index, operation, error, value });
          if (operation === 'set') return store.setItem('myTradingView', { revision: 'new' }, callback);
          if (operation === 'get') return store.getItem('myTradingView', callback);
          if (operation === 'remove') return store.removeItem('myTradingView', callback);
          return store.clear(callback);
        });
        outcomes.push({ values: await Promise.all(pending), callbacks, finalValue: await store.getItem('myTradingView') });
      }
      return { outcomes, dispatches: state.dispatches,
        sameMethods: ['setItem', 'getItem', 'removeItem', 'clear'].every((name, index) => store[name] === state.matrixMethods[index]),
        sameFactory: state.localforage.createInstance === state.nativeCreateInstance };
    });

    // Then native delayed set preparation preserves concrete values and callback ordering in every matrix.
    const before = { revision: 'original' };
    const after = { revision: 'new' };
    const callback = (index, operation, value) => ({ index, operation, error: null, value });
    expect(result).toEqual({ outcomes: [
      { values: [after, before], callbacks: [callback(1, 'get', before), callback(0, 'set', after)], finalValue: after },
      { values: [after, undefined, null], callbacks: [callback(1, 'remove', undefined), callback(2, 'get', null), callback(0, 'set', after)], finalValue: after },
      { values: [after, undefined, null], callbacks: [callback(1, 'clear', undefined), callback(2, 'get', null), callback(0, 'set', after)], finalValue: after },
      { values: [before, undefined, after, null], callbacks: [callback(0, 'get', before), callback(1, 'remove', undefined), callback(3, 'get', null), callback(2, 'set', after)], finalValue: after },
    ], dispatches: 0, sameMethods: true, sameFactory: true });
  });

  test(`user preserves ordinary storage API identity and native concurrent clear ordering with ${mode}`, async ({ page }) => {
    // Given real localForage and Basic storage are ready before the mirror writer is used.
    await openChartMirrorScoped(page, { mode });
    await page.evaluate(async () => {
      const state = window.__MIRROR_SCOPED__;
      state.tv = window.__STORAGE_LAB__.create();
      state.basic = window.__CHART_HOST__.basic.create({ namespace: 'chart_futures', symbol: 'BTCUSDT' });
      await state.tv.setItem('myTradingView', { revision: 0 });
      await state.basic.saveSettings({ background: 'initial' });
      state.setItem = state.tv.setItem;
      state.clear = state.tv.clear;
    });

    // When native writes and the original Basic clear are issued in the same stack.
    const result = await page.evaluate(async () => {
      const state = window.__MIRROR_SCOPED__;
      await Promise.all([
        state.tv.setItem('#TV_SYMBOL-BEFORE', []), state.basic.saveSettings({ background: 'before-clear' }),
        state.basic.clear(), state.tv.setItem('#TV_SYMBOL-AFTER', []),
      ]);
      return {
        keys: (await state.tv.keys()).sort(), settings: await state.tv.getItem('candlestick-setting'),
        snapshot: await state.tv.getItem('myTradingView'), dispatches: state.dispatches,
        identity: state.localforage.createInstance === state.nativeCreateInstance && state.tv.setItem === state.setItem && state.tv.clear === state.clear,
      };
    });

    // Then the same native ordering survives and no ordinary storage call enters the scoped writer.
    expect(result).toEqual({
      keys: ['#TV_SYMBOL-AFTER', '#TV_SYMBOL-BEFORE', 'candlestick-setting'], settings: { background: 'before-clear' },
      snapshot: null, dispatches: 0, identity: true,
    });
  });

  test(`user mirrors the original serial save chain while retaining null values and target-only keys with ${mode}`, async ({ page }) => {
    // Given source and target hold independent Basic settings and an explicit null drawing.
    await openChartMirrorScoped(page, { mode });
    await page.evaluate(async () => {
      const state = window.__MIRROR_SCOPED__;
      state.source = state.localforage.createInstance({ name: 'chart_futures' });
      state.target = state.localforage.createInstance({ name: 'chart_delivery' });
      await state.source.setItem('#TV_SYMBOL-NULL', null);
      await state.source.setItem('candlestick-setting', { theme: 'source' });
      await state.target.setItem('candlestick-setting', { theme: 'target' });
      await state.target.setItem('#TV_SYMBOL-TARGET-ONLY', []);
      state.save = window.__CHART_HOST__.tradingView.createSaveCallback(state.source, 'myTradingView', {}, state.create('chart_futures'));
      window.__STORAGE_NATIVE__.reset();
    });

    // When the unchanged original save callback awaits three successive mirror callbacks.
    const result = await page.evaluate(async () => {
      const state = window.__MIRROR_SCOPED__;
      for (const revision of [1, 1, 2]) await state.save({ layout: 's', revision, charts: [] });
      const metrics = window.__STORAGE_NATIVE__.snapshot();
      return {
        source: await state.source.getItem('myTradingView'), target: await state.target.getItem('myTradingView'),
        targetKeys: (await state.target.keys()).sort(), targetNull: await state.target.getItem('#TV_SYMBOL-NULL'),
        sourceBasic: await state.source.getItem('candlestick-setting'), targetBasic: await state.target.getItem('candlestick-setting'),
        targetOnly: await state.target.getItem('#TV_SYMBOL-TARGET-ONLY'), metrics, dispatches: state.dispatches,
      };
    });

    // Then snapshots match, null remains a stored key, and only target mirror writes use fewer transactions.
    expect(result.source).toEqual({ layout: 's', revision: 2, charts: [] });
    expect(result.target).toEqual(result.source);
    expect(result.targetKeys).toEqual(['#TV_SYMBOL-NULL', '#TV_SYMBOL-TARGET-ONLY', 'candlestick-setting', 'myTradingView', 'myTradingView.layout']);
    expect(result.targetNull).toBe(null);
    expect(result.sourceBasic).toEqual({ theme: 'source' });
    expect(result.targetBasic).toEqual({ theme: 'target' });
    expect(result.targetOnly).toEqual([]);
    expect(result.metrics.puts).toBe(mode === 'native' ? 15 : 10);
    expect(result.metrics.transactions).toBe(mode === 'native' ? 30 : 24);
    expect(result.metrics.pending).toBe(0);
    expect(result.metrics.aborted).toBe(0);
    expect(result.dispatches).toBe(mode === 'native' ? 0 : 3);
  });

  test(`user keeps native mirror guards and empty-source behavior with ${mode}`, async ({ page }) => {
    // Given only an unrelated Basic key exists and both mirror control refs are available.
    await openChartMirrorScoped(page, { mode });
    await page.evaluate(async () => {
      const state = window.__MIRROR_SCOPED__;
      await window.__STORAGE_LAB__.native.setItem('candlestick-setting', { theme: 'source' });
      state.blocked = state.create('chart_futures', { current: true }, { current: true });
      state.disabled = state.create('chart_futures', { current: false }, { current: false });
      window.__STORAGE_NATIVE__.reset();
    });

    // When guarded callbacks return before storage and an enabled callback sees zero mirror entries.
    const result = await page.evaluate(async () => {
      const state = window.__MIRROR_SCOPED__;
      const guarded = await Promise.all([state.blocked(), state.disabled()]);
      const guards = window.__STORAGE_NATIVE__.snapshot();
      await state.create('chart_futures')();
      const empty = window.__STORAGE_NATIVE__.snapshot();
      const target = state.localforage.createInstance({ name: 'chart_delivery' });
      return { guarded, guards, empty, targetKeys: await target.keys(), dispatches: state.dispatches };
    });

    // Then neither guard performs IO and the empty mirror issues only its native source-key read.
    expect(result.guarded).toEqual([undefined, undefined]);
    expect(result.guards.transactions).toBe(0);
    expect(result.empty.transactions).toBe(1);
    expect(result.empty.puts).toBe(0);
    expect(result.targetKeys).toEqual([]);
    expect(result.dispatches).toBe(mode === 'native' ? 0 : 1);
  });
}

for (const order of ['runtime-first', 'module-first']) {
  test(`user replaces only the selected mirror module before first require with ${order}`, async ({ page }) => {
    // Given the empty queue observer has an explicit synthetic 70940 replacement and an unrelated module.
    await openMirrorBootstrapLab(page);
    await page.evaluate(async () => {
      const { observeChartStorageBootstrap } = await import('/bootstrap.js');
      const state = { replacements: 0, originalExecutions: 0, patchedExecutions: 0 };
      state.original = function (module) { state.originalExecutions += 1; module.exports = { value: 'original' }; };
      state.patched = function (module) { state.patchedExecutions += 1; module.exports = { value: 'patched' }; };
      state.observer = observeChartStorageBootstrap({ replaceMirrorFactory(original) {
        if (original !== state.original) throw new Error('Unexpected synthetic factory');
        state.replacements += 1;
        return state.patched;
      } });
      state.chunk = [['mirror-scoped-synthetic'], { 70940: state.original, 43917(module) { module.exports = { value: 'untouched' }; } }, require => {
        state.require = require;
        state.first = require(70940);
        state.other = require(43917);
      }];
      window.__MIRROR_ENGINE__ = state;
    });

    // When the actual Rspack runtime consumes the synthetic module in either registration order.
    if (order === 'runtime-first') await page.addScriptTag({ url: `${STORAGE_LAB_ORIGIN}/webpack-runtime.js` });
    await page.evaluate(() => self.webpackChunkfutures_trade_ui.push(window.__MIRROR_ENGINE__.chunk));
    if (order === 'module-first') await page.addScriptTag({ url: `${STORAGE_LAB_ORIGIN}/webpack-runtime.js` });
    const result = await page.evaluate(async () => {
      const state = window.__MIRROR_ENGINE__;
      const captured = await state.observer.captured;
      state.observer.stop();
      return {
        first: state.first, other: state.other, sameExport: state.require(70940) === captured,
        replacements: state.replacements, originalExecutions: state.originalExecutions, patchedExecutions: state.patchedExecutions,
        restored: state.require.m[70940] === state.original,
        queueRestored: Object.hasOwn(Object.getOwnPropertyDescriptor(self.webpackChunkfutures_trade_ui, 'push'), 'value'),
      };
    });

    // Then the cached transformed export survives observer cleanup while future factory and queue slots are restored.
    expect(result).toEqual({ first: { value: 'patched' }, other: { value: 'untouched' }, sameExport: true,
      replacements: 1, originalExecutions: 0, patchedExecutions: 1, restored: true, queueRestored: true });
  });
}

test('user keeps the native module executable when strict mirror registration validation rejects', async ({ page }) => {
  // Given an early observer uses the real strict replacement against a mismatched synthetic factory.
  await openMirrorBootstrapLab(page);
  await page.evaluate(async () => {
    const { observeChartStorageBootstrap } = await import('/bootstrap.js');
    const { replaceChartMirrorFactory } = await import('/mirror-module.js');
    const state = { executions: 0 };
    state.original = function (module) { state.executions += 1; module.exports = { value: 'native' }; };
    state.observer = observeChartStorageBootstrap({ replaceMirrorFactory: original => replaceChartMirrorFactory(original, (_target, _entries, thunk) => thunk()) });
    state.failure = state.observer.captured.then(() => 'unexpected-success', error => error.message);
    window.__MIRROR_ENGINE__ = state;
  });

  // When actual runtime registration rejects transformation before the native factory executes.
  await page.addScriptTag({ url: `${STORAGE_LAB_ORIGIN}/webpack-runtime.js` });
  const result = await page.evaluate(async () => {
    const state = window.__MIRROR_ENGINE__;
    self.webpackChunkfutures_trade_ui.push([['mirror-scoped-rejected'], { 70940: state.original }, require => { state.require = require; state.first = require(70940); }]);
    return { failure: await state.failure, first: state.first, sameExport: state.require(70940) === state.first,
      executions: state.executions, restored: state.require.m[70940] === state.original };
  });

  // Then observer rejection cannot enter the runtime module-error cache or alter native exports.
  expect(result).toEqual({ failure: 'Mirror factory source does not match the pinned public module', first: { value: 'native' },
    sameExport: true, executions: 1, restored: true });
});

for (const runtimeStarted of [false, true]) {
  test(`user retains the native factory when replacement synchronously stops observation with runtime started ${runtimeStarted}`, async ({ page }) => {
    // Given the synchronous replacement callback stops its observer before returning a candidate factory.
    await openMirrorBootstrapLab(page);
    await page.evaluate(async () => {
      const { observeChartStorageBootstrap } = await import('/bootstrap.js');
      const state = { originalExecutions: 0, patchedExecutions: 0 };
      state.original = function (module) { state.originalExecutions += 1; module.exports = { value: 'native' }; };
      state.patched = function (module) { state.patchedExecutions += 1; module.exports = { value: 'patched' }; };
      state.observer = observeChartStorageBootstrap({ replaceMirrorFactory() {
        state.observer.stop();
        return state.patched;
      } });
      state.failure = state.observer.captured.then(() => 'unexpected-success', error => error.message);
      window.__MIRROR_ENGINE__ = state;
    });

    // When the real runtime consumes that registration before the host's first require.
    if (runtimeStarted) await page.addScriptTag({ url: `${STORAGE_LAB_ORIGIN}/webpack-runtime.js` });
    await page.evaluate(() => {
      const state = window.__MIRROR_ENGINE__;
      self.webpackChunkfutures_trade_ui.push([['mirror-scoped-stop-during-replacement'], { 70940: state.original }, require => {
        state.require = require;
        state.first = require(70940);
      }]);
    });
    if (!runtimeStarted) await page.addScriptTag({ url: `${STORAGE_LAB_ORIGIN}/webpack-runtime.js` });
    const result = await page.evaluate(async () => {
      const state = window.__MIRROR_ENGINE__;
      const queue = self.webpackChunkfutures_trade_ui;
      return { failure: await state.failure, first: state.first, sameExport: state.require(70940) === state.first,
        originalExecutions: state.originalExecutions, patchedExecutions: state.patchedExecutions,
        originalFactory: state.require.m[70940] === state.original,
        queuedOriginalFactory: queue.find(chunk => Object.hasOwn(chunk[1], '70940'))[1][70940] === state.original,
        queueRestored: Object.hasOwn(Object.getOwnPropertyDescriptor(queue, 'push'), 'value') };
    });

    // Then stop rejects capture while the original factory executes once and owns the unchanged runtime cache.
    expect(result).toEqual({ failure: 'Storage bootstrap stopped before module execution', first: { value: 'native' },
      sameExport: true, originalExecutions: 1, patchedExecutions: 0, originalFactory: true, queuedOriginalFactory: true, queueRestored: true });
  });

  test(`user restores the original unexecuted mirror factory when stopped with runtime started ${runtimeStarted}`, async ({ page }) => {
    // Given a replaced synthetic mirror factory has registered without being required.
    await openMirrorBootstrapLab(page);
    await page.evaluate(async () => {
      const { observeChartStorageBootstrap } = await import('/bootstrap.js');
      const state = { executions: 0 };
      state.original = function (module) { state.executions += 1; module.exports = { value: 'native-after-stop' }; };
      state.observer = observeChartStorageBootstrap({ replaceMirrorFactory: () => function () { throw new Error('Stopped replacement executed'); } });
      state.failure = state.observer.captured.then(() => 'unexpected-success', error => error.message);
      window.__MIRROR_ENGINE__ = state;
    });
    if (runtimeStarted) await page.addScriptTag({ url: `${STORAGE_LAB_ORIGIN}/webpack-runtime.js` });
    await page.evaluate(() => self.webpackChunkfutures_trade_ui.push([['mirror-scoped-stopped'], { 70940: window.__MIRROR_ENGINE__.original }]));

    // When stop restores the registered factory before the actual runtime requires it.
    await page.evaluate(() => window.__MIRROR_ENGINE__.observer.stop());
    if (!runtimeStarted) await page.addScriptTag({ url: `${STORAGE_LAB_ORIGIN}/webpack-runtime.js` });
    const result = await page.evaluate(async () => {
      const state = window.__MIRROR_ENGINE__;
      self.webpackChunkfutures_trade_ui.push([['mirror-scoped-stopped-entry'], {}, require => { state.require = require; state.value = require(70940); }]);
      return { value: state.value, executions: state.executions, restored: state.require.m[70940] === state.original,
        failure: await state.failure, queueRestored: Object.hasOwn(Object.getOwnPropertyDescriptor(self.webpackChunkfutures_trade_ui, 'push'), 'value') };
    });

    // Then only the original factory executes and the observer reports its explicit pre-execution stop.
    expect(result).toEqual({ value: { value: 'native-after-stop' }, executions: 1, restored: true,
      failure: 'Storage bootstrap stopped before module execution', queueRestored: true });
  });
}

test('user resumes the exact native per-key mirror map through retained callbacks after the scoped writer stops', async ({ page }) => {
  // Given one retained transformed mirror callback points to a source with three mirror entries.
  await openChartMirrorScoped(page);
  await page.evaluate(async () => {
    const state = window.__MIRROR_SCOPED__;
    const source = state.localforage.createInstance({ name: 'chart_futures' });
    await Promise.all([source.setItem('myTradingView', { revision: 1 }), source.setItem('myTradingView.layout', []), source.setItem('#TV_SYMBOL-NULL', null)]);
    state.retained = state.create('chart_futures');
    await state.writer.stop();
    window.__STORAGE_NATIVE__.reset();
  });

  // When the unchanged surrounding host callback calls dispatch after the writer has stopped.
  const result = await page.evaluate(async () => {
    const state = window.__MIRROR_SCOPED__;
    await state.retained();
    const metrics = window.__STORAGE_NATIVE__.snapshot();
    const target = state.localforage.createInstance({ name: 'chart_delivery' });
    return { metrics, keys: (await target.keys()).sort(), snapshot: await target.getItem('myTradingView'), dispatches: state.dispatches,
      createInstanceUnchanged: state.localforage.createInstance === state.nativeCreateInstance };
  });

  // Then three native target transactions preserve the original map and native instance factory identity.
  expect(result.metrics.transactions).toBe(7);
  expect(result.metrics.puts).toBe(3);
  expect(result.metrics.pending).toBe(0);
  expect(result.keys).toEqual(['#TV_SYMBOL-NULL', 'myTradingView', 'myTradingView.layout']);
  expect(result.snapshot).toEqual({ revision: 1 });
  expect(result.dispatches).toBe(1);
  expect(result.createInstanceUnchanged).toBe(true);
});

for (const mode of ['native', 'scoped']) {
  test(`user preserves all historical mirror data through thirty-two real host save chains with ${mode}`, async ({ page }, testInfo) => {
    // Given 290 historical drawing keys already exist in each independently initialized database.
    test.setTimeout(30_000);
    await openChartMirrorScoped(page, { mode });
    await page.evaluate(async () => {
      const state = window.__MIRROR_SCOPED__;
      state.source = state.localforage.createInstance({ name: 'chart_futures' });
      state.target = state.localforage.createInstance({ name: 'chart_delivery' });
      state.history = Array.from({ length: 290 }, (_, index) => ({ key: `#TV_SYMBOL-LAB${index}`, value: [{ id: `history-${index}`, points: [{ time: 1000, price: index }] }] }));
      await Promise.all(state.history.flatMap(({ key, value }) => [state.source.setItem(key, value), state.target.setItem(key, value)]));
      state.initial = { layout: 's', revision: 0, charts: [{ chartId: '0', panes: [{ mainSourceId: 'main-BTCUSDT', sources: [
        { id: 'main-BTCUSDT', type: 'MainSeries', state: { symbol: 'BTCUSDT' } },
        { id: 'drawing-BTCUSDT', type: 'LineToolTrendLine', ownerSource: 'main-BTCUSDT', state: { symbol: 'BTCUSDT' }, points: [{ time: 1000, price: 20 }, { time: 2000, price: 25 }] },
      ] }] }] };
      state.save = window.__CHART_HOST__.tradingView.createSaveCallback(state.source, 'myTradingView', {}, state.create('chart_futures'));
      await state.save(structuredClone(state.initial));
      window.__STORAGE_NATIVE__.reset();
      state.dispatches = 0;
    });

    // When eight revisions each complete four concurrent unchanged host save and mirror chains.
    const result = await page.evaluate(async () => {
      const state = window.__MIRROR_SCOPED__;
      let completed = 0;
      const started = performance.now();
      for (let revision = 1; revision <= 8; revision += 1) {
        const snapshot = structuredClone(state.initial);
        snapshot.revision = revision;
        snapshot.charts[0].panes[0].sources[1].points[1].price = 25 + revision;
        completed += (await Promise.all(Array.from({ length: 4 }, () => state.save(snapshot)))).length;
      }
      const elapsedMs = performance.now() - started;
      const metrics = window.__STORAGE_NATIVE__.snapshot();
      const read = async storage => ({ keys: (await storage.keys()).sort(), history: await Promise.all(state.history.map(async ({ key }) => ({ key, value: await storage.getItem(key) }))),
        loaded: await window.__CHART_HOST__.tradingView.load({ storage, key: 'myTradingView' }) });
      return { completed, elapsedMs, metrics, dispatches: state.dispatches, source: await read(state.source), target: await read(state.target),
        expectedHistory: state.history, createInstanceUnchanged: state.localforage.createInstance === state.nativeCreateInstance };
    });
    await testInfo.attach(`mirror-scoped-load-${mode}.json`, { body: JSON.stringify({ mode, completed: result.completed, elapsedMs: result.elapsedMs, metrics: result.metrics }, null, 2), contentType: 'application/json' });

    // Then both full datasets retain every historical value and the final drawing revision without facade changes.
    expect(result.completed).toBe(32);
    expect(result.source).toEqual(result.target);
    expect(result.source.history).toEqual(result.expectedHistory);
    expect(result.source.keys).toEqual([...result.expectedHistory.map(({ key }) => key), '#TV_SYMBOL-BTCUSDT', 'myTradingView', 'myTradingView.layout'].sort());
    expect(result.source.loaded.chartSave.revision).toBe(8);
    expect(result.source.loaded.chartSave.charts[0].panes[0].sources[1].points[1].price).toBe(33);
    expect(result.metrics.transactions).toBe((mode === 'native' ? 591 : 299) * 32);
    expect(result.metrics.puts).toBe(mode === 'native' ? 296 * 32 : 112);
    expect(result.metrics.pending).toBe(0);
    expect(result.metrics.aborted).toBe(0);
    expect(result.metrics.completed).toBe(result.metrics.transactions);
    expect(result.dispatches).toBe(mode === 'native' ? 0 : 32);
    expect(result.elapsedMs).toBeGreaterThan(0);
    expect(result.createInstanceUnchanged).toBe(true);
  });
}
