import { test, expect } from '../test.js';
import { writeFile } from 'node:fs/promises';
import { openStorageLab, openStorageRuntime, initializeStorageLab, displayStorageResult, STORAGE_LAB_ORIGIN } from '../helpers/chart-storage-lab.js';

test('user repeats 290 historical chart saves with bounded transactions and no unchanged writes', async ({ page }, testInfo) => {
  // Given the actual fixture library has persisted 290 synthetic historical chart records.
  await openStorageLab(page, { install: process.env.STORAGE_PROTOTYPE_BASELINE !== '1' });
  await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    lab.records = Array.from({ length: 290 }, (_, index) => ({
      key: `#TV_SYMBOL-LAB${index}USDT`,
      value: { symbol: `LAB${index}USDT`, interval: '15', studies: [{ name: 'volume', inputs: [20, true] }] },
    }));
    await Promise.all(lab.records.map(({ key, value }) => lab.native.setItem(key, value)));
    lab.store = lab.create();
    await lab.store.ready();
    window.__STORAGE_NATIVE__.reset();
  });

  // When eight complete save rounds read and write the same chart state through Promise and callback APIs.
  const result = await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    const callbacks = [];
    const values = [];
    for (let round = 0; round < 8; round += 1) {
      values.push(await Promise.all(lab.records.map(async ({ key, value }, index) => {
        const callback = kind => (error, actual) => {
          callbacks.push({ id: `${round}:${index}:${kind}`, error: error === null, value: actual });
        };
        const read = await lab.store.getItem(key, callback('get'));
        const written = await lab.store.setItem(key, read, callback('set'));
        return { readMatches: JSON.stringify(read) === JSON.stringify(value), writeMatches: JSON.stringify(written) === JSON.stringify(value) };
      })));
    }
    const metrics = window.__STORAGE_NATIVE__.snapshot();
    const stats = lab.controller ? lab.controller.getStats() : null;
    const persisted = await Promise.all(lab.records.map(({ key }) => lab.native.getItem(key)));
    return {
      metrics, stats, identity: lab.cacheIdentity(),
      valuesMatch: values.flat().every(value => value.readMatches && value.writeMatches),
      callbackCount: callbacks.length,
      uniqueCallbacks: new Set(callbacks.map(({ id }) => id)).size,
      callbackValuesMatch: callbacks.every(({ id, error, value }) => error
        && JSON.stringify(value) === JSON.stringify(lab.records[Number(id.split(':')[1])].value)),
      persistedMatches: persisted.every((value, index) => JSON.stringify(value) === JSON.stringify(lab.records[index].value)),
    };
  });
  await displayStorageResult(page, result);
  const measurementPath = testInfo.outputPath('storage-measurement.json');
  await writeFile(measurementPath, JSON.stringify(result, null, 2));
  await testInfo.attach('storage-measurement.json', { path: measurementPath, contentType: 'application/json' });
  const screenshotPath = testInfo.outputPath('storage-lab.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach('storage-lab.png', { path: screenshotPath, contentType: 'image/png' });

  // Then every value and callback is preserved while actual database work remains bounded.
  expect(result.identity).toEqual({ sameExport: true, factoryExecutions: 1 });
  expect(result.valuesMatch).toBe(true);
  expect(result.persistedMatches).toBe(true);
  expect(result.callbackCount).toBe(290 * 8 * 2);
  expect(result.uniqueCallbacks).toBe(290 * 8 * 2);
  expect(result.callbackValuesMatch).toBe(true);
  expect(result.metrics.transactions).toBeLessThanOrEqual(32);
  expect(result.metrics.puts).toBe(0);
});

test('user captures the first registered storage export without executing its factory twice', async ({ page }) => {
  // Given the observer is installed between the real runtime and first module registration.
  await openStorageLab(page, { capture: true });

  // When the host requires the module and the observer delivers the captured export.
  const result = await page.evaluate(async () => ({
    capturedSameExport: await window.__STORAGE_CAPTURE__.captured === window.__STORAGE_LAB__.localforage,
    pushRestored: self.webpackChunkfutures_trade_ui.push === window.__STORAGE_CAPTURE_ORIGINAL_PUSH__,
    identity: window.__STORAGE_LAB__.cacheIdentity(),
  }));

  // Then capture shares the host's exact export and real runtime cache identity.
  expect(result).toEqual({ capturedSameExport: true, pushRestored: true, identity: { sameExport: true, factoryExecutions: 1 } });
});

test('user receives an explicit refusal when module capture starts after registration', async ({ page }) => {
  // Given the real storage module is already registered and required by the host.
  await openStorageLab(page);

  // When a new observer attempts to capture the existing module.
  const result = await page.evaluate(async () => {
    const { observeChartStorageModule } = await import('/capture.js');
    try {
      const observer = observeChartStorageModule();
      await observer.captured;
      return { rejected: false };
    } catch (error) {
      return { rejected: true, message: error.message, identity: window.__STORAGE_LAB__.cacheIdentity() };
    }
  });

  // Then the unavailable capture fails explicitly without re-executing the host factory.
  expect(result.rejected).toBe(true);
  expect(result.message).toMatch(/already|late|registered/i);
  expect(result.identity).toEqual({ sameExport: true, factoryExecutions: 1 });
});

test('user preserves cross-instance call order before readiness and native non-target storage', async ({ page }) => {
  // Given fresh futures and delivery instances have not initialized their real databases.
  await openStorageLab(page);

  // When callers issue interleaved operations before ready and another database stores a native Blob.
  const result = await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    const first = lab.create();
    const second = first.createInstance({ name: 'chart_futures', storeName: 'keyvaluepairs', driver: lab.localforage.INDEXEDDB });
    const setter = first.setItem;
    const delivery = lab.create('chart_delivery');
    const key = '#TV_SYMBOL-ORDER';
    const sequence = await Promise.all([
      first.setItem(key, { value: 'first' }),
      second.getItem(key),
      second.setItem(key, { value: 'second' }),
      first.getItem(key),
      delivery.setItem(key, { value: 'delivery' }),
    ]);
    await first.ready();
    const other = lab.create('chart_other');
    const blob = new Blob(['native-binary'], { type: 'text/plain' });
    await other.setItem(key, blob);
    const binary = await other.getItem(key);
    return {
      sequence, wrapperPreserved: setter === first.setItem,
      delivery: await delivery.getItem(key), nativeBlobText: await binary.text(), nativeBlobType: binary.type,
    };
  });

  // Then shared-store operations retain issue order while delivery and native databases stay independent.
  expect(result).toEqual({
    sequence: [{ value: 'first' }, { value: 'first' }, { value: 'second' }, { value: 'second' }, { value: 'delivery' }],
    wrapperPreserved: true, delivery: { value: 'delivery' }, nativeBlobText: 'native-binary', nativeBlobType: 'text/plain',
  });
});

test('user observes every A to B to A transition and ordered native barriers', async ({ page }) => {
  // Given the real database initially contains chart state A.
  await openStorageLab(page);
  await page.evaluate(() => window.__STORAGE_LAB__.native.setItem('#TV_SYMBOL-ABA', 'A'));

  // When one caller interleaves state changes, reads, enumeration, deletion, and an unmanaged key.
  const result = await page.evaluate(async () => {
    const store = window.__STORAGE_LAB__.create();
    return Promise.all([
      store.getItem('#TV_SYMBOL-ABA'),
      store.setItem('#TV_SYMBOL-ABA', 'B'),
      store.getItem('#TV_SYMBOL-ABA'),
      store.setItem('#TV_SYMBOL-ABA', 'A'),
      store.getItem('#TV_SYMBOL-ABA'),
      store.keys(),
      store.removeItem('#TV_SYMBOL-ABA'),
      store.getItem('#TV_SYMBOL-ABA'),
      store.setItem('unmanaged-setting', { enabled: true }),
      store.getItem('unmanaged-setting'),
      store.clear(),
      store.keys(),
    ]);
  });

  // Then each intermediate result follows issue order and clear leaves no stored keys.
  expect(result).toEqual([
    'A', 'B', 'B', 'A', 'A', ['#TV_SYMBOL-ABA'], undefined, null,
    { enabled: true }, { enabled: true }, undefined, [],
  ]);
});

test('user creates a present null record and suppresses only its repeated null write', async ({ page }) => {
  // Given the chart store is empty and its native connection is ready.
  await openStorageLab(page);
  await page.evaluate(async () => {
    window.__STORAGE_LAB__.store = window.__STORAGE_LAB__.create();
    await window.__STORAGE_LAB__.store.ready();
    window.__STORAGE_NATIVE__.reset();
  });

  // When a missing chart key receives two explicit null saves.
  const result = await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    const values = await Promise.all([
      lab.store.getItem('myTradingView-null'),
      lab.store.setItem('myTradingView-null', null),
      lab.store.setItem('myTradingView-null', null),
    ]);
    const metrics = window.__STORAGE_NATIVE__.snapshot();
    return { values, metrics, keys: await lab.native.keys(), stats: lab.controller.getStats() };
  });

  // Then null is a persisted present key and only the unchanged second save is skipped.
  expect(result.values).toEqual([null, null, null]);
  expect(result.keys).toEqual(['myTradingView-null']);
  expect(result.metrics.puts).toBe(1);
  expect(result.stats.skippedWrites).toBe(1);
});

test('user reads completed writes from another page and retains them after reload', async ({ page, context }) => {
  // Given two isolated host pages share only the real same-origin IndexedDB database.
  await openStorageLab(page);
  const second = await context.newPage();
  await openStorageLab(second);

  // When the first page commits A and the second page reads A before committing B.
  await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    lab.sharedStore = lab.create();
    await lab.sharedStore.setItem('#TV_SYMBOL-SHARED', { revision: 'A' });
    await lab.sharedStore.getItem('#TV_SYMBOL-SHARED');
  });
  const secondRead = await second.evaluate(async () => {
    const store = window.__STORAGE_LAB__.create();
    const prior = await store.getItem('#TV_SYMBOL-SHARED');
    await store.setItem('#TV_SYMBOL-SHARED', { revision: 'B' });
    return prior;
  });
  const firstRead = await page.evaluate(() => window.__STORAGE_LAB__.sharedStore.getItem('#TV_SYMBOL-SHARED'));
  await page.reload();
  await initializeStorageLab(page);
  const reloaded = await page.evaluate(() => window.__STORAGE_LAB__.create().getItem('#TV_SYMBOL-SHARED'));

  // Then the later completed write is visible across pages and survives a real document reload.
  expect(secondRead).toEqual({ revision: 'A' });
  expect(firstRead).toEqual({ revision: 'B' });
  expect(reloaded).toEqual({ revision: 'B' });
  await second.close();
});

test('user receives batch failures after a real transaction abort with every prior value restored', async ({ page }) => {
  // Given two committed records exist and the next native put will trigger a real IDB transaction abort.
  await openStorageLab(page);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    await Promise.all(['A', 'B'].map(key => lab.native.setItem(`#TV_SYMBOL-${key}`, { revision: 1 })));
    lab.store = lab.create();
    await lab.store.ready();
    window.__STORAGE_NATIVE__.reset();
    window.__STORAGE_NATIVE__.abortNextPut();
  });

  // When two writes and a read are accepted into the aborting batch.
  const result = await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    const callbacks = [];
    const callback = (error, value) => callbacks.push({ error: error instanceof Error || error instanceof DOMException, value });
    const outcomes = await Promise.allSettled([
      lab.store.setItem('#TV_SYMBOL-A', { revision: 2 }, callback),
      lab.store.setItem('#TV_SYMBOL-B', { revision: 2 }, callback),
      lab.store.getItem('#TV_SYMBOL-A', callback),
    ]);
    await lab.controller.drain();
    const metrics = window.__STORAGE_NATIVE__.snapshot();
    return {
      statuses: outcomes.map(value => value.status), names: outcomes.map(value => value.reason?.name), callbacks, metrics,
      persisted: await Promise.all(['A', 'B'].map(key => lab.native.getItem(`#TV_SYMBOL-${key}`))),
    };
  });

  // Then every accepted request rejects once and the actual database has rolled the entire batch back.
  expect(result.statuses).toEqual(['rejected', 'rejected', 'rejected']);
  expect(result.names).toEqual(['AbortError', 'AbortError', 'AbortError']);
  expect(result.callbacks).toEqual([
    { error: true, value: undefined }, { error: true, value: undefined }, { error: true, value: undefined },
  ]);
  expect(result.persisted).toEqual([{ revision: 1 }, { revision: 1 }]);
  expect(result.metrics.aborted).toBe(1);
  expect(result.metrics.pending).toBe(0);
  expect(pageErrors).toEqual([]);
});

test('user receives success only after all accepted writes commit to the real database', async ({ page }) => {
  // Given the chart store is ready and native transaction completion is being observed.
  await openStorageLab(page);
  await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    lab.store = lab.create();
    await lab.store.ready();
    window.__STORAGE_NATIVE__.reset();
  });

  // When a batch is saved and each returned Promise records the real transaction state at resolution.
  const result = await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    const completions = await Promise.all(Array.from({ length: 20 }, (_, index) => (
      lab.store.setItem(`#TV_SYMBOL-COMMIT${index}`, { index }).then(value => ({
        value, native: window.__STORAGE_NATIVE__.snapshot(),
      }))
    )));
    return { completions, keys: await lab.native.keys() };
  });

  // Then all twenty results arrive after native completion and all twenty keys are durable.
  expect(result.completions.map(({ value }) => value)).toEqual(Array.from({ length: 20 }, (_, index) => ({ index })));
  expect(result.completions.every(({ native }) => native.completed >= 1 && native.pending === 0)).toBe(true);
  expect(result.keys).toHaveLength(20);
});

test('user receives explicit capacity rejection without losing any accepted save', async ({ page }) => {
  // Given the isolated adapter accepts at most two outstanding chart operations.
  await openStorageLab(page, { options: { maxPendingOperations: 2 } });

  // When three writes arrive synchronously before database readiness can finish.
  const result = await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    const store = lab.create();
    const outcomes = await Promise.allSettled([0, 1, 2].map(index => store.setItem(`#TV_SYMBOL-LIMIT${index}`, index)));
    await lab.controller.drain();
    return {
      outcomes: outcomes.map(outcome => ({ status: outcome.status, value: outcome.value, message: outcome.reason?.message })),
      persisted: await Promise.all([0, 1, 2].map(index => lab.native.getItem(`#TV_SYMBOL-LIMIT${index}`))),
      keys: await lab.native.keys(), stats: lab.controller.getStats(),
    };
  });

  // Then the first two writes remain durable and the third fails explicitly instead of disappearing.
  expect(result.outcomes.map(({ status }) => status)).toEqual(['fulfilled', 'fulfilled', 'rejected']);
  expect(result.outcomes[2].message).toMatch(/capacity|limit|pending|queue/i);
  expect(result.persisted).toEqual([0, 1, null]);
  expect(result.keys.sort()).toEqual(['#TV_SYMBOL-LIMIT0', '#TV_SYMBOL-LIMIT1']);
  expect(result.stats.pendingOperations).toBe(0);
  expect(result.stats.pendingBytes).toBe(0);
  expect(result.stats.peakPendingOperations).toBe(2);
  expect(result.stats.rejectedOperations).toBe(1);
});

test('user rejects oversized pending data while a subsequent bounded save remains durable', async ({ page }) => {
  // Given pending JSON input is limited to sixty-four bytes.
  await openStorageLab(page, { options: { maxPendingBytes: 64 } });

  // When an oversized chart string is followed by a small valid chart number.
  const result = await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    const store = lab.create();
    const outcomes = await Promise.allSettled([
      store.setItem('#TV_SYMBOL-BIG', 'x'.repeat(1024)),
      store.setItem('#TV_SYMBOL-SMALL', 7),
    ]);
    await lab.controller.drain();
    return {
      statuses: outcomes.map(outcome => outcome.status),
      keys: await lab.native.keys(), value: await lab.native.getItem('#TV_SYMBOL-SMALL'), stats: lab.controller.getStats(),
    };
  });

  // Then only the bounded save exists and every pending accounting reservation is released.
  expect(result.statuses).toEqual(['rejected', 'fulfilled']);
  expect(result.keys).toEqual(['#TV_SYMBOL-SMALL']);
  expect(result.value).toBe(7);
  expect(result.stats.pendingBytes).toBe(0);
  expect(result.stats.pendingOperations).toBe(0);
});

test('user drains accepted work during stop and retained facades continue with native storage', async ({ page }) => {
  // Given two operations are accepted before the new chart database becomes ready.
  await openStorageLab(page);

  // When stop is requested while the accepted write and read are still queued.
  const result = await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    const store = lab.create();
    const accepted = [store.setItem('#TV_SYMBOL-STOP', { saved: true }), store.getItem('#TV_SYMBOL-STOP')];
    const stopping = lab.controller.stop();
    await stopping;
    const values = await Promise.all(accepted);
    const retained = await Promise.allSettled([
      store.getItem('#TV_SYMBOL-STOP'), store.setItem('#TV_SYMBOL-LATE', 1), store.keys(),
    ]);
    const restored = lab.localforage.createInstance === lab.nativeCreateInstance;
    const fresh = lab.create();
    await fresh.setItem('#TV_SYMBOL-NATIVE', 2);
    return {
      values, restored, statuses: retained.map(outcome => outcome.status),
      keys: await lab.native.keys(), stats: lab.controller.getStats(),
      saved: await lab.native.getItem('#TV_SYMBOL-STOP'), nativeSaved: await lab.native.getItem('#TV_SYMBOL-NATIVE'),
    };
  });

  // Then stop preserves queued work, allows retained-facade calls, and restores native factory behavior.
  expect(result.values).toEqual([{ saved: true }, { saved: true }]);
  expect(result.restored).toBe(true);
  expect(result.statuses).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
  expect(result.keys.sort()).toEqual(['#TV_SYMBOL-LATE', '#TV_SYMBOL-NATIVE', '#TV_SYMBOL-STOP']);
  expect(result.saved).toEqual({ saved: true });
  expect(result.nativeSaved).toBe(2);
  expect(result.stats.pendingOperations).toBe(0);
  expect(result.stats.pendingBytes).toBe(0);
});

test('user cannot mutate managed configuration or submit values outside the JSON contract', async ({ page }) => {
  // Given a managed store exposes a configuration snapshot for inspection.
  await openStorageLab(page);

  // When callers mutate a snapshot and attempt configuration, driver, database, and non-JSON changes.
  const result = await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    const store = lab.create();
    const snapshot = store.config();
    snapshot.name = 'changed-outside';
    const cycle = {};
    cycle.self = cycle;
    const actions = [
      () => store.config({ name: 'changed-inside' }),
      () => store.setDriver(lab.localforage.LOCALSTORAGE),
      () => store.dropInstance(),
      ...[undefined, NaN, Infinity, new Date(0), new Blob(['binary']), cycle]
        .map(value => () => store.setItem('#TV_SYMBOL-INVALID', value)),
    ];
    const outcomes = await Promise.allSettled(actions.map(action => Promise.resolve().then(action)));
    return {
      name: store.config().name,
      statuses: outcomes.map(outcome => outcome.status),
      messages: outcomes.map(outcome => outcome.reason?.message),
      keys: await lab.native.keys(),
    };
  });

  // Then invalid operations fail explicitly without changing database identity or creating a key.
  expect(result.name).toBe('chart_futures');
  expect(result.statuses).toEqual(Array(9).fill('rejected'));
  expect(result.messages.every(message => typeof message === 'string' && message.length > 0)).toBe(true);
  expect(result.keys).toEqual([]);
});

test('user receives a closed-connection failure without an automatic reopen or retry', async ({ page }) => {
  // Given the real connection used by a completed managed save is deliberately closed.
  await openStorageLab(page);
  const closed = await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    lab.store = lab.create();
    await lab.store.setItem('#TV_SYMBOL-BEFORE-CLOSE', 1);
    const count = window.__STORAGE_NATIVE__.closeTarget('chart_futures');
    window.__STORAGE_NATIVE__.reset();
    return count;
  });

  // When the retained facade attempts another chart save through that closed connection.
  const result = await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    const outcomes = await Promise.allSettled([lab.store.setItem('#TV_SYMBOL-AFTER-CLOSE', 2)]);
    await lab.controller.drain();
    return {
      status: outcomes[0].status, name: outcomes[0].reason?.name, message: outcomes[0].reason?.message,
      metrics: window.__STORAGE_NATIVE__.snapshot(), stats: lab.controller.getStats(),
    };
  });

  // Then the storage error is explicit and no hidden database open retries the failed write.
  expect(closed).toBeGreaterThanOrEqual(1);
  expect(result.status).toBe('rejected');
  expect(result.message).toMatch(/clos|connection|transaction|invalid/i);
  expect(result.metrics.opens).toBe(0);
  expect(result.metrics.puts).toBe(0);
  expect(result.stats.pendingOperations).toBe(0);
});

test('user splits accepted work at the configured batch size without losing a result', async ({ page }) => {
  // Given a ready real chart store limits each batch to two operations.
  await openStorageLab(page, { options: { maxBatchOperations: 2 } });
  await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    lab.store = lab.create();
    await lab.store.ready();
    window.__STORAGE_NATIVE__.reset();
  });

  // When five saves are submitted together through the public storage facade.
  const result = await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    const values = await Promise.all(Array.from({ length: 5 }, (_, index) => (
      lab.store.setItem(`#TV_SYMBOL-BATCH${index}`, index)
    )));
    return { values, metrics: window.__STORAGE_NATIVE__.snapshot(), stats: lab.controller.getStats() };
  });

  // Then all results complete through exactly three real committed transactions.
  expect(result.values).toEqual([0, 1, 2, 3, 4]);
  expect(result.metrics.transactions).toBe(3);
  expect(result.metrics.completed).toBe(3);
  expect(result.metrics.puts).toBe(5);
  expect(result.stats.pendingOperations).toBe(0);
});

test('user receives an explicit oversized-result failure and can still read a bounded value', async ({ page }) => {
  // Given native storage contains a large value beyond the adapter's result-size contract.
  await openStorageLab(page, { options: { maxResultBytes: 32 } });
  await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    await lab.native.setItem('#TV_SYMBOL-LARGE-RESULT', 'x'.repeat(1024));
    await lab.native.setItem('#TV_SYMBOL-SMALL-RESULT', 3);
    lab.store = lab.create();
  });

  // When the caller reads the oversized record before reading the independent bounded record.
  const result = await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    const outcome = await Promise.allSettled([lab.store.getItem('#TV_SYMBOL-LARGE-RESULT')]);
    return {
      status: outcome[0].status, message: outcome[0].reason?.message,
      small: await lab.store.getItem('#TV_SYMBOL-SMALL-RESULT'),
      originalLength: (await lab.native.getItem('#TV_SYMBOL-LARGE-RESULT')).length,
      stats: lab.controller.getStats(),
    };
  });

  // Then the oversized read fails without corrupting storage or blocking later valid work.
  expect(result.status).toBe('rejected');
  expect(result.message).toMatch(/result|size|byte|limit/i);
  expect(result.small).toBe(3);
  expect(result.originalLength).toBe(1024);
  expect(result.stats.pendingOperations).toBe(0);
});

test('user saves an admission-time JSON snapshot without sharing mutable result objects', async ({ page }) => {
  // Given a caller owns a nested JSON chart object.
  await openStorageLab(page);

  // When that object and later returned objects are mutated around asynchronous storage calls.
  const result = await page.evaluate(async () => {
    const store = window.__STORAGE_LAB__.create();
    const input = { nested: [1] };
    const saving = store.setItem('#TV_SYMBOL-SNAPSHOT', input);
    input.nested[0] = 2;
    const written = await saving;
    const savedResult = structuredClone(written);
    written.nested[0] = 3;
    const read = await store.getItem('#TV_SYMBOL-SNAPSHOT');
    const firstRead = structuredClone(read);
    read.nested[0] = 4;
    return { savedResult, firstRead, secondRead: await store.getItem('#TV_SYMBOL-SNAPSHOT') };
  });

  // Then persistence and every result retain the original snapshot instead of caller mutations.
  expect(result).toEqual({ savedResult: { nested: [1] }, firstRead: { nested: [1] }, secondRead: { nested: [1] } });
});

test('user completes an external version upgrade and recovers storage only after a fresh page lifecycle', async ({ page }) => {
  // Given a managed facade has committed through the library's shared native connection.
  await openStorageLab(page);
  await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    lab.store = lab.create();
    await lab.store.setItem('#TV_SYMBOL-UPGRADE', 1);
    window.__STORAGE_NATIVE__.reset();
  });

  // When an external native connection upgrades the database and the old facade attempts another save.
  const result = await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    const previousVersion = window.__STORAGE_NATIVE__.version('chart_futures');
    const upgrade = await new Promise((resolve, reject) => {
      const request = indexedDB.open('chart_futures', previousVersion + 1);
      let upgraded = false;
      request.onupgradeneeded = () => { upgraded = true; };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('The external version upgrade was blocked'));
      request.onsuccess = () => {
        const version = request.result.version;
        request.result.close();
        resolve({ upgraded, version });
      };
    });
    const nativeAfterUpgrade = window.__STORAGE_NATIVE__.snapshot();
    window.__STORAGE_NATIVE__.reset();
    const outcome = await Promise.allSettled([lab.store.setItem('#TV_SYMBOL-UPGRADE', 2)]);
    await lab.controller.stop();
    return {
      previousVersion, upgrade, nativeAfterUpgrade, status: outcome[0].status,
      afterFailure: window.__STORAGE_NATIVE__.snapshot(),
      factoryRestored: lab.localforage.createInstance === lab.nativeCreateInstance,
    };
  });

  // Then the actual upgrade completes, the stale facade fails without reopening, and stop restores the factory.
  expect(result.upgrade).toEqual({ upgraded: true, version: result.previousVersion + 1 });
  expect(result.nativeAfterUpgrade.versionChanges).toBeGreaterThanOrEqual(1);
  expect(result.status).toBe('rejected');
  expect(result.afterFailure.opens).toBe(0);
  expect(result.afterFailure.puts).toBe(0);
  expect(result.factoryRestored).toBe(true);

  // When a real reload creates a fresh library lifecycle against the upgraded database.
  await page.reload();
  await initializeStorageLab(page);
  const recovered = await page.evaluate(async () => {
    const store = window.__STORAGE_LAB__.create();
    const before = await store.getItem('#TV_SYMBOL-UPGRADE');
    await store.setItem('#TV_SYMBOL-UPGRADE', 3);
    return { before, after: await store.getItem('#TV_SYMBOL-UPGRADE') };
  });

  // Then the last committed value survives and a fresh lifecycle can save again.
  expect(recovered).toEqual({ before: 1, after: 3 });
});

test('user installs storage synchronously before the host creates its first instance', async ({ page }) => {
  // Given capture and its synchronous adapter callback precede module registration and execution.
  await openStorageLab(page, { capture: true, captureInstall: true, initialize: false });

  // When the real host requires storage and immediately creates and uses its first instance.
  const result = await page.evaluate(async () => {
    let hostExport;
    let store;
    let firstSave;
    let pendingBeforeRequireReturns;
    let factoryExecutions = 0;
    self.webpackChunkfutures_trade_ui.push([
      ['codex-chart-storage-sync-host'], {}, require => {
        const original = require.m[43917];
        require.m[43917] = function (...args) {
          factoryExecutions += 1;
          return original.apply(this, args);
        };
        hostExport = require(43917);
        store = hostExport.createInstance({
          name: 'chart_futures', storeName: 'keyvaluepairs', driver: hostExport.INDEXEDDB,
        });
        firstSave = store.setItem('#TV_SYMBOL-SYNC-CAPTURE', { saved: true });
        pendingBeforeRequireReturns = window.__STORAGE_CAPTURE_CONTROLLER__.getStats().pendingOperations;
      },
    ]);
    await firstSave;
    const capturedSameExport = await window.__STORAGE_CAPTURE__.captured === hostExport;
    window.__STORAGE_NATIVE__.reset();
    const repeated = await Promise.all(Array.from({ length: 12 }, () => (
      store.setItem('#TV_SYMBOL-SYNC-CAPTURE', { saved: true })
    )));
    return {
      pendingBeforeRequireReturns, factoryExecutions, capturedSameExport, repeated,
      metrics: window.__STORAGE_NATIVE__.snapshot(),
      saved: await store.getItem('#TV_SYMBOL-SYNC-CAPTURE'),
    };
  });

  // Then the first host instance performs real batching and unchanged-write suppression.
  expect(result.pendingBeforeRequireReturns).toBe(1);
  expect(result.factoryExecutions).toBe(1);
  expect(result.capturedSameExport).toBe(true);
  expect(result.repeated).toEqual(Array.from({ length: 12 }, () => ({ saved: true })));
  expect(result.metrics.transactions).toBe(1);
  expect(result.metrics.puts).toBe(0);
  expect(result.saved).toEqual({ saved: true });
});

test('user keeps every accepted save when one callback throws a caller error', async ({ page }) => {
  // Given a ready managed store has an event listener for the deliberately thrown caller error.
  await openStorageLab(page);
  const reportedError = page.waitForEvent('pageerror', { predicate: error => error.message === 'Storage lab callback failure' });

  // When one callback throws while three valid saves are completing.
  const result = await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    const store = lab.create();
    const callbacks = [];
    const values = await Promise.all([0, 1, 2].map(index => store.setItem(`#TV_SYMBOL-CALLBACK${index}`, index, (error, value) => {
      callbacks.push({ index, success: error === null, value });
      if (index === 0) throw new Error('Storage lab callback failure');
    })));
    return {
      values, callbacks,
      persisted: await Promise.all([0, 1, 2].map(index => lab.native.getItem(`#TV_SYMBOL-CALLBACK${index}`))),
      pending: lab.controller.getStats().pendingOperations,
    };
  });
  const error = await reportedError;

  // Then the error is reported separately and all three callbacks, promises, and committed values survive.
  expect(error.message).toBe('Storage lab callback failure');
  expect(result.values).toEqual([0, 1, 2]);
  expect(result.callbacks).toEqual([
    { index: 0, success: true, value: 0 }, { index: 1, success: true, value: 1 }, { index: 2, success: true, value: 2 },
  ]);
  expect(result.persisted).toEqual([0, 1, 2]);
  expect(result.pending).toBe(0);
});

test('user splits chart saves at the configured byte limit while retaining every value', async ({ page }) => {
  // Given each individual JSON save fits a hundred-byte batch but two saves do not.
  await openStorageLab(page, { options: { maxBatchBytes: 100 } });
  await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    lab.store = lab.create();
    await lab.store.ready();
    window.__STORAGE_NATIVE__.reset();
  });

  // When three sixty-character records are accepted together.
  const result = await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    const values = await Promise.all([0, 1, 2].map(index => lab.store.setItem(`#TV_SYMBOL-BYTES${index}`, 'x'.repeat(60))));
    const metrics = window.__STORAGE_NATIVE__.snapshot();
    return { values, metrics, persisted: await Promise.all([0, 1, 2].map(index => lab.native.getItem(`#TV_SYMBOL-BYTES${index}`))) };
  });

  // Then three bounded transactions preserve all saved and returned values.
  expect(result.values).toEqual(Array(3).fill('x'.repeat(60)));
  expect(result.persisted).toEqual(Array(3).fill('x'.repeat(60)));
  expect(result.metrics.transactions).toBe(3);
  expect(result.metrics.completed).toBe(3);
  expect(result.metrics.puts).toBe(3);
});

test('user counts native barriers against pending capacity and preserves their place in order', async ({ page }) => {
  // Given only two pending operations may be accepted before fresh database initialization.
  await openStorageLab(page, { options: { maxPendingOperations: 2 } });

  // When a save and keys barrier occupy capacity before a third save arrives.
  const result = await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    const store = lab.create();
    const outcomes = await Promise.allSettled([
      store.setItem('#TV_SYMBOL-BARRIER-FIRST', 1), store.keys(), store.setItem('#TV_SYMBOL-BARRIER-LATE', 2),
    ]);
    await lab.controller.drain();
    return {
      statuses: outcomes.map(outcome => outcome.status),
      barrierKeys: outcomes[1].value, persistedKeys: await lab.native.keys(), stats: lab.controller.getStats(),
    };
  });

  // Then the barrier sees the first committed key and the over-capacity save explicitly fails.
  expect(result.statuses).toEqual(['fulfilled', 'fulfilled', 'rejected']);
  expect(result.barrierKeys).toEqual(['#TV_SYMBOL-BARRIER-FIRST']);
  expect(result.persistedKeys).toEqual(['#TV_SYMBOL-BARRIER-FIRST']);
  expect(result.stats.peakPendingOperations).toBe(2);
  expect(result.stats.pendingOperations).toBe(0);
});

test('user stops capture after registration and restores the unexecuted original factory', async ({ page }) => {
  // Given module registration has completed but the host has not required the storage factory.
  await openStorageLab(page, { capture: true, initialize: false });

  // When capture stops before the first host require.
  const stopped = await page.evaluate(async () => {
    const capture = window.__STORAGE_CAPTURE__;
    const completion = capture.captured.then(() => ({ status: 'fulfilled' }), error => ({ status: 'rejected', message: error.message }));
    capture.stop();
    let restoredFactory;
    self.webpackChunkfutures_trade_ui.push([
      ['codex-chart-storage-stopped-host'], {}, require => {
        restoredFactory = require.m[43917] === window.__STORAGE_ORIGINAL_MODULE_FACTORY__;
      },
    ]);
    return {
      completion: await completion,
      restoredFactory,
      restoredPush: self.webpackChunkfutures_trade_ui.push === window.__STORAGE_CAPTURE_ORIGINAL_PUSH__,
    };
  });
  await initializeStorageLab(page, { install: false });
  const identity = await page.evaluate(() => window.__STORAGE_LAB__.cacheIdentity());

  // Then capture rejects explicitly and the host can execute the restored native factory exactly once.
  expect(stopped.completion.status).toBe('rejected');
  expect(stopped.completion.message).toMatch(/stop.*before.*execution/i);
  expect(stopped.restoredFactory).toBe(true);
  expect(stopped.restoredPush).toBe(true);
  expect(identity).toEqual({ sameExport: true, factoryExecutions: 1 });
});

test('user receives the original factory error and capture restores every owned runtime hook', async ({ page }) => {
  // Given the real runtime will execute an explicitly failing test-owned module factory.
  await openStorageRuntime(page);

  // When the host requires that factory through the capture observer.
  const result = await page.evaluate(async () => {
    const { observeChartStorageModule } = await import('/capture.js');
    const queue = self.webpackChunkfutures_trade_ui;
    const originalPush = queue.push;
    let executions = 0;
    const originalFactory = () => {
      executions += 1;
      throw new Error('Storage lab original factory failed');
    };
    const capture = observeChartStorageModule();
    const captured = capture.captured.then(() => ({ status: 'fulfilled' }), error => ({ status: 'rejected', message: error.message }));
    let runtimeRequire;
    queue.push([['codex-chart-storage-failing-module'], { 43917: originalFactory }, require => { runtimeRequire = require; }]);
    let hostError;
    try { runtimeRequire(43917); } catch (error) { hostError = error.message; }
    return {
      hostError, captured: await captured, executions,
      factoryRestored: runtimeRequire.m[43917] === originalFactory, pushRestored: queue.push === originalPush,
    };
  });

  // Then both consumers receive the original error and no interception hook remains installed.
  expect(result).toEqual({
    hostError: 'Storage lab original factory failed',
    captured: { status: 'rejected', message: 'Storage lab original factory failed' },
    executions: 1, factoryRestored: true, pushRestored: true,
  });
});

test('user receives a capture callback error and the real storage factory remains restored', async ({ page }) => {
  // Given a capture callback deliberately fails after the actual localForage factory returns.
  await openStorageRuntime(page);
  await page.evaluate(async () => {
    const { observeChartStorageModule } = await import('/capture.js');
    const queue = self.webpackChunkfutures_trade_ui;
    window.__CAPTURE_ERROR_ORIGINAL_PUSH__ = queue.push;
    const capture = observeChartStorageModule(queue, { onCapture() { throw new Error('Storage lab onCapture failed'); } });
    window.__CAPTURE_ERROR_RESULT__ = capture.captured.then(() => ({ status: 'fulfilled' }), error => ({ status: 'rejected', message: error.message }));
    const observedPush = queue.push;
    window.__CAPTURE_ERROR_OBSERVED_PUSH__ = observedPush;
    queue.push = function (chunk) {
      if (Object.hasOwn(chunk[1], '43917')) window.__CAPTURE_ERROR_ORIGINAL_FACTORY__ = chunk[1][43917];
      return observedPush.call(this, chunk);
    };
  });
  await page.addScriptTag({ url: `${STORAGE_LAB_ORIGIN}/localforage-module.js` });

  // When the host first requires the real module and handles the callback error explicitly.
  const result = await page.evaluate(async () => {
    const queue = self.webpackChunkfutures_trade_ui;
    queue.push = window.__CAPTURE_ERROR_OBSERVED_PUSH__;
    let runtimeRequire;
    queue.push([['codex-chart-storage-capture-error'], {}, require => { runtimeRequire = require; }]);
    let hostError;
    try { runtimeRequire(43917); } catch (error) { hostError = error.message; }
    return {
      hostError, captured: await window.__CAPTURE_ERROR_RESULT__,
      factoryRestored: runtimeRequire.m[43917] === window.__CAPTURE_ERROR_ORIGINAL_FACTORY__,
      pushRestored: queue.push === window.__CAPTURE_ERROR_ORIGINAL_PUSH__,
    };
  });

  // Then the callback failure rejects capture and leaves the real runtime's factory and queue restored.
  expect(result).toEqual({
    hostError: 'Storage lab onCapture failed',
    captured: { status: 'rejected', message: 'Storage lab onCapture failed' },
    factoryRestored: true, pushRestored: true,
  });
});

test('user rejects an oversized unmanaged save before its native barrier can persist data', async ({ page }) => {
  // Given a managed store limits any result to thirty-two bytes.
  await openStorageLab(page, { options: { maxResultBytes: 32 } });
  await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    lab.store = lab.create();
    await lab.store.ready();
    window.__STORAGE_NATIVE__.reset();
  });

  // When an unmanaged key attempts a native-barrier save whose returned value exceeds the limit.
  const result = await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    const outcome = await Promise.allSettled([lab.store.setItem('unmanaged-large-value', 'x'.repeat(100))]);
    return {
      status: outcome[0].status, message: outcome[0].reason?.message,
      metrics: window.__STORAGE_NATIVE__.snapshot(), keys: await lab.native.keys(),
      value: await lab.native.getItem('unmanaged-large-value'),
    };
  });

  // Then explicit rejection precedes every native put and no rejected value is stored.
  expect(result.status).toBe('rejected');
  expect(result.message).toMatch(/result|size|byte|limit/i);
  expect(result.metrics.puts).toBe(0);
  expect(result.keys).toEqual([]);
  expect(result.value).toBe(null);
});

test('user completes eight simultaneous 290-key save rounds with every callback and bounded native work', async ({ page }, testInfo) => {
  // Given the native library has committed 290 historical chart snapshots before observation begins.
  await openStorageLab(page);
  await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    lab.concurrentRecords = Array.from({ length: 290 }, (_, index) => ({
      key: `#TV_SYMBOL-CONCURRENT${index}`, value: { symbol: `CONCURRENT${index}`, drawings: [index, { visible: true }] },
    }));
    await Promise.all(lab.concurrentRecords.map(({ key, value }) => lab.native.setItem(key, value)));
    lab.store = lab.create();
    await lab.store.ready();
    window.__STORAGE_NATIVE__.reset();
  });

  // When all eight rounds begin together and each read is followed by its corresponding unchanged save.
  const result = await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    const callbacks = [];
    const rounds = Array.from({ length: 8 }, (_, round) => Promise.all(lab.concurrentRecords.map(async ({ key, value }, index) => {
      const callback = kind => (error, actual) => callbacks.push({
        id: `${round}:${index}:${kind}`, success: error === null, matches: JSON.stringify(actual) === JSON.stringify(value),
      });
      const read = await lab.store.getItem(key, callback('get'));
      const saved = await lab.store.setItem(key, read, callback('set'));
      return JSON.stringify(read) === JSON.stringify(value) && JSON.stringify(saved) === JSON.stringify(value);
    })));
    const matches = await Promise.all(rounds);
    const metrics = window.__STORAGE_NATIVE__.snapshot();
    const stats = lab.controller.getStats();
    const persisted = await Promise.all(lab.concurrentRecords.map(({ key }) => lab.native.getItem(key)));
    return {
      matches: matches.flat().every(Boolean), metrics, stats,
      callbacks: callbacks.length, uniqueCallbacks: new Set(callbacks.map(({ id }) => id)).size,
      callbackValuesMatch: callbacks.every(({ success, matches }) => success && matches),
      persistedMatches: persisted.every((value, index) => JSON.stringify(value) === JSON.stringify(lab.concurrentRecords[index].value)),
    };
  });
  await displayStorageResult(page, result);
  const measurementPath = testInfo.outputPath('concurrent-storage-measurement.json');
  await writeFile(measurementPath, JSON.stringify(result, null, 2));
  await testInfo.attach('concurrent-storage-measurement.json', { path: measurementPath, contentType: 'application/json' });

  // Then all 4640 distinct callbacks and results match while concurrent work remains batched and unchanged writes vanish.
  expect(result.matches).toBe(true);
  expect(result.callbackValuesMatch).toBe(true);
  expect(result.persistedMatches).toBe(true);
  expect(result.callbacks).toBe(4640);
  expect(result.uniqueCallbacks).toBe(4640);
  expect(result.metrics.transactions).toBeLessThanOrEqual(32);
  expect(result.metrics.puts).toBe(0);
  expect(result.stats.pendingOperations).toBe(0);
  expect(result.stats.pendingBytes).toBe(0);
});

test('user retains upstream native connection recovery for an unmanaged barrier save', async ({ page }) => {
  // Given the real connection closes after a managed chart save has committed.
  await openStorageLab(page);
  await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    lab.store = lab.create();
    await lab.store.setItem('#TV_SYMBOL-BEFORE-BARRIER', 1);
    window.__STORAGE_NATIVE__.closeTarget('chart_futures');
    window.__STORAGE_NATIVE__.reset();
  });

  // When an unmanaged key uses localForage's native barrier path through the closed connection.
  const result = await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    const value = await lab.store.setItem('unmanaged-recovery', { recovered: true });
    return {
      value, metrics: window.__STORAGE_NATIVE__.snapshot(),
      persisted: await lab.native.getItem('unmanaged-recovery'),
      previous: await lab.native.getItem('#TV_SYMBOL-BEFORE-BARRIER'),
    };
  });

  // Then native localForage reopens and commits the barrier while preserving the earlier chart value.
  expect(result.value).toEqual({ recovered: true });
  expect(result.persisted).toEqual({ recovered: true });
  expect(result.previous).toBe(1);
  expect(result.metrics.opens).toBeGreaterThanOrEqual(1);
  expect(result.metrics.puts).toBe(1);
});

test('user retains native barrier rejection even when its abort reason is null', async ({ page }) => {
  // Given an unmanaged native record exists and its next put will abort a real transaction.
  await openStorageLab(page);
  await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    await lab.native.setItem('unmanaged-abort', 1);
    lab.store = lab.create();
    await lab.store.ready();
    window.__STORAGE_NATIVE__.reset();
    window.__STORAGE_NATIVE__.abortNextPut();
  });

  // When the native barrier attempts to replace that record and localForage rejects with a null reason.
  const result = await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    const outcome = await Promise.allSettled([lab.store.setItem('unmanaged-abort', 2)]);
    return {
      status: outcome[0].status, reason: outcome[0].reason,
      persisted: await lab.native.getItem('unmanaged-abort'), metrics: window.__STORAGE_NATIVE__.snapshot(),
    };
  });

  // Then a null rejection reason cannot become success and rollback preserves the original value.
  expect(result.status).toBe('rejected');
  expect(result.reason).toBe(null);
  expect(result.persisted).toBe(1);
  expect(result.metrics.aborted).toBe(1);
});

test('user receives real quota failures for every batched request while prior values remain durable', async ({ page, context }) => {
  // Given the isolated browser has two committed records and a real sixty-four-KiB origin quota.
  await openStorageRuntime(page);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const session = await context.newCDPSession(page);
  try {
    // Chromium caches bucket space from its first writes, so override quota before initialization.
    await session.send('Storage.overrideQuotaForOrigin', { origin: STORAGE_LAB_ORIGIN, quotaSize: 64 * 1024 });
    const quota = await session.send('Storage.getUsageAndQuota', { origin: STORAGE_LAB_ORIGIN });
    expect(quota.overrideActive).toBe(true);
    expect(quota.quota).toBe(64 * 1024);
    await page.addScriptTag({ url: `${STORAGE_LAB_ORIGIN}/localforage-module.js` });
    await initializeStorageLab(page);
    await page.evaluate(async () => {
      const lab = window.__STORAGE_LAB__;
      await Promise.all([
        lab.native.setItem('#TV_SYMBOL-QUOTA-A', { revision: 1 }),
        lab.native.setItem('#TV_SYMBOL-QUOTA-B', { revision: 1 }),
      ]);
      lab.store = lab.create();
      await lab.store.ready();
      window.__STORAGE_NATIVE__.reset();
    });

    // When a one-MiB JSON string and two related requests enter the same real transaction.
    const result = await page.evaluate(async () => {
      const lab = window.__STORAGE_LAB__;
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
      const chunks = Array.from({ length: 16 }, () => {
        const bytes = crypto.getRandomValues(new Uint8Array(65536));
        return Array.from(bytes, byte => alphabet[byte & 63]).join('');
      });
      const large = chunks.join('');
      const callbacks = [];
      const callback = id => (error, value) => callbacks.push({ id, name: error?.name, value });
      const outcomes = await Promise.allSettled([
        lab.store.setItem('#TV_SYMBOL-QUOTA-A', large, callback('large')),
        lab.store.setItem('#TV_SYMBOL-QUOTA-B', { revision: 2 }, callback('small')),
        lab.store.getItem('#TV_SYMBOL-QUOTA-A', callback('read')),
      ]);
      await lab.controller.drain();
      return {
        inputBytes: new TextEncoder().encode(JSON.stringify(large)).byteLength,
        statuses: outcomes.map(outcome => outcome.status), names: outcomes.map(outcome => outcome.reason?.name),
        callbacks, metrics: window.__STORAGE_NATIVE__.snapshot(), stats: lab.controller.getStats(),
        persisted: await Promise.all([
          lab.native.getItem('#TV_SYMBOL-QUOTA-A'), lab.native.getItem('#TV_SYMBOL-QUOTA-B'),
        ]),
      };
    });

    // Then real QuotaExceededError rejects every request once and rollback preserves both original records.
    expect(result.inputBytes).toBe(1024 * 1024 + 2);
    expect(result.statuses).toEqual(['rejected', 'rejected', 'rejected']);
    expect(result.names).toEqual(['QuotaExceededError', 'QuotaExceededError', 'QuotaExceededError']);
    expect(result.callbacks).toEqual([
      { id: 'large', name: 'QuotaExceededError', value: undefined },
      { id: 'small', name: 'QuotaExceededError', value: undefined },
      { id: 'read', name: 'QuotaExceededError', value: undefined },
    ]);
    expect(result.persisted).toEqual([{ revision: 1 }, { revision: 1 }]);
    expect(result.metrics.transactions).toBe(1);
    expect(result.metrics.aborted).toBe(1);
    expect(result.stats.pendingOperations).toBe(0);
    expect(result.stats.pendingBytes).toBe(0);
    expect(pageErrors).toEqual([]);
  } finally {
    try {
      await session.send('Storage.overrideQuotaForOrigin', { origin: STORAGE_LAB_ORIGIN });
    } finally {
      await session.detach();
    }
  }
});

test('user competing across two pages writes the same new chart state only once', async ({ page, context }) => {
  // Given both pages are ready and a native readwrite transaction holds their shared chart store lock.
  await openStorageLab(page);
  const second = await context.newPage();
  await openStorageLab(second);
  await page.evaluate(() => window.__STORAGE_LAB__.native.setItem('#TV_SYMBOL-CONTENDED', 'A'));
  await Promise.all([page, second].map(target => target.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    lab.store = lab.create();
    await lab.store.ready();
  })));
  await page.evaluate(() => {
    const database = window.__STORAGE_LAB__.native._dbInfo.db;
    const transaction = database.transaction('keyvaluepairs', 'readwrite');
    const store = transaction.objectStore('keyvaluepairs');
    const control = { release: false, reads: 0 };
    const completion = new Promise((resolve, reject) => {
      transaction.addEventListener('complete', () => resolve('complete'), { once: true });
      transaction.addEventListener('abort', () => reject(transaction.error), { once: true });
    });
    function continueHolding() {
      const request = store.get('#TV_SYMBOL-CONTENDED');
      request.onsuccess = () => {
        control.reads += 1;
        if (!control.release) continueHolding();
      };
    }
    window.__STORAGE_CONTENTION_LOCK__ = { control, completion };
    continueHolding();
  });
  try {
    await expect.poll(() => page.evaluate(() => window.__STORAGE_CONTENTION_LOCK__.control.reads)).toBeGreaterThan(0);
    await Promise.all([page, second].map(target => target.evaluate(() => window.__STORAGE_NATIVE__.reset())));

    // When both pages create pending write transactions for B before the lock is explicitly released.
    await Promise.all([page, second].map(target => target.evaluate(() => {
      const lab = window.__STORAGE_LAB__;
      lab.contendingSave = lab.store.setItem('#TV_SYMBOL-CONTENDED', 'B').then(
        value => ({ status: 'fulfilled', value }), error => ({ status: 'rejected', name: error?.name }),
      );
    })));
    await expect.poll(() => Promise.all([page, second].map(target => target.evaluate(() => (
      window.__STORAGE_NATIVE__.snapshot().pending
    ))))).toEqual([1, 1]);
    await page.evaluate(async () => {
      const lock = window.__STORAGE_CONTENTION_LOCK__;
      lock.control.release = true;
      await lock.completion;
    });
    const results = await Promise.all([page, second].map(target => target.evaluate(async () => ({
      outcome: await window.__STORAGE_LAB__.contendingSave,
      metrics: window.__STORAGE_NATIVE__.snapshot(),
    }))));
    const persisted = await page.evaluate(() => window.__STORAGE_LAB__.native.getItem('#TV_SYMBOL-CONTENDED'));

    // Then IndexedDB serializes both comparisons and only one physical put is needed for both successful results.
    expect(results.map(({ outcome }) => outcome)).toEqual([
      { status: 'fulfilled', value: 'B' }, { status: 'fulfilled', value: 'B' },
    ]);
    expect(results.map(({ metrics }) => metrics.transactions)).toEqual([1, 1]);
    expect(results.map(({ metrics }) => metrics.completed)).toEqual([1, 1]);
    expect(results.reduce((sum, { metrics }) => sum + metrics.puts, 0)).toBe(1);
    expect(results.map(({ metrics }) => metrics.pending)).toEqual([0, 0]);
    expect(persisted).toBe('B');
  } finally {
    try {
      await page.evaluate(async () => {
        const lock = window.__STORAGE_CONTENTION_LOCK__;
        lock.control.release = true;
        await lock.completion;
      });
    } finally {
      await second.close();
    }
  }
});
