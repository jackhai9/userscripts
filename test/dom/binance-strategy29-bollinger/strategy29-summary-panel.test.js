import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { createStrategy29SummaryPanel } from '../../../src/binance-strategy29-bollinger/dom/strategy29-summary-panel.js';

const status = JSON.parse(await readFile(new URL('../../fixtures/strategy29-gateway-status.json', import.meta.url)));
const events = JSON.parse(await readFile(new URL('../../fixtures/strategy29-gateway-events.json', import.meta.url)));

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
  panel.renderStatus({ ...status, spec_version: '29_2_spec_v2' });
  assert.match(dom.window.document.body.textContent, /Spec mismatch/);
  assert.equal(dom.window.document.querySelector('[data-role=spec]').dataset.state, 'error');
  panel.destroy();
  dom.window.close();
});
