import { observeChartStorageBootstrap } from './bootstrap.js';

/**
 * Bounded startup observation. Native instances, storage methods and results are
 * untouched. Only two fixed chart database names and the default store are reported.
 */
export function startChartStoragePreflight() {
  const state = {
    outcome: 'waiting', active: true, captureAtMs: null, failure: null,
    instances: { chart_futures: 0, chart_delivery: 0 }, firstInstances: [],
  };
  let localforage;
  let originalFactory;
  let originalDescriptor;
  let observedFactory;
  let timer;
  let observer;

  function snapshot() {
    return {
      ...state, instances: { ...state.instances },
      firstInstances: state.firstInstances.map(instance => ({ ...instance })),
    };
  }

  function stop() {
    if (!state.active) return snapshot();
    state.active = false;
    clearTimeout(timer);
    self.removeEventListener('pagehide', stop);
    if (localforage && observedFactory) {
      const descriptor = Object.getOwnPropertyDescriptor(localforage, 'createInstance');
      if (descriptor?.value !== observedFactory || !descriptor.configurable) {
        state.outcome = 'failed';
        state.failure = 'factory_ownership_changed';
      } else if (originalDescriptor) {
        Object.defineProperty(localforage, 'createInstance', originalDescriptor);
      } else {
        delete localforage.createInstance;
      }
    }
    observer.stop();
    return snapshot();
  }

  observer = observeChartStorageBootstrap({
    onCapture(actualExport) {
      localforage = actualExport;
      originalDescriptor = Object.getOwnPropertyDescriptor(actualExport, 'createInstance');
      originalFactory = actualExport.createInstance;
      state.captureAtMs = performance.now();
      observedFactory = function (...args) {
        const instance = Reflect.apply(originalFactory, this, args);
        if (state.active) {
          try {
            const name = instance._config.name;
            if (Object.hasOwn(state.instances, name)) {
              state.instances[name] += 1;
              if (state.firstInstances.length < 16) {
                state.firstInstances.push({
                  name, storeName: instance._config.storeName === 'keyvaluepairs' ? 'keyvaluepairs' : null,
                  atMs: performance.now(),
                });
              }
            }
          } catch {
            // Metadata failure retires the observer while returning the untouched native instance.
            state.outcome = 'failed';
            state.failure = 'instance_metadata_unavailable';
            stop();
          }
        }
        return instance;
      };
      Object.defineProperty(actualExport, 'createInstance', {
        value: observedFactory, writable: true, configurable: true, enumerable: true,
      });
      state.outcome = 'captured';
    },
  });
  observer.captured.catch(() => {
    if (!state.active) return;
    state.outcome = 'failed';
    state.failure = 'bootstrap_rejected';
    stop();
  });
  self.addEventListener('pagehide', stop, { once: true });
  timer = setTimeout(stop, 30_000);
  return Object.freeze({ snapshot, stop });
}
