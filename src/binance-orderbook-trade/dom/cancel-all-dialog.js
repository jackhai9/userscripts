import {
  BINANCE_PAGE_TEXT,
  includesBinancePageText,
} from '../contracts/binance-page-text.js';
import {
  throwIfAborted,
  waitForPromiseOrAbort,
} from '../core/abort.js';

const CANCEL_ALL_DIALOG_CANDIDATE_SELECTOR =
  '[role="dialog"], [class*="modal"], [class*="Modal"]';
const DIALOG_MUTATION_CANDIDATE_SELECTOR = [
  CANCEL_ALL_DIALOG_CANDIDATE_SELECTOR,
  '[class*="popover"]',
  '[class*="Popover"]',
  '[class*="drawer"]',
  '[class*="Drawer"]',
].join(', ');
const PRIMARY_BUTTON_SELECTOR = 'button.bn-button.bn-button__primary';

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function getDialogContract(dialog, isVisibleElement) {
  if (!isVisibleElement(dialog)) return null;
  if (!includesBinancePageText(
    normalizeText(dialog.textContent),
    BINANCE_PAGE_TEXT.cancelAllDialog,
  )) return null;

  const buttons = Array.from(dialog.querySelectorAll('button')).filter(isVisibleElement);
  if (!buttons.length) return null;
  if (buttons.length !== 2) {
    throw new Error(`Expected two Binance cancel-all dialog buttons, found ${buttons.length}`);
  }
  const primaryButtons = buttons.filter((button) => button.matches(PRIMARY_BUTTON_SELECTOR));
  if (primaryButtons.length !== 1) {
    throw new Error(`Expected one Binance cancel-all primary button, found ${primaryButtons.length}`);
  }
  const confirmButton = primaryButtons[0];
  const cancelButton = buttons.find((button) => button !== confirmButton);
  return { dialog, confirmButton, cancelButton };
}

export function findBinanceCancelAllDialog(document, isVisibleElement) {
  const contracts = Array.from(document.querySelectorAll(CANCEL_ALL_DIALOG_CANDIDATE_SELECTOR))
    .map((dialog) => getDialogContract(dialog, isVisibleElement))
    .filter(Boolean);
  if (!contracts.length) return null;

  const actionPairs = [];
  for (const contract of contracts) {
    const existing = actionPairs.find((candidate) => (
      candidate.confirmButton === contract.confirmButton
      && candidate.cancelButton === contract.cancelButton
    ));
    if (!existing) actionPairs.push(contract);
  }
  if (actionPairs.length !== 1) {
    throw new Error(`Expected one Binance cancel-all dialog action pair, found ${actionPairs.length}`);
  }

  return contracts.reduce((innermost, contract) => (
    innermost.dialog.contains(contract.dialog) ? contract : innermost
  ));
}

function elementTouchesDialogCandidate(node) {
  const element = node?.nodeType === 1 ? node : node?.parentElement;
  if (!element) return false;
  return element.matches?.(DIALOG_MUTATION_CANDIDATE_SELECTOR)
    || !!element.closest?.(DIALOG_MUTATION_CANDIDATE_SELECTOR)
    || !!element.querySelector?.(DIALOG_MUTATION_CANDIDATE_SELECTOR);
}

export function mutationTouchesDialogCandidate(mutation) {
  if (!mutation) return false;
  if (mutation.type === 'attributes') return elementTouchesDialogCandidate(mutation.target);
  if (mutation.type !== 'childList') return false;
  if (elementTouchesDialogCandidate(mutation.target)) return true;
  return [...mutation.addedNodes, ...mutation.removedNodes]
    .some(elementTouchesDialogCandidate);
}

export function createDialogMutationSignal(document) {
  const MutationObserverClass = document?.defaultView?.MutationObserver;
  if (!document?.body || !MutationObserverClass) return null;

  let version = 0;
  let pendingFinish = null;
  const notify = () => {
    version += 1;
    pendingFinish?.('changed');
  };
  const observer = new MutationObserverClass((mutations) => {
    if (mutations.some(mutationTouchesDialogCandidate)) notify();
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'role', 'aria-hidden', 'hidden'],
  });

  return {
    get version() {
      return version;
    },
    notify,
    waitForChange(afterVersion, timeoutMs = null) {
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
        if (timeoutMs !== null) timer = setTimeout(() => finish('timeout'), timeoutMs);
      });
    },
    dispose() {
      observer.disconnect();
      pendingFinish?.('disposed');
    },
  };
}

export async function waitForDialogMutationState(
  document,
  readState,
  timeoutMs,
  abortSignal = null,
) {
  throwIfAborted(abortSignal);
  const currentState = readState();
  if (currentState) return currentState;
  const signal = createDialogMutationSignal(document);
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

export function classifyBinanceCancelAllDialogAction(contract, eventTarget) {
  const button = eventTarget?.closest?.('button');
  if (!button || !contract.dialog.contains(button)) return null;
  if (button === contract.confirmButton) return 'confirmed';
  if (button === contract.cancelButton) return 'cancelled';
  return null;
}

export function classifyBinanceCancelAllDialogKeyboardAction(contract, key, activeElement) {
  if (key === 'Escape') return 'cancelled';
  if (key === 'Enter') {
    return classifyBinanceCancelAllDialogAction(contract, activeElement) || 'confirmed';
  }
  if (key === ' ') return classifyBinanceCancelAllDialogAction(contract, activeElement);
  return null;
}
