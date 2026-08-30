import test from 'node:test';
import assert from 'node:assert/strict';

import { loadFixtureDom } from '../../helpers/dom.js';
import {
  showUsdtRebalanceDialog,
  USDT_REBALANCE_DIALOG_ID,
} from '../../../src/binance-orderbook-trade/dom/usdt-rebalance-dialog.js';

function createDialogDocument() {
  const dom = loadFixtureDom('<!doctype html><html><head></head><body></body></html>');
  const { window } = dom;
  window.HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  window.HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
    this.dispatchEvent(new window.Event('close'));
  };
  return dom;
}

function createDialogModel() {
  return {
    title: 'Account Rebalance',
    targetSummary: 'Target allocation: Funding 50% / Spot 40% / USDⓈ-M Futures 10%',
    accountHeading: 'Account',
    currentHeading: 'Current (USDT)',
    targetHeading: 'Target (USDT)',
    transferHeading: 'Transfer Plan',
    balanceRows: [
      { account: 'Funding', current: '20.00', target: '50.00' },
      { account: 'Spot', current: '70.00', target: '40.00' },
      { account: 'USDⓈ-M Futures', current: '10.00', target: '10.00' },
    ],
    transferRows: [
      { route: 'Spot → Funding', amount: '30.00 USDT' },
    ],
    question: 'Confirm 1 transfer?',
    cancelLabel: 'Cancel',
    confirmLabel: 'Confirm Rebalance',
  };
}

test('USDT rebalance dialog renders the plan and focuses the safe action', async () => {
  const dom = createDialogDocument();
  const { document } = dom.window;
  const result = showUsdtRebalanceDialog(document, createDialogModel());
  const dialog = document.getElementById(USDT_REBALANCE_DIALOG_ID);

  assert.equal(dialog.tagName, 'DIALOG');
  assert.equal(dialog.open, true);
  assert.equal(dialog.getAttribute('aria-labelledby'), `${USDT_REBALANCE_DIALOG_ID}-title`);
  assert.equal(document.getElementById(`${USDT_REBALANCE_DIALOG_ID}-title`).textContent, 'Account Rebalance');
  assert.match(dialog.textContent, /Target allocation: Funding 50%/);
  assert.match(dialog.textContent, /Spot → Funding/);
  assert.match(dialog.textContent, /30\.00 USDT/);
  assert.equal(dialog.querySelectorAll('[role="columnheader"]').length, 3);
  assert.equal(dialog.querySelectorAll('[role="cell"]').length, 9);
  assert.equal(document.activeElement.dataset.rebalanceDialogAction, 'cancel');
  assert.equal(document.querySelectorAll('#jh-binance-usdt-rebalance-dialog-style').length, 1);

  dialog.querySelector('[data-rebalance-dialog-action="cancel"]').click();
  assert.equal(await result, false);
  assert.equal(document.getElementById(USDT_REBALANCE_DIALOG_ID), null);
});

test('USDT rebalance dialog resolves true only from the confirm action', async () => {
  const dom = createDialogDocument();
  const { document } = dom.window;
  const result = showUsdtRebalanceDialog(document, createDialogModel());

  document.querySelector('[data-rebalance-dialog-action="confirm"]').click();

  assert.equal(await result, true);
  assert.equal(document.getElementById(USDT_REBALANCE_DIALOG_ID), null);
});

test('USDT rebalance dialog treats Escape as cancellation', async () => {
  const dom = createDialogDocument();
  const { document } = dom.window;
  const result = showUsdtRebalanceDialog(document, createDialogModel());
  const dialog = document.getElementById(USDT_REBALANCE_DIALOG_ID);
  const event = new dom.window.Event('cancel', { cancelable: true });

  dialog.dispatchEvent(event);

  assert.equal(event.defaultPrevented, true);
  assert.equal(await result, false);
  assert.equal(document.getElementById(USDT_REBALANCE_DIALOG_ID), null);
});

test('USDT rebalance dialog rejects concurrent dialogs', async () => {
  const dom = createDialogDocument();
  const { document } = dom.window;
  const firstResult = showUsdtRebalanceDialog(document, createDialogModel());

  assert.throws(
    () => showUsdtRebalanceDialog(document, createDialogModel()),
    /USDT rebalance dialog is already open/,
  );

  document.querySelector('[data-rebalance-dialog-action="cancel"]').click();
  assert.equal(await firstResult, false);
});
