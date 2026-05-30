import {
  isOpenOrdersTabText,
  normalizeText,
} from '../core/cancel-orders.js';

function getNormalizedText(el) {
  return normalizeText(el?.textContent || '');
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
  return tabs.find((tab) => isAccountOrdersTab(tab, { isVisibleElement })) || tabs[0] || null;
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

  const doc = root.ownerDocument || root;
  const paneId = tab.getAttribute('aria-controls');
  const pane = paneId ? doc.getElementById(paneId) : null;
  if (
    pane &&
    isVisibleElement(pane) &&
    hasOpenOrdersPanelEvidence(pane, {
      findHideOtherSymbolCheckbox,
      findCurrentSymbolCancelAllButton,
    })
  ) {
    return pane;
  }

  let node = tab.parentElement;
  let depth = 0;
  while (node && node !== doc.body && depth < 8) {
    if (
      hasOpenOrdersPanelEvidence(node, {
        findHideOtherSymbolCheckbox,
        findCurrentSymbolCancelAllButton,
      })
    ) {
      return node;
    }
    node = node.parentElement;
    depth += 1;
  }
  return null;
}
