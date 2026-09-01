import { validateGatewayResponse } from './live-event-contract.js';

const DEFAULT_RECONNECT_DELAY_MS = 2_000;

export class Strategy27GatewayTransportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'Strategy27GatewayTransportError';
  }
}

function abortError() {
  return new DOMException('Strategy 27 gateway request aborted', 'AbortError');
}

export function normalizeGatewayBaseUrl(value) {
  const url = new URL(String(value));
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') {
    throw new Error('Strategy 27 gateway must use an explicit HTTP loopback address');
  }
  if (!url.port || url.username || url.password || url.search || url.hash) {
    throw new Error('Strategy 27 gateway must be a loopback origin only');
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error('Strategy 27 gateway must be a loopback origin only');
  }
  return url.origin;
}

export function createGmJsonRequest(gmRequest) {
  if (typeof gmRequest !== 'function') throw new Error('GM request adapter is unavailable');
  return ({ url, authSecret, signal }) => new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    let settled = false;
    const settle = (callback) => (value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      callback(value);
    };
    const resolveOnce = settle(resolve);
    const rejectOnce = settle(reject);
    const handle = gmRequest({
      method: 'GET',
      url,
      headers: { Authorization: `Bearer ${authSecret}` },
      timeout: 25_000,
      onload: resolveOnce,
      onerror: () => rejectOnce(new Strategy27GatewayTransportError('Strategy 27 gateway request failed')),
      ontimeout: () => rejectOnce(new Strategy27GatewayTransportError('Strategy 27 gateway request timed out')),
      onabort: () => rejectOnce(abortError()),
    });
    function abort() {
      handle.abort();
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}

function waitForReconnect(delayMs, signal) {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(finish, delayMs);
    function finish() {
      signal.removeEventListener('abort', abort);
      resolve();
    }
    function abort() {
      clearTimeout(timeoutId);
      reject(abortError());
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}

function parseResponseJson(response) {
  if (!Number.isInteger(response?.status) || typeof response.responseText !== 'string') {
    throw new Error('Strategy 27 gateway returned an invalid GM response');
  }
  let payload;
  try {
    payload = JSON.parse(response.responseText);
  } catch {
    throw new Error('Strategy 27 gateway returned invalid JSON');
  }
  return validateGatewayResponse(payload, response.status);
}

function compareStreamIds(left, right) {
  const [leftMs, leftSequence] = left.split('-').map(BigInt);
  const [rightMs, rightSequence] = right.split('-').map(BigInt);
  if (leftMs !== rightMs) return leftMs > rightMs ? 1 : -1;
  if (leftSequence === rightSequence) return 0;
  return leftSequence > rightSequence ? 1 : -1;
}

function assertCursorContract(payload, cursor) {
  if (payload.status === 'error') return;
  if (payload.requested_cursor !== cursor) {
    throw new Error('Strategy 27 gateway response cursor does not match the request');
  }
  if (cursor !== null && compareStreamIds(payload.next_cursor, cursor) < 0) {
    throw new Error('Strategy 27 gateway cursor regressed');
  }
}

export function createLiveEventClient({
  request,
  gatewayBaseUrl,
  authSecret,
  canonicalSymbol,
  onResponse,
  onConnectionStateChange,
  reconnectDelayMs = DEFAULT_RECONNECT_DELAY_MS,
}) {
  if (typeof request !== 'function') throw new Error('Strategy 27 request function is required');
  if (typeof authSecret !== 'string' || authSecret.length === 0) throw new Error('Strategy 27 gateway secret is not configured');
  if (typeof canonicalSymbol !== 'string' || canonicalSymbol.length === 0) throw new Error('Strategy 27 canonical symbol is required');
  if (typeof onResponse !== 'function') throw new Error('Strategy 27 response listener is required');
  if (typeof onConnectionStateChange !== 'function') throw new Error('Strategy 27 connection state listener is required');
  if (!Number.isInteger(reconnectDelayMs) || reconnectDelayMs < 0) throw new Error('Strategy 27 reconnect delay is invalid');
  const origin = normalizeGatewayBaseUrl(gatewayBaseUrl);
  let cursor = null;
  let reconnecting = false;

  return Object.freeze({
    async run(signal) {
      while (!signal.aborted) {
        const url = new URL('/v1/strategy27/events', origin);
        url.searchParams.set('symbol', canonicalSymbol);
        if (cursor !== null) url.searchParams.set('cursor', cursor);
        let response;
        try {
          response = await request({
            url: url.href,
            authSecret,
            signal,
          });
        } catch (error) {
          if (!(error instanceof Strategy27GatewayTransportError)) throw error;
          if (!reconnecting) {
            reconnecting = true;
            onConnectionStateChange('reconnecting');
          }
          await waitForReconnect(reconnectDelayMs, signal);
          continue;
        }
        const payload = parseResponseJson(response);
        assertCursorContract(payload, cursor);
        if (payload.status === 'error') {
          throw new Error(`Strategy 27 gateway error: ${payload.error_code}`);
        }
        if (reconnecting) {
          reconnecting = false;
          onConnectionStateChange('connected');
        }
        await onResponse(payload);
        cursor = payload.next_cursor;
      }
    },
  });
}
