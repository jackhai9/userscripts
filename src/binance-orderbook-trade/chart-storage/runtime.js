import { observeChartStorageBootstrap } from './bootstrap.js';
import { replaceChartMirrorFactory } from './mirror-module.js';
import { replaceChartDrawingSaveFactory } from './drawing-save-module.js';
import { createChartMirrorWriter } from './mirror-writer.js';
import { isChartStoragePage } from './scope.js';

const CAPTURE_DEADLINE_MS = 30_000;
const MIRROR_MODULE = '70940';
const DRAWING_MODULE = '76535';

/**
 * Mirror optimization is optional and drainable. Drawing ownership protection
 * remains installed after stop and gets the same finite startup capture window.
 */
export function startChartStorageOptimizer({ additionalTargets = {} } = {}) {
  if (!isChartStoragePage()) throw new Error('Chart storage requires a top-level Binance trading page');
  for (const [id, target] of Object.entries(additionalTargets)) {
    if (id === MIRROR_MODULE || id === DRAWING_MODULE ||
        !target || [target.replace, target.onCapture, target.onFailure].some(callback => typeof callback !== 'function')) {
      throw new Error('Additional native targets require independent replacement and outcome callbacks');
    }
  }
  const writer = createChartMirrorWriter();
  const state = { status: 'waiting', reason: null, attempts: 0, matches: 0, executions: 0 };
  const drawingScope = { status: 'waiting', reason: null, attempts: 0, matches: 0, executions: 0 };
  let observer;
  let timer;
  let stopping;
  let observationFinished = false;

  function snapshot() {
    const stats = writer.getStats();
    return { ...state, status: stats.failedBatches > 0 ? 'native_after_failure' : state.status,
      phase: writer.getPhase(), writer: stats, drawingScope: { ...drawingScope } };
  }

  function stop(reason = 'manual') {
    if (stopping) return stopping;
    state.status = 'stopping';
    state.reason = reason;
    stopping = writer.stop().then(() => {
      state.status = 'native';
      return snapshot();
    });
    if (observer) observer.stopTarget(MIRROR_MODULE, reason);
    if (observationFinished) self.removeEventListener('pagehide', onPageHide);
    return stopping;
  }

  function finishObservation() {
    observationFinished = true;
    clearTimeout(timer);
    if (stopping) self.removeEventListener('pagehide', onPageHide);
  }

  function onPageHide() {
    if (observer) observer.stop('pagehide');
    void stop('pagehide');
  }

  function dispatch(target, entries, nativeThunk) {
    if (!isChartStoragePage()) void stop('scope_changed');
    return writer.dispatch(target, entries, nativeThunk);
  }

  function replaceFactory(id, original, replace) {
    if (!isChartStoragePage()) {
      observer.stop('scope_changed');
      void stop('scope_changed');
      return original;
    }
    const targetState = id === MIRROR_MODULE ? state : drawingScope;
    targetState.attempts += 1;
    const replacement = replace(original);
    targetState.matches += 1;
    return function (...args) {
      targetState.executions += 1;
      return Reflect.apply(replacement, this, args);
    };
  }

  try {
    observer = observeChartStorageBootstrap({
      targets: {
        [MIRROR_MODULE]: original => replaceFactory(MIRROR_MODULE, original, factory => replaceChartMirrorFactory(factory, dispatch)),
        [DRAWING_MODULE]: original => replaceFactory(DRAWING_MODULE, original, replaceChartDrawingSaveFactory),
        ...Object.fromEntries(Object.entries(additionalTargets).map(([id, target]) => [id, original => {
          if (!isChartStoragePage()) {
            observer.stop('scope_changed');
            void stop('scope_changed');
            return original;
          }
          return target.replace(original);
        }])),
      },
      onCapture(id) {
        if (Object.hasOwn(additionalTargets, id)) {
          additionalTargets[id].onCapture();
          return;
        }
        const targetState = id === MIRROR_MODULE ? state : drawingScope;
        if (id !== MIRROR_MODULE || !stopping) targetState.status = 'active';
      },
      onFailure(id, reason) {
        if (Object.hasOwn(additionalTargets, id)) {
          additionalTargets[id].onFailure(reason);
          return;
        }
        if (id === MIRROR_MODULE) {
          void stop(reason === 'execution_failed' ? 'capture_failed' : reason);
        } else {
          drawingScope.status = reason === 'source_mismatch' ? 'source_mismatch' : 'unavailable';
          drawingScope.reason = reason;
        }
      },
      onComplete() { finishObservation(); },
    });
  } catch {
    // A late extension cannot safely replace the runtime's cached modules.
    for (const target of Object.values(additionalTargets)) target.onFailure('bootstrap_unavailable');
    drawingScope.status = 'unavailable';
    drawingScope.reason = 'bootstrap_unavailable';
    finishObservation();
    void stop('bootstrap_unavailable');
    return Object.freeze({ snapshot, stop });
  }

  if (!observationFinished) {
    self.addEventListener('pagehide', onPageHide, { once: true });
    timer = setTimeout(() => {
      observer.stop('capture_deadline');
      if (state.status === 'waiting') void stop('capture_deadline');
    }, CAPTURE_DEADLINE_MS);
  }
  return Object.freeze({ snapshot, stop });
}
