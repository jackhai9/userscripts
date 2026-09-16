import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { installNativeInputRollbackHost, installNativeSubmitFeedbackHost } from '../helpers/native-submit-feedback-host.js';

test('user receives native validation feedback without reaching the exchange transport', () => {
  // Given the native submit button has a transport callback and known input values.
  const dom = new JSDOM('<section id="trade-form"><div class="order-entry"><input id="limitPrice-open" value="80.9"><input id="unitAmount-open" value="0.07"><button>Open Long</button></div></section>');
  const document = dom.window.document;
  const button = document.querySelector('button');
  let transportCalls = 0;
  button.addEventListener('click', () => { transportCalls += 1; });
  const host = installNativeSubmitFeedbackHost({ ownerDocument: document, initialText: 'Old error', busy: true });

  // When the button is activated and native validation publishes an updated message.
  button.click();
  host.publish('Insufficient balance', { replaceMarkup: true });

  // Then the attempted fields are retained, the pending native state is visible, and transport remains untouched.
  assert.deepEqual(host.snapshot(), {
    attempts: [{ action: 'Open Long', price: '80.9', quantity: '0.07' }],
    text: 'Insufficient balance',
  });
  assert.equal(button.getAttribute('data-loading'), 'true');
  assert.equal(document.querySelector('[role="alert"]').innerHTML, '<strong>Insufficient balance</strong>');
  assert.equal(transportCalls, 0);

  // When the validation boundary is removed and the native button is used again.
  host.dispose();
  button.click();

  // Then the original transport owns clicks again and no validation DOM or pending flag remains.
  assert.equal(transportCalls, 1);
  assert.equal(button.hasAttribute('data-loading'), false);
  assert.equal(document.querySelectorAll('[role="alert"]').length, 0);
  dom.window.close();
});

test('user cannot publish validation feedback before submitting the native form', () => {
  // Given the native host has no submitted attempt.
  const dom = new JSDOM('<section id="trade-form"><div class="order-entry"></div></section>');
  const host = installNativeSubmitFeedbackHost({ ownerDocument: dom.window.document });

  // When feedback is published without a corresponding user action.
  const publish = () => host.publish('Order rejected');

  // Then the host exposes the missing submit contract instead of manufacturing evidence.
  assert.throws(publish, /active submitted attempt/);
  assert.deepEqual(host.snapshot(), { attempts: [], text: '' });
  host.dispose();
  dom.window.close();
});

test('user retains the native committed value when a controlled field rejects a proposed input', () => {
  // Given a native quantity field has a committed value from the host application.
  const dom = new JSDOM('<input id="quantity" value="2">');
  const input = dom.window.document.querySelector('input');
  const host = installNativeInputRollbackHost({ ownerDocument: dom.window.document, selector: '#quantity', rollbackValue: '2' });

  // When an input event proposes a new value to that controlled field.
  input.value = '3';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

  // Then the host records the proposal and exposes its committed value to every subsequent reader.
  assert.deepEqual(host.snapshot(), { proposed: ['3'], current: '2' });

  // When the rollback owner is disposed and the same field receives a new proposal.
  host.dispose();
  input.value = '4';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

  // Then native input events proceed without an old boundary rewriting them.
  assert.deepEqual(host.snapshot(), { proposed: ['3'], current: '4' });
  dom.window.close();
});
