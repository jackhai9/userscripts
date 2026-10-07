import { test, expect } from '../test.js';
import { openStorageLab, STORAGE_LAB_ORIGIN } from '../helpers/chart-storage-lab.js';
import { openMirrorWriterLab, holdMirrorWriteLock, releaseMirrorWriteLock } from '../helpers/chart-storage-mirror-writer.js';

test('user mirrors changed and missing values atomically while preserving equal values native APIs and copied input', async ({ page }) => {
  // Given a ready native target has equal, changed, explicit-null and target-only records.
  await openMirrorWriterLab(page);
  await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    const state = window.__MIRROR_WRITER__;
    await Promise.all([
      lab.native.setItem('myTradingView.equal', { b: [2, null], a: 1 }),
      lab.native.setItem('myTradingView.changed', { revision: 0 }),
      lab.native.setItem('#TV_SYMBOL-NULL', null),
      lab.native.setItem('#TV_SYMBOL-TARGET-ONLY', ['keep']),
      lab.native.setItem('candlestick-setting', { theme: 'target' }),
    ]);
    state.methods = Object.fromEntries(['setItem', 'getItem', 'clear', 'ready', 'createInstance'].map(name => [name, lab.native[name]]));
    state.factory = lab.localforage.createInstance;
    state.beforeOwnKeys = Reflect.ownKeys(lab.native);
    window.__STORAGE_NATIVE__.reset();
  });

  // When the caller mutates its input immediately after dispatch and repeats the null batch.
  const result = await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    const state = window.__MIRROR_WRITER__;
    const changed = { revision: 1, charts: [{ symbol: 'BTCUSDT' }] };
    const entries = [
      ['myTradingView.equal', { a: 1, b: [2, null] }],
      ['myTradingView.changed', changed], ['#TV_SYMBOL-NULL', null], ['#TV_SYMBOL-MISSING', null],
    ];
    const before = JSON.stringify(entries);
    const dispatched = state.writer.dispatch(lab.native, entries, state.nativeThunk);
    const unchangedByDispatch = JSON.stringify(entries) === before;
    changed.revision = 99;
    changed.charts[0].symbol = 'ETHUSDT';
    entries[0][0] = 'myTradingView.caller-mutated';
    const outcomes = await Promise.allSettled(dispatched);
    const first = window.__STORAGE_NATIVE__.snapshot();
    const repeated = await Promise.allSettled(state.writer.dispatch(lab.native, [
      ['#TV_SYMBOL-NULL', null], ['#TV_SYMBOL-MISSING', null],
    ], state.nativeThunk));
    const metrics = window.__STORAGE_NATIVE__.snapshot();
    const persisted = await Promise.all(['myTradingView.equal', 'myTradingView.changed', '#TV_SYMBOL-NULL', '#TV_SYMBOL-MISSING', '#TV_SYMBOL-TARGET-ONLY', 'candlestick-setting'].map(key => lab.native.getItem(key)));
    return {
      outcomes, repeated, first, metrics, persisted, keys: (await lab.native.keys()).sort(),
      unchangedByDispatch, callerValue: changed, nativeCalls: state.nativeCalls, stats: state.writer.getStats(),
      equalKeyOrder: Object.keys(persisted[0]),
      identity: state.factory === lab.localforage.createInstance && Object.entries(state.methods).every(([name, method]) => lab.native[name] === method),
      ownKeysUnchanged: JSON.stringify(Reflect.ownKeys(lab.native)) === JSON.stringify(state.beforeOwnKeys),
    };
  });

  // Then one transaction per batch changes only two keys and keeps native identity and caller ownership.
  expect(result.outcomes).toEqual([{ status: 'fulfilled', value: undefined }]);
  expect(result.repeated).toEqual([{ status: 'fulfilled', value: undefined }]);
  expect(result.first).toMatchObject({ transactions: 1, completed: 1, puts: 2, pending: 0 });
  expect(result.metrics).toMatchObject({ transactions: 2, completed: 2, puts: 2, pending: 0 });
  expect(result.persisted).toEqual([{ b: [2, null], a: 1 }, { revision: 1, charts: [{ symbol: 'BTCUSDT' }] }, null, null, ['keep'], { theme: 'target' }]);
  expect(result.keys).toEqual(['#TV_SYMBOL-MISSING', '#TV_SYMBOL-NULL', '#TV_SYMBOL-TARGET-ONLY', 'candlestick-setting', 'myTradingView.changed', 'myTradingView.equal']);
  expect(result.equalKeyOrder).toEqual(['b', 'a']);
  expect(result.unchangedByDispatch).toBe(true);
  expect(result.callerValue).toEqual({ revision: 99, charts: [{ symbol: 'ETHUSDT' }] });
  expect(result.identity).toBe(true);
  expect(result.ownKeysUnchanged).toBe(true);
  expect(result.nativeCalls).toBe(0);
  expect(result.stats).toMatchObject({ acceptedBatches: 2, committedWrites: 2, skippedWrites: 4, pendingBatches: 0, pendingBytes: 0 });
});

test('user receives one rejected bulk result and keeps every original record after a real second-put abort', async ({ page }) => {
  // Given two committed records and a native observer that aborts after the second successful put.
  await openMirrorWriterLab(page);
  await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    await lab.native.setItem('myTradingView.A', { revision: 0 });
    await lab.native.setItem('myTradingView.B', { revision: 0 });
    const nativePut = IDBObjectStore.prototype.put;
    let puts = 0;
    window.__MIRROR_WRITER__.restorePut = () => { IDBObjectStore.prototype.put = nativePut; };
    IDBObjectStore.prototype.put = function (...args) {
      const request = Reflect.apply(nativePut, this, args);
      if (this.transaction.db.name === 'chart_futures' && ++puts === 2) {
        request.addEventListener('success', () => this.transaction.abort(), { once: true });
      }
      return request;
    };
    window.__STORAGE_NATIVE__.reset();
  });

  // When both replacements have executed within one transaction before its real abort event.
  const result = await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    const state = window.__MIRROR_WRITER__;
    const outcomes = await Promise.allSettled(state.writer.dispatch(lab.native, [
      ['myTradingView.A', { revision: 1 }], ['myTradingView.B', { revision: 1 }],
    ], state.nativeThunk));
    state.restorePut();
    await state.writer.stop();
    return {
      outcomes: outcomes.map(outcome => ({ status: outcome.status, name: outcome.reason?.name })),
      metrics: window.__STORAGE_NATIVE__.snapshot(), stats: state.writer.getStats(), nativeCalls: state.nativeCalls,
      persisted: await Promise.all(['A', 'B'].map(key => lab.native.getItem(`myTradingView.${key}`))),
    };
  });

  // Then the abort rolls back both successful puts and the original native expression is never retried.
  expect(result.outcomes).toEqual([{ status: 'rejected', name: 'AbortError' }]);
  expect(result.persisted).toEqual([{ revision: 0 }, { revision: 0 }]);
  expect(result.metrics).toMatchObject({ transactions: 1, puts: 2, completed: 0, aborted: 1, pending: 0 });
  expect(result.stats).toMatchObject({ acceptedBatches: 1, failedBatches: 1, committedWrites: 0, pendingBatches: 0, pendingBytes: 0 });
  expect(result.nativeCalls).toBe(0);
});

test('user keeps the first replacement rolled back when the second record exceeds the real origin quota', async ({ page, context }) => {
  // Given the isolated origin has a real quota before its first IndexedDB initialization.
  await openMirrorWriterLab(page);
  const session = await context.newCDPSession(page);
  try {
    await session.send('Storage.overrideQuotaForOrigin', { origin: STORAGE_LAB_ORIGIN, quotaSize: 64 * 1024 });
    const quota = await session.send('Storage.getUsageAndQuota', { origin: STORAGE_LAB_ORIGIN });
    expect(quota.overrideActive).toBe(true);
    expect(quota.quota).toBe(64 * 1024);
    await page.evaluate(async () => {
      const lab = window.__STORAGE_LAB__;
      await lab.native.setItem('myTradingView.small', { revision: 0 });
      await lab.native.setItem('myTradingView.large', { revision: 0 });
      window.__STORAGE_NATIVE__.reset();
    });

    // When an earlier small put shares a transaction with an incompressible one-MiB value.
    const result = await page.evaluate(async () => {
      const lab = window.__STORAGE_LAB__;
      const state = window.__MIRROR_WRITER__;
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
      const large = Array.from({ length: 16 }, () => Array.from(crypto.getRandomValues(new Uint8Array(65536)), byte => alphabet[byte & 63]).join('')).join('');
      const outcomes = await Promise.allSettled(state.writer.dispatch(lab.native, [
        ['myTradingView.small', { revision: 1 }], ['myTradingView.large', large],
      ], state.nativeThunk));
      return {
        outcomes: outcomes.map(outcome => ({ status: outcome.status, name: outcome.reason?.name })),
        metrics: window.__STORAGE_NATIVE__.snapshot(), stats: state.writer.getStats(), nativeCalls: state.nativeCalls,
        persisted: await Promise.all(['small', 'large'].map(key => lab.native.getItem(`myTradingView.${key}`))),
      };
    });

    // Then Chromium reports its real quota failure and neither record commits or replays.
    expect(result.outcomes).toEqual([{ status: 'rejected', name: 'QuotaExceededError' }]);
    expect(result.persisted).toEqual([{ revision: 0 }, { revision: 0 }]);
    expect(result.metrics).toMatchObject({ transactions: 1, puts: 2, completed: 0, aborted: 1, pending: 0 });
    expect(result.stats).toMatchObject({ failedBatches: 1, committedWrites: 0, pendingBatches: 0, pendingBytes: 0 });
    expect(result.nativeCalls).toBe(0);
  } finally {
    await session.send('Storage.overrideQuotaForOrigin', { origin: STORAGE_LAB_ORIGIN });
    await session.detach();
  }
});

test('user retains native clear transaction ordering while a mirror batch waits for the real write lock', async ({ page }) => {
  // Given a native transaction holds the target lock and all later transaction creation is observed.
  await openMirrorWriterLab(page);
  await page.evaluate(async () => { await window.__STORAGE_LAB__.native.setItem('myTradingView.initial', 0); });
  await holdMirrorWriteLock(page);
  await page.evaluate(() => {
    const state = window.__MIRROR_WRITER__;
    const nativeTransaction = IDBDatabase.prototype.transaction;
    const nativeClear = IDBObjectStore.prototype.clear;
    state.created = [];
    state.completed = [];
    const ids = new WeakMap();
    IDBDatabase.prototype.transaction = function (...args) {
      const transaction = Reflect.apply(nativeTransaction, this, args);
      if (this.name === 'chart_futures') {
        const id = state.created.length + 1;
        ids.set(transaction, id);
        state.created.push({ id, mode: transaction.mode, clear: false });
        transaction.addEventListener('complete', () => state.completed.push(id), { once: true });
      }
      return transaction;
    };
    IDBObjectStore.prototype.clear = function (...args) {
      state.created.find(entry => entry.id === ids.get(this.transaction)).clear = true;
      return Reflect.apply(nativeClear, this, args);
    };
    state.restoreObservation = () => {
      IDBDatabase.prototype.transaction = nativeTransaction;
      IDBObjectStore.prototype.clear = nativeClear;
    };
    window.__STORAGE_NATIVE__.reset();
    state.first = Promise.all(state.writer.dispatch(window.__STORAGE_LAB__.native, [['myTradingView.before', 1]], state.nativeThunk));
  });
  await expect.poll(() => page.evaluate(() => window.__MIRROR_WRITER__.created.length)).toBe(1);

  // When native clear creates its own transaction before the lock releases and a later bulk is admitted.
  let blocked;
  try {
    await page.evaluate(() => { window.__MIRROR_WRITER__.cleared = window.__STORAGE_LAB__.native.clear(); });
    await expect.poll(() => page.evaluate(() => window.__MIRROR_WRITER__.created.length)).toBe(2);
    await page.evaluate(() => {
      const state = window.__MIRROR_WRITER__;
      state.last = Promise.all(state.writer.dispatch(window.__STORAGE_LAB__.native, [['myTradingView.after', 2]], state.nativeThunk));
    });
    await expect.poll(() => page.evaluate(() => window.__MIRROR_WRITER__.created.length)).toBe(3);
    blocked = await page.evaluate(() => ({ created: window.__MIRROR_WRITER__.created, completed: window.__MIRROR_WRITER__.completed }));
  } finally {
    await releaseMirrorWriteLock(page);
  }
  const result = await page.evaluate(async () => {
    const state = window.__MIRROR_WRITER__;
    const outcomes = await Promise.all([state.first, state.cleared, state.last]);
    state.restoreObservation();
    return { outcomes, completed: state.completed, nativeCalls: state.nativeCalls, keys: await window.__STORAGE_LAB__.native.keys() };
  });

  // Then all three native transactions exist while blocked and commit in their creation order.
  expect(blocked).toEqual({ created: [{ id: 1, mode: 'readwrite', clear: false }, { id: 2, mode: 'readwrite', clear: true }, { id: 3, mode: 'readwrite', clear: false }], completed: [] });
  expect(result.completed).toEqual([1, 2, 3]);
  expect(result.outcomes).toEqual([[undefined], undefined, [undefined]]);
  expect(result.keys).toEqual(['myTradingView.after']);
  expect(result.nativeCalls).toBe(0);
});

test('user compares current target data after another tab replaces an earlier mirrored value', async ({ page, context }) => {
  // Given one writer has committed a value and another real page shares its IndexedDB origin.
  await openMirrorWriterLab(page);
  const other = await context.newPage();
  try {
    await openStorageLab(other, { install: false });
    await page.evaluate(async () => {
      const state = window.__MIRROR_WRITER__;
      await Promise.all(state.writer.dispatch(window.__STORAGE_LAB__.native, [['myTradingView.shared', { revision: 1 }]], state.nativeThunk));
    });

    // When the other page changes storage and the first page requests its original value again.
    await other.evaluate(async () => { await window.__STORAGE_LAB__.native.setItem('myTradingView.shared', { revision: 2 }); });
    const result = await page.evaluate(async () => {
      const state = window.__MIRROR_WRITER__;
      window.__STORAGE_NATIVE__.reset();
      await Promise.all(state.writer.dispatch(window.__STORAGE_LAB__.native, [['myTradingView.shared', { revision: 1 }]], state.nativeThunk));
      return { metrics: window.__STORAGE_NATIVE__.snapshot(), nativeCalls: state.nativeCalls };
    });
    const persisted = await other.evaluate(() => window.__STORAGE_LAB__.native.getItem('myTradingView.shared'));

    // Then the writer reads the shared target again and restores it with one actual put.
    expect(result.metrics).toMatchObject({ transactions: 1, gets: 1, puts: 1, completed: 1 });
    expect(persisted).toEqual({ revision: 1 });
    expect(result.nativeCalls).toBe(0);
  } finally {
    await other.close();
  }
});

test('user stops at a fixed accepted-work fence while native clear and later mirror thunks remain independent', async ({ page }) => {
  // Given one accepted mirror waits behind an actual write lock.
  await openMirrorWriterLab(page);
  await page.evaluate(async () => { await window.__STORAGE_LAB__.native.ready(); });
  await holdMirrorWriteLock(page);
  await page.evaluate(() => {
    const state = window.__MIRROR_WRITER__;
    window.__STORAGE_NATIVE__.reset();
    state.accepted = Promise.all(state.writer.dispatch(window.__STORAGE_LAB__.native, [['myTradingView.accepted', 1]], state.nativeThunk));
  });
  await expect.poll(() => page.evaluate(() => window.__STORAGE_NATIVE__.snapshot().transactions)).toBe(1);

  // When stop defers new thunks but a native clear still creates a transaction immediately.
  let blocked;
  try {
    await page.evaluate(() => {
      const state = window.__MIRROR_WRITER__;
      state.events = [];
      state.stopping = state.writer.stop();
      state.sameStop = state.writer.stop() === state.stopping;
      state.stopping.then(() => state.events.push('stopped'));
      state.tail = Promise.all(state.writer.dispatch(window.__STORAGE_LAB__.native, [['myTradingView.tail', 2]], () => {
        state.events.push('native-thunk');
        return [new Promise(resolve => { state.releaseTail = resolve; })];
      })).then(value => { state.events.push('tail-complete'); return value; });
      state.cleared = window.__STORAGE_LAB__.native.clear();
    });
    await expect.poll(() => page.evaluate(() => window.__STORAGE_NATIVE__.snapshot().transactions)).toBe(2);
    blocked = await page.evaluate(() => ({ events: window.__MIRROR_WRITER__.events, stats: window.__MIRROR_WRITER__.writer.getStats(), metrics: window.__STORAGE_NATIVE__.snapshot() }));
  } finally {
    await releaseMirrorWriteLock(page);
  }
  const result = await page.evaluate(async () => {
    const state = window.__MIRROR_WRITER__;
    const accepted = await state.accepted;
    await state.stopping;
    await state.cleared;
    const atFence = [...state.events];
    const nativeResult = [Promise.resolve('native-result')];
    let calls = 0;
    const exact = state.writer.dispatch(null, null, () => { calls += 1; return nativeResult; });
    state.releaseTail('tail-result');
    return {
      accepted, atFence, tail: await state.tail, events: state.events, sameStop: state.sameStop,
      exactArray: exact === nativeResult, exactPromise: exact[0] === nativeResult[0], calls,
      stoppedResult: await Promise.all(exact), stats: state.writer.getStats(), keys: await window.__STORAGE_LAB__.native.keys(),
    };
  });

  // Then stop resolves without waiting for the tail and stopped dispatch returns the exact native array.
  expect(blocked.events).toEqual([]);
  expect(blocked.stats).toMatchObject({ acceptedBatches: 1, pendingBatches: 1 });
  expect(blocked.metrics).toMatchObject({ transactions: 2, completed: 0, pending: 2 });
  expect(result.accepted).toEqual([undefined]);
  expect(result.atFence).toEqual(['stopped', 'native-thunk']);
  expect(result.tail).toEqual([['tail-result']]);
  expect(result.events).toEqual(['stopped', 'native-thunk', 'tail-complete']);
  expect(result.sameStop).toBe(true);
  expect(result.exactArray).toBe(true);
  expect(result.exactPromise).toBe(true);
  expect(result.calls).toBe(1);
  expect(result.stoppedResult).toEqual(['native-result']);
  expect(result.keys).toEqual([]);
  expect(result.stats).toMatchObject({ acceptedBatches: 1, pendingBatches: 0, pendingBytes: 0 });
});

test('user drains a blocked database initialization while unrelated raw native writes stay available', async ({ page }) => {
  // Given an external version-one connection blocks the target native version-two initialization.
  await openMirrorWriterLab(page);
  await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    const state = window.__MIRROR_WRITER__;
    await lab.native.ready();
    state.blocker = await new Promise((resolve, reject) => {
      const request = indexedDB.open('chart_delivery', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('keyvaluepairs');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const nativeOpen = IDBFactory.prototype.open;
    let resolveBlocked;
    state.blocked = new Promise(resolve => { resolveBlocked = resolve; });
    IDBFactory.prototype.open = function (...args) {
      const request = Reflect.apply(nativeOpen, this, args);
      if (args[0] === 'chart_delivery' && args[1] === 2) request.addEventListener('blocked', event => resolveBlocked({ oldVersion: event.oldVersion, newVersion: event.newVersion }), { once: true });
      return request;
    };
    state.restoreOpen = () => { IDBFactory.prototype.open = nativeOpen; };
    state.target = lab.create('chart_delivery', { version: 2 });
    state.accepted = Promise.all(state.writer.dispatch(state.target, [['myTradingView.upgrade', 1]], state.nativeThunk));
  });

  // When stop waits for accepted initialization while a raw source write completes and a mirror tail waits.
  let blocked;
  try {
    blocked = await page.evaluate(async () => {
      const state = window.__MIRROR_WRITER__;
      const version = await state.blocked;
      state.events = [];
      state.stopping = state.writer.stop();
      state.stopping.then(() => state.events.push('stopped'));
      state.tail = Promise.all(state.writer.dispatch(state.target, [['myTradingView.upgrade', 2]], () => {
        state.events.push('native-thunk');
        return [state.target.setItem('myTradingView.upgrade', 2)];
      }));
      const raw = await window.__STORAGE_LAB__.native.setItem('myTradingView.raw', 3);
      return { version, raw, events: [...state.events], stats: state.writer.getStats() };
    });
  } finally {
    await page.evaluate(() => { const state = window.__MIRROR_WRITER__; state.restoreOpen(); state.blocker.close(); });
  }
  const result = await page.evaluate(async () => {
    const state = window.__MIRROR_WRITER__;
    const accepted = await state.accepted;
    await state.stopping;
    return { accepted, tail: await state.tail, events: state.events, stats: state.writer.getStats(), persisted: await state.target.getItem('myTradingView.upgrade') };
  });

  // Then independent native work succeeds before the drain and the accepted write precedes its native tail.
  expect(blocked.version).toEqual({ oldVersion: 1, newVersion: 2 });
  expect(blocked.raw).toBe(3);
  expect(blocked.events).toEqual([]);
  expect(blocked.stats).toMatchObject({ acceptedBatches: 1, pendingBatches: 1, transactions: 0 });
  expect(result.accepted).toEqual([undefined]);
  expect(result.tail).toEqual([[2]]);
  expect(result.events).toEqual(['stopped', 'native-thunk']);
  expect(result.persisted).toBe(2);
  expect(result.stats).toMatchObject({ acceptedBatches: 1, pendingBatches: 0, pendingBytes: 0, committedWrites: 1 });
});

test('user dispatches an empty mirror without initializing the native target or opening a transaction', async ({ page }) => {
  // Given the native instance has never needed a database connection.
  await openMirrorWriterLab(page);
  await page.evaluate(() => { window.__STORAGE_NATIVE__.reset(); });

  // When active dispatch receives zero source entries and stop drains the empty writer.
  const result = await page.evaluate(async () => {
    const state = window.__MIRROR_WRITER__;
    const target = window.__STORAGE_LAB__.native;
    const beforeReady = target._ready;
    const dispatched = state.writer.dispatch(target, [], state.nativeThunk);
    await state.writer.stop();
    return { length: dispatched.length, unchangedReady: target._ready === beforeReady, hasDatabase: Boolean(target._dbInfo?.db), metrics: window.__STORAGE_NATIVE__.snapshot(), stats: state.writer.getStats(), nativeCalls: state.nativeCalls };
  });

  // Then the empty array costs no ready initialization, database open, transaction or accepted batch.
  expect(result.length).toBe(0);
  expect(result.unchangedReady).toBe(true);
  expect(result.hasDatabase).toBe(false);
  expect(result.metrics).toMatchObject({ opens: 0, transactions: 0, puts: 0, gets: 0 });
  expect(result.stats).toMatchObject({ acceptedBatches: 0, rejectedBatches: 0, pendingBatches: 0, pendingBytes: 0 });
  expect(result.nativeCalls).toBe(0);
});

for (const scenario of [
  { name: 'entry count', limits: { maxEntries: 1 }, kind: 'entries', error: /entry limit/ },
  { name: 'encoded batch bytes', limits: { maxBatchBytes: 32 }, kind: 'bytes', error: /batch byte limit/ },
  { name: 'duplicate keys', limits: {}, kind: 'duplicate', error: /unique/ },
  { name: 'non-chart keys', limits: {}, kind: 'key', error: /non-chart key/ },
  { name: 'non-JSON values', limits: {}, kind: 'value', error: /plain JSON/ },
  { name: 'invalid pair shape', limits: {}, kind: 'pair', error: /key\/value pair/ },
]) {
  test(`user rejects ${scenario.name} before any mirror entry is written`, async ({ page }) => {
    // Given a committed first key would visibly change if admission wrote a partial batch.
    await openMirrorWriterLab(page, { limits: scenario.limits });
    await page.evaluate(async () => {
      await window.__STORAGE_LAB__.native.setItem('myTradingView.first', 0);
      window.__STORAGE_NATIVE__.reset();
    });

    // When a valid first entry precedes the specified invalid or oversized entry.
    const result = await page.evaluate(async kind => {
      const state = window.__MIRROR_WRITER__;
      const first = ['myTradingView.first', 1];
      const second = {
        entries: ['myTradingView.second', 2], bytes: ['myTradingView.second', 'x'.repeat(64)],
        duplicate: ['myTradingView.first', 2], key: ['candlestick-setting', 2],
        value: ['myTradingView.second', new Date(0)], pair: ['myTradingView.second'],
      }[kind];
      const outcomes = await Promise.allSettled(state.writer.dispatch(window.__STORAGE_LAB__.native, [first, second], state.nativeThunk));
      return {
        outcomes: outcomes.map(outcome => ({ status: outcome.status, message: outcome.reason?.message })),
        metrics: window.__STORAGE_NATIVE__.snapshot(), stats: state.writer.getStats(), nativeCalls: state.nativeCalls,
        first: await window.__STORAGE_LAB__.native.getItem('myTradingView.first'), keys: await window.__STORAGE_LAB__.native.keys(),
      };
    }, scenario.kind);

    // Then the one rejected result preserves original data without opening a transaction or retrying.
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0].status).toBe('rejected');
    expect(result.outcomes[0].message).toMatch(scenario.error);
    expect(result.first).toBe(0);
    expect(result.keys).toEqual(['myTradingView.first']);
    expect(result.metrics).toMatchObject({ opens: 0, transactions: 0, puts: 0 });
    expect(result.stats).toMatchObject({ acceptedBatches: 0, rejectedBatches: 1, pendingBatches: 0, pendingBytes: 0 });
    expect(result.nativeCalls).toBe(0);
  });
}

for (const kind of ['batches', 'bytes']) {
  test(`user rejects pending ${kind} overflow without disturbing the accepted mirror`, async ({ page }) => {
    // Given a real lock holds one batch inside the configured pending capacity.
    const limits = kind === 'batches' ? { maxPendingBatches: 1 } : { maxPendingBytes: 48 };
    await openMirrorWriterLab(page, { limits });
    await page.evaluate(async () => { await window.__STORAGE_LAB__.native.ready(); });
    await holdMirrorWriteLock(page);
    await page.evaluate(() => {
      const state = window.__MIRROR_WRITER__;
      window.__STORAGE_NATIVE__.reset();
      state.accepted = Promise.all(state.writer.dispatch(window.__STORAGE_LAB__.native, [['myTradingView.first', 1]], state.nativeThunk));
    });
    await expect.poll(() => page.evaluate(() => window.__STORAGE_NATIVE__.snapshot().transactions)).toBe(1);

    // When another valid batch exceeds the pending bound while the first transaction cannot finish.
    let rejected;
    try {
      rejected = await page.evaluate(async () => {
        const state = window.__MIRROR_WRITER__;
        const outcomes = await Promise.allSettled(state.writer.dispatch(window.__STORAGE_LAB__.native, [['myTradingView.second', 2]], state.nativeThunk));
        return { outcomes: outcomes.map(outcome => ({ status: outcome.status, message: outcome.reason?.message })), metrics: window.__STORAGE_NATIVE__.snapshot(), stats: state.writer.getStats() };
      });
    } finally {
      await releaseMirrorWriteLock(page);
    }
    const result = await page.evaluate(async () => {
      const state = window.__MIRROR_WRITER__;
      return { accepted: await state.accepted, keys: await window.__STORAGE_LAB__.native.keys(), stats: state.writer.getStats(), nativeCalls: state.nativeCalls };
    });

    // Then only the first batch owns a transaction and its successful commit releases all capacity.
    expect(rejected.outcomes).toHaveLength(1);
    expect(rejected.outcomes[0].status).toBe('rejected');
    expect(rejected.outcomes[0].message).toMatch(kind === 'batches' ? /pending batch limit/ : /pending byte limit/);
    expect(rejected.metrics).toMatchObject({ transactions: 1, puts: 0 });
    expect(rejected.stats).toMatchObject({ acceptedBatches: 1, rejectedBatches: 1, pendingBatches: 1 });
    expect(result.accepted).toEqual([undefined]);
    expect(result.keys).toEqual(['myTradingView.first']);
    expect(result.stats).toMatchObject({ acceptedBatches: 1, rejectedBatches: 1, pendingBatches: 0, pendingBytes: 0 });
    expect(result.nativeCalls).toBe(0);
  });
}

test('user rejects a Proxy value that stops admission during validation without replaying its native thunk', async ({ page }) => {
  // Given no active work exists and the native target is already ready.
  await openMirrorWriterLab(page);
  await page.evaluate(async () => { await window.__STORAGE_LAB__.native.ready(); window.__STORAGE_NATIVE__.reset(); });

  // When synchronous object inspection invokes stop before the batch can be admitted.
  const result = await page.evaluate(async () => {
    const state = window.__MIRROR_WRITER__;
    let stopping;
    let inspections = 0;
    const value = new Proxy({ revision: 1 }, {
      getPrototypeOf(target) {
        inspections += 1;
        stopping = state.writer.stop();
        return Reflect.getPrototypeOf(target);
      },
    });
    const outcomes = await Promise.allSettled(state.writer.dispatch(window.__STORAGE_LAB__.native, [['myTradingView.reentrant', value]], state.nativeThunk));
    await stopping;
    return { outcomes: outcomes.map(outcome => ({ status: outcome.status, message: outcome.reason?.message })), inspections, metrics: window.__STORAGE_NATIVE__.snapshot(), stats: state.writer.getStats(), nativeCalls: state.nativeCalls, keys: await window.__STORAGE_LAB__.native.keys() };
  });

  // Then reentrant stop rejects admission before any put and no active failure replays natively.
  expect(result.inspections).toBeGreaterThan(0);
  expect(result.outcomes).toEqual([{ status: 'rejected', message: 'Chart mirror admission stopped during validation' }]);
  expect(result.metrics).toMatchObject({ transactions: 0, puts: 0 });
  expect(result.stats).toMatchObject({ acceptedBatches: 0, rejectedBatches: 1, pendingBatches: 0, pendingBytes: 0 });
  expect(result.nativeCalls).toBe(0);
  expect(result.keys).toEqual([]);
});

test('user rolls back earlier replacements when a later stored value exceeds the read budget', async ({ page }) => {
  // Given native storage contains a small first value and a second value larger than the mirror read bound.
  await openMirrorWriterLab(page, { limits: { maxReadBytes: 64 } });
  await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    await lab.native.setItem('myTradingView.first', { revision: 0 });
    await lab.native.setItem('myTradingView.large', 'x'.repeat(128));
    window.__STORAGE_NATIVE__.reset();
  });

  // When the first replacement succeeds inside the transaction before the oversized value is read.
  const result = await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    const state = window.__MIRROR_WRITER__;
    const outcomes = await Promise.allSettled(state.writer.dispatch(lab.native, [
      ['myTradingView.first', { revision: 1 }], ['myTradingView.large', 'small'],
    ], state.nativeThunk));
    return {
      outcomes: outcomes.map(outcome => ({ status: outcome.status, message: outcome.reason?.message })),
      metrics: window.__STORAGE_NATIVE__.snapshot(), stats: state.writer.getStats(), nativeCalls: state.nativeCalls,
      persisted: await Promise.all(['first', 'large'].map(key => lab.native.getItem(`myTradingView.${key}`))),
    };
  });

  // Then the explicit read-limit failure aborts all changes and preserves both original native values.
  expect(result.outcomes).toEqual([{ status: 'rejected', message: 'Mirror stored-value byte limit exceeded' }]);
  expect(result.persisted).toEqual([{ revision: 0 }, 'x'.repeat(128)]);
  expect(result.metrics).toMatchObject({ transactions: 1, gets: 2, puts: 1, aborted: 1, completed: 0, pending: 0 });
  expect(result.stats).toMatchObject({ acceptedBatches: 1, failedBatches: 1, committedWrites: 0, pendingBatches: 0, pendingBytes: 0 });
  expect(result.nativeCalls).toBe(0);
});
