// ==UserScript==
// @name         【自写】Binance 合约交易数据面板
// @namespace    binance.trading.data
// @icon         data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%23f0b90b%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2249%22%20text-anchor%3D%22middle%22%20font-family%3D%22Arial%2C%20sans-serif%22%20font-size%3D%2242%22%20font-weight%3D%22800%22%20fill%3D%22%23111827%22%3EJ%3C%2Ftext%3E%3C%2Fsvg%3E
// @icon64       data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%23f0b90b%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2249%22%20text-anchor%3D%22middle%22%20font-family%3D%22Arial%2C%20sans-serif%22%20font-size%3D%2242%22%20font-weight%3D%22800%22%20fill%3D%22%23111827%22%3EJ%3C%2Ftext%3E%3C%2Fsvg%3E
// @version      1.2.0
// @author       jackhai9
// @description  Bilingual futures metrics with historical trends, current funding, settlement countdown, and indicator signals.
// @match        https://www.binance.com/*/futures/*
// @match        https://www.binance.com/futures/*
// @exclude      https://www.binance.com/*/my/wallet/futures/*
// @exclude      https://www.binance.com/my/wallet/futures/*
// @updateURL    https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-trading-data.user.js
// @downloadURL  https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-trading-data.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

import {
  isFuturesTradingPathname,
  parseFuturesTradingSymbolFromPathname,
} from '../shared/binance-futures-route.js';
import {
  ensureSpaRouteChangePatched,
  installSpaRouteChangeListener,
} from '../shared/spa-route-change.js';
import { resolveUiLocaleFromPathname } from '../binance-orderbook-trade/contracts/panel-copy.js';
import { computeTradingSignals, parseCurrentFunding, parseFundingInterval, parseHistory } from './market-data.js';
import { createTradingDataView } from './panel-view.js';
import { calculateDataPanelLayout, DATA_PANEL_LAYOUT_EVENT, hasVisibleDataPanelPeer } from '../shared/data-panel-layout.js';

(function () {
  'use strict';

  function isFuturesTradingPage() {
    return isFuturesTradingPathname(location.pathname);
  }

  /* ========== 常量 & 配置 ========== */

  const PREFIX = '[交易数据]';
  const PANEL_ID = 'jh-binance-trading-data-panel';
  const STORAGE_POS_KEY = 'jh_binance_trading_data_pos';
  const STORAGE_COLLAPSED_KEY = 'jh_binance_trading_data_collapsed';
  const PANEL_WIDTH = 480;
  const DEBUG = false;

  const PERIOD_MS = 5 * 60 * 1000;  // 数据周期 5 分钟
  const FIRST_DELAY = 5_000;         // 周期边界后首次等待 5s
  const RETRY_DELAYS = [10_000, 15_000, 20_000]; // 后续重试间隔，用完后按 30s 循环
  const RETRY_FALLBACK = 30_000;
  const ROUTE_WATCHDOG_MS = 5_000;
  const DEFAULT_PERIOD = '5m';
  const DATA_LIMIT = 30;
  const FUNDING_HISTORY_LIMIT = 40;
  const CURRENT_FUNDING_REFRESH_MS = 15_000;
  const FUNDING_REQUEST_TIMEOUT_MS = 10_000;
  const CLOCK_REQUEST_TIMEOUT_MS = 5_000;
  const CLOCK_MAX_ROUND_TRIP_MS = 2_000;

  const API_BASE = 'https://www.binance.com';
  const API_PATHS = {
    openInterest:       '/futures/data/openInterestHist',
    topAccountRatio:    '/futures/data/topLongShortAccountRatio',
    topPositionRatio:   '/futures/data/topLongShortPositionRatio',
    globalAccountRatio: '/futures/data/globalLongShortAccountRatio',
    takerRatio:         '/futures/data/takerlongshortRatio',
    basis:              '/futures/data/basis',
    fundingRate:        '/fapi/v1/fundingRate',
    currentFunding:     '/fapi/v1/premiumIndex',
    fundingInterval:    '/fapi/v1/fundingInfo',
    serverTime:         '/fapi/v1/time',
  };

  // 参与 5 分钟周期重试的接口（不含 fundingRate）
  const PERIOD_KEYS = ['openInterest', 'topAccountRatio', 'topPositionRatio', 'globalAccountRatio', 'takerRatio', 'basis'];

  /* ========== 日志 ========== */

  // Binance 屏蔽了 console.log/warn/info/debug，只能用 console.error
  function emit(level, ...args) {
    if (!DEBUG && level !== 'ERR') return;
    console.error(PREFIX, `[${level}]`, ...args);
  }
  function log(...args) { emit('LOG', ...args); }
  function err(...args) { emit('ERR', ...args); }

  /* ========== Symbol 检测 ========== */

  let lastSymbol = null;

  function getCurrentSymbol() {
    return parseFuturesTradingSymbolFromPathname(location.pathname);
  }

  function isActiveTradingPage() {
    return !panelClosed && !document.hidden && isFuturesTradingPage();
  }

  /* ========== API 层 ========== */

  async function fetchJson(path, params, signal) {
    const url = new URL(path, API_BASE);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const href = url.toString();
    try {
      const resp = await fetch(href, { signal });
      if (!resp.ok) throw Object.assign(new Error(`HTTP ${resp.status}`), { status: resp.status });
      return await resp.json();
    } catch (e1) {
      if (signal?.aborted) throw e1;
      // 4xx 是确定性失败（参数错误、限流），不重试
      if (e1.status && e1.status >= 400 && e1.status < 500) throw e1;
      // 网络错误或 5xx，重试一次
      log('重试:', path);
      const resp = await fetch(href, { signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status} (retry)`);
      return await resp.json();
    }
  }

  function fetchOpenInterest(symbol) {
    return fetchJson(API_PATHS.openInterest, { symbol, period: DEFAULT_PERIOD, limit: DATA_LIMIT });
  }
  function fetchTopAccountRatio(symbol) {
    return fetchJson(API_PATHS.topAccountRatio, { symbol, period: DEFAULT_PERIOD, limit: DATA_LIMIT });
  }
  function fetchTopPositionRatio(symbol) {
    return fetchJson(API_PATHS.topPositionRatio, { symbol, period: DEFAULT_PERIOD, limit: DATA_LIMIT });
  }
  function fetchGlobalAccountRatio(symbol) {
    return fetchJson(API_PATHS.globalAccountRatio, { symbol, period: DEFAULT_PERIOD, limit: DATA_LIMIT });
  }
  function fetchTakerRatio(symbol) {
    return fetchJson(API_PATHS.takerRatio, { symbol, period: DEFAULT_PERIOD, limit: DATA_LIMIT });
  }
  function fetchBasis(symbol) {
    return fetchJson(API_PATHS.basis, { pair: symbol, period: DEFAULT_PERIOD, limit: DATA_LIMIT, contractType: 'PERPETUAL' });
  }
  function fetchFundingRate(symbol) {
    return fetchJson(API_PATHS.fundingRate, { symbol, limit: FUNDING_HISTORY_LIMIT });
  }

  // key -> fetcher 映射
  const FETCHER_MAP = {
    openInterest:       fetchOpenInterest,
    topAccountRatio:    fetchTopAccountRatio,
    topPositionRatio:   fetchTopPositionRatio,
    globalAccountRatio: fetchGlobalAccountRatio,
    takerRatio:         fetchTakerRatio,
    basis:              fetchBasis,
  };

  /* ========== 服务器时间 ========== */

  let serverOffset = 0; // serverTime - localTime
  let clockCalibrated = false;
  let sessionGeneration = 0;
  let clockRequestId = 0;
  let serverTimeRequest = null;

  function currentSession() {
    return { generation: sessionGeneration, path: location.pathname, symbol: getCurrentSymbol() };
  }

  function sessionIsCurrent(session) {
    return session.generation === sessionGeneration
      && session.path === location.pathname
      && session.symbol === getCurrentSymbol()
      && isActiveTradingPage();
  }

  async function syncServerTime(session) {
    const requestId = ++clockRequestId;
    const startedAt = Date.now();
    const request = { controller: new AbortController(), timeout: null };
    serverTimeRequest = request;
    request.timeout = setTimeout(function () {
      request.controller.abort(new DOMException('Server time request timed out', 'TimeoutError'));
    }, CLOCK_REQUEST_TIMEOUT_MS);
    try {
      const resp = await fetch(API_BASE + API_PATHS.serverTime, { signal: request.controller.signal });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const json = await resp.json();
      if (!Number.isSafeInteger(json.serverTime) || json.serverTime <= 0) throw new TypeError('Invalid server time');
      if (!sessionIsCurrent(session) || requestId !== clockRequestId) return;
      const receivedAt = Date.now();
      const roundTrip = receivedAt - startedAt;
      if (roundTrip < 0 || roundTrip > CLOCK_MAX_ROUND_TRIP_MS) throw new Error('Server time round trip exceeded the calibration limit');
      // The midpoint bounds network transit error; slow samples cannot certify a countdown.
      serverOffset = json.serverTime - (startedAt + receivedAt) / 2;
      clockCalibrated = true;
      log('服务器时间偏移:', serverOffset + 'ms');
    } catch (e) {
      if (!sessionIsCurrent(session) || requestId !== clockRequestId) return;
      err('获取服务器时间失败，使用本地时间', e.message);
      serverOffset = 0;
      clockCalibrated = false;
    } finally {
      clearTimeout(request.timeout);
      if (serverTimeRequest === request) serverTimeRequest = null;
    }
  }

  function serverNow() {
    return Date.now() + serverOffset;
  }

  /* ========== 数据存储 ========== */

  let dataStore = {};   // symbol -> { key: responseData } 当前展示用
  let dataCache = {};   // symbol -> { key: responseData } 失败回退用
  let failedKeys = new Set(); // 当前使用回退缓存的 key
  let endpointErrors = {};
  const historyUpdatedAt = {};

  // 提取接口返回的最新数据点时间戳
  function extractEndpointTs(data) {
    if (!Array.isArray(data) || data.length === 0) return 0;
    return Number(data[data.length - 1].timestamp) || 0;
  }

  // 纯函数：拉取指定 5m 接口，返回结果但不写全局状态
  async function fetchPeriodData(symbol, keys) {
    if (!keys || keys.length === 0) return {};
    var fetchers = keys.map(async function (k) { return parseHistory(k, await FETCHER_MAP[k](symbol), symbol); });
    var results = await Promise.allSettled(fetchers);
    var backup = dataCache[symbol] || {};
    var entries = {};

    keys.forEach(function (key, i) {
      if (results[i].status === 'fulfilled') {
        entries[key] = { data: results[i].value, cached: false, error: null };
      } else {
        err(key + ' 请求失败:', results[i].reason?.message || results[i].reason);
        if (backup[key]) {
          entries[key] = { data: backup[key], cached: true, error: String(results[i].reason?.message || results[i].reason) };
          log(key + ' 使用缓存数据');
        } else {
          entries[key] = { data: null, cached: true, error: String(results[i].reason?.message || results[i].reason) };
        }
      }
    });
    return entries;
  }

  // 纯函数：拉取 fundingRate
  async function fetchFundingRateData(symbol) {
    var backup = dataCache[symbol] || {};
    try {
      var data = parseHistory('fundingRate', await fetchFundingRate(symbol), symbol);
      return { data: data, cached: false, error: null };
    } catch (e) {
      err('fundingRate 请求失败:', e);
      return { data: backup.fundingRate || null, cached: true, error: String(e.message || e) };
    }
  }

  // 将 fetch 结果写入全局状态（仅在 epoch 校验通过后调用）
  function applyResults(symbol, periodEntries, fundingEntry) {
    if (!dataStore[symbol]) dataStore[symbol] = {};
    if (!dataCache[symbol]) dataCache[symbol] = {};

    if (periodEntries) {
      for (var key in periodEntries) {
        var e = periodEntries[key];
        dataStore[symbol][key] = e.data;
        endpointErrors[key] = e.error;
        if (!e.cached) {
          dataCache[symbol][key] = e.data;
          failedKeys.delete(key);
        } else {
          failedKeys.add(key);
        }
      }
    }

    if (fundingEntry) {
      dataStore[symbol].fundingRate = fundingEntry.data;
      endpointErrors.fundingRate = fundingEntry.error;
      if (!fundingEntry.cached) {
        dataCache[symbol].fundingRate = fundingEntry.data;
        failedKeys.delete('fundingRate');
      } else {
        failedKeys.add('fundingRate');
      }
    }
    const freshHistory = (periodEntries && Object.values(periodEntries).some(entry => !entry.cached))
      || (fundingEntry && !fundingEntry.cached);
    if (freshHistory) historyUpdatedAt[symbol] = Date.now();
    lastUpdateTs = historyUpdatedAt[symbol] || 0;
  }

  // 哪些 5m 接口的最新数据时间戳还没到 targetTs
  function getPendingKeys(symbol, targetTs) {
    var store = dataStore[symbol] || {};
    return PERIOD_KEYS.filter(function (key) {
      return extractEndpointTs(store[key]) < targetTs;
    });
  }

  /* ========== Panel presentation ========== */

  let panelView = null;

  function uiLocale() {
    return resolveUiLocaleFromPathname(location.pathname);
  }

  function fundingClock() {
    return { now: serverNow(), calibrated: clockCalibrated, localNow: Date.now() };
  }

  function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;
    panel = document.createElement('section');
    panel.id = PANEL_ID;
    Object.assign(panel.style, { position: 'fixed', top: '60px', right: '16px', zIndex: '999998' });
    document.body.appendChild(panel);
    panelView = createTradingDataView({
      document, panel, locale: uiLocale(), collapsed: loadCollapsed(),
      onCollapse(collapsed) {
        saveCollapsed(collapsed);
        keepPanelInViewport(panel);
      },
      onClose() {
        panel.style.display = 'none';
        panelClosed = true;
        stopLoop();
        cleanupPanelDrag();
        panelView.destroy();
        window.dispatchEvent(new CustomEvent(DATA_PANEL_LAYOUT_EVENT));
      },
    });
    keepPanelInViewport(panel);
    cleanupPanelDrag();
    dragCleanup = setupDrag(panel);
    window.dispatchEvent(new CustomEvent(DATA_PANEL_LAYOUT_EVENT));
    return panel;
  }

  function renderPanel(result, symbol) {
    if (!isActiveTradingPage() || getCurrentSymbol() !== symbol) return;
    const panel = ensurePanel();
    panelView.setLocale(uiLocale());
    panelView.render(result);
    panelView.setFunding(currentFundingState, fundingClock());
    const footer = panel.querySelector('#' + PANEL_ID + '-footer');
    if (footer) updateFooter(footer);
  }

  /** Funding updates and clock ticks must not refresh the historical data timestamp. */
  function startDisplayClock() {
    if (agoTimer) return;
    agoTimer = setInterval(function () {
      if (!isActiveTradingPage() || !panelView) return;
      const footer = document.getElementById(PANEL_ID + '-footer');
      if (footer) updateFooter(footer);
      panelView.updateClock(fundingClock());
    }, 1000);
  }

  function updateFooter(el) {
    const locale = uiLocale();
    let updatedText = locale === 'zh-CN' ? '等待数据' : 'Waiting for data';
    let elapsedText = '';
    if (lastUpdateTs) {
      const clock = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(lastUpdateTs);
      const ago = Math.max(0, Math.floor((Date.now() - lastUpdateTs) / 1000));
      updatedText = (locale === 'zh-CN' ? '更新于 ' : 'Updated ') + clock;
      elapsedText = locale === 'zh-CN' ? ago + '秒前' : ago + 's ago';
    }
    const updated = el.querySelector('[data-role="updated-at"]');
    const elapsed = el.querySelector('[data-role="elapsed"]');
    if (updated.textContent !== updatedText) updated.textContent = updatedText;
    if (elapsed.textContent !== elapsedText) elapsed.textContent = elapsedText;
  }

  /* ========== Current funding feed ========== */

  let currentFundingTimer = null;
  let currentFundingRequest = null;
  let fundingIntervalRequest = null;
  let currentFundingState = emptyCurrentFundingState(null);

  function emptyCurrentFundingState(symbol) {
    const interval = symbol ? dataCache[symbol]?.fundingInterval : null;
    return {
      current: null, intervalHours: interval ?? null, receivedAt: null,
      cached: false, error: null, intervalCached: interval !== undefined && interval !== null,
      intervalError: null,
    };
  }

  async function refreshCurrentFunding(session) {
    if (!sessionIsCurrent(session) || currentFundingRequest) return;
    const request = { controller: new AbortController(), timeout: null };
    currentFundingRequest = request;
    request.timeout = setTimeout(function () {
      request.controller.abort(new DOMException('Funding request timed out', 'TimeoutError'));
    }, FUNDING_REQUEST_TIMEOUT_MS);
    try {
      const payload = await fetchJson(API_PATHS.currentFunding, { symbol: session.symbol }, request.controller.signal);
      const current = parseCurrentFunding(payload, session.symbol);
      if (!sessionIsCurrent(session) || currentFundingRequest !== request) return;
      currentFundingState = { ...currentFundingState, current, receivedAt: Date.now(), cached: false, error: null };
    } catch (error) {
      if (!sessionIsCurrent(session) || currentFundingRequest !== request) return;
      currentFundingState = { ...currentFundingState, cached: currentFundingState.current !== null, error: String(error.message || error) };
      err('Current funding request failed:', error.message);
    } finally {
      clearTimeout(request.timeout);
      if (sessionIsCurrent(session) && currentFundingRequest === request) {
        currentFundingRequest = null;
        panelView.setFunding(currentFundingState, fundingClock());
        currentFundingTimer = setTimeout(function () {
          refreshCurrentFunding(session);
        }, CURRENT_FUNDING_REFRESH_MS);
      }
    }
  }

  /** Optional interval metadata publishes independently and cannot delay historical data. */
  async function refreshFundingInterval(session) {
    if (!sessionIsCurrent(session) || fundingIntervalRequest) return;
    const request = { controller: new AbortController(), timeout: null };
    fundingIntervalRequest = request;
    request.timeout = setTimeout(function () {
      request.controller.abort(new DOMException('Funding interval request timed out', 'TimeoutError'));
    }, FUNDING_REQUEST_TIMEOUT_MS);
    try {
      const payload = await fetchJson(API_PATHS.fundingInterval, {}, request.controller.signal);
      const intervalHours = parseFundingInterval(payload, session.symbol);
      if (!sessionIsCurrent(session) || fundingIntervalRequest !== request) return;
      if (!dataCache[session.symbol]) dataCache[session.symbol] = {};
      dataCache[session.symbol].fundingInterval = intervalHours;
      currentFundingState = { ...currentFundingState, intervalHours, intervalCached: false, intervalError: null };
    } catch (error) {
      if (!sessionIsCurrent(session) || fundingIntervalRequest !== request) return;
      const intervalHours = dataCache[session.symbol]?.fundingInterval ?? null;
      currentFundingState = { ...currentFundingState, intervalHours, intervalCached: intervalHours !== null, intervalError: String(error.message || error) };
      err('Funding interval request failed:', error.message);
    } finally {
      clearTimeout(request.timeout);
      if (sessionIsCurrent(session) && fundingIntervalRequest === request) {
        fundingIntervalRequest = null;
        panelView.setFunding(currentFundingState, fundingClock());
      }
    }
  }

  /* ========== 拖拽 ========== */

  function setupDrag(panel) {
    const header = panel.querySelector('#' + PANEL_ID + '-header');
    if (!header) return null;

    let dragging = false, startX, startY, startLeft, startTop;
    const cancelDrag = function () {
      if (!dragging) return;
      dragging = false;
      keepPanelInViewport(panel);
    };
    const onResize = function () {
      dragging = false;
      keepPanelInViewport(panel);
    };

    const onMouseDown = function (e) {
      if (e.button !== 0 || e.target.closest('button,a')) return;
      dragging = true;
      const rect = panel.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      e.preventDefault();
    };

    const onMouseMove = function (e) {
      if (!dragging) return;
      if ((e.buttons & 1) === 0) {
        cancelDrag();
        return;
      }
      const newLeft = Math.max(0, Math.min(startLeft + (e.clientX - startX), window.innerWidth - panel.offsetWidth));
      const newTop  = Math.max(0, Math.min(startTop + (e.clientY - startY), window.innerHeight - panel.offsetHeight));
      panel.style.left  = newLeft + 'px';
      panel.style.top   = newTop + 'px';
      panel.style.right = 'auto';
    };

    const onMouseUp = function (e) {
      if (!dragging || e.button !== 0) return;
      dragging = false;
      const rect = panel.getBoundingClientRect();
      if (rect.left !== startLeft || rect.top !== startTop) savePanelPosition(panel);
    };

    header.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    window.addEventListener('blur', cancelDrag);
    window.addEventListener('resize', onResize);
    window.addEventListener(DATA_PANEL_LAYOUT_EVENT, onResize);

    return function cleanupDrag() {
      dragging = false;
      header.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('blur', cancelDrag);
      window.removeEventListener('resize', onResize);
      window.removeEventListener(DATA_PANEL_LAYOUT_EVENT, onResize);
    };
  }

  function clampNumber(value, min, max) {
    return Math.max(min, Math.min(value, max));
  }

  function normalizeSavedPosition(pos, panelWidth) {
    if (!pos || !Number.isFinite(pos.left) || !Number.isFinite(pos.top)) return null;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || panelWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 80;
    return {
      left: clampNumber(pos.left, 0, Math.max(0, viewportWidth - panelWidth)),
      top: clampNumber(pos.top, 0, Math.max(0, viewportHeight - 48)),
    };
  }

  /** Project the saved preference without letting smaller windows overwrite it. */
  function keepPanelInViewport(panel) {
    const width = panel.offsetWidth || PANEL_WIDTH;
    const normalized = calculateDataPanelLayout({
      kind: 'trading', panelWidth: width,
      viewportWidth: window.innerWidth || document.documentElement.clientWidth || width,
      viewportHeight: window.innerHeight || document.documentElement.clientHeight || 80,
      savedPosition: normalizeSavedPosition(loadPosition(), width),
      hasPeer: hasVisibleDataPanelPeer(document, 'trading'),
    });
    panel.style.left = normalized.left + 'px';
    panel.style.top = normalized.top + 'px';
    panel.style.maxHeight = normalized.maxHeight + 'px';
    panel.style.right = 'auto';
  }

  function savePanelPosition(panel) {
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const normalized = normalizeSavedPosition({ left: rect.left, top: rect.top }, panel.offsetWidth || PANEL_WIDTH);
    if (!normalized) return;
    savePosition(normalized.left, normalized.top);
    keepPanelInViewport(panel);
  }

  /* ========== localStorage ========== */

  function loadPosition() {
    try {
      const raw = localStorage.getItem(STORAGE_POS_KEY);
      if (!raw) return null;
      const pos = JSON.parse(raw);
      if (typeof pos.left === 'number' && typeof pos.top === 'number') return pos;
    } catch (_) { /* ignore */ }
    return null;
  }

  function savePosition(left, top) {
    if (!Number.isFinite(left) || !Number.isFinite(top)) return;
    localStorage.setItem(STORAGE_POS_KEY, JSON.stringify({ left: left, top: top }));
  }

  function loadCollapsed() {
    return localStorage.getItem(STORAGE_COLLAPSED_KEY) === '1';
  }

  function saveCollapsed(collapsed) {
    localStorage.setItem(STORAGE_COLLAPSED_KEY, collapsed ? '1' : '0');
  }

  /* ========== 主循环 ========== */

  let cycleTimer = null;
  let retryTimer = null;
  let pathTimer = null;
  let removeSpaRouteChangeListener = null;
  let agoTimer = null;
  let serverTimeTimer = null;
  let dragCleanup = null;
  let panelClosed = false;
  let lastUpdateTs = 0;
  let fetching = 0; // 0=空闲, 非零=正在拉取的 epoch
  let epoch = 0; // 递增计数器，用于作废过期的异步回调
  let lastPath = location.pathname;

  function renderAll(symbol) {
    if (!isActiveTradingPage() || getCurrentSymbol() !== symbol) return;
    var data = dataStore[symbol] || {};
    var result = computeTradingSignals(data, failedKeys, uiLocale(), symbol, endpointErrors);
    renderPanel(result, symbol);
  }

  // 首次全量拉取（启动 / 切交易对 / tab 恢复）
  async function initialFetch(symbol) {
    // 作废所有正在进行的异步操作
    epoch++;
    var myEpoch = epoch;
    clearTimeout(cycleTimer);
    clearTimeout(retryTimer);

    if (symbol !== lastSymbol) {
      lastSymbol = symbol;
      log('交易对:', symbol);
    }
    fetching = myEpoch;
    try {
      var history = Promise.all([
        fetchPeriodData(symbol, PERIOD_KEYS),
        fetchFundingRateData(symbol),
      ]);
      refreshFundingInterval(currentSession());
      var [periodEntries, fundingEntry] = await history;
      if (epoch !== myEpoch || !isActiveTradingPage() || getCurrentSymbol() !== symbol) return; // 已被更新的调用取代
      applyResults(symbol, periodEntries, fundingEntry);
      renderAll(symbol);
    } catch (e) { err('拉取失败:', e); }
    finally { if (fetching === myEpoch) fetching = 0; }
  }

  // boundary = 刚过去的 5 分钟边界（floor）
  // targetTs = boundary = Binance 数据 timestamp 推进到关闭边界
  // 重试窗口 = boundary ~ boundary + PERIOD_MS

  function scheduleCycle(forceNext) {
    clearTimeout(cycleTimer);
    clearTimeout(retryTimer);
    cycleTimer = null;
    retryTimer = null;

    if (panelClosed || document.hidden) return;
    if (!isFuturesTradingPage()) {
      pauseForNonTradingPage();
      return;
    }

    var now = serverNow();
    var boundary = Math.floor(now / PERIOD_MS) * PERIOD_MS;

    if (!forceNext) {
      var targetTs = boundary;
      var symbol = getCurrentSymbol();
      var pending = symbol ? getPendingKeys(symbol, targetTs) : [];

      if (pending.length > 0 && now < boundary + PERIOD_MS) {
        // 当前周期还有数据没拿到，异步进入重试
        var delay = Math.max(0, boundary + FIRST_DELAY - now);
        cycleTimer = setTimeout(function () {
          runCycleAttempt(boundary, 0);
        }, delay);
        return;
      }
    }

    // 当前周期已完成 / 被强制跳过，调度下一个周期
    var nextBound = boundary + PERIOD_MS;
    var delay = Math.max(0, nextBound - now + FIRST_DELAY);
    log('下次拉取:', new Date(nextBound + FIRST_DELAY - serverOffset).toLocaleTimeString());

    cycleTimer = setTimeout(function () {
      runCycleAttempt(nextBound, 0);
    }, delay);
  }

  async function runCycleAttempt(boundary, attempt) {
    if (document.hidden || panelClosed) return;
    if (!isFuturesTradingPage()) {
      pauseForNonTradingPage();
      return;
    }
    if (fetching) return;

    var symbol = getCurrentSymbol();
    if (!symbol) { scheduleCycle(true); return; }

    if (symbol !== lastSymbol) {
      lastSymbol = symbol;
      failedKeys = new Set();
      log('交易对:', symbol);
    }

    var targetTs = boundary;
    var myEpoch = ++epoch;

    fetching = myEpoch;
    try {
      var periodEntries, fundingEntry;
      if (attempt === 0) {
        var history = Promise.all([
          fetchPeriodData(symbol, PERIOD_KEYS),
          fetchFundingRateData(symbol),
        ]);
        refreshFundingInterval(currentSession());
        [periodEntries, fundingEntry] = await history;
      } else {
        var pending = getPendingKeys(symbol, targetTs);
        if (pending.length === 0) {
          log('所有 5m 接口已更新');
          renderAll(symbol);
          scheduleCycle();
          return;
        }
        periodEntries = await fetchPeriodData(symbol, pending);
      }

      // await 返回后检查：是否已被 initialFetch 取代
      if (epoch !== myEpoch || !isActiveTradingPage() || getCurrentSymbol() !== symbol) return;

      applyResults(symbol, periodEntries, fundingEntry || null);
      renderAll(symbol);

      var stillPending = getPendingKeys(symbol, targetTs);

      if (stillPending.length === 0) {
        log('所有 5m 接口已更新');
        scheduleCycle();
        return;
      }

      // 计算重试间隔
      var retryDelay = attempt < RETRY_DELAYS.length ? RETRY_DELAYS[attempt] : RETRY_FALLBACK;
      var retryTime = serverNow() + retryDelay;
      var cycleEnd = boundary + PERIOD_MS;

      if (retryTime >= cycleEnd) {
        log('本周期时间用完，待更新:', stillPending.join(', '));
        scheduleCycle(true);
        return;
      }

      log(stillPending.length + ' 个接口未更新，' + (retryDelay / 1000) + '秒后重试:', stillPending.join(', '));
      retryTimer = setTimeout(function () {
        runCycleAttempt(boundary, attempt + 1);
      }, retryDelay);
    } catch (e) {
      err('数据拉取失败:', e);
      scheduleCycle();
    } finally {
      if (fetching === myEpoch) fetching = 0;
    }
  }

  function stopBusinessLoop() {
    clearTimeout(cycleTimer);  cycleTimer = null;
    clearTimeout(retryTimer);  retryTimer = null;
    if (agoTimer)  { clearInterval(agoTimer);  agoTimer = null; }
    if (serverTimeTimer) { clearInterval(serverTimeTimer); serverTimeTimer = null; }
    if (serverTimeRequest) {
      clearTimeout(serverTimeRequest.timeout);
      serverTimeRequest.controller.abort();
      serverTimeRequest = null;
    }
    clearTimeout(currentFundingTimer); currentFundingTimer = null;
    if (currentFundingRequest) {
      clearTimeout(currentFundingRequest.timeout);
      currentFundingRequest.controller.abort();
      currentFundingRequest = null;
    }
    if (fundingIntervalRequest) {
      clearTimeout(fundingIntervalRequest.timeout);
      fundingIntervalRequest.controller.abort();
      fundingIntervalRequest = null;
    }
    clockCalibrated = false;
  }

  function startServerTimeLoop() {
    if (serverTimeTimer) return;
    serverTimeTimer = setInterval(function () {
      if (isActiveTradingPage()) syncServerTime(currentSession());
    }, 60 * 60 * 1000);
  }

  function stopRouteWatcher() {
    if (pathTimer) { clearInterval(pathTimer); pathTimer = null; }
    if (removeSpaRouteChangeListener) {
      removeSpaRouteChangeListener();
      removeSpaRouteChangeListener = null;
    }
  }

  function stopLoop() {
    sessionGeneration++;
    epoch++;
    stopBusinessLoop();
    stopRouteWatcher();
  }

  function cleanupPanelDrag() {
    if (!dragCleanup) return;
    dragCleanup();
    dragCleanup = null;
  }

  function removePanel() {
    cleanupPanelDrag();
    if (panelView) panelView.destroy();
    panelView = null;
    var panel = document.getElementById(PANEL_ID);
    if (panel) {
      panel.remove();
      window.dispatchEvent(new CustomEvent(DATA_PANEL_LAYOUT_EVENT));
    }
  }

  function pauseForNonTradingPage() {
    sessionGeneration++;
    epoch++;
    stopBusinessLoop();
    lastSymbol = null;
    removePanel();
  }

  async function activateTradingPage() {
    if (!isActiveTradingPage()) return;
    sessionGeneration++;
    epoch++;
    stopBusinessLoop();
    fetching = 0;
    const session = currentSession();
    const symbol = session.symbol;
    if (!symbol) return;
    failedKeys = new Set([...PERIOD_KEYS, 'fundingRate']);
    endpointErrors = {};
    currentFundingState = emptyCurrentFundingState(symbol);
    lastUpdateTs = historyUpdatedAt[symbol] || 0;
    ensurePanel();
    renderAll(symbol);
    await syncServerTime(session);
    if (!sessionIsCurrent(session)) return;
    startServerTimeLoop();
    startDisplayClock();
    refreshCurrentFunding(session);
    await initialFetch(symbol);
    if (!sessionIsCurrent(session)) return;
    scheduleCycle();
  }

  function handlePathChange() {
    if (document.hidden || panelClosed) return;
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    if (!isFuturesTradingPage()) {
      pauseForNonTradingPage();
      return;
    }
    activateTradingPage();
  }

  function startRouteWatcher() {
    if (document.hidden || panelClosed) return;
    lastPath = location.pathname;
    if (!removeSpaRouteChangeListener) {
      removeSpaRouteChangeListener = installSpaRouteChangeListener(window, handlePathChange);
    }
    if (!pathTimer) {
      pathTimer = setInterval(function () {
        ensureSpaRouteChangePatched(window);
        handlePathChange();
      }, ROUTE_WATCHDOG_MS);
    }
  }

  function start() {
    log('脚本启动');

    // tab 恢复时：重同步服务器时间 + 立即拉取 + 补抓当前周期 + 恢复定时器
    // tab 隐藏时：暂停业务 timer 和 route watcher，减少后台开销
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) {
        if (panelClosed) return; // 面板已被用户关闭，不恢复
        startRouteWatcher();
        if (!isFuturesTradingPage()) {
          pauseForNonTradingPage();
          return;
        }
        activateTradingPage();
      } else {
        stopLoop();
      }
    });

    // SPA 切换交易对检测（初始就在后台时延迟到前台再启动）
    if (!document.hidden) {
      startRouteWatcher();
      if (isFuturesTradingPage()) activateTradingPage();
    }
  }

  // 等待 DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
