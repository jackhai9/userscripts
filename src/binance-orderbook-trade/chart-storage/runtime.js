import { observeChartStorageBootstrap } from './bootstrap.js';
import { replaceChartMirrorFactory } from './mirror-module.js';
import { createChartMirrorWriter } from './mirror-writer.js';
import { isChartStoragePage } from './scope.js';

const CAPTURE_DEADLINE_MS = 30_000;

/**
 * The sole interception point is the pinned mirror destination expression.
 * Unsupported startup retires the hook; it never executes modules to find them.
 * A retained callback drains accepted writes before resuming the native map.
 */
export function startChartStorageOptimizer() {
  if (!isChartStoragePage()) throw new Error('Chart storage requires a top-level Binance trading page');
  const writer = createChartMirrorWriter();
  const state = { status: 'waiting', reason: null, attempts: 0, matches: 0, executions: 0 };
  let observer;
  let timer;
  let stopping;

  function snapshot() {
    const stats = writer.getStats();
    return { ...state, status: stats.failedBatches > 0 ? 'native_after_failure' : state.status,
      phase: writer.getPhase(), writer: stats };
  }

  function stop(reason = 'manual') {
    if (stopping) return stopping;
    state.status = 'stopping';
    state.reason = reason;
    clearTimeout(timer);
    self.removeEventListener('pagehide', onPageHide);
    if (observer) observer.stop();
    stopping = writer.stop().then(() => {
      state.status = 'native';
      return snapshot();
    });
    return stopping;
  }

  function onPageHide() { void stop('pagehide'); }

  function dispatch(target, entries, nativeThunk) {
    if (!isChartStoragePage()) void stop('scope_changed');
    return writer.dispatch(target, entries, nativeThunk);
  }

  try {
    observer = observeChartStorageBootstrap({
      replaceMirrorFactory(original) {
        if (!isChartStoragePage()) {
          void stop('scope_changed');
          return original;
        }
        state.attempts += 1;
        let replacement;
        try {
          replacement = replaceChartMirrorFactory(original, dispatch);
        } catch {
          // Source drift is an expected release boundary; leave registration native.
          void stop('source_mismatch');
          return original;
        }
        state.matches += 1;
        return function (...args) {
          state.executions += 1;
          return Reflect.apply(replacement, this, args);
        };
      },
      onCapture() {
        clearTimeout(timer);
        state.status = 'active';
      },
    });
  } catch {
    // A late extension cannot safely replace the runtime's cached module.
    void stop('bootstrap_unavailable');
    return Object.freeze({ snapshot, stop });
  }

  observer.captured.catch(() => {
    if (!stopping) void stop('capture_failed');
  });
  self.addEventListener('pagehide', onPageHide, { once: true });
  timer = setTimeout(() => { void stop('capture_deadline'); }, CAPTURE_DEADLINE_MS);
  return Object.freeze({ snapshot, stop });
}
