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

test("user finds the visible TradingView frame host", () => {
  // Given the chart geometry and visible depth levels are available
  const dom = createChartDom();
  // When the current depth display is rendered or resolved
  const target = findDepthProfileHost(dom.window.document);

  // Then finds the visible TradingView frame host
  assert.equal(target.chartRoot.className, 'chart-widget-root');
  assert.equal(target.host.className, 'h-full relative');
});

test("user returns null while Binance mounts the native depth chart instead of a visible frame", () => {
  // Given the chart geometry and visible depth levels are available
  const dom = createChartDom({ hiddenFrame: true });
  // When the current depth display is rendered or resolved
  const observed = findDepthProfileHost(dom.window.document);

  // Then returns null while Binance mounts the native depth chart instead of a visible frame
  assert.equal(observed, null);
});

test("user does not mount on Binance Basic because it has no verified price-coordinate contract", () => {
  // Given the chart geometry and visible depth levels are available
  const dom = loadFixtureDom(`
    <div class="chart-widget-root">
      <div class="draggableCancel h-full relative">
        <div class="kline-container"><canvas></canvas></div>
      </div>
    </div>
  `);
  // When the current depth display is rendered or resolved
  const observed = findDepthProfileHost(dom.window.document);

  // Then does not mount on Binance Basic because it has no verified price-coordinate contract
  assert.equal(observed, null);
});

test("user maps prices through the active TradingView main-pane scale", () => {
  // Given the chart geometry and visible depth levels are available
  const dom = createChartDom();
  const frame = dom.window.document.querySelector('iframe');
  installTradingViewApi(frame);

  // When the current depth display is rendered or resolved
  const geometry = getTradingViewDepthProfileGeometry(frame);

  // Then maps prices through the active TradingView main-pane scale
  assert.equal(geometry.top, 0);
  assert.equal(geometry.height, 200);
  assert.equal(geometry.rightInset, 88);
  assert.equal(geometry.minPrice, 90);
  assert.equal(geometry.maxPrice, 110);
  assert.ok(Math.abs(geometry.priceToCoordinate(100) - 100) < 0.02);
  assert.equal(geometry.priceToCoordinate(111), null);
});

test("user maps prices correctly on logarithmic and inverted TradingView scales", () => {
  // Given the chart geometry and visible depth levels are available
  const logarithmic = createChartDom();
  const logarithmicFrame = logarithmic.window.document.querySelector('iframe');
  installTradingViewApi(logarithmicFrame, {
    height: 100,
    mode: 1,
    coordinateToPrice: (coordinate) => 1000 * ((100 / 1000) ** (coordinate / 100)),
  });
  // When the current depth display is rendered or resolved
  const logarithmicGeometry = getTradingViewDepthProfileGeometry(logarithmicFrame);
  // Then maps prices correctly on logarithmic and inverted TradingView scales
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

test("user waits for the native chart model before reading panes and recovers when ready", () => {
  // Given the chart geometry and visible depth levels are available
  const frame = createChartDom().window.document.querySelector('iframe');
  // When the current depth display is rendered or resolved
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
  // Then waits for the native chart model before reading panes and recovers when ready
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

for (const [scenarioIndex, variant] of ([
    { mode: 0, inverted: false, convert: (y) => 110 - y / 10 },
    { mode: 1, inverted: false, convert: (y) => 1000 * (0.1 ** (y / 200)) },
    { mode: 0, inverted: true, convert: (y) => 90 + y / 10 },
  ]).entries()) {
  test(`user reuses native scale samples within one geometry without changing binary-search coordinates (case ${scenarioIndex + 1})`, () => {
    // Given the native fixture represents this supported scenario
    const frame = createChartDom().window.document.querySelector('iframe');
    const reads = new Map();
    installTradingViewApi(frame, {
      ...variant,
      coordinateToPrice: (y) => {
        reads.set(y, (reads.get(y) || 0) + 1);
        return variant.convert(y);
      },
    });
    // When the real adapter handles this fixture
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
    // Then the user reuses native scale samples within one geometry without changing binary-search coordinates
    assert.equal(Math.max(...reads.values()), 1);
    assert.ok(reads.size < prices.length * 13 / 4);
  });
}

test("user sees that a new geometry samples the changed native scale instead of reusing the previous frame", () => {
  // Given the chart geometry and visible depth levels are available
  const frame = createChartDom().window.document.querySelector('iframe');
  const scale = installTradingViewApi(frame);
  const before = getTradingViewDepthProfileGeometry(frame);
  const oldY = before.priceToCoordinate(100);
  let reads = 0;
  scale.coordinateToPrice = (y) => { reads += 1; return 120 - y / 5; };
  // When the current depth display is rendered or resolved
  const after = getTradingViewDepthProfileGeometry(frame);
  // Then sees that a new geometry samples the changed native scale instead of reusing the previous frame
  assert.ok(Math.abs(after.priceToCoordinate(110) - 50) < 0.02);
  assert.ok(reads > 5);
  assert.ok(Math.abs(oldY - 100) < 0.02);
});

test("user sees that invalid native samples inside the binary search still fail explicitly", () => {
  // Given the chart geometry and visible depth levels are available
  const frame = createChartDom().window.document.querySelector('iframe');
  installTradingViewApi(frame, {
    coordinateToPrice: (y) => y === 25 ? NaN : 110 - y / 10,
  });
  // When the current depth display is rendered or resolved
  const geometry = getTradingViewDepthProfileGeometry(frame);
  // Then sees that invalid native samples inside the binary search still fail explicitly
  assert.throws(() => geometry.priceToCoordinate(108), /TradingView price coordinate is invalid/);
});

test("user fails closed when the TradingView price-scale adapter is unavailable", () => {
  // Given the chart geometry and visible depth levels are available
  const dom = createChartDom();
  const frame = dom.window.document.querySelector('iframe');
  // When the current depth display is rendered or resolved
  const observed = getTradingViewDepthProfileGeometry(frame);

  // Then fails closed when the TradingView price-scale adapter is unavailable
  assert.equal(observed, null);

  frame.contentWindow.tradingViewApi = { activeChart: () => ({}) };
  assert.equal(getTradingViewDepthProfileGeometry(frame), null);
});

test("user fails closed when TradingView returns a non-monotonic price transform", () => {
  // Given the chart geometry and visible depth levels are available
  const dom = createChartDom();
  const frame = dom.window.document.querySelector('iframe');
  // When the current depth display is rendered or resolved
  installTradingViewApi(frame, {
    coordinateToPrice: (coordinate) => (coordinate === 100 ? 111 : 110 - coordinate / 10),
  });

  // Then fails closed when TradingView returns a non-monotonic price transform
  assert.equal(getTradingViewDepthProfileGeometry(frame), null);
});

test("user fails closed when the TradingView main-pane price axis is missing or ambiguous", () => {
  // Given the chart geometry and visible depth levels are available
  const missing = createChartDom();
  const missingFrame = missing.window.document.querySelector('iframe');
  installTradingViewApi(missingFrame);
  // When the current depth display is rendered or resolved
  missingFrame.contentDocument.querySelector('.price-axis-container').remove();
  // Then fails closed when the TradingView main-pane price axis is missing or ambiguous
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

test("user rejects ambiguous visible chart roots", () => {
  // Given the chart geometry and visible depth levels are available
  const first = createChartDom();
  const secondRoot = first.window.document.querySelector('.chart-widget-root').cloneNode(true);
  // When the current depth display is rendered or resolved
  first.window.document.body.appendChild(secondRoot);

  // Then rejects ambiguous visible chart roots
  assert.throws(
    () => findDepthProfileHost(first.window.document),
    /Visible chart root count is invalid: 2/,
  );
});

test("user creates a non-interactive canvas with an independently clickable toggle", () => {
  // Given the chart geometry and visible depth levels are available
  const dom = createChartDom();
  const { document } = dom.window;
  const { host } = findDepthProfileHost(document);
  let toggles = 0;
  // When the current depth display is rendered or resolved
  const root = ensureDepthProfileView(document, host, { onToggle: () => { toggles += 1; } });

  // Then creates a non-interactive canvas with an independently clickable toggle
  assert.equal(root.id, DEPTH_PROFILE_ID);
  assert.equal(root.parentElement, host);
  const styleText = document.getElementById('jh-binance-depth-profile-style').textContent;
  assert.match(styleText, /pointer-events: none/);
  assert.match(styleText, /pointer-events: auto/);
  assert.match(
    styleText,
    /\.jh-depth-profile-canvas\s*\{[^}]*background: transparent;/,
  );
  assert.doesNotMatch(
    styleText,
    /\.jh-depth-profile-canvas\s*\{[^}]*color-mix\(/,
  );
  assert.doesNotMatch(
    styleText,
    /\.jh-depth-profile-canvas\s*\{[^}]*opacity:/,
  );
  root.querySelector('[data-depth-profile-toggle]').click();
  assert.equal(toggles, 1);
});

test("user updates expanded state and removes the view", () => {
  // Given the chart geometry and visible depth levels are available
  const dom = createChartDom();
  const { document } = dom.window;
  const { host } = findDepthProfileHost(document);
  const root = ensureDepthProfileView(document, host, { onToggle: () => {} });

  // When the current depth display is rendered or resolved
  setDepthProfileViewState(root, {
    expanded: false,
    expandedLabel: 'Hide depth profile',
    collapsedLabel: 'D',
    status: 'Connecting',
  });
  // Then updates expanded state and removes the view
  assert.equal(root.dataset.expanded, 'false');
  assert.equal(root.querySelector('[data-depth-profile-toggle]').textContent, 'D');
  assert.equal(root.querySelector('.jh-depth-profile-status').textContent, 'Connecting');

  removeDepthProfileView(document);
  assert.equal(document.getElementById(DEPTH_PROFILE_ID), null);
});

test("user sees that reapplying the same view state does not create observer churn", async () => {
  // Given the chart geometry and visible depth levels are available
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

  // When the current depth display is rendered or resolved
  observer.disconnect();
  // Then sees that reapplying the same view state does not create observer churn
  assert.equal(mutations.length, 0);
});

test("user draws bid and ask bars plus the latest-trade divider", () => {
  // Given the chart geometry and visible depth levels are available
  const dom = createChartDom();
  const { document } = dom.window;
  const { host } = findDepthProfileHost(document);
  // When the current depth display is rendered or resolved
  const root = ensureDepthProfileView(document, host, { onToggle: () => {} });
  const calls = [];
  const fillStyles = [];
  const canvas = root.querySelector('canvas');
  canvas.getBoundingClientRect = () => ({ width: 132, height: 240, left: 0, top: 0 });
  canvas.getContext = () => ({
    beginPath: () => calls.push('beginPath'),
    clearRect: () => calls.push('clearRect'),
    fillRect: (...args) => calls.push(['fillRect', ...args]),
    fillText: () => {},
    measureText: (text) => ({ width: text.length * 6 }),
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
    inverted: false,
    priceToCoordinate: (price) => ({ 100: 180, 100.5: 140, 101: 80 }[price] ?? null),
  };
  // Then draws bid and ask bars plus the latest-trade divider
  assert.equal(renderDepthProfile(root, {
    minPrice: 99,
    maxPrice: 102,
    midPrice: 99.5,
    maxCumulative: 5,
    bids: [{ price: 100, quantity: 5, cumulative: 5 }],
    asks: [{ price: 101, quantity: 4, cumulative: 4 }, { price: 105, quantity: 1, cumulative: 5 }],
  }, geometry, 100.5), true);
  assert.equal(root.style.height, '240px');
  const bars = calls.filter((call) => Array.isArray(call) && call[0] === 'fillRect' && call[4] === 1);
  assert.equal(bars.length, 2);
  assert.deepEqual(fillStyles.slice(0, 2), [
    '#f6465d',
    '#0ecb81',
  ]);
  assert.deepEqual(
    bars.map((call) => call[2]),
    [80, 180],
  );
  assert.deepEqual(calls.find((call) => Array.isArray(call) && call[0] === 'moveTo'), ['moveTo', 0, 140.5]);
  assert.equal(calls.includes('stroke'), true);

  calls.length = 0;
  clearDepthProfile(root);
  assert.deepEqual(calls, ['save', 'setTransform', 'clearRect', 'restore']);
});

test("user draws one bar per visible CSS pixel row and scales width to visible depth", () => {
  // Given the chart geometry and visible depth levels are available
  const dom = createChartDom();
  const { document } = dom.window;
  const { host } = findDepthProfileHost(document);
  const root = ensureDepthProfileView(document, host, { onToggle: () => {} });
  const fillRects = [];
  const canvas = root.querySelector('canvas');
  canvas.getBoundingClientRect = () => ({ width: 132, height: 240, left: 0, top: 0 });
  canvas.getContext = () => ({
    beginPath: () => {},
    clearRect: () => {},
    fillRect: (...args) => { if (args[3] === 1) fillRects.push(args); },
    fillText: () => {},
    measureText: (text) => ({ width: text.length * 6 }),
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
    inverted: false,
    priceToCoordinate: (price) => ({
      99: 180.4,
      101: 80.2,
      102: 80.4,
    }[price] ?? null),
  };
  // When the current depth display is rendered or resolved
  renderDepthProfile(root, {
    maxCumulative: 1_000,
    bids: [{ price: 99, quantity: 4, cumulative: 4 }],
    asks: [
      { price: 101, quantity: 3, cumulative: 3 },
      { price: 102, quantity: 5, cumulative: 8 },
      { price: 110, quantity: 992, cumulative: 1_000 },
    ],
  }, geometry, 100);

  // Then draws one bar per visible CSS pixel row and scales width to visible depth
  assert.equal(fillRects.length, 2);
  assert.deepEqual(fillRects.map(([, y, , height]) => [y, height]), [[80, 1], [180, 1]]);
  assert.equal(fillRects[0][0], 0);
  assert.equal(fillRects[0][2], canvas.getBoundingClientRect().width);
  assert.equal(fillRects[1][2], canvas.getBoundingClientRect().width / 2);
});

function createLabelRenderer({ width = 132, height = 240, inverted = false, coordinates } = {}) {
  const dom = createChartDom();
  const { document } = dom.window;
  const { host } = findDepthProfileHost(document);
  const root = ensureDepthProfileView(document, host, { onToggle: () => {} });
  const canvas = root.querySelector('canvas');
  canvas.getBoundingClientRect = () => ({ width, height, left: 0, top: 0 });
  root.querySelector('[data-depth-profile-toggle]').getBoundingClientRect = () => ({
    left: width - 28, top: 8, width: 24, height: 24,
  });
  const rectangles = [];
  const labels = [];
  const context = {
    beginPath() {},
    clearRect() { rectangles.length = 0; labels.length = 0; },
    fillRect(x, y, boxWidth, boxHeight) {
      rectangles.push({ x, y, width: boxWidth, height: boxHeight, color: this.fillStyle });
    },
    fillText(text, x, y) { labels.push({ text, x, y, font: this.font }); },
    measureText: (text) => ({ width: text.length * 6 }),
    lineTo() {},
    moveTo() {},
    restore() {},
    save() {},
    setLineDash() {},
    setTransform() {},
    stroke() {},
  };
  canvas.getContext = () => context;
  const geometry = {
    top: 0,
    height,
    rightInset: 88,
    inverted,
    priceToCoordinate: (price) => coordinates[price] ?? null,
  };
  return {
    root,
    labels,
    rectangles,
    render: (profile, currentPrice = null) => renderDepthProfile(root, profile, geometry, currentPrice),
  };
}

function depthLevels(entries) {
  let cumulative = 0;
  return entries.map(([price, quantity]) => {
    cumulative += quantity;
    return { price, quantity, cumulative };
  });
}

test("user labels the complete visible pixel-row quantity, not its last level or offscreen cumulative depth", () => {
  // Given the chart geometry and visible depth levels are available
  const view = createLabelRenderer({ coordinates: { 99: 180.4, 101: 80.2, 102: 80.4 } });
  // When the current depth display is rendered or resolved
  view.render({
    maxCumulative: 1_000,
    bids: depthLevels([[99, 4]]),
    asks: depthLevels([[101, 3], [102, 5], [110, 992]]),
  });

  // Then labels the complete visible pixel-row quantity, not its last level or offscreen cumulative depth
  assert.deepEqual(view.labels.map(({ text }) => text), ['101–102 · 8', '99 · 4']);
  assert.deepEqual(view.rectangles.filter(({ height }) => height === 1), [
    { x: 0, y: 80, width: 132, height: 1, color: '#f6465d' },
    { x: 66, y: 180, width: 66, height: 1, color: '#0ecb81' },
  ]);
});

test("user chooses at most two large quantity steps per side instead of the largest cumulative bars", () => {
  // Given the chart geometry and visible depth levels are available
  const view = createLabelRenderer({ coordinates: { 99: 220, 101: 180, 102: 160, 103: 140, 104: 120, 105: 100, 106: 80 } });
  // When the current depth display is rendered or resolved
  view.render({
    bids: depthLevels([[99, 1]]),
    asks: depthLevels([[101, 300], [102, 5], [103, 200], [104, 4], [105, 100], [106, 3]]),
  });

  // Then chooses at most two large quantity steps per side instead of the largest cumulative bars
  assert.deepEqual(view.labels.map(({ text }) => text), ['101 · 300', '103 · 200']);
});

test("user uses quantity-only text when a complete price band is too wide and keeps every label inside the canvas", () => {
  // Given the chart geometry and visible depth levels are available
  const view = createLabelRenderer({ coordinates: { 0.00010001: 80.2, 0.00010002: 80.4, 0.00009: 180 } });
  // When the current depth display is rendered or resolved
  view.render({
    bids: depthLevels([[0.00009, 620_000]]),
    asks: depthLevels([[0.00010001, 2_400_000], [0.00010002, 1_400_000]]),
  });

  // Then uses quantity-only text when a complete price band is too wide and keeps every label inside the canvas
  assert.deepEqual(view.labels.map(({ text }) => text), ['3.8M', '620K']);
  for (const box of view.rectangles.filter(({ height }) => height === 16)) {
    assert.ok(box.width <= 88);
    assert.ok(box.x >= 0 && box.x + box.width <= 132);
    assert.ok(box.y >= 0 && box.y + box.height <= 240);
  }
  assert.deepEqual(view.rectangles.filter(({ height }) => height === 16).map(({ width }) => width), [30, 30]);
});

for (const [scenarioIndex, [quantity, expected]] of ([[2_400_000, '101 · 2.4M'], [999_950, '101 · 1M'], [0.00002, '101 · 0.00002']]).entries()) {
  test(`user formats quantities without trailing zeroes, unit-boundary errors, or rounding small nonzero amounts to zero (case ${scenarioIndex + 1})`, () => {
    // Given the native fixture represents this supported scenario
    const view = createLabelRenderer({ coordinates: { 101: 80 } });

    // When the real adapter handles this fixture
    view.render({ bids: [], asks: depthLevels([[101, quantity]]) });
    // Then the user formats quantities without trailing zeroes, unit-boundary errors, or rounding small nonzero amounts to zero
    assert.deepEqual(view.labels.map(({ text }) => text), [expected]);
  });
}

test("user keeps nearby labels apart and does not cover the current-price divider", () => {
  // Given the chart geometry and visible depth levels are available
  const view = createLabelRenderer({ coordinates: { 99: 150, 100: 110, 101: 125, 102: 95, 103: 90 } });
  // When the current depth display is rendered or resolved
  view.render({
    bids: depthLevels([[99, 80]]),
    asks: depthLevels([[101, 70], [102, 100], [103, 90]]),
  }, 100);

  // Then keeps nearby labels apart and does not cover the current-price divider
  assert.deepEqual(view.labels.map(({ text }) => text), ['102 · 100', '99 · 80']);
  const boxes = view.rectangles.filter(({ height }) => height === 16);
  assert.ok(boxes.every((box) => box.y + box.height < 110 || box.y > 110));
  assert.ok(boxes[0].y + boxes[0].height < boxes[1].y);
});

for (const [scenarioIndex, inverted] of ([false, true]).entries()) {
  test(`user places bid and ask labels on opposite sides of a shared pixel row, including inverted scales (case ${scenarioIndex + 1})`, () => {
    // Given the native fixture represents this supported scenario
    const coordinates = inverted ? { 99: 100.2, 101: 100.4 } : { 99: 100.4, 101: 100.2 };
    const view = createLabelRenderer({ inverted, coordinates });
    // When the real adapter handles this fixture
    view.render({ bids: depthLevels([[99, 9]]), asks: depthLevels([[101, 10]]) });

    // Then the user places bid and ask labels on opposite sides of a shared pixel row, including inverted scales
    assert.deepEqual(view.labels.map(({ text }) => text), ['101 · 10', '99 · 9']);
    assert.deepEqual(view.rectangles.filter(({ height }) => height === 16).map(({ y }) => y), inverted ? [102, 82] : [82, 102]);
  });
}

test("user omits labels that would overlap the collapse button or extend past the vertical canvas boundary", () => {
  // Given the chart geometry and visible depth levels are available
  const view = createLabelRenderer({ coordinates: { 99: 220, 101: 38, 102: 10 } });
  // When the current depth display is rendered or resolved
  view.render({
    bids: depthLevels([[99, 1_000]]),
    asks: depthLevels([[101, 200], [102, 100]]),
  });
  // Then omits labels that would overlap the collapse button or extend past the vertical canvas boundary
  assert.deepEqual(view.labels.map(({ text }) => text), ['99 · 1K']);

  const narrow = createLabelRenderer({ width: 20, coordinates: { 101: 80 } });
  narrow.render({ bids: [], asks: depthLevels([[101, 620_000]]) });
  assert.deepEqual(narrow.labels, []);
});

test("user repaints changed quantities and removes old labels when the depth canvas clears", () => {
  // Given the chart geometry and visible depth levels are available
  const view = createLabelRenderer({ coordinates: { 101: 80 } });
  // When the current depth display is rendered or resolved
  view.render({ bids: [], asks: depthLevels([[101, 3_800_000]]) });
  // Then repaints changed quantities and removes old labels when the depth canvas clears
  assert.deepEqual(view.labels.map(({ text }) => text), ['101 · 3.8M']);
  view.render({ bids: [], asks: depthLevels([[101, 1_500_000]]) });
  assert.deepEqual(view.labels.map(({ text }) => text), ['101 · 1.5M']);
  clearDepthProfile(view.root);
  assert.deepEqual(view.labels, []);
  assert.deepEqual(view.rectangles, []);
});

test("user updates root geometry without rewriting unchanged styles", () => {
  // Given the chart geometry and visible depth levels are available
  const dom = createChartDom();
  const { document } = dom.window;
  const { host } = findDepthProfileHost(document);
  const root = ensureDepthProfileView(document, host, { onToggle: () => {} });

  // When the current depth display is rendered or resolved
  setDepthProfileGeometry(root, { top: 4, height: 320, rightInset: 88 });
  // Then updates root geometry without rewriting unchanged styles
  assert.equal(root.style.top, '4px');
  assert.equal(root.style.height, '320px');
  assert.equal(root.style.right, '88px');
  setDepthProfileGeometry(root, { top: 4, height: 320, rightInset: 88 });
  assert.equal(root.getAttribute('style'), 'top: 4px; height: 320px; right: 88px;');
});
