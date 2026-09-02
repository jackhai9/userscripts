import { findBinanceTradingViewTarget } from './tradingview-target.js';

export const MAX_BEARISH_BOLLINGER_MARKERS = 1_000;

function routeSymbolFromChartSymbol(value) {
  return String(value || '').split('@', 1)[0];
}

function assertChartContract(chart) {
  for (const method of [
    'createShape',
    'dataReady',
    'exportData',
    'getShapeById',
    'removeEntity',
    'resolution',
    'symbol',
  ]) {
    if (typeof chart?.[method] !== 'function') {
      throw new Error(`TradingView bearish alert method is unavailable: ${method}`);
    }
  }
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
  throw new Error(`TradingView bearish alert resolution is unsupported: ${resolution}`);
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
      `TradingView bearish alert symbol mismatch: expected ${expectedRouteSymbol}, received ${routeSymbol}`,
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
  if (!Array.isArray(schema)) throw new Error('TradingView bearish alert export schema is invalid');
  const fields = schema.map((column) => column.plotTitle || column.type);
  const expected = ['time', 'open', 'high', 'low', 'close'];
  if (fields.length !== expected.length || fields.some((field, index) => field !== expected[index])) {
    throw new Error(`TradingView bearish alert export schema mismatch: ${fields.join(',')}`);
  }
}

function parseExportRow(row, index) {
  if (!row || typeof row !== 'object') {
    throw new Error(`TradingView bearish alert export row ${index} is invalid`);
  }
  const bar = {
    time: row[0],
    open: row[1],
    high: row[2],
    low: row[3],
    close: row[4],
  };
  if (!Number.isInteger(bar.time)) {
    throw new Error(`TradingView bearish alert export time ${index} is invalid`);
  }
  for (const field of ['open', 'high', 'low', 'close']) {
    if (!Number.isFinite(bar[field])) {
      throw new Error(`TradingView bearish alert export ${field} ${index} is invalid`);
    }
  }
  return bar;
}

export function parseClosedTradingViewBars(
  exported,
  { resolutionSeconds, observedAtSeconds },
) {
  if (!Number.isSafeInteger(resolutionSeconds) || resolutionSeconds < 1) {
    throw new Error('TradingView bearish alert resolution seconds are invalid');
  }
  if (!Number.isFinite(observedAtSeconds)) {
    throw new Error('TradingView bearish alert observation time is invalid');
  }
  assertExportSchema(exported?.schema);
  if (!Array.isArray(exported.data)) {
    throw new Error('TradingView bearish alert export data is invalid');
  }
  // Binance's current trading-platform-30 runtime exports one numeric-keyed object per bar.
  // This deliberately follows that live contract instead of TradingView's generic column model.
  const bars = exported.data.map(parseExportRow);
  for (let index = 1; index < bars.length; index += 1) {
    if (bars[index].time <= bars[index - 1].time) {
      throw new Error(`TradingView bearish alert export order is invalid at ${index}`);
    }
  }
  return bars.filter((bar) => bar.time + resolutionSeconds <= observedAtSeconds);
}

export function buildClosedBarsWindowKey(bars) {
  if (!Array.isArray(bars) || bars.length === 0) {
    throw new Error('TradingView bearish alert closed-bar window is empty');
  }
  return `${bars.length}:${bars[0].time}:${bars.at(-1).time}`;
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
      shape: 'arrow_down',
      overrides: {
        color: '#F6465D',
        arrowColor: '#F6465D',
        fixedSize: true,
      },
    };
  }
  if (signal.type === 'reversal') {
    return {
      ...common,
      shape: 'arrow_up',
      overrides: {
        color: '#0ECB81',
        arrowColor: '#0ECB81',
        fixedSize: true,
      },
    };
  }
  throw new Error(`TradingView bearish alert signal type is invalid: ${signal.type}`);
}

function verifyResolvedTime(chart, id, requestedTime) {
  const shape = chart.getShapeById(id);
  const points = shape?.getPoints?.();
  if (!Array.isArray(points) || points.length !== 1 || points[0].time !== requestedTime) {
    throw new Error(`TradingView bearish alert time alignment failed for ${requestedTime}`);
  }
}

async function createAlignedMarker(chart, signal) {
  const id = await chart.createShape({
    time: signal.time,
    price: signal.markerPrice,
  }, markerOptions(signal));
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('TradingView returned an invalid bearish alert shape id');
  }
  try {
    verifyResolvedTime(chart, id, signal.time);
  } catch (error) {
    chart.removeEntity(id);
    throw error;
  }
  return id;
}

export function createBearishBollingerMarkerLayer(target) {
  const { chart } = target;
  const registry = new Map();
  let generation = 0;

  function removeSignal(signalId) {
    const record = registry.get(signalId);
    if (!record) return;
    chart.removeEntity(record.markerId);
    registry.delete(signalId);
  }

  return Object.freeze({
    async render(signals, { isCurrent }) {
      if (!Array.isArray(signals)) throw new Error('TradingView bearish alert signals are invalid');
      if (signals.length > MAX_BEARISH_BOLLINGER_MARKERS) {
        throw new Error(
          `TradingView bearish alert marker limit exceeded: ${signals.length}`,
        );
      }
      if (typeof isCurrent !== 'function') {
        throw new Error('TradingView bearish alert current-target validator is unavailable');
      }
      const requestedGeneration = generation;
      if (!isCurrent()) return false;
      const nextIds = new Set(signals.map((signal) => signal.id));
      for (const signalId of [...registry.keys()]) {
        if (!nextIds.has(signalId)) removeSignal(signalId);
      }
      for (const signal of signals) {
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
      for (const signalId of [...registry.keys()]) removeSignal(signalId);
    },
    get size() {
      return registry.size;
    },
  });
}
