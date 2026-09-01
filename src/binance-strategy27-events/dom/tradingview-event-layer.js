const CHART_ROOT_SELECTOR = '.chart-widget-root';
const STATUS_ID = 'jh-strategy27-event-status';
const DIRECTIONAL_MARKER_GAP_PX = 8;

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
  const requiredMethods = [
    [timeScale, 'timePointToIndex'],
    [seriesData, 'valueAt'],
    [mainSeries, 'firstValue'],
    [priceScale, 'priceToCoordinate'],
    [priceScale, 'coordinateToPrice'],
  ];
  for (const [owner, method] of requiredMethods) {
    if (typeof owner?.[method] !== 'function') {
      throw new Error(`TradingView marker placement method is unavailable: ${method}`);
    }
  }

  return (annotation) => {
    const point = { time: annotation.markerTime, price: annotation.markerPrice };
    if (annotation.markerShape === 'flag') return point;
    if (!['arrow_up', 'arrow_down'].includes(annotation.markerShape)) {
      throw new Error(`Unsupported Strategy 27 marker shape: ${annotation.markerShape}`);
    }

    const barIndex = timeScale.timePointToIndex(annotation.markerTime, 0);
    const candle = Number.isFinite(barIndex) ? seriesData.valueAt(barIndex) : null;
    if (!Array.isArray(candle) || candle.length < 5 || candle[0] !== annotation.markerTime) {
      throw new Error(`Strategy 27 candle is unavailable for ${annotation.markerTime}`);
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
      edgeCoordinate + (direction * DIRECTIONAL_MARKER_GAP_PX),
      firstValue,
    );
    if (!Number.isFinite(markerPrice)) {
      throw new Error(`Strategy 27 marker price is unavailable for ${annotation.markerTime}`);
    }
    return { time: annotation.markerTime, price: markerPrice };
  };
}

function verifyResolvedTime(chart, id, requestedTime) {
  const shape = chart.getShapeById(id);
  const points = shape?.getPoints?.();
  if (!Array.isArray(points) || points.length !== 1 || points[0].time !== requestedTime) {
    throw new Error(`Strategy 27 chart time alignment failed for ${requestedTime}`);
  }
  return shape;
}

async function createAlignedShape(chart, point, options) {
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

function updateAlignedShape(chart, id, point, properties) {
  const shape = chart.getShapeById(id);
  if (!shape || typeof shape.setPoints !== 'function' || typeof shape.setProperties !== 'function') {
    throw new Error('TradingView shape update contract is unavailable');
  }
  shape.setPoints([point]);
  shape.setProperties(properties);
  verifyResolvedTime(chart, id, point.time);
}

export function createTradingViewEventLayer(target, { maxEvents, maxAgeMs }) {
  if (!Number.isInteger(maxEvents) || maxEvents < 1) throw new Error('Strategy 27 maxEvents is invalid');
  if (!Number.isInteger(maxAgeMs) || maxAgeMs < 1) throw new Error('Strategy 27 maxAgeMs is invalid');
  const { chart } = target;
  const resolveMarkerPoint = createMarkerPointResolver(chart);
  const registry = new Map();
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
    const markerPoint = resolveMarkerPoint(annotation);
    if (!record) {
      pruneAge(observedAtMs);
      ensureCapacityForNew();
      const requestedGeneration = renderGeneration;
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
    } else if (record.markerShape !== annotation.markerShape) {
      const requestedGeneration = renderGeneration;
      const markerId = await createAlignedShape(
        chart,
        markerPoint,
        shapeOptions(annotation.markerShape, annotation.markerColor),
      );
      if (requestedGeneration !== renderGeneration) {
        chart.removeEntity(markerId);
        return false;
      }
      chart.removeEntity(record.markerId);
      record.markerId = markerId;
      record.markerShape = annotation.markerShape;
      record.observedAtMs = observedAtMs;
    } else {
      updateAlignedShape(
        chart,
        record.markerId,
        markerPoint,
        { color: annotation.markerColor },
      );
      record.observedAtMs = observedAtMs;
    }
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
