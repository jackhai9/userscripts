import assert from 'node:assert/strict';
import test from 'node:test';

import { loadFixtureDom } from '../../helpers/dom.js';
import { createStrategy27EventPanel } from '../../../src/binance-strategy27-events/dom/strategy27-event-panel.js';

function annotation({ time = 1_000, summary = '价格 +4.2 bps · 点差 1.2 bps' } = {}) {
  return {
    title: '订单流观察',
    eventTimeMs: time,
    markerColor: '#0ECB81',
    windowText: '统计 1 秒 · 4 桶',
    candidateText: '卖出推动失效 · 抛压转弱',
    summary,
    forceRows: [
      { label: '主动买', value: '12.3K USDT · 3 笔', detail: '吃 ask 深度 0.41' },
      { label: '主动卖', value: '200 USDT · 1 笔', detail: '吃 bid 深度 0.1' },
      { label: 'bid', value: '增 300 · 减 100', detail: '迁移 +0.23 bps' },
      { label: 'ask', value: '增 100 · 减 500', detail: '迁移 -0.41 bps' },
    ],
    triggerText: '主动买、ask 减',
    closeText: null,
    notices: [],
  };
}

function panelOptions(maxEvents, overrides = {}) {
  return {
    maxEvents,
    maxCompoundEvents: maxEvents,
    loadPosition: () => null,
    savePosition: () => {},
    ...overrides,
  };
}

test('renders one fixed detail panel and a bounded recent-event list', () => {
  const dom = loadFixtureDom('<div class="chart-widget-root"></div>');
  const { document } = dom.window;
  const chartRoot = document.querySelector('.chart-widget-root');
  const panel = createStrategy27EventPanel(dom.window.document, chartRoot, panelOptions(2));

  panel.upsert('event-a', annotation({ time: 1_000 }), 1_100);
  panel.upsert('event-b', annotation({ time: 2_000, summary: '价格 -2.8 bps · 点差 2.3 bps' }), 2_100);
  panel.upsert('event-c', annotation({ time: 3_000, summary: '价格 +0.04 bps · 点差 1.1 bps' }), 3_100);

  assert.equal(document.querySelectorAll('#jh-strategy27-event-panel').length, 1);
  assert.equal(document.querySelectorAll('[data-role="event-row"]').length, 2);
  assert.match(document.querySelector('[data-role="event-detail"]').textContent, /\+0\.04 bps/);
  assert.match(document.querySelector('[data-role="event-detail"]').textContent, /12\.3K USDT/);
  assert.doesNotMatch(document.body.textContent, /12345\.6789/);
  assert.equal(panel.size, 2);
});

function compoundAnnotation(time, family = '买入推动失效') {
  return {
    kind: 'compound',
    title: '复合候选高',
    titleColor: '#FF718A',
    eventTimeMs: time,
    markerColor: '#B71C3B',
    ruleIdentity: `impact_failure/high/${'a'.repeat(64)}`,
    candidateId: 'b'.repeat(64),
    summary: family,
    detailRows: [
      { label: '规则', value: family },
      { label: '证据', value: '上涨背景 → 买入未推动 → 后续转弱' },
      { label: '参数版本', value: 'compound-exploration-1' },
    ],
    notices: ['探索候选，尚未验证预测能力'],
  };
}

test('ordinary and compound histories have independent bounds and reset ownership', () => {
  const dom = loadFixtureDom('<div class="chart-widget-root"></div>');
  const { document } = dom.window;
  const panel = createStrategy27EventPanel(document, document.querySelector('.chart-widget-root'), panelOptions(8));
  for (let i = 0; i < 9; i += 1) {
    panel.upsert(`event-${i}`, annotation({ time: 1000 + i }), 2000 + i);
    panel.upsertCompound(`candidate-${i}`, compoundAnnotation(1000 + i), 2000 + i);
  }
  assert.equal(panel.size, 8);
  assert.equal(panel.compoundSize, 8);
  assert.equal(document.querySelectorAll('[data-role="event-row"]').length, 8);
  assert.equal(document.querySelectorAll('[data-role="compound-row"]').length, 8);
  assert.equal(document.querySelector('[data-event-id="candidate-0"]'), null);
  panel.clear();
  assert.equal(panel.size, 0);
  assert.equal(panel.compoundSize, 8);
  assert.equal(document.querySelectorAll('[data-role="compound-row"]').length, 8);
  panel.upsert('retained-ordinary', annotation({ time: 3000 }), 3000);
  panel.clearCompound();
  assert.equal(panel.compoundSize, 0);
  assert.equal(panel.size, 1);
  assert.equal(document.querySelector('[data-role="event-row"]').dataset.eventId, 'retained-ordinary');
  panel.destroy();
});

test('compound connection status survives ordinary updates and both streams expose selectable detail', () => {
  const dom = loadFixtureDom('<div class="chart-widget-root"></div>');
  const { document } = dom.window;
  const panel = createStrategy27EventPanel(document, document.querySelector('.chart-widget-root'), panelOptions(8));
  panel.upsertCompound('impact', compoundAnnotation(7000), 8000);
  panel.upsertCompound('passive', compoundAnnotation(7000, '被动承接转弱'), 8000);
  panel.setCompoundStatus('复合候选不可用，正在重连', 'inactive');
  panel.upsert('ordinary', annotation({ time: 9000 }), 9000);
  assert.equal(document.querySelector('[data-role="compound-status"]').textContent, '复合候选不可用，正在重连');
  const rows = [...document.querySelectorAll('[data-role="compound-row"]')];
  assert.equal(rows.length, 2);
  assert.deepEqual(new Set(rows.map((row) => row.dataset.eventId)), new Set(['impact', 'passive']));
  rows.find((row) => row.dataset.eventId === 'passive').click();
  assert.match(document.querySelector('[data-role="event-detail"]').textContent, /被动承接转弱/);
  panel.upsert('ordinary-new', annotation({ time: 10000 }), 10000);
  assert.match(document.querySelector('[data-role="event-detail"]').textContent, /被动承接转弱/);
  panel.removeCompound('impact');
  assert.match(document.querySelector('[data-role="event-detail"]').textContent, /被动承接转弱/);
  document.querySelector('[data-role="follow-latest"]').click();
  assert.match(document.querySelector('[data-role="event-detail"]').textContent, /订单流观察/);
  panel.setCompoundStatus('复合候选已连接', 'normal');
  assert.equal(document.querySelector('[data-role="compound-status"]').textContent, '复合候选已连接');
  panel.destroy();
});

test('keeps a manually selected event until follow-latest is restored', () => {
  const dom = loadFixtureDom('<div class="chart-widget-root"></div>');
  const { document } = dom.window;
  const chartRoot = document.querySelector('.chart-widget-root');
  const panel = createStrategy27EventPanel(dom.window.document, chartRoot, panelOptions(3));

  panel.upsert('event-a', annotation({ time: 1_000, summary: '价格 +1.0 bps · 点差 1.0 bps' }), 1_100);
  panel.upsert('event-b', annotation({ time: 2_000, summary: '价格 -2.0 bps · 点差 1.0 bps' }), 2_100);
  const eventA = [...document.querySelectorAll('[data-role="event-row"]')]
    .find((row) => row.dataset.eventId === 'event-a');
  eventA.click();
  panel.upsert('event-c', annotation({ time: 3_000, summary: '价格 +3.0 bps · 点差 1.0 bps' }), 3_100);

  assert.match(document.querySelector('[data-role="event-detail"]').textContent, /\+1\.0 bps/);
  document.querySelector('[data-role="follow-latest"]').click();
  assert.match(document.querySelector('[data-role="event-detail"]').textContent, /\+3\.0 bps/);

  panel.clear();
  assert.equal(panel.size, 0);
  assert.match(document.querySelector('[data-role="event-detail"]').textContent, /等待新事件/);
  panel.destroy();
  assert.equal(document.querySelector('#jh-strategy27-event-panel'), null);
});

test('drags the panel by its header, persists the bounded position, and ignores header buttons', () => {
  const dom = loadFixtureDom('<div class="chart-widget-root"></div>');
  const { document } = dom.window;
  const chartRoot = document.querySelector('.chart-widget-root');
  Object.defineProperties(dom.window, {
    innerWidth: { configurable: true, value: 500 },
    innerHeight: { configurable: true, value: 400 },
  });
  chartRoot.getBoundingClientRect = () => ({
    left: 0,
    right: 500,
    top: 80,
    bottom: 400,
    width: 500,
    height: 320,
  });

  const savedPositions = [];
  const controller = createStrategy27EventPanel(document, chartRoot, panelOptions(2, {
    loadPosition: () => ({ left: 100, top: 120 }),
    savePosition: (position) => savedPositions.push(position),
  }));
  const panel = document.querySelector('#jh-strategy27-event-panel');
  const header = panel.querySelector('header');
  const latestButton = panel.querySelector('[data-role="follow-latest"]');
  Object.defineProperties(panel, {
    offsetWidth: { configurable: true, value: 320 },
    offsetHeight: { configurable: true, value: 200 },
  });
  panel.getBoundingClientRect = () => {
    const left = Number.parseFloat(panel.style.left);
    const top = Number.parseFloat(panel.style.top);
    return { left, right: left + 320, top, bottom: top + 200, width: 320, height: 200 };
  };

  assert.equal(panel.style.position, 'fixed');
  assert.equal(panel.style.left, '100px');
  assert.equal(panel.style.top, '120px');
  assert.equal(header.style.cursor, 'move');

  header.dispatchEvent(new dom.window.MouseEvent('mousedown', {
    bubbles: true,
    clientX: 140,
    clientY: 150,
  }));
  document.dispatchEvent(new dom.window.MouseEvent('mousemove', {
    bubbles: true,
    clientX: 700,
    clientY: 600,
  }));
  document.dispatchEvent(new dom.window.MouseEvent('mouseup', { bubbles: true }));

  assert.equal(panel.style.left, '180px');
  assert.equal(panel.style.top, '200px');
  assert.deepEqual(savedPositions, [{ left: 180, top: 200 }]);

  latestButton.dispatchEvent(new dom.window.MouseEvent('mousedown', {
    bubbles: true,
    clientX: 200,
    clientY: 210,
  }));
  document.dispatchEvent(new dom.window.MouseEvent('mousemove', {
    bubbles: true,
    clientX: 0,
    clientY: 0,
  }));
  document.dispatchEvent(new dom.window.MouseEvent('mouseup', { bubbles: true }));
  assert.equal(panel.style.left, '180px');
  assert.equal(panel.style.top, '200px');
  assert.equal(savedPositions.length, 1);

  header.dispatchEvent(new dom.window.MouseEvent('mousedown', {
    bubbles: true,
    clientX: 200,
    clientY: 210,
  }));
  controller.destroy();
  document.dispatchEvent(new dom.window.MouseEvent('mousemove', {
    bubbles: true,
    clientX: 100,
    clientY: 100,
  }));
  document.dispatchEvent(new dom.window.MouseEvent('mouseup', { bubbles: true }));
  assert.equal(savedPositions.length, 1);
});
