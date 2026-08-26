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
