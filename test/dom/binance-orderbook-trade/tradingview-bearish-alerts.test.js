import assert from 'node:assert/strict';
import test from 'node:test';

import { loadFixtureDom } from '../../helpers/dom.js';
import {
  createBearishBollingerMarkerLayer,
  findBearishBollingerChartTarget,
  isBearishBollingerChartTargetCurrent,
  parseClosedTradingViewBars,
  tradingViewResolutionToSeconds,
} from '../../../src/binance-orderbook-trade/dom/tradingview-bearish-alerts.js';

function createChartDom({
  resolution = '1',
  symbol = 'BTRUSDT@PRICETYPE=LAST',
  shiftSeconds = 0,
  deferredCreate = false,
} = {}) {
  const dom = loadFixtureDom('<div class="chart-widget-root"><iframe></iframe></div>');
  const shapes = new Map();
  const removed = [];
  let nextId = 1;
  let releaseCreate = null;
  let currentResolution = resolution;
  let currentSymbol = symbol;
  const chart = {
    resolution: () => currentResolution,
    symbol: () => currentSymbol,
    dataReady: () => true,
    exportData: async () => ({ schema: [], data: [] }),
    async createShape(point, properties) {
      if (deferredCreate) await new Promise((resolve) => { releaseCreate = resolve; });
      const id = `shape-${nextId++}`;
      shapes.set(id, {
        point: { ...point, time: point.time + shiftSeconds },
        properties,
        getPoints() { return [this.point]; },
      });
      return id;
    },
    getShapeById: (id) => shapes.get(id),
    removeEntity(id) {
      removed.push(id);
      shapes.delete(id);
    },
  };
  let activeChart = chart;
  const tradingViewApi = {
    activeChart: () => activeChart,
  };
  dom.window.document.querySelector('iframe').contentWindow.tradingViewApi = tradingViewApi;
  return {
    dom,
    chart,
    shapes,
    removed,
    releaseCreate: () => releaseCreate(),
    setActiveChart: (value) => { activeChart = value; },
    setResolution: (value) => { currentResolution = value; },
    setSymbol: (value) => { currentSymbol = value; },
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

test('keeps exactly the latest 500 closed bars for historical detection', () => {
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

  assert.equal(bars.length, 500);
  assert.equal(bars[0].time, 6 * 60);
  assert.equal(bars.at(-1).time, 505 * 60);
});

test('renders a yellow icon and red downward arrow with exact time alignment', async () => {
  const { dom, shapes, removed } = createChartDom();
  const target = findBearishBollingerChartTarget(dom.window.document, 'BTRUSDT');
  const layer = createBearishBollingerMarkerLayer(target);
  const isCurrent = () => true;

  assert.equal(await layer.render([
    { id: 'setup:warning', type: 'warning', time: 120, markerPrice: 10 },
    { id: 'setup:confirmed', type: 'confirmed', time: 180, markerPrice: 9 },
  ], { isCurrent }), true);
  assert.equal(shapes.size, 2);
  const records = [...shapes.values()];
  assert.equal(records[0].properties.shape, 'icon');
  assert.equal(records[0].properties.icon, 0xf111);
  assert.equal(records[0].properties.overrides.color, '#F0B90B');
  assert.equal(records[1].properties.shape, 'arrow_down');
  assert.equal(records[1].properties.overrides.arrowColor, '#F6465D');

  await layer.render(
    [{ id: 'setup:confirmed', type: 'confirmed', time: 180, markerPrice: 9 }],
    { isCurrent },
  );
  assert.equal(shapes.size, 1);
  assert.deepEqual(removed, ['shape-1']);
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
