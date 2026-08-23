const DIALOG_CANDIDATE_SELECTOR =
  '[role="dialog"], [class*="modal"], [class*="Modal"]';
const CANCEL_ALL_DIALOG_TEXT_PATTERN = /(?:确定取消全部订单|Cancel all orders)/i;
const PRIMARY_BUTTON_SELECTOR = 'button.bn-button.bn-button__primary';

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function getDialogContract(dialog, isVisibleElement) {
  if (!isVisibleElement(dialog)) return null;
  if (!CANCEL_ALL_DIALOG_TEXT_PATTERN.test(normalizeText(dialog.textContent))) return null;

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
  const contracts = Array.from(document.querySelectorAll(DIALOG_CANDIDATE_SELECTOR))
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
