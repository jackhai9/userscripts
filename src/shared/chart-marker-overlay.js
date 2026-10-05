/**
 * Owns presentation only. SVG updates never enter TradingView's drawing model or
 * serialization queue; the host remains the sole owner of user drawings.
 *
 * Inputs contain resolved time/price and an explicit style, never candle-wait
 * or retention policy. Size means circle diameter, arrow height, or text font
 * size in CSS pixels. Arrows use a tip or center anchor; text uses its top edge.
 * Each strategy owns its immutable placement and failure-reporting contract.
 */
export function createChartMarkerOverlay(target, {
  maxMarkers,
  canMutate = () => true,
  onRenderError,
} = {}) {
  if (!Number.isSafeInteger(maxMarkers) || maxMarkers < 1) throw new Error('TradingView overlay marker limit is invalid');
  const { chart } = target;
  const document = target.chartRoot.ownerDocument;
  const owner = {};
  const subscriptions = [];
  const nodes = new Map();
  let svg = null, host = null, frame = null, observer = null, projection = null;
  let signals = [], validateCurrent = null, invalidated = false;
  let renderedFrames = 0, visibleMarkers = 0, generation = 0;

  function hide() {
    if (svg && svg.style.visibility !== 'hidden') svg.style.visibility = 'hidden';
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
    document.removeEventListener('visibilitychange', visibilityChanged);
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
    if (!container || !container.classList.contains('chart-gui-wrapper')) {
      throw new Error('TradingView marker main-pane container is unavailable');
    }
    return { model, series, time, price, pane, container };
  }

  function current() {
    return !invalidated && validateCurrent() && !document.hidden
      && target.chartRoot.isConnected && chart.hasModel() && chart.dataReady()
      && target.tradingViewApi.activeChart() === chart
      && chart.resolution() === target.resolution
      && String(chart.symbol()).split('@', 1)[0] === target.routeSymbol;
  }

  function draw() {
    if (!current() || !canMutate()) { hide(); return false; }
    const next = readProjection();
    for (const key of ['model', 'series', 'time', 'price', 'pane', 'container']) {
      if (next[key] !== projection[key]) {
        throw new Error(`TradingView marker projection changed: ${key}`);
      }
    }
    if (!host.isConnected) throw new Error('TradingView marker pane is detached');
    const { width, height } = host.getBoundingClientRect();
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      throw new Error('TradingView marker pane dimensions are invalid');
    }
    const projected = [];
    const visibleIds = new Set();
    const { series, time, price } = projection;
    const data = chart.getSeries().data();
    for (const signal of signals) {
      const index = time.timePointToIndex(signal.time, 0);
      if (index === null) continue;
      if (!Number.isFinite(index)) throw new Error('TradingView marker bar index is invalid');
      // Exact readback excludes feed gaps even if the host returns a nearby index.
      const row = data.valueAt(index);
      if (!row || row[0] !== signal.time) continue;
      const x = time.indexToCoordinate(index);
      if (!Number.isFinite(x)) throw new Error('TradingView marker coordinates are invalid');
      if (width <= 0 || height <= 0 || x < 0 || x > width) continue;
      const y = price.priceToCoordinate(signal.price, series.firstValue());
      if (!Number.isFinite(y)) {
        throw new Error('TradingView marker coordinates are invalid');
      }
      if (y < 0 || y > height) continue;
      projected.push({ signal, x, y });
      visibleIds.add(signal.id);
    }
    // Compute the complete frame before touching DOM. Reuse visible nodes so
    // panning and unchanged samples do not rebuild thousands of SVG elements.
    function setAttribute(node, name, value) {
      if (node.getAttribute(name) !== value) node.setAttribute(name, value);
    }
    setAttribute(svg, 'width', String(width));
    setAttribute(svg, 'height', String(height));
    setAttribute(svg, 'viewBox', `0 0 ${width} ${height}`);
    for (const [id, node] of nodes) {
      if (!visibleIds.has(id)) { node.remove(); nodes.delete(id); }
    }
    for (const { signal, x, y } of projected) {
      const tag = signal.shape === 'circle' ? 'circle' : signal.shape === 'text' ? 'text' : 'path';
      let node = nodes.get(signal.id);
      if (node && node.localName !== tag) { node.remove(); nodes.delete(signal.id); node = null; }
      if (!node) {
        node = host.ownerDocument.createElementNS('http://www.w3.org/2000/svg', tag);
        nodes.set(signal.id, node);
        svg.append(node);
      }
      setAttribute(node, 'data-marker-id', signal.id);
      setAttribute(node, 'data-marker-type', signal.type);
      setAttribute(node, 'data-marker-direction', signal.direction);
      setAttribute(node, 'transform', `translate(${x} ${y})`);
      setAttribute(node, 'fill', signal.color);
      if (signal.shape === 'circle') setAttribute(node, 'r', String(signal.size / 2));
      else if (signal.shape === 'text') {
        setAttribute(node, 'font-size', String(signal.size));
        setAttribute(node, 'font-weight', '700');
        setAttribute(node, 'font-family', 'Arial, sans-serif');
        setAttribute(node, 'text-anchor', 'middle');
        setAttribute(node, 'dominant-baseline', 'hanging');
        if (node.textContent !== signal.text) node.textContent = signal.text;
      } else {
        setAttribute(node, 'd', signal.pathData);
      }
    }
    if (svg.style.visibility !== 'visible') svg.style.visibility = 'visible';
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
      try { draw(); } catch (error) {
        // This is the asynchronous rendering boundary. Consumers expose terminal
        // failures through their existing monitor diagnostics or status notice.
        clear();
        if (onRenderError) onRenderError(error);
        else throw error;
      }
    });
  }

  function invalidate() { invalidated = true; hide(); cancelFrame(); }
  function dataChanged() { hide(); schedule(); }
  function visibilityChanged() {
    if (document.hidden) { hide(); cancelFrame(); } else schedule();
  }
  function subscribe(event, callback) {
    event.subscribe(owner, callback);
    subscriptions.push([event, callback]);
  }

  function install() {
    projection = readProjection();
    host = projection.container;
    svg = host.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('data-strategy-marker-overlay', '');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;visibility:hidden';
    host.append(svg);
    const { series, time, price } = projection;
    for (const event of [time.logicalRangeChanged(), time.barSpacingChanged(), time.rightOffsetChanged(),
      price.priceRangeChanged(), price.modeChanged(), price.internalHeightChanged()]) {
      subscribe(event, schedule);
    }
    subscribe(series.dataUpdated(), dataChanged);
    subscribe(chart.onIntervalChanged(), invalidate);
    subscribe(chart.onDataLoaded(), dataChanged);
    observer = new host.ownerDocument.defaultView.ResizeObserver(schedule);
    observer.observe(host);
    document.addEventListener('visibilitychange', visibilityChanged);
  }

  return Object.freeze({
    render(nextSignals, { isCurrent }) {
      try {
        if (!Array.isArray(nextSignals) || nextSignals.length > maxMarkers) {
          throw new Error('TradingView overlay marker collection is invalid');
        }
        if (typeof isCurrent !== 'function') throw new Error('TradingView overlay current-target validator is unavailable');
        const ids = new Set();
        for (const marker of nextSignals) {
          if (!marker || typeof marker.id !== 'string' || !marker.id || ids.has(marker.id)
            || !Number.isInteger(marker.time) || !Number.isFinite(marker.price)
            || !['circle', 'arrow_up', 'arrow_down', 'text'].includes(marker.shape)
            || typeof marker.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(marker.color)
            || !Number.isFinite(marker.size) || marker.size <= 0
            || typeof marker.type !== 'string' || !marker.type
            || !['bearish', 'bullish'].includes(marker.direction)) {
            throw new Error('TradingView overlay marker contract is invalid');
          }
          if (marker.shape === 'text' ? marker.anchor !== 'top' || typeof marker.text !== 'string' || !marker.text
            : marker.shape === 'circle' ? marker.anchor !== 'center' : !['tip', 'center'].includes(marker.anchor)) {
            throw new Error('TradingView overlay marker style is invalid');
          }
          ids.add(marker.id);
        }
        validateCurrent = isCurrent;
        if (!current() || !canMutate()) { hide(); return false; }
        if (!svg) install();
        signals = nextSignals.map(marker => {
          if (marker.shape !== 'arrow_up' && marker.shape !== 'arrow_down') return { ...marker };
          const sign = marker.shape === 'arrow_up' ? 1 : -1;
          const scale = marker.size / 18;
          const centerShift = marker.anchor === 'center' ? -sign * marker.size / 2 : 0;
          const points = [[0, 0], [-6, 8], [-2, 8], [-2, 18], [2, 18], [2, 8], [6, 8]];
          const path = points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x * scale} ${sign * y * scale + centerShift}`).join(' ');
          return { ...marker, pathData: `${path} Z` };
        });
        return draw();
      } catch (error) { clear(); throw error; }
    },
    clear,
    updateText(id, text) {
      if (typeof id !== 'string' || typeof text !== 'string' || !text) throw new Error('TradingView overlay text update is invalid');
      const marker = signals.find(candidate => candidate.id === id);
      // A cleared or retired overlay has no presentation to translate.
      if (!marker) return false;
      if (marker.shape !== 'text') throw new Error('TradingView overlay text target is invalid');
      marker.text = text;
      const node = nodes.get(id);
      if (node && node.textContent !== text) node.textContent = text;
      return true;
    },
    remove(ids) {
      if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw new Error('TradingView overlay removal IDs are invalid');
      const removed = new Set(ids);
      signals = signals.filter(signal => !removed.has(signal.id));
      for (const id of removed) {
        nodes.get(id)?.remove();
        nodes.delete(id);
      }
      visibleMarkers = svg?.style.visibility === 'visible' ? nodes.size : 0;
    },
    get size() { return signals.length; },
    get overlayStats() {
      return { renderedFrames, visibleMarkers, signalCount: signals.length,
        attached: svg !== null, pendingFrame: frame !== null, subscriptions: subscriptions.length };
    },
  });
}

