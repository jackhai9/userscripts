import {
  applyDepthProfileSnapshot,
  buildDepthProfile,
  createDepthProfileBook,
  DepthProfileSequenceError,
  pushDepthProfileUpdate,
} from './depth-profile-book.js';

const NATIVE_RPI_DEPTH_PATH = '/fapi/v1/rpiDepth';
const NATIVE_RPI_DEPTH_LIMIT = '1000';
const NATIVE_RPI_STREAM_PATTERN = /^([a-z0-9_]+)@rpiDepth@500ms$/;

function assertFunction(value, field) {
  if (typeof value !== 'function') throw new Error(`Invalid native depth ${field}`);
  return value;
}

function assertSymbol(value) {
  if (typeof value !== 'string' || !/^[A-Z0-9_]+$/.test(value)) {
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
    for (const subscriber of record.subscribers) subscriber.onProfile(profile);
    notifyStatus(record, 'ready');
  }

  function failRecord(record, error) {
    record.profile = null;
    notifyStatus(record, 'failed', error?.message || String(error));
  }

  function beginSnapshot(symbol) {
    const record = ensureRecord(symbol);
    record.book = createDepthProfileBook(symbol);
    record.profile = null;
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
      if (ready) notifyProfile(record, buildDepthProfile(record.book));
      else notifyStatus(record, 'synchronizing');
    } catch (error) {
      failRecord(record, error);
    }
  }

  function acceptUpdate(symbol, payload) {
    if (restored) return;
    const record = ensureRecord(symbol);
    try {
      const ready = pushDepthProfileUpdate(record.book, payload);
      if (ready) notifyProfile(record, buildDepthProfile(record.book));
      else notifyStatus(record, 'synchronizing');
    } catch (error) {
      record.profile = null;
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
        if (!match || !envelope.data || typeof envelope.data !== 'object') {
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
        if (record) notifyStatus(record, 'reconnecting', 'Binance native depth socket closed');
      }
    }]);
  }

  const observedFetch = new Proxy(nativeFetch, {
    apply(target, receiver, args) {
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
          (error) => failRecord(ensureRecord(symbol), error),
        );
      }
      return result;
    },
  });

  const ObservedWebSocket = new Proxy(NativeWebSocket, {
    construct(target, args, newTarget) {
      const socket = Reflect.construct(target, args, newTarget);
      observeSocket(socket);
      return socket;
    },
  });

  globalObject.fetch = observedFetch;
  globalObject.WebSocket = ObservedWebSocket;

  return {
    subscribe(options) {
      const {
        symbol,
        onProfile,
        onStatus,
      } = options || {};
      const record = ensureRecord(symbol);
      const subscriber = {
        onProfile: assertFunction(onProfile, 'profile listener'),
        onStatus: assertFunction(onStatus, 'status listener'),
      };
      if (restored) throw new Error('Binance native depth source has been restored');
      record.subscribers.add(subscriber);
      subscriber.onStatus(record.status);
      if (record.profile) subscriber.onProfile(record.profile);
      return () => record.subscribers.delete(subscriber);
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
      };
    },
    restore() {
      if (restored) return;
      restored = true;
      if (globalObject.fetch === observedFetch) globalObject.fetch = nativeFetch;
      if (globalObject.WebSocket === ObservedWebSocket) globalObject.WebSocket = NativeWebSocket;
      records.clear();
    },
  };
}
