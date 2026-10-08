import { createChartMarkerOverlay } from '../../shared/chart-marker-overlay.js';

const CHART_ROOT_SELECTOR = '.chart-widget-root';
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
  for (const method of ['hasModel', 'dataReady', 'onIntervalChanged', 'onDataLoaded', 'resolution', 'symbol']) {
    if (typeof chart?.[method] !== 'function') throw new Error(`TradingView chart method is unavailable: ${method}`);
  }
}

/** Check chart identity around candle waits, before the next context tick. */
export function pinMarkerChartContext(chart) {
  const symbol = chart.symbol();
  const resolution = chart.resolution();
  return () => chart.symbol() === symbol && chart.resolution() === resolution;
}

/** Resolve the frame from the root validated by this synchronous context sample. */
export function findStrategy27ChartTarget(chartRoot, expectedRouteSymbol) {
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
  onRenderError,
}) {
  if (!Number.isInteger(maxEvents) || maxEvents < 1) throw new Error('Strategy 27 maxEvents is invalid');
  if (!Number.isInteger(maxAgeMs) || maxAgeMs < 1) throw new Error('Strategy 27 maxAgeMs is invalid');
  const placement = createTradingViewMarkerPlacement(target.chart, { candleWaitMs });
  const isChartCurrent = pinMarkerChartContext(target.chart);
  const registry = new Map();
  const pendingRenders = new Map();
  let renderGeneration = 0;
  let suspended = false;
  const overlay = createChartMarkerOverlay(target, {
    maxMarkers: maxEvents,
    onRenderError(error) {
      suspend();
      if (onRenderError) onRenderError(error);
      else throw error;
    },
  });
  const markers = () => [...registry.values()].map(record => record.marker);

  function removeRecord(eventId) {
    pendingRenders.get(eventId)?.abort();
    const record = registry.get(eventId);
    if (!record) return;
    registry.delete(eventId);
    overlay.remove([record.marker.id]);
  }

  function pruneAge(observedAtMs) {
    for (const [eventId, record] of registry) {
      if (observedAtMs - record.observedAtMs > maxAgeMs) removeRecord(eventId);
    }
  }

  function ensureCapacityForNew() {
    while (registry.size >= maxEvents) removeRecord(registry.keys().next().value);
  }

  async function reconcile() {
    if (!suspended) overlay.render(markers(), { isCurrent: isChartCurrent });
  }

  async function ensureMarker(eventId, annotation, observedAtMs) {
    if (suspended) return false;
    const existing = registry.get(eventId);
    if (existing) {
      existing.observedAtMs = observedAtMs;
      return overlay.render(markers(), { isCurrent: isChartCurrent });
    }
    if (annotation.markerShape === null) return true;
    const requestedGeneration = renderGeneration;
    const controller = new AbortController();
    pendingRenders.set(eventId, controller);
    try {
      const point = await placement.wait(annotation, { signal: controller.signal });
      if (!point || suspended || controller.signal.aborted || requestedGeneration !== renderGeneration || !isChartCurrent()) return false;
      pruneAge(observedAtMs);
      ensureCapacityForNew();
      const marker = { id: `event:${eventId}`, time: point.time, price: point.price,
        shape: annotation.markerShape, color: annotation.markerColor, size: 18, anchor: 'tip',
        type: 'ordinary', direction: annotation.markerShape === 'arrow_up' ? 'bullish' : 'bearish' };
      if (!overlay.render([...markers(), marker], { isCurrent: isChartCurrent })) return false;
      // Retain the first accepted point and style; later facts never move it.
      registry.set(eventId, { marker, observedAtMs });
      return true;
    } finally {
      if (pendingRenders.get(eventId) === controller) pendingRenders.delete(eventId);
    }
  }

  /** Freeze verified evidence while cancelling unfinished candle placement. */
  function suspend() {
    suspended = true;
    renderGeneration += 1;
    for (const controller of pendingRenders.values()) controller.abort();
  }

  return Object.freeze({
    renderOpened: (eventId, annotation, observedAtMs) => ensureMarker(eventId, annotation, observedAtMs),
    renderUpdated: (eventId, annotation, observedAtMs) => ensureMarker(eventId, annotation, observedAtMs),
    renderClosed: (eventId, annotation, observedAtMs) => ensureMarker(eventId, annotation, observedAtMs),
    renderOutcome: (eventId, annotation, observedAtMs) => ensureMarker(eventId, annotation, observedAtMs),
    remove: removeRecord,
    prune: pruneAge,
    reconcile,
    suspend,
    clear() {
      renderGeneration += 1;
      for (const controller of pendingRenders.values()) controller.abort();
      registry.clear();
      overlay.clear();
    },
    get size() { return registry.size; },
  });
}
