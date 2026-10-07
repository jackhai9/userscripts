import { test, expect } from '../test.js';
import { openStorageLab } from '../helpers/chart-storage-lab.js';

/** Real request events retain the write lock until the scenario releases it. */
async function holdChartWriteLock(page) {
  await page.evaluate(() => {
    const transaction = window.__STORAGE_LAB__.native._dbInfo.db.transaction('keyvaluepairs', 'readwrite');
    const store = transaction.objectStore('keyvaluepairs');
    const pulses = [];
    const lock = {
      released: false,
      progress: () => new Promise(resolve => pulses.push(resolve)),
      completion: new Promise((resolve, reject) => {
        transaction.addEventListener('complete', () => resolve('complete'), { once: true });
        transaction.addEventListener('abort', () => reject(transaction.error), { once: true });
      }),
    };
    function hold() {
      const request = store.get('#TV_SYMBOL-STOP');
      request.onsuccess = () => {
        for (const resolve of pulses.splice(0)) resolve();
        if (!lock.released) hold();
      };
    }
    window.__STORAGE_STOP_LOCK__ = lock;
    hold();
  });
  await page.evaluate(() => window.__STORAGE_STOP_LOCK__.progress());
}

async function releaseChartWriteLock(page) {
  await page.evaluate(async () => {
    const lock = window.__STORAGE_STOP_LOCK__;
    lock.released = true;
    await lock.completion;
  });
}

test('user preserves accepted writes before retained and newly created stores resume native saves', async ({ page, browser }) => {
  // Given an independent native baseline and an actual lock blocking the accepted chart batch.
  const nativeContext = await browser.newContext();
  let nativeBaseline;
  try {
    const nativePage = await nativeContext.newPage();
    await openStorageLab(nativePage, { install: false });
    nativeBaseline = await nativePage.evaluate(async () => {
      const lab = window.__STORAGE_LAB__;
      await lab.native.setItem('#TV_SYMBOL-STOP', 1);
      const retained = lab.create();
      await retained.ready();
      const fresh = lab.create();
      const callbacks = [];
      const callback = id => (error, value) => callbacks.push({ id, error: error === null, value });
      const tail = await Promise.allSettled([
        retained.getItem('#TV_SYMBOL-STOP', callback('retained-read')),
        retained.setItem('#TV_SYMBOL-RETAINED', 2, callback('retained-write')),
        fresh.setItem('#TV_SYMBOL-STOP', 3, callback('fresh-write')),
        fresh.getItem('#TV_SYMBOL-STOP', callback('fresh-read')),
      ]);
      return { tail, callbacks, finalValue: await lab.native.getItem('#TV_SYMBOL-STOP') };
    });
  } finally {
    await nativeContext.close();
  }
  await openStorageLab(page);
  await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    await lab.native.setItem('#TV_SYMBOL-STOP', 0);
    lab.store = lab.create();
    await lab.store.ready();
  });
  await holdChartWriteLock(page);
  await page.evaluate(() => {
    const lab = window.__STORAGE_LAB__;
    window.__STORAGE_NATIVE__.reset();
    lab.accepted = Promise.all([
      lab.store.setItem('#TV_SYMBOL-STOP', 1), lab.store.getItem('#TV_SYMBOL-STOP'),
    ]);
  });
  await expect.poll(() => page.evaluate(() => window.__STORAGE_NATIVE__.snapshot().pending)).toBe(1);

  // When stop and calls through both retained and new stores occur in the same stack.
  let beforeRelease;
  try {
    beforeRelease = await page.evaluate(async () => {
      const lab = window.__STORAGE_LAB__;
      lab.stopResolved = false;
      lab.stopping = lab.controller.stop();
      lab.stopping.then(() => { lab.stopResolved = true; });
      lab.callbacks = [];
      const callback = id => (error, value) => lab.callbacks.push({ id, error: error === null, value });
      const fresh = lab.create();
      lab.nativeTail = Promise.allSettled([
        lab.store.getItem('#TV_SYMBOL-STOP', callback('retained-read')),
        lab.store.setItem('#TV_SYMBOL-RETAINED', 2, callback('retained-write')),
        fresh.setItem('#TV_SYMBOL-STOP', 3, callback('fresh-write')),
        fresh.getItem('#TV_SYMBOL-STOP', callback('fresh-read')),
      ]);
      lab.readyCallbacks = [];
      lab.nativeReady = lab.store.ready((...args) => { lab.readyCallbacks.push(args); });
      let configError;
      try {
        lab.store.config({ description: 'Cannot mutate during drain' });
      } catch (error) {
        configError = error.message;
      }
      await window.__STORAGE_STOP_LOCK__.progress();
      return {
        stopResolved: lab.stopResolved,
        restoredFactory: lab.localforage.createInstance === lab.nativeCreateInstance,
        callbacks: [...lab.callbacks],
        acceptedOperations: lab.controller.getStats().acceptedOperations,
        pendingOperations: lab.controller.getStats().pendingOperations,
        transactions: window.__STORAGE_NATIVE__.snapshot().transactions,
        readyCallbacks: [...lab.readyCallbacks],
        configName: lab.store.config('name'), driver: lab.store.driver(), configError,
      };
    });
  } finally {
    await releaseChartWriteLock(page);
  }
  const result = await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    const accepted = await lab.accepted;
    await lab.stopping;
    const tail = await lab.nativeTail;
    await lab.nativeReady;
    return {
      accepted, tail, callbacks: lab.callbacks, stats: lab.controller.getStats(),
      readyCallbacks: lab.readyCallbacks,
      restoredFactory: lab.localforage.createInstance === lab.nativeCreateInstance,
      finalValue: await lab.native.getItem('#TV_SYMBOL-STOP'),
      retainedValue: await lab.native.getItem('#TV_SYMBOL-RETAINED'),
    };
  });

  // Then only accepted work crosses the lock and every later call completes after its drain fence.
  expect(beforeRelease).toEqual({
    stopResolved: false, restoredFactory: false, callbacks: [],
    acceptedOperations: 2, pendingOperations: 2, transactions: 1,
    readyCallbacks: [], configName: 'chart_futures', driver: 'asyncStorage',
    configError: 'Managed chart configuration is immutable',
  });
  expect(result.accepted).toEqual([1, 1]);
  // Native setItem prepares its value in an extra Promise stage, so a same-stack read can precede it.
  expect(nativeBaseline.tail).toEqual([1, 2, 3, 1].map(value => ({ status: 'fulfilled', value })));
  expect(nativeBaseline.finalValue).toBe(3);
  expect(result.tail).toEqual(nativeBaseline.tail);
  expect(result.callbacks).toEqual(nativeBaseline.callbacks);
  expect(result.readyCallbacks).toEqual([[undefined]]);
  expect(result.finalValue).toBe(3);
  expect(result.retainedValue).toBe(2);
  expect(result.restoredFactory).toBe(true);
  expect(result.stats).toMatchObject({ acceptedOperations: 2, rejectedOperations: 0, pendingOperations: 0, pendingBytes: 0 });
});

test('user preserves a replacement factory when ownership changes while accepted writes drain', async ({ page }) => {
  // Given an accepted write waits behind a real native transaction lock.
  await openStorageLab(page);
  await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    await lab.native.setItem('#TV_SYMBOL-OWNERSHIP', 0);
    lab.store = lab.create();
    await lab.store.ready();
  });
  await holdChartWriteLock(page);
  await page.evaluate(() => {
    const lab = window.__STORAGE_LAB__;
    window.__STORAGE_NATIVE__.reset();
    lab.accepted = lab.store.setItem('#TV_SYMBOL-OWNERSHIP', 1);
  });
  await expect.poll(() => page.evaluate(() => window.__STORAGE_NATIVE__.snapshot().pending)).toBe(1);

  // When another owner replaces the factory after stop starts and before the write commits.
  let whileLocked;
  try {
    whileLocked = await page.evaluate(async () => {
      const lab = window.__STORAGE_LAB__;
      lab.stopSettled = false;
      lab.stopped = Promise.allSettled([lab.controller.stop()]).then(outcomes => {
        lab.stopSettled = true;
        return outcomes;
      });
      lab.replacementFactory = function (...args) {
        return Reflect.apply(lab.nativeCreateInstance, lab.localforage, args);
      };
      Object.defineProperty(lab.localforage, 'createInstance', {
        value: lab.replacementFactory, enumerable: false, writable: true, configurable: true,
      });
      await window.__STORAGE_STOP_LOCK__.progress();
      return { stopSettled: lab.stopSettled, pendingOperations: lab.controller.getStats().pendingOperations };
    });
  } finally {
    await releaseChartWriteLock(page);
  }
  const result = await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    const accepted = await lab.accepted;
    const [stopped] = await lab.stopped;
    const descriptor = Object.getOwnPropertyDescriptor(lab.localforage, 'createInstance');
    return {
      accepted, stopStatus: stopped.status, stopError: stopped.reason.message,
      replacementPreserved: descriptor.value === lab.replacementFactory,
      descriptor: { enumerable: descriptor.enumerable, writable: descriptor.writable, configurable: descriptor.configurable },
      persisted: await lab.native.getItem('#TV_SYMBOL-OWNERSHIP'), stats: lab.controller.getStats(),
    };
  });

  // Then the accepted write commits and stop refuses to overwrite the other owner's exact descriptor.
  expect(whileLocked).toEqual({ stopSettled: false, pendingOperations: 1 });
  expect(result.accepted).toBe(1);
  expect(result.persisted).toBe(1);
  expect(result.stopStatus).toBe('rejected');
  expect(result.stopError).toMatch(/ownership/i);
  expect(result.replacementPreserved).toBe(true);
  expect(result.descriptor).toEqual({ enumerable: false, writable: true, configurable: true });
  expect(result.stats).toMatchObject({ acceptedOperations: 1, failedOperations: 0, pendingOperations: 0, pendingBytes: 0 });
});

test('user drains saves awaiting a blocked native database upgrade before restoring the factory', async ({ page }) => {
  // Given an external version-one connection will block the real library's version-two initialization.
  await openStorageLab(page);
  await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('chart_futures', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('keyvaluepairs');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const nativeOpen = IDBFactory.prototype.open;
    let blocked;
    let opened;
    const gate = {
      database, nativeOpen,
      blocked: new Promise(resolve => { blocked = resolve; }),
      opened: new Promise(resolve => { opened = resolve; }),
    };
    /** Observe the native upgrade request without replacing its initialization or event behavior. */
    IDBFactory.prototype.open = function (...args) {
      const request = Reflect.apply(nativeOpen, this, args);
      if (args[0] === 'chart_futures' && args[1] === 2) {
        request.addEventListener('blocked', event => {
          blocked({ oldVersion: event.oldVersion, newVersion: event.newVersion });
        }, { once: true });
        request.addEventListener('success', () => opened(request.result.version), { once: true });
      }
      return request;
    };
    window.__STORAGE_INITIALIZATION_GATE__ = gate;
    window.__STORAGE_NATIVE__.reset();
    const lab = window.__STORAGE_LAB__;
    lab.store = lab.create('chart_futures', { version: 2 });
    lab.accepted = Promise.all([
      lab.store.setItem('#TV_SYMBOL-INITIALIZING', 1), lab.store.getItem('#TV_SYMBOL-INITIALIZING'),
    ]);
  });

  // When stop and new managed calls occur while IndexedDB explicitly reports the initialization blocked.
  let blockedState;
  try {
    blockedState = await page.evaluate(async () => {
      const lab = window.__STORAGE_LAB__;
      const versionEvent = await window.__STORAGE_INITIALIZATION_GATE__.blocked;
      lab.stopResolved = false;
      lab.stopping = lab.controller.stop();
      lab.stopping.then(() => { lab.stopResolved = true; });
      lab.callbacks = [];
      const callback = id => (error, value) => lab.callbacks.push({ id, error: error === null, value });
      const fresh = lab.create('chart_futures', { version: 2 });
      lab.tail = Promise.all([
        lab.store.getItem('#TV_SYMBOL-INITIALIZING', callback('retained-read')),
        fresh.setItem('#TV_SYMBOL-INITIALIZING', 3, callback('fresh-write')),
      ]);
      await Promise.resolve();
      return {
        versionEvent, stopResolved: lab.stopResolved, callbacks: [...lab.callbacks],
        restoredFactory: lab.localforage.createInstance === lab.nativeCreateInstance,
        acceptedOperations: lab.controller.getStats().acceptedOperations,
        pendingOperations: lab.controller.getStats().pendingOperations,
        transactions: window.__STORAGE_NATIVE__.snapshot().transactions,
      };
    });
  } finally {
    await page.evaluate(async () => {
      const gate = window.__STORAGE_INITIALIZATION_GATE__;
      IDBFactory.prototype.open = gate.nativeOpen;
      gate.database.close();
      await gate.opened;
    });
  }
  const result = await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    const accepted = await lab.accepted;
    await lab.stopping;
    const tail = await lab.tail;
    return {
      accepted, tail, callbacks: lab.callbacks,
      restoredFactory: lab.localforage.createInstance === lab.nativeCreateInstance,
      persisted: await lab.store.getItem('#TV_SYMBOL-INITIALIZING'), stats: lab.controller.getStats(),
    };
  });

  // Then factory restoration waits for initialization and accepted commits before native calls resume.
  expect(blockedState).toEqual({
    versionEvent: { oldVersion: 1, newVersion: 2 },
    stopResolved: false, callbacks: [], restoredFactory: false,
    acceptedOperations: 2, pendingOperations: 2, transactions: 0,
  });
  expect(result.accepted).toEqual([1, 1]);
  expect(result.tail).toEqual([1, 3]);
  expect(result.callbacks).toEqual([
    { id: 'retained-read', error: true, value: 1 }, { id: 'fresh-write', error: true, value: 3 },
  ]);
  expect(result.restoredFactory).toBe(true);
  expect(result.persisted).toBe(3);
  expect(result.stats).toMatchObject({ acceptedOperations: 2, pendingOperations: 0, pendingBytes: 0 });
});

test('user rejects a save when synchronous value inspection stops admission before enqueue', async ({ page }) => {
  // Given a ready store has no accepted work when a transparent Proxy invokes stop during inspection.
  await openStorageLab(page);
  await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    lab.store = lab.create();
    await lab.store.ready();
    window.__STORAGE_NATIVE__.reset();
  });

  // When value validation synchronously stops the controller before the save can enter its queue.
  const result = await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    let stopping;
    let inspections = 0;
    const value = new Proxy({ revision: 1 }, {
      getPrototypeOf(target) {
        inspections += 1;
        stopping = lab.controller.stop();
        return Reflect.getPrototypeOf(target);
      },
    });
    const callbacks = [];
    const [outcome] = await Promise.allSettled([
      lab.store.setItem('#TV_SYMBOL-ADMISSION', value, (error, saved) => {
        callbacks.push({ message: error?.message, value: saved });
      }),
    ]);
    await stopping;
    return {
      status: outcome.status, message: outcome.reason?.message, callbacks, inspections,
      restoredFactory: lab.localforage.createInstance === lab.nativeCreateInstance,
      stats: lab.controller.getStats(), metrics: window.__STORAGE_NATIVE__.snapshot(),
      persisted: await lab.native.getItem('#TV_SYMBOL-ADMISSION'),
    };
  });

  // Then the stopped admission rejects once without queuing or replaying the inspected value.
  expect(result.inspections).toBeGreaterThan(0);
  expect(result.status).toBe('rejected');
  expect(result.message).toMatch(/stopped|active|admission/i);
  expect(result.callbacks).toEqual([{ message: result.message, value: undefined }]);
  expect(result.restoredFactory).toBe(true);
  expect(result.stats).toMatchObject({ acceptedOperations: 0, rejectedOperations: 1, pendingOperations: 0, pendingBytes: 0 });
  expect(result.metrics).toMatchObject({ puts: 0, transactions: 0 });
  expect(result.persisted).toBe(null);
});

test('user can stop from a save callback and continue saving without blocking the remaining accepted batches', async ({ page }) => {
  // Given each accepted write uses its own real transaction and a ready retained store.
  await openStorageLab(page, { options: { maxBatchOperations: 1 } });
  await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    lab.store = lab.create();
    await lab.store.ready();
    window.__STORAGE_NATIVE__.reset();
  });

  // When the first callback stops optimization and immediately saves through the retained instance.
  const result = await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    const callbacks = [];
    let stopping;
    let resumed;
    const accepted = await Promise.all([1, 2, 3].map(value => lab.store.setItem('#TV_SYMBOL-REENTRANT', value, (error, actual) => {
      callbacks.push({ phase: 'accepted', error: error === null, value: actual });
      if (value === 1) {
        stopping = lab.controller.stop();
        resumed = Promise.allSettled([
          lab.store.setItem('#TV_SYMBOL-REENTRANT', 4, (failure, saved) => {
            callbacks.push({ phase: 'native', error: failure === null, value: saved });
          }),
        ]);
      }
    })));
    await stopping;
    const tail = await resumed;
    return {
      accepted, tail, callbacks, stats: lab.controller.getStats(),
      persisted: await lab.native.getItem('#TV_SYMBOL-REENTRANT'),
      metrics: window.__STORAGE_NATIVE__.snapshot(),
    };
  });

  // Then all accepted callbacks settle and the native continuation saves the final revision once.
  expect(result.accepted).toEqual([1, 2, 3]);
  expect(result.tail).toEqual([{ status: 'fulfilled', value: 4 }]);
  expect(result.callbacks).toEqual([
    { phase: 'accepted', error: true, value: 1 },
    { phase: 'accepted', error: true, value: 2 },
    { phase: 'accepted', error: true, value: 3 },
    { phase: 'native', error: true, value: 4 },
  ]);
  expect(result.persisted).toBe(4);
  expect(result.metrics.puts).toBe(4);
  expect(result.stats).toMatchObject({ acceptedOperations: 3, failedOperations: 0, pendingOperations: 0 });
});

test('user receives every aborted batch callback and resumes native storage after stop without retrying failed puts', async ({ page }) => {
  // Given committed chart values and the next real put aborts its native transaction.
  await openStorageLab(page);
  await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    await Promise.all(['A', 'B'].map(key => lab.native.setItem(`#TV_SYMBOL-${key}`, 1)));
    lab.store = lab.create();
    await lab.store.ready();
    window.__STORAGE_NATIVE__.reset();
    window.__STORAGE_NATIVE__.abortNextPut();
  });

  // When stop drains an aborting batch and the retained store immediately queues a native continuation.
  const result = await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    const callbacks = [];
    const callback = id => (error, value) => callbacks.push({ id, name: error?.name, value });
    const accepted = Promise.allSettled([
      lab.store.setItem('#TV_SYMBOL-A', 2, callback('write-A')),
      lab.store.setItem('#TV_SYMBOL-B', 2, callback('write-B')),
      lab.store.getItem('#TV_SYMBOL-A', callback('read-A')),
    ]);
    const stopping = lab.controller.stop();
    const tail = Promise.allSettled([lab.store.setItem('#TV_SYMBOL-NATIVE', 3, callback('native'))]);
    const outcomes = await accepted;
    await stopping;
    const resumed = await tail;
    return {
      statuses: outcomes.map(value => value.status), names: outcomes.map(value => value.reason.name),
      resumed, callbacks, stats: lab.controller.getStats(), metrics: window.__STORAGE_NATIVE__.snapshot(),
      persisted: await Promise.all(['A', 'B', 'NATIVE'].map(key => lab.native.getItem(`#TV_SYMBOL-${key}`))),
    };
  });

  // Then each failed call is notified once and only the successful native continuation changes storage.
  expect(result.statuses).toEqual(['rejected', 'rejected', 'rejected']);
  expect(result.names).toEqual(['AbortError', 'AbortError', 'AbortError']);
  expect(result.resumed).toEqual([{ status: 'fulfilled', value: 3 }]);
  expect(result.callbacks).toEqual([
    { id: 'write-A', name: 'AbortError', value: undefined },
    { id: 'write-B', name: 'AbortError', value: undefined },
    { id: 'read-A', name: 'AbortError', value: undefined },
    { id: 'native', name: undefined, value: 3 },
  ]);
  expect(result.persisted).toEqual([1, 1, 3]);
  expect(result.metrics).toMatchObject({ puts: 2, aborted: 1, pending: 0 });
  expect(result.stats).toMatchObject({ acceptedOperations: 3, failedOperations: 3, pendingOperations: 0, pendingBytes: 0 });
});

test('user keeps native callbacks configuration and Blob storage through an existing facade after stop', async ({ page }) => {
  // Given an unused managed facade survives stopping before it initializes a database.
  await openStorageLab(page);
  await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    lab.store = lab.create();
    await lab.controller.stop();
  });

  // When the retained instance configures and uses the original native storage API.
  const result = await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    const store = lab.store;
    const configured = store.config({ description: 'Native storage after stop' });
    const configuration = store.config();
    let readyArgs;
    await store.ready((...args) => { readyArgs = args; });
    const blob = new Blob(['native chart payload'], { type: 'text/plain' });
    let savedCallback;
    const saved = await store.setItem('#TV_SYMBOL-BLOB', blob, (error, value) => {
      savedCallback = { error: error === null, sameBlob: value === blob };
    });
    const restored = await store.getItem('#TV_SYMBOL-BLOB');
    await store.setItem('native-number', 7);
    const keys = await store.keys();
    const length = await store.length();
    const firstKey = await store.key(0);
    const driver = await store.getDriver(store.driver());
    const entries = [];
    await store.iterate((value, key) => { entries.push({ key, blob: value instanceof Blob }); });
    await store.removeItem('native-number');
    const removed = await store.getItem('native-number');
    await store.clear();
    return {
      configured, description: configuration.description, configIdentity: store.config() === configuration,
      readyArgs, driver: store.driver(), driverMatches: driver._driver === lab.localforage.INDEXEDDB,
      savedIsBlob: saved === blob, savedCallback,
      restoredBlob: { type: restored.type, content: await restored.text(), isBlob: restored instanceof Blob },
      keys, length, firstKey, entries, removed, remaining: await store.keys(), stats: lab.controller.getStats(),
    };
  });

  // Then callbacks retain native signatures and unrestricted native values and methods remain usable.
  expect(result.configured).toBe(true);
  expect(result.description).toBe('Native storage after stop');
  expect(result.configIdentity).toBe(true);
  expect(result.readyArgs).toEqual([undefined]);
  expect(result.driver).toBe('asyncStorage');
  expect(result.driverMatches).toBe(true);
  expect(result.savedIsBlob).toBe(true);
  expect(result.savedCallback).toEqual({ error: true, sameBlob: true });
  expect(result.restoredBlob).toEqual({ type: 'text/plain', content: 'native chart payload', isBlob: true });
  expect(result.keys).toEqual(['#TV_SYMBOL-BLOB', 'native-number']);
  expect(result.length).toBe(2);
  expect(result.firstKey).toBe('#TV_SYMBOL-BLOB');
  expect(result.entries).toEqual([{ key: '#TV_SYMBOL-BLOB', blob: true }, { key: 'native-number', blob: false }]);
  expect(result.removed).toBe(null);
  expect(result.remaining).toEqual([]);
  expect(result.stats).toMatchObject({ acceptedOperations: 0, rejectedOperations: 0, transactions: 0 });
});

for (const placement of ['inherited', 'own']) {
  test(`user restores the exact ${placement} factory descriptor and cannot reinstall until reload`, async ({ page }) => {
    // Given the actual library has either its inherited factory or an explicit own descriptor.
    await openStorageLab(page, { install: false });
    await page.evaluate(placement => {
      const lab = window.__STORAGE_LAB__;
      if (placement === 'own') {
        Object.defineProperty(lab.localforage, 'createInstance', {
          value: lab.nativeCreateInstance, writable: true, enumerable: false, configurable: true,
        });
      }
      lab.originalDescriptor = Object.getOwnPropertyDescriptor(lab.localforage, 'createInstance');
    }, placement);

    // When the prototype stops repeatedly and a caller attempts to install it again on the same export.
    const result = await page.evaluate(async () => {
      const lab = window.__STORAGE_LAB__;
      const { installChartStoragePrototype } = await import('/adapter.js');
      const controller = installChartStoragePrototype(lab.localforage);
      const retainedFactory = lab.localforage.createInstance;
      const stopping = controller.stop();
      const samePendingStop = controller.stop() === stopping;
      await stopping;
      const sameCompletedStop = controller.stop() === stopping;
      const restoredDescriptor = Object.getOwnPropertyDescriptor(lab.localforage, 'createInstance');
      const descriptorMatches = lab.originalDescriptor === undefined
        ? restoredDescriptor === undefined
        : Object.keys(lab.originalDescriptor).every(key => restoredDescriptor[key] === lab.originalDescriptor[key]);
      const restoredFactory = lab.localforage.createInstance === lab.nativeCreateInstance;
      let reinstallError;
      try {
        const reinstalled = installChartStoragePrototype(lab.localforage);
        await reinstalled.stop();
      } catch (error) {
        reinstallError = error.message;
      }
      let retainedFactoryOutcome;
      try {
        const fresh = retainedFactory({ name: 'chart_futures', storeName: 'keyvaluepairs', driver: lab.localforage.INDEXEDDB });
        retainedFactoryOutcome = { status: 'fulfilled', value: await fresh.setItem('#TV_SYMBOL-FACTORY', 5) };
      } catch (error) {
        retainedFactoryOutcome = { status: 'rejected', message: error.message };
      }
      return {
        samePendingStop, sameCompletedStop, descriptorMatches, restoredFactory, reinstallError, retainedFactoryOutcome,
        originallyOwn: lab.originalDescriptor !== undefined, restoredOwn: restoredDescriptor !== undefined,
      };
    });

    // Then stop is idempotent, restores property ownership exactly, and retained factories stay native.
    expect(result.samePendingStop).toBe(true);
    expect(result.sameCompletedStop).toBe(true);
    expect(result.descriptorMatches).toBe(true);
    expect(result.restoredFactory).toBe(true);
    expect(result.originallyOwn).toBe(placement === 'own');
    expect(result.restoredOwn).toBe(placement === 'own');
    expect(result.reinstallError).toMatch(/already|reload|install/i);
    expect(result.retainedFactoryOutcome).toEqual({ status: 'fulfilled', value: 5 });
  });
}
