// ==UserScript==
// @name         【自写】Binance Strategy 31 Volume Reversal
// @namespace    binance.strategy31.volume-reversal
// @icon         data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%23f0b90b%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2249%22%20text-anchor%3D%22middle%22%20font-family%3D%22Arial%2C%20sans-serif%22%20font-size%3D%2242%22%20font-weight%3D%22800%22%20fill%3D%22%23111827%22%3EJ%3C%2Ftext%3E%3C%2Fsvg%3E
// @icon64       data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%23f0b90b%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2249%22%20text-anchor%3D%22middle%22%20font-family%3D%22Arial%2C%20sans-serif%22%20font-size%3D%2242%22%20font-weight%3D%22800%22%20fill%3D%22%23111827%22%3EJ%3C%2Ftext%3E%3C%2Fsvg%3E
// @version      0.1.0
// @author       jackhai9
// @description  Confirmed red-to-green volume signals from CorsairQuant
// @match        https://www.binance.com/*/futures/*
// @match        https://www.binance.com/futures/*
// @exclude      https://www.binance.com/*/my/wallet/futures/*
// @exclude      https://www.binance.com/my/wallet/futures/*
// @updateURL    https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-strategy31-volume-reversal.user.js
// @downloadURL  https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-strategy31-volume-reversal.user.js
// @run-at       document-start
// @grant        unsafeWindow
// ==/UserScript==
(() => {
  // src/shared/canonical-symbol.js
  var ROUTE_SYMBOL_PATTERN = /^([\p{L}\p{N}]+)USDT$/u;
  function usdtRouteToCanonical(value) {
    const match = typeof value === "string" && value.match(ROUTE_SYMBOL_PATTERN);
    if (!match || match[0] !== value || match[1] !== match[1].toUpperCase()) {
      throw new TypeError("Invalid Binance futures route symbol");
    }
    return `${match[1]}/USDT:USDT`;
  }

  // src/shared/signal-gateway-bridge.js
  var SIGNAL_GATEWAY_BRIDGE = Symbol.for("jh-userscripts.signal-gateway");
  var MAX_RESPONSE_LENGTH = 2 * 1024 * 1024;

  // src/shared/binance-symbol.js
  var BINANCE_SYMBOL_CHARACTERS = "\\p{L}\\p{N}_";
  var SYMBOL_PATTERN = new RegExp(`^[${BINANCE_SYMBOL_CHARACTERS}]+$`, "u");

  // src/shared/binance-futures-route.js
  var FUTURES_TRADING_PATH_RE = /^\/(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?futures\/([^/]+)\/?$/;
  var TRADING_SYMBOL_RE = new RegExp(`^[${BINANCE_SYMBOL_CHARACTERS}]{3,}$`, "u");
  function parseFuturesTradingSymbolFromPathname(pathname) {
    const normalized = String(pathname || "").split(/[?#]/, 1)[0];
    const match = normalized.match(FUTURES_TRADING_PATH_RE);
    if (!match || match[0] !== normalized) return null;
    let symbol;
    try {
      symbol = decodeURIComponent(match[1]);
    } catch (error) {
      if (error instanceof URIError) return null;
      throw error;
    }
    const symbolMatch = symbol.match(TRADING_SYMBOL_RE);
    return symbolMatch && symbolMatch[0] === symbol ? symbol.toUpperCase() : null;
  }

  // src/shared/chart-mutation-owners.js
  var OWNER_SLOT = Symbol.for("jh-userscripts.chart-mutation-owners");
  var VERSION = 1;
  function existingOwners(view) {
    const record = view[OWNER_SLOT];
    if (record === void 0) return null;
    if (typeof view?.Map !== "function" || record.version !== VERSION || !(record.predicates instanceof view.Map)) {
      throw new Error("Incompatible chart mutation protocol; update both scripts and reload");
    }
    return record.predicates;
  }
  function isChartMutationBlocked(view) {
    const registry = existingOwners(view);
    if (registry === null) return false;
    for (const predicate of registry.values()) {
      const blocked = predicate();
      if (typeof blocked !== "boolean") throw new Error("Chart mutation owner must return a boolean");
      if (blocked) return true;
    }
    return false;
  }

  // src/shared/tradingview-target.js
  var CHART_ROOT_SELECTOR = ".chart-widget-root";
  function hasVisibleBox(element) {
    if (!element?.getClientRects().length) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  function findBinanceTradingViewTarget(document) {
    const chartRoots = Array.from(document.querySelectorAll(CHART_ROOT_SELECTOR)).filter(hasVisibleBox);
    if (!chartRoots.length) return null;
    if (chartRoots.length > 1) {
      throw new Error(`可见图表区域数量异常：${chartRoots.length}`);
    }
    const chartRoot = chartRoots[0];
    const tradingViewApis = Array.from(chartRoot.querySelectorAll("iframe")).map((frame) => frame.contentWindow?.tradingViewApi).filter(Boolean);
    if (!tradingViewApis.length) return null;
    if (tradingViewApis.length > 1) {
      throw new Error(`图表接口数量异常：${tradingViewApis.length}`);
    }
    return { chartRoot, tradingViewApi: tradingViewApis[0] };
  }

  // src/binance-strategy29-bollinger/core/bearish-bollinger-pattern.js
  var BOLLINGER_PATTERN = Object.freeze({
    bollingerPeriod: 20,
    bollingerStdDev: 2,
    maPeriod: 60,
    preCrossBars: 8,
    minPreCrossChannelCloses: 4,
    maxPreCrossAboveMiddleCloses: 1,
    maxPreCrossBelowLowerCloses: 3,
    trendLookbackBars: 3,
    minMiddleDeclineBandFraction: 0.01,
    postCrossBars: 20,
    middleApproachBandFraction: 0.12,
    maxPostCrossCloseAboveMiddleBandFraction: 0.05,
    lowerTouchBandFraction: 0.05,
    reversalFollowBars: 60
  });
  var TradingViewBarSnapshotInconsistentError = class extends Error {
    constructor(message) {
      super(message);
      this.name = "TradingViewBarSnapshotInconsistentError";
    }
  };

  // src/shared/abort.js
  function getAbortReason(signal) {
    if (signal?.reason instanceof Error) return signal.reason;
    const error = new Error("Operation aborted");
    error.name = "AbortError";
    return error;
  }
  function throwIfAborted(signal) {
    if (signal?.aborted) throw getAbortReason(signal);
  }
  function waitForPromiseOrAbort(task, signal) {
    if (!signal) return Promise.resolve(task);
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        callback(value);
      };
      const onAbort = () => finish(reject, getAbortReason(signal));
      signal.addEventListener("abort", onAbort, { once: true });
      Promise.resolve(task).then(
        (value) => finish(resolve, value),
        (error) => finish(reject, error)
      );
    });
  }

  // src/shared/chart-marker-save-controller.js
  var CONTROLLER_SLOT = Symbol.for("jh-userscripts.chart-marker-save-controller");
  var PROTOCOL_VERSION = 1;
  function readController(api) {
    const record = api[CONTROLLER_SLOT];
    if (record === void 0) return null;
    if (record.version !== PROTOCOL_VERSION || typeof record.controller?.runAfterIdle !== "function") {
      throw new Error("Incompatible TradingView marker save protocol; update both scripts and reload");
    }
    return record.controller;
  }
  var QUIET_MS = 150;
  var MAX_BURST_MS = 1e3;
  var DRAIN_TIMEOUT_MS = 2e3;
  function installTradingViewMarkerSaveController(api, {
    onError = (error) => {
      throw error;
    },
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout
  } = {}) {
    const existing = readController(api);
    if (existing) return existing;
    if (typeof api?.saveChart !== "function") {
      throw new Error("TradingView marker save API is unavailable");
    }
    const originalSaveChart = api.saveChart;
    let burst = null;
    let tailTimer = null;
    let mutations = 0;
    let draining = 0;
    let saveRequests = 0;
    let serializations = 0;
    let callbackCount = 0;
    let failureCount = 0;
    const idleWaiters = /* @__PURE__ */ new Set();
    const busy = () => burst !== null || mutations !== 0 || tailTimer !== null;
    function notifyIdle() {
      if (busy()) return;
      for (const resolve of idleWaiters) resolve();
      idleWaiters.clear();
    }
    function reportErrors(errors) {
      if (errors.length === 0) return;
      failureCount += errors.length;
      setTimeoutFn(() => onError(new AggregateError(errors, "TradingView marker save burst failed")), 0);
    }
    function flush() {
      const pending = burst;
      if (!pending) return;
      burst = null;
      clearTimeoutFn(pending.quietTimer);
      clearTimeoutFn(pending.maxTimer);
      const errors = [];
      try {
        if (pending.callbacks.length > 0) {
          serializations += 1;
          originalSaveChart.call(api, (snapshot) => {
            const json = JSON.stringify(snapshot);
            for (const callback of pending.callbacks) {
              try {
                callbackCount += 1;
                callback(JSON.parse(json));
              } catch (error) {
                errors.push(error);
              }
            }
          });
        }
      } catch (error) {
        errors.push(error);
      } finally {
        pending.callbacks.length = 0;
        notifyIdle();
        reportErrors(errors);
      }
    }
    function scheduleQuiet() {
      clearTimeoutFn(burst.quietTimer);
      burst.quietTimer = setTimeoutFn(flush, QUIET_MS);
    }
    function markMutation() {
      if (tailTimer !== null) clearTimeoutFn(tailTimer);
      tailTimer = setTimeoutFn(() => {
        tailTimer = null;
        notifyIdle();
      }, QUIET_MS);
      if (!burst) {
        burst = { callbacks: [], quietTimer: null, maxTimer: setTimeoutFn(flush, MAX_BURST_MS) };
      }
      scheduleQuiet();
    }
    function markerSaveChart(...args) {
      const defaultCall = this === api && args.length <= 2 && typeof args[0] === "function" && args[1] === void 0;
      if (api.saveChart !== markerSaveChart || !defaultCall) {
        flush();
        return originalSaveChart.apply(this, args);
      }
      if (!burst) return originalSaveChart.apply(this, args);
      saveRequests += 1;
      burst.callbacks.push(args[0]);
      scheduleQuiet();
      return void 0;
    }
    api.saveChart = markerSaveChart;
    if (api.saveChart !== markerSaveChart) {
      throw new Error("TradingView marker save wrapper could not be installed");
    }
    const controller = Object.freeze({
      canMutate: () => draining === 0 && api.saveChart === markerSaveChart,
      beginMutation() {
        if (!controller.canMutate()) {
          throw new Error("TradingView marker mutation overlaps a chart save owner");
        }
        mutations += 1;
        markMutation();
        let finished = false;
        return () => {
          if (finished) throw new Error("TradingView marker mutation finished twice");
          finished = true;
          mutations -= 1;
          markMutation();
        };
      },
      async runAfterIdle(action, { signal } = {}) {
        throwIfAborted(signal);
        draining += 1;
        let timeout = null;
        let wake = null;
        try {
          if (busy()) {
            await waitForPromiseOrAbort(new Promise((resolve, reject) => {
              wake = resolve;
              idleWaiters.add(wake);
              timeout = setTimeoutFn(() => {
                const error = new Error("TradingView marker saves did not finish before the chart operation");
                error.name = "TradingViewMarkerSaveDrainTimeoutError";
                reject(error);
              }, DRAIN_TIMEOUT_MS);
            }), signal);
          }
          if (busy()) throw new Error("TradingView marker save drain was invalidated");
          throwIfAborted(signal);
          return await action();
        } finally {
          if (timeout !== null) clearTimeoutFn(timeout);
          if (wake !== null) idleWaiters.delete(wake);
          draining -= 1;
        }
      },
      getStats: () => ({
        busy: busy(),
        mutations,
        draining,
        saveRequests,
        serializations,
        callbackCount,
        failureCount,
        pendingCallbacks: burst?.callbacks.length || 0
      })
    });
    Object.defineProperty(api, CONTROLLER_SLOT, { value: Object.freeze({ version: PROTOCOL_VERSION, controller }) });
    return controller;
  }

  // src/binance-strategy29-bollinger/dom/tradingview-bearish-alerts.js
  var MAX_BOLLINGER_MARKERS_PER_DIRECTION = 1e3;
  var MAX_BOLLINGER_MARKERS = MAX_BOLLINGER_MARKERS_PER_DIRECTION * 2;
  function routeSymbolFromChartSymbol(value) {
    return String(value || "").split("@", 1)[0];
  }
  function assertChartContract(chart) {
    for (const method of [
      "createShape",
      "dataReady",
      "exportData",
      "getAllShapes",
      "getShapeById",
      "hasModel",
      "onDataLoaded",
      "onIntervalChanged",
      "removeEntity",
      "resolution",
      "symbol"
    ]) {
      if (typeof chart?.[method] !== "function") {
        throw new Error(`TradingView Bollinger alert method is unavailable: ${method}`);
      }
    }
  }
  function readLiveShapes(chart) {
    const shapes = chart.getAllShapes();
    if (!Array.isArray(shapes)) {
      throw new Error("TradingView Bollinger alert shape list is invalid");
    }
    const ids = /* @__PURE__ */ new Map();
    for (const [index, shape] of shapes.entries()) {
      if (typeof shape?.id !== "string" || shape.id.length === 0 || typeof shape.name !== "string") {
        throw new Error(`TradingView Bollinger alert shape ${index} id is invalid`);
      }
      ids.set(shape.id, shape.name);
    }
    return ids;
  }
  function tradingViewResolutionToSeconds(resolution) {
    const value = String(resolution || "").toUpperCase();
    const units = [
      { pattern: /^(\d+)S$/, seconds: 1 },
      { pattern: /^(\d+)$/, seconds: 60 },
      { pattern: /^(\d+)H$/, seconds: 60 * 60 },
      { pattern: /^(\d+)D$/, seconds: 24 * 60 * 60 },
      { pattern: /^(\d+)W$/, seconds: 7 * 24 * 60 * 60 }
    ];
    for (const { pattern, seconds } of units) {
      const match = value.match(pattern);
      if (!match) continue;
      const count = Number(match[1]);
      if (Number.isSafeInteger(count) && count > 0) return count * seconds;
    }
    throw new Error(`TradingView Bollinger alert resolution is unsupported: ${resolution}`);
  }
  function bollingerIntervalVisibility(resolution) {
    const seconds = tradingViewResolutionToSeconds(resolution);
    const value = String(resolution).toUpperCase();
    const visibility = {
      ticks: false,
      seconds: false,
      minutes: false,
      hours: false,
      days: false,
      weeks: false,
      months: false,
      ranges: false
    };
    let unit;
    let count;
    if (value.endsWith("W")) {
      unit = "weeks";
      count = seconds / 604800;
    } else if (value.endsWith("D")) {
      unit = "days";
      count = seconds / 86400;
    } else if (seconds < 60) {
      unit = "seconds";
      count = seconds;
    } else if (value.endsWith("S") || seconds < 3600) {
      unit = "minutes";
      count = Math.floor(seconds / 60);
    } else {
      unit = "hours";
      count = Math.floor(seconds / 3600);
    }
    visibility[unit] = true;
    visibility[`${unit}From`] = count;
    visibility[`${unit}To`] = count;
    return visibility;
  }
  function createBollingerIntervalSession(chart) {
    const intervalChanged = chart.onIntervalChanged();
    const dataLoaded = chart.onDataLoaded();
    for (const subscription of [intervalChanged, dataLoaded]) {
      if (typeof subscription?.subscribe !== "function" || typeof subscription.unsubscribe !== "function") {
        throw new Error("TradingView Bollinger interval subscription is unavailable");
      }
    }
    let revision = 0;
    let disposed = false;
    let awaitingData = !chart.dataReady();
    const owner = {};
    function invalidate() {
      revision += 1;
      awaitingData = true;
    }
    function complete() {
      awaitingData = false;
    }
    intervalChanged.subscribe(owner, invalidate);
    dataLoaded.subscribe(owner, complete);
    return Object.freeze({
      get revision() {
        return revision;
      },
      isCurrent(candidate) {
        return !disposed && !awaitingData && candidate === revision && chart.dataReady();
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        revision += 1;
        intervalChanged.unsubscribe(owner, invalidate);
        dataLoaded.unsubscribe(owner, complete);
      }
    });
  }
  function isBearishBollingerChartTargetCurrent(document, target) {
    const baseTarget = findBinanceTradingViewTarget(document);
    if (!baseTarget) return false;
    const chart = baseTarget.tradingViewApi.activeChart?.();
    if (!chart) return false;
    assertChartContract(chart);
    if (!chart.hasModel()) return false;
    return baseTarget.chartRoot === target.chartRoot && baseTarget.tradingViewApi === target.tradingViewApi && chart === target.chart && chart.resolution() === target.resolution && routeSymbolFromChartSymbol(chart.symbol()) === target.routeSymbol;
  }
  function assertExportSchema(schema) {
    if (!Array.isArray(schema)) throw new Error("TradingView Bollinger alert export schema is invalid");
    const fields = schema.map((column) => column.plotTitle || column.type);
    const expected = ["time", "open", "high", "low", "close"];
    if (fields.length !== expected.length || fields.some((field, index) => field !== expected[index])) {
      throw new Error(`TradingView Bollinger alert export schema mismatch: ${fields.join(",")}`);
    }
  }
  function parseExportRow(row, index) {
    if (!row || typeof row !== "object") {
      throw new Error(`TradingView Bollinger alert export row ${index} is invalid`);
    }
    const bar = {
      time: row[0],
      open: row[1],
      high: row[2],
      low: row[3],
      close: row[4]
    };
    if (!Number.isInteger(bar.time)) {
      throw new Error(`TradingView Bollinger alert export time ${index} is invalid`);
    }
    for (const field of ["open", "high", "low", "close"]) {
      if (!Number.isFinite(bar[field])) {
        throw new Error(`TradingView Bollinger alert export ${field} ${index} is invalid`);
      }
    }
    return bar;
  }
  function parseClosedTradingViewBars(exported, { resolutionSeconds, observedAtSeconds, resolution }) {
    if (!Number.isSafeInteger(resolutionSeconds) || resolutionSeconds < 1) {
      throw new Error("TradingView Bollinger alert resolution seconds are invalid");
    }
    if (!Number.isFinite(observedAtSeconds)) {
      throw new Error("TradingView Bollinger alert observation time is invalid");
    }
    assertExportSchema(exported?.schema);
    if (!Array.isArray(exported.data)) {
      throw new Error("TradingView Bollinger alert export data is invalid");
    }
    const bars = exported.data.map(parseExportRow);
    const gridSeconds = Math.min(resolutionSeconds, 86400);
    for (const [index, bar] of bars.entries()) {
      if (bar.time % gridSeconds !== 0 || String(resolution).toUpperCase().endsWith("W") && new Date(bar.time * 1e3).getUTCDay() !== 1) {
        throw new TradingViewBarSnapshotInconsistentError(
          `TradingView Bollinger alert export interval grid is invalid at ${index}`
        );
      }
    }
    for (let index = 1; index < bars.length; index += 1) {
      if (bars[index].time <= bars[index - 1].time) {
        throw new TradingViewBarSnapshotInconsistentError(
          `TradingView Bollinger alert export order is invalid at ${index}`
        );
      }
      if ((bars[index].time - bars[index - 1].time) % resolutionSeconds !== 0) {
        throw new TradingViewBarSnapshotInconsistentError(
          `TradingView Bollinger alert export interval spacing is invalid at ${index}`
        );
      }
    }
    return bars.filter((bar) => bar.time + resolutionSeconds <= observedAtSeconds);
  }
  async function exportClosedTradingViewBars(target, session, observedAtMs = Date.now()) {
    const revision = session.revision;
    const isCurrent = () => session.isCurrent(revision) && target.chart.resolution() === target.resolution && routeSymbolFromChartSymbol(target.chart.symbol()) === target.routeSymbol;
    if (!isCurrent()) return null;
    const exported = await target.chart.exportData({ includedStudies: [] });
    if (!isCurrent()) return null;
    return parseClosedTradingViewBars(exported, {
      resolutionSeconds: target.resolutionSeconds,
      resolution: target.resolution,
      observedAtSeconds: observedAtMs / 1e3
    });
  }
  function markerOptions(signal, resolution) {
    const direction = signal.direction;
    if (direction !== "bearish" && direction !== "bullish") {
      throw new Error(`TradingView Bollinger alert signal direction is invalid: ${direction}`);
    }
    const isBullish = direction === "bullish";
    const common = {
      lock: true,
      disableSave: true,
      disableSelection: true,
      disableUndo: true,
      showInObjectsTree: false
    };
    if (signal.type === "warning") {
      return {
        ...common,
        shape: "icon",
        icon: 61713,
        overrides: {
          visible: true,
          intervalsVisibilities: bollingerIntervalVisibility(resolution),
          color: isBullish ? "#0ECB81" : "#F6465D",
          size: 10
        }
      };
    }
    if (signal.type === "confirmed") {
      return {
        ...common,
        shape: isBullish ? "arrow_up" : "arrow_down",
        overrides: {
          visible: true,
          intervalsVisibilities: bollingerIntervalVisibility(resolution),
          color: isBullish ? "#0ECB81" : "#F6465D",
          arrowColor: isBullish ? "#0ECB81" : "#F6465D"
        }
      };
    }
    if (signal.type === "reversal") {
      return {
        ...common,
        shape: isBullish ? "arrow_down" : "arrow_up",
        overrides: {
          visible: true,
          intervalsVisibilities: bollingerIntervalVisibility(resolution),
          color: isBullish ? "#F6465D" : "#0ECB81",
          arrowColor: isBullish ? "#F6465D" : "#0ECB81"
        }
      };
    }
    throw new Error(`TradingView Bollinger alert signal type is invalid: ${signal.type}`);
  }
  function readMarkerPoint(shape) {
    const points = shape?.getPoints?.();
    if (!Array.isArray(points) || points.length !== 1 || !Number.isInteger(points[0].time) || !Number.isFinite(points[0].price)) {
      throw new Error("TradingView Bollinger alert marker point is invalid");
    }
    return points[0];
  }
  function markerPropertiesMatch(shape, options) {
    const properties = shape.getProperties();
    if (!properties || typeof properties !== "object") {
      throw new Error("TradingView Bollinger alert marker properties are invalid");
    }
    if (options.icon !== void 0 && properties.icon !== options.icon) return false;
    for (const [key, expected] of Object.entries(options.overrides)) {
      if (key === "intervalsVisibilities") {
        if (!properties[key] || Object.entries(expected).some(([unit, value]) => properties[key][unit] !== value)) return false;
      } else if (properties[key] !== expected) return false;
    }
    return true;
  }
  function normalizeSignal(signal, index, defaultDirection) {
    if (!signal || typeof signal !== "object") {
      throw new Error(`TradingView Bollinger alert signal ${index} is invalid`);
    }
    if (typeof signal.id !== "string" || signal.id.length === 0) {
      throw new Error(`TradingView Bollinger alert signal ${index} id is invalid`);
    }
    const direction = signal.direction === void 0 ? defaultDirection : signal.direction;
    if (direction !== "bearish" && direction !== "bullish") {
      throw new Error(`TradingView Bollinger alert signal ${index} direction is invalid: ${direction}`);
    }
    return signal.direction === direction ? signal : { ...signal, direction };
  }
  function createMarkerLayer(target, defaultDirection, {
    canMutate: canMutateExternally = () => true,
    onSaveError,
    yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0))
  } = {}) {
    const { chart } = target;
    const saveController = installTradingViewMarkerSaveController(target.tradingViewApi, { onError: onSaveError });
    const canMutate = () => canMutateExternally() && saveController.canMutate();
    const registry = /* @__PURE__ */ new Map();
    const pendingMarkers = /* @__PURE__ */ new Set();
    let generation = 0;
    let creating = 0;
    function mutate(action) {
      const finish = saveController.beginMutation();
      try {
        return action();
      } finally {
        finish();
      }
    }
    function removePendingMarkers() {
      if (pendingMarkers.size === 0 || !canMutate()) return;
      const liveShapeIds = readLiveShapes(chart);
      for (const id of pendingMarkers) {
        if (liveShapeIds.has(id)) mutate(() => chart.removeEntity(id));
        pendingMarkers.delete(id);
      }
    }
    function discardMissingSignals(liveShapeIds) {
      for (const [signalId, record] of registry) {
        if (!liveShapeIds.has(record.markerId)) registry.delete(signalId);
      }
    }
    function removeSignal(signalId, liveShapeIds) {
      const record = registry.get(signalId);
      if (!record) return;
      if (liveShapeIds.has(record.markerId)) {
        mutate(() => chart.removeEntity(record.markerId));
        liveShapeIds.delete(record.markerId);
      }
      registry.delete(signalId);
    }
    return Object.freeze({
      async render(signals, { isCurrent }) {
        if (!Array.isArray(signals)) throw new Error("TradingView Bollinger alert signals are invalid");
        if (signals.length > MAX_BOLLINGER_MARKERS) {
          throw new Error(
            `TradingView Bollinger alert marker limit exceeded: ${signals.length}`
          );
        }
        if (typeof isCurrent !== "function") {
          throw new Error("TradingView Bollinger alert current-target validator is unavailable");
        }
        const normalizedSignals = signals.map((signal, index) => normalizeSignal(signal, index, defaultDirection));
        const directionCounts = { bearish: 0, bullish: 0 };
        for (const signal of normalizedSignals) {
          directionCounts[signal.direction] += 1;
          if (directionCounts[signal.direction] > MAX_BOLLINGER_MARKERS_PER_DIRECTION) {
            throw new Error(
              `TradingView Bollinger alert ${signal.direction} marker limit exceeded: ` + directionCounts[signal.direction]
            );
          }
        }
        const requestedGeneration = generation;
        if (!isCurrent() || !canMutate()) return false;
        removePendingMarkers();
        let liveShapeIds = readLiveShapes(chart);
        discardMissingSignals(liveShapeIds);
        const nextIds = new Set(normalizedSignals.map((signal) => signal.id));
        for (const signalId of [...registry.keys()]) {
          if (!nextIds.has(signalId)) removeSignal(signalId, liveShapeIds);
        }
        let batchStartedAt = performance.now();
        let batchOps = 0;
        for (const signal of normalizedSignals) {
          if (batchOps > 0 && (batchOps >= 32 || performance.now() - batchStartedAt >= 8)) {
            await yieldToBrowser();
            if (requestedGeneration !== generation || !isCurrent() || !canMutate()) return false;
            liveShapeIds = readLiveShapes(chart);
            discardMissingSignals(liveShapeIds);
            batchStartedAt = performance.now();
            batchOps = 0;
          }
          if (requestedGeneration !== generation || !isCurrent() || !canMutate()) return false;
          batchOps += 1;
          const options = markerOptions(signal, target.resolution);
          const existing = registry.get(signal.id);
          if (existing) {
            const shape = chart.getShapeById(existing.markerId);
            const point = readMarkerPoint(shape);
            if (point.time === signal.time && point.price === existing.resolvedPrice && existing.markerPrice === signal.markerPrice && existing.type === signal.type && existing.direction === signal.direction && liveShapeIds.get(existing.markerId) === options.shape && markerPropertiesMatch(shape, options)) continue;
            removeSignal(signal.id, liveShapeIds);
          }
          const finishCreation = saveController.beginMutation();
          creating += 1;
          try {
            const markerId = await chart.createShape({ time: signal.time, price: signal.markerPrice }, {
              ...options,
              overrides: { ...options.overrides, visible: false }
            });
            if (typeof markerId !== "string" || markerId.length === 0) {
              throw new Error("TradingView returned an invalid Bollinger alert shape id");
            }
            pendingMarkers.add(markerId);
            if (requestedGeneration !== generation || !isCurrent() || !canMutate()) return false;
            const shape = chart.getShapeById(markerId);
            const point = readMarkerPoint(shape);
            if (point.time !== signal.time) {
              throw new Error(`TradingView Bollinger alert time alignment failed: expected ${signal.time}, received ${point.time}`);
            }
            if (requestedGeneration !== generation || !isCurrent() || !canMutate()) return false;
            mutate(() => shape.setProperties(options.overrides, false));
            if (!markerPropertiesMatch(shape, options)) {
              throw new Error("TradingView Bollinger alert marker properties were not applied");
            }
            registry.set(signal.id, {
              markerId,
              resolvedPrice: point.price,
              markerPrice: signal.markerPrice,
              type: signal.type,
              direction: signal.direction
            });
            pendingMarkers.delete(markerId);
          } finally {
            finishCreation();
            creating -= 1;
            removePendingMarkers();
          }
        }
        return true;
      },
      clear() {
        generation += 1;
        if (!canMutate()) return false;
        removePendingMarkers();
        const liveShapeIds = readLiveShapes(chart);
        discardMissingSignals(liveShapeIds);
        for (const signalId of [...registry.keys()]) removeSignal(signalId, liveShapeIds);
        return creating === 0 && pendingMarkers.size === 0;
      },
      get size() {
        return registry.size;
      },
      get saveStats() {
        return saveController.getStats();
      }
    });
  }
  function createBollingerMarkerLayer(target, options) {
    return createMarkerLayer(target, void 0, options);
  }

  // src/binance-strategy31-volume-reversal/event-contract.js
  var STRATEGY31_PERIODS = Object.freeze({
    "1m": 60,
    "3m": 180,
    "5m": 300,
    "15m": 900,
    "30m": 1800,
    "1h": 3600,
    "2h": 7200,
    "4h": 14400,
    "6h": 21600,
    "8h": 28800,
    "12h": 43200,
    "1d": 86400,
    "3d": 259200,
    "1w": 604800
  });
  function parseStrategy31Events(payload, symbol, timeframe) {
    const interval = STRATEGY31_PERIODS[timeframe] * 1e3;
    if (!interval || payload?.schema_version !== 1 || payload.strategy_id !== "31" || payload.spec_version !== "31_2_spec_v1" || payload.symbol !== symbol || payload.timeframe !== timeframe || !Number.isSafeInteger(payload.observed_at_ms) || !Array.isArray(payload.events) || payload.events.length > 200) {
      throw new TypeError("Invalid Strategy31 event snapshot");
    }
    let previousOpen = -1;
    return payload.events.map((event) => {
      const anchor = timeframe === "1w" ? 3456e5 : 0;
      if (event.symbol !== symbol || event.timeframe !== timeframe || !Number.isSafeInteger(event.bar_open_ms) || event.bar_open_ms <= previousOpen || (event.bar_open_ms - anchor) % interval !== 0 || event.bar_close_ms !== event.bar_open_ms + interval || event.bar_close_ms > payload.observed_at_ms || event.id !== `31_2_spec_v1:${symbol}:${timeframe}:${event.bar_open_ms}` || !["open", "high", "low", "close", "volume", "previous_volume"].every((key) => Number.isFinite(event[key])) || event.low <= 0 || event.low > event.open || event.high < event.close || event.close <= event.open || event.previous_volume < 0 || event.volume <= event.previous_volume) {
        throw new TypeError("Invalid Strategy31 event");
      }
      previousOpen = event.bar_open_ms;
      return { id: event.id, direction: "bullish", type: "confirmed", time: event.bar_open_ms / 1e3, markerPrice: event.low };
    });
  }

  // src/binance-strategy31-volume-reversal/runtime.js
  function installStrategy31(view) {
    const key = Symbol.for("jh-userscripts.strategy31");
    if (view[key]) return view[key];
    let context = null, intervalOwner = null, inflight = null, disposed = false, failed = false;
    const retired = /* @__PURE__ */ new Set();
    const document = view.document;
    function notice(text) {
      if (!document.body) return;
      let node = document.getElementById("jh-strategy31-status");
      if (!node) {
        node = document.createElement("div");
        node.id = "jh-strategy31-status";
        node.setAttribute("role", "status");
        node.style.cssText = "position:fixed;bottom:40px;left:16px;z-index:10000;padding:6px;background:#181a20;color:#ddd;font:12px sans-serif;pointer-events:none";
        document.body.append(node);
      }
      node.textContent = text;
    }
    function retire() {
      if (context) {
        retired.add(context.layer);
        context = null;
      }
      inflight?.abort();
    }
    function releaseChart() {
      retire();
      intervalOwner?.session.dispose();
      intervalOwner = null;
    }
    function cleanup() {
      if (isChartMutationBlocked(view)) return;
      for (const layer of retired) if (layer.clear()) retired.delete(layer);
      if ((disposed || failed) && retired.size === 0) view.clearInterval(timer);
    }
    function current(candidate) {
      return !disposed && !document.hidden && context === candidate && candidate.session.isCurrent(candidate.revision) && parseFuturesTradingSymbolFromPathname(view.location.pathname) === candidate.target.routeSymbol && isBearishBollingerChartTargetCurrent(document, candidate.target) && !isChartMutationBlocked(view);
    }
    async function sample() {
      cleanup();
      if (disposed || failed || document.hidden || inflight) return;
      const route = parseFuturesTradingSymbolFromPathname(view.location.pathname);
      if (!route?.endsWith("USDT")) {
        releaseChart();
        cleanup();
        notice("Strategy31: unsupported market");
        return;
      }
      const symbol = usdtRouteToCanonical(route);
      const base = findBinanceTradingViewTarget(document);
      const chart = base?.tradingViewApi.activeChart?.();
      if (!route || !chart?.hasModel() || String(chart.symbol()).split("@")[0] !== route) {
        releaseChart();
        cleanup();
        return;
      }
      if (!intervalOwner || intervalOwner.chart !== chart || intervalOwner.route !== route) {
        releaseChart();
        intervalOwner = { chart, route, session: createBollingerIntervalSession(chart) };
      }
      const resolution = chart.resolution();
      if (!/^\d+(?:S|H|D|W)?$/i.test(String(resolution))) {
        retire();
        cleanup();
        notice("Strategy31: unsupported interval");
        return;
      }
      const seconds = tradingViewResolutionToSeconds(resolution);
      const timeframe = Object.keys(STRATEGY31_PERIODS).find((period) => STRATEGY31_PERIODS[period] === seconds);
      if (!timeframe) {
        retire();
        cleanup();
        notice("Strategy31: unsupported interval");
        return;
      }
      if (context && (context.target.chart !== chart || context.target.routeSymbol !== route || context.target.chartRoot !== base.chartRoot || context.target.tradingViewApi !== base.tradingViewApi || context.target.resolution !== resolution || context.revision !== context.session.revision)) retire();
      cleanup();
      const session = intervalOwner.session;
      if (retired.size || !session.isCurrent(session.revision)) return;
      if (!context) {
        const target = { ...base, chart, resolution, resolutionSeconds: seconds, routeSymbol: route };
        context = {
          target,
          session,
          revision: session.revision,
          layer: createBollingerMarkerLayer(target, { canMutate: () => !isChartMutationBlocked(view) })
        };
      }
      const candidate = context;
      if (!current(candidate)) return;
      const provider = view[SIGNAL_GATEWAY_BRIDGE];
      if (!provider?.capabilities?.includes("strategy31")) {
        notice("Strategy31: update CorsairQuant signal client");
        return;
      }
      const state = provider.getState();
      if (!state.configured || !state.available) {
        notice("Strategy31: configure CorsairQuant signal client");
        return;
      }
      const controller = new AbortController();
      const requestCurrent = () => current(candidate) && view[SIGNAL_GATEWAY_BRIDGE] === provider && provider.getState().settingsRevision === state.settingsRevision;
      inflight = controller;
      try {
        const path = `/v1/strategy31/events?${new URLSearchParams({ symbol, timeframe, limit: "200" })}`;
        const response = await provider.request(path, controller.signal);
        if (!requestCurrent()) return;
        if (response.kind !== "response" || response.status !== 200) {
          notice("Strategy31: signal service unavailable");
          return;
        }
        const signals = parseStrategy31Events(JSON.parse(response.responseText), symbol, timeframe);
        let bars;
        try {
          bars = await exportClosedTradingViewBars(candidate.target, candidate.session);
        } catch (error) {
          if (error instanceof TradingViewBarSnapshotInconsistentError) return;
          throw error;
        }
        if (!bars || !requestCurrent()) return;
        const loadedTimes = new Set(bars.map((bar) => bar.time));
        const visible = signals.filter((signal) => loadedTimes.has(signal.time));
        const rendered = await candidate.layer.render(visible, { isCurrent: requestCurrent });
        if (rendered && requestCurrent()) notice(`Strategy31: ${visible.length} chart signals · ${timeframe}`);
      } finally {
        if (inflight === controller) inflight = null;
      }
    }
    function tick() {
      return sample().catch(() => {
        failed = true;
        releaseChart();
        cleanup();
        if (!disposed) notice("Strategy31 stopped: invalid chart or signal data");
      });
    }
    function visibility() {
      if (document.hidden) retire();
      else void tick();
    }
    const timer = view.setInterval(() => {
      void tick();
    }, 5e3);
    document.addEventListener("visibilitychange", visibility);
    const runtime = Object.freeze({ sample: tick, dispose() {
      disposed = true;
      releaseChart();
      cleanup();
      document.removeEventListener("visibilitychange", visibility);
      document.getElementById("jh-strategy31-status")?.remove();
    } });
    Object.defineProperty(view, key, { value: runtime });
    void tick();
    return runtime;
  }

  // src/binance-strategy31-volume-reversal/index.user.js
  installStrategy31(unsafeWindow);
})();
