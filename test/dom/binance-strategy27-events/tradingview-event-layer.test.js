import assert from 'node:assert/strict';
import test from 'node:test';

import { loadFixtureDom } from '../../helpers/dom.js';
import { captureStrategyError, createStrategyShapeBoundary } from '../../helpers/strategy-migration-boundaries.js';
import {
  createAlignedShape,
  createTradingViewEventLayer,
  createTradingViewMarkerPlacement,
  findStrategy27ChartRoot,
  findStrategy27ChartTarget as resolveStrategy27ChartTarget,
  readLiveShapeIds,
} from '../../../src/binance-strategy27-events/dom/tradingview-event-layer.js';

function findStrategy27ChartTarget(document, symbol) {
  return resolveStrategy27ChartTarget(findStrategy27ChartRoot(document), symbol);
}

function createChartDom({
  resolution = '1S',
  symbol = 'BTRUSDT@PRICETYPE=LAST',
  shiftSeconds = 0,
  deferredCreate = false,
  candle = [10, 1.25, 1.3, 1.2, 1.25],
  previousCandle = null,
  priceToCoordinate = price => 2_000 - (price * 1_000),
  coordinateToPrice = coordinate => (2_000 - coordinate) / 1_000,
} = {}) {
  const dom = loadFixtureDom('<div class="chart-widget-root"><div><iframe></iframe></div></div>');
  const shapes = new Map();
  const removed = [];
  const dataUpdatedListeners = [];
  let currentCandle = candle;
  let currentResolution = resolution;
  let currentSymbol = symbol;
  let nextId = 1;
  let releaseCreate = null;
  const chart = {
    resolution: () => currentResolution,
    symbol: () => currentSymbol,
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
    getAllShapes: () => [...shapes.keys()].map((id) => ({ id })),
    removeEntity(id) { removed.push(id); shapes.delete(id); },
    getSeries: () => ({
      data: () => ({
        valueAt: (index) => {
          if (index === 5) return currentCandle;
          if (index === 4) return previousCandle;
          return null;
        },
      }),
    }),
    _chartWidget: {
      model: () => ({
        model: () => ({
          timeScale: () => ({
            timePointToIndex: (time, matchMode) => {
              if (time !== 10) return null;
              if (matchMode === 1 && previousCandle) return 4;
              return 5;
            },
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
              priceToCoordinate,
              coordinateToPrice,
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
    setResolution: (value) => { currentResolution = value; },
    setSymbol: (value) => { currentSymbol = value; },
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

test('user requires an exact matching one-second TradingView chart', () => {
  // Given a native chart and ordinary event annotations
  const { dom } = createChartDom();
  // When findStrategy27ChartTarget processes the configured inputs
  const target = findStrategy27ChartTarget(dom.window.document, 'BTRUSDT');
  // Then user requires an exact matching one-second TradingView chart
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

test('user observes that one event owns one marker across its complete lifecycle', async () => {
  // Given a native chart and ordinary event annotations
  const { dom, shapes, removed } = createChartDom();
  // When findStrategy27ChartTarget processes the configured inputs
  const target = findStrategy27ChartTarget(dom.window.document, 'BTRUSDT');
  const layer = createTradingViewEventLayer(target, { maxEvents: 2, maxAgeMs: 60_000 });

  await layer.renderOpened('event-a', annotation(), 10_000);
  // Then user observes that one event owns one marker across its complete lifecycle
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

test('user sees red and green directional arrows eight pixels outside the matching candle', async () => {
  // Given a native chart and ordinary event annotations
  const { dom, shapes } = createChartDom();
  // When findStrategy27ChartTarget processes the configured inputs
  const target = findStrategy27ChartTarget(dom.window.document, 'BTRUSDT');
  const layer = createTradingViewEventLayer(target, { maxEvents: 3, maxAgeMs: 60_000 });

  await layer.renderOpened('up', annotation({ markerPrice: 9.99 }), 10_000);
  await layer.renderOpened('down', annotation({
    markerShape: 'arrow_down',
    markerColor: '#F6465D',
    markerPrice: 0.01,
  }), 10_001);
  const [up, down] = [...shapes.values()];
  // Then user sees red and green directional arrows eight pixels outside the matching candle
  assert.equal(up.getPoints()[0].price, 1.192);
  assert.equal(down.getPoints()[0].price, 1.308);
});

test('user keeps the first event marker immutable when later updates change direction', async () => {
  // Given a native chart and ordinary event annotations
  const { dom, shapes, removed } = createChartDom();
  // When findStrategy27ChartTarget processes the configured inputs
  const target = findStrategy27ChartTarget(dom.window.document, 'BTRUSDT');
  const layer = createTradingViewEventLayer(target, { maxEvents: 2, maxAgeMs: 60_000 });

  await layer.renderOpened('event-a', annotation(), 10_000);
  const originalId = [...shapes.keys()][0];
  await layer.renderUpdated('event-a', annotation({
    markerShape: 'arrow_down',
    markerColor: '#F6465D',
  }), 11_000);

  // Then user keeps the first event marker immutable when later updates change direction
  assert.equal(shapes.size, 1);
  assert.deepEqual(removed, []);
  assert.deepEqual([...shapes.keys()], [originalId]);
  const marker = [...shapes.values()][0];
  assert.equal(marker.getProperties().shape, 'arrow_up');
  assert.equal(marker.getPoints()[0].price, 1.192);
});

test('user waits for the matching candle data update before placing a directional marker', async () => {
  // Given a native chart and ordinary event annotations
  const fixture = createChartDom({ candle: null });
  // When findStrategy27ChartTarget processes the configured inputs
  const target = findStrategy27ChartTarget(fixture.dom.window.document, 'BTRUSDT');
  const layer = createTradingViewEventLayer(target, {
    maxEvents: 2,
    maxAgeMs: 60_000,
    candleWaitMs: 50,
  });

  const renderPromise = layer.renderOpened('event-a', annotation(), 10_000);
  await Promise.resolve();
  // Then user waits for the matching candle data update before placing a directional marker
  assert.equal(fixture.shapes.size, 0);
  assert.equal(fixture.dataUpdatedListenerCount, 1);

  fixture.setCandle([10, 1.25, 1.3, 1.2, 1.25]);
  fixture.fireDataUpdated();

  assert.equal(await renderPromise, true);
  assert.equal(fixture.shapes.size, 1);
  assert.equal(fixture.dataUpdatedListenerCount, 0);
  assert.equal([...fixture.shapes.values()][0].getPoints()[0].price, 1.192);
});

test('user does not create a marker for a neutral observation', async () => {
  // Given a native chart and ordinary event annotations
  const fixture = createChartDom({ candle: null });
  // When findStrategy27ChartTarget processes the configured inputs
  const target = findStrategy27ChartTarget(fixture.dom.window.document, 'BTRUSDT');
  const layer = createTradingViewEventLayer(target, {
    maxEvents: 2,
    maxAgeMs: 60_000,
    candleWaitMs: 50,
  });

  const observedResult = await layer.renderOpened('event-a', annotation({
    markerShape: null,
    markerColor: null,
  }), 10_000);
  // Then user does not create a marker for a neutral observation
  assert.equal(observedResult, true);
  assert.equal(fixture.shapes.size, 0);
  assert.equal(fixture.dataUpdatedListenerCount, 0);
});

test('user rejects a directional marker when its matching candle misses the bounded wait', async () => {
  // Given a native chart and ordinary event annotations
  const { dom } = createChartDom({ candle: null });
  // When findStrategy27ChartTarget processes the configured inputs
  const target = findStrategy27ChartTarget(dom.window.document, 'BTRUSDT');
  const layer = createTradingViewEventLayer(target, {
    maxEvents: 2,
    maxAgeMs: 60_000,
    candleWaitMs: 5,
  });

  const observedResult = layer.renderOpened('event-a', annotation(), 10_000);
  // Then user rejects a directional marker when its matching candle misses the bounded wait
  await assert.rejects(
    observedResult,
    /candle did not arrive within 5 ms for 10/,
  );
});

test('user does not anchor a neutral observation to a previous candle', async () => {
  // Given a native chart and ordinary event annotations
  const fixture = createChartDom({
    candle: null,
    previousCandle: [9, 1.24, 1.28, 1.18, 1.23],
  });
  // When findStrategy27ChartTarget processes the configured inputs
  const target = findStrategy27ChartTarget(fixture.dom.window.document, 'BTRUSDT');
  const layer = createTradingViewEventLayer(target, {
    maxEvents: 2,
    maxAgeMs: 60_000,
    candleWaitMs: 5,
  });

  const observedResult = await layer.renderOpened('event-a', annotation({
    markerShape: null,
    markerColor: null,
  }), 10_000);
  // Then user does not anchor a neutral observation to a previous candle
  assert.equal(observedResult, true);

  assert.equal(fixture.shapes.size, 0);
  assert.equal(fixture.dataUpdatedListenerCount, 0);
});

test('user sees a directional event outside the latest prior candle when its exact second has no trade', async () => {
  // Given a native chart and ordinary event annotations
  const fixture = createChartDom({
    candle: null,
    previousCandle: [9, 1.24, 1.28, 1.18, 1.23],
  });
  // When findStrategy27ChartTarget processes the configured inputs
  const target = findStrategy27ChartTarget(fixture.dom.window.document, 'BTRUSDT');
  const layer = createTradingViewEventLayer(target, {
    maxEvents: 2,
    maxAgeMs: 60_000,
    candleWaitMs: 5,
  });

  const observedResult = await layer.renderOpened('event-a', annotation(), 10_000);
  // Then user sees a directional event outside the latest prior candle when its exact second has no trade
  assert.equal(observedResult, true);

  const marker = [...fixture.shapes.values()][0];
  assert.deepEqual(marker.getPoints(), [{ time: 9, price: 1.172 }]);
  assert.equal(fixture.dataUpdatedListenerCount, 0);
});

test('user observes that clear cancels a pending candle wait without creating a late marker', async () => {
  // Given a native chart and ordinary event annotations
  const fixture = createChartDom({ candle: null });
  // When findStrategy27ChartTarget processes the configured inputs
  const target = findStrategy27ChartTarget(fixture.dom.window.document, 'BTRUSDT');
  const layer = createTradingViewEventLayer(target, {
    maxEvents: 2,
    maxAgeMs: 60_000,
    candleWaitMs: 50,
  });

  const renderPromise = layer.renderOpened('event-a', annotation(), 10_000);
  await Promise.resolve();
  layer.clear();

  // Then user observes that clear cancels a pending candle wait without creating a late marker
  assert.equal(await renderPromise, false);
  assert.equal(fixture.dataUpdatedListenerCount, 0);
  fixture.setCandle([10, 1.25, 1.3, 1.2, 1.25]);
  fixture.fireDataUpdated();
  assert.equal(fixture.shapes.size, 0);
});

test('user removes a shifted entity and reports chart alignment failure', async () => {
  // Given a native chart and ordinary event annotations
  const { dom, shapes, removed } = createChartDom({ shiftSeconds: -1 });
  // When findStrategy27ChartTarget processes the configured inputs
  const target = findStrategy27ChartTarget(dom.window.document, 'BTRUSDT');
  const layer = createTradingViewEventLayer(target, { maxEvents: 2, maxAgeMs: 60_000 });

  const observedResult = layer.renderOpened('event-a', annotation(), 10_000);
  // Then user removes a shifted entity and reports chart alignment failure
  await assert.rejects(
    observedResult,
    /chart time alignment failed: expected 10, received 9 \(point count 1\)/,
  );
  assert.equal(shapes.size, 0);
  assert.equal(removed.length, 1);
});

test('user observes that clear removes a marker whose asynchronous creation finishes late', async () => {
  // Given a native chart and ordinary event annotations
  const {
    dom,
    shapes,
    removed,
    releaseCreate,
  } = createChartDom({ deferredCreate: true });
  // When findStrategy27ChartTarget processes the configured inputs
  const target = findStrategy27ChartTarget(dom.window.document, 'BTRUSDT');
  const layer = createTradingViewEventLayer(target, { maxEvents: 2, maxAgeMs: 60_000 });

  const renderPromise = layer.renderOpened('event-a', annotation(), 10_000);
  await Promise.resolve();
  layer.clear();
  releaseCreate();

  // Then user observes that clear removes a marker whose asynchronous creation finishes late
  assert.equal(await renderPromise, false);
  assert.equal(layer.size, 0);
  assert.equal(shapes.size, 0);
  assert.equal(removed.length, 1);
});

test('user observes that an update restores an externally evicted marker with its original immutable presentation', async () => {
  // Given a native chart and ordinary event annotations
  const f = createChartDom();
  const layer = createTradingViewEventLayer({ chart: f.chart }, { maxEvents: 2, maxAgeMs: 60000 });
  // When layer.renderOpened processes the configured inputs
  await layer.renderOpened('a', annotation(), 10000);
  const [oldId] = f.shapes.keys();
  const point = f.shapes.get(oldId).getPoints();
  f.shapes.delete(oldId);
  // Then user observes that an update restores an externally evicted marker with its original immutable presentation
  assert.equal(await layer.renderUpdated('a', annotation({ markerShape: 'arrow_down', markerColor: '#F6465D' }), 11000), true);
  assert.equal(f.shapes.size, 1);
  const [id, shape] = [...f.shapes][0];
  assert.notEqual(id, oldId);
  assert.deepEqual(shape.getPoints(), point);
  assert.equal(shape.getProperties().shape, 'arrow_up');
  assert.equal(shape.getProperties().overrides.color, '#0ECB81');
  assert.equal(layer.size, 1);
  assert.deepEqual(f.removed, []);
});

test('user observes that reconciliation restores missing ordinary markers without an event and never revives a cleared record', async () => {
  // Given a native chart and ordinary event annotations
  const f = createChartDom();
  const layer = createTradingViewEventLayer({ chart: f.chart }, { maxEvents: 2, maxAgeMs: 60000 });
  // When f.shapes.set processes the configured inputs
  f.shapes.set('foreign', {});
  await layer.renderOpened('a', annotation(), 10000);
  f.shapes.delete('shape-1');
  await layer.reconcile();
  // Then user observes that reconciliation restores missing ordinary markers without an event and never revives a cleared record
  assert.deepEqual([...f.shapes.keys()], ['foreign', 'shape-2']);
  await layer.reconcile();
  assert.deepEqual([...f.shapes.keys()], ['foreign', 'shape-2']);
  f.shapes.delete('shape-2');
  layer.clear();
  await layer.reconcile();
  assert.deepEqual([...f.shapes.keys()], ['foreign']);
  assert.deepEqual(f.removed, []);
  assert.equal(layer.size, 0);
});

for (const action of ['retain', 'clear', 'remove', 'expire', 'interval', 'symbol', 'suspend']) {
  test(`user observes that ordinary timer and gateway repair share a single creation and cancel stale results (action=${JSON.stringify(action)})`, async () => {
    // Given a native chart and ordinary event annotations
    const f = createChartDom();
    const layer = createTradingViewEventLayer({ chart: f.chart }, { maxEvents: 2, maxAgeMs: 60000 });
    // When layer.renderOpened processes the configured inputs
    await layer.renderOpened('a', annotation(), 10000);
    f.shapes.delete('shape-1');
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const nativeCreate = f.chart.createShape;
    let creates = 0;
    f.chart.createShape = async (...args) => {
      creates += 1;
      entered.resolve();
      await release.promise;
      return nativeCreate(...args);
    };
    const repair = layer.reconcile();
    await entered.promise;
    const update = layer.renderUpdated('a', annotation(), 11000);
    const anotherTick = layer.reconcile();
    if (action === 'clear') layer.clear();
    if (action === 'suspend') layer.suspend();
    if (action === 'remove') layer.remove('a');
    if (action === 'expire') layer.prune(7200000);
    if (action === 'interval') f.chart.resolution = () => '1';
    if (action === 'symbol') f.chart.symbol = () => 'BTCUSDT';
    release.resolve();
    // Then user observes that ordinary timer and gateway repair share a single creation and cancel stale results (action=the selected case)
    assert.equal(await update, action === 'retain', action);
    await Promise.all([repair, anotherTick]);
    assert.equal(creates, 1, action);
    assert.equal(f.shapes.size, action === 'retain' ? 1 : 0, action);
    if (['clear', 'remove', 'expire'].includes(action)) assert.equal(layer.size, 0);
    layer.clear();
    await layer.reconcile();
    assert.equal(f.shapes.size, 0);

  });
}

test('user observes that suspension retains existing markers, cancels late first creation and still permits expiry', async () => {
  // Given a native chart and ordinary event annotations
  const f = createChartDom();
  const layer = createTradingViewEventLayer({ chart: f.chart }, { maxEvents: 3, maxAgeMs: 60000 });
  // When layer.renderOpened processes the configured inputs
  await layer.renderOpened('a', annotation(), 10000);
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const create = f.chart.createShape;
  f.chart.createShape = async (...args) => { entered.resolve(); await release.promise; return create(...args); };
  const pending = layer.renderOpened('b', annotation(), 11000);
  await entered.promise;
  layer.suspend();
  release.resolve();
  // Then user observes that suspension retains existing markers, cancels late first creation and still permits expiry
  assert.equal(await pending, false);
  assert.deepEqual([...f.shapes.keys()], ['shape-1']);
  assert.equal(layer.size, 1);
  assert.equal(await layer.renderOpened('c', annotation(), 12000), false);
  await layer.reconcile();
  assert.deepEqual([...f.shapes.keys()], ['shape-1']);
  layer.prune(70001);
  assert.equal(layer.size, 0);
  assert.equal(f.shapes.size, 0);
});

test('user observes native chart fixture coordinates, shape identity and listener ownership', async (t) => {
  // Given the chart fixture exposes unmodified host data and coordinate operations
  const malformedCandle = { incomplete: true };
  const fixture = createChartDom({ priceToCoordinate: price => price * 2, coordinateToPrice: coordinate => coordinate / 2 });
  t.after(() => fixture.dom.window.close());
  const model = fixture.chart._chartWidget.model().model();
  const series = model.mainSeries();
  const notifications = [];
  const owner = {};
  const listener = () => notifications.push('update');
  series.dataUpdated().subscribe(owner, listener);
  const point = { time: 10, price: 1.25 };

  // When native shape creation, data delivery, and removal are exercised directly
  const id = await fixture.chart.createShape(point, { shape: 'arrow_up' });
  const shape = fixture.chart.getShapeById(id);
  fixture.setCandle(malformedCandle);
  fixture.setSymbol('ETHUSDT');
  fixture.setResolution('5');
  fixture.fireDataUpdated();
  series.dataUpdated().unsubscribe(owner, listener);
  fixture.fireDataUpdated();
  const listed = fixture.chart.getAllShapes();
  fixture.chart.removeEntity(id);

  // Then the boundary preserves raw data, exact operations and independent subscription cleanup
  assert.equal(id, 'shape-1');
  assert.deepEqual(shape.getPoints(), [point]);
  assert.equal(fixture.chart.getSeries().data().valueAt(5), malformedCandle);
  assert.equal(series.priceScale().priceToCoordinate(1.25), 2.5);
  assert.equal(series.priceScale().coordinateToPrice(2.5), 1.25);
  assert.equal(fixture.chart.symbol(), 'ETHUSDT');
  assert.equal(fixture.chart.resolution(), '5');
  assert.deepEqual(notifications, ['update']);
  assert.equal(fixture.dataUpdatedListenerCount, 0);
  assert.deepEqual(listed, [{ id: 'shape-1' }]);
  assert.deepEqual(fixture.removed, ['shape-1']);
  assert.deepEqual(fixture.chart.getAllShapes(), []);
});

for (const [label, markup] of [
  ['missing chart', '<body></body>'],
  ['hidden chart', '<div class="chart-widget-root" data-hidden><iframe></iframe></div>'],
  ['missing frame', '<div class="chart-widget-root"></div>'],
  ['hidden frame', '<div class="chart-widget-root"><iframe data-hidden></iframe></div>'],
  ['uninitialized frame API', '<div class="chart-widget-root"><iframe></iframe></div>'],
]) {
  test(`user waits for the ${label} before binding ordinary markers`, (t) => {
    // Given the native chart is still absent or has not exposed its required frame
    const dom = loadFixtureDom(markup);
    t.after(() => dom.window.close());

    // When the current visible chart is resolved
    const target = findStrategy27ChartTarget(dom.window.document, 'BTRUSDT');

    // Then no chart target is invented during host initialization
    assert.equal(target, null);
  });
}

for (const [label, markup, expected] of [
  ['roots', '<div class="chart-widget-root"></div><div class="chart-widget-root"></div>', 'Visible Strategy 27 chart root count is invalid: 2'],
  ['frames', '<div class="chart-widget-root"><iframe></iframe><iframe></iframe></div>', 'Visible Strategy 27 chart frame count is invalid: 2'],
]) {
  test(`user rejects ambiguous visible chart ${label}`, (t) => {
    // Given multiple visible native containers could receive the marker
    const dom = loadFixtureDom(markup);
    t.after(() => dom.window.close());

    // When the route attempts to bind its current TradingView chart
    const failure = captureStrategyError(() => findStrategy27ChartTarget(dom.window.document, 'BTRUSDT'));

    // Then ambiguity is explicit and no arbitrary container is chosen
    assert.equal(failure.message, expected);
  });
}

test('user rejects a native chart without its required entity method', (t) => {
  // Given the native chart no longer exposes the expected create method
  const fixture = createChartDom();
  t.after(() => fixture.dom.window.close());
  delete fixture.chart.createShape;

  // When the current TradingView target is validated
  const failure = captureStrategyError(() => findStrategy27ChartTarget(fixture.dom.window.document, 'BTRUSDT'));

  // Then the unavailable method is identified before marker work begins
  assert.equal(failure.message, 'TradingView chart method is unavailable: createShape');
  assert.equal(fixture.shapes.size, 0);
});

test('user rejects a chart with no native symbol instead of adopting the route symbol', (t) => {
  // Given the frame is ready but its native symbol is absent
  const fixture = createChartDom({ symbol: null });
  t.after(() => fixture.dom.window.close());

  // When route and native chart identity are checked together
  const failure = captureStrategyError(() => findStrategy27ChartTarget(fixture.dom.window.document, 'BTRUSDT'));

  // Then the symbol mismatch remains explicit
  assert.equal(failure.message, 'Strategy 27 chart symbol mismatch: expected BTRUSDT, received ');
});

for (const [label, listedShapes, expected] of [
  ['non-array list', null, 'Strategy 27 chart shape list is invalid'],
  ['empty identity', [{ id: '' }], 'Strategy 27 chart shape id is invalid'],
  ['numeric identity', [{ id: 42 }], 'Strategy 27 chart shape id is invalid'],
  ['missing entity', [null], 'Strategy 27 chart shape id is invalid'],
]) {
  test(`user rejects native shape discovery with ${label}`, () => {
    // Given the host returns the malformed list without repairing its entries
    const boundary = createStrategyShapeBoundary({ listedShapes });

    // When live native shape identities are read for reconciliation
    const failure = captureStrategyError(() => readLiveShapeIds(boundary.chart));

    // Then invalid native identities fail before any removal is attempted
    assert.equal(failure.message, expected);
    assert.deepEqual(boundary.removed, []);
  });
}

for (const shapeId of [null, '', 42]) {
  test(`user rejects native shape creation returning identity ${JSON.stringify(shapeId)}`, async () => {
    // Given native creation returns an unusable entity identity
    const boundary = createStrategyShapeBoundary({ shapeId });
    const point = { time: 10, price: 1.25 };

    // When the real aligned creation adapter receives that identity
    const result = createAlignedShape(boundary.chart, point, { shape: 'arrow_up' });

    // Then the unusable identity is reported without guessing which entity to remove
    await assert.rejects(result, { message: 'TradingView returned an invalid shape id' });
    assert.equal(boundary.created.length, 1);
    assert.deepEqual(boundary.removed, []);
  });
}

for (const [label, points, count] of [
  ['missing points', null, null],
  ['empty points', [], 0],
  ['multiple points', [{ time: 10, price: 1.25 }, { time: 11, price: 1.26 }], 2],
]) {
  test(`user removes only the newly created marker after native ${label}`, async () => {
    // Given native creation succeeds but its point collection violates the marker contract
    const boundary = createStrategyShapeBoundary({ points });

    // When the real aligned creation adapter verifies the native point collection
    const result = createAlignedShape(boundary.chart, { time: 10, price: 1.25 }, { shape: 'arrow_up' });

    // Then the invalid owned marker is removed and its alignment error remains visible
    await assert.rejects(result, { message: `Strategy 27 chart time alignment failed: expected 10, received null (point count ${count})` });
    assert.deepEqual(boundary.removed, ['native-shape']);
    assert.equal(boundary.created.length, 1);
  });
}

for (const [label, candle, expected] of [
  ['non-array candle', { time: 10 }, 'Strategy 27 candle is invalid for 10'],
  ['incomplete OHLC values', [10, 1.25], 'Strategy 27 candle is invalid for 10'],
  ['mismatched candle time', [9, 1.25, 1.3, 1.2, 1.25], 'Strategy 27 candle is invalid for 10'],
  ['non-finite high price', [10, 1.25, NaN, 1.2, 1.25], 'Strategy 27 candle prices are invalid for 10'],
  ['missing low price', [10, 1.25, 1.3, undefined, 1.25], 'Strategy 27 candle prices are invalid for 10'],
]) {
  test(`user rejects native marker placement with ${label}`, (t) => {
    // Given the native series exposes the malformed candle at the exact event second
    const fixture = createChartDom({ candle });
    t.after(() => fixture.dom.window.close());
    const placement = createTradingViewMarkerPlacement(fixture.chart);
    const controller = new AbortController();

    // When causal placement inspects that native candle
    const failure = captureStrategyError(() => placement.wait(annotation(), { signal: controller.signal }));

    // Then the malformed native data is explicit and no listener or marker is installed
    assert.equal(failure.message, expected);
    assert.equal(fixture.dataUpdatedListenerCount, 0);
    assert.equal(fixture.shapes.size, 0);
  });
}

for (const [label, chartOptions, expected] of [
  ['candle coordinate', { priceToCoordinate: () => NaN }, 'Strategy 27 candle coordinate is unavailable for 10'],
  ['marker price', { coordinateToPrice: () => NaN }, 'Strategy 27 marker price is unavailable for 10'],
]) {
  test(`user rejects a non-finite native ${label}`, (t) => {
    // Given the native price scale cannot provide the required finite mapping
    const fixture = createChartDom(chartOptions);
    t.after(() => fixture.dom.window.close());
    const placement = createTradingViewMarkerPlacement(fixture.chart);
    const signal = new AbortController().signal;

    // When the real placement adapter asks the native scale for an arrow position
    const failure = captureStrategyError(() => placement.wait(annotation(), { signal }));

    // Then invalid geometry cannot become a guessed marker price
    assert.equal(failure.message, expected);
    assert.equal(fixture.dataUpdatedListenerCount, 0);
    assert.equal(fixture.shapes.size, 0);
  });
}

for (const [label, candidate, gapPx, expected] of [
  ['unsupported marker shape', annotation({ markerShape: 'triangle' }), 8, 'Unsupported Strategy 27 marker shape: triangle'],
  ['non-finite pixel gap', annotation(), Infinity, 'Strategy 27 marker pixel gap is invalid'],
]) {
  test(`user rejects ${label} before reading candle data`, (t) => {
    // Given marker presentation includes an invalid public placement argument
    const fixture = createChartDom();
    t.after(() => fixture.dom.window.close());
    const placement = createTradingViewMarkerPlacement(fixture.chart);
    const signal = new AbortController().signal;

    // When the native placement adapter receives that argument
    const failure = captureStrategyError(() => placement.wait(candidate, { signal, gapPx }));

    // Then the invalid presentation is reported without waiting or creating a marker
    assert.equal(failure.message, expected);
    assert.equal(fixture.dataUpdatedListenerCount, 0);
    assert.equal(fixture.shapes.size, 0);
  });
}

test('user rejects an unavailable native placement method at initialization', () => {
  // Given the native chart has not exposed its time-scale API
  const chart = {};

  // When the real marker placement adapter initializes
  const failure = captureStrategyError(() => createTradingViewMarkerPlacement(chart));

  // Then the missing native method is identified without starting a candle wait
  assert.equal(failure.message, 'TradingView marker placement method is unavailable: timePointToIndex');
});

for (const candleWaitMs of [0, 1.5]) {
  test(`user rejects a candle wait deadline of ${candleWaitMs}`, (t) => {
    // Given an invalid deadline was requested for a valid native chart
    const fixture = createChartDom();
    t.after(() => fixture.dom.window.close());

    // When marker placement initializes with that deadline
    const failure = captureStrategyError(() => createTradingViewMarkerPlacement(fixture.chart, { candleWaitMs }));

    // Then the invalid deadline cannot create an unbounded or fractional wait
    assert.equal(failure.message, 'Strategy 27 candleWaitMs is invalid');
    assert.equal(fixture.dataUpdatedListenerCount, 0);
  });
}

test('user cancels placement before any native candle read or subscription', async (t) => {
  // Given cancellation already occurred and the native candle would otherwise be invalid
  const fixture = createChartDom({ candle: {} });
  t.after(() => fixture.dom.window.close());
  const placement = createTradingViewMarkerPlacement(fixture.chart);
  const controller = new AbortController();
  controller.abort();

  // When the cancelled caller requests marker placement
  const point = await placement.wait(annotation(), { signal: controller.signal });

  // Then cancellation returns no marker point and leaves no native subscription
  assert.equal(point, null);
  assert.equal(fixture.dataUpdatedListenerCount, 0);
  assert.equal(fixture.shapes.size, 0);
});

test('user releases candle subscriptions when a later native update is malformed', async (t) => {
  // Given placement is waiting on the native series for the event second
  const fixture = createChartDom({ candle: null });
  t.after(() => fixture.dom.window.close());
  const placement = createTradingViewMarkerPlacement(fixture.chart);
  const pending = placement.wait(annotation(), { signal: new AbortController().signal });
  assert.equal(fixture.dataUpdatedListenerCount, 1);

  // When the native data update supplies malformed candle content
  fixture.setCandle({ incomplete: true });
  fixture.fireDataUpdated();

  // Then the actual data error rejects placement and its listener is removed
  await assert.rejects(pending, { message: 'Strategy 27 candle is invalid for 10' });
  assert.equal(fixture.dataUpdatedListenerCount, 0);
  assert.equal(fixture.shapes.size, 0);
});

test('user cannot anchor an expired candle wait to a future native bar', async (t) => {
  // Given the exact candle is absent and the native prior-candle lookup incorrectly points forward
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fixture = createChartDom({ candle: null, previousCandle: [11, 1.25, 1.3, 1.2, 1.25] });
  t.after(() => fixture.dom.window.close());
  const placement = createTradingViewMarkerPlacement(fixture.chart, { candleWaitMs: 25 });
  const pending = placement.wait(annotation(), { signal: new AbortController().signal });

  // When the bounded exact-candle deadline is reached
  t.mock.timers.tick(24);
  assert.equal(fixture.dataUpdatedListenerCount, 1);
  t.mock.timers.tick(1);

  // Then a future bar is rejected and the bounded wait releases its listener
  await assert.rejects(pending, { message: 'Strategy 27 candle is invalid for 10' });
  assert.equal(fixture.dataUpdatedListenerCount, 0);
  assert.equal(fixture.shapes.size, 0);
});

test('user shifts a marker through the native price scale while preserving its candle time', (t) => {
  // Given the exact native marker point is offset from its candle
  const fixture = createChartDom();
  t.after(() => fixture.dom.window.close());
  const placement = createTradingViewMarkerPlacement(fixture.chart);

  // When an additional eight-pixel vertical offset is requested
  const shifted = placement.shift({ time: 10, price: 1.25 }, 8);

  // Then the native inverse mapping determines price and candle time is unchanged
  assert.deepEqual(shifted, { time: 10, price: 1.242 });
});

for (const [label, chartOptions, deltaPixels, expected] of [
  ['invalid pixel delta', {}, Infinity, 'Strategy 27 marker pixel shift is invalid'],
  ['unavailable native coordinate', { priceToCoordinate: () => NaN }, 8, 'Strategy 27 shifted marker coordinate is invalid'],
  ['unavailable inverse price', { coordinateToPrice: () => NaN }, 8, 'Strategy 27 shifted marker coordinate is invalid'],
]) {
  test(`user rejects a marker shift with ${label}`, (t) => {
    // Given the native scale or requested shift cannot provide valid coordinates
    const fixture = createChartDom(chartOptions);
    t.after(() => fixture.dom.window.close());
    const placement = createTradingViewMarkerPlacement(fixture.chart);

    // When the real marker placement adapter shifts its existing point
    const failure = captureStrategyError(() => placement.shift({ time: 10, price: 1.25 }, deltaPixels));

    // Then invalid geometry fails explicitly without creating an entity
    assert.equal(failure.message, expected);
    assert.equal(fixture.shapes.size, 0);
  });
}

for (const [field, value] of [['maxEvents', 0], ['maxEvents', 1.5], ['maxAgeMs', 0], ['maxAgeMs', 1.5]]) {
  test(`user rejects invalid ordinary marker retention ${field}=${value}`, (t) => {
    // Given one retention bound violates the layer configuration contract
    const fixture = createChartDom();
    t.after(() => fixture.dom.window.close());
    const options = { maxEvents: 2, maxAgeMs: 60000, [field]: value };

    // When the real event layer initializes with that bound
    const failure = captureStrategyError(() => createTradingViewEventLayer({ chart: fixture.chart }, options));

    // Then the invalid bound is explicit and no chart entity is created
    assert.equal(failure.message, `Strategy 27 ${field} is invalid`);
    assert.equal(fixture.shapes.size, 0);
  });
}

test('user does not restore an evicted marker after the native chart has changed symbols', async (t) => {
  // Given the layer retains a verified BTR event whose native marker was evicted
  const fixture = createChartDom();
  t.after(() => fixture.dom.window.close());
  const layer = createTradingViewEventLayer({ chart: fixture.chart }, { maxEvents: 2, maxAgeMs: 60000 });
  await layer.renderOpened('event-a', annotation(), 10000);
  fixture.shapes.delete('shape-1');
  fixture.setSymbol('ETHUSDT');

  // When an old event update arrives before the outer context sample
  const rendered = await layer.renderUpdated('event-a', annotation(), 11000);

  // Then the stale marker is not created on the replacement chart
  assert.equal(rendered, false);
  assert.equal(layer.size, 1);
  assert.equal(fixture.shapes.size, 0);
  assert.deepEqual(fixture.removed, []);
  layer.clear();
});
