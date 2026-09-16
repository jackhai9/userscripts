import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadFixtureDom, isVisibleElement } from '../../helpers/dom.js';
import { captureThrownError } from '../../helpers/orderbook-migration-errors.js';
import { createAnimationFrameBoundary } from '../../helpers/orderbook-migration-frames.js';
import {
  calculateFloatingPanelLayout,
  collectTradeButtonsFromScopes,
  createTradeInputResolver,
  findActiveTradeInputs,
  findCurrentLeverageButtonFromScopes,
  findTradeFormRoot,
  findTradePanelInsertionPoint,
  isTradeActionButton,
  isTradeModeTab,
  parseLeverageButtonText,
  placeTradePanelSpacer,
  readTradeAvailableBalance,
  waitForTradeActionButtonFrameState,
  waitForTradeFormFrameState,
  waitForTradeFormMutationState,
} from '../../../src/binance-orderbook-trade/dom/trade-form.js';

const fixture = await readFile(new URL('../../fixtures/binance-orderbook-trade/right-trade-form.html', import.meta.url), 'utf8');
const panelId = 'jh-binance-close-qty-multiplier-panel';

for (const { label, html } of [
  { label: 'multiple value siblings', html: '<div><span>Avbl</span><span>1 USDT</span><span>2 USDT</span></div>' },
  { label: 'missing value', html: '<div><span>Avbl</span></div>' },
  { label: 'empty value', html: '<div><span>Avbl</span><span></span></div>' },
  { label: 'malformed value', html: '<div><span>Avbl</span><span>pending</span></div>' },
  { label: 'hidden label', html: '<div><span data-hidden>Avbl</span><span>1 USDT</span></div>' },
  { label: 'hidden value', html: '<div><span>Avbl</span><span data-hidden>1 USDT</span></div>' },
]) {
  test(`user cannot infer available balance from ${label}`, () => {
    // Given the current trade form lacks one unique visible balance value
    const { window } = loadFixtureDom(`<section>${html}</section>`);

    // When the balance adapter reads the actual native DOM
    const balance = readTradeAvailableBalance(window.document.querySelector('section'), { isVisibleElement });

    // Then incomplete or hidden balance evidence remains unresolved
    assert.equal(balance, null);
  });
}

test('user leaves trade discovery unavailable when its DOM dependencies are missing', () => {
  // Given the native form exists but one required discovery dependency is unavailable
  const { window } = loadFixtureDom(fixture);

  // When public adapters receive an absent root or visibility predicate
  const missingBalanceRoot = readTradeAvailableBalance(null, { isVisibleElement });
  const missingBalanceVisibility = readTradeAvailableBalance(window.document, { isVisibleElement: null });
  const missingInputsRoot = findActiveTradeInputs(null, { panelId, isVisibleElement });
  const missingInputsVisibility = findActiveTradeInputs(window.document, { panelId, isVisibleElement: null });
  const resolverError = captureThrownError(() => createTradeInputResolver(null, { panelId, isVisibleElement }));

  // Then readers return no inferred inputs and resolver construction exposes its invalid dependency
  assert.equal(missingBalanceRoot, null);
  assert.equal(missingBalanceVisibility, null);
  assert.equal(missingInputsRoot, null);
  assert.equal(missingInputsVisibility, null);
  assert.equal(resolverError.message, '交易表单解析依赖异常');
});

test('user rejects detached, cross-document, and unrelated trade field pairs', () => {
  // Given two documents and disconnected nodes cannot share one coherent native form owner
  const { window } = loadFixtureDom('<section><div role="tab">Open</div></section><aside><input></aside>');
  const second = loadFixtureDom('<section><input></section>');
  const tab = window.document.querySelector('[role="tab"]');
  const input = window.document.querySelector('input');
  const detached = window.document.createElement('input');

  // When native form ownership is resolved for each invalid pair
  const detachedRoot = findTradeFormRoot(tab, detached);
  const crossDocumentRoot = findTradeFormRoot(tab, second.window.document.querySelector('input'));
  const unrelatedRoot = findTradeFormRoot(tab, input);

  // Then no body-wide or foreign-document owner is accepted
  assert.equal(detachedRoot, null);
  assert.equal(crossDocumentRoot, null);
  assert.equal(unrelatedRoot, null);
});

test('user ignores panel-owned and hidden actions when repeated scopes overlap', () => {
  // Given repeated native scopes contain visible, hidden, and panel-owned buttons
  const { window } = loadFixtureDom(`
    <section id="native"><button id="long"><span>Open Long</span></button>
      <button data-hidden>Open Short</button><button>Other</button>
      <div id="${panelId}"><button>Open Short</button><div role="tab" class="bn-tab__buySell">Open</div></div>
    </section><div id="plain">Open Long</div>
  `);
  const native = window.document.querySelector('#native');
  const nestedLabel = native.querySelector('#long span');

  // When actions and mode controls are resolved from the same scopes twice
  const buttons = collectTradeButtonsFromScopes([null, native, native], 'OPEN', { panelId, isVisibleElement });
  const action = isTradeActionButton(nestedLabel, { panelId });
  const panelAction = isTradeActionButton(window.document.querySelector(`#${panelId} button`), { panelId });
  const plainAction = isTradeActionButton(window.document.querySelector('#plain'), { panelId });
  const missingAction = isTradeActionButton(null, { panelId });
  const panelTab = isTradeModeTab(window.document.querySelector(`#${panelId} [role="tab"]`), { panelId });
  const plainTab = isTradeModeTab(window.document.querySelector('#plain'), { panelId });

  // Then only the unique visible native button remains actionable
  assert.deepEqual(buttons, [native.querySelector('#long')]);
  assert.equal(action, true);
  assert.equal(panelAction, false);
  assert.equal(plainAction, false);
  assert.equal(missingAction, false);
  assert.equal(panelTab, false);
  assert.equal(plainTab, false);
});

test('user reads one current leverage through overlapping scopes without hidden or panel controls', () => {
  // Given the native form contains one valid leverage and several ineligible labels
  const { window } = loadFixtureDom(`
    <section><button id="leverage">125X</button><button>0x</button><button>126x</button>
      <button data-hidden>5x</button><div id="${panelId}"><button>10x</button></div>
    </section>
  `);
  const root = window.document.querySelector('section');

  // When the current leverage adapter visits repeated and absent scopes
  const button = findCurrentLeverageButtonFromScopes([null, root, root], { panelId, isVisibleElement });
  const leverage = parseLeverageButtonText(button.textContent);
  const absent = findCurrentLeverageButtonFromScopes([null], { panelId, isVisibleElement });

  // Then only the unique current native leverage contributes to the result
  assert.equal(button, root.querySelector('#leverage'));
  assert.equal(leverage, 125);
  assert.equal(absent, null);
});

for (const { label, mutate } of [
  { label: 'missing mode group', mutate: (document) => document.querySelector('#position-direction').remove() },
  { label: 'missing open mode', mutate: (document) => document.querySelector('#position-direction [role="tab"]').remove() },
  { label: 'missing close mode', mutate: (document) => document.querySelector('#position-direction [role="tab"]:last-child').remove() },
  { label: 'an extra mode-row child', mutate: (document) => document.querySelector('.trade-mode-row').append(document.createElement('span')) },
  { label: 'missing leading header controls', mutate: (document) => document.querySelector('.quick-controls').remove() },
]) {
  test(`user avoids inserting a panel into a native header with ${label}`, () => {
    // Given the native header structure has changed from the verified insertion contract
    const { window } = loadFixtureDom(fixture);
    mutate(window.document);

    // When the panel adapter resolves its insertion point
    const insertionPoint = findTradePanelInsertionPoint(window.document);

    // Then the changed structure provides no guessed insertion location
    assert.equal(insertionPoint, null);
  });
}

test('user keeps a correctly placed panel spacer without another DOM insertion', () => {
  // Given the spacer already occupies the verified location before the native mode row
  const { window } = loadFixtureDom(fixture);
  const insertionPoint = findTradePanelInsertionPoint(window.document);
  const spacer = window.document.createElement('div');
  insertionPoint.parent.insertBefore(spacer, insertionPoint.before);
  const observer = new window.MutationObserver(() => {});
  observer.observe(insertionPoint.parent, { childList: true });

  // When stable rendering places the same spacer again
  const placed = placeTradePanelSpacer(spacer, insertionPoint);
  const mutations = observer.takeRecords();
  observer.disconnect();

  // Then placement succeeds without detaching or reinserting the spacer
  assert.equal(placed, true);
  assert.equal(spacer.nextElementSibling, insertionPoint.before);
  assert.deepEqual(mutations, []);
});

test('user rejects a stale panel insertion point and missing spacer inputs', () => {
  // Given React moved the target mode row away from its previously resolved header
  const { window } = loadFixtureDom(fixture);
  const insertionPoint = findTradePanelInsertionPoint(window.document);
  const spacer = window.document.createElement('div');
  window.document.querySelector('.order-entry').append(insertionPoint.before);

  // When the spacer adapter receives stale or incomplete placement inputs
  const stale = placeTradePanelSpacer(spacer, insertionPoint);
  const missingPoint = placeTradePanelSpacer(spacer, null);
  const missingSpacer = placeTradePanelSpacer(null, insertionPoint);

  // Then no unverified placement moves the spacer into the page
  assert.equal(stale, false);
  assert.equal(missingPoint, false);
  assert.equal(missingSpacer, false);
  assert.equal(spacer.isConnected, false);
});

test('user keeps floating panel geometry inside a narrow viewport and rounds fractional anchors', () => {
  // Given anchors sit beyond a narrow viewport and at fractional positions in a larger one
  const narrow = { anchorRect: { left: -20, top: 800, width: 200, height: 24 }, panelHeight: 100, viewportWidth: 250, viewportHeight: 300 };
  const fractional = { anchorRect: { left: 12.4, top: 5.5, width: 300.6, height: 24 }, panelHeight: 0, viewportWidth: 1000, viewportHeight: 700 };

  // When the floating layout uses the current viewport constraints
  const narrowLayout = calculateFloatingPanelLayout(narrow);
  const fractionalLayout = calculateFloatingPanelLayout(fractional);

  // Then margins, available width, minimum height, and pixel rounding remain concrete
  assert.deepEqual(narrowLayout, { width: 234, left: 8, top: 192 });
  assert.deepEqual(fractionalLayout, { width: 301, left: 12, top: 8 });
});

test('user receives current trade form state before requiring mutation observation', async () => {
  // Given an already selected native mode can be read without an observer root
  const { window } = loadFixtureDom('<div role="tab" aria-selected="true">Open</div>');
  const tab = window.document.querySelector('[role="tab"]');

  // When current and absent state are read through the mutation waiter
  const selected = await waitForTradeFormMutationState(null, () => window.document.querySelector('[aria-selected="true"]'), 1000);
  const absent = await waitForTradeFormMutationState(null, () => window.document.querySelector('[data-ready]'), 1000);

  // Then current native state is preserved while absent observation stays unresolved
  assert.equal(selected, tab);
  assert.equal(absent, null);
});

for (const frames of [0, 1.5]) {
  test(`user rejects the invalid stable frame count ${frames}`, () => {
    // Given both frame waiters have a valid browser scheduling boundary
    const { window } = loadFixtureDom('<section><button>Open Long</button></section>');
    const root = window.document.querySelector('section');
    const clock = createAnimationFrameBoundary(window);

    // When the caller requests a nonpositive or fractional stability count
    const formError = captureThrownError(() => waitForTradeFormFrameState(root, () => root, 1000, frames));
    const buttonError = captureThrownError(() => waitForTradeActionButtonFrameState(root, () => root.querySelector('button'), isVisibleElement, 1000, frames));

    // Then both public contracts reject before scheduling any browser frame
    assert.equal(formError.message, '稳定帧数必须为正整数');
    assert.equal(buttonError.message, '稳定帧数必须为正整数');
    assert.equal(clock.pendingCount, 0);
  });
}

test('user rejects absent frame schedulers and missing action locator dependencies', () => {
  // Given JSDOM has no frame scheduler until the explicit browser boundary is installed
  const { window } = loadFixtureDom('<section><button>Open Long</button></section>');
  const root = window.document.querySelector('section');

  // When consumers request frame observation without its required dependencies
  const missingView = captureThrownError(() => waitForTradeFormFrameState(null, () => root, 1000));
  const missingScheduler = captureThrownError(() => waitForTradeActionButtonFrameState(root, () => root.querySelector('button'), isVisibleElement, 1000));
  const clock = createAnimationFrameBoundary(window);
  const missingLocator = captureThrownError(() => waitForTradeActionButtonFrameState(root, null, isVisibleElement, 1000));
  const missingVisibility = captureThrownError(() => waitForTradeActionButtonFrameState(root, () => root.querySelector('button'), null, 1000));

  // Then each dependency failure remains explicit and no partial wait is scheduled
  assert.equal(missingView.message, '交易表单帧调度器不可用');
  assert.equal(missingScheduler.message, '下单按钮帧调度器不可用');
  assert.equal(missingLocator.message, '下单按钮定位器不可用');
  assert.equal(missingVisibility.message, '下单按钮定位器不可用');
  assert.equal(clock.pendingCount, 0);
});
