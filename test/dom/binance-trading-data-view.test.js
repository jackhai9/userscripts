import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createTradingDataView } from '../../src/binance-trading-data/panel-view.js';

const PANEL_ID = 'jh-binance-trading-data-panel';
const START = Date.UTC(2026, 9, 9, 4);

function indicator(id, values = {}) {
  return {
    id, signal: 'neutral', display: '1.20', unit: '', cached: false, vote: true,
    history: [
      { timestamp: START, value: 1.1 },
      { timestamp: START + 300_000, value: 1.2 },
    ],
    ...values,
  };
}

function model() {
  return {
    symbol: 'BTCUSDT', longCount: 3, shortCount: 1, total: 5,
    indicators: [
      indicator('oi', { display: '120.00', unit: 'BTC', history: [
        { timestamp: START, value: 100 },
        { timestamp: START + 300_000, value: 120 },
      ] }),
      indicator('top-accounts'), indicator('top-positions'), indicator('global-accounts'),
      indicator('taker', { display: '0.50', unit: 'BTC', history: [
        { timestamp: START, value: 1.2, buy: 12, sell: 10 },
        { timestamp: START + 300_000, value: 0.5, buy: 6, sell: 12 },
      ] }),
      indicator('basis', { display: '-0.10%', history: [{ timestamp: START, value: -0.001 }] }),
      indicator('funding', {
        display: '0.000029%', history: [{ timestamp: START, value: 0.00000029 }],
      }),
      indicator('oi-supply', { display: '5.00%', vote: false, history: [{ timestamp: START, value: 0.05 }] }),
    ],
  };
}

function fundingState(values = {}) {
  return {
    current: { value: 0.0000424, nextFundingTime: START + 5_400_000, time: START },
    intervalHours: 4, receivedAt: START, cached: false, error: null,
    intervalCached: false, intervalError: null,
    ...values,
  };
}

function harness(t, locale = 'zh-CN', collapsed = false) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>');
  const { document } = dom.window;
  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  document.body.append(panel);
  const actions = [];
  const view = createTradingDataView({
    document, panel, locale, collapsed,
    onCollapse: value => actions.push(['collapse', value]),
    onClose: () => actions.push(['close']),
  });
  t.after(() => { view.destroy(); dom.window.close(); });
  return {
    view, panel, window: dom.window, actions,
    element: suffix => document.getElementById(`${PANEL_ID}-${suffix}`),
    row: id => panel.querySelector(`[data-metric="${id}"]`),
  };
}

test('user sees the approved eight indicator names in Chinese and English', t => {
  // Given a Chinese panel receives all eight real indicator records
  const h = harness(t);
  const data = model();

  // When the display model is rendered
  h.view.render(data);

  // Then the three-column table uses the approved names and exposes current-symbol units
  assert.deepEqual([...h.element('rows').querySelectorAll('.td-name')].map(node => node.textContent), [
    '合约持仓量', '大户账户数多空比', '大户持仓量多空比', '多空账户数比',
    '合约主动买卖量', '基差', '资金费率', '未平仓量与市值比率',
  ]);
  assert.deepEqual([...h.panel.querySelectorAll('thead th')].map(node => node.textContent), ['指标', '历史趋势', '数值']);
  assert.equal(h.element('rows').children.length, 8);
  assert.equal(h.element('symbol').textContent, 'BTCUSDT');
  assert.equal(h.row('oi').querySelector('.td-unit').textContent, 'BTC');
  assert.equal(h.row('taker').querySelector('.td-unit').textContent, '买/卖比');
  assert.equal(h.row('basis').querySelector('.td-unit').textContent, '比率');
  assert.match(h.element('composite').textContent, /偏多 3:1/);
  assert.match(h.element('composite').textContent, /简化规则/);

  // When the page locale switches to English
  h.view.setLocale('en');

  // Then every indicator name and header action follows the English locale
  assert.deepEqual([...h.element('rows').querySelectorAll('.td-name')].map(node => node.textContent), [
    'Open Interest', 'Top Trader Long/Short Ratio (Accounts)', 'Top Trader Long/Short Ratio (Positions)',
    'Long/Short Ratio', 'Taker Buy/Sell Volume', 'Basis', 'Funding Rate', 'Open Interest to Market Cap Ratio',
  ]);
  assert.equal(h.element('close').getAttribute('aria-label'), 'Close');
  assert.equal(h.element('collapse').getAttribute('aria-label'), 'Collapse panel');
  assert.deepEqual([...h.panel.querySelectorAll('thead th')].map(node => node.textContent), ['Metric', 'History', 'Value']);
});

test('user inspects the actual historical timestamp and value with pointer and keyboard', t => {
  // Given open-interest samples have a real irregular interval between observations
  const h = harness(t, 'en');
  const data = model();
  data.indicators[0].history = [
    { timestamp: START, value: 10 },
    { timestamp: START + 1_000, value: 12 },
    { timestamp: START + 10_000, value: 11 },
  ];
  h.view.render(data);
  const chart = h.row('oi').querySelector('.td-spark-button');
  const middlePoint = chart.querySelector('[data-history-index="1"]');

  // When the user points to the middle observation and opens its details
  middlePoint.dispatchEvent(new h.window.Event('pointerenter'));
  middlePoint.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }));

  // Then the curve spacing and inspection retain the supplied time and quantity
  assert.equal(chart.querySelector('.td-spark-path').getAttribute('d'), 'M4,40 L17.6,4 L140,22');
  assert.equal(h.panel.querySelector('.td-history-detail time').dateTime, new Date(START + 1_000).toISOString());
  assert.match(h.panel.querySelector('.td-history-value').textContent, /12(?:\.00)? BTC/);
  assert.match(chart.title, /12(?:\.00)? BTC/);
  assert.equal(chart.getAttribute('aria-expanded'), 'true');

  // When the user moves left with the keyboard
  chart.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));

  // Then the preceding real observation is displayed without a synthesized timestamp
  assert.equal(h.panel.querySelector('.td-history-detail time').dateTime, new Date(START).toISOString());
  assert.match(h.panel.querySelector('.td-history-value').textContent, /10(?:\.00)? BTC/);
  assert.match(chart.getAttribute('aria-label'), /10(?:\.00)? BTC/);
  assert.equal(h.panel.querySelector('.td-history-inspection').getAttribute('role'), 'status');

  // When the user closes the inspection with Escape
  chart.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  // Then the detail row closes and the keyboard focus target remains available
  assert.equal(h.panel.querySelectorAll('.td-history-detail').length, 0);
  assert.equal(chart.getAttribute('aria-expanded'), 'false');
});

test('user sees separate taker buy and sell quantities while the main value remains a ratio', t => {
  // Given the taker history contains two observations with independent buy and sell volumes
  const h = harness(t, 'en');
  h.view.render(model());
  const row = h.row('taker');
  const chart = row.querySelector('.td-spark-button');

  // When the user inspects the last volume pair
  chart.click();

  // Then separate bars and explicit quantity units accompany the unchanged ratio
  assert.equal(chart.querySelectorAll('.td-buy-bar').length, 2);
  assert.equal(chart.querySelectorAll('.td-sell-bar').length, 2);
  assert.equal(row.querySelector('.td-number').textContent, '0.50');
  assert.equal(row.querySelector('.td-unit').textContent, 'Buy/sell ratio');
  assert.match(h.panel.querySelector('.td-history-value').textContent, /Buy 6(?:\.00)? BTC/);
  assert.match(h.panel.querySelector('.td-history-value').textContent, /Sell 12(?:\.00)? BTC/);
  assert.match(h.panel.querySelector('.td-history-value').textContent, /Buy\/sell ratio 0\.50/);
});

test('user sees missing history and isolated observations without invented connecting lines', t => {
  // Given one history is absent and another contains a missing observation between two values
  const h = harness(t, 'en');
  const data = model();
  data.indicators[0].history = [];
  data.indicators[1].history = [
    { timestamp: START, value: 1 },
    { timestamp: START + 300_000, value: null },
    { timestamp: START + 600_000, value: 2 },
  ];

  // When the panel renders those histories
  h.view.render(data);

  // Then absent data has a visible state while isolated values are points without false continuity
  assert.match(h.row('oi').querySelector('.td-trend').textContent, /No history/);
  assert.equal(h.row('oi').querySelectorAll('svg').length, 0);
  assert.equal(h.row('top-accounts').querySelectorAll('.td-spark-path').length, 0);
  assert.equal(h.row('top-accounts').querySelectorAll('.td-spark-point').length, 2);
  assert.equal(h.row('funding').querySelectorAll('.td-spark-path').length, 0);
  assert.equal(h.row('funding').querySelectorAll('.td-spark-point').length, 1);
});

test('user keeps settled history and footer nodes while the current funding countdown advances', t => {
  // Given the panel has a tiny settled rate and an independent current funding snapshot
  const h = harness(t);
  h.view.render(model());
  const footer = h.element('footer');
  const updatedAt = footer.querySelector('[data-role="updated-at"]');
  updatedAt.textContent = '更新于 12:00:00';
  const settledChart = h.row('funding').querySelector('svg');
  const ordinaryRow = h.row('oi');
  const fundingRow = h.row('funding');

  // When a current snapshot arrives and the parent advances its clock sixty times
  h.view.setFunding(fundingState(), { now: START, calibrated: true, localNow: START });
  for (let second = 1; second <= 60; second += 1) {
    h.view.updateClock({ now: START + second * 1_000, calibrated: true, localNow: START + second * 1_000 });
  }

  // Then current values stay separate from the preserved settled chart and existing timestamp nodes
  assert.equal(h.row('funding'), fundingRow);
  assert.equal(h.row('oi'), ordinaryRow);
  assert.equal(h.row('funding').querySelector('svg'), settledChart);
  assert.equal(h.element('footer'), footer);
  assert.equal(footer.querySelector('[data-role="updated-at"]'), updatedAt);
  assert.equal(updatedAt.textContent, '更新于 12:00:00');
  assert.equal(fundingRow.querySelector('[data-role="current-funding"]').textContent, '0.00424%');
  assert.equal(fundingRow.querySelector('[data-role="funding-period"]').textContent, '当前 · 4小时');
  assert.equal(fundingRow.querySelector('[data-role="funding-countdown"]').textContent, '倒计时 01:29:00');
  assert.match(fundingRow.querySelector('.td-last-settled').textContent, /上次 0\.000029%/);
  assert.equal(settledChart.querySelectorAll('[data-history-index]').length, 1);
});

test('user sees unavailable funding and clock states without guessed periods or zero rates', t => {
  // Given there is no current rate and no confirmed funding interval
  const h = harness(t);
  h.view.render(model());
  const clock = { now: START, calibrated: false, localNow: START };

  // When the unconfirmed funding state is displayed
  h.view.setFunding(fundingState({ current: null, intervalHours: null }), clock);

  // Then missing data stays missing and the panel does not assume an eight-hour cycle
  assert.equal(h.row('funding').querySelector('[data-role="current-funding"]').textContent, '--');
  assert.equal(h.row('funding').querySelector('[data-role="funding-period"]').textContent, '当前 · 周期待确认');
  assert.match(h.row('funding').querySelector('[data-role="funding-status"]').textContent, /加载中/);
  assert.equal(h.row('funding').querySelector('[data-role="funding-countdown"]').textContent, '倒计时 校时不可用');

  // When a current snapshot arrives while server-time calibration remains unavailable
  h.view.setFunding(fundingState({ intervalHours: null }), clock);

  // Then the current rate is shown but its uncalibrated countdown remains explicitly unavailable
  assert.equal(h.row('funding').querySelector('[data-role="current-funding"]').textContent, '0.00424%');
  assert.equal(h.row('funding').querySelector('[data-role="funding-countdown"]').textContent, '倒计时 校时不可用');
});

test('user sees cached refresh failures and waits for an authoritative next funding time', t => {
  // Given an English panel has a cached rate and an independently cached interval
  const h = harness(t, 'en');
  h.view.render(model());
  const state = fundingState({ cached: true, error: 'HTTP 503', intervalCached: true, intervalError: 'HTTP 500' });

  // When the server-calibrated time reaches the supplied funding boundary
  h.view.setFunding(state, { now: START + 5_400_000, calibrated: true, localNow: START + 5_400_000 });

  // Then failures are written explicitly and the display never advances to an invented next interval
  assert.match(h.row('funding').querySelector('[data-role="funding-status"]').textContent, /Cached.*refresh failed/);
  assert.match(h.row('funding').querySelector('[data-role="funding-interval-status"]').textContent, /Cached.*refresh failed/);
  assert.equal(h.row('funding').querySelector('[data-role="funding-countdown"]').textContent, 'Countdown Waiting for update');
  assert.equal(h.row('funding').querySelector('[data-role="current-funding"]').textContent, '--');
});

test('user retains cached indicator provenance after switching the display language', t => {
  // Given one indicator has a retained cached value after a failed refresh
  const h = harness(t);
  const data = model();
  data.indicators[0].cached = true;
  data.indicators[0].error = 'HTTP 503';
  h.view.render(data);

  // When the locale changes to English without fetching new market data
  h.view.setLocale('en');

  // Then the retained value is still explicitly marked as cached and failed
  assert.match(h.row('oi').querySelector('.td-data-status').textContent, /Cached.*refresh failed/);
  assert.equal(h.row('oi').querySelector('.td-number').textContent, '120.00');
  assert.match(h.row('oi').querySelector('.td-data-status').title, /HTTP 503/);
});

test('user can collapse and close the panel and destroyed views stop handling input', t => {
  // Given a panel starts collapsed and its callbacks record user actions
  const h = harness(t, 'en', true);
  h.view.render(model());
  const close = h.element('close');
  const collapse = h.element('collapse');

  // When the user expands the body and then closes the panel
  collapse.click();
  close.click();

  // Then the callback contract and visible expansion state match the actions
  assert.deepEqual(h.actions, [['collapse', false], ['close']]);
  assert.equal(h.element('body').style.display, 'block');
  assert.equal(collapse.getAttribute('aria-expanded'), 'true');

  // When the view is destroyed and old button references receive clicks
  h.view.destroy();
  collapse.click();
  close.click();

  // Then removed listeners cannot call the parent again
  assert.deepEqual(h.actions, [['collapse', false], ['close']]);
});
