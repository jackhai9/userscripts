import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { createStrategy29SummaryPanel } from '../../../src/binance-strategy29-bollinger/dom/strategy29-summary-panel.js';

const status = JSON.parse(await readFile(new URL('../../fixtures/strategy29-gateway-status.json', import.meta.url)));
const events = JSON.parse(await readFile(new URL('../../fixtures/strategy29-gateway-events.json', import.meta.url)));

test('distinguishes unavailable selection, unselected symbol and pending unit registration', () => {
  const dom = new JSDOM('<body></body>');
  const panel = createStrategy29SummaryPanel(dom.window.document, 'BTC/USDT:USDT', { maxEvents: 8 });
  panel.addEvents(events.events);
  panel.renderStatus({ ...status, units: [] });
  assert.match(dom.window.document.body.textContent, /Symbol is selected; waiting for unit status/);
  assert.doesNotMatch(dom.window.document.body.textContent, /Symbol is not watched/);
  panel.renderStatus({ ...status, universe: {
    ...status.universe, refresh_status: 'fail_closed', reason: 'selection_expired_or_unusable',
    selected_markets: [], selected_unit_count: 0, ready_unit_count: 0, pending_unit_count: 0,
  } });
  assert.match(dom.window.document.body.textContent, /Selection expired/);
  assert.match(dom.window.document.body.textContent, /Server selection is unavailable/);
  assert.equal(dom.window.document.querySelectorAll('[data-role=unit]').length, 0);
  assert.equal(dom.window.document.querySelectorAll('[data-role=remote-event]').length, 2);
  panel.renderStatus({ ...status, universe: { ...status.universe, refresh_status: 'stale_if_error', reason: 'using_stale_selection_after_refresh_error' } });
  assert.match(dom.window.document.body.textContent, /Refresh failed; using the previous selection until expiry/);
  assert.equal(dom.window.document.querySelectorAll('[data-role=unit]').length, 2);
  panel.destroy();
  dom.window.close();
});

test('replaces dynamic membership while retaining durable signal history', () => {
  const dom = new JSDOM('<body></body>');
  const panel = createStrategy29SummaryPanel(dom.window.document, 'BTC/USDT:USDT', { maxEvents: 8 });
  panel.renderStatus(status);
  panel.addEvents(events.events);
  assert.equal(dom.window.document.querySelectorAll('[data-role=unit]').length, 2);
  panel.renderStatus({ ...status, universe: { ...status.universe, selected_markets: ['ETH/USDT:USDT'] }, units: [] });
  assert.equal(dom.window.document.querySelectorAll('[data-role=unit]').length, 0);
  assert.match(dom.window.document.body.textContent, /Symbol is not watched/);
  assert.equal(dom.window.document.querySelectorAll('[data-role=remote-event]').length, 2);
  panel.renderStatus({ ...status, units: [{ ...status.units[0], timeframe: '4h', status: 'warming', reason: 'awaiting_producer_generation' }] });
  const units = dom.window.document.querySelectorAll('[data-role=unit]');
  assert.equal(units.length, 1);
  assert.match(units[0].textContent, /4h.*warming.*awaiting_producer_generation/);
  assert.doesNotMatch(dom.window.document.body.textContent, /Symbol is not watched/);
  panel.destroy();
  dom.window.close();
});

test('renders all watched timeframes for the route symbol and labels global delivery totals', () => {
  const dom = new JSDOM('<body></body>');
  const panel = createStrategy29SummaryPanel(dom.window.document, 'BTC/USDT:USDT', { maxEvents: 8 });
  panel.renderStatus(status);
  const text = dom.window.document.body.textContent;
  assert.match(text, /BTC\/USDT:USDT/);
  assert.match(text, /1m/);
  assert.match(text, /1h/);
  assert.doesNotMatch(text, /ETH\/USDT:USDT/);
  assert.match(text, /Global delivery/);
  assert.match(text, /Sent 4/);
  assert.match(text, /Spec version matched/);
  assert.match(text, /eece8cf16e58340910587962f3bfbb19acb72155c09a52b4b6c0570cc979ef8d/);
  panel.destroy();
  assert.equal(dom.window.document.getElementById('jh-strategy29-summary-panel'), null);
  dom.window.close();
});

test('shows multi-timeframe events, deduplicates identities and clears only remote rows', () => {
  const dom = new JSDOM('<body></body>');
  const panel = createStrategy29SummaryPanel(dom.window.document, 'BTC/USDT:USDT', { maxEvents: 8 });
  panel.addEvents(events.events, events.observed_at_ms);
  panel.addEvents([events.events[0]]);
  assert.equal(dom.window.document.querySelectorAll('[data-role=remote-event]').length, 2);
  const text = dom.window.document.body.textContent;
  assert.match(text, /1m/);
  assert.match(text, /1h/);
  assert.match(text, /Bearish warning/);
  assert.match(text, /Short reversal/);
  assert.match(text, /Close/);
  assert.match(text, /Events checked/);
  assert.match(text, /UTC\+08/);
  panel.clearEvents();
  assert.equal(dom.window.document.querySelectorAll('[data-role=remote-event]').length, 0);
  panel.destroy();
  dom.window.close();
});

test('makes server/local spec mismatch visible without rendering it as verified', () => {
  const dom = new JSDOM('<body></body>');
  const panel = createStrategy29SummaryPanel(dom.window.document, 'BTC/USDT:USDT', { maxEvents: 8 });
  panel.renderStatus({ ...status, spec_version: 'other_spec' });
  assert.match(dom.window.document.body.textContent, /Spec mismatch/);
  assert.equal(dom.window.document.querySelector('[data-role=spec]').dataset.state, 'error');
  panel.destroy();
  dom.window.close();
});

test('retains the latest durable sequences even when detection times arrive out of order', () => {
  const dom = new JSDOM('<body></body>');
  const panel = createStrategy29SummaryPanel(dom.window.document, 'BTC/USDT:USDT', { maxEvents: 2 });
  const first = { ...events.events[0], event_id: 'a'.repeat(64), sequence: 10, detected_at_ms: 3000 };
  const second = { ...events.events[0], event_id: 'b'.repeat(64), sequence: 11, detected_at_ms: 2000 };
  const third = { ...events.events[0], event_id: 'c'.repeat(64), sequence: 12, detected_at_ms: 1000 };
  panel.addEvents([first, second]);
  panel.addEvents([third]);
  assert.deepEqual([...dom.window.document.querySelectorAll('[data-role=remote-event]')].map(row => row.dataset.eventId), [third.event_id, second.event_id]);
  panel.destroy();
  dom.window.close();
});
