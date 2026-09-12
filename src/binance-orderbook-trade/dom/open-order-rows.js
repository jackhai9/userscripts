import { normalizeText, parseOpenOrderContractSymbol } from '../core/cancel-orders.js';

const MIN_OPEN_ORDER_COLUMNS = 10;

function getVisibleDirectChildren(element, isVisibleElement) {
  return Array.from(element?.children || []).filter(isVisibleElement);
}

export function findOpenOrderRowElement(actionIcon, root, { isVisibleElement }) {
  let candidate = actionIcon?.parentElement || null;
  while (candidate && candidate !== root) {
    if (getVisibleDirectChildren(candidate, isVisibleElement).length >= MIN_OPEN_ORDER_COLUMNS) {
      return candidate;
    }
    candidate = candidate.parentElement;
  }
  return null;
}

export function findOpenOrderRowElements(root, {
  isVisibleElement,
  isRowCancelIcon,
}) {
  if (!root) return [];
  const rows = new Set();
  for (const icon of root.querySelectorAll('svg[aria-label]')) {
    if (!isVisibleElement(icon) || !isRowCancelIcon(icon)) continue;
    const row = findOpenOrderRowElement(icon, root, { isVisibleElement });
    if (row) rows.add(row);
  }
  return Array.from(rows);
}

export function getOpenOrderRowCells(row, { isVisibleElement }) {
  const cells = getVisibleDirectChildren(row, isVisibleElement);
  return cells.length >= MIN_OPEN_ORDER_COLUMNS ? cells : [];
}

/**
 * textContent joins adjacent Binance cells without separators. Preserve complete
 * symbol cells so another visible contract cannot disappear from scope evidence.
 */
export function readOpenOrdersScopeText(root, options) {
  if (!root) return '';
  const symbolCells = new Set(findOpenOrderRowElements(root, options).map((row) => {
    const cell = getOpenOrderRowCells(row, options)[1];
    if (!cell || !parseOpenOrderContractSymbol(cell.textContent)) {
      throw new Error('Invalid visible open-order symbol');
    }
    return cell;
  }));
  const parts = [];
  function appendText(node) {
    if (symbolCells.has(node)) {
      parts.push('\n', normalizeText(node.textContent), '\n');
    } else if (node.nodeType === 3) {
      parts.push(node.textContent);
    } else {
      for (const child of node.childNodes) appendText(child);
    }
  }
  appendText(root);
  return parts.join('');
}
