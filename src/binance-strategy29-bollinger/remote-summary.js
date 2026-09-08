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

import { SUMMARY_COPY as COPY, formatLocalizedText, resolveUiLocaleFromPathname } from './ui-copy.js';

export const STRATEGY29_PANEL_POSITION_KEY = 'strategy29SummaryPanelPosition';
export const STRATEGY29_REMOTE_ENABLED_KEY = 'strategy29RemoteSummaryEnabled';
export const STRATEGY29_REMOTE_POLL_INTERVAL_MS = 5_000;

function abortError(view, message) {
  const ErrorConstructor = view.DOMException ?? DOMException;
  return new ErrorConstructor(message, 'AbortError');
}

function assertAdapters({ view, request, getValue, setValue, registerMenuCommand, getGatewaySettings, createPanel, createClient }) {
  if (!view?.document || !view?.location) throw new TypeError('Strategy 29 remote summary requires a page window');
  for (const [name, value] of Object.entries({
    request, getValue, setValue, registerMenuCommand, getGatewaySettings, createPanel, createClient,
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
  getGatewaySettings,
  createPanel = createStrategy29SummaryPanel,
  createClient = createStrategy29SummaryClient,
  pollIntervalMs = STRATEGY29_REMOTE_POLL_INTERVAL_MS,
}) {
  assertAdapters({ view, request, getValue, setValue, registerMenuCommand, getGatewaySettings, createPanel, createClient });
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 1_000) throw new TypeError('Strategy 29 remote poll interval is invalid');
  let enabled = getValue(STRATEGY29_REMOTE_ENABLED_KEY, false) === true;
  let active = null;
  let disposed = false;
  let unsupportedRoute = null;
  let locale = resolveUiLocaleFromPathname(view.location.pathname);
  const text = value => formatLocalizedText(value, locale);

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
    const { authSecret, gatewayOrigin } = getGatewaySettings();
    if (typeof authSecret !== 'string') throw new TypeError('Strategy 29 gateway secret storage is invalid');
    return { authSecret, gatewayOrigin: normalizeStrategy29GatewayOrigin(gatewayOrigin) };
  }

  function startContext(routeSymbol) {
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
    if (!enabled) {
      context.state = 'disabled';
      panel.setConnection('disabled', COPY.disabled);
      return context;
    }
    let settings;
    try {
      settings = configuredSettings();
      context.gatewayOrigin = settings.gatewayOrigin;
    } catch (error) {
      context.failed = true;
      context.state = 'stopped';
      context.lastError = error.message;
      panel.setConnection('stopped', COPY.stopped(error.message));
      view.console.warn('[Strategy29 remote]', error.message);
      return context;
    }
    const { authSecret, gatewayOrigin } = settings;
    if (authSecret.length === 0) {
      context.state = 'configuration_required';
      panel.setConnection('configuration_required', COPY.configuration);
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
    if (disposed || view.document.hidden) return;
    synchronizeLocale();
    const context = synchronizeContext();
    if (!context || !context.client || context.inFlight || context.failed || nowMs < context.nextPollAtMs) return;
    if (context.abortController.signal.aborted) {
      const AbortControllerConstructor = view.AbortController ?? AbortController;
      context.abortController = new AbortControllerConstructor();
    }
    const controller = context.abortController;
    const ownsRequest = () => isCurrent(context) && context.abortController === controller;
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
    enabled = getValue(STRATEGY29_REMOTE_ENABLED_KEY, false) === true;
    unsupportedRoute = null;
    stopActive('Strategy 29 remote settings changed');
    if (!disposed) void sample(Date.now());
  }

  const menus = [
    { copy: COPY.menuToggle, run() {
      enabled = !enabled;
      setValue(STRATEGY29_REMOTE_ENABLED_KEY, enabled);
      restart();
    } },
  ];
  for (const menu of menus) menu.id = registerMenuCommand(text(menu.copy), menu.run);
  function synchronizeLocale() {
    const current = resolveUiLocaleFromPathname(view.location.pathname);
    if (current === locale) return;
    locale = current;
    // Updating menu IDs and rendering text do not retire a client or its cursor.
    for (const menu of menus) menu.id = registerMenuCommand(text(menu.copy), menu.run, { id: menu.id });
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
