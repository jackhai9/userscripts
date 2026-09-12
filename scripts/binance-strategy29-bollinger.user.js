// ==UserScript==
// @name         【自写】Binance Strategy 29 布林带信号
// @namespace    binance.strategy29.bollinger
// @icon         data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%23f0b90b%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2249%22%20text-anchor%3D%22middle%22%20font-family%3D%22Arial%2C%20sans-serif%22%20font-size%3D%2242%22%20font-weight%3D%22800%22%20fill%3D%22%23111827%22%3EJ%3C%2Ftext%3E%3C%2Fsvg%3E
// @icon64       data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%23f0b90b%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2249%22%20text-anchor%3D%22middle%22%20font-family%3D%22Arial%2C%20sans-serif%22%20font-size%3D%2242%22%20font-weight%3D%22800%22%20fill%3D%22%23111827%22%3EJ%3C%2Ftext%3E%3C%2Fsvg%3E
// @version      0.5.4
// @author       jackhai9
// @description  Native Bollinger/SMA60 markers and the default read-only cross-timeframe summary
// @match        https://www.binance.com/*/futures/*
// @match        https://www.binance.com/futures/*
// @exclude      https://www.binance.com/*/my/wallet/futures/*
// @exclude      https://www.binance.com/my/wallet/futures/*
// @updateURL    https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-strategy29-bollinger.user.js
// @downloadURL  https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-strategy29-bollinger.user.js
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==
(() => {
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
  function isTradingViewBarSnapshotInconsistentError(error) {
    return error instanceof TradingViewBarSnapshotInconsistentError;
  }
  function applyBollingerAlertTaskFailure(context, error) {
    if (!context || typeof context !== "object" || typeof context.failed !== "boolean" || typeof context.cleanupPending !== "boolean") {
      throw new Error("Bollinger alert task context is invalid");
    }
    if (isTradingViewBarSnapshotInconsistentError(error)) return "retry";
    context.failed = true;
    context.cleanupPending = true;
    return "fatal";
  }
  function assertFiniteNumber(value, label) {
    if (!Number.isFinite(value)) throw new Error(`${label} is invalid`);
  }
  function assertBars(bars, directionLabel) {
    if (!Array.isArray(bars)) throw new Error(`${directionLabel} Bollinger bars must be an array`);
    let previousTime = -Infinity;
    for (const [index, bar] of bars.entries()) {
      if (!bar || typeof bar !== "object") {
        throw new Error(`${directionLabel} Bollinger bar ${index} is invalid`);
      }
      if (!Number.isInteger(bar.time)) {
        throw new Error(`${directionLabel} Bollinger bar time ${index} is invalid`);
      }
      if (bar.time <= previousTime) {
        throw new TradingViewBarSnapshotInconsistentError(
          `${directionLabel} Bollinger bar time ${index} is invalid`
        );
      }
      for (const field of ["open", "high", "low", "close"]) {
        assertFiniteNumber(bar[field], `${directionLabel} Bollinger bar ${index} ${field}`);
      }
      if (bar.high < bar.low || bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close)) {
        throw new TradingViewBarSnapshotInconsistentError(
          `${directionLabel} Bollinger bar ${index} OHLC range is invalid`
        );
      }
      previousTime = bar.time;
    }
  }
  function assertIndicatorBars(indicatorBars, directionLabel) {
    if (!Array.isArray(indicatorBars)) {
      throw new Error(`${directionLabel} Bollinger indicator bars must be an array`);
    }
    assertBars(indicatorBars, directionLabel);
    for (const [index, bar] of indicatorBars.entries()) {
      const fields = ["middle", "upper", "lower", "ma60"];
      const nullFields = fields.filter((field) => bar[field] === null);
      if (nullFields.length !== 0 && nullFields.length !== fields.length) {
        throw new Error(`${directionLabel} Bollinger indicator bar ${index} is incomplete`);
      }
      for (const field of fields) {
        if (bar[field] !== null) {
          assertFiniteNumber(
            bar[field],
            `${directionLabel} Bollinger indicator bar ${index} ${field}`
          );
        }
      }
    }
  }
  function calculateBollingerIndicatorBars(bars, directionLabel) {
    assertBars(bars, directionLabel);
    const config = BOLLINGER_PATTERN;
    return bars.map((bar, index) => {
      if (index < config.maPeriod - 1) {
        return { ...bar, middle: null, upper: null, lower: null, ma60: null };
      }
      const start = index - config.bollingerPeriod + 1;
      let closeSum = 0;
      for (let cursor = start; cursor <= index; cursor += 1) closeSum += bars[cursor].close;
      const middle = closeSum / config.bollingerPeriod;
      let squaredDeviationSum = 0;
      for (let cursor = start; cursor <= index; cursor += 1) {
        squaredDeviationSum += (bars[cursor].close - middle) ** 2;
      }
      const deviation = Math.sqrt(squaredDeviationSum / config.bollingerPeriod) * config.bollingerStdDev;
      let maSum = 0;
      for (let cursor = index - config.maPeriod + 1; cursor <= index; cursor += 1) maSum += bars[cursor].close;
      return {
        ...bar,
        middle,
        upper: middle + deviation,
        lower: middle - deviation,
        ma60: maSum / config.maPeriod
      };
    });
  }
  function bandWidth(bar) {
    const width = bar.upper - bar.lower;
    if (!(width > 0)) throw new Error(`Bollinger band width is invalid at ${bar.time}`);
    return width;
  }
  function hasDownwardBandCenter(indicatorBars, index) {
    const { trendLookbackBars, minMiddleDeclineBandFraction } = BOLLINGER_PATTERN;
    const current = indicatorBars[index];
    const earlier = indicatorBars[index - trendLookbackBars];
    const averageWidth = (bandWidth(current) + bandWidth(earlier)) / 2;
    return (earlier.middle - current.middle) / averageWidth >= minMiddleDeclineBandFraction;
  }
  function isRejectedAboveMiddleClose(indicatorBars, index) {
    const next = indicatorBars[index + 1];
    return next.close < next.middle && next.close < next.open;
  }
  function matchesPreCrossCompression(indicatorBars, crossIndex) {
    const config = BOLLINGER_PATTERN;
    const start = crossIndex - config.preCrossBars;
    const preCross = indicatorBars.slice(start, crossIndex);
    const channelCloses = preCross.filter(
      (bar) => bar.close >= bar.lower && bar.close <= bar.middle
    ).length;
    const aboveMiddleIndexes = [];
    let belowLowerCloses = 0;
    for (let offset = 0; offset < preCross.length; offset += 1) {
      const bar = preCross[offset];
      if (bar.close > bar.middle) aboveMiddleIndexes.push(start + offset);
      if (bar.close < bar.lower) belowLowerCloses += 1;
    }
    return channelCloses >= config.minPreCrossChannelCloses && aboveMiddleIndexes.length <= config.maxPreCrossAboveMiddleCloses && belowLowerCloses <= config.maxPreCrossBelowLowerCloses && aboveMiddleIndexes.every((index) => isRejectedAboveMiddleClose(indicatorBars, index));
  }
  function isDownwardCross(previous, current) {
    return previous.middle >= previous.ma60 && current.middle < current.ma60;
  }
  function buildSignal(type, setup, bar) {
    const width = bandWidth(bar);
    const markerGapFraction = type === "warning" ? 0.06 : 0.1;
    return Object.freeze({
      id: `${setup.time}:${type}`,
      type,
      setupTime: setup.time,
      time: bar.time,
      markerPrice: type === "reversal" ? bar.low - width * markerGapFraction : bar.high + width * markerGapFraction
    });
  }
  function detectReversalSignal(indicatorBars, setup, warningIndex) {
    const { reversalFollowBars } = BOLLINGER_PATTERN;
    const warning = indicatorBars[warningIndex];
    const endIndex = Math.min(
      indicatorBars.length - 1,
      warningIndex + reversalFollowBars
    );
    for (let index = warningIndex + 1; index <= endIndex; index += 1) {
      const bar = indicatorBars[index];
      if (bar.close > warning.high) return buildSignal("reversal", setup, bar);
    }
    return null;
  }
  function detectSetupSignals(indicatorBars, crossIndex) {
    const config = BOLLINGER_PATTERN;
    const setup = indicatorBars[crossIndex];
    const signals = [];
    let warningIndex = null;
    let pendingMiddleRejection = false;
    let aboveMiddleCloseCount = 0;
    const endIndex = Math.min(
      indicatorBars.length - 1,
      crossIndex + config.postCrossBars
    );
    for (let index = crossIndex + 1; index <= endIndex; index += 1) {
      const bar = indicatorBars[index];
      const width = bandWidth(bar);
      if (pendingMiddleRejection) {
        if (!(bar.close < bar.middle && bar.close < bar.open)) break;
        pendingMiddleRejection = false;
      }
      if (bar.close > bar.middle) {
        aboveMiddleCloseCount += 1;
        if (aboveMiddleCloseCount > 1 || bar.close > bar.middle + width * config.maxPostCrossCloseAboveMiddleBandFraction || bar.close > bar.upper) break;
        pendingMiddleRejection = true;
        continue;
      }
      const bandStillDown = bar.middle < setup.middle && hasDownwardBandCenter(indicatorBars, index);
      if (!bandStillDown) continue;
      if (warningIndex === null && bar.high >= bar.middle - width * config.middleApproachBandFraction) {
        warningIndex = index;
        signals.push(buildSignal("warning", setup, bar));
        continue;
      }
      if (warningIndex !== null && index > warningIndex && bar.close < bar.open && bar.low <= bar.lower + width * config.lowerTouchBandFraction) {
        signals.push(buildSignal("confirmed", setup, bar));
        break;
      }
    }
    if (warningIndex !== null) {
      const reversal = detectReversalSignal(indicatorBars, setup, warningIndex);
      if (reversal) signals.push(reversal);
    }
    return signals;
  }
  function appendSetupSignals(signals, setupSignals) {
    for (const signal of setupSignals) {
      if (signal.type !== "reversal") {
        signals.push(signal);
        continue;
      }
      const duplicateIndex = signals.findIndex(
        (existing) => existing.type === "reversal" && existing.time === signal.time
      );
      if (duplicateIndex === -1) {
        signals.push(signal);
        continue;
      }
      if (signal.setupTime > signals[duplicateIndex].setupTime) {
        signals[duplicateIndex] = signal;
      }
    }
  }
  function detectBearishBollingerSignalsFromIndicatorBarsInternal(indicatorBars) {
    const config = BOLLINGER_PATTERN;
    const firstCrossIndex = Math.max(
      config.maPeriod,
      config.maPeriod - 1 + config.preCrossBars,
      config.trendLookbackBars
    );
    const signals = [];
    for (let index = firstCrossIndex; index < indicatorBars.length; index += 1) {
      const previous = indicatorBars[index - 1];
      const current = indicatorBars[index];
      if (!isDownwardCross(previous, current)) continue;
      if (!hasDownwardBandCenter(indicatorBars, index)) continue;
      if (!matchesPreCrossCompression(indicatorBars, index)) continue;
      appendSetupSignals(signals, detectSetupSignals(indicatorBars, index));
    }
    const typeOrder = { warning: 0, confirmed: 1, reversal: 2 };
    return signals.sort(
      (left, right) => left.time - right.time || typeOrder[left.type] - typeOrder[right.type]
    );
  }
  function mirrorIndicatorBar(bar) {
    return {
      ...bar,
      open: -bar.open,
      high: -bar.low,
      low: -bar.high,
      close: -bar.close,
      middle: bar.middle === null ? null : -bar.middle,
      upper: bar.upper === null ? null : -bar.lower,
      lower: bar.lower === null ? null : -bar.upper,
      ma60: bar.ma60 === null ? null : -bar.ma60
    };
  }
  function mapMirroredBullishSignal(signal) {
    return Object.freeze({
      ...signal,
      id: `${signal.setupTime}:bullish:${signal.type}`,
      direction: "bullish",
      markerPrice: -signal.markerPrice
    });
  }
  function detectBullishBollingerSignalsFromIndicatorBarsInternal(indicatorBars) {
    return detectBearishBollingerSignalsFromIndicatorBarsInternal(
      indicatorBars.map(mirrorIndicatorBar)
    ).map(mapMirroredBullishSignal);
  }
  function compareBollingerSignals(left, right) {
    const directionOrder = { bearish: 0, bullish: 1 };
    const typeOrder = { warning: 0, confirmed: 1, reversal: 2 };
    const leftDirectionOrder = directionOrder[left.direction];
    const rightDirectionOrder = directionOrder[right.direction];
    if (leftDirectionOrder === void 0 || rightDirectionOrder === void 0) {
      throw new Error("Bollinger signal direction is invalid");
    }
    return left.time - right.time || leftDirectionOrder - rightDirectionOrder || typeOrder[left.type] - typeOrder[right.type];
  }
  function detectBollingerSignalsFromIndicatorBars(indicatorBars) {
    assertIndicatorBars(indicatorBars, "Bollinger");
    const bearishSignals = detectBearishBollingerSignalsFromIndicatorBarsInternal(indicatorBars).map((signal) => Object.freeze({ ...signal, direction: "bearish" }));
    const bullishSignals = detectBullishBollingerSignalsFromIndicatorBarsInternal(indicatorBars);
    return [...bearishSignals, ...bullishSignals].sort(compareBollingerSignals);
  }
  function detectBollingerSignals(bars) {
    return detectBollingerSignalsFromIndicatorBars(
      calculateBollingerIndicatorBars(bars, "Bollinger")
    );
  }

  // src/shared/tradingview-target.js
  var CHART_ROOT_SELECTOR = ".chart-widget-root";
  function hasVisibleBox(element2) {
    if (!element2?.getClientRects().length) return false;
    const rect = element2.getBoundingClientRect();
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
  function findBearishBollingerChartTarget(document, expectedRouteSymbol) {
    const baseTarget = findBinanceTradingViewTarget(document);
    if (!baseTarget) return null;
    const chart = baseTarget.tradingViewApi.activeChart?.();
    if (!chart) return null;
    assertChartContract(chart);
    if (!chart.hasModel()) return null;
    const resolution = chart.resolution();
    const resolutionSeconds = tradingViewResolutionToSeconds(resolution);
    const routeSymbol = routeSymbolFromChartSymbol(chart.symbol());
    if (routeSymbol !== expectedRouteSymbol) {
      throw new Error(
        `TradingView Bollinger alert symbol mismatch: expected ${expectedRouteSymbol}, received ${routeSymbol}`
      );
    }
    return {
      ...baseTarget,
      chart,
      resolution,
      resolutionSeconds,
      routeSymbol
    };
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
  function buildClosedBarsWindowKey(bars) {
    if (!Array.isArray(bars) || bars.length === 0) {
      throw new Error("TradingView Bollinger alert closed-bar window is empty");
    }
    return `${bars.length}:${bars[0].time}:${bars.at(-1).time}`;
  }
  function writeClosedBarToSnapshot(values, offset, bar, index) {
    if (!bar || typeof bar !== "object") {
      throw new Error(`TradingView Bollinger closed bar ${index} is invalid`);
    }
    if (!Number.isInteger(bar.time)) {
      throw new Error(`TradingView Bollinger closed bar time ${index} is invalid`);
    }
    const fields = ["open", "high", "low", "close"];
    for (const field of fields) {
      if (!Number.isFinite(bar[field])) {
        throw new Error(`TradingView Bollinger closed bar ${field} ${index} is invalid`);
      }
    }
    values[offset] = bar.time;
    values[offset + 1] = bar.open;
    values[offset + 2] = bar.high;
    values[offset + 3] = bar.low;
    values[offset + 4] = bar.close;
  }
  function buildClosedBarsContentSnapshot(bars) {
    const windowKey = buildClosedBarsWindowKey(bars);
    const values = new Float64Array(bars.length * 5);
    for (let index = 0; index < bars.length; index += 1) {
      writeClosedBarToSnapshot(values, index * 5, bars[index], index);
    }
    return { windowKey, values };
  }
  function matchesClosedBarsContentSnapshot(bars, snapshot) {
    if (!snapshot || typeof snapshot !== "object" || typeof snapshot.windowKey !== "string" || !(snapshot.values instanceof Float64Array)) {
      throw new Error("TradingView Bollinger closed-bar snapshot is invalid");
    }
    if (buildClosedBarsWindowKey(bars) !== snapshot.windowKey) return false;
    if (snapshot.values.length !== bars.length * 5) return false;
    const candidate = new Float64Array(5);
    for (let index = 0; index < bars.length; index += 1) {
      writeClosedBarToSnapshot(candidate, 0, bars[index], index);
      const offset = index * 5;
      for (let fieldIndex = 0; fieldIndex < candidate.length; fieldIndex += 1) {
        if (!Object.is(snapshot.values[offset + fieldIndex], candidate[fieldIndex])) return false;
      }
    }
    return true;
  }
  async function reconcileBearishBollingerAlertWindow({
    bars,
    cachedWindowKey,
    cachedContentSnapshot = null,
    cachedSignals,
    detectSignals,
    renderSignals
  }) {
    if (typeof detectSignals !== "function") {
      throw new Error("TradingView Bollinger alert detector is unavailable");
    }
    if (typeof renderSignals !== "function") {
      throw new Error("TradingView Bollinger alert renderer is unavailable");
    }
    const closedBarsWindowKey = buildClosedBarsWindowKey(bars);
    const contentUnchanged = closedBarsWindowKey === cachedWindowKey && cachedContentSnapshot !== null && matchesClosedBarsContentSnapshot(bars, cachedContentSnapshot);
    const signals = contentUnchanged ? cachedSignals : detectSignals(bars);
    if (!Array.isArray(signals)) {
      throw new Error("Bollinger signal cache is invalid");
    }
    const rendered = await renderSignals(signals);
    if (typeof rendered !== "boolean") {
      throw new Error("TradingView Bollinger alert render result is invalid");
    }
    return {
      rendered,
      closedBarsWindowKey,
      closedBarsContentSnapshot: contentUnchanged ? cachedContentSnapshot : buildClosedBarsContentSnapshot(bars),
      signals
    };
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

  // src/binance-strategy29-bollinger/monitor.js
  function createBollingerMonitor({
    document,
    getCurrentSymbol,
    isFuturesTradingPage,
    isTradingViewDrawingMutationBusy,
    err,
    warn
  }) {
    let bearishBollingerAlertTask = null;
    let bearishBollingerAlertContext = null;
    let bollingerIntervalSession = null;
    let lastLocalFailure = null;
    const retiredBollingerLayers = /* @__PURE__ */ new Set();
    function clearBearishBollingerAlertContext() {
      if (bearishBollingerAlertContext) {
        retiredBollingerLayers.add(bearishBollingerAlertContext.layer);
        bearishBollingerAlertContext = null;
      }
      return clearRetiredBollingerLayers();
    }
    function clearRetiredBollingerLayers() {
      if (isTradingViewDrawingMutationBusy()) return false;
      for (const layer of retiredBollingerLayers) {
        if (layer.clear()) retiredBollingerLayers.delete(layer);
      }
      return retiredBollingerLayers.size === 0;
    }
    function disposeBollingerIntervalSession() {
      if (bollingerIntervalSession) {
        bollingerIntervalSession.session.dispose();
        bollingerIntervalSession = null;
      }
    }
    function isBearishBollingerAlertContextCurrent(context) {
      return bearishBollingerAlertContext === context && context.intervalSession === bollingerIntervalSession?.session && context.intervalSession.isCurrent(context.intervalRevision) && !document.hidden && isFuturesTradingPage() && !isTradingViewDrawingMutationBusy() && getCurrentSymbol() === context.routeSymbol && isBearishBollingerChartTargetCurrent(document, context.target);
    }
    async function synchronizeBearishBollingerAlerts() {
      if (document.hidden || !isFuturesTradingPage()) return;
      const routeSymbol = getCurrentSymbol();
      if (!routeSymbol) return;
      let target;
      try {
        target = findBearishBollingerChartTarget(document, routeSymbol);
      } catch (error) {
        disposeBollingerIntervalSession();
        clearBearishBollingerAlertContext();
        err("Bollinger chart lookup failed for this sample:", error);
        return;
      }
      if (!target) {
        disposeBollingerIntervalSession();
        clearBearishBollingerAlertContext();
        return;
      }
      if (!bollingerIntervalSession || bollingerIntervalSession.chart !== target.chart || bollingerIntervalSession.routeSymbol !== routeSymbol) {
        disposeBollingerIntervalSession();
        bollingerIntervalSession = {
          chart: target.chart,
          routeSymbol,
          session: createBollingerIntervalSession(target.chart)
        };
      }
      const intervalSession = bollingerIntervalSession.session;
      const contextMatches = bearishBollingerAlertContext && bearishBollingerAlertContext.target.chart === target.chart && bearishBollingerAlertContext.target.chartRoot === target.chartRoot && bearishBollingerAlertContext.target.tradingViewApi === target.tradingViewApi && bearishBollingerAlertContext.routeSymbol === routeSymbol && bearishBollingerAlertContext.resolution === target.resolution && bearishBollingerAlertContext.intervalSession === intervalSession && bearishBollingerAlertContext.intervalRevision === intervalSession.revision;
      if (!contextMatches) {
        if (!clearBearishBollingerAlertContext()) return;
        if (!intervalSession.isCurrent(intervalSession.revision) || isTradingViewDrawingMutationBusy()) return;
        bearishBollingerAlertContext = {
          routeSymbol,
          resolution: target.resolution,
          intervalSession,
          intervalRevision: intervalSession.revision,
          target,
          layer: createBollingerMarkerLayer(target, {
            canMutate: () => !isTradingViewDrawingMutationBusy(),
            onSaveError: (error) => err("Bollinger chart save failed:", error)
          }),
          failed: false,
          cleanupPending: false,
          lastProcessedClosedBarsWindowKey: null,
          lastProcessedClosedBarsContentSnapshot: null,
          lastProcessedSignals: null
        };
      }
      if (isTradingViewDrawingMutationBusy() || !clearRetiredBollingerLayers()) return;
      const context = bearishBollingerAlertContext;
      if (context.cleanupPending) {
        context.layer.clear();
        context.cleanupPending = false;
      }
      if (context.failed || bearishBollingerAlertTask) return;
      let stage = "export";
      const task = (async () => {
        const bars = await exportClosedTradingViewBars(context.target, context.intervalSession);
        if (!bars || !isBearishBollingerAlertContextCurrent(context)) return;
        if (bars.length === 0) return;
        stage = "reconcile";
        const result = await reconcileBearishBollingerAlertWindow({
          bars,
          cachedWindowKey: context.lastProcessedClosedBarsWindowKey,
          cachedContentSnapshot: context.lastProcessedClosedBarsContentSnapshot,
          cachedSignals: context.lastProcessedSignals,
          detectSignals: (bars2) => {
            stage = "detect";
            const signals = detectBollingerSignals(bars2);
            stage = "reconcile";
            return signals;
          },
          renderSignals: async (signals) => {
            stage = "render";
            const rendered = await context.layer.render(signals, {
              isCurrent: () => isBearishBollingerAlertContextCurrent(context)
            });
            stage = "reconcile";
            return rendered;
          }
        });
        if (result.rendered && isBearishBollingerAlertContextCurrent(context)) {
          context.lastProcessedClosedBarsWindowKey = result.closedBarsWindowKey;
          context.lastProcessedClosedBarsContentSnapshot = result.closedBarsContentSnapshot;
          context.lastProcessedSignals = result.signals;
        }
      })();
      bearishBollingerAlertTask = task;
      task.catch((error) => {
        if (bearishBollingerAlertContext !== context || context.intervalSession !== bollingerIntervalSession?.session || context.intervalRevision !== context.intervalSession.revision) return;
        let failureKind;
        let classificationFailed = false;
        try {
          failureKind = applyBollingerAlertTaskFailure(context, error);
        } catch {
          classificationFailed = true;
          context.failed = true;
          context.cleanupPending = true;
          failureKind = "fatal";
        }
        if (failureKind === "retry") {
          warn("布林带形态预警本轮快照不一致，保留现有标记并等待下一次采样:", error);
          return;
        }
        const details = { name: null, message: null };
        const unreadableFields = [];
        for (const [key, limit] of [["name", 64], ["message", 512]]) {
          try {
            const value = key === "message" && typeof error === "string" ? error : error?.[key];
            details[key] = typeof value === "string" ? value.slice(0, limit) : null;
          } catch {
            unreadableFields.push(key);
          }
        }
        lastLocalFailure = Object.freeze({
          thrownType: error === null ? "null" : typeof error,
          classificationFailed,
          ...details,
          unreadableFields: Object.freeze(unreadableFields),
          stage,
          routeSymbol: context.routeSymbol,
          resolution: context.resolution,
          cachedSignalCount: context.lastProcessedSignals === null ? null : context.lastProcessedSignals.length,
          layerSizeBeforeCleanup: context.layer.size,
          sessionRevision: context.intervalSession.revision,
          contextIntervalRevision: context.intervalRevision
        });
        err("布林带形态预警已停止:", error);
      }).finally(() => {
        if (bearishBollingerAlertTask === task) bearishBollingerAlertTask = null;
      });
    }
    function stopBearishBollingerAlertMonitor() {
      disposeBollingerIntervalSession();
      clearBearishBollingerAlertContext();
    }
    function getBollingerAlertDiagnostics() {
      const context = bearishBollingerAlertContext;
      const session = bollingerIntervalSession?.session || null;
      const chart = bollingerIntervalSession?.chart || context?.target.chart || null;
      const nativeModelReady = chart ? chart.hasModel() : null;
      return {
        taskPending: bearishBollingerAlertTask !== null,
        contextPresent: context !== null,
        failed: context ? context.failed : null,
        lastLocalFailure,
        cleanupPending: context ? context.cleanupPending : null,
        cachedSignalCount: context?.lastProcessedSignals === null || !context ? null : context.lastProcessedSignals.length,
        layerSize: context ? context.layer.size : null,
        markerSaveStats: context ? context.layer.saveStats : null,
        retiredCount: retiredBollingerLayers.size,
        sessionPresent: session !== null,
        sessionRevision: session ? session.revision : null,
        contextIntervalRevision: context ? context.intervalRevision : null,
        sessionMatchesContext: context && session ? context.intervalSession === session : null,
        sessionCurrent: session && nativeModelReady ? session.isCurrent(session.revision) : null,
        nativeModelReady,
        nativeDataReady: nativeModelReady ? chart.dataReady() : null,
        mutationBlocked: isTradingViewDrawingMutationBusy()
      };
    }
    return Object.freeze({
      tick: synchronizeBearishBollingerAlerts,
      stop: stopBearishBollingerAlertMonitor,
      get diagnostics() {
        return getBollingerAlertDiagnostics();
      }
    });
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
  function isFuturesTradingPathname(pathname) {
    return Boolean(parseFuturesTradingSymbolFromPathname(pathname));
  }

  // src/shared/spa-route-change.js
  var ROUTE_CHANGE_EVENT = "jh-userscripts:spa-route-change";
  var ROUTE_PATCH_MARKER = Symbol.for("jh-userscripts.spa-route-change-patched");
  var ROUTE_DISPATCH_STATE = Symbol.for("jh-userscripts.spa-route-change-dispatch");
  function dispatchRouteChange(view) {
    const href = view.location.href;
    if (view[ROUTE_DISPATCH_STATE]?.href === href) return;
    const state = { href };
    view[ROUTE_DISPATCH_STATE] = state;
    view.dispatchEvent(new view.Event(ROUTE_CHANGE_EVENT));
    view.queueMicrotask(() => {
      if (view[ROUTE_DISPATCH_STATE] === state) delete view[ROUTE_DISPATCH_STATE];
    });
  }
  function patchHistoryMethod(view, methodName) {
    const current = view.history[methodName];
    if (current[ROUTE_PATCH_MARKER]) return;
    function routeAwareHistoryMethod(...args) {
      const previousHref = view.location.href;
      const result = Reflect.apply(current, this, args);
      if (view.location.href !== previousHref) dispatchRouteChange(view);
      return result;
    }
    Object.defineProperty(routeAwareHistoryMethod, ROUTE_PATCH_MARKER, { value: true });
    view.history[methodName] = routeAwareHistoryMethod;
  }
  function ensureSpaRouteChangePatched(view) {
    if (!view?.history) throw new Error("SPA route patch requires a window");
    patchHistoryMethod(view, "pushState");
    patchHistoryMethod(view, "replaceState");
  }
  function installSpaRouteChangeListener(view, listener) {
    if (!view?.history || typeof listener !== "function") {
      throw new Error("SPA route listener requires a window and callback");
    }
    ensureSpaRouteChangePatched(view);
    view.addEventListener(ROUTE_CHANGE_EVENT, listener);
    view.addEventListener("popstate", listener);
    view.addEventListener("hashchange", listener);
    return () => {
      view.removeEventListener(ROUTE_CHANGE_EVENT, listener);
      view.removeEventListener("popstate", listener);
      view.removeEventListener("hashchange", listener);
    };
  }

  // src/shared/canonical-symbol.js
  var CANONICAL_SYMBOL_PATTERN = /^([\p{L}\p{N}]+)\/USDT:USDT$/u;
  var ROUTE_SYMBOL_PATTERN = /^([\p{L}\p{N}]+)USDT$/u;
  function isCanonicalUsdtSymbol(value) {
    if (typeof value !== "string") return false;
    const match = value.match(CANONICAL_SYMBOL_PATTERN);
    return Boolean(match && match[0] === value && match[1] === match[1].toUpperCase());
  }
  function usdtRouteToCanonical(value) {
    const match = typeof value === "string" && value.match(ROUTE_SYMBOL_PATTERN);
    if (!match || match[0] !== value || match[1] !== match[1].toUpperCase()) {
      throw new TypeError("Invalid Binance futures route symbol");
    }
    return `${match[1]}/USDT:USDT`;
  }

  // src/binance-strategy29-bollinger/core/remote-summary-contract.js
  var STRATEGY29_SCHEMA_VERSION = 1;
  var STRATEGY29_API_SPEC_VERSION = "29_2_spec_v3";
  var STRATEGY29_EVENT_SPEC_VERSION = "29_2_spec_v2";
  var STRATEGY29_REFERENCE_SHA256 = "eece8cf16e58340910587962f3bfbb19acb72155c09a52b4b6c0570cc979ef8d";
  var TIMEFRAMES = /* @__PURE__ */ new Set(["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "1w"]);
  var UNIT_STATUSES = /* @__PURE__ */ new Set(["warming", "ready", "stale", "insufficient_history", "data_gap", "failed"]);
  var DIRECTIONS = /* @__PURE__ */ new Set(["bearish", "bullish"]);
  var SIGNAL_TYPES = /* @__PURE__ */ new Set(["warning", "confirmed", "reversal"]);
  var SIGNAL_SIDES = /* @__PURE__ */ new Set(["short", "long"]);
  var ORIGINS = /* @__PURE__ */ new Set(["historical", "catch_up", "live"]);
  var DELIVERY_STATES = /* @__PURE__ */ new Set(["pending", "sending", "sent", "unknown", "expired", "failed"]);
  var DELIVERY_COUNT_KEYS = ["pending", "sending", "sent", "unknown", "expired", "failed"];
  var STATUS_KEYS = ["schema_version", "spec_version", "observed_at_ms", "universe", "units", "delivery_counts"];
  var UNIVERSE_KEYS = [
    "source_monitor",
    "generation",
    "refresh_status",
    "reason",
    "selected_markets",
    "configured_timeframes",
    "selected_unit_count",
    "ready_unit_count",
    "pending_unit_count",
    "refreshed_at_ms",
    "last_successful_refreshed_at_ms",
    "last_success_age_seconds",
    "last_refresh_error_at_ms",
    "selection_expires_at_ms"
  ];
  var UNIVERSE_STATES = /* @__PURE__ */ new Set(["fresh", "stale_if_error", "fail_closed"]);
  var UNIVERSE_REASONS = {
    fresh: /* @__PURE__ */ new Set(["current"]),
    stale_if_error: /* @__PURE__ */ new Set(["using_stale_selection_after_refresh_error"]),
    fail_closed: /* @__PURE__ */ new Set([
      "selection_fail_closed",
      "selection_expired_or_unusable",
      "missing_current_universe_facts",
      "incompatible_current_universe_facts"
    ])
  };
  var UNIT_KEYS = [
    "symbol",
    "timeframe",
    "status",
    "reason",
    "last_processed_open_ms",
    "last_data_at_ms",
    "last_event_id"
  ];
  var EVENTS_KEYS = ["schema_version", "spec_version", "observed_at_ms", "next_cursor", "has_more", "events"];
  var EVENT_KEYS = [
    "sequence",
    "event_id",
    "schema_version",
    "strategy_id",
    "spec_version",
    "symbol",
    "timeframe",
    "setup_direction",
    "signal_type",
    "signal_side",
    "setup_open_ms",
    "bar_open_ms",
    "bar_close_ms",
    "detected_at_ms",
    "close_price",
    "marker_price",
    "warning_open_ms",
    "warning_high",
    "warning_low",
    "origin",
    "delivery_state",
    "delivery_failure_reason"
  ];
  var EVENT_ID_PATTERN = /^[0-9a-f]{64}$/;
  function assertObject(value, name) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  }
  function assertExactKeys(value, keys, name) {
    assertObject(value, name);
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
      throw new TypeError(`${name} must contain exact keys: ${expected.join(", ")}`);
    }
  }
  function assertInteger(value, name, { nullable = false, minimum = 0 } = {}) {
    if (nullable && value === null) return;
    if (!Number.isSafeInteger(value) || value < minimum) throw new TypeError(`${name} must be an integer >= ${minimum}`);
  }
  function assertString(value, name, { nullable = false, maximumLength = 256 } = {}) {
    if (nullable && value === null) return;
    if (typeof value !== "string" || value.length === 0) throw new TypeError(`${name} must be a non-empty string`);
    if (value.length > maximumLength) throw new TypeError(`${name} exceeds ${maximumLength} characters`);
  }
  function assertEnum(value, allowed, name, { nullable = false } = {}) {
    if (nullable && value === null) return;
    if (!allowed.has(value)) throw new TypeError(`${name} is invalid`);
  }
  function assertFiniteNumber2(value, name) {
    if (!Number.isFinite(value)) throw new TypeError(`${name} must be a finite number`);
  }
  function assertSchema(value, name) {
    if (value !== STRATEGY29_SCHEMA_VERSION) throw new TypeError(`${name} must equal ${STRATEGY29_SCHEMA_VERSION}`);
  }
  function assertCanonicalSymbol(value, name) {
    if (!isCanonicalUsdtSymbol(value)) {
      throw new TypeError(`${name} must use canonical symbol format`);
    }
  }
  function routeSymbolToCanonical(value) {
    return usdtRouteToCanonical(value);
  }
  function validateUnit(value, index) {
    const name = `status.units[${index}]`;
    assertExactKeys(value, UNIT_KEYS, name);
    assertCanonicalSymbol(value.symbol, `${name}.symbol`);
    assertEnum(value.timeframe, TIMEFRAMES, `${name}.timeframe`);
    assertEnum(value.status, UNIT_STATUSES, `${name}.status`);
    assertString(value.reason, `${name}.reason`);
    assertInteger(value.last_processed_open_ms, `${name}.last_processed_open_ms`, { nullable: true });
    assertInteger(value.last_data_at_ms, `${name}.last_data_at_ms`, { nullable: true });
    if (value.last_event_id !== null && (typeof value.last_event_id !== "string" || !EVENT_ID_PATTERN.test(value.last_event_id))) {
      throw new TypeError(`${name}.last_event_id must be null or a lowercase hexadecimal event id`);
    }
  }
  function validateUniverse(value) {
    assertExactKeys(value, UNIVERSE_KEYS, "status.universe");
    if (value.source_monitor !== "monitor29_bollinger_ma60") throw new TypeError("status.universe.source_monitor is invalid");
    assertInteger(value.generation, "status.universe.generation", { nullable: true, minimum: 1 });
    assertEnum(value.refresh_status, UNIVERSE_STATES, "status.universe.refresh_status");
    assertEnum(value.reason, UNIVERSE_REASONS[value.refresh_status], "status.universe.reason");
    for (const key of ["selected_markets", "configured_timeframes"]) {
      if (!Array.isArray(value[key]) || value[key].length > 128 || new Set(value[key]).size !== value[key].length) {
        throw new TypeError(`status.universe.${key} must be a bounded unique array`);
      }
    }
    value.selected_markets.forEach((symbol) => assertCanonicalSymbol(symbol, "status.universe.selected_markets"));
    value.configured_timeframes.forEach((timeframe) => assertEnum(timeframe, TIMEFRAMES, "status.universe.configured_timeframes"));
    for (const key of ["selected_unit_count", "ready_unit_count", "pending_unit_count"]) {
      assertInteger(value[key], `status.universe.${key}`);
      if (value[key] > 128) throw new TypeError(`status.universe.${key} exceeds the unit bound`);
    }
    if (value.ready_unit_count + value.pending_unit_count !== value.selected_unit_count || value.selected_markets.length > value.selected_unit_count) throw new TypeError("status.universe counts are inconsistent");
    if (value.refresh_status === "fail_closed" && value.selected_unit_count !== 0) throw new TypeError("status.universe unavailable selection must be empty");
    for (const key of ["refreshed_at_ms", "last_successful_refreshed_at_ms", "last_refresh_error_at_ms", "selection_expires_at_ms"]) {
      assertInteger(value[key], `status.universe.${key}`, { nullable: true });
    }
    if (value.last_success_age_seconds !== null) {
      assertFiniteNumber2(value.last_success_age_seconds, "status.universe.last_success_age_seconds");
      if (value.last_success_age_seconds < 0) throw new TypeError("status.universe last success age must be non-negative");
    }
    if (value.last_successful_refreshed_at_ms === null !== (value.last_success_age_seconds === null)) {
      throw new TypeError("status.universe last success fields are inconsistent");
    }
    const successMissing = value.last_successful_refreshed_at_ms === null;
    if (successMissing !== (value.selection_expires_at_ms === null)) {
      throw new TypeError("status.universe successful selection requires its expiry");
    }
    const absentFacts = value.reason === "missing_current_universe_facts" || value.reason === "incompatible_current_universe_facts";
    if (absentFacts) {
      if ([
        value.generation,
        value.refreshed_at_ms,
        value.last_successful_refreshed_at_ms,
        value.last_success_age_seconds,
        value.last_refresh_error_at_ms,
        value.selection_expires_at_ms
      ].some((item) => item !== null)) {
        throw new TypeError("status.universe unavailable facts must have null refresh metadata");
      }
    } else {
      if (value.generation === null || value.refreshed_at_ms === null) {
        throw new TypeError("status.universe current facts require generation and refresh time");
      }
      if (value.reason !== "selection_fail_closed" && successMissing) {
        throw new TypeError("status.universe successful selection metadata is required");
      }
      if (value.refresh_status === "fresh" && value.last_refresh_error_at_ms !== null) {
        throw new TypeError("status.universe fresh selection cannot report a refresh error");
      }
      if ((value.refresh_status === "stale_if_error" || value.reason === "selection_fail_closed") && value.last_refresh_error_at_ms === null) {
        throw new TypeError("status.universe failed refresh requires its error time");
      }
    }
  }
  function validateStrategy29StatusResponse(value, httpStatus) {
    if (httpStatus !== 200) throw new TypeError(`status response requires HTTP 200, received ${httpStatus}`);
    assertObject(value, "status response");
    assertSchema(value.schema_version, "status.schema_version");
    assertString(value.spec_version, "status.spec_version");
    assertInteger(value.observed_at_ms, "status.observed_at_ms");
    if (value.spec_version !== STRATEGY29_API_SPEC_VERSION) return {
      schema_version: value.schema_version,
      spec_version: value.spec_version,
      observed_at_ms: value.observed_at_ms
    };
    assertExactKeys(value, STATUS_KEYS, "status response");
    validateUniverse(value.universe);
    if (!Array.isArray(value.units)) throw new TypeError("status.units must be an array");
    if (value.units.length > 128) throw new TypeError("status.units exceeds the 128-unit bound");
    value.units.forEach(validateUnit);
    assertExactKeys(value.delivery_counts, DELIVERY_COUNT_KEYS, "status.delivery_counts");
    for (const key of DELIVERY_COUNT_KEYS) {
      assertInteger(value.delivery_counts[key], `status.delivery_counts.${key}`);
    }
    return value;
  }
  function expectedSignalSide(direction, signalType) {
    if (signalType === "reversal") return direction === "bearish" ? "long" : "short";
    return direction === "bearish" ? "short" : "long";
  }
  function validateEvent(value, index) {
    const name = `events.events[${index}]`;
    assertExactKeys(value, EVENT_KEYS, name);
    assertInteger(value.sequence, `${name}.sequence`, { minimum: 1 });
    if (typeof value.event_id !== "string" || !EVENT_ID_PATTERN.test(value.event_id)) {
      throw new TypeError(`${name}.event_id must be a lowercase hexadecimal event id`);
    }
    assertSchema(value.schema_version, `${name}.schema_version`);
    if (value.strategy_id !== "29") throw new TypeError(`${name}.strategy_id must equal 29`);
    if (value.spec_version !== STRATEGY29_EVENT_SPEC_VERSION) {
      throw new TypeError(`${name}.spec_version must equal ${STRATEGY29_EVENT_SPEC_VERSION}`);
    }
    assertCanonicalSymbol(value.symbol, `${name}.symbol`);
    assertEnum(value.timeframe, TIMEFRAMES, `${name}.timeframe`);
    assertEnum(value.setup_direction, DIRECTIONS, `${name}.setup_direction`);
    assertEnum(value.signal_type, SIGNAL_TYPES, `${name}.signal_type`);
    assertEnum(value.signal_side, SIGNAL_SIDES, `${name}.signal_side`);
    if (value.signal_side !== expectedSignalSide(value.setup_direction, value.signal_type)) {
      throw new TypeError(`${name}.signal_side does not match direction and signal type`);
    }
    for (const field of ["setup_open_ms", "bar_open_ms", "bar_close_ms", "detected_at_ms", "warning_open_ms"]) {
      assertInteger(value[field], `${name}.${field}`);
    }
    if (value.bar_close_ms <= value.bar_open_ms) throw new TypeError(`${name}.bar_close_ms must follow bar_open_ms`);
    for (const field of ["close_price", "marker_price", "warning_high", "warning_low"]) {
      assertFiniteNumber2(value[field], `${name}.${field}`);
    }
    if (value.warning_high < value.warning_low) throw new TypeError(`${name}.warning_high must not be below warning_low`);
    assertEnum(value.origin, ORIGINS, `${name}.origin`);
    assertEnum(value.delivery_state, DELIVERY_STATES, `${name}.delivery_state`, { nullable: true });
    assertString(value.delivery_failure_reason, `${name}.delivery_failure_reason`, { nullable: true, maximumLength: 512 });
  }
  function validateStrategy29EventsResponse(value, httpStatus) {
    if (httpStatus !== 200) throw new TypeError(`events response requires HTTP 200, received ${httpStatus}`);
    assertExactKeys(value, EVENTS_KEYS, "events response");
    assertSchema(value.schema_version, "events.schema_version");
    if (value.spec_version !== STRATEGY29_API_SPEC_VERSION) {
      throw new TypeError(`events.spec_version must equal ${STRATEGY29_API_SPEC_VERSION}`);
    }
    assertInteger(value.observed_at_ms, "events.observed_at_ms");
    assertInteger(value.next_cursor, "events.next_cursor");
    if (typeof value.has_more !== "boolean") throw new TypeError("events.has_more must be boolean");
    if (!Array.isArray(value.events)) throw new TypeError("events.events must be an array");
    if (value.events.length > 200) throw new TypeError("events.events exceeds the 200-event page bound");
    value.events.forEach(validateEvent);
    return value;
  }
  function validateStrategy29GatewayError(value, httpStatus) {
    if (httpStatus === 503 && (value.error === "module_disabled" || value.error === "gateway_unavailable")) {
      assertExactKeys(value, value.error === "module_disabled" ? ["schema_version", "error", "strategy_id", "status"] : ["schema_version", "error", "strategy_id"], "gateway error");
      assertSchema(value.schema_version, "gateway error.schema_version");
      if (value.strategy_id !== "29" || value.error === "module_disabled" && value.status !== "disabled") {
        throw new TypeError("Strategy29 gateway module identity is invalid");
      }
      return value;
    }
    if (httpStatus === 409) {
      assertExactKeys(value, ["schema_version", "error", "oldest_cursor"], "gateway error");
      assertSchema(value.schema_version, "gateway error.schema_version");
      if (value.error !== "cursor_expired") throw new TypeError("gateway error.error must equal cursor_expired");
      assertInteger(value.oldest_cursor, "gateway error.oldest_cursor");
      return value;
    }
    const expected = /* @__PURE__ */ new Map([[400, "invalid_request"], [401, "unauthorized"], [503, "database_unavailable"]]);
    if (!expected.has(httpStatus)) throw new TypeError(`unsupported gateway HTTP status ${httpStatus}`);
    assertExactKeys(value, ["schema_version", "error"], "gateway error");
    assertSchema(value.schema_version, "gateway error.schema_version");
    if (value.error !== expected.get(httpStatus)) {
      throw new TypeError(`gateway error.error must equal ${expected.get(httpStatus)}`);
    }
    return value;
  }

  // src/binance-strategy29-bollinger/core/remote-summary-client.js
  var Strategy29GatewayTransportError = class extends Error {
    constructor(message) {
      super(message);
      this.name = "Strategy29GatewayTransportError";
    }
  };
  function parseJsonResponse(response, label) {
    if (!response || !Number.isInteger(response.status) || typeof response.responseText !== "string") {
      throw new Strategy29GatewayTransportError(`${label} returned an invalid transport response`);
    }
    try {
      return JSON.parse(response.responseText);
    } catch {
      throw new TypeError(`${label} returned invalid JSON`);
    }
  }
  function assertConfiguration({ request, canonicalSymbol, maxPagesPerPoll, onStatus, onEvents, onCursorReset }) {
    if (typeof request !== "function") throw new TypeError("request must be a function");
    if (!isCanonicalUsdtSymbol(canonicalSymbol)) {
      throw new TypeError("canonicalSymbol must use canonical symbol format");
    }
    if (!Number.isInteger(maxPagesPerPoll) || maxPagesPerPoll < 1 || maxPagesPerPoll > 10) {
      throw new TypeError("maxPagesPerPoll must be between 1 and 10");
    }
    for (const [name, callback] of Object.entries({ onStatus, onEvents, onCursorReset })) {
      if (typeof callback !== "function") throw new TypeError(`${name} must be a function`);
    }
  }
  function buildEventsPath(canonicalSymbol, cursor) {
    const url = new URL("/v1/strategy29/events", "https://gateway.invalid");
    url.searchParams.set("symbol", canonicalSymbol);
    if (cursor === null) {
      url.searchParams.set("mode", "latest");
      url.searchParams.set("limit", "20");
    } else url.searchParams.set("cursor", String(cursor));
    return url.pathname + url.search;
  }
  function createStrategy29SummaryClient({
    request,
    canonicalSymbol,
    maxPagesPerPoll = 2,
    onStatus,
    onEvents,
    onCursorReset
  }) {
    assertConfiguration({ request, canonicalSymbol, maxPagesPerPoll, onStatus, onEvents, onCursorReset });
    let cursor = null;
    async function perform(path, signal) {
      if (!signal || typeof signal.aborted !== "boolean" || typeof signal.addEventListener !== "function") {
        throw new TypeError("poll requires an AbortSignal");
      }
      if (signal.aborted) throw signal.reason;
      return request({ path, signal });
    }
    async function poll(signal) {
      const statusResponse = await perform("/v1/strategy29/status", signal);
      if (signal.aborted) throw signal.reason;
      const statusBody = parseJsonResponse(statusResponse, "Strategy29 status");
      if (statusResponse.status === 503) {
        const error = validateStrategy29GatewayError(statusBody, 503);
        return { state: error.error === "database_unavailable" ? "unavailable" : error.error, pages: 0, hasMore: false };
      }
      if (statusResponse.status !== 200) {
        validateStrategy29GatewayError(statusBody, statusResponse.status);
        throw new Error(`Strategy29 status request failed with HTTP ${statusResponse.status}`);
      }
      const status = validateStrategy29StatusResponse(statusBody, 200);
      onStatus(status);
      if (status.spec_version !== STRATEGY29_API_SPEC_VERSION) {
        return { state: "incompatible", pages: 0, hasMore: false };
      }
      let pages = 0;
      let hasMore = false;
      while (pages < maxPagesPerPoll) {
        const requestedCursor = cursor;
        const eventsResponse = await perform(buildEventsPath(canonicalSymbol, cursor), signal);
        if (signal.aborted) throw signal.reason;
        const eventsBody = parseJsonResponse(eventsResponse, "Strategy29 events");
        pages += 1;
        if (eventsResponse.status === 409) {
          const error = validateStrategy29GatewayError(eventsBody, 409);
          cursor = null;
          onCursorReset(error.oldest_cursor);
          hasMore = true;
          continue;
        }
        if (eventsResponse.status === 503) {
          const error = validateStrategy29GatewayError(eventsBody, 503);
          return { state: error.error === "database_unavailable" ? "unavailable" : error.error, pages, hasMore: false };
        }
        if (eventsResponse.status !== 200) {
          validateStrategy29GatewayError(eventsBody, eventsResponse.status);
          throw new Error(`Strategy29 events request failed with HTTP ${eventsResponse.status}`);
        }
        const page = validateStrategy29EventsResponse(eventsBody, 200);
        if (requestedCursor === null && (page.has_more || page.events.length > 20)) {
          throw new TypeError("Strategy29 latest snapshot must be complete and bounded to 20 events");
        }
        if (requestedCursor !== null && page.next_cursor < requestedCursor) {
          throw new TypeError("Strategy29 event cursor moved backwards");
        }
        if (page.has_more && (requestedCursor === null ? page.next_cursor <= 0 : page.next_cursor <= requestedCursor)) {
          throw new TypeError("Strategy29 event cursor did not advance while has_more is true");
        }
        let previousSequence = requestedCursor;
        for (const event of page.events) {
          if (event.symbol !== canonicalSymbol) throw new TypeError("Strategy29 event symbol does not match the requested symbol");
          if (previousSequence !== null && event.sequence <= previousSequence) {
            throw new TypeError("Strategy29 event sequences must advance strictly");
          }
          if (event.sequence > page.next_cursor) throw new TypeError("Strategy29 event sequence exceeds next_cursor");
          previousSequence = event.sequence;
        }
        onEvents(page.events, page.observed_at_ms);
        cursor = page.next_cursor;
        hasMore = page.has_more;
        if (!hasMore) break;
      }
      return { state: "connected", pages, hasMore };
    }
    return Object.freeze({
      poll,
      get diagnostics() {
        return Object.freeze({ cursor });
      }
    });
  }

  // src/binance-orderbook-trade/contracts/panel-copy.js
  var UI_LOCALE_ZH_CN = "zh-CN";
  var UI_LOCALE_EN = "en";
  var SUPPORTED_UI_LOCALES = Object.freeze([
    UI_LOCALE_ZH_CN,
    UI_LOCALE_EN
  ]);
  function localizedText(zhCN, en) {
    if (typeof zhCN !== "string" || zhCN === "" || typeof en !== "string" || en === "") {
      throw new Error("Localized UI text requires non-empty Chinese and English values");
    }
    return Object.freeze({ zhCN, en });
  }
  function isLocalizedText(value) {
    return Boolean(
      value && typeof value === "object" && typeof value.zhCN === "string" && typeof value.en === "string"
    );
  }
  function formatLocalizedText(value, locale) {
    if (typeof value === "string") return value;
    if (!isLocalizedText(value)) throw new Error("Invalid localized UI text");
    if (locale === UI_LOCALE_ZH_CN) return value.zhCN;
    if (locale === UI_LOCALE_EN) return value.en;
    throw new Error(`Unsupported UI locale: ${locale}`);
  }
  function resolveUiLocaleFromPathname(pathname) {
    const firstSegment = String(pathname || "").split(/[?#]/, 1)[0].split("/").filter(Boolean)[0];
    return firstSegment?.toLowerCase() === "zh-cn" ? UI_LOCALE_ZH_CN : UI_LOCALE_EN;
  }
  var freezeCopy = (copy) => Object.freeze(copy);
  var PANEL_COPY = Object.freeze({
    section: freezeCopy({
      singleOrder: localizedText("单击下单", "Single Order"),
      ladderMaker: localizedText("阶梯下单 · Maker", "Ladder Orders · Maker")
    }),
    field: freezeCopy({
      clickOrderbook: localizedText("单击订单簿时", "On click"),
      minimumOrderQuantity: localizedText("最小下单量的", "Minimum order qty"),
      minimumOpenQuantity: localizedText("最小开仓量的", "Minimum open qty"),
      minimumCloseQuantity: localizedText("最小平仓量的", "Minimum close qty"),
      ratio: localizedText("比例", "Ratio"),
      orderCount: localizedText("笔数", "Orders"),
      interval: localizedText("间距", "Gap"),
      pricePrecision: localizedText("精度", "Precision"),
      multiplierUnit: localizedText("倍", "×")
    }),
    action: freezeCopy({
      openLong: localizedText("阶梯开多", "Open Long"),
      openShort: localizedText("阶梯开空", "Open Short"),
      closeLong: localizedText("阶梯平多", "Close Long"),
      closeShort: localizedText("阶梯平空", "Close Short"),
      cancel: localizedText("撤单", "Cancel"),
      cancelRunning: localizedText("撤单处理中", "Cancelling"),
      noOrders: localizedText("无挂单", "No Orders"),
      accountRebalance: localizedText("账户再平衡", "Account Rebalance"),
      stopLadderByAction: freezeCopy({
        OPEN_LONG: localizedText("停止开多", "Stop Open Long"),
        OPEN_SHORT: localizedText("停止开空", "Stop Open Short"),
        CLOSE_LONG: localizedText("停止平多", "Stop Close Long"),
        CLOSE_SHORT: localizedText("停止平空", "Stop Close Short")
      })
    }),
    side: freezeCopy({
      long: localizedText("多", "Long"),
      short: localizedText("空", "Short"),
      openLong: localizedText("开多", "Open Long"),
      openShort: localizedText("开空", "Open Short"),
      closeLong: localizedText("平多", "Close Long"),
      closeShort: localizedText("平空", "Close Short")
    }),
    state: freezeCopy({
      idle: localizedText("空闲", "Idle"),
      allPositionsClosed: localizedText("已全部平仓", "All positions closed"),
      waitingTradeMode: localizedText("等待开仓/平仓状态", "Waiting for trade mode"),
      waitingPricePrecision: localizedText("等待价格精度", "Waiting for precision"),
      waitingPrecisionOptions: localizedText("等待精度档位", "Waiting for options"),
      loadingPrecisionOptions: localizedText("读取精度档位", "Loading options"),
      minimumQuantityLoading: localizedText("最小量读取中", "Loading minimum qty"),
      positiveIntegerMultiplier: localizedText("请输入正整数倍数", "Enter a positive integer"),
      noClosablePosition: localizedText("暂无可平仓位", "No position to close")
    }),
    status: freezeCopy({
      precisionUpdated: localizedText("精度推荐已更新", "Precision recommendation updated"),
      precisionOptionsUnavailable: localizedText("档位读取失败，请刷新", "Options unavailable. Refresh."),
      precisionInsufficient: localizedText(
        "近期价格变化不足，请稍后重试",
        "Recent price movement is insufficient. Try again later."
      )
    }),
    aria: freezeCopy({
      decrementMultiplier: localizedText("减少倍数", "Decrease multiplier"),
      incrementMultiplier: localizedText("增加倍数", "Increase multiplier")
    }),
    rebalanceDialog: freezeCopy({
      targetSummary: localizedText(
        "目标分配：资金 50% / 现货 40% / U本位 10%",
        "Target allocation: Funding 50% / Spot 40% / USDⓈ-M Futures 10%"
      ),
      accountHeading: localizedText("账户", "Account"),
      currentHeading: localizedText("当前 (USDT)", "Current (USDT)"),
      targetHeading: localizedText("目标 (USDT)", "Target (USDT)"),
      transferHeading: localizedText("划转计划", "Transfer Plan"),
      cancel: localizedText("取消", "Cancel"),
      confirm: localizedText("确认再平衡", "Confirm Rebalance")
    }),
    tooltip: freezeCopy({
      singleOrder: localizedText(
        "单击订单簿中的某个价格，按当前方向和数量设置提交一笔订单。",
        "Click a price in the order book to submit one order using the current side and quantity settings."
      ),
      ladderMaker: localizedText(
        "根据当前比例、笔数、间距和价格精度设置，依次提交只做 Maker 的阶梯订单。",
        "Submit Post Only ladder orders sequentially using the current ratio, order count, gap, and precision."
      ),
      ratio: localizedText(
        "本次阶梯下单使用可开/可平数量的百分比。",
        "Percentage of the available open or close quantity used by this ladder."
      ),
      orderCount: localizedText(
        "计划拆分成多少笔阶梯订单。",
        "Number of orders in the ladder."
      ),
      interval: localizedText(
        "相邻订单跨越多少个订单簿价格级别。",
        "Number of order-book price levels between adjacent orders."
      ),
      pricePrecision: localizedText(
        "与订单簿中的价格精度联动。黄点表示推荐值。比例、笔数、间距会随所选精度恢复对应设置。",
        "Linked to the order-book price precision. The yellow dot marks the recommendation. Ratio, orders, and gap restore their saved values for the selected precision."
      ),
      continuousClose: localizedText(
        "Option/Alt + 单击：连续交易",
        "Option/Alt + click: continuous trading"
      ),
      accountRebalance: localizedText(
        "将资金、现货和 U 本位账户的 USDT 按 5:4:1 分配",
        "Allocate USDT across Funding, Spot, and USDⓈ-M Futures accounts at a 5:4:1 ratio"
      )
    })
  });

  // src/binance-strategy29-bollinger/ui-copy.js
  var pair = localizedText;
  var SUMMARY_COPY = Object.freeze({
    upgradeClient: pair("Strategy 29 本地信号已加载。跨周期汇总需要更新或安装 Strategy 27 信号客户端，并刷新页面。", "Strategy 29 local signals are loaded. Update or install the Strategy 27 signal client and reload for the cross-timeframe summary."),
    moduleDisabled: pair("服务端尚未启用 Strategy 29 监控汇总", "Strategy 29 monitoring summary is not enabled on the server"),
    gatewayUnavailable: pair("Strategy 29 后端暂不可用，等待恢复", "Strategy 29 backend is unavailable; waiting for recovery"),
    noLiveStatus: pair("当前监控状态不可用；下方仅保留历史信号。", "Current monitoring status is unavailable; only retained signals are shown below."),
    title: pair("Strategy 29 汇总", "Strategy 29 Summary"),
    drag: pair("拖动面板", "Drag panel"),
    collapse: pair("收起", "Collapse"),
    expand: pair("展开", "Expand"),
    waiting: pair("等待中", "Waiting"),
    observerSpec: (value) => pair(`观察器规格 ${value}`, `Observer spec ${value}`),
    reference: (value) => pair(`本地参考版本 ${value}`, `Local reference ${value}`),
    noStatus: pair("尚未收到状态", "Status not received"),
    noEventsCheck: pair("尚未检查事件", "Events not checked"),
    processing: pair("最近处理状态", "Last processing status"),
    processingHint: pair("已保存的处理状态不代表当前实时数据已就绪。", "Stored processing status does not confirm current live readiness."),
    waitingDelivery: pair("全局通知 — 等待中", "Global delivery — waiting"),
    recent: pair("最近跨周期信号", "Recent cross-timeframe signals"),
    noEvents: pair("暂无最近信号", "No recent signals"),
    close: (value) => pair(`收盘 ${value}`, `Close ${value}`),
    matched: (value) => pair(`规格版本一致 · ${value}`, `Spec version matched · ${value}`),
    mismatch: (local, server) => pair(`规格不一致 · 本地 ${local} · 服务端 ${server}`, `Spec mismatch · local ${local} · server ${server}`),
    statusAt: (value) => pair(`状态更新 ${value}`, `Status ${value}`),
    eventsAt: (value) => pair(`事件检查 ${value}`, `Events checked ${value}`),
    incompatibleSelection: pair("选币不可用：观察器规格不一致", "Selection unavailable: observer specs are incompatible"),
    incompatibleDelivery: pair("全局通知状态不可用：观察器规格不一致", "Global delivery unavailable: observer specs are incompatible"),
    pending: pair("等待中", "pending"),
    generation: (value) => pair(`批次 ${value}`, `Generation ${value}`),
    markets: (value) => pair(`${value} 个币种`, `${value} markets`),
    ready: (ready, total) => pair(`${ready}/${total} 个实时监测单元已就绪`, `${ready}/${total} live units ready`),
    intervals: (value) => pair(`周期 ${value}`, `Intervals ${value}`),
    noSuccess: pair("尚无成功选币记录", "No successful selection has been observed"),
    lastSuccess: (clock, age) => pair(`上次成功选币 ${clock} · ${age} 秒前`, `Last successful selection ${clock} · ${age}s ago`),
    unavailableSelection: pair("服务端选币不可用", "Server selection is unavailable"),
    awaitingUnits: pair("币种已入选，等待监测单元状态", "Symbol is selected; waiting for unit status"),
    notSelected: pair("当前服务端选币未监听此币种", "Symbol is not watched by the current server selection"),
    delivery: (c) => pair(`全局通知 · 待发送 ${c.pending} · 发送中 ${c.sending} · 已发送 ${c.sent} · 结果未知 ${c.unknown} · 已过期 ${c.expired} · 失败 ${c.failed}`, `Global delivery · Pending ${c.pending} · Sending ${c.sending} · Sent ${c.sent} · Unknown ${c.unknown} · Expired ${c.expired} · Failed ${c.failed}`),
    configuration: pair("尚未配置网关密钥", "Gateway secret is not configured"),
    connecting: pair("正在连接 Strategy 29 网关", "Connecting to Strategy 29 gateway"),
    connected: pair("已连接", "Connected"),
    moreHistory: pair("已连接 · 仍有历史记录待加载", "Connected · more history pending"),
    unavailable: pair("网关数据库暂不可用", "Gateway database unavailable"),
    incompatible: pair("服务端与本地规格不一致", "Server and local specs are incompatible"),
    disconnected: pair("网关连接失败，将在下次定时检查时重试", "Gateway connection failed; next scheduled poll will retry"),
    stopped: (detail) => pair(`远程汇总已停止。技术详情：${detail}`, `Remote summary stopped: ${detail}`),
    localStopped: (detail) => pair(`Strategy 29 已停止。技术详情：${detail}`, `Strategy 29 stopped: ${detail}`),
    conflict: pair("Strategy 29 已停止：请将订单簿脚本更新至 2.7.199 或更高版本，或禁用内嵌布林带观察器的旧版本，然后刷新页面。", "Strategy 29 stopped: update Orderbook to 2.7.199 or disable its embedded Bollinger version, then reload this page.")
  });
  var SELECTION_REASONS = Object.freeze({
    current: pair("当前选币有效", "Selection is current"),
    using_stale_selection_after_refresh_error: pair("刷新失败，暂沿用上次选币直至过期", "Refresh failed; using the previous selection until expiry"),
    selection_fail_closed: pair("刷新失败，选币不可用", "Selection unavailable after refresh failure"),
    selection_expired_or_unusable: pair("选币已过期，等待成功刷新", "Selection expired; waiting for a successful refresh"),
    missing_current_universe_facts: pair("等待服务端初始化选币", "Waiting for server selection to initialize"),
    incompatible_current_universe_facts: pair("服务端选币规格不兼容", "Server selection has an incompatible specification")
  });
  var STATUS_LABELS = Object.freeze({
    ready: pair("已处理", "Processed"),
    warming: pair("预热中", "Warming"),
    stale: pair("已过期", "Stale"),
    insufficient_history: pair("历史不足", "Insufficient history"),
    data_gap: pair("数据缺口", "Data gap"),
    failed: pair("失败", "Failed")
  });
  var SIGNAL_LABELS = Object.freeze({
    "bearish:warning": pair("看跌预警", "Bearish warning"),
    "bearish:confirmed": pair("看跌确认", "Bearish confirmed"),
    "bearish:reversal": pair("多头反转", "Long reversal"),
    "bullish:warning": pair("看涨预警", "Bullish warning"),
    "bullish:confirmed": pair("看涨确认", "Bullish confirmed"),
    "bullish:reversal": pair("空头反转", "Short reversal")
  });
  var PROCESSING_REASONS = Object.freeze({
    current: pair("进度已更新", "Progress current"),
    awaiting_producer_generation: pair("等待当前批次行情就绪", "Awaiting producer generation"),
    awaiting_initial_baseline: pair("等待建立初始历史基线", "Awaiting initial baseline"),
    awaiting_reentry_baseline: pair("等待重新入选的历史基线", "Awaiting re-entry baseline"),
    latest_closed_candle_missing: pair("缺少最新已收盘 K 线", "Latest closed candle missing"),
    observer_progress_stale: pair("观察器进度已过期", "Observer progress stale")
  });
  function processingReason(reason, locale) {
    if (Object.hasOwn(PROCESSING_REASONS, reason)) return formatLocalizedText(PROCESSING_REASONS[reason], locale);
    const required = /^requires_(\d+)_closed_candles$/.exec(reason);
    if (required) return formatLocalizedText(pair(`需要 ${required[1]} 根已收盘 K 线`, `Requires ${required[1]} closed candles`), locale);
    return formatLocalizedText(pair(`技术详情：${reason}`, `Details: ${reason}`), locale);
  }

  // src/binance-strategy29-bollinger/dom/panel-position.js
  function installPanelPosition(document, panel, header, { initialPosition, savePosition }) {
    const view = document.defaultView;
    if (!view) throw new Error("Strategy 29 panel window is unavailable");
    let position = initialPosition ?? { left: view.innerWidth - panel.getBoundingClientRect().width - 84, top: 68 };
    let drag = null;
    function apply(next) {
      const rect = panel.getBoundingClientRect();
      position = {
        left: Math.max(0, Math.min(next.left, Math.max(0, view.innerWidth - rect.width))),
        top: Math.max(0, Math.min(next.top, Math.max(0, view.innerHeight - rect.height)))
      };
      panel.style.left = `${position.left}px`;
      panel.style.top = `${position.top}px`;
      panel.style.right = "auto";
    }
    function clamp() {
      apply(position);
    }
    function onDown(event) {
      if (drag || !event.isPrimary || event.button !== 0 || event.buttons !== 1 || event.target.closest("button,a")) return;
      const rect = panel.getBoundingClientRect();
      header.setPointerCapture(event.pointerId);
      drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
      event.preventDefault();
    }
    function onMove(event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      apply({ left: drag.left + event.clientX - drag.x, top: drag.top + event.clientY - drag.y });
    }
    function release() {
      const { pointerId } = drag;
      drag = null;
      if (header.hasPointerCapture(pointerId)) header.releasePointerCapture(pointerId);
    }
    function finish() {
      if (!drag) return;
      release();
      clamp();
      savePosition({ ...position });
    }
    function onEnd(event) {
      if (drag && event.pointerId === drag.pointerId) finish();
    }
    clamp();
    header.style.cursor = "move";
    header.style.touchAction = "none";
    header.addEventListener("pointerdown", onDown);
    header.addEventListener("pointermove", onMove);
    header.addEventListener("pointerup", onEnd);
    header.addEventListener("pointercancel", onEnd);
    header.addEventListener("lostpointercapture", onEnd);
    view.addEventListener("blur", finish);
    view.addEventListener("resize", clamp);
    return Object.freeze({
      clamp,
      destroy() {
        if (drag) release();
        header.removeEventListener("pointerdown", onDown);
        header.removeEventListener("pointermove", onMove);
        header.removeEventListener("pointerup", onEnd);
        header.removeEventListener("pointercancel", onEnd);
        header.removeEventListener("lostpointercapture", onEnd);
        view.removeEventListener("blur", finish);
        view.removeEventListener("resize", clamp);
      }
    });
  }

  // src/binance-strategy29-bollinger/dom/strategy29-summary-panel.js
  var PANEL_ID = "jh-strategy29-summary-panel";
  function newestSignalFirst(left, right) {
    return right.bar_close_ms - left.bar_close_ms || right.sequence - left.sequence;
  }
  var STATE_COLORS = Object.freeze({
    disabled: "#848E9C",
    module_disabled: "#848E9C",
    gateway_unavailable: "#F0B90B",
    connected: "#0ECB81",
    connecting: "#F0B90B",
    unavailable: "#F0B90B",
    disconnected: "#F6465D",
    stopped: "#F6465D",
    incompatible: "#F6465D",
    configuration_required: "#F0B90B"
  });
  var STATUS_COLORS = Object.freeze({
    ready: "#848E9C",
    warming: "#F0B90B",
    stale: "#F6465D",
    insufficient_history: "#F0B90B",
    data_gap: "#F6465D",
    failed: "#F6465D"
  });
  var CLOCK_FORMATTER = new Intl.DateTimeFormat("en-GB", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai"
  });
  function element(document, tagName, { text = "", role = null, styles = null } = {}) {
    const node = document.createElement(tagName);
    node.textContent = text;
    if (role) node.dataset.role = role;
    if (styles) Object.assign(node.style, styles);
    return node;
  }
  function formatClock(timestampMs) {
    const date = new Date(timestampMs);
    const parts = CLOCK_FORMATTER.formatToParts(date);
    const part = (name) => parts.find((item) => item.type === name)?.value;
    return `${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")} UTC+08`;
  }
  function createStrategy29SummaryPanel(document, canonicalSymbol, { maxEvents = 20, locale = resolveUiLocaleFromPathname(document.location.pathname), loadPosition, savePosition } = {}) {
    if (!document?.body) throw new Error("Strategy 29 summary panel requires document.body");
    if (typeof canonicalSymbol !== "string" || canonicalSymbol.length === 0) throw new Error("Strategy 29 panel symbol is invalid");
    if (!Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > 100) throw new Error("Strategy 29 panel maxEvents is invalid");
    const text = (value) => formatLocalizedText(value, locale);
    text(SUMMARY_COPY.waiting);
    if (typeof loadPosition !== "function" || typeof savePosition !== "function") throw new TypeError("Strategy 29 panel position adapters are required");
    const stored = loadPosition();
    if (stored !== null && (!stored || typeof stored !== "object" || !Number.isFinite(stored.left) || !Number.isFinite(stored.top))) throw new TypeError("Strategy 29 panel position is invalid");
    document.getElementById(PANEL_ID)?.remove();
    const panel = element(document, "section", {
      styles: {
        position: "fixed",
        zIndex: "999995",
        left: "0",
        top: "0",
        width: "340px",
        boxSizing: "border-box",
        maxWidth: "calc(100vw - 112px)",
        maxHeight: "calc(100vh - 92px)",
        overflow: "hidden",
        border: "1px solid rgba(132,142,156,.30)",
        borderRadius: "9px",
        background: "rgba(24,26,32,.96)",
        boxShadow: "0 5px 18px rgba(0,0,0,.30)",
        color: "#EAECEF",
        font: "12px/17px BinancePlex,ui-sans-serif,system-ui,sans-serif",
        pointerEvents: "auto",
        userSelect: "none"
      }
    });
    panel.id = PANEL_ID;
    const header = element(document, "header", {
      styles: { display: "flex", alignItems: "center", gap: "7px", padding: "8px 10px", borderBottom: "1px solid rgba(132,142,156,.20)" }
    });
    const heading = element(document, "strong", { text: text(SUMMARY_COPY.title), styles: { flex: "1", fontSize: "13px" } });
    header.appendChild(element(document, "span", { text: "☰", styles: { color: "#848E9C" } }));
    header.appendChild(heading);
    header.title = text(SUMMARY_COPY.drag);
    const collapse = element(document, "button", {
      text: text(SUMMARY_COPY.collapse),
      role: "collapse",
      styles: { border: "0", borderRadius: "5px", padding: "2px 7px", background: "rgba(132,142,156,.18)", color: "#EAECEF", cursor: "pointer" }
    });
    collapse.type = "button";
    header.appendChild(collapse);
    const body = element(document, "div", { role: "body", styles: { maxHeight: "calc(100vh - 150px)", overflow: "auto" } });
    const overview = element(document, "div", { styles: { display: "grid", gap: "4px", padding: "9px 10px" } });
    overview.appendChild(element(document, "div", { text: canonicalSymbol, role: "symbol", styles: { fontWeight: "700" } }));
    const connection = element(document, "div", { text: text(SUMMARY_COPY.waiting), role: "connection", styles: { color: "#848E9C", fontSize: "11px" } });
    const spec = element(document, "div", { text: text(SUMMARY_COPY.observerSpec(STRATEGY29_API_SPEC_VERSION)), role: "spec", styles: { color: "#848E9C", fontSize: "11px" } });
    const reference = element(document, "div", { text: text(SUMMARY_COPY.reference(STRATEGY29_REFERENCE_SHA256)), role: "reference", styles: { color: "#848E9C", fontSize: "10px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", userSelect: "text" } });
    const statusFreshness = element(document, "div", { text: text(SUMMARY_COPY.noStatus), role: "status-freshness", styles: { color: "#848E9C", fontSize: "11px" } });
    const eventsFreshness = element(document, "div", { text: text(SUMMARY_COPY.noEventsCheck), role: "events-freshness", styles: { color: "#848E9C", fontSize: "11px" } });
    const selection = element(document, "div", { role: "selection", styles: { color: "#EAECEF", fontSize: "11px" } });
    const selectionRefresh = element(document, "div", { role: "selection-refresh", styles: { color: "#848E9C", fontSize: "11px" } });
    overview.append(connection, spec, reference, statusFreshness, selection, selectionRefresh, eventsFreshness);
    const unitsTitle = element(document, "div", { text: text(SUMMARY_COPY.processing), styles: { padding: "7px 10px 4px", borderTop: "1px solid rgba(132,142,156,.18)", color: "#848E9C", fontWeight: "600" } });
    const processingHint = element(document, "div", {
      text: text(SUMMARY_COPY.processingHint),
      styles: { fontSize: "11px", fontWeight: "400" }
    });
    unitsTitle.appendChild(processingHint);
    const units = element(document, "div", { role: "units", styles: { display: "grid", gap: "3px", padding: "0 7px 8px" } });
    const delivery = element(document, "div", { text: text(SUMMARY_COPY.waitingDelivery), role: "delivery", styles: { padding: "7px 10px", borderTop: "1px solid rgba(132,142,156,.18)", color: "#848E9C", fontSize: "11px" } });
    const eventsTitle = element(document, "div", { text: text(SUMMARY_COPY.recent), styles: { padding: "7px 10px 4px", borderTop: "1px solid rgba(132,142,156,.18)", color: "#848E9C", fontWeight: "600" } });
    const events = element(document, "div", { role: "events", styles: { display: "grid", gap: "3px", padding: "0 7px 8px" } });
    body.append(overview, unitsTitle, units, delivery, eventsTitle, events);
    panel.append(header, body);
    document.body.appendChild(panel);
    const position = installPanelPosition(document, panel, header, { initialPosition: stored, savePosition });
    const eventRecords = /* @__PURE__ */ new Map();
    let lastStatus = null;
    function clearCurrentStatus() {
      lastStatus = null;
      spec.dataset.state = "unavailable";
      spec.style.color = "#848E9C";
      spec.textContent = text(SUMMARY_COPY.observerSpec(STRATEGY29_API_SPEC_VERSION));
      statusFreshness.textContent = text(SUMMARY_COPY.noStatus);
      selection.dataset.state = "unavailable";
      selection.style.color = "#848E9C";
      selection.textContent = text(SUMMARY_COPY.noLiveStatus);
      selectionRefresh.textContent = "";
      units.replaceChildren();
      delivery.textContent = text(SUMMARY_COPY.waitingDelivery);
    }
    let lastEventsAt = null;
    let connectionCopy = SUMMARY_COPY.waiting;
    let destroyed = false;
    function assertLive() {
      if (destroyed) throw new Error("Strategy 29 summary panel is destroyed");
    }
    function renderEvents(ordered) {
      events.replaceChildren();
      for (const event of ordered) {
        const row = element(document, "div", {
          role: "remote-event",
          styles: { display: "grid", gridTemplateColumns: "36px minmax(0,1fr) 116px", gap: "6px", alignItems: "center", padding: "5px 6px", borderRadius: "5px", background: "rgba(132,142,156,.08)" }
        });
        row.dataset.eventId = event.event_id;
        row.appendChild(element(document, "strong", { text: event.timeframe, styles: { color: "#F0B90B" } }));
        row.appendChild(element(document, "span", {
          text: text(SIGNAL_LABELS[`${event.setup_direction}:${event.signal_type}`]),
          styles: { color: event.signal_side === "long" ? "#0ECB81" : "#F6465D", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }
        }));
        row.appendChild(element(document, "span", { text: text(SUMMARY_COPY.close(formatClock(event.bar_close_ms))), styles: { color: "#848E9C", fontSize: "10px", textAlign: "right" } }));
        events.appendChild(row);
      }
      if (ordered.length === 0) events.appendChild(element(document, "span", { text: text(SUMMARY_COPY.noEvents), styles: { color: "#848E9C", padding: "4px" } }));
    }
    collapse.addEventListener("click", () => {
      const collapsed = body.style.display !== "none";
      body.style.display = collapsed ? "none" : "block";
      collapse.textContent = text(collapsed ? SUMMARY_COPY.expand : SUMMARY_COPY.collapse);
      position.clamp();
    });
    renderEvents([]);
    const api = Object.freeze({
      setLocale(nextLocale) {
        assertLive();
        formatLocalizedText(SUMMARY_COPY.waiting, nextLocale);
        if (locale === nextLocale) return;
        locale = nextLocale;
        heading.textContent = text(SUMMARY_COPY.title);
        header.title = text(SUMMARY_COPY.drag);
        collapse.textContent = text(body.style.display === "none" ? SUMMARY_COPY.expand : SUMMARY_COPY.collapse);
        connection.textContent = text(connectionCopy);
        reference.textContent = text(SUMMARY_COPY.reference(STRATEGY29_REFERENCE_SHA256));
        unitsTitle.firstChild.textContent = text(SUMMARY_COPY.processing);
        processingHint.textContent = text(SUMMARY_COPY.processingHint);
        eventsTitle.textContent = text(SUMMARY_COPY.recent);
        eventsFreshness.textContent = text(lastEventsAt === null ? SUMMARY_COPY.noEventsCheck : SUMMARY_COPY.eventsAt(formatClock(lastEventsAt)));
        if (lastStatus !== null) api.renderStatus(lastStatus);
        else clearCurrentStatus();
        renderEvents([...eventRecords.values()].sort(newestSignalFirst));
        position.clamp();
      },
      setConnection(state, message) {
        assertLive();
        if (!(state in STATE_COLORS)) throw new Error("Strategy 29 panel connection state is invalid");
        connection.dataset.state = state;
        connection.style.color = STATE_COLORS[state];
        connectionCopy = message;
        connection.textContent = text(message);
        if (["disabled", "module_disabled", "gateway_unavailable", "unavailable"].includes(state)) clearCurrentStatus();
        position.clamp();
      },
      renderStatus(snapshot) {
        assertLive();
        lastStatus = snapshot;
        const matched = snapshot.spec_version === STRATEGY29_API_SPEC_VERSION;
        spec.dataset.state = matched ? "matched" : "error";
        spec.style.color = matched ? "#0ECB81" : "#F6465D";
        spec.textContent = matched ? text(SUMMARY_COPY.matched(STRATEGY29_API_SPEC_VERSION)) : text(SUMMARY_COPY.mismatch(STRATEGY29_API_SPEC_VERSION, snapshot.spec_version));
        statusFreshness.textContent = text(SUMMARY_COPY.statusAt(formatClock(snapshot.observed_at_ms)));
        if (!matched) {
          selection.dataset.state = "incompatible";
          selection.style.color = "#F6465D";
          selection.textContent = text(SUMMARY_COPY.incompatibleSelection);
          selectionRefresh.textContent = "";
          units.replaceChildren();
          delivery.textContent = text(SUMMARY_COPY.incompatibleDelivery);
          position.clamp();
          return;
        }
        const universe = snapshot.universe;
        const unavailable = universe.refresh_status === "fail_closed";
        selection.dataset.state = universe.refresh_status;
        selection.style.color = unavailable ? "#F6465D" : universe.refresh_status === "fresh" ? "#0ECB81" : "#F0B90B";
        selection.textContent = [text(SELECTION_REASONS[universe.reason]), text(SUMMARY_COPY.generation(universe.generation ?? text(SUMMARY_COPY.pending))), text(SUMMARY_COPY.markets(universe.selected_markets.length)), text(SUMMARY_COPY.ready(universe.ready_unit_count, universe.selected_unit_count)), text(SUMMARY_COPY.intervals(universe.configured_timeframes.join(", ") || text(SUMMARY_COPY.pending)))].join(" · ");
        selectionRefresh.textContent = universe.last_successful_refreshed_at_ms === null ? text(SUMMARY_COPY.noSuccess) : text(SUMMARY_COPY.lastSuccess(formatClock(universe.last_successful_refreshed_at_ms), universe.last_success_age_seconds.toFixed(1)));
        units.replaceChildren();
        const selected = universe.selected_markets.includes(canonicalSymbol);
        const matching = unavailable || !selected ? [] : snapshot.units.filter((unit) => unit.symbol === canonicalSymbol && universe.configured_timeframes.includes(unit.timeframe));
        for (const unit of matching) {
          const row = element(document, "div", {
            role: "unit",
            styles: { display: "grid", gridTemplateColumns: "36px 78px minmax(0,1fr)", gap: "6px", padding: "4px 6px", borderRadius: "5px", background: "rgba(132,142,156,.08)" }
          });
          row.appendChild(element(document, "strong", { text: unit.timeframe, styles: { color: "#EAECEF" } }));
          row.appendChild(element(document, "span", { text: text(STATUS_LABELS[unit.status]), styles: { color: STATUS_COLORS[unit.status] } }));
          row.appendChild(element(document, "span", { text: processingReason(unit.reason, locale), styles: { color: "#848E9C", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }));
          units.appendChild(row);
        }
        if (matching.length === 0) units.appendChild(element(document, "span", {
          text: text(unavailable ? SUMMARY_COPY.unavailableSelection : selected ? SUMMARY_COPY.awaitingUnits : SUMMARY_COPY.notSelected),
          styles: { color: "#F0B90B", padding: "4px" }
        }));
        const counts = snapshot.delivery_counts;
        delivery.textContent = text(SUMMARY_COPY.delivery(counts));
        position.clamp();
      },
      addEvents(incoming, observedAtMs = null) {
        assertLive();
        if (incoming.length > 0) {
          for (const event of incoming) eventRecords.set(event.event_id, event);
          const ordered = [...eventRecords.values()].sort(newestSignalFirst);
          while (ordered.length > maxEvents) eventRecords.delete(ordered.pop().event_id);
          renderEvents(ordered);
        }
        if (observedAtMs !== null) {
          lastEventsAt = observedAtMs;
          eventsFreshness.textContent = text(SUMMARY_COPY.eventsAt(formatClock(observedAtMs)));
        }
        position.clamp();
      },
      clearEvents() {
        assertLive();
        eventRecords.clear();
        renderEvents([]);
        position.clamp();
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        eventRecords.clear();
        position.destroy();
        panel.remove();
      },
      get size() {
        return eventRecords.size;
      }
    });
    position.clamp();
    return api;
  }

  // src/binance-strategy29-bollinger/remote-summary.js
  var STRATEGY29_PANEL_POSITION_KEY = "strategy29SummaryPanelPosition";
  var STRATEGY29_REMOTE_POLL_INTERVAL_MS = 5e3;
  function abortError(view, message) {
    const ErrorConstructor = view.DOMException ?? DOMException;
    return new ErrorConstructor(message, "AbortError");
  }
  function assertAdapters({ view, request, getValue, setValue, getGatewayState, createPanel, createClient }) {
    if (!view?.document || !view?.location) throw new TypeError("Strategy 29 remote summary requires a page window");
    for (const [name, value] of Object.entries({
      request,
      getValue,
      setValue,
      getGatewayState,
      createPanel,
      createClient
    })) {
      if (typeof value !== "function") throw new TypeError(`Strategy 29 remote summary ${name} is invalid`);
    }
  }
  function createStrategy29RemoteSummary({
    view,
    request,
    getValue,
    setValue,
    getGatewayState,
    createPanel = createStrategy29SummaryPanel,
    createClient = createStrategy29SummaryClient,
    pollIntervalMs = STRATEGY29_REMOTE_POLL_INTERVAL_MS
  }) {
    assertAdapters({ view, request, getValue, setValue, getGatewayState, createPanel, createClient });
    if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 1e3) throw new TypeError("Strategy 29 remote poll interval is invalid");
    let active = null;
    let disposed = false;
    let unsupportedRoute = null;
    let moduleFailure = null;
    let gatewayAvailable = false;
    let failureNotice = null;
    let locale = resolveUiLocaleFromPathname(view.location.pathname);
    function isCurrent(context) {
      return !disposed && active === context && !context.abortController.signal.aborted;
    }
    function stopActive(reason = "Strategy 29 remote context retired") {
      if (!active) return;
      const context = active;
      active = null;
      context.abortController.abort(abortError(view, reason));
      context.panel.destroy();
    }
    function startContext(routeSymbol, gatewayState, canonicalSymbol) {
      const panel = createPanel(view.document, canonicalSymbol, {
        maxEvents: 20,
        locale,
        loadPosition: () => getValue(STRATEGY29_PANEL_POSITION_KEY, null),
        savePosition: (position) => setValue(STRATEGY29_PANEL_POSITION_KEY, position)
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
        state: "idle",
        lastError: null,
        lastResult: null
      };
      active = context;
      if (!gatewayState.configured) {
        context.state = "configuration_required";
        panel.setConnection("configuration_required", SUMMARY_COPY.configuration);
        return context;
      }
      try {
        context.client = createClient({
          request,
          canonicalSymbol,
          maxPagesPerPoll: 2,
          onStatus: (snapshot) => {
            if (isCurrent(context)) context.panel.renderStatus(snapshot);
          },
          onEvents: (events, observedAtMs) => {
            if (isCurrent(context)) context.panel.addEvents(events, observedAtMs);
          },
          onCursorReset: () => {
            if (isCurrent(context)) context.panel.clearEvents();
          }
        });
      } catch (error) {
        context.failed = true;
        context.state = "stopped";
        context.lastError = error.message;
        panel.setConnection("stopped", SUMMARY_COPY.stopped(error.message));
        view.console.warn("[Strategy29 remote]", error.message);
      }
      return context;
    }
    function synchronizeContext() {
      if (!view.document.body) {
        unsupportedRoute = null;
        stopActive("Strategy 29 remote summary disabled");
        return null;
      }
      const routeSymbol = parseFuturesTradingSymbolFromPathname(view.location.pathname);
      if (!routeSymbol) {
        unsupportedRoute = null;
        stopActive("Strategy 29 route changed");
        return null;
      }
      const gatewayState = getGatewayState();
      gatewayAvailable = gatewayState.available;
      if (!gatewayState.available) {
        stopActive("Shared signal gateway unavailable");
        return null;
      }
      if (active?.routeSymbol === routeSymbol && active.gatewayState.settingsRevision === gatewayState.settingsRevision && active.gatewayState.configured === gatewayState.configured) return active;
      if (unsupportedRoute === routeSymbol) return null;
      unsupportedRoute = null;
      stopActive("Strategy 29 route changed");
      let canonicalSymbol;
      try {
        canonicalSymbol = routeSymbolToCanonical(routeSymbol);
      } catch (error) {
        unsupportedRoute = routeSymbol;
        stopActive("Strategy 29 remote context initialization failed");
        view.console.warn("[Strategy29 remote]", error.message);
        return null;
      }
      return startContext(routeSymbol, gatewayState, canonicalSymbol);
    }
    function sampleRemote(nowMs) {
      if (disposed || view.document.hidden) return;
      synchronizeLocale();
      const context = synchronizeContext();
      if (!context || !context.client || context.inFlight || context.failed || nowMs < context.nextPollAtMs) return;
      if (context.abortController.signal.aborted) {
        const AbortControllerConstructor = view.AbortController ?? AbortController;
        context.abortController = new AbortControllerConstructor();
      }
      const controller = context.abortController;
      const ownsRequest = () => isCurrent(context) && context.abortController === controller && getGatewayState().settingsRevision === context.gatewayState.settingsRevision;
      context.nextPollAtMs = nowMs + pollIntervalMs;
      context.inFlight = true;
      if (context.state === "idle") {
        context.state = "connecting";
        context.panel.setConnection("connecting", SUMMARY_COPY.connecting);
      }
      return context.client.poll(controller.signal).then((result) => {
        if (!ownsRequest()) return;
        context.lastResult = result;
        context.lastError = null;
        context.state = result.state;
        const presentation = {
          connected: ["connected", result.hasMore ? SUMMARY_COPY.moreHistory : SUMMARY_COPY.connected],
          unavailable: ["unavailable", SUMMARY_COPY.unavailable],
          module_disabled: ["module_disabled", SUMMARY_COPY.moduleDisabled],
          gateway_unavailable: ["gateway_unavailable", SUMMARY_COPY.gatewayUnavailable],
          incompatible: ["incompatible", SUMMARY_COPY.incompatible]
        }[result.state];
        if (!presentation) throw new Error(`Strategy 29 remote state is invalid: ${result.state}`);
        context.panel.setConnection(...presentation);
      }).catch((error) => {
        if (!ownsRequest() || error?.name === "AbortError") return;
        context.lastError = error.message;
        if (error instanceof Strategy29GatewayTransportError) {
          context.state = "disconnected";
          context.panel.setConnection("disconnected", SUMMARY_COPY.disconnected);
        } else {
          context.state = "stopped";
          context.failed = true;
          context.panel.setConnection("stopped", SUMMARY_COPY.stopped(error.message));
        }
        view.console.warn("[Strategy29 remote]", error.message);
      }).finally(() => {
        if (ownsRequest()) context.inFlight = false;
      });
    }
    function showModuleFailure() {
      if (!view.document.body) return;
      if (failureNotice === null) {
        const notice = view.document.createElement("div");
        notice.id = "jh-strategy29-summary-error";
        notice.setAttribute("role", "status");
        notice.style.cssText = "position:fixed;left:16px;top:68px;z-index:10000;max-width:420px;padding:10px;background:#332b16;color:#ffcf67;font:13px sans-serif;pointer-events:none";
        view.document.body.append(notice);
        failureNotice = notice;
      }
      failureNotice.textContent = formatLocalizedText(SUMMARY_COPY.stopped(moduleFailure), resolveUiLocaleFromPathname(view.location.pathname));
    }
    function failModule(error) {
      moduleFailure = error.message;
      stopActive("Strategy 29 remote provider failed");
      showModuleFailure();
      view.console.warn("[Strategy29 remote]", error.message);
    }
    function sample(nowMs = Date.now()) {
      if (disposed || view.document.hidden) return;
      if (moduleFailure !== null) {
        showModuleFailure();
        return;
      }
      try {
        return sampleRemote(nowMs)?.catch(failModule);
      } catch (error) {
        failModule(error);
      }
    }
    function restart() {
      unsupportedRoute = null;
      stopActive("Strategy 29 remote settings changed");
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
        active.abortController.abort(abortError(view, "Strategy 29 remote summary paused"));
        active.inFlight = false;
        active.nextPollAtMs = 0;
      },
      restart,
      dispose() {
        if (disposed) return;
        disposed = true;
        stopActive("Strategy 29 remote summary disposed");
        failureNotice?.remove();
        failureNotice = null;
      },
      get diagnostics() {
        return Object.freeze({
          contextPresent: active !== null,
          canonicalSymbol: active?.canonicalSymbol ?? null,
          gatewayRevision: active?.gatewayState.settingsRevision ?? null,
          state: moduleFailure !== null ? "stopped" : active?.state ?? (unsupportedRoute ? "unsupported_route" : !gatewayAvailable ? "waiting_for_gateway" : "waiting_for_route"),
          inFlight: active?.inFlight ?? false,
          stopped: moduleFailure !== null || (active?.failed ?? false),
          lastError: moduleFailure ?? active?.lastError ?? null,
          lastResult: active?.lastResult ?? null,
          cursor: active?.client?.diagnostics.cursor ?? null,
          specVersion: STRATEGY29_API_SPEC_VERSION,
          referenceSha256: STRATEGY29_REFERENCE_SHA256
        });
      }
    });
  }

  // src/shared/signal-gateway-bridge.js
  var SIGNAL_GATEWAY_BRIDGE = Symbol.for("jh-userscripts.signal-gateway");
  var MAX_RESPONSE_LENGTH = 2 * 1024 * 1024;

  // src/binance-strategy29-bollinger/runtime.js
  var INSTANCE = Symbol.for("jh-userscripts.strategy29-bollinger");
  var RUNTIME_VERSION = 4;
  var CONFLICT = SUMMARY_COPY.conflict;
  function hasEmbeddedBollinger(view) {
    const debug = view.__TM_CLOSE_LONG_DEBUG__;
    return !!debug && Object.getOwnPropertyDescriptor(debug, "bollingerAlertState") !== void 0;
  }
  function installStrategy29(view, remoteAdapters = null) {
    if (view[INSTANCE] !== void 0) {
      if (view[INSTANCE].version !== RUNTIME_VERSION) throw new Error("Incompatible Strategy 29 runtime; reload the page");
      return view[INSTANCE].runtime;
    }
    const document = view.document;
    let timer = null;
    let failed = null;
    let disposed = false;
    let removeRouteListener = null;
    const remoteSummary = remoteAdapters === null ? null : createStrategy29RemoteSummary({ view, ...remoteAdapters });
    const noticeId = "jh-strategy29-bollinger-status";
    const upgradeNoticeId = "jh-strategy29-client-upgrade";
    function showUpgradeNotice() {
      if (disposed || view[SIGNAL_GATEWAY_BRIDGE]?.version === 1 || !isFuturesTradingPathname(view.location.pathname)) {
        document.getElementById(upgradeNoticeId)?.remove();
        return;
      }
      if (!document.body) return;
      let notice = document.getElementById(upgradeNoticeId);
      if (!notice) {
        notice = document.createElement("div");
        notice.id = upgradeNoticeId;
        notice.setAttribute("role", "status");
        notice.style.cssText = "position:fixed;left:16px;top:16px;z-index:10000;max-width:420px;padding:10px;background:#332b16;color:#ffcf67;font:13px sans-serif;pointer-events:none";
        document.body.append(notice);
      }
      notice.textContent = formatLocalizedText(SUMMARY_COPY.upgradeClient, resolveUiLocaleFromPathname(view.location.pathname));
    }
    function showFailure() {
      if (!failed || !document.body) return;
      let notice = document.getElementById(noticeId);
      if (!notice) {
        notice = document.createElement("div");
        notice.id = noticeId;
        notice.setAttribute("role", "status");
        notice.style.cssText = "position:fixed;left:16px;bottom:16px;z-index:10000;max-width:420px;padding:10px;background:#332b16;color:#ffcf67;font:13px sans-serif;pointer-events:none";
        document.body.append(notice);
      }
      notice.textContent = formatLocalizedText(failed, resolveUiLocaleFromPathname(view.location.pathname));
    }
    const monitor = createBollingerMonitor({
      document,
      getCurrentSymbol: () => parseFuturesTradingSymbolFromPathname(view.location.pathname),
      isFuturesTradingPage: () => !disposed && !failed && isFuturesTradingPathname(view.location.pathname),
      isTradingViewDrawingMutationBusy: () => hasEmbeddedBollinger(view) || isChartMutationBlocked(view),
      err: (...args) => view.console.error("[Strategy29]", ...args),
      warn: (...args) => view.console.warn("[Strategy29]", ...args)
    });
    function pause() {
      if (timer !== null) view.clearInterval(timer);
      timer = null;
      monitor.stop();
      remoteSummary?.pause();
    }
    function fail(message) {
      failed = message;
      pause();
      remoteSummary?.dispose();
      showFailure();
    }
    function sample() {
      if (disposed || document.hidden) return;
      showUpgradeNotice();
      if (failed) {
        showFailure();
        return;
      }
      if (hasEmbeddedBollinger(view)) {
        fail(CONFLICT);
        return;
      }
      ensureSpaRouteChangePatched(view);
      void remoteSummary?.sample(Date.now());
      if (!isFuturesTradingPathname(view.location.pathname)) {
        monitor.stop();
        return;
      }
      void monitor.tick().catch((error) => fail(SUMMARY_COPY.localStopped(error.message)));
    }
    function resume() {
      if (disposed || failed || document.hidden) return;
      sample();
      if (!failed && timer === null) timer = view.setInterval(sample, 1e3);
    }
    function onVisibility() {
      if (document.hidden) pause();
      else resume();
    }
    function onPageHide(event) {
      if (event.persisted) pause();
      else runtime.dispose();
    }
    function onPageShow() {
      resume();
    }
    const runtime = Object.freeze({
      get diagnostics() {
        return {
          ...monitor.diagnostics,
          runtimeFailure: failed === null ? null : formatLocalizedText(failed, "en"),
          disposed,
          timerRunning: timer !== null,
          remoteSummary: remoteSummary?.diagnostics ?? Object.freeze({ enabled: false, state: "unavailable_in_this_installation" })
        };
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        pause();
        remoteSummary?.dispose();
        removeRouteListener();
        document.removeEventListener("visibilitychange", onVisibility);
        document.removeEventListener("DOMContentLoaded", showFailure);
        document.removeEventListener("DOMContentLoaded", showUpgradeNotice);
        view.removeEventListener("pagehide", onPageHide);
        view.removeEventListener("pageshow", onPageShow);
        document.getElementById(noticeId)?.remove();
        document.getElementById(upgradeNoticeId)?.remove();
      }
    });
    Object.defineProperty(view, INSTANCE, { value: Object.freeze({ version: RUNTIME_VERSION, runtime }) });
    Object.defineProperty(view, "__TM_STRATEGY29_DEBUG__", { value: runtime });
    removeRouteListener = installSpaRouteChangeListener(view, sample);
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("DOMContentLoaded", showFailure, { once: true });
    document.addEventListener("DOMContentLoaded", showUpgradeNotice, { once: true });
    view.addEventListener("pagehide", onPageHide);
    view.addEventListener("pageshow", onPageShow);
    resume();
    return runtime;
  }

  // src/binance-strategy29-bollinger/core/shared-gateway-client.js
  function createSharedGatewayClient(view) {
    function bridge() {
      const value = view[SIGNAL_GATEWAY_BRIDGE];
      if (value === void 0) return null;
      if (value.version !== 1 || typeof value.getState !== "function" || typeof value.request !== "function") {
        throw new TypeError("Shared signal gateway version is incompatible; update both scripts and reload");
      }
      return value;
    }
    function getGatewayState() {
      const api = bridge();
      if (api === null) return { available: false, configured: false, settingsRevision: null };
      const state = api.getState();
      if (typeof state.available !== "boolean" || typeof state.configured !== "boolean" || !Number.isSafeInteger(state.settingsRevision) || state.settingsRevision < 0) {
        throw new TypeError("Shared signal gateway state is invalid");
      }
      return { available: state.available, configured: state.configured, settingsRevision: state.settingsRevision };
    }
    return Object.freeze({
      getGatewayState,
      async request({ path, signal }) {
        const api = bridge();
        if (api === null) throw new Strategy29GatewayTransportError("Shared signal gateway is unavailable");
        const revision = api.getState().settingsRevision;
        const result = await api.request(path, signal);
        if (signal.aborted) throw signal.reason;
        if (view[SIGNAL_GATEWAY_BRIDGE] !== api || api.getState().settingsRevision !== revision || result.kind === "aborted") {
          throw new view.DOMException("Shared signal gateway request retired", "AbortError");
        }
        if (result.kind === "transport_error") throw new Strategy29GatewayTransportError("Shared signal gateway transport failure");
        if (result.kind !== "response" || !Number.isInteger(result.status) || typeof result.responseText !== "string" || Object.keys(result).sort().join(",") !== "kind,responseText,status") {
          throw new TypeError("Shared signal gateway response is invalid");
        }
        return { status: result.status, responseText: result.responseText };
      }
    });
  }

  // src/shared/strategy29-panel-position-handoff.js
  var HANDOFF = Symbol.for("jh-userscripts.strategy29-panel-position-handoff");
  var POSITION_KEY = "strategy29SummaryPanelPosition";
  var VERSION_KEY = "strategy29PanelPositionHandoffVersion";
  function copyPosition(value) {
    if (value === null) return null;
    if (!value || typeof value !== "object" || Object.keys(value).sort().join(",") !== "left,top" || !Number.isFinite(value.left) || !Number.isFinite(value.top)) {
      throw new TypeError("Previous Strategy 29 panel position is invalid");
    }
    return Object.freeze({ left: value.left, top: value.top });
  }
  function createStrategy29PositionReader(view, getValue, setValue) {
    return (key, initial) => {
      if (key !== POSITION_KEY) throw new TypeError("Strategy29 position reader received an unexpected key");
      const version = getValue(VERSION_KEY, null);
      if (version !== null && version !== 1) throw new TypeError("Strategy29 position handoff version is invalid");
      if (version === null) {
        const record = view[HANDOFF];
        if (!record || record.version !== 1 || Object.keys(record).sort().join(",") !== "position,version") {
          throw new TypeError("Previous Strategy 29 panel position handoff is invalid");
        }
        const position = copyPosition(record.position);
        if (position !== null) setValue(POSITION_KEY, { ...position });
        setValue(VERSION_KEY, 1);
      }
      return getValue(key, initial);
    };
  }

  // src/binance-strategy29-bollinger/index.user.js
  installStrategy29(unsafeWindow, {
    ...createSharedGatewayClient(unsafeWindow),
    getValue: createStrategy29PositionReader(unsafeWindow, GM_getValue, GM_setValue),
    setValue: GM_setValue
  });
})();
