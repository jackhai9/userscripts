const LAB_ORIGIN = 'https://chart-storage.test';
const DATABASES = new Set(['chart_futures', 'chart_delivery']);
const DEFAULT_LIMITS = Object.freeze({
  maxBatchOperations: 512,
  maxBatchBytes: 4 * 1024 * 1024,
  maxPendingOperations: 8192,
  maxPendingBytes: 64 * 1024 * 1024,
  maxResultBytes: 4 * 1024 * 1024,
});
const installations = new WeakSet();
const encoder = new TextEncoder();
const nativeObjectSource = Function.prototype.toString.call(Object);

export { snapshotJson, byteLength, equalJson };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** TradingView creates snapshots in an iframe, whose Object.prototype differs. */
function isPlainJsonObject(value) {
  const prototype = Object.getPrototypeOf(value);
  if (prototype === null || Object.getPrototypeOf(prototype) !== null) return false;
  const constructor = Object.getOwnPropertyDescriptor(prototype, 'constructor');
  if (!constructor || !Object.hasOwn(constructor, 'value') || typeof constructor.value !== 'function') return false;
  if (Function.prototype.toString.call(constructor.value) !== nativeObjectSource) return false;
  const constructorPrototype = Object.getOwnPropertyDescriptor(constructor.value, 'prototype');
  return !!constructorPrototype && Object.hasOwn(constructorPrototype, 'value') && constructorPrototype.value === prototype;
}

/** Reject values whose JSON encoding would silently change their meaning. */
function snapshotJson(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    assert(Number.isFinite(value), 'Chart JSON numbers must be finite');
    return value;
  }
  assert(typeof value === 'object', 'Chart values must be JSON');
  assert(!ancestors.has(value), 'Chart JSON must not contain cycles');
  const array = Array.isArray(value);
  assert(array || isPlainJsonObject(value), 'Chart values must be plain JSON');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  assert(Object.getOwnPropertySymbols(value).length === 0, 'Chart JSON must not contain symbol properties');
  const keys = Object.keys(descriptors).filter(key => !(array && key === 'length'));
  if (array) assert(keys.length === value.length && keys.every((key, index) => key === String(index)), 'Chart JSON arrays must be dense');
  ancestors.add(value);
  const result = array ? [] : {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    assert(descriptor.enumerable && Object.hasOwn(descriptor, 'value'), 'Chart JSON requires enumerable data properties');
    Object.defineProperty(result, key, {
      value: snapshotJson(descriptor.value, ancestors), enumerable: true, writable: true, configurable: true,
    });
  }
  ancestors.delete(value);
  return result;
}

function byteLength(value) {
  return encoder.encode(JSON.stringify(value)).byteLength;
}

/** Compare JSON structure without changing the property order of stored snapshots. */
function equalJson(first, second) {
  if (first === second) return true;
  if (first === null || second === null || typeof first !== 'object' || typeof second !== 'object') return false;
  if (Array.isArray(first) !== Array.isArray(second)) return false;
  const keys = Object.keys(first);
  if (keys.length !== Object.keys(second).length) return false;
  return keys.every(key => Object.hasOwn(second, key) && equalJson(first[key], second[key]));
}

function isChartKey(key) {
  return key.startsWith('#TV_SYMBOL-') || key.startsWith('myTradingView');
}

/** Callback exceptions are caller errors; they cannot abandon other accepted calls. */
function withCallback(promise, callback) {
  if (callback !== undefined) {
    assert(typeof callback === 'function', 'Storage callback must be a function');
    const invoke = (error, value) => {
      try {
        callback(error, value);
      } catch (callbackError) {
        queueMicrotask(() => { throw callbackError; });
      }
    };
    promise.then(value => invoke(null, value), error => invoke(error, undefined));
  }
  return promise;
}

/**
 * Isolated facade for the captured localForage export. The library owns its
 * connections; this experiment owns only accepted operations and their batches.
 * Batch atomicity and connection-failure behavior deliberately differ from native.
 */
export function installChartStoragePrototype(localforage, options = {}) {
  assert(location.origin === LAB_ORIGIN, 'Chart storage prototype is restricted to the isolated lab origin');
  assert(typeof localforage.createInstance === 'function', 'Expected the actual localForage export');
  assert(!installations.has(localforage), 'Chart storage prototype is already installed');
  const limits = { ...DEFAULT_LIMITS, ...options };
  for (const [name, value] of Object.entries(limits)) {
    assert(Object.hasOwn(DEFAULT_LIMITS, name), `Unknown chart storage limit: ${name}`);
    assert(Number.isSafeInteger(value) && value > 0, `${name} must be a positive safe integer`);
  }
  const nativeCreateInstance = localforage.createInstance;
  const originalFactoryDescriptor = Object.getOwnPropertyDescriptor(localforage, 'createInstance');
  const coordinators = new Map();
  const waiters = [];
  let phase = 'active';
  let stopping;
  const stats = {
    acceptedOperations: 0, rejectedOperations: 0, failedOperations: 0,
    pendingOperations: 0, pendingBytes: 0, peakPendingOperations: 0, peakPendingBytes: 0,
    transactions: 0, committedTransactions: 0, abortedTransactions: 0,
    committedWrites: 0, skippedWrites: 0, barriers: 0,
  };

  function finish(operation, succeeded, value) {
    stats.pendingOperations -= 1;
    stats.pendingBytes -= operation.bytes;
    if (!succeeded) {
      stats.failedOperations += 1;
      operation.reject(value);
    } else {
      operation.resolve(value);
    }
  }

  function notifyDrained() {
    if (stats.pendingOperations === 0) {
      for (const resolve of waiters.splice(0)) resolve();
    }
  }

  function drain() {
    return stats.pendingOperations === 0 ? Promise.resolve() : new Promise(resolve => waiters.push(resolve));
  }

  /** Native request events keep the transaction active; no Promise is awaited inside it. */
  function transact(database, batch) {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('keyvaluepairs', batch.some(op => op.method === 'setItem') ? 'readwrite' : 'readonly');
      stats.transactions += 1;
      const store = transaction.objectStore('keyvaluepairs');
      const results = [];
      let index = 0;
      let resultBytes = 0;
      let writes = 0;
      let skipped = 0;
      let failure;
      transaction.oncomplete = () => {
        stats.committedTransactions += 1;
        stats.committedWrites += writes;
        stats.skippedWrites += skipped;
        resolve(results);
      };
      transaction.onabort = () => {
        stats.abortedTransactions += 1;
        reject(failure || transaction.error || new DOMException('Chart storage transaction aborted', 'AbortError'));
      };
      transaction.onerror = event => { failure = event.target.error; };

      function guarded(action) {
        try {
          action();
        } catch (error) {
          try {
            transaction.abort();
          } catch (abortError) {
            // Another native listener may already have aborted this transaction.
            // Its abort event owns the error; do not replace it with a late request failure.
            if (abortError instanceof DOMException && abortError.name === 'InvalidStateError') return;
            throw abortError;
          }
          failure = error;
        }
      }

      function completeOperation(value) {
        const snapshot = snapshotJson(value);
        resultBytes += byteLength(snapshot);
        assert(resultBytes <= limits.maxResultBytes, 'Chart batch result byte limit exceeded');
        results.push(snapshot);
        index += 1;
        advance();
      }

      function advance() {
        if (index === batch.length) return;
        const operation = batch[index];
        const request = store.get(operation.key);
        request.onsuccess = () => guarded(() => {
          if (operation.method === 'getItem') {
            completeOperation(request.result === undefined ? null : request.result);
            return;
          }
          function compareAndWrite(present) {
            const current = request.result === undefined ? null : snapshotJson(request.result);
            if (present && equalJson(current, operation.value)) {
              skipped += 1;
              completeOperation(operation.value);
            } else {
              const put = store.put(operation.value === null ? undefined : operation.value, operation.key);
              writes += 1;
              put.onsuccess = () => guarded(() => completeOperation(operation.value));
            }
          }
          if (request.result === undefined) {
            const existence = store.getKey(operation.key);
            existence.onsuccess = () => guarded(() => compareAndWrite(existence.result !== undefined));
          } else {
            compareAndWrite(true);
          }
        });
      }
      guarded(advance);
    });
  }

  /** Each store has one queue across instances, including operations awaiting ready. */
  async function pump(coordinator) {
    while (coordinator.queue.length > 0) {
      const first = coordinator.queue.shift();
      const batch = [first];
      if (!first.barrier) {
        let bytes = first.bytes;
        while (coordinator.queue.length > 0 && batch.length < limits.maxBatchOperations) {
          const next = coordinator.queue[0];
          if (next.barrier || bytes + next.bytes > limits.maxBatchBytes) break;
          batch.push(coordinator.queue.shift());
          bytes += next.bytes;
        }
      }
      try {
        for (const raw of new Set(batch.map(operation => operation.raw))) {
          await raw.ready();
          assert(raw.driver() === localforage.INDEXEDDB, 'Managed chart storage requires the IndexedDB driver');
          assert(raw._dbInfo.name === coordinator.name && raw._dbInfo.storeName === 'keyvaluepairs', 'Managed chart database configuration changed');
        }
        let values;
        if (first.barrier) {
          stats.barriers += 1;
          const result = await first.raw[first.method](...first.args);
          if (result !== undefined) assert(byteLength(snapshotJson(result)) <= limits.maxResultBytes, 'Chart barrier result byte limit exceeded');
          values = [result];
        } else {
          values = await transact(first.raw._dbInfo.db, batch);
        }
        batch.forEach((operation, index) => finish(operation, true, values[index]));
      } catch (error) {
        // The batch boundary settles every accepted caller on validation, connection or IDB failure.
        batch.forEach(operation => finish(operation, false, error));
      }
    }
    coordinator.running = false;
    notifyDrained();
  }

  function submit(raw, method, args, callback) {
    if (callback !== undefined) assert(typeof callback === 'function', 'Storage callback must be a function');
    let promise;
    try {
      let key;
      let value;
      if (['getItem', 'setItem', 'removeItem'].includes(method)) {
        key = args[0];
        assert(typeof key === 'string' && key.length > 0, 'Chart storage requires a nonempty string key');
      }
      if (method === 'setItem') value = snapshotJson(args[1]);
      if (method === 'key') assert(Number.isSafeInteger(args[0]) && args[0] >= 0, 'Chart key index must be a nonnegative safe integer');
      const copiedArgs = method === 'setItem' ? [key, value] : [...args];
      const bytes = byteLength(copiedArgs);
      const barrier = !((method === 'getItem' || method === 'setItem') && isChartKey(key));
      if (method === 'setItem') assert(byteLength(value) <= limits.maxResultBytes, 'Chart set result byte limit exceeded');
      assert(barrier || bytes <= limits.maxBatchBytes, 'Chart operation exceeds batch byte limit');
      assert(stats.pendingOperations < limits.maxPendingOperations, 'Chart pending operation capacity exceeded');
      assert(stats.pendingBytes + bytes <= limits.maxPendingBytes, 'Chart pending byte capacity exceeded');
      const name = raw.config('name');
      // Value inspection can run Proxy traps that synchronously stop admission.
      assert(phase === 'active', 'Chart storage admission stopped during validation');
      let coordinator = coordinators.get(name);
      if (!coordinator) {
        coordinator = { name, queue: [], running: false };
        coordinators.set(name, coordinator);
      }
      promise = new Promise((resolve, reject) => {
        coordinator.queue.push({ raw, method, args: copiedArgs, key, value, bytes, barrier, resolve, reject });
      });
      stats.acceptedOperations += 1;
      stats.pendingOperations += 1;
      stats.pendingBytes += bytes;
      stats.peakPendingOperations = Math.max(stats.peakPendingOperations, stats.pendingOperations);
      stats.peakPendingBytes = Math.max(stats.peakPendingBytes, stats.pendingBytes);
      if (!coordinator.running) {
        coordinator.running = true;
        queueMicrotask(() => { void pump(coordinator); });
      }
    } catch (error) {
      stats.rejectedOperations += 1;
      promise = Promise.reject(error);
    }
    return withCallback(promise, callback);
  }

  /**
   * Retained host instances outlive the optimization. The finite stop fence
   * prevents new native calls from overtaking accepted batches during teardown.
   * Native callbacks have method-specific signatures and receive the original args.
   */
  function forwardNative(raw, method, args) {
    const invoke = () => Reflect.apply(raw[method], raw, args);
    return phase === 'stopped' ? invoke() : stopping.then(invoke);
  }

  function callStorage(raw, method, arity, args) {
    if (phase !== 'active') return forwardNative(raw, method, args);
    return submit(raw, method, args.slice(0, arity), args[arity]);
  }

  function createInstance(...args) {
    const raw = Reflect.apply(nativeCreateInstance, localforage, args);
    if (phase === 'stopped' || !DATABASES.has(raw.config('name')) || raw.config('storeName') !== 'keyvaluepairs') return raw;
    const facade = {
      getItem: (...args) => callStorage(raw, 'getItem', 1, args),
      setItem: (...args) => callStorage(raw, 'setItem', 2, args),
      removeItem: (...args) => callStorage(raw, 'removeItem', 1, args),
      clear: (...args) => callStorage(raw, 'clear', 0, args),
      keys: (...args) => callStorage(raw, 'keys', 0, args),
      key: (...args) => callStorage(raw, 'key', 1, args),
      length: (...args) => callStorage(raw, 'length', 0, args),
      ready(...args) {
        return phase === 'active' ? raw.ready(...args) : forwardNative(raw, 'ready', args);
      },
      config(option) {
        if (phase === 'stopped') return raw.config(option);
        assert(option === undefined || typeof option === 'string', 'Managed chart configuration is immutable');
        return structuredClone(raw.config(option));
      },
      driver() { return raw.driver(); },
      createInstance,
    };
    for (const name of ['setDriver', 'dropInstance', 'defineDriver', 'iterate', 'getDriver', 'getSerializer']) {
      facade[name] = (...args) => phase === 'active'
        ? Promise.reject(new Error(`${name} is unsupported by the chart storage experiment`))
        : forwardNative(raw, name, args);
    }
    return Object.freeze(facade);
  }

  localforage.createInstance = createInstance;
  const installedFactoryDescriptor = Object.getOwnPropertyDescriptor(localforage, 'createInstance');
  function assertFactoryOwnership() {
    const descriptor = Object.getOwnPropertyDescriptor(localforage, 'createInstance');
    assert(descriptor && ['value', 'writable', 'enumerable', 'configurable'].every(
      key => descriptor[key] === installedFactoryDescriptor[key],
    ), 'Chart factory ownership changed before restoration');
  }

  // A stopped facade cannot join a new installation's queue; require a fresh export lifecycle.
  installations.add(localforage);
  return Object.freeze({
    getStats: () => ({ ...stats }),
    drain,
    stop() {
      if (phase === 'active') {
        assertFactoryOwnership();
        phase = 'draining';
        stopping = drain().then(() => {
          assertFactoryOwnership();
          if (originalFactoryDescriptor) Object.defineProperty(localforage, 'createInstance', originalFactoryDescriptor);
          else delete localforage.createInstance;
          phase = 'stopped';
        });
      }
      return stopping;
    },
  });
}
