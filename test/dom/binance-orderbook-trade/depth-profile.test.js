import test from 'node:test';
import assert from 'node:assert/strict';

import { loadFixtureDom } from '../../helpers/dom.js';
import {
  clearDepthProfile,
  DEPTH_PROFILE_ID,
  ensureDepthProfileView,
  findDepthProfileHost,
  removeDepthProfileView,
  renderDepthProfile,
  setDepthProfileViewState,
} from '../../../src/binance-orderbook-trade/dom/depth-profile.js';

function createChartDom({ hiddenFrame = false } = {}) {
  return loadFixtureDom(`
    <div class="chart-widget-root">
      <div class="h-full relative">
        <div id="chart_futures-tradingview" class="h-full">
          <iframe${hiddenFrame ? ' data-hidden' : ''}></iframe>
        </div>
      </div>
    </div>
  `);
}

test('finds the visible chart frame host without requiring TradingView private APIs', () => {
  const dom = createChartDom();
  const target = findDepthProfileHost(dom.window.document);

  assert.equal(target.chartRoot.className, 'chart-widget-root');
  assert.equal(target.host.className, 'h-full relative');
});

test('returns null while Binance mounts the native depth chart instead of a visible frame', () => {
  const dom = createChartDom({ hiddenFrame: true });
  assert.equal(findDepthProfileHost(dom.window.document), null);
});

test('finds the visible Binance basic chart host without matching the native depth chart', () => {
  const dom = loadFixtureDom(`
    <div class="chart-widget-root">
      <div class="draggableCancel h-full relative">
        <div class="kline-container"><canvas></canvas></div>
      </div>
    </div>
  `);
  const target = findDepthProfileHost(dom.window.document);

  assert.equal(target.frame, null);
  assert.equal(target.host.className, 'draggableCancel h-full relative');

  dom.window.document.querySelector('.kline-container').remove();
  assert.equal(findDepthProfileHost(dom.window.document), null);
});

test('rejects ambiguous visible chart roots', () => {
  const first = createChartDom();
  const secondRoot = first.window.document.querySelector('.chart-widget-root').cloneNode(true);
  first.window.document.body.appendChild(secondRoot);

  assert.throws(
    () => findDepthProfileHost(first.window.document),
    /Visible chart root count is invalid: 2/,
  );
});

test('creates a non-interactive canvas with an independently clickable toggle', () => {
  const dom = createChartDom();
  const { document } = dom.window;
  const { host } = findDepthProfileHost(document);
  let toggles = 0;
  const root = ensureDepthProfileView(document, host, { onToggle: () => { toggles += 1; } });

  assert.equal(root.id, DEPTH_PROFILE_ID);
  assert.equal(root.parentElement, host);
  assert.match(document.getElementById('jh-binance-depth-profile-style').textContent, /pointer-events: none/);
  assert.match(document.getElementById('jh-binance-depth-profile-style').textContent, /pointer-events: auto/);
  root.querySelector('[data-depth-profile-toggle]').click();
  assert.equal(toggles, 1);
});

test('updates expanded state and removes the view', () => {
  const dom = createChartDom();
  const { document } = dom.window;
  const { host } = findDepthProfileHost(document);
  const root = ensureDepthProfileView(document, host, { onToggle: () => {} });

  setDepthProfileViewState(root, {
    expanded: false,
    expandedLabel: 'Hide depth profile',
    collapsedLabel: 'D',
    status: 'Connecting',
  });
  assert.equal(root.dataset.expanded, 'false');
  assert.equal(root.querySelector('[data-depth-profile-toggle]').textContent, 'D');
  assert.equal(root.querySelector('.jh-depth-profile-status').textContent, 'Connecting');

  removeDepthProfileView(document);
  assert.equal(document.getElementById(DEPTH_PROFILE_ID), null);
});

test('reapplying the same view state does not create observer churn', async () => {
  const dom = createChartDom();
  const { document, MutationObserver } = dom.window;
  const { host } = findDepthProfileHost(document);
  const root = ensureDepthProfileView(document, host, { onToggle: () => {} });
  const state = {
    expanded: true,
    expandedLabel: 'Hide depth profile',
    collapsedLabel: 'D',
    status: 'Connecting',
  };
  setDepthProfileViewState(root, state);
  await Promise.resolve();

  const mutations = [];
  const observer = new MutationObserver((records) => mutations.push(...records));
  observer.observe(root, { subtree: true, childList: true, attributes: true });
  setDepthProfileViewState(root, state);
  await Promise.resolve();

  observer.disconnect();
  assert.equal(mutations.length, 0);
});

test('draws bid and ask bars plus the current-price divider', () => {
  const dom = createChartDom();
  const { document } = dom.window;
  const { host } = findDepthProfileHost(document);
  const root = ensureDepthProfileView(document, host, { onToggle: () => {} });
  const calls = [];
  root.querySelector('canvas').getContext = () => ({
    beginPath: () => calls.push('beginPath'),
    clearRect: () => calls.push('clearRect'),
    fillRect: () => calls.push('fillRect'),
    lineTo: () => calls.push('lineTo'),
    moveTo: () => calls.push('moveTo'),
    restore: () => calls.push('restore'),
    save: () => calls.push('save'),
    setLineDash: () => calls.push('setLineDash'),
    setTransform: () => calls.push('setTransform'),
    stroke: () => calls.push('stroke'),
  });

  assert.equal(renderDepthProfile(root, {
    minPrice: 99,
    maxPrice: 102,
    midPrice: 100.5,
    maxCumulative: 5,
    bids: [{ price: 100, cumulative: 5 }],
    asks: [{ price: 101, cumulative: 4 }],
  }), true);
  assert.equal(calls.filter((call) => call === 'fillRect').length, 2);
  assert.equal(calls.includes('stroke'), true);

  calls.length = 0;
  clearDepthProfile(root);
  assert.deepEqual(calls, ['save', 'setTransform', 'clearRect', 'restore']);
});
