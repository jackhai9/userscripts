import {
  BINANCE_PAGE_TEXT,
  includesBinancePageText,
  matchesBinancePageText,
} from '../contracts/binance-page-text.js';

function buttonTextMatches(button, labels) {
  return includesBinancePageText(button?.textContent, labels);
}

function isOwnPanelButton(button, panelId) {
  return !!button?.closest?.(`#${panelId}`);
}

const CLOSE_QUANTITY_SELECTOR = '[data-testid="max-sell-amount"], [data-testid="max-buy-amount"]';

export function parseTradeModeLabel(value) {
  if (matchesBinancePageText(value, BINANCE_PAGE_TEXT.tradeMode.OPEN)) return 'OPEN';
  if (matchesBinancePageText(value, BINANCE_PAGE_TEXT.tradeMode.CLOSE)) return 'CLOSE';
  return null;
}

export function readTradeAvailableBalance(root, { isVisibleElement }) {
  if (!root?.querySelectorAll || typeof isVisibleElement !== 'function') return null;
  const candidates = Array.from(root.querySelectorAll('span'))
    .filter((label) => (
      isVisibleElement(label)
      && matchesBinancePageText(label.textContent, BINANCE_PAGE_TEXT.availableBalance)
    ))
    .map((label) => {
      const valueNodes = Array.from(label.parentElement?.children || [])
        .filter((node) => node !== label && isVisibleElement(node));
      if (valueNodes.length !== 1) return null;
      const match = /^([\d,]+(?:\.\d+)?)\s+([A-Z0-9]+)$/.exec(
        String(valueNodes[0].textContent || '').replace(/\s+/g, ' ').trim(),
      );
      return match ? { amount: match[1].replace(/,/g, ''), asset: match[2] } : null;
    })
    .filter(Boolean);
  return candidates.length === 1 ? candidates[0] : null;
}

function isCloseQuantityNode(node) {
  const element = node?.nodeType === 1 ? node : node?.parentElement;
  if (!element) return false;
  return element.matches?.(CLOSE_QUANTITY_SELECTOR)
    || !!element.closest?.(CLOSE_QUANTITY_SELECTOR)
    || !!element.querySelector?.(CLOSE_QUANTITY_SELECTOR);
}

export function mutationTouchesCloseQuantity(mutation) {
  if (!mutation) return false;
  if (mutation.type === 'characterData') return isCloseQuantityNode(mutation.target);
  if (mutation.type !== 'childList') return false;
  if (isCloseQuantityNode(mutation.target)) return true;
  return Array.from(mutation.addedNodes || []).some(isCloseQuantityNode);
}

/**
 * Resolve the live trade form without trusting Binance's duplicated tab-pane IDs.
 * React keeps the mode tabs and quantity input under one stable form owner even
 * when it replaces the active pane's descendants during an OPEN/CLOSE switch.
 */
export function findTradeFormRoot(activeTab, qtyInput) {
  if (!activeTab?.isConnected || !qtyInput?.isConnected) return null;
  if (activeTab.ownerDocument !== qtyInput.ownerDocument) return null;

  const ownerDocument = activeTab.ownerDocument;
  let candidate = qtyInput.parentElement;
  while (
    candidate
    && candidate !== ownerDocument.body
    && candidate !== ownerDocument.documentElement
  ) {
    if (candidate.contains(activeTab)) return candidate;
    candidate = candidate.parentElement;
  }
  return null;
}

export function findTradePanelInsertionPoint(root) {
  const modeTabs = root?.querySelector?.('#position-direction');
  if (!modeTabs) return null;

  const modeAndOrderTypeColumn = modeTabs.parentElement;
  const modeAndOrderTypeRow = modeAndOrderTypeColumn?.parentElement;
  const tradeHeader = modeAndOrderTypeRow?.parentElement;
  const ownerDocument = modeTabs.ownerDocument;
  const tradeModes = new Set(
    Array.from(modeTabs.querySelectorAll('[role="tab"]'))
      .map((tab) => parseTradeModeLabel(tab.textContent))
      .filter(Boolean),
  );

  if (
    !modeAndOrderTypeColumn
    || !modeAndOrderTypeRow
    || !tradeHeader
    || modeAndOrderTypeRow === ownerDocument?.body
    || tradeHeader === ownerDocument?.documentElement
    || modeAndOrderTypeRow.firstElementChild !== modeAndOrderTypeColumn
    || modeAndOrderTypeRow.children.length !== 1
    || tradeHeader.firstElementChild === modeAndOrderTypeRow
    || !tradeModes.has('OPEN')
    || !tradeModes.has('CLOSE')
  ) {
    return null;
  }

  return {
    parent: tradeHeader,
    before: modeAndOrderTypeRow,
  };
}

export function placeTradePanelSpacer(spacer, insertionPoint) {
  const { parent, before } = insertionPoint || {};
  if (!spacer || !parent || !before || before.parentElement !== parent) return false;
  if (spacer.parentElement !== parent || spacer.nextElementSibling !== before) {
    parent.insertBefore(spacer, before);
  }
  return true;
}

export function calculateFloatingPanelLayout({
  anchorRect,
  panelHeight,
  viewportWidth,
  viewportHeight,
  minimumWidth = 280,
  margin = 8,
}) {
  if (!anchorRect?.width || !anchorRect?.height) return null;

  const width = Math.min(
    Math.max(anchorRect.width, minimumWidth),
    viewportWidth - margin * 2,
  );
  const estimatedHeight = Math.max(panelHeight, 76);
  const left = Math.max(
    margin,
    Math.min(anchorRect.left, viewportWidth - width - margin),
  );
  const top = Math.max(
    margin,
    Math.min(anchorRect.top, viewportHeight - estimatedHeight - margin),
  );

  return {
    width: Math.round(width),
    left: Math.round(left),
    top: Math.round(top),
  };
}

export function waitForTradeFormMutationState(observationRoot, readState, timeoutMs) {
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
      characterData: true,
      attributes: true,
      attributeFilter: ['aria-selected', 'class'],
    });
    check();
  });
}

export function isTradeModeTab(node, { panelId }) {
  if (!node?.matches?.('[role="tab"]')) return false;
  if (node.closest(`#${panelId}`)) return false;
  if (
    !node.matches('#position-direction [role="tab"], .bn-tabs__buySell [role="tab"], [role="tab"].bn-tab__buySell')
  ) {
    return false;
  }
  return parseTradeModeLabel(node.textContent) !== null;
}

export function isTradeActionButton(node, { panelId }) {
  if (!node?.matches) return false;
  const button = node.matches('button') ? node : node.closest('button');
  if (!button || isOwnPanelButton(button, panelId)) return false;
  return Object.values(BINANCE_PAGE_TEXT.tradeAction)
    .some((labels) => buttonTextMatches(button, labels));
}

export function collectTradeButtonsFromScopes(scopes, mode, {
  panelId,
  isVisibleElement,
}) {
  const modeLabels = mode === 'OPEN'
    ? [BINANCE_PAGE_TEXT.tradeAction.OPEN_LONG, BINANCE_PAGE_TEXT.tradeAction.OPEN_SHORT]
    : [BINANCE_PAGE_TEXT.tradeAction.CLOSE_LONG, BINANCE_PAGE_TEXT.tradeAction.CLOSE_SHORT];
  const buttons = [];
  const seen = new Set();
  const collectFrom = (scope) => {
    if (!scope) return;
    for (const candidate of scope.querySelectorAll('button')) {
      if (seen.has(candidate) || isOwnPanelButton(candidate, panelId) || !isVisibleElement(candidate)) continue;
      seen.add(candidate);
      if (modeLabels.some((labels) => buttonTextMatches(candidate, labels))) buttons.push(candidate);
    }
  };

  for (const scope of scopes) collectFrom(scope);
  return buttons;
}

export function parseLeverageButtonText(text) {
  const match = String(text || '').trim().match(/^(\d{1,3})\s*[xX]$/);
  if (!match) return null;
  const leverage = Number(match[1]);
  return leverage >= 1 && leverage <= 125 ? leverage : null;
}

export function findCurrentLeverageButtonFromScopes(scopes, {
  panelId,
  isVisibleElement,
}) {
  const buttons = [];
  const seen = new Set();
  for (const scope of scopes) {
    if (!scope) continue;
    for (const button of scope.querySelectorAll('button')) {
      if (
        seen.has(button)
        || isOwnPanelButton(button, panelId)
        || !isVisibleElement(button)
      ) {
        continue;
      }
      seen.add(button);
      if (parseLeverageButtonText(button.textContent) != null) buttons.push(button);
    }
  }
  return buttons.length === 1 ? buttons[0] : null;
}
