import { normalizeGatewayBaseUrl } from '../binance-strategy27-events/core/live-event-client.js';

/** Keep the existing installation keys so an in-place update retains private credentials. */
export const SIGNAL_GATEWAY_ORIGIN_KEY = 'strategy27GatewayOrigin';
export const SIGNAL_GATEWAY_SECRET_KEY = 'strategy27GatewayAuthSecret';
export const SIGNAL_GATEWAY_ORIGIN = 'http://127.0.0.1:18765';

export function readSignalGatewaySettings(getValue) {
  const authSecret = getValue(SIGNAL_GATEWAY_SECRET_KEY, '');
  if (typeof authSecret !== 'string') throw new TypeError('Signal gateway secret storage is invalid');
  return {
    authSecret,
    gatewayOrigin: normalizeGatewayBaseUrl(getValue(SIGNAL_GATEWAY_ORIGIN_KEY, SIGNAL_GATEWAY_ORIGIN)),
  };
}
