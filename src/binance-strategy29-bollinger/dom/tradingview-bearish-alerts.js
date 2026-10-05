import { createChartMarkerOverlay } from '../../shared/chart-marker-overlay.js';
import { findBinanceTradingViewTarget } from '../../shared/tradingview-target.js';
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
    'dataReady',
    'exportData',
    'hasModel',
    'onDataLoaded',
    'onIntervalChanged',
    'resolution',
    'symbol',
  ]) {
    if (typeof chart?.[method] !== 'function') {
      throw new Error(`TradingView Bollinger alert method is unavailable: ${method}`);
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
  throw new Error(`TradingView Bollinger alert resolution is unsupported: ${resolution}`);
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

/** Map strategy output onto the shared read-only chart presentation contract. */
function createMarkerLayer(target, defaultDirection, options) {
  const overlay = createChartMarkerOverlay(target, { ...options, maxMarkers: MAX_BOLLINGER_MARKERS });
  return Object.freeze({
    async render(nextSignals, { isCurrent }) {
      try {
        if (!Array.isArray(nextSignals)) throw new Error('TradingView Bollinger alert signals are invalid');
        if (nextSignals.length > MAX_BOLLINGER_MARKERS) {
          throw new Error(`TradingView Bollinger alert marker limit exceeded: ${nextSignals.length}`);
        }
        if (typeof isCurrent !== 'function') {
          throw new Error('TradingView Bollinger alert current-target validator is unavailable');
        }
        const normalized = nextSignals.map((signal, index) => normalizeSignal(signal, index, defaultDirection));
        const counts = { bearish: 0, bullish: 0 }, ids = new Set();
        for (const signal of normalized) {
          if (!Number.isInteger(signal.time) || !Number.isFinite(signal.markerPrice)) {
            throw new Error('TradingView Bollinger alert signal point is invalid');
          }
          if (!['warning', 'confirmed', 'reversal'].includes(signal.type)) {
            throw new Error(`TradingView Bollinger alert signal type is invalid: ${signal.type}`);
          }
          if (ids.has(signal.id)) throw new Error(`TradingView Bollinger alert duplicate signal id: ${signal.id}`);
          ids.add(signal.id);
          counts[signal.direction] += 1;
          if (counts[signal.direction] > MAX_BOLLINGER_MARKERS_PER_DIRECTION) {
            throw new Error(`TradingView Bollinger alert ${signal.direction} marker limit exceeded: ${counts[signal.direction]}`);
          }
        }
        const markers = normalized.map(signal => {
          const bullish = signal.direction === 'bullish';
          const up = signal.type === 'reversal' ? !bullish : bullish;
          const circle = signal.type === 'warning';
          return { id: signal.id, time: signal.time, price: signal.markerPrice,
            shape: circle ? 'circle' : up ? 'arrow_up' : 'arrow_down',
            color: (circle ? bullish : up) ? '#0ECB81' : '#F6465D',
            size: circle ? 10 : 18, anchor: circle ? 'center' : 'tip',
            type: signal.type, direction: signal.direction };
        });
        return overlay.render(markers, { isCurrent });
      } catch (error) { overlay.clear(); throw error; }
    },
    clear: overlay.clear,
    get size() { return overlay.size; },
    get overlayStats() { return overlay.overlayStats; },
  });
}

export function createBollingerMarkerLayer(target, options) {
  return createMarkerLayer(target, undefined, options);
}

export function createBearishBollingerMarkerLayer(target, options) {
  return createMarkerLayer(target, 'bearish', options);
}
