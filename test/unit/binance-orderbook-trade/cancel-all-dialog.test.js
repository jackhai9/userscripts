import test from 'node:test';
import assert from 'node:assert/strict';

import { isVisibleElement, loadFixtureDom } from '../../helpers/dom.js';
import {
  classifyBinanceCancelAllDialogAction,
  classifyBinanceCancelAllDialogKeyboardAction,
  findBinanceCancelAllDialog,
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
