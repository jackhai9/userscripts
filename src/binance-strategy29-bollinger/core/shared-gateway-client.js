import { SIGNAL_GATEWAY_BRIDGE } from '../../shared/signal-gateway-bridge.js';
import { Strategy29GatewayTransportError } from './remote-summary-client.js';

/** Consume only public read results; credentials never enter this script's storage or context. */
export function createSharedGatewayClient(view) {
  function bridge() {
    const value = view[SIGNAL_GATEWAY_BRIDGE];
    if (value === undefined) return null;
    if (value.version !== 1 || typeof value.getState !== 'function' || typeof value.request !== 'function') {
      throw new TypeError('Shared signal gateway version is incompatible; update both scripts and reload');
    }
    return value;
  }
  function getGatewayState() {
    const api = bridge();
    if (api === null) return { available: false, configured: false, settingsRevision: null };
    const state = api.getState();
    if (typeof state.available !== 'boolean' || typeof state.configured !== 'boolean'
      || !Number.isSafeInteger(state.settingsRevision) || state.settingsRevision < 0) {
      throw new TypeError('Shared signal gateway state is invalid');
    }
    return { available: state.available, configured: state.configured, settingsRevision: state.settingsRevision };
  }
  return Object.freeze({
    getGatewayState,
    async request({ path, signal }) {
      const api = bridge();
      if (api === null) throw new Strategy29GatewayTransportError('Shared signal gateway is unavailable');
      const revision = api.getState().settingsRevision;
      const result = await api.request(path, signal);
      if (signal.aborted) throw signal.reason;
      if (view[SIGNAL_GATEWAY_BRIDGE] !== api || api.getState().settingsRevision !== revision || result.kind === 'aborted') {
        throw new view.DOMException('Shared signal gateway request retired', 'AbortError');
      }
      if (result.kind === 'transport_error') throw new Strategy29GatewayTransportError('Shared signal gateway transport failure');
      if (result.kind !== 'response' || !Number.isInteger(result.status) || typeof result.responseText !== 'string'
        || Object.keys(result).sort().join(',') !== 'kind,responseText,status') {
        throw new TypeError('Shared signal gateway response is invalid');
      }
      return { status: result.status, responseText: result.responseText };
    },
  });
}
