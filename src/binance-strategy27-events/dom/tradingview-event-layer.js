const CHART_ROOT_SELECTOR = '.chart-widget-root';
const STATUS_ID = 'jh-strategy27-event-status';

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

function shapeOptions(shape, color, text = '') {
  return {
    shape,
    text,
    lock: true,
    disableSave: true,
    disableSelection: true,
    disableUndo: true,
    showInObjectsTree: false,
    overrides: {
      color,
      fontsize: 12,
      fixedSize: true,
      wordWrap: true,
      wordWrapWidth: 220,
    },
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
  const registry = new Map();

  function removeRecord(eventId) {
    const record = registry.get(eventId);
    if (!record) return;
    for (const id of [record.markerId, record.noteId]) {
      if (id) chart.removeEntity(id);
    }
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
    if (!record) {
      pruneAge(observedAtMs);
      ensureCapacityForNew();
      const markerId = await createAlignedShape(chart, {
        time: annotation.markerTime,
        price: annotation.markerPrice,
      }, shapeOptions(annotation.markerShape, annotation.markerColor));
      record = { markerId, noteId: null, observedAtMs };
      registry.set(eventId, record);
    } else {
      updateAlignedShape(chart, record.markerId, {
        time: annotation.markerTime,
        price: annotation.markerPrice,
      }, { color: annotation.markerColor });
      record.observedAtMs = observedAtMs;
    }
    return record;
  }

  async function ensureNote(eventId, annotation, observedAtMs) {
    const record = await ensureMarker(eventId, annotation, observedAtMs);
    const point = { time: annotation.noteTime, price: annotation.notePrice };
    if (!record.noteId) {
      record.noteId = await createAlignedShape(
        chart,
        point,
        shapeOptions('text', annotation.markerColor, annotation.noteText),
      );
    } else {
      updateAlignedShape(chart, record.noteId, point, {
        color: annotation.markerColor,
        text: annotation.noteText,
      });
    }
  }

  return Object.freeze({
    renderOpened: (eventId, annotation, observedAtMs) => ensureMarker(eventId, annotation, observedAtMs),
    renderUpdated: (eventId, annotation, observedAtMs) => ensureMarker(eventId, annotation, observedAtMs),
    renderClosed: (eventId, annotation, observedAtMs) => ensureNote(eventId, annotation, observedAtMs),
    renderOutcome: (eventId, annotation, observedAtMs) => ensureNote(eventId, annotation, observedAtMs),
    remove: removeRecord,
    prune: pruneAge,
    clear() {
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
