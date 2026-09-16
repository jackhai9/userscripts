import { captureThrownError } from '../../helpers/orderbook-migration-errors.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { isVisibleElement, loadFixtureDom } from '../../helpers/dom.js';
import { normalizeDecimalString } from '../../../src/binance-orderbook-trade/core/decimal.js';
import {
  OrderbookPrecisionDomError,
  findNativeOrderbookPrecisionOverlay,
  isNativeOrderbookPrecisionMenuOpen,
} from '../../../src/binance-orderbook-trade/dom/orderbook-precision.js';

const source = readFileSync(new URL('../../../src/binance-orderbook-trade/index.user.js', import.meta.url), 'utf8');
const markup = readFileSync(new URL('../../fixtures/binance-orderbook-trade/orderbook-precision.html', import.meta.url), 'utf8');

function declaration(name) {
  const start = source.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, name + ' must exist');
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(source.slice(start - 6, start) === 'async ' ? start - 6 : start, index + 1);
  }
  assert.fail(name + ' must have a complete body');
}

function attachDropdownOwner(root, id = 'bn-select-precision') {
  const host = root.querySelector('.bn-select');
  const branch = () => ({
    stateNode: host,
    return: {
      memoizedProps: { overlay: { props: { id } } },
      return: { stateNode: root, return: null },
    },
  });
  const fiber = branch();
  fiber.alternate = branch();
  host.__reactFiber$fixture = fiber;
  return fiber;
}

function setup() {
  const dom = loadFixtureDom(markup);
  const document = dom.window.document;
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  const root = document.querySelector('.orderbook-tickSize');
  const fiber = attachDropdownOwner(root);
  const context = vm.createContext({
    document,
    isVisibleElement,
    normalizeDecimalString,
    findNativeOrderbookPrecisionOverlay,
    isNativeOrderbookPrecisionMenuOpen,
    OrderbookPrecisionDomError,
    ORDERBOOK_PRECISION_SHORTCUT_LIMIT: 4,
    MUTED_TEXT_COLOR: '#76808f',
    renderOrderbookPrecisionShortcut: (value) => '<button data-orderbook-precision-value="' + value + '">' + value + '</button>',
  });
  for (const name of [
    'isOrderbookPrecisionNumericText',
    'findOrderbookPrecisionTrigger',
    'readCurrentOrderbookPrecisionValue',
    'getVisibleOrderbookPrecisionOverlay',
    'getVisibleOrderbookPrecisionOptionNodes',
    'readOrderbookPrecisionOptionValue',
    'readVisibleOrderbookPrecisionOptionValues',
    'renderOrderbookPrecisionShortcutSlots',
  ]) vm.runInContext(declaration(name), context);
  return { dom, document, root, fiber, context };
}

function installController(context, overrides = {}) {
  Object.assign(context, {
    window: context.document.defaultView,
    getCurrentSymbol: () => 'SOPHUSDT',
    isCurrentObservedSymbol: (symbol) => symbol === 'SOPHUSDT',
    isFuturesTradingPage: () => true,
    orderbookPrecisionState: { symbol: 'SOPHUSDT', nativeOptions: ['stale'], nativeOptionsStatus: null },
    orderbookPrecisionSelectionTask: null,
    orderbookPrecisionObserver: null,
    orderbookPrecisionObserverRoot: null,
    lastObservedOrderbookPrecision: null,
    ladderPanelBodySignature: 'old',
    scheduleRenderPanel() {},
    stopMultiplierEdit() {},
    delay: () => Promise.resolve(),
    ORDERBOOK_PRECISION_OPTION_WAIT_MS: 50,
    ORDERBOOK_PRECISION_READY_TIMEOUT_MS: 500,
    ORDERBOOK_PRECISION_READY_POLL_MS: 1,
    ...overrides,
  });
  for (const name of [
    'handleOrderbookPrecisionChange',
    'recordOrderbookPrecisionDomFailure',
    'stopOrderbookPrecisionObserver',
    'ensureOrderbookPrecisionObserver',
    'runOrderbookPrecisionSelectionTask',
    'waitForOrderbookPrecisionMenuState',
    'closeOrderbookPrecisionOptions',
    'waitForStableOrderbookPrecisionOptions',
    'runLoadOrderbookPrecisionOptions',
  ]) vm.runInContext(declaration(name), context);
}

test("user reads exact native precision options from the control-owned body portal", () => {
  // Given the native precision control and its menu state are available
  const { document, root, context } = setup();
  const trigger = root.querySelector('.tick-content');
  const listbox = document.getElementById('bn-select-precision');
  // When the native precision selection is read or updated
  const observed = root.contains(listbox);

  // Then reads exact native precision options from the control-owned body portal
  assert.equal(observed, false);
  const nodes = context.getVisibleOrderbookPrecisionOptionNodes(trigger);
  assert.deepEqual(Array.from(nodes, context.readOrderbookPrecisionOptionValue), [
    '0.000001', '0.00001', '0.0001',
  ]);
});

test("user sees that empty precision options have a visible status instead of four blank slots", () => {
  // Given the native precision control and its menu state are available
  const { document, context } = setup();
  const row = document.createElement('div');
  // When the native precision selection is read or updated
  row.innerHTML = context.renderOrderbookPrecisionShortcutSlots([], '0.000001', null, false, 'Waiting for options').join('');
  // Then sees that empty precision options have a visible status instead of four blank slots
  assert.equal(row.textContent, 'Waiting for options');
  assert.equal(row.querySelector('[role="status"]').getAttribute('data-orderbook-precision-status'), 'true');
  assert.equal(row.querySelectorAll('[data-orderbook-precision-value]').length, 0);
});

test("user sees that native options keep their exact values and reserve only the unused fourth slot", () => {
  // Given the native precision control and its menu state are available
  const { document, context } = setup();
  const row = document.createElement('div');
  // When the native precision selection is read or updated
  row.innerHTML = context.renderOrderbookPrecisionShortcutSlots(
    ['0.000001', '0.00001', '0.0001'], '0.000001', null, false, 'Waiting for options',
  ).join('');
  // Then sees that native options keep their exact values and reserve only the unused fourth slot
  assert.deepEqual(Array.from(row.querySelectorAll('button'), (node) => node.dataset.orderbookPrecisionValue), [
    '0.000001', '0.00001', '0.0001',
  ]);
  assert.equal(row.querySelectorAll('[aria-hidden="true"]').length, 1);
  assert.equal(row.querySelector('[role="status"]'), null);
});

test("user sees that a lookalike numeric portal cannot supply the precision menu options", () => {
  // Given the native precision control and its menu state are available
  const { document, context } = setup();
  const owned = document.getElementById('bn-select-precision');
  const otherBubble = owned.closest('.bn-select-bubble').cloneNode(true);
  otherBubble.querySelector('[role="listbox"]').id = 'bn-select-unrelated';
  // When the native precision selection is read or updated
  document.body.prepend(otherBubble);
  // Then sees that a lookalike numeric portal cannot supply the precision menu options
  assert.deepEqual(Array.from(context.getVisibleOrderbookPrecisionOptionNodes(), (node) => node.closest('[role="listbox"]').id), [
    'bn-select-precision', 'bn-select-precision', 'bn-select-precision',
  ]);
  owned.remove();
  assert.deepEqual(Array.from(context.getVisibleOrderbookPrecisionOptionNodes()), []);
});

for (const [scenarioIndex, transition] of (['closed', 'hidden', 'unmounted', 'detached']).entries()) {
  test(`user sees that closed, unmounted, or detached menus return no options (case ${scenarioIndex + 1})`, () => {
    // Given the native fixture represents this supported scenario
    const { root, document, context } = setup();
    const trigger = root.querySelector('.tick-content');
    if (transition === 'closed') root.querySelector('.bn-select').classList.remove('active');
    if (transition === 'hidden') document.querySelector('.bn-select-bubble').setAttribute('data-hidden', '');
    if (transition === 'unmounted') document.querySelector('.bn-select-bubble').remove();
    if (transition === 'detached') root.remove();
    // When the real adapter handles this fixture
    const observed = context.getVisibleOrderbookPrecisionOverlay(trigger);

    // Then the user sees that closed, unmounted, or detached menus return no options
    assert.equal(observed, null, transition);
  });
}

{
const mutations = [
    (root) => { delete root.querySelector('.bn-select').__reactFiber$fixture; },
    (_root, fiber) => { fiber.return.return = null; },
    (_root, fiber) => { fiber.return.return = { memoizedProps: { overlay: { props: { id: 'bn-select-second' } } }, return: fiber.return.return }; },
    (_root, fiber) => { fiber.alternate.return.memoizedProps.overlay.props.id = 'bn-select-replaced'; },
  ];
for (const [scenarioIndex, mutate] of (mutations).entries()) {
  test(`user sees that missing, ambiguous, escaped, or disagreeing React owners fail explicitly (case ${scenarioIndex + 1})`, () => {
    // Given the native fixture represents this supported scenario
    const { root, fiber, context } = setup();
    mutate(root, fiber);
    // When the real adapter handles this fixture
    const observedFailure = captureThrownError(() => context.getVisibleOrderbookPrecisionOverlay());

    // Then the user sees that missing, ambiguous, escaped, or disagreeing React owners fail explicitly
    assert.ok(observedFailure instanceof OrderbookPrecisionDomError);
    assert.equal(context.readCurrentOrderbookPrecisionValue(), '0.000001');
  });
}
}

test("user sees that the current native root is reacquired after a same-symbol replacement", () => {
  // Given the native precision control and its menu state are available
  const { document, root, context } = setup();
  const oldTrigger = root.querySelector('.tick-content');
  const replacement = root.cloneNode(true);
  root.replaceWith(replacement);
  attachDropdownOwner(replacement, 'bn-select-new');
  const listbox = document.getElementById('bn-select-precision');
  // When the native precision selection is read or updated
  listbox.id = 'bn-select-new';
  // Then sees that the current native root is reacquired after a same-symbol replacement
  assert.equal(context.getVisibleOrderbookPrecisionOverlay(oldTrigger), null);
  assert.equal(context.getVisibleOrderbookPrecisionOverlay(), listbox.parentElement);
});

test("user sees that an owner-linked element with a changed listbox contract fails explicitly", () => {
  // Given the native precision control and its menu state are available
  const { document, context } = setup();
  // When the native precision selection is read or updated
  document.getElementById('bn-select-precision').setAttribute('role', 'menu');
  // Then sees that an owner-linked element with a changed listbox contract fails explicitly
  assert.throws(() => context.getVisibleOrderbookPrecisionOverlay(), /listbox structure has changed/);
});

test("user sees that cleanup closes only the captured trigger without selecting an option", async () => {
  // Given the native precision control and its menu state are available
  const { root, context } = setup();
  const trigger = root.querySelector('.tick-content');
  const clicks = [];
  installController(context, {
    clickDomTarget(node) {
      clicks.push(node);
      root.querySelector('.bn-select').classList.remove('active');
      return true;
    },
  });
  // When the native precision selection is read or updated
  delete root.querySelector('.bn-select').__reactFiber$fixture;
  // Then sees that cleanup closes only the captured trigger without selecting an option
  assert.equal(await context.closeOrderbookPrecisionOptions(trigger), true);
  assert.deepEqual(clicks, [root.querySelector('.bn-select-trigger')]);
  assert.equal(trigger.textContent.trim(), '0.000001');
});

for (const [scenarioIndex, transition] of (['replaced', 'closed']).entries()) {
  test(`user sees that cleanup never clicks a replacement trigger or a user-closed menu (case ${scenarioIndex + 1})`, async () => {
    // Given the native fixture represents this supported scenario
    const { root, context } = setup();
    const trigger = root.querySelector('.tick-content');
    let clicks = 0;
    installController(context, { clickDomTarget() { clicks += 1; return true; } });
    if (transition === 'replaced') root.replaceWith(root.cloneNode(true));
    else root.querySelector('.bn-select').classList.remove('active');
    // When the real adapter handles this fixture
    const observed = await context.closeOrderbookPrecisionOptions(trigger);

    // Then the user sees that cleanup never clicks a replacement trigger or a user-closed menu
    assert.equal(observed, true);
    assert.equal(clicks, 0, transition);
  });
}

test("user sees that precision jobs expose DOM contract failures and discard cached options", async () => {
  // Given the native precision control and its menu state are available
  const { context } = setup();
  // When the native precision selection is read or updated
  installController(context);
  const error = new OrderbookPrecisionDomError('Native precision listbox identity changed between renders');
  // Then sees that precision jobs expose DOM contract failures and discard cached options
  assert.equal(await context.runOrderbookPrecisionSelectionTask(async () => { throw error; }), false);
  assert.deepEqual(Array.from(context.orderbookPrecisionState.nativeOptions), []);
  assert.equal(context.orderbookPrecisionState.nativeOptionsStatus, error.message);
  assert.equal(context.orderbookPrecisionSelectionTask, null);
  const unexpected = new TypeError('Unexpected programmer error');
  await assert.rejects(context.runOrderbookPrecisionSelectionTask(async () => { throw unexpected; }), unexpected);
});

test("user sees that a failed precision job cannot overwrite the next symbol state", async () => {
  // Given the native precision control and its menu state are available
  const { context } = setup();
  let symbol = 'SOPHUSDT';
  // When the native precision selection is read or updated
  installController(context, {
    getCurrentSymbol: () => symbol,
    isCurrentObservedSymbol: (captured) => captured === symbol,
  });
  const nextState = { symbol: 'BTCUSDT', nativeOptions: ['0.1', '1'], nativeOptionsStatus: null };
  const result = await context.runOrderbookPrecisionSelectionTask(async () => {
    await Promise.resolve();
    symbol = 'BTCUSDT';
    context.orderbookPrecisionState = nextState;
    throw new OrderbookPrecisionDomError('Native precision React ownership is unavailable');
  });
  // Then sees that a failed precision job cannot overwrite the next symbol state
  assert.equal(result, false);
  assert.equal(context.orderbookPrecisionState, nextState);
  assert.equal(context.orderbookPrecisionSelectionTask, null);
});

test("user sees that observer contract failures preserve current-precision invalidation and visible error state", () => {
  // Given the native precision control and its menu state are available
  const { root, context } = setup();
  let callback;
  let stoppedEdits = 0;
  installController(context, {
    MutationObserver: class {
      constructor(handler) { callback = handler; }
      observe() {}
      disconnect() {}
    },
    stopMultiplierEdit() { stoppedEdits += 1; },
  });
  context.ensureOrderbookPrecisionObserver();
  root.querySelector('.tick-content span').textContent = '0.00001';
  delete root.querySelector('.bn-select').__reactFiber$fixture;
  // When the native precision selection is read or updated
  callback();
  // Then sees that observer contract failures preserve current-precision invalidation and visible error state
  assert.equal(context.lastObservedOrderbookPrecision, '0.00001');
  assert.equal(stoppedEdits, 1);
  assert.equal(context.ladderPanelBodySignature, '');
  assert.deepEqual(Array.from(context.orderbookPrecisionState.nativeOptions), []);
  assert.equal(context.orderbookPrecisionState.nativeOptionsStatus, 'Native precision React ownership is unavailable');
  context.handleOrderbookPrecisionChange = () => { throw new TypeError('Unexpected programmer error'); };
  assert.throws(callback, /Unexpected programmer error/);
});

test("user sees that bootstrap discards a snapshot replaced during cleanup before committing new options", async () => {
  // Given the native precision control and its menu state are available
  const { document, root, context } = setup();
  let menuOpen = false;
  let closes = 0;
  let currentOptions = ['0.000001', '0.00001', '0.0001'];
  installController(context);
  // When the native precision selection is read or updated
  Object.assign(context, {
    waitForOrderbookPrecisionBootstrapReady: async () => context.findOrderbookPrecisionTrigger(),
    getVisibleOrderbookPrecisionOptionNodes: () => menuOpen ? currentOptions : [],
    ensureVisibleOrderbookPrecisionOptions: async () => { menuOpen = true; return currentOptions; },
    readVisibleOrderbookPrecisionOptionValues: () => currentOptions,
    closeOrderbookPrecisionOptions: async () => {
      await Promise.resolve();
      closes += 1;
      menuOpen = false;
      if (closes === 1) {
        const replacement = root.cloneNode(true);
        replacement.querySelector('.tick-content span').textContent = '0.001';
        root.replaceWith(replacement);
        attachDropdownOwner(replacement, 'bn-select-new');
        currentOptions = ['0.001', '0.01'];
      }
      return true;
    },
  });
  // Then sees that bootstrap discards a snapshot replaced during cleanup before committing new options
  assert.equal(await context.runLoadOrderbookPrecisionOptions(), true);
  assert.equal(closes, 2);
  assert.equal(root.isConnected, false);
  assert.equal(document.querySelector('.tick-content').textContent, '0.001');
  assert.deepEqual(Array.from(context.orderbookPrecisionState.nativeOptions), ['0.001', '0.01']);
  assert.equal(context.orderbookPrecisionState.current, '0.001');
});

test("user sees that bootstrap preserves an already open native precision menu", async () => {
  // Given the native precision control and its menu state are available
  const { context } = setup();
  installController(context);
  let closes = 0;
  // When the native precision selection is read or updated
  Object.assign(context, {
    waitForOrderbookPrecisionBootstrapReady: async () => context.findOrderbookPrecisionTrigger(),
    getVisibleOrderbookPrecisionOptionNodes: () => ['option'],
    ensureVisibleOrderbookPrecisionOptions: async () => ['option'],
    readVisibleOrderbookPrecisionOptionValues: () => ['0.000001', '0.00001'],
    closeOrderbookPrecisionOptions: async () => { closes += 1; return true; },
  });
  // Then sees that bootstrap preserves an already open native precision menu
  assert.equal(await context.runLoadOrderbookPrecisionOptions(), true);
  assert.equal(closes, 0);
  assert.deepEqual(Array.from(context.orderbookPrecisionState.nativeOptions), ['0.000001', '0.00001']);
});

test("user sees that bootstrap reacquires the displayed precision after it changes during cleanup", async () => {
  // Given the native precision control and its menu state are available
  const { root, context } = setup();
  installController(context);
  let closes = 0;
  const values = ['0.000001', '0.00001', '0.0001'];
  // When the native precision selection is read or updated
  Object.assign(context, {
    waitForOrderbookPrecisionBootstrapReady: async () => context.findOrderbookPrecisionTrigger(),
    getVisibleOrderbookPrecisionOptionNodes: () => [],
    ensureVisibleOrderbookPrecisionOptions: async () => values,
    readVisibleOrderbookPrecisionOptionValues: () => values,
    closeOrderbookPrecisionOptions: async () => {
      await Promise.resolve();
      closes += 1;
      root.querySelector('.tick-content span').textContent = '0.00001';
      return true;
    },
  });
  // Then sees that bootstrap reacquires the displayed precision after it changes during cleanup
  assert.equal(await context.runLoadOrderbookPrecisionOptions(), true);
  assert.equal(closes, 2);
  assert.equal(context.orderbookPrecisionState.current, '0.00001');
  assert.deepEqual(Array.from(context.orderbookPrecisionState.nativeOptions), values);
});

test("user sees that bootstrap discards its snapshot when the symbol changes during cleanup", async () => {
  // Given the native precision control and its menu state are available
  const { context } = setup();
  let symbol = 'SOPHUSDT';
  installController(context, {
    getCurrentSymbol: () => symbol,
    isCurrentObservedSymbol: (captured) => captured === symbol,
  });
  const nextState = { symbol: 'BTCUSDT', nativeOptions: ['0.1', '1'], nativeOptionsStatus: null };
  // When the native precision selection is read or updated
  Object.assign(context, {
    waitForOrderbookPrecisionBootstrapReady: async () => context.findOrderbookPrecisionTrigger(),
    getVisibleOrderbookPrecisionOptionNodes: () => [],
    ensureVisibleOrderbookPrecisionOptions: async () => ['0.000001', '0.00001'],
    readVisibleOrderbookPrecisionOptionValues: () => ['0.000001', '0.00001'],
    closeOrderbookPrecisionOptions: async () => {
      await Promise.resolve();
      symbol = 'BTCUSDT';
      context.orderbookPrecisionState = nextState;
      return true;
    },
  });
  // Then sees that bootstrap discards its snapshot when the symbol changes during cleanup
  assert.equal(await context.runLoadOrderbookPrecisionOptions(), false);
  assert.equal(context.orderbookPrecisionState, nextState);
});
