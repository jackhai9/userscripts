import assert from 'node:assert/strict';
import test from 'node:test';
import { createStrategy29ChartHost, createStrategy29RequestHost, createStrategyGatewayProviderHost } from '../../helpers/strategy29-runtime-boundary-host.js';

test('user receives unchanged native candle exports and explicit interval notifications from the chart boundary', async () => {
  // Given positive OHLC records and independent native interval subscriptions.
  const bars = [
    { time: 60, open: 100, high: 102, low: 99, close: 101 },
    { time: 120, open: 101, high: 103, low: 100, close: 102 },
  ];
  const host = createStrategy29ChartHost({ bars });
  const events = [];
  const owner = {};
  const changed = () => events.push('changed');
  const loaded = () => events.push('loaded');
  host.intervalChanged.subscribe(owner, changed);
  host.dataLoaded.subscribe(owner, loaded);

  // When the host exports its data and completes a requested interval transition.
  const exported = await host.chart.exportData({ includedStudies: [] });
  host.changeInterval('5');
  assert.equal(host.chart.dataReady(), false);
  host.finishData();

  // Then timestamps and prices remain exact while notification ownership stays explicit.
  assert.deepEqual(exported, {
    schema: [{ type: 'time' }, { type: 'open' }, { type: 'high' }, { type: 'low' }, { type: 'close' }],
    data: [{ 0: 60, 1: 100, 2: 102, 3: 99, 4: 101 }, { 0: 120, 1: 101, 2: 103, 3: 100, 4: 102 }],
  });
  assert.deepEqual(host.exports, [{ includedStudies: [] }]);
  assert.deepEqual(events, ['changed', 'loaded']);
  assert.equal(host.chart.resolution(), '5');
  assert.equal(host.chart.dataReady(), true);
  assert.equal(host.document.hidden, false);
  host.intervalChanged.unsubscribe(owner, changed);
  host.dataLoaded.unsubscribe(owner, loaded);
  assert.equal(host.intervalChanged.size, 0);
  assert.equal(host.dataLoaded.size, 0);
  host.close();
});

test('user controls only native drawing completion and observes failed property writes without repaired results', async () => {
  // Given a held native creation and a host that declines property writes.
  const host = createStrategy29ChartHost();
  const gate = host.holdNextCreation();
  host.ignorePropertyWrites(true);
  const options = { shape: 'arrow_down', disableSave: true, overrides: { visible: false, color: '#F6465D' } };

  // When the native call is released and its property setter is invoked.
  const pending = host.chart.createShape({ time: 60, price: 100 }, options);
  await gate.entered;
  assert.equal(host.shapes.size, 0);
  gate.release();
  const id = await pending;
  const shape = host.chart.getShapeById(id);
  shape.setProperties({ visible: true }, false);

  // Then the actual unmodified properties and exact mutation request remain observable.
  assert.equal(id, 'native-1');
  assert.deepEqual(shape.getPoints(), [{ time: 60, price: 100 }]);
  assert.deepEqual(shape.getProperties(), { visible: false, color: '#F6465D', icon: undefined });
  assert.deepEqual(host.propertyWrites, [{ id, properties: { visible: true }, saveDefaults: false }]);
  host.addForeignShape('user-line');
  host.chart.removeEntity(id);
  assert.deepEqual(host.chart.getAllShapes(), [{ id: 'user-line', name: 'trend_line' }]);
  assert.deepEqual(host.removed, ['native-1']);
  host.close();
});

test('user receives an explicitly gated gateway response even after abort without the host inventing protocol decisions', async () => {
  // Given a held raw response and a separate caller-owned abort signal.
  const host = createStrategy29RequestHost();
  const gate = host.hold();
  const controller = new AbortController();

  // When cancellation races a native response that the host still delivers.
  const pending = host.request({ path: '/v1/strategy29/status', signal: controller.signal });
  await gate.entered;
  controller.abort(new Error('context retired'));
  gate.respond({ revision: 2 }, 503);
  const response = await pending;

  // Then the boundary returns precisely the declared body and leaves rejection policy to the real client.
  assert.deepEqual(response, { status: 503, responseText: '{"revision":2}' });
  assert.equal(host.requests[0].signal, controller.signal);
  assert.equal(host.requests[0].signal.aborted, true);
  assert.equal(host.remaining, 0);
  await assert.rejects(host.request({ path: '/undeclared', signal: new AbortController().signal }), /declared response/);
});

test('user controls native export completion and malformed values without losing their identity', async (t) => {
  // Given a chart with a held export and exact subsequent raw response declarations.
  const host = createStrategy29ChartHost();
  t.after(() => host.close());
  const gate = host.holdNextExport();
  const malformed = { schema: null, data: [] };
  const rejection = { name: 7, message: 8 };

  // When each native export completes with its declared external response or rejection.
  const pending = host.chart.exportData({ includedStudies: [] });
  await gate.entered;
  gate.resolve(malformed);
  const held = await pending;
  host.exportNext(malformed);
  const immediate = await host.chart.exportData({ includedStudies: [] });
  host.failNextExport(rejection);
  const failed = host.chart.exportData({ includedStudies: [] });

  // Then the boundary preserves raw values and errors while recording one call per export.
  assert.equal(held, malformed);
  assert.equal(immediate, malformed);
  await assert.rejects(failed, error => error === rejection);
  assert.deepEqual(host.exports, [{ includedStudies: [] }, { includedStudies: [] }, { includedStudies: [] }]);
});

test('user can model native chart retirement and readback changes without hidden business decisions', async (t) => {
  // Given a native chart with one real drawing record and independently controlled host state.
  const host = createStrategy29ChartHost();
  t.after(() => host.close());
  const id = await host.chart.createShape({ time: 60, price: 100 }, { shape: 'icon', icon: 0xf111, overrides: { visible: false } });
  host.onNextPointRead(() => host.setHidden(true));

  // When native state changes independently of any detector or marker controller.
  const point = host.chart.getShapeById(id).getPoints();
  host.editProperties(id, { icon: 0xf110 });
  const edited = host.chart.getShapeById(id).getProperties();
  host.setNativeProperties(id, null);
  const malformed = host.chart.getShapeById(id).getProperties();
  host.setActiveChart(null);
  host.setModelReady(false);
  host.setDataReady(false);
  host.setSymbol('BTCUSDT@PRICETYPE=LAST');
  host.returnNextCreationId(42);
  const invalidId = await host.chart.createShape({ time: 120, price: 101 }, { shape: 'icon', overrides: {} });

  // Then callers observe the exact external state and no repair, cleanup or substitute drawing occurs.
  assert.deepEqual(point, [{ time: 60, price: 100 }]);
  assert.deepEqual(edited, { visible: false, icon: 0xf110 });
  assert.equal(malformed, null);
  assert.equal(host.document.hidden, true);
  assert.equal(host.tradingViewApi.activeChart(), null);
  assert.equal(host.chart.hasModel(), false);
  assert.equal(host.chart.dataReady(), false);
  assert.equal(host.chart.symbol(), 'BTCUSDT@PRICETYPE=LAST');
  assert.equal(invalidId, 42);
  assert.deepEqual([...host.shapes.keys()], [id]);
  assert.deepEqual(host.propertyWrites, []);
  assert.deepEqual(host.removed, []);
});

test('user receives declared gateway response and rejection values in FIFO order', async () => {
  // Given exact gateway responses followed by a rejected native request.
  const host = createStrategy29RequestHost();
  const raw = { status: '200', responseText: null };
  const error = new Error('native request failed');
  host.respond({ schema_version: 1 }, 503);
  host.respondRaw(raw);
  host.reject(error);
  const request = { path: '/v1/strategy29/status', signal: new AbortController().signal };

  // When requests consume the declared native response queue.
  const first = await host.request(request);
  const second = await host.request(request);
  const rejected = host.request(request);

  // Then JSON encoding, raw identity and rejection ownership remain observable without protocol validation.
  assert.deepEqual(first, { status: 503, responseText: '{"schema_version":1}' });
  assert.equal(second, raw);
  await assert.rejects(rejected, observed => observed === error);
  assert.deepEqual(host.requests, [request, request, request]);
  assert.equal(host.remaining, 0);
});

test('user observes omitted native capabilities and raw subscription or shape-list values without helper repair', (t) => {
  // Given a chart build that omits one capability and a raw native subscription response.
  const host = createStrategy29ChartHost({ omittedMethods: ['exportData'] });
  t.after(() => host.close());
  host.setIntervalSubscription(null);
  host.listShapesNext(null);
  host.addForeignShape('user-line');

  // When consumers inspect native methods, subscriptions and successive shape lists.
  const subscription = host.chart.onIntervalChanged();
  const malformed = host.chart.getAllShapes();
  const next = host.chart.getAllShapes();

  // Then every missing or malformed native value stays visible and declared real shapes remain stored.
  assert.equal(Object.hasOwn(host.chart, 'exportData'), false);
  assert.equal(subscription, null);
  assert.equal(malformed, null);
  assert.deepEqual(next, [{ id: 'user-line', name: 'trend_line' }]);
  assert.equal(host.shapes.size, 1);
  assert.deepEqual(host.removed, []);
});

test('user sees provider versions, states and raw response fields unchanged at the public bridge boundary', async () => {
  // Given an externally installed provider with explicit nonconforming protocol values.
  const view = {};
  const host = createStrategyGatewayProviderHost(view);
  const state = { available: 'yes', configured: true, settingsRevision: 1 };
  const response = { kind: 'response', status: 200, responseText: '{}', unexpected: true };
  host.setVersion(2);
  host.setState(state);
  host.transport.respondRaw(response);
  const signal = new AbortController().signal;

  // When the public provider interface is used without a consuming business client.
  const observed = await host.bridge.request('/v1/strategy29/status', signal);

  // Then the host returns the exact declared values and records the untouched call.
  assert.equal(view[Symbol.for('jh-userscripts.signal-gateway')], host.bridge);
  assert.equal(host.bridge.version, 2);
  assert.equal(host.bridge.getState(), state);
  assert.equal(observed, response);
  assert.deepEqual(host.transport.requests, [{ path: '/v1/strategy29/status', signal }]);
});
