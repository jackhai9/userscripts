import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAccountOrdersMutationSignal,
  findAccountOrdersTabByIdentity,
  findAccountPositionTab,
  findOpenOrdersBasicSubTab,
  findOpenOrdersConditionalSubTab,
  findOpenOrdersSubTabByIdentity,
  findOpenOrdersTab,
  findSelectedAccountOrdersTab,
  findSelectedOpenOrdersSubTab,
  getAccountOrdersTabGroup,
  getAccountOrdersTabIdentity,
  getActiveOpenOrdersScope,
  getOpenOrdersSubTabIdentity,
  isAccountOrdersTab,
  parseAccountPositionTabCount,
  waitForAccountOrdersMutationState,
} from '../../../src/binance-orderbook-trade/dom/account-orders.js';
import { isVisibleElement, loadFixtureDom } from '../../helpers/dom.js';

const openOrdersHtml = await readFile(new URL('../../fixtures/binance-orderbook-trade/account-orders-open-orders.html', import.meta.url), 'utf8');
const positionHtml = await readFile(new URL('../../fixtures/binance-orderbook-trade/account-orders-position.html', import.meta.url), 'utf8');

test("user selects the bottom account-orders open-orders tab over unrelated tab groups", () => {
  // Given native account tabs and order panes are mounted
  const { window } = loadFixtureDom(openOrdersHtml);
  // When the current account and order scope is resolved
  const tab = findOpenOrdersTab(window.document, { isVisibleElement });

  // Then selects the bottom account-orders open-orders tab over unrelated tab groups
  assert.equal(tab?.textContent.trim(), '当前委托(2)');
  assert.equal(tab?.closest('#account-orders') != null, true);
});

test("user reads a confirmed zero position count from the unique account tab group", () => {
  // Given native account tabs and order panes are mounted
  const { window } = loadFixtureDom(`
    <section id="account-orders">
      <div class="account-tab-group">
        <div role="tab" aria-selected="true">仓位(0)</div>
        <div role="tab" aria-selected="false">当前委托(0)</div>
        <div role="tab" aria-selected="false">历史委托</div>
        <div role="tab" aria-selected="false">历史成交</div>
        <div role="tab" aria-selected="false">资金流水</div>
      </div>
    </section>
  `);

  // When the current account and order scope is resolved
  const tab = findAccountPositionTab(window.document, { isVisibleElement });

  // Then reads a confirmed zero position count from the unique account tab group
  assert.equal(tab?.textContent.trim(), '仓位(0)');
  assert.equal(parseAccountPositionTabCount(tab?.textContent), 0);
  assert.equal(parseAccountPositionTabCount('Positions (12)'), 12);
  assert.equal(parseAccountPositionTabCount('仓位'), null);
});

test("user rejects position counts when account tab groups are ambiguous", () => {
  // Given native account tabs and order panes are mounted
  const accountGroup = (id) => `
    <section id="${id}">
      <div class="account-tab-group">
        <div role="tab" aria-selected="true">仓位(0)</div>
        <div role="tab" aria-selected="false">当前委托(0)</div>
        <div role="tab" aria-selected="false">历史委托</div>
        <div role="tab" aria-selected="false">历史成交</div>
        <div role="tab" aria-selected="false">资金流水</div>
      </div>
    </section>
  `;
  const { window } = loadFixtureDom(`${accountGroup('first')}${accountGroup('second')}`);

  // When the current account and order scope is resolved
  const observed = findAccountPositionTab(window.document, { isVisibleElement });

  // Then rejects position counts when account tab groups are ambiguous
  assert.equal(observed, null);
});

test("user does not trust aria-controls alone when resolving current-orders pane", () => {
  // Given native account tabs and order panes are mounted
  const { window } = loadFixtureDom(openOrdersHtml);
  // When the current account and order scope is resolved
  const scope = getActiveOpenOrdersScope(window.document, {
    isVisibleElement,
    findHideOtherSymbolCheckbox: (root) => root.querySelector('[role="checkbox"][name="hideOtherSymbol"]'),
    findCurrentSymbolCancelAllButton: (root) => Array.from(root.querySelectorAll('button')).find((button) => button.textContent.trim() === '全撤') || null,
  });

  // Then does not trust aria-controls alone when resolving current-orders pane
  assert.equal(scope?.id, 'OPEN_ORDERS');
  assert.equal(scope.querySelector('#wrong-pane'), null);
});

test("user rejects ambiguous visible OPEN_ORDERS panes", () => {
  // Given native account tabs and order panes are mounted
  const { window } = loadFixtureDom(`${openOrdersHtml}<div id="OPEN_ORDERS"><button>全撤</button></div>`);
  // When the current account and order scope is resolved
  const scope = getActiveOpenOrdersScope(window.document, {
    isVisibleElement,
    findHideOtherSymbolCheckbox: (root) => root.querySelector('[role="checkbox"][name="hideOtherSymbol"]'),
    findCurrentSymbolCancelAllButton: (root) => Array.from(root.querySelectorAll('button')).find((button) => button.textContent.trim() === '全撤') || null,
  });

  // Then rejects ambiguous visible OPEN_ORDERS panes
  assert.equal(scope, null);
});

test("user returns no active open-orders scope when current-orders tab is not active", () => {
  // Given native account tabs and order panes are mounted
  const { window } = loadFixtureDom(positionHtml);
  // When the current account and order scope is resolved
  const scope = getActiveOpenOrdersScope(window.document, {
    isVisibleElement,
    findHideOtherSymbolCheckbox: (root) => root.querySelector('[role="checkbox"][name="hideOtherSymbol"]'),
    findCurrentSymbolCancelAllButton: (root) => Array.from(root.querySelectorAll('button')).find((button) => button.textContent.trim() === '全撤') || null,
  });

  // Then returns no active open-orders scope when current-orders tab is not active
  assert.equal(scope, null);
});

test("user does not treat stale position content as active open-orders scope", () => {
  // Given native account tabs and order panes are mounted
  const { window } = loadFixtureDom(`
    <section id="account-orders">
      <div class="account-tab-group">
        <div role="tab" aria-selected="false">仓位(1)</div>
        <div role="tab" aria-selected="true">当前委托(9)</div>
        <div role="tab" aria-selected="false">历史委托</div>
        <div role="tab" aria-selected="false">历史成交</div>
        <div role="tab" aria-selected="false">资金流水</div>
      </div>
      <div id="stale-position-pane">
        <label role="checkbox" name="hideOtherSymbol" aria-checked="false">隐藏其他合约</label>
        <button>市价全部平仓</button>
        <div>HYPEUSDT 永续 3x -5.64 HYPE</div>
      </div>
    </section>
  `);
  // When the current account and order scope is resolved
  const scope = getActiveOpenOrdersScope(window.document, {
    isVisibleElement,
    findHideOtherSymbolCheckbox: (root) => root.querySelector('[role="checkbox"][name="hideOtherSymbol"]'),
    findCurrentSymbolCancelAllButton: (root) => Array.from(root.querySelectorAll('button')).find((button) => button.textContent.trim() === '全撤') || null,
  });

  // Then does not treat stale position content as active open-orders scope
  assert.equal(scope, null);
});

test("user finds basic open-orders sub tab when conditional sub tab is selected", () => {
  // Given native account tabs and order panes are mounted
  const { window } = loadFixtureDom(`
    <section id="account-orders">
      <div class="account-tab-group">
        <div role="tab" aria-selected="false">仓位(1)</div>
        <div role="tab" aria-selected="true">当前委托(5)</div>
        <div role="tab" aria-selected="false">历史委托</div>
        <div role="tab" aria-selected="false">历史成交</div>
        <div role="tab" aria-selected="false">资金流水</div>
      </div>
      <div id="OPEN_ORDERS">
        <div role="tab" aria-selected="false">基础单(5)</div>
        <div role="tab" aria-selected="true">条件委托(0)</div>
        <label role="checkbox" name="hideOtherSymbol" aria-checked="true">隐藏其他合约</label>
        <button>全撤</button>
      </div>
    </section>
  `);
  const scope = getActiveOpenOrdersScope(window.document, {
    isVisibleElement,
    findHideOtherSymbolCheckbox: (root) => root.querySelector('[role="checkbox"][name="hideOtherSymbol"]'),
    findCurrentSymbolCancelAllButton: (root) => Array.from(root.querySelectorAll('button')).find((button) => button.textContent.trim() === '全撤') || null,
  });
  const basicTab = findOpenOrdersBasicSubTab(scope, { isVisibleElement });
  // When the current account and order scope is resolved
  const selectedSubTab = findSelectedOpenOrdersSubTab(scope, { isVisibleElement });

  // Then finds basic open-orders sub tab when conditional sub tab is selected
  assert.equal(basicTab?.textContent.trim(), '基础单(5)');
  assert.equal(selectedSubTab?.textContent.trim(), '条件委托(0)');
});

test("user finds the verified English Basic and Conditional labels with live counts", () => {
  // Given native account tabs and order panes are mounted
  const { window } = loadFixtureDom(`
    <section id="account-orders">
      <div class="account-tab-group">
        <div role="tab" aria-selected="false">Positions(1)</div>
        <div role="tab" aria-selected="true">Open Orders(31)</div>
        <div role="tab" aria-selected="false">Order History</div>
        <div role="tab" aria-selected="false">Trade History</div>
        <div role="tab" aria-selected="false">Transaction History</div>
      </div>
      <div id="OPEN_ORDERS">
        <div role="tab" aria-selected="false">Basic(31)</div>
        <div role="tab" aria-selected="true">Conditional(0)</div>
        <label role="checkbox" name="hideOtherSymbol" aria-checked="true">Hide Other Symbols</label>
        <button>Cancel All</button>
      </div>
    </section>
  `);
  // When the current account and order scope is resolved
  const scope = getActiveOpenOrdersScope(window.document, {
    isVisibleElement,
    findHideOtherSymbolCheckbox: (root) => root.querySelector('[role="checkbox"][name="hideOtherSymbol"]'),
    findCurrentSymbolCancelAllButton: (root) => Array.from(root.querySelectorAll('button'))
      .find((button) => button.textContent.trim() === 'Cancel All') || null,
  });

  // Then finds the verified English Basic and Conditional labels with live counts
  assert.equal(
    findOpenOrdersBasicSubTab(scope, { isVisibleElement })?.textContent.trim(),
    'Basic(31)',
  );
  assert.equal(
    findSelectedOpenOrdersSubTab(scope, { isVisibleElement })?.textContent.trim(),
    'Conditional(0)',
  );
});

test("user reacquires account and open-orders tabs by semantic identity after rerender", () => {
  // Given native account tabs and order panes are mounted
  const { window } = loadFixtureDom(openOrdersHtml);
  const selectedAccountTab = window.document.querySelector('#account-orders [role="tab"][aria-selected="true"]');
  const accountIdentity = getAccountOrdersTabIdentity(selectedAccountTab);
  const replacementAccountTab = selectedAccountTab.cloneNode(true);
  replacementAccountTab.textContent = '当前委托(7)';
  selectedAccountTab.replaceWith(replacementAccountTab);

  // When the current account and order scope is resolved
  const accountTab = findAccountOrdersTabByIdentity(window.document, accountIdentity, { isVisibleElement });
  // Then reacquires account and open-orders tabs by semantic identity after rerender
  assert.equal(selectedAccountTab.isConnected, false);
  assert.notEqual(accountTab, selectedAccountTab);
  assert.equal(accountTab?.textContent.trim(), '当前委托(7)');

  const scope = window.document.querySelector('#OPEN_ORDERS');
  scope.insertAdjacentHTML('afterbegin', `
    <div role="tab" aria-selected="false">基础单(7)</div>
    <div role="tab" aria-selected="true">条件委托(2)</div>
  `);
  const selectedSubTab = findSelectedOpenOrdersSubTab(scope, { isVisibleElement });
  const subTabIdentity = getOpenOrdersSubTabIdentity(selectedSubTab);
  const replacementSubTab = selectedSubTab.cloneNode(true);
  replacementSubTab.textContent = '条件委托(3)';
  selectedSubTab.replaceWith(replacementSubTab);

  const subTab = findOpenOrdersSubTabByIdentity(scope, subTabIdentity, { isVisibleElement });
  assert.equal(selectedSubTab.isConnected, false);
  assert.notEqual(subTab, selectedSubTab);
  assert.equal(subTab?.textContent.trim(), '条件委托(3)');
});

test("user waits through replacement of the OPEN_ORDERS subtree", async () => {
  // Given native account tabs and order panes are mounted
  const { window } = loadFixtureDom(openOrdersHtml);
  const observationRoot = window.document.querySelector('#account-orders');
  const oldScope = window.document.querySelector('#OPEN_ORDERS');
  const wait = waitForAccountOrdersMutationState(
    observationRoot,
    () => window.document.querySelector('#OPEN_ORDERS[data-ready="true"]'),
    200,
  );

  const replacementScope = oldScope.cloneNode(true);
  replacementScope.dataset.ready = 'true';
  // When the current account and order scope is resolved
  oldScope.replaceWith(replacementScope);

  const resolvedScope = await wait;
  // Then sees that mutation wait survives replacement of the OPEN_ORDERS subtree
  assert.equal(oldScope.isConnected, false);
  assert.equal(resolvedScope, replacementScope);
});

test("user reacts to native row text changes without advancing the mutation deadline", async (t) => {
  // Given native account tabs and order panes are mounted
  const { window } = loadFixtureDom(openOrdersHtml);
  const observationRoot = window.document.querySelector('#account-orders');
  const scope = window.document.querySelector('#OPEN_ORDERS');
  const marker = window.document.createElement('span');
  marker.textContent = 'loading';
  scope.append(marker);
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  const wait = waitForAccountOrdersMutationState(
    observationRoot,
    () => marker.textContent === 'ready' ? marker : null,
    200,
  );

  // When the current account and order scope is resolved
  marker.firstChild.data = 'ready';

  // Then sees that mutation wait reacts when Binance updates row text in place
  assert.equal(await wait, marker);
  assert.equal(Date.now(), 1000);
});

test("user aborts a pending mutation wait with the caller-provided reason", async (t) => {
  // Given native account tabs and order panes are mounted
  const { window } = loadFixtureDom(openOrdersHtml);
  const observationRoot = window.document.querySelector('#account-orders');
  const controller = new AbortController();
  const reason = new Error('ladder stopped');
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  const wait = waitForAccountOrdersMutationState(
    observationRoot,
    () => null,
    5000,
    controller.signal,
  );

  // When the current account and order scope is resolved
  controller.abort(reason);

  // Then sees that mutation wait aborts immediately with the caller-provided reason
  await assert.rejects(wait, (error) => error === reason);
  assert.equal(Date.now(), 1000);
});

test("user sees that account-orders mutation signal wakes once for a relevant subtree change", async () => {
  // Given native account tabs and order panes are mounted
  const { window } = loadFixtureDom(openOrdersHtml);
  const observationRoot = window.document.querySelector('#account-orders');
  const signal = createAccountOrdersMutationSignal(observationRoot);
  const version = signal.version;
  const wait = signal.waitForChange(version, 200);

  // When the current account and order scope is resolved
  window.document.querySelector('#OPEN_ORDERS').classList.add('ready');

  // Then sees that account-orders mutation signal wakes once for a relevant subtree change
  assert.equal(await wait, 'changed');
  assert.ok(signal.version > version);
  signal.dispose();
});

test('user receives an already delivered account mutation without waiting for another event', async () => {
  // Given a real mutation signal and an independent observer watch the mounted account section
  const { window } = loadFixtureDom(openOrdersHtml);
  const root = window.document.querySelector('#account-orders');
  const signal = createAccountOrdersMutationSignal(root);
  const previousVersion = signal.version;
  const delivered = Promise.withResolvers();
  const observer = new window.MutationObserver((mutations) => {
    observer.disconnect();
    delivered.resolve(mutations);
  });
  observer.observe(root, { attributes: true });
  root.classList.add('native-ready');
  const mutations = await delivered.promise;

  // When a consumer starts waiting from the version preceding that delivery
  const result = await signal.waitForChange(previousVersion, 1000);

  // Then the known mutation is reported immediately with one advanced version
  assert.equal(mutations[0].attributeName, 'class');
  assert.equal(result, 'changed');
  assert.equal(signal.version, previousVersion + 1);
  signal.dispose();
});

test('user reaches the account mutation timeout only at its virtual deadline', async (t) => {
  // Given a mounted account section has no pending native changes
  const { window } = loadFixtureDom(openOrdersHtml);
  const signal = createAccountOrdersMutationSignal(window.document.querySelector('#account-orders'));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let result = 'pending';
  const pending = signal.waitForChange(signal.version, 50).then((value) => { result = value; return value; });

  // When the virtual clock advances to just before the deadline
  t.mock.timers.tick(49);
  await Promise.resolve();

  // Then the unchanged account remains pending
  assert.equal(result, 'pending');
  assert.equal(signal.version, 0);

  // When the final millisecond reaches the explicit deadline
  t.mock.timers.tick(1);
  const outcome = await pending;

  // Then the signal resolves once with timeout and no synthetic mutation
  assert.equal(outcome, 'timeout');
  assert.equal(result, 'timeout');
  assert.equal(signal.version, 0);
  signal.dispose();
});

test('user disposes an account mutation wait and disconnects later DOM observations', async () => {
  // Given a consumer is waiting while another observer can verify later DOM delivery
  const { window } = loadFixtureDom(openOrdersHtml);
  const root = window.document.querySelector('#account-orders');
  const signal = createAccountOrdersMutationSignal(root);
  const pending = signal.waitForChange(signal.version, 1000);
  const delivered = Promise.withResolvers();
  const observer = new window.MutationObserver((mutations) => {
    observer.disconnect();
    delivered.resolve(mutations);
  });
  observer.observe(root, { childList: true });

  // When cleanup runs before native page content changes again
  signal.dispose();
  root.append(window.document.createElement('span'));
  const [outcome, mutations] = await Promise.all([pending, delivered.promise]);

  // Then cleanup releases the waiter and later delivered mutations do not increment its version
  assert.equal(outcome, 'disposed');
  assert.equal(mutations[0].addedNodes[0].tagName, 'SPAN');
  assert.equal(signal.version, 0);
});

test('user reads an already available account state without requiring an observation root', async () => {
  // Given the requested native pane is already present in the document
  const { window } = loadFixtureDom(openOrdersHtml);
  const pane = window.document.querySelector('#OPEN_ORDERS');

  // When the state waiter checks the current DOM before installing observation
  const result = await waitForAccountOrdersMutationState(null, () => window.document.querySelector('#OPEN_ORDERS'), 1000);

  // Then the exact current pane is returned despite the absent observer root
  assert.equal(result, pane);
});

test('user gets no mutation state when the observation root is unavailable', async () => {
  // Given the document contains no account order state or observable root
  const { window } = loadFixtureDom('<main></main>');

  // When the signal and state waiter are created without an account root
  const signal = createAccountOrdersMutationSignal(null);
  const result = await waitForAccountOrdersMutationState(null, () => window.document.querySelector('#OPEN_ORDERS'), 1000);

  // Then observation remains unavailable without inventing a state
  assert.equal(signal, null);
  assert.equal(result, null);
});

test('user gets the final absent account state when the virtual mutation deadline expires', async (t) => {
  // Given an observable account section has not mounted the requested ready marker
  const { window } = loadFixtureDom(openOrdersHtml);
  const root = window.document.querySelector('#account-orders');
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  let outcome = 'pending';
  const pending = waitForAccountOrdersMutationState(root, () => root.querySelector('[data-ready]'), 50)
    .then((value) => { outcome = value; return value; });

  // When the deadline has not yet elapsed
  t.mock.timers.tick(49);
  await Promise.resolve();

  // Then the caller still waits for the real account marker
  assert.equal(outcome, 'pending');

  // When the clock reaches the account wait deadline
  t.mock.timers.tick(1);
  const result = await pending;

  // Then a final DOM read returns null at the exact deadline
  assert.equal(result, null);
  assert.equal(outcome, null);
  assert.equal(Date.now(), 1050);
});

test('user rejects a pre-aborted account wait before reading or observing state', async () => {
  // Given cancellation already carries the caller's specific failure reason
  const { window } = loadFixtureDom(openOrdersHtml);
  const controller = new AbortController();
  const reason = new Error('account workflow stopped');
  controller.abort(reason);
  let reads = 0;

  // When the aborted caller requests account state
  const pending = waitForAccountOrdersMutationState(window.document.body, () => {
    reads += 1;
    return window.document.querySelector('#OPEN_ORDERS');
  }, 1000, controller.signal);

  // Then the original reason propagates before the DOM reader is invoked
  await assert.rejects(pending, (error) => error === reason);
  assert.equal(reads, 0);
});

test('user finds visible conditional and selected basic subtabs while ignoring hidden candidates', () => {
  // Given the native pane contains hidden stale tabs and current English subtabs
  const { window } = loadFixtureDom(`
    <section id="orders">
      <div role="tab" data-hidden aria-selected="true">Conditional(9)</div>
      <div role="tab" aria-selected="true">Unrelated</div>
      <div role="tab" aria-selected="true">Basic(2)</div>
      <div role="tab">Conditional(3)</div>
    </section>
  `);
  const root = window.document.querySelector('#orders');

  // When subtab discovery reads the current visible controls
  const conditional = findOpenOrdersConditionalSubTab(root, { isVisibleElement });
  const selected = findSelectedOpenOrdersSubTab(root, { isVisibleElement });
  const basicIdentity = getOpenOrdersSubTabIdentity(selected);

  // Then the visible semantic controls determine selection and stable identity
  assert.equal(conditional.textContent, 'Conditional(3)');
  assert.equal(selected.textContent, 'Basic(2)');
  assert.equal(basicIdentity, 'basic');
});

test('user rejects missing and duplicate subtab identities instead of choosing a stale candidate', () => {
  // Given two visible basic subtabs share an identity and an unrelated selected tab exists
  const { window } = loadFixtureDom(`
    <section><div role="tab">Basic(2)</div><div role="tab">Basic(3)</div>
    <div role="tab" aria-selected="true">Other</div></section>
  `);
  const root = window.document.querySelector('section');
  const unrelated = root.querySelector('[aria-selected="true"]');

  // When semantic resolution sees duplicate, absent, and unsupported subtab identities
  const duplicate = findOpenOrdersSubTabByIdentity(root, 'basic', { isVisibleElement });
  const missingRoot = findOpenOrdersSubTabByIdentity(null, 'basic', { isVisibleElement });
  const missingIdentity = findOpenOrdersSubTabByIdentity(root, null, { isVisibleElement });
  const conditional = findOpenOrdersConditionalSubTab(root, { isVisibleElement });
  const selected = findSelectedOpenOrdersSubTab(root, { isVisibleElement });
  const identity = getOpenOrdersSubTabIdentity(unrelated);

  // Then none of those cases yields a unique supported native subtab
  assert.equal(duplicate, null);
  assert.equal(missingRoot, null);
  assert.equal(missingIdentity, null);
  assert.equal(conditional, null);
  assert.equal(selected, null);
  assert.equal(identity, null);
});

test('user resolves the selected account tab and rejects duplicate semantic account identities', () => {
  // Given the account group has one current-orders selection and two position labels
  const { window } = loadFixtureDom(openOrdersHtml);
  const group = window.document.querySelector('#account-orders .account-tab-group');
  group.insertAdjacentHTML('beforeend', '<div role="tab">仓位(1)</div>');

  // When account selection and the ambiguous position identity are resolved
  const selected = findSelectedAccountOrdersTab(window.document, { isVisibleElement });
  const position = findAccountOrdersTabByIdentity(window.document, '仓位', { isVisibleElement });
  const countTab = findAccountPositionTab(window.document, { isVisibleElement });
  const missingIdentity = findAccountOrdersTabByIdentity(window.document, null, { isVisibleElement });

  // Then the unique selected orders tab survives while duplicate positions remain unresolved
  assert.equal(selected.textContent, '当前委托(2)');
  assert.equal(position, null);
  assert.equal(countTab, null);
  assert.equal(missingIdentity, null);
  assert.equal(getAccountOrdersTabIdentity(null), null);
});

test('user rejects unrelated and detached tabs that do not belong to an account group', () => {
  // Given a page only contains an unrelated tab group and a detached native-looking label
  const { window } = loadFixtureDom('<main><div role="tab">Open Orders</div></main>');
  const unrelated = window.document.querySelector('[role="tab"]');
  const detached = window.document.createElement('div');
  detached.textContent = 'Open Orders';

  // When account ownership and selection are requested for those candidates
  const related = isAccountOrdersTab(unrelated, { isVisibleElement });
  const group = getAccountOrdersTabGroup(detached, { isVisibleElement });
  const selected = findSelectedAccountOrdersTab(window.document, { isVisibleElement });
  const identity = findAccountOrdersTabByIdentity(window.document, 'open orders', { isVisibleElement });

  // Then no unrelated or detached control can become the account's native order scope
  assert.equal(related, false);
  assert.equal(group, null);
  assert.equal(selected, null);
  assert.equal(identity, null);
});

test('user leaves account selection unresolved when no native account tab is selected', () => {
  // Given the semantic account group is mounted between two native selection updates
  const { window } = loadFixtureDom(openOrdersHtml);
  window.document.querySelector('#account-orders [aria-selected="true"]').setAttribute('aria-selected', 'false');

  // When the current selected account tab is read
  const selected = findSelectedAccountOrdersTab(window.document, { isVisibleElement });

  // Then no selection is inferred from the order of available tabs
  assert.equal(selected, null);
});

test('user recognizes an open-order pane from its native filter and basic-order evidence', () => {
  // Given an empty native pane has its filter and basic subtab but no cancel button
  const { window } = loadFixtureDom(openOrdersHtml);
  const pane = window.document.querySelector('#OPEN_ORDERS');
  pane.querySelector('button').remove();
  pane.insertAdjacentHTML('afterbegin', '<div role="tab">基础单(0)</div>');

  // When the active pane is resolved from current native DOM evidence
  const scope = getActiveOpenOrdersScope(window.document, {
    isVisibleElement,
    findHideOtherSymbolCheckbox: (root) => root.querySelector('[name="hideOtherSymbol"]'),
    findCurrentSymbolCancelAllButton: (root) => root.querySelector('button'),
  });

  // Then the filter and basic-order label jointly identify the empty native pane
  assert.equal(scope, pane);
});

test('user ignores a hidden open-order pane even when its native controls remain mounted', () => {
  // Given the selected account tab still has a hidden stale order pane
  const { window } = loadFixtureDom(openOrdersHtml);
  window.document.querySelector('#OPEN_ORDERS').setAttribute('data-hidden', '');

  // When the current open-orders scope is resolved
  const scope = getActiveOpenOrdersScope(window.document, {
    isVisibleElement,
    findHideOtherSymbolCheckbox: (root) => root.querySelector('[name="hideOtherSymbol"]'),
    findCurrentSymbolCancelAllButton: (root) => root.querySelector('button'),
  });

  // Then hidden native controls cannot certify a current order scope
  assert.equal(scope, null);
});
