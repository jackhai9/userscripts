import {
  isOpenOrdersTabText,
  normalizeText,
} from '../core/cancel-orders.js';
import {
  BINANCE_PAGE_TEXT,
  includesBinancePageText,
  matchesBinancePageText,
  parseBinanceTabCount,
  startsWithBinancePageText,
} from '../contracts/binance-page-text.js';
import {
  throwIfAborted,
  waitForPromiseOrAbort,
} from '../../shared/abort.js';

function getNormalizedText(el) {
  return normalizeText(el?.textContent || '');
}

function getTabIdentity(el) {
  return getNormalizedText(el).replace(/\s*\(\d+\)$/, '').toLocaleLowerCase();
}

export function createAccountOrdersMutationSignal(observationRoot) {
  const MutationObserverClass = observationRoot?.ownerDocument?.defaultView?.MutationObserver;
  if (!observationRoot || !MutationObserverClass) return null;

  let version = 0;
  let pendingFinish = null;
  const notify = () => {
    version += 1;
    pendingFinish?.('changed');
  };
  const observer = new MutationObserverClass(notify);
  observer.observe(observationRoot, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['aria-selected', 'aria-checked', 'class', 'style'],
  });

  return {
    get version() {
      return version;
    },
    waitForChange(afterVersion, timeoutMs) {
      if (version !== afterVersion) return Promise.resolve('changed');
      return new Promise((resolve) => {
        let timer = null;
        const finish = (result) => {
          if (pendingFinish !== finish) return;
          pendingFinish = null;
          if (timer) clearTimeout(timer);
          resolve(result);
        };
        pendingFinish = finish;
        timer = setTimeout(() => finish('timeout'), timeoutMs);
      });
    },
    dispose() {
      observer.disconnect();
      pendingFinish?.('disposed');
    },
  };
}

export async function waitForAccountOrdersMutationState(
  observationRoot,
  readState,
  timeoutMs,
  abortSignal = null,
) {
  throwIfAborted(abortSignal);
  const currentState = readState();
  if (currentState) return currentState;
  const signal = createAccountOrdersMutationSignal(observationRoot);
  if (!signal) return null;
  const deadline = Date.now() + timeoutMs;

  try {
    while (true) {
      throwIfAborted(abortSignal);
      const version = signal.version;
      const state = readState();
      if (state) return state;
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) return readState();
      await waitForPromiseOrAbort(
        signal.waitForChange(version, remainingMs),
        abortSignal,
      );
    }
  } finally {
    signal.dispose();
  }
}

function hasAccountOrdersTabs(node, isVisibleElement) {
  const tabTexts = Array.from(node.querySelectorAll('[role="tab"]'))
    .filter(isVisibleElement)
    .map(getNormalizedText)
    .join(' ');
  return (
    includesBinancePageText(tabTexts, BINANCE_PAGE_TEXT.accountOrders.positionTab) &&
    includesBinancePageText(tabTexts, BINANCE_PAGE_TEXT.accountOrders.openOrdersTab) &&
    includesBinancePageText(tabTexts, BINANCE_PAGE_TEXT.accountOrders.historyTab)
  );
}

function containsNestedAccountOrdersGroupOutsideTab(node, tab, isVisibleElement) {
  return Array.from(node.children).some((child) => (
    !child.contains(tab) && hasAccountOrdersTabs(child, isVisibleElement)
  ));
}

function hasOpenOrdersPanelText(node) {
  return includesBinancePageText(
    getNormalizedText(node),
    BINANCE_PAGE_TEXT.accountOrders.panelEvidence,
  );
}

function hasOpenOrdersPanelEvidence(node, {
  findHideOtherSymbolCheckbox,
  findCurrentSymbolCancelAllButton,
}) {
  if (findCurrentSymbolCancelAllButton(node)) return true;
  return Boolean(findHideOtherSymbolCheckbox(node) && hasOpenOrdersPanelText(node));
}

function isOpenOrdersBasicSubTabText(text) {
  return startsWithBinancePageText(text, BINANCE_PAGE_TEXT.accountOrders.basicSubTab);
}

function isOpenOrdersConditionalSubTabText(text) {
  return startsWithBinancePageText(text, BINANCE_PAGE_TEXT.accountOrders.conditionalSubTab);
}

function isAccountPositionTabText(text) {
  return matchesBinancePageText(text, BINANCE_PAGE_TEXT.accountOrders.positionTab)
    || parseBinanceTabCount(text, BINANCE_PAGE_TEXT.accountOrders.positionTab) !== null;
}

export function parseAccountPositionTabCount(text) {
  return parseBinanceTabCount(text, BINANCE_PAGE_TEXT.accountOrders.positionTab);
}

export function findOpenOrdersBasicSubTab(root, { isVisibleElement }) {
  return Array.from(root.querySelectorAll('[role="tab"]'))
    .find((tab) => isVisibleElement(tab) && isOpenOrdersBasicSubTabText(getNormalizedText(tab))) || null;
}

export function findOpenOrdersConditionalSubTab(root, { isVisibleElement }) {
  return Array.from(root.querySelectorAll('[role="tab"]'))
    .find((tab) => isVisibleElement(tab) && isOpenOrdersConditionalSubTabText(getNormalizedText(tab))) || null;
}

export function findSelectedOpenOrdersSubTab(root, { isVisibleElement }) {
  return Array.from(root.querySelectorAll('[role="tab"][aria-selected="true"]'))
    .find((tab) => (
      isVisibleElement(tab) &&
      (
        isOpenOrdersBasicSubTabText(getNormalizedText(tab)) ||
        isOpenOrdersConditionalSubTabText(getNormalizedText(tab))
      )
    )) || null;
}

export function getOpenOrdersSubTabIdentity(tab) {
  const text = getNormalizedText(tab);
  if (!isOpenOrdersBasicSubTabText(text) && !isOpenOrdersConditionalSubTabText(text)) return null;
  return getTabIdentity(tab);
}

export function findOpenOrdersSubTabByIdentity(root, identity, { isVisibleElement }) {
  if (!root || !identity) return null;
  const tabs = Array.from(root.querySelectorAll('[role="tab"]'))
    .filter((tab) => (
      isVisibleElement(tab) &&
      getOpenOrdersSubTabIdentity(tab) === identity
    ));
  return tabs.length === 1 ? tabs[0] : null;
}

export function isAccountOrdersTab(tab, { isVisibleElement }) {
  let node = tab.parentElement;
  let depth = 0;
  while (node && node !== tab.ownerDocument.body && depth < 5) {
    if (
      hasAccountOrdersTabs(node, isVisibleElement) &&
      !containsNestedAccountOrdersGroupOutsideTab(node, tab, isVisibleElement)
    ) {
      return true;
    }
    node = node.parentElement;
    depth += 1;
  }
  return false;
}

export function getAccountOrdersTabGroup(tab, { isVisibleElement }) {
  let node = tab?.parentElement;
  let depth = 0;
  while (node && node !== tab.ownerDocument.body && depth < 5) {
    if (
      hasAccountOrdersTabs(node, isVisibleElement) &&
      !containsNestedAccountOrdersGroupOutsideTab(node, tab, isVisibleElement)
    ) {
      return node;
    }
    node = node.parentElement;
    depth += 1;
  }
  return null;
}

export function findOpenOrdersTab(root, { isVisibleElement }) {
  const tabs = Array.from(root.querySelectorAll('[role="tab"]'))
    .filter((tab) => isVisibleElement(tab) && isOpenOrdersTabText(getNormalizedText(tab)));
  const accountTabs = tabs.filter((tab) => isAccountOrdersTab(tab, { isVisibleElement }));
  return accountTabs.length === 1 ? accountTabs[0] : null;
}

export function getAccountOrdersTabIdentity(tab) {
  return tab ? getTabIdentity(tab) : null;
}

export function findAccountOrdersTabByIdentity(root, identity, { isVisibleElement }) {
  if (!identity) return null;
  const openOrdersTab = findOpenOrdersTab(root, { isVisibleElement });
  if (!openOrdersTab) return null;
  const tabGroup = getAccountOrdersTabGroup(openOrdersTab, { isVisibleElement });
  if (!tabGroup) return null;
  const tabs = Array.from(tabGroup.querySelectorAll('[role="tab"]'))
    .filter((tab) => isVisibleElement(tab) && getAccountOrdersTabIdentity(tab) === identity);
  return tabs.length === 1 ? tabs[0] : null;
}

export function findAccountPositionTab(root, { isVisibleElement }) {
  const accountGroups = new Set();
  for (const tab of root.querySelectorAll('[role="tab"]')) {
    if (!isVisibleElement(tab) || !isOpenOrdersTabText(getNormalizedText(tab))) continue;
    const group = getAccountOrdersTabGroup(tab, { isVisibleElement });
    if (group) accountGroups.add(group);
  }
  if (accountGroups.size !== 1) return null;

  const [group] = accountGroups;
  const positionTabs = Array.from(group.querySelectorAll('[role="tab"]'))
    .filter((tab) => isVisibleElement(tab) && isAccountPositionTabText(getNormalizedText(tab)));
  return positionTabs.length === 1 ? positionTabs[0] : null;
}

export function findSelectedAccountOrdersTab(root, { isVisibleElement }) {
  const openOrdersTab = findOpenOrdersTab(root, { isVisibleElement });
  if (!openOrdersTab) return null;
  const tabGroup = getAccountOrdersTabGroup(openOrdersTab, { isVisibleElement });
  if (!tabGroup) return null;
  return Array.from(tabGroup.querySelectorAll('[role="tab"][aria-selected="true"]'))
    .filter(isVisibleElement)[0] || null;
}

export function getActiveOpenOrdersScope(root, {
  isVisibleElement,
  findHideOtherSymbolCheckbox,
  findCurrentSymbolCancelAllButton,
}) {
  const tab = findOpenOrdersTab(root, { isVisibleElement });
  if (!tab || tab.getAttribute('aria-selected') !== 'true') return null;

  const scopes = Array.from(root.querySelectorAll('[id="OPEN_ORDERS"]'))
    .filter((scope) => (
      isVisibleElement(scope) &&
      hasOpenOrdersPanelEvidence(scope, {
      findHideOtherSymbolCheckbox,
      findCurrentSymbolCancelAllButton,
      })
    ));
  return scopes.length === 1 ? scopes[0] : null;
}
