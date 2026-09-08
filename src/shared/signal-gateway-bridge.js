import { readSignalGatewaySettings, SIGNAL_GATEWAY_SECRET_KEY } from './signal-client-settings.js';
import { isCanonicalUsdtSymbol } from './canonical-symbol.js';

export const SIGNAL_GATEWAY_BRIDGE = Symbol.for('jh-userscripts.signal-gateway');
const MAX_RESPONSE_LENGTH = 2 * 1024 * 1024;

/** Public read capability: the page may request these projections, never arbitrary authenticated URLs. */
export function validateSignalGatewayPath(path) {
  if (typeof path !== 'string' || path.length > 2048 || !path.startsWith('/v1/strategy29/')) {
    throw new TypeError('Signal gateway route is not allowed');
  }
  const url = new URL(path, 'https://gateway.invalid');
  if (url.origin !== 'https://gateway.invalid' || url.hash || url.pathname + url.search !== path) {
    throw new TypeError('Signal gateway path must use exact relative syntax');
  }
  const query = url.searchParams;
  const keys = [...query.keys()];
  if (new Set(keys).size !== keys.length) throw new TypeError('Signal gateway query contains duplicates');
  if (url.pathname === '/v1/strategy29/status' && keys.length === 0) return path;
  if (url.pathname !== '/v1/strategy29/events' || !isCanonicalUsdtSymbol(query.get('symbol'))) {
    throw new TypeError('Signal gateway route or symbol is invalid');
  }
  const cursor = query.get('cursor');
  const latest = keys.length === 3 && keys.every(key => ['symbol', 'mode', 'limit'].includes(key))
    && query.get('mode') === 'latest' && query.get('limit') === '20';
  const increment = keys.length === 2 && keys.includes('cursor')
    && /^(0|[1-9]\d*)$/.test(cursor) && Number.isSafeInteger(Number(cursor));
  if (!latest && !increment) throw new TypeError('Signal gateway event query is invalid');
  return path;
}

/** Runs inside the existing installation; only sanitized results leave its private GM closure. */
export function installSignalGatewayBridge(view, { getValue, gmXmlHttpRequest }) {
  if (view[SIGNAL_GATEWAY_BRIDGE] !== undefined) throw new Error('Signal gateway is already installed; reload the page');
  let settingsRevision = 0;
  let disposed = false;
  const pending = new Set();
  const api = Object.freeze({
    version: 1,
    getState() {
      const value = getValue(SIGNAL_GATEWAY_SECRET_KEY, '');
      if (typeof value !== 'string') throw new TypeError('Signal gateway configuration is invalid');
      return Object.freeze({ available: !disposed, configured: value.length > 0, settingsRevision });
    },
    request(path, signal) {
      validateSignalGatewayPath(path);
      if (disposed) throw new Error('Signal gateway is disposed');
      if (!signal || typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function') {
        throw new TypeError('Signal gateway request requires an AbortSignal');
      }
      if (signal.aborted) return Promise.resolve({ kind: 'aborted' });
      if (pending.size >= 4) return Promise.resolve({ kind: 'transport_error' });
      const { authSecret, gatewayOrigin } = readSignalGatewaySettings(getValue);
      if (!authSecret) return Promise.resolve({ kind: 'configuration_required' });
      return new Promise(resolve => {
        let settled = false;
        let handle;
        let timeout = null;
        function finish(value) {
          if (settled) return;
          settled = true;
          if (timeout !== null) view.clearTimeout(timeout);
          signal.removeEventListener('abort', abort);
          pending.delete(abort);
          resolve(value);
        }
        function abort() {
          finish({ kind: 'aborted' });
          handle.abort();
        }
        try {
          handle = gmXmlHttpRequest({
            method: 'GET', url: gatewayOrigin + path,
            headers: { Authorization: `Bearer ${authSecret}` }, redirect: 'error', anonymous: true,
            onload(response) {
              if (!Number.isInteger(response.status) || typeof response.responseText !== 'string'
                || response.responseText.length > MAX_RESPONSE_LENGTH) {
                finish({ kind: 'invalid_response' });
              } else finish({ kind: 'response', status: response.status, responseText: response.responseText });
            },
            onerror: () => finish({ kind: 'transport_error' }),
            ontimeout: () => finish({ kind: 'transport_error' }),
            onabort: () => finish({ kind: 'aborted' }),
          });
        } catch {
          finish({ kind: 'transport_error' });
          return;
        }
        if (settled) return;
        /** Redirect rejection uses fetch mode, where Chrome ignores GM's timeout option. */
        timeout = view.setTimeout(() => {
          finish({ kind: 'transport_error' });
          handle.abort();
        }, 10_000);
        pending.add(abort);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
    },
  });
  Object.defineProperty(view, SIGNAL_GATEWAY_BRIDGE, { value: api, configurable: true });
  return Object.freeze({
    settingsChanged() {
      settingsRevision += 1;
      for (const abort of [...pending]) abort();
    },
    dispose() {
      disposed = true;
      for (const abort of [...pending]) abort();
      if (view[SIGNAL_GATEWAY_BRIDGE] === api) delete view[SIGNAL_GATEWAY_BRIDGE];
    },
  });
}
