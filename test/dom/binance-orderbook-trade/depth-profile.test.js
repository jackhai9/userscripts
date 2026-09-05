import test from 'node:test';
import assert from 'node:assert/strict';

import { loadFixtureDom } from '../../helpers/dom.js';
import {
  clearDepthProfile,
  DEPTH_PROFILE_ID,
  ensureDepthProfileView,
  findDepthProfileHost,
  getTradingViewDepthProfileGeometry,
  removeDepthProfileView,
  renderDepthProfile,
  setDepthProfileGeometry,
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

function installTradingViewApi(frame, {
  height = 200,
  viewportWidth = 1200,
  priceAxisWidth = 88,
  mode = 0,
  inverted = false,
  coordinateToPrice = (coordinate) => 110 - coordinate / 10,
} = {}) {
  Object.defineProperty(frame.contentWindow, 'innerWidth', {
    configurable: true,
    value: viewportWidth,
  });
  const priceAxis = frame.contentDocument.createElement('div');
  priceAxis.className = 'chart-markup-table price-axis-container';
  priceAxis.getBoundingClientRect = () => ({
    width: priceAxisWidth,
    height,
    left: viewportWidth - priceAxisWidth,
    right: viewportWidth,
    top: 0,
    bottom: height,
  });
  frame.contentDocument.body.appendChild(priceAxis);
  const scale = {
    coordinateToPrice,
    getMode: () => mode,
    getVisiblePriceRange: () => ({ from: 90, to: 110 }),
    isInverted: () => inverted,
  };
  frame.contentWindow.tradingViewApi = {
    activeChart: () => ({
      hasModel: () => true,
      getAllPanesHeight: () => [height, 80, 120],
      getPanes: () => [{ getMainSourcePriceScale: () => scale }],
    }),
  };
  return scale;
}

test('finds the visible TradingView frame host', () => {
  const dom = createChartDom();
  const target = findDepthProfileHost(dom.window.document);

  assert.equal(target.chartRoot.className, 'chart-widget-root');
  assert.equal(target.host.className, 'h-full relative');
});

test('returns null while Binance mounts the native depth chart instead of a visible frame', () => {
  const dom = createChartDom({ hiddenFrame: true });
  assert.equal(findDepthProfileHost(dom.window.document), null);
});

test('does not mount on Binance Basic because it has no verified price-coordinate contract', () => {
  const dom = loadFixtureDom(`
    <div class="chart-widget-root">
      <div class="draggableCancel h-full relative">
        <div class="kline-container"><canvas></canvas></div>
      </div>
    </div>
  `);
  assert.equal(findDepthProfileHost(dom.window.document), null);
});

test('maps prices through the active TradingView main-pane scale', () => {
  const dom = createChartDom();
  const frame = dom.window.document.querySelector('iframe');
  installTradingViewApi(frame);

  const geometry = getTradingViewDepthProfileGeometry(frame);

  assert.equal(geometry.top, 0);
  assert.equal(geometry.height, 200);
  assert.equal(geometry.rightInset, 88);
  assert.equal(geometry.minPrice, 90);
  assert.equal(geometry.maxPrice, 110);
  assert.ok(Math.abs(geometry.priceToCoordinate(100) - 100) < 0.02);
  assert.equal(geometry.priceToCoordinate(111), null);
});

test('maps prices correctly on logarithmic and inverted TradingView scales', () => {
  const logarithmic = createChartDom();
  const logarithmicFrame = logarithmic.window.document.querySelector('iframe');
  installTradingViewApi(logarithmicFrame, {
    height: 100,
    mode: 1,
    coordinateToPrice: (coordinate) => 1000 * ((100 / 1000) ** (coordinate / 100)),
  });
  const logarithmicGeometry = getTradingViewDepthProfileGeometry(logarithmicFrame);
  assert.equal(logarithmicGeometry.mode, 1);
  assert.ok(Math.abs(logarithmicGeometry.priceToCoordinate(Math.sqrt(100_000)) - 50) < 0.02);

  const inverted = createChartDom();
  const invertedFrame = inverted.window.document.querySelector('iframe');
  installTradingViewApi(invertedFrame, {
    height: 100,
    inverted: true,
    coordinateToPrice: (coordinate) => 90 + coordinate / 5,
  });
  const invertedGeometry = getTradingViewDepthProfileGeometry(invertedFrame);
  assert.equal(invertedGeometry.inverted, true);
  assert.ok(Math.abs(invertedGeometry.priceToCoordinate(100) - 50) < 0.02);
});

test('waits for the native chart model before reading panes and recovers when ready', () => {
  const frame = createChartDom().window.document.querySelector('iframe');
  installTradingViewApi(frame);
  const chart = frame.contentWindow.tradingViewApi.activeChart();
  frame.contentWindow.tradingViewApi.activeChart = () => chart;
  const readHeights = chart.getAllPanesHeight;
  const readPanes = chart.getPanes;
  let ready = false;
  let paneReads = 0;
  chart.hasModel = () => ready;
  chart.getAllPanesHeight = () => {
    paneReads += 1;
    assert.equal(ready, true, 'pane height requires a ready model');
    return readHeights();
  };
  chart.getPanes = () => {
    paneReads += 1;
    assert.equal(ready, true, 'pane access requires a ready model');
    return readPanes();
  };
  assert.equal(getTradingViewDepthProfileGeometry(frame), null);
  assert.equal(paneReads, 0);
  ready = true;
  const geometry = getTradingViewDepthProfileGeometry(frame);
  assert.equal(paneReads, 2);
  assert.ok(Math.abs(geometry.priceToCoordinate(100) - 100) < 0.02);
  delete chart.hasModel;
  assert.equal(getTradingViewDepthProfileGeometry(frame), null);
  assert.equal(paneReads, 2);
});

test('reuses native scale samples within one geometry without changing binary-search coordinates', () => {
  for (const variant of [
    { mode: 0, inverted: false, convert: (y) => 110 - y / 10 },
    { mode: 1, inverted: false, convert: (y) => 1000 * (0.1 ** (y / 200)) },
    { mode: 0, inverted: true, convert: (y) => 90 + y / 10 },
  ]) {
    const frame = createChartDom().window.document.querySelector('iframe');
    const reads = new Map();
    installTradingViewApi(frame, {
      ...variant,
      coordinateToPrice: (y) => {
        reads.set(y, (reads.get(y) || 0) + 1);
        return variant.convert(y);
      },
    });
    const geometry = getTradingViewDepthProfileGeometry(frame);
    const prices = Array.from({ length: 1000 }, (_, i) => variant.convert(20 + i * 0.03));
    for (const price of prices) {
      let low = 0;
      let high = 200;
      for (let step = 0; step < 13; step += 1) {
        const middle = (low + high) / 2;
        const middlePrice = variant.convert(middle);
        if (variant.inverted ? middlePrice < price : middlePrice > price) low = middle;
        else high = middle;
      }
      assert.equal(geometry.priceToCoordinate(price), (low + high) / 2);
    }
    assert.equal(Math.max(...reads.values()), 1);
    assert.ok(reads.size < prices.length * 13 / 4);
  }
});

test('a new geometry samples the changed native scale instead of reusing the previous frame', () => {
  const frame = createChartDom().window.document.querySelector('iframe');
  const scale = installTradingViewApi(frame);
  const before = getTradingViewDepthProfileGeometry(frame);
  const oldY = before.priceToCoordinate(100);
  let reads = 0;
  scale.coordinateToPrice = (y) => { reads += 1; return 120 - y / 5; };
  const after = getTradingViewDepthProfileGeometry(frame);
  assert.ok(Math.abs(after.priceToCoordinate(110) - 50) < 0.02);
  assert.ok(reads > 5);
  assert.ok(Math.abs(oldY - 100) < 0.02);
});

test('invalid native samples inside the binary search still fail explicitly', () => {
  const frame = createChartDom().window.document.querySelector('iframe');
  installTradingViewApi(frame, {
    coordinateToPrice: (y) => y === 25 ? NaN : 110 - y / 10,
  });
  const geometry = getTradingViewDepthProfileGeometry(frame);
  assert.throws(() => geometry.priceToCoordinate(108), /TradingView price coordinate is invalid/);
});

test('fails closed when the TradingView price-scale adapter is unavailable', () => {
  const dom = createChartDom();
  const frame = dom.window.document.querySelector('iframe');
  assert.equal(getTradingViewDepthProfileGeometry(frame), null);

  frame.contentWindow.tradingViewApi = { activeChart: () => ({}) };
  assert.equal(getTradingViewDepthProfileGeometry(frame), null);
});

test('fails closed when TradingView returns a non-monotonic price transform', () => {
  const dom = createChartDom();
  const frame = dom.window.document.querySelector('iframe');
  installTradingViewApi(frame, {
    coordinateToPrice: (coordinate) => (coordinate === 100 ? 111 : 110 - coordinate / 10),
  });

  assert.equal(getTradingViewDepthProfileGeometry(frame), null);
});

test('fails closed when the TradingView main-pane price axis is missing or ambiguous', () => {
  const missing = createChartDom();
  const missingFrame = missing.window.document.querySelector('iframe');
  installTradingViewApi(missingFrame);
  missingFrame.contentDocument.querySelector('.price-axis-container').remove();
  assert.equal(getTradingViewDepthProfileGeometry(missingFrame), null);

  const ambiguous = createChartDom();
  const ambiguousFrame = ambiguous.window.document.querySelector('iframe');
  installTradingViewApi(ambiguousFrame);
  const duplicate = ambiguousFrame.contentDocument.querySelector('.price-axis-container').cloneNode();
  duplicate.getBoundingClientRect = () => ({
    width: 88,
    height: 200,
    left: 1112,
    right: 1200,
    top: 0,
    bottom: 200,
  });
  ambiguousFrame.contentDocument.body.appendChild(duplicate);
  assert.equal(getTradingViewDepthProfileGeometry(ambiguousFrame), null);
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
  const styleText = document.getElementById('jh-binance-depth-profile-style').textContent;
  assert.match(styleText, /pointer-events: none/);
  assert.match(styleText, /pointer-events: auto/);
  assert.match(
    styleText,
    /background: linear-gradient\(90deg, transparent, color-mix\(in srgb, var\(--color-BasicBg, #fff\) 24%, transparent\)\)/,
  );
  assert.doesNotMatch(
    styleText,
    /\.jh-depth-profile-canvas\s*\{[^}]*opacity:/,
  );
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

test('draws bid and ask bars plus the latest-trade divider', () => {
  const dom = createChartDom();
  const { document } = dom.window;
  const { host } = findDepthProfileHost(document);
  const root = ensureDepthProfileView(document, host, { onToggle: () => {} });
  const calls = [];
  const fillStyles = [];
  root.querySelector('canvas').getContext = () => ({
    beginPath: () => calls.push('beginPath'),
    clearRect: () => calls.push('clearRect'),
    fillRect: (...args) => calls.push(['fillRect', ...args]),
    lineTo: () => calls.push('lineTo'),
    moveTo: (...args) => calls.push(['moveTo', ...args]),
    restore: () => calls.push('restore'),
    save: () => calls.push('save'),
    setLineDash: () => calls.push('setLineDash'),
    setTransform: () => calls.push('setTransform'),
    stroke: () => calls.push('stroke'),
    set fillStyle(value) { fillStyles.push(value); },
  });

  const geometry = {
    top: 0,
    height: 240,
    priceToCoordinate: (price) => ({ 100: 180, 100.5: 140, 101: 80 }[price] ?? null),
  };
  assert.equal(renderDepthProfile(root, {
    minPrice: 99,
    maxPrice: 102,
    midPrice: 99.5,
    maxCumulative: 5,
    bids: [{ price: 100, cumulative: 5 }],
    asks: [{ price: 101, cumulative: 4 }, { price: 105, cumulative: 5 }],
  }, geometry, 100.5), true);
  assert.equal(root.style.height, '240px');
  assert.equal(calls.filter((call) => Array.isArray(call) && call[0] === 'fillRect').length, 2);
  assert.deepEqual(fillStyles, [
    'rgba(246, 70, 93, .62)',
    'rgba(14, 203, 129, .62)',
  ]);
  assert.deepEqual(
    calls.filter((call) => Array.isArray(call) && call[0] === 'fillRect').map((call) => call[2]),
    [80, 180],
  );
  assert.deepEqual(calls.find((call) => Array.isArray(call) && call[0] === 'moveTo'), ['moveTo', 0, 140.5]);
  assert.equal(calls.includes('stroke'), true);

  calls.length = 0;
  clearDepthProfile(root);
  assert.deepEqual(calls, ['save', 'setTransform', 'clearRect', 'restore']);
});

test('draws one bar per visible CSS pixel row and scales width to visible depth', () => {
  const dom = createChartDom();
  const { document } = dom.window;
  const { host } = findDepthProfileHost(document);
  const root = ensureDepthProfileView(document, host, { onToggle: () => {} });
  const fillRects = [];
  const canvas = root.querySelector('canvas');
  canvas.getContext = () => ({
    beginPath: () => {},
    clearRect: () => {},
    fillRect: (...args) => fillRects.push(args),
    lineTo: () => {},
    moveTo: () => {},
    restore: () => {},
    save: () => {},
    setLineDash: () => {},
    setTransform: () => {},
    stroke: () => {},
  });

  const geometry = {
    top: 0,
    height: 240,
    priceToCoordinate: (price) => ({
      99: 180.4,
      101: 80.2,
      102: 80.4,
    }[price] ?? null),
  };
  renderDepthProfile(root, {
    maxCumulative: 1_000,
    bids: [{ price: 99, cumulative: 4 }],
    asks: [
      { price: 101, cumulative: 3 },
      { price: 102, cumulative: 8 },
      { price: 110, cumulative: 1_000 },
    ],
  }, geometry, 100);

  assert.equal(fillRects.length, 2);
  assert.deepEqual(fillRects.map(([, y, , height]) => [y, height]), [[80, 1], [180, 1]]);
  assert.equal(fillRects[0][0], 0);
  assert.equal(fillRects[0][2], canvas.getBoundingClientRect().width);
  assert.equal(fillRects[1][2], canvas.getBoundingClientRect().width / 2);
});

test('updates root geometry without rewriting unchanged styles', () => {
  const dom = createChartDom();
  const { document } = dom.window;
  const { host } = findDepthProfileHost(document);
  const root = ensureDepthProfileView(document, host, { onToggle: () => {} });

  setDepthProfileGeometry(root, { top: 4, height: 320, rightInset: 88 });
  assert.equal(root.style.top, '4px');
  assert.equal(root.style.height, '320px');
  assert.equal(root.style.right, '88px');
  setDepthProfileGeometry(root, { top: 4, height: 320, rightInset: 88 });
  assert.equal(root.getAttribute('style'), 'top: 4px; height: 320px; right: 88px;');
});
