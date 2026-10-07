import { openProductionMirrorWriterLab } from './chart-storage-production-writer.js';

/** Observe real transaction creation so queued work never relies on a timed wait. */
export async function openChartStorageConcurrency(page) {
  await openProductionMirrorWriterLab(page);
  await page.evaluate(async () => {
    await window.__STORAGE_LAB__.native.ready();
    const nativeTransaction = IDBDatabase.prototype.transaction;
    const state = {
      pending: Object.create(null),
      writes: [],
      waiters: [],
      waitForWrites(count) {
        if (state.writes.length >= count) return Promise.resolve();
        return new Promise(resolve => state.waiters.push({ count, resolve }));
      },
      restore() { IDBDatabase.prototype.transaction = nativeTransaction; },
    };
    IDBDatabase.prototype.transaction = function (...args) {
      const transaction = Reflect.apply(nativeTransaction, this, args);
      if (this.name === 'chart_futures' && transaction.mode === 'readwrite') {
        const record = { outcome: 'pending' };
        state.writes.push(record);
        transaction.addEventListener('complete', () => { record.outcome = 'complete'; }, { once: true });
        transaction.addEventListener('abort', () => { record.outcome = 'abort'; }, { once: true });
        for (const waiter of state.waiters.splice(0)) {
          if (state.writes.length >= waiter.count) waiter.resolve();
          else state.waiters.push(waiter);
        }
      }
      return transaction;
    };
    window.__CHART_CONCURRENCY__ = state;
  });
}

/** Return after admission creates a real transaction, while its lock stays blocked. */
export async function queueChartMirrorBatch(page, id, entries) {
  await page.evaluate(async ({ id, entries }) => {
    const state = window.__CHART_CONCURRENCY__;
    const mirror = window.__MIRROR_WRITER__;
    const next = state.writes.length + 1;
    state.pending[id] = Promise.all(mirror.writer.dispatch(window.__STORAGE_LAB__.native, entries, mirror.nativeThunk));
    await state.waitForWrites(next);
  }, { id, entries });
}

export async function queueNativeChartClear(page, id) {
  await page.evaluate(async id => {
    const state = window.__CHART_CONCURRENCY__;
    const next = state.writes.length + 1;
    state.pending[id] = window.__STORAGE_LAB__.native.clear();
    await state.waitForWrites(next);
  }, id);
}

/** One native readonly transaction prevents the observation itself from mixing revisions. */
export async function queueChartSnapshot(page, id) {
  await page.evaluate(id => {
    const transaction = window.__STORAGE_LAB__.native._dbInfo.db.transaction('keyvaluepairs', 'readonly');
    const store = transaction.objectStore('keyvaluepairs');
    const keys = store.getAllKeys();
    const values = store.getAll();
    window.__CHART_CONCURRENCY__.pending[id] = new Promise((resolve, reject) => {
      transaction.addEventListener('complete', () => {
        resolve(keys.result.map((key, index) => [key, values.result[index]]));
      }, { once: true });
      transaction.addEventListener('abort', () => reject(transaction.error), { once: true });
    });
  }, id);
}

export async function finishChartOperations(page, ids) {
  return page.evaluate(async ids => {
    const pending = window.__CHART_CONCURRENCY__.pending;
    const results = await Promise.all(ids.map(id => pending[id]));
    for (const id of ids) delete pending[id];
    return results;
  }, ids);
}

export async function chartConcurrencyState(page) {
  return page.evaluate(() => ({
    writes: window.__CHART_CONCURRENCY__.writes.map(record => record.outcome),
    stats: window.__MIRROR_WRITER__.writer.getStats(),
    nativeCalls: window.__MIRROR_WRITER__.nativeCalls,
  }));
}

export async function stopChartConcurrency(page) {
  await page.evaluate(async () => {
    await window.__MIRROR_WRITER__.writer.stop();
    window.__CHART_CONCURRENCY__.restore();
  });
}
