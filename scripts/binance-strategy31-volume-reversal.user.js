// ==UserScript==
// @name         【自写】Binance Strategy 31 Volume Reversal
// @namespace    binance.strategy31.volume-reversal
// @icon         data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%23f0b90b%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2249%22%20text-anchor%3D%22middle%22%20font-family%3D%22Arial%2C%20sans-serif%22%20font-size%3D%2242%22%20font-weight%3D%22800%22%20fill%3D%22%23111827%22%3EJ%3C%2Ftext%3E%3C%2Fsvg%3E
// @icon64       data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%23f0b90b%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2249%22%20text-anchor%3D%22middle%22%20font-family%3D%22Arial%2C%20sans-serif%22%20font-size%3D%2242%22%20font-weight%3D%22800%22%20fill%3D%22%23111827%22%3EJ%3C%2Ftext%3E%3C%2Fsvg%3E
// @version      0.1.9
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
// @grant        GM_getValue
// @grant        GM_setValue
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

  // src/shared/panel-position.js
  function installPanelPosition(document, panel, header, { initialPosition, savePosition }) {
    const view = document.defaultView;
    if (!view) throw new Error("Panel window is unavailable");
    if (!initialPosition || !Number.isFinite(initialPosition.left) || !Number.isFinite(initialPosition.top)) {
      throw new TypeError("Panel initial position is invalid");
    }
    let position = { ...initialPosition };
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
      panel.style.bottom = "auto";
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
      get position() {
        return { ...position };
      },
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

  // src/shared/draggable-status-view.js
  function readPosition(loadPosition) {
    const position = loadPosition();
    if (position === null) return null;
    if (!position || typeof position !== "object" || Object.keys(position).sort().join(",") !== "left,top" || !Number.isFinite(position.left) || !Number.isFinite(position.top)) {
      throw new TypeError("Status position must contain finite left and top coordinates");
    }
    return { ...position };
  }
  function createDraggableStatusView(view, { id, loadPosition, savePosition, defaultPosition }) {
    if (typeof id !== "string" || id.length === 0 || typeof loadPosition !== "function" || typeof savePosition !== "function" || typeof defaultPosition !== "function") {
      throw new TypeError("Draggable status requires an ID and position adapters");
    }
    const document = view.document;
    let position = readPosition(loadPosition);
    let node = null;
    let drag = null;
    let disposed = false;
    function hide() {
      if (!node) return;
      position = drag.position;
      drag.destroy();
      node.remove();
      node = null;
      drag = null;
    }
    return Object.freeze({
      show(text, state = "normal") {
        if (disposed) throw new Error("Cannot show a disposed status");
        if (typeof text !== "string" || !["normal", "inactive", "error"].includes(state)) {
          throw new TypeError("Status text or state is invalid");
        }
        if (!node) {
          node = document.createElement("div");
          node.id = id;
          node.setAttribute("role", "status");
          node.setAttribute("aria-live", "polite");
          Object.assign(node.style, {
            position: "fixed",
            zIndex: "10000",
            boxSizing: "border-box",
            width: "max-content",
            maxWidth: "min(520px, calc(100vw - 16px))",
            padding: "6px 8px",
            border: "1px solid #474D57",
            borderRadius: "6px",
            background: "#181A20",
            color: "#DDD",
            font: "12px/18px BinancePlex, ui-sans-serif, system-ui, sans-serif",
            pointerEvents: "auto",
            userSelect: "none",
            whiteSpace: "normal",
            overflowWrap: "anywhere"
          });
          node.textContent = text;
          document.body.appendChild(node);
          drag = installPanelPosition(document, node, node, {
            initialPosition: position ?? defaultPosition(node),
            savePosition(next) {
              position = next;
              savePosition(next);
            }
          });
        } else if (node.textContent !== text) {
          node.textContent = text;
          drag.clamp();
        }
        if (node.title !== text) node.title = text;
        if (node.dataset.state !== state) {
          node.dataset.state = state;
          node.style.borderColor = state === "error" ? "#F6465D" : "#474D57";
        }
      },
      hide,
      get visible() {
        return node !== null;
      },
      dispose() {
        hide();
        disposed = true;
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
    let projectionDirty = true, renderedWidth = null, renderedHeight = null;
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
      projectionDirty = true;
      renderedWidth = null;
      renderedHeight = null;
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
      if (!projectionDirty && svg.style.visibility === "visible" && width === renderedWidth && height === renderedHeight) return true;
      projectionDirty = false;
      const projected = [];
      const visibleIds = /* @__PURE__ */ new Set();
      const { series, time, price } = projection;
      const data = chart.getSeries().data();
      let firstValue, firstValueRead = false;
      for (const signal of signals) {
        const index = time.timePointToIndex(signal.time, 0);
        if (index === null) continue;
        if (!Number.isFinite(index)) throw new Error("TradingView marker bar index is invalid");
        const row = data.valueAt(index);
        if (!row || row[0] !== signal.time) continue;
        const x = time.indexToCoordinate(index);
        if (!Number.isFinite(x)) throw new Error("TradingView marker coordinates are invalid");
        if (width <= 0 || height <= 0 || x < 0 || x > width) continue;
        if (!firstValueRead) {
          firstValue = series.firstValue();
          firstValueRead = true;
        }
        const y = price.priceToCoordinate(signal.price, firstValue);
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
      renderedWidth = width;
      renderedHeight = height;
      renderedFrames += 1;
      return true;
    }
    function schedule() {
      projectionDirty = true;
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
          projectionDirty = true;
          return draw();
        } catch (error) {
          clear();
          throw error;
        }
      },
      /** Rechecks the retained snapshot; changed caller inputs must go through render. */
      reconcile({ isCurrent }) {
        try {
          if (typeof isCurrent !== "function") throw new Error("TradingView overlay current-target validator is unavailable");
          validateCurrent = isCurrent;
          return svg ? draw() : false;
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
      reconcile: overlay.reconcile,
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
    automaticRebalance: freezeCopy({
      waitingForFlat: localizedText("自动再平衡：等待账户持续无持仓、无挂单", "Automatic USDT transfer: waiting for stable flat account"),
      waitingForAccess: localizedText("自动再平衡：等待账户操作完成", "Automatic USDT transfer: waiting for account access"),
      checkingAccount: localizedText("自动再平衡：正在检查账户", "Automatic USDT transfer: checking account"),
      blocked: localizedText("自动再平衡已阻止：请先核实上次划转结果", "Automatic USDT transfer blocked: previous outcome requires account review"),
      completed: localizedText("已自动进行账户再平衡", "Account automatically rebalanced"),
      notRepeated: localizedText("本轮不再自动执行账户再平衡", "No further automatic rebalance in this round"),
      noTransfer: localizedText("自动再平衡：无需划转", "Automatic account rebalance: no transfer needed"),
      paused: localizedText("自动再平衡已暂停：执行条件已变化", "Automatic USDT transfer paused: eligibility changed"),
      stopped: localizedText("自动再平衡已停止：", "Automatic USDT transfer stopped: "),
      eligibilityFailed: localizedText("自动再平衡资格检查失败：", "Automatic USDT eligibility check failed: "),
      accountBusy: localizedText("账户操作已阻止：其他标签页正在划转资金", "Account operation blocked: another tab is transferring funds")
    }),
    rebalanceErrors: freezeCopy({
      pageIneligible: localizedText("当前合约页面不符合账户划转条件", "Current futures page is not eligible for account transfers"),
      ordinaryAccountRequired: localizedText("自动划转仅支持普通 U 本位合约账户", "Automatic transfers require an ordinary USD-M Futures account"),
      eligibilityChanged: localizedText("划转前账户执行条件已变化", "Account eligibility changed before transfer"),
      tradingTaskRunning: localizedText("当前仍有交易任务运行", "A trading task is still running"),
      identityUnverified: localizedText("账户身份或模式不受支持或尚未核实", "Unsupported or unverified account identity"),
      identityChanged: localizedText("账户身份已变化", "Account identity changed"),
      identityChangedAfterConfirmation: localizedText("确认后账户身份已变化", "Account identity changed after confirmation"),
      reviewRequired: localizedText("请先核实上次划转结果", "Previous transfer outcome requires account review"),
      flatRequired: localizedText("全账户持仓和当前委托必须为零", "Account-wide positions and open orders must be zero"),
      accountNotFlat: localizedText("全账户仍有持仓或当前委托", "Positions or open orders still exist in the account"),
      invalidOutcome: localizedText("自动再平衡结果记录无效", "Invalid automatic rebalance episode outcome")
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

  // src/binance-strategy31-volume-reversal/runtime.js
  var STATUS_COPY = Object.freeze({
    unsupportedMarket: localizedText("策略31：不支持的交易市场", "Strategy31: unsupported market"),
    unsupportedInterval: localizedText("策略31：不支持的图表周期", "Strategy31: unsupported interval"),
    updateClient: localizedText("策略31：请更新 CorsairQuant 信号客户端", "Strategy31: update CorsairQuant signal client"),
    configureClient: localizedText("策略31：请配置 CorsairQuant 信号客户端", "Strategy31: configure CorsairQuant signal client"),
    unavailable: localizedText("策略31：信号服务不可用", "Strategy31: signal service unavailable"),
    stopped: localizedText("策略31已停止：图表或信号数据无效", "Strategy31 stopped: invalid chart or signal data")
  });
  function installStrategy31(view, { getValue, setValue }) {
    const key = Symbol.for("jh-userscripts.strategy31");
    if (view[key]) return view[key];
    if (typeof getValue !== "function" || typeof setValue !== "function") {
      throw new TypeError("Strategy31 requires private storage adapters");
    }
    let context = null, intervalOwner = null, inflight = null, disposed = false, failed = false;
    const retired = /* @__PURE__ */ new Set();
    const document = view.document;
    const status = createDraggableStatusView(view, {
      id: "jh-strategy31-status",
      loadPosition: () => getValue("strategy31StatusPosition", null),
      savePosition: (position) => setValue("strategy31StatusPosition", position),
      defaultPosition: (node) => ({ left: 16, top: view.innerHeight - node.getBoundingClientRect().height - 40 })
    });
    let statusText = "";
    function renderNotice() {
      if (!status.visible) return;
      status.show(formatLocalizedText(statusText, resolveUiLocaleFromPathname(view.location.pathname)));
    }
    function notice(text) {
      if (!document.body || !parseFuturesTradingSymbolFromPathname(view.location.pathname)) return;
      statusText = text;
      status.show(formatLocalizedText(statusText, resolveUiLocaleFromPathname(view.location.pathname)));
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
        status.hide();
        return;
      }
      if (failed || document.hidden || inflight) return;
      if (!route.endsWith("USDT")) {
        releaseChart();
        cleanup();
        notice(STATUS_COPY.unsupportedMarket);
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
        notice(STATUS_COPY.unsupportedInterval);
        return;
      }
      const seconds = tradingViewResolutionToSeconds(resolution);
      const timeframe = Object.keys(STRATEGY31_PERIODS).find((period) => STRATEGY31_PERIODS[period] === seconds);
      if (!timeframe) {
        retire();
        cleanup();
        notice(STATUS_COPY.unsupportedInterval);
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
        notice(STATUS_COPY.updateClient);
        return;
      }
      const state = provider.getState();
      if (!state.configured || !state.available) {
        notice(STATUS_COPY.configureClient);
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
          notice(STATUS_COPY.unavailable);
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
        if (rendered && requestCurrent()) notice(localizedText(
          `策略31：${visible.length} 个图表信号 · ${timeframe}`,
          `Strategy31: ${visible.length} chart signals · ${timeframe}`
        ));
      } finally {
        if (inflight === controller) inflight = null;
      }
    }
    function stopAfterFailure() {
      failed = true;
      releaseChart();
      cleanup();
      if (!disposed) notice(STATUS_COPY.stopped);
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
      else renderNotice();
    });
    function dispose() {
      if (disposed) return;
      disposed = true;
      releaseChart();
      cleanup();
      removeRouteListener();
      document.removeEventListener("visibilitychange", visibility);
      view.removeEventListener("beforeunload", dispose);
      status.dispose();
    }
    view.addEventListener("beforeunload", dispose);
    const runtime = Object.freeze({ sample: tick, dispose });
    Object.defineProperty(view, key, { value: runtime });
    void tick();
    return runtime;
  }

  // src/binance-strategy31-volume-reversal/index.user.js
  installStrategy31(unsafeWindow, { getValue: GM_getValue, setValue: GM_setValue });
})();
