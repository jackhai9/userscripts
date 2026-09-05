import { normalizeGatewayBaseUrl, Strategy27GatewayTransportError } from './live-event-client.js';
import { validateCompoundBootstrapResponse, validateCompoundGatewayResponse } from './compound-candidate-contract.js';

function wait(delay, signal) {
  const aborted = () => new DOMException('Compound request aborted', 'AbortError');
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel);
      resolve();
    }, delay);
    function cancel() {
      clearTimeout(timer);
      reject(aborted());
    }
    signal.addEventListener('abort', cancel, { once: true });
  });
}

function cursorRegressed(next, previous) {
  const [nextMs, nextSequence] = next.split('-').map(BigInt);
  const [previousMs, previousSequence] = previous.split('-').map(BigInt);
  return nextMs < previousMs || (nextMs === previousMs && nextSequence < previousSequence);
}

/** A missing/failed compound route must never own the ordinary client's state. */
export function createCompoundCandidateClient({ request, gatewayBaseUrl, authSecret, canonicalSymbol, onResponse, onConnectionStateChange, reconnectDelayMs = 2000 }) {
  if (typeof request !== 'function' || typeof onResponse !== 'function' || typeof onConnectionStateChange !== 'function') throw new Error('Compound client callbacks are required');
  if (typeof authSecret !== 'string' || authSecret.length === 0) throw new Error('Compound gateway secret is not configured');
  if (typeof canonicalSymbol !== 'string' || !/^[A-Z0-9]+\/USDT:USDT$/.test(canonicalSymbol)) throw new Error('Compound canonical symbol is invalid');
  if (!Number.isSafeInteger(reconnectDelayMs) || reconnectDelayMs < 0) throw new Error('Compound reconnect delay is invalid');
  const origin = normalizeGatewayBaseUrl(gatewayBaseUrl);
  let cursor = null;
  let needsBootstrap = true;
  let state = null;
  function transition(next) {
    if (state === next) return;
    state = next;
    onConnectionStateChange(next);
  }
  return Object.freeze({
    async run(signal) {
      while (!signal.aborted) {
        const url = new URL(needsBootstrap ? '/v1/strategy27/compound-candidates/bootstrap' : '/v1/strategy27/compound-candidates', origin);
        url.searchParams.set('symbol', canonicalSymbol);
        if (!needsBootstrap) url.searchParams.set('cursor', cursor);
        let response;
        try {
          response = await request({ url: url.href, authSecret, signal });
        } catch (error) {
          if (signal.aborted) return;
          if (!(error instanceof Strategy27GatewayTransportError)) throw error;
          transition('reconnecting');
          await wait(reconnectDelayMs, signal);
          continue;
        }
        if (signal.aborted) return;
        if (!Number.isInteger(response?.status) || typeof response.responseText !== 'string') throw new Error('Compound gateway returned an invalid response');
        // Old gateways return a non-JSON 404; do not mistake it for bad candidate data.
        if (response.status === 404) {
          transition('unsupported');
          return;
        }
        const payload = needsBootstrap
          ? await validateCompoundBootstrapResponse(JSON.parse(response.responseText), response.status)
          : await validateCompoundGatewayResponse(JSON.parse(response.responseText), response.status);
        if (signal.aborted) return;
        if (payload.status === 'error') {
          if (response.status !== 503) throw new Error(`Compound gateway error: ${payload.error_code}`);
          cursor = null;
          needsBootstrap = true;
          transition('unavailable');
          await wait(reconnectDelayMs, signal);
          continue;
        }
        if (!needsBootstrap && (payload.requested_cursor !== cursor || cursorRegressed(payload.next_cursor, cursor))) throw new Error('Compound gateway response cursor mismatch/regression');
        if (signal.aborted) return;
        transition('connected');
        await onResponse(payload);
        if (!needsBootstrap && payload.status === 'reset') {
          cursor = null;
          needsBootstrap = true;
        } else {
          cursor = payload.next_cursor;
          needsBootstrap = false;
        }
      }
    },
  });
}
