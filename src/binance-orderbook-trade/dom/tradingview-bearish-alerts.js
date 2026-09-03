import { findBinanceTradingViewTarget } from './tradingview-target.js';
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
    'removeEntity',
    'resolution',
    'symbol',
  ]) {
    if (typeof chart?.[method] !== 'function') {
      throw new Error(`TradingView Bollinger alert method is unavailable: ${method}`);
    }
  }
}

function readLiveShapeIds(chart) {
  const shapes = chart.getAllShapes();
  if (!Array.isArray(shapes)) {
    throw new Error('TradingView Bollinger alert shape list is invalid');
  }
  const ids = new Set();
  for (const [index, shape] of shapes.entries()) {
    if (typeof shape?.id !== 'string' || shape.id.length === 0) {
      throw new Error(`TradingView Bollinger alert shape ${index} id is invalid`);
    }
    ids.add(shape.id);
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

export function findBearishBollingerChartTarget(document, expectedRouteSymbol) {
  const baseTarget = findBinanceTradingViewTarget(document);
  if (!baseTarget) return null;
  const chart = baseTarget.tradingViewApi.activeChart?.();
  if (!chart) return null;
  assertChartContract(chart);
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
  { resolutionSeconds, observedAtSeconds },
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
  for (let index = 1; index < bars.length; index += 1) {
    if (bars[index].time <= bars[index - 1].time) {
      throw new TradingViewBarSnapshotInconsistentError(
        `TradingView Bollinger alert export order is invalid at ${index}`,
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

export async function exportClosedTradingViewBars(target, observedAtMs = Date.now()) {
  if (!target.chart.dataReady()) return null;
  const exported = await target.chart.exportData({ includedStudies: [] });
  return parseClosedTradingViewBars(exported, {
    resolutionSeconds: target.resolutionSeconds,
    observedAtSeconds: observedAtMs / 1_000,
  });
}

function markerOptions(signal) {
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
        color: '#F0B90B',
        size: 10,
      },
    };
  }
  if (signal.type === 'confirmed') {
    return {
      ...common,
      shape: isBullish ? 'arrow_up' : 'arrow_down',
      overrides: {
        color: isBullish ? '#0ECB81' : '#F6465D',
        arrowColor: isBullish ? '#0ECB81' : '#F6465D',
        fixedSize: true,
      },
    };
  }
  if (signal.type === 'reversal') {
    return {
      ...common,
      shape: isBullish ? 'arrow_down' : 'arrow_up',
      overrides: {
        color: isBullish ? '#F6465D' : '#0ECB81',
        arrowColor: isBullish ? '#F6465D' : '#0ECB81',
        fixedSize: true,
      },
    };
  }
  throw new Error(`TradingView Bollinger alert signal type is invalid: ${signal.type}`);
}

function verifyResolvedTime(chart, id, requestedTime) {
  const shape = chart.getShapeById(id);
  const points = shape?.getPoints?.();
  if (!Array.isArray(points) || points.length !== 1 || points[0].time !== requestedTime) {
    throw new Error(`TradingView Bollinger alert time alignment failed for ${requestedTime}`);
  }
}

async function createAlignedMarker(chart, signal) {
  const id = await chart.createShape({
    time: signal.time,
    price: signal.markerPrice,
  }, markerOptions(signal));
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('TradingView returned an invalid Bollinger alert shape id');
  }
  try {
    verifyResolvedTime(chart, id, signal.time);
  } catch (error) {
    chart.removeEntity(id);
    throw error;
  }
  return id;
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

function createMarkerLayer(target, defaultDirection) {
  const { chart } = target;
  const registry = new Map();
  let generation = 0;

  function discardMissingSignals(liveShapeIds) {
    for (const [signalId, record] of registry) {
      if (!liveShapeIds.has(record.markerId)) registry.delete(signalId);
    }
  }

  function removeSignal(signalId, liveShapeIds) {
    const record = registry.get(signalId);
    if (!record) return;
    if (liveShapeIds.has(record.markerId)) {
      chart.removeEntity(record.markerId);
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
      if (!isCurrent()) return false;
      const liveShapeIds = readLiveShapeIds(chart);
      discardMissingSignals(liveShapeIds);
      const nextIds = new Set(normalizedSignals.map((signal) => signal.id));
      for (const signalId of [...registry.keys()]) {
        if (!nextIds.has(signalId)) removeSignal(signalId, liveShapeIds);
      }
      for (const signal of normalizedSignals) {
        if (registry.has(signal.id)) continue;
        if (!isCurrent()) return false;
        const markerId = await createAlignedMarker(chart, signal);
        if (requestedGeneration !== generation || !isCurrent()) {
          chart.removeEntity(markerId);
          return false;
        }
        registry.set(signal.id, { markerId });
      }
      return true;
    },
    clear() {
      generation += 1;
      const liveShapeIds = readLiveShapeIds(chart);
      discardMissingSignals(liveShapeIds);
      for (const signalId of [...registry.keys()]) removeSignal(signalId, liveShapeIds);
    },
    get size() {
      return registry.size;
    },
  });
}

export function createBollingerMarkerLayer(target) {
  return createMarkerLayer(target, undefined);
}

export function createBearishBollingerMarkerLayer(target) {
  return createMarkerLayer(target, 'bearish');
}
