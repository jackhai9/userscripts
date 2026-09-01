import { validateGatewayResponse } from './live-event-contract.js';

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
      onerror: () => rejectOnce(new Error('Strategy 27 gateway request failed')),
      ontimeout: () => rejectOnce(new Error('Strategy 27 gateway request timed out')),
      onabort: () => rejectOnce(abortError()),
    });
    function abort() {
      handle.abort();
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
}) {
  if (typeof request !== 'function') throw new Error('Strategy 27 request function is required');
  if (typeof authSecret !== 'string' || authSecret.length === 0) throw new Error('Strategy 27 gateway secret is not configured');
  if (typeof canonicalSymbol !== 'string' || canonicalSymbol.length === 0) throw new Error('Strategy 27 canonical symbol is required');
  if (typeof onResponse !== 'function') throw new Error('Strategy 27 response listener is required');
  const origin = normalizeGatewayBaseUrl(gatewayBaseUrl);
  let cursor = null;

  return Object.freeze({
    async run(signal) {
      while (!signal.aborted) {
        const url = new URL('/v1/strategy27/events', origin);
        url.searchParams.set('symbol', canonicalSymbol);
        if (cursor !== null) url.searchParams.set('cursor', cursor);
        const response = await request({
          url: url.href,
          authSecret,
          signal,
        });
        const payload = parseResponseJson(response);
        assertCursorContract(payload, cursor);
        if (payload.status === 'error') {
          throw new Error(`Strategy 27 gateway error: ${payload.error_code}`);
        }
        await onResponse(payload);
        cursor = payload.next_cursor;
      }
    },
  });
}
