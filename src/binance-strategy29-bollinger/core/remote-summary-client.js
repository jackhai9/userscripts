import { isCanonicalUsdtSymbol } from '../../shared/canonical-symbol.js';
import {
  STRATEGY29_API_SPEC_VERSION,
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

function assertConfiguration({ request, canonicalSymbol, maxPagesPerPoll, onStatus, onEvents, onCursorReset }) {
  if (typeof request !== 'function') throw new TypeError('request must be a function');
  if (!isCanonicalUsdtSymbol(canonicalSymbol)) {
    throw new TypeError('canonicalSymbol must use canonical symbol format');
  }
  if (!Number.isInteger(maxPagesPerPoll) || maxPagesPerPoll < 1 || maxPagesPerPoll > 10) {
    throw new TypeError('maxPagesPerPoll must be between 1 and 10');
  }
  for (const [name, callback] of Object.entries({ onStatus, onEvents, onCursorReset })) {
    if (typeof callback !== 'function') throw new TypeError(`${name} must be a function`);
  }
}

function buildEventsPath(canonicalSymbol, cursor) {
  const url = new URL('/v1/strategy29/events', 'https://gateway.invalid');
  url.searchParams.set('symbol', canonicalSymbol);
  if (cursor === null) {
    url.searchParams.set('mode', 'latest');
    url.searchParams.set('limit', '20');
  } else url.searchParams.set('cursor', String(cursor));
  return url.pathname + url.search;
}

/** Bounded snapshot consumer. Filtered pages advance the global cursor even when events is empty. */
export function createStrategy29SummaryClient({
  request,
  canonicalSymbol,
  maxPagesPerPoll = 2,
  onStatus,
  onEvents,
  onCursorReset,
}) {
  assertConfiguration({ request, canonicalSymbol, maxPagesPerPoll, onStatus, onEvents, onCursorReset });
  let cursor = null;

  async function perform(path, signal) {
    if (!signal || typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function') {
      throw new TypeError('poll requires an AbortSignal');
    }
    if (signal.aborted) throw signal.reason;
    return request({ path, signal });
  }

  async function poll(signal) {
    const statusResponse = await perform('/v1/strategy29/status', signal);
    // Aborted host requests can still resolve; they must not mutate a resumed client.
    if (signal.aborted) throw signal.reason;
    const statusBody = parseJsonResponse(statusResponse, 'Strategy29 status');
    if (statusResponse.status === 503) {
      const error = validateStrategy29GatewayError(statusBody, 503);
      return { state: error.error === 'database_unavailable' ? 'unavailable' : error.error, pages: 0, hasMore: false };
    }
    if (statusResponse.status !== 200) {
      validateStrategy29GatewayError(statusBody, statusResponse.status);
      throw new Error(`Strategy29 status request failed with HTTP ${statusResponse.status}`);
    }
    const status = validateStrategy29StatusResponse(statusBody, 200);
    onStatus(status);
    if (status.spec_version !== STRATEGY29_API_SPEC_VERSION) {
      return { state: 'incompatible', pages: 0, hasMore: false };
    }

    let pages = 0;
    let hasMore = false;
    while (pages < maxPagesPerPoll) {
      const requestedCursor = cursor;
      const eventsResponse = await perform(buildEventsPath(canonicalSymbol, cursor), signal);
      if (signal.aborted) throw signal.reason;
      const eventsBody = parseJsonResponse(eventsResponse, 'Strategy29 events');
      pages += 1;
      if (eventsResponse.status === 409) {
        const error = validateStrategy29GatewayError(eventsBody, 409);
        cursor = null;
        onCursorReset(error.oldest_cursor);
        hasMore = true;
        continue;
      }
      if (eventsResponse.status === 503) {
        const error = validateStrategy29GatewayError(eventsBody, 503);
        return { state: error.error === 'database_unavailable' ? 'unavailable' : error.error, pages, hasMore: false };
      }
      if (eventsResponse.status !== 200) {
        validateStrategy29GatewayError(eventsBody, eventsResponse.status);
        throw new Error(`Strategy29 events request failed with HTTP ${eventsResponse.status}`);
      }
      const page = validateStrategy29EventsResponse(eventsBody, 200);
      if (requestedCursor === null && (page.has_more || page.events.length > 20)) {
        throw new TypeError('Strategy29 latest snapshot must be complete and bounded to 20 events');
      }
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
