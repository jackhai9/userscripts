import assert from 'node:assert/strict';
import test from 'node:test';
import { createBollingerMonitor } from '../../src/binance-strategy29-bollinger/monitor.js';
import { createChartMarkerOverlay } from '../../src/shared/chart-marker-overlay.js';
import { findBearishBollingerChartTarget } from '../../src/binance-strategy29-bollinger/dom/tradingview-bearish-alerts.js';
import { createStrategy29ChartHost } from '../helpers/strategy29-runtime-boundary-host.js';
import { captureStrategyError, observeStrategyCondition } from '../helpers/strategy-migration-boundaries.js';

/** Native OHLC history exercises both real detector directions without fabricated signals. */
function history(count = 600) {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + 15 * Math.sin(index * 2 * Math.PI / 80);
    const open = index === 0 ? close : 100 + 15 * Math.sin((index - 1) * 2 * Math.PI / 80);
    return { time: (index + 1) * 60, open, high: Math.max(open, close) + 5,
      low: Math.min(open, close) - 5, close };
  });
}

/** Observe native coordinate reads while retaining every host result and exception. */
function observeProjection(host) {
  const reads = { index: 0, x: 0, price: 0, firstValue: 0 };
  for (const [object, method, key] of [
    [host.overlay.timeScale, 'timePointToIndex', 'index'],
    [host.overlay.timeScale, 'indexToCoordinate', 'x'],
    [host.overlay.priceScale, 'priceToCoordinate', 'price'],
    [host.overlay.series, 'firstValue', 'firstValue'],
  ]) {
    const original = object[method];
    object[method] = function countedProjection(...args) {
      reads[key] += 1;
      return Reflect.apply(original, this, args);
    };
  }
  return reads;
}

function monitorFixture(t, bars = history()) {
  const host = createStrategy29ChartHost({ bars });
  let busy = false;
  const errors = [], warnings = [];
  const monitor = createBollingerMonitor({
    document: host.document,
    getCurrentSymbol: () => 'BTRUSDT',
    isFuturesTradingPage: () => true,
    isTradingViewDrawingMutationBusy: () => busy,
    err: (...args) => errors.push(args),
    warn: (...args) => warnings.push(args),
  });
  t.after(() => { monitor.stop(); host.close(); });
  return {
    ...host, monitor, errors, warnings,
    setBusy(value) { busy = value; },
    async sample() {
      await monitor.tick();
      await observeStrategyCondition(() => !monitor.diagnostics.taskPending, 'complete marker sample');
    },
  };
}

function marker(overrides = {}) {
  return { id: 'warning', time: 60, price: 100, shape: 'circle', color: '#F6465D',
    size: 10, anchor: 'center', type: 'warning', direction: 'bearish', ...overrides };
}

function overlayFixture(t, options = {}) {
  const host = createStrategy29ChartHost();
  const target = findBearishBollingerChartTarget(host.document, 'BTRUSDT');
  const layer = createChartMarkerOverlay(target, { maxMarkers: 10, ...options });
  t.after(() => { layer.clear(); host.close(); });
  return { ...host, layer };
}

const current = { isCurrent: () => true };

test('user receives exact native projection results while their reads are counted', t => {
  // Given an observed host with independently specified candle and coordinate contracts
  const host = createStrategy29ChartHost();
  t.after(() => host.close());
  const reads = observeProjection(host);

  // When the native series and scales are read directly
  const index = host.overlay.timeScale.timePointToIndex(60, 0);
  const x = host.overlay.timeScale.indexToCoordinate(index);
  const y = host.overlay.priceScale.priceToCoordinate(100, host.overlay.series.firstValue());

  // Then observation preserves the exact host results and records one read each
  assert.deepEqual({ index, x, y }, { index: 0, x: 0, y: 400 });
  assert.deepEqual(reads, { index: 1, x: 1, price: 1, firstValue: 1 });
});

test('user keeps all 444 cached markers without repeated projection while every poll audits 6000 candles', async t => {
  // Given the real monitor has rendered its complete six thousand candle signal history
  const bars = history(6000);
  const host = monitorFixture(t, bars);
  host.overlay.setProjection({ time: index => index / 6 });
  const reads = observeProjection(host);
  await host.sample();
  assert.equal(host.monitor.diagnostics.cachedSignalCount, 444);
  const initialReads = { ...reads };
  const initialNodes = host.overlay.markers();
  const mutations = [];
  const observer = new host.view.MutationObserver(records => mutations.push(...records));
  observer.observe(host.overlay.pane, { attributes: true, childList: true, characterData: true, subtree: true });
  t.after(() => observer.disconnect());

  // When ten polls receive fresh native arrays containing the same complete OHLC history
  for (let index = 0; index < 10; index += 1) {
    host.setBars(bars.map(bar => ({ ...bar })));
    await host.sample();
  }

  // Then exports continue while validated markers keep their nodes and need no coordinate work
  assert.equal(host.exports.length, 11);
  assert.equal(initialNodes.length, 444);
  assert.deepEqual(host.overlay.markers(), initialNodes);
  assert.deepEqual(reads, initialReads);
  assert.equal(initialReads.firstValue, 1);
  assert.equal(host.monitor.diagnostics.markerOverlayStats.renderedFrames, 1);
  assert.equal(host.monitor.diagnostics.cachedSignalCount, 444);
  assert.equal(mutations.length + observer.takeRecords().length, 0);
  assert.deepEqual(host.errors, []);
  assert.deepEqual(host.warnings, []);
});

test('user sees a same-window historical high correction move the existing warning on the next poll', async t => {
  // Given a verified historical bearish warning from the real detector
  const bars = history();
  const host = monitorFixture(t, bars);
  await host.sample();
  const node = host.overlay.markers().find(candidate => candidate.dataset.markerId === '7620:warning');
  const before = Number(node.getAttribute('transform').match(/translate\([^ ]+ ([^)]+)\)/)[1]);
  assert.equal(host.monitor.diagnostics.cachedSignalCount, 39);

  // When a historical high changes without changing timestamps or emitting a data event
  host.setBars(bars.map(bar => bar.time === 8160 ? { ...bar, high: bar.high + 10 } : bar));
  await host.sample();

  // Then the same marker moves ten native price pixels and the full signal count is preserved
  const updated = host.overlay.markers().find(candidate => candidate.dataset.markerId === '7620:warning');
  assert.equal(updated, node);
  assert.equal(Number(updated.getAttribute('transform').match(/translate\([^ ]+ ([^)]+)\)/)[1]), before - 10);
  assert.equal(host.monitor.diagnostics.markerOverlayStats.renderedFrames, 2);
  assert.equal(host.monitor.diagnostics.cachedSignalCount, 39);
  assert.equal(host.exports.length, 2);
  assert.deepEqual(host.errors, []);
});

test('user restores the committed marker snapshot after a busy owner interrupts a historical correction', async t => {
  // Given the monitor has committed the original candle history and warning position
  const bars = history();
  const host = monitorFixture(t, bars);
  await host.sample();
  const node = host.overlay.markers().find(candidate => candidate.dataset.markerId === '7620:warning');
  const originalTransform = node.getAttribute('transform');
  const observer = new host.view.MutationObserver(() => host.setBusy(true));
  observer.observe(host.overlay.pane, { attributes: true, attributeFilter: ['transform'], subtree: true });
  t.after(() => observer.disconnect());

  // When native drawing ownership changes after a historical correction is painted
  host.setBars(bars.map(bar => bar.time === 8160 ? { ...bar, high: bar.high + 10 } : bar));
  await host.sample();

  // Then the corrected marker is visible but that sample cannot commit its candle cache
  assert.notEqual(node.getAttribute('transform'), originalTransform);
  assert.equal(host.monitor.diagnostics.markerOverlayStats.renderedFrames, 2);
  assert.equal(host.monitor.diagnostics.failed, false);

  // When ownership is released and the native candles return to the committed history
  observer.disconnect();
  host.setBusy(false);
  host.setBars(bars);
  await host.sample();
  await host.sample();

  // Then the original position returns once and later unchanged samples can reuse it
  assert.equal(node.getAttribute('transform'), originalTransform);
  assert.equal(host.monitor.diagnostics.markerOverlayStats.renderedFrames, 3);
  assert.equal(host.exports.length, 4);
  assert.equal(host.monitor.diagnostics.cachedSignalCount, 39);
  assert.deepEqual(host.errors, []);
  assert.deepEqual(host.warnings, []);
});

test('user receives a newly closed warning at its clock boundary without a native data notification', async t => {
  // Given the last native candle ends one millisecond after the first monitor sample
  t.mock.timers.enable({ apis: ['Date'], now: 8_219_999 });
  const host = monitorFixture(t, history(136));
  await host.sample();
  assert.equal(host.overlay.markers().some(node => node.dataset.markerId === '7620:warning'), false);

  // When the clock reaches the exact close while native OHLC and notifications remain unchanged
  t.mock.timers.setTime(8_220_000);
  await host.sample();

  // Then the actual detector warning appears on the newly closed candle
  assert.equal(host.overlay.markers().filter(node => node.dataset.markerId === '7620:warning').length, 1);
  assert.equal(host.exports.length, 2);
  assert.equal(host.monitor.diagnostics.markerOverlayStats.renderedFrames, 2);
  assert.deepEqual(host.errors, []);
});

test('user regains cached markers after a busy native owner suppressed an event frame', async t => {
  // Given a rendered monitor and the original owned SVG nodes
  const host = monitorFixture(t);
  await host.sample();
  const nodes = host.overlay.markers();
  const svg = host.overlay.pane.querySelector('svg');

  // When a viewport event arrives while native drawing mutation is busy
  host.setBusy(true);
  host.overlay.events.logicalRangeChanged.emit();
  host.overlay.flushFrames();

  // Then the pending presentation hides without discarding validated signals
  assert.equal(svg.style.visibility, 'hidden');
  assert.equal(host.monitor.diagnostics.markerOverlayStats.visibleMarkers, 0);
  assert.equal(host.monitor.diagnostics.cachedSignalCount, 39);

  // When the native owner finishes and the next poll contains identical candles
  host.setBusy(false);
  await host.sample();

  // Then cached presentation is restored with the same nodes and no failure
  assert.equal(svg.style.visibility, 'visible');
  assert.deepEqual(host.overlay.markers(), nodes);
  assert.equal(host.monitor.diagnostics.markerOverlayStats.visibleMarkers, 39);
  assert.equal(host.monitor.diagnostics.markerOverlayStats.renderedFrames, 2);
  assert.equal(host.exports.length, 2);
  assert.deepEqual(host.errors, []);
});

/** Replace exactly one projection identity while the active chart remains unchanged. */
function replaceProjection(host, key) {
  const { model, series, timeScale, priceScale, canvas } = host.overlay;
  const widget = host.chart._chartWidget;
  const state = model.paneForSource(series);
  const pane = widget.paneByState(state);
  if (key === 'model') {
    const replacement = { ...model };
    widget.model = () => ({ model: () => replacement });
  }
  if (key === 'series') {
    const nextSeries = { ...series };
    model.mainSeries = () => nextSeries;
    model.paneForSource = source => { assert.equal(source, nextSeries); return state; };
  }
  if (key === 'time') {
    const nextTime = { ...timeScale };
    model.timeScale = () => nextTime;
  }
  if (key === 'price') {
    const nextPrice = { ...priceScale };
    series.priceScale = () => nextPrice;
  }
  if (key === 'pane') {
    const nextPane = { ...pane };
    widget.paneByState = candidate => { assert.equal(candidate, state); return nextPane; };
  }
  if (key === 'container') {
    const nextContainer = canvas.ownerDocument.createElement('div');
    nextContainer.className = 'chart-gui-wrapper';
    host.overlay.pane.after(nextContainer);
    nextContainer.append(canvas);
  }
}

for (const key of ['model', 'series', 'time', 'price', 'pane', 'container']) {
  test(`user rejects a changed native ${key} identity even when cached markers need no redraw`, t => {
    // Given clean visible presentation bound to one native projection
    const host = overlayFixture(t);
    host.layer.render([marker()], current);

    // When the same chart replaces one native projection object without sending an event
    replaceProjection(host, key);
    const failure = captureStrategyError(() => host.layer.reconcile(current));

    // Then the precise contract change is reported and every owned resource is removed
    assert.equal(failure.message, `TradingView marker projection changed: ${key}`);
    assert.equal(host.tradingViewApi.activeChart(), host.chart);
    assert.equal(host.layer.overlayStats.attached, false);
    assert.equal(host.layer.size, 0);
    assert.equal(host.overlay.subscriptions, 0);
    assert.equal(host.intervalChanged.size, 0);
    assert.equal(host.dataLoaded.size, 0);
  });
}

test('user sees a cached monitor stop visibly when its chart model is replaced', async t => {
  // Given an unchanged monitor cache with thirty nine verified signals
  const host = monitorFixture(t);
  await host.sample();

  // When its native model is replaced before the next identical OHLC sample
  replaceProjection(host, 'model');
  await host.sample();

  // Then the monitor records a render failure and removes stale presentation
  assert.equal(host.monitor.diagnostics.failed, true);
  assert.equal(host.monitor.diagnostics.lastLocalFailure.stage, 'render');
  assert.equal(host.monitor.diagnostics.lastLocalFailure.message, 'TradingView marker projection changed: model');
  assert.equal(host.monitor.diagnostics.markerOverlayStats.attached, false);
  assert.equal(host.overlay.markers().length, 0);
  assert.equal(host.errors.length, 1);
});

test('user sees geometry changes and invalid dimensions checked during otherwise clean reconciliation', t => {
  // Given two visible cached markers in a wide native pane
  const host = overlayFixture(t);
  host.overlay.setProjection({ time: index => 100 + index * 100 });
  host.layer.render([marker(), marker({ id: 'second', time: 120 })], current);

  // When the pane narrows before its resize notification arrives
  host.overlay.pane.getBoundingClientRect = () => ({ width: 150, height: 500 });
  const rendered = host.layer.reconcile(current);

  // Then reconciliation clips the second marker and updates the pane geometry
  assert.equal(rendered, true);
  assert.deepEqual(host.overlay.markers().map(node => node.dataset.markerId), ['warning']);
  assert.equal(host.overlay.pane.querySelector('svg').getAttribute('viewBox'), '0 0 150 500');
  assert.equal(host.layer.overlayStats.renderedFrames, 2);

  // When the host later reports a nonfinite width without any native delegate
  host.overlay.pane.getBoundingClientRect = () => ({ width: NaN, height: 500 });
  const failure = captureStrategyError(() => host.layer.reconcile(current));

  // Then invalid geometry fails explicitly and clears the stale SVG
  assert.equal(failure.message, 'TradingView marker pane dimensions are invalid');
  assert.equal(host.layer.overlayStats.attached, false);
});

test('user sees native viewport data resize and visibility events redraw cached markers independently', t => {
  // Given clean presentation after the cached reconciliation path
  const host = overlayFixture(t);
  host.layer.render([marker()], current);
  assert.equal(host.layer.reconcile(current), true);
  const svg = host.overlay.pane.querySelector('svg');
  let expectedFrames = 1;

  // When every native coordinate delegate changes its projection without a detector poll
  for (const event of Object.values(host.overlay.events)) {
    host.overlay.setProjection({ time: () => expectedFrames * 10, price: () => 200 + expectedFrames });
    event.emit();
    assert.equal(host.overlay.pendingFrames, 1);
    host.overlay.flushFrames();
    assert.equal(host.overlay.markers()[0].getAttribute('transform'), `translate(${expectedFrames * 10} ${200 + expectedFrames})`);
    expectedFrames += 1;
  }
  host.overlay.setViewport(700, 350);
  host.overlay.flushFrames();
  expectedFrames += 1;

  // Then each independent event projects once and resize keeps the SVG clipped to the host
  assert.equal(host.layer.overlayStats.renderedFrames, expectedFrames);
  assert.equal(svg.getAttribute('viewBox'), '0 0 700 350');

  // When the document hides with a pending frame and then becomes visible again
  host.overlay.events.dataUpdated.emit();
  assert.equal(svg.style.visibility, 'hidden');
  host.overlay.setHidden(true);
  assert.equal(host.overlay.pendingFrames, 0);
  host.overlay.setProjection({ time: () => 90, price: () => 300 });
  host.overlay.setHidden(false);
  host.overlay.flushFrames();

  // Then visibility restores the latest coordinates without reviving an old frame
  assert.equal(svg.style.visibility, 'visible');
  assert.equal(host.overlay.markers()[0].getAttribute('transform'), 'translate(90 300)');
  assert.equal(host.layer.overlayStats.renderedFrames, expectedFrames + 1);
});

test('user can change marker content through the same input array and still receives strict validation', t => {
  // Given generic markers rendered from mutable caller-owned objects
  const host = overlayFixture(t);
  const markers = [marker(), marker({ id: 'label', shape: 'text', anchor: 'top', text: 'Original' })];
  host.layer.render(markers, current);
  const originalNodes = host.overlay.markers();

  // When the caller edits coordinates styles and text in place and renders the same array
  Object.assign(markers[0], { time: 120, price: 110, color: '#0ECB81', size: 20, direction: 'bullish' });
  Object.assign(markers[1], { text: 'Updated', price: 120, size: 14 });
  const rendered = host.layer.render(markers, current);

  // Then full render accepts the new content and updates the original keyed nodes
  assert.equal(rendered, true);
  assert.deepEqual(host.overlay.markers(), originalNodes);
  assert.equal(originalNodes[0].getAttribute('transform'), 'translate(1 390)');
  assert.equal(originalNodes[0].getAttribute('fill'), '#0ECB81');
  assert.equal(originalNodes[0].getAttribute('r'), '10');
  assert.equal(originalNodes[0].dataset.markerDirection, 'bullish');
  assert.equal(originalNodes[1].textContent, 'Updated');
  assert.equal(originalNodes[1].getAttribute('font-size'), '14');
  assert.equal(originalNodes[1].getAttribute('transform'), 'translate(0 380)');

  // When the same object is changed into an invalid point
  markers[0].price = NaN;
  const failure = captureStrategyError(() => host.layer.render(markers, current));

  // Then array identity cannot bypass input validation or retain invalid presentation
  assert.equal(failure.message, 'TradingView overlay marker contract is invalid');
  assert.equal(host.layer.overlayStats.attached, false);
});

test('user retains text and removal updates through reconciliation and rebuilds only after a new render', t => {
  // Given two generic markers and an owned visible SVG
  const host = overlayFixture(t);
  const markers = [marker(), marker({ id: 'label', shape: 'text', anchor: 'top', text: 'Original' })];
  host.layer.render(markers, current);
  const originalSvg = host.overlay.pane.querySelector('svg');

  // When the label is translated and the other marker is removed before reconciliation
  host.layer.updateText('label', 'Translated');
  host.layer.remove(['warning']);
  const reconciled = host.layer.reconcile(current);

  // Then reconciliation keeps those changes without reconstructing or projecting the removed marker
  assert.equal(reconciled, true);
  assert.equal(host.layer.size, 1);
  assert.deepEqual(host.overlay.markers().map(node => [node.dataset.markerId, node.textContent]), [['label', 'Translated']]);
  assert.equal(host.layer.overlayStats.renderedFrames, 1);

  // When a pending event is cleared and the cached presentation is reconciled again
  host.overlay.events.logicalRangeChanged.emit();
  host.layer.clear();
  const cleared = host.layer.reconcile(current);

  // Then no signal snapshot or native subscription is invented after clear
  assert.equal(cleared, false);
  assert.equal(originalSvg.isConnected, false);
  assert.equal(host.layer.size, 0);
  assert.equal(host.overlay.subscriptions, 0);
  assert.equal(host.overlay.pendingFrames, 0);

  // When the caller explicitly renders a complete new snapshot
  const rebuilt = host.layer.render(markers, current);

  // Then the layer installs one fresh SVG with the complete supplied contents
  assert.equal(rebuilt, true);
  assert.equal(host.overlay.pane.querySelectorAll('svg').length, 1);
  assert.notEqual(host.overlay.pane.querySelector('svg'), originalSvg);
  assert.deepEqual(host.overlay.markers().map(node => node.dataset.markerId), ['warning', 'label']);
  assert.equal(host.overlay.markers()[1].textContent, 'Original');
});
