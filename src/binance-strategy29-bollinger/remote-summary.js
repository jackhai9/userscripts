import {
  Strategy29GatewayTransportError,
  createStrategy29SummaryClient,
} from './core/remote-summary-client.js';
import {
  STRATEGY29_REFERENCE_SHA256,
  STRATEGY29_SPEC_VERSION,
  routeSymbolToCanonical,
} from './core/remote-summary-contract.js';
import { createStrategy29SummaryPanel } from './dom/strategy29-summary-panel.js';
import { parseFuturesTradingSymbolFromPathname } from '../shared/binance-futures-route.js';

import { SUMMARY_COPY as COPY, resolveUiLocaleFromPathname } from './ui-copy.js';

export const STRATEGY29_PANEL_POSITION_KEY = 'strategy29SummaryPanelPosition';
export const STRATEGY29_REMOTE_POLL_INTERVAL_MS = 5_000;

function abortError(view, message) {
  const ErrorConstructor = view.DOMException ?? DOMException;
  return new ErrorConstructor(message, 'AbortError');
}

function assertAdapters({ view, request, getValue, setValue, getGatewayState, createPanel, createClient }) {
  if (!view?.document || !view?.location) throw new TypeError('Strategy 29 remote summary requires a page window');
  for (const [name, value] of Object.entries({
    request, getValue, setValue, getGatewayState, createPanel, createClient,
  })) {
    if (typeof value !== 'function') throw new TypeError(`Strategy 29 remote summary ${name} is invalid`);
  }
}

/** Default read-only remote projection. Its state machine cannot stop or mutate the local chart observer. */
export function createStrategy29RemoteSummary({
  view,
  request,
  getValue,
  setValue,
  getGatewayState,
  createPanel = createStrategy29SummaryPanel,
  createClient = createStrategy29SummaryClient,
  pollIntervalMs = STRATEGY29_REMOTE_POLL_INTERVAL_MS,
}) {
  assertAdapters({ view, request, getValue, setValue, getGatewayState, createPanel, createClient });
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 1_000) throw new TypeError('Strategy 29 remote poll interval is invalid');
  let active = null;
  let disposed = false;
  let unsupportedRoute = null;
  let locale = resolveUiLocaleFromPathname(view.location.pathname);

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

  function startContext(routeSymbol, gatewayState) {
    const canonicalSymbol = routeSymbolToCanonical(routeSymbol);
    const panel = createPanel(view.document, canonicalSymbol, {
      maxEvents: 20, locale,
      loadPosition: () => getValue(STRATEGY29_PANEL_POSITION_KEY, null),
      savePosition: position => setValue(STRATEGY29_PANEL_POSITION_KEY, position),
    });
    const AbortControllerConstructor = view.AbortController ?? AbortController;
    const context = {
      routeSymbol,
      canonicalSymbol,
      gatewayState: { ...gatewayState },
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
    if (!gatewayState.configured) {
      context.state = 'configuration_required';
      panel.setConnection('configuration_required', COPY.configuration);
      return context;
    }
    try {
      context.client = createClient({
        request,
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
      panel.setConnection('stopped', COPY.stopped(error.message));
      view.console.warn('[Strategy29 remote]', error.message);
    }
    return context;
  }

  function synchronizeContext() {
    if (!view.document.body) {
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
    const gatewayState = getGatewayState();
    if (!gatewayState.available) {
      stopActive('Shared signal gateway unavailable');
      return null;
    }
    if (active?.routeSymbol === routeSymbol
      && active.gatewayState.settingsRevision === gatewayState.settingsRevision
      && active.gatewayState.configured === gatewayState.configured) return active;
    if (unsupportedRoute === routeSymbol) return null;
    unsupportedRoute = null;
    stopActive('Strategy 29 route changed');
    try {
      return startContext(routeSymbol, gatewayState);
    } catch (error) {
      unsupportedRoute = routeSymbol;
      stopActive('Strategy 29 remote context initialization failed');
      view.console.warn('[Strategy29 remote]', error.message);
      return null;
    }
  }

  function sample(nowMs = Date.now()) {
    if (disposed || view.document.hidden) return;
    synchronizeLocale();
    const context = synchronizeContext();
    if (!context || !context.client || context.inFlight || context.failed || nowMs < context.nextPollAtMs) return;
    if (context.abortController.signal.aborted) {
      const AbortControllerConstructor = view.AbortController ?? AbortController;
      context.abortController = new AbortControllerConstructor();
    }
    const controller = context.abortController;
    const ownsRequest = () => isCurrent(context) && context.abortController === controller
      && getGatewayState().settingsRevision === context.gatewayState.settingsRevision;
    context.nextPollAtMs = nowMs + pollIntervalMs;
    context.inFlight = true;
    context.state = 'connecting';
    context.panel.setConnection('connecting', COPY.connecting);
    return context.client.poll(controller.signal)
      .then(result => {
        if (!ownsRequest()) return;
        context.lastResult = result;
        context.lastError = null;
        context.state = result.state;
        const presentation = {
          connected: ['connected', result.hasMore ? COPY.moreHistory : COPY.connected],
          unavailable: ['unavailable', COPY.unavailable],
          module_disabled: ['module_disabled', COPY.moduleDisabled],
          gateway_unavailable: ['gateway_unavailable', COPY.gatewayUnavailable],
          incompatible: ['incompatible', COPY.incompatible],
        }[result.state];
        if (!presentation) throw new Error(`Strategy 29 remote state is invalid: ${result.state}`);
        context.panel.setConnection(...presentation);
      })
      .catch(error => {
        if (!ownsRequest() || error?.name === 'AbortError') return;
        context.lastError = error.message;
        if (error instanceof Strategy29GatewayTransportError) {
          context.state = 'disconnected';
          context.panel.setConnection('disconnected', COPY.disconnected);
        } else {
          context.state = 'stopped';
          context.failed = true;
          context.panel.setConnection('stopped', COPY.stopped(error.message));
        }
        view.console.warn('[Strategy29 remote]', error.message);
      })
      .finally(() => { if (ownsRequest()) context.inFlight = false; });
  }

  function restart() {
    unsupportedRoute = null;
    stopActive('Strategy 29 remote settings changed');
    if (!disposed) void sample(Date.now());
  }

  function synchronizeLocale() {
    const current = resolveUiLocaleFromPathname(view.location.pathname);
    if (current === locale) return;
    locale = current;
    active?.panel.setLocale(locale);
  }

  return Object.freeze({
    sample,
    pause() {
      if (!active) return;
      active.abortController.abort(abortError(view, 'Strategy 29 remote summary paused'));
      active.inFlight = false;
      active.nextPollAtMs = 0;
    },
    restart,
    dispose() {
      if (disposed) return;
      disposed = true;
      stopActive('Strategy 29 remote summary disposed');
    },
    get diagnostics() {
      return Object.freeze({
        contextPresent: active !== null,
        canonicalSymbol: active?.canonicalSymbol ?? null,
        gatewayRevision: active?.gatewayState.settingsRevision ?? null,
        state: active?.state ?? (unsupportedRoute ? 'unsupported_route' : !getGatewayState().available ? 'waiting_for_gateway' : 'waiting_for_route'),
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
