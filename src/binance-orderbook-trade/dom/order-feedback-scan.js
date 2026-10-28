import { isPotentialOrderFeedbackText } from '../core/order-feedback.js';

const ORDER_FEEDBACK_SELECTOR = [
  '[role="alert"]',
  '[aria-live]',
  '[class*="toast"]',
  '[class*="Toast"]',
  '[class*="message"]',
  '[class*="Message"]',
  '[class*="notification"]',
  '[class*="Notification"]',
].join(',');
const MAX_ORDER_FEEDBACK_TEXT_LENGTH = 300;

/**
 * The submit flow scans on every body mutation batch while an order is pending.
 * Visibility reads computed style and layout, so it runs only for short
 * order-feedback text; the pure text filters select the same entries first.
 */
export function readVisibleOrderFeedbackEntries(document, { isVisibleElement }) {
  const entries = [];
  for (const el of document.querySelectorAll(ORDER_FEEDBACK_SELECTOR)) {
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > MAX_ORDER_FEEDBACK_TEXT_LENGTH || !isPotentialOrderFeedbackText(text)) continue;
    if (isVisibleElement(el)) entries.push({ el, text });
  }
  return entries;
}
