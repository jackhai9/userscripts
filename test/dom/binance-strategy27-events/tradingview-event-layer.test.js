import assert from 'node:assert/strict';
import test from 'node:test';

import { loadFixtureDom } from '../../helpers/dom.js';
import {
  createTradingViewEventLayer,
  findStrategy27ChartTarget,
} from '../../../src/binance-strategy27-events/dom/tradingview-event-layer.js';

function createChartDom({
  resolution = '1S',
  symbol = 'BTRUSDT@PRICETYPE=LAST',
  shiftSeconds = 0,
  deferredCreate = false,
  candle = [10, 1.25, 1.3, 1.2, 1.25],
} = {}) {
  const dom = loadFixtureDom('<div class="chart-widget-root"><div><iframe></iframe></div></div>');
  const shapes = new Map();
  const removed = [];
  const dataUpdatedListeners = [];
  let currentCandle = candle;
  let nextId = 1;
  let releaseCreate = null;
  const chart = {
    resolution: () => resolution,
    symbol: () => symbol,
    async createShape(point, properties) {
      if (deferredCreate) await new Promise((resolve) => { releaseCreate = resolve; });
      const id = `shape-${nextId++}`;
      let points = [{ ...point, time: point.time + shiftSeconds }];
      let currentProperties = { ...properties, text: properties.text ?? '' };
      shapes.set(id, {
        id,
        getPoints: () => points,
        setPoints: (value) => { points = value; },
        getProperties: () => currentProperties,
        setProperties: (value) => { currentProperties = { ...currentProperties, ...value }; },
      });
      return id;
    },
    getShapeById: (id) => shapes.get(id),
    removeEntity(id) { removed.push(id); shapes.delete(id); },
    getSeries: () => ({
      data: () => ({
        valueAt: (index) => (index === 5 ? currentCandle : null),
      }),
    }),
    _chartWidget: {
      model: () => ({
        model: () => ({
          timeScale: () => ({
            timePointToIndex: (time) => (time === 10 ? 5 : null),
          }),
          mainSeries: () => ({
            dataUpdated: () => ({
              subscribe: (owner, listener) => dataUpdatedListeners.push({ owner, listener }),
              unsubscribe: (owner, listener) => {
                const index = dataUpdatedListeners.findIndex(
                  (candidate) => candidate.owner === owner && candidate.listener === listener,
                );
                if (index >= 0) dataUpdatedListeners.splice(index, 1);
              },
            }),
            firstValue: () => 1,
            priceScale: () => ({
              priceToCoordinate: (price) => 2_000 - (price * 1_000),
              coordinateToPrice: (coordinate) => (2_000 - coordinate) / 1_000,
            }),
          }),
        }),
      }),
    },
  };
  dom.window.document.querySelector('iframe').contentWindow.tradingViewApi = {
    activeChart: () => chart,
  };
  return {
    dom,
    chart,
    shapes,
    removed,
    releaseCreate: () => releaseCreate(),
    setCandle: (value) => { currentCandle = value; },
    fireDataUpdated: () => {
      for (const { listener } of [...dataUpdatedListeners]) listener();
    },
    get dataUpdatedListenerCount() {
      return dataUpdatedListeners.length;
    },
  };
}

function annotation(overrides = {}) {
  return {
    markerShape: 'arrow_up',
    markerColor: '#0ECB81',
    markerTime: 10,
    markerPrice: 1.25,
    ...overrides,
  };
}

test('requires an exact matching one-second TradingView chart', () => {
  const { dom } = createChartDom();
  const target = findStrategy27ChartTarget(dom.window.document, 'BTRUSDT');
  assert.equal(target.routeSymbol, 'BTRUSDT');
  assert.equal(target.resolution, '1S');

  const minute = createChartDom({ resolution: '1' });
  assert.throws(
    () => findStrategy27ChartTarget(minute.dom.window.document, 'BTRUSDT'),
    /one-second chart/,
  );
  const wrongSymbol = createChartDom({ symbol: 'BTCUSDT@PRICETYPE=LAST' });
  assert.throws(
    () => findStrategy27ChartTarget(wrongSymbol.dom.window.document, 'BTRUSDT'),
    /chart symbol/,
  );
});

test('one event owns one marker across its complete lifecycle', async () => {
  const { dom, shapes, removed } = createChartDom();
  const target = findStrategy27ChartTarget(dom.window.document, 'BTRUSDT');
  const layer = createTradingViewEventLayer(target, { maxEvents: 2, maxAgeMs: 60_000 });

  await layer.renderOpened('event-a', annotation(), 10_000);
  assert.equal(shapes.size, 1);
  await layer.renderUpdated('event-a', annotation(), 11_000);
  assert.equal(shapes.size, 1);
  await layer.renderClosed('event-a', annotation(), 12_000);
  assert.equal(shapes.size, 1);
  const ids = [...shapes.keys()];
  await layer.renderOutcome('event-a', annotation(), 13_000);
  assert.deepEqual([...shapes.keys()], ids);
  assert.equal(shapes.get(ids[0]).getProperties().shape, 'arrow_up');

  layer.remove('event-a');
  assert.equal(shapes.size, 0);
  assert.equal(layer.size, 0);

  await layer.renderOpened('event-b', annotation(), 14_000);

  layer.clear();
  assert.equal(shapes.size, 0);
  assert.equal(removed.length, 2);
});

test('places directional arrows eight pixels outside the matching candle', async () => {
  const { dom, shapes } = createChartDom();
  const target = findStrategy27ChartTarget(dom.window.document, 'BTRUSDT');
  const layer = createTradingViewEventLayer(target, { maxEvents: 3, maxAgeMs: 60_000 });

  await layer.renderOpened('up', annotation({ markerPrice: 9.99 }), 10_000);
  await layer.renderOpened('down', annotation({
    markerShape: 'arrow_down',
    markerColor: '#F6465D',
    markerPrice: 0.01,
  }), 10_001);
  await layer.renderOpened('flag', annotation({
    markerShape: 'flag',
    markerColor: '#F0B90B',
    markerPrice: 1.26,
  }), 10_002);

  const [up, down, flag] = [...shapes.values()];
  assert.equal(up.getPoints()[0].price, 1.192);
  assert.equal(down.getPoints()[0].price, 1.308);
  assert.equal(flag.getPoints()[0].price, 1.26);
});

test('replaces an event marker when its response direction changes', async () => {
  const { dom, shapes, removed } = createChartDom();
  const target = findStrategy27ChartTarget(dom.window.document, 'BTRUSDT');
  const layer = createTradingViewEventLayer(target, { maxEvents: 2, maxAgeMs: 60_000 });

  await layer.renderOpened('event-a', annotation(), 10_000);
  const originalId = [...shapes.keys()][0];
  await layer.renderUpdated('event-a', annotation({
    markerShape: 'arrow_down',
    markerColor: '#F6465D',
  }), 11_000);

  assert.equal(shapes.size, 1);
  assert.deepEqual(removed, [originalId]);
  const replacement = [...shapes.values()][0];
  assert.equal(replacement.getProperties().shape, 'arrow_down');
  assert.equal(replacement.getPoints()[0].price, 1.308);
});

test('waits for the matching candle data update before placing a directional marker', async () => {
  const fixture = createChartDom({ candle: null });
  const target = findStrategy27ChartTarget(fixture.dom.window.document, 'BTRUSDT');
  const layer = createTradingViewEventLayer(target, {
    maxEvents: 2,
    maxAgeMs: 60_000,
    candleWaitMs: 50,
  });

  const renderPromise = layer.renderOpened('event-a', annotation(), 10_000);
  await Promise.resolve();
  assert.equal(fixture.shapes.size, 0);
  assert.equal(fixture.dataUpdatedListenerCount, 1);

  fixture.setCandle([10, 1.25, 1.3, 1.2, 1.25]);
  fixture.fireDataUpdated();

  assert.equal(await renderPromise, true);
  assert.equal(fixture.shapes.size, 1);
  assert.equal(fixture.dataUpdatedListenerCount, 0);
  assert.equal([...fixture.shapes.values()][0].getPoints()[0].price, 1.192);
});

test('waits for the matching candle data update before placing a neutral flag', async () => {
  const fixture = createChartDom({ candle: null });
  const target = findStrategy27ChartTarget(fixture.dom.window.document, 'BTRUSDT');
  const layer = createTradingViewEventLayer(target, {
    maxEvents: 2,
    maxAgeMs: 60_000,
    candleWaitMs: 50,
  });

  const renderPromise = layer.renderOpened('event-a', annotation({
    markerShape: 'flag',
    markerColor: '#F0B90B',
    markerPrice: 1.26,
  }), 10_000);
  await Promise.resolve();
  assert.equal(fixture.shapes.size, 0);
  assert.equal(fixture.dataUpdatedListenerCount, 1);

  fixture.setCandle([10, 1.25, 1.3, 1.2, 1.25]);
  fixture.fireDataUpdated();

  assert.equal(await renderPromise, true);
  assert.equal(fixture.shapes.size, 1);
  assert.equal(fixture.dataUpdatedListenerCount, 0);
  assert.equal([...fixture.shapes.values()][0].getPoints()[0].price, 1.26);
});

test('rejects a directional marker when its matching candle misses the bounded wait', async () => {
  const { dom } = createChartDom({ candle: null });
  const target = findStrategy27ChartTarget(dom.window.document, 'BTRUSDT');
  const layer = createTradingViewEventLayer(target, {
    maxEvents: 2,
    maxAgeMs: 60_000,
    candleWaitMs: 5,
  });

  await assert.rejects(
    layer.renderOpened('event-a', annotation(), 10_000),
    /candle did not arrive within 5 ms for 10/,
  );
});

test('clear cancels a pending candle wait without creating a late marker', async () => {
  const fixture = createChartDom({ candle: null });
  const target = findStrategy27ChartTarget(fixture.dom.window.document, 'BTRUSDT');
  const layer = createTradingViewEventLayer(target, {
    maxEvents: 2,
    maxAgeMs: 60_000,
    candleWaitMs: 50,
  });

  const renderPromise = layer.renderOpened('event-a', annotation(), 10_000);
  await Promise.resolve();
  layer.clear();

  assert.equal(await renderPromise, false);
  assert.equal(fixture.dataUpdatedListenerCount, 0);
  fixture.setCandle([10, 1.25, 1.3, 1.2, 1.25]);
  fixture.fireDataUpdated();
  assert.equal(fixture.shapes.size, 0);
});

test('removes a shifted entity and reports chart alignment failure', async () => {
  const { dom, shapes, removed } = createChartDom({ shiftSeconds: -1 });
  const target = findStrategy27ChartTarget(dom.window.document, 'BTRUSDT');
  const layer = createTradingViewEventLayer(target, { maxEvents: 2, maxAgeMs: 60_000 });

  await assert.rejects(
    layer.renderOpened('event-a', annotation(), 10_000),
    /chart time alignment failed: expected 10, received 9 \(point count 1\)/,
  );
  assert.equal(shapes.size, 0);
  assert.equal(removed.length, 1);
});

test('clear removes a marker whose asynchronous creation finishes late', async () => {
  const {
    dom,
    shapes,
    removed,
    releaseCreate,
  } = createChartDom({ deferredCreate: true });
  const target = findStrategy27ChartTarget(dom.window.document, 'BTRUSDT');
  const layer = createTradingViewEventLayer(target, { maxEvents: 2, maxAgeMs: 60_000 });

  const renderPromise = layer.renderOpened('event-a', annotation(), 10_000);
  await Promise.resolve();
  layer.clear();
  releaseCreate();

  assert.equal(await renderPromise, false);
  assert.equal(layer.size, 0);
  assert.equal(shapes.size, 0);
  assert.equal(removed.length, 1);
});
