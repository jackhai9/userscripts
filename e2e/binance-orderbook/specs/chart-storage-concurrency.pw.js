import { test, expect, reloadPageWithCoverage } from '../test.js';
import { holdMirrorWriteLock, releaseMirrorWriteLock } from '../helpers/chart-storage-mirror-writer.js';
import { initializeStorageLab, openStorageLab } from '../helpers/chart-storage-lab.js';
import {
  openChartStorageConcurrency,
  queueChartMirrorBatch,
  queueNativeChartClear,
  queueChartSnapshot,
  finishChartOperations,
  chartConcurrencyState,
  stopChartConcurrency,
} from '../helpers/chart-storage-concurrency.js';

const chartKeys = ['#TV_SYMBOL-BTCUSDT', '#TV_SYMBOL-ETHUSDT', 'myTradingView', 'myTradingView.layout'];
const entriesFor = (writer, revision) => chartKeys.map((key, index) => [key, { writer, revision, index, points: [revision, index] }]);
const sortedEntries = entries => [...entries].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);

test('user reads complete committed revisions through twelve rounds of three-tab contention and reload', async ({ page, context }) => {
  // Given three independent writers share native IndexedDB and an unrelated target record.
  const tabs = [page, await context.newPage(), await context.newPage()];
  const preserved = [['candlestick-setting', { theme: 'target' }], ['#TV_SYMBOL-TARGET-ONLY', ['keep']]];
  for (const tab of tabs) await openChartStorageConcurrency(tab);
  await page.evaluate(async entries => {
    for (const [key, value] of entries) await window.__STORAGE_LAB__.native.setItem(key, value);
  }, preserved);
  const rounds = [];
  try {
    // When all three revision batches and intervening native reads queue behind a real write lock each round.
    for (let round = 0; round < 12; round += 1) {
      await holdMirrorWriteLock(page);
      const order = [0, 1, 2].map(offset => (round + offset) % tabs.length);
      const batches = order.map(writer => entriesFor(writer, round + 1));
      let blocked;
      try {
        for (let index = 0; index < order.length; index += 1) {
          const entries = index % 2 === 0 ? batches[index] : [...batches[index]].reverse();
          await queueChartMirrorBatch(tabs[order[index]], 'batch', entries);
          await queueChartSnapshot(page, `snapshot-${index}`);
        }
        blocked = await Promise.all(tabs.map(chartConcurrencyState));
      } finally {
        await releaseMirrorWriteLock(page);
      }
      const outcomes = await Promise.all(tabs.map(tab => finishChartOperations(tab, ['batch'])));
      const snapshots = await finishChartOperations(page, ['snapshot-0', 'snapshot-1', 'snapshot-2']);
      await queueChartSnapshot(tabs[order[0]], 'final');
      const [final] = await finishChartOperations(tabs[order[0]], ['final']);
      rounds.push({ blocked, outcomes, snapshots, final, batches });
    }
    const states = await Promise.all(tabs.map(chartConcurrencyState));

    // Then every observed commit is its entire batch, all tabs finish each round, and no writer replays natively.
    expect(rounds).toHaveLength(12);
    for (const round of rounds) {
      expect(round.blocked.map(state => state.stats.pendingBatches)).toEqual([1, 1, 1]);
      expect(round.outcomes).toEqual([[[undefined]], [[undefined]], [[undefined]]]);
      expect(round.snapshots).toEqual(round.batches.map(batch => sortedEntries([...preserved, ...batch])));
      expect(round.final).toEqual(sortedEntries([...preserved, ...round.batches[2]]));
    }
    for (const state of states) {
      expect(state.stats).toMatchObject({ acceptedBatches: 12, committedTransactions: 12, committedWrites: 48, pendingBatches: 0, pendingBytes: 0, failedBatches: 0 });
      expect(state.writes.every(outcome => outcome === 'complete')).toBe(true);
      expect(state.nativeCalls).toBe(0);
    }

    // When an independent native reader reloads after the last competing batch has committed.
    const reader = await context.newPage();
    try {
      await openStorageLab(reader, { install: false });
      await reloadPageWithCoverage(reader);
      await initializeStorageLab(reader, { install: false });
      const reloaded = await reader.evaluate(async () => {
        const entries = [];
        await window.__STORAGE_LAB__.native.iterate((value, key) => { entries.push([key, value]); });
        return entries;
      });

      // Then unchanged native iteration retrieves the exact last committed revision and preserved records.
      expect(reloaded).toEqual(sortedEntries([...preserved, ...rounds.at(-1).batches[2]]));
    } finally {
      await reader.close();
    }
  } finally {
    for (const tab of tabs) await stopChartConcurrency(tab);
    for (const tab of tabs.slice(1)) await tab.close();
  }
});

test('user observes batch clear batch commits in their native cross-tab transaction order', async ({ page, context }) => {
  // Given ready same-origin tabs share a target containing existing chart and Basic records.
  const tabs = [page, await context.newPage(), await context.newPage()];
  for (const tab of tabs) await openChartStorageConcurrency(tab);
  await page.evaluate(() => window.__STORAGE_LAB__.native.setItem('candlestick-setting', { theme: 'old' }));
  const before = entriesFor('before-clear', 1);
  const after = entriesFor('after-clear', 2);
  await holdMirrorWriteLock(page);
  let blocked;
  try {
    // When a mirror, native clear and another tab's mirror queue with native reads between them.
    try {
      await queueChartMirrorBatch(tabs[1], 'before', before);
      await queueChartSnapshot(page, 'before');
      await queueNativeChartClear(page, 'clear');
      await queueChartSnapshot(page, 'cleared');
      await queueChartMirrorBatch(tabs[2], 'after', after);
      await queueChartSnapshot(page, 'after');
      blocked = await Promise.all(tabs.map(chartConcurrencyState));
    } finally {
      await releaseMirrorWriteLock(page);
    }
    const [snapshots, first, last] = await Promise.all([
      finishChartOperations(page, ['before', 'clear', 'cleared', 'after']),
      finishChartOperations(tabs[1], ['before']),
      finishChartOperations(tabs[2], ['after']),
    ]);
    const states = await Promise.all(tabs.map(chartConcurrencyState));

    // Then clear removes every earlier record before the later complete revision repopulates the target.
    expect(blocked.map(state => state.stats.pendingBatches)).toEqual([0, 1, 1]);
    expect(blocked.map(state => state.writes.filter(outcome => outcome === 'pending').length)).toEqual([2, 1, 1]);
    expect(snapshots).toEqual([sortedEntries([['candlestick-setting', { theme: 'old' }], ...before]), undefined, [], sortedEntries(after)]);
    expect(first).toEqual([[undefined]]);
    expect(last).toEqual([[undefined]]);
    expect(states.map(state => state.stats.committedTransactions)).toEqual([0, 1, 1]);
    expect(states.map(state => state.nativeCalls)).toEqual([0, 0, 0]);
  } finally {
    for (const tab of tabs) await stopChartConcurrency(tab);
    for (const tab of tabs.slice(1)) await tab.close();
  }
});

test('user keeps real native values and callbacks after stop drains its last optimized batch', async ({ page }) => {
  // Given an accepted complete revision waits for the target's real write lock.
  await openChartStorageConcurrency(page);
  await holdMirrorWriteLock(page);
  await queueChartMirrorBatch(page, 'accepted', entriesFor('optimized', 1));
  let blocked;
  try {
    // When stop closes admission and the continuation invokes unchanged native setItem promises and callbacks.
    try {
      blocked = await page.evaluate(entries => {
        const state = window.__CHART_CONCURRENCY__;
        const writer = window.__MIRROR_WRITER__.writer;
        state.events = [];
        state.callbacks = [];
        state.nativeCalls = 0;
        state.stopped = false;
        state.stopping = writer.stop();
        state.stopping.then(() => { state.stopped = true; state.events.push('stopped'); });
        state.pending.tail = Promise.all(writer.dispatch(window.__STORAGE_LAB__.native, entries, () => {
          state.nativeCalls += 1;
          state.events.push('native-thunk');
          return entries.map(([key, value]) => window.__STORAGE_LAB__.native.setItem(key, value, (error, result) => {
            state.callbacks.push({ key, error, value: result });
          }));
        }));
        return { stopped: state.stopped, events: state.events, callbacks: state.callbacks, nativeCalls: state.nativeCalls, stats: writer.getStats() };
      }, entriesFor('native-draining', 2));
    } finally {
      await releaseMirrorWriteLock(page);
    }
    const [accepted, tail] = await finishChartOperations(page, ['accepted', 'tail']);
    await queueChartSnapshot(page, 'drained');
    const [drained] = await finishChartOperations(page, ['drained']);
    const continuation = await page.evaluate(async entries => {
      const state = window.__CHART_CONCURRENCY__;
      const writer = window.__MIRROR_WRITER__.writer;
      await state.stopping;
      const atStop = writer.getStats();
      let nativeResult;
      const dispatched = writer.dispatch(null, null, () => {
        state.nativeCalls += 1;
        nativeResult = entries.map(([key, value]) => window.__STORAGE_LAB__.native.setItem(key, value, (error, result) => {
          state.callbacks.push({ key, error, value: result });
        }));
        return nativeResult;
      });
      const exactArray = dispatched === nativeResult;
      const exactPromises = dispatched.every((promise, index) => promise === nativeResult[index]);
      return { values: await Promise.all(dispatched), callbacks: state.callbacks, nativeCalls: state.nativeCalls,
        events: state.events, stopped: state.stopped, exactArray, exactPromises, atStop, after: writer.getStats() };
    }, entriesFor('native-stopped', 3));
    await queueChartSnapshot(page, 'final');
    const [final] = await finishChartOperations(page, ['final']);

    // Then native continuations persist both revisions and preserve callbacks without accepting another optimized batch.
    expect(blocked).toMatchObject({ stopped: false, events: [], callbacks: [], nativeCalls: 0, stats: { acceptedBatches: 1, pendingBatches: 1, committedTransactions: 0 } });
    expect(accepted).toEqual([undefined]);
    expect(tail).toEqual([entriesFor('native-draining', 2).map(([, value]) => value)]);
    expect(drained).toEqual(sortedEntries(entriesFor('native-draining', 2)));
    expect(continuation.values).toEqual(entriesFor('native-stopped', 3).map(([, value]) => value));
    expect(continuation.callbacks).toEqual([
      ...entriesFor('native-draining', 2), ...entriesFor('native-stopped', 3),
    ].map(([key, value]) => ({ key, error: null, value })));
    expect(continuation).toMatchObject({ events: ['stopped', 'native-thunk'], nativeCalls: 2, stopped: true, exactArray: true, exactPromises: true });
    expect(continuation.atStop).toMatchObject({ acceptedBatches: 1, committedTransactions: 1, committedWrites: 4, pendingBatches: 0, pendingBytes: 0 });
    expect(continuation.after).toEqual(continuation.atStop);
    expect(final).toEqual(sortedEntries(entriesFor('native-stopped', 3)));
  } finally {
    await stopChartConcurrency(page);
  }
});
