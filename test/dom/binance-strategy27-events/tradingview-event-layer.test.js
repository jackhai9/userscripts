import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFixtureDom } from '../../helpers/dom.js';
import { captureStrategyError } from '../../helpers/strategy-migration-boundaries.js';
import { createStrategy27OverlayHost } from '../../helpers/strategy27-overlay-host.js';
import { createTradingViewEventLayer, createTradingViewMarkerPlacement, findStrategy27ChartRoot,
  findStrategy27ChartTarget as resolveStrategy27ChartTarget } from '../../../src/binance-strategy27-events/dom/tradingview-event-layer.js';

function findStrategy27ChartTarget(document, symbol) {
  return resolveStrategy27ChartTarget(findStrategy27ChartRoot(document), symbol);
}
function createChartDom({ candle = [10, 1.25, 1.3, 1.2, 1.25], previousCandle = null, ...options } = {}) {
  const fixture = createStrategy27OverlayHost(options);
  let currentCandle = candle;
  fixture.chart.getSeries = () => ({ data: () => ({ valueAt: index => index === 5 ? currentCandle : index === 4 ? previousCandle : null }) });
  fixture.overlay.timeScale.timePointToIndex = (time, mode) => {
    if (previousCandle && time === previousCandle[0] && mode === 0) return 4;
    if (time !== 10) return null;
    return mode === 1 && previousCandle ? 4 : 5;
  };
  fixture.setCandle = value => { currentCandle = value; };
  Object.defineProperty(fixture, 'dataUpdatedListenerCount', { get: () => fixture.overlay.events.dataUpdated.size });
  return fixture;
}
function annotation(overrides = {}) {
  return { markerShape: 'arrow_up', markerColor: '#0ECB81', markerTime: 10, markerPrice: 1.25, ...overrides };
}
const eventLayer = fixture => createTradingViewEventLayer(fixture.target, { maxEvents: 2, maxAgeMs: 60000 });

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

test('user rejects a native chart without its required chart method', (t) => {
  // Given the native chart no longer exposes the expected create method
  const fixture = createChartDom();
  t.after(() => fixture.dom.window.close());
  delete fixture.chart.resolution;

  // When the current TradingView target is validated
  const failure = captureStrategyError(() => findStrategy27ChartTarget(fixture.dom.window.document, 'BTRUSDT'));

  // Then the unavailable method is identified before marker work begins
  assert.equal(failure.message, 'TradingView chart method is unavailable: resolution');
  assert.equal(fixture.created.length, 0);
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
    assert.equal(fixture.created.length, 0);
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
    assert.equal(fixture.created.length, 0);
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
    assert.equal(fixture.created.length, 0);
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
  assert.equal(fixture.created.length, 0);
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
  assert.equal(fixture.created.length, 0);
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
  assert.equal(fixture.created.length, 0);
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
    assert.equal(fixture.created.length, 0);
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
    assert.equal(fixture.created.length, 0);
  });
}


test('user owns one immutable arrow across opened updated closed and outcome events', async () => {
  // Given one accepted directional event beside a user drawing
  const host = createChartDom();
  const layer = eventLayer(host);
  await layer.renderOpened('first', annotation(), 10000);
  const original = host.markers()[0];
  // When later event stages change their proposed direction and price
  for (const stage of ['renderUpdated', 'renderClosed', 'renderOutcome']) {
    await layer[stage]('first', annotation({ markerShape: 'arrow_down', markerColor: '#F6465D', markerPrice: 999 }), 11000);
  }
  // Then the original marker identity geometry and color are immutable
  assert.equal(host.markers().length, 1);
  assert.equal(host.markers()[0], original);
  assert.equal(original.dataset.markerId, 'event:first');
  assert.equal(original.getAttribute('fill'), '#0ECB81');
  assert.equal(original.getAttribute('transform'), 'translate(50 808)');
  layer.remove('first');
  assert.equal(host.markers().length, 0);
  await layer.renderOpened('second', annotation(), 12000);
  layer.clear();
  assert.equal(host.markers().length, 0);
  assert.deepEqual([...host.shapes.keys()], ['user-owned']);
  assert.deepEqual([host.created.length, host.removed.length, host.saves.length], [0, 0, 0]);
  host.close();
});

test('user sees arrows at candle edges with the original eight pixel price conversion', async () => {
  // Given high and low candle prices independent of signal markerPrice
  const host = createChartDom();
  const layer = eventLayer(host);
  // When both arrow directions are rendered
  await layer.renderOpened('up', annotation({ markerPrice: 999 }), 10000);
  await layer.renderOpened('down', annotation({ markerShape: 'arrow_down', markerColor: '#F6465D', markerPrice: 0 }), 10000);
  // Then both tips have eight pixel gaps and later zoom projects the stored prices
  assert.deepEqual(host.markers().map(node => node.getAttribute('transform')), ['translate(50 808)', 'translate(50 692)']);
  host.overlay.setProjection({ price: price => 2000 - price * 500 });
  host.overlay.events.priceRangeChanged.emit();
  host.overlay.flushFrames();
  assert.deepEqual(host.markers().map(node => node.getAttribute('transform')), ['translate(50 1404)', 'translate(50 1346)']);
  layer.clear();
  host.close();
});

test('user receives an exact candle arriving before three seconds without using the previous candle', async t => {
  // Given a missing exact candle and an available previous candle
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const host = createChartDom({ candle: null, previousCandle: [9, 1.25, 1.3, 1.2, 1.25] });
  const layer = eventLayer(host);
  const pending = layer.renderOpened('exact', annotation(), 10000);
  // When the exact candle arrives one millisecond before the deadline
  t.mock.timers.tick(2999);
  assert.equal(host.markers().length, 0);
  host.setCandle([10, 1.25, 1.3, 1.2, 1.25]);
  host.fireDataUpdated();
  // Then the exact candle owns the arrow and the placement listener is released
  assert.equal(await pending, true);
  assert.equal(host.markers()[0].getAttribute('transform'), 'translate(50 808)');
  assert.equal(host.dataUpdatedListenerCount, 1);
  layer.clear();
  assert.equal(host.dataUpdatedListenerCount, 0);
  host.close();
});

test('user anchors to a previous candle only after the full three second deadline', async t => {
  // Given no exact candle but a valid earlier candle
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const host = createChartDom({ candle: null, previousCandle: [9, 1.25, 1.3, 1.2, 1.25] });
  const layer = eventLayer(host);
  const pending = layer.renderOpened('previous', annotation(), 10000);
  // When the exact deadline is crossed
  t.mock.timers.tick(2999);
  assert.equal(host.markers().length, 0);
  t.mock.timers.tick(1);
  // Then the preceding candle receives the marker without snapping to a later bar
  assert.equal(await pending, true);
  assert.equal(host.markers()[0].getAttribute('transform'), 'translate(40 808)');
  layer.clear();
  host.close();
});

for (const reason of ['clear', 'remove', 'symbol', 'suspend']) {
  test(`user never publishes a pending ordinary marker after ${reason}`, async () => {
    // Given a marker waiting for its exact native candle
    const host = createChartDom({ candle: null });
    const layer = eventLayer(host);
    const pending = layer.renderOpened('pending', annotation(), 10000);
    // When its owner is retired before native data arrives
    if (reason === 'clear') layer.clear();
    if (reason === 'remove') layer.remove('pending');
    if (reason === 'symbol') host.setSymbol('ETHUSDT');
    if (reason === 'suspend') layer.suspend();
    host.setCandle([10, 1.25, 1.3, 1.2, 1.25]);
    host.fireDataUpdated();
    // Then no late arrow or placement subscription survives
    assert.equal(await pending, false);
    assert.equal(host.markers().length, 0);
    assert.equal(host.dataUpdatedListenerCount, 0);
    assert.equal(layer.size, 0);
    layer.clear();
    host.close();
  });
}

test('user retains suspended history through zoom while refusing new markers and permitting expiry', async () => {
  // Given an accepted event and a later neutral observation
  const host = createChartDom();
  const layer = eventLayer(host);
  await layer.renderOpened('first', annotation(), 10000);
  assert.equal(await layer.renderOpened('neutral', annotation({ markerShape: null }), 11000), true);
  // When presentation is suspended and the native price scale changes
  layer.suspend();
  host.overlay.setProjection({ price: price => 2000 - price * 500 });
  host.overlay.events.modeChanged.emit();
  host.overlay.flushFrames();
  // Then verified history remains projected but new events do not render
  assert.equal(host.markers()[0].getAttribute('transform'), 'translate(50 1404)');
  assert.equal(await layer.renderOpened('second', annotation(), 12000), false);
  assert.equal(layer.size, 1);
  layer.prune(70000);
  assert.equal(layer.size, 1);
  layer.prune(70001);
  assert.equal(layer.size, 0);
  assert.equal(host.markers().length, 0);
  layer.clear();
  host.close();
});

test('user evicts only the oldest ordinary event when bounded capacity is reached', async () => {
  // Given a two-event capacity filled in insertion order
  const host = createChartDom();
  const layer = eventLayer(host);
  await layer.renderOpened('first', annotation(), 10000);
  await layer.renderOpened('second', annotation(), 10001);
  // When a third event arrives and repeated reconciliation runs
  await layer.renderOpened('third', annotation(), 10002);
  const nodes = host.markers();
  await layer.reconcile();
  // Then the two newest immutable markers survive without native mutation
  assert.deepEqual(host.markers().map(node => node.dataset.markerId), ['event:second', 'event:third']);
  assert.deepEqual(host.markers(), nodes);
  assert.deepEqual([host.created.length, host.removed.length, host.saves.length], [0, 0, 0]);
  layer.clear();
  host.close();
});

for (const [resolution, symbol, expected] of [['1', 'BTRUSDT', /one-second chart/], ['1S', 'ETHUSDT', /symbol mismatch/]]) {
  test(`user rejects ${resolution} ${symbol} before binding the current one-second route`, () => {
    // Given a visible native chart outside the requested symbol or interval
    const host = createChartDom({ resolution, symbol });
    // When the current route attempts to bind presentation
    const resolve = () => findStrategy27ChartTarget(host.document, 'BTRUSDT');
    // Then the incompatible chart fails before any overlay is installed
    assert.throws(resolve, expected);
    assert.equal(host.overlay.pane.querySelectorAll('svg').length, 0);
    host.close();
  });
}

test('user sees a terminal ordinary projection failure without later marker resurrection', async () => {
  // Given a valid ordinary event and an explicit failure consumer
  const host = createChartDom();
  const errors = [];
  const layer = createTradingViewEventLayer(host.target, { maxEvents: 2, maxAgeMs: 60000, onRenderError: error => errors.push(error.message) });
  await layer.renderOpened('first', annotation(), 10000);
  // When native projection fails in a scheduled frame and later recovers
  host.overlay.setProjection({ price: () => NaN });
  host.overlay.events.priceRangeChanged.emit();
  host.overlay.flushFrames();
  host.overlay.setProjection({ price: price => 2000 - price * 1000 });
  await layer.reconcile();
  // Then accepted history remains recorded but failed presentation cannot reappear
  assert.equal(errors.length, 1);
  assert.match(errors[0], /coordinates are invalid/);
  assert.equal(layer.size, 1);
  assert.equal(host.markers().length, 0);
  assert.equal(await layer.renderUpdated('first', annotation(), 11000), false);
  assert.equal(host.overlay.subscriptions, 0);
  layer.clear();
  host.close();
});

test('user receives the native candle and coordinate host contract without repaired data', () => {
  // Given explicit candle rows and an owner-bound delegate
  const host = createStrategy27OverlayHost({ bars: [[10, 1.25, 1.3, 1.2, 1.25], [12, 1.3, 1.4, 1.25, 1.35]] });
  const event = host.overlay.events.dataUpdated;
  const owner = {};
  let notifications = 0;
  const callback = () => { notifications += 1; };
  // When exact previous and missing indices are read and subscriptions are released
  const exact = host.overlay.timeScale.timePointToIndex(12, 0);
  const previous = host.overlay.timeScale.timePointToIndex(11, 1);
  const missing = host.overlay.timeScale.timePointToIndex(11, 0);
  event.subscribe(owner, callback);
  host.fireDataUpdated();
  event.unsubscribe(owner, callback);
  host.fireDataUpdated();
  // Then the host obeys independently specified native timing and scale contracts
  assert.deepEqual([exact, previous, missing], [12, 10, null]);
  assert.deepEqual(host.chart.getSeries().data().valueAt(exact), [12, 1.3, 1.4, 1.25, 1.35]);
  assert.equal(host.overlay.priceScale.priceToCoordinate(1.3, 100), 700);
  assert.equal(host.overlay.priceScale.coordinateToPrice(708, 100), 1.292);
  assert.equal(notifications, 1);
  assert.equal(event.size, 0);
  host.close();
});

test('user receives a bounded failure when neither the exact nor a previous candle exists', async t => {
  // Given an empty native candle series and the default three second wait
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const host = createChartDom({ candle: null });
  const layer = eventLayer(host);
  const pending = layer.renderOpened('missing', annotation(), 10000);
  // When the full candle deadline expires
  t.mock.timers.tick(3000);
  // Then the specific placement failure releases its subscription without creating presentation
  await assert.rejects(pending, /candle did not arrive within 3000 ms for 10/);
  assert.equal(host.dataUpdatedListenerCount, 0);
  assert.equal(layer.size, 0);
  assert.equal(host.markers().length, 0);
  layer.clear();
  host.close();
});
