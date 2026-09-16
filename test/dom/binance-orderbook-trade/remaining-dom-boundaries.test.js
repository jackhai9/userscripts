import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFixtureDom, isVisibleElement } from '../../helpers/dom.js';
import {
  clearDepthProfile,
  ensureDepthProfileView,
  findDepthProfileHost,
  getTradingViewDepthProfileGeometry,
  renderDepthProfile,
} from '../../../src/binance-orderbook-trade/dom/depth-profile.js';
import {
  createBoundedInputWriter,
  createTradeInputResolver,
  createTradeInputStateReader,
  findActiveTradeInputs,
  isScriptOwnedTradeInputRecoveryState,
  mutationTouchesCloseQuantity,
} from '../../../src/binance-orderbook-trade/dom/trade-form.js';
import {
  compareDecimalStrings,
  normalizeDecimalString,
} from '../../../src/binance-orderbook-trade/core/decimal.js';

function openChart(t) {
  const dom = loadFixtureDom('<div class="chart-widget-root"><section><div><iframe></iframe></div></section></div>');
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const frame = document.querySelector('iframe');
  const state = {
    heights: [200],
    viewportWidth: 1000,
    axisWidth: 88,
    range: { from: 0, to: 20 },
    mode: 0,
    inverted: false,
    convert: coordinate => 20 - coordinate / 10,
  };
  const scale = {
    coordinateToPrice: coordinate => state.convert(coordinate),
    getVisiblePriceRange: () => state.range,
    getMode: () => state.mode,
    isInverted: () => state.inverted,
  };
  state.panes = [{ getMainSourcePriceScale: () => scale }];
  const chart = {
    hasModel: () => true,
    getAllPanesHeight: () => state.heights,
    getPanes: () => state.panes,
  };
  Object.defineProperty(frame.contentWindow, 'innerWidth', { get: () => state.viewportWidth, configurable: true });
  frame.contentWindow.tradingViewApi = { activeChart: () => chart };
  const axis = frame.contentDocument.createElement('div');
  axis.className = 'chart-markup-table price-axis-container';
  axis.getBoundingClientRect = () => ({
    top: 0, left: state.viewportWidth - state.axisWidth,
    right: state.viewportWidth, bottom: 200, width: state.axisWidth, height: 200,
  });
  frame.contentDocument.body.append(axis);
  return { document, frame, state, chart, scale, axis };
}

/** The recorder owns browser canvas operations, never depth bucketing or label placement. */
function installCanvasRecorder(root) {
  const canvas = root.querySelector('canvas');
  const calls = [];
  const state = { width: 132, height: 200, available: true };
  const context = {};
  for (const method of [
    'beginPath', 'clearRect', 'fillRect', 'fillText', 'lineTo', 'moveTo',
    'restore', 'save', 'setLineDash', 'setTransform', 'stroke',
  ]) {
    context[method] = (...args) => calls.push({ method, args });
  }
  context.measureText = text => ({ width: text.length * 6 });
  canvas.getContext = type => {
    assert.equal(type, '2d');
    return state.available ? context : null;
  };
  canvas.getBoundingClientRect = () => ({
    left: 0, top: 0, right: state.width, bottom: state.height,
    width: state.width, height: state.height,
  });
  root.querySelector('[data-depth-profile-toggle]').getBoundingClientRect = () => ({
    left: 104, top: 8, right: 128, bottom: 32, width: 24, height: 24,
  });
  root.querySelector('.jh-depth-profile-status').getBoundingClientRect = () => ({
    left: 1, top: 120, right: 131, bottom: 142, width: 130, height: 22,
  });
  return { canvas, context, calls, state };
}

function openProfile(t) {
  const host = openChart(t);
  const parent = findDepthProfileHost(host.document).host;
  const root = ensureDepthProfileView(host.document, parent, {
    onToggle: () => { root.dataset.toggleRequested = 'true'; },
  });
  return { ...host, root, ...installCanvasRecorder(root) };
}

const formHtml = '<section id="native-form"><div id="position-direction"><div role="tab" aria-selected="true">开仓</div></div><input id="limitPrice-open" value="10"><input id="unitAmount-open" value="0.1"></section>';

function openForm(t) {
  const dom = loadFixtureDom(formHtml);
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const writes = [];
  document.addEventListener('input', event => writes.push({ id: event.target.id, value: event.target.value }));
  const resolveInputs = createTradeInputResolver(document, { panelId: 'own-panel', isVisibleElement });
  const writeValue = (input, value) => {
    input.value = value;
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  };
  return { document, resolveInputs, writes, writeValue };
}

function readerOptions(host, extra = {}) {
  return {
    resolveInputs: host.resolveInputs,
    expectedPrice: '10',
    expectedQty: '0.2',
    includePrice: false,
    normalizeValue: normalizeDecimalString,
    compareValues: compareDecimalStrings,
    writeValue: host.writeValue,
    ...extra,
  };
}

test('user receives the declared native geometry and canvas recording contract', t => {
  // Given the host exposes a native pane, price axis, and available two-dimensional canvas.
  const host = openProfile(t);

  // When native API consumers read geometry and issue drawing commands.
  const chart = host.frame.contentWindow.tradingViewApi.activeChart();
  const context = host.canvas.getContext('2d');
  context.setTransform(2, 0, 0, 2, 0, 0);
  context.fillRect(1, 2, 3, 4);
  context.fillText('Order', 8, 9);

  // Then the boundary preserves exact API values and records only the requested operations.
  assert.equal(chart, host.chart);
  assert.deepEqual(chart.getAllPanesHeight(), [200]);
  assert.equal(chart.getPanes()[0].getMainSourcePriceScale(), host.scale);
  assert.equal(host.scale.coordinateToPrice(0), 20);
  assert.equal(host.scale.coordinateToPrice(200), 0);
  assert.deepEqual(host.axis.getBoundingClientRect(), {
    top: 0, left: 912, right: 1000, bottom: 200, width: 88, height: 200,
  });
  assert.equal(host.canvas.getContext('2d'), context);
  assert.deepEqual(context.measureText('Order'), { width: 30 });
  assert.deepEqual(host.calls, [
    { method: 'setTransform', args: [2, 0, 0, 2, 0, 0] },
    { method: 'fillRect', args: [1, 2, 3, 4] },
    { method: 'fillText', args: ['Order', 8, 9] },
  ]);
  host.state.available = false;
  assert.equal(host.canvas.getContext('2d'), null);
});

test('user cannot mount a depth profile on two visible native frames', t => {
  // Given one chart root contains two visible embedded chart frames.
  const { document, frame } = openChart(t);
  frame.parentElement.append(frame.cloneNode());

  // When the actual host resolver selects the native chart.
  const resolve = () => findDepthProfileHost(document);

  // Then ambiguity is explicit and no profile is installed.
  assert.throws(resolve, { message: 'Visible chart frame count is invalid: 2' });
  assert.equal(document.getElementById('jh-binance-depth-profile'), null);
});

for (const variant of [
  { name: 'unpublished pane heights', configure: host => { host.state.heights = null; } },
  { name: 'an empty pane collection', configure: host => { host.state.panes = []; } },
  { name: 'a zero-height main pane', configure: host => { host.state.heights = [0]; } },
  { name: 'an incomplete price-scale API', configure: host => { host.scale.getMode = null; } },
  { name: 'a zero-width native viewport', configure: host => { host.state.viewportWidth = 0; } },
  { name: 'an unbounded native price axis', configure: host => { host.state.axisWidth = Infinity; } },
  { name: 'an unpublished visible price range', configure: host => { host.state.range = null; } },
  { name: 'a constant native price scale', configure: host => { host.state.convert = () => 10; } },
]) {
  test(`user declines depth geometry with ${variant.name}`, t => {
    // Given the current native chart is incomplete in one explicit host contract.
    const host = openChart(t);
    variant.configure(host);

    // When the real adapter asks for a price-coordinate mapping.
    const geometry = getTradingViewDepthProfileGeometry(host.frame);

    // Then no fabricated scale or overlay is supplied.
    assert.equal(geometry, null);
    assert.equal(host.document.getElementById('jh-binance-depth-profile'), null);
  });
}

test('user maps both exact visible price boundaries to the native pane edges', t => {
  // Given a verified native scale covers prices zero through twenty.
  const { frame } = openChart(t);

  // When the adapter resolves both endpoints and an out-of-range price.
  const geometry = getTradingViewDepthProfileGeometry(frame);

  // Then endpoints retain their exact native coordinates without interpolation drift.
  assert.equal(geometry.priceToCoordinate(20), 0);
  assert.equal(geometry.priceToCoordinate(0), 200);
  assert.equal(geometry.priceToCoordinate(-1), null);
});

test('user remounts the depth view with one stylesheet even before a document head exists', t => {
  // Given a valid host exists before head mounting, and invalid public arguments are rejected.
  const { document } = openChart(t);
  document.head.remove();
  const parent = document.querySelector('section');
  assert.throws(() => ensureDepthProfileView(document, null, { onToggle: () => true }), { message: 'Invalid depth profile host' });
  assert.throws(() => ensureDepthProfileView(document, parent, { onToggle: null }), { message: 'Invalid depth profile toggle listener' });
  let toggles = 0;
  const original = ensureDepthProfileView(document, parent, { onToggle: () => { toggles += 1; } });
  const nextHost = document.createElement('section');
  document.body.append(nextHost);

  // When a replacement native host receives the profile and its real toggle is clicked.
  const current = ensureDepthProfileView(document, nextHost, { onToggle: () => { toggles += 1; } });
  current.querySelector('[data-depth-profile-toggle]').click();

  // Then the stale view is removed and a single root stylesheet and new toggle remain.
  assert.equal(original.isConnected, false);
  assert.equal(current.parentElement, nextHost);
  assert.equal(document.querySelectorAll('#jh-binance-depth-profile-style').length, 1);
  assert.equal(document.getElementById('jh-binance-depth-profile-style').parentElement, document.documentElement);
  assert.equal(toggles, 1);
});

test('user clears an empty depth book at one device pixel without drawing invented liquidity', t => {
  // Given the current native book is empty and the browser does not supply a device scale.
  const host = openProfile(t);
  Object.defineProperty(host.document.defaultView, 'devicePixelRatio', { configurable: true, value: 0 });
  const geometry = getTradingViewDepthProfileGeometry(host.frame);

  // When the real renderer receives no bid or ask levels and no visible latest trade.
  const rendered = renderDepthProfile(host.root, { bids: [], asks: [] }, geometry, 21);

  // Then the canvas is sized and cleared once without bars, labels, or a divider.
  assert.equal(rendered, true);
  assert.equal(host.canvas.width, 132);
  assert.equal(host.canvas.height, 200);
  assert.deepEqual(host.calls, [
    { method: 'setTransform', args: [1, 0, 0, 1, 0, 0] },
    { method: 'clearRect', args: [0, 0, 132, 200] },
  ]);
});

test('user receives no depth paint for an invisible canvas and explicit failure for a missing context', t => {
  // Given the profile canvas has no visible width.
  const host = openProfile(t);
  const geometry = getTradingViewDepthProfileGeometry(host.frame);
  host.state.width = 0;

  // When the renderer handles the invisible canvas.
  const rendered = renderDepthProfile(host.root, { bids: [], asks: [] }, geometry, 10);

  // Then it leaves the drawing context untouched.
  assert.equal(rendered, false);
  assert.deepEqual(host.calls, []);

  // When the canvas becomes visible but its native two-dimensional context is unavailable.
  host.state.width = 132;
  host.state.available = false;

  // Then both render and clear expose the missing host dependency.
  assert.throws(() => renderDepthProfile(host.root, { bids: [], asks: [] }, geometry, 10), { message: 'Depth profile canvas context is unavailable' });
  assert.throws(() => clearDepthProfile(host.root), { message: 'Depth profile canvas context is unavailable' });
  assert.deepEqual(host.calls, []);
});

test('user keeps the largest cumulative bar while adding every quantity in the same pixel row', t => {
  // Given two bid prices share a pixel, with the smaller cumulative value arriving second.
  const host = openProfile(t);
  const geometry = getTradingViewDepthProfileGeometry(host.frame);
  const profile = {
    asks: [{ price: 14, quantity: 10, cumulative: 10 }],
    bids: [{ price: 11, quantity: 2, cumulative: 5 }, { price: 11.02, quantity: 1, cumulative: 3 }],
  };

  // When the production renderer buckets the exact visible levels.
  renderDepthProfile(host.root, profile, geometry, 21);

  // Then the bid retains width sixty-six and its band label includes all three units.
  assert.deepEqual(host.calls.filter(call => call.method === 'fillRect' && call.args[3] === 1).map(call => call.args), [
    [0, 60, 132, 1],
    [66, 90, 66, 1],
  ]);
  assert.deepEqual(host.calls.filter(call => call.method === 'fillText').map(call => call.args[0]), ['14 · 10', '11–11.02 · 3']);
});

for (const showStatus of [false, true]) {
  test(`user orders equal depth labels by price with status visibility ${showStatus}`, t => {
    // Given equal-quantity bid labels compete near the native status control.
    const host = openProfile(t);
    const geometry = getTradingViewDepthProfileGeometry(host.frame);
    host.root.querySelector('.jh-depth-profile-status').textContent = showStatus ? 'Synchronizing' : '';
    const profile = {
      asks: [],
      bids: [{ price: 12, quantity: 3, cumulative: 3 }, { price: 8, quantity: 3, cumulative: 6 }],
    };

    // When the real label placement accounts for equal quantities and visible controls.
    renderDepthProfile(host.root, profile, geometry, 21);

    // Then price breaks the tie and an active status box excludes only its overlapping label.
    assert.deepEqual(host.calls.filter(call => call.method === 'fillText').map(call => call.args[0]),
      showStatus ? ['12 · 3'] : ['8 · 3', '12 · 3']);
  });
}

test('user keeps a visible cumulative depth bar when its individual quantity is too small for a label', t => {
  // Given one visible price has a small quantity within a much larger cumulative depth.
  const host = openProfile(t);
  const geometry = getTradingViewDepthProfileGeometry(host.frame);

  // When the renderer evaluates label density for that price.
  renderDepthProfile(host.root, { asks: [], bids: [{ price: 11, quantity: 1, cumulative: 1000 }] }, geometry, 21);

  // Then the exact bar remains while no unreadable label is painted.
  assert.deepEqual(host.calls.filter(call => call.method === 'fillRect').map(call => call.args), [[0, 90, 132, 1]]);
  assert.deepEqual(host.calls.filter(call => call.method === 'fillText'), []);
});

test('user recognizes a native quantity text mutation and discards its detached stale record', t => {
  // Given a real observer watches the native quantity text node.
  const { document } = openForm(t);
  const quantity = document.createElement('div');
  quantity.dataset.testid = 'max-sell-amount';
  quantity.textContent = '可平 1 HYPE';
  document.querySelector('#native-form').append(quantity);
  const observer = new document.defaultView.MutationObserver(records => records.length);
  observer.observe(quantity, { characterData: true, subtree: true });

  // When the native renderer updates the same text node.
  const text = quantity.firstChild;
  text.data = '可平 2 HYPE';
  const records = observer.takeRecords();

  // Then the real character-data record is quantity evidence.
  assert.equal(records.length, 1);
  assert.equal(records[0].type, 'characterData');
  assert.equal(mutationTouchesCloseQuantity(records[0]), true);

  // When that observed text is detached before a stale consumer reuses the record.
  text.remove();
  observer.disconnect();

  // Then stale or absent evidence cannot confirm a new close snapshot.
  assert.equal(mutationTouchesCloseQuantity(records[0]), false);
  assert.equal(mutationTouchesCloseQuantity(null), false);
});

test('user waits for a coherent replacement form after the previous owner disconnects', t => {
  // Given the resolver already owns one complete native form.
  const host = openForm(t);
  const initial = host.resolveInputs();
  assert.equal(initial.root.id, 'native-form');
  initial.root.remove();
  host.document.body.innerHTML = '<div id="position-direction"><div role="tab" aria-selected="true">开仓</div></div><section><input id="unitAmount-open"></section>';

  // When the old owner has disconnected but the new tab and input have no common form owner.
  const unresolved = host.resolveInputs();
  const readState = createTradeInputStateReader(readerOptions(host));

  // Then neither discovery nor synchronization uses unrelated document nodes.
  assert.equal(unresolved, null);
  assert.equal(findActiveTradeInputs(host.document, { panelId: 'own-panel', isVisibleElement }), null);
  assert.equal(readState(), null);
  assert.deepEqual(host.writes, []);

  // When the native renderer finishes mounting a coherent form.
  host.document.body.innerHTML = formHtml;
  const current = host.resolveInputs();

  // Then fresh ownership resolves both inputs without reviving the detached node.
  assert.equal(current.root.id, 'native-form');
  assert.notEqual(current.root, initial.root);
  assert.equal(current.qtyInput.id, 'unitAmount-open');
  assert.equal(current.priceInput.id, 'limitPrice-open');
});

test('user preserves a native input when its writer budget is exhausted and resumes on a replacement node', t => {
  // Given the existing input has consumed its one allowed native write.
  const host = openForm(t);
  const writer = createBoundedInputWriter({ writeValue: host.writeValue, maxWriteAttempts: 1 });
  const original = host.resolveInputs().qtyInput;
  assert.equal(writer(original, '0.15'), true);
  const readState = createTradeInputStateReader(readerOptions(host, { writeValue: writer }));

  // When synchronization requests another value from that exhausted native node.
  const first = readState();
  const second = readState();

  // Then refusal does not trigger another write or pretend that the expected quantity is ready.
  assert.equal(first, null);
  assert.equal(second, null);
  assert.equal(original.value, '0.15');
  assert.deepEqual(host.writes, [{ id: 'unitAmount-open', value: '0.15' }]);

  // When React replaces the input with a new node carrying its own write budget.
  const replacement = original.cloneNode();
  original.replaceWith(replacement);
  assert.equal(readState(), null);
  const synchronized = readState();

  // Then the fresh node receives exactly one requested write and becomes the submission target.
  assert.equal(synchronized.qtyInput, replacement);
  assert.equal(synchronized.submittedQty, '0.2');
  assert.deepEqual(host.writes, [
    { id: 'unitAmount-open', value: '0.15' },
    { id: 'unitAmount-open', value: '0.2' },
  ]);
});

test('user keeps a manual quantity edit after the final permitted synchronized write', t => {
  // Given one script write has reached an acknowledged stable quantity.
  const host = openForm(t);
  const readState = createTradeInputStateReader(readerOptions(host, { maxWriteAttempts: 1 }));
  assert.equal(readState(), null);
  assert.equal(readState().submittedQty, '0.2');

  // When a real native input event publishes a later manual edit.
  host.writeValue(host.resolveInputs().qtyInput, '0.3');
  const afterEdit = readState();
  const afterAnotherRead = readState();

  // Then the exhausted recovery budget preserves the manual value and leaves submission unready.
  assert.equal(afterEdit, null);
  assert.equal(afterAnotherRead, null);
  assert.equal(host.resolveInputs().qtyInput.value, '0.3');
  assert.deepEqual(host.writes, [
    { id: 'unitAmount-open', value: '0.2' },
    { id: 'unitAmount-open', value: '0.3' },
  ]);
});

test('user rejects incomplete synchronization dependencies before any native input is written', t => {
  // Given a complete native form has not received any input operation.
  const host = openForm(t);

  // When public synchronization helpers receive missing dependencies or invalid budgets.
  const calls = [
    [() => createBoundedInputWriter({ writeValue: null, maxWriteAttempts: 1 }), '输入框写入依赖异常'],
    [() => createBoundedInputWriter({ writeValue: host.writeValue, maxWriteAttempts: 0 }), '输入框写入次数必须为正整数'],
    [() => isScriptOwnedTradeInputRecoveryState({ compareValues: null }), '输入框恢复校验依赖异常'],
    [() => createTradeInputStateReader(readerOptions(host, { readNowMs: null })), '交易输入框同步依赖异常'],
  ];

  // Then each invalid contract is explicit and the native price and quantity remain untouched.
  for (const [call, message] of calls) assert.throws(call, { message });
  assert.equal(host.resolveInputs().qtyInput.value, '0.1');
  assert.equal(host.resolveInputs().priceInput.value, '10');
  assert.deepEqual(host.writes, []);
});

for (const variant of [
  { name: 'three empty native states', values: [null, null, null], previous: undefined, allowed: true },
  { name: 'the previously acknowledged quantity', values: ['0.20', '0.2', '0.200'], previous: '0.2', allowed: true },
  { name: 'a manual value without an acknowledged predecessor', values: ['0.3', null, null], previous: undefined, allowed: false },
  { name: 'a manual edit after an acknowledged predecessor', values: [null, '0.2', '0.3'], previous: '0.2', allowed: false },
]) {
  test(`user allows recovery only for owned inputs with ${variant.name}`, () => {
    // Given the host exposes explicit pre-write, rollback, and current quantities.
    const [preWriteValue, rollbackValue, submittedValue] = variant.values;

    // When the real ownership contract compares the current state with its acknowledged predecessor.
    const allowed = isScriptOwnedTradeInputRecoveryState({
      preWriteValue, rollbackValue, submittedValue,
      previousSubmittedValue: variant.previous, compareValues: compareDecimalStrings,
    });

    // Then manual values cannot be mistaken for script-owned rollback state.
    assert.equal(allowed, variant.allowed);
  });
}
