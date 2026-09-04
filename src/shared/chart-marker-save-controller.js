import { throwIfAborted, waitForPromiseOrAbort } from './abort.js';

const CONTROLLER_SLOT = Symbol.for('jh-userscripts.chart-marker-save-controller');
const PROTOCOL_VERSION = 1;

function readController(api) {
  const record = api[CONTROLLER_SLOT];
  if (record === undefined) return null;
  if (record.version !== PROTOCOL_VERSION || typeof record.controller?.runAfterIdle !== 'function') {
    throw new Error('Incompatible TradingView marker save protocol; update both scripts and reload');
  }
  return record.controller;
}
const QUIET_MS = 150;
const MAX_BURST_MS = 1000;
const DRAIN_TIMEOUT_MS = 2000;

/**
 * Binance schedules a full chart save 100ms after each drawing event, including
 * disableSave drawings. Keep one stable base wrapper beneath order-save owners.
 * Only our marker mutation bursts opt into deferred default saves. During that
 * window callbacks receive the final complete snapshot, but synchronous callback
 * return values cannot be preserved. Explicit options and idle calls stay native.
 */
export function installTradingViewMarkerSaveController(api, {
  onError = (error) => { throw error; },
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  const existing = readController(api);
  if (existing) return existing;
  if (typeof api?.saveChart !== 'function') {
    throw new Error('TradingView marker save API is unavailable');
  }
  const originalSaveChart = api.saveChart;
  let burst = null;
  let tailTimer = null;
  let mutations = 0;
  let draining = 0;
  let saveRequests = 0;
  let serializations = 0;
  let callbackCount = 0;
  let failureCount = 0;
  const idleWaiters = new Set();
  const busy = () => burst !== null || mutations !== 0 || tailTimer !== null;
  function notifyIdle() {
    if (busy()) return;
    for (const resolve of idleWaiters) resolve();
    idleWaiters.clear();
  }
  function reportErrors(errors) {
    if (errors.length === 0) return;
    failureCount += errors.length;
    // A previous deferred callback must not throw into an unrelated explicit
    // save. Report all burst failures at their own asynchronous job boundary.
    setTimeoutFn(() => onError(new AggregateError(errors, 'TradingView marker save burst failed')), 0);
  }
  function flush() {
    const pending = burst;
    if (!pending) return;
    burst = null;
    clearTimeoutFn(pending.quietTimer);
    clearTimeoutFn(pending.maxTimer);
    const errors = [];
    try {
      if (pending.callbacks.length > 0) {
        serializations += 1;
        originalSaveChart.call(api, (snapshot) => {
          // The native API already serializes JSON. Reparse for every callback so
          // a host save handler cannot mutate another caller's chart snapshot.
          const json = JSON.stringify(snapshot);
          for (const callback of pending.callbacks) {
            try {
              callbackCount += 1;
              callback(JSON.parse(json));
            } catch (error) {
              errors.push(error);
            }
          }
        });
      }
    } catch (error) {
      errors.push(error);
    } finally {
      pending.callbacks.length = 0;
      notifyIdle();
      reportErrors(errors);
    }
  }
  function scheduleQuiet() {
    clearTimeoutFn(burst.quietTimer);
    burst.quietTimer = setTimeoutFn(flush, QUIET_MS);
  }
  function markMutation() {
    // Explicit saves may flush/disarm a burst before Binance's delayed callbacks
    // arrive. The independent tail still keeps a new order-save owner waiting.
    if (tailTimer !== null) clearTimeoutFn(tailTimer);
    tailTimer = setTimeoutFn(() => { tailTimer = null; notifyIdle(); }, QUIET_MS);
    if (!burst) {
      burst = { callbacks: [], quietTimer: null, maxTimer: setTimeoutFn(flush, MAX_BURST_MS) };
    }
    scheduleQuiet();
  }
  function markerSaveChart(...args) {
    const defaultCall = this === api && args.length <= 2
      && typeof args[0] === 'function' && args[1] === undefined;
    if (api.saveChart !== markerSaveChart || !defaultCall) {
      flush();
      return originalSaveChart.apply(this, args);
    }
    if (!burst) return originalSaveChart.apply(this, args);
    saveRequests += 1;
    burst.callbacks.push(args[0]);
    scheduleQuiet();
    return undefined;
  }
  api.saveChart = markerSaveChart;
  if (api.saveChart !== markerSaveChart) {
    throw new Error('TradingView marker save wrapper could not be installed');
  }
  const controller = Object.freeze({
    canMutate: () => draining === 0 && api.saveChart === markerSaveChart,
    beginMutation() {
      if (!controller.canMutate()) {
        throw new Error('TradingView marker mutation overlaps a chart save owner');
      }
      mutations += 1;
      markMutation();
      let finished = false;
      return () => {
        if (finished) throw new Error('TradingView marker mutation finished twice');
        finished = true;
        mutations -= 1;
        // Native createShape can outlive the first quiet/max window. Completion
        // always opens a fresh tail, including stale creations never published.
        markMutation();
      };
    },
    async runAfterIdle(action, { signal } = {}) {
      throwIfAborted(signal);
      draining += 1;
      let timeout = null;
      let wake = null;
      try {
        if (busy()) {
          await waitForPromiseOrAbort(new Promise((resolve, reject) => {
            wake = resolve;
            idleWaiters.add(wake);
            timeout = setTimeoutFn(() => {
              const error = new Error('TradingView marker saves did not finish before the chart operation');
              error.name = 'TradingViewMarkerSaveDrainTimeoutError';
              reject(error);
            }, DRAIN_TIMEOUT_MS);
          }), signal);
        }
        // No new mutation can start while draining; asynchronous creations are
        // counted until completion and its 100ms native save tail has settled.
        if (busy()) throw new Error('TradingView marker save drain was invalidated');
        throwIfAborted(signal);
        return await action();
      } finally {
        if (timeout !== null) clearTimeoutFn(timeout);
        if (wake !== null) idleWaiters.delete(wake);
        draining -= 1;
      }
    },
    getStats: () => ({
      busy: busy(), mutations, draining, saveRequests, serializations, callbackCount,
      failureCount, pendingCallbacks: burst?.callbacks.length || 0,
    }),
  });
  Object.defineProperty(api, CONTROLLER_SLOT, { value: Object.freeze({ version: PROTOCOL_VERSION, controller }) });
  return controller;
}

export function getTradingViewMarkerSaveController(api) {
  return readController(api);
}

/** Call the outer owner's installer in the same continuation that confirms idle. */
export function afterTradingViewMarkerSaves(api, action, options) {
  throwIfAborted(options?.signal);
  const controller = readController(api);
  return controller ? controller.runAfterIdle(action, options) : action();
}
