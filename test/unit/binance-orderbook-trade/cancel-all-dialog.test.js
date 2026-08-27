import test from 'node:test';
import assert from 'node:assert/strict';

import { isVisibleElement, loadFixtureDom } from '../../helpers/dom.js';
import {
  classifyBinanceCancelAllDialogAction,
  classifyBinanceCancelAllDialogKeyboardAction,
  createDialogMutationSignal,
  findBinanceCancelAllDialog,
  waitForDialogMutationState,
} from '../../../src/binance-orderbook-trade/dom/cancel-all-dialog.js';

function createDialogMarkup({ text = '确定取消全部订单？', extraButton = '' } = {}) {
  return `
    <div class="bn-modal-root">
      <div role="dialog" data-testid="dialog">
        <div class="bn-modal-title">${text}</div>
        <button class="bn-button">取消</button>
        <button class="bn-button bn-button__primary"><span>确认</span></button>
        ${extraButton}
      </div>
    </div>
  `;
}

test('finds one semantic Binance cancel-all action pair through nested modal wrappers', () => {
  const dom = loadFixtureDom(createDialogMarkup());
  const contract = findBinanceCancelAllDialog(dom.window.document, isVisibleElement);

  assert.equal(contract.dialog.getAttribute('data-testid'), 'dialog');
  assert.equal(contract.cancelButton.textContent.trim(), '取消');
  assert.equal(contract.confirmButton.textContent.trim(), '确认');
});

test('finds the verified English cancel-all dialog contract', () => {
  const dom = loadFixtureDom(createDialogMarkup({ text: 'Cancel all orders?' }));
  const contract = findBinanceCancelAllDialog(dom.window.document, isVisibleElement);

  assert.equal(contract.dialog.getAttribute('data-testid'), 'dialog');
  assert.equal(contract.confirmButton.classList.contains('bn-button__primary'), true);
});

test('classifies nested confirm targets and the secondary cancel button', () => {
  const dom = loadFixtureDom(createDialogMarkup());
  const contract = findBinanceCancelAllDialog(dom.window.document, isVisibleElement);

  assert.equal(
    classifyBinanceCancelAllDialogAction(contract, contract.confirmButton.querySelector('span')),
    'confirmed',
  );
  assert.equal(
    classifyBinanceCancelAllDialogAction(contract, contract.cancelButton),
    'cancelled',
  );
  assert.equal(
    classifyBinanceCancelAllDialogAction(contract, dom.window.document.body),
    null,
  );
});

test('classifies keyboard decisions including default Enter confirmation without button focus', () => {
  const dom = loadFixtureDom(createDialogMarkup());
  const contract = findBinanceCancelAllDialog(dom.window.document, isVisibleElement);

  assert.equal(
    classifyBinanceCancelAllDialogKeyboardAction(contract, 'Enter', dom.window.document.body),
    'confirmed',
  );
  assert.equal(
    classifyBinanceCancelAllDialogKeyboardAction(contract, 'Enter', contract.cancelButton),
    'cancelled',
  );
  assert.equal(
    classifyBinanceCancelAllDialogKeyboardAction(contract, 'Escape', dom.window.document.body),
    'cancelled',
  );
});

test('ignores unrelated dialogs and rejects invalid cancel-all button contracts', () => {
  const unrelatedDom = loadFixtureDom(createDialogMarkup({ text: '调整保证金' }));
  assert.equal(
    findBinanceCancelAllDialog(unrelatedDom.window.document, isVisibleElement),
    null,
  );

  const extraButtonDom = loadFixtureDom(createDialogMarkup({
    extraButton: '<button class="bn-button">Help</button>',
  }));
  assert.throws(
    () => findBinanceCancelAllDialog(extraButtonDom.window.document, isVisibleElement),
    /Expected two Binance cancel-all dialog buttons, found 3/,
  );
});

test('rejects multiple semantic cancel-all dialogs with distinct action pairs', () => {
  const dom = loadFixtureDom(`${createDialogMarkup()}${createDialogMarkup()}`);
  assert.throws(
    () => findBinanceCancelAllDialog(dom.window.document, isVisibleElement),
    /Expected one Binance cancel-all dialog action pair, found 2/,
  );
});

test('dialog mutation signal ignores unrelated DOM churn and reports dialog insertion', async () => {
  const dom = loadFixtureDom('<main id="app"></main>');
  const { document } = dom.window;
  const signal = createDialogMutationSignal(document);
  const initialVersion = signal.version;

  document.querySelector('#app').append(document.createElement('span'));
  await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  assert.equal(signal.version, initialVersion);

  document.body.insertAdjacentHTML('beforeend', createDialogMarkup());
  await signal.waitForChange(initialVersion, 100);
  assert.ok(signal.version > initialVersion);
  signal.dispose();
});

test('dialog mutation state resolves when React removes the dialog wrapper', async () => {
  const dom = loadFixtureDom(createDialogMarkup());
  const { document } = dom.window;
  const dialog = document.querySelector('[role="dialog"]');
  const pending = waitForDialogMutationState(
    document,
    () => (!dialog.isConnected ? 'closed' : null),
    100,
  );

  dialog.parentElement.remove();

  assert.equal(await pending, 'closed');
});

test('dialog mutation state aborts immediately with the caller-provided reason', async () => {
  const dom = loadFixtureDom(createDialogMarkup());
  const { document } = dom.window;
  const controller = new AbortController();
  const reason = new Error('ladder stopped');
  const startedAt = Date.now();
  const pending = waitForDialogMutationState(
    document,
    () => null,
    5000,
    controller.signal,
  );

  controller.abort(reason);

  await assert.rejects(pending, (error) => error === reason);
  assert.ok(Date.now() - startedAt < 100, 'abort should not wait for the dialog deadline');
});
