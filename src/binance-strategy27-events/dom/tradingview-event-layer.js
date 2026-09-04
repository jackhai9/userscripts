const CHART_ROOT_SELECTOR = '.chart-widget-root';
const STATUS_ID = 'jh-strategy27-event-status';
const DIRECTIONAL_MARKER_GAP_PX = 8;
const DEFAULT_CANDLE_WAIT_MS = 3_000;
const EXACT_TIME_MATCH_MODE = 0;
const PREVIOUS_OR_EXACT_TIME_MATCH_MODE = 1;

function hasVisibleBox(element) {
  if (!element?.getClientRects().length) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function routeSymbolFromChartSymbol(value) {
  return String(value || '').split('@', 1)[0];
}

function assertChartContract(chart) {
  for (const method of ['createShape', 'getShapeById', 'removeEntity', 'resolution', 'symbol']) {
    if (typeof chart?.[method] !== 'function') throw new Error(`TradingView chart method is unavailable: ${method}`);
  }
}

export function findStrategy27ChartTarget(document, expectedRouteSymbol) {
  const chartRoot = findStrategy27ChartRoot(document);
  if (!chartRoot) return null;
  const frames = Array.from(chartRoot.querySelectorAll('iframe')).filter(hasVisibleBox);
  if (!frames.length) return null;
  if (frames.length !== 1) throw new Error(`Visible Strategy 27 chart frame count is invalid: ${frames.length}`);
  const tradingViewApi = frames[0].contentWindow?.tradingViewApi;
  const chart = tradingViewApi?.activeChart?.();
  if (!chart) return null;
  assertChartContract(chart);
  const resolution = chart.resolution();
  if (resolution !== '1S') throw new Error(`Strategy 27 annotations require a one-second chart, received ${resolution}`);
  const routeSymbol = routeSymbolFromChartSymbol(chart.symbol());
  if (routeSymbol !== expectedRouteSymbol) {
    throw new Error(`Strategy 27 chart symbol mismatch: expected ${expectedRouteSymbol}, received ${routeSymbol}`);
  }
  return { chartRoot, frame: frames[0], tradingViewApi, chart, resolution, routeSymbol };
}

export function findStrategy27ChartRoot(document) {
  const chartRoots = Array.from(document.querySelectorAll(CHART_ROOT_SELECTOR)).filter(hasVisibleBox);
  if (!chartRoots.length) return null;
  if (chartRoots.length !== 1) throw new Error(`Visible Strategy 27 chart root count is invalid: ${chartRoots.length}`);
  return chartRoots[0];
}

function shapeOptions(shape, color) {
  return {
    shape,
    lock: true,
    disableSave: true,
    disableSelection: true,
    disableUndo: true,
    showInObjectsTree: false,
    overrides: {
      color,
      fixedSize: true,
    },
  };
}

function createMarkerPointResolver(chart) {
  const model = chart._chartWidget?.model?.()?.model?.();
  const timeScale = model?.timeScale?.();
  const seriesData = chart.getSeries?.()?.data?.();
  const mainSeries = model?.mainSeries?.();
  const priceScale = mainSeries?.priceScale?.();
  const dataUpdated = mainSeries?.dataUpdated?.();
  const requiredMethods = [
    [timeScale, 'timePointToIndex'],
    [seriesData, 'valueAt'],
    [mainSeries, 'firstValue'],
    [priceScale, 'priceToCoordinate'],
    [priceScale, 'coordinateToPrice'],
    [dataUpdated, 'subscribe'],
    [dataUpdated, 'unsubscribe'],
  ];
  for (const [owner, method] of requiredMethods) {
    if (typeof owner?.[method] !== 'function') {
      throw new Error(`TradingView marker placement method is unavailable: ${method}`);
    }
  }

  const resolve = (annotation, { allowPreviousCandle = false, gapPx = DIRECTIONAL_MARKER_GAP_PX } = {}) => {
    if (!Number.isFinite(gapPx)) throw new Error('Strategy 27 marker pixel gap is invalid');
    if (!['arrow_up', 'arrow_down'].includes(annotation.markerShape)) {
      throw new Error(`Unsupported Strategy 27 marker shape: ${annotation.markerShape}`);
    }

    const matchMode = allowPreviousCandle
      ? PREVIOUS_OR_EXACT_TIME_MATCH_MODE
      : EXACT_TIME_MATCH_MODE;
    const barIndex = timeScale.timePointToIndex(annotation.markerTime, matchMode);
    if (!Number.isFinite(barIndex)) return null;
    const candle = seriesData.valueAt(barIndex);
    if (candle === null) return null;
    const candleTime = Array.isArray(candle) ? candle[0] : null;
    const timeMatches = allowPreviousCandle
      ? Number.isInteger(candleTime) && candleTime <= annotation.markerTime
      : candleTime === annotation.markerTime;
    if (!Array.isArray(candle) || candle.length < 5 || !timeMatches) {
      throw new Error(`Strategy 27 candle is invalid for ${annotation.markerTime}`);
    }
    const candleHigh = Number(candle[2]);
    const candleLow = Number(candle[3]);
    if (!Number.isFinite(candleHigh) || !Number.isFinite(candleLow)) {
      throw new Error(`Strategy 27 candle prices are invalid for ${annotation.markerTime}`);
    }

    const firstValue = mainSeries.firstValue();
    const candleEdge = annotation.markerShape === 'arrow_up' ? candleLow : candleHigh;
    const edgeCoordinate = priceScale.priceToCoordinate(candleEdge, firstValue);
    if (!Number.isFinite(edgeCoordinate)) {
      throw new Error(`Strategy 27 candle coordinate is unavailable for ${annotation.markerTime}`);
    }
    const direction = annotation.markerShape === 'arrow_up' ? 1 : -1;
    const markerPrice = priceScale.coordinateToPrice(
      edgeCoordinate + (direction * gapPx),
      firstValue,
    );
    if (!Number.isFinite(markerPrice)) {
      throw new Error(`Strategy 27 marker price is unavailable for ${annotation.markerTime}`);
    }
    return { time: candleTime, price: markerPrice };
  };
  function shift(point, deltaPixels) {
    if (!Number.isFinite(deltaPixels)) throw new Error('Strategy 27 marker pixel shift is invalid');
    const firstValue = mainSeries.firstValue();
    const y = priceScale.priceToCoordinate(point.price, firstValue);
    const price = priceScale.coordinateToPrice(y + deltaPixels, firstValue);
    if (!Number.isFinite(y) || !Number.isFinite(price)) throw new Error('Strategy 27 shifted marker coordinate is invalid');
    return { time: point.time, price };
  }
  return { dataUpdated, resolve, shift };
}

function verifyResolvedTime(chart, id, requestedTime) {
  const shape = chart.getShapeById(id);
  const points = shape?.getPoints?.();
  if (!Array.isArray(points) || points.length !== 1 || points[0].time !== requestedTime) {
    const actualTime = Array.isArray(points) && points.length === 1 ? points[0]?.time : null;
    const pointCount = Array.isArray(points) ? points.length : null;
    throw new Error(
      `Strategy 27 chart time alignment failed: expected ${requestedTime}, received ${actualTime} (point count ${pointCount})`,
    );
  }
  return shape;
}

export async function createAlignedShape(chart, point, options) {
  const id = await chart.createShape(point, options);
  if (typeof id !== 'string' || id.length === 0) throw new Error('TradingView returned an invalid shape id');
  try {
    verifyResolvedTime(chart, id, point.time);
  } catch (error) {
    chart.removeEntity(id);
    throw error;
  }
  return id;
}

/** Shared causal candle placement; each caller owns cancellation of its wait. */
export function createTradingViewMarkerPlacement(chart, {
  candleWaitMs = DEFAULT_CANDLE_WAIT_MS,
} = {}) {
  if (!Number.isInteger(candleWaitMs) || candleWaitMs < 1) {
    throw new Error('Strategy 27 candleWaitMs is invalid');
  }
  const { dataUpdated, resolve: resolveMarkerPoint, shift } = createMarkerPointResolver(chart);

  function wait(annotation, { signal, gapPx = DIRECTIONAL_MARKER_GAP_PX }) {
    if (signal.aborted) return Promise.resolve(null);
    const immediate = resolveMarkerPoint(annotation, { gapPx });
    if (immediate) return Promise.resolve(immediate);

    return new Promise((resolve, reject) => {
      const owner = {};
      let settled = false;
      let timeoutId;

      const cleanup = () => {
        clearTimeout(timeoutId);
        dataUpdated.unsubscribe(owner, onDataUpdated);
        signal.removeEventListener('abort', cancel);
      };
      const finish = (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const cancel = () => finish(null);
      const onDataUpdated = () => {
        if (signal.aborted) {
          cancel();
          return;
        }
        try {
          const point = resolveMarkerPoint(annotation, { gapPx });
          if (point) finish(point);
        } catch (error) {
          fail(error);
        }
      };

      timeoutId = setTimeout(() => {
        try {
          // Order-book events can occur during seconds with no trades, so a
          // one-second chart may never create the exact candle. Anchor those
          // events to the latest causal candle instead of a future bar.
          const previousPoint = resolveMarkerPoint(annotation, { allowPreviousCandle: true, gapPx });
          if (previousPoint) {
            finish(previousPoint);
            return;
          }
          fail(new Error(
            `Strategy 27 candle did not arrive within ${candleWaitMs} ms for ${annotation.markerTime}`,
          ));
        } catch (error) {
          fail(error);
        }
      }, candleWaitMs);
      signal.addEventListener('abort', cancel, { once: true });
      dataUpdated.subscribe(owner, onDataUpdated);
      onDataUpdated();
    });
  }
  return Object.freeze({ wait, shift });
}

export function createTradingViewEventLayer(target, {
  maxEvents,
  maxAgeMs,
  candleWaitMs = DEFAULT_CANDLE_WAIT_MS,
}) {
  if (!Number.isInteger(maxEvents) || maxEvents < 1) throw new Error('Strategy 27 maxEvents is invalid');
  if (!Number.isInteger(maxAgeMs) || maxAgeMs < 1) throw new Error('Strategy 27 maxAgeMs is invalid');
  const { chart } = target;
  const placement = createTradingViewMarkerPlacement(chart, { candleWaitMs });
  const registry = new Map();
  const pendingCandleWaits = new Set();
  let renderGeneration = 0;

  function removeRecord(eventId) {
    const record = registry.get(eventId);
    if (!record) return;
    chart.removeEntity(record.markerId);
    registry.delete(eventId);
  }

  function pruneAge(observedAtMs) {
    for (const [eventId, record] of registry) {
      if (observedAtMs - record.observedAtMs > maxAgeMs) removeRecord(eventId);
    }
  }

  function ensureCapacityForNew() {
    while (registry.size >= maxEvents) removeRecord(registry.keys().next().value);
  }

  async function ensureMarker(eventId, annotation, observedAtMs) {
    let record = registry.get(eventId);
    if (record) {
      record.observedAtMs = observedAtMs;
      return true;
    }
    if (annotation.markerShape === null) return true;
    const requestedGeneration = renderGeneration;
    const controller = new AbortController();
    pendingCandleWaits.add(controller);
    let markerPoint;
    try {
      markerPoint = await placement.wait(annotation, { signal: controller.signal });
    } finally {
      pendingCandleWaits.delete(controller);
    }
    if (!markerPoint || requestedGeneration !== renderGeneration) return false;
    pruneAge(observedAtMs);
    ensureCapacityForNew();
    const markerId = await createAlignedShape(
      chart,
      markerPoint,
      shapeOptions(annotation.markerShape, annotation.markerColor),
    );
    if (requestedGeneration !== renderGeneration) {
      chart.removeEntity(markerId);
      return false;
    }
    record = { markerId, markerShape: annotation.markerShape, observedAtMs };
    registry.set(eventId, record);
    return true;
  }

  return Object.freeze({
    renderOpened: (eventId, annotation, observedAtMs) => ensureMarker(eventId, annotation, observedAtMs),
    renderUpdated: (eventId, annotation, observedAtMs) => ensureMarker(eventId, annotation, observedAtMs),
    renderClosed: (eventId, annotation, observedAtMs) => ensureMarker(eventId, annotation, observedAtMs),
    renderOutcome: (eventId, annotation, observedAtMs) => ensureMarker(eventId, annotation, observedAtMs),
    remove: removeRecord,
    prune: pruneAge,
    clear() {
      renderGeneration += 1;
      for (const controller of [...pendingCandleWaits]) controller.abort();
      for (const eventId of [...registry.keys()]) removeRecord(eventId);
    },
    get size() {
      return registry.size;
    },
  });
}

export function ensureStrategy27StatusView(document, chartRoot) {
  const existing = document.getElementById(STATUS_ID);
  if (existing && existing.parentElement === chartRoot) return existing;
  existing?.remove();
  const status = document.createElement('div');
  status.id = STATUS_ID;
  status.setAttribute('aria-live', 'polite');
  Object.assign(status.style, {
    position: 'absolute',
    zIndex: '8',
    right: '84px',
    top: '42px',
    maxWidth: '520px',
    padding: '4px 8px',
    borderRadius: '6px',
    background: 'rgba(24, 26, 32, .82)',
    color: '#EAECEF',
    font: '12px/18px BinancePlex, ui-sans-serif, system-ui, sans-serif',
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  });
  chartRoot.appendChild(status);
  return status;
}

export function setStrategy27Status(status, text, state = 'normal') {
  status.textContent = text;
  status.title = text;
  status.dataset.state = state;
  status.style.color = state === 'error' ? '#F6465D' : state === 'inactive' ? '#848E9C' : '#EAECEF';
}

export function removeStrategy27StatusView(document) {
  document.getElementById(STATUS_ID)?.remove();
}
