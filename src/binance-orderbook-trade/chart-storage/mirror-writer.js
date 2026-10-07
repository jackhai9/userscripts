import { snapshotJson, byteLength, equalJson } from './json.js';

const DEFAULT_LIMITS = Object.freeze({
  maxEntries: 512,
  maxBatchBytes: 4 * 1024 * 1024,
  maxReadBytes: 4 * 1024 * 1024,
  maxPendingBatches: 16,
  maxPendingBytes: 64 * 1024 * 1024,
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * Batch only the host's explicit mirror destination writes. The runtime owns URL
 * admission; localForage retains its instances, API methods and connections.
 * Native routing is allowed only before an IndexedDB transaction is created.
 */
export function createChartMirrorWriter({ limits: suppliedLimits = {} } = {}) {
  const limits = { ...DEFAULT_LIMITS, ...suppliedLimits };
  for (const [key, value] of Object.entries(limits)) {
    assert(Object.hasOwn(DEFAULT_LIMITS, key), `Unknown mirror limit: ${key}`);
    assert(Number.isSafeInteger(value) && value > 0, `${key} must be a positive safe integer`);
  }
  let phase = 'active';
  let stopping;
  let resolveDrain;
  const stats = {
    acceptedBatches: 0, rejectedBatches: 0, failedBatches: 0,
    pendingBatches: 0, pendingBytes: 0, peakPendingBatches: 0, peakPendingBytes: 0,
    transactions: 0, committedTransactions: 0, abortedTransactions: 0,
    committedWrites: 0, skippedWrites: 0, nativePassthroughBatches: 0,
  };

  function stop() {
    if (phase === 'active') {
      phase = 'draining';
      const drained = stats.pendingBatches === 0
        ? Promise.resolve() : new Promise(resolve => { resolveDrain = resolve; });
      stopping = drained.then(() => { phase = 'stopped'; });
    }
    return stopping;
  }

  function release(work) {
    stats.pendingBatches -= 1;
    stats.pendingBytes -= work.bytes;
    if (phase === 'draining' && stats.pendingBatches === 0) resolveDrain();
  }

  /** Native Promise.all may reject early; the lifecycle fence waits for every map member. */
  function nativeBeforeTransaction(work, nativeThunk) {
    stats.rejectedBatches += 1;
    stats.nativePassthroughBatches += 1;
    stats.pendingBytes -= work.bytes;
    work.bytes = 0;
    let results;
    try {
      results = nativeThunk();
    } catch (error) {
      release(work);
      return Promise.reject(error);
    }
    Promise.allSettled(results).then(() => release(work));
    return Promise.all(results);
  }

  /** Request callbacks keep the real transaction alive without awaiting another task. */
  function transact(transaction, entries) {
    return new Promise((resolve, reject) => {
      let index = 0;
      let writes = 0;
      let skipped = 0;
      let failure;
      const budget = { remaining: limits.maxReadBytes };
      transaction.oncomplete = () => {
        stats.committedTransactions += 1;
        stats.committedWrites += writes;
        stats.skippedWrites += skipped;
        resolve();
      };
      transaction.onabort = () => {
        stats.abortedTransactions += 1;
        reject(failure || transaction.error || new DOMException('Chart mirror batch aborted', 'AbortError'));
      };
      transaction.onerror = event => { failure = event.target.error; };

      function guard(action) {
        try {
          action();
        } catch (error) {
          failure = error;
          try {
            transaction.abort();
          } catch (abortError) {
            // A concurrent native abort listener may already own the final event.
            if (abortError instanceof DOMException && abortError.name === 'InvalidStateError') return;
            throw abortError;
          }
        }
      }

      let store;
      function advance() {
        if (index === entries.length) return;
        const [key, value] = entries[index];
        function next() { index += 1; advance(); }
        function put() {
          const request = store.put(value === null ? undefined : value, key);
          writes += 1;
          request.onsuccess = () => guard(next);
        }
        if (budget.remaining <= 0) { put(); return; }
        const read = store.get(key);
        read.onsuccess = () => guard(() => {
          let current;
          try {
            current = snapshotJson(read.result === undefined ? null : read.result, budget);
          } catch {
            // Unsupported old values and exhausted comparison budgets only disable
            // deduplication; they must not discard this otherwise valid mirror.
            budget.remaining = 0;
            put();
            return;
          }
          function writeIfChanged(present) {
            if (present && equalJson(current, value)) { skipped += 1; next(); }
            else put();
          }
          if (read.result === undefined && value === null) {
            const exists = store.getKey(key);
            exists.onsuccess = () => guard(() => writeIfChanged(exists.result !== undefined));
          } else writeIfChanged(read.result !== undefined);
        });
      }
      guard(() => { store = transaction.objectStore('keyvaluepairs'); advance(); });
    });
  }

  async function write(target, entries, work, nativeThunk) {
    let transaction;
    try {
      await target.ready();
      assert(target.driver() === 'asyncStorage', 'Chart mirror requires the native IndexedDB driver');
      const info = target._dbInfo;
      assert((info.name === 'chart_futures' || info.name === 'chart_delivery') && info.storeName === 'keyvaluepairs',
        'Unexpected chart mirror database configuration');
      transaction = info.db.transaction('keyvaluepairs', 'readwrite');
    } catch {
      return nativeBeforeTransaction(work, nativeThunk);
    }
    stats.acceptedBatches += 1;
    stats.transactions += 1;
    try {
      await transact(transaction, entries);
    } catch (error) {
      stats.failedBatches += 1;
      stop();
      throw error;
    } finally {
      release(work);
    }
  }

  function dispatch(target, entries, nativeThunk) {
    assert(typeof nativeThunk === 'function', 'Chart mirror dispatch requires its original native expression');
    if (phase === 'stopped') return nativeThunk();
    if (phase === 'draining') return [stopping.then(() => Promise.all(nativeThunk()))];

    // Register before inspecting caller data: a Proxy can synchronously call stop.
    const work = { bytes: 0 };
    stats.pendingBatches += 1;
    let copied;
    try {
      assert(Array.isArray(entries), 'Chart mirror entries must be an array');
      if (entries.length === 0) { release(work); return []; }
      stats.peakPendingBatches = Math.max(stats.peakPendingBatches, stats.pendingBatches);
      assert(entries.length <= limits.maxEntries, 'Chart mirror entry limit exceeded');
      assert(stats.pendingBatches <= limits.maxPendingBatches, 'Chart mirror pending batch limit exceeded');
      const budget = { remaining: limits.maxBatchBytes };
      const seen = new Set();
      const keys = new Set();
      copied = entries.map(entry => {
        assert(Array.isArray(entry) && entry.length === 2, 'Chart mirror entry must be a key/value pair');
        const [key, value] = entry;
        assert(typeof key === 'string' && (key.startsWith('#TV_SYMBOL-') || key.startsWith('myTradingView')),
          'Chart mirror received a non-chart key');
        assert(!keys.has(key), 'Chart mirror keys must be unique');
        keys.add(key);
        budget.remaining -= byteLength(key) + 3;
        return [key, snapshotJson(value, budget, seen)];
      });
      const bytes = byteLength(copied);
      assert(bytes <= limits.maxBatchBytes, 'Chart mirror batch byte limit exceeded');
      assert(stats.pendingBytes + bytes <= limits.maxPendingBytes, 'Chart mirror pending byte limit exceeded');
      work.bytes = bytes;
      stats.pendingBytes += bytes;
      stats.peakPendingBytes = Math.max(stats.peakPendingBytes, stats.pendingBytes);
    } catch {
      return [nativeBeforeTransaction(work, nativeThunk)];
    }
    return [write(target, copied, work, nativeThunk)];
  }

  return Object.freeze({ dispatch, getStats: () => ({ ...stats }), getPhase: () => phase, stop });
}
