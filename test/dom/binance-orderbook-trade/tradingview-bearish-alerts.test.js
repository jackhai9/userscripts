import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import * as alertApi from '../../../src/binance-orderbook-trade/dom/tradingview-bearish-alerts.js';
import { getTradingViewMarkerSaveController } from '../../../src/binance-orderbook-trade/core/chart-marker-save-controller.js';

import { loadFixtureDom } from '../../helpers/dom.js';
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
} from '../../../src/binance-orderbook-trade/dom/tradingview-bearish-alerts.js';
import {
  applyBollingerAlertTaskFailure,
  isTradingViewBarSnapshotInconsistentError,
  TradingViewBarSnapshotInconsistentError,
} from '../../../src/binance-orderbook-trade/core/bearish-bollinger-pattern.js';

const monitorSource = await readFile(new URL('../../../src/binance-orderbook-trade/index.user.js', import.meta.url), 'utf8');

test('native marker creation and clear save bursts preserve foreign drawings without arming stable audits', async () => {
  const fixture = createChartDom();
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
  assert.equal(await layer.render(signals, { isCurrent: () => true }), true);
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

test('an outer save drain waits for native creation, leaves its late result hidden, and preserves cleanup ownership', async () => {
  const fixture = createChartDom({ deferredCreate: true });
  fixture.addForeignShape('user-channel');
  const target = findBearishBollingerChartTarget(fixture.dom.window.document, 'BTRUSDT');
  const layer = createBollingerMarkerLayer(target);
  const rendering = layer.render([
    { id: 'warning', direction: 'bearish', type: 'warning', time: 60, markerPrice: 13 },
  ], { isCurrent: () => true });
  const controller = getTradingViewMarkerSaveController(fixture.tradingViewApi);
  let starts = 0;
  const drain = controller.runAfterIdle(() => { starts += 1; });
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
  const end = monitorSource.indexOf('  function parseJsonSafe(', start);
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
    BEARISH_BOLLINGER_ALERT_POLL_MS: 1000,
    ...dependencyOverrides,
  };
  const factory = new Function(...Object.keys(dependencies), `
    let bearishBollingerAlertTimer = null;
    let bearishBollingerAlertTask = null;
    let bearishBollingerAlertContext = null;
    let bollingerIntervalSession = null;
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

test('maps TradingView time resolutions to exact bar durations', () => {
  assert.equal(tradingViewResolutionToSeconds('1S'), 1);
  assert.equal(tradingViewResolutionToSeconds('1'), 60);
  assert.equal(tradingViewResolutionToSeconds('60'), 3600);
  assert.equal(tradingViewResolutionToSeconds('4H'), 14400);
  assert.equal(tradingViewResolutionToSeconds('1D'), 86400);
  assert.equal(tradingViewResolutionToSeconds('1W'), 604800);
  assert.throws(() => tradingViewResolutionToSeconds('1M'), /unsupported/);
});

test('native null-owner cleanup preserves alert subscriptions and their readiness transitions', () => {
  const fixture = createChartDom();
  let ready = false;
  fixture.chart.dataReady = () => ready;
  const session = alertApi.createBollingerIntervalSession(fixture.chart);
  fixture.dataLoaded.subscribe(null, () => {});
  fixture.intervalChanged.subscribe(null, () => {});
  fixture.dataLoaded.unsubscribeAll(null);
  fixture.intervalChanged.unsubscribeAll(null);
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

test('rejects second bars under a minute target and accepts the replacement minute history', () => {
  const row = (time) => ({ 0: time, 1: 10, 2: 12, 3: 9, 4: 11 });
  assert.throws(() => parseClosedTradingViewBars(exportResult(
    Array.from({ length: 120 }, (_, index) => row(3600 + index)),
  ), { resolutionSeconds: 60, observedAtSeconds: 4000 }),
  isTradingViewBarSnapshotInconsistentError);
  const bars = parseClosedTradingViewBars(exportResult([row(3600), row(3660), row(3780)]), {
    resolutionSeconds: 60, observedAtSeconds: 3840,
  });
  assert.deepEqual(bars.map(bar => bar.time), [3600, 3660, 3780]);
});

test('validates the entire export including off-grid bars that are not closed yet', () => {
  assert.throws(() => parseClosedTradingViewBars(exportResult([
    { 0: 3600, 1: 10, 2: 12, 3: 9, 4: 11 },
    { 0: 3661, 1: 10, 2: 12, 3: 9, 4: 11 },
  ]), { resolutionSeconds: 60, observedAtSeconds: 3662 }),
  isTradingViewBarSnapshotInconsistentError);
});

test('accepts multi-day and Monday weekly bars without Unix-epoch phase assumptions', () => {
  for (const [resolutionSeconds, times] of [
    [3 * 86400, [86400, 4 * 86400, 10 * 86400]],
    [7 * 86400, [4 * 86400, 11 * 86400, 25 * 86400]],
  ]) {
    const bars = parseClosedTradingViewBars(exportResult(times.map(time => (
      { 0: time, 1: 10, 2: 12, 3: 9, 4: 11 }
    ))), { resolutionSeconds, observedAtSeconds: 40 * 86400 });
    assert.deepEqual(bars.map(bar => bar.time), times);
  }
});

test('interval sessions invalidate A-B-A exports and wait for data completion despite nonempty old data', async () => {
  const { chart, setResolution, dataLoaded, intervalChanged } = createChartDom({ resolution: '1S' });
  const session = alertApi.createBollingerIntervalSession(chart);
  let releaseExport;
  chart.exportData = () => new Promise(resolve => { releaseExport = resolve; });
  const target = { chart, resolution: '1S', resolutionSeconds: 1, routeSymbol: 'BTRUSDT' };
  const pending = alertApi.exportClosedTradingViewBars(target, session, 4000000);
  const revision = session.revision;
  setResolution('1');
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

test('reconciles moved points, changed signal prices and altered owned colors without touching foreign drawings', async () => {
  const { dom, shapes, removed, addForeignShape } = createChartDom();
  const layer = createBollingerMarkerLayer(findBearishBollingerChartTarget(dom.window.document, 'BTRUSDT'));
  const signal = { id: 'drift', direction: 'bearish', type: 'warning', time: 120, markerPrice: 10 };
  addForeignShape();
  await layer.render([signal], { isCurrent: () => true });
  shapes.get('shape-1').point.time = 60;
  await layer.render([signal], { isCurrent: () => true });
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

test('native interval visibility hides second markers on minutes even while cleanup is busy', async () => {
  const { dom, shapes, removed, setResolution } = createChartDom({ resolution: '1S' });
  let busy = false;
  const layer = createBollingerMarkerLayer(findBearishBollingerChartTarget(dom.window.document, 'BTRUSDT'), {
    canMutate: () => !busy,
  });
  await layer.render([{ id: 'second', direction: 'bearish', type: 'warning', time: 3601, markerPrice: 10 }], {
    isCurrent: () => true,
  });
  const visibility = shapes.get('shape-1').properties.overrides.intervalsVisibilities;
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

test('retains late async marker ownership until a busy chart permits cleanup', async () => {
  const { dom, shapes, removed, releaseCreate, setResolution, createdOptions, propertyUpdates } = createChartDom({ resolution: '1S', deferredCreate: true });
  let busy = false;
  let current = true;
  const layer = createBollingerMarkerLayer(findBearishBollingerChartTarget(dom.window.document, 'BTRUSDT'), {
    canMutate: () => !busy,
  });
  const pending = layer.render([{ id: 'late', direction: 'bearish', type: 'warning', time: 3601, markerPrice: 10 }], {
    isCurrent: () => current,
  });
  await Promise.resolve();
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

test('publishes a current hidden creation only after restoring its exact interval mask', async () => {
  const fixture = createChartDom({ resolution: '1S', deferredCreate: true });
  const layer = createBollingerMarkerLayer(findBearishBollingerChartTarget(fixture.dom.window.document, 'BTRUSDT'));
  const pending = layer.render([{ id: 'publish', direction: 'bullish', type: 'confirmed', time: 3601, markerPrice: 10 }], {
    isCurrent: () => true,
  });
  fixture.setResolution('1');
  fixture.releaseCreate();
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

test('production monitor retires old interval before readiness and resumes with minute data', async () => {
  const fixture = createChartDom({ resolution: '1S' });
  const harness = createMonitorHarness(fixture);
  fixture.chart.exportData = async () => exportResult([
    { 0: 3601, 1: 10, 2: 12, 3: 9, 4: 11 },
    { 0: 3602, 1: 10, 2: 12, 3: 9, 4: 11 },
  ]);
  await harness.tick();
  const session = harness.monitor.session.session;
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

test('production monitor stop disposes subscriptions and invalidates busy pending export', async () => {
  const fixture = createChartDom({ resolution: '1S' });
  const harness = createMonitorHarness(fixture);
  let releaseExport;
  fixture.chart.exportData = () => new Promise(resolve => { releaseExport = resolve; });
  await harness.monitor.tick();
  const oldTask = harness.monitor.task;
  const oldSession = harness.monitor.session.session;
  harness.setBusy(true);
  harness.setHidden(true);
  harness.monitor.stop();
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

test('production monitor retains a retired layer until late creation and busy cleanup finish', async () => {
  const fixture = createChartDom({ resolution: '1S', deferredCreate: true });
  const harness = createMonitorHarness(fixture);
  fixture.chart.exportData = async () => exportResult([{ 0: 3601, 1: 10, 2: 12, 3: 9, 4: 11 }]);
  await harness.monitor.tick();
  await Promise.resolve();
  const oldTask = harness.monitor.task;
  harness.setBusy(true);
  fixture.setResolution('1');
  await harness.monitor.tick();
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

test('production monitor detects a round-trip interval switch between polls', async () => {
  const fixture = createChartDom({ resolution: '1S' });
  const harness = createMonitorHarness(fixture);
  fixture.chart.exportData = async () => exportResult([{ 0: 3601, 1: 10, 2: 12, 3: 9, 4: 11 }]);
  await harness.tick();
  const originalContext = harness.monitor.context;
  fixture.setResolution('1');
  fixture.setResolution('1S');
  await harness.tick();
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

test('production monitor disposes old chart subscriptions even when removal is busy', async () => {
  const fixture = createChartDom({ resolution: '1S' });
  const harness = createMonitorHarness(fixture);
  fixture.chart.exportData = async () => exportResult([{ 0: 3601, 1: 10, 2: 12, 3: 9, 4: 11 }]);
  await harness.tick();
  const replacement = createChartDom({ resolution: '1S' });
  replacement.chart.exportData = fixture.chart.exportData;
  harness.setBusy(true);
  fixture.setActiveChart(replacement.chart);
  await harness.tick();
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

test('uses native visibility buckets for Binance seconds, minutes, hours, days and weeks', () => {
  for (const [resolution, unit, count] of [
    ['1S', 'seconds', 1], ['90S', 'minutes', 1], ['15', 'minutes', 15], ['60', 'hours', 1],
    ['4H', 'hours', 4], ['1D', 'days', 1], ['1W', 'weeks', 1],
  ]) {
    const visibility = alertApi.bollingerIntervalVisibility(resolution);
    assert.equal(visibility[unit], true);
    assert.equal(visibility[`${unit}From`], count);
    assert.equal(visibility[`${unit}To`], count);
    assert.deepEqual(Object.entries(visibility).filter(([, value]) => value === true).map(([key]) => key), [unit]);
  }
});

test('rejects weekly bars off Monday while preserving legitimate multiweek gaps', () => {
  const row = time => ({ 0: time, 1: 10, 2: 12, 3: 9, 4: 11 });
  assert.throws(() => parseClosedTradingViewBars(exportResult([row(0), row(604800)]), {
    resolution: '1W', resolutionSeconds: 604800, observedAtSeconds: 2000000,
  }), isTradingViewBarSnapshotInconsistentError);
  assert.deepEqual(parseClosedTradingViewBars(exportResult([row(345600), row(1555200)]), {
    resolution: '1W', resolutionSeconds: 604800, observedAtSeconds: 3000000,
  }).map(bar => bar.time), [345600, 1555200]);
});

test('waits for the model before reading a chart target and invalidates a torn-down model', () => {
  const fixture = createChartDom();
  fixture.setModelReady(false);
  assert.equal(findBearishBollingerChartTarget(fixture.dom.window.document, 'BTRUSDT'), null);
  fixture.setModelReady(true);
  const target = findBearishBollingerChartTarget(fixture.dom.window.document, 'BTRUSDT');
  assert.equal(target.resolution, '1');
  fixture.setModelReady(false);
  assert.equal(isBearishBollingerChartTargetCurrent(fixture.dom.window.document, target), false);
});

test('production monitor waits through first-refresh model creation without errors and then renders', async () => {
  const fixture = createChartDom();
  const harness = createMonitorHarness(fixture);
  fixture.chart.exportData = async () => exportResult([{ 0: 60, 1: 10, 2: 12, 3: 9, 4: 11 }]);
  fixture.setModelReady(false);
  await harness.tick();
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

test('on-demand diagnostics distinguish active, awaiting-data and torn-down states without drawing calls', async () => {
  const fixture = createChartDom();
  const harness = createMonitorHarness(fixture);
  fixture.chart.exportData = async () => exportResult([{ 0: 60, 1: 10, 2: 12, 3: 9, 4: 11 }]);
  assert.equal(harness.monitor.diagnostics.contextPresent, false);
  assert.equal(harness.monitor.diagnostics.nativeModelReady, null);
  await harness.tick();
  const originalGetAllShapes = fixture.chart.getAllShapes;
  fixture.chart.getAllShapes = () => { throw new Error('Diagnostics must not audit drawings'); };
  fixture.chart.exportData = () => { throw new Error('Diagnostics must not export data'); };
  assert.deepEqual(harness.monitor.diagnostics, {
    timerRunning: false, taskPending: false, contextPresent: true, failed: false,
    cleanupPending: false, cachedSignalCount: 1, layerSize: 1, retiredCount: 0,
    markerSaveStats: { busy: true, mutations: 0, draining: 0, saveRequests: 0,
      serializations: 0, callbackCount: 0, failureCount: 0, pendingCallbacks: 0 },
    sessionPresent: true, sessionRevision: 0, contextIntervalRevision: 0,
    sessionMatchesContext: true, sessionCurrent: true,
    nativeModelReady: true, nativeDataReady: true, mutationBlocked: false,
    ownerFlags: { ladderTask: false, continuousLadderTask: false, singleOrderTask: false,
      cancelCurrentSymbolOpenOrdersTask: false, chartOrdersRecoveryTask: false,
      continuousChartSaveController: false },
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

test('requires the current symbol and complete bearish-alert chart API', () => {
  const {
    dom,
    setActiveChart,
    setResolution,
    setSymbol,
  } = createChartDom({ resolution: '60' });
  const target = findBearishBollingerChartTarget(dom.window.document, 'BTRUSDT');
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

test('exports only bars whose resolution-derived end time has passed', () => {
  const exported = exportResult([
    { 0: 60, 1: 10, 2: 12, 3: 9, 4: 11 },
    { 0: 120, 1: 11, 2: 13, 3: 10, 4: 12 },
    { 0: 180, 1: 12, 2: 20, 3: 5, 4: 19 },
  ]);

  assert.deepEqual(
    parseClosedTradingViewBars(exported, {
      resolutionSeconds: 60,
      observedAtSeconds: 180,
    }),
    [
      { time: 60, open: 10, high: 12, low: 9, close: 11 },
      { time: 120, open: 11, high: 13, low: 10, close: 12 },
    ],
  );
});

test('classifies a non-monotonic export as a recoverable TradingView snapshot race', () => {
  assert.throws(
    () => parseClosedTradingViewBars(exportResult([
      { 0: 120, 1: 11, 2: 13, 3: 10, 4: 12 },
      { 0: 60, 1: 10, 2: 12, 3: 9, 4: 11 },
    ]), {
      resolutionSeconds: 60,
      observedAtSeconds: 180,
    }),
    (error) => isTradingViewBarSnapshotInconsistentError(error),
  );
});

test('keeps every closed bar already loaded by TradingView', () => {
  const rows = Array.from({ length: 505 }, (_, index) => ({
    0: (index + 1) * 60,
    1: 10,
    2: 12,
    3: 9,
    4: 11,
  }));
  const bars = parseClosedTradingViewBars(exportResult(rows), {
    resolutionSeconds: 60,
    observedAtSeconds: 506 * 60,
  });

  assert.equal(bars.length, 505);
  assert.equal(bars[0].time, 60);
  assert.equal(bars.at(-1).time, 505 * 60);
});

test('changes the closed-bar window key when older history loads without a new latest bar', () => {
  const recent = [
    { time: 120, open: 11, high: 13, low: 10, close: 12 },
    { time: 180, open: 12, high: 14, low: 11, close: 13 },
  ];
  const expanded = [
    { time: 60, open: 10, high: 12, low: 9, close: 11 },
    ...recent,
  ];

  assert.notEqual(buildClosedBarsWindowKey(recent), buildClosedBarsWindowKey(expanded));
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

test('changes the content key when OHLC changes inside the same closed-bar window', () => {
  const bars = [
    { time: 120, open: 11, high: 13, low: 10, close: 12 },
    { time: 180, open: 12, high: 14, low: 11, close: 13 },
  ];
  const corrected = [
    bars[0],
    { ...bars[1], high: 15 },
  ];

  assert.equal(buildClosedBarsWindowKey(bars), buildClosedBarsWindowKey(corrected));
  assert.notEqual(buildClosedBarsContentKey(bars), buildClosedBarsContentKey(corrected));
  const snapshot = buildClosedBarsContentSnapshot(bars);
  assert.equal(matchesClosedBarsContentSnapshot(bars, snapshot), true);
  assert.equal(matchesClosedBarsContentSnapshot(corrected, snapshot), false);
});

test('renders warning, bearish confirmation, and bullish reversal markers', async () => {
  const { dom, shapes, removed } = createChartDom();
  const target = findBearishBollingerChartTarget(dom.window.document, 'BTRUSDT');
  const layer = createBearishBollingerMarkerLayer(target);
  const isCurrent = () => true;

  assert.equal(await layer.render([
    { id: 'setup:warning', type: 'warning', time: 120, markerPrice: 10 },
    { id: 'setup:confirmed', type: 'confirmed', time: 180, markerPrice: 9 },
    { id: 'setup:reversal', type: 'reversal', time: 240, markerPrice: 8 },
  ], { isCurrent }), true);
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

test('renders mirrored bullish marker shapes and colors in the shared layer', async () => {
  const { dom, shapes } = createChartDom();
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
  assert.equal(records[0].properties.shape, 'icon');
  assert.equal(records[0].properties.overrides.color, '#0ECB81');
  assert.equal(records[1].properties.shape, 'arrow_up');
  assert.equal(records[1].properties.overrides.arrowColor, '#0ECB81');
  assert.equal(records[2].properties.shape, 'arrow_down');
  assert.equal(records[2].properties.overrides.arrowColor, '#F6465D');
});

test('keeps opposite-direction signals on the same candle as distinct markers', async () => {
  const { dom, shapes } = createChartDom();
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

  assert.equal(shapes.size, 2);
  const records = [...shapes.values()];
  assert.deepEqual(
    records.map((record) => [record.point.time, record.point.price, record.properties.shape]),
    [[240, 8, 'arrow_up'], [240, 12, 'arrow_down']],
  );
});

test('requires explicit direction when using the shared marker layer', async () => {
  const { dom, shapes } = createChartDom();
  const target = findBearishBollingerChartTarget(dom.window.document, 'BTRUSDT');
  const layer = createBollingerMarkerLayer(target);

  await assert.rejects(
    layer.render([{
      id: 'missing-direction',
      type: 'warning',
      time: 120,
      markerPrice: 10,
    }], { isCurrent: () => true }),
    /direction is invalid/,
  );
  assert.equal(shapes.size, 0);
});

test('keeps existing markers through a recoverable snapshot error and retries next tick', async () => {
  const { dom, shapes } = createChartDom();
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

test('keeps the task context retryable across malformed-to-valid snapshots', async () => {
  const { dom, shapes } = createChartDom();
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

test('recreates a marker that TradingView evicted outside the alert layer', async () => {
  const {
    dom,
    shapes,
    removed,
    evictShape,
  } = createChartDom();
  const target = findBearishBollingerChartTarget(dom.window.document, 'BTRUSDT');
  const layer = createBearishBollingerMarkerLayer(target);
  const signals = [{
    id: 'setup:warning',
    type: 'warning',
    time: 120,
    markerPrice: 10,
  }];

  assert.equal(await layer.render(signals, { isCurrent: () => true }), true);
  assert.equal(shapes.has('shape-1'), true);

  evictShape('shape-1');

  assert.equal(await layer.render(signals, { isCurrent: () => true }), true);
  assert.equal(shapes.has('shape-1'), false);
  assert.equal(shapes.has('shape-2'), true);
  assert.deepEqual(removed, []);
});

test('same closed-bar window reuses detection and still restores an evicted marker', async () => {
  const {
    dom,
    shapes,
    removed,
    evictShape,
  } = createChartDom();
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
  assert.equal(shapes.has('shape-1'), true);
  evictShape('shape-1');

  await runMonitorTick();

  assert.equal(detectorCalls, 1);
  assert.equal(rendererCalls, 2);
  assert.equal(shapes.has('shape-1'), false);
  assert.equal(shapes.has('shape-2'), true);
  assert.deepEqual(removed, []);
});

test('reconciliation, signal removal, and clear preserve foreign drawings', async () => {
  const {
    dom,
    shapes,
    removed,
    evictShape,
    addForeignShape,
  } = createChartDom();
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

test('clear forgets an externally evicted marker without removing a missing entity', async () => {
  const {
    dom,
    shapes,
    removed,
    evictShape,
  } = createChartDom();
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

  assert.equal(layer.size, 0);
  assert.equal(shapes.size, 0);
  assert.deepEqual(removed, []);
});

test('excludes an unclosed reversal breakout bar from detector input', () => {
  const exported = exportResult([
    { 0: 60, 1: 10, 2: 12, 3: 9, 4: 11 },
    { 0: 120, 1: 11, 2: 14, 3: 10, 4: 13 },
  ]);

  const bars = parseClosedTradingViewBars(exported, {
    resolutionSeconds: 60,
    observedAtSeconds: 150,
  });
  assert.deepEqual(bars, [{ time: 60, open: 10, high: 12, low: 9, close: 11 }]);
});

test('rejects an abnormal marker count before mutating the existing layer', async () => {
  const { dom, shapes, removed } = createChartDom();
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

  await assert.rejects(
    layer.render(excessive, { isCurrent }),
    /marker limit exceeded/,
  );
  assert.equal(shapes.size, 1);
  assert.deepEqual(removed, []);
});

test('applies the marker limit to the combined bullish and bearish layer', async () => {
  const { dom, chart, shapes, removed, createdOptions, propertyUpdates } = createChartDom();
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

  assert.equal(await layer.render(signals, { isCurrent: () => true }), true);
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

test('a real render batch yields a browser task before finishing', async () => {
  const fixture = createChartDom();
  const target = findBearishBollingerChartTarget(fixture.dom.window.document, 'BTRUSDT');
  const layer = createBollingerMarkerLayer(target);
  const task = layer.render(batchSignals(), { isCurrent: () => true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(fixture.shapes.size > 0 && fixture.shapes.size <= 32);
  assert.equal(await task, true);
  assert.equal(fixture.shapes.size, 64);
});

for (const reason of ['stale', 'busy', 'clear']) {
  test(`a ${reason} transition during a render yield stops the old batch`, async () => {
    const fixture = createChartDom();
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
    assert.ok(countAtYield > 0 && countAtYield <= 32);
    assert.equal(fixture.createdOptions.length, countAtYield);
    assert.equal(fixture.propertyUpdates.length, countAtYield);
    assert.equal(result.rendered, false);
    assert.equal(fixture.shapes.size, reason === 'clear' ? 0 : countAtYield);
  });
}

test('a marker evicted during a yield is recreated from the refreshed shape list', async () => {
  const fixture = createChartDom();
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
  assert.equal(await layer.render(signals, { isCurrent: () => true }), true);
  evict = true;
  assert.equal(await layer.render(signals, { isCurrent: () => true }), true);
  assert.equal(fixture.shapes.has(evicted), false);
  assert.equal(fixture.shapes.size, 64);
  assert.equal(fixture.createdOptions.length, 65);
  assert.equal(fixture.shapes.get('shape-65').point.time, signals.at(-1).time);
  assert.deepEqual(fixture.removed, []);
});

test('production monitor does not commit a batch interrupted by an interval switch', async () => {
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
  await harness.tick();
  assert.ok(fixture.shapes.size > 0 && fixture.shapes.size <= 32);
  assert.equal(harness.monitor.context.lastProcessedClosedBarsWindowKey, null);
  assert.equal(harness.monitor.context.lastProcessedClosedBarsContentSnapshot, null);
  assert.equal(harness.monitor.context.lastProcessedSignals, null);
  assert.deepEqual(harness.errors, []);
  harness.monitor.stop();
  assert.equal(fixture.shapes.size, 0);
});

test('preserves the full per-direction capacity when both directions are present', async () => {
  const { dom, shapes } = createChartDom();
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

  assert.equal(shapes.size, MAX_BOLLINGER_MARKERS_PER_DIRECTION + 1);
});

test('removes a shifted marker and fails the alignment contract', async () => {
  const { dom, shapes, removed } = createChartDom({ shiftSeconds: -60 });
  const target = findBearishBollingerChartTarget(dom.window.document, 'BTRUSDT');
  const layer = createBearishBollingerMarkerLayer(target);

  await assert.rejects(
    layer.render(
      [{ id: 'setup:warning', type: 'warning', time: 120, markerPrice: 10 }],
      { isCurrent: () => true },
    ),
    /time alignment failed/,
  );
  assert.equal(shapes.size, 0);
  assert.deepEqual(removed, ['shape-1']);
});

test('clear removes a marker whose asynchronous creation finishes late', async () => {
  const { dom, shapes, removed, releaseCreate } = createChartDom({ deferredCreate: true });
  const target = findBearishBollingerChartTarget(dom.window.document, 'BTRUSDT');
  const layer = createBearishBollingerMarkerLayer(target);
  const renderPromise = layer.render([
    { id: 'setup:warning', type: 'warning', time: 120, markerPrice: 10 },
  ], { isCurrent: () => true });

  await Promise.resolve();
  layer.clear();
  releaseCreate();

  assert.equal(await renderPromise, false);
  assert.equal(shapes.size, 0);
  assert.deepEqual(removed, ['shape-1']);
});

test('removes a marker whose target changes while asynchronous creation is pending', async () => {
  const { dom, shapes, removed, releaseCreate } = createChartDom({ deferredCreate: true });
  const target = findBearishBollingerChartTarget(dom.window.document, 'BTRUSDT');
  const layer = createBearishBollingerMarkerLayer(target);
  let current = true;
  const renderPromise = layer.render([
    { id: 'setup:warning', type: 'warning', time: 120, markerPrice: 10 },
  ], { isCurrent: () => current });

  await Promise.resolve();
  current = false;
  releaseCreate();

  assert.equal(await renderPromise, false);
  assert.equal(shapes.size, 0);
  assert.deepEqual(removed, ['shape-1']);
});
