import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createBollingerMonitor } from '../../../src/binance-strategy29-bollinger/monitor.js';
import { createStrategy29RemoteSummary, STRATEGY29_PANEL_POSITION_KEY } from '../../../src/binance-strategy29-bollinger/remote-summary.js';
import { createStrategy29SummaryPanel } from '../../../src/binance-strategy29-bollinger/dom/strategy29-summary-panel.js';
import { createBollingerIntervalSession } from '../../../src/binance-strategy29-bollinger/dom/tradingview-bearish-alerts.js';
import { validateStrategy29EventsResponse, validateStrategy29StatusResponse } from '../../../src/binance-strategy29-bollinger/core/remote-summary-contract.js';
import { SUMMARY_COPY } from '../../../src/binance-strategy29-bollinger/ui-copy.js';
import { createStrategy29ChartHost, createStrategy29RequestHost } from '../../helpers/strategy29-runtime-boundary-host.js';
import { captureStrategyError, installStrategyClock, observeStrategyCondition } from '../../helpers/strategy-migration-boundaries.js';

const status = JSON.parse(await readFile(new URL('../../fixtures/strategy29-gateway-status.json', import.meta.url)));
const events = JSON.parse(await readFile(new URL('../../fixtures/strategy29-gateway-events.json', import.meta.url)));

function remoteConfiguration(host, transport, reads, writes) {
  return {
    view: host.view, request: request => transport.request(request),
    getValue(key) { assert.equal(key, STRATEGY29_PANEL_POSITION_KEY); reads.push(key); return null; },
    setValue(key, value) { writes.push({ key, value }); },
    getGatewayState: () => ({ available: true, configured: true, settingsRevision: 1 }),
    pollIntervalMs: 1000,
  };
}

for (const [label, changed, message] of [
  ['missing page window', { view: null }, 'Strategy 29 remote summary requires a page window'],
  ['missing position writer', { setValue: null }, 'Strategy 29 remote summary setValue is invalid'],
  ['too-short poll interval', { pollIntervalMs: 999 }, 'Strategy 29 remote poll interval is invalid'],
]) {
  test(`user rejects a remote summary with ${label} before installing a panel`, async (t) => {
    // Given an invalid public remote-summary configuration and a fresh page.
    const host = createStrategy29ChartHost();
    host.dom.reconfigure({ url: 'https://www.binance.com/en/futures/BTCUSDT' });
    const transport = createStrategy29RequestHost();
    const reads = [];
    const writes = [];
    const configuration = remoteConfiguration(host, transport, reads, writes);
    t.after(() => host.close());

    // When the public constructor validates the configured adapters and poll boundary.
    const error = captureStrategyError(() => createStrategy29RemoteSummary({ ...configuration, ...changed }));

    // Then initialization fails before storage, transport or visible page state is touched.
    assert.equal(error.name, 'TypeError');
    assert.equal(error.message, message);
    assert.deepEqual(reads, []);
    assert.deepEqual(writes, []);
    assert.deepEqual(transport.requests, []);
    assert.equal(host.document.getElementById('jh-strategy29-summary-panel'), null);

    // When corrected adapters use the supported one-second minimum and receive a real snapshot.
    const remote = createStrategy29RemoteSummary(configuration);
    t.after(() => remote.dispose());
    transport.respond(status);
    transport.respond(events);
    await remote.sample(status.observed_at_ms);

    // Then the default client and panel connect normally using only the declared position key.
    assert.equal(remote.diagnostics.state, 'connected');
    assert.equal(remote.diagnostics.cursor, 42);
    assert.deepEqual(reads, [STRATEGY29_PANEL_POSITION_KEY]);
    assert.equal(host.document.querySelectorAll('[data-role=remote-event]').length, 2);
    assert.deepEqual(writes, []);
    remote.dispose();
  });
}

for (const [label, mode, message] of [
  ['a body element', 'body', 'Strategy 29 summary panel requires document.body'],
  ['a nonempty symbol', 'symbol', 'Strategy 29 panel symbol is invalid'],
  ['position adapters', 'adapters', 'Strategy 29 panel position adapters are required'],
]) {
  test(`user requires ${label} before a summary panel is inserted`, (t) => {
    // Given a real document whose public panel initialization prerequisite is absent.
    const host = createStrategy29ChartHost();
    t.after(() => host.close());
    if (mode === 'body') host.document.body.remove();
    const reads = [];
    const writes = [];
    const options = {
      locale: 'en', loadPosition: () => { reads.push('position'); return null; },
      savePosition: position => writes.push(position),
    };
    if (mode === 'adapters') options.loadPosition = null;

    // When the public panel factory is called before that prerequisite is satisfied.
    const error = captureStrategyError(() => createStrategy29SummaryPanel(host.document, mode === 'symbol' ? '' : 'BTC/USDT:USDT', options));

    // Then the missing prerequisite is reported and no partial panel or storage write is left behind.
    assert.equal(error.message, message);
    assert.equal(host.document.getElementById('jh-strategy29-summary-panel'), null);
    assert.deepEqual(reads, []);
    assert.deepEqual(writes, []);
  });
}

test('user cannot mutate a destroyed summary panel through any retained public update callback', (t) => {
  // Given a real panel with validated status and events that has been retired.
  const host = createStrategy29ChartHost();
  t.after(() => host.close());
  const writes = [];
  const panel = createStrategy29SummaryPanel(host.document, 'BTC/USDT:USDT', {
    locale: 'en', loadPosition: () => null, savePosition: value => writes.push(value),
  });
  const validatedStatus = validateStrategy29StatusResponse(status, 200);
  const validatedEvents = validateStrategy29EventsResponse(events, 200);
  panel.renderStatus(validatedStatus);
  panel.addEvents(validatedEvents.events, validatedEvents.observed_at_ms);
  const element = host.document.getElementById('jh-strategy29-summary-panel');
  panel.destroy();
  const markupAfterRetirement = element.innerHTML;

  // When late public update callbacks attempt to render into the destroyed panel.
  const errors = [
    () => panel.setLocale('zh-CN'),
    () => panel.setConnection('connected', SUMMARY_COPY.connected),
    () => panel.renderStatus(validatedStatus),
    () => panel.addEvents(validatedEvents.events, validatedEvents.observed_at_ms),
    () => panel.clearEvents(),
  ].map(operation => captureStrategyError(operation));

  // Then every late update is explicitly rejected and no DOM or persistence state changes.
  assert.deepEqual(errors.map(error => error.message), Array(5).fill('Strategy 29 summary panel is destroyed'));
  assert.equal(element.innerHTML, markupAfterRetirement);
  assert.equal(element.isConnected, false);
  assert.equal(panel.size, 0);
  assert.deepEqual(writes, []);
});

function monitorFixture(t, options) {
  const host = createStrategy29ChartHost(options);
  const clock = installStrategyClock(t, host.view, 20_000_000);
  const errors = [];
  const warnings = [];
  const monitor = createBollingerMonitor({
    document: host.document, getCurrentSymbol: () => 'BTRUSDT', isFuturesTradingPage: () => true,
    isTradingViewDrawingMutationBusy: () => false,
    err: (...values) => errors.push(values), warn: (...values) => warnings.push(values),
  });
  t.after(() => { monitor.stop(); host.close(); });
  return { host, clock, errors, warnings, monitor };
}

async function sample(fixture) {
  await fixture.monitor.tick();
  await observeStrategyCondition(() => {
    fixture.clock.advance(0);
    return !fixture.monitor.diagnostics.taskPending;
  }, 'provider boundary sample completes');
}

for (const [label, options, change, expected] of [
  ['omitted candle-export capability', { omittedMethods: ['exportData'] }, null, 'TradingView Bollinger alert method is unavailable: exportData'],
  ['missing native symbol', {}, host => host.setSymbol(null), 'TradingView Bollinger alert symbol mismatch: expected BTRUSDT, received '],
  ['missing native resolution', { resolution: null }, null, 'TradingView Bollinger alert resolution is unsupported: null'],
]) {
  test(`user does not start an observer against a chart with ${label}`, async (t) => {
    // Given an exposed native chart whose reported capabilities are incomplete.
    const fixture = monitorFixture(t, options);
    if (change) change(fixture.host);
    fixture.host.addForeignShape('user-line');

    // When the real monitor resolves its chart target.
    await sample(fixture);

    // Then the exact external capability failure is reported before an export or drawing mutation.
    assert.equal(fixture.errors.length, 1);
    assert.equal(fixture.errors[0][0], 'Bollinger chart lookup failed for this sample:');
    assert.equal(fixture.errors[0][1].message, expected);
    assert.equal(fixture.monitor.diagnostics.contextPresent, false);
    assert.equal(fixture.monitor.diagnostics.sessionPresent, false);
    assert.deepEqual(fixture.host.exports, []);
    assert.deepEqual(fixture.host.created, []);
    assert.deepEqual(fixture.host.chart.getAllShapes(), [{ id: 'user-line', name: 'trend_line' }]);
  });
}

for (const [label, list, expected] of [
  ['non-array shape list', null, 'TradingView Bollinger alert shape list is invalid'],
  ['nonnative shape identifier', [{ id: 7, name: 'icon' }], 'TradingView Bollinger alert shape 0 id is invalid'],
]) {
  test(`user stops marker publication after a native ${label} and keeps unrelated drawings`, async (t) => {
    // Given real signal candles and a malformed list supplied by the native chart API.
    const fixture = monitorFixture(t);
    fixture.host.addForeignShape('user-line');
    fixture.host.listShapesNext(list);

    // When the real detector completes and the marker layer audits native ownership.
    await sample(fixture);

    // Then the render contract failure is retained without creating or deleting any drawing.
    assert.equal(fixture.monitor.diagnostics.failed, true);
    assert.equal(fixture.monitor.diagnostics.lastLocalFailure.stage, 'render');
    assert.equal(fixture.monitor.diagnostics.lastLocalFailure.message, expected);
    assert.equal(fixture.monitor.diagnostics.cachedSignalCount, null);
    assert.deepEqual(fixture.host.created, []);
    assert.deepEqual(fixture.host.removed, []);
    assert.deepEqual(fixture.host.chart.getAllShapes(), [{ id: 'user-line', name: 'trend_line' }]);
  });
}

test('user rejects an unavailable interval subscription without attaching half a readiness session', (t) => {
  // Given a native chart that has not exposed its interval subscription interface.
  const host = createStrategy29ChartHost();
  t.after(() => host.close());
  host.setIntervalSubscription(null);

  // When the public interval-session factory checks the native readiness capabilities.
  const error = captureStrategyError(() => createBollingerIntervalSession(host.chart));

  // Then initialization fails before either native subscription is attached.
  assert.equal(error.message, 'TradingView Bollinger interval subscription is unavailable');
  assert.equal(host.intervalChanged.size, 0);
  assert.equal(host.dataLoaded.size, 0);
  assert.deepEqual(host.exports, []);
});
