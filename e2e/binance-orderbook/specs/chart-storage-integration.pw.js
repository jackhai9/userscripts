import { test, expect } from '../test.js';
import { initializeStorageLab, openEmptyStorageLab, openStorageLab, STORAGE_LAB_ORIGIN } from '../helpers/chart-storage-lab.js';
import { installScenarioClock, pauseScenarioClock } from '../helpers/scenario-clock.js';

async function installEarlyCapture(page, { existingQueue = true, callbackFails = false } = {}) {
  await page.evaluate(async ({ existingQueue, callbackFails }) => {
    const { observeChartStorageBootstrap } = await import('/bootstrap.js');
    const { installChartStoragePrototype } = await import('/adapter.js');
    if (existingQueue) self.webpackChunkfutures_trade_ui = [];
    const state = {
      captures: 0, factoryExecutions: 0, completion: 'pending',
      hostResult: null, hostError: null,
    };
    window.__STORAGE_STARTUP__ = state;
    state.capture = observeChartStorageBootstrap({
      onCapture(localforage) {
        state.captures += 1;
        if (callbackFails) throw new Error('Startup capture callback failed');
        state.capturedExport = localforage;
        state.nativeCreateInstance = localforage.createInstance;
        state.controller = installChartStoragePrototype(localforage);
      },
    });
    state.queue = self.webpackChunkfutures_trade_ui;
    state.capture.captured.then(
      value => { state.completion = 'fulfilled'; state.completedExport = value; },
      error => { state.completion = 'rejected'; state.captureError = error.message; },
    );
    state.runHost = require => {
      try {
        const localforage = require(43917);
        state.hostExport = localforage;
        state.store = localforage.createInstance({
          name: 'chart_futures', storeName: 'keyvaluepairs', driver: localforage.INDEXEDDB,
        });
        state.saved = state.store.setItem('#TV_SYMBOL-STARTUP', { interval: '15' });
        state.hostResult = {
          captures: state.captures,
          acceptedBeforeReturn: state.controller ? state.controller.getStats().acceptedOperations : 0,
          exportMatches: localforage === state.capturedExport,
        };
      } catch (error) {
        state.hostError = error.message;
      }
    };
  }, { existingQueue, callbackFails });
}

/**
 * Execute the unchanged library fixture with only its chunk-registration boundary
 * supplied by the host. The real factory and runtime cache own module execution.
 */
async function registerStorageChunk(page, { requireStorage = true } = {}) {
  await page.evaluate(async ({ requireStorage }) => {
    const response = await fetch('/localforage-module.js');
    if (!response.ok) throw new Error(`Storage fixture request failed: ${response.status}`);
    const source = await response.text();
    const state = window.__STORAGE_STARTUP__;
    const registration = {
      webpackChunkfutures_trade_ui: {
        push(chunk) {
          const actualFactory = chunk[1][43917];
          state.originalFactory = function (...args) {
            state.factoryExecutions += 1;
            const result = actualFactory.apply(this, args);
            state.nativeFactoryBeforeCapture = args[0].exports.createInstance;
            return result;
          };
          chunk[1][43917] = state.originalFactory;
          chunk[2] = require => {
            state.require = require;
            if (requireStorage) state.runHost(require);
          };
          return state.queue.push(chunk);
        },
      },
    };
    new Function('self', source)(registration);
  }, { requireStorage });
}

async function installStoragePreflight(page) {
  await page.evaluate(async () => {
    const { startChartStoragePreflight } = await import('/preflight.js');
    const preflight = startChartStoragePreflight();
    const state = {
      preflight, queue: self.webpackChunkfutures_trade_ui, factoryExecutions: 0,
      runHost(require) {
        state.hostExport = require(43917);
        state.store = state.hostExport.createInstance({ name: 'chart_futures' });
        state.snapshotBeforeHostReturns = preflight.snapshot();
      },
    };
    window.__STORAGE_STARTUP__ = state;
    window.__STORAGE_NATIVE__.reset();
  });
}

async function readCaptureCleanup(page) {
  return page.evaluate(() => {
    const state = window.__STORAGE_STARTUP__;
    const push = state.queue.push;
    state.capture.stop();
    let laterHostExport;
    state.queue.push([['storage-lab-after-capture'], {}, require => { laterHostExport = require(43917); }]);
    const descriptor = Object.getOwnPropertyDescriptor(state.queue, 'push');
    return {
      sameExport: laterHostExport === state.hostExport,
      samePush: state.queue.push === push,
      ordinaryPush: Object.hasOwn(descriptor, 'value') && descriptor.writable && descriptor.configurable && descriptor.enumerable,
      factoryRestored: state.require.m[43917] === state.originalFactory,
      queuedFactoryRestored: state.queue.find(chunk => Object.hasOwn(chunk[1], '43917'))[1][43917] === state.originalFactory,
      factoryExecutions: state.factoryExecutions,
      captures: state.captures,
    };
  });
}

for (const order of ['runtime then module', 'module then runtime']) {
  test(`user captures chart storage before the first host save with ${order}`, async ({ page }) => {
    // Given capture observes an empty global queue before either real host fixture loads.
    await openEmptyStorageLab(page);
    await installEarlyCapture(page);

    // When the real runtime consumes the library chunk and its host requires storage in the same stack.
    if (order === 'runtime then module') {
      await page.addScriptTag({ url: `${STORAGE_LAB_ORIGIN}/webpack-runtime.js` });
      await registerStorageChunk(page);
    } else {
      await registerStorageChunk(page);
      await page.addScriptTag({ url: `${STORAGE_LAB_ORIGIN}/webpack-runtime.js` });
    }
    const result = await page.evaluate(async () => {
      const state = window.__STORAGE_STARTUP__;
      const persisted = state.saved ? await state.saved : null;
      return {
        hostResult: state.hostResult, hostError: state.hostError,
        captures: state.captures, factoryExecutions: state.factoryExecutions,
        completion: state.completion, persisted,
      };
    });

    // Then the first host save already uses the adapter and the actual library factory executes once.
    expect(result).toEqual({
      hostResult: { captures: 1, acceptedBeforeReturn: 1, exportMatches: true },
      hostError: null, captures: 1, factoryExecutions: 1,
      completion: 'fulfilled', persisted: { interval: '15' },
    });

    // When later host work uses the restored queue after successful capture is stopped again.
    const cleanup = await readCaptureCleanup(page);

    // Then no observer accessor or wrapped factory survives and require reuses the existing library export.
    expect(cleanup).toEqual({
      sameExport: true, samePush: true, ordinaryPush: true,
      factoryRestored: true, queuedFactoryRestored: true, factoryExecutions: 1, captures: 1,
    });
  });
}

test('user captures the first chart save when the global chunk queue does not exist yet', async ({ page }) => {
  // Given the empty document has not created a global runtime queue.
  await openEmptyStorageLab(page);
  expect(await page.evaluate(() => Object.hasOwn(self, 'webpackChunkfutures_trade_ui'))).toBe(false);
  await installEarlyCapture(page, { existingQueue: false });

  // When the runtime initializes its queue and the first module chunk immediately requires chart storage.
  await page.addScriptTag({ url: `${STORAGE_LAB_ORIGIN}/webpack-runtime.js` });
  await registerStorageChunk(page);
  const result = await page.evaluate(async () => {
    const state = window.__STORAGE_STARTUP__;
    return { hostResult: state.hostResult, saved: await state.saved, completion: state.completion };
  });

  // Then bootstrap-created registration still captures the exact export before the first save returns.
  expect(result).toEqual({
    hostResult: { captures: 1, acceptedBeforeReturn: 1, exportMatches: true },
    saved: { interval: '15' }, completion: 'fulfilled',
  });
});

for (const stage of ['before scripts', 'before runtime consumes module', 'after runtime registers module']) {
  test(`user stops startup observation ${stage} and keeps native host storage available`, async ({ page }) => {
    // Given capture has not executed the actual library factory at the selected host startup boundary.
    await openEmptyStorageLab(page);
    await installEarlyCapture(page);
    if (stage !== 'before scripts') await registerStorageChunk(page, { requireStorage: false });
    if (stage === 'after runtime registers module') {
      await page.addScriptTag({ url: `${STORAGE_LAB_ORIGIN}/webpack-runtime.js` });
    }
    expect(await page.evaluate(() => window.__STORAGE_STARTUP__.factoryExecutions)).toBe(0);

    // When observation stops and the host completes startup before its first storage use.
    await page.evaluate(() => window.__STORAGE_STARTUP__.capture.stop());
    if (stage !== 'after runtime registers module') {
      await page.addScriptTag({ url: `${STORAGE_LAB_ORIGIN}/webpack-runtime.js` });
    }
    if (stage === 'before scripts') await registerStorageChunk(page, { requireStorage: false });
    const result = await page.evaluate(async () => {
      const state = window.__STORAGE_STARTUP__;
      state.runHost(state.require);
      return {
        completion: state.completion, captureError: state.captureError,
        captures: state.captures, hostError: state.hostError,
        hostResult: state.hostResult, saved: await state.saved,
      };
    });
    const cleanup = await readCaptureCleanup(page);

    // Then only capture rejects while the restored factory executes exactly once and persists the native host save.
    expect(result.completion).toBe('rejected');
    expect(result.captureError).toMatch(/stop.*before.*execution/i);
    expect(result.captures).toBe(0);
    expect(result.hostError).toBe(null);
    expect(result.hostResult).toEqual({ captures: 0, acceptedBeforeReturn: 0, exportMatches: false });
    expect(result.saved).toEqual({ interval: '15' });
    expect(cleanup).toEqual({
      sameExport: true, samePush: true, ordinaryPush: true,
      factoryRestored: true, queuedFactoryRestored: true, factoryExecutions: 1, captures: 0,
    });
  });
}

for (const stage of ['runtime starts', 'module registers']) {
  test(`user receives an explicit late-bootstrap refusal after the ${stage}`, async ({ page }) => {
    // Given one real fixture has started before bootstrap can observe a native empty queue.
    await openEmptyStorageLab(page);
    const first = stage === 'runtime starts' ? 'webpack-runtime.js' : 'localforage-module.js';
    const second = stage === 'runtime starts' ? 'localforage-module.js' : 'webpack-runtime.js';
    await page.addScriptTag({ url: `${STORAGE_LAB_ORIGIN}/${first}` });

    // When bootstrap attempts late installation and the host then completes its unmodified startup.
    const rejection = await page.evaluate(async () => {
      const { observeChartStorageBootstrap } = await import('/bootstrap.js');
      try {
        const capture = observeChartStorageBootstrap();
        capture.captured.catch(error => { window.__LATE_CAPTURE_ERROR__ = error.message; });
        capture.stop();
        return null;
      } catch (error) {
        return error.message;
      }
    });
    await page.addScriptTag({ url: `${STORAGE_LAB_ORIGIN}/${second}` });
    await initializeStorageLab(page, { install: false });
    const identity = await page.evaluate(() => window.__STORAGE_LAB__.cacheIdentity());

    // Then refusal is immediate and the original runtime still executes and caches localForage once.
    expect(rejection).toMatch(/late|before|already|native|empty|runtime/i);
    expect(identity).toEqual({ sameExport: true, factoryExecutions: 1 });
  });
}

test('user retains a working host module when the startup capture callback throws', async ({ page }) => {
  // Given the observer callback will fail after the real library factory creates its export.
  await openEmptyStorageLab(page);
  await installEarlyCapture(page, { callbackFails: true });

  // When the real runtime registers and requires storage in the same host stack.
  await page.addScriptTag({ url: `${STORAGE_LAB_ORIGIN}/webpack-runtime.js` });
  await registerStorageChunk(page);
  const result = await page.evaluate(async () => {
    const state = window.__STORAGE_STARTUP__;
    return {
      saved: await state.saved, hostError: state.hostError,
      completion: state.completion, captureError: state.captureError,
    };
  });
  const cleanup = await readCaptureCleanup(page);

  // Then only the observer rejects and the host retains its successful save and original cache identity.
  expect(result).toEqual({
    saved: { interval: '15' }, hostError: null,
    completion: 'rejected', captureError: 'Startup capture callback failed',
  });
  expect(cleanup).toEqual({
    sameExport: true, samePush: true, ordinaryPush: true,
    factoryRestored: true, queuedFactoryRestored: true, factoryExecutions: 1, captures: 1,
  });
});

test('user retains a queued host module when its null runtime callback ends observation', async ({ page }) => {
  // Given bootstrap creates a previously absent queue before a host chunk with a valid falsy runtime callback.
  await openEmptyStorageLab(page);
  await page.evaluate(async () => {
    const { observeChartStorageBootstrap } = await import('/bootstrap.js');
    const observer = observeChartStorageBootstrap();
    const state = { queue: self.webpackChunkfutures_trade_ui, factoryExecutions: 0, outcome: 'pending' };
    state.originalFactory = module => {
      state.factoryExecutions += 1;
      module.exports = { hostValue: 'retained' };
    };
    state.chunk = [['chart-storage-null-runtime'], { 43917: state.originalFactory }, null];
    observer.captured.then(
      () => { state.outcome = 'fulfilled'; },
      error => { state.outcome = 'rejected'; state.error = error.message; },
    );
    window.__STORAGE_NULL_RUNTIME__ = state;
  });

  // When registration ends observation before the real runtime consumes the exact original queue.
  await page.evaluate(() => {
    const state = window.__STORAGE_NULL_RUNTIME__;
    state.queue.push(state.chunk);
    state.sameQueueAfterAppend = self.webpackChunkfutures_trade_ui === state.queue;
    state.sameChunkAfterAppend = state.queue[0] === state.chunk;
  });
  await page.addScriptTag({ url: `${STORAGE_LAB_ORIGIN}/webpack-runtime.js` });
  const result = await page.evaluate(() => {
    const state = window.__STORAGE_NULL_RUNTIME__;
    let runtimeRequire;
    self.webpackChunkfutures_trade_ui.push([['chart-storage-null-host'], {}, require => { runtimeRequire = require; }]);
    const factoryRetained = runtimeRequire.m[43917] === state.originalFactory;
    const value = factoryRetained ? runtimeRequire(43917) : null;
    return {
      outcome: state.outcome, error: state.error,
      sameQueueAfterAppend: state.sameQueueAfterAppend,
      sameChunkAfterAppend: state.sameChunkAfterAppend,
      sameQueueAfterRuntime: self.webpackChunkfutures_trade_ui === state.queue,
      factoryRetained, factoryExecutions: state.factoryExecutions, value,
    };
  });

  // Then the observer rejects its unsupported shape while the unmodified host factory remains registered and callable.
  expect(result.outcome).toBe('rejected');
  expect(result.error).toMatch(/runtime callback/i);
  expect(result.sameQueueAfterAppend).toBe(true);
  expect(result.sameChunkAfterAppend).toBe(true);
  expect(result.sameQueueAfterRuntime).toBe(true);
  expect(result.factoryRetained).toBe(true);
  expect(result.factoryExecutions).toBe(1);
  expect(result.value).toEqual({ hostValue: 'retained' });
});

test('user saves nested chart JSON created by a same-origin iframe without changing its value', async ({ page }) => {
  // Given the parent owns a real storage facade and an iframe creates the complete chart value in its own realm.
  await openStorageLab(page);
  await page.evaluate(() => {
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const json = '{"symbol":"BTCUSDT","layout":{"panes":[{"id":1,"studies":[{"name":"volume","inputs":[20,true,null]}]}]},"__proto__":{"chart":"own-data"}}';
    window.__STORAGE_FRAME_CHART__ = {
      frame, value: frame.contentWindow.JSON.parse(json), expected: JSON.parse(json),
    };
  });

  // When the iframe value is submitted through create and then read with the parent's native localForage instance.
  const result = await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    const { frame, value, expected } = window.__STORAGE_FRAME_CHART__;
    const foreignPrototype = Object.getPrototypeOf(value);
    const ownPrototype = Object.getPrototypeOf(value.layout);
    const outcomes = await Promise.allSettled([lab.create().setItem('#TV_SYMBOL-IFRAME', value)]);
    const outcome = outcomes[0];
    return {
      differentRealm: foreignPrototype === frame.contentWindow.Object.prototype && foreignPrototype !== Object.prototype,
      status: outcome.status,
      rejection: outcome.status === 'rejected' ? outcome.reason.message : null,
      returned: outcome.status === 'fulfilled' ? outcome.value : null,
      persisted: await lab.native.getItem('#TV_SYMBOL-IFRAME'), expected,
      original: value,
      prototypesPreserved: Object.getPrototypeOf(value) === foreignPrototype && Object.getPrototypeOf(value.layout) === ownPrototype,
      dangerousKeyPreserved: Object.hasOwn(value, '__proto__'),
    };
  });

  // Then the real IndexedDB record preserves all nested JSON and the input keeps its original realm and own properties.
  expect(result.differentRealm).toBe(true);
  expect(result.status).toBe('fulfilled');
  expect(result.rejection).toBe(null);
  expect(result.returned).toEqual(result.expected);
  expect(result.persisted).toEqual(result.expected);
  expect(result.original).toEqual(result.expected);
  expect(result.prototypesPreserved).toBe(true);
  expect(result.dangerousKeyPreserved).toBe(true);
});

test('user keeps the original chart when iframe Date and class values are refused', async ({ page }) => {
  // Given the real database contains a valid chart and iframe values include non-JSON object types.
  await openStorageLab(page);
  await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const realm = frame.contentWindow;
    const ChartModel = realm.eval('(class ChartModel { constructor() { this.interval = "30"; } })');
    const ObjectNamedClass = realm.eval('(class Object { constructor() { this.interval = "60"; } })');
    const forgedPrototype = realm.Object.create(null);
    realm.Object.defineProperty(forgedPrototype, 'constructor', { value: realm.Object });
    const forgedPlainObject = realm.Object.create(forgedPrototype);
    forgedPlainObject.interval = '240';
    const values = [new realm.Date(0), new ChartModel(), new ObjectNamedClass(), new realm.Map([['interval', '15']]), forgedPlainObject];
    lab.invalidCharts = values.map(value => ({ layout: value }));
    lab.invalidChartSnapshots = lab.invalidCharts.map(value => JSON.stringify(value));
    lab.invalidChartPrototypes = values.map(value => Object.getPrototypeOf(value));
    await lab.native.setItem('#TV_SYMBOL-PRESERVED', { interval: '15', studies: ['volume'] });
  });

  // When each invalid nested value attempts to replace the same existing chart through the public facade.
  const result = await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    const store = lab.create();
    const outcomes = await Promise.allSettled(lab.invalidCharts.map(value => store.setItem('#TV_SYMBOL-PRESERVED', value)));
    return {
      outcomes: outcomes.map(outcome => ({
        status: outcome.status, message: outcome.status === 'rejected' ? outcome.reason.message : null,
      })),
      persisted: await lab.native.getItem('#TV_SYMBOL-PRESERVED'),
      originalValuesPreserved: lab.invalidCharts.every((value, index) => (
        JSON.stringify(value) === lab.invalidChartSnapshots[index]
        && Object.getPrototypeOf(value.layout) === lab.invalidChartPrototypes[index]
      )),
    };
  });

  // Then all unsupported values reject explicitly and neither the stored chart nor the caller's objects change.
  expect(result.outcomes.map(outcome => outcome.status)).toEqual(['rejected', 'rejected', 'rejected', 'rejected', 'rejected']);
  for (const outcome of result.outcomes) expect(outcome.message).toMatch(/plain JSON/i);
  expect(result.persisted).toEqual({ interval: '15', studies: ['volume'] });
  expect(result.originalValuesPreserved).toBe(true);
});

test('user observes native chart instance creation through preflight without adding storage work', async ({ page }) => {
  // Given preflight starts before the real runtime without installing a storage adapter.
  await openEmptyStorageLab(page);
  await installStoragePreflight(page);

  // When the first real module chunk creates a chart instance in the same host stack.
  await page.addScriptTag({ url: `${STORAGE_LAB_ORIGIN}/webpack-runtime.js` });
  await registerStorageChunk(page);
  const observed = await page.evaluate(() => {
    const state = window.__STORAGE_STARTUP__;
    return { snapshot: state.snapshotBeforeHostReturns, metrics: window.__STORAGE_NATIVE__.snapshot() };
  });

  // Then preflight records only the native creation and does not open a database or submit storage operations.
  expect(observed.snapshot.outcome).toBe('captured');
  expect(observed.snapshot.active).toBe(true);
  expect(observed.snapshot.instances).toEqual({ chart_futures: 1, chart_delivery: 0 });
  expect(observed.snapshot.captureAtMs).toBeGreaterThanOrEqual(0);
  expect(observed.snapshot.firstInstances).toHaveLength(1);
  expect(observed.snapshot.firstInstances[0]).toEqual({
    name: 'chart_futures', storeName: 'keyvaluepairs', atMs: expect.any(Number),
  });
  expect(observed.snapshot.firstInstances[0].atMs).toBeGreaterThanOrEqual(observed.snapshot.captureAtMs);
  expect(observed.metrics).toMatchObject({ opens: 0, transactions: 0, puts: 0, gets: 0, pending: 0 });

  // When the host initializes its native instances, stops observation, and uses the retained original instance.
  const result = await page.evaluate(async () => {
    const state = window.__STORAGE_STARTUP__;
    const control = state.nativeFactoryBeforeCapture.call(state.hostExport, { name: 'chart_futures' });
    await Promise.all([state.store.ready(), control.ready()]);
    const methodsAreNative = state.store.getItem === control.getItem && state.store.setItem === control.setItem;
    const getItem = state.store.getItem;
    const setItem = state.store.setItem;
    window.__STORAGE_NATIVE__.reset();
    state.preflight.stop();
    const metricsAfterStop = window.__STORAGE_NATIVE__.snapshot();
    const written = await state.store.setItem('#TV_SYMBOL-PREFLIGHT', { interval: '15', studies: ['volume'] });
    const read = await state.store.getItem('#TV_SYMBOL-PREFLIGHT');
    const metrics = window.__STORAGE_NATIVE__.snapshot();
    return {
      methodsAreNative,
      methodsRetained: state.store.getItem === getItem && state.store.setItem === setItem,
      factoryRestored: state.hostExport.createInstance === state.nativeFactoryBeforeCapture,
      factoryExecutions: state.factoryExecutions,
      sameExport: state.require(43917) === state.hostExport,
      metricsAfterStop, metrics, written, read, snapshot: state.preflight.snapshot(),
    };
  });

  // Then stopping restores the exact factory while the unwrapped retained instance performs one native write and one read.
  expect(result.methodsAreNative).toBe(true);
  expect(result.methodsRetained).toBe(true);
  expect(result.factoryRestored).toBe(true);
  expect(result.factoryExecutions).toBe(1);
  expect(result.sameExport).toBe(true);
  expect(result.metricsAfterStop).toMatchObject({ opens: 0, transactions: 0, puts: 0, gets: 0, pending: 0 });
  expect(result.metrics).toMatchObject({ opens: 0, transactions: 2, puts: 1, gets: 1 });
  expect(result.written).toEqual({ interval: '15', studies: ['volume'] });
  expect(result.read).toEqual(result.written);
  expect(result.snapshot.active).toBe(false);
  expect(result.snapshot.instances).toEqual({ chart_futures: 1, chart_delivery: 0 });
});

test('user has preflight restore the native factory automatically after thirty seconds', async ({ page }) => {
  // Given a paused virtual clock owns the preflight lifetime before any real host fixture loads.
  await installScenarioClock(page);
  await openEmptyStorageLab(page);
  await pauseScenarioClock(page);
  await installStoragePreflight(page);
  await page.addScriptTag({ url: `${STORAGE_LAB_ORIGIN}/webpack-runtime.js` });
  await registerStorageChunk(page);

  // When the clock reaches the instant immediately before the bounded observation ends.
  await page.clock.runFor(29_999);
  const beforeDeadline = await page.evaluate(() => {
    const state = window.__STORAGE_STARTUP__;
    return {
      active: state.preflight.snapshot().active,
      factoryRestored: state.hostExport.createInstance === state.nativeFactoryBeforeCapture,
    };
  });

  // Then the observer remains active throughout the authorized observation window.
  expect(beforeDeadline).toEqual({ active: true, factoryRestored: false });

  // When the deadline arrives and the host creates another native instance after automatic cleanup.
  await page.clock.runFor(1);
  const afterDeadline = await page.evaluate(() => {
    const state = window.__STORAGE_STARTUP__;
    state.hostExport.createInstance({ name: 'chart_delivery' });
    const descriptor = Object.getOwnPropertyDescriptor(state.queue, 'push');
    return {
      snapshot: state.preflight.snapshot(),
      factoryRestored: state.hostExport.createInstance === state.nativeFactoryBeforeCapture,
      ordinaryPush: Object.hasOwn(descriptor, 'value') && descriptor.writable && descriptor.configurable,
      moduleFactoryRestored: state.require.m[43917] === state.originalFactory,
      factoryExecutions: state.factoryExecutions,
      metrics: window.__STORAGE_NATIVE__.snapshot(),
    };
  });

  // Then all observation hooks are restored at thirty seconds and later native creation is neither counted nor accessed.
  expect(afterDeadline.snapshot).toMatchObject({
    outcome: 'captured', active: false, instances: { chart_futures: 1, chart_delivery: 0 },
  });
  expect(afterDeadline.snapshot.firstInstances).toHaveLength(1);
  expect(afterDeadline.factoryRestored).toBe(true);
  expect(afterDeadline.ordinaryPush).toBe(true);
  expect(afterDeadline.moduleFactoryRestored).toBe(true);
  expect(afterDeadline.factoryExecutions).toBe(1);
  expect(afterDeadline.metrics).toMatchObject({ opens: 0, transactions: 0, puts: 0, gets: 0, pending: 0 });
});
