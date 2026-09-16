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

test('user observes that each timeframe retains three signals through dense minute updates and historical backfills', () => {
  // Given the remote summary panel and observer snapshot
  const dom = new JSDOM('<body></body>');
  const panel = createStrategy29SummaryPanel(dom.window.document, 'BTC/USDT:USDT');
  const timeframes = ['1m', '5m', '15m', '1h', '4h', '1d'];
  let sequence = 0;
  // When timeframes.flatMap processes the configured inputs
  const records = timeframes.flatMap((timeframe, group) => Array.from({ length: group === 0 ? 30 : 3 }, (_, index) => ({
    ...events.events[0], timeframe, event_id: String(++sequence).padStart(64, '0'), sequence,
    bar_close_ms: events.observed_at_ms - group * 86_400_000 - index * 60_000,
  })));
  panel.addEvents(records, events.observed_at_ms);
  const rows = () => [...dom.window.document.querySelectorAll('[data-role=remote-event]')];
  // Then user observes that each timeframe retains three signals through dense minute updates and historical backfills
  assert.equal(panel.size, 18);
  for (const timeframe of timeframes) assert.equal(rows().filter(row => row.firstChild.textContent === timeframe).length, 3);
  const otherIds = rows().filter(row => row.firstChild.textContent !== '1m').map(row => row.dataset.eventId);
  const updates = Array.from({ length: 5 }, (_, index) => ({
    ...records[0], event_id: String(++sequence).padStart(64, '0'), sequence,
    bar_close_ms: events.observed_at_ms + (index + 1) * 60_000,
  }));
  panel.addEvents(updates, events.observed_at_ms + 300_000);
  panel.addEvents([{ ...records[10], event_id: 'f'.repeat(64), sequence: ++sequence }]);
  assert.deepEqual(rows().slice(0, 3).map(row => row.dataset.eventId), updates.slice(-3).reverse().map(event => event.event_id));
  assert.deepEqual(rows().filter(row => row.firstChild.textContent !== '1m').map(row => row.dataset.eventId), otherIds);
  panel.setLocale('zh-CN');
  assert.equal(panel.size, 18);
  panel.destroy();
  dom.window.close();
});

test('user observes that diagnostics start collapsed with duration-sorted processing while actionable notices stay outside', () => {
  // Given the remote summary panel and observer snapshot
  const dom = new JSDOM('<body></body>');
  const panel = createStrategy29SummaryPanel(dom.window.document, 'BTC/USDT:USDT');
  const timeframes = ['15m', '1d', '1h', '1m', '4h', '5m'];
  // When panel.renderStatus processes the configured inputs
  panel.renderStatus({ ...status, universe: { ...status.universe, configured_timeframes: timeframes },
    units: timeframes.map(timeframe => ({ ...status.units[0], timeframe, status: timeframe === '4h' ? 'data_gap' : 'ready', reason: timeframe === '4h' ? 'closed_bar_gap' : 'current' })),
  });
  const diagnostics = dom.window.document.querySelector('[data-role=diagnostics]');
  // Then user observes that diagnostics start collapsed with duration-sorted processing while actionable notices stay outside
  assert.equal(diagnostics.tagName, 'DETAILS');
  assert.equal(diagnostics.open, false);
  for (const role of ['spec', 'reference', 'units', 'delivery', 'selection-details']) {
    assert.equal(dom.window.document.querySelector(`[data-role=${role}]`).closest('details'), diagnostics);
  }
  assert.deepEqual([...diagnostics.querySelectorAll('[data-role=unit]')].map(row => row.firstChild.textContent), ['1m', '5m', '15m', '1h', '4h', '1d']);
  const notices = dom.window.document.querySelector('[data-role=notices]');
  assert.equal(notices.closest('details'), null);
  assert.match(notices.textContent, /4h.*Data gap/);
  assert.doesNotMatch(notices.textContent, /closed_bar_gap/);
  assert.match(diagnostics.textContent, /closed_bar_gap/);
  panel.addEvents(events.events, events.observed_at_ms);
  panel.setConnection('disconnected', { en: 'Disconnected', zhCN: '连接中断' });
  assert.match(notices.textContent, /historical/i);
  panel.renderStatus({ ...status, spec_version: 'incompatible-spec' });
  assert.match(notices.textContent, /update/i);
  panel.destroy();
  dom.window.close();
});

test('user observes that empty increments retain event DOM identities while advancing freshness', () => {
  // Given the remote summary panel and observer snapshot
  const dom = new JSDOM('<body></body>');
  const panel = createStrategy29SummaryPanel(dom.window.document, 'BTC/USDT:USDT');
  const incoming = Array.from({ length: 20 }, (_, index) => ({
    ...events.events[0], event_id: `performance-${index}`, sequence: index + 1,
    bar_close_ms: events.events[0].bar_close_ms + index * 60_000,
  }));
  // When panel.addEvents processes the configured inputs
  panel.addEvents(incoming, events.observed_at_ms);
  const container = dom.window.document.querySelector('[data-role=events]');
  const rows = [...container.children];
  const freshness = dom.window.document.querySelector('[data-role=events-freshness]');
  const before = freshness.textContent;
  const observer = new dom.window.MutationObserver(() => {});
  observer.observe(container, { childList: true, subtree: true, characterData: true });
  for (let index = 1; index <= 10; index += 1) panel.addEvents([], events.observed_at_ms + index * 5_000);
  // Then user observes that empty increments retain event DOM identities while advancing freshness
  assert.equal(container.children.length, rows.length);
  rows.forEach((row, index) => assert.equal(container.children[index], row));
  assert.equal(observer.takeRecords().length, 0);
  assert.notEqual(freshness.textContent, before);
  assert.equal(panel.size, 3);
  panel.setLocale('zh-CN');
  assert.notEqual(container.firstChild, rows[0]);
  assert.match(freshness.textContent, /UTC\+08/);
  observer.disconnect();
  panel.destroy();
  dom.window.close();
});

for (const state of ['module_disabled', 'gateway_unavailable', 'unavailable']) {
  test(`user observes that ${state} removes current readiness while preserving historical signals across locale changes`, () => {
    // Given the remote summary panel and observer snapshot
    const dom = new JSDOM('<body></body>');
    const panel = createStrategy29SummaryPanel(dom.window.document, 'BTC/USDT:USDT');
    // When panel.renderStatus processes the configured inputs
    panel.renderStatus(status);
    panel.addEvents(events.events, events.observed_at_ms);
    // Then user observes that the selected case removes current readiness while preserving historical signals across locale changes
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

test('user distinguishes stored processing success from current live readiness', () => {
  // Given the remote summary panel and observer snapshot
  const dom = new JSDOM('<body></body>');
  const panel = createStrategy29SummaryPanel(dom.window.document, 'BTC/USDT:USDT');
  // When panel.renderStatus processes the configured inputs
  panel.renderStatus({ ...status, universe: {
    ...status.universe, ready_unit_count: 0, pending_unit_count: status.universe.selected_unit_count,
  } });
  // Then user distinguishes stored processing success from current live readiness
  assert.match(dom.window.document.querySelector('[data-role=selection-details]').textContent, /0\/3 live units ready/);
  assert.match(dom.window.document.querySelector('[data-role=notices]').textContent, /3 server monitoring units are not ready/);
  assert.match(dom.window.document.body.textContent, /Last processing status/);
  assert.match(dom.window.document.body.textContent, /Stored processing status does not confirm current live readiness/);
  const processing = dom.window.document.querySelector('[data-role=unit]').children[1];
  assert.equal(processing.textContent, 'Processed');
  assert.equal(processing.style.color, 'rgb(132, 142, 156)');
  panel.destroy();
  dom.window.close();
});

test('user distinguishes unavailable selection, unselected symbol and pending unit registration', () => {
  // Given the remote summary panel and observer snapshot
  const dom = new JSDOM('<body></body>');
  const panel = createStrategy29SummaryPanel(dom.window.document, 'BTC/USDT:USDT');
  // When panel.addEvents processes the configured inputs
  panel.addEvents(events.events);
  panel.renderStatus({ ...status, units: [] });
  // Then user distinguishes unavailable selection, unselected symbol and pending unit registration
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

test('user observes that replaces dynamic membership while retaining durable signal history', () => {
  // Given the remote summary panel and observer snapshot
  const dom = new JSDOM('<body></body>');
  const panel = createStrategy29SummaryPanel(dom.window.document, 'BTC/USDT:USDT');
  // When panel.renderStatus processes the configured inputs
  panel.renderStatus(status);
  panel.addEvents(events.events);
  // Then user observes that replaces dynamic membership while retaining durable signal history
  assert.equal(dom.window.document.querySelectorAll('[data-role=unit]').length, 2);
  panel.renderStatus({ ...status, universe: { ...status.universe, configured_timeframes: ['1h'] } });
  assert.deepEqual([...dom.window.document.querySelectorAll('[data-role=unit]')].map(row => row.firstChild.textContent), ['1h']);
  assert.equal(dom.window.document.querySelectorAll('[data-role=remote-event]').length, 1);
  panel.renderStatus({ ...status, universe: { ...status.universe, selected_markets: ['ETH/USDT:USDT'] }, units: [] });
  assert.equal(dom.window.document.querySelectorAll('[data-role=unit]').length, 0);
  assert.match(dom.window.document.body.textContent, /Symbol is not watched/);
  assert.equal(dom.window.document.querySelectorAll('[data-role=remote-event]').length, 1);
  panel.renderStatus({ ...status, universe: { ...status.universe, configured_timeframes: ['4h'] }, units: [{ ...status.units[0], timeframe: '4h', status: 'warming', reason: 'awaiting_producer_generation' }] });
  const units = dom.window.document.querySelectorAll('[data-role=unit]');
  assert.equal(units.length, 1);
  assert.match(units[0].textContent, /4h.*Warming.*Awaiting producer generation/);
  assert.doesNotMatch(dom.window.document.body.textContent, /Symbol is not watched/);
  panel.destroy();
  dom.window.close();
});

test('user renders all watched timeframes for the route symbol and labels global delivery totals', () => {
  // Given the remote summary panel and observer snapshot
  const dom = new JSDOM('<body></body>');
  const panel = createStrategy29SummaryPanel(dom.window.document, 'BTC/USDT:USDT');
  // When panel.renderStatus processes the configured inputs
  panel.renderStatus(status);
  const text = dom.window.document.body.textContent;
  // Then user renders all watched timeframes for the route symbol and labels global delivery totals
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

test('user sees multi-timeframe events with deduplicated identities and independently cleared remote rows', () => {
  // Given the remote summary panel and observer snapshot
  const dom = new JSDOM('<body></body>');
  const panel = createStrategy29SummaryPanel(dom.window.document, 'BTC/USDT:USDT');
  // When panel.addEvents processes the configured inputs
  panel.addEvents(events.events, events.observed_at_ms);
  panel.addEvents([events.events[0]]);
  // Then user sees multi-timeframe events with deduplicated identities and independently cleared remote rows
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

test('user observes that makes server/local spec mismatch visible without rendering it as verified', () => {
  // Given the remote summary panel and observer snapshot
  const dom = new JSDOM('<body></body>');
  const panel = createStrategy29SummaryPanel(dom.window.document, 'BTC/USDT:USDT');
  // When panel.renderStatus processes the configured inputs
  panel.renderStatus(status);
  panel.addEvents(events.events, events.observed_at_ms);
  panel.renderStatus({ schema_version: 1, spec_version: 'other_spec', observed_at_ms: status.observed_at_ms });
  // Then user observes that makes server/local spec mismatch visible without rendering it as verified
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

test('user retains newest signal close times regardless of insertion or detection order', () => {
  // Given the remote summary panel and observer snapshot
  const dom = new JSDOM('<body></body>');
  const panel = createStrategy29SummaryPanel(dom.window.document, 'BTC/USDT:USDT');
  const first = { ...events.events[0], event_id: 'a'.repeat(64), sequence: 10, detected_at_ms: 3000, bar_close_ms: 3000 };
  const second = { ...events.events[0], event_id: 'b'.repeat(64), sequence: 11, detected_at_ms: 2000, bar_close_ms: 3000 };
  const third = { ...events.events[0], event_id: 'c'.repeat(64), sequence: 12, detected_at_ms: 4000, bar_close_ms: 2000 };
  const fourth = { ...events.events[0], event_id: 'd'.repeat(64), sequence: 13, detected_at_ms: 5000, bar_close_ms: 1000 };
  // When panel.addEvents processes the configured inputs
  panel.addEvents([first, second, third]);
  panel.addEvents([fourth]);
  // Then user retains newest signal close times regardless of insertion or detection order
  assert.deepEqual([...dom.window.document.querySelectorAll('[data-role=remote-event]')].map(row => row.dataset.eventId), [second.event_id, first.event_id, third.event_id]);
  panel.destroy();
  dom.window.close();
});
