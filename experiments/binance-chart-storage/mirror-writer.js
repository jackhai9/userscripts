import { snapshotJson, byteLength, equalJson } from './adapter.js';

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
 * One explicit mirror destination batch, never a replacement localForage API.
 * The caller owns native instance creation, source reads and the original catch.
 * Each accepted batch commits or aborts as a whole; it is never replayed.
 * The explicit page probe scope relies on its harness to own an anonymous browser;
 * origin/path validation alone cannot establish profile isolation or authorization.
 */
export function createChartMirrorWriter({ limits: suppliedLimits = {}, scope = 'lab' } = {}) {
  assert(scope === 'lab' || scope === 'isolated-ususdt-probe', 'Unknown chart mirror scope');
  if (scope === 'lab') {
    assert(location.origin === 'https://chart-storage.test', 'Chart mirror writer requires the isolated lab origin');
  } else {
    assert(location.origin === 'https://www.binance.com' && location.pathname === '/zh-CN/futures/USUSDT' && self === top,
      'Chart mirror writer requires the top-level USUSDT probe page');
  }
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
    committedWrites: 0, skippedWrites: 0,
  };

  function transact(database, entries) {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('keyvaluepairs', 'readwrite');
      stats.transactions += 1;
      const store = transaction.objectStore('keyvaluepairs');
      let index = 0;
      let readBytes = 0;
      let writes = 0;
      let skipped = 0;
      let failure;
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
            // A competing native abort listener may already own completion.
            if (abortError instanceof DOMException && abortError.name === 'InvalidStateError') return;
            throw abortError;
          }
        }
      }

      function advance() {
        if (index === entries.length) return;
        const [key, value] = entries[index];
        const read = store.get(key);
        read.onsuccess = () => guard(() => {
          const current = read.result === undefined ? null : snapshotJson(read.result);
          readBytes += byteLength(current);
          assert(readBytes <= limits.maxReadBytes, 'Mirror stored-value byte limit exceeded');
          function writeIfChanged(present) {
            if (present && equalJson(current, value)) {
              skipped += 1;
              index += 1;
              advance();
            } else {
              const put = store.put(value === null ? undefined : value, key);
              writes += 1;
              put.onsuccess = () => guard(() => { index += 1; advance(); });
            }
          }
          if (read.result === undefined) {
            const exists = store.getKey(key);
            exists.onsuccess = () => guard(() => writeIfChanged(exists.result !== undefined));
          } else {
            writeIfChanged(true);
          }
        });
      }
      guard(advance);
    });
  }

  async function write(target, entries) {
    await target.ready();
    assert(target.driver() === 'asyncStorage', 'Chart mirror batching requires the native IndexedDB driver');
    const info = target._dbInfo;
    assert((info.name === 'chart_futures' || info.name === 'chart_delivery') && info.storeName === 'keyvaluepairs',
      'Unexpected chart mirror database configuration');
    await transact(info.db, entries);
  }

  function release(bytes) {
    stats.pendingBatches -= 1;
    stats.pendingBytes -= bytes;
    if (phase === 'draining' && stats.pendingBatches === 0) resolveDrain();
  }

  function dispatch(target, entries, nativeThunk) {
    assert(typeof nativeThunk === 'function', 'Chart mirror dispatch requires its original native expression');
    if (phase === 'stopped') return nativeThunk();
    if (phase === 'draining') return [stopping.then(() => Promise.all(nativeThunk()))];

    let copied;
    let bytes;
    try {
      assert(Array.isArray(entries), 'Chart mirror entries must be an array');
      if (entries.length === 0) return [];
      assert(entries.length <= limits.maxEntries, 'Chart mirror entry limit exceeded');
      const keys = new Set();
      copied = entries.map(entry => {
        assert(Array.isArray(entry) && entry.length === 2, 'Chart mirror entry must be a key/value pair');
        const [key, value] = entry;
        assert(typeof key === 'string' && (key.startsWith('#TV_SYMBOL-') || key.startsWith('myTradingView')),
          'Chart mirror received a non-chart key');
        assert(!keys.has(key), 'Chart mirror keys must be unique');
        keys.add(key);
        return [key, snapshotJson(value)];
      });
      bytes = byteLength(copied);
      assert(bytes <= limits.maxBatchBytes, 'Chart mirror batch byte limit exceeded');
      assert(stats.pendingBatches < limits.maxPendingBatches, 'Chart mirror pending batch limit exceeded');
      assert(stats.pendingBytes + bytes <= limits.maxPendingBytes, 'Chart mirror pending byte limit exceeded');
      assert(phase === 'active', 'Chart mirror admission stopped during validation');
    } catch (error) {
      stats.rejectedBatches += 1;
      return [Promise.reject(error)];
    }
    stats.acceptedBatches += 1;
    stats.pendingBatches += 1;
    stats.pendingBytes += bytes;
    stats.peakPendingBatches = Math.max(stats.peakPendingBatches, stats.pendingBatches);
    stats.peakPendingBytes = Math.max(stats.peakPendingBytes, stats.pendingBytes);
    const completion = write(target, copied).then(
      () => { release(bytes); },
      error => { stats.failedBatches += 1; release(bytes); throw error; },
    );
    return [completion];
  }

  return Object.freeze({
    dispatch,
    getStats: () => ({ ...stats }),
    stop() {
      if (phase === 'active') {
        phase = 'draining';
        const drained = stats.pendingBatches === 0
          ? Promise.resolve()
          : new Promise(resolve => { resolveDrain = resolve; });
        stopping = drained.then(() => { phase = 'stopped'; });
      }
      return stopping;
    },
  });
}
