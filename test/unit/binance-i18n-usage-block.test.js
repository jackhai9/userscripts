import assert from 'node:assert/strict';
import test from 'node:test';

import { USAGE_DATABASE, USAGE_OPEN_EXPECTED_MS, installI18nUsageBlock } from '../../src/binance-orderbook-trade/i18n-usage/install.js';

/** Minimal IndexedDB factory: native open records names and returns a request object. */
function factoryView(t, { onContractBreak } = {}) {
  const opened = [];
  class IDBFactory { open(...args) { opened.push(args); return { receiver: this, name: args[0], readyState: 'pending' }; } }
  const view = { IDBFactory, DOMException };
  const breaks = [];
  const timers = [];
  const block = installI18nUsageBlock(view, {
    onContractBreak: onContractBreak ?? (entry => breaks.push(entry)),
    setTimeout: (callback, delay) => timers.push({ callback, delay }),
  });
  t.after(async () => {
    await Promise.resolve();
    assert.deepEqual(block.breaks(), breaks);
  });
  const elapse = () => {
    for (const { callback, delay } of timers.splice(0)) {
      assert.equal(delay, USAGE_OPEN_EXPECTED_MS);
      callback();
    }
  };
  return { view, indexedDB: new IDBFactory(), opened, breaks, block, elapse };
}

/** Binance's usage store: opens inside a Promise executor and caches the connection promise. */
function binanceUsageStore(indexedDB) {
  let db = null;
  let dbPromise = null;
  const errors = [];
  const openDB = () => new Promise((resolve, reject) => {
    const request = indexedDB.open(USAGE_DATABASE, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  async function getDB() {
    if (!db) {
      if (dbPromise) return dbPromise;
      dbPromise = openDB();
      db = await dbPromise;
      dbPromise = null;
    }
    return db;
  }
  return {
    errors,
    async insert() {
      try { await getDB(); } catch (error) { errors.push(error); }
    },
  };
}

test('user page keeps Binance usage telemetry out of IndexedDB without repeated open attempts', async t => {
  // Given Binance's usage store loads with the block installed.
  const host = factoryView(t);
  const store = binanceUsageStore(host.indexedDB);

  // When it records translation usage three times.
  await store.insert();
  await store.insert();
  await store.insert();

  // Then the database is never opened, the one open attempt fails as a caught rejection, and later inserts reuse it.
  assert.deepEqual(host.opened, []);
  assert.deepEqual(host.block.snapshot(), { blocked: 1 });
  assert.equal(store.errors.length, 3);
  assert.ok(store.errors.every(error => error.name === 'NotAllowedError' && error.message === ''));
  assert.equal(new Set(store.errors).size, 1);

  // When the expected-open window closes after the block worked.
  host.elapse();
  await Promise.resolve();

  // Then no missing-database break is reported.
  assert.deepEqual(host.breaks, []);
});

test('user translations and other Binance databases open natively', t => {
  // Given the block is installed.
  const host = factoryView(t);

  // When translation resources, chart storage and an unrelated store are opened, one with an extra argument.
  const requests = ['pika-i18n-zh-CN', 'i18n-data-zh-CN', 'chart_futures', 'futures-trade-ui'].map(name => host.indexedDB.open(name, 3, 'extra'));

  // Then each reaches the native method with its receiver, every argument and its result.
  assert.deepEqual(host.opened, ['pika-i18n-zh-CN', 'i18n-data-zh-CN', 'chart_futures', 'futures-trade-ui'].map(name => [name, 3, 'extra']));
  assert.deepEqual(requests.map(request => request.name), ['pika-i18n-zh-CN', 'i18n-data-zh-CN', 'chart_futures', 'futures-trade-ui']);
  assert.ok(requests.every(request => request.receiver === host.indexedDB));
  assert.deepEqual(host.block.snapshot(), { blocked: 0 });
  assert.deepEqual(host.breaks, []);
});

test('user is alerted once when the usage telemetry moves to a renamed database', async t => {
  // Given the block is installed.
  const host = factoryView(t);

  // When Binance opens a usage-like database under a new name twice.
  host.indexedDB.open('pika-i18n_usage-v2', 1);
  host.indexedDB.open('pika-i18n_usage-v2', 1);
  await Promise.resolve();

  // Then it still opens natively and the rename is reported once.
  assert.equal(host.opened.length, 2);
  assert.deepEqual(host.breaks.map(({ reason, detail }) => [reason, detail]), [
    ['usage-db-name', 'Usage-like database opened under a new name: pika-i18n_usage-v2'],
  ]);
});

test('user is alerted when Binance no longer opens the usage database at all', async t => {
  // Given a page whose usage telemetry still defines its debug hook but never opens the database.
  const host = factoryView(t);
  host.view.__getActiveI18nKeys = () => [];

  // When the expected-open window closes without any blocked open.
  host.elapse();
  await Promise.resolve();

  // Then the silent bypass is reported with the hook state.
  assert.deepEqual(host.breaks.map(({ reason }) => reason), ['usage-db-missing']);
  assert.match(host.breaks[0].detail, /No pika-i18n-usage open within 120 s \(Binance usage debug hook present\)/);
});

test('user page gets the native open result before the alert handler runs', async t => {
  // Given a contract break handler that records whether open had already returned.
  let returned = false;
  const seen = [];
  const host = factoryView(t, { onContractBreak: entry => seen.push([entry.reason, returned]) });

  // When a renamed usage database is opened.
  const request = host.indexedDB.open('pika-i18n-usage-v2', 1);
  returned = true;
  await Promise.resolve();

  // Then open returned the native request first, so a failing handler cannot affect Binance's call.
  assert.equal(request.name, 'pika-i18n-usage-v2');
  assert.deepEqual(seen, [['usage-db-name', true]]);
  assert.deepEqual(host.block.breaks().map(({ reason }) => reason), ['usage-db-name']);
  host.breaks.push(...host.block.breaks());
});
