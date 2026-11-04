import { readFile } from 'node:fs/promises';
import { openStorageLab, STORAGE_LAB_ORIGIN } from './chart-storage-lab.js';

/** Install the production write filter in front of the captured native localForage driver. */
/**
 * `unreadableKey` models a stored value Chromium cannot read: a readwrite read of that
 * key becomes a real request that fails asynchronously (an `add` of an existing key).
 */
export async function openChartWriteFilterLab(page, { unreadableKey = null } = {}) {
  await openStorageLab(page, { install: false });
  await page.route(`${STORAGE_LAB_ORIGIN}/{unchanged-write-filter,json}.js`, async route => {
    const filename = new URL(route.request().url()).pathname.slice(1);
    await route.fulfill({
      contentType: 'text/javascript',
      body: await readFile(new URL(`../../../src/binance-orderbook-trade/chart-storage/${filename}`, import.meta.url), 'utf8'),
    });
  });
  await page.evaluate(async unreadableKey => {
    if (unreadableKey !== null) {
      const nativeGet = IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get = function (key) {
        return key === unreadableKey && this.transaction.mode === 'readwrite'
          ? this.add('unreadable-placeholder', key) : Reflect.apply(nativeGet, this, arguments);
      };
    }
    const nativeTransaction = IDBDatabase.prototype.transaction;
    const writeTransactions = [];
    const transactionWaiters = [];
    IDBDatabase.prototype.transaction = function (...args) {
      const transaction = Reflect.apply(nativeTransaction, this, args);
      if (this.name === 'chart_futures' && transaction.mode === 'readwrite') {
        writeTransactions.push(transaction);
        for (const waiter of transactionWaiters.splice(0)) {
          if (writeTransactions.length >= waiter.count) waiter.resolve();
          else transactionWaiters.push(waiter);
        }
      }
      return transaction;
    };
    const { installUnchangedChartWriteFilter } = await import('/unchanged-write-filter.js');
    const filter = installUnchangedChartWriteFilter(window);
    let base = filter.snapshot();
    const pending = Object.create(null);
    window.__WRITE_FILTER__ = {
      /** Start a native save and return once its readwrite transaction exists and holds its queue position. */
      queue(id, key, value) {
        const next = writeTransactions.length + 1;
        pending[id] = window.__STORAGE_LAB__.native.setItem(key, value);
        if (writeTransactions.length >= next) return Promise.resolve();
        return new Promise(resolve => transactionWaiters.push({ count: next, resolve }));
      },
      finish(ids) {
        return Promise.all(ids.map(id => pending[id].then(() => 'resolved', error => error?.name ?? 'rejected')));
      },
      /** Start counting native operations and filter outcomes for the scenario's action. */
      reset() {
        window.__STORAGE_NATIVE__.reset();
        base = filter.snapshot();
      },
      delta() {
        const current = filter.snapshot();
        return Object.fromEntries(Object.entries(current).map(([key, value]) => [key, value - base[key]]));
      },
    };
    await window.__STORAGE_LAB__.native.ready();
  }, unreadableKey);
}
