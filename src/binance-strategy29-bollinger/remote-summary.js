import {
  Strategy29GatewayTransportError,
  createStrategy29SummaryClient,
  normalizeStrategy29GatewayOrigin,
} from './core/remote-summary-client.js';
import {
  STRATEGY29_REFERENCE_SHA256,
  STRATEGY29_SPEC_VERSION,
  routeSymbolToCanonical,
} from './core/remote-summary-contract.js';
import { createStrategy29SummaryPanel } from './dom/strategy29-summary-panel.js';
import { parseFuturesTradingSymbolFromPathname } from '../shared/binance-futures-route.js';

export const STRATEGY29_REMOTE_ENABLED_KEY = 'strategy29RemoteSummaryEnabled';
export const STRATEGY29_GATEWAY_ORIGIN_KEY = 'strategy29GatewayOrigin';
export const STRATEGY29_GATEWAY_SECRET_KEY = 'strategy29GatewayAuthSecret';
export const STRATEGY29_DEFAULT_GATEWAY_ORIGIN = 'http://127.0.0.1:8729';
export const STRATEGY29_REMOTE_POLL_INTERVAL_MS = 5_000;

function abortError(view, message) {
  const ErrorConstructor = view.DOMException ?? DOMException;
  return new ErrorConstructor(message, 'AbortError');
}

function assertAdapters({ view, request, getValue, setValue, registerMenuCommand, promptUser, createPanel, createClient }) {
  if (!view?.document || !view?.location) throw new TypeError('Strategy 29 remote summary requires a page window');
  for (const [name, value] of Object.entries({
    request, getValue, setValue, registerMenuCommand, promptUser, createPanel, createClient,
  })) {
    if (typeof value !== 'function') throw new TypeError(`Strategy 29 remote summary ${name} is invalid`);
  }
}

/** Optional remote projection. Its state machine cannot stop or mutate the local chart observer. */
export function createStrategy29RemoteSummary({
  view,
  request,
  getValue,
  setValue,
  registerMenuCommand,
  promptUser,
  createPanel = createStrategy29SummaryPanel,
  createClient = createStrategy29SummaryClient,
  pollIntervalMs = STRATEGY29_REMOTE_POLL_INTERVAL_MS,
}) {
  assertAdapters({ view, request, getValue, setValue, registerMenuCommand, promptUser, createPanel, createClient });
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 1_000) throw new TypeError('Strategy 29 remote poll interval is invalid');
  let enabled = getValue(STRATEGY29_REMOTE_ENABLED_KEY, false) === true;
  let active = null;
  let disposed = false;
  let unsupportedRoute = null;

  function isCurrent(context) {
    return !disposed && active === context && !context.abortController.signal.aborted;
  }

  function stopActive(reason = 'Strategy 29 remote context retired') {
    if (!active) return;
    const context = active;
    active = null;
    context.abortController.abort(abortError(view, reason));
    context.panel.destroy();
  }

  function configuredSettings() {
    const authSecret = getValue(STRATEGY29_GATEWAY_SECRET_KEY, '');
    if (typeof authSecret !== 'string') throw new TypeError('Strategy 29 gateway secret storage is invalid');
    const gatewayOrigin = normalizeStrategy29GatewayOrigin(
      getValue(STRATEGY29_GATEWAY_ORIGIN_KEY, STRATEGY29_DEFAULT_GATEWAY_ORIGIN),
    );
    return { authSecret, gatewayOrigin };
  }

  function startContext(routeSymbol) {
    const canonicalSymbol = routeSymbolToCanonical(routeSymbol);
    const panel = createPanel(view.document, canonicalSymbol, { maxEvents: 20 });
    const AbortControllerConstructor = view.AbortController ?? AbortController;
    const context = {
      routeSymbol,
      canonicalSymbol,
      gatewayOrigin: null,
      panel,
      abortController: new AbortControllerConstructor(),
      client: null,
      inFlight: false,
      failed: false,
      nextPollAtMs: 0,
      state: 'idle',
      lastError: null,
      lastResult: null,
    };
    active = context;
    let settings;
    try {
      settings = configuredSettings();
      context.gatewayOrigin = settings.gatewayOrigin;
    } catch (error) {
      context.failed = true;
      context.state = 'stopped';
      context.lastError = error.message;
      panel.setConnection('stopped', `Remote summary stopped: ${error.message}`);
      view.console.warn('[Strategy29 remote]', error.message);
      return context;
    }
    const { authSecret, gatewayOrigin } = settings;
    if (authSecret.length === 0) {
      context.state = 'configuration_required';
      panel.setConnection('configuration_required', 'Gateway secret is not configured');
      return context;
    }
    try {
      context.client = createClient({
        request,
        gatewayOrigin,
        authSecret,
        canonicalSymbol,
        maxPagesPerPoll: 2,
        onStatus: snapshot => {
          if (isCurrent(context)) context.panel.renderStatus(snapshot);
        },
        onEvents: (events, observedAtMs) => {
          if (isCurrent(context)) context.panel.addEvents(events, observedAtMs);
        },
        onCursorReset: () => {
          if (isCurrent(context)) context.panel.clearEvents();
        },
      });
    } catch (error) {
      context.failed = true;
      context.state = 'stopped';
      context.lastError = error.message;
      panel.setConnection('stopped', `Remote summary stopped: ${error.message}`);
      view.console.warn('[Strategy29 remote]', error.message);
    }
    return context;
  }

  function synchronizeContext() {
    if (!enabled || !view.document.body) {
      unsupportedRoute = null;
      stopActive('Strategy 29 remote summary disabled');
      return null;
    }
    const routeSymbol = parseFuturesTradingSymbolFromPathname(view.location.pathname);
    if (!routeSymbol) {
      unsupportedRoute = null;
      stopActive('Strategy 29 route changed');
      return null;
    }
    if (active?.routeSymbol === routeSymbol) return active;
    if (unsupportedRoute === routeSymbol) return null;
    unsupportedRoute = null;
    stopActive('Strategy 29 route changed');
    try {
      return startContext(routeSymbol);
    } catch (error) {
      unsupportedRoute = routeSymbol;
      stopActive('Strategy 29 remote context initialization failed');
      view.console.warn('[Strategy29 remote]', error.message);
      return null;
    }
  }

  function sample(nowMs = Date.now()) {
    if (disposed) return;
    const context = synchronizeContext();
    if (!context || !context.client || context.inFlight || context.failed || nowMs < context.nextPollAtMs) return;
    context.nextPollAtMs = nowMs + pollIntervalMs;
    context.inFlight = true;
    context.state = 'connecting';
    context.panel.setConnection('connecting', 'Connecting to Strategy 29 gateway');
    return context.client.poll(context.abortController.signal)
      .then(result => {
        if (!isCurrent(context)) return;
        context.lastResult = result;
        context.lastError = null;
        context.state = result.state;
        const presentation = {
          connected: ['connected', result.hasMore ? 'Connected · more history pending' : 'Connected'],
          unavailable: ['unavailable', 'Gateway database unavailable'],
          incompatible: ['incompatible', 'Server and local specs are incompatible'],
        }[result.state];
        if (!presentation) throw new Error(`Strategy 29 remote state is invalid: ${result.state}`);
        context.panel.setConnection(...presentation);
      })
      .catch(error => {
        if (!isCurrent(context) || error?.name === 'AbortError') return;
        context.lastError = error.message;
        if (error instanceof Strategy29GatewayTransportError) {
          context.state = 'disconnected';
          context.panel.setConnection('disconnected', 'Gateway connection failed; next scheduled poll will retry');
        } else {
          context.state = 'stopped';
          context.failed = true;
          context.panel.setConnection('stopped', `Remote summary stopped: ${error.message}`);
        }
        view.console.warn('[Strategy29 remote]', error.message);
      })
      .finally(() => { context.inFlight = false; });
  }

  function restart() {
    unsupportedRoute = null;
    stopActive('Strategy 29 remote settings changed');
    if (!disposed) void sample(Date.now());
  }

  registerMenuCommand('Toggle Strategy 29 cross-timeframe summary', () => {
    enabled = !enabled;
    setValue(STRATEGY29_REMOTE_ENABLED_KEY, enabled);
    restart();
  });
  registerMenuCommand('Set Strategy 29 gateway secret', () => {
    const value = promptUser('Enter the local Strategy 29 gateway secret. It is stored only in this userscript storage.');
    if (value === null) return;
    if (value.length === 0) throw new Error('Strategy 29 gateway secret cannot be empty');
    setValue(STRATEGY29_GATEWAY_SECRET_KEY, value);
    restart();
  });
  registerMenuCommand('Set Strategy 29 gateway origin', () => {
    const current = getValue(STRATEGY29_GATEWAY_ORIGIN_KEY, STRATEGY29_DEFAULT_GATEWAY_ORIGIN);
    const value = promptUser('Enter the loopback gateway origin (http://127.0.0.1:<port>)', current);
    if (value === null) return;
    setValue(STRATEGY29_GATEWAY_ORIGIN_KEY, normalizeStrategy29GatewayOrigin(value));
    restart();
  });

  return Object.freeze({
    sample,
    pause() { stopActive('Strategy 29 remote summary paused'); },
    restart,
    dispose() {
      if (disposed) return;
      disposed = true;
      stopActive('Strategy 29 remote summary disposed');
    },
    get diagnostics() {
      return Object.freeze({
        enabled,
        contextPresent: active !== null,
        canonicalSymbol: active?.canonicalSymbol ?? null,
        gatewayOrigin: active?.gatewayOrigin ?? null,
        state: active?.state ?? (unsupportedRoute ? 'unsupported_route' : enabled ? 'waiting_for_route' : 'disabled'),
        inFlight: active?.inFlight ?? false,
        stopped: active?.failed ?? false,
        lastError: active?.lastError ?? null,
        lastResult: active?.lastResult ?? null,
        cursor: active?.client?.diagnostics.cursor ?? null,
        specVersion: STRATEGY29_SPEC_VERSION,
        referenceSha256: STRATEGY29_REFERENCE_SHA256,
      });
    },
  });
}
