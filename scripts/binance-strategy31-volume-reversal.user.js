// ==UserScript==
// @name         【自写】Binance Strategy 31 Volume Reversal
// @namespace    binance.strategy31.volume-reversal
// @icon         data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%23f0b90b%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2249%22%20text-anchor%3D%22middle%22%20font-family%3D%22Arial%2C%20sans-serif%22%20font-size%3D%2242%22%20font-weight%3D%22800%22%20fill%3D%22%23111827%22%3EJ%3C%2Ftext%3E%3C%2Fsvg%3E
// @icon64       data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%23f0b90b%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2249%22%20text-anchor%3D%22middle%22%20font-family%3D%22Arial%2C%20sans-serif%22%20font-size%3D%2242%22%20font-weight%3D%22800%22%20fill%3D%22%23111827%22%3EJ%3C%2Ftext%3E%3C%2Fsvg%3E
// @version      0.1.2
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
  var TRADING_SYMBOL_RE = new RegExp(`^[${BINANCE_SYMBOL_CHARACTERS}]+(?:USDT|USDC)$`, "iu");
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

  // src/shared/chart-marker-overlay.js
  function createChartMarkerOverlay(target, {
    maxMarkers,
    canMutate = () => true,
    onRenderError
  } = {}) {
    if (!Number.isSafeInteger(maxMarkers) || maxMarkers < 1) throw new Error("TradingView overlay marker limit is invalid");
    const { chart } = target;
    const document = target.chartRoot.ownerDocument;
    const owner = {};
    const subscriptions = [];
    const nodes = /* @__PURE__ */ new Map();
    let svg = null, host = null, frame = null, observer = null, projection = null;
    let signals = [], validateCurrent = null, invalidated = false;
    let renderedFrames = 0, visibleMarkers = 0, generation = 0;
    function hide() {
      if (svg && svg.style.visibility !== "hidden") svg.style.visibility = "hidden";
      visibleMarkers = 0;
    }
    function cancelFrame() {
      if (frame !== null) host.ownerDocument.defaultView.cancelAnimationFrame(frame);
      frame = null;
    }
    function clear() {
      generation += 1;
      hide();
      cancelFrame();
      observer?.disconnect();
      observer = null;
      for (const [event, callback] of subscriptions) event.unsubscribe(owner, callback);
      subscriptions.length = 0;
      document.removeEventListener("visibilitychange", visibilityChanged);
      svg?.remove();
      svg = null;
      host = null;
      projection = null;
      signals = [];
      nodes.clear();
      validateCurrent = null;
      invalidated = false;
      return true;
    }
    function readProjection() {
      const widget = chart._chartWidget;
      const model = widget.model().model();
      const series = model.mainSeries();
      const time = model.timeScale();
      const price = series.priceScale();
      const pane = widget.paneByState(model.paneForSource(series));
      const container = pane.canvasElement().parentElement;
      if (!container || !container.classList.contains("chart-gui-wrapper")) {
        throw new Error("TradingView marker main-pane container is unavailable");
      }
      return { model, series, time, price, pane, container };
    }
    function current() {
      return !invalidated && validateCurrent() && !document.hidden && target.chartRoot.isConnected && chart.hasModel() && chart.dataReady() && target.tradingViewApi.activeChart() === chart && chart.resolution() === target.resolution && String(chart.symbol()).split("@", 1)[0] === target.routeSymbol;
    }
    function draw() {
      if (!current() || !canMutate()) {
        hide();
        return false;
      }
      const next = readProjection();
      for (const key of ["model", "series", "time", "price", "pane", "container"]) {
        if (next[key] !== projection[key]) {
          throw new Error(`TradingView marker projection changed: ${key}`);
        }
      }
      if (!host.isConnected) throw new Error("TradingView marker pane is detached");
      const { width, height } = host.getBoundingClientRect();
      if (!Number.isFinite(width) || !Number.isFinite(height)) {
        throw new Error("TradingView marker pane dimensions are invalid");
      }
      const projected = [];
      const visibleIds = /* @__PURE__ */ new Set();
      const { series, time, price } = projection;
      const data = chart.getSeries().data();
      for (const signal of signals) {
        const index = time.timePointToIndex(signal.time, 0);
        if (index === null) continue;
        if (!Number.isFinite(index)) throw new Error("TradingView marker bar index is invalid");
        const row = data.valueAt(index);
        if (!row || row[0] !== signal.time) continue;
        const x = time.indexToCoordinate(index);
        if (!Number.isFinite(x)) throw new Error("TradingView marker coordinates are invalid");
        if (width <= 0 || height <= 0 || x < 0 || x > width) continue;
        const y = price.priceToCoordinate(signal.price, series.firstValue());
        if (!Number.isFinite(y)) {
          throw new Error("TradingView marker coordinates are invalid");
        }
        if (y < 0 || y > height) continue;
        projected.push({ signal, x, y });
        visibleIds.add(signal.id);
      }
      function setAttribute(node, name, value) {
        if (node.getAttribute(name) !== value) node.setAttribute(name, value);
      }
      setAttribute(svg, "width", String(width));
      setAttribute(svg, "height", String(height));
      setAttribute(svg, "viewBox", `0 0 ${width} ${height}`);
      for (const [id, node] of nodes) {
        if (!visibleIds.has(id)) {
          node.remove();
          nodes.delete(id);
        }
      }
      for (const { signal, x, y } of projected) {
        const tag = signal.shape === "circle" ? "circle" : signal.shape === "text" ? "text" : "path";
        let node = nodes.get(signal.id);
        if (node && node.localName !== tag) {
          node.remove();
          nodes.delete(signal.id);
          node = null;
        }
        if (!node) {
          node = host.ownerDocument.createElementNS("http://www.w3.org/2000/svg", tag);
          nodes.set(signal.id, node);
          svg.append(node);
        }
        setAttribute(node, "data-marker-id", signal.id);
        setAttribute(node, "data-marker-type", signal.type);
        setAttribute(node, "data-marker-direction", signal.direction);
        setAttribute(node, "transform", `translate(${x} ${y})`);
        setAttribute(node, "fill", signal.color);
        if (signal.shape === "circle") setAttribute(node, "r", String(signal.size / 2));
        else if (signal.shape === "text") {
          setAttribute(node, "font-size", String(signal.size));
          setAttribute(node, "font-weight", "700");
          setAttribute(node, "font-family", "Arial, sans-serif");
          setAttribute(node, "text-anchor", "middle");
          setAttribute(node, "dominant-baseline", "hanging");
          if (node.textContent !== signal.text) node.textContent = signal.text;
        } else {
          setAttribute(node, "d", signal.pathData);
        }
      }
      if (svg.style.visibility !== "visible") svg.style.visibility = "visible";
      visibleMarkers = projected.length;
      renderedFrames += 1;
      return true;
    }
    function schedule() {
      if (!svg || frame !== null || invalidated || document.hidden) return;
      const scheduledGeneration = generation;
      frame = host.ownerDocument.defaultView.requestAnimationFrame(() => {
        if (!svg || scheduledGeneration !== generation) return;
        frame = null;
        try {
          draw();
        } catch (error) {
          clear();
          if (onRenderError) onRenderError(error);
          else throw error;
        }
      });
    }
    function invalidate() {
      invalidated = true;
      hide();
      cancelFrame();
    }
    function dataChanged() {
      hide();
      schedule();
    }
    function visibilityChanged() {
      if (document.hidden) {
        hide();
        cancelFrame();
      } else schedule();
    }
    function subscribe(event, callback) {
      event.subscribe(owner, callback);
      subscriptions.push([event, callback]);
    }
    function install() {
      projection = readProjection();
      host = projection.container;
      svg = host.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("data-strategy-marker-overlay", "");
      svg.setAttribute("aria-hidden", "true");
      svg.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;visibility:hidden";
      host.append(svg);
      const { series, time, price } = projection;
      for (const event of [
        time.logicalRangeChanged(),
        time.barSpacingChanged(),
        time.rightOffsetChanged(),
        price.priceRangeChanged(),
        price.modeChanged(),
        price.internalHeightChanged()
      ]) {
        subscribe(event, schedule);
      }
      subscribe(series.dataUpdated(), dataChanged);
      subscribe(chart.onIntervalChanged(), invalidate);
      subscribe(chart.onDataLoaded(), dataChanged);
      observer = new host.ownerDocument.defaultView.ResizeObserver(schedule);
      observer.observe(host);
      document.addEventListener("visibilitychange", visibilityChanged);
    }
    return Object.freeze({
      render(nextSignals, { isCurrent }) {
        try {
          if (!Array.isArray(nextSignals) || nextSignals.length > maxMarkers) {
            throw new Error("TradingView overlay marker collection is invalid");
          }
          if (typeof isCurrent !== "function") throw new Error("TradingView overlay current-target validator is unavailable");
          const ids = /* @__PURE__ */ new Set();
          for (const marker of nextSignals) {
            if (!marker || typeof marker.id !== "string" || !marker.id || ids.has(marker.id) || !Number.isInteger(marker.time) || !Number.isFinite(marker.price) || !["circle", "arrow_up", "arrow_down", "text"].includes(marker.shape) || typeof marker.color !== "string" || !/^#[0-9a-f]{6}$/i.test(marker.color) || !Number.isFinite(marker.size) || marker.size <= 0 || typeof marker.type !== "string" || !marker.type || !["bearish", "bullish"].includes(marker.direction)) {
              throw new Error("TradingView overlay marker contract is invalid");
            }
            if (marker.shape === "text" ? marker.anchor !== "top" || typeof marker.text !== "string" || !marker.text : marker.shape === "circle" ? marker.anchor !== "center" : !["tip", "center"].includes(marker.anchor)) {
              throw new Error("TradingView overlay marker style is invalid");
            }
            ids.add(marker.id);
          }
          validateCurrent = isCurrent;
          if (!current() || !canMutate()) {
            hide();
            return false;
          }
          if (!svg) install();
          signals = nextSignals.map((marker) => {
            if (marker.shape !== "arrow_up" && marker.shape !== "arrow_down") return { ...marker };
            const sign = marker.shape === "arrow_up" ? 1 : -1;
            const scale = marker.size / 18;
            const centerShift = marker.anchor === "center" ? -sign * marker.size / 2 : 0;
            const points = [[0, 0], [-6, 8], [-2, 8], [-2, 18], [2, 18], [2, 8], [6, 8]];
            const path = points.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x * scale} ${sign * y * scale + centerShift}`).join(" ");
            return { ...marker, pathData: `${path} Z` };
          });
          return draw();
        } catch (error) {
          clear();
          throw error;
        }
      },
      clear,
      updateText(id, text) {
        if (typeof id !== "string" || typeof text !== "string" || !text) throw new Error("TradingView overlay text update is invalid");
        const marker = signals.find((candidate) => candidate.id === id);
        if (!marker) return false;
        if (marker.shape !== "text") throw new Error("TradingView overlay text target is invalid");
        marker.text = text;
        const node = nodes.get(id);
        if (node && node.textContent !== text) node.textContent = text;
        return true;
      },
      remove(ids) {
        if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) throw new Error("TradingView overlay removal IDs are invalid");
        const removed = new Set(ids);
        signals = signals.filter((signal) => !removed.has(signal.id));
        for (const id of removed) {
          nodes.get(id)?.remove();
          nodes.delete(id);
        }
        visibleMarkers = svg?.style.visibility === "visible" ? nodes.size : 0;
      },
      get size() {
        return signals.length;
      },
      get overlayStats() {
        return {
          renderedFrames,
          visibleMarkers,
          signalCount: signals.length,
          attached: svg !== null,
          pendingFrame: frame !== null,
          subscriptions: subscriptions.length
        };
      }
    });
  }

  // src/binance-strategy29-bollinger/dom/tradingview-bearish-alerts.js
  var MAX_BOLLINGER_MARKERS_PER_DIRECTION = 1e3;
  var MAX_BOLLINGER_MARKERS = MAX_BOLLINGER_MARKERS_PER_DIRECTION * 2;
  function routeSymbolFromChartSymbol(value) {
    return String(value || "").split("@", 1)[0];
  }
  function assertChartContract(chart) {
    for (const method of [
      "dataReady",
      "exportData",
      "hasModel",
      "onDataLoaded",
      "onIntervalChanged",
      "resolution",
      "symbol"
    ]) {
      if (typeof chart?.[method] !== "function") {
        throw new Error(`TradingView Bollinger alert method is unavailable: ${method}`);
      }
    }
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
  function createMarkerLayer(target, defaultDirection, options) {
    const overlay = createChartMarkerOverlay(target, { ...options, maxMarkers: MAX_BOLLINGER_MARKERS });
    return Object.freeze({
      async render(nextSignals, { isCurrent }) {
        try {
          if (!Array.isArray(nextSignals)) throw new Error("TradingView Bollinger alert signals are invalid");
          if (nextSignals.length > MAX_BOLLINGER_MARKERS) {
            throw new Error(`TradingView Bollinger alert marker limit exceeded: ${nextSignals.length}`);
          }
          if (typeof isCurrent !== "function") {
            throw new Error("TradingView Bollinger alert current-target validator is unavailable");
          }
          const normalized = nextSignals.map((signal, index) => normalizeSignal(signal, index, defaultDirection));
          const counts = { bearish: 0, bullish: 0 }, ids = /* @__PURE__ */ new Set();
          for (const signal of normalized) {
            if (!Number.isInteger(signal.time) || !Number.isFinite(signal.markerPrice)) {
              throw new Error("TradingView Bollinger alert signal point is invalid");
            }
            if (!["warning", "confirmed", "reversal"].includes(signal.type)) {
              throw new Error(`TradingView Bollinger alert signal type is invalid: ${signal.type}`);
            }
            if (ids.has(signal.id)) throw new Error(`TradingView Bollinger alert duplicate signal id: ${signal.id}`);
            ids.add(signal.id);
            counts[signal.direction] += 1;
            if (counts[signal.direction] > MAX_BOLLINGER_MARKERS_PER_DIRECTION) {
              throw new Error(`TradingView Bollinger alert ${signal.direction} marker limit exceeded: ${counts[signal.direction]}`);
            }
          }
          const markers = normalized.map((signal) => {
            const bullish = signal.direction === "bullish";
            const up = signal.type === "reversal" ? !bullish : bullish;
            const circle = signal.type === "warning";
            return {
              id: signal.id,
              time: signal.time,
              price: signal.markerPrice,
              shape: circle ? "circle" : up ? "arrow_up" : "arrow_down",
              color: (circle ? bullish : up) ? "#0ECB81" : "#F6465D",
              size: circle ? 10 : 18,
              anchor: circle ? "center" : "tip",
              type: signal.type,
              direction: signal.direction
            };
          });
          return overlay.render(markers, { isCurrent });
        } catch (error) {
          overlay.clear();
          throw error;
        }
      },
      clear: overlay.clear,
      get size() {
        return overlay.size;
      },
      get overlayStats() {
        return overlay.overlayStats;
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
      if (!document.body || !parseFuturesTradingSymbolFromPathname(view.location.pathname)) return;
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
        context.layer.clear();
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
      for (const layer of retired) if (layer.clear()) retired.delete(layer);
      if ((disposed || failed) && retired.size === 0) view.clearInterval(timer);
    }
    function current(candidate) {
      return !disposed && !failed && !document.hidden && context === candidate && candidate.session.isCurrent(candidate.revision) && parseFuturesTradingSymbolFromPathname(view.location.pathname) === candidate.target.routeSymbol && isBearishBollingerChartTargetCurrent(document, candidate.target) && !isChartMutationBlocked(view);
    }
    async function sample() {
      cleanup();
      if (disposed) return;
      const route = parseFuturesTradingSymbolFromPathname(view.location.pathname);
      if (!route) {
        releaseChart();
        cleanup();
        document.getElementById("jh-strategy31-status")?.remove();
        return;
      }
      if (failed || document.hidden || inflight) return;
      if (!route.endsWith("USDT")) {
        releaseChart();
        cleanup();
        notice("Strategy31: unsupported market");
        return;
      }
      const symbol = usdtRouteToCanonical(route);
      const base = findBinanceTradingViewTarget(document);
      const chart = base?.tradingViewApi.activeChart?.();
      if (!chart?.hasModel() || String(chart.symbol()).split("@")[0] !== route) {
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
          layer: createBollingerMarkerLayer(target, {
            canMutate: () => !isChartMutationBlocked(view),
            onRenderError: stopAfterFailure
          })
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
    function stopAfterFailure() {
      failed = true;
      releaseChart();
      cleanup();
      if (!disposed) notice("Strategy31 stopped: invalid chart or signal data");
    }
    function tick() {
      return sample().catch(stopAfterFailure);
    }
    function visibility() {
      if (document.hidden) retire();
      else void tick();
    }
    const timer = view.setInterval(() => {
      void tick();
    }, 5e3);
    document.addEventListener("visibilitychange", visibility);
    const removeRouteListener = installSpaRouteChangeListener(view, () => {
      if (!parseFuturesTradingSymbolFromPathname(view.location.pathname)) void tick();
    });
    const runtime = Object.freeze({ sample: tick, dispose() {
      disposed = true;
      releaseChart();
      cleanup();
      removeRouteListener();
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
