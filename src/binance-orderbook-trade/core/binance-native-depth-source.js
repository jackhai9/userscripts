import {
  applyDepthProfileSnapshot,
  buildDepthProfile,
  createDepthProfileBook,
  DepthProfileSequenceError,
  pushDepthProfileUpdate,
} from './depth-profile-book.js';
import { BINANCE_SYMBOL_CHARACTERS, isBinanceSymbol } from '../../shared/binance-symbol.js';

const NATIVE_RPI_DEPTH_PATH = '/fapi/v1/rpiDepth';
const NATIVE_RPI_DEPTH_LIMIT = '1000';
const NATIVE_RPI_STREAM_PATTERN = new RegExp(`^([${BINANCE_SYMBOL_CHARACTERS}]+)@rpiDepth@500ms$`, 'u');

function assertFunction(value, field) {
  if (typeof value !== 'function') throw new Error(`Invalid native depth ${field}`);
  return value;
}

function assertSymbol(value) {
  if (!isBinanceSymbol(value)) {
    throw new Error('Invalid native depth symbol');
  }
  return value;
}

function resolveRequestUrl(input, baseUrl) {
  if (typeof input === 'string') return new URL(input, baseUrl);
  if (input && typeof input === 'object' && typeof input.url === 'string') {
    return new URL(input.url, baseUrl);
  }
  return null;
}

function resolveNativeSnapshotSymbol(input, baseUrl) {
  const url = resolveRequestUrl(input, baseUrl);
  if (!url || url.pathname !== NATIVE_RPI_DEPTH_PATH) return null;
  const symbol = assertSymbol(url.searchParams.get('symbol'));
  if (url.searchParams.get('limit') !== NATIVE_RPI_DEPTH_LIMIT) {
    return {
      symbol,
      error: new Error('Invalid Binance native RPI depth snapshot limit'),
    };
  }
  return { symbol, error: null };
}

function createRecord(symbol) {
  return {
    symbol,
    book: createDepthProfileBook(symbol),
    profile: null,
    profileUpdateId: null,
    profileBuildCount: 0,
    pendingFrame: null,
    status: { symbol, status: 'connecting', detail: '' },
    subscribers: new Set(),
  };
}

/**
 * Observes Binance's existing RPI depth transport. The wrappers preserve the page's
 * fetch result and WebSocket instances; this module never opens a network connection.
 */
export function installBinanceNativeDepthSource(globalObject) {
  if (!globalObject || typeof globalObject !== 'object') {
    throw new Error('Invalid native depth global object');
  }
  const nativeFetch = assertFunction(globalObject.fetch, 'fetch function');
  const NativeWebSocket = assertFunction(globalObject.WebSocket, 'WebSocket constructor');
  const nativeSocketAddEventListener = assertFunction(
    NativeWebSocket.prototype?.addEventListener,
    'WebSocket event listener',
  );
  const baseUrl = globalObject.location?.href;
  if (typeof baseUrl !== 'string') throw new Error('Invalid native depth page URL');
  const requestFrame = assertFunction(globalObject.requestAnimationFrame, 'animation frame request');
  const cancelFrame = assertFunction(globalObject.cancelAnimationFrame, 'animation frame cancellation');

  const records = new Map();
  const socketSymbols = new WeakMap();
  let restored = false;

  function ensureRecord(symbol) {
    const normalizedSymbol = assertSymbol(symbol);
    let record = records.get(normalizedSymbol);
    if (!record) {
      record = createRecord(normalizedSymbol);
      records.set(normalizedSymbol, record);
    }
    return record;
  }

  function notifyStatus(record, status, detail = '') {
    record.status = { symbol: record.symbol, status, detail };
    for (const subscriber of record.subscribers) subscriber.onStatus(record.status);
  }

  function notifyProfile(record, profile) {
    record.profile = profile;
    for (const subscriber of record.subscribers) {
      if (subscriber.profile === profile) continue;
      subscriber.profile = profile;
      subscriber.onProfile(profile);
    }
    notifyStatus(record, 'ready');
  }

  function cancelPendingProfile(record) {
    if (record.pendingFrame === null) return;
    Reflect.apply(cancelFrame, globalObject, [record.pendingFrame]);
    record.pendingFrame = null;
  }

  function clearProfile(record) {
    record.profile = null;
    record.profileUpdateId = null;
  }

  function materializeProfile(record) {
    record.profileBuildCount += 1;
    record.profile = buildDepthProfile(record.book);
    record.profileUpdateId = record.book.previousFinalUpdateId;
    return record.profile;
  }

  /**
   * Sequence validation and book writes stay synchronous. Sorting is display work,
   * so a burst shares one native frame and hidden books retain no display copies.
   */
  function publishCurrentBook(record) {
    clearProfile(record);
    if (record.subscribers.size === 0) {
      notifyStatus(record, 'ready');
      return;
    }
    if (record.pendingFrame !== null) return;
    record.pendingFrame = Reflect.apply(requestFrame, globalObject, [() => {
      record.pendingFrame = null;
      try {
        // A subscriber may already have materialized this version while frames paused.
        notifyProfile(record, record.profile || materializeProfile(record));
      } catch (error) {
        failRecord(record, error);
      }
    }]);
  }

  function failRecord(record, error) {
    cancelPendingProfile(record);
    clearProfile(record);
    notifyStatus(record, 'failed', error?.message || String(error));
  }

  function beginSnapshot(symbol) {
    const record = ensureRecord(symbol);
    cancelPendingProfile(record);
    record.book = createDepthProfileBook(symbol);
    clearProfile(record);
    notifyStatus(record, 'synchronizing');
    for (const [otherSymbol, otherRecord] of records) {
      if (otherSymbol !== symbol && otherRecord.subscribers.size === 0) records.delete(otherSymbol);
    }
    return record;
  }

  function acceptSnapshot(symbol, payload) {
    if (restored) return;
    const record = ensureRecord(symbol);
    try {
      const ready = applyDepthProfileSnapshot(record.book, payload);
      if (ready) publishCurrentBook(record);
      else notifyStatus(record, 'synchronizing');
    } catch (error) {
      failRecord(record, error);
    }
  }

  function acceptUpdate(symbol, payload) {
    if (restored) return;
    const record = ensureRecord(symbol);
    try {
      const previousUpdateId = record.book.previousFinalUpdateId;
      const ready = pushDepthProfileUpdate(record.book, payload);
      // A duplicate can still confirm recovery after a transport interruption.
      if (ready && record.status.status === 'ready'
        && record.book.previousFinalUpdateId === previousUpdateId) return;
      if (ready) publishCurrentBook(record);
      else notifyStatus(record, 'synchronizing');
    } catch (error) {
      cancelPendingProfile(record);
      clearProfile(record);
      if (error instanceof DepthProfileSequenceError) {
        record.book = createDepthProfileBook(symbol);
        notifyStatus(record, 'resyncing', error.message);
      } else {
        failRecord(record, error);
      }
    }
  }

  function failAll(error) {
    for (const record of records.values()) failRecord(record, error);
  }

  function observeSocket(socket) {
    const symbols = new Set();
    socketSymbols.set(socket, symbols);
    Reflect.apply(nativeSocketAddEventListener, socket, ['message', (event) => {
      if (restored || typeof event?.data !== 'string' || !event.data.includes('@rpiDepth@500ms')) {
        return;
      }
      let envelope;
      try {
        envelope = JSON.parse(event.data);
        const match = NATIVE_RPI_STREAM_PATTERN.exec(envelope?.stream);
        if (
          !match || match[0] !== envelope.stream || match[1] !== match[1].toLowerCase()
          || !envelope.data || typeof envelope.data !== 'object'
        ) {
          throw new Error('Invalid Binance native RPI depth message');
        }
        const symbol = assertSymbol(match[1].toUpperCase());
        symbols.add(symbol);
        acceptUpdate(symbol, envelope.data);
      } catch (error) {
        failAll(error);
      }
    }]);
    Reflect.apply(nativeSocketAddEventListener, socket, ['close', () => {
      if (restored) return;
      for (const symbol of socketSymbols.get(socket) || []) {
        const record = records.get(symbol);
        if (record) {
          cancelPendingProfile(record);
          clearProfile(record);
          notifyStatus(record, 'reconnecting', 'Binance native depth socket closed');
        }
      }
    }]);
  }

  const observedFetch = new Proxy(nativeFetch, {
    apply(target, receiver, args) {
      // The page can retain a wrapper after its global transport has been restored.
      if (restored) return Reflect.apply(target, receiver, args);
      let observation = null;
      try {
        observation = resolveNativeSnapshotSymbol(args[0], baseUrl);
      } catch (error) {
        failAll(error);
      }
      const symbol = observation?.symbol || null;
      if (observation?.error) failRecord(ensureRecord(symbol), observation.error);
      else if (symbol) beginSnapshot(symbol);
      let result;
      try {
        result = Reflect.apply(target, receiver, args);
      } catch (error) {
        if (symbol) failRecord(ensureRecord(symbol), error);
        throw error;
      }
      if (symbol && !observation.error) {
        Promise.resolve(result).then((response) => {
          if (!response?.ok) {
            throw new Error(`Binance native RPI depth snapshot HTTP ${response?.status}`);
          }
          return response.clone().json();
        }).then(
          (payload) => acceptSnapshot(symbol, payload),
          (error) => {
            if (!restored) failRecord(ensureRecord(symbol), error);
          },
        );
      }
      return result;
    },
  });

  const ObservedWebSocket = new Proxy(NativeWebSocket, {
    construct(target, args, newTarget) {
      const socket = Reflect.construct(target, args, newTarget);
      if (!restored) observeSocket(socket);
      return socket;
    },
  });

  globalObject.fetch = observedFetch;
  globalObject.WebSocket = ObservedWebSocket;

  return {
    subscribe(options) {
      if (restored) throw new Error('Binance native depth source has been restored');
      const {
        symbol,
        onProfile,
        onStatus,
      } = options || {};
      const record = ensureRecord(symbol);
      const subscriber = {
        onProfile: assertFunction(onProfile, 'profile listener'),
        onStatus: assertFunction(onStatus, 'status listener'),
        profile: null,
      };
      if ((record.status.status === 'ready' || record.pendingFrame !== null) && record.profile === null) {
        try {
          materializeProfile(record);
          record.status = { symbol: record.symbol, status: 'ready', detail: '' };
        } catch (error) {
          // Deferred geometry validation uses the same visible failure boundary as updates.
          failRecord(record, error);
        }
      }
      record.subscribers.add(subscriber);
      subscriber.onStatus(record.status);
      if (record.profile) {
        subscriber.profile = record.profile;
        subscriber.onProfile(record.profile);
      }
      return () => {
        const removed = record.subscribers.delete(subscriber);
        if (record.subscribers.size === 0) {
          // A paused first paint must not discard the book's completed synchronization.
          if (record.pendingFrame !== null) notifyStatus(record, 'ready');
          cancelPendingProfile(record);
          clearProfile(record);
        }
        return removed;
      };
    },
    getState(symbol) {
      const record = records.get(assertSymbol(symbol));
      if (!record) return null;
      return {
        status: record.status,
        bidCount: record.profile?.bids.length || 0,
        askCount: record.profile?.asks.length || 0,
        minPrice: record.profile?.minPrice ?? null,
        maxPrice: record.profile?.maxPrice ?? null,
        bookBidCount: record.book.bids.size,
        bookAskCount: record.book.asks.size,
        subscriberCount: record.subscribers.size,
        profileUpdateId: record.profileUpdateId,
        profileBuildCount: record.profileBuildCount,
      };
    },
    restore() {
      if (restored) return;
      restored = true;
      for (const record of records.values()) cancelPendingProfile(record);
      if (globalObject.fetch === observedFetch) globalObject.fetch = nativeFetch;
      if (globalObject.WebSocket === ObservedWebSocket) globalObject.WebSocket = NativeWebSocket;
      records.clear();
    },
  };
}
