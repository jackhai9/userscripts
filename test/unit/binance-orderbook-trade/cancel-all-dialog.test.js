import { captureThrownError } from '../../helpers/orderbook-migration-errors.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import { isVisibleElement, loadFixtureDom } from '../../helpers/dom.js';
import {
  classifyBinanceCancelAllDialogAction,
  classifyBinanceCancelAllDialogKeyboardAction,
  createDialogMutationSignal,
  findBinanceCancelAllDialog,
  mutationTouchesDialogCandidate,
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

test("user finds one semantic Binance cancel-all action pair through nested modal wrappers", () => {
  // Given the native cancellation dialog and caller state are available
  const dom = loadFixtureDom(createDialogMarkup());
  // When the dialog action or lifecycle event is observed
  const contract = findBinanceCancelAllDialog(dom.window.document, isVisibleElement);

  // Then finds one semantic Binance cancel-all action pair through nested modal wrappers
  assert.equal(contract.dialog.getAttribute('data-testid'), 'dialog');
  assert.equal(contract.cancelButton.textContent.trim(), '取消');
  assert.equal(contract.confirmButton.textContent.trim(), '确认');
});

test("user finds the verified English cancel-all dialog contract", () => {
  // Given the native cancellation dialog and caller state are available
  const dom = loadFixtureDom(createDialogMarkup({ text: 'Cancel all orders?' }));
  // When the dialog action or lifecycle event is observed
  const contract = findBinanceCancelAllDialog(dom.window.document, isVisibleElement);

  // Then finds the verified English cancel-all dialog contract
  assert.equal(contract.dialog.getAttribute('data-testid'), 'dialog');
  assert.equal(contract.confirmButton.classList.contains('bn-button__primary'), true);
});

test("user sees that classifies nested confirm targets and the secondary cancel button", () => {
  // Given the native cancellation dialog and caller state are available
  const dom = loadFixtureDom(createDialogMarkup());
  // When the dialog action or lifecycle event is observed
  const contract = findBinanceCancelAllDialog(dom.window.document, isVisibleElement);

  // Then sees that classifies nested confirm targets and the secondary cancel button
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

test("user sees that classifies keyboard decisions including default Enter confirmation without button focus", () => {
  // Given the native cancellation dialog and caller state are available
  const dom = loadFixtureDom(createDialogMarkup());
  // When the dialog action or lifecycle event is observed
  const contract = findBinanceCancelAllDialog(dom.window.document, isVisibleElement);

  // Then sees that classifies keyboard decisions including default Enter confirmation without button focus
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

test("user ignores unrelated dialogs and rejects invalid cancel-all button contracts", () => {
  // Given the native cancellation dialog and caller state are available
  const unrelatedDom = loadFixtureDom(createDialogMarkup({ text: '调整保证金' }));
  // When the dialog action or lifecycle event is observed
  const observed = findBinanceCancelAllDialog(unrelatedDom.window.document, isVisibleElement);

  // Then ignores unrelated dialogs and rejects invalid cancel-all button contracts
  assert.equal(
    observed,
    null,
  );

  const extraButtonDom = loadFixtureDom(createDialogMarkup({
    extraButton: '<button class="bn-button">Help</button>',
  }));
  assert.throws(
    () => findBinanceCancelAllDialog(extraButtonDom.window.document, isVisibleElement),
    /撤单确认弹窗按钮数量异常：3/,
  );
});

test("user rejects multiple semantic cancel-all dialogs with distinct action pairs", () => {
  // Given the native cancellation dialog and caller state are available
  const dom = loadFixtureDom(`${createDialogMarkup()}${createDialogMarkup()}`);
  // When the dialog action or lifecycle event is observed
  const observedFailure = captureThrownError(() => findBinanceCancelAllDialog(dom.window.document, isVisibleElement));

  // Then rejects multiple semantic cancel-all dialogs with distinct action pairs
  assert.match(observedFailure.message, /撤单确认弹窗操作区域数量异常：2/);
});

test("user sees that dialog mutation signal ignores unrelated DOM churn and reports dialog insertion", async () => {
  // Given the native cancellation dialog and caller state are available
  const dom = loadFixtureDom('<main id="app"></main>');
  const { document } = dom.window;
  const signal = createDialogMutationSignal(document);
  const initialVersion = signal.version;
  const delivered = Promise.withResolvers();
  const unrelatedObserver = new dom.window.MutationObserver((mutations) => {
    unrelatedObserver.disconnect();
    delivered.resolve(mutations);
  });
  unrelatedObserver.observe(document.querySelector('#app'), { childList: true });

  // When the dialog action or lifecycle event is observed
  document.querySelector('#app').append(document.createElement('span'));
  const unrelatedMutations = await delivered.promise;
  // Then sees that dialog mutation signal ignores unrelated DOM churn and reports dialog insertion
  assert.equal(unrelatedMutations.length, 1);
  assert.equal(unrelatedMutations[0].addedNodes[0].tagName, 'SPAN');
  assert.equal(signal.version, initialVersion);

  document.body.insertAdjacentHTML('beforeend', createDialogMarkup());
  await signal.waitForChange(initialVersion, 100);
  assert.ok(signal.version > initialVersion);
  signal.dispose();
});

test("user sees that dialog mutation state resolves when React removes the dialog wrapper", async () => {
  // Given the native cancellation dialog and caller state are available
  const dom = loadFixtureDom(createDialogMarkup());
  const { document } = dom.window;
  const dialog = document.querySelector('[role="dialog"]');
  const pending = waitForDialogMutationState(
    document,
    () => (!dialog.isConnected ? 'closed' : null),
    100,
  );

  // When the dialog action or lifecycle event is observed
  dialog.parentElement.remove();

  // Then sees that dialog mutation state resolves when React removes the dialog wrapper
  assert.equal(await pending, 'closed');
});

test("user aborts dialog mutation state with the caller-provided reason before its deadline", async (t) => {
  // Given the native cancellation dialog and caller state are available
  const dom = loadFixtureDom(createDialogMarkup());
  const { document } = dom.window;
  const controller = new AbortController();
  const reason = new Error('ladder stopped');
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  const pending = waitForDialogMutationState(
    document,
    () => null,
    5000,
    controller.signal,
  );

  // When the dialog action or lifecycle event is observed
  controller.abort(reason);

  // Then sees that dialog mutation state aborts immediately with the caller-provided reason
  await assert.rejects(pending, (error) => error === reason);
  assert.equal(Date.now(), 1000);
});

test('user applies Space only to the focused native dialog button and ignores unrelated keys', () => {
  // Given a verified native cancel dialog has both actions and another mounted button
  const { window } = loadFixtureDom(createDialogMarkup());
  const contract = findBinanceCancelAllDialog(window.document, isVisibleElement);
  const otherButton = window.document.createElement('button');
  contract.dialog.append(otherButton);

  // When keyboard decisions and an unrelated action are classified
  const confirm = classifyBinanceCancelAllDialogKeyboardAction(contract, ' ', contract.confirmButton);
  const cancel = classifyBinanceCancelAllDialogKeyboardAction(contract, ' ', contract.cancelButton);
  const unfocused = classifyBinanceCancelAllDialogKeyboardAction(contract, ' ', window.document.body);
  const unrelatedKey = classifyBinanceCancelAllDialogKeyboardAction(contract, 'Tab', contract.confirmButton);
  const unrelatedAction = classifyBinanceCancelAllDialogAction(contract, otherButton);
  const absentAction = classifyBinanceCancelAllDialogAction(contract, null);

  // Then explicit native focus determines Space and unknown actions remain undecided
  assert.equal(confirm, 'confirmed');
  assert.equal(cancel, 'cancelled');
  assert.equal(unfocused, null);
  assert.equal(unrelatedKey, null);
  assert.equal(unrelatedAction, null);
  assert.equal(absentAction, null);
});

for (const primaryCount of [0, 2]) {
  test(`user rejects a cancel dialog containing ${primaryCount} primary actions`, () => {
    // Given the native-looking dialog has two buttons but no unique primary action
    const { window } = loadFixtureDom(createDialogMarkup());
    const buttons = window.document.querySelectorAll('button');
    for (const button of buttons) button.classList.toggle('bn-button__primary', primaryCount === 2);

    // When the cancellation dialog contract is resolved
    const failure = captureThrownError(() => findBinanceCancelAllDialog(window.document, isVisibleElement));

    // Then the ambiguous confirmation contract is rejected explicitly
    assert.equal(failure.message, `撤单确认按钮数量异常：${primaryCount}`);
  });
}

test('user ignores hidden dialog wrappers and native dialogs without visible action buttons', () => {
  // Given all native action buttons are hidden while a separate candidate wrapper is also hidden
  const { window } = loadFixtureDom(createDialogMarkup());
  window.document.querySelector('.bn-modal-root').setAttribute('data-hidden', '');
  for (const button of window.document.querySelectorAll('button')) button.setAttribute('data-hidden', '');

  // When native cancellation discovery reads the mounted candidates
  const dialog = findBinanceCancelAllDialog(window.document, isVisibleElement);

  // Then no hidden or actionless candidate becomes a valid confirmation contract
  assert.equal(dialog, null);
});

test('user classifies real dialog attribute and subtree mutations without treating text churn as a dialog event', () => {
  // Given a real observer captures native dialog changes and unrelated page content
  const { window } = loadFixtureDom(`${createDialogMarkup()}<main id="outside">outside</main>`);
  const observer = new window.MutationObserver(() => {});
  observer.observe(window.document.body, { childList: true, subtree: true, attributes: true, characterData: true });
  const dialog = window.document.querySelector('[role="dialog"]');

  // When native attributes, nested buttons, outside text, and a wrapper removal change
  dialog.setAttribute('aria-hidden', 'false');
  const attributeMutation = observer.takeRecords()[0];
  dialog.append(window.document.createElement('span'));
  const nestedMutation = observer.takeRecords()[0];
  window.document.querySelector('#outside').firstChild.data = 'updated';
  const textMutation = observer.takeRecords()[0];
  dialog.parentElement.remove();
  const removedMutation = observer.takeRecords()[0];
  observer.disconnect();
  const classified = [attributeMutation, nestedMutation, textMutation, removedMutation, null]
    .map(mutationTouchesDialogCandidate);

  // Then only the actual dialog-affecting records request a dialog state refresh
  assert.deepEqual(classified, [true, true, false, true, false]);
});

test('user wakes an indefinite dialog wait through explicit notification and observes its new version', async () => {
  // Given a dialog signal waits without a timeout for an explicit native decision event
  const { window } = loadFixtureDom('<main></main>');
  const signal = createDialogMutationSignal(window.document);
  const initialVersion = signal.version;
  const pending = signal.waitForChange(initialVersion);

  // When the native decision listener notifies the dialog signal
  signal.notify();
  const result = await pending;
  const alreadyChanged = await signal.waitForChange(initialVersion);

  // Then both the pending and later stale-version consumers observe that exact change
  assert.equal(result, 'changed');
  assert.equal(alreadyChanged, 'changed');
  assert.equal(signal.version, initialVersion + 1);
  signal.dispose();
});

test('user reaches a dialog signal deadline only after the virtual clock expires', async (t) => {
  // Given no native dialog event has occurred during a bounded wait
  const { window } = loadFixtureDom('<main></main>');
  const signal = createDialogMutationSignal(window.document);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let result = 'pending';
  const pending = signal.waitForChange(signal.version, 50).then((value) => { result = value; return value; });

  // When the clock stops immediately before the deadline
  t.mock.timers.tick(49);
  await Promise.resolve();

  // Then the source still awaits a real dialog event
  assert.equal(result, 'pending');

  // When the virtual deadline is reached
  t.mock.timers.tick(1);
  const outcome = await pending;

  // Then timeout ends the wait without inventing a dialog change
  assert.equal(outcome, 'timeout');
  assert.equal(signal.version, 0);
  signal.dispose();
});

test('user releases an indefinite dialog wait when its observer is disposed', async () => {
  // Given a live dialog signal has an indefinite waiter
  const { window } = loadFixtureDom('<main></main>');
  const signal = createDialogMutationSignal(window.document);
  const pending = signal.waitForChange(signal.version);

  // When the dialog workflow disposes its observer
  signal.dispose();
  const result = await pending;

  // Then disposal settles the waiter without incrementing the event version
  assert.equal(result, 'disposed');
  assert.equal(signal.version, 0);
});

test('user reads existing dialog state without a document and leaves absent state unresolved', async () => {
  // Given a confirmed dialog state is already available to one reader
  const current = { decision: 'cancelled' };

  // When state waiters run without an observable document
  const ready = await waitForDialogMutationState(null, () => current, 1000);
  const absent = await waitForDialogMutationState(null, () => null, 1000);
  const signal = createDialogMutationSignal(null);

  // Then existing state retains identity while absent observation produces no decision
  assert.equal(ready, current);
  assert.equal(absent, null);
  assert.equal(signal, null);
});

test('user finishes a dialog state wait at its exact virtual deadline', async (t) => {
  // Given the mounted document has no cancellation dialog yet
  const { window } = loadFixtureDom('<main></main>');
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  let outcome = 'pending';
  const pending = waitForDialogMutationState(window.document, () => window.document.querySelector('[role="dialog"]'), 50)
    .then((value) => { outcome = value; return value; });

  // When the clock advances to just before the deadline
  t.mock.timers.tick(49);
  await Promise.resolve();

  // Then the native dialog remains awaited
  assert.equal(outcome, 'pending');

  // When the final virtual millisecond expires
  t.mock.timers.tick(1);
  const result = await pending;

  // Then the final native DOM read returns no dialog at the exact deadline
  assert.equal(result, null);
  assert.equal(Date.now(), 1050);
});
