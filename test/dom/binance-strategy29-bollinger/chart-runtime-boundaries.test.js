import assert from 'node:assert/strict';
import test from 'node:test';
import { createBollingerMonitor } from '../../../src/binance-strategy29-bollinger/monitor.js';
import { detectBollingerSignals } from '../../../src/binance-strategy29-bollinger/core/bearish-bollinger-pattern.js';
import {
  bollingerIntervalVisibility, buildClosedBarsContentSnapshot, createBollingerIntervalSession,
  createBollingerMarkerLayer, exportClosedTradingViewBars, findBearishBollingerChartTarget,
  isBearishBollingerChartTargetCurrent, matchesClosedBarsContentSnapshot, parseClosedTradingViewBars,
} from '../../../src/binance-strategy29-bollinger/dom/tradingview-bearish-alerts.js';
import {
  createOscillatingStrategyBars, createStrategy29ChartHost, exportStrategyBars,
} from '../../helpers/strategy29-runtime-boundary-host.js';
import { installStrategyClock, observeStrategyCondition } from '../../helpers/strategy-migration-boundaries.js';

function monitorFixture(t, options) {
  const host = createStrategy29ChartHost(options);
  const clock = installStrategyClock(t, host.view, 20_000_000);
  const state = { route: 'BTRUSDT', futures: true, busy: false };
  const errors = [];
  const warnings = [];
  const monitor = createBollingerMonitor({
    document: host.document,
    getCurrentSymbol: () => state.route,
    isFuturesTradingPage: () => state.futures,
    isTradingViewDrawingMutationBusy: () => state.busy,
    err: (...values) => errors.push(values),
    warn: (...values) => warnings.push(values),
  });
  t.after(() => { state.busy = false; monitor.stop(); host.close(); });
  return { host, clock, state, errors, warnings, monitor };
}

async function sample(fixture) {
  await fixture.monitor.tick();
  await observeStrategyCondition(() => {
    fixture.clock.advance(0);
    return !fixture.monitor.diagnostics.taskPending;
  }, 'native export and marker rendering complete');
}

test('user sees both directions and reversal markers calculated from native OHLC candles', async (t) => {
  // Given real oscillating OHLC candles and an unrelated user drawing.
  const fixture = monitorFixture(t);
  const { host, monitor } = fixture;
  host.addForeignShape('user-line');

  // When the real monitor exports candles and runs its detector and drawing layer.
  await sample(fixture);

  // Then each calculated event uses its directional shape and the pending shape starts hidden.
  assert.deepEqual(host.created.map(({ point, options }) => [point.time, options.shape, options.overrides.color]), [
    [7440, 'icon', '#F6465D'], [7500, 'arrow_down', '#F6465D'], [7740, 'arrow_up', '#0ECB81'],
    [9360, 'icon', '#0ECB81'], [9900, 'arrow_down', '#F6465D'],
  ]);
  assert.equal(host.created.every(({ options }) => options.overrides.visible === false && options.disableSave === true), true);
  assert.deepEqual(host.propertyWrites.map(({ properties }) => properties.visible), [true, true, true, true, true]);
  assert.equal(monitor.diagnostics.cachedSignalCount, 5);
  assert.equal(monitor.diagnostics.layerSize, 5);
  assert.deepEqual(fixture.errors, []);

  // When an explicit chart save and a repeated sample use the same candle content.
  let saved;
  host.tradingViewApi.saveChart(value => { saved = value; }, { explicit: true });
  await sample(fixture);

  // Then user drawings are saved and unchanged strategy markers are reused.
  assert.deepEqual(saved, { drawings: [{ id: 'user-line' }] });
  assert.equal(host.created.length, 5);
  assert.deepEqual(host.removed, []);
  assert.equal(host.exports.length, 2);
});

test('user removes obsolete strategy markers when revised native candles contain no signals', async (t) => {
  // Given rendered strategy signals beside one user-owned line.
  const fixture = monitorFixture(t);
  fixture.host.addForeignShape('user-line');
  await sample(fixture);

  // When the same native window is corrected to valid flat-price candles.
  fixture.host.setBars(createOscillatingStrategyBars().map(bar => ({ ...bar, open: 100, close: 100, high: 101, low: 99 })));
  await sample(fixture);

  // Then only the former strategy drawings are removed and the empty result is cached.
  assert.deepEqual(fixture.host.removed, ['native-1', 'native-2', 'native-3', 'native-4', 'native-5']);
  assert.deepEqual(fixture.host.chart.getAllShapes(), [{ id: 'user-line', name: 'trend_line' }]);
  assert.equal(fixture.monitor.diagnostics.cachedSignalCount, 0);
  assert.equal(fixture.monitor.diagnostics.layerSize, 0);
  assert.deepEqual(fixture.errors, []);
});

for (const [label, properties] of [
  ['icon', { icon: 0xf110 }],
  ['interval visibility', { intervalsVisibilities: { minutes: false } }],
]) {
  test(`user repairs an externally changed marker ${label} without duplicating other signals`, async (t) => {
    // Given five real signals whose first native drawing has been edited externally.
    const fixture = monitorFixture(t);
    await sample(fixture);
    fixture.host.editProperties('native-1', properties);

    // When the unchanged candle window is audited again.
    await sample(fixture);

    // Then the changed drawing is replaced and the complete real marker contract is restored.
    assert.deepEqual(fixture.host.removed, ['native-1']);
    assert.equal(fixture.host.created.length, 6);
    assert.equal(fixture.monitor.diagnostics.layerSize, 5);
    assert.deepEqual(fixture.host.shapes.get('native-6').getProperties(), {
      visible: true, intervalsVisibilities: bollingerIntervalVisibility('1'), color: '#F6465D', size: 10, icon: 0xf111,
    });
  });
}

test('user stops publishing markers when native property writes are declined and clears the pending drawing', async (t) => {
  // Given a native chart that accepts creation but declines property writes.
  const fixture = monitorFixture(t);
  fixture.host.addForeignShape('user-line');
  fixture.host.ignorePropertyWrites(true);

  // When the real monitor tries to reveal its first signal marker.
  await sample(fixture);

  // Then the unpublished marker is removed and diagnostics identify the fatal render failure.
  assert.deepEqual(fixture.host.removed, ['native-1']);
  assert.deepEqual(fixture.host.chart.getAllShapes(), [{ id: 'user-line', name: 'trend_line' }]);
  assert.equal(fixture.monitor.diagnostics.failed, true);
  assert.equal(fixture.monitor.diagnostics.cleanupPending, true);
  assert.equal(fixture.monitor.diagnostics.lastLocalFailure.stage, 'render');
  assert.equal(fixture.monitor.diagnostics.lastLocalFailure.message, 'TradingView Bollinger alert marker properties were not applied');
  assert.equal(fixture.monitor.diagnostics.cachedSignalCount, null);
  assert.equal(fixture.errors.length, 1);
});

test('user receives a fatal native-property diagnostic before old owned markers are cleaned on the next sample', async (t) => {
  // Given an established signal layer whose native property readback becomes invalid.
  const fixture = monitorFixture(t);
  fixture.host.addForeignShape('user-line');
  await sample(fixture);
  fixture.host.setNativeProperties('native-1', null);

  // When the next real audit reads the malformed external properties.
  await sample(fixture);

  // Then the existing layer is marked for cleanup without losing the original failure stage.
  assert.equal(fixture.monitor.diagnostics.lastLocalFailure.message, 'TradingView Bollinger alert marker properties are invalid');
  assert.equal(fixture.monitor.diagnostics.lastLocalFailure.layerSizeBeforeCleanup, 5);
  assert.equal(fixture.monitor.diagnostics.cleanupPending, true);

  // When another sample applies the queued cleanup.
  await sample(fixture);

  // Then all owned markers disappear, the foreign line survives, and no export is retried in the failed context.
  assert.deepEqual(fixture.host.chart.getAllShapes(), [{ id: 'user-line', name: 'trend_line' }]);
  assert.equal(fixture.monitor.diagnostics.layerSize, 0);
  assert.equal(fixture.monitor.diagnostics.cleanupPending, false);
  assert.equal(fixture.host.exports.length, 2);
});

for (const invalidId of ['', 42]) {
  test(`user stops after a native marker creation returns ${invalidId === '' ? 'an empty ID' : 'a numeric ID'}`, async (t) => {
    // Given a native creation response that violates the external chart contract.
    const fixture = monitorFixture(t);
    fixture.host.returnNextCreationId(invalidId);

    // When the first detected marker awaits that native response.
    await sample(fixture);

    // Then no ID is claimed or removed and the render failure is retained.
    assert.equal(fixture.monitor.diagnostics.lastLocalFailure.message, 'TradingView returned an invalid Bollinger alert shape id');
    assert.equal(fixture.monitor.diagnostics.failed, true);
    assert.equal(fixture.monitor.diagnostics.layerSize, 0);
    assert.equal(fixture.host.created.length, 1);
    assert.deepEqual(fixture.host.removed, []);
    assert.equal(fixture.host.shapes.size, 0);
  });
}

test('user discards a marker whose native readback races leaving the futures page', async (t) => {
  // Given a real signal whose native point read occurs as the route is retired.
  const fixture = monitorFixture(t);
  fixture.host.onNextPointRead(() => { fixture.state.futures = false; });

  // When marker creation finishes and the layer reads its point.
  await sample(fixture);

  // Then the pending drawing never becomes visible and is removed without recording a terminal error.
  assert.equal(fixture.host.created.length, 1);
  assert.deepEqual(fixture.host.propertyWrites, []);
  assert.deepEqual(fixture.host.removed, ['native-1']);
  assert.equal(fixture.monitor.diagnostics.cachedSignalCount, null);
  assert.equal(fixture.monitor.diagnostics.failed, false);
  assert.deepEqual(fixture.errors, []);
});

test('user defers retired drawing cleanup while another drawing owner is busy and resumes afterward', async (t) => {
  // Given real signal candles whose first native marker creation is still pending.
  const fixture = monitorFixture(t);
  const gate = fixture.host.holdNextCreation();
  await fixture.monitor.tick();
  await gate.entered;

  // When stop invalidates that context while the host reports a drawing owner as busy.
  fixture.state.busy = true;
  fixture.monitor.stop();
  gate.release();
  await observeStrategyCondition(() => !fixture.monitor.diagnostics.taskPending, 'retired native creation settles');

  // Then the late result remains owned and hidden while mutation is deferred.
  assert.equal(fixture.monitor.diagnostics.contextPresent, false);
  assert.equal(fixture.monitor.diagnostics.retiredCount, 1);
  assert.equal(fixture.host.shapes.get('native-1').properties.visible, false);
  assert.deepEqual(fixture.host.removed, []);
  assert.deepEqual(fixture.host.propertyWrites, []);

  // When the drawing owner releases the page and the monitor samples again.
  fixture.state.busy = false;
  await sample(fixture);

  // Then the retired result is removed before one fresh complete layer is published.
  assert.deepEqual(fixture.host.removed, ['native-1']);
  assert.equal(fixture.monitor.diagnostics.retiredCount, 0);
  assert.equal(fixture.monitor.diagnostics.cachedSignalCount, 5);
  assert.equal(fixture.monitor.diagnostics.layerSize, 5);
  assert.equal(fixture.host.shapes.size, 5);
});

test('user ignores a late export error from a retired interval and renders the fresh interval', async (t) => {
  // Given a pending native export in the one-minute interval.
  const fixture = monitorFixture(t);
  const gate = fixture.host.holdNextExport();
  await fixture.monitor.tick();
  await gate.entered;

  // When the chart completes a five-minute transition before the old export rejects.
  fixture.host.changeInterval('5');
  fixture.host.setBars(createOscillatingStrategyBars().map(bar => ({ ...bar, time: bar.time * 5 })));
  fixture.host.finishData();
  fixture.clock.setTime(100_000_000);
  await fixture.monitor.tick();
  gate.reject(new Error('retired one-minute export'));
  await observeStrategyCondition(() => !fixture.monitor.diagnostics.taskPending, 'old export rejection settles');
  await sample(fixture);

  // Then the stale failure is ignored and every published marker belongs to the new interval.
  assert.deepEqual(fixture.errors, []);
  assert.equal(fixture.monitor.diagnostics.lastLocalFailure, null);
  assert.equal(fixture.monitor.diagnostics.failed, false);
  assert.equal(fixture.monitor.diagnostics.layerSize, 5);
  assert.deepEqual(fixture.host.created.map(({ point }) => point.time), [37200, 37500, 38700, 46800, 49500]);
  assert.equal(fixture.host.created.every(({ options }) => options.overrides.intervalsVisibilities.minutesFrom === 5), true);
});

for (const [label, reason, thrownType, name, message] of [
  ['a string', 'native export rejected', 'string', null, 'native export rejected'],
  ['null', null, 'null', null, null],
  ['a numeric field object', { name: 7, message: 8 }, 'object', null, null],
]) {
  test(`user receives bounded diagnostics when the native export rejects with ${label}`, async (t) => {
    // Given a native export rejection with a supported JavaScript rejection type.
    const fixture = monitorFixture(t);
    fixture.host.failNextExport(reason);

    // When the real monitor receives the external rejection.
    await sample(fixture);

    // Then the exact rejection type is retained without inventing a string or signal cache.
    assert.deepEqual(fixture.monitor.diagnostics.lastLocalFailure, {
      thrownType, classificationFailed: false, name, message, unreadableFields: [], stage: 'export',
      routeSymbol: 'BTRUSDT', resolution: '1', cachedSignalCount: null, layerSizeBeforeCleanup: 0,
      sessionRevision: 0, contextIntervalRevision: 0,
    });
    assert.equal(fixture.monitor.diagnostics.failed, true);
    assert.equal(fixture.errors.length, 1);
    assert.equal(fixture.errors[0][1], reason);
    assert.deepEqual(fixture.host.created, []);
  });
}

test('user waits through hidden pages, missing routes, busy drawings and an incomplete native interval', async (t) => {
  // Given a visible chart and real monitor that has not yet exported any candles.
  const fixture = monitorFixture(t);

  // When each native readiness boundary temporarily prevents a sample.
  fixture.host.setHidden(true);
  await sample(fixture);
  fixture.host.setHidden(false);
  fixture.state.route = null;
  await sample(fixture);
  fixture.state.route = 'BTRUSDT';
  fixture.state.busy = true;
  await sample(fixture);
  fixture.state.busy = false;
  fixture.host.changeInterval('1');
  await sample(fixture);

  // Then no premature export or marker is created.
  assert.equal(fixture.host.exports.length, 0);
  assert.equal(fixture.host.created.length, 0);
  assert.equal(fixture.monitor.diagnostics.contextPresent, false);

  // When native data completion and normal drawing ownership become observable.
  fixture.host.finishData();
  await sample(fixture);
  fixture.state.busy = true;
  await sample(fixture);

  // Then the completed interval renders once and an established busy layer remains untouched.
  assert.equal(fixture.host.exports.length, 1);
  assert.equal(fixture.host.created.length, 5);
  assert.equal(fixture.monitor.diagnostics.layerSize, 5);
});

test('user waits for a closed candle and discards an export when the page becomes hidden', async (t) => {
  // Given a native export window whose first candle is still open.
  const fixture = monitorFixture(t, { bars: createOscillatingStrategyBars(1) });
  fixture.clock.setTime(119_999);
  await sample(fixture);
  const gate = fixture.host.holdNextExport();

  // When the next sample is hidden while awaiting the native export.
  await fixture.monitor.tick();
  await gate.entered;
  fixture.host.setHidden(true);
  gate.resolve(exportStrategyBars(createOscillatingStrategyBars()));
  await observeStrategyCondition(() => !fixture.monitor.diagnostics.taskPending, 'hidden export settles');

  // Then neither an open candle nor a hidden response commits detector output.
  assert.equal(fixture.host.exports.length, 2);
  assert.equal(fixture.monitor.diagnostics.cachedSignalCount, null);
  assert.deepEqual(fixture.host.created, []);
  assert.deepEqual(fixture.errors, []);
});

for (const transition of ['interval', 'symbol', 'disposed']) {
  test(`user rejects a held native candle export after its ${transition} context changes`, async (t) => {
    // Given a real interval session and a held external export.
    const host = createStrategy29ChartHost();
    const target = findBearishBollingerChartTarget(host.document, 'BTRUSDT');
    const session = createBollingerIntervalSession(host.chart);
    t.after(() => { session.dispose(); host.close(); });
    const gate = host.holdNextExport();
    const pending = exportClosedTradingViewBars(target, session, 20_000_000);
    await gate.entered;

    // When the native context retires before its OHLC response arrives.
    if (transition === 'interval') { host.changeInterval('5'); host.finishData(); }
    if (transition === 'symbol') host.setSymbol('BTCUSDT@PRICETYPE=LAST');
    if (transition === 'disposed') session.dispose();
    gate.resolve(exportStrategyBars(createOscillatingStrategyBars()));
    const result = await pending;

    // Then the late bars are discarded and disposal removes both owned native subscriptions exactly once.
    assert.equal(result, null);
    session.dispose();
    session.dispose();
    assert.equal(host.intervalChanged.size, 0);
    assert.equal(host.dataLoaded.size, 0);
    assert.equal(host.exports.length, 1);
  });
}

test('user stops recognizing a chart target when the native chart or its model disappears', (t) => {
  // Given a fully initialized native target.
  const host = createStrategy29ChartHost();
  t.after(() => host.close());
  const target = findBearishBollingerChartTarget(host.document, 'BTRUSDT');

  // When the active chart and model become unavailable at separate host lifecycle boundaries.
  host.setActiveChart(null);
  const missingChart = isBearishBollingerChartTargetCurrent(host.document, target);
  host.setActiveChart(host.chart);
  host.setModelReady(false);
  const missingModel = isBearishBollingerChartTargetCurrent(host.document, target);
  host.setModelReady(true);
  const restored = isBearishBollingerChartTargetCurrent(host.document, target);

  // Then only the restored native chart is current.
  assert.deepEqual({ missingChart, missingModel, restored }, { missingChart: false, missingModel: false, restored: true });
});

for (const [resolution, unit, count] of [['10S', 'seconds', 10], ['1D', 'days', 1], ['2H', 'hours', 2], ['90', 'hours', 1]]) {
  test(`user keeps ${resolution} markers visible only in their native interval bucket`, () => {
    // Given an observed native interval that the chart groups into one visibility bucket.
    const interval = resolution;

    // When the production adapter computes the drawing visibility contract.
    const visibility = bollingerIntervalVisibility(interval);

    // Then exactly that native unit and count are enabled.
    assert.deepEqual(visibility, {
      ticks: false, seconds: false, minutes: false, hours: false, days: false, weeks: false,
      months: false, ranges: false, [unit]: true, [`${unit}From`]: count, [`${unit}To`]: count,
    });
  });
}

for (const [label, change, expected] of [
  ['schema', value => { value.schema = null; }, /export schema is invalid/],
  ['data list', value => { value.data = {}; }, /export data is invalid/],
  ['row', value => { value.data[0] = null; }, /export row 0 is invalid/],
  ['time', value => { value.data[0][0] = 60.5; }, /export time 0 is invalid/],
  ['close', value => { value.data[0][4] = null; }, /export close 0 is invalid/],
]) {
  test(`user receives a specific error for a malformed native export ${label}`, async (t) => {
    // Given a declared malformed native response without repairing its fields in the host.
    const fixture = monitorFixture(t);
    const exported = exportStrategyBars(createOscillatingStrategyBars(2));
    change(exported);
    fixture.host.exportNext(exported);

    // When the real monitor parses the exported response.
    await sample(fixture);

    // Then the external contract failure stops this context before detector or drawing work.
    assert.match(fixture.monitor.diagnostics.lastLocalFailure.message, expected);
    assert.equal(fixture.monitor.diagnostics.lastLocalFailure.stage, 'export');
    assert.equal(fixture.monitor.diagnostics.failed, true);
    assert.deepEqual(fixture.host.created, []);
  });
}

test('user rejects off-grid weekly and mis-spaced multi-day exports while accepting valid calendar phases', () => {
  // Given valid OHLC rows anchored on Monday and a multi-day grid unrelated to the Unix epoch phase.
  const monday = Date.UTC(2026, 8, 14) / 1000;
  const bar = { open: 100, high: 102, low: 99, close: 101 };
  const weekly = exportStrategyBars([{ ...bar, time: monday }, { ...bar, time: monday + 604800 }]);
  const multiDay = exportStrategyBars([{ ...bar, time: monday }, { ...bar, time: monday + 172800 }]);

  // When valid calendar feeds and their corresponding host mistakes are parsed.
  const weekBars = parseClosedTradingViewBars(weekly, { resolution: '1W', resolutionSeconds: 604800, observedAtSeconds: monday + 1209600 });
  const dayBars = parseClosedTradingViewBars(multiDay, { resolution: '2D', resolutionSeconds: 172800, observedAtSeconds: monday + 345600 });
  const tuesday = exportStrategyBars([{ ...bar, time: monday + 86400 }]);
  const wrongSpacing = exportStrategyBars([{ ...bar, time: monday }, { ...bar, time: monday + 86400 }]);

  // Then valid phase-aligned bars are retained and concrete grid mistakes are classified as retryable snapshots.
  assert.deepEqual(weekBars.map(item => item.time), [monday, monday + 604800]);
  assert.deepEqual(dayBars.map(item => item.time), [monday, monday + 172800]);
  assert.throws(() => parseClosedTradingViewBars(tuesday, { resolution: '1W', resolutionSeconds: 604800, observedAtSeconds: monday + 1209600 }), { name: 'TradingViewBarSnapshotInconsistentError', message: /interval grid is invalid at 0/ });
  assert.throws(() => parseClosedTradingViewBars(wrongSpacing, { resolution: '2D', resolutionSeconds: 172800, observedAtSeconds: monday + 345600 }), { name: 'TradingViewBarSnapshotInconsistentError', message: /interval spacing is invalid at 1/ });
});

test('user invalidates a closed-candle content snapshot when its native window expands', () => {
  // Given a concrete two-candle export and its immutable content snapshot.
  const bars = createOscillatingStrategyBars(2);
  const snapshot = buildClosedBarsContentSnapshot(bars);

  // When the next native export contains one additional closed candle.
  const expanded = matchesClosedBarsContentSnapshot(createOscillatingStrategyBars(3), snapshot);
  const unchanged = matchesClosedBarsContentSnapshot(bars, snapshot);

  // Then the longer window cannot reuse the former detector result.
  assert.equal(expanded, false);
  assert.equal(unchanged, true);
  assert.equal(snapshot.windowKey, '2:60:120');
  assert.equal(snapshot.values.length, 10);
});

test('user leaves markers untouched when direct rendering loses drawing ownership', async (t) => {
  // Given real detector output and a layer whose native drawing owner is busy.
  const host = createStrategy29ChartHost();
  installStrategyClock(t, host.view, 20_000_000);
  t.after(() => host.close());
  const target = findBearishBollingerChartTarget(host.document, 'BTRUSDT');
  const signals = detectBollingerSignals(createOscillatingStrategyBars());
  let busy = true;
  const layer = createBollingerMarkerLayer(target, { canMutate: () => !busy });

  // When rendering is requested during host ownership and then against a stale page context.
  const blocked = await layer.render(signals, { isCurrent: () => true });
  busy = false;
  const stale = await layer.render(signals, { isCurrent: () => false });

  // Then neither request creates or removes a native drawing.
  assert.deepEqual({ blocked, stale }, { blocked: false, stale: false });
  assert.equal(layer.size, 0);
  assert.deepEqual(host.created, []);
  assert.deepEqual(host.removed, []);
});
