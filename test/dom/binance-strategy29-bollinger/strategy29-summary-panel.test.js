import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { createStrategy29SummaryPanel as createPanel } from '../../../src/binance-strategy29-bollinger/dom/strategy29-summary-panel.js';

function createStrategy29SummaryPanel(document, symbol, options = {}) {
  let position = null;
  return createPanel(document, symbol, { locale: 'en', loadPosition: () => position, savePosition: value => { position = value; }, ...options });
}

const status = JSON.parse(await readFile(new URL('../../fixtures/strategy29-gateway-status.json', import.meta.url)));
const events = JSON.parse(await readFile(new URL('../../fixtures/strategy29-gateway-events.json', import.meta.url)));

for (const state of ['module_disabled', 'gateway_unavailable', 'unavailable']) {
  test(`${state} removes current readiness while preserving historical signals across locale changes`, () => {
    const dom = new JSDOM('<body></body>');
    const panel = createStrategy29SummaryPanel(dom.window.document, 'BTC/USDT:USDT');
    panel.renderStatus(status);
    panel.addEvents(events.events, events.observed_at_ms);
    assert.equal(dom.window.document.querySelectorAll('[data-role=unit]').length, 2);
    panel.setConnection(state, { zhCN: '暂不可用', en: 'Unavailable' });
    assert.equal(dom.window.document.querySelectorAll('[data-role=unit]').length, 0);
    assert.equal(dom.window.document.querySelectorAll('[data-role=remote-event]').length, 2);
    assert.doesNotMatch(dom.window.document.querySelector('[data-role=selection]').textContent, /live units ready/);
    panel.setLocale('zh-CN');
    assert.match(dom.window.document.querySelector('[data-role=selection]').textContent, /当前监控状态不可用/);
    assert.equal(dom.window.document.querySelectorAll('[data-role=unit]').length, 0);
    panel.renderStatus(status);
    assert.equal(dom.window.document.querySelectorAll('[data-role=unit]').length, 2);
    assert.equal(panel.size, 2);
    panel.destroy();
    dom.window.close();
  });
}

test('distinguishes stored processing success from current live readiness', () => {
  const dom = new JSDOM('<body></body>');
  const panel = createStrategy29SummaryPanel(dom.window.document, 'BTC/USDT:USDT');
  panel.renderStatus({ ...status, universe: {
    ...status.universe, ready_unit_count: 0, pending_unit_count: status.universe.selected_unit_count,
  } });
  assert.match(dom.window.document.querySelector('[data-role=selection]').textContent, /0\/3 live units ready/);
  assert.match(dom.window.document.body.textContent, /Last processing status/);
  assert.match(dom.window.document.body.textContent, /Stored processing status does not confirm current live readiness/);
  const processing = dom.window.document.querySelector('[data-role=unit]').children[1];
  assert.equal(processing.textContent, 'Processed');
  assert.equal(processing.style.color, 'rgb(132, 142, 156)');
  panel.destroy();
  dom.window.close();
});

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
  panel.renderStatus({ ...status, universe: { ...status.universe, configured_timeframes: ['1h'] } });
  assert.deepEqual([...dom.window.document.querySelectorAll('[data-role=unit]')].map(row => row.firstChild.textContent), ['1h']);
  assert.equal(dom.window.document.querySelectorAll('[data-role=remote-event]').length, 2);
  panel.renderStatus({ ...status, universe: { ...status.universe, selected_markets: ['ETH/USDT:USDT'] }, units: [] });
  assert.equal(dom.window.document.querySelectorAll('[data-role=unit]').length, 0);
  assert.match(dom.window.document.body.textContent, /Symbol is not watched/);
  assert.equal(dom.window.document.querySelectorAll('[data-role=remote-event]').length, 2);
  panel.renderStatus({ ...status, universe: { ...status.universe, configured_timeframes: ['4h'] }, units: [{ ...status.units[0], timeframe: '4h', status: 'warming', reason: 'awaiting_producer_generation' }] });
  const units = dom.window.document.querySelectorAll('[data-role=unit]');
  assert.equal(units.length, 1);
  assert.match(units[0].textContent, /4h.*Warming.*Awaiting producer generation/);
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
  panel.renderStatus(status);
  panel.addEvents(events.events, events.observed_at_ms);
  panel.renderStatus({ schema_version: 1, spec_version: 'other_spec', observed_at_ms: status.observed_at_ms });
  assert.match(dom.window.document.body.textContent, /Spec mismatch/);
  assert.equal(dom.window.document.querySelector('[data-role=spec]').dataset.state, 'error');
  assert.equal(dom.window.document.querySelectorAll('[data-role=unit]').length, 0);
  assert.equal(dom.window.document.querySelectorAll('[data-role=remote-event]').length, 2);
  assert.match(dom.window.document.querySelector('[data-role=selection]').textContent, /incompatible/);
  panel.renderStatus(status);
  assert.equal(dom.window.document.querySelectorAll('[data-role=unit]').length, 2);
  panel.destroy();
  dom.window.close();
});

test('retains newest signal close times regardless of insertion or detection order', () => {
  const dom = new JSDOM('<body></body>');
  const panel = createStrategy29SummaryPanel(dom.window.document, 'BTC/USDT:USDT', { maxEvents: 2 });
  const first = { ...events.events[0], event_id: 'a'.repeat(64), sequence: 10, detected_at_ms: 3000, bar_close_ms: 3000 };
  const second = { ...events.events[0], event_id: 'b'.repeat(64), sequence: 11, detected_at_ms: 2000, bar_close_ms: 3000 };
  const third = { ...events.events[0], event_id: 'c'.repeat(64), sequence: 12, detected_at_ms: 4000, bar_close_ms: 1000 };
  panel.addEvents([first, second]);
  panel.addEvents([third]);
  assert.deepEqual([...dom.window.document.querySelectorAll('[data-role=remote-event]')].map(row => row.dataset.eventId), [second.event_id, first.event_id]);
  panel.destroy();
  dom.window.close();
});
