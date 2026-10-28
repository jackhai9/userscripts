import test from 'node:test';
import assert from 'node:assert/strict';

import { readVisibleOrderFeedbackEntries } from '../../../src/binance-orderbook-trade/dom/order-feedback-scan.js';
import { isVisibleElement, loadFixtureDom } from '../../helpers/dom.js';

const unrelatedMessages = Array.from({ length: 40 }, (_, index) => (
  `<div class="price-message">Mark price ${index}</div>`
)).join('');
const longOrderPanel = `<section aria-live="polite">${'Order book depth row '.repeat(20)}</section>`;
const feedbackHtml = `<!doctype html><body>
  ${unrelatedMessages}
  ${longOrderPanel}
  <div class="bn-toast" data-hidden>Order failed: old toast</div>
  <div role="alert">  Order
    rejected: insufficient margin </div>
  <div class="NotificationItem">Funding fee settled</div>
  <div class="toast-message">下单失败：余额不足</div>
</body>`;

function countingVisibility() {
  const evaluated = [];
  return {
    evaluated,
    isVisibleElement(el) {
      evaluated.push(el.textContent.trim());
      return isVisibleElement(el);
    },
  };
}

test('user sees order feedback detection evaluate layout visibility only for order-feedback text', () => {
  // Given many visible page messages beside hidden and visible order feedback
  const { window } = loadFixtureDom(feedbackHtml);
  const visibility = countingVisibility();

  // When the order flow scans for visible feedback before and after a submit
  const entries = readVisibleOrderFeedbackEntries(window.document, visibility);

  // Then only short order-feedback candidates reach the layout visibility check
  assert.deepEqual(visibility.evaluated, [
    'Order failed: old toast',
    'Order\n    rejected: insufficient margin',
    '下单失败：余额不足',
  ]);
  assert.deepEqual(entries.map(({ text }) => text), [
    'Order rejected: insufficient margin',
    '下单失败：余额不足',
  ]);
});

test('user receives visible order feedback in document order with its element identity', () => {
  // Given two visible order messages and one unrelated notification
  const { window } = loadFixtureDom(feedbackHtml);
  const alert = window.document.querySelector('[role="alert"]');
  const toast = window.document.querySelector('.toast-message');

  // When the order flow reads the feedback snapshot
  const entries = readVisibleOrderFeedbackEntries(window.document, { isVisibleElement });

  // Then each entry keeps the original element for later change detection
  assert.equal(entries.length, 2);
  assert.equal(entries[0].el, alert);
  assert.equal(entries[1].el, toast);
});
