import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createStrategy29RemoteSummary, STRATEGY29_PANEL_POSITION_KEY } from '../../../src/binance-strategy29-bollinger/remote-summary.js';
import { createStrategy29SummaryPanel } from '../../../src/binance-strategy29-bollinger/dom/strategy29-summary-panel.js';
import {
  validateStrategy29EventsResponse, validateStrategy29StatusResponse,
} from '../../../src/binance-strategy29-bollinger/core/remote-summary-contract.js';
import { createStrategy29ChartHost, createStrategy29RequestHost } from '../../helpers/strategy29-runtime-boundary-host.js';
import { installStrategyClock, observeStrategyCondition } from '../../helpers/strategy-migration-boundaries.js';

const status = JSON.parse(await readFile(new URL('../../fixtures/strategy29-gateway-status.json', import.meta.url)));
const events = JSON.parse(await readFile(new URL('../../fixtures/strategy29-gateway-events.json', import.meta.url)));
const initialMissingSelection = {
  ...status, units: [], universe: {
    ...status.universe, generation: null, refresh_status: 'fail_closed', reason: 'missing_current_universe_facts',
    selected_markets: [], configured_timeframes: [], selected_unit_count: 0, ready_unit_count: 0, pending_unit_count: 0,
    refreshed_at_ms: null, last_successful_refreshed_at_ms: null, last_success_age_seconds: null,
    last_refresh_error_at_ms: null, selection_expires_at_ms: null,
  },
};

function remoteFixture(t) {
  const host = createStrategy29ChartHost();
  host.dom.reconfigure({ url: 'https://www.binance.com/en/futures/BTCUSDT' });
  const clock = installStrategyClock(t, host.view, status.observed_at_ms);
  const gateway = createStrategy29RequestHost();
  const values = new Map([[STRATEGY29_PANEL_POSITION_KEY, { left: 120, top: 80 }]]);
  const writes = [];
  const remote = createStrategy29RemoteSummary({
    view: host.view,
    request: options => gateway.request(options),
    getValue: (key, defaultValue) => values.has(key) ? values.get(key) : defaultValue,
    setValue: (key, value) => { values.set(key, value); writes.push({ key, value }); },
    getGatewayState: () => ({ available: true, configured: true, settingsRevision: 1 }),
  });
  t.after(() => { remote.dispose(); host.close(); });
  return { host, clock, gateway, remote, writes, panel: () => host.document.getElementById('jh-strategy29-summary-panel') };
}

test('user replaces the remote context with a fresh latest snapshot after restart', async (t) => {
  // Given a real remote client and panel containing an acknowledged snapshot.
  const fixture = remoteFixture(t);
  fixture.gateway.respond(status);
  fixture.gateway.respond(events);
  await fixture.remote.sample();
  const previous = fixture.panel();
  const previousSignal = fixture.gateway.requests[0].signal;
  fixture.gateway.respond(status);
  fixture.gateway.respond({ ...events, events: [events.events[0]], next_cursor: 90 });

  // When the public restart hook retires the old context and polls immediately.
  fixture.remote.restart();
  await observeStrategyCondition(() => !fixture.remote.diagnostics.inFlight, 'restarted remote poll completes');

  // Then the old request owner and panel are retired and a bounded latest query establishes new history.
  assert.equal(previous.isConnected, false);
  assert.equal(previousSignal.aborted, true);
  assert.equal(fixture.panel() === previous, false);
  assert.deepEqual([...fixture.panel().querySelectorAll('[data-role=remote-event]')].map(row => row.dataset.eventId), [events.events[0].event_id]);
  assert.equal(new URL(fixture.gateway.requests[3].path, 'https://gateway.invalid').searchParams.get('mode'), 'latest_per_timeframe');
  assert.equal(fixture.remote.diagnostics.cursor, 90);
  assert.equal(fixture.remote.diagnostics.state, 'connected');
  assert.equal(fixture.panel().style.left, '120px');
  assert.deepEqual(fixture.writes, []);
});

test('user sees expired retained rows cleared before the replacement latest snapshot arrives', async (t) => {
  // Given accepted remote history whose next incremental cursor has expired.
  const fixture = remoteFixture(t);
  fixture.gateway.respond(status);
  fixture.gateway.respond(events);
  await fixture.remote.sample();
  fixture.gateway.respond(status);
  fixture.gateway.respond({ schema_version: 1, error: 'cursor_expired', oldest_cursor: 50 }, 409);
  const latest = fixture.gateway.hold();

  // When the real client resets its cursor and awaits the replacement latest response.
  const pending = fixture.remote.sample(status.observed_at_ms + 5000);
  await latest.entered;

  // Then the existing panel drops expired rows and reports that events have not yet been checked.
  assert.equal(fixture.remote.diagnostics.cursor, null);
  assert.equal(fixture.panel().querySelectorAll('[data-role=remote-event]').length, 0);
  assert.equal(fixture.panel().querySelector('[data-role=events-freshness]').textContent, 'Events not checked');
  assert.equal(new URL(fixture.gateway.requests[4].path, 'https://gateway.invalid').searchParams.get('mode'), 'latest_per_timeframe');

  // When the replacement latest snapshot delivers one newer signal.
  const replacement = { ...events.events[0], sequence: 70, event_id: 'c'.repeat(64) };
  latest.respond({ ...events, events: [replacement], next_cursor: 70 });
  await pending;

  // Then only that replacement signal is shown and its cursor is committed.
  assert.deepEqual([...fixture.panel().querySelectorAll('[data-role=remote-event]')].map(row => row.dataset.eventId), [replacement.event_id]);
  assert.equal(fixture.remote.diagnostics.cursor, 70);
  assert.equal(fixture.remote.diagnostics.state, 'connected');
});

test('user sees more-history status after two bounded incremental pages without a third events request', async (t) => {
  // Given a real client with an established global cursor and additional retained history.
  const fixture = remoteFixture(t);
  fixture.gateway.respond(status);
  fixture.gateway.respond({ ...events, events: [], next_cursor: 40 });
  await fixture.remote.sample();
  fixture.gateway.respond(status);
  fixture.gateway.respond({ ...events, events: [events.events[0]], next_cursor: 41, has_more: true });
  fixture.gateway.respond({ ...events, events: [events.events[1]], next_cursor: 42, has_more: true });

  // When the next public sample consumes its two allowed pages.
  await fixture.remote.sample(status.observed_at_ms + 5000);

  // Then the panel exposes pending history and the poll stops at the configured page bound.
  assert.equal(fixture.panel().querySelector('[data-role=connection]').textContent, 'Connected · more history pending');
  assert.deepEqual(fixture.remote.diagnostics.lastResult, { state: 'connected', pages: 2, hasMore: true });
  assert.equal(fixture.remote.diagnostics.cursor, 42);
  assert.equal(fixture.gateway.requests.length, 5);
  assert.equal(fixture.gateway.remaining, 0);
  assert.equal(fixture.panel().querySelectorAll('[data-role=remote-event]').length, 2);
});

test('user removes the remote panel after leaving futures and rejects a late native response without affecting chart drawings', async (t) => {
  // Given retained remote rows, an unrelated chart drawing and a pending incremental response.
  const fixture = remoteFixture(t);
  fixture.host.addForeignShape('user-line');
  fixture.gateway.respond(status);
  fixture.gateway.respond(events);
  await fixture.remote.sample();
  const oldPanel = fixture.panel();
  fixture.gateway.respond(status);
  const late = fixture.gateway.hold();
  const pending = fixture.remote.sample(status.observed_at_ms + 5000);
  await late.entered;
  const oldSignal = fixture.gateway.requests.at(-1).signal;

  // When browser navigation leaves futures before the response completes.
  fixture.host.view.history.pushState({}, '', '/en/markets');
  await fixture.remote.sample(status.observed_at_ms + 10_000);
  late.respond({ ...events, events: [{ ...events.events[0], sequence: 80, event_id: 'd'.repeat(64) }], next_cursor: 80 });
  await pending;

  // Then the retired response has no page target or cursor to mutate and native drawings remain intact.
  assert.equal(oldSignal.aborted, true);
  assert.equal(oldPanel.isConnected, false);
  assert.equal(fixture.panel(), null);
  assert.equal(fixture.remote.diagnostics.contextPresent, false);
  assert.equal(fixture.remote.diagnostics.cursor, null);
  assert.equal(fixture.remote.diagnostics.state, 'waiting_for_route');
  assert.deepEqual(fixture.host.chart.getAllShapes(), [{ id: 'user-line', name: 'trend_line' }]);
  assert.deepEqual(fixture.host.removed, []);
});

test('user pauses hidden remote samples and cannot restart a disposed panel', async (t) => {
  // Given a real controller on a hidden page before its first request.
  const fixture = remoteFixture(t);
  fixture.host.setHidden(true);

  // When the controller is sampled while hidden and then disposed and restarted.
  await fixture.remote.sample();
  fixture.remote.dispose();
  fixture.host.setHidden(false);
  fixture.remote.restart();
  await fixture.remote.sample();
  fixture.remote.dispose();

  // Then no request or replacement panel can escape either lifecycle boundary.
  assert.deepEqual(fixture.gateway.requests, []);
  assert.equal(fixture.panel(), null);
  assert.equal(fixture.remote.diagnostics.contextPresent, false);
  assert.equal(fixture.remote.diagnostics.inFlight, false);
  assert.deepEqual(fixture.writes, []);
});

test('user sees initialization pending without fabricated timeframe, generation or last-success facts', async (t) => {
  // Given a server response whose absent selection facts satisfy the real gateway validator.
  const fixture = remoteFixture(t);
  validateStrategy29StatusResponse(initialMissingSelection, 200);
  fixture.gateway.respond(initialMissingSelection);
  fixture.gateway.respond({ ...events, events: [], next_cursor: 0 });

  // When the real client delivers that first status to the default panel.
  await fixture.remote.sample();

  // Then the panel keeps pending selection facts explicit and accepts an empty bounded history.
  assert.equal(fixture.panel().querySelector('[data-role=timeframes]').textContent, '');
  assert.equal(fixture.panel().querySelector('[data-role=selection]').textContent, 'Waiting for server selection to initialize');
  assert.equal(fixture.panel().querySelector('[data-role=selection-details]').textContent, 'Waiting for server selection to initialize · Generation pending · 0 markets · 0/0 live units ready');
  assert.equal(fixture.panel().querySelector('[data-role=selection-refresh]').textContent, 'No successful selection has been observed');
  assert.equal(fixture.panel().querySelector('[data-role=events]').textContent, 'No signals in retained history');
  assert.equal(fixture.remote.diagnostics.cursor, 0);
});

test('user sees only configured timeframe events and long signals use their actual direction color', async (t) => {
  // Given a structurally valid event page that straddles a server configuration change.
  const fixture = remoteFixture(t);
  const longEvent = { ...events.events[0], event_id: 'e'.repeat(64), setup_direction: 'bullish', signal_side: 'long' };
  const outside = { ...events.events[1], timeframe: '4h' };
  const page = { ...events, events: [longEvent, outside] };
  validateStrategy29EventsResponse(page, 200);
  fixture.gateway.respond(status);
  fixture.gateway.respond(page);

  // When the real client accepts the protocol page and the panel projects the current configured intervals.
  await fixture.remote.sample();

  // Then the supported but unconfigured event is hidden and the long signal is rendered in green.
  const rows = [...fixture.panel().querySelectorAll('[data-role=remote-event]')];
  assert.deepEqual(rows.map(row => row.dataset.eventId), [longEvent.event_id]);
  assert.equal(rows[0].children[1].textContent, 'Bullish warning');
  assert.equal(rows[0].children[1].style.color, 'rgb(14, 203, 129)');
  assert.equal(fixture.remote.diagnostics.cursor, 42);
  assert.equal(fixture.panel().querySelector('[data-role=missing-signals]').textContent, 'No retained signals: 5m, 1h');
});

test('user keeps existing rows when applying the same locale and clamps diagnostics only while the panel is live', (t) => {
  // Given a real panel with validated status and rows plus a native viewport.
  const host = createStrategy29ChartHost();
  host.dom.reconfigure({ url: 'https://www.binance.com/en/futures/BTCUSDT' });
  const saved = [];
  const controller = createStrategy29SummaryPanel(host.document, 'BTC/USDT:USDT', {
    locale: 'en', loadPosition: () => ({ left: 800, top: 600 }), savePosition: value => saved.push(value),
  });
  t.after(() => { controller.destroy(); host.close(); });
  controller.renderStatus(validateStrategy29StatusResponse(status, 200));
  controller.addEvents(validateStrategy29EventsResponse(events, 200).events, events.observed_at_ms);
  const panel = host.document.getElementById('jh-strategy29-summary-panel');
  const originalRows = [...panel.querySelectorAll('[data-role=remote-event]')];
  const details = panel.querySelector('[data-role=diagnostics]');

  // When the same locale is applied and native diagnostics toggle after a smaller viewport is observed.
  controller.setLocale('en');
  Object.defineProperties(host.view, { innerWidth: { configurable: true, value: 300 }, innerHeight: { configurable: true, value: 200 } });
  details.dispatchEvent(new host.view.Event('toggle'));

  // Then existing event elements are preserved and the live panel stays inside the viewport.
  assert.deepEqual([...panel.querySelectorAll('[data-role=remote-event]')], originalRows);
  assert.equal(panel.style.left, '200px');
  assert.equal(panel.style.top, '176px');
  assert.deepEqual(saved, []);

  // When a queued native toggle arrives after destruction.
  controller.destroy();
  panel.style.left = '777px';
  details.dispatchEvent(new host.view.Event('toggle'));

  // Then the retired listener performs no clamp or persistence write.
  assert.equal(panel.isConnected, false);
  assert.equal(panel.style.left, '777px');
  assert.deepEqual(saved, []);
});
