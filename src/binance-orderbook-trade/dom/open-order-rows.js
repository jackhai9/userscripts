import { subtractDecimalStrings } from '../core/decimal.js';
import { sameNativeOrder } from '../core/capacity-cancel-receipts.js';
import { normalizeText, parseOpenOrderContractSymbol } from '../core/cancel-orders.js';

const MIN_OPEN_ORDER_COLUMNS = 10;

function getVisibleDirectChildren(element, isVisibleElement) {
  return Array.from(element?.children || []).filter(isVisibleElement);
}

export function findOpenOrderRowElement(actionIcon, root, { isVisibleElement }) {
  let candidate = actionIcon?.parentElement || null;
  while (candidate && candidate !== root) {
    if (candidate.childElementCount >= MIN_OPEN_ORDER_COLUMNS
      && getVisibleDirectChildren(candidate, isVisibleElement).length >= MIN_OPEN_ORDER_COLUMNS) {
      return candidate;
    }
    candidate = candidate.parentElement;
  }
  return null;
}

function cellKeyText(cell) {
  return cell.textContent.replace(/\s+/g, ' ').trim();
}

export function getOpenOrderRowKey(cells) {
  return cells.slice(0, MIN_OPEN_ORDER_COLUMNS).map(cellKeyText).join('|');
}

/**
 * Hidden columns can occur anywhere. The visible key must still occur in order
 * among the raw cell texts. Splitting both sides preserves literal pipes too.
 * This cheap rejection needs no layout reads. Actual visibility is checked below.
 */
function couldHaveVisibleKey(row, keyParts) {
  let next = 0;
  for (const cell of row.children) {
    for (const part of cellKeyText(cell).split('|')) {
      if (part !== keyParts[next]) continue;
      next += 1;
      if (next === keyParts.length) return true;
    }
  }
  return false;
}

function findCandidateOrderIcons(root, key) {
  const icons = new Set();
  const keyParts = key.split('|');
  // Every eligible row has a tenth direct child, regardless of Binance's classes.
  for (const marker of root.querySelectorAll(`:nth-child(${MIN_OPEN_ORDER_COLUMNS})`)) {
    const row = marker.parentElement;
    if (row === root || !couldHaveVisibleKey(row, keyParts)) continue;
    for (const icon of row.querySelectorAll('svg[aria-label]')) icons.add(icon);
  }
  return icons;
}

export function findOpenOrderRowElements(root, options, key = null) {
  if (!root) return [];
  const { isVisibleElement, isRowCancelIcon } = options;
  const keyedIcons = key === null ? null : findCandidateOrderIcons(root, key);
  if (keyedIcons?.size === 0) return [];
  const rows = new Set();
  for (const icon of root.querySelectorAll('svg[aria-label]')) {
    if (keyedIcons && !keyedIcons.has(icon)) continue;
    if (!isRowCancelIcon(icon) || !isVisibleElement(icon)) continue;
    const row = findOpenOrderRowElement(icon, root, options);
    if (!row || rows.has(row)) continue;
    if (key !== null && getOpenOrderRowKey(getOpenOrderRowCells(row, options)) !== key) continue;
    rows.add(row);
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

/**
 * Binance's USD-M Basic row component owns both IDs on its props. Stay below
 * the next host element so an enclosing list cannot supply another order's ID.
 */
function readNativeOrderProps(row, symbol) {
  const fiberKey = Object.keys(row).find(key => key.startsWith('__reactFiber$'));
  for (let owner = row[fiberKey]?.return; owner && !owner.stateNode?.nodeType; owner = owner.return) {
    const props = owner.memoizedProps;
    if (props?.orderId == null || props.symbol !== symbol) continue;
    const previous = owner.alternate?.memoizedProps;
    if (previous && !sameNativeOrder(props, previous)) throw new Error('订单行身份发生变化，已停止撤单');
    if (!sameNativeOrder(props, props)) break;
    return props;
  }
  throw new Error('无法确认原生订单编号，已停止撤单');
}

export function readNativeOrderIdentity(row, symbol) {
  const { orderId, clientOrderId } = readNativeOrderProps(row, symbol);
  return { symbol, orderId, clientOrderId };
}

/** Rendered quantities can lag fills. Native props are a preflight bound, never proof of cancellation. */
export function readNativeReplacementOrder(row, symbol) {
  const { orderId, clientOrderId, origQty, executedQty } = readNativeOrderProps(row, symbol);
  if (typeof origQty !== 'string' || !/^\d+(?:\.\d+)?$/.test(origQty)
    || typeof executedQty !== 'number' || !Number.isFinite(executedQty) || executedQty < 0) {
    throw new Error('无法确认原生订单数量，已停止撤单');
  }
  // Decimal strings from the final account event stay exact. Expand tiny native numeric preflight values.
  const filledQty = executedQty.toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 21 });
  const remainingQty = subtractDecimalStrings(origQty, filledQty);
  if (remainingQty === null) throw new Error('原生订单数量不一致，已停止撤单');
  return { symbol, orderId, clientOrderId, origQty, executedQty: filledQty, remainingQty };
}
