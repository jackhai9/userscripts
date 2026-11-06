import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { observeOrderLineSaves } from '../../src/binance-orderbook-trade/chart-storage/order-line-saves.js';
import { coalesceChartOrderVisibilitySaves } from '../../src/binance-orderbook-trade/core/chart-save-coalescer.js';
import { createManualTimers } from './binance-orderbook-trade/chart-save-test-host.js';

// These two adjacent host listeners share their readiness ref and save scheduler.
function binanceListeners(q) {
  const J = { current: true };
  return {
    study: ()=>{J.current&&q()},
    drawing: (e,t)=>{if(J.current)switch(t){case"click":case"move":return;default:q()}},
  };
}

function renamedListeners(save) {
  const ready = { current: true };
  return {
    study: ()=>{ready.current&&save()},
    drawing: (id,type)=>{if(ready.current)switch(type){case"click":case"move":return;default:save()}},
  };
}

function chartPage(t) {
  const { window } = new JSDOM('<div class="chart-widget-root"></div>', { url: 'https://www.binance.com/en/futures/BTCUSDT' });
  t.after(() => window.close());
  observeOrderLineSaves(window.document);
  return window.document;
}

async function mountWidget(document, { subscribeSave = true, createListeners = binanceListeners, rejectTopic } = {}) {
  const subscriptions = new Map();
  const widgets = [];
  const saves = [];
  let drawing;
  const api = {
    _chartWidgetCollection: { getAll: () => widgets },
    saveChart(callback) {
      callback({ drawings: [...chart.sources.keys()] });
    },
    subscribe(topic, callback) {
      if (topic === rejectTopic) throw new Error(`Delegate rejected ${topic}`);
      if (!subscriptions.has(topic)) subscriptions.set(topic, []);
      subscriptions.get(topic).push(callback);
    },
    unsubscribe(topic, callback) {
      const listeners = subscriptions.get(topic) ?? [];
      const first = listeners.indexOf(callback);
      if (first !== -1) listeners.splice(first, 1);
    },
  };
  function emit(topic, ...args) {
    drawing = args;
    for (const listener of [...(subscriptions.get(topic) ?? [])]) listener(...args);
  }
  function drawingEvent(id, type) {
    emit('drawing_event', id, type);
  }
  class ChartModel {
    sources = new Map();
    add(id, toolname) {
      const source = { id: () => id, toolname };
      this.sources.set(id, source);
      return source;
    }
    getLineToolById(id) {
      return this.sources.get(id) ?? null;
    }
    removeSource(source, keepPane) {
      this.sources.delete(source.id());
      drawingEvent(source.id(), 'remove');
    }
  }
  function addChart() {
    const chart = new ChartModel();
    widgets.push({ hasModel: () => true, model: () => ({ model: () => chart }) });
    return chart;
  }
  const chart = addChart();
  const frame = document.createElement('iframe');
  frame.id = 'tradingview_chart';
  document.querySelector('.chart-widget-root').replaceChildren(frame);
  const win = frame.contentWindow;
  frame.dispatchEvent(new document.defaultView.Event('load'));
  await Promise.resolve();
  const ready = [];
  win.widgetReady = callback => ready.push(callback);
  win.dispatchEvent(new win.Event('innerWindowLoad'));
  win.tradingViewApi = api;
  for (const callback of ready) callback();
  const save = () => saves.push(drawing);
  const { drawing: saveListener, study } = createListeners(save);
  function registerHostPrelude(studyCallback = study) {
    api.subscribe('onAutoSaveNeeded', save);
    api.subscribe('study_event', () => {});
    api.subscribe('study_properties_changed', studyCallback);
    api.subscribe('layout_about_to_be_changed', () => {});
    api.subscribe('layout_changed', () => {});
  }
  function registerHost(callback, studyCallback) {
    registerHostPrelude(studyCallback);
    api.subscribe('drawing_event', callback);
  }
  if (subscribeSave) registerHost(saveListener);
  return { api, chart, addChart, drawingEvent, emit, registerHost, registerHostPrelude, saveListener, saves };
}

test('user skips saves for transient order properties and removals while other subscribers see every event', async t => {
  // Given the native save callback and a separate subscriber observe the same chart.
  const { api, chart, drawingEvent, saves } = await mountWidget(chartPage(t));
  const order = chart.add('order', 'LineToolOrder');
  const received = [];
  api.subscribe('drawing_event', (...event) => received.push(event));

  // When the order changes, receives other events and is removed after detaching from the model.
  for (const type of ['properties_changed', 'click', 'move', 'create', 'hide', 'show']) drawingEvent('order', type);
  chart.removeSource(order, false);

  // Then only the two confirmed transient events are gated and Binance still handles all other types natively.
  assert.deepEqual(saves, [['order', 'create'], ['order', 'hide'], ['order', 'show']]);
  assert.deepEqual(received, ['properties_changed', 'click', 'move', 'create', 'hide', 'show', 'remove'].map(type => ['order', type]));
});

test('user saves a hand drawing that reuses an order ID including its final deletion', async t => {
  // Given an order is removed and a new manual drawing receives its old ID.
  const { chart, drawingEvent, saves } = await mountWidget(chartPage(t));
  const order = chart.add('reused', 'LineToolOrder');
  chart.removeSource(order, false);
  const manual = chart.add('reused', 'LineToolHorzLine');

  // When the last manual drawing changes and is removed, followed by unidentified events.
  drawingEvent('reused', 'properties_changed');
  chart.removeSource(manual, false);
  drawingEvent('reused', 'remove');
  drawingEvent('unknown', 'properties_changed');

  // Then the manual change, final deletion and events with no identifiable source all reach persistence.
  assert.deepEqual(saves, [
    ['reused', 'properties_changed'], ['reused', 'remove'], ['reused', 'remove'], ['unknown', 'properties_changed'],
  ]);
});

test('user retains saves when charts have conflicting drawings with the same ID', async t => {
  // Given an order and a hand drawing share one ID across the chart layout.
  const { chart, addChart, drawingEvent, saves } = await mountWidget(chartPage(t));
  const second = addChart();
  const order = chart.add('shared', 'LineToolOrder');
  const manual = second.add('shared', 'LineToolHorzLine');
  second.add('second-only', 'LineToolOrder');

  // When changes have only an ID but each chart independently removes its actual source.
  drawingEvent('shared', 'properties_changed');
  drawingEvent('second-only', 'properties_changed');
  chart.removeSource(order, false);

  // Then the ambiguous change reaches persistence while deletion of the identified order stays silent.
  assert.deepEqual(saves, [['shared', 'properties_changed']]);

  // When the other chart removes the hand drawing under the same ID.
  second.removeSource(manual, false);

  // Then the manual removal reaches persistence exactly once.
  assert.deepEqual(saves, [['shared', 'properties_changed'], ['shared', 'remove']]);
});

test('user can unsubscribe the original save callback independently for each event and widget mount', async t => {
  // Given a widget saves drawings and the same callback also listens on a separate topic.
  const page = chartPage(t);
  const first = await mountWidget(page);
  first.api.subscribe('unrelated', first.saveListener);
  const observer = [];
  first.api.subscribe('drawing_event', (...args) => observer.push(args));

  // When drawing persistence is unsubscribed and the chart is later remounted.
  first.api.unsubscribe('drawing_event', first.saveListener);
  first.drawingEvent('manual', 'properties_changed');
  first.emit('unrelated', 'retained', 'properties_changed');
  const next = await mountWidget(page);
  const order = next.chart.add('order', 'LineToolOrder');
  next.chart.removeSource(order, false);
  next.drawingEvent('manual', 'create');

  // Then native unsubscription preserves other listeners and topics and the replacement enforces its own gate.
  assert.deepEqual(first.saves, [['retained', 'properties_changed']]);
  assert.deepEqual(observer, [['manual', 'properties_changed']]);
  assert.deepEqual(next.saves, [['manual', 'create']]);
});

test('user keeps native drawing saves when chart discovery throws during subscription', async t => {
  // Given the widget is replacing its models while Binance subscribes its save listener.
  const host = await mountWidget(chartPage(t), { subscribeSave: false });
  host.api._chartWidgetCollection.getAll = () => { throw new Error('Chart layout is unavailable'); };

  // When Binance subscribes during replacement and a drawing subsequently changes.
  host.registerHost(host.saveListener);
  host.drawingEvent('manual', 'properties_changed');

  // Then the original persistence listener receives the change.
  assert.deepEqual(host.saves, [['manual', 'properties_changed']]);
});

test('user can unsubscribe each duplicate registration of the Binance save listener exactly once', async t => {
  // Given the native delegate accepts the previously recognized callback a second time.
  const { api, chart, drawingEvent, saveListener, saves } = await mountWidget(chartPage(t));
  api.subscribe('drawing_event', saveListener);
  chart.add('order', 'LineToolOrder');

  // When the same events reach both registered listeners.
  drawingEvent('order', 'properties_changed');
  drawingEvent('both', 'create');

  // Then both registrations filter order changes and independently save manual drawings.
  assert.deepEqual(saves, [['both', 'create'], ['both', 'create']]);

  // When the host removes its registrations successively using the original callback.
  api.unsubscribe('drawing_event', saveListener);
  drawingEvent('one', 'create');
  api.unsubscribe('drawing_event', saveListener);
  drawingEvent('none', 'create');

  // Then the first cancellation leaves one subscriber and the second leaves none.
  assert.deepEqual(saves, [['both', 'create'], ['both', 'create'], ['one', 'create']]);

  // When Binance resubscribes the same callback after removing its last registration.
  api.subscribe('drawing_event', saveListener);
  drawingEvent('order', 'properties_changed');
  drawingEvent('restored', 'create');

  // Then order filtering resumes and the new registration receives manual drawings exactly once.
  assert.deepEqual(saves.slice(3), [['restored', 'create']]);
});

test('user can remove every save registration after initial chart discovery failed', async t => {
  // Given the first native registration runs during a model replacement and the second after it.
  const host = await mountWidget(chartPage(t), { subscribeSave: false });
  const collection = host.api._chartWidgetCollection;
  const getAll = collection.getAll;
  collection.getAll = () => { throw new Error('Chart layout is unavailable'); };
  host.registerHost(host.saveListener);
  collection.getAll = getAll;
  host.registerHost(host.saveListener);
  host.chart.add('order', 'LineToolOrder');

  // When two registrations receive an order change before and during their cancellation.
  host.drawingEvent('order', 'properties_changed');
  host.api.unsubscribe('drawing_event', host.saveListener);
  host.drawingEvent('order', 'properties_changed');
  host.api.unsubscribe('drawing_event', host.saveListener);
  host.drawingEvent('after-last-unsubscribe', 'create');

  // Then all native callbacks remain independently cancellable on that widget.
  assert.deepEqual(host.saves, Array.from({ length: 3 }, () => ['order', 'properties_changed']));
});

test('user filters a renamed Binance listener while independent listeners of identical shape still see orders', async t => {
  // Given Binance changes four local variable names and another listener has exactly the same source shape.
  const { api, chart, drawingEvent, saves } = await mountWidget(chartPage(t), { createListeners: renamedListeners });
  const notifications = [];
  api.subscribe('drawing_event', renamedListeners(() => notifications.push('third-party')).drawing);
  const order = chart.add('order', 'LineToolOrder');

  // When order property and removal notifications are followed by a manual drawing.
  drawingEvent('order', 'properties_changed');
  chart.removeSource(order, false);
  drawingEvent('manual', 'create');

  // Then the host subscription sequence identifies persistence and the independent listener sees all three changes.
  assert.deepEqual(saves, [['manual', 'create']]);
  assert.deepEqual(notifications, ['third-party', 'third-party', 'third-party']);
});

test('user keeps native drawing delivery when the host callbacks no longer share a save target', async t => {
  // Given the host sequence is intact but the study callback now invokes a different target.
  const createListeners = save => {
    const J = { current: true };
    const other = () => {};
    return { drawing: binanceListeners(save).drawing, study: ()=>{J.current&&other()} };
  };
  const { chart, drawingEvent, registerHost, saves } = await mountWidget(chartPage(t), { createListeners });
  chart.add('order', 'LineToolOrder');

  // When a transient order changes while the host callbacks have different responsibilities.
  drawingEvent('order', 'properties_changed');

  // Then the drawing callback still receives the change.
  assert.deepEqual(saves, [['order', 'properties_changed']]);

  // When a later registration batch matches every topic and both callback bodies.
  const notifications = [];
  const later = binanceListeners(() => notifications.push('later'));
  registerHost(later.drawing, later.study);
  drawingEvent('order', 'properties_changed');

  // Then the second batch cannot replace the first host callback as the save target.
  assert.deepEqual(notifications, ['later']);
  assert.equal(saves.length, 2);
});

test('user keeps a later drawing subscription separate from an unfinished host subscription batch', async t => {
  // Given the chart registers the five preceding topics without subscribing to drawing events in that turn.
  const host = await mountWidget(chartPage(t), { subscribeSave: false });
  host.chart.add('order', 'LineToolOrder');
  host.registerHostPrelude();
  await Promise.resolve();

  // When a matching drawing listener appears in a later microtask and receives the order change.
  host.api.subscribe('drawing_event', host.saveListener);
  host.drawingEvent('order', 'properties_changed');

  // Then the later listener receives the change as an independent subscription.
  assert.deepEqual(host.saves, [['order', 'properties_changed']]);
});

test('user retains native drawing delivery after the delegate rejects part of the host subscription batch', async t => {
  // Given the native delegate refuses the layout subscription immediately preceding drawing events.
  const host = await mountWidget(chartPage(t), { subscribeSave: false, rejectTopic: 'layout_changed' });
  host.chart.add('order', 'LineToolOrder');

  // When the host observes its registration error but another drawing listener can still subscribe.
  assert.throws(() => host.registerHostPrelude(), /Delegate rejected layout_changed/);
  host.api.subscribe('drawing_event', host.saveListener);
  host.drawingEvent('order', 'properties_changed');

  // Then a failed registration does not count toward recognition of the save callback.
  assert.deepEqual(host.saves, [['order', 'properties_changed']]);
});

test('user keeps native drawing saves when the active chart cannot look up a source', async t => {
  // Given a widget successfully subscribed before its model stopped answering drawing lookups.
  const { chart, drawingEvent, saves } = await mountWidget(chartPage(t));
  chart.getLineToolById = () => { throw new Error('Chart model has been destroyed'); };

  // When Binance receives a property change from the outgoing chart.
  drawingEvent('unresolved', 'properties_changed');

  // Then the save callback persists the unidentified change.
  assert.deepEqual(saves, [['unresolved', 'properties_changed']]);
});

test('user restores order visibility even when the order change schedules zero save callbacks', async t => {
  // Given a chart with Binance's drawing-save subscription under the order-line filter.
  const { api, chart, drawingEvent, saves } = await mountWidget(chartPage(t));
  const timers = createManualTimers();

  // When restoring visibility adds the order line and emits its property change.
  const completion = coalesceChartOrderVisibilitySaves(api, () => {
    chart.add('restored-order', 'LineToolOrder');
    drawingEvent('restored-order', 'properties_changed');
  }, { timeoutMs: 100, ...timers });
  await Promise.resolve();
  timers.advance(100);
  await completion;

  // Then restoration succeeds with the order present and no native save callback requested.
  assert.deepEqual([...chart.sources.keys()], ['restored-order']);
  assert.deepEqual(saves, []);
});

test('user retains save coalescing after the gated Binance subscription is removed', async t => {
  // Given Binance removes its recognized subscription and a replacement listener requests ordinary chart saves.
  const { api, chart, drawingEvent, saveListener } = await mountWidget(chartPage(t));
  api.unsubscribe('drawing_event', saveListener);
  const timers = createManualTimers();
  const snapshots = [];
  api.subscribe('drawing_event', () => api.saveChart(snapshot => snapshots.push(snapshot)));

  // When the visibility action changes two order lines in one burst.
  const completion = coalesceChartOrderVisibilitySaves(api, () => {
    for (const id of ['first', 'second']) {
      chart.add(id, 'LineToolOrder');
      drawingEvent(id, 'properties_changed');
    }
  }, { settleQuietMs: 10, ...timers });
  await Promise.resolve();
  timers.advance(10);
  await completion;

  // Then both callbacks receive the same final drawing list from the restored coalescing workflow.
  assert.deepEqual(snapshots, [{ drawings: ['first', 'second'] }, { drawings: ['first', 'second'] }]);
});
