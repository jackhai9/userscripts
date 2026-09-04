import { findBinanceTradingViewTarget } from '../../shared/tradingview-target.js';
import { installTradingViewMarkerSaveController } from '../../shared/chart-marker-save-controller.js';
import {
  TradingViewBarSnapshotInconsistentError,
} from '../core/bearish-bollinger-pattern.js';

export const MAX_BOLLINGER_MARKERS_PER_DIRECTION = 1_000;
export const MAX_BOLLINGER_MARKERS = MAX_BOLLINGER_MARKERS_PER_DIRECTION * 2;
export const MAX_BEARISH_BOLLINGER_MARKERS = MAX_BOLLINGER_MARKERS_PER_DIRECTION;

function routeSymbolFromChartSymbol(value) {
  return String(value || '').split('@', 1)[0];
}

function assertChartContract(chart) {
  for (const method of [
    'createShape',
    'dataReady',
    'exportData',
    'getAllShapes',
    'getShapeById',
    'hasModel',
    'onDataLoaded',
    'onIntervalChanged',
    'removeEntity',
    'resolution',
    'symbol',
  ]) {
    if (typeof chart?.[method] !== 'function') {
      throw new Error(`TradingView Bollinger alert method is unavailable: ${method}`);
    }
  }
}

function readLiveShapes(chart) {
  const shapes = chart.getAllShapes();
  if (!Array.isArray(shapes)) {
    throw new Error('TradingView Bollinger alert shape list is invalid');
  }
  const ids = new Map();
  for (const [index, shape] of shapes.entries()) {
    if (typeof shape?.id !== 'string' || shape.id.length === 0 || typeof shape.name !== 'string') {
      throw new Error(`TradingView Bollinger alert shape ${index} id is invalid`);
    }
    ids.set(shape.id, shape.name);
  }
  return ids;
}

export function tradingViewResolutionToSeconds(resolution) {
  const value = String(resolution || '').toUpperCase();
  const units = [
    { pattern: /^(\d+)S$/, seconds: 1 },
    { pattern: /^(\d+)$/, seconds: 60 },
    { pattern: /^(\d+)H$/, seconds: 60 * 60 },
    { pattern: /^(\d+)D$/, seconds: 24 * 60 * 60 },
    { pattern: /^(\d+)W$/, seconds: 7 * 24 * 60 * 60 },
  ];
  for (const { pattern, seconds } of units) {
    const match = value.match(pattern);
    if (!match) continue;
    const count = Number(match[1]);
    if (Number.isSafeInteger(count) && count > 0) return count * seconds;
  }
  throw new Error(`TradingView Bollinger alert resolution is unsupported: ${resolution}`);
}

/** Native drawings must stay hidden outside their originating interval, including while saves defer removal. */
export function bollingerIntervalVisibility(resolution) {
  const seconds = tradingViewResolutionToSeconds(resolution);
  const value = String(resolution).toUpperCase();
  const visibility = {
    ticks: false, seconds: false, minutes: false, hours: false,
    days: false, weeks: false, months: false, ranges: false,
  };
  let unit;
  let count;
  if (value.endsWith('W')) { unit = 'weeks'; count = seconds / 604800; }
  else if (value.endsWith('D')) { unit = 'days'; count = seconds / 86400; }
  else if (seconds < 60) { unit = 'seconds'; count = seconds; }
  else if (value.endsWith('S') || seconds < 3600) { unit = 'minutes'; count = Math.floor(seconds / 60); }
  else { unit = 'hours'; count = Math.floor(seconds / 3600); }
  // TradingView groups 60+ minute intervals into integer-hour visibility buckets.
  visibility[unit] = true;
  visibility[`${unit}From`] = count;
  visibility[`${unit}To`] = count;
  return visibility;
}

/**
 * dataReady() in Binance's chart runtime only checks for nonempty data. A revision
 * and the data-completed event are needed to exclude old bars during A -> B -> A.
 * Event callbacks never export or mutate drawings: interval notification precedes
 * the host's data reset, and drawing/save owners may still be busy.
 */
export function createBollingerIntervalSession(chart) {
  const intervalChanged = chart.onIntervalChanged();
  const dataLoaded = chart.onDataLoaded();
  for (const subscription of [intervalChanged, dataLoaded]) {
    if (typeof subscription?.subscribe !== 'function' || typeof subscription.unsubscribe !== 'function') {
      throw new Error('TradingView Bollinger interval subscription is unavailable');
    }
  }
  let revision = 0;
  let disposed = false;
  let awaitingData = !chart.dataReady();
  // Binance clears its null-owned listeners when rebinding chart callbacks.
  // A private owner keeps that host cleanup from deleting our readiness session.
  const owner = {};
  function invalidate() { revision += 1; awaitingData = true; }
  function complete() { awaitingData = false; }
  intervalChanged.subscribe(owner, invalidate);
  dataLoaded.subscribe(owner, complete);
  return Object.freeze({
    get revision() { return revision; },
    isCurrent(candidate) {
      return !disposed && !awaitingData && candidate === revision && chart.dataReady();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      revision += 1;
      intervalChanged.unsubscribe(owner, invalidate);
      dataLoaded.unsubscribe(owner, complete);
    },
  });
}

export function findBearishBollingerChartTarget(document, expectedRouteSymbol) {
  const baseTarget = findBinanceTradingViewTarget(document);
  if (!baseTarget) return null;
  const chart = baseTarget.tradingViewApi.activeChart?.();
  if (!chart) return null;
  assertChartContract(chart);
  // The API object is exposed before its model exists during first refresh.
  if (!chart.hasModel()) return null;
  const resolution = chart.resolution();
  const resolutionSeconds = tradingViewResolutionToSeconds(resolution);
  const routeSymbol = routeSymbolFromChartSymbol(chart.symbol());
  if (routeSymbol !== expectedRouteSymbol) {
    throw new Error(
      `TradingView Bollinger alert symbol mismatch: expected ${expectedRouteSymbol}, received ${routeSymbol}`,
    );
  }
  return {
    ...baseTarget,
    chart,
    resolution,
    resolutionSeconds,
    routeSymbol,
  };
}

export function isBearishBollingerChartTargetCurrent(document, target) {
  const baseTarget = findBinanceTradingViewTarget(document);
  if (!baseTarget) return false;
  const chart = baseTarget.tradingViewApi.activeChart?.();
  if (!chart) return false;
  assertChartContract(chart);
  if (!chart.hasModel()) return false;
  return (
    baseTarget.chartRoot === target.chartRoot
    && baseTarget.tradingViewApi === target.tradingViewApi
    && chart === target.chart
    && chart.resolution() === target.resolution
    && routeSymbolFromChartSymbol(chart.symbol()) === target.routeSymbol
  );
}

function assertExportSchema(schema) {
  if (!Array.isArray(schema)) throw new Error('TradingView Bollinger alert export schema is invalid');
  const fields = schema.map((column) => column.plotTitle || column.type);
  const expected = ['time', 'open', 'high', 'low', 'close'];
  if (fields.length !== expected.length || fields.some((field, index) => field !== expected[index])) {
    throw new Error(`TradingView Bollinger alert export schema mismatch: ${fields.join(',')}`);
  }
}

function parseExportRow(row, index) {
  if (!row || typeof row !== 'object') {
    throw new Error(`TradingView Bollinger alert export row ${index} is invalid`);
  }
  const bar = {
    time: row[0],
    open: row[1],
    high: row[2],
    low: row[3],
    close: row[4],
  };
  if (!Number.isInteger(bar.time)) {
    throw new Error(`TradingView Bollinger alert export time ${index} is invalid`);
  }
  for (const field of ['open', 'high', 'low', 'close']) {
    if (!Number.isFinite(bar[field])) {
      throw new Error(`TradingView Bollinger alert export ${field} ${index} is invalid`);
    }
  }
  return bar;
}

export function parseClosedTradingViewBars(
  exported,
  { resolutionSeconds, observedAtSeconds, resolution },
) {
  if (!Number.isSafeInteger(resolutionSeconds) || resolutionSeconds < 1) {
    throw new Error('TradingView Bollinger alert resolution seconds are invalid');
  }
  if (!Number.isFinite(observedAtSeconds)) {
    throw new Error('TradingView Bollinger alert observation time is invalid');
  }
  assertExportSchema(exported?.schema);
  if (!Array.isArray(exported.data)) {
    throw new Error('TradingView Bollinger alert export data is invalid');
  }
  // Binance's current trading-platform-30 runtime exports one numeric-keyed object per bar.
  // This deliberately follows that live contract instead of TradingView's generic column model.
  const bars = exported.data.map(parseExportRow);
  // Multi-day/week feeds need not share the Unix epoch's phase. Intraday bars use
  // UTC boundaries; D/W bars start at UTC midnight, with weekly bars on Monday.
  const gridSeconds = Math.min(resolutionSeconds, 86400);
  for (const [index, bar] of bars.entries()) {
    if (
      bar.time % gridSeconds !== 0
      || (String(resolution).toUpperCase().endsWith('W') && new Date(bar.time * 1000).getUTCDay() !== 1)
    ) {
      throw new TradingViewBarSnapshotInconsistentError(
        `TradingView Bollinger alert export interval grid is invalid at ${index}`,
      );
    }
  }
  for (let index = 1; index < bars.length; index += 1) {
    if (bars[index].time <= bars[index - 1].time) {
      throw new TradingViewBarSnapshotInconsistentError(
        `TradingView Bollinger alert export order is invalid at ${index}`,
      );
    }
    if ((bars[index].time - bars[index - 1].time) % resolutionSeconds !== 0) {
      throw new TradingViewBarSnapshotInconsistentError(
        `TradingView Bollinger alert export interval spacing is invalid at ${index}`,
      );
    }
  }
  return bars.filter((bar) => bar.time + resolutionSeconds <= observedAtSeconds);
}

export function buildClosedBarsWindowKey(bars) {
  if (!Array.isArray(bars) || bars.length === 0) {
    throw new Error('TradingView Bollinger alert closed-bar window is empty');
  }
  return `${bars.length}:${bars[0].time}:${bars.at(-1).time}`;
}

export function buildClosedBarsContentKey(bars) {
  const windowKey = buildClosedBarsWindowKey(bars);
  const content = bars.map((bar) => [bar.time, bar.open, bar.high, bar.low, bar.close]);
  return `${windowKey}:${JSON.stringify(content)}`;
}

function writeClosedBarToSnapshot(values, offset, bar, index) {
  if (!bar || typeof bar !== 'object') {
    throw new Error(`TradingView Bollinger closed bar ${index} is invalid`);
  }
  if (!Number.isInteger(bar.time)) {
    throw new Error(`TradingView Bollinger closed bar time ${index} is invalid`);
  }
  const fields = ['open', 'high', 'low', 'close'];
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

export function buildClosedBarsContentSnapshot(bars) {
  const windowKey = buildClosedBarsWindowKey(bars);
  const values = new Float64Array(bars.length * 5);
  for (let index = 0; index < bars.length; index += 1) {
    writeClosedBarToSnapshot(values, index * 5, bars[index], index);
  }
  return { windowKey, values };
}

export function matchesClosedBarsContentSnapshot(bars, snapshot) {
  if (
    !snapshot
    || typeof snapshot !== 'object'
    || typeof snapshot.windowKey !== 'string'
    || !(snapshot.values instanceof Float64Array)
  ) {
    throw new Error('TradingView Bollinger closed-bar snapshot is invalid');
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

/**
 * Reuses detector output for an unchanged bar window while still reconciling live markers.
 */
export async function reconcileBearishBollingerAlertWindow({
  bars,
  cachedWindowKey,
  cachedContentSnapshot = null,
  cachedSignals,
  detectSignals,
  renderSignals,
}) {
  if (typeof detectSignals !== 'function') {
    throw new Error('TradingView Bollinger alert detector is unavailable');
  }
  if (typeof renderSignals !== 'function') {
    throw new Error('TradingView Bollinger alert renderer is unavailable');
  }
  const closedBarsWindowKey = buildClosedBarsWindowKey(bars);
  const contentUnchanged = (
    closedBarsWindowKey === cachedWindowKey
    && cachedContentSnapshot !== null
    && matchesClosedBarsContentSnapshot(bars, cachedContentSnapshot)
  );
  const signals = contentUnchanged
    ? cachedSignals
    : detectSignals(bars);
  if (!Array.isArray(signals)) {
    throw new Error('Bollinger signal cache is invalid');
  }
  const rendered = await renderSignals(signals);
  if (typeof rendered !== 'boolean') {
    throw new Error('TradingView Bollinger alert render result is invalid');
  }
  return {
    rendered,
    closedBarsWindowKey,
    closedBarsContentSnapshot: contentUnchanged
      ? cachedContentSnapshot
      : buildClosedBarsContentSnapshot(bars),
    signals,
  };
}

export async function exportClosedTradingViewBars(target, session, observedAtMs = Date.now()) {
  const revision = session.revision;
  const isCurrent = () => session.isCurrent(revision)
    && target.chart.resolution() === target.resolution
    && routeSymbolFromChartSymbol(target.chart.symbol()) === target.routeSymbol;
  if (!isCurrent()) return null;
  const exported = await target.chart.exportData({ includedStudies: [] });
  if (!isCurrent()) return null;
  return parseClosedTradingViewBars(exported, {
    resolutionSeconds: target.resolutionSeconds,
    resolution: target.resolution,
    observedAtSeconds: observedAtMs / 1_000,
  });
}

function markerOptions(signal, resolution) {
  const direction = signal.direction;
  if (direction !== 'bearish' && direction !== 'bullish') {
    throw new Error(`TradingView Bollinger alert signal direction is invalid: ${direction}`);
  }
  const isBullish = direction === 'bullish';
  const common = {
    lock: true,
    disableSave: true,
    disableSelection: true,
    disableUndo: true,
    showInObjectsTree: false,
  };
  if (signal.type === 'warning') {
    return {
      ...common,
      shape: 'icon',
      icon: 0xf111,
      overrides: {
        visible: true,
        intervalsVisibilities: bollingerIntervalVisibility(resolution),
        color: isBullish ? '#0ECB81' : '#F6465D',
        size: 10,
      },
    };
  }
  if (signal.type === 'confirmed') {
    return {
      ...common,
      shape: isBullish ? 'arrow_up' : 'arrow_down',
      overrides: {
        visible: true,
        intervalsVisibilities: bollingerIntervalVisibility(resolution),
        color: isBullish ? '#0ECB81' : '#F6465D',
        arrowColor: isBullish ? '#0ECB81' : '#F6465D',
      },
    };
  }
  if (signal.type === 'reversal') {
    return {
      ...common,
      shape: isBullish ? 'arrow_down' : 'arrow_up',
      overrides: {
        visible: true,
        intervalsVisibilities: bollingerIntervalVisibility(resolution),
        color: isBullish ? '#F6465D' : '#0ECB81',
        arrowColor: isBullish ? '#F6465D' : '#0ECB81',
      },
    };
  }
  throw new Error(`TradingView Bollinger alert signal type is invalid: ${signal.type}`);
}

function readMarkerPoint(shape) {
  const points = shape?.getPoints?.();
  if (!Array.isArray(points) || points.length !== 1 || !Number.isInteger(points[0].time) || !Number.isFinite(points[0].price)) {
    throw new Error('TradingView Bollinger alert marker point is invalid');
  }
  return points[0];
}

function markerPropertiesMatch(shape, options) {
  const properties = shape.getProperties();
  if (!properties || typeof properties !== 'object') {
    throw new Error('TradingView Bollinger alert marker properties are invalid');
  }
  if (options.icon !== undefined && properties.icon !== options.icon) return false;
  for (const [key, expected] of Object.entries(options.overrides)) {
    if (key === 'intervalsVisibilities') {
      if (!properties[key] || Object.entries(expected).some(([unit, value]) => properties[key][unit] !== value)) return false;
    } else if (properties[key] !== expected) return false;
  }
  return true;
}

function normalizeSignal(signal, index, defaultDirection) {
  if (!signal || typeof signal !== 'object') {
    throw new Error(`TradingView Bollinger alert signal ${index} is invalid`);
  }
  if (typeof signal.id !== 'string' || signal.id.length === 0) {
    throw new Error(`TradingView Bollinger alert signal ${index} id is invalid`);
  }
  const direction = signal.direction === undefined ? defaultDirection : signal.direction;
  if (direction !== 'bearish' && direction !== 'bullish') {
    throw new Error(`TradingView Bollinger alert signal ${index} direction is invalid: ${direction}`);
  }
  return signal.direction === direction ? signal : { ...signal, direction };
}

function createMarkerLayer(target, defaultDirection, {
  canMutate: canMutateExternally = () => true,
  onSaveError,
  yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0)),
} = {}) {
  const { chart } = target;
  const saveController = installTradingViewMarkerSaveController(target.tradingViewApi, { onError: onSaveError });
  const canMutate = () => canMutateExternally() && saveController.canMutate();
  const registry = new Map();
  const pendingMarkers = new Set();
  let generation = 0;
  let creating = 0;

  function mutate(action) {
    const finish = saveController.beginMutation();
    try { return action(); } finally { finish(); }
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
      if (!Array.isArray(signals)) throw new Error('TradingView Bollinger alert signals are invalid');
      if (signals.length > MAX_BOLLINGER_MARKERS) {
        throw new Error(
          `TradingView Bollinger alert marker limit exceeded: ${signals.length}`,
        );
      }
      if (typeof isCurrent !== 'function') {
        throw new Error('TradingView Bollinger alert current-target validator is unavailable');
      }
      const normalizedSignals = signals.map((signal, index) => (
        normalizeSignal(signal, index, defaultDirection)
      ));
      const directionCounts = { bearish: 0, bullish: 0 };
      for (const signal of normalizedSignals) {
        directionCounts[signal.direction] += 1;
        if (directionCounts[signal.direction] > MAX_BOLLINGER_MARKERS_PER_DIRECTION) {
          throw new Error(
            `TradingView Bollinger alert ${signal.direction} marker limit exceeded: `
            + directionCounts[signal.direction],
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
        // Awaiting native shape creation may resolve as a microtask. Explicitly
        // yield large audits/rebuilds so input and paint can run between batches.
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
          if (
            point.time === signal.time && point.price === existing.resolvedPrice
            && existing.markerPrice === signal.markerPrice
            && existing.type === signal.type && existing.direction === signal.direction
            && liveShapeIds.get(existing.markerId) === options.shape
            && markerPropertiesMatch(shape, options)
          ) continue;
          removeSignal(signal.id, liveShapeIds);
        }
        const finishCreation = saveController.beginMutation();
        creating += 1;
        try {
          // Native creation enables the interval active after its async loader.
          // Keep pending drawings hidden until the originating session can publish.
          const markerId = await chart.createShape({ time: signal.time, price: signal.markerPrice }, {
            ...options,
            overrides: { ...options.overrides, visible: false },
          });
          if (typeof markerId !== 'string' || markerId.length === 0) {
            throw new Error('TradingView returned an invalid Bollinger alert shape id');
          }
          // Own the result before checking the epoch. Late results may need to wait
          // for a trade/save owner, and must never become untracked foreign drawings.
          pendingMarkers.add(markerId);
          if (requestedGeneration !== generation || !isCurrent() || !canMutate()) return false;
          const shape = chart.getShapeById(markerId);
          const point = readMarkerPoint(shape);
          if (point.time !== signal.time) {
            throw new Error(`TradingView Bollinger alert time alignment failed for ${signal.time}`);
          }
          if (requestedGeneration !== generation || !isCurrent() || !canMutate()) return false;
          mutate(() => shape.setProperties(options.overrides, false));
          if (!markerPropertiesMatch(shape, options)) {
            throw new Error('TradingView Bollinger alert marker properties were not applied');
          }
          registry.set(signal.id, {
            markerId, resolvedPrice: point.price, markerPrice: signal.markerPrice,
            type: signal.type, direction: signal.direction,
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
    },
  });
}

export function createBollingerMarkerLayer(target, options) {
  return createMarkerLayer(target, undefined, options);
}

export function createBearishBollingerMarkerLayer(target, options) {
  return createMarkerLayer(target, 'bearish', options);
}
