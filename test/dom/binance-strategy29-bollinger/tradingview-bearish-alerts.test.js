import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import * as alertApi from '../../../src/binance-strategy29-bollinger/dom/tradingview-bearish-alerts.js';
import { getTradingViewMarkerSaveController } from '../../../src/shared/chart-marker-save-controller.js';
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

test('user observes that native marker creation and clear save bursts preserve foreign drawings without arming stable audits', async () => {
  // Given the chart candles, interval and marker ownership
  const fixture = createChartDom();
  // When fixture.addForeignShape processes the configured inputs
  fixture.addForeignShape('user-channel');
  const snapshots = [];
  const scheduleSave = () => setTimeout(() => fixture.tradingViewApi.saveChart((value) => snapshots.push(value)), 100);
  const create = fixture.chart.createShape;
  fixture.chart.createShape = async (...args) => {
    const id = await create(...args);
    const shape = fixture.chart.getShapeById(id);
    const update = shape.setProperties.bind(shape);
    shape.setProperties = (...properties) => { update(...properties); scheduleSave(); };
    scheduleSave();
    return id;
  };
  const remove = fixture.chart.removeEntity;
  fixture.chart.removeEntity = (id) => { remove(id); scheduleSave(); };
  const target = findBearishBollingerChartTarget(fixture.dom.window.document, 'BTRUSDT');
  const layer = createBollingerMarkerLayer(target);
  const controller = getTradingViewMarkerSaveController(fixture.tradingViewApi);
  const signals = Array.from({ length: 5 }, (_, i) => ({
    id: `signal-${i}`, direction: 'bearish', type: 'warning', time: 60 * (i + 1), markerPrice: 13,
  }));
  const observedResult = await layer.render(signals, { isCurrent: () => true });
  // Then user observes that native marker creation and clear save bursts preserve foreign drawings without arming stable audits
  assert.equal(observedResult, true);
  await controller.runAfterIdle(() => {});
  assert.equal(layer.saveStats.saveRequests, 10);
  assert.equal(layer.saveStats.serializations, 1);
  assert.equal(snapshots.length, 10);
  assert.deepEqual(snapshots[0], { drawings: [{ id: 'user-channel' }] });
  assert.equal(await layer.render(signals, { isCurrent: () => true }), true);
  assert.equal(layer.saveStats.busy, false);
  assert.equal(layer.saveStats.serializations, 1);
  assert.equal(layer.clear(), true);
  assert.equal(layer.saveStats.busy, true);
  await controller.runAfterIdle(() => {});
  assert.equal(layer.saveStats.saveRequests, 15);
  assert.equal(layer.saveStats.serializations, 2);
  assert.equal(snapshots.length, 15);
  assert.deepEqual([...fixture.shapes.keys()], ['user-channel']);
  assert.deepEqual(snapshots.at(-1), { drawings: [{ id: 'user-channel' }] });
});

test('user observes that an outer save drain waits for native creation, leaves its late result hidden, and preserves cleanup ownership', async () => {
  // Given the chart candles, interval and marker ownership
  const fixture = createChartDom({ deferredCreate: true });
  // When fixture.addForeignShape processes the configured inputs
  fixture.addForeignShape('user-channel');
  const target = findBearishBollingerChartTarget(fixture.dom.window.document, 'BTRUSDT');
  const layer = createBollingerMarkerLayer(target);
  const rendering = layer.render([
    { id: 'warning', direction: 'bearish', type: 'warning', time: 60, markerPrice: 13 },
  ], { isCurrent: () => true });
  const controller = getTradingViewMarkerSaveController(fixture.tradingViewApi);
  let starts = 0;
  const drain = controller.runAfterIdle(() => { starts += 1; });
  // Then user observes that an outer save drain waits for native creation, leaves its late result hidden, and preserves cleanup ownership
  assert.equal(starts, 0);
  assert.equal(layer.saveStats.mutations, 1);
  fixture.releaseCreate();
  assert.equal(await rendering, false);
  assert.equal(fixture.shapes.get('shape-1').properties.overrides.visible, false);
  assert.equal(fixture.propertyUpdates.length, 0);
  await drain;
  assert.equal(starts, 1);
  assert.equal(layer.clear(), true);
  assert.deepEqual([...fixture.shapes.keys()], ['user-channel']);
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
  shiftSeconds = 0,
  deferredCreate = false,
} = {}) {
  const dom = loadFixtureDom('<div class="chart-widget-root"><iframe></iframe></div>');
  const shapes = new Map();
  const removed = [];
  const createdOptions = [];
  const propertyUpdates = [];
  let nextId = 1;
  let releaseCreate = null;
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
    async createShape(point, properties) {
      createdOptions.push(structuredClone(properties));
      if (deferredCreate) await new Promise((resolve) => { releaseCreate = resolve; });
      const id = `shape-${nextId++}`;
      const currentVisibility = alertApi.bollingerIntervalVisibility(currentResolution);
      const nativeVisibility = { ...properties.overrides.intervalsVisibilities };
      // Native creation enables the interval active when the async loader resolves.
      for (const [key, value] of Object.entries(currentVisibility)) {
        if (value !== false) nativeVisibility[key] = value;
      }
      shapes.set(id, {
        point: { ...point, time: point.time + shiftSeconds },
        properties: { ...properties, overrides: { ...properties.overrides, intervalsVisibilities: nativeVisibility } },
        getPoints() { return [this.point]; },
        getProperties() { return { ...this.properties.overrides, icon: this.properties.icon }; },
        setProperties(overrides, saveDefaults) {
          propertyUpdates.push({ id, overrides: structuredClone(overrides), saveDefaults });
          Object.assign(this.properties.overrides, overrides);
        },
      });
      return id;
    },
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
  let activeChart = chart;
  const tradingViewApi = {
    activeChart: () => activeChart,
    saveChart: (callback) => callback({
      drawings: [...shapes].filter(([, record]) => !record.properties.disableSave).map(([id]) => ({ id })),
    }),
  };
  dom.window.document.querySelector('iframe').contentWindow.tradingViewApi = tradingViewApi;
  return {
    dom,
    chart,
    tradingViewApi,
    intervalChanged,
    dataLoaded,
    shapes,
    removed,
    createdOptions,
    propertyUpdates,
    setModelReady: (value) => { modelReady = value; },
    releaseCreate: () => releaseCreate(),
    setActiveChart: (value) => { activeChart = value; },
    setResolution: (value) => { currentResolution = value; intervalChanged.fire(value); },
    setSymbol: (value) => { currentSymbol = value; },
    evictShape: (id) => { shapes.delete(id); },
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
  const recentIds = [...fixture.shapes.keys()].filter(id => id !== 'user-channel');
  assert.equal(recentIds.length, 12);
  assert.equal(fixture.monitor.diagnostics.cachedSignalCount, 12);
  assert.equal(fixture.source.exported.data.at(-1)[0], 36000);

  // When older native history expands the same latest-candle window to six hundred candles
  fixture.source.exported = exportResult(fullMonitorHistory());
  await fixture.sample();

  // Then all thirty-nine real detector signals are retained, including the earliest loaded setup
  assert.equal(fixture.monitor.diagnostics.cachedSignalCount, 39);
  assert.equal(fixture.monitor.diagnostics.layerSize, 39);
  assert.equal(fixture.shapes.size, 40);
  assert.equal(fixture.source.exported.data.at(-1)[0], 36000);
  assert.equal(recentIds.every(id => fixture.shapes.has(id)), true);
  assert.deepEqual(fixture.removed, []);
  assert.deepEqual([...fixture.shapes.values()].filter(shape => shape.point.time > 0).map(shape => shape.point.time).sort((a, b) => a - b).slice(0, 3), [5760, 5820, 6840]);
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
  const ids = [...fixture.shapes.keys()];
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
  assert.deepEqual([...fixture.shapes.keys()], ids);
  assert.equal(fixture.warnings.length, 1);
  assert.equal(isTradingViewBarSnapshotInconsistentError(fixture.warnings[0][1]), true);

  // When the next poll receives a coherent native snapshot
  fixture.source.exported = original;
  await fixture.sample();

  // Then the real monitor resumes sampling without replacing unchanged markers
  assert.equal(fixture.source.requests, 3);
  assert.deepEqual([...fixture.shapes.keys()], ids);
  assert.equal(fixture.monitor.diagnostics.failed, false);
  assert.deepEqual(fixture.errors, []);
});

test('user sees a fatal real monitor schema failure clear only owned markers on the next cleanup sample', async (t) => {
  // Given verified detector markers beside a foreign user drawing
  const fixture = fullMonitorFixture(t);
  fixture.addForeignShape('user-channel');
  await fixture.sample();

  // When the native chart returns an invalid export schema
  fixture.source.exported = { schema: [], data: [] };
  await fixture.sample();

  // Then the fatal failure records pre-cleanup evidence and schedules owned-layer cleanup
  assert.equal(fixture.monitor.diagnostics.failed, true);
  assert.equal(fixture.monitor.diagnostics.cleanupPending, true);
  assert.equal(fixture.monitor.diagnostics.lastLocalFailure.stage, 'export');
  assert.equal(fixture.monitor.diagnostics.lastLocalFailure.cachedSignalCount, 12);
  assert.equal(fixture.monitor.diagnostics.lastLocalFailure.layerSizeBeforeCleanup, 12);
  assert.match(fixture.monitor.diagnostics.lastLocalFailure.message, /schema mismatch/);
  assert.equal(fixture.shapes.size, 13);

  // When the next sample executes the deferred fatal cleanup
  await fixture.sample();

  // Then every owned marker is removed once and the failed context stops exporting
  assert.deepEqual([...fixture.shapes.keys()], ['user-channel']);
  assert.equal(fixture.removed.length, 12);
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

test('user observes that reconciles moved points, changed signal prices and altered owned colors without touching foreign drawings', async () => {
  // Given the chart candles, interval and marker ownership
  const { dom, shapes, removed, addForeignShape } = createChartDom();
  const layer = createBollingerMarkerLayer(findBearishBollingerChartTarget(dom.window.document, 'BTRUSDT'));
  const signal = { id: 'drift', direction: 'bearish', type: 'warning', time: 120, markerPrice: 10 };
  // When addForeignShape processes the configured inputs
  addForeignShape();
  await layer.render([signal], { isCurrent: () => true });
  shapes.get('shape-1').point.time = 60;
  await layer.render([signal], { isCurrent: () => true });
  // Then user observes that reconciles moved points, changed signal prices and altered owned colors without touching foreign drawings
  assert.deepEqual(shapes.get('shape-2').point, { time: 120, price: 10 });
  shapes.get('shape-2').point.price = 12;
  await layer.render([signal], { isCurrent: () => true });
  assert.deepEqual(shapes.get('shape-3').point, { time: 120, price: 10 });
  await layer.render([{ ...signal, markerPrice: 11 }], { isCurrent: () => true });
  assert.equal(shapes.get('shape-4').point.price, 11);
  shapes.get('shape-4').properties.overrides.color = '#000000';
  await layer.render([{ ...signal, markerPrice: 11 }], { isCurrent: () => true });
  assert.equal(shapes.get('shape-5').properties.overrides.color, '#F6465D');
  shapes.get('shape-5').properties.shape = 'arrow_down';
  await layer.render([{ ...signal, markerPrice: 11 }], { isCurrent: () => true });
  assert.equal(shapes.get('shape-6').properties.shape, 'icon');
  assert.deepEqual(removed, ['shape-1', 'shape-2', 'shape-3', 'shape-4', 'shape-5']);
  assert.equal(shapes.has('foreign-shape'), true);
});

test('user observes that native interval visibility hides second markers on minutes even while cleanup is busy', async () => {
  // Given the chart candles, interval and marker ownership
  const { dom, shapes, removed, setResolution } = createChartDom({ resolution: '1S' });
  let busy = false;
  const layer = createBollingerMarkerLayer(findBearishBollingerChartTarget(dom.window.document, 'BTRUSDT'), {
    canMutate: () => !busy,
  });
  // When layer.render processes the configured inputs
  await layer.render([{ id: 'second', direction: 'bearish', type: 'warning', time: 3601, markerPrice: 10 }], {
    isCurrent: () => true,
  });
  const visibility = shapes.get('shape-1').properties.overrides.intervalsVisibilities;
  // Then user observes that native interval visibility hides second markers on minutes even while cleanup is busy
  assert.equal(visibility.seconds, true);
  assert.equal(visibility.secondsFrom, 1);
  assert.equal(visibility.secondsTo, 1);
  assert.equal(visibility.minutes, false);
  busy = true;
  setResolution('1');
  assert.equal(layer.clear(), false);
  assert.deepEqual(removed, []);
  busy = false;
  assert.equal(layer.clear(), true);
  assert.equal(shapes.size, 0);
});

test('user retains late async marker ownership until a busy chart permits cleanup', async () => {
  // Given the chart candles, interval and marker ownership
  const { dom, shapes, removed, releaseCreate, setResolution, createdOptions, propertyUpdates } = createChartDom({ resolution: '1S', deferredCreate: true });
  let busy = false;
  let current = true;
  const layer = createBollingerMarkerLayer(findBearishBollingerChartTarget(dom.window.document, 'BTRUSDT'), {
    canMutate: () => !busy,
  });
  // When layer.render processes the configured inputs
  const pending = layer.render([{ id: 'late', direction: 'bearish', type: 'warning', time: 3601, markerPrice: 10 }], {
    isCurrent: () => current,
  });
  await Promise.resolve();
  // Then user retains late async marker ownership until a busy chart permits cleanup
  assert.equal(layer.clear(), false);
  current = false;
  busy = true;
  setResolution('1');
  releaseCreate();
  assert.equal(await pending, false);
  assert.equal(shapes.size, 1);
  assert.equal(createdOptions[0].overrides.visible, false);
  assert.equal(shapes.get('shape-1').getProperties().intervalsVisibilities.minutes, true);
  assert.equal(shapes.get('shape-1').getProperties().visible, false);
  assert.deepEqual(propertyUpdates, []);
  assert.deepEqual(removed, []);
  busy = false;
  assert.equal(layer.clear(), true);
  assert.equal(shapes.size, 0);
  assert.deepEqual(removed, ['shape-1']);
});

test('user publishes a current hidden creation only after restoring its exact interval mask', async () => {
  // Given the chart candles, interval and marker ownership
  const fixture = createChartDom({ resolution: '1S', deferredCreate: true });
  const layer = createBollingerMarkerLayer(findBearishBollingerChartTarget(fixture.dom.window.document, 'BTRUSDT'));
  // When layer.render processes the configured inputs
  const pending = layer.render([{ id: 'publish', direction: 'bullish', type: 'confirmed', time: 3601, markerPrice: 10 }], {
    isCurrent: () => true,
  });
  fixture.setResolution('1');
  fixture.releaseCreate();
  // Then user publishes a current hidden creation only after restoring its exact interval mask
  assert.equal(await pending, true);
  assert.equal(fixture.createdOptions[0].overrides.visible, false);
  assert.equal(fixture.propertyUpdates.length, 1);
  assert.equal(fixture.propertyUpdates[0].saveDefaults, false);
  const properties = fixture.shapes.get('shape-1').getProperties();
  assert.equal(properties.visible, true);
  assert.equal(properties.intervalsVisibilities.minutes, false);
  assert.equal(properties.intervalsVisibilities.seconds, true);
  assert.equal(properties.arrowColor, '#0ECB81');
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
  assert.equal(fixture.shapes.size, 1);
  harness.setBusy(true);
  fixture.setResolution('1');
  await harness.tick();
  assert.equal(harness.monitor.context, null);
  assert.equal(harness.monitor.retiredCount, 1);
  assert.equal(fixture.removed.length, 0);
  assert.equal(harness.detectorCalls, 1);
  harness.setBusy(false);
  await harness.tick();
  assert.equal(fixture.shapes.size, 0);
  assert.equal(harness.monitor.context, null);
  assert.equal(session.isCurrent(session.revision), false);
  fixture.chart.exportData = async () => exportResult([
    { 0: 3600, 1: 10, 2: 12, 3: 9, 4: 11 },
    { 0: 3660, 1: 10, 2: 12, 3: 9, 4: 11 },
  ]);
  fixture.dataLoaded.fire();
  await harness.tick();
  assert.equal(harness.monitor.context.resolution, '1');
  assert.equal(fixture.shapes.size, 1);
  assert.deepEqual(fixture.shapes.get('shape-2').point, { time: 3600, price: 13 });
  assert.equal(fixture.shapes.get('shape-2').properties.overrides.intervalsVisibilities.seconds, false);
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
  assert.equal(fixture.shapes.size, 0);
  assert.equal(harness.detectorCalls, 0);
  harness.setBusy(false);
  harness.setHidden(false);
  fixture.chart.exportData = async () => exportResult([{ 0: 3601, 1: 10, 2: 12, 3: 9, 4: 11 }]);
  await harness.tick();
  assert.equal(harness.monitor.retiredCount, 0);
  assert.equal(fixture.intervalChanged.size, 1);
  assert.equal(fixture.shapes.size, 1);
  harness.monitor.stop();
  assert.deepEqual(harness.errors, []);
});

test('user observes that production monitor retains a retired layer until late creation and busy cleanup finish', async () => {
  // Given the chart candles, interval and marker ownership
  const fixture = createChartDom({ resolution: '1S', deferredCreate: true });
  const harness = createMonitorHarness(fixture);
  fixture.chart.exportData = async () => exportResult([{ 0: 3601, 1: 10, 2: 12, 3: 9, 4: 11 }]);
  // When harness.monitor.tick processes the configured inputs
  await harness.monitor.tick();
  await Promise.resolve();
  const oldTask = harness.monitor.task;
  harness.setBusy(true);
  fixture.setResolution('1');
  await harness.monitor.tick();
  // Then user observes that production monitor retains a retired layer until late creation and busy cleanup finish
  assert.equal(harness.monitor.context, null);
  fixture.releaseCreate();
  await oldTask;
  assert.equal(harness.monitor.retiredCount, 1);
  assert.equal(fixture.shapes.size, 1);
  assert.deepEqual(fixture.removed, []);
  harness.setBusy(false);
  await harness.tick();
  assert.equal(harness.monitor.retiredCount, 0);
  assert.equal(fixture.shapes.size, 0);
  assert.deepEqual(fixture.removed, ['shape-1']);
  harness.monitor.stop();
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
  assert.equal(fixture.shapes.size, 0);
  assert.equal(harness.detectorCalls, 1);
  fixture.dataLoaded.fire();
  await harness.tick();
  assert.notEqual(harness.monitor.context, originalContext);
  assert.equal(harness.monitor.context.intervalRevision, 2);
  assert.equal(fixture.shapes.size, 1);
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
  assert.equal(harness.monitor.retiredCount, 1);
  assert.deepEqual(fixture.removed, []);
  harness.setBusy(false);
  await harness.tick();
  assert.equal(fixture.shapes.size, 0);
  assert.equal(replacement.shapes.size, 1);
  assert.equal(harness.monitor.context.target.chart, replacement.chart);
  harness.monitor.stop();
  assert.equal(replacement.intervalChanged.size, 0);
});

for (const [resolution, unit, count] of [
    ['1S', 'seconds', 1], ['90S', 'minutes', 1], ['15', 'minutes', 15], ['60', 'hours', 1],
    ['4H', 'hours', 4], ['1D', 'days', 1], ['1W', 'weeks', 1],
  ]) {
  test(`user uses native visibility buckets for Binance seconds, minutes, hours, days and weeks (resolution=${JSON.stringify(resolution)})`, () => {
    // Given a Binance chart resolution with its native visibility bucket
    const sourceResolution = resolution;
    // When the marker visibility mask is constructed
    const visibility = alertApi.bollingerIntervalVisibility(sourceResolution);
    // Then only the exact expected bucket is enabled
    assert.equal(visibility[unit], true);
    assert.equal(visibility[`${unit}From`], count);
    assert.equal(visibility[`${unit}To`], count);
    assert.deepEqual(Object.entries(visibility).filter(([, value]) => value === true).map(([key]) => key), [unit]);

  });
}

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
  assert.equal(fixture.shapes.size, 0);
  fixture.setModelReady(true);
  await harness.tick();
  assert.equal(harness.monitor.context.resolution, '1');
  assert.equal(fixture.shapes.size, 1);
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
    markerSaveStats: { busy: true, mutations: 0, draining: 0, saveRequests: 0,
      serializations: 0, callbackCount: 0, failureCount: 0, pendingCallbacks: 0 },
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

test('user observes that initial one-second alignment failure retains requested and native times after cleanup', async () => {
  // Given the chart candles, interval and marker ownership
  const fixture = createChartDom({ resolution: '1S', shiftSeconds: -60 });
  const harness = createMonitorHarness(fixture);
  fixture.chart.exportData = async () => exportResult([{ 0: 120, 1: 10, 2: 12, 3: 9, 4: 11 }]);
  const message = 'TradingView Bollinger alert time alignment failed: expected 120, received 60';
  // When harness.tick processes the configured inputs
  const observedResult = harness.tick();
  // Then user observes that initial one-second alignment failure retains requested and native times after cleanup
  await assert.rejects(observedResult, { message });
  await harness.tick();
  assert.equal(harness.monitor.diagnostics.failed, true);
  assert.equal(harness.monitor.diagnostics.layerSize, 0);
  assert.equal(fixture.shapes.size, 0);
  assert.deepEqual(harness.monitor.diagnostics.lastLocalFailure, {
    thrownType: 'object', classificationFailed: false, name: 'Error', message,
    unreadableFields: [], stage: 'render', routeSymbol: 'BTRUSDT', resolution: '1S',
    cachedSignalCount: null, layerSizeBeforeCleanup: 0,
    sessionRevision: 0, contextIntervalRevision: 0,
  });
  harness.monitor.stop();
  assert.equal(harness.monitor.diagnostics.lastLocalFailure.message, message);
  fixture.dom.window.close();
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
    else fixture.chart.getShapeById = () => undefined;
    const message = stage === 'export' ? 'synthetic export failure' : 'TradingView Bollinger alert marker point is invalid';
    await assert.rejects(harness.tick(), { message });
    await harness.tick();
    assert.equal(harness.monitor.diagnostics.failed, true);
    assert.equal(harness.monitor.diagnostics.cleanupPending, false);
    assert.equal(harness.monitor.diagnostics.layerSize, 0);
    const expected = {
      thrownType: 'object', classificationFailed: false, name: 'Error', message, unreadableFields: [], stage, routeSymbol: 'BTRUSDT', resolution: '1',
      cachedSignalCount: 6, layerSizeBeforeCleanup: 6,
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

test('user renders warning, bearish confirmation, and bullish reversal markers', async () => {
  // Given the chart candles, interval and marker ownership
  const { dom, shapes, removed } = createChartDom();
  // When findBearishBollingerChartTarget processes the configured inputs
  const target = findBearishBollingerChartTarget(dom.window.document, 'BTRUSDT');
  const layer = createBearishBollingerMarkerLayer(target);
  const isCurrent = () => true;

  const observedResult = await layer.render([
    { id: 'setup:warning', type: 'warning', time: 120, markerPrice: 10 },
    { id: 'setup:confirmed', type: 'confirmed', time: 180, markerPrice: 9 },
    { id: 'setup:reversal', type: 'reversal', time: 240, markerPrice: 8 },
  ], { isCurrent });
  // Then user renders warning, bearish confirmation, and bullish reversal markers
  assert.equal(observedResult, true);
  assert.equal(shapes.size, 3);
  const records = [...shapes.values()];
  assert.equal(records[0].properties.shape, 'icon');
  assert.equal(records[0].properties.icon, 0xf111);
  assert.equal(records[0].properties.overrides.color, '#F6465D');
  assert.equal(records[1].properties.shape, 'arrow_down');
  assert.equal(records[1].properties.overrides.arrowColor, '#F6465D');
  assert.equal(records[2].properties.shape, 'arrow_up');
  assert.equal(records[2].properties.overrides.arrowColor, '#0ECB81');
  assert.equal(records[2].point.price, 8);

  await layer.render([{ id: 'setup:reversal', type: 'reversal', time: 240, markerPrice: 8 }], {
    isCurrent,
  });
  assert.equal(shapes.size, 1);
  assert.deepEqual(removed, ['shape-1', 'shape-2']);
});

test('user renders mirrored bullish marker shapes and colors in the shared layer', async () => {
  // Given the chart candles, interval and marker ownership
  const { dom, shapes } = createChartDom();
  // When findBearishBollingerChartTarget processes the configured inputs
  const target = findBearishBollingerChartTarget(dom.window.document, 'BTRUSDT');
  const layer = createBearishBollingerMarkerLayer(target);

  await layer.render([
    {
      id: 'setup:bullish:warning',
      direction: 'bullish',
      type: 'warning',
      time: 120,
      markerPrice: 10,
    },
    {
      id: 'setup:bullish:confirmed',
      direction: 'bullish',
      type: 'confirmed',
      time: 180,
      markerPrice: 9,
    },
    {
      id: 'setup:bullish:reversal',
      direction: 'bullish',
      type: 'reversal',
      time: 240,
      markerPrice: 8,
    },
  ], { isCurrent: () => true });

  const records = [...shapes.values()];
  // Then user renders mirrored bullish marker shapes and colors in the shared layer
  assert.equal(records[0].properties.shape, 'icon');
  assert.equal(records[0].properties.overrides.color, '#0ECB81');
  assert.equal(records[1].properties.shape, 'arrow_up');
  assert.equal(records[1].properties.overrides.arrowColor, '#0ECB81');
  assert.equal(records[2].properties.shape, 'arrow_down');
  assert.equal(records[2].properties.overrides.arrowColor, '#F6465D');
});

test('user keeps opposite-direction signals on the same candle as distinct markers', async () => {
  // Given the chart candles, interval and marker ownership
  const { dom, shapes } = createChartDom();
  // When findBearishBollingerChartTarget processes the configured inputs
  const target = findBearishBollingerChartTarget(dom.window.document, 'BTRUSDT');
  const layer = createBollingerMarkerLayer(target);

  await layer.render([
    {
      id: 'setup:bearish:reversal',
      direction: 'bearish',
      type: 'reversal',
      time: 240,
      markerPrice: 8,
    },
    {
      id: 'setup:bullish:reversal',
      direction: 'bullish',
      type: 'reversal',
      time: 240,
      markerPrice: 12,
    },
  ], { isCurrent: () => true });

  // Then user keeps opposite-direction signals on the same candle as distinct markers
  assert.equal(shapes.size, 2);
  const records = [...shapes.values()];
  assert.deepEqual(
    records.map((record) => [record.point.time, record.point.price, record.properties.shape]),
    [[240, 8, 'arrow_up'], [240, 12, 'arrow_down']],
  );
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
  assert.equal(shapes.size, 1);

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
  assert.equal(shapes.size, 1);

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
  assert.equal(shapes.size, 2);
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

test('user recreates a marker that TradingView evicted outside the alert layer', async () => {
  // Given the chart candles, interval and marker ownership
  const {
    dom,
    shapes,
    removed,
    evictShape,
  } = createChartDom();
  // When findBearishBollingerChartTarget processes the configured inputs
  const target = findBearishBollingerChartTarget(dom.window.document, 'BTRUSDT');
  const layer = createBearishBollingerMarkerLayer(target);
  const signals = [{
    id: 'setup:warning',
    type: 'warning',
    time: 120,
    markerPrice: 10,
  }];

  const observedResult = await layer.render(signals, { isCurrent: () => true });
  // Then user recreates a marker that TradingView evicted outside the alert layer
  assert.equal(observedResult, true);
  assert.equal(shapes.has('shape-1'), true);

  evictShape('shape-1');

  assert.equal(await layer.render(signals, { isCurrent: () => true }), true);
  assert.equal(shapes.has('shape-1'), false);
  assert.equal(shapes.has('shape-2'), true);
  assert.deepEqual(removed, []);
});

test('user observes that same closed-bar window reuses detection and still restores an evicted marker', async () => {
  // Given the chart candles, interval and marker ownership
  const {
    dom,
    shapes,
    removed,
    evictShape,
  } = createChartDom();
  // When findBearishBollingerChartTarget processes the configured inputs
  const target = findBearishBollingerChartTarget(dom.window.document, 'BTRUSDT');
  const layer = createBearishBollingerMarkerLayer(target);
  const bars = [
    { time: 60, open: 10, high: 12, low: 9, close: 11 },
    { time: 120, open: 11, high: 13, low: 10, close: 12 },
  ];
  const expectedSignals = [{
    id: 'setup:warning',
    type: 'warning',
    time: 120,
    markerPrice: 10,
  }];
  let detectorCalls = 0;
  let rendererCalls = 0;
  let cachedWindowKey = null;
  let cachedContentSnapshot = null;
  let cachedSignals = null;

  async function runMonitorTick() {
    const result = await reconcileBearishBollingerAlertWindow({
      bars,
      cachedWindowKey,
      cachedContentSnapshot,
      cachedSignals,
      detectSignals: () => {
        detectorCalls += 1;
        return expectedSignals;
      },
      renderSignals: (signals) => {
        rendererCalls += 1;
        return layer.render(signals, { isCurrent: () => true });
      },
    });
    if (result.rendered) {
      cachedWindowKey = result.closedBarsWindowKey;
      cachedContentSnapshot = result.closedBarsContentSnapshot;
      cachedSignals = result.signals;
    }
  }

  await runMonitorTick();
  // Then user observes that same closed-bar window reuses detection and still restores an evicted marker
  assert.equal(shapes.has('shape-1'), true);
  evictShape('shape-1');

  await runMonitorTick();

  assert.equal(detectorCalls, 1);
  assert.equal(rendererCalls, 2);
  assert.equal(shapes.has('shape-1'), false);
  assert.equal(shapes.has('shape-2'), true);
  assert.deepEqual(removed, []);
});

test('user observes that reconciliation, signal removal, and clear preserve foreign drawings', async () => {
  // Given the chart candles, interval and marker ownership
  const {
    dom,
    shapes,
    removed,
    evictShape,
    addForeignShape,
  } = createChartDom();
  // When findBearishBollingerChartTarget processes the configured inputs
  const target = findBearishBollingerChartTarget(dom.window.document, 'BTRUSDT');
  const layer = createBearishBollingerMarkerLayer(target);
  const foreignId = addForeignShape();
  const signal = {
    id: 'setup:warning',
    type: 'warning',
    time: 120,
    markerPrice: 10,
  };

  await layer.render([signal], { isCurrent: () => true });
  evictShape('shape-1');
  await layer.render([signal], { isCurrent: () => true });

  // Then user observes that reconciliation, signal removal, and clear preserve foreign drawings
  assert.equal(shapes.has(foreignId), true);
  assert.deepEqual(removed, []);

  await layer.render([], { isCurrent: () => true });
  assert.equal(shapes.has(foreignId), true);
  assert.deepEqual(removed, ['shape-2']);

  await layer.render([signal], { isCurrent: () => true });
  layer.clear();

  assert.equal(shapes.size, 1);
  assert.equal(shapes.has(foreignId), true);
  assert.deepEqual(removed, ['shape-2', 'shape-3']);
});

test('user observes that clear forgets an externally evicted marker without removing a missing entity', async () => {
  // Given the chart candles, interval and marker ownership
  const {
    dom,
    shapes,
    removed,
    evictShape,
  } = createChartDom();
  // When findBearishBollingerChartTarget processes the configured inputs
  const target = findBearishBollingerChartTarget(dom.window.document, 'BTRUSDT');
  const layer = createBearishBollingerMarkerLayer(target);

  await layer.render([{
    id: 'setup:warning',
    type: 'warning',
    time: 120,
    markerPrice: 10,
  }], { isCurrent: () => true });
  evictShape('shape-1');

  layer.clear();

  // Then user observes that clear forgets an externally evicted marker without removing a missing entity
  assert.equal(layer.size, 0);
  assert.equal(shapes.size, 0);
  assert.deepEqual(removed, []);
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

test('user rejects an abnormal marker count before mutating the existing layer', async () => {
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

  // Then user rejects an abnormal marker count before mutating the existing layer
  await assert.rejects(
    layer.render(excessive, { isCurrent }),
    /marker limit exceeded/,
  );
  assert.equal(shapes.size, 1);
  assert.deepEqual(removed, []);
});

test('user applies the marker limit to the combined bullish and bearish layer', async () => {
  // Given the chart candles, interval and marker ownership
  const { dom, chart, shapes, removed, createdOptions, propertyUpdates } = createChartDom();
  // When findBearishBollingerChartTarget processes the configured inputs
  const target = findBearishBollingerChartTarget(dom.window.document, 'BTRUSDT');
  let yields = 0;
  const layer = createBollingerMarkerLayer(target, { yieldToBrowser: async () => { yields += 1; } });
  const signals = Array.from({ length: MAX_BOLLINGER_MARKERS }, (_, index) => ({
    id: `combined-${index}`,
    direction: index % 2 === 0 ? 'bearish' : 'bullish',
    type: 'warning',
    time: 120 + index,
    markerPrice: 10,
  }));

  const observedResult = await layer.render(signals, { isCurrent: () => true });
  // Then user applies the marker limit to the combined bullish and bearish layer
  assert.equal(observedResult, true);
  assert.equal(shapes.size, MAX_BOLLINGER_MARKERS);

  const reads = { handles: 0, points: 0, properties: 0 };
  yields = 0;
  const getShapeById = chart.getShapeById;
  chart.getShapeById = (id) => { reads.handles += 1; return getShapeById(id); };
  for (const shape of shapes.values()) {
    const getPoints = shape.getPoints.bind(shape);
    const getProperties = shape.getProperties.bind(shape);
    shape.getPoints = () => { reads.points += 1; return getPoints(); };
    shape.getProperties = () => { reads.properties += 1; return getProperties(); };
  }
  assert.equal(await layer.render(signals, { isCurrent: () => true }), true);
  assert.ok(yields >= Math.floor((MAX_BOLLINGER_MARKERS - 1) / 32));
  assert.deepEqual(reads, {
    handles: MAX_BOLLINGER_MARKERS,
    points: MAX_BOLLINGER_MARKERS,
    properties: MAX_BOLLINGER_MARKERS,
  });
  assert.equal(createdOptions.length, MAX_BOLLINGER_MARKERS);
  assert.equal(propertyUpdates.length, MAX_BOLLINGER_MARKERS);

  await assert.rejects(
    layer.render([
      ...signals,
      {
        id: 'combined-overflow',
        direction: 'bullish',
        type: 'warning',
        time: 120 + MAX_BOLLINGER_MARKERS,
        markerPrice: 10,
      },
    ], { isCurrent: () => true }),
    /marker limit exceeded/,
  );
  assert.equal(shapes.size, MAX_BOLLINGER_MARKERS);
  assert.deepEqual(removed, []);
});

function batchSignals() {
  return Array.from({ length: 64 }, (_, index) => ({
    id: `batch-${index}`, direction: 'bearish', type: 'warning',
    time: 120 + index * 60, markerPrice: 10,
  }));
}

test('user observes that a real render batch yields a browser task before finishing', async (t) => {
  // Given the chart candles, interval and marker ownership
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fixture = createChartDom();
  // When findBearishBollingerChartTarget processes the configured inputs
  const target = findBearishBollingerChartTarget(fixture.dom.window.document, 'BTRUSDT');
  const layer = createBollingerMarkerLayer(target);
  let completed = false;
  const task = layer.render(batchSignals(), { isCurrent: () => true }).then(result => { completed = true; return result; });
  await observeStrategyCondition(() => fixture.shapes.size > 0, 'first render batch');
  // Then user observes that a real render batch yields a browser task before finishing
  assert.ok(fixture.shapes.size > 0 && fixture.shapes.size <= 32);
  assert.equal(completed, false, 'microtasks alone cannot resume the default browser-task yield');
  for (let batch = 0; batch < 64 && !completed; batch += 1) {
    t.mock.timers.tick(0);
    await new Promise(setImmediate);
  }
  assert.equal(completed, true, 'each explicit browser task advances the bounded render');
  assert.equal(await task, true);
  assert.equal(fixture.shapes.size, 64);
});

for (const reason of ['stale', 'busy', 'clear']) {
  test(`user observes that a ${reason} transition during a render yield stops the old batch`, async () => {
    // Given the chart candles, interval and marker ownership
    const fixture = createChartDom();
    // When findBearishBollingerChartTarget processes the configured inputs
    const target = findBearishBollingerChartTarget(fixture.dom.window.document, 'BTRUSDT');
    let current = true;
    let busy = false;
    let countAtYield = 0;
    const layer = createBollingerMarkerLayer(target, {
      canMutate: () => !busy,
      yieldToBrowser: async () => {
        countAtYield = fixture.createdOptions.length;
        if (reason === 'stale') current = false;
        if (reason === 'busy') busy = true;
        if (reason === 'clear') assert.equal(layer.clear(), true);
      },
    });
    const result = await reconcileBearishBollingerAlertWindow({
      bars: [{ time: 120, open: 10, high: 12, low: 9, close: 11 }],
      cachedWindowKey: null, cachedSignals: null,
      detectSignals: batchSignals,
      renderSignals: (signals) => layer.render(signals, { isCurrent: () => current }),
    });
    // Then user observes that a the selected case transition during a render yield stops the old batch
    assert.ok(countAtYield > 0 && countAtYield <= 32);
    assert.equal(fixture.createdOptions.length, countAtYield);
    assert.equal(fixture.propertyUpdates.length, countAtYield);
    assert.equal(result.rendered, false);
    assert.equal(fixture.shapes.size, reason === 'clear' ? 0 : countAtYield);
  });
}

test('user observes that a marker evicted during a yield is recreated from the refreshed shape list', async () => {
  // Given the chart candles, interval and marker ownership
  const fixture = createChartDom();
  // When findBearishBollingerChartTarget processes the configured inputs
  const target = findBearishBollingerChartTarget(fixture.dom.window.document, 'BTRUSDT');
  let evict = false;
  let evicted = null;
  const layer = createBollingerMarkerLayer(target, {
    yieldToBrowser: async () => {
      if (!evict) return;
      evict = false;
      evicted = [...fixture.shapes.keys()].at(-1);
      fixture.evictShape(evicted);
    },
  });
  const signals = batchSignals();
  // Then user observes that a marker evicted during a yield is recreated from the refreshed shape list
  assert.equal(await layer.render(signals, { isCurrent: () => true }), true);
  evict = true;
  assert.equal(await layer.render(signals, { isCurrent: () => true }), true);
  assert.equal(fixture.shapes.has(evicted), false);
  assert.equal(fixture.shapes.size, 64);
  assert.equal(fixture.createdOptions.length, 65);
  assert.equal(fixture.shapes.get('shape-65').point.time, signals.at(-1).time);
  assert.deepEqual(fixture.removed, []);
});

test('user observes that production monitor does not commit a batch interrupted by an interval switch', async () => {
  // Given the chart candles, interval and marker ownership
  const fixture = createChartDom();
  const harness = createMonitorHarness(fixture, {
    detectBollingerSignals: batchSignals,
    createBollingerMarkerLayer: (target, options) => createBollingerMarkerLayer(target, {
      ...options,
      yieldToBrowser: async () => { fixture.setResolution('5'); },
    }),
  });
  fixture.chart.exportData = async () => exportResult([
    { 0: 3600, 1: 10, 2: 12, 3: 9, 4: 11 },
    { 0: 3660, 1: 10, 2: 12, 3: 9, 4: 11 },
  ]);
  // When harness.tick processes the configured inputs
  await harness.tick();
  // Then user observes that production monitor does not commit a batch interrupted by an interval switch
  assert.ok(fixture.shapes.size > 0 && fixture.shapes.size <= 32);
  assert.equal(harness.monitor.context.lastProcessedClosedBarsWindowKey, null);
  assert.equal(harness.monitor.context.lastProcessedClosedBarsContentSnapshot, null);
  assert.equal(harness.monitor.context.lastProcessedSignals, null);
  assert.deepEqual(harness.errors, []);
  harness.monitor.stop();
  assert.equal(fixture.shapes.size, 0);
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
  assert.equal(shapes.size, MAX_BOLLINGER_MARKERS_PER_DIRECTION + 1);
});

test('user removes a shifted marker and fails the alignment contract', async () => {
  // Given the chart candles, interval and marker ownership
  const { dom, shapes, removed } = createChartDom({ shiftSeconds: -60 });
  // When findBearishBollingerChartTarget processes the configured inputs
  const target = findBearishBollingerChartTarget(dom.window.document, 'BTRUSDT');
  const layer = createBearishBollingerMarkerLayer(target);

  const observedResult = layer.render(
      [{ id: 'setup:warning', type: 'warning', time: 120, markerPrice: 10 }],
      { isCurrent: () => true },
    );
  // Then user removes a shifted marker and fails the alignment contract
  await assert.rejects(
    observedResult,
    /time alignment failed: expected 120, received 60/,
  );
  assert.equal(shapes.size, 0);
  assert.deepEqual(removed, ['shape-1']);
});

test('user observes that clear removes a marker whose asynchronous creation finishes late', async () => {
  // Given the chart candles, interval and marker ownership
  const { dom, shapes, removed, releaseCreate } = createChartDom({ deferredCreate: true });
  // When findBearishBollingerChartTarget processes the configured inputs
  const target = findBearishBollingerChartTarget(dom.window.document, 'BTRUSDT');
  const layer = createBearishBollingerMarkerLayer(target);
  const renderPromise = layer.render([
    { id: 'setup:warning', type: 'warning', time: 120, markerPrice: 10 },
  ], { isCurrent: () => true });

  await Promise.resolve();
  layer.clear();
  releaseCreate();

  // Then user observes that clear removes a marker whose asynchronous creation finishes late
  assert.equal(await renderPromise, false);
  assert.equal(shapes.size, 0);
  assert.deepEqual(removed, ['shape-1']);
});

test('user removes a marker whose target changes while asynchronous creation is pending', async () => {
  // Given the chart candles, interval and marker ownership
  const { dom, shapes, removed, releaseCreate } = createChartDom({ deferredCreate: true });
  // When findBearishBollingerChartTarget processes the configured inputs
  const target = findBearishBollingerChartTarget(dom.window.document, 'BTRUSDT');
  const layer = createBearishBollingerMarkerLayer(target);
  let current = true;
  const renderPromise = layer.render([
    { id: 'setup:warning', type: 'warning', time: 120, markerPrice: 10 },
  ], { isCurrent: () => current });

  await Promise.resolve();
  current = false;
  releaseCreate();

  // Then user removes a marker whose target changes while asynchronous creation is pending
  assert.equal(await renderPromise, false);
  assert.equal(shapes.size, 0);
  assert.deepEqual(removed, ['shape-1']);
});
