export const USDT_REBALANCE_DIALOG_ID = 'jh-binance-usdt-rebalance-dialog';

const STYLE_ID = 'jh-binance-usdt-rebalance-dialog-style';

function assertText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Invalid USDT rebalance dialog ${field}`);
  }
}

function assertModel(model) {
  if (!model || !Array.isArray(model.balanceRows) || !Array.isArray(model.transferRows)) {
    throw new Error('Invalid USDT rebalance dialog model');
  }
  for (const field of [
    'title',
    'targetSummary',
    'accountHeading',
    'currentHeading',
    'targetHeading',
    'transferHeading',
    'question',
    'cancelLabel',
    'confirmLabel',
  ]) {
    assertText(model[field], field);
  }
  for (const row of model.balanceRows) {
    assertText(row?.account, 'balance account');
    assertText(row?.current, 'current balance');
    assertText(row?.target, 'target balance');
  }
  if (model.transferRows.length === 0) {
    throw new Error('USDT rebalance dialog requires at least one transfer');
  }
  for (const row of model.transferRows) {
    assertText(row?.route, 'transfer route');
    assertText(row?.amount, 'transfer amount');
  }
}

function appendTextElement(document, parent, tagName, className, text) {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  parent.appendChild(element);
  return element;
}

function installDialogStyle(document) {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${USDT_REBALANCE_DIALOG_ID} {
      box-sizing: border-box;
      width: min(440px, calc(100vw - 32px));
      max-height: calc(100vh - 32px);
      margin: auto;
      padding: 0;
      overflow: hidden;
      border: 1px solid var(--color-InputLine, #eaecef);
      border-radius: 12px;
      background: var(--color-BasicBg, #fff);
      color: var(--color-PrimaryText, #1e2329);
      box-shadow: 0 8px 32px rgba(0, 0, 0, .18);
      font-family: BinancePlex, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 14px;
      line-height: 20px;
    }
    #${USDT_REBALANCE_DIALOG_ID}::backdrop {
      background: rgba(0, 0, 0, .48);
    }
    #${USDT_REBALANCE_DIALOG_ID} .jh-rebalance-dialog-header {
      padding: 20px 24px 12px;
      font-size: 20px;
      font-weight: 600;
      line-height: 28px;
    }
    #${USDT_REBALANCE_DIALOG_ID} .jh-rebalance-dialog-body {
      max-height: calc(100vh - 190px);
      padding: 0 24px;
      overflow: auto;
    }
    #${USDT_REBALANCE_DIALOG_ID} .jh-rebalance-dialog-summary {
      margin-bottom: 16px;
      color: var(--color-SecondaryText, #474d57);
    }
    #${USDT_REBALANCE_DIALOG_ID} .jh-rebalance-dialog-table {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(92px, auto) minmax(92px, auto);
      gap: 0;
      overflow: hidden;
      border: 1px solid var(--color-InputLine, #eaecef);
      border-radius: 8px;
    }
    #${USDT_REBALANCE_DIALOG_ID} .jh-rebalance-dialog-cell {
      min-width: 0;
      padding: 9px 10px;
      overflow: hidden;
      border-bottom: 1px solid var(--color-InputLine, #eaecef);
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    #${USDT_REBALANCE_DIALOG_ID} .jh-rebalance-dialog-cell:nth-last-child(-n + 3) {
      border-bottom: 0;
    }
    #${USDT_REBALANCE_DIALOG_ID} .jh-rebalance-dialog-cell--heading {
      background: var(--color-InputBg, #f5f5f5);
      color: var(--color-TertiaryText, #707a8a);
      font-size: 12px;
      font-weight: 500;
    }
    #${USDT_REBALANCE_DIALOG_ID} .jh-rebalance-dialog-cell--number {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    #${USDT_REBALANCE_DIALOG_ID} .jh-rebalance-dialog-section-title {
      margin: 18px 0 8px;
      font-weight: 500;
    }
    #${USDT_REBALANCE_DIALOG_ID} .jh-rebalance-dialog-transfer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 8px 0;
      border-bottom: 1px solid var(--color-InputLine, #eaecef);
    }
    #${USDT_REBALANCE_DIALOG_ID} .jh-rebalance-dialog-transfer:last-child {
      border-bottom: 0;
    }
    #${USDT_REBALANCE_DIALOG_ID} .jh-rebalance-dialog-transfer-amount {
      flex: 0 0 auto;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
    }
    #${USDT_REBALANCE_DIALOG_ID} .jh-rebalance-dialog-question {
      margin-top: 14px;
      color: var(--color-SecondaryText, #474d57);
    }
    #${USDT_REBALANCE_DIALOG_ID} .jh-rebalance-dialog-footer {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      padding: 20px 24px 24px;
    }
    #${USDT_REBALANCE_DIALOG_ID} .jh-rebalance-dialog-button {
      height: 40px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
    }
    #${USDT_REBALANCE_DIALOG_ID} .jh-rebalance-dialog-button--cancel {
      border: 1px solid var(--color-InputLine, #d8dce1);
      background: var(--color-BasicBg, #fff);
      color: var(--color-PrimaryText, #1e2329);
    }
    #${USDT_REBALANCE_DIALOG_ID} .jh-rebalance-dialog-button--confirm {
      border: 1px solid var(--color-PrimaryYellow, #f0b90b);
      background: var(--color-PrimaryYellow, #f0b90b);
      color: var(--color-TextOnYellow, #202630);
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

export function showUsdtRebalanceDialog(document, model) {
  assertModel(model);
  if (document.getElementById(USDT_REBALANCE_DIALOG_ID)) {
    throw new Error('USDT rebalance dialog is already open');
  }
  installDialogStyle(document);

  const dialog = document.createElement('dialog');
  dialog.id = USDT_REBALANCE_DIALOG_ID;
  dialog.setAttribute('aria-labelledby', `${USDT_REBALANCE_DIALOG_ID}-title`);

  const title = appendTextElement(
    document,
    dialog,
    'div',
    'jh-rebalance-dialog-header',
    model.title,
  );
  title.id = `${USDT_REBALANCE_DIALOG_ID}-title`;

  const body = document.createElement('div');
  body.className = 'jh-rebalance-dialog-body';
  dialog.appendChild(body);
  appendTextElement(
    document,
    body,
    'div',
    'jh-rebalance-dialog-summary',
    model.targetSummary,
  );

  const table = document.createElement('div');
  table.className = 'jh-rebalance-dialog-table';
  table.setAttribute('role', 'table');
  body.appendChild(table);
  for (const heading of [model.accountHeading, model.currentHeading, model.targetHeading]) {
    appendTextElement(
      document,
      table,
      'div',
      'jh-rebalance-dialog-cell jh-rebalance-dialog-cell--heading',
      heading,
    ).setAttribute('role', 'columnheader');
  }
  for (const row of model.balanceRows) {
    appendTextElement(document, table, 'div', 'jh-rebalance-dialog-cell', row.account)
      .setAttribute('role', 'cell');
    appendTextElement(
      document,
      table,
      'div',
      'jh-rebalance-dialog-cell jh-rebalance-dialog-cell--number',
      row.current,
    ).setAttribute('role', 'cell');
    appendTextElement(
      document,
      table,
      'div',
      'jh-rebalance-dialog-cell jh-rebalance-dialog-cell--number',
      row.target,
    ).setAttribute('role', 'cell');
  }

  appendTextElement(
    document,
    body,
    'div',
    'jh-rebalance-dialog-section-title',
    model.transferHeading,
  );
  const transfers = document.createElement('div');
  body.appendChild(transfers);
  for (const row of model.transferRows) {
    const transfer = document.createElement('div');
    transfer.className = 'jh-rebalance-dialog-transfer';
    appendTextElement(document, transfer, 'span', 'jh-rebalance-dialog-transfer-route', row.route);
    appendTextElement(
      document,
      transfer,
      'span',
      'jh-rebalance-dialog-transfer-amount',
      row.amount,
    );
    transfers.appendChild(transfer);
  }
  appendTextElement(
    document,
    body,
    'div',
    'jh-rebalance-dialog-question',
    model.question,
  );

  const footer = document.createElement('div');
  footer.className = 'jh-rebalance-dialog-footer';
  dialog.appendChild(footer);
  const cancelButton = appendTextElement(
    document,
    footer,
    'button',
    'jh-rebalance-dialog-button jh-rebalance-dialog-button--cancel',
    model.cancelLabel,
  );
  cancelButton.type = 'button';
  cancelButton.dataset.rebalanceDialogAction = 'cancel';
  const confirmButton = appendTextElement(
    document,
    footer,
    'button',
    'jh-rebalance-dialog-button jh-rebalance-dialog-button--confirm',
    model.confirmLabel,
  );
  confirmButton.type = 'button';
  confirmButton.dataset.rebalanceDialogAction = 'confirm';

  document.body.appendChild(dialog);
  dialog.showModal();
  cancelButton.focus();

  return new Promise((resolve) => {
    let settled = false;
    const finish = (confirmed) => {
      if (settled) return;
      settled = true;
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(confirmed);
    };
    cancelButton.addEventListener('click', () => finish(false));
    confirmButton.addEventListener('click', () => finish(true));
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(false);
    });
    dialog.addEventListener('close', () => finish(false));
  });
}
