const QUEUE_NAME = 'webpackChunkfutures_trade_ui';

/**
 * Observe first module execution before Rspack installs its chunk dispatcher.
 * By default this only captures localForage. An explicit mirror replacer selects
 * module 70940 and runs before registration; it never calls a storage method.
 * The live scope is one incident page; the general experiment stays in the lab.
 */
export function observeChartStorageBootstrap({ onCapture, replaceMirrorFactory } = {}) {
  const lab = location.origin === 'https://chart-storage.test';
  const incidentPage = location.origin === 'https://www.binance.com'
    && location.pathname === '/zh-CN/futures/USUSDT' && self === top;
  if (!lab && !incidentPage) throw new Error('Storage bootstrap requires the lab or the top-level USUSDT incident page');
  if (onCapture !== undefined && typeof onCapture !== 'function') throw new Error('onCapture must be a synchronous function');
  if (replaceMirrorFactory !== undefined && typeof replaceMirrorFactory !== 'function') throw new Error('replaceMirrorFactory must be a synchronous function');
  const moduleId = replaceMirrorFactory === undefined ? '43917' : '70940';

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
  let inFlightAppends = 0;
  let active = true;
  let originalFactory;
  let observedFactory;
  let observedChunk;
  let runtimeRequire;
  let resolveCapture;
  let rejectCapture;
  const captured = new Promise((resolve, reject) => { resolveCapture = resolve; rejectCapture = reject; });

  function restore() {
    if (runtimeRequire && runtimeRequire.m[moduleId] === observedFactory) runtimeRequire.m[moduleId] = originalFactory;
    if (observedChunk && observedChunk[1][moduleId] === observedFactory) observedChunk[1][moduleId] = originalFactory;
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

  /** Observational failure is isolated from Rspack's persistent module-error cache. */
  function finish(succeeded, result) {
    if (!active) return;
    active = false;
    try {
      restore();
    } catch (cleanupError) {
      if (succeeded) {
        succeeded = false;
        result = cleanupError;
      }
    }
    if (succeeded) resolveCapture(result);
    else rejectCapture(result);
  }

  function prepareChunk(chunk) {
    if (!active) return chunk;
    try {
      if (!Array.isArray(chunk) || !Array.isArray(chunk[0]) || !chunk[1] || typeof chunk[1] !== 'object') {
        throw new Error('Storage bootstrap observed an unsupported chunk shape');
      }
      if (!Object.hasOwn(chunk[1], moduleId)) return chunk;
      if (originalFactory) throw new Error('Storage module registered twice before capture');
      originalFactory = chunk[1][moduleId];
      if (typeof originalFactory !== 'function') throw new Error('Storage module factory must be a function');
      const hostRuntime = chunk[2];
      if (hostRuntime !== undefined && typeof hostRuntime !== 'function') throw new Error('Storage chunk runtime callback must be a function');
      const executionFactory = replaceMirrorFactory === undefined ? originalFactory : replaceMirrorFactory(originalFactory);
      if (!active) return chunk;
      if (typeof executionFactory !== 'function') throw new Error('Mirror replacement must return a factory synchronously');
      observedFactory = function (module, exports, require) {
        runtimeRequire = require;
        let returned;
        try {
          returned = executionFactory.call(this, module, exports, require);
        } catch (hostError) {
          finish(false, hostError);
          throw hostError;
        }
        if (active) {
          try {
            const result = onCapture === undefined ? undefined : onCapture(module.exports);
            if (result && typeof result.then === 'function') throw new Error('Storage observation callback must complete synchronously');
            finish(true, module.exports);
          } catch (observationError) {
            finish(false, observationError);
          }
        }
        return returned;
      };
      observedChunk = [chunk[0], { ...chunk[1], [moduleId]: observedFactory }, require => {
        runtimeRequire = require;
        if (hostRuntime !== undefined) return hostRuntime(require);
      }];
      return observedChunk;
    } catch (observationError) {
      // Invalid or duplicate registrations still reach the host's original dispatcher.
      finish(false, observationError);
      return chunk;
    }
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
      finish(false, new Error('Storage bootstrap observed an unexpected push replacement'));
      Object.defineProperty(queue, 'push', { value: dispatcher, writable: true, configurable: true, enumerable: true });
      return;
    }
    runtimePush = dispatcher;
  }

  Object.defineProperty(queue, 'push', { get: getPush, set: setPush, enumerable: true, configurable: true });
  return Object.freeze({
    captured,
    stop() {
      finish(false, new Error('Storage bootstrap stopped before module execution'));
    },
  });
}
