import assert from 'node:assert/strict';
import test from 'node:test';

import { loadFixtureDom } from '../../helpers/dom.js';
import { createStrategy27EventPanel } from '../../../src/binance-strategy27-events/dom/strategy27-event-panel.js';

function annotation({ time = 1_000, summary = '价格 +4.2 bps · 点差 1.2 bps' } = {}) {
  return {
    title: '订单流事件',
    eventTimeMs: time,
    markerColor: '#0ECB81',
    summary,
    forceRows: [
      { label: '主动买', value: '12.3K USDT · 3 笔', detail: '吃 ask 深度 0.41' },
      { label: '主动卖', value: '200 USDT · 1 笔', detail: '吃 bid 深度 0.1' },
      { label: 'bid', value: '增 300 · 减 100', detail: '迁移 +0.23 bps' },
      { label: 'ask', value: '增 100 · 减 500', detail: '迁移 -0.41 bps' },
    ],
    triggerText: '主动买、ask 减',
    closeText: null,
    outcomeLines: [],
    notices: [],
  };
}

test('renders one fixed detail panel and a bounded recent-event list', () => {
  const dom = loadFixtureDom('<div class="chart-widget-root"></div>');
  const chartRoot = dom.window.document.querySelector('.chart-widget-root');
  const panel = createStrategy27EventPanel(dom.window.document, chartRoot, { maxEvents: 2 });

  panel.upsert('event-a', annotation({ time: 1_000 }), 1_100);
  panel.upsert('event-b', annotation({ time: 2_000, summary: '价格 -2.8 bps · 点差 2.3 bps' }), 2_100);
  panel.upsert('event-c', annotation({ time: 3_000, summary: '价格 +0.04 bps · 点差 1.1 bps' }), 3_100);

  assert.equal(chartRoot.querySelectorAll('#jh-strategy27-event-panel').length, 1);
  assert.equal(chartRoot.querySelectorAll('[data-role="event-row"]').length, 2);
  assert.match(chartRoot.querySelector('[data-role="event-detail"]').textContent, /\+0\.04 bps/);
  assert.match(chartRoot.querySelector('[data-role="event-detail"]').textContent, /12\.3K USDT/);
  assert.doesNotMatch(chartRoot.textContent, /12345\.6789/);
  assert.equal(panel.size, 2);
});

test('keeps a manually selected event until follow-latest is restored', () => {
  const dom = loadFixtureDom('<div class="chart-widget-root"></div>');
  const chartRoot = dom.window.document.querySelector('.chart-widget-root');
  const panel = createStrategy27EventPanel(dom.window.document, chartRoot, { maxEvents: 3 });

  panel.upsert('event-a', annotation({ time: 1_000, summary: '价格 +1.0 bps · 点差 1.0 bps' }), 1_100);
  panel.upsert('event-b', annotation({ time: 2_000, summary: '价格 -2.0 bps · 点差 1.0 bps' }), 2_100);
  const eventA = [...chartRoot.querySelectorAll('[data-role="event-row"]')]
    .find((row) => row.dataset.eventId === 'event-a');
  eventA.click();
  panel.upsert('event-c', annotation({ time: 3_000, summary: '价格 +3.0 bps · 点差 1.0 bps' }), 3_100);

  assert.match(chartRoot.querySelector('[data-role="event-detail"]').textContent, /\+1\.0 bps/);
  chartRoot.querySelector('[data-role="follow-latest"]').click();
  assert.match(chartRoot.querySelector('[data-role="event-detail"]').textContent, /\+3\.0 bps/);

  panel.clear();
  assert.equal(panel.size, 0);
  assert.match(chartRoot.querySelector('[data-role="event-detail"]').textContent, /等待新事件/);
  panel.destroy();
  assert.equal(chartRoot.querySelector('#jh-strategy27-event-panel'), null);
});
