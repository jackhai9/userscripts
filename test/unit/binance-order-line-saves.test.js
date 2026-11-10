import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { ORDER_LINE_CONTRACT_CHECK_MS, observeOrderLineSaves } from '../../src/binance-orderbook-trade/chart-storage/order-line-saves.js';
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
  const notified = [];
  const checks = [];
  const nativeSaves = [];
  let clock = 0;
  const snapshot = observeOrderLineSaves(window.document, {
    onContractBreak: entry => notified.push(entry),
    setTimeout(callback, delay) { checks.push({ callback, delay }); },
    now: () => clock,
    onNativeSave: () => nativeSaves.push(clock),
  });
  const document = window.document;
  // Each test page fails if a dependency break was reported but not asserted,
  // and the deferred handler must have received exactly the recorded entries.
  t.after(async () => {
    await Promise.resolve();
    assert.deepEqual(document.breaks.map(({ reason }) => reason), document.expectedBreaks);
    assert.deepEqual(notified, document.breaks);
  });
  Object.defineProperty(document, 'breaks', { get: () => snapshot().breaks });
  return Object.assign(document, {
    notified, nativeSaves, snapshot, expectedBreaks: [],
    advance(ms) { clock += ms; },
    /**
     * Runs the frame checks due at the next tick, as the 30 s timer would. JSDOM also
     * fires the frame's initial about:blank load, whose superseded check stops on its first tick.
     */
    runContractCheck() {
      const due = checks.splice(0);
      for (const { callback, delay } of due) {
        assert.equal(delay, ORDER_LINE_CONTRACT_CHECK_MS);
        callback();
      }
      return due.length;
    },
  });
}

async function mountWidget(document, { subscribeSave = true, createListeners = binanceListeners, rejectTopic, deferReady = false } = {}) {
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
  const becomeReady = () => { for (const callback of ready.splice(0)) callback(); };
  if (!deferReady) becomeReady();
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
  return { api, chart, addChart, becomeReady, drawingEvent, emit, registerHost, registerHostPrelude, saveListener, saves };
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

test('user is alerted when a chart keeps saving natively because its removal hook could not be installed', async t => {
  // Given Binance subscribes its save listener while the chart models are being replaced.
  const page = chartPage(t);
  const host = await mountWidget(page, { subscribeSave: false });
  const getAll = host.api._chartWidgetCollection.getAll;
  host.api._chartWidgetCollection.getAll = () => { throw new Error('Chart layout is unavailable'); };
  host.registerHost(host.saveListener);
  host.api._chartWidgetCollection.getAll = getAll;

  // When the frame check sees the same ready API, then waits one more tick for subscriptions.
  page.runContractCheck();
  page.runContractCheck();
  assert.deepEqual(page.breaks, []);
  assert.equal(page.runContractCheck(), 1);

  // Then the unprotected chart is reported once and no further checks are scheduled.
  page.expectedBreaks = ['removal-hook'];
  assert.equal(page.runContractCheck(), 0);
  await Promise.resolve();
  assert.deepEqual(page.notified, page.breaks);
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
  const page = chartPage(t);
  const { chart, drawingEvent, registerHost, saves } = await mountWidget(page, { createListeners });
  chart.add('order', 'LineToolOrder');

  // When a transient order changes while the host callbacks have different responsibilities.
  drawingEvent('order', 'properties_changed');

  // Then the drawing callback still receives the change and the changed listener is reported with both bodies.
  assert.deepEqual(saves, [['order', 'properties_changed']]);
  page.expectedBreaks = ['listener-shape'];
  assert.match(page.breaks[0].detail, /^study: \(\)=>\{J\.current&&other\(\)\} \| drawing: \(e,t\)=>/);

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

test('user sees no alert and no further checks once the recognized chart is judged protected', async t => {
  // Given Binance's current subscription batch was recognized.
  const page = chartPage(t);
  await mountWidget(page);

  // When the frame check runs past the confirmation tick.
  for (let tick = 0; tick < 3; tick++) page.runContractCheck();

  // Then the chart is judged protected, nothing is reported and checking stops.
  assert.equal(page.runContractCheck(), 0);
  assert.deepEqual(page.snapshot(), { matched: 1, skipped: 0, breaks: [] });
});

test('user is alerted when Binance no longer registers its save listener in the recognized batch', async t => {
  // Given the host subscribes drawing events without the preceding topic batch.
  const page = chartPage(t);
  const host = await mountWidget(page, { subscribeSave: false });
  host.api.subscribe('drawing_event', host.saveListener);
  host.chart.add('order', 'LineToolOrder');
  host.drawingEvent('order', 'properties_changed');

  // When frame checks see the same ready but unfiltered API for a full tick after readiness.
  for (let tick = 0; tick < 3; tick++) page.runContractCheck();

  // Then native saving continues and the missing batch is reported with the expected topics.
  assert.deepEqual(host.saves, [['order', 'properties_changed']]);
  page.expectedBreaks = ['subscription-batch'];
  assert.match(page.breaks[0].detail, /onAutoSaveNeeded → .* → drawing_event/);
  assert.deepEqual(page.snapshot().breaks, page.breaks);
});

test('user is alerted when TradingView chart widgets no longer expose the model lookup', async t => {
  // Given a chart model renamed its line-tool lookup before Binance subscribes.
  const page = chartPage(t);
  const host = await mountWidget(page, { subscribeSave: false });
  host.chart.getLineToolById = undefined;

  // When Binance registers its recognized save batch.
  host.registerHost(host.saveListener);
  host.drawingEvent('manual', 'create');

  // Then saves stay native and the model contract is reported once.
  assert.deepEqual(host.saves, [['manual', 'create']]);
  page.expectedBreaks = ['chart-model'];
});

test('user is alerted when order lines are removed outside the tracked removeSource path', async t => {
  // Given three filtered order lines.
  const page = chartPage(t);
  const host = await mountWidget(page);
  for (const id of ['a', 'b', 'c']) {
    host.chart.add(id, 'LineToolOrder');
    host.drawingEvent(id, 'properties_changed');
  }

  // When TradingView detaches the first two without removeSource, in separate bursts.
  for (const id of ['a', 'b']) {
    host.chart.sources.delete(id);
    host.drawingEvent(id, 'remove');
    page.advance(1000);
  }

  // Then those removals reach native persistence without an alert yet.
  assert.deepEqual(host.saves, [['a', 'remove'], ['b', 'remove']]);
  assert.deepEqual(page.breaks, []);

  // When the third known order line is detached the same way.
  host.chart.sources.delete('c');
  host.drawingEvent('c', 'remove');

  // Then the removal path change is reported once.
  page.expectedBreaks = ['removal-capture'];
  assert.match(page.breaks[0].detail, /^3 separate order-line removal bursts/);
});

test('user gets no removal alert once removeSource has captured an order removal', async t => {
  // Given one order removal went through removeSource and three other known orders did not.
  const page = chartPage(t);
  const host = await mountWidget(page);
  for (const id of ['tracked', 'a', 'b', 'c']) {
    host.chart.add(id, 'LineToolOrder');
    host.drawingEvent(id, 'properties_changed');
  }
  host.chart.removeSource(host.chart.getLineToolById('tracked'), false);

  // When the other three are detached by chart teardown outside removeSource.
  for (const id of ['a', 'b', 'c']) {
    host.chart.sources.delete(id);
    host.drawingEvent(id, 'remove');
  }

  // Then the working hook keeps those removals native without reporting a contract change.
  assert.deepEqual(host.saves, ['a', 'b', 'c'].map(id => [id, 'remove']));
  assert.deepEqual(page.breaks, []);
});

/** Mounts only the TradingView bootstrap, letting each test break one step. */
async function mountBootstrap(document, { innerWindowLoad = true, widgetReady = true, readyApi = {} } = {}) {
  const frame = document.createElement('iframe');
  frame.id = 'tradingview_bootstrap';
  document.querySelector('.chart-widget-root').replaceChildren(frame);
  const win = frame.contentWindow;
  frame.dispatchEvent(new document.defaultView.Event('load'));
  await Promise.resolve();
  const ready = [];
  if (widgetReady) win.widgetReady = callback => ready.push(callback);
  if (innerWindowLoad) win.dispatchEvent(new win.Event('innerWindowLoad'));
  return {
    win,
    becomeReady() {
      win.tradingViewApi = readyApi;
      for (const callback of ready.splice(0)) callback();
    },
  };
}

test('user is alerted when the TradingView bootstrap no longer defines widgetReady', async t => {
  // Given a chart page observing TradingView frames.
  const page = chartPage(t);

  // When the bootstrap document finishes without the readiness hook.
  await mountBootstrap(page, { widgetReady: false });

  // Then the bootstrap change is reported immediately.
  page.expectedBreaks = ['bootstrap'];
  assert.match(page.breaks[0].detail, /widgetReady/);
});

test('user is alerted when the chart API appears without the innerWindowLoad hook ever running', async t => {
  // Given Binance stopped dispatching innerWindowLoad but still publishes the chart API.
  const page = chartPage(t);
  const host = await mountBootstrap(page, { innerWindowLoad: false });
  host.win.tradingViewApi = {};

  // When two frame checks see the same API.
  page.runContractCheck();
  assert.deepEqual(page.breaks, []);
  page.runContractCheck();

  // Then the missing hook is reported.
  page.expectedBreaks = ['bootstrap'];
  assert.match(page.breaks[0].detail, /innerWindowLoad → widgetReady/);
});

test('user sees no alert while a slow chart is still waiting for widgetReady', async t => {
  // Given the readiness hook is armed but chart storage delays the widget for minutes.
  const page = chartPage(t);
  const host = await mountBootstrap(page);
  host.win.tradingViewApi = {};

  // When many frame checks pass before readiness.
  page.runContractCheck();
  for (let tick = 0; tick < 5; tick++) assert.equal(page.runContractCheck(), 1);

  // Then nothing is reported and checks continue.
  assert.deepEqual(page.breaks, []);
  assert.equal(page.runContractCheck(), 1);
});

test('user is alerted when the ready chart API lacks the subscription surface', async t => {
  // Given widgetReady delivers an API without subscribe and unsubscribe.
  const page = chartPage(t);
  const host = await mountBootstrap(page, { readyApi: { _chartWidgetCollection: { getAll: () => [] } } });

  // When the chart becomes ready.
  host.becomeReady();

  // Then the API shape is reported once, and later checks do not add a second reason.
  page.runContractCheck();
  page.runContractCheck();
  page.expectedBreaks = ['api-shape'];
});

test('user sees no bootstrap alert when the chart frame loads again while its first widgetReady is pending', async t => {
  // Given the bootstrap armed widgetReady and the frame then fires its final load before readiness.
  const page = chartPage(t);
  const host = await mountBootstrap(page);
  const frame = page.querySelector('iframe');
  frame.dispatchEvent(new page.defaultView.Event('load'));
  await Promise.resolve();
  host.win.tradingViewApi = {};

  // When chart storage delays readiness across many checks of the newer load.
  page.runContractCheck();
  for (let tick = 0; tick < 4; tick++) page.runContractCheck();

  // Then the still-pending callback defers judgment instead of reporting a missing hook.
  assert.deepEqual(page.breaks, []);
});

test('user gets a full tick for Binance to subscribe after a chart becomes ready between checks', async t => {
  // Given a slow chart whose API is published before widgetReady.
  const page = chartPage(t);
  const host = await mountWidget(page, { subscribeSave: false, deferReady: true });
  page.runContractCheck();
  page.runContractCheck();

  // When readiness lands just before a tick, and Binance subscribes after that tick.
  host.becomeReady();
  page.runContractCheck();
  host.registerHost(host.saveListener);
  page.runContractCheck();

  // Then the widget is judged protected and checking stops without a report.
  assert.deepEqual(page.breaks, []);
  assert.equal(page.runContractCheck(), 0);
});

test('user gets no removal alert when a chart teardown removes many order lines in one burst', async t => {
  // Given four filtered order lines and no captured removal yet.
  const page = chartPage(t);
  const host = await mountWidget(page);
  for (const id of ['a', 'b', 'c', 'd']) {
    host.chart.add(id, 'LineToolOrder');
    host.drawingEvent(id, 'properties_changed');
  }

  // When a teardown detaches all of them outside removeSource within one second.
  for (const id of ['a', 'b', 'c', 'd']) {
    host.chart.sources.delete(id);
    host.drawingEvent(id, 'remove');
    page.advance(100);
  }

  // Then the removals save natively as one burst without reporting the hook.
  assert.equal(host.saves.length, 4);
  assert.deepEqual(page.breaks, []);
});

test('user gets no removal alert for hand drawings removed while removeSource never captured an order', async t => {
  // Given a protected chart whose drawings were never seen as order lines.
  const page = chartPage(t);
  const host = await mountWidget(page);

  // When three manual drawings are removed in separate bursts.
  for (const id of ['h1', 'h2', 'h3']) {
    host.drawingEvent(id, 'remove');
    page.advance(1000);
  }

  // Then they save natively and nothing is reported.
  assert.deepEqual(host.saves, ['h1', 'h2', 'h3'].map(id => [id, 'remove']));
  assert.deepEqual(page.breaks, []);
});

test('user sees no alert after Binance unsubscribes its recognized save listener', async t => {
  // Given the recognized listener was removed by Binance.
  const page = chartPage(t);
  const host = await mountWidget(page);
  host.api.unsubscribe('drawing_event', host.saveListener);

  // When the frame check judges the widget.
  for (let tick = 0; tick < 3; tick++) page.runContractCheck();

  // Then no dependency break is reported and checking stops.
  assert.deepEqual(page.breaks, []);
  assert.equal(page.runContractCheck(), 0);
});

test('user sees one alert per changed dependency even when it recurs', async t => {
  // Given a recognized chart whose collection later stops returning a widget list.
  const page = chartPage(t);
  const host = await mountWidget(page);
  host.api._chartWidgetCollection.getAll = () => null;

  // When two drawing changes need the model lookup, and the frame check later judges the widget.
  host.drawingEvent('x', 'properties_changed');
  host.drawingEvent('y', 'properties_changed');
  for (let tick = 0; tick < 3; tick++) page.runContractCheck();

  // Then both changes save natively and the model change is reported once.
  assert.deepEqual(host.saves, [['x', 'properties_changed'], ['y', 'properties_changed']]);
  page.expectedBreaks = ['chart-model'];
});

test('user sees no batch alert in addition to a reported listener-shape change', async t => {
  // Given the host batch completed with a changed drawing callback.
  const page = chartPage(t);
  const createListeners = save => ({ study: binanceListeners(save).study, drawing: (id, type) => save(id, type) });
  await mountWidget(page, { createListeners });

  // When the frame check later finds the widget unfiltered.
  for (let tick = 0; tick < 3; tick++) page.runContractCheck();

  // Then only the specific listener-shape change is reported.
  page.expectedBreaks = ['listener-shape'];
});

test('user is alerted when the model prototype no longer has a writable removeSource', async t => {
  // Given TradingView moved removeSource off the model prototype.
  const page = chartPage(t);
  const host = await mountWidget(page, { subscribeSave: false });
  const owner = Object.getPrototypeOf(host.chart);
  const removeSource = owner.removeSource;
  delete owner.removeSource;
  t.after(() => { owner.removeSource = removeSource; });

  // When Binance registers its save batch.
  host.registerHost(host.saveListener);

  // Then the removal hook change is reported immediately.
  page.expectedBreaks = ['removal-hook'];
});

test('user is alerted when widgetReady runs without the chart API', async t => {
  // Given the bootstrap hook fires but the API global was renamed.
  const page = chartPage(t);
  const host = await mountBootstrap(page, { readyApi: null });

  // When the chart becomes ready.
  host.becomeReady();

  // Then the missing API is reported.
  page.expectedBreaks = ['bootstrap'];
  assert.match(page.breaks[0].detail, /missing when widgetReady runs/);
});

test('user is alerted when TradingView renames the order line tool', async t => {
  // Given a protected chart whose order lines now use a different tool name.
  const page = chartPage(t);
  const host = await mountWidget(page);
  host.chart.add('renamed', 'LineToolOrderV2');
  host.chart.add('trend', 'LineToolTrendLine');

  // When the renamed order line and a hand drawing change.
  host.drawingEvent('renamed', 'properties_changed');
  host.drawingEvent('trend', 'properties_changed');

  // Then both save natively and only the order-like rename is reported.
  assert.equal(host.saves.length, 2);
  page.expectedBreaks = ['order-tool-name'];
  assert.match(page.breaks[0].detail, /LineToolOrderV2/);
});

test('user is alerted when drawing events use an undocumented type', async t => {
  // Given a protected chart.
  const page = chartPage(t);
  const host = await mountWidget(page);

  // When TradingView emits an event type outside its documented set.
  host.drawingEvent('order', 'line_updated');

  // Then the event still reaches Binance and the new type is reported.
  assert.deepEqual(host.saves, [['order', 'line_updated']]);
  page.expectedBreaks = ['event-type'];
});

test('user is alerted when the chart API moves to a frame outside the recognized selector', async t => {
  // Given Binance renamed the chart frame so the bootstrap hook is never armed.
  const page = chartPage(t);
  const frame = page.createElement('iframe');
  frame.id = 'tv_chart_container';
  page.querySelector('.chart-widget-root').replaceChildren(frame);
  frame.dispatchEvent(new page.defaultView.Event('load'));
  frame.contentWindow.tradingViewApi = {};

  // When two frame checks see the same chart API.
  page.runContractCheck();
  page.runContractCheck();

  // Then the selector change is reported with the frame's new id.
  page.expectedBreaks = ['bootstrap'];
  assert.match(page.breaks[0].detail, /id: tv_chart_container/);
});

test('user is alerted when chart lookups keep failing in separate bursts', async t => {
  // Given a protected chart whose model lookup starts throwing.
  const page = chartPage(t);
  const host = await mountWidget(page);
  host.chart.getLineToolById = () => { throw new TypeError('getLineToolById is broken'); };

  // When two bursts of failing changes arrive, each with several events.
  for (let burst = 0; burst < 2; burst++) {
    for (const id of ['a', 'b', 'c']) host.drawingEvent(id, 'properties_changed');
    page.advance(5000);
  }

  // Then a chart replacement's bursts alone are not reported, and changes keep saving natively.
  assert.deepEqual(page.breaks, []);
  assert.equal(host.saves.length, 6);

  // When a third separate burst fails.
  host.drawingEvent('d', 'properties_changed');

  // Then the persistent lookup failure is reported with the error.
  page.expectedBreaks = ['lookup-error'];
  assert.match(page.breaks[0].detail, /TypeError: getLineToolById is broken/);
});

test('user is alerted when the TradingView frame becomes cross-origin', async t => {
  // Given a chart frame whose document the page cannot read.
  const page = chartPage(t);
  const frame = page.createElement('iframe');
  frame.id = 'tradingview_cross';
  page.querySelector('.chart-widget-root').replaceChildren(frame);
  Object.defineProperty(frame, 'contentDocument', { get: () => null });

  // When it finishes loading.
  frame.dispatchEvent(new page.defaultView.Event('load'));

  // Then the bootstrap change is reported.
  page.expectedBreaks = ['bootstrap'];
  assert.match(page.breaks[0].detail, /tradingview_cross is not same-origin/);
});

test('user write filter learns of every native save request except clicks, moves and filtered order changes', async t => {
  // Given a protected chart with a live order line.
  const page = chartPage(t);
  const host = await mountWidget(page);
  host.chart.add('order', 'LineToolOrder');

  // When clicks, moves, a filtered order change and two saving events arrive.
  for (const type of ['click', 'move', 'properties_changed']) host.drawingEvent('order', type);
  host.drawingEvent('manual', 'create');
  page.advance(10);
  host.drawingEvent('manual', 'properties_changed');

  // Then only the two events that reach Binance's save are announced.
  assert.deepEqual(page.nativeSaves, [0, 10]);
});

test('user sees no lookup alert when chart replacements fail briefly between successful lookups', async t => {
  // Given a protected chart whose model is replaced several times during a long session.
  const page = chartPage(t);
  const host = await mountWidget(page);
  host.chart.add('order', 'LineToolOrder');
  const lookup = host.chart.getLineToolById.bind(host.chart);

  // When each replacement throws once and the next change succeeds again.
  for (let replacement = 0; replacement < 5; replacement++) {
    host.chart.getLineToolById = () => { throw new Error('Chart model has been destroyed'); };
    host.drawingEvent('order', 'properties_changed');
    host.chart.getLineToolById = lookup;
    page.advance(5000);
    host.drawingEvent('order', 'properties_changed');
  }

  // Then transient failures are not reported and order changes stay filtered after each recovery.
  assert.deepEqual(page.breaks, []);
  assert.equal(page.snapshot().skipped, 5);
});

test('user sees no alert when a chart frame is removed before its bootstrap load is handled', async t => {
  // Given a recognized chart frame whose load has just fired.
  const page = chartPage(t);
  const frame = page.createElement('iframe');
  frame.id = 'tradingview_removed';
  page.querySelector('.chart-widget-root').replaceChildren(frame);
  frame.dispatchEvent(new page.defaultView.Event('load'));

  // When a symbol switch removes it before the deferred load handling runs.
  frame.remove();
  // Chrome detaches a removed frame's document; JSDOM keeps it.
  Object.defineProperty(frame, 'contentDocument', { get: () => null });
  await Promise.resolve();

  // Then nothing is reported.
  assert.deepEqual(page.breaks, []);
});

test('user is alerted when the chart frame turns cross-origin after its bootstrap', async t => {
  // Given a recognized chart frame that loaded same-origin.
  const page = chartPage(t);
  const frame = page.createElement('iframe');
  frame.id = 'tradingview_moved';
  page.querySelector('.chart-widget-root').replaceChildren(frame);
  frame.dispatchEvent(new page.defaultView.Event('load'));

  // When its final load is on another origin.
  Object.defineProperty(frame, 'contentDocument', { get: () => null });
  frame.dispatchEvent(new page.defaultView.Event('load'));
  await Promise.resolve();

  // Then the change is reported with both possible causes.
  page.expectedBreaks = ['bootstrap'];
  assert.match(page.breaks[0].detail, /tradingview_moved is not same-origin \(moved to another origin, or a network error page\)/);
});
