import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAccountOrdersMutationSignal,
  findAccountOrdersTabByIdentity,
  findAccountPositionTab,
  findOpenOrdersBasicSubTab,
  findOpenOrdersSubTabByIdentity,
  findOpenOrdersTab,
  findSelectedOpenOrdersSubTab,
  getAccountOrdersTabIdentity,
  getActiveOpenOrdersScope,
  getOpenOrdersSubTabIdentity,
  parseAccountPositionTabCount,
  waitForAccountOrdersMutationState,
} from '../../../src/binance-orderbook-trade/dom/account-orders.js';
import { isVisibleElement, loadFixtureDom } from '../../helpers/dom.js';

const openOrdersHtml = await readFile(new URL('../../fixtures/binance-orderbook-trade/account-orders-open-orders.html', import.meta.url), 'utf8');
const positionHtml = await readFile(new URL('../../fixtures/binance-orderbook-trade/account-orders-position.html', import.meta.url), 'utf8');

test('selects the bottom account-orders open-orders tab over unrelated tab groups', () => {
  const { window } = loadFixtureDom(openOrdersHtml);
  const tab = findOpenOrdersTab(window.document, { isVisibleElement });

  assert.equal(tab?.textContent.trim(), '当前委托(2)');
  assert.equal(tab?.closest('#account-orders') != null, true);
});

test('reads a confirmed zero position count from the unique account tab group', () => {
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

  const tab = findAccountPositionTab(window.document, { isVisibleElement });

  assert.equal(tab?.textContent.trim(), '仓位(0)');
  assert.equal(parseAccountPositionTabCount(tab?.textContent), 0);
  assert.equal(parseAccountPositionTabCount('Positions (12)'), 12);
  assert.equal(parseAccountPositionTabCount('仓位'), null);
});

test('rejects position counts when account tab groups are ambiguous', () => {
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

  assert.equal(findAccountPositionTab(window.document, { isVisibleElement }), null);
});

test('does not trust aria-controls alone when resolving current-orders pane', () => {
  const { window } = loadFixtureDom(openOrdersHtml);
  const scope = getActiveOpenOrdersScope(window.document, {
    isVisibleElement,
    findHideOtherSymbolCheckbox: (root) => root.querySelector('[role="checkbox"][name="hideOtherSymbol"]'),
    findCurrentSymbolCancelAllButton: (root) => Array.from(root.querySelectorAll('button')).find((button) => button.textContent.trim() === '全撤') || null,
  });

  assert.equal(scope?.id, 'OPEN_ORDERS');
  assert.equal(scope.querySelector('#wrong-pane'), null);
});

test('rejects ambiguous visible OPEN_ORDERS panes', () => {
  const { window } = loadFixtureDom(`${openOrdersHtml}<div id="OPEN_ORDERS"><button>全撤</button></div>`);
  const scope = getActiveOpenOrdersScope(window.document, {
    isVisibleElement,
    findHideOtherSymbolCheckbox: (root) => root.querySelector('[role="checkbox"][name="hideOtherSymbol"]'),
    findCurrentSymbolCancelAllButton: (root) => Array.from(root.querySelectorAll('button')).find((button) => button.textContent.trim() === '全撤') || null,
  });

  assert.equal(scope, null);
});

test('returns no active open-orders scope when current-orders tab is not active', () => {
  const { window } = loadFixtureDom(positionHtml);
  const scope = getActiveOpenOrdersScope(window.document, {
    isVisibleElement,
    findHideOtherSymbolCheckbox: (root) => root.querySelector('[role="checkbox"][name="hideOtherSymbol"]'),
    findCurrentSymbolCancelAllButton: (root) => Array.from(root.querySelectorAll('button')).find((button) => button.textContent.trim() === '全撤') || null,
  });

  assert.equal(scope, null);
});

test('does not treat stale position content as active open-orders scope', () => {
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
  const scope = getActiveOpenOrdersScope(window.document, {
    isVisibleElement,
    findHideOtherSymbolCheckbox: (root) => root.querySelector('[role="checkbox"][name="hideOtherSymbol"]'),
    findCurrentSymbolCancelAllButton: (root) => Array.from(root.querySelectorAll('button')).find((button) => button.textContent.trim() === '全撤') || null,
  });

  assert.equal(scope, null);
});

test('finds basic open-orders sub tab when conditional sub tab is selected', () => {
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
  const selectedSubTab = findSelectedOpenOrdersSubTab(scope, { isVisibleElement });

  assert.equal(basicTab?.textContent.trim(), '基础单(5)');
  assert.equal(selectedSubTab?.textContent.trim(), '条件委托(0)');
});

test('finds the verified English Basic and Conditional labels with live counts', () => {
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
  const scope = getActiveOpenOrdersScope(window.document, {
    isVisibleElement,
    findHideOtherSymbolCheckbox: (root) => root.querySelector('[role="checkbox"][name="hideOtherSymbol"]'),
    findCurrentSymbolCancelAllButton: (root) => Array.from(root.querySelectorAll('button'))
      .find((button) => button.textContent.trim() === 'Cancel All') || null,
  });

  assert.equal(
    findOpenOrdersBasicSubTab(scope, { isVisibleElement })?.textContent.trim(),
    'Basic(31)',
  );
  assert.equal(
    findSelectedOpenOrdersSubTab(scope, { isVisibleElement })?.textContent.trim(),
    'Conditional(0)',
  );
});

test('reacquires account and open-orders tabs by semantic identity after rerender', () => {
  const { window } = loadFixtureDom(openOrdersHtml);
  const selectedAccountTab = window.document.querySelector('#account-orders [role="tab"][aria-selected="true"]');
  const accountIdentity = getAccountOrdersTabIdentity(selectedAccountTab);
  const replacementAccountTab = selectedAccountTab.cloneNode(true);
  replacementAccountTab.textContent = '当前委托(7)';
  selectedAccountTab.replaceWith(replacementAccountTab);

  const accountTab = findAccountOrdersTabByIdentity(window.document, accountIdentity, { isVisibleElement });
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

test('mutation wait survives replacement of the OPEN_ORDERS subtree', async () => {
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
  oldScope.replaceWith(replacementScope);

  const resolvedScope = await wait;
  assert.equal(oldScope.isConnected, false);
  assert.equal(resolvedScope, replacementScope);
});

test('mutation wait reacts when Binance updates row text in place', async () => {
  const { window } = loadFixtureDom(openOrdersHtml);
  const observationRoot = window.document.querySelector('#account-orders');
  const scope = window.document.querySelector('#OPEN_ORDERS');
  const marker = window.document.createElement('span');
  marker.textContent = 'loading';
  scope.append(marker);
  const wait = waitForAccountOrdersMutationState(
    observationRoot,
    () => marker.textContent === 'ready' ? marker : null,
    200,
  );
  const startedAt = Date.now();

  marker.firstChild.data = 'ready';

  assert.equal(await wait, marker);
  assert.ok(Date.now() - startedAt < 100, 'characterData should resolve through the observer, not timeout');
});

test('mutation wait aborts immediately with the caller-provided reason', async () => {
  const { window } = loadFixtureDom(openOrdersHtml);
  const observationRoot = window.document.querySelector('#account-orders');
  const controller = new AbortController();
  const reason = new Error('ladder stopped');
  const startedAt = Date.now();
  const wait = waitForAccountOrdersMutationState(
    observationRoot,
    () => null,
    5000,
    controller.signal,
  );

  controller.abort(reason);

  await assert.rejects(wait, (error) => error === reason);
  assert.ok(Date.now() - startedAt < 100, 'abort should not wait for the mutation deadline');
});

test('account-orders mutation signal wakes once for a relevant subtree change', async () => {
  const { window } = loadFixtureDom(openOrdersHtml);
  const observationRoot = window.document.querySelector('#account-orders');
  const signal = createAccountOrdersMutationSignal(observationRoot);
  const version = signal.version;
  const wait = signal.waitForChange(version, 200);

  window.document.querySelector('#OPEN_ORDERS').classList.add('ready');

  assert.equal(await wait, 'changed');
  assert.ok(signal.version > version);
  signal.dispose();
});
