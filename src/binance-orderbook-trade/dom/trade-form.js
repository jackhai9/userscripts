function buttonTextMatches(button, patterns) {
  const text = (button?.textContent || '').trim().toLowerCase();
  return patterns.some((pattern) => text.includes(pattern));
}

function isOwnPanelButton(button, panelId) {
  return !!button?.closest?.(`#${panelId}`);
}

const CLOSE_QUANTITY_SELECTOR = '[data-testid="max-sell-amount"], [data-testid="max-buy-amount"]';

const TRADE_MODE_LABELS = Object.freeze({
  OPEN: new Set(['开仓', 'open']),
  CLOSE: new Set(['平仓', 'close']),
});

export function parseTradeModeLabel(value) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (TRADE_MODE_LABELS.OPEN.has(normalized)) return 'OPEN';
  if (TRADE_MODE_LABELS.CLOSE.has(normalized)) return 'CLOSE';
  return null;
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
  return buttonTextMatches(button, [
    '开多',
    'open long',
    '开空',
    'open short',
    '平多',
    'close long',
    '平空',
    'close short',
  ]);
}

export function collectTradeButtonsFromScopes(scopes, mode, {
  panelId,
  isVisibleElement,
}) {
  const modePatterns = mode === 'OPEN'
    ? ['开多', 'open long', '开空', 'open short']
    : ['平多', 'close long', '平空', 'close short'];
  const buttons = [];
  const seen = new Set();
  const collectFrom = (scope) => {
    if (!scope) return;
    for (const candidate of scope.querySelectorAll('button')) {
      if (seen.has(candidate) || isOwnPanelButton(candidate, panelId) || !isVisibleElement(candidate)) continue;
      seen.add(candidate);
      if (buttonTextMatches(candidate, modePatterns)) buttons.push(candidate);
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
