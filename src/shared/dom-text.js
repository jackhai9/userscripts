/**
 * Writes an element's text by updating its existing Text node.
 *
 * Assigning `textContent` to an element that already has children removes all of them, and Chrome
 * then re-evaluates `:has()` for every affected ancestor. On Binance futures pages the price-alert
 * stylesheet (`.price-alert-modal :has(>div.bn-skeleton)>:not(.bn-skeleton)`) turns that into a
 * whole-body style recalculation, ~50 ms with a logged-in DOM. Changing a Text node's data does
 * not remove children, so periodic labels update without that cost.
 */
export function setElementText(element, text) {
  const node = element.firstChild;
  if (node !== null && node === element.lastChild && node.nodeType === node.TEXT_NODE) {
    if (node.data !== text) node.data = text;
    return;
  }
  if (element.textContent !== text) element.textContent = text;
}
