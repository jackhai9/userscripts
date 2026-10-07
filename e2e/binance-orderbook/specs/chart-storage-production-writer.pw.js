import { test, expect } from '../test.js';
import { openProductionMirrorWriterLab } from '../helpers/chart-storage-production-writer.js';
import { holdMirrorWriteLock, releaseMirrorWriteLock } from '../helpers/chart-storage-mirror-writer.js';

test('user persists signed zero and property order changes without rewriting equal snapshots', async ({ page }) => {
  // Given native records differ only by signed zero or insertion order.
  await openProductionMirrorWriterLab(page);
  await page.evaluate(async () => {
    const target = window.__STORAGE_LAB__.native;
    await Promise.all([
      target.setItem('myTradingView.zero', { value: -0 }),
      target.setItem('myTradingView.order', { a: 1, b: 2 }),
      target.setItem('myTradingView.equal', { same: [1, null] }),
    ]);
    window.__STORAGE_NATIVE__.reset();
  });

  // When the native mirror receives the next ordered snapshot.
  const result = await page.evaluate(async () => {
    const state = window.__MIRROR_WRITER__;
    await Promise.all(state.dispatch([
      ['myTradingView.zero', { value: 0 }],
      ['myTradingView.order', { b: 2, a: 1 }],
      ['myTradingView.equal', { same: [1, null] }],
    ]));
    const target = window.__STORAGE_LAB__.native;
    const metrics = window.__STORAGE_NATIVE__.snapshot();
    return { metrics, zero: Object.is((await target.getItem('myTradingView.zero')).value, 0),
      keys: Object.keys(await target.getItem('myTradingView.order')), stats: state.writer.getStats(), nativeCalls: state.nativeCalls };
  });

  // Then exactly the observable changes are committed in one transaction.
  expect(result.zero).toBe(true);
  expect(result.keys).toEqual(['b', 'a']);
  expect(result.metrics).toMatchObject({ transactions: 1, puts: 2, aborted: 0, completed: 1 });
  expect(result.stats).toMatchObject({ committedWrites: 2, skippedWrites: 1, failedBatches: 0 });
  expect(result.nativeCalls).toBe(0);
});

for (const kind of ['shared reference', 'cycle', 'date', 'oversized input']) {
  test(`user preserves native storage semantics for ${kind} before a batch transaction exists`, async ({ page }) => {
    // Given the supported optimization limits exclude the next structured clone value.
    await openProductionMirrorWriterLab(page, { limits: kind === 'oversized input' ? { maxBatchBytes: 40 } : {} });
    await page.evaluate(async () => { await window.__STORAGE_LAB__.native.ready(); window.__STORAGE_NATIVE__.reset(); });

    // When the original native map receives the unsupported snapshot once.
    const result = await page.evaluate(async kind => {
      const state = window.__MIRROR_WRITER__;
      const shared = { revision: 1 };
      const value = kind === 'shared reference' ? { a: shared, b: shared }
        : kind === 'cycle' ? { revision: 1 } : kind === 'date' ? new Date(0) : 'x'.repeat(100);
      if (kind === 'cycle') value.self = value;
      const outcomes = await Promise.allSettled(state.dispatch([['myTradingView.native', value]]));
      await state.writer.stop();
      const persisted = await window.__STORAGE_LAB__.native.getItem('myTradingView.native');
      return { status: outcomes.map(outcome => outcome.status), nativeCalls: state.nativeCalls, stats: state.writer.getStats(),
        preserved: kind === 'shared reference' ? persisted.a === persisted.b
          : kind === 'cycle' ? persisted.self === persisted : kind === 'date' ? persisted instanceof Date && persisted.getTime() === 0 : persisted === value };
    }, kind);

    // Then native structured cloning retains the value without splitting aliases or dropping a save.
    expect(result.status).toEqual(['fulfilled']);
    expect(result.preserved).toBe(true);
    expect(result.nativeCalls).toBe(1);
    expect(result.stats).toMatchObject({ acceptedBatches: 0, rejectedBatches: 1, nativePassthroughBatches: 1,
      transactions: 0, failedBatches: 0, pendingBatches: 0, pendingBytes: 0 });
  });
}

for (const kind of ['date', 'read budget']) {
  test(`user replaces a stored ${kind} inside the original transaction`, async ({ page }) => {
    // Given the second old value cannot be safely compared within the optimization budget.
    await openProductionMirrorWriterLab(page, { limits: { maxReadBytes: 64 } });
    await page.evaluate(async kind => {
      const target = window.__STORAGE_LAB__.native;
      await target.setItem('myTradingView.first', { revision: 0 });
      await target.setItem('myTradingView.second', kind === 'date' ? new Date(0) : 'x'.repeat(128));
      window.__STORAGE_NATIVE__.reset();
    }, kind);

    // When both records receive fresh JSON snapshots.
    const result = await page.evaluate(async () => {
      const state = window.__MIRROR_WRITER__;
      const outcomes = await Promise.allSettled(state.dispatch([
        ['myTradingView.first', { revision: 1 }], ['myTradingView.second', { revision: 2 }],
      ]));
      return { status: outcomes.map(outcome => outcome.status), nativeCalls: state.nativeCalls, metrics: window.__STORAGE_NATIVE__.snapshot(),
        stats: state.writer.getStats(), values: await Promise.all(['first', 'second'].map(key => window.__STORAGE_LAB__.native.getItem(`myTradingView.${key}`))) };
    });

    // Then the transaction commits both replacements without aborting or native replay.
    expect(result.status).toEqual(['fulfilled']);
    expect(result.values).toEqual([{ revision: 1 }, { revision: 2 }]);
    expect(result.nativeCalls).toBe(0);
    expect(result.metrics).toMatchObject({ transactions: 1, puts: 2, completed: 1, aborted: 0 });
    expect(result.stats).toMatchObject({ acceptedBatches: 1, failedBatches: 0, committedWrites: 2, pendingBytes: 0 });
  });
}

test('user accepts plain snapshots from the chart iframe without changing native methods', async ({ page }) => {
  // Given the chart creates ordinary objects in a different JavaScript realm.
  await openProductionMirrorWriterLab(page);
  await page.evaluate(async () => { await window.__STORAGE_LAB__.native.ready(); window.__STORAGE_NATIVE__.reset(); });

  // When dispatch copies the iframe snapshot before its owner mutates it.
  const result = await page.evaluate(async () => {
    const iframe = document.createElement('iframe');
    document.body.append(iframe);
    const value = new iframe.contentWindow.Object();
    value.revision = 1;
    const target = window.__STORAGE_LAB__.native;
    const method = target.setItem;
    const state = window.__MIRROR_WRITER__;
    const work = state.dispatch([['myTradingView.realm', value]]);
    value.revision = 2;
    await Promise.all(work);
    iframe.remove();
    return { value: await target.getItem('myTradingView.realm'), sameMethod: method === target.setItem, stats: state.writer.getStats(), nativeCalls: state.nativeCalls };
  });

  // Then the accepted snapshot is isolated from later caller changes.
  expect(result.value).toEqual({ revision: 1 });
  expect(result.sameMethod).toBe(true);
  expect(result.nativeCalls).toBe(0);
  expect(result.stats).toMatchObject({ acceptedBatches: 1, committedWrites: 1 });
});

test('user resumes native writes exactly once after a closed IndexedDB connection', async ({ page }) => {
  // Given localForage owns a connection that has really been closed.
  await openProductionMirrorWriterLab(page);
  await page.evaluate(async () => {
    await window.__STORAGE_LAB__.native.ready();
    window.__STORAGE_LAB__.native._dbInfo.db.close();
    window.__STORAGE_NATIVE__.reset();
  });

  // When transaction creation fails before any mirror transaction was accepted.
  const result = await page.evaluate(async () => {
    const state = window.__MIRROR_WRITER__;
    const outcomes = await Promise.allSettled(state.dispatch([['myTradingView.reopened', 42]]));
    await state.writer.stop();
    return { status: outcomes.map(outcome => outcome.status), value: await window.__STORAGE_LAB__.native.getItem('myTradingView.reopened'),
      stats: state.writer.getStats(), nativeCalls: state.nativeCalls };
  });

  // Then the real library reopens its connection and commits the original native map once.
  expect(result.status).toEqual(['fulfilled']);
  expect(result.value).toBe(42);
  expect(result.nativeCalls).toBe(1);
  expect(result.stats).toMatchObject({ transactions: 0, failedBatches: 0, nativePassthroughBatches: 1, pendingBatches: 0 });
});

for (const kind of ['driver', 'database configuration', 'ready rejection']) {
  test(`user preserves the native result after a ${kind} mismatch before transaction creation`, async ({ page }) => {
    // Given a real localForage instance does not satisfy the mirror destination contract.
    await openProductionMirrorWriterLab(page);

    // When the writer encounters the actual configured driver or readiness failure.
    const result = await page.evaluate(async kind => {
      const lab = window.__STORAGE_LAB__;
      const state = window.__MIRROR_WRITER__;
      const target = kind === 'driver' ? lab.create('chart_futures', { driver: lab.localforage.LOCALSTORAGE })
        : kind === 'database configuration' ? lab.create('other_chart') : lab.create('chart_futures', { driver: 'not-an-installed-driver' });
      const outcomes = await Promise.allSettled(state.dispatch([['myTradingView.native', 42]], target));
      await state.writer.stop();
      return { outcomes: outcomes.map(outcome => ({ status: outcome.status, message: outcome.reason?.message })),
        value: kind === 'ready rejection' ? null : await target.getItem('myTradingView.native'),
        stats: state.writer.getStats(), nativeCalls: state.nativeCalls };
    }, kind);

    // Then only the original native expression determines the saved value or rejection.
    expect(result.nativeCalls).toBe(1);
    expect(result.stats).toMatchObject({ transactions: 0, nativePassthroughBatches: 1, pendingBatches: 0, pendingBytes: 0 });
    if (kind === 'ready rejection') {
      expect(result.outcomes).toEqual([{ status: 'rejected', message: 'No available storage method found.' }]);
    } else {
      expect(result.outcomes).toEqual([{ status: 'fulfilled', message: undefined }]);
      expect(result.value).toBe(42);
    }
  });
}

test('user keeps transaction aborts atomic and routes later calls through the untouched native API', async ({ page }) => {
  // Given the actual IndexedDB transaction is aborted after its first successful put.
  await openProductionMirrorWriterLab(page);
  await page.evaluate(async () => {
    await window.__STORAGE_LAB__.native.setItem('myTradingView.first', 0);
    window.__STORAGE_NATIVE__.reset();
    window.__STORAGE_NATIVE__.abortNextPut();
  });

  // When the admitted batch aborts and a later mirror is submitted.
  const result = await page.evaluate(async () => {
    const state = window.__MIRROR_WRITER__;
    const outcomes = await Promise.allSettled(state.dispatch([['myTradingView.first', 1], ['myTradingView.second', 2]]));
    const first = await window.__STORAGE_LAB__.native.getItem('myTradingView.first');
    const before = state.writer.getStats();
    const nativeResult = [window.__STORAGE_LAB__.native.setItem('myTradingView.later', 3)];
    let nativeCalls = 0;
    const returned = state.writer.dispatch(window.__STORAGE_LAB__.native, [['myTradingView.later', 3]], () => { nativeCalls += 1; return nativeResult; });
    await Promise.all(returned);
    return { status: outcomes.map(outcome => outcome.status), first, noReplay: state.nativeCalls, nativeCalls,
      originalReturn: returned === nativeResult, before, after: state.writer.getStats(), keys: (await window.__STORAGE_LAB__.native.keys()).sort() };
  });

  // Then rollback is reported once and the stopped writer no longer changes optimization statistics.
  expect(result.status).toEqual(['rejected']);
  expect(result.first).toBe(0);
  expect(result.noReplay).toBe(0);
  expect(result.nativeCalls).toBe(1);
  expect(result.originalReturn).toBe(true);
  expect(result.keys).toEqual(['myTradingView.first', 'myTradingView.later']);
  expect(result.before).toMatchObject({ failedBatches: 1, abortedTransactions: 1, committedWrites: 0, pendingBatches: 0 });
  expect(result.after).toEqual(result.before);
});

for (const kind of ['batch count', 'snapshot bytes']) {
  test(`user drains native work over pending ${kind} capacity before stop releases later writes`, async ({ page }) => {
    // Given a real write lock holds the only allowed optimization batch.
    await openProductionMirrorWriterLab(page, { limits: kind === 'batch count' ? { maxPendingBatches: 1 } : { maxPendingBytes: 40 } });
    await page.evaluate(async () => { await window.__STORAGE_LAB__.native.ready(); });
    await holdMirrorWriteLock(page);
    await page.evaluate(() => {
      const state = window.__MIRROR_WRITER__;
      window.__STORAGE_NATIVE__.reset();
      state.first = Promise.all(state.dispatch([['myTradingView.first', 1]]));
    });
    await expect.poll(() => page.evaluate(() => window.__STORAGE_NATIVE__.snapshot().transactions)).toBe(1);

    // When another batch uses native storage and stop is followed by one final mirror.
    const during = await page.evaluate(() => {
      const state = window.__MIRROR_WRITER__;
      state.second = Promise.all(state.dispatch([['myTradingView.second', 2]]));
      state.stopped = false;
      state.stopping = state.writer.stop().then(() => { state.stopped = true; });
      state.later = Promise.all(state.dispatch([['myTradingView.later', 3]]));
      return { stats: state.writer.getStats(), nativeCalls: state.nativeCalls, stopped: state.stopped };
    });
    await releaseMirrorWriteLock(page);
    const result = await page.evaluate(async () => {
      const state = window.__MIRROR_WRITER__;
      await Promise.all([state.first, state.second, state.stopping, state.later]);
      return { stats: state.writer.getStats(), nativeCalls: state.nativeCalls, stopped: state.stopped,
        values: await Promise.all(['first', 'second', 'later'].map(key => window.__STORAGE_LAB__.native.getItem(`myTradingView.${key}`))) };
    });

    // Then no save is discarded and the fence includes the native work accepted before stop.
    expect(during.stopped).toBe(false);
    expect(during.nativeCalls).toBe(1);
    expect(during.stats).toMatchObject({ acceptedBatches: 1, rejectedBatches: 1, pendingBatches: 2, nativePassthroughBatches: 1 });
    expect(result.values).toEqual([1, 2, 3]);
    expect(result.stopped).toBe(true);
    expect(result.nativeCalls).toBe(2);
    expect(result.stats).toMatchObject({ pendingBatches: 0, pendingBytes: 0, nativePassthroughBatches: 1, failedBatches: 0 });
  });
}

test('user preserves missing and explicit null chart keys without disturbing target-only records', async ({ page }) => {
  // Given native storage contains an explicit null and records outside this mirror.
  await openProductionMirrorWriterLab(page);
  await page.evaluate(async () => {
    const target = window.__STORAGE_LAB__.native;
    await Promise.all([target.setItem('myTradingView.present', null), target.setItem('myTradingView.targetOnly', 7), target.setItem('candlestick-setting', 8)]);
    window.__STORAGE_NATIVE__.reset();
  });

  // When a missing null key is mirrored twice and an empty batch follows.
  const result = await page.evaluate(async () => {
    const state = window.__MIRROR_WRITER__;
    const entries = [['myTradingView.present', null], ['myTradingView.missing', null]];
    await Promise.all(state.dispatch(entries));
    await Promise.all(state.dispatch(entries));
    const before = state.writer.getStats();
    const empty = state.dispatch([]);
    return { before, after: state.writer.getStats(), empty, nativeCalls: state.nativeCalls,
      metrics: window.__STORAGE_NATIVE__.snapshot(), keys: (await window.__STORAGE_LAB__.native.keys()).sort(),
      values: await Promise.all(['myTradingView.present', 'myTradingView.missing', 'myTradingView.targetOnly', 'candlestick-setting'].map(key => window.__STORAGE_LAB__.native.getItem(key))) };
  });

  // Then one new null record is committed while repeats and the empty batch make no writes.
  expect(result.values).toEqual([null, null, 7, 8]);
  expect(result.keys).toEqual(['candlestick-setting', 'myTradingView.missing', 'myTradingView.present', 'myTradingView.targetOnly']);
  expect(result.metrics).toMatchObject({ transactions: 2, puts: 1, completed: 2, aborted: 0 });
  expect(result.before).toMatchObject({ committedWrites: 1, skippedWrites: 3, pendingBatches: 0 });
  expect(result.after).toEqual(result.before);
  expect(result.empty).toEqual([]);
  expect(result.nativeCalls).toBe(0);
});

test('user drains accepted work when input inspection synchronously requests stop', async ({ page }) => {
  // Given input inspection can synchronously call the exposed stop hook.
  await openProductionMirrorWriterLab(page);
  await page.evaluate(async () => { await window.__STORAGE_LAB__.native.ready(); });

  // When inspecting the snapshot triggers stop during the original dispatch.
  const result = await page.evaluate(async () => {
    const state = window.__MIRROR_WRITER__;
    let stop;
    const value = new Proxy({ revision: 1 }, { getPrototypeOf(target) { stop = state.writer.stop(); return Reflect.getPrototypeOf(target); } });
    const outcomes = await Promise.allSettled(state.dispatch([['myTradingView.reentrant', value]]));
    await stop;
    return { status: outcomes.map(outcome => outcome.status), nativeCalls: state.nativeCalls,
      value: await window.__STORAGE_LAB__.native.getItem('myTradingView.reentrant'), stats: state.writer.getStats() };
  });

  // Then the work accepted before inspection completes and stop does not discard its snapshot.
  expect(result.status).toEqual(['fulfilled']);
  expect(result.value).toEqual({ revision: 1 });
  expect(result.nativeCalls).toBe(0);
  expect(result.stats).toMatchObject({ acceptedBatches: 1, committedWrites: 1, pendingBatches: 0 });
});

test('user drains every native map member after one member rejects', async ({ page }) => {
  // Given a real write lock delays a valid native save while another native value cannot clone.
  await openProductionMirrorWriterLab(page, { limits: { maxEntries: 1 } });
  await page.evaluate(async () => { await window.__STORAGE_LAB__.native.ready(); });
  await holdMirrorWriteLock(page);

  // When a rejected native member settles before the other pending member and stop is requested.
  const during = await page.evaluate(async () => {
    const state = window.__MIRROR_WRITER__;
    state.results = Promise.allSettled(state.dispatch([['myTradingView.invalid', () => 1], ['myTradingView.valid', 2]]));
    state.results.then(outcomes => { state.earlyOutcome = outcomes[0].status; });
    state.stopped = false;
    state.stopping = state.writer.stop().then(() => { state.stopped = true; });
    await window.__MIRROR_WRITE_LOCK__.progress();
    return { stopped: state.stopped, earlyOutcome: state.earlyOutcome, stats: state.writer.getStats(), nativeCalls: state.nativeCalls };
  });
  await releaseMirrorWriteLock(page);
  const result = await page.evaluate(async () => {
    const state = window.__MIRROR_WRITER__;
    const outcomes = await state.results;
    await state.stopping;
    return { status: outcomes.map(outcome => outcome.status), stopped: state.stopped, nativeCalls: state.nativeCalls,
      value: await window.__STORAGE_LAB__.native.getItem('myTradingView.valid'), stats: state.writer.getStats() };
  });

  // Then stop waits for the successful member and neither native promise is replayed.
  expect(during.stopped).toBe(false);
  expect(during.earlyOutcome).toBe('rejected');
  expect(during.nativeCalls).toBe(1);
  expect(during.stats.pendingBatches).toBe(1);
  expect(result.status).toEqual(['rejected']);
  expect(result.value).toBe(2);
  expect(result.stopped).toBe(true);
  expect(result.nativeCalls).toBe(1);
  expect(result.stats).toMatchObject({ pendingBatches: 0, pendingBytes: 0 });
});
