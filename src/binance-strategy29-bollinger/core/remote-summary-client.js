import {
  STRATEGY29_SPEC_VERSION,
  validateStrategy29EventsResponse,
  validateStrategy29GatewayError,
  validateStrategy29StatusResponse,
} from './remote-summary-contract.js';

export class Strategy29GatewayTransportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'Strategy29GatewayTransportError';
  }
}

function gatewayAbortError() {
  return new DOMException('Strategy29 gateway request aborted', 'AbortError');
}

export function normalizeStrategy29GatewayOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('Strategy29 gateway must be an explicit loopback origin');
  }
  if (
    url.protocol !== 'http:'
    || url.hostname !== '127.0.0.1'
    || url.port === ''
    || url.username !== ''
    || url.password !== ''
    || url.pathname !== '/'
    || url.search !== ''
    || url.hash !== ''
  ) throw new TypeError('Strategy29 gateway must be an explicit loopback origin');
  return url.origin;
}

function parseJsonResponse(response, label) {
  if (!response || !Number.isInteger(response.status) || typeof response.responseText !== 'string') {
    throw new Strategy29GatewayTransportError(`${label} returned an invalid transport response`);
  }
  try {
    return JSON.parse(response.responseText);
  } catch {
    throw new TypeError(`${label} returned invalid JSON`);
  }
}

function assertConfiguration({ request, authSecret, canonicalSymbol, maxPagesPerPoll, onStatus, onEvents, onCursorReset }) {
  if (typeof request !== 'function') throw new TypeError('request must be a function');
  if (typeof authSecret !== 'string' || authSecret.length === 0) throw new TypeError('authSecret must be non-empty');
  if (typeof canonicalSymbol !== 'string' || !/^[A-Z0-9]+\/USDT:USDT$/.test(canonicalSymbol)) {
    throw new TypeError('canonicalSymbol must use canonical symbol format');
  }
  if (!Number.isInteger(maxPagesPerPoll) || maxPagesPerPoll < 1 || maxPagesPerPoll > 10) {
    throw new TypeError('maxPagesPerPoll must be between 1 and 10');
  }
  for (const [name, callback] of Object.entries({ onStatus, onEvents, onCursorReset })) {
    if (typeof callback !== 'function') throw new TypeError(`${name} must be a function`);
  }
}

function buildEventsUrl(origin, canonicalSymbol, cursor) {
  const url = new URL('/v1/strategy29/events', origin);
  url.searchParams.set('symbol', canonicalSymbol);
  if (cursor !== null) url.searchParams.set('cursor', String(cursor));
  return url.href;
}

/** Bounded snapshot consumer. Filtered pages advance the global cursor even when events is empty. */
export function createStrategy29SummaryClient({
  request,
  gatewayOrigin,
  authSecret,
  canonicalSymbol,
  maxPagesPerPoll = 2,
  onStatus,
  onEvents,
  onCursorReset,
}) {
  const origin = normalizeStrategy29GatewayOrigin(gatewayOrigin);
  assertConfiguration({ request, authSecret, canonicalSymbol, maxPagesPerPoll, onStatus, onEvents, onCursorReset });
  let cursor = null;

  async function perform(url, signal) {
    if (!signal || typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function') {
      throw new TypeError('poll requires an AbortSignal');
    }
    if (signal.aborted) throw signal.reason;
    return request({ url, authSecret, signal });
  }

  async function poll(signal) {
    const statusResponse = await perform(`${origin}/v1/strategy29/status`, signal);
    const statusBody = parseJsonResponse(statusResponse, 'Strategy29 status');
    if (statusResponse.status === 503) {
      validateStrategy29GatewayError(statusBody, 503);
      return { state: 'unavailable', pages: 0, hasMore: false };
    }
    if (statusResponse.status !== 200) {
      validateStrategy29GatewayError(statusBody, statusResponse.status);
      throw new Error(`Strategy29 status request failed with HTTP ${statusResponse.status}`);
    }
    const status = validateStrategy29StatusResponse(statusBody, 200);
    onStatus(status);
    if (status.spec_version !== STRATEGY29_SPEC_VERSION) {
      return { state: 'incompatible', pages: 0, hasMore: false };
    }

    let pages = 0;
    let hasMore = false;
    while (pages < maxPagesPerPoll) {
      const requestedCursor = cursor;
      const eventsResponse = await perform(buildEventsUrl(origin, canonicalSymbol, cursor), signal);
      const eventsBody = parseJsonResponse(eventsResponse, 'Strategy29 events');
      pages += 1;
      if (eventsResponse.status === 409) {
        const error = validateStrategy29GatewayError(eventsBody, 409);
        cursor = error.oldest_cursor;
        onCursorReset(cursor);
        hasMore = true;
        continue;
      }
      if (eventsResponse.status === 503) {
        validateStrategy29GatewayError(eventsBody, 503);
        return { state: 'unavailable', pages, hasMore: false };
      }
      if (eventsResponse.status !== 200) {
        validateStrategy29GatewayError(eventsBody, eventsResponse.status);
        throw new Error(`Strategy29 events request failed with HTTP ${eventsResponse.status}`);
      }
      const page = validateStrategy29EventsResponse(eventsBody, 200);
      if (requestedCursor !== null && page.next_cursor < requestedCursor) {
        throw new TypeError('Strategy29 event cursor moved backwards');
      }
      if (page.has_more && (requestedCursor === null ? page.next_cursor <= 0 : page.next_cursor <= requestedCursor)) {
        throw new TypeError('Strategy29 event cursor did not advance while has_more is true');
      }
      let previousSequence = requestedCursor;
      for (const event of page.events) {
        if (event.symbol !== canonicalSymbol) throw new TypeError('Strategy29 event symbol does not match the requested symbol');
        if (previousSequence !== null && event.sequence <= previousSequence) {
          throw new TypeError('Strategy29 event sequences must advance strictly');
        }
        if (event.sequence > page.next_cursor) throw new TypeError('Strategy29 event sequence exceeds next_cursor');
        previousSequence = event.sequence;
      }
      onEvents(page.events, page.observed_at_ms);
      cursor = page.next_cursor;
      hasMore = page.has_more;
      if (!hasMore) break;
    }
    return { state: 'connected', pages, hasMore };
  }

  return Object.freeze({
    poll,
    get diagnostics() { return Object.freeze({ cursor }); },
  });
}

/** Userscript-sandbox transport. Abort is part of route/visibility/dispose ownership. */
export function createStrategy29GmJsonRequest(gmXmlHttpRequest, timeoutMs = 10_000) {
  if (typeof gmXmlHttpRequest !== 'function') throw new TypeError('GM_xmlhttpRequest must be a function');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new TypeError('timeoutMs must be a positive integer');
  return ({ url, authSecret, signal }) => new Promise((resolve, reject) => {
    let settled = false;
    function finish(callback, value) {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      callback(value);
    }
    let request;
    function onAbort() {
      request.abort();
      finish(reject, signal.reason ?? gatewayAbortError());
    }
    try {
      request = gmXmlHttpRequest({
        method: 'GET',
        url,
        headers: { Authorization: `Bearer ${authSecret}` },
        timeout: timeoutMs,
        onload: response => finish(resolve, response),
        onerror: () => finish(reject, new Strategy29GatewayTransportError('Strategy29 gateway transport failure')),
        ontimeout: () => finish(reject, new Strategy29GatewayTransportError('Strategy29 gateway transport timeout')),
        onabort: () => finish(reject, signal.reason ?? gatewayAbortError()),
      });
    } catch {
      finish(reject, new Strategy29GatewayTransportError('Strategy29 gateway transport initialization failed'));
      return;
    }
    if (settled) return;
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}
