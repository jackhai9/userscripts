import { observeChartStorageBootstrap } from './bootstrap.js';
import { replaceChartMirrorFactory } from './mirror-module.js';
import { createChartMirrorWriter } from './mirror-writer.js';
import { snapshotJson, equalJson } from './adapter.js';
import { captureAnonymousMirrorBatch } from './anonymous-probe-contract.js';

/** Only the fresh-profile runner imports this entry; it is not a userscript. */
if (self === top && location.origin === 'https://www.binance.com' && location.pathname === '/zh-CN/futures/USUSDT') {
  const writer = createChartMirrorWriter({ scope: 'isolated-ususdt-probe' });
  const state = { matched: 0, executed: 0, dispatched: 0, completed: 0, failed: 0, nativeCalls: 0, stopped: false, capture: 'waiting' };
  let last;
  const observer = observeChartStorageBootstrap({
    replaceMirrorFactory(original) {
      const factory = replaceChartMirrorFactory(original, (target, entries, nativeThunk) => {
        const batch = captureAnonymousMirrorBatch(target, entries, state);
        last = batch;
        state.dispatched += 1;
        const promises = writer.dispatch(target, entries, () => {
          state.nativeCalls += 1;
          return nativeThunk();
        });
        batch.completion = Promise.all(promises).then(
          () => { state.completed += 1; return true; },
          () => { state.failed += 1; return false; },
        );
        return promises;
      });
      state.matched += 1;
      return factory;
    },
    onCapture() { state.executed += 1; },
  });
  observer.captured.then(() => { state.capture = 'captured'; }, () => { state.capture = 'rejected'; });

  self.__ANONYMOUS_MIRROR_PROBE__ = Object.freeze({
    snapshot: () => ({ ...state, writer: writer.getStats() }),
    async verifyLast() {
      if (!last) throw new Error('No mirror batch has executed');
      const batch = last;
      if (!await batch.completion) throw new Error('Observed mirror batch failed');
      const values = await Promise.all(batch.entries.map(([key]) => batch.target.getItem(key)));
      if (last !== batch) throw new Error('Mirror changed during verification');
      return { entries: batch.entries.length, valuesMatch: values.every((value, index) => equalJson(snapshotJson(value), batch.entries[index][1])) };
    },
    async stop() {
      await writer.stop();
      observer.stop();
      state.stopped = true;
    },
  });
}
