import { isChartStoragePage } from './scope.js';

const QUEUE_NAME = 'webpackChunkfutures_trade_ui';

/**
 * Own one early Rspack queue accessor for explicitly pinned factory replacements.
 * Each target terminates independently; restoring registration never changes the
 * runtime's module cache or an already-created export.
 */
export function observeChartStorageBootstrap({ targets, onCapture, onFailure, onComplete }) {
  if (!isChartStoragePage()) throw new Error('Storage bootstrap requires a top-level Binance trading page');
  const registrations = new Map(Object.entries(targets).map(([id, replaceFactory]) => {
    if (typeof replaceFactory !== 'function') throw new Error('Storage replacement must be a synchronous function');
    return [id, { id, replaceFactory, terminal: false }];
  }));
  if (registrations.size === 0) throw new Error('Storage bootstrap requires explicit module targets');
  for (const callback of [onCapture, onFailure, onComplete]) {
    if (typeof callback !== 'function') throw new Error('Storage observation callbacks must be synchronous functions');
  }

  const globalDescriptor = Object.getOwnPropertyDescriptor(self, QUEUE_NAME);
  if (globalDescriptor && !Object.hasOwn(globalDescriptor, 'value')) throw new Error('Storage bootstrap requires a native queue property');
  const queue = globalDescriptor && globalDescriptor.value !== undefined ? globalDescriptor.value : [];
  const nativeAppend = Array.prototype.push;
  if (!Array.isArray(queue) || queue.length !== 0 || queue.push !== nativeAppend || Object.hasOwn(queue, 'push')) {
    throw new Error('Storage bootstrap must start before runtime on a native empty queue');
  }
  if (globalDescriptor && globalDescriptor.value === undefined && !globalDescriptor.configurable) {
    throw new Error('Storage bootstrap cannot own the existing global queue property');
  }
  const createdQueue = !globalDescriptor || globalDescriptor.value === undefined;
  if (createdQueue) Object.defineProperty(self, QUEUE_NAME, { value: queue, writable: true, configurable: true, enumerable: true });

  let runtimePush;
  let runtimeRequire;
  let inFlightAppends = 0;
  let active = true;

  function restoreFactory(target) {
    if (target.observedFactory && runtimeRequire && runtimeRequire.m[target.id] === target.observedFactory) {
      runtimeRequire.m[target.id] = target.originalFactory;
    }
    if (target.observedChunk && target.observedChunk[1][target.id] === target.observedFactory) {
      target.observedChunk[1][target.id] = target.originalFactory;
    }
  }

  function restoreQueue() {
    const descriptor = Object.getOwnPropertyDescriptor(queue, 'push');
    if (!descriptor || descriptor.get !== getPush || descriptor.set !== setPush || !descriptor.configurable) {
      throw new Error('Storage bootstrap lost queue accessor ownership');
    }
    if (runtimePush) {
      Object.defineProperty(queue, 'push', { value: runtimePush, writable: true, configurable: true, enumerable: true });
    } else {
      delete queue.push;
      if (createdQueue && inFlightAppends === 0 && queue.length === 0 && Object.getOwnPropertyDescriptor(self, QUEUE_NAME)?.value === queue) {
        if (globalDescriptor) Object.defineProperty(self, QUEUE_NAME, globalDescriptor);
        else delete self[QUEUE_NAME];
      }
    }
  }

  /** Observational cleanup must not enter Rspack's persistent module-error cache. */
  function completeIfFinished() {
    if (!active || [...registrations.values()].some(target => !target.terminal)) return;
    active = false;
    let reason = null;
    try {
      restoreQueue();
    } catch {
      // A new owner keeps its accessor; report the lost boundary without replacing it.
      reason = 'ownership_lost';
    }
    onComplete(reason);
  }

  function finish(target, reason) {
    if (target.terminal) return;
    target.terminal = true;
    restoreFactory(target);
    if (reason === 'captured') onCapture(target.id);
    else onFailure(target.id, reason);
    completeIfFinished();
  }

  function stop(reason = 'stopped') {
    for (const target of registrations.values()) finish(target, reason);
  }

  function prepareChunk(chunk) {
    if (!active) return chunk;
    if (!Array.isArray(chunk) || !Array.isArray(chunk[0]) || !chunk[1] || typeof chunk[1] !== 'object' ||
        (chunk[2] !== undefined && typeof chunk[2] !== 'function')) {
      stop('unsupported_registration');
      return chunk;
    }
    let observedChunk;
    for (const target of registrations.values()) {
      if (target.terminal || !Object.hasOwn(chunk[1], target.id)) continue;
      if (target.originalFactory || typeof chunk[1][target.id] !== 'function') {
        finish(target, 'unsupported_registration');
        continue;
      }
      target.originalFactory = chunk[1][target.id];
      let executionFactory;
      try {
        executionFactory = target.replaceFactory(target.originalFactory);
      } catch {
        // A failed complete-source pin leaves only this target's registration native.
        finish(target, 'source_mismatch');
        continue;
      }
      if (target.terminal) continue;
      if (typeof executionFactory !== 'function') {
        finish(target, 'unsupported_registration');
        continue;
      }
      target.observedFactory = function (module, exports, require) {
        runtimeRequire = require;
        let returned;
        try {
          returned = executionFactory.call(this, module, exports, require);
        } catch (hostError) {
          finish(target, 'execution_failed');
          throw hostError;
        }
        finish(target, 'captured');
        return returned;
      };
      if (!observedChunk) {
        const hostRuntime = chunk[2];
        observedChunk = [chunk[0], { ...chunk[1] }, require => {
          runtimeRequire = require;
          if (hostRuntime !== undefined) return hostRuntime(require);
        }];
      }
      observedChunk[1][target.id] = target.observedFactory;
      target.observedChunk = observedChunk;
    }
    return observedChunk || chunk;
  }

  /** Rspack retains this parent callback; after takeover it must only append. */
  function preRuntimePush(...chunks) {
    if (!active || runtimePush) return nativeAppend.apply(this, chunks);
    inFlightAppends += 1;
    try {
      return nativeAppend.apply(this, chunks.map(prepareChunk));
    } finally {
      inFlightAppends -= 1;
    }
  }

  function runtimeObservingPush(chunk) {
    return runtimePush.call(this, prepareChunk(chunk));
  }

  function getPush() {
    return runtimePush ? runtimeObservingPush : preRuntimePush;
  }

  function setPush(dispatcher) {
    if (!active) {
      Object.defineProperty(queue, 'push', { value: dispatcher, writable: true, configurable: true, enumerable: true });
      return;
    }
    if (runtimePush || typeof dispatcher !== 'function') {
      stop('unexpected_dispatcher');
      Object.defineProperty(queue, 'push', { value: dispatcher, writable: true, configurable: true, enumerable: true });
      return;
    }
    runtimePush = dispatcher;
  }

  Object.defineProperty(queue, 'push', { get: getPush, set: setPush, enumerable: true, configurable: true });
  return Object.freeze({
    stop,
    stopTarget(id, reason = 'stopped') {
      const target = registrations.get(id);
      if (!target) throw new Error('Storage bootstrap target is not registered');
      finish(target, reason);
    },
  });
}
