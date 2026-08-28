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
const TRADE_MODE_TAB_SELECTOR = [
  '#position-direction [role="tab"][aria-selected="true"]',
  '.bn-tabs__buySell [role="tab"][aria-selected="true"]',
  '[role="tab"].bn-tab__buySell[aria-selected="true"]',
].join(',');
const TRADE_QTY_INPUT_SELECTOR = [
  'input[id^="unitAmount-"]',
  'input[aria-label="数量"]',
  'input[placeholder="数量"]',
].join(',');
const TRADE_PRICE_INPUT_SELECTOR = [
  'input[id^="limitPrice-"]',
  'input[aria-label="委托价格"]',
  'input[placeholder="委托价格"]',
].join(',');

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

/**
 * Resolve one coherent pair of live controlled inputs from the visible trade form.
 * Binance can leave hidden or replaced form nodes in the document during React
 * transitions, so global first-match selectors are not a safe submission contract.
 */
export function findActiveTradeInputs(ownerDocument, {
  panelId,
  isVisibleElement,
  requirePrice = true,
}) {
  if (!ownerDocument?.querySelectorAll || typeof isVisibleElement !== 'function') return null;

  const activeTabs = Array.from(ownerDocument.querySelectorAll(TRADE_MODE_TAB_SELECTOR))
    .filter((tab) => !tab.closest(`#${panelId}`) && isVisibleElement(tab));
  const qtyInputs = Array.from(ownerDocument.querySelectorAll(TRADE_QTY_INPUT_SELECTOR))
    .filter((input) => !input.closest(`#${panelId}`) && isVisibleElement(input));
  const matches = [];

  for (const activeTab of activeTabs) {
    for (const qtyInput of qtyInputs) {
      const root = findTradeFormRoot(activeTab, qtyInput);
      if (!root) continue;
      const priceInputs = Array.from(root.querySelectorAll(TRADE_PRICE_INPUT_SELECTOR))
        .filter((input) => !input.closest(`#${panelId}`) && isVisibleElement(input));
      if (priceInputs.length > 1 || (requirePrice && priceInputs.length !== 1)) continue;
      matches.push({ root, activeTab, priceInput: priceInputs[0] || null, qtyInput });
    }
  }

  return matches.length === 1 ? matches[0] : null;
}

export function createBoundedInputWriter({ writeValue, maxWriteAttempts }) {
  if (typeof writeValue !== 'function') {
    throw new Error('Bounded input writer dependency is invalid');
  }
  if (!Number.isInteger(maxWriteAttempts) || maxWriteAttempts < 1) {
    throw new Error('Trade input write attempts must be a positive integer');
  }

  const attemptsByInput = new WeakMap();
  return (input, value) => {
    const attempts = attemptsByInput.get(input) || 0;
    if (attempts >= maxWriteAttempts) return false;
    attemptsByInput.set(input, attempts + 1);
    writeValue(input, value);
    return true;
  };
}

export function isScriptOwnedTradeInputRecoveryState({
  preWriteValue,
  rollbackValue,
  submittedValue,
  previousSubmittedValue,
  compareValues,
}) {
  if (typeof compareValues !== 'function') {
    throw new Error('Trade input recovery comparison dependency is invalid');
  }

  const isScriptOwnedOrEmpty = (value) => (
    value === null
    || (
      previousSubmittedValue != null
      && compareValues(previousSubmittedValue, value) === 0
    )
  );

  return (
    isScriptOwnedOrEmpty(preWriteValue)
    && isScriptOwnedOrEmpty(rollbackValue)
    && isScriptOwnedOrEmpty(submittedValue)
  );
}

/**
 * Synchronize each live React input identity with a bounded post-transition budget.
 * Binance can synchronously restore a controlled input while a replacement form is
 * settling. A caller may preserve the pre-write value as a provisional rollback
 * contract because React can restore it after the write returns but before the
 * first frame observation. Recovery policy owns the accepted state transition;
 * generic callers retain exact rollback matching while ladder callers may identify
 * a previous acknowledged script-owned value or Binance's empty post-submit state.
 */
export function createTradeInputStateReader({
  resolveInputs,
  expectedPrice,
  expectedQty,
  includePrice,
  normalizeValue,
  compareValues,
  writeValue,
  requiredStableMismatchFrames = 2,
  requiredStableMatchFrames = 1,
  maxWriteAttempts = 2,
  recoverProvisionalMatchRollback = false,
  isRecoveryWriteAllowed = ({ rollbackValue, submittedValue }) => (
    rollbackValue === submittedValue
  ),
}) {
  if (
    typeof resolveInputs !== 'function'
    || typeof normalizeValue !== 'function'
    || typeof compareValues !== 'function'
    || typeof writeValue !== 'function'
    || typeof isRecoveryWriteAllowed !== 'function'
  ) {
    throw new Error('Trade input synchronizer dependencies are invalid');
  }
  if (
    !Number.isInteger(requiredStableMismatchFrames)
    || requiredStableMismatchFrames < 1
  ) {
    throw new Error('Trade input rollback stability must be a positive integer');
  }
  if (!Number.isInteger(requiredStableMatchFrames) || requiredStableMatchFrames < 1) {
    throw new Error('Trade input accepted stability must be a positive integer');
  }
  if (!Number.isInteger(maxWriteAttempts) || maxWriteAttempts < 1) {
    throw new Error('Trade input write attempts must be a positive integer');
  }
  if (typeof recoverProvisionalMatchRollback !== 'boolean') {
    throw new Error('Provisional trade input recovery flag must be boolean');
  }

  const createSyncSlot = (field) => {
    let root = null;
    let input = null;
    let writeCount = 0;
    let preWriteValue = null;
    let rollbackValue = null;
    let recoveryEligible = false;
    let stableRollbackFrames = 0;
    let stableMatchFrames = 0;

    const clearRecovery = () => {
      preWriteValue = null;
      rollbackValue = null;
      recoveryEligible = false;
      stableRollbackFrames = 0;
    };

    const writeExpectedValue = (currentInput, expectedValue, submittedValue) => {
      preWriteValue = submittedValue;
      const wrote = writeValue(currentInput, expectedValue);
      if (wrote === false) {
        writeCount = maxWriteAttempts;
        clearRecovery();
        stableMatchFrames = 0;
        return;
      }
      writeCount += 1;
      const postWriteValue = normalizeValue(currentInput.value);
      const rejected = compareValues(expectedValue, postWriteValue) !== 0;
      recoveryEligible = (
        writeCount < maxWriteAttempts
        && (rejected || recoverProvisionalMatchRollback)
      );
      rollbackValue = rejected ? postWriteValue : submittedValue;
      stableRollbackFrames = 0;
      stableMatchFrames = 0;
    };

    return ({
      currentRoot,
      currentInput,
      expectedValue,
      submittedValue,
      matchesExpected,
    }) => {
      if (root !== currentRoot || input !== currentInput) {
        root = currentRoot;
        input = currentInput;
        writeCount = 0;
        clearRecovery();
        stableMatchFrames = 0;
      }

      if (matchesExpected) {
        recoveryEligible = false;
        stableRollbackFrames = 0;
        stableMatchFrames += 1;
        return stableMatchFrames >= requiredStableMatchFrames;
      }

      if (stableMatchFrames > 0) {
        stableMatchFrames = 0;
        recoveryEligible = writeCount < maxWriteAttempts;
        stableRollbackFrames = 0;
        if (!recoveryEligible) clearRecovery();
      }

      if (writeCount === 0) {
        writeExpectedValue(currentInput, expectedValue, submittedValue);
        return false;
      }
      if (writeCount >= maxWriteAttempts || !recoveryEligible) return false;

      if (!isRecoveryWriteAllowed({
        field,
        currentRoot,
        currentInput,
        expectedValue,
        preWriteValue,
        rollbackValue,
        submittedValue,
        writeCount,
      })) {
        clearRecovery();
        return false;
      }

      stableRollbackFrames += 1;
      if (stableRollbackFrames < requiredStableMismatchFrames) return false;

      writeExpectedValue(currentInput, expectedValue, submittedValue);
      return false;
    };
  };

  const syncQty = createSyncSlot('qty');
  const syncPrice = createSyncSlot('price');
  return () => {
    const inputs = resolveInputs();
    if (!inputs?.qtyInput || (includePrice && !inputs.priceInput)) return null;

    const submittedQty = normalizeValue(inputs.qtyInput.value);
    const qtyMatches = compareValues(expectedQty, submittedQty) === 0;
    const qtyStable = syncQty({
      currentRoot: inputs.root,
      currentInput: inputs.qtyInput,
      expectedValue: expectedQty,
      submittedValue: submittedQty,
      matchesExpected: qtyMatches,
    });
    if (!qtyMatches || !qtyStable) return null;

    if (!includePrice) {
      return { ...inputs, submittedQty };
    }

    const submittedPrice = normalizeValue(inputs.priceInput.value);
    const priceMatches = compareValues(expectedPrice, submittedPrice) === 0;
    const priceStable = syncPrice({
      currentRoot: inputs.root,
      currentInput: inputs.priceInput,
      expectedValue: expectedPrice,
      submittedValue: submittedPrice,
      matchesExpected: priceMatches,
    });
    if (!priceMatches || !priceStable) return null;

    return { ...inputs, submittedPrice, submittedQty };
  };
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

/**
 * Confirm property-based controlled-input state across consecutive paint frames.
 * MutationObserver cannot observe React restoring an input's value property, so
 * trade submission must read the current live inputs after React has settled.
 */
export function waitForTradeFormFrameState(
  observationRoot,
  readState,
  timeoutMs,
  requiredStableFrames = 2,
) {
  const view = observationRoot?.ownerDocument?.defaultView;
  if (
    !view
    || typeof view.requestAnimationFrame !== 'function'
    || typeof view.cancelAnimationFrame !== 'function'
  ) {
    throw new Error('Trade form frame scheduler is unavailable');
  }
  if (!Number.isInteger(requiredStableFrames) || requiredStableFrames < 1) {
    throw new Error('requiredStableFrames must be a positive integer');
  }

  return new Promise((resolve) => {
    let settled = false;
    let frameHandle = 0;
    let timer = 0;
    let stableFrames = 0;
    let stableState = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (frameHandle) view.cancelAnimationFrame(frameHandle);
      view.clearTimeout(timer);
      resolve(value);
    };
    const check = () => {
      frameHandle = 0;
      const state = readState();
      if (state) {
        stableFrames += 1;
        stableState = state;
        if (stableFrames >= requiredStableFrames) {
          finish(stableState);
          return;
        }
      } else {
        stableFrames = 0;
        stableState = null;
      }
      frameHandle = view.requestAnimationFrame(check);
    };
    timer = view.setTimeout(() => finish(null), timeoutMs);
    frameHandle = view.requestAnimationFrame(check);
  });
}

/**
 * Binance can mark the requested trade mode active before React replaces the
 * native action buttons. Require one live button identity to remain actionable
 * across consecutive paint frames so callers never click the outgoing node.
 */
export function waitForTradeActionButtonFrameState(
  observationRoot,
  findButton,
  isVisibleElement,
  timeoutMs,
  requiredStableFrames = 2,
) {
  const view = observationRoot?.ownerDocument?.defaultView || observationRoot?.defaultView;
  if (
    !view
    || typeof view.requestAnimationFrame !== 'function'
    || typeof view.cancelAnimationFrame !== 'function'
  ) {
    throw new Error('Trade action button frame scheduler is unavailable');
  }
  if (typeof findButton !== 'function' || typeof isVisibleElement !== 'function') {
    throw new Error('Trade action button resolver is unavailable');
  }
  if (!Number.isInteger(requiredStableFrames) || requiredStableFrames < 1) {
    throw new Error('requiredStableFrames must be a positive integer');
  }

  return new Promise((resolve) => {
    let settled = false;
    let frameHandle = 0;
    let timer = 0;
    let stableFrames = 0;
    let stableButton = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (frameHandle) view.cancelAnimationFrame(frameHandle);
      view.clearTimeout(timer);
      resolve(value);
    };
    const check = () => {
      frameHandle = 0;
      const button = findButton();
      const actionable = Boolean(
        button
        && button.isConnected
        && isVisibleElement(button)
        && !button.disabled
        && button.getAttribute('aria-disabled') !== 'true'
      );
      if (actionable) {
        if (button === stableButton) {
          stableFrames += 1;
        } else {
          stableButton = button;
          stableFrames = 1;
        }
        if (stableFrames >= requiredStableFrames) {
          finish(button);
          return;
        }
      } else {
        stableButton = null;
        stableFrames = 0;
      }
      frameHandle = view.requestAnimationFrame(check);
    };
    timer = view.setTimeout(() => finish(null), timeoutMs);
    frameHandle = view.requestAnimationFrame(check);
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
