// ==UserScript==
// @name         【自写】Binance Strategy 27 事件标注
// @namespace    binance.strategy27.events
// @icon         data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%23f0b90b%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2249%22%20text-anchor%3D%22middle%22%20font-family%3D%22Arial%2C%20sans-serif%22%20font-size%3D%2242%22%20font-weight%3D%22800%22%20fill%3D%22%23111827%22%3EJ%3C%2Ftext%3E%3C%2Fsvg%3E
// @icon64       data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%23f0b90b%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2249%22%20text-anchor%3D%22middle%22%20font-family%3D%22Arial%2C%20sans-serif%22%20font-size%3D%2242%22%20font-weight%3D%22800%22%20fill%3D%22%23111827%22%3EJ%3C%2Ftext%3E%3C%2Fsvg%3E
// @version      0.5.1
// @author       jackhai9
// @description  统一配置 CorsairQuant 网关，显示 Strategy 27 事件与 Strategy 29 跨周期汇总
// @match        https://www.binance.com/*/futures/*
// @match        https://www.binance.com/futures/*
// @exclude      https://www.binance.com/*/my/wallet/futures/*
// @exclude      https://www.binance.com/my/wallet/futures/*
// @connect      127.0.0.1
// @updateURL    https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-strategy27-events.user.js
// @downloadURL  https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-strategy27-events.user.js
// @run-at       document-idle
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

import {
  canonicalSymbolToRoute,
  LiveEventLifecycle,
  routeSymbolToCanonical,
} from './core/live-event-contract.js';
import {
  createGmJsonRequest,
  createLiveEventClient,
  normalizeGatewayBaseUrl,
} from './core/live-event-client.js';
import {
  buildEventAnnotation,
  stabilizeCandidatePresentation,
} from './core/event-annotation.js';
import {
  createTradingViewEventLayer,
  ensureStrategy27StatusView,
  findStrategy27ChartRoot,
  findStrategy27ChartTarget,
  removeStrategy27StatusView,
  setStrategy27Status,
} from './dom/tradingview-event-layer.js';
import { createStrategy27EventPanel } from './dom/strategy27-event-panel.js';
import { createCompoundCandidateController } from './core/compound-candidate-controller.js';
import { createTradingViewCompoundLayer } from './dom/tradingview-compound-layer.js';
import { parseFuturesTradingSymbolFromPathname } from '../shared/binance-futures-route.js';
import { createStrategy27Translator, localizeAnnotation, resolveUiLocaleFromPathname } from './core/ui-copy.js';
import { installSpaRouteChangeListener } from '../shared/spa-route-change.js';
import { createStrategy29RemoteSummary } from '../binance-strategy29-bollinger/remote-summary.js';
import { createStrategy29GmJsonRequest } from '../binance-strategy29-bollinger/core/remote-summary-client.js';
import { readSignalGatewaySettings, SIGNAL_GATEWAY_ORIGIN, SIGNAL_GATEWAY_ORIGIN_KEY, SIGNAL_GATEWAY_SECRET_KEY } from '../shared/signal-client-settings.js';
import { migrateStrategy29Preferences, isStrategy29CompanionReady, STRATEGY29_PREFERENCES_EVENT, SIGNAL_HOST_READY, SIGNAL_HOST_READY_EVENT } from '../shared/strategy29-preferences-migration.js';

const promptUser = globalThis.prompt.bind(globalThis);

(function () {
  'use strict';

  const DEFAULT_GATEWAY_ORIGIN = SIGNAL_GATEWAY_ORIGIN;
  const GATEWAY_ORIGIN_KEY = SIGNAL_GATEWAY_ORIGIN_KEY;
  const GATEWAY_SECRET_KEY = SIGNAL_GATEWAY_SECRET_KEY;
  const PANEL_POSITION_KEY = 'strategy27EventPanelPosition';
  const CONTEXT_CHECK_INTERVAL_MS = 1_000;
  const MAX_RETAINED_EVENTS = 80;
  const MAX_PANEL_EVENTS = 8;
  const MAX_EVENT_AGE_MS = 2 * 60 * 60 * 1_000;
  const page = unsafeWindow;
  const pageDocument = page.document;
  const request = createGmJsonRequest(GM_xmlhttpRequest);
  let active = null;
  let statusView = null;
  let uiLocale = resolveUiLocaleFromPathname(page.location.pathname);
  let t = createStrategy27Translator(uiLocale);
  let statusCopy = null;
  let strategy29Summary = null;
  let strategy29Failure = null;
  function failStrategy29(error) {
    if (strategy29Failure !== null) return;
    strategy29Failure = String(error.message).slice(0, 512);
    if (strategy29Summary !== null) strategy29Summary.dispose();
    page.console.warn('[CorsairQuant Strategy29]', strategy29Failure);
  }
  /** The companion must relinquish legacy remote ownership before this installation takes it. */
  function initializeStrategy29() {
    if (strategy29Summary !== null || !isStrategy29CompanionReady(page)) return;
    migrateStrategy29Preferences(page, GM_getValue, GM_setValue);
    strategy29Summary = createStrategy29RemoteSummary({
      view: page,
      request: createStrategy29GmJsonRequest(GM_xmlhttpRequest),
      getValue: GM_getValue,
      setValue: GM_setValue,
      registerMenuCommand: GM_registerMenuCommand,
      getGatewaySettings: () => readSignalGatewaySettings(GM_getValue),
    });
    Object.defineProperty(page, SIGNAL_HOST_READY, { value: true });
    page.dispatchEvent(new page.Event(SIGNAL_HOST_READY_EVENT));
  }
  try { initializeStrategy29(); } catch (error) { failStrategy29(error); }
  /** Module boundary: a panel failure must not interrupt independent Strategy27 consumers. */
  function sampleStrategy29() {
    if (strategy29Failure !== null || strategy29Summary === null) return;
    try {
      const pending = strategy29Summary.sample(Date.now());
      if (pending) void pending.catch(failStrategy29);
    } catch (error) { failStrategy29(error); }
  }
  function onStrategy29Preferences() {
    if (strategy29Failure !== null) return;
    try {
      initializeStrategy29();
      sampleStrategy29();
    } catch (error) { failStrategy29(error); }
  }
  page.addEventListener(STRATEGY29_PREFERENCES_EVENT, onStrategy29Preferences);
  function onSummaryVisibility() {
    if (strategy29Failure !== null || strategy29Summary === null) return;
    if (pageDocument.hidden) strategy29Summary.pause();
    else sampleStrategy29();
  }
  function pauseSummary() { if (strategy29Failure === null && strategy29Summary !== null) strategy29Summary.pause(); }
  pageDocument.addEventListener('visibilitychange', onSummaryVisibility);
  page.addEventListener('pagehide', pauseSummary);
  page.addEventListener('pageshow', onSummaryVisibility);
  Object.defineProperty(page, '__TM_SIGNAL_CLIENT_DEBUG__', {
    value: Object.freeze({ get strategy29() { return strategy29Summary === null
      ? { state: strategy29Failure === null ? 'waiting_for_companion' : 'initialization_failed', moduleFailure: strategy29Failure }
      : { ...strategy29Summary.diagnostics, moduleFailure: strategy29Failure }; } }),
  });

  function stopActive(resetReason) {
    if (!active) return;
    active.controller.abort();
    active.compound.stop(resetReason);
    active.lifecycle.reset(resetReason);
    active.layer.clear();
    active.panel.destroy();
    active = null;
  }

  function showStatus(chartRoot, text, state = 'normal') {
    statusView = ensureStrategy27StatusView(pageDocument, chartRoot);
    statusCopy = { text, state };
    setStrategy27Status(statusView, text(uiLocale), state);
  }

  function hideStatus() {
    removeStrategy27StatusView(pageDocument);
    statusView = null;
    statusCopy = null;
  }

  function removeOrdinaryEvent(context, eventId) {
    context.ordinaryHistory.delete(eventId);
    context.layer.remove(eventId);
    context.panel.remove(eventId);
    context.candidatePresentations.delete(eventId);
  }

  function pruneOrdinaryEvents(context) {
    const now = Date.now();
    context.lifecycle.prune(now);
    for (const [eventId, observedAtMs] of context.ordinaryHistory) {
      if (now - observedAtMs > MAX_EVENT_AGE_MS) removeOrdinaryEvent(context, eventId);
    }
  }

  /** Transport epochs reset validation, not the lifetime of verified chart evidence. */
  function retainOrdinaryEvent(context, eventId, observedAtMs) {
    const previous = context.ordinaryHistory.get(eventId);
    const retainedAtMs = previous === undefined ? observedAtMs : Math.max(previous, observedAtMs);
    context.ordinaryHistory.set(eventId, retainedAtMs);
    const oldestFirst = [...context.ordinaryHistory].sort(([leftId, leftTime], [rightId, rightTime]) => (
      leftTime - rightTime || leftId.localeCompare(rightId)
    ));
    while (context.ordinaryHistory.size > MAX_RETAINED_EVENTS) {
      removeOrdinaryEvent(context, oldestFirst.shift()[0]);
    }
    return retainedAtMs;
  }

  function failOrdinary(context, error) {
    if (error.name === 'AbortError' || active !== context || context.failed) return;
    context.failed = true;
    context.controller.abort();
    context.layer.suspend();
    context.panel.setOrdinaryConnection('stopped');
    showStatus(context.target.chartRoot, (locale) => createStrategy27Translator(locale)('Strategy 27 已停止，历史记录已保留。请使用重新连接菜单恢复：', 'Strategy 27 stopped; history retained. Use the reconnect menu to resume: ') + error.message, 'error');
  }

  function reconcileOrdinary(context) {
    try {
      pruneOrdinaryEvents(context);
      if (context.failed) return;
      if (context.reconciliation) return;
      context.reconciliation = context.layer.reconcile()
        .catch((error) => failOrdinary(context, error))
        .finally(() => { context.reconciliation = null; });
    } catch (error) {
      failOrdinary(context, error);
    }
  }

  async function renderGatewayResponse(context, response) {
    if (active !== context || context.failed) return;
    context.panel.setOrdinaryConnection('connected');
    pruneOrdinaryEvents(context);
    if (response.status === 'reset') {
      context.lifecycle.reset(response.reason);
      context.panel.retainHistory();
      hideStatus();
      return;
    }

    let messages = response.messages;
    if (response.status === 'bootstrap') {
      context.lifecycle.beginBootstrap({
        runtimeEpoch: response.runtime_epoch,
        observedAtMs: response.bootstrap_observed_at_ms,
      });
      context.panel.retainHistory();
      const bySequence = new Map();
      for (const record of response.records) {
        for (const message of [record.marker_envelope, record.event_envelope, record.outcome_envelope]) {
          if (message === null) continue;
          const existing = bySequence.get(message.sequence);
          if (existing && JSON.stringify(existing) !== JSON.stringify(message)) {
            throw new Error('Strategy 27 bootstrap sequence identifies different envelopes');
          }
          bySequence.set(message.sequence, message);
        }
      }
      messages = [...bySequence.values()].sort((left, right) => left.sequence - right.sequence);
    }

    for (const message of messages) {
      if (active !== context || context.failed) return;
      const action = context.lifecycle.apply(message);
      if (action.type === 'stream_reset') {
        context.panel.retainHistory();
        hideStatus();
        continue;
      }
      if (action.type === 'event_evicted') continue;
      context.panel.observeOrdinaryEvent(action.event, action.observedAtMs);
      const retainedAtMs = retainOrdinaryEvent(context, action.eventId, action.observedAtMs);
      if (!context.ordinaryHistory.has(action.eventId)) continue;
      const annotation = stabilizeCandidatePresentation(
        context.candidatePresentations,
        action.eventId,
        buildEventAnnotation({
          event: action.event,
          rehydrated: action.rehydrated,
          locale: context.locale,
        }),
      );
      const renderMethod = {
        event_opened: 'renderOpened',
        event_updated: 'renderUpdated',
        event_closed: 'renderClosed',
        event_outcome: 'renderOutcome',
      }[action.messageKind];
      const rendered = await context.layer[renderMethod](action.eventId, annotation, retainedAtMs);
      if (!rendered || active !== context || context.failed || !context.ordinaryHistory.has(action.eventId)) continue;
      context.panel.upsert(action.eventId, localizeAnnotation(annotation, context.locale), retainedAtMs);
      hideStatus();
    }
    if (response.status === 'bootstrap') {
      context.lifecycle.finishBootstrap(response.last_sequence);
      hideStatus();
    }
  }

  function startContext({ routeSymbol, canonicalSymbol, target, gatewayOrigin, authSecret }) {
    const context = {
      signature: `${routeSymbol}|${target.resolution}`,
      routeSymbol,
      locale: uiLocale,
      canonicalSymbol,
      target,
      controller: new AbortController(),
      lifecycle: new LiveEventLifecycle(canonicalSymbol, {
        maxEvents: MAX_RETAINED_EVENTS,
        maxAgeMs: MAX_EVENT_AGE_MS,
      }),
      layer: createTradingViewEventLayer(target, {
        maxEvents: MAX_RETAINED_EVENTS,
        maxAgeMs: MAX_EVENT_AGE_MS,
      }),
      panel: createStrategy27EventPanel(pageDocument, target.chartRoot, {
        locale: uiLocale,
        maxEvents: MAX_PANEL_EVENTS,
        maxCompoundEvents: MAX_PANEL_EVENTS,
        loadPosition: () => GM_getValue(PANEL_POSITION_KEY, null),
        savePosition: (position) => GM_setValue(PANEL_POSITION_KEY, position),
      }),
      candidatePresentations: new Map(),
      ordinaryHistory: new Map(),
      reconciliation: null,
      failed: false,
    };
    active = context;
    context.compound = createCompoundCandidateController({
      locale: context.locale, request, gatewayBaseUrl: gatewayOrigin, authSecret, canonicalSymbol,
      panel: context.panel, isCurrent: () => active === context,
      maxCandidates: MAX_RETAINED_EVENTS, maxAgeMs: MAX_EVENT_AGE_MS,
      createLayer: () => createTradingViewCompoundLayer(target, { maxCandidates: MAX_RETAINED_EVENTS, locale: context.locale }),
    });
    void context.compound.run();
    showStatus(target.chartRoot, (locale) => createStrategy27Translator(locale)('Strategy 27 正在连接', 'Strategy 27 connecting'));
    const client = createLiveEventClient({
      request,
      gatewayBaseUrl: gatewayOrigin,
      authSecret,
      canonicalSymbol,
      onConnectionStateChange: (state) => {
        if (active !== context || context.failed) return;
        context.panel.setOrdinaryConnection(state);
        if (state === 'reconnecting') {
          showStatus(context.target.chartRoot, (locale) => createStrategy27Translator(locale)('Strategy 27 网关连接中断，正在重连', 'Strategy 27 gateway disconnected; reconnecting'), 'inactive');
        } else {
          hideStatus();
        }
      },
      onResponse: (response) => renderGatewayResponse(context, response),
    });
    client.run(context.controller.signal).catch((error) => failOrdinary(context, error));
  }

  function synchronizeContext() {
    sampleStrategy29();
    const nextLocale = resolveUiLocaleFromPathname(page.location.pathname);
    if (nextLocale !== uiLocale) {
      uiLocale = nextLocale;
      t = createStrategy27Translator(uiLocale);
      if (active) {
        active.locale = uiLocale;
        active.panel.setLocale(uiLocale);
        active.compound.setLocale(uiLocale);
      }
      if (statusView && statusCopy) setStrategy27Status(statusView, statusCopy.text(uiLocale), statusCopy.state);
    }
    synchronizeMenus();
    const routeSymbol = parseFuturesTradingSymbolFromPathname(page.location.pathname);
    if (!routeSymbol) {
      stopActive('route_changed');
      hideStatus();
      return;
    }

    const chartRoot = findStrategy27ChartRoot(pageDocument);
    if (!chartRoot) {
      stopActive('interval_changed');
      hideStatus();
      return;
    }
    let canonicalSymbol;
    try {
      canonicalSymbol = routeSymbolToCanonical(routeSymbol);
      if (canonicalSymbolToRoute(canonicalSymbol) !== routeSymbol) {
        throw new Error('Binance route symbol does not round-trip');
      }
    } catch (error) {
      stopActive('route_changed');
      showStatus(chartRoot, (locale) => createStrategy27Translator(locale)('Strategy 27 已停止：', 'Strategy 27 stopped: ') + error.message, 'error');
      return;
    }

    let target;
    try {
      target = findStrategy27ChartTarget(pageDocument, routeSymbol);
    } catch (error) {
      stopActive('interval_changed');
      const inactive = error.message.includes('one-second chart');
      showStatus(
        chartRoot,
        inactive ? (locale) => createStrategy27Translator(locale)('Strategy 27 仅在 1 秒图表启用', 'Strategy 27 requires a one-second chart') : (locale) => createStrategy27Translator(locale)('Strategy 27 已停止：', 'Strategy 27 stopped: ') + error.message,
        inactive ? 'inactive' : 'error',
      );
      return;
    }
    if (!target) {
      stopActive('interval_changed');
      showStatus(chartRoot, (locale) => createStrategy27Translator(locale)('Strategy 27 正在等待图表接口', 'Strategy 27 waiting for the chart interface'), 'inactive');
      return;
    }

    if (
      active
      && active.routeSymbol === routeSymbol
      && active.target.chart === target.chart
      && active.target.chartRoot === target.chartRoot
    ) {
      reconcileOrdinary(active);
      void active.compound.reconcile();
      return;
    }
    stopActive('route_changed');

    const authSecret = GM_getValue(GATEWAY_SECRET_KEY, '');
    if (typeof authSecret !== 'string' || authSecret.length === 0) {
      showStatus(chartRoot, (locale) => createStrategy27Translator(locale)('Strategy 27 未配置网关密钥（请使用油猴菜单设置）', 'Strategy 27 gateway secret is not configured (use the userscript menu)'), 'inactive');
      return;
    }
    let gatewayOrigin;
    try {
      gatewayOrigin = normalizeGatewayBaseUrl(GM_getValue(GATEWAY_ORIGIN_KEY, DEFAULT_GATEWAY_ORIGIN));
    } catch (error) {
      showStatus(chartRoot, (locale) => createStrategy27Translator(locale)('Strategy 27 已停止：', 'Strategy 27 stopped: ') + error.message, 'error');
      return;
    }
    startContext({ routeSymbol, canonicalSymbol, target, gatewayOrigin, authSecret });
  }

  function restart() {
    stopActive('route_changed');
    if (strategy29Failure === null && strategy29Summary !== null) {
      try { strategy29Summary.restart(); } catch (error) { failStrategy29(error); }
    }
    synchronizeContext();
  }

  const menuDefinitions = [
    { label: () => t('设置 CorsairQuant 网关密钥', 'Set CorsairQuant gateway secret'), run: () => {
      const value = promptUser(t('输入 CorsairQuant 网关密钥。所有远程策略模块共用此配置，仅保存在当前用户脚本私有存储中。', 'Enter the CorsairQuant gateway secret. All remote strategy modules share this private userscript configuration.'));
      if (value === null) return;
      if (value.length === 0) throw new Error(t('CorsairQuant 网关密钥不能为空', 'CorsairQuant gateway secret must not be empty'));
      GM_setValue(GATEWAY_SECRET_KEY, value);
      restart();
    } },
    { label: () => t('设置 CorsairQuant 本机网关地址', 'Set CorsairQuant local gateway URL'), run: () => {
      const current = GM_getValue(GATEWAY_ORIGIN_KEY, DEFAULT_GATEWAY_ORIGIN);
      const value = promptUser(t('输入 SSH 本地转发地址（仅允许 http://127.0.0.1:<端口>）', 'Enter the SSH local forwarding URL (only http://127.0.0.1:<port> is allowed)'), current);
      if (value === null) return;
      GM_setValue(GATEWAY_ORIGIN_KEY, normalizeGatewayBaseUrl(value));
      restart();
    } },
    { label: () => t('清除 Strategy 27 图表标注', 'Clear Strategy 27 chart annotations'), run: () => {
      active?.compound.clear();
      active?.layer.clear();
      active?.panel.clear();
      active?.ordinaryHistory.clear();
      active?.candidatePresentations.clear();
      if (!active?.failed) hideStatus();
    } },
    { label: () => t('重新连接 Strategy 27 并恢复历史', 'Reconnect Strategy 27 and restore history'), run: restart },
  ];
  let menuLocale = null;
  function synchronizeMenus() {
    if (menuLocale === uiLocale) return;
    for (const menu of menuDefinitions) {
      menu.id = GM_registerMenuCommand(menu.label(), menu.run, menuLocale === null ? undefined : { id: menu.id });
    }
    menuLocale = uiLocale;
  }

  const removeRouteListener = installSpaRouteChangeListener(page, synchronizeContext);
  const contextTimer = page.setInterval(synchronizeContext, CONTEXT_CHECK_INTERVAL_MS);
  page.addEventListener('beforeunload', () => {
    page.clearInterval(contextTimer);
    removeRouteListener();
    page.removeEventListener(STRATEGY29_PREFERENCES_EVENT, onStrategy29Preferences);
    pageDocument.removeEventListener('visibilitychange', onSummaryVisibility);
    page.removeEventListener('pagehide', pauseSummary);
    page.removeEventListener('pageshow', onSummaryVisibility);
    if (strategy29Summary !== null) strategy29Summary.dispose();
    stopActive('route_changed');
  }, { once: true });
  synchronizeContext();
})();
