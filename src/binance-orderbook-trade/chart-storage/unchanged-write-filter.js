import { equalJsonClones } from './json.js';

const CHART_DATABASE = /^chart_/;
const CHART_STORE = 'keyvaluepairs';
const CHART_KEY = /^(?:#TV_SYMBOL-|myTradingView)/;
/** Writes that still look like chart storage after Binance changed the database, store or keys. */
const CHART_LIKE = /chart|tradingview|tv_symbol|drawing/i;
/** A native save writes within seconds; the window allows for a busy IndexedDB queue. */
export const NATIVE_SAVE_WINDOW_MS = 30000;
/** Windows with only unrecognized chart-like writes before the layout is considered changed. */
const LAYOUT_MISS_LIMIT = 3;
const LAYOUT_SAMPLE_LIMIT = 5;

/**
 * Binance rewrites every symbol's stored chart drawings on each chart save, and each
 * placed or cancelled order triggers a save. Most values are unchanged, yet every put
 * rewrites LevelDB; long automated order sessions have stalled Chrome's IndexedDB
 * service. Comparing at the standard IndexedDB boundary depends only on Binance's
 * persisted layout (database prefix, localForage store and key families), never on
 * its bundle, module IDs or minified names.
 *
 * A matching put reads the stored value in the same readwrite transaction and writes
 * only when the value differs. The value is cloned at call time, as the native put
 * captures it, so later caller changes cannot alter what is written. An unreadable
 * stored value is overwritten like the native put would. A failed deferred write
 * aborts its transaction with the real error, which localForage reports.
 *
 * The deferred write assumes the put is the caller's last request for that key in
 * its transaction, as localForage issues one request per transaction and never
 * commits early. Other keys, stores, databases and receivers keep the native call.
 */
export function installUnchangedChartWriteFilter(view, { onContractBreak }) {
  if (typeof onContractBreak !== 'function') throw new Error('Chart write filter requires a contract break handler');
  const prototype = view.IDBObjectStore.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'put');
  const nativePut = descriptor.value;
  const nativeGet = prototype.get;
  const nativeGetKey = prototype.getKey;
  const clone = view.structuredClone;
  if ([nativePut, nativeGet, nativeGetKey, clone].some(method => typeof method !== 'function')) {
    throw new Error('Chart write filter requires native IndexedDB store methods and structuredClone');
  }
  const stats = { compared: 0, skipped: 0, written: 0, unreadable: 0 };
  const breaks = [];
  // Open while a native chart save requested by Binance is expected to reach IndexedDB.
  let saveWindow = null;
  let layoutMisses = 0;

  /**
   * Binance asked TradingView to save. If the following writes only reach
   * chart-like targets this filter does not recognize, the persisted layout
   * changed and every write is native again. Windows without any chart-like
   * write (a stalled queue, a skipped save) prove nothing either way.
   */
  function noteNativeSave() {
    if (saveWindow) return;
    saveWindow = { matched: 0, samples: new Set() };
    view.setTimeout(() => {
      const { matched, samples } = saveWindow;
      saveWindow = null;
      if (matched > 0) {
        layoutMisses = 0;
        return;
      }
      if (!samples.size || ++layoutMisses !== LAYOUT_MISS_LIMIT) return;
      const entry = Object.freeze({
        reason: 'write-layout',
        detail: `Chart saves wrote only unrecognized targets: ${[...samples].join(', ')}`,
      });
      breaks.push(entry);
      onContractBreak(entry);
    }, NATIVE_SAVE_WINDOW_MS);
  }

  function noteUnmatchedWrite(store, key) {
    if (!saveWindow || saveWindow.samples.size >= LAYOUT_SAMPLE_LIMIT) return;
    const database = store.transaction.db.name;
    const keyText = typeof key === 'string' ? key.slice(0, 24) : typeof key;
    if (CHART_LIKE.test(database) || CHART_LIKE.test(store.name) || (typeof key === 'string' && CHART_LIKE.test(key))) {
      saveWindow.samples.add(`${database}/${store.name}/${keyText}`);
    }
  }

  function isChartRecordWrite(store, key, argumentCount) {
    return argumentCount === 2 && typeof key === 'string' && CHART_KEY.test(key)
      && store.keyPath === null && store.name === CHART_STORE
      && store.transaction.mode === 'readwrite' && CHART_DATABASE.test(store.transaction.db.name);
  }

  function put(value, key) {
    if (!isChartRecordWrite(this, key, arguments.length)) {
      // An inline-key store passes no key argument; its key stays unknown here.
      if (saveWindow) noteUnmatchedWrite(this, arguments.length >= 2 ? key : undefined);
      return Reflect.apply(nativePut, this, arguments);
    }
    if (saveWindow) saveWindow.matched += 1;
    // Uncloneable values throw here exactly as the native put would.
    const copy = Reflect.apply(clone, view, [value]);
    stats.compared += 1;
    const store = this;
    function write() {
      stats.written += 1;
      const request = Reflect.apply(nativePut, store, [copy, key]);
      // The caller holds the read request; let the transaction abort carry this error instead.
      request.addEventListener('error', event => event.stopPropagation());
    }
    const read = Reflect.apply(nativeGet, store, [key]);
    read.addEventListener('error', event => {
      event.preventDefault();
      event.stopPropagation();
      stats.unreadable += 1;
      write();
    });
    read.addEventListener('success', () => {
      if (read.result !== undefined || copy !== undefined) {
        if (read.result !== undefined && equalJsonClones(read.result, copy)) stats.skipped += 1;
        else write();
        return;
      }
      // localForage stores null as undefined; a missing key must still be created.
      const existing = Reflect.apply(nativeGetKey, store, [key]);
      existing.addEventListener('success', () => {
        if (existing.result === undefined) write();
        else stats.skipped += 1;
      });
    });
    return read;
  }

  Object.defineProperty(prototype, 'put', { ...descriptor, value: put });
  return Object.freeze({ snapshot: () => ({ ...stats }), breaks: () => [...breaks], noteNativeSave });
}
