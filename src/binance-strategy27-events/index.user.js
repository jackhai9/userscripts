// ==UserScript==
// @name         【自写】Binance Strategy 27 事件标注
// @namespace    binance.strategy27.events
// @icon         data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%23f0b90b%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2249%22%20text-anchor%3D%22middle%22%20font-family%3D%22Arial%2C%20sans-serif%22%20font-size%3D%2242%22%20font-weight%3D%22800%22%20fill%3D%22%23111827%22%3EJ%3C%2Ftext%3E%3C%2Fsvg%3E
// @icon64       data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%23f0b90b%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2249%22%20text-anchor%3D%22middle%22%20font-family%3D%22Arial%2C%20sans-serif%22%20font-size%3D%2242%22%20font-weight%3D%22800%22%20fill%3D%22%23111827%22%3EJ%3C%2Ftext%3E%3C%2Fsvg%3E
// @version      0.3.1
// @author       jackhai9
// @description  在 Binance 一秒图表标注 VPS Strategy 27 的实时订单流候选观察
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
import { parseFuturesTradingSymbolFromPathname } from '../shared/binance-futures-route.js';
import { installSpaRouteChangeListener } from '../shared/spa-route-change.js';

(function () {
  'use strict';

  const DEFAULT_GATEWAY_ORIGIN = 'http://127.0.0.1:18765';
  const GATEWAY_ORIGIN_KEY = 'strategy27GatewayOrigin';
  const GATEWAY_SECRET_KEY = 'strategy27GatewayAuthSecret';
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

  function stopActive(resetReason) {
    if (!active) return;
    active.controller.abort();
    active.lifecycle.reset(resetReason);
    active.layer.clear();
    active.panel.destroy();
    active = null;
  }

  function showStatus(chartRoot, text, state = 'normal') {
    statusView = ensureStrategy27StatusView(pageDocument, chartRoot);
    setStrategy27Status(statusView, text, state);
  }

  function hideStatus() {
    removeStrategy27StatusView(pageDocument);
    statusView = null;
  }

  async function renderGatewayResponse(context, response) {
    if (active !== context) return;
    for (const eventId of context.lifecycle.prune(Date.now())) {
      context.layer.remove(eventId);
      context.panel.remove(eventId);
      context.candidatePresentations.delete(eventId);
    }
    if (response.status === 'reset') {
      context.lifecycle.reset(response.reason);
      context.layer.clear();
      context.panel.clear();
      context.candidatePresentations.clear();
      hideStatus();
      return;
    }

    for (const message of response.messages) {
      const action = context.lifecycle.apply(message);
      for (const eventId of action.evictedEventIds ?? []) {
        context.layer.remove(eventId);
        context.panel.remove(eventId);
        context.candidatePresentations.delete(eventId);
      }
      if (action.type === 'stream_reset') {
        context.layer.clear();
        context.panel.clear();
        context.candidatePresentations.clear();
        hideStatus();
        continue;
      }
      if (action.type === 'event_evicted') continue;
      const annotation = stabilizeCandidatePresentation(
        context.candidatePresentations,
        action.eventId,
        buildEventAnnotation({
          event: action.event,
          rehydrated: action.rehydrated,
        }),
      );
      const renderMethod = {
        event_opened: 'renderOpened',
        event_updated: 'renderUpdated',
        event_closed: 'renderClosed',
        event_outcome: 'renderOutcome',
      }[action.messageKind];
      const rendered = await context.layer[renderMethod](action.eventId, annotation, action.observedAtMs);
      if (!rendered || active !== context) continue;
      context.panel.upsert(action.eventId, annotation, action.observedAtMs);
      hideStatus();
    }
  }

  function startContext({ routeSymbol, canonicalSymbol, target, gatewayOrigin, authSecret }) {
    const context = {
      signature: `${routeSymbol}|${target.resolution}`,
      routeSymbol,
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
        maxEvents: MAX_PANEL_EVENTS,
        loadPosition: () => GM_getValue(PANEL_POSITION_KEY, null),
        savePosition: (position) => GM_setValue(PANEL_POSITION_KEY, position),
      }),
      candidatePresentations: new Map(),
      failed: false,
    };
    active = context;
    showStatus(target.chartRoot, 'Strategy 27 正在连接');
    const client = createLiveEventClient({
      request,
      gatewayBaseUrl: gatewayOrigin,
      authSecret,
      canonicalSymbol,
      onConnectionStateChange: (state) => {
        if (active !== context) return;
        if (state === 'reconnecting') {
          showStatus(context.target.chartRoot, 'Strategy 27 网关连接中断，正在重连', 'inactive');
        } else {
          hideStatus();
        }
      },
      onResponse: (response) => renderGatewayResponse(context, response),
    });
    client.run(context.controller.signal).catch((error) => {
      if (error.name === 'AbortError' || active !== context) return;
      context.failed = true;
      context.layer.clear();
      context.panel.clear();
      showStatus(target.chartRoot, `Strategy 27 已停止：${error.message}`, 'error');
    });
  }

  function synchronizeContext() {
    const routeSymbol = parseFuturesTradingSymbolFromPathname(page.location.pathname);
    if (!routeSymbol) {
      stopActive('route_changed');
      removeStrategy27StatusView(pageDocument);
      statusView = null;
      return;
    }

    const chartRoot = findStrategy27ChartRoot(pageDocument);
    if (!chartRoot) return;
    let canonicalSymbol;
    try {
      canonicalSymbol = routeSymbolToCanonical(routeSymbol);
      if (canonicalSymbolToRoute(canonicalSymbol) !== routeSymbol) {
        throw new Error('Binance route symbol does not round-trip');
      }
    } catch (error) {
      stopActive('route_changed');
      showStatus(chartRoot, `Strategy 27 已停止：${error.message}`, 'error');
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
        inactive ? 'Strategy 27 仅在 1 秒图表启用' : `Strategy 27 已停止：${error.message}`,
        inactive ? 'inactive' : 'error',
      );
      return;
    }
    if (!target) {
      stopActive('interval_changed');
      showStatus(chartRoot, 'Strategy 27 正在等待图表接口', 'inactive');
      return;
    }

    if (
      active
      && active.routeSymbol === routeSymbol
      && active.target.chart === target.chart
      && active.target.chartRoot === target.chartRoot
    ) {
      return;
    }
    stopActive('route_changed');

    const authSecret = GM_getValue(GATEWAY_SECRET_KEY, '');
    if (typeof authSecret !== 'string' || authSecret.length === 0) {
      showStatus(chartRoot, 'Strategy 27 未配置网关密钥（请使用油猴菜单设置）', 'inactive');
      return;
    }
    let gatewayOrigin;
    try {
      gatewayOrigin = normalizeGatewayBaseUrl(GM_getValue(GATEWAY_ORIGIN_KEY, DEFAULT_GATEWAY_ORIGIN));
    } catch (error) {
      showStatus(chartRoot, `Strategy 27 已停止：${error.message}`, 'error');
      return;
    }
    startContext({ routeSymbol, canonicalSymbol, target, gatewayOrigin, authSecret });
  }

  function restart() {
    stopActive('route_changed');
    synchronizeContext();
  }

  GM_registerMenuCommand('设置 Strategy 27 网关密钥', () => {
    const value = page.prompt('输入本机 Strategy 27 网关密钥。该值只保存在此油猴脚本的私有存储中。');
    if (value === null) return;
    if (value.length === 0) throw new Error('Strategy 27 网关密钥不能为空');
    GM_setValue(GATEWAY_SECRET_KEY, value);
    restart();
  });
  GM_registerMenuCommand('设置 Strategy 27 本机网关地址', () => {
    const current = GM_getValue(GATEWAY_ORIGIN_KEY, DEFAULT_GATEWAY_ORIGIN);
    const value = page.prompt('输入 SSH 本地转发地址（仅允许 http://127.0.0.1:<端口>）', current);
    if (value === null) return;
    GM_setValue(GATEWAY_ORIGIN_KEY, normalizeGatewayBaseUrl(value));
    restart();
  });
  GM_registerMenuCommand('清除 Strategy 27 图表标注', () => {
    active?.layer.clear();
    active?.panel.clear();
    hideStatus();
  });

  const removeRouteListener = installSpaRouteChangeListener(page, restart);
  const contextTimer = page.setInterval(synchronizeContext, CONTEXT_CHECK_INTERVAL_MS);
  page.addEventListener('beforeunload', () => {
    page.clearInterval(contextTimer);
    removeRouteListener();
    stopActive('route_changed');
  }, { once: true });
  synchronizeContext();
})();
