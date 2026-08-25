import {
  isOpenOrdersTabText,
  normalizeText,
} from '../core/cancel-orders.js';

function getNormalizedText(el) {
  return normalizeText(el?.textContent || '');
}

function getTabIdentity(el) {
  return getNormalizedText(el).replace(/\s*\(\d+\)$/, '').toLocaleLowerCase();
}

export function waitForAccountOrdersMutationState(observationRoot, readState, timeoutMs) {
  const currentState = readState();
  if (currentState) return Promise.resolve(currentState);
  const MutationObserverClass = observationRoot?.ownerDocument?.defaultView?.MutationObserver;
  if (!observationRoot || !MutationObserverClass) return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timer);
      resolve(value);
    };
    const check = () => {
      const value = readState();
      if (value) finish(value);
    };
    const observer = new MutationObserverClass(check);
    const timer = setTimeout(() => finish(readState()), timeoutMs);
    observer.observe(observationRoot, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-selected', 'aria-checked', 'class', 'style'],
    });
    check();
  });
}

function hasAccountOrdersTabs(node, isVisibleElement) {
  const tabTexts = Array.from(node.querySelectorAll('[role="tab"]'))
    .filter(isVisibleElement)
    .map(getNormalizedText)
    .join(' ');
  return (
    /(仓位|Positions)/i.test(tabTexts) &&
    /(当前\s*委托|Open Orders)/i.test(tabTexts) &&
    /(历史委托|Order History|历史成交|Trade History|资金流水|Transaction)/i.test(tabTexts)
  );
}

function containsNestedAccountOrdersGroupOutsideTab(node, tab, isVisibleElement) {
  return Array.from(node.children).some((child) => (
    !child.contains(tab) && hasAccountOrdersTabs(child, isVisibleElement)
  ));
}

function hasOpenOrdersPanelText(node) {
  return /(基础单|条件委托|Open Orders|成交数量|只减仓|只做Maker|生效时间|追单)/i
    .test(getNormalizedText(node));
}

function hasOpenOrdersPanelEvidence(node, {
  findHideOtherSymbolCheckbox,
  findCurrentSymbolCancelAllButton,
}) {
  if (findCurrentSymbolCancelAllButton(node)) return true;
  return Boolean(findHideOtherSymbolCheckbox(node) && hasOpenOrdersPanelText(node));
}

function isOpenOrdersBasicSubTabText(text) {
  return /^(基础单|Basic Orders?)(?:\(|\s|$)/i.test(normalizeText(text));
}

function isOpenOrdersConditionalSubTabText(text) {
  return /^(条件委托|Conditional Orders?)(?:\(|\s|$)/i.test(normalizeText(text));
}

function isAccountPositionTabText(text) {
  return /^(仓位|Positions)(?:\s*\(\d+\))?$/i.test(normalizeText(text));
}

export function parseAccountPositionTabCount(text) {
  const match = normalizeText(text).match(/^(?:仓位|Positions)\s*\((\d+)\)$/i);
  return match ? Number(match[1]) : null;
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
