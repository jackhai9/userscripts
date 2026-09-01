import {
  applyDepthProfileSnapshot,
  buildDepthProfile,
  createDepthProfileBook,
  DepthProfileSequenceError,
  pushDepthProfileUpdate,
} from './depth-profile-book.js';

const DEPTH_SNAPSHOT_LIMIT = 1000;
const MAX_RESYNCS_PER_CONNECTION = 3;
const MAX_RECONNECT_ATTEMPTS = 5;
const RESYNC_DELAY_MS = 1000;
const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000, 30000];

function assertFunction(value, field) {
  if (typeof value !== 'function') throw new Error(`Invalid depth profile ${field}`);
  return value;
}

export function createDepthProfileSession(options) {
  const {
    symbol,
    fetchFn,
    WebSocketCtor,
    onProfile,
    onStatus,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = options || {};
  if (typeof symbol !== 'string' || !/^[A-Z0-9_]+$/.test(symbol)) {
    throw new Error('Invalid depth profile session symbol');
  }
  assertFunction(fetchFn, 'fetch function');
  assertFunction(WebSocketCtor, 'WebSocket constructor');
  assertFunction(onProfile, 'profile listener');
  assertFunction(onStatus, 'status listener');
  assertFunction(setTimer, 'timer scheduler');
  assertFunction(clearTimer, 'timer clearer');

  let active = false;
  let epoch = 0;
  let socket = null;
  let snapshotController = null;
  let reconnectTimer = 0;
  let resyncTimer = 0;
  let reconnectAttempts = 0;
  let resyncAttempts = 0;
  let book = createDepthProfileBook(symbol);

  const snapshotUrl = `https://fapi.binance.com/fapi/v1/depth?symbol=${symbol}&limit=${DEPTH_SNAPSHOT_LIMIT}`;
  const streamUrl = `wss://fstream.binance.com/public/ws/${symbol.toLowerCase()}@depth@100ms`;

  function emitStatus(status, detail = '') {
    if (!active) return;
    onStatus({ symbol, status, detail });
  }

  function clearScheduledWork() {
    if (reconnectTimer) clearTimer(reconnectTimer);
    if (resyncTimer) clearTimer(resyncTimer);
    reconnectTimer = 0;
    resyncTimer = 0;
  }

  function abortSnapshot() {
    snapshotController?.abort();
    snapshotController = null;
  }

  function closeSocket() {
    const currentSocket = socket;
    socket = null;
    if (currentSocket && currentSocket.readyState < 2) currentSocket.close();
  }

  function emitProfile(profile) {
    reconnectAttempts = 0;
    onProfile(profile);
    emitStatus('ready');
  }

  function failSession(error) {
    clearScheduledWork();
    abortSnapshot();
    closeSocket();
    emitStatus('failed', error?.message || String(error));
    active = false;
    epoch += 1;
  }

  function scheduleReconnect(error) {
    if (!active || reconnectTimer) return;
    abortSnapshot();
    closeSocket();
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      failSession(error);
      return;
    }
    const delay = RECONNECT_DELAYS_MS[reconnectAttempts];
    reconnectAttempts += 1;
    emitStatus('reconnecting', error?.message || String(error));
    const scheduledEpoch = epoch;
    reconnectTimer = setTimer(() => {
      reconnectTimer = 0;
      if (!active || scheduledEpoch !== epoch) return;
      connect();
    }, delay);
  }

  function scheduleResync(error) {
    if (!active || resyncTimer) return;
    abortSnapshot();
    book = createDepthProfileBook(symbol);
    if (resyncAttempts >= MAX_RESYNCS_PER_CONNECTION) {
      scheduleReconnect(error);
      return;
    }
    resyncAttempts += 1;
    emitStatus('resyncing', error?.message || String(error));
    const scheduledEpoch = epoch;
    resyncTimer = setTimer(() => {
      resyncTimer = 0;
      if (!active || scheduledEpoch !== epoch) return;
      requestSnapshot();
    }, RESYNC_DELAY_MS);
  }

  async function requestSnapshot() {
    if (!active || snapshotController) return;
    const requestEpoch = epoch;
    const controller = new AbortController();
    snapshotController = controller;
    let profile = null;
    try {
      const response = await fetchFn(snapshotUrl, { signal: controller.signal });
      if (!active || requestEpoch !== epoch || snapshotController !== controller) return;
      if (!response.ok) throw new Error(`Depth snapshot HTTP ${response.status}`);
      const payload = await response.json();
      if (!active || requestEpoch !== epoch || snapshotController !== controller) return;
      const ready = applyDepthProfileSnapshot(book, payload);
      snapshotController = null;
      if (ready) profile = buildDepthProfile(book);
    } catch (error) {
      if (snapshotController === controller) snapshotController = null;
      if (controller.signal.aborted || !active || requestEpoch !== epoch) return;
      scheduleResync(error);
      return;
    }
    if (profile) emitProfile(profile);
    else emitStatus('synchronizing');
  }

  function handleMessage(currentSocket, event) {
    if (!active || socket !== currentSocket) return;
    let profile = null;
    try {
      const payload = JSON.parse(event.data);
      const ready = pushDepthProfileUpdate(book, payload);
      if (ready) profile = buildDepthProfile(book);
    } catch (error) {
      if (error instanceof DepthProfileSequenceError) scheduleResync(error);
      else scheduleReconnect(error);
      return;
    }
    if (profile) emitProfile(profile);
  }

  function connect() {
    if (!active || socket) return;
    book = createDepthProfileBook(symbol);
    resyncAttempts = 0;
    emitStatus('connecting');
    let currentSocket;
    try {
      currentSocket = new WebSocketCtor(streamUrl);
    } catch (error) {
      scheduleReconnect(error);
      return;
    }
    socket = currentSocket;
    currentSocket.addEventListener('open', () => {
      if (!active || socket !== currentSocket) return;
      emitStatus('synchronizing');
      requestSnapshot();
    }, { once: true });
    currentSocket.addEventListener('message', (event) => handleMessage(currentSocket, event));
    currentSocket.addEventListener('error', () => {
      if (!active || socket !== currentSocket) return;
      currentSocket.close();
    });
    currentSocket.addEventListener('close', () => {
      if (!active || socket !== currentSocket) return;
      socket = null;
      scheduleReconnect(new Error('Depth WebSocket closed'));
    }, { once: true });
  }

  return {
    symbol,
    start() {
      if (active) throw new Error('Depth profile session already started');
      active = true;
      epoch += 1;
      connect();
    },
    stop() {
      if (!active) return;
      active = false;
      epoch += 1;
      clearScheduledWork();
      abortSnapshot();
      closeSocket();
    },
    isActive() {
      return active;
    },
  };
}
