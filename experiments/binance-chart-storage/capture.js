const MODULE_ID = '43917';

/**
 * Observe the host's first module execution, never require a possibly unexecuted
 * factory ourselves. onCapture runs synchronously before require returns so the
 * host cannot create its initial instances before the adapter is installed.
 */
export function observeChartStorageModule(queue = self.webpackChunkfutures_trade_ui, { onCapture } = {}) {
  if (location.origin !== 'https://chart-storage.test') throw new Error('Module capture is restricted to the isolated lab origin');
  if (!Array.isArray(queue)) throw new Error('Expected the captured chart runtime chunk queue');
  if (queue.some(chunk => Object.hasOwn(chunk[1], MODULE_ID))) throw new Error('Chart storage module is already registered; late capture is unsupported');
  if (onCapture !== undefined && typeof onCapture !== 'function') throw new Error('onCapture must be a function');
  const originalPush = queue.push;
  let originalFactory;
  let observedFactory;
  let observedChunk;
  let runtimeRequire;
  let active = true;
  let resolveCapture;
  let rejectCapture;
  const captured = new Promise((resolve, reject) => { resolveCapture = resolve; rejectCapture = reject; });

  function restore() {
    const ownsQueue = queue.push === observingPush;
    if (ownsQueue) queue.push = originalPush;
    if (runtimeRequire && runtimeRequire.m[MODULE_ID] === observedFactory) runtimeRequire.m[MODULE_ID] = originalFactory;
    if (observedChunk) observedChunk[1][MODULE_ID] = originalFactory;
    active = false;
    if (!ownsQueue) throw new Error('Chart module observer lost chunk queue ownership');
  }

  function observingPush(chunk) {
    if (!Object.hasOwn(chunk[1], MODULE_ID)) return originalPush.call(this, chunk);
    if (originalFactory) throw new Error('Chart storage module was registered twice');
    originalFactory = chunk[1][MODULE_ID];
    observedFactory = function (module, exports, require) {
      runtimeRequire = require;
      try {
        originalFactory.call(this, module, exports, require);
        const actualExport = module.exports;
        if (onCapture) {
          const result = onCapture(actualExport);
          if (result && typeof result.then === 'function') throw new Error('onCapture must install synchronously');
        }
        restore();
        resolveCapture(actualExport);
      } catch (error) {
        rejectCapture(error);
        if (active) restore();
        throw error;
      }
    };
    const hostRuntime = chunk[2];
    observedChunk = [chunk[0], { ...chunk[1], [MODULE_ID]: observedFactory }, require => {
      runtimeRequire = require;
      if (hostRuntime) return hostRuntime(require);
    }];
    return originalPush.call(this, observedChunk);
  }

  queue.push = observingPush;
  return Object.freeze({
    captured,
    stop() {
      if (active) {
        rejectCapture(new Error('Chart storage module capture stopped before execution'));
        restore();
      }
    },
  });
}
