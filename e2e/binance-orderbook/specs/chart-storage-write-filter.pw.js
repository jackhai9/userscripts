import { test, expect } from '../test.js';
import { STORAGE_LAB_ORIGIN } from '../helpers/chart-storage-lab.js';
import { holdMirrorWriteLock, releaseMirrorWriteLock } from '../helpers/chart-storage-mirror-writer.js';
import { openChartWriteFilterLab } from '../helpers/chart-storage-write-filter.js';

test('user keeps stored chart records unchanged while repeated identical saves write nothing', async ({ page }) => {
  // Given stored drawings for 109 symbols and a layout record, as Binance keeps them.
  await openChartWriteFilterLab(page);
  await page.evaluate(async () => {
    const target = window.__STORAGE_LAB__.native;
    await Promise.all(Array.from({ length: 109 }, (_, index) => target.setItem(`#TV_SYMBOL-S${index}USDT@PRICETYPE=LAST`, [{ id: `line-${index}`, points: [1, -0, 2] }])));
    await target.setItem('myTradingView.layout', { charts: [{ panes: [{ sources: [{ type: 'MainSeries' }] }] }] });
    window.__WRITE_FILTER__.reset();
  });

  // When ten chart saves each rewrite every record with the same values.
  const result = await page.evaluate(async () => {
    const target = window.__STORAGE_LAB__.native;
    for (let save = 0; save < 10; save += 1) {
      await Promise.all([
        ...Array.from({ length: 109 }, (_, index) => target.setItem(`#TV_SYMBOL-S${index}USDT@PRICETYPE=LAST`, [{ id: `line-${index}`, points: [1, -0, 2] }])),
        target.setItem('myTradingView.layout', { charts: [{ panes: [{ sources: [{ type: 'MainSeries' }] }] }] }),
      ]);
    }
    const native = window.__STORAGE_NATIVE__.snapshot();
    const filter = window.__WRITE_FILTER__.delta();
    const stored = await target.getItem('#TV_SYMBOL-S7USDT@PRICETYPE=LAST');
    return { native, filter, stored, signedZero: Object.is(stored[0].points[1], -0), keys: (await target.keys()).length };
  });

  // Then every save completes from reads alone and the stored values are untouched.
  expect(result.native).toMatchObject({ puts: 0, aborted: 0, transactions: 1100, completed: 1100 });
  expect(result.filter).toEqual({ compared: 1100, skipped: 1100, written: 0, unreadable: 0 });
  expect(result.stored).toEqual([{ id: 'line-7', points: [1, -0, 2] }]);
  expect(result.signedZero).toBe(true);
  expect(result.keys).toBe(110);
});

test('user persists changed, new, reordered and cleared chart records exactly once', async ({ page }) => {
  // Given existing drawings, a layout with ordered keys and a record holding a value.
  await openChartWriteFilterLab(page);
  await page.evaluate(async () => {
    const target = window.__STORAGE_LAB__.native;
    await target.setItem('#TV_SYMBOL-BTCUSDT', [{ id: 'a', price: 0 }]);
    await target.setItem('myTradingView.order', { a: 1, b: 2 });
    await target.setItem('#TV_SYMBOL-ETHUSDT', [{ id: 'e' }]);
    window.__WRITE_FILTER__.reset();
  });

  // When a save changes a value, adds a symbol, reorders keys, clears a record and repeats a cleared record.
  const result = await page.evaluate(async () => {
    const target = window.__STORAGE_LAB__.native;
    await target.setItem('#TV_SYMBOL-BTCUSDT', [{ id: 'a', price: -0 }]);
    await target.setItem('#TV_SYMBOL-SOLUSDT', []);
    await target.setItem('myTradingView.order', { b: 2, a: 1 });
    await target.setItem('#TV_SYMBOL-ETHUSDT', null);
    const afterClear = window.__STORAGE_NATIVE__.snapshot().puts;
    await target.setItem('#TV_SYMBOL-ETHUSDT', null);
    await target.setItem('#TV_SYMBOL-NEWUSDT', null);
    const native = window.__STORAGE_NATIVE__.snapshot();
    const filter = window.__WRITE_FILTER__.delta();
    return {
      afterClear, native, filter,
      btcSignedZero: Object.is((await target.getItem('#TV_SYMBOL-BTCUSDT'))[0].price, -0),
      sol: await target.getItem('#TV_SYMBOL-SOLUSDT'),
      orderKeys: Object.keys(await target.getItem('myTradingView.order')),
      eth: await target.getItem('#TV_SYMBOL-ETHUSDT'),
      keys: (await target.keys()).sort(),
    };
  });

  // Then each real difference is written, the repeated clear is skipped and a missing key is created.
  expect(result.afterClear).toBe(4);
  expect(result.native).toMatchObject({ puts: 5, aborted: 0 });
  expect(result.filter).toEqual({ compared: 6, skipped: 1, written: 5, unreadable: 0 });
  expect(result.btcSignedZero).toBe(true);
  expect(result.sol).toEqual([]);
  expect(result.orderKeys).toEqual(['b', 'a']);
  expect(result.eth).toBeNull();
  expect(result.keys).toEqual(['#TV_SYMBOL-BTCUSDT', '#TV_SYMBOL-ETHUSDT', '#TV_SYMBOL-NEWUSDT', '#TV_SYMBOL-SOLUSDT', 'myTradingView.order']);
});

test('user retains native writes for other keys and databases and always rewrites non-JSON chart values', async ({ page }) => {
  // Given identical values already stored in a chart database, another database and a Date record.
  await openChartWriteFilterLab(page);
  await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    window.__OTHER_DB__ = lab.create('user_settings');
    await lab.native.setItem('chart-preference', { theme: 'dark' });
    await window.__OTHER_DB__.setItem('#TV_SYMBOL-BTCUSDT', [{ id: 'kept' }]);
    await lab.native.setItem('#TV_SYMBOL-DATEUSDT', new Date(0));
    window.__WRITE_FILTER__.reset();
  });

  // When those exact values are written again.
  const result = await page.evaluate(async () => {
    const lab = window.__STORAGE_LAB__;
    await lab.native.setItem('chart-preference', { theme: 'dark' });
    await window.__OTHER_DB__.setItem('#TV_SYMBOL-BTCUSDT', [{ id: 'kept' }]);
    await lab.native.setItem('#TV_SYMBOL-DATEUSDT', new Date(0));
    const native = window.__STORAGE_NATIVE__.snapshot();
    const filter = window.__WRITE_FILTER__.delta();
    const date = await lab.native.getItem('#TV_SYMBOL-DATEUSDT');
    return { native, filter, dateKept: date instanceof Date && date.getTime() === 0 };
  });

  // Then other records use the native put and the Date record is compared but always written.
  expect(result.native).toMatchObject({ puts: 2, aborted: 0 });
  expect(result.filter).toEqual({ compared: 1, skipped: 0, written: 1, unreadable: 0 });
  expect(result.dateKept).toBe(true);
});

test('user stores the chart value captured when the write was requested', async ({ page }) => {
  // Given a raw IndexedDB connection to the chart database with an existing record.
  await openChartWriteFilterLab(page);

  // When the caller changes its object immediately after requesting the write.
  const result = await page.evaluate(async () => {
    await window.__STORAGE_LAB__.native.setItem('#TV_SYMBOL-BTCUSDT', [{ id: 'old' }]);
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('chart_futures');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const value = [{ id: 'requested' }];
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('keyvaluepairs', 'readwrite');
      transaction.objectStore('keyvaluepairs').put(value, '#TV_SYMBOL-BTCUSDT');
      value[0].id = 'mutated-after-request';
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
    return window.__STORAGE_LAB__.native.getItem('#TV_SYMBOL-BTCUSDT');
  });

  // Then the stored value is the one present at request time, as with a native structured clone.
  expect(result).toEqual([{ id: 'requested' }]);
});

test('user keeps issue order for concurrent saves of the same chart record', async ({ page }) => {
  // Given a stored drawing record.
  await openChartWriteFilterLab(page);
  await page.evaluate(async () => {
    await window.__STORAGE_LAB__.native.setItem('#TV_SYMBOL-BTCUSDT', [{ id: 'stored' }]);
    window.__WRITE_FILTER__.reset();
  });

  // When two tabs' worth of saves race: a change, the same change again, then a later change.
  const result = await page.evaluate(async () => {
    const target = window.__STORAGE_LAB__.native;
    await Promise.all([
      target.setItem('#TV_SYMBOL-BTCUSDT', [{ id: 'first' }]),
      target.setItem('#TV_SYMBOL-BTCUSDT', [{ id: 'first' }]),
      target.setItem('#TV_SYMBOL-BTCUSDT', [{ id: 'last' }]),
    ]);
    return { stored: await target.getItem('#TV_SYMBOL-BTCUSDT'), native: window.__STORAGE_NATIVE__.snapshot() };
  });

  // Then the last requested value wins and the duplicate in between is skipped.
  expect(result.stored).toEqual([{ id: 'last' }]);
  expect(result.native).toMatchObject({ puts: 2, aborted: 0 });
});

test('user sees a failed chart write rejected with the previous record retained', async ({ page }) => {
  // Given a stored drawing record and a transaction that aborts after its next write.
  await openChartWriteFilterLab(page);
  await page.evaluate(async () => {
    await window.__STORAGE_LAB__.native.setItem('#TV_SYMBOL-BTCUSDT', [{ id: 'line-BTC' }]);
    window.__WRITE_FILTER__.reset();
    window.__STORAGE_NATIVE__.abortNextPut();
  });

  // When a save changes the record.
  const result = await page.evaluate(async () => {
    const target = window.__STORAGE_LAB__.native;
    const outcome = await target.setItem('#TV_SYMBOL-BTCUSDT', [{ id: 'changed' }]).then(() => 'resolved', () => 'rejected');
    return { outcome, stored: await target.getItem('#TV_SYMBOL-BTCUSDT'), native: window.__STORAGE_NATIVE__.snapshot() };
  });

  // Then localForage rejects the save and the previous record remains.
  expect(result.outcome).toBe('rejected');
  expect(result.stored).toEqual([{ id: 'line-BTC' }]);
  expect(result.native).toMatchObject({ puts: 1, aborted: 1 });
});

test('user receives the real quota error when a changed chart record cannot be stored', async ({ page, context }) => {
  // Given a stored drawing record on an origin limited to a 64 KiB real quota.
  await openChartWriteFilterLab(page);
  const session = await context.newCDPSession(page);
  try {
    await session.send('Storage.overrideQuotaForOrigin', { origin: STORAGE_LAB_ORIGIN, quotaSize: 64 * 1024 });
    await page.evaluate(async () => {
      await window.__STORAGE_LAB__.native.setItem('#TV_SYMBOL-BTCUSDT', [{ id: 'stored' }]);
      window.__WRITE_FILTER__.reset();
    });

    // When a save replaces it with an incompressible one-MiB drawing.
    const result = await page.evaluate(async () => {
      const target = window.__STORAGE_LAB__.native;
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
      const large = Array.from({ length: 16 }, () => Array.from(crypto.getRandomValues(new Uint8Array(65536)), byte => alphabet[byte & 63]).join('')).join('');
      const outcome = await target.setItem('#TV_SYMBOL-BTCUSDT', [{ id: 'large', text: large }])
        .then(() => ({ status: 'resolved' }), error => ({ status: 'rejected', name: error?.name ?? null }));
      return { outcome, stored: await target.getItem('#TV_SYMBOL-BTCUSDT'), filter: window.__WRITE_FILTER__.delta() };
    });

    // Then localForage rejects with Chromium's quota error and the previous record remains.
    expect(result.outcome).toEqual({ status: 'rejected', name: 'QuotaExceededError' });
    expect(result.stored).toEqual([{ id: 'stored' }]);
    expect(result.filter).toEqual({ compared: 1, skipped: 0, written: 1, unreadable: 0 });
  } finally {
    await session.send('Storage.overrideQuotaForOrigin', { origin: STORAGE_LAB_ORIGIN });
    await session.detach();
  }
});

test('user overwrites a stored chart record that can no longer be read', async ({ page }) => {
  // Given a stored drawing record whose readwrite read fails asynchronously.
  await openChartWriteFilterLab(page, { unreadableKey: '#TV_SYMBOL-BTCUSDT' });
  await page.evaluate(async () => {
    await window.__STORAGE_LAB__.native.setItem('#TV_SYMBOL-BTCUSDT', [{ id: 'stored' }]);
    window.__WRITE_FILTER__.reset();
  });

  // When a save writes the record, even with an unchanged value.
  const result = await page.evaluate(async () => {
    const target = window.__STORAGE_LAB__.native;
    const outcome = await target.setItem('#TV_SYMBOL-BTCUSDT', [{ id: 'stored' }]).then(() => 'resolved', () => 'rejected');
    return { outcome, stored: await target.getItem('#TV_SYMBOL-BTCUSDT'), native: window.__STORAGE_NATIVE__.snapshot(), filter: window.__WRITE_FILTER__.delta() };
  });

  // Then the save succeeds through a native write, as it would without the comparison.
  expect(result.outcome).toBe('resolved');
  expect(result.stored).toEqual([{ id: 'stored' }]);
  expect(result.native).toMatchObject({ puts: 1, aborted: 0 });
  expect(result.filter).toEqual({ compared: 1, skipped: 0, written: 1, unreadable: 1 });
});

test('user keeps a later tab write that matches the value stored when it was requested', async ({ page, context }) => {
  // Given two filtered tabs share a stored drawing record behind a held IndexedDB write lock.
  const other = await context.newPage();
  try {
    await openChartWriteFilterLab(page);
    await openChartWriteFilterLab(other);
    await page.evaluate(async () => {
      await window.__STORAGE_LAB__.native.setItem('#TV_SYMBOL-BTCUSDT', [{ id: 'original' }]);
    });
    await holdMirrorWriteLock(page);
    try {
      // When the first tab changes the record and the second tab then requests the original value again.
      await page.evaluate(() => window.__WRITE_FILTER__.queue('change', '#TV_SYMBOL-BTCUSDT', [{ id: 'changed' }]));
      await other.evaluate(() => window.__WRITE_FILTER__.queue('restore', '#TV_SYMBOL-BTCUSDT', [{ id: 'original' }]));
    } finally {
      await releaseMirrorWriteLock(page);
    }
    const outcomes = [
      ...await page.evaluate(() => window.__WRITE_FILTER__.finish(['change'])),
      ...await other.evaluate(() => window.__WRITE_FILTER__.finish(['restore'])),
    ];
    const stored = await page.evaluate(() => window.__STORAGE_LAB__.native.getItem('#TV_SYMBOL-BTCUSDT'));

    // Then both saves commit in request order, so the later original value is not mistaken for unchanged.
    expect(outcomes).toEqual(['resolved', 'resolved']);
    expect(stored).toEqual([{ id: 'original' }]);
  } finally {
    await other.close();
  }
});
