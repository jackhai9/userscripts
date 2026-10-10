import { attachChartMarkerOverlayHost } from '../../helpers/chart-marker-overlay-host.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import * as alertApi from '../../../src/binance-strategy29-bollinger/dom/tradingview-bearish-alerts.js';
import { createBollingerMonitor } from '../../../src/binance-strategy29-bollinger/monitor.js';

import { loadFixtureDom } from '../../helpers/dom.js';
import { captureStrategyError, observeStrategyCondition } from '../../helpers/strategy-migration-boundaries.js';
import {
  buildClosedBarsContentKey,
  buildClosedBarsContentSnapshot,
  buildClosedBarsWindowKey,
  createBollingerMarkerLayer,
  createBearishBollingerMarkerLayer,
  findBearishBollingerChartTarget,
  isBearishBollingerChartTargetCurrent,
  parseClosedTradingViewBars,
  reconcileBearishBollingerAlertWindow,
  MAX_BOLLINGER_MARKERS,
  MAX_BOLLINGER_MARKERS_PER_DIRECTION,
  MAX_BEARISH_BOLLINGER_MARKERS,
  matchesClosedBarsContentSnapshot,
  tradingViewResolutionToSeconds,
} from '../../../src/binance-strategy29-bollinger/dom/tradingview-bearish-alerts.js';
import {
  applyBollingerAlertTaskFailure,
  isTradingViewBarSnapshotInconsistentError,
  TradingViewBarSnapshotInconsistentError,
} from '../../../src/binance-strategy29-bollinger/core/bearish-bollinger-pattern.js';

const monitorSource = await readFile(new URL('../../../src/binance-strategy29-bollinger/monitor.js', import.meta.url), 'utf8');

test('user renders updates and clears 2000 markers without touching native drawings or chart saves', async () => {
  // Given a chart with a user drawing and a full marker history
  const fixture = createChartDom();
  fixture.addForeignShape('user-channel');
  const layer = createBollingerMarkerLayer(findBearishBollingerChartTarget(fixture.dom.window.document, 'BTRUSDT'));
  const signals = Array.from({ length: 2000 }, (_, index) => ({
    id: `overlay-${index}`, direction: index < 1000 ? 'bearish' : 'bullish', type: 'warning',
    time: 60 * (index + 1), markerPrice: 13,
  }));
  // When the history is rendered updated and cleared
  assert.equal(await layer.render(signals, { isCurrent: () => true }), true);
  assert.equal(layer.size, 2000);
  assert.equal(fixture.overlay.markers().length, 1000);
  assert.equal(await layer.render(signals.map(signal => ({ ...signal, markerPrice: 14 })), { isCurrent: () => true }), true);
  assert.equal(fixture.overlay.markers()[0].getAttribute('transform'), 'translate(1 486)');
  assert.equal(layer.clear(), true);
  // Then native chart persistence and foreign drawings are untouched
  assert.equal(fixture.createdOptions.length, 0);
  assert.equal(fixture.removed.length, 0);
  assert.equal(fixture.saveCalls.length, 0);
  assert.deepEqual([...fixture.shapes.keys()], ['user-channel']);
  fixture.dom.window.close();
});


/** Execute the production monitor functions, without the unrelated trading/bootstrap side effects. */
function createMonitorHarness(fixture, dependencyOverrides = {}) {
  const start = monitorSource.indexOf('  function clearBearishBollingerAlertContext()');
  const end = monitorSource.indexOf('  return Object.freeze(', start);
  assert.ok(start > 0 && end > start);
  let busy = false;
  let hidden = false;
  Object.defineProperty(fixture.dom.window.document, 'hidden', { get: () => hidden });
  let symbol = 'BTRUSDT';
  const errors = [];
  let detectorCalls = 0;
  const dependencies = {
    ...alertApi,
    document: fixture.dom.window.document,
    getCurrentSymbol: () => symbol,
    isFuturesTradingPage: () => true,
    isTradingViewDrawingMutationBusy: () => busy,
    applyBollingerAlertTaskFailure,
    detectBollingerSignals: (bars) => {
      detectorCalls += 1;
      return [{ id: `${bars[0].time}:warning`, direction: 'bearish', type: 'warning', time: bars[0].time, markerPrice: 13 }];
    },
    err: (...args) => errors.push(args),
    warn: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    ...dependencyOverrides,
  };
  const factory = new Function(...Object.keys(dependencies), `
    let bearishBollingerAlertTask = null;
    let bearishBollingerAlertContext = null;
    let bollingerIntervalSession = null;
    let lastLocalFailure = null;
    const retiredBollingerLayers = new Set();
    const ladderTask = null, continuousLadderTask = null, singleOrderTask = null;
    const cancelCurrentSymbolOpenOrdersTask = null, chartOrdersRecoveryTask = null;
    const continuousChartSaveController = null;
    ${monitorSource.slice(start, end)}
    return {
      tick: synchronizeBearishBollingerAlerts,
      stop: stopBearishBollingerAlertMonitor,
      get task() { return bearishBollingerAlertTask; },
      get context() { return bearishBollingerAlertContext; },
      get session() { return bollingerIntervalSession; },
      get retiredCount() { return retiredBollingerLayers.size; },
      get diagnostics() { return getBollingerAlertDiagnostics(); },
    };
  `);
  const monitor = factory(...Object.values(dependencies));
  return {
    monitor, errors,
    get detectorCalls() { return detectorCalls; },
    setBusy(value) { busy = value; },
    setHidden(value) { hidden = value; },
    setSymbol(value) { symbol = value; },
    async tick() {
      // A real timer tick runs after the previous task's catch/finally microtasks.
      await Promise.resolve();
      await monitor.tick();
      if (monitor.task) await monitor.task;
      await Promise.resolve();
    },
  };
}

function createChartDom({
  resolution = '1',
  symbol = 'BTRUSDT@PRICETYPE=LAST',
} = {}) {
  const dom = loadFixtureDom('<div class="chart-widget-root"><iframe></iframe></div>');
  const shapes = new Map();
  const removed = [];
  const createdOptions = [];
  const saveCalls = [];
  let currentResolution = resolution;
  let currentSymbol = symbol;
  let modelReady = true;
  function subscription() {
    const listeners = new Map();
    return {
      subscribe(owner, callback) { listeners.set(callback, owner); },
      unsubscribe(owner, callback) { assert.equal(listeners.get(callback), owner); listeners.delete(callback); },
      unsubscribeAll(owner) {
        for (const [callback, registeredOwner] of listeners) {
          if (registeredOwner === owner) listeners.delete(callback);
        }
      },
      fire(...args) { for (const callback of listeners.keys()) callback(...args); },
      get size() { return listeners.size; },
    };
  }
  const intervalChanged = subscription();
  const dataLoaded = subscription();
  const chart = {
    resolution: () => { assert.equal(modelReady, true, 'resolution requires a chart model'); return currentResolution; },
    symbol: () => currentSymbol,
    hasModel: () => modelReady,
    dataReady: () => modelReady,
    onIntervalChanged: () => intervalChanged,
    onDataLoaded: () => dataLoaded,
    exportData: async () => ({ schema: [], data: [] }),
    async createShape(point, properties) { createdOptions.push({ point, properties }); throw new Error('Native markers are forbidden'); },
    getShapeById: (id) => shapes.get(id),
    getAllShapes: () => [...shapes.entries()].map(([id, record]) => ({
      id,
      name: record.properties.shape,
    })),
    removeEntity(id) {
      assert.equal(shapes.has(id), true, `shape ${id} should exist before removal`);
      removed.push(id);
      shapes.delete(id);
    },
  };
  const overlay = attachChartMarkerOverlayHost({ chart, document: dom.window.document });
  let activeChart = chart;
  const tradingViewApi = {
    activeChart: () => activeChart,
    saveChart: (callback) => { saveCalls.push(true); return callback({
      drawings: [...shapes].filter(([, record]) => !record.properties.disableSave).map(([id]) => ({ id })),
    }); },
  };
  dom.window.document.querySelector('iframe').contentWindow.tradingViewApi = tradingViewApi;
  return {
    dom,
    overlay,
    chart,
    tradingViewApi,
    intervalChanged,
    dataLoaded,
    shapes,
    removed,
    createdOptions,
    saveCalls,
    setModelReady: (value) => { modelReady = value; },
    setActiveChart: (value) => { activeChart = value; },
    setResolution: (value) => { currentResolution = value; intervalChanged.fire(value); },
    setSymbol: (value) => { currentSymbol = value; },
    addForeignShape(id = 'foreign-shape') {
      assert.equal(shapes.has(id), false, `shape ${id} should not already exist`);
      shapes.set(id, {
        point: { time: 0, price: 0 },
        properties: { shape: 'trend_line' },
        getPoints() { return [this.point]; },
      });
      return id;
    },
  };
}

function exportResult(rows) {
  return {
    sourceTitle: 'BTRUSDT@PRICETYPE=LAST',
    schema: [
      { type: 'time' },
      { plotTitle: 'open' },
      { plotTitle: 'high' },
      { plotTitle: 'low' },
      { plotTitle: 'close' },
    ],
    data: rows.map((row) => ({ ...row })),
  };
}

/** Deterministic OHLC history includes real bullish and bearish detector setups. */
function fullMonitorHistory() {
  return Array.from({ length: 600 }, (_, index) => {
    const close = 100 + 15 * Math.sin(index * 2 * Math.PI / 80);
    const open = index === 0 ? close : 100 + 15 * Math.sin((index - 1) * 2 * Math.PI / 80);
    return { 0: (index + 1) * 60, 1: open, 2: Math.max(open, close) + 5, 3: Math.min(open, close) - 5, 4: close };
  });
}

function fullMonitorFixture(t) {
  const fixture = createChartDom();
  Object.defineProperty(fixture.dom.window.document, 'hidden', { configurable: true, value: false });
  const source = { exported: exportResult(fullMonitorHistory().slice(-240)), requests: 0 };
  fixture.chart.exportData = async () => { source.requests += 1; return source.exported; };
  const errors = [], warnings = [];
  const monitor = createBollingerMonitor({
    document: fixture.dom.window.document,
    getCurrentSymbol: () => 'BTRUSDT',
    isFuturesTradingPage: () => true,
    isTradingViewDrawingMutationBusy: () => false,
    err: (...args) => errors.push(args),
    warn: (...args) => warnings.push(args),
  });
  t.after(() => { monitor.stop(); fixture.dom.window.close(); });
  return {
    ...fixture, source, monitor, errors, warnings,
    async sample() {
      await monitor.tick();
      await observeStrategyCondition(() => !monitor.diagnostics.taskPending, 'complete real monitor sample');
    },
  };
}

test('user receives the exact native export snapshot used by the full monitor fixture', async (t) => {
  // Given the fixture export boundary with two independently specified native rows
  const fixture = fullMonitorFixture(t);
  const expected = exportResult([{ 0: 60, 1: 100, 2: 105, 3: 95, 4: 101 }]);
  fixture.source.exported = expected;
  // When the native export boundary is called directly
  const received = await fixture.chart.exportData();
  // Then it returns the original uncorrected schema and rows and counts the request
  assert.equal(received, expected);
  assert.deepEqual(received.data, [{ 0: 60, 1: 100, 2: 105, 3: 95, 4: 101 }]);
  assert.equal(fixture.source.requests, 1);
});

test('user sees older loaded signals added by the real monitor without a new latest candle or loss of recent markers', async (t) => {
  // Given a real monitor that has rendered twelve signals from the latest 240 native candles
  const fixture = fullMonitorFixture(t);
  fixture.addForeignShape('user-channel');
  await fixture.sample();
  const recentIds = fixture.overlay.markers().map(node => node.dataset.markerId);
  assert.equal(recentIds.length, 12);
  assert.equal(fixture.monitor.diagnostics.cachedSignalCount, 12);
  assert.equal(fixture.source.exported.data.at(-1)[0], 36000);

  // When older native history expands the same latest-candle window to six hundred candles
  fixture.source.exported = exportResult(fullMonitorHistory());
  await fixture.sample();

  // Then all thirty-nine real detector signals are retained, including the earliest loaded setup
  assert.equal(fixture.monitor.diagnostics.cachedSignalCount, 39);
  assert.equal(fixture.monitor.diagnostics.layerSize, 39);
  assert.equal(fixture.overlay.markers().length, 39);
  assert.equal(fixture.source.exported.data.at(-1)[0], 36000);
  assert.equal(recentIds.every(id => fixture.overlay.markers().some(node => node.dataset.markerId === id)), true);
  assert.deepEqual(fixture.removed, []);
  assert.deepEqual(fixture.overlay.markers().map(node => Number(node.getAttribute('transform').match(/translate\(([^ ]+)/)[1]) * 60).sort((a, b) => a - b).slice(0, 3), [5760, 5820, 6840]);
  assert.deepEqual(fixture.errors, []);

  // When another unchanged sample audits the full loaded history
  const created = fixture.createdOptions.length;
  await fixture.sample();

  // Then the same markers remain and the monitor does not throttle the native export
  assert.equal(fixture.createdOptions.length, created);
  assert.equal(fixture.monitor.diagnostics.cachedSignalCount, 39);
  assert.equal(fixture.source.requests, 3);
});

test('user keeps real monitor markers through a snapshot race and resumes the next valid native export', async (t) => {
  // Given twelve actual detector markers and the original valid native history
  const fixture = fullMonitorFixture(t);
  await fixture.sample();
  const ids = fixture.overlay.markers().map(node => node.dataset.markerId);
  const original = fixture.source.exported;
  const malformed = structuredClone(original);
  malformed.data[0][2] = malformed.data[0][3] - 1;

  // When the next export contains a transient contradictory OHLC range
  fixture.source.exported = malformed;
  await fixture.sample();

  // Then the monitor remains retryable and preserves the verified marker and cache ownership
  assert.equal(fixture.monitor.diagnostics.failed, false);
  assert.equal(fixture.monitor.diagnostics.cleanupPending, false);
  assert.equal(fixture.monitor.diagnostics.lastLocalFailure, null);
  assert.equal(fixture.monitor.diagnostics.cachedSignalCount, 12);
  assert.deepEqual(fixture.overlay.markers().map(node => node.dataset.markerId), ids);
  assert.equal(fixture.warnings.length, 1);
  assert.equal(isTradingViewBarSnapshotInconsistentError(fixture.warnings[0][1]), true);

  // When the next poll receives a coherent native snapshot
  fixture.source.exported = original;
  await fixture.sample();

  // Then the real monitor resumes sampling without replacing unchanged markers
  assert.equal(fixture.source.requests, 3);
  assert.deepEqual(fixture.overlay.markers().map(node => node.dataset.markerId), ids);
  assert.equal(fixture.monitor.diagnostics.failed, false);
  assert.deepEqual(fixture.errors, []);
});

test('user sees a fatal real monitor schema failure clear only owned markers immediately', async (t) => {
  // Given verified detector markers beside a foreign user drawing
  const fixture = fullMonitorFixture(t);
  fixture.addForeignShape('user-channel');
  await fixture.sample();

  // When the native chart returns an invalid export schema
  fixture.source.exported = { schema: [], data: [] };
  await fixture.sample();

  // Then the fatal failure records pre-cleanup evidence and clears the owned overlay
  assert.equal(fixture.monitor.diagnostics.failed, true);
  assert.equal(fixture.monitor.diagnostics.cleanupPending, false);
  assert.equal(fixture.monitor.diagnostics.lastLocalFailure.stage, 'export');
  assert.equal(fixture.monitor.diagnostics.lastLocalFailure.cachedSignalCount, 12);
  assert.equal(fixture.monitor.diagnostics.lastLocalFailure.layerSizeBeforeCleanup, 12);
  assert.match(fixture.monitor.diagnostics.lastLocalFailure.message, /schema mismatch/);
  assert.equal(fixture.overlay.markers().length, 0);

  // When the next sample executes the deferred fatal cleanup
  await fixture.sample();

  // Then every owned marker is removed once and the failed context stops exporting
  assert.deepEqual([...fixture.shapes.keys()], ['user-channel']);
  assert.equal(fixture.removed.length, 0);
  assert.equal(fixture.overlay.markers().length, 0);
  assert.equal(fixture.source.requests, 2);
  assert.equal(fixture.monitor.diagnostics.cleanupPending, false);
  assert.equal(fixture.monitor.diagnostics.failed, true);
  assert.equal(fixture.errors.length, 1);
});

test('user maps TradingView time resolutions to exact bar durations', () => {
  // Given the chart candles, interval and marker ownership
  const scenarioInput = '1S';
  // When tradingViewResolutionToSeconds processes the configured inputs
  const observedResult = tradingViewResolutionToSeconds(scenarioInput);
  // Then user maps TradingView time resolutions to exact bar durations
  assert.equal(observedResult, 1);
  assert.equal(tradingViewResolutionToSeconds('1'), 60);
  assert.equal(tradingViewResolutionToSeconds('60'), 3600);
  assert.equal(tradingViewResolutionToSeconds('4H'), 14400);
  assert.equal(tradingViewResolutionToSeconds('1D'), 86400);
  assert.equal(tradingViewResolutionToSeconds('1W'), 604800);
  assert.throws(() => tradingViewResolutionToSeconds('1M'), /unsupported/);
});

test('user observes that native null-owner cleanup preserves alert subscriptions and their readiness transitions', () => {
  // Given the chart candles, interval and marker ownership
  const fixture = createChartDom();
  let ready = false;
  fixture.chart.dataReady = () => ready;
  // When alertApi.createBollingerIntervalSession processes the configured inputs
  const session = alertApi.createBollingerIntervalSession(fixture.chart);
  fixture.dataLoaded.subscribe(null, () => {});
  fixture.intervalChanged.subscribe(null, () => {});
  fixture.dataLoaded.unsubscribeAll(null);
  fixture.intervalChanged.unsubscribeAll(null);
  // Then user observes that native null-owner cleanup preserves alert subscriptions and their readiness transitions
  assert.equal(fixture.dataLoaded.size, 1);
  assert.equal(fixture.intervalChanged.size, 1);
  ready = true;
  assert.equal(session.isCurrent(0), false);
  fixture.dataLoaded.fire();
  assert.equal(session.isCurrent(0), true);
  fixture.intervalChanged.fire('5');
  assert.equal(session.revision, 1);
  assert.equal(session.isCurrent(1), false);
  fixture.dataLoaded.fire();
  assert.equal(session.isCurrent(1), true);
  session.dispose();
  assert.equal(fixture.dataLoaded.size, 0);
  assert.equal(fixture.intervalChanged.size, 0);
  assert.equal(session.isCurrent(1), false);
});

test('user rejects second bars under a minute target and accepts the replacement minute history', () => {
  // Given the chart candles, interval and marker ownership
  const row = (time) => ({ 0: time, 1: 10, 2: 12, 3: 9, 4: 11 });
  assert.throws(() => parseClosedTradingViewBars(exportResult(
    Array.from({ length: 120 }, (_, index) => row(3600 + index)),
  ), { resolutionSeconds: 60, observedAtSeconds: 4000 }),
  isTradingViewBarSnapshotInconsistentError);
  // When parseClosedTradingViewBars processes the configured inputs
  const bars = parseClosedTradingViewBars(exportResult([row(3600), row(3660), row(3780)]), {
    resolutionSeconds: 60, observedAtSeconds: 3840,
  });
  // Then user rejects second bars under a minute target and accepts the replacement minute history
  assert.deepEqual(bars.map(bar => bar.time), [3600, 3660, 3780]);
});

test('user validates the entire export including off-grid bars that are not closed yet', () => {
  // Given an off-grid current candle following a correctly aligned minute
  const exported = exportResult([
    { 0: 3600, 1: 10, 2: 12, 3: 9, 4: 11 },
    { 0: 3661, 1: 10, 2: 12, 3: 9, 4: 11 },
  ]);
  // When the parser validates every exported candle before filtering open bars
  const failure = captureStrategyError(() => parseClosedTradingViewBars(exported, { resolutionSeconds: 60, observedAtSeconds: 3662 }));
  // Then even the unclosed off-grid bar is a recoverable snapshot race
  assert.equal(isTradingViewBarSnapshotInconsistentError(failure), true);
});

for (const [resolutionSeconds, times] of [
    [3 * 86400, [86400, 4 * 86400, 10 * 86400]],
    [7 * 86400, [4 * 86400, 11 * 86400, 25 * 86400]],
  ]) {
  test(`user accepts multi-day and Monday weekly bars without Unix-epoch phase assumptions (resolutionSeconds=${JSON.stringify(resolutionSeconds)})`, () => {
    // Given valid multi-day or Monday weekly candles with historical gaps
    const exported = exportResult(times.map(time => (
      { 0: time, 1: 10, 2: 12, 3: 9, 4: 11 }
    )));
    // When the complete export is parsed for its native resolution
    const bars = parseClosedTradingViewBars(exported, { resolutionSeconds, observedAtSeconds: 40 * 86400 });
    // Then every legitimate candle retains its exact timestamp
    assert.deepEqual(bars.map(bar => bar.time), times);

  });
}

test('user observes that interval sessions invalidate A-B-A exports and wait for data completion despite nonempty old data', async () => {
  // Given the chart candles, interval and marker ownership
  const { chart, setResolution, dataLoaded, intervalChanged } = createChartDom({ resolution: '1S' });
  // When alertApi.createBollingerIntervalSession processes the configured inputs
  const session = alertApi.createBollingerIntervalSession(chart);
  let releaseExport;
  chart.exportData = () => new Promise(resolve => { releaseExport = resolve; });
  const target = { chart, resolution: '1S', resolutionSeconds: 1, routeSymbol: 'BTRUSDT' };
  const pending = alertApi.exportClosedTradingViewBars(target, session, 4000000);
  const revision = session.revision;
  setResolution('1');
  // Then user observes that interval sessions invalidate A-B-A exports and wait for data completion despite nonempty old data
  assert.equal(chart.dataReady(), true);
  assert.equal(session.isCurrent(session.revision), false);
  setResolution('1S');
  dataLoaded.fire();
  assert.equal(session.isCurrent(revision), false);
  assert.equal(session.isCurrent(session.revision), true);
  releaseExport(exportResult([{ 0: 3600, 1: 10, 2: 12, 3: 9, 4: 11 }]));
  assert.equal(await pending, null);
  session.dispose();
  assert.equal(session.isCurrent(session.revision), false);
  assert.equal(intervalChanged.size, 0);
  assert.equal(dataLoaded.size, 0);
});


test('user observes that production monitor retires old interval before readiness and resumes with minute data', async () => {
  // Given the chart candles, interval and marker ownership
  const fixture = createChartDom({ resolution: '1S' });
  const harness = createMonitorHarness(fixture);
  fixture.chart.exportData = async () => exportResult([
    { 0: 3601, 1: 10, 2: 12, 3: 9, 4: 11 },
    { 0: 3602, 1: 10, 2: 12, 3: 9, 4: 11 },
  ]);
  // When harness.tick processes the configured inputs
  await harness.tick();
  const session = harness.monitor.session.session;
  // Then user observes that production monitor retires old interval before readiness and resumes with minute data
  assert.equal(fixture.overlay.markers().length, 1);
  harness.setBusy(true);
  fixture.setResolution('1');
  await harness.tick();
  assert.equal(harness.monitor.context, null);
  assert.equal(harness.monitor.retiredCount, 0);
  assert.equal(fixture.removed.length, 0);
  assert.equal(harness.detectorCalls, 1);
  harness.setBusy(false);
  await harness.tick();
  assert.equal(fixture.overlay.markers().length, 0);
  assert.equal(harness.monitor.context, null);
  assert.equal(session.isCurrent(session.revision), false);
  fixture.chart.exportData = async () => exportResult([
    { 0: 3600, 1: 10, 2: 12, 3: 9, 4: 11 },
    { 0: 3660, 1: 10, 2: 12, 3: 9, 4: 11 },
  ]);
  fixture.dataLoaded.fire();
  await harness.tick();
  assert.equal(harness.monitor.context.resolution, '1');
  assert.equal(fixture.overlay.markers().length, 1);
  assert.equal(fixture.overlay.markers()[0].getAttribute('transform'), 'translate(60 487)');
  assert.equal(harness.detectorCalls, 2);
  assert.deepEqual(harness.errors, []);
  harness.monitor.stop();
});

test('user observes that production monitor stop disposes subscriptions and invalidates busy pending export', async () => {
  // Given the chart candles, interval and marker ownership
  const fixture = createChartDom({ resolution: '1S' });
  const harness = createMonitorHarness(fixture);
  let releaseExport;
  fixture.chart.exportData = () => new Promise(resolve => { releaseExport = resolve; });
  // When harness.monitor.tick processes the configured inputs
  await harness.monitor.tick();
  const oldTask = harness.monitor.task;
  const oldSession = harness.monitor.session.session;
  harness.setBusy(true);
  harness.setHidden(true);
  harness.monitor.stop();
  // Then user observes that production monitor stop disposes subscriptions and invalidates busy pending export
  assert.equal(harness.monitor.context, null);
  assert.equal(harness.monitor.session, null);
  assert.equal(oldSession.isCurrent(oldSession.revision), false);
  assert.equal(fixture.intervalChanged.size, 0);
  assert.equal(fixture.dataLoaded.size, 0);
  releaseExport(exportResult([{ 0: 3601, 1: 10, 2: 12, 3: 9, 4: 11 }]));
  await oldTask;
  assert.equal(fixture.overlay.markers().length, 0);
  assert.equal(harness.detectorCalls, 0);
  harness.setBusy(false);
  harness.setHidden(false);
  fixture.chart.exportData = async () => exportResult([{ 0: 3601, 1: 10, 2: 12, 3: 9, 4: 11 }]);
  await harness.tick();
  assert.equal(harness.monitor.retiredCount, 0);
  assert.equal(fixture.intervalChanged.size, 2);
  assert.equal(fixture.overlay.markers().length, 1);
  harness.monitor.stop();
  assert.deepEqual(harness.errors, []);
});


test('user observes that production monitor detects a round-trip interval switch between polls', async () => {
  // Given the chart candles, interval and marker ownership
  const fixture = createChartDom({ resolution: '1S' });
  const harness = createMonitorHarness(fixture);
  fixture.chart.exportData = async () => exportResult([{ 0: 3601, 1: 10, 2: 12, 3: 9, 4: 11 }]);
  // When harness.tick processes the configured inputs
  await harness.tick();
  const originalContext = harness.monitor.context;
  fixture.setResolution('1');
  fixture.setResolution('1S');
  await harness.tick();
  // Then user observes that production monitor detects a round-trip interval switch between polls
  assert.equal(harness.monitor.context, null);
  assert.equal(fixture.overlay.markers().length, 0);
  assert.equal(harness.detectorCalls, 1);
  fixture.dataLoaded.fire();
  await harness.tick();
  assert.notEqual(harness.monitor.context, originalContext);
  assert.equal(harness.monitor.context.intervalRevision, 2);
  assert.equal(fixture.overlay.markers().length, 1);
  assert.equal(harness.detectorCalls, 2);
  harness.monitor.stop();
});

test('user observes that production monitor disposes old chart subscriptions even when removal is busy', async () => {
  // Given the chart candles, interval and marker ownership
  const fixture = createChartDom({ resolution: '1S' });
  const harness = createMonitorHarness(fixture);
  fixture.chart.exportData = async () => exportResult([{ 0: 3601, 1: 10, 2: 12, 3: 9, 4: 11 }]);
  // When harness.tick processes the configured inputs
  await harness.tick();
  const replacement = createChartDom({ resolution: '1S' });
  replacement.chart.exportData = fixture.chart.exportData;
  harness.setBusy(true);
  fixture.setActiveChart(replacement.chart);
  await harness.tick();
  // Then user observes that production monitor disposes old chart subscriptions even when removal is busy
  assert.equal(fixture.intervalChanged.size, 0);
  assert.equal(fixture.dataLoaded.size, 0);
  assert.equal(harness.monitor.context, null);
  assert.equal(harness.monitor.retiredCount, 0);
  assert.deepEqual(fixture.removed, []);
  harness.setBusy(false);
  await harness.tick();
  assert.equal(fixture.overlay.markers().length, 0);
  assert.equal(replacement.overlay.markers().length, 1);
  assert.equal(harness.monitor.context.target.chart, replacement.chart);
  harness.monitor.stop();
  assert.equal(replacement.intervalChanged.size, 0);
});

test('user rejects weekly bars off Monday while preserving legitimate multiweek gaps', () => {
  // Given weekly candles on the wrong weekday and legitimate Monday candles
  const row = time => ({ 0: time, 1: 10, 2: 12, 3: 9, 4: 11 });
  // When the parser checks the off-Monday export
  const failure = captureStrategyError(() => parseClosedTradingViewBars(exportResult([row(0), row(604800)]), {
    resolution: '1W', resolutionSeconds: 604800, observedAtSeconds: 2000000,
  }));
  // Then the off-Monday candles fail and valid multiweek gaps remain intact
  assert.equal(isTradingViewBarSnapshotInconsistentError(failure), true);
  assert.deepEqual(parseClosedTradingViewBars(exportResult([row(345600), row(1555200)]), {
    resolution: '1W', resolutionSeconds: 604800, observedAtSeconds: 3000000,
  }).map(bar => bar.time), [345600, 1555200]);
});

test('user waits for the model before reading a chart target and invalidates a torn-down model', () => {
  // Given the chart candles, interval and marker ownership
  const fixture = createChartDom();
  // When fixture.setModelReady processes the configured inputs
  fixture.setModelReady(false);
  const observedResult = findBearishBollingerChartTarget(fixture.dom.window.document, 'BTRUSDT');
  // Then user waits for the model before reading a chart target and invalidates a torn-down model
  assert.equal(observedResult, null);
  fixture.setModelReady(true);
  const target = findBearishBollingerChartTarget(fixture.dom.window.document, 'BTRUSDT');
  assert.equal(target.resolution, '1');
  fixture.setModelReady(false);
  assert.equal(isBearishBollingerChartTargetCurrent(fixture.dom.window.document, target), false);
});

test('user observes that production monitor waits through first-refresh model creation without errors and then renders', async () => {
  // Given the chart candles, interval and marker ownership
  const fixture = createChartDom();
  const harness = createMonitorHarness(fixture);
  fixture.chart.exportData = async () => exportResult([{ 0: 60, 1: 10, 2: 12, 3: 9, 4: 11 }]);
  // When fixture.setModelReady processes the configured inputs
  fixture.setModelReady(false);
  await harness.tick();
  // Then user observes that production monitor waits through first-refresh model creation without errors and then renders
  assert.deepEqual(harness.errors, []);
  assert.equal(harness.monitor.context, null);
  assert.equal(fixture.intervalChanged.size, 0);
  assert.equal(fixture.overlay.markers().length, 0);
  fixture.setModelReady(true);
  await harness.tick();
  assert.equal(harness.monitor.context.resolution, '1');
  assert.equal(fixture.overlay.markers().length, 1);
  assert.deepEqual(harness.errors, []);
  harness.monitor.stop();
});

test('user observes that on-demand diagnostics distinguish active, awaiting-data and torn-down states without drawing calls', async () => {
  // Given the chart candles, interval and marker ownership
  const fixture = createChartDom();
  const harness = createMonitorHarness(fixture);
  fixture.chart.exportData = async () => exportResult([{ 0: 60, 1: 10, 2: 12, 3: 9, 4: 11 }]);
  assert.equal(harness.monitor.diagnostics.contextPresent, false);
  assert.equal(harness.monitor.diagnostics.nativeModelReady, null);
  // When harness.tick processes the configured inputs
  await harness.tick();
  const originalGetAllShapes = fixture.chart.getAllShapes;
  fixture.chart.getAllShapes = () => { throw new Error('Diagnostics must not audit drawings'); };
  fixture.chart.exportData = () => { throw new Error('Diagnostics must not export data'); };
  // Then user observes that on-demand diagnostics distinguish active, awaiting-data and torn-down states without drawing calls
  assert.deepEqual(harness.monitor.diagnostics, {
    taskPending: false, contextPresent: true, failed: false, lastLocalFailure: null,
    cleanupPending: false, cachedSignalCount: 1, layerSize: 1, retiredCount: 0,
    markerOverlayStats: { renderedFrames: 1, visibleMarkers: 1, signalCount: 1, attached: true, pendingFrame: false, subscriptions: 9 },
    sessionPresent: true, sessionRevision: 0, contextIntervalRevision: 0,
    sessionMatchesContext: true, sessionCurrent: true,
    nativeModelReady: true, nativeDataReady: true, mutationBlocked: false,
  });
  fixture.setResolution('5');
  assert.equal(harness.monitor.diagnostics.sessionRevision, 1);
  assert.equal(harness.monitor.diagnostics.sessionCurrent, false);
  assert.equal(harness.monitor.diagnostics.nativeDataReady, true);
  fixture.setModelReady(false);
  assert.equal(harness.monitor.diagnostics.nativeModelReady, false);
  assert.equal(harness.monitor.diagnostics.nativeDataReady, null);
  assert.equal(harness.monitor.diagnostics.sessionCurrent, null);
  fixture.chart.getAllShapes = originalGetAllShapes;
  harness.monitor.stop();
});


for (const stage of ['export', 'render']) {
  test(`user retains the last local ${stage} failure after clearing the layer and stopping`, async () => {
    // Given the chart candles, interval and marker ownership
    const fixture = createChartDom();
    const harness = createMonitorHarness(fixture, {
      detectBollingerSignals: bars => bars.map(bar => ({
        id: `${bar.time}:warning`, direction: 'bearish', type: 'warning',
        time: bar.time, markerPrice: 13,
      })),
    });
    fixture.chart.exportData = async () => exportResult(Array.from({ length: 6 }, (_, index) => ({
      0: (index + 1) * 60, 1: 10, 2: 12, 3: 9, 4: 11,
    })));
    // When harness.tick processes the configured inputs
    await harness.tick();
    // Then user retains the last local the selected case failure after clearing the layer and stopping
    assert.equal(harness.monitor.diagnostics.cachedSignalCount, 6);
    assert.equal(harness.monitor.diagnostics.layerSize, 6);
    if (stage === 'export') fixture.chart.exportData = async () => { throw new Error('synthetic export failure'); };
    else {
      fixture.overlay.setProjection({ price: () => { throw new Error('synthetic projection failure'); } });
      fixture.overlay.events.priceRangeChanged.emit();
    }
    const message = stage === 'export' ? 'synthetic export failure' : 'synthetic projection failure';
    await assert.rejects(harness.tick(), { message });
    await harness.tick();
    assert.equal(harness.monitor.diagnostics.failed, true);
    assert.equal(harness.monitor.diagnostics.cleanupPending, false);
    assert.equal(harness.monitor.diagnostics.layerSize, 0);
    const expected = {
      thrownType: 'object', classificationFailed: false, name: 'Error', message, unreadableFields: [], stage, routeSymbol: 'BTRUSDT', resolution: '1',
      cachedSignalCount: 6, layerSizeBeforeCleanup: stage === 'render' ? 0 : 6,
      sessionRevision: 0, contextIntervalRevision: 0,
    };
    assert.deepEqual(harness.monitor.diagnostics.lastLocalFailure, expected);
    assert.equal(Object.isFrozen(harness.monitor.diagnostics.lastLocalFailure), true);
    harness.monitor.stop();
    assert.deepEqual(harness.monitor.diagnostics.lastLocalFailure, expected);
    fixture.dom.window.close();
  });
}

for (const value of ['x'.repeat(600), null, { code: 7 }]) {
  test(`user records ${value === null ? 'null' : typeof value} host rejection without a diagnostic rejection`, async () => {
    // Given the chart candles, interval and marker ownership
    const fixture = createChartDom();
    const harness = createMonitorHarness(fixture);
    fixture.chart.exportData = async () => { throw value; };
    // When harness.tick processes the configured inputs
    const observedResult = harness.tick();
    // Then user records the selected case host rejection without a diagnostic rejection
    await assert.rejects(observedResult, reason => reason === value);
    await harness.tick();
    assert.equal(harness.monitor.diagnostics.failed, true);
    assert.equal(harness.monitor.diagnostics.cleanupPending, false);
    assert.deepEqual(harness.monitor.diagnostics.lastLocalFailure, {
      thrownType: value === null ? 'null' : typeof value,
      classificationFailed: false,
      name: null, message: typeof value === 'string' ? 'x'.repeat(512) : null,
      unreadableFields: [], stage: 'export', routeSymbol: 'BTRUSDT', resolution: '1',
      cachedSignalCount: null, layerSizeBeforeCleanup: 0,
      sessionRevision: 0, contextIntervalRevision: 0,
    });
    assert.equal(harness.errors.length, 1);
    assert.equal(harness.errors[0][1], value);
    harness.monitor.stop();
    fixture.dom.window.close();
  });
}

test('user keeps a recoverable snapshot race out of fatal diagnostics and resumes exports', async () => {
  // Given the chart candles, interval and marker ownership
  const fixture = createChartDom();
  const harness = createMonitorHarness(fixture);
  const stable = async () => exportResult([{ 0: 60, 1: 10, 2: 12, 3: 9, 4: 11 }]);
  fixture.chart.exportData = stable;
  // When harness.tick processes the configured inputs
  await harness.tick();
  const failure = new TradingViewBarSnapshotInconsistentError('synthetic snapshot race');
  fixture.chart.exportData = async () => { throw failure; };
  const observedResult = harness.tick();
  // Then user keeps a recoverable snapshot race out of fatal diagnostics and resumes exports
  await assert.rejects(observedResult, reason => reason === failure);
  assert.equal(harness.monitor.diagnostics.failed, false);
  assert.equal(harness.monitor.diagnostics.cleanupPending, false);
  assert.equal(harness.monitor.diagnostics.lastLocalFailure, null);
  assert.equal(harness.monitor.diagnostics.layerSize, 1);
  fixture.chart.exportData = stable;
  await harness.tick();
  assert.equal(harness.monitor.diagnostics.cachedSignalCount, 1);
  assert.equal(harness.monitor.diagnostics.lastLocalFailure, null);
  assert.deepEqual(harness.errors, []);
  harness.monitor.stop();
  fixture.dom.window.close();
});

for (const revoked of [true, false]) {
  test(`user stops an unclassifiable host Proxy rejection (revoked=${revoked})`, async () => {
    // Given the chart candles, interval and marker ownership
    const fixture = createChartDom();
    const harness = createMonitorHarness(fixture);
    // When Proxy.revocable processes the configured inputs
    const host = Proxy.revocable({}, { getPrototypeOf() {
      throw new Error('synthetic host prototype failure');
    } });
    if (revoked) host.revoke();
    let exports = 0;
    fixture.chart.exportData = async () => { exports += 1; throw host.proxy; };
    // assert.rejects itself reads properties of the rejected value, which a revoked Proxy forbids.
    await harness.tick().then(
      () => assert.fail('The original host rejection must propagate'),
      reason => assert.equal(reason, host.proxy),
    );
    await harness.tick();
    await harness.tick();
    const recorded = harness.monitor.diagnostics.lastLocalFailure;
    // Then user stops an unclassifiable host Proxy rejection (revoked=the selected case)
    assert.equal(recorded.classificationFailed, true);
    assert.equal(recorded.thrownType, 'object');
    assert.equal(recorded.name, null);
    assert.equal(recorded.message, null);
    assert.deepEqual(recorded.unreadableFields, revoked ? ['name', 'message'] : []);
    assert.equal(harness.monitor.diagnostics.failed, true);
    assert.equal(harness.monitor.diagnostics.cleanupPending, false);
    assert.equal(harness.monitor.diagnostics.layerSize, 0);
    assert.equal(harness.errors[0][1], host.proxy);
    assert.equal(exports, 1);
    harness.monitor.stop();
    fixture.dom.window.close();
  });
}

for (const throwing of [true, false]) {
  test(`user reads host rejection accessors once and records unreadable fields (throwing=${throwing})`, async () => {
    // Given the chart candles, interval and marker ownership
    const fixture = createChartDom();
    const harness = createMonitorHarness(fixture);
    const reads = { name: 0, message: 0 };
    const rejection = {};
    for (const key of ['name', 'message']) {
      Object.defineProperty(rejection, key, { get() {
        reads[key] += 1;
        if (throwing) throw new Error('synthetic inaccessible diagnostic field');
        return reads[key] === 1 ? key : null;
      } });
    }
    fixture.chart.exportData = async () => { throw rejection; };
    // When harness.tick processes the configured inputs
    const observedResult = harness.tick();
    // Then user reads host rejection accessors once and records unreadable fields (throwing=the selected case)
    await assert.rejects(observedResult, reason => reason === rejection);
    await harness.tick();
    assert.deepEqual(reads, { name: 1, message: 1 });
    const recorded = harness.monitor.diagnostics.lastLocalFailure;
    assert.deepEqual(recorded.unreadableFields, throwing ? ['name', 'message'] : []);
    assert.equal(recorded.name, throwing ? null : 'name');
    assert.equal(recorded.message, throwing ? null : 'message');
    assert.equal(recorded.stage, 'export');
    assert.equal(harness.monitor.diagnostics.failed, true);
    assert.equal(harness.monitor.diagnostics.cleanupPending, false);
    assert.equal(harness.errors[0][1], rejection);
    harness.monitor.stop();
    fixture.dom.window.close();
  });
}

for (const stage of ['detect', 'reconcile']) {
  test(`user identifies ${stage} failures before rendering`, async () => {
    // Given the chart candles, interval and marker ownership
    const fixture = createChartDom();
    const failure = new Error('synthetic detector failure');
    failure.name = 'N'.repeat(80);
    const harness = createMonitorHarness(fixture, {
      detectBollingerSignals: () => {
        if (stage === 'detect') throw failure;
        return undefined;
      },
    });
    fixture.chart.exportData = async () => exportResult([{ 0: 60, 1: 10, 2: 12, 3: 9, 4: 11 }]);
    const message = stage === 'detect' ? failure.message : 'Bollinger signal cache is invalid';
    // When harness.tick processes the configured inputs
    const observedResult = harness.tick();
    // Then user identifies the selected case failures before rendering
    await assert.rejects(observedResult, { message });
    await harness.tick();
    assert.equal(harness.monitor.diagnostics.lastLocalFailure.stage, stage);
    assert.equal(harness.monitor.diagnostics.lastLocalFailure.name, stage === 'detect' ? 'N'.repeat(64) : 'Error');
    assert.equal(harness.monitor.diagnostics.lastLocalFailure.message, message);
    assert.equal(harness.monitor.diagnostics.failed, true);
    assert.equal(fixture.createdOptions.length, 0);
    harness.monitor.stop();
    fixture.dom.window.close();
  });
}

test('user requires the current symbol and complete bearish-alert chart API', () => {
  // Given the chart candles, interval and marker ownership
  const {
    dom,
    setActiveChart,
    setResolution,
    setSymbol,
  } = createChartDom({ resolution: '60' });
  // When findBearishBollingerChartTarget processes the configured inputs
  const target = findBearishBollingerChartTarget(dom.window.document, 'BTRUSDT');
  // Then user requires the current symbol and complete bearish-alert chart API
  assert.equal(target.routeSymbol, 'BTRUSDT');
  assert.equal(target.resolution, '60');
  assert.equal(target.resolutionSeconds, 3600);

  assert.throws(
    () => findBearishBollingerChartTarget(dom.window.document, 'BTCUSDT'),
    /symbol mismatch/,
  );

  assert.equal(isBearishBollingerChartTargetCurrent(dom.window.document, target), true);
  setResolution('15');
  assert.equal(isBearishBollingerChartTargetCurrent(dom.window.document, target), false);
  setResolution('60');
  setSymbol('BTCUSDT@PRICETYPE=LAST');
  assert.equal(isBearishBollingerChartTargetCurrent(dom.window.document, target), false);
  setSymbol('BTRUSDT@PRICETYPE=LAST');
  setActiveChart({ ...target.chart });
  assert.equal(isBearishBollingerChartTargetCurrent(dom.window.document, target), false);
});

test('user exports only bars whose resolution-derived end time has passed', () => {
  // Given the chart candles, interval and marker ownership
  const exported = exportResult([
    { 0: 60, 1: 10, 2: 12, 3: 9, 4: 11 },
    { 0: 120, 1: 11, 2: 13, 3: 10, 4: 12 },
    { 0: 180, 1: 12, 2: 20, 3: 5, 4: 19 },
  ]);

  // When parseClosedTradingViewBars processes the configured inputs
  const observedResult = parseClosedTradingViewBars(exported, {
      resolutionSeconds: 60,
      observedAtSeconds: 180,
    });
  // Then user exports only bars whose resolution-derived end time has passed
  assert.deepEqual(
    observedResult,
    [
      { time: 60, open: 10, high: 12, low: 9, close: 11 },
      { time: 120, open: 11, high: 13, low: 10, close: 12 },
    ],
  );
});

test('user classifies a non-monotonic export as a recoverable TradingView snapshot race', () => {
  // Given native export rows whose timestamps move backwards
  const exported = exportResult([
      { 0: 120, 1: 11, 2: 13, 3: 10, 4: 12 },
      { 0: 60, 1: 10, 2: 12, 3: 9, 4: 11 },
    ]);
  // When the parser checks the native snapshot ordering
  const failure = captureStrategyError(() => parseClosedTradingViewBars(exported, {
      resolutionSeconds: 60,
      observedAtSeconds: 180,
    }));
  // Then the failure is classified as a retryable snapshot race
  assert.equal(isTradingViewBarSnapshotInconsistentError(failure), true);
});

test('user keeps every closed bar already loaded by TradingView', () => {
  // Given the chart candles, interval and marker ownership
  const rows = Array.from({ length: 505 }, (_, index) => ({
    0: (index + 1) * 60,
    1: 10,
    2: 12,
    3: 9,
    4: 11,
  }));
  // When parseClosedTradingViewBars processes the configured inputs
  const bars = parseClosedTradingViewBars(exportResult(rows), {
    resolutionSeconds: 60,
    observedAtSeconds: 506 * 60,
  });

  // Then user keeps every closed bar already loaded by TradingView
  assert.equal(bars.length, 505);
  assert.equal(bars[0].time, 60);
  assert.equal(bars.at(-1).time, 505 * 60);
});

test('user changes the closed-bar window key when older history loads without a new latest bar', () => {
  // Given the same latest candle with an expanded older history window
  const recent = [
    { time: 120, open: 11, high: 13, low: 10, close: 12 },
    { time: 180, open: 12, high: 14, low: 11, close: 13 },
  ];
  const expanded = [
    { time: 60, open: 10, high: 12, low: 9, close: 11 },
    ...recent,
  ];

  // When the window identity is calculated for the recent bars
  const observedResult = buildClosedBarsWindowKey(recent);
  // Then adding older history changes identity even without a newer latest bar
  assert.notEqual(observedResult, buildClosedBarsWindowKey(expanded));
  assert.equal(buildClosedBarsWindowKey(recent), '2:120:180');
  assert.equal(buildClosedBarsWindowKey(expanded), '3:60:180');
  assert.equal(buildClosedBarsWindowKey(recent), buildClosedBarsWindowKey([...recent]));
  assert.notEqual(
    buildClosedBarsWindowKey(recent),
    buildClosedBarsWindowKey([
      ...recent,
      { time: 240, open: 13, high: 15, low: 12, close: 14 },
    ]),
  );
});

test('user changes the content key when OHLC changes inside the same closed-bar window', () => {
  // Given equal timestamp windows with a corrected candle high
  const bars = [
    { time: 120, open: 11, high: 13, low: 10, close: 12 },
    { time: 180, open: 12, high: 14, low: 11, close: 13 },
  ];
  const corrected = [
    bars[0],
    { ...bars[1], high: 15 },
  ];

  // When the timestamp identity and candle content are compared
  const observedResult = buildClosedBarsWindowKey(bars);
  // Then the window identity is stable while content identity detects the correction
  assert.equal(observedResult, buildClosedBarsWindowKey(corrected));
  assert.notEqual(buildClosedBarsContentKey(bars), buildClosedBarsContentKey(corrected));
  const snapshot = buildClosedBarsContentSnapshot(bars);
  assert.equal(matchesClosedBarsContentSnapshot(bars, snapshot), true);
  assert.equal(matchesClosedBarsContentSnapshot(corrected, snapshot), false);
});


test('user requires explicit direction when using the shared marker layer', async () => {
  // Given the chart candles, interval and marker ownership
  const { dom, shapes } = createChartDom();
  // When findBearishBollingerChartTarget processes the configured inputs
  const target = findBearishBollingerChartTarget(dom.window.document, 'BTRUSDT');
  const layer = createBollingerMarkerLayer(target);

  const observedResult = layer.render([{
      id: 'missing-direction',
      type: 'warning',
      time: 120,
      markerPrice: 10,
    }], { isCurrent: () => true });
  // Then user requires explicit direction when using the shared marker layer
  await assert.rejects(
    observedResult,
    /direction is invalid/,
  );
  assert.equal(shapes.size, 0);
});

test('user keeps existing markers through a recoverable snapshot error and retries next tick', async () => {
  // Given the chart candles, interval and marker ownership
  const { dom, shapes } = createChartDom();
  // When findBearishBollingerChartTarget processes the configured inputs
  const target = findBearishBollingerChartTarget(dom.window.document, 'BTRUSDT');
  const layer = createBollingerMarkerLayer(target);
  const signal = {
    id: 'bearish:warning',
    direction: 'bearish',
    type: 'warning',
    time: 120,
    markerPrice: 10,
  };
  const bars = [
    { time: 60, open: 10, high: 12, low: 9, close: 11 },
    { time: 120, open: 11, high: 13, low: 10, close: 12 },
  ];
  await layer.render([signal], { isCurrent: () => true });
  // Then user keeps existing markers through a recoverable snapshot error and retries next tick
  assert.equal(layer.size, 1);

  let detectorCalls = 0;
  await assert.rejects(
    reconcileBearishBollingerAlertWindow({
      bars,
      cachedWindowKey: null,
      cachedSignals: null,
      detectSignals: () => {
        detectorCalls += 1;
        throw new TradingViewBarSnapshotInconsistentError('snapshot race');
      },
      renderSignals: (signals) => layer.render(signals, { isCurrent: () => true }),
    }),
    /snapshot race/,
  );
  assert.equal(detectorCalls, 1);
  assert.equal(layer.size, 1);

  await reconcileBearishBollingerAlertWindow({
    bars,
    cachedWindowKey: null,
    cachedSignals: null,
    detectSignals: () => [
      signal,
      {
        id: 'bullish:warning',
        direction: 'bullish',
        type: 'warning',
        time: 180,
        markerPrice: 9,
      },
    ],
    renderSignals: (signals) => layer.render(signals, { isCurrent: () => true }),
  });
  assert.equal(layer.size, 2);
});

test('user keeps the task context retryable across malformed-to-valid snapshots', async () => {
  // Given the chart candles, interval and marker ownership
  const { dom, shapes } = createChartDom();
  // When findBearishBollingerChartTarget processes the configured inputs
  const target = findBearishBollingerChartTarget(dom.window.document, 'BTRUSDT');
  const layer = createBollingerMarkerLayer(target);
  const signal = {
    id: 'stable:warning',
    direction: 'bearish',
    type: 'warning',
    time: 120,
    markerPrice: 10,
  };
  const stableBars = [
    { time: 60, open: 10, high: 12, low: 9, close: 11 },
    { time: 120, open: 11, high: 13, low: 10, close: 12 },
  ];
  const malformedBars = [
    stableBars[0],
    { ...stableBars[1], high: 9 },
  ];
  const validBars = [
    stableBars[0],
    { ...malformedBars[1], high: 14 },
  ];
  const context = {
    failed: false,
    cleanupPending: false,
    lastProcessedClosedBarsWindowKey: buildClosedBarsWindowKey(stableBars),
    lastProcessedClosedBarsContentSnapshot: buildClosedBarsContentSnapshot(stableBars),
    lastProcessedSignals: [signal],
  };
  await layer.render([signal], { isCurrent: () => true });

  let detectorCalls = 0;
  let snapshotError = null;
  // Then user keeps the task context retryable across malformed-to-valid snapshots
  await assert.rejects(
    reconcileBearishBollingerAlertWindow({
      bars: malformedBars,
      cachedWindowKey: context.lastProcessedClosedBarsWindowKey,
      cachedContentSnapshot: context.lastProcessedClosedBarsContentSnapshot,
      cachedSignals: context.lastProcessedSignals,
      detectSignals: () => {
        detectorCalls += 1;
        throw new TradingViewBarSnapshotInconsistentError('snapshot race');
      },
      renderSignals: (signals) => layer.render(signals, { isCurrent: () => true }),
    }),
    (error) => {
      snapshotError = error;
      return /snapshot race/.test(error.message);
    },
  );
  assert.equal(applyBollingerAlertTaskFailure(context, snapshotError), 'retry');

  assert.equal(detectorCalls, 1);
  assert.equal(context.failed, false);
  assert.equal(context.cleanupPending, false);
  assert.equal(layer.size, 1);

  const result = await reconcileBearishBollingerAlertWindow({
    bars: validBars,
    cachedWindowKey: context.lastProcessedClosedBarsWindowKey,
    cachedContentSnapshot: context.lastProcessedClosedBarsContentSnapshot,
    cachedSignals: context.lastProcessedSignals,
    detectSignals: () => {
      detectorCalls += 1;
      return [signal, {
        id: 'stable:bullish:warning',
        direction: 'bullish',
        type: 'warning',
        time: 180,
        markerPrice: 9,
      }];
    },
    renderSignals: (signals) => layer.render(signals, { isCurrent: () => true }),
  });
  assert.equal(result.rendered, true);
  assert.equal(detectorCalls, 2);
  assert.equal(layer.size, 2);
});


test('user excludes an unclosed reversal breakout bar from detector input', () => {
  // Given the chart candles, interval and marker ownership
  const exported = exportResult([
    { 0: 60, 1: 10, 2: 12, 3: 9, 4: 11 },
    { 0: 120, 1: 11, 2: 14, 3: 10, 4: 13 },
  ]);

  // When parseClosedTradingViewBars processes the configured inputs
  const bars = parseClosedTradingViewBars(exported, {
    resolutionSeconds: 60,
    observedAtSeconds: 150,
  });
  // Then user excludes an unclosed reversal breakout bar from detector input
  assert.deepEqual(bars, [{ time: 60, open: 10, high: 12, low: 9, close: 11 }]);
});

test('user rejects an abnormal marker count and clears the invalid overlay', async () => {
  // Given the chart candles, interval and marker ownership
  const { dom, shapes, removed } = createChartDom();
  // When findBearishBollingerChartTarget processes the configured inputs
  const target = findBearishBollingerChartTarget(dom.window.document, 'BTRUSDT');
  const layer = createBearishBollingerMarkerLayer(target);
  const isCurrent = () => true;
  await layer.render([
    { id: 'stable:warning', type: 'warning', time: 120, markerPrice: 10 },
  ], { isCurrent });
  const excessive = Array.from(
    { length: MAX_BEARISH_BOLLINGER_MARKERS + 1 },
    (_, index) => ({
      id: `setup-${index}:warning`,
      type: 'warning',
      time: 180 + index,
      markerPrice: 9,
    }),
  );

  // Then user rejects an abnormal marker count and clears the invalid overlay
  await assert.rejects(
    layer.render(excessive, { isCurrent }),
    /marker limit exceeded/,
  );
  assert.equal(layer.size, 0);
  assert.deepEqual(removed, []);
});


test('user preserves the full per-direction capacity when both directions are present', async () => {
  // Given the chart candles, interval and marker ownership
  const { dom, shapes } = createChartDom();
  // When findBearishBollingerChartTarget processes the configured inputs
  const target = findBearishBollingerChartTarget(dom.window.document, 'BTRUSDT');
  const layer = createBollingerMarkerLayer(target);
  const bearishSignals = Array.from(
    { length: MAX_BOLLINGER_MARKERS_PER_DIRECTION },
    (_, index) => ({
      id: `bearish-capacity-${index}`,
      direction: 'bearish',
      type: 'warning',
      time: 120 + index,
      markerPrice: 10,
    }),
  );

  await layer.render([
    ...bearishSignals,
    {
      id: 'bullish-capacity-0',
      direction: 'bullish',
      type: 'warning',
      time: 10000,
      markerPrice: 10,
    },
  ], { isCurrent: () => true });

  // Then user preserves the full per-direction capacity when both directions are present
  assert.equal(layer.size, MAX_BOLLINGER_MARKERS_PER_DIRECTION + 1);
});


function overlaySignals() {
  return ['bearish', 'bullish'].flatMap(direction => ['warning', 'confirmed', 'reversal'].map((type, index) => ({
    id: `${direction}:${type}`, direction, type, time: 60 * (index + 1), markerPrice: 10,
  })));
}

test('user sees six directional marker styles anchored to the exact candle and price', async () => {
  // Given all signal types in both directions beside an untouched user drawing
  const fixture = createChartDom();
  fixture.addForeignShape('user-channel');
  const layer = createBollingerMarkerLayer(findBearishBollingerChartTarget(fixture.dom.window.document, 'BTRUSDT'));
  // When the shared layer renders both strategies marker styles
  await layer.render(overlaySignals(), { isCurrent: () => true });
  // Then warnings are circles and confirmations and reversals have directional arrow tips
  assert.deepEqual(fixture.overlay.markers().map(node => [node.dataset.markerId, node.tagName, node.getAttribute('fill'), node.getAttribute('transform')]), [
    ['bearish:warning', 'circle', '#F6465D', 'translate(1 490)'],
    ['bearish:confirmed', 'path', '#F6465D', 'translate(2 490)'],
    ['bearish:reversal', 'path', '#0ECB81', 'translate(3 490)'],
    ['bullish:warning', 'circle', '#0ECB81', 'translate(1 490)'],
    ['bullish:confirmed', 'path', '#0ECB81', 'translate(2 490)'],
    ['bullish:reversal', 'path', '#F6465D', 'translate(3 490)'],
  ]);
  const nodes = fixture.overlay.markers();
  assert.equal(nodes[1].getAttribute('d'), nodes[5].getAttribute('d'));
  assert.equal(nodes[2].getAttribute('d'), nodes[4].getAttribute('d'));
  assert.notEqual(nodes[1].getAttribute('d'), nodes[2].getAttribute('d'));
  const svg = fixture.overlay.pane.querySelector('svg');
  assert.equal(svg.style.pointerEvents, 'none');
  assert.equal(svg.style.overflow, 'hidden');
  assert.deepEqual([...fixture.shapes.keys()], ['user-channel']);
  layer.clear();
  fixture.dom.window.close();
});

test('user sees viewport zoom resize logarithmic and inverted prices through one coalesced frame', async () => {
  // Given visible markers using the actual native price projection boundary
  const fixture = createChartDom();
  const layer = createBollingerMarkerLayer(findBearishBollingerChartTarget(fixture.dom.window.document, 'BTRUSDT'));
  await layer.render(overlaySignals(), { isCurrent: () => true });
  // When pan zoom price mode and resize delegates fire in the same frame
  fixture.overlay.setProjection({ time: index => index * 2, price: price => Math.log10(price) * 40 });
  fixture.overlay.setViewport(300, 100);
  for (const event of Object.values(fixture.overlay.events)) event.emit();
  assert.equal(fixture.overlay.pendingFrames, 1);
  fixture.overlay.flushFrames();
  // Then only visible candles appear at native nonlinear price coordinates
  assert.deepEqual(fixture.overlay.markers().map(node => node.getAttribute('transform')), ['translate(120 40)', 'translate(240 40)', 'translate(120 40)', 'translate(240 40)']);
  assert.equal(layer.overlayStats.renderedFrames, 2);
  assert.equal(fixture.overlay.pane.querySelector('svg').getAttribute('viewBox'), '0 0 300 100');
  // When inverse price mode changes and the viewport becomes empty
  fixture.overlay.setProjection({ price: price => 100 - Math.log10(price) * 40 });
  fixture.overlay.events.modeChanged.emit();
  fixture.overlay.flushFrames();
  // Then the inverse axis moves the markers without touching drawings
  assert.equal(fixture.overlay.markers()[0].getAttribute('transform'), 'translate(120 60)');
  fixture.overlay.setViewport(0, 0);
  fixture.overlay.flushFrames();
  assert.equal(fixture.overlay.markers().length, 0);
  assert.equal(layer.size, 6);
  layer.clear();
  fixture.dom.window.close();
});

test('user never sees a marker snapped to a missing neighboring candle', async () => {
  // Given the time scale resolves a gap to a neighboring index and another time is missing
  const fixture = createChartDom();
  fixture.overlay.setTimeLookup({ index: time => time === 180 ? null : time, time: index => index === 120 ? 119 : index });
  const layer = createBollingerMarkerLayer(findBearishBollingerChartTarget(fixture.dom.window.document, 'BTRUSDT'));
  // When markers are projected with exact native time readback
  await layer.render(overlaySignals(), { isCurrent: () => true });
  // Then only the exact existing candle is displayed while the signal history is retained
  assert.deepEqual(fixture.overlay.markers().map(node => node.dataset.markerId), ['bearish:warning', 'bullish:warning']);
  assert.equal(layer.size, 6);
  layer.clear();
  fixture.dom.window.close();
});

for (const reason of ['hidden', 'interval', 'busy', 'stale']) {
  test(`user hides the overlay during ${reason} transitions and clears it while drawings are busy`, async () => {
    // Given an active overlay with a pending coordinate frame
    const fixture = createChartDom();
    let busy = false;
    let current = true;
    const layer = createBollingerMarkerLayer(findBearishBollingerChartTarget(fixture.dom.window.document, 'BTRUSDT'), { canMutate: () => !busy });
    await layer.render(overlaySignals(), { isCurrent: () => current });
    const svg = fixture.overlay.pane.querySelector('svg');
    fixture.overlay.events.logicalRangeChanged.emit();
    // When the target can no longer publish visible markers
    if (reason === 'hidden') fixture.overlay.setHidden(true);
    if (reason === 'interval') fixture.setResolution('5');
    if (reason === 'busy') busy = true;
    if (reason === 'stale') current = false;
    if (reason === 'busy' || reason === 'stale') fixture.overlay.flushFrames();
    // Then the old overlay is hidden and clear removes every owned resource even while busy
    assert.equal(svg.style.visibility, 'hidden');
    busy = true;
    assert.equal(layer.clear(), true);
    assert.equal(fixture.overlay.pane.querySelector('svg'), null);
    assert.equal(fixture.overlay.pendingFrames, 0);
    assert.equal(fixture.overlay.subscriptions, 0);
    assert.equal(fixture.intervalChanged.size, 0);
    assert.equal(fixture.dataLoaded.size, 0);
    assert.equal(layer.size, 0);
    fixture.dom.window.close();
  });
}

test('user reuses a cleared layer and keeps a second strategies overlay and foreign drawings intact', async () => {
  // Given independent strategy layers attached to one chart
  const fixture = createChartDom();
  fixture.addForeignShape('user-channel');
  const target = findBearishBollingerChartTarget(fixture.dom.window.document, 'BTRUSDT');
  const first = createBollingerMarkerLayer(target);
  const second = createBollingerMarkerLayer(target);
  await first.render(overlaySignals(), { isCurrent: () => true });
  await second.render([{ ...overlaySignals()[0], id: 'strategy31' }], { isCurrent: () => true });
  // When one layer clears and is used again
  first.clear();
  assert.deepEqual(fixture.overlay.markers().map(node => node.dataset.markerId), ['strategy31']);
  await first.render([{ ...overlaySignals()[0], id: 'strategy29' }], { isCurrent: () => true });
  // Then both layers remain independent and no native entity was changed
  assert.deepEqual(fixture.overlay.markers().map(node => node.dataset.markerId), ['strategy31', 'strategy29']);
  assert.equal(fixture.overlay.pane.querySelectorAll('svg').length, 2);
  assert.equal(first.size, 1);
  assert.equal(second.size, 1);
  assert.deepEqual([...fixture.shapes.keys()], ['user-channel']);
  assert.equal(fixture.createdOptions.length, 0);
  first.clear();
  second.clear();
  assert.equal(fixture.overlay.subscriptions, 0);
  fixture.dom.window.close();
});

test('user sees an asynchronous projection failure after complete overlay resource cleanup', async () => {
  // Given a rendered overlay with a consumer failure boundary
  const fixture = createChartDom();
  const failures = [];
  const layer = createBollingerMarkerLayer(findBearishBollingerChartTarget(fixture.dom.window.document, 'BTRUSDT'), {
    onRenderError(error) { failures.push({ message: error.message, attached: layer.overlayStats.attached, subscriptions: fixture.overlay.subscriptions }); },
  });
  await layer.render(overlaySignals(), { isCurrent: () => true });
  // When the native coordinate projection fails in a queued frame
  fixture.overlay.setProjection({ price: () => { throw new Error('price projection failed'); } });
  fixture.overlay.events.priceRangeChanged.emit();
  fixture.overlay.flushFrames();
  // Then the consumer receives the real failure only after all resources are retired
  assert.deepEqual(failures, [{ message: 'price projection failed', attached: false, subscriptions: 0 }]);
  assert.equal(layer.size, 0);
  assert.equal(fixture.overlay.pendingFrames, 0);
  assert.equal(fixture.overlay.pane.querySelector('svg'), null);
  assert.equal(fixture.intervalChanged.size, 0);
  fixture.dom.window.close();
});

test('user gets a visible thrown frame failure when no consumer error callback is installed', async () => {
  // Given an overlay without a consumer recovery boundary
  const fixture = createChartDom();
  const layer = createBollingerMarkerLayer(findBearishBollingerChartTarget(fixture.dom.window.document, 'BTRUSDT'));
  await layer.render(overlaySignals(), { isCurrent: () => true });
  // When a native scale returns an invalid coordinate asynchronously
  fixture.overlay.setProjection({ price: () => NaN });
  fixture.overlay.events.priceRangeChanged.emit();
  // Then the exception propagates and no stale partial overlay survives
  assert.throws(() => fixture.overlay.flushFrames(), /coordinates are invalid/);
  assert.equal(fixture.overlay.subscriptions, 0);
  assert.equal(fixture.overlay.markers().length, 0);
  fixture.dom.window.close();
});

test('user keeps cached detector results and unchanged overlay nodes without DOM writes', async () => {
  // Given a reconciled candle window and observable overlay subtree
  const fixture = createChartDom();
  const layer = createBollingerMarkerLayer(findBearishBollingerChartTarget(fixture.dom.window.document, 'BTRUSDT'));
  const bars = [{ time: 60, open: 10, high: 12, low: 9, close: 11 }];
  let detections = 0;
  const detectSignals = () => { detections += 1; return overlaySignals(); };
  const first = await reconcileBearishBollingerAlertWindow({ bars, cachedWindowKey: null, cachedSignals: null, detectSignals, renderSignals: signals => layer.render(signals, { isCurrent: () => true }) });
  const initialNodes = fixture.overlay.markers();
  const observer = new fixture.overlay.pane.ownerDocument.defaultView.MutationObserver(() => {});
  observer.observe(fixture.overlay.pane, { attributes: true, childList: true, subtree: true });
  // When the unchanged closed-bar window is reconciled again
  const next = await reconcileBearishBollingerAlertWindow({ bars, cachedWindowKey: first.closedBarsWindowKey, cachedContentSnapshot: first.closedBarsContentSnapshot, cachedSignals: first.signals, detectSignals, renderSignals: signals => layer.render(signals, { isCurrent: () => true }) });
  // Then detection is reused and no redraw mutates unchanged DOM
  assert.equal(next.rendered, true);
  assert.equal(detections, 1);
  assert.deepEqual(fixture.overlay.markers(), initialNodes);
  assert.equal(observer.takeRecords().length, 0);
  observer.disconnect();
  layer.clear();
  fixture.dom.window.close();
});

test('user receives independent host index price delegate and animation cancellation contracts', () => {
  // Given a fixture with explicit native candle rows and a private subscription owner
  const fixture = createChartDom();
  const owner = {};
  let notifications = 0;
  const callback = () => { notifications += 1; };
  fixture.overlay.setTimeLookup({ index: time => time === 60 ? 3 : null, time: index => index === 3 ? 60 : undefined });
  fixture.overlay.setProjection({ time: index => index * 12, price: price => Math.log10(price) * 20 });
  const event = fixture.overlay.events.modeChanged;
  // When the chart host maps prices and delivers owner-bound notifications
  event.subscribe(owner, callback);
  event.emit();
  event.unsubscribe(owner, callback);
  event.emit();
  const view = fixture.overlay.pane.ownerDocument.defaultView;
  const cancelled = view.requestAnimationFrame(callback);
  view.cancelAnimationFrame(cancelled);
  fixture.overlay.flushFrames();
  // Then exact time readback nonlinear coordinates and cancellation follow the host contract
  assert.equal(fixture.overlay.timeScale.timePointToIndex(60, 0), 3);
  assert.equal(fixture.overlay.timeScale.timePointToIndex(120, 0), null);
  assert.deepEqual(fixture.chart.getSeries().data().valueAt(3), [60, 1, 2, 0, 1]);
  assert.equal(fixture.chart.getSeries().data().valueAt(4), null);
  assert.equal(fixture.overlay.timeScale.indexToCoordinate(3), 36);
  assert.equal(fixture.overlay.priceScale.priceToCoordinate(100, fixture.overlay.series.firstValue()), 40);
  assert.equal(notifications, 1);
  assert.equal(event.size, 0);
  fixture.dom.window.close();
});

for (const invalid of ['combined-limit', 'duplicate-id', 'invalid-time', 'invalid-price', 'invalid-type']) {
  test(`user rejects ${invalid} signals and removes a previously valid overlay`, async () => {
    // Given valid existing markers followed by a malformed marker request
    const fixture = createChartDom();
    const layer = createBollingerMarkerLayer(findBearishBollingerChartTarget(fixture.dom.window.document, 'BTRUSDT'));
    await layer.render(overlaySignals(), { isCurrent: () => true });
    const invalidRequests = {
      'combined-limit': Array.from({ length: MAX_BOLLINGER_MARKERS + 1 }, (_, index) => ({ ...overlaySignals()[0], id: String(index) })),
      'duplicate-id': [overlaySignals()[0], overlaySignals()[0]],
      'invalid-time': [{ ...overlaySignals()[0], time: 1.5 }],
      'invalid-price': [{ ...overlaySignals()[0], markerPrice: NaN }],
      'invalid-type': [{ ...overlaySignals()[0], type: 'unknown' }],
    };
    // When the invalid request reaches the public rendering boundary
    const rendering = layer.render(invalidRequests[invalid], { isCurrent: () => true });
    // Then a concrete validation failure propagates without stale overlay state
    await assert.rejects(rendering, /limit exceeded|duplicate signal id|signal point is invalid|signal type is invalid/);
    assert.equal(layer.size, 0);
    assert.equal(fixture.overlay.markers().length, 0);
    assert.equal(fixture.overlay.subscriptions, 0);
    assert.equal(fixture.createdOptions.length, 0);
    fixture.dom.window.close();
  });
}
