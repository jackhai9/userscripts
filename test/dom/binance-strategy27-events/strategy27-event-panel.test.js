import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { loadFixtureDom } from '../../helpers/dom.js';
import { captureStrategyError } from '../../helpers/strategy-migration-boundaries.js';
import { createLocalizedAnnotation } from '../../../src/binance-strategy27-events/core/ui-copy.js';
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

test('user renders one fixed detail panel and a bounded recent-event list', () => {
  // Given the Strategy 27 panel and its event records
  const dom = loadFixtureDom('<div class="chart-widget-root"></div>');
  const { document } = dom.window;
  // When document.querySelector processes the configured inputs
  const chartRoot = document.querySelector('.chart-widget-root');
  const panel = createStrategy27EventPanel(dom.window.document, chartRoot, panelOptions(2));

  panel.upsert('event-a', annotation({ time: 1_000 }), 1_100);
  panel.upsert('event-b', annotation({ time: 2_000, summary: '价格 -2.8 bps · 点差 2.3 bps' }), 2_100);
  panel.upsert('event-c', annotation({ time: 3_000, summary: '价格 +0.04 bps · 点差 1.1 bps' }), 3_100);

  // Then user renders one fixed detail panel and a bounded recent-event list
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

test('user observes that ordinary and compound histories have independent bounds and reset ownership', () => {
  // Given the Strategy 27 panel and its event records
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
  // When panel.clear processes the configured inputs
  panel.clear();
  // Then user observes that ordinary and compound histories have independent bounds and reset ownership
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

test('user observes that compound connection status survives ordinary updates and both streams expose selectable detail', () => {
  // Given the Strategy 27 panel and its event records
  const dom = loadFixtureDom('<div class="chart-widget-root"></div>');
  const { document } = dom.window;
  const panel = createStrategy27EventPanel(document, document.querySelector('.chart-widget-root'), panelOptions(8));
  // When panel.upsertCompound processes the configured inputs
  panel.upsertCompound('impact', compoundAnnotation(7000), 8000);
  panel.upsertCompound('passive', compoundAnnotation(7000, '被动承接转弱'), 8000);
  panel.setCompoundStatus('复合候选不可用，正在重连', 'inactive');
  panel.upsert('ordinary', annotation({ time: 9000 }), 9000);
  // Then user observes that compound connection status survives ordinary updates and both streams expose selectable detail
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

test('user keeps a manually selected event until follow-latest is restored', () => {
  // Given the Strategy 27 panel and its event records
  const dom = loadFixtureDom('<div class="chart-widget-root"></div>');
  const { document } = dom.window;
  // When document.querySelector processes the configured inputs
  const chartRoot = document.querySelector('.chart-widget-root');
  const panel = createStrategy27EventPanel(dom.window.document, chartRoot, panelOptions(3));

  panel.upsert('event-a', annotation({ time: 1_000, summary: '价格 +1.0 bps · 点差 1.0 bps' }), 1_100);
  panel.upsert('event-b', annotation({ time: 2_000, summary: '价格 -2.0 bps · 点差 1.0 bps' }), 2_100);
  const eventA = [...document.querySelectorAll('[data-role="event-row"]')]
    .find((row) => row.dataset.eventId === 'event-a');
  eventA.click();
  panel.upsert('event-c', annotation({ time: 3_000, summary: '价格 +3.0 bps · 点差 1.0 bps' }), 3_100);

  // Then user keeps a manually selected event until follow-latest is restored
  assert.match(document.querySelector('[data-role="event-detail"]').textContent, /\+1\.0 bps/);
  document.querySelector('[data-role="follow-latest"]').click();
  assert.match(document.querySelector('[data-role="event-detail"]').textContent, /\+3\.0 bps/);

  panel.clear();
  assert.equal(panel.size, 0);
  assert.match(document.querySelector('[data-role="event-detail"]').textContent, /等待新事件/);
  panel.destroy();
  assert.equal(document.querySelector('#jh-strategy27-event-panel'), null);
});

test('user drags the panel by its header and persists its bounded position without dragging header buttons', () => {
  // Given the Strategy 27 panel and its event records
  const dom = loadFixtureDom('<div class="chart-widget-root"></div>');
  const { document } = dom.window;
  // When document.querySelector processes the configured inputs
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

  // Then user drags the panel by its header and persists its bounded position without dragging header buttons
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

test('user observes that transport history marking preserves selection, facts, bounds and compound ownership', () => {
  // Given the Strategy 27 panel and its event records
  const dom = loadFixtureDom('<div class="chart-widget-root"></div>');
  const { document } = dom.window;
  const panel = createStrategy27EventPanel(document, document.querySelector('.chart-widget-root'), panelOptions(2));
  // When panel.upsert processes the configured inputs
  panel.upsert('old', { ...annotation(), status: 'active' }, 1100);
  panel.upsert('latest', { ...annotation({ time: 2000 }), status: 'complete' }, 2100);
  panel.upsertCompound('compound', compoundAnnotation(3000), 3100);
  document.querySelector('[data-event-id="old"]').click();
  panel.retainHistory();
  panel.retainHistory();
  // Then user observes that transport history marking preserves selection, facts, bounds and compound ownership
  assert.equal(panel.size, 2);
  assert.equal(panel.compoundSize, 1);
  const detail = document.querySelector('[data-role="event-detail"]');
  assert.match(detail.textContent, /历史记录/);
  assert.match(detail.textContent, /12\.3K USDT/);
  assert.equal(detail.textContent.split('数据流已重启，当前显示最后收到的观察记录。').length, 2);
  panel.upsert('latest', { ...annotation({ time: 2000 }), status: 'complete' }, 2200);
  assert.match(detail.textContent, /历史记录/);
  panel.upsert('old', { ...annotation(), status: 'complete' }, 2300);
  assert.doesNotMatch(detail.textContent, /历史记录|数据流已重启/);
  assert.match(detail.textContent, /已结束/);
  assert.equal(panel.compoundSize, 1);
  panel.destroy();
  dom.window.close();
});

test('user observes that monitoring status remains independent of selected history and connection recovery', () => {
  // Given the Strategy 27 panel and its event records
  const dom = loadFixtureDom('<div class="chart-widget-root"></div>');
  const { document } = dom.window;
  const panel = createStrategy27EventPanel(document, document.querySelector('.chart-widget-root'), panelOptions(2));
  const removed = { triggered_at_ms: 2000, event_status: 'incomplete', close_reason: 'universe_removed' };
  // When panel.upsert processes the configured inputs
  panel.upsert('old', annotation({ time: 1000 }), 1100);
  panel.upsert('removed', annotation({ time: 2000 }), 3000);
  panel.observeOrdinaryEvent(removed, 3000);
  const monitoring = document.querySelector('[data-role="ordinary-monitoring-status"]');
  const connection = document.querySelector('[data-role="ordinary-connection-status"]');
  // Then user observes that monitoring status remains independent of selected history and connection recovery
  assert.equal(monitoring.dataset.state, 'removed');
  assert.match(monitoring.textContent, /已移出监控范围/);
  document.querySelector('[data-event-id="old"]').click();
  panel.retainHistory();
  panel.setOrdinaryConnection('connected');
  panel.setCompoundStatus('Connected', 'normal');
  assert.equal(monitoring.dataset.state, 'removed');
  assert.match(connection.textContent, /已连接/);
  panel.observeOrdinaryEvent({ ...removed, triggered_at_ms: 1000 }, 9000);
  panel.observeOrdinaryEvent({ triggered_at_ms: 2000, event_status: 'active', close_reason: null }, 10000);
  assert.equal(monitoring.dataset.state, 'removed');
  panel.observeOrdinaryEvent({ triggered_at_ms: 4000, event_status: 'active', close_reason: null }, 11000);
  assert.equal(monitoring.dataset.state, 'observed');
  assert.doesNotMatch(monitoring.textContent, /removed/);
  panel.observeOrdinaryEvent(removed, 12000);
  assert.equal(monitoring.dataset.state, 'observed');
  panel.retainHistory();
  assert.equal(monitoring.dataset.state, 'historical');
  panel.setOrdinaryConnection('reconnecting');
  assert.match(connection.textContent, /正在重连/);
  panel.setOrdinaryConnection('stopped');
  assert.match(connection.textContent, /已停止/);
  panel.clear();
  assert.equal(monitoring.dataset.state, 'historical');
  panel.destroy();
  dom.window.close();
});

for (const [field, value] of [
  ['maxEvents', 0], ['maxEvents', 1.5],
  ['maxCompoundEvents', 0], ['maxCompoundEvents', 9],
  ['loadPosition', null], ['savePosition', null],
]) {
  test(`user rejects invalid panel option ${field}=${value} before creating the panel`, (t) => {
    // Given the requested panel dependency or capacity violates its public contract
    const dom = loadFixtureDom('<div class="chart-widget-root"></div>');
    t.after(() => dom.window.close());
    const { document } = dom.window;
    const options = panelOptions(2, { [field]: value });

    // When the panel is created with the invalid option
    const failure = captureStrategyError(() => createStrategy27EventPanel(document, document.querySelector('.chart-widget-root'), options));

    // Then the invalid option is identified and no panel has been mounted
    assert.equal(failure.message, `Strategy 27 panel ${field} is invalid`);
    assert.equal(document.getElementById('jh-strategy27-event-panel'), null);
  });
}

for (const [label, position] of [
  ['missing position', undefined], ['text position', '100,200'],
  ['non-finite left coordinate', { left: Infinity, top: 0 }],
  ['text top coordinate', { left: 0, top: '200' }],
]) {
  test(`user receives an explicit error for a stored ${label}`, (t) => {
    // Given the saved position is not a valid pair of numeric coordinates
    const dom = loadFixtureDom('<div class="chart-widget-root"></div>');
    t.after(() => dom.window.close());
    const { document } = dom.window;
    const options = panelOptions(2, { loadPosition: () => position });

    // When the panel restores its persisted position
    const failure = captureStrategyError(() => createStrategy27EventPanel(document, document.querySelector('.chart-widget-root'), options));

    // Then malformed persisted coordinates are rejected explicitly
    assert.equal(failure.message, 'Strategy 27 panel position is invalid');
  });
}

test('user cannot mount the panel into a document without a browsing context', (t) => {
  // Given a real detached HTML document has no associated window
  const dom = new JSDOM('<body></body>');
  t.after(() => dom.window.close());
  const document = dom.window.document.implementation.createHTMLDocument('Detached');
  const chartRoot = document.createElement('div');
  document.body.append(chartRoot);
  assert.equal(document.defaultView, null);

  // When panel placement requires the unavailable viewport
  const failure = captureStrategyError(() => createStrategy27EventPanel(document, chartRoot, panelOptions(2)));

  // Then the missing window is reported without inventing viewport dimensions
  assert.equal(failure.message, 'Strategy 27 panel window is unavailable');
});

test('user keeps a restored panel inside the viewport before native layout has measured its size', (t) => {
  // Given native JSDOM geometry has zero dimensions and the saved position lies outside the viewport
  const dom = new JSDOM('<div class="chart-widget-root"></div>');
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const chartRoot = document.querySelector('.chart-widget-root');
  assert.equal(chartRoot.offsetWidth, 0);
  assert.equal(chartRoot.offsetHeight, 0);

  // When the panel restores an out-of-bounds saved position before layout
  const panel = createStrategy27EventPanel(document, chartRoot, panelOptions(2, {
    loadPosition: () => ({ left: 10000, top: 10000 }),
  }));
  t.after(() => panel.destroy());
  const element = document.getElementById('jh-strategy27-event-panel');

  // Then the designed 320 by 48 pre-layout bounds keep the panel on screen
  assert.equal(element.offsetWidth, 0);
  assert.equal(element.offsetHeight, 0);
  assert.equal(element.style.left, '704px');
  assert.equal(element.style.top, '720px');
});

test('user sees neutral facts without a directional color or an empty detail separator', (t) => {
  // Given the event contains neutral facts and a force row without additional detail
  const dom = loadFixtureDom('<div class="chart-widget-root"></div>');
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const panel = createStrategy27EventPanel(document, document.querySelector('.chart-widget-root'), panelOptions(2));
  t.after(() => panel.destroy());
  const neutral = { ...annotation(), markerColor: null, candidateText: null, forceRows: [{ label: 'Trades', value: '0 trades', detail: null }] };

  // When the neutral observation becomes the selected event
  panel.upsert('neutral', neutral, 2000);
  const detail = document.querySelector('[data-role="event-detail"]');
  const row = document.querySelector('[data-event-id="neutral"]');

  // Then neutral text remains readable and the event dot has no direction
  assert.equal(detail.firstElementChild.firstElementChild.style.color, 'rgb(234, 236, 239)');
  assert.equal([...detail.children].find(element => element.textContent.includes(neutral.summary)).lastElementChild.style.color, 'rgb(234, 236, 239)');
  assert.equal(row.firstElementChild.style.background, 'transparent');
  assert.match(detail.textContent, /0 trades/);
  assert.doesNotMatch(detail.textContent, /0 trades｜/);
});

test('user retains the reported monitor stop after transport reconnects', (t) => {
  // Given a terminal event explicitly reports that monitoring stopped
  const dom = loadFixtureDom('<div class="chart-widget-root"></div>');
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const panel = createStrategy27EventPanel(document, document.querySelector('.chart-widget-root'), panelOptions(2, { locale: 'en' }));
  t.after(() => panel.destroy());
  panel.upsert('stopped', annotation(), 3000);
  panel.observeOrdinaryEvent({ triggered_at_ms: 1000, event_status: 'incomplete', close_reason: 'monitor_stopped' }, 3000);

  // When the transport reconnects and existing observations become retained history
  panel.setOrdinaryConnection('reconnecting');
  panel.retainHistory();
  panel.setOrdinaryConnection('connected');

  // Then a connected transport does not claim the monitor has restarted
  const monitoring = document.querySelector('[data-role="ordinary-monitoring-status"]');
  assert.equal(monitoring.dataset.state, 'stopped');
  assert.match(monitoring.textContent, /Monitoring stopped\. Retained records are historical\./);
  assert.equal(document.querySelector('[data-role="ordinary-connection-status"]').textContent, 'Event data: Connected');
  assert.equal(document.querySelector('[data-event-id="stopped"]').dataset.historical, 'true');
});

test('user keeps the selected event while collapsing the panel and changing language', (t) => {
  // Given a selected event carries both supported localized copies
  const dom = loadFixtureDom('<div class="chart-widget-root"></div>');
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const panel = createStrategy27EventPanel(document, document.querySelector('.chart-widget-root'), panelOptions(2));
  t.after(() => panel.destroy());
  panel.upsert('selected', createLocalizedAnnotation(locale => ({ ...annotation(), title: locale === 'en' ? 'Order flow observation' : '订单流观察' }), 'zh-CN'), 2000);
  document.querySelector('[data-event-id="selected"]').click();
  const collapse = document.querySelector('[data-role="collapse"]');
  const body = document.querySelector('[data-role="panel-body"]');

  // When the user collapses the panel and switches its language
  collapse.click();
  panel.setLocale('en');

  // Then the hidden body retains its selected record with the localized expand action
  assert.equal(body.style.display, 'none');
  assert.equal(collapse.textContent, 'Expand');
  assert.match(document.querySelector('[data-role="event-detail"]').textContent, /Order flow observation/);
  assert.equal(document.querySelector('[data-role="follow-latest"]').style.color, 'rgb(234, 236, 239)');
  assert.equal(panel.size, 1);

  // When the user expands the same panel
  collapse.click();

  // Then its record is visible again without replaying the event stream
  assert.equal(body.style.display, 'block');
  assert.equal(collapse.textContent, 'Collapse');
  assert.equal(document.querySelector('[data-role="event-row"]').dataset.eventId, 'selected');
});

test('user does not move or persist the panel with a secondary-button drag', (t) => {
  // Given the panel has a valid saved position and records persistence attempts
  const dom = loadFixtureDom('<div class="chart-widget-root"></div>');
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const saved = [];
  const panel = createStrategy27EventPanel(document, document.querySelector('.chart-widget-root'), panelOptions(2, {
    loadPosition: () => ({ left: 100, top: 120 }), savePosition: position => saved.push(position),
  }));
  t.after(() => panel.destroy());
  const element = document.getElementById('jh-strategy27-event-panel');

  // When the header receives a secondary-button drag gesture
  element.querySelector('header').dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true, button: 2, clientX: 120, clientY: 140 }));
  document.dispatchEvent(new dom.window.MouseEvent('mousemove', { bubbles: true, clientX: 400, clientY: 400 }));
  document.dispatchEvent(new dom.window.MouseEvent('mouseup', { bubbles: true, button: 2 }));

  // Then neither the panel coordinates nor persisted settings change
  assert.equal(element.style.left, '100px');
  assert.equal(element.style.top, '120px');
  assert.deepEqual(saved, []);
});

for (const [label, update, expected] of [
  ['unknown ordinary connection', panel => panel.setOrdinaryConnection('unknown'), 'Invalid ordinary connection state'],
  ['unknown compound status', panel => panel.setCompoundStatus('Connected', 'unknown'), 'Strategy 27 compound panel status is invalid'],
  ['non-text compound status', panel => panel.setCompoundStatus(null, 'normal'), 'Strategy 27 compound panel status is invalid'],
]) {
  test(`user rejects ${label} without changing the visible connection state`, (t) => {
    // Given both panel streams have their original connection presentation
    const dom = loadFixtureDom('<div class="chart-widget-root"></div>');
    t.after(() => dom.window.close());
    const { document } = dom.window;
    const panel = createStrategy27EventPanel(document, document.querySelector('.chart-widget-root'), panelOptions(2));
    t.after(() => panel.destroy());
    const before = document.querySelector('[data-role="panel-body"]').textContent;

    // When a caller supplies the invalid connection update
    const failure = captureStrategyError(() => update(panel));

    // Then the update fails explicitly and existing visible state survives
    assert.equal(failure.message, expected);
    assert.equal(document.querySelector('[data-role="panel-body"]').textContent, before);
  });
}
