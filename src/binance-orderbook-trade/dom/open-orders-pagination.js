import { findCurrentReactFiber, readCurrentHostFiber } from './react-current-fiber.js';
import { sameNativeOrder } from '../core/capacity-cancel-receipts.js';

function represents(item, element) {
  const props = element?.props;
  if (!item || !props) return false;
  const fields = Object.keys(item);
  return fields.length > 0 && fields.every(field => Object.hasOwn(props, field) && Object.is(item[field], props[field]));
}

/** The Basic list owner holds the whole filtered data set; the scroll host renders a separate window. */
function readCommittedList(root, symbol) {
  let found = null;
  for (const host of root.querySelectorAll('div[style]')) {
    if (host.style.overflowY !== 'auto') continue;
    const hostFiber = readCurrentHostFiber(host);
    if (!hostFiber) continue;
    for (let ancestor = hostFiber.return; ancestor; ancestor = ancestor.return) {
      const current = findCurrentReactFiber(ancestor);
      if (!current) return null;
      const list = current.memoizedProps;
      if (list?.conRef?.current !== host) continue;
      if (found || list.loading !== false || list.hasMore !== undefined || list.loadMore !== undefined
        || !Array.isArray(list.data) || typeof list.renderItem !== 'function') return null;
      const data = list.data;
      // The checkbox can commit before the data reflects its new filter. Binance represents
      // paired strategy legs as a single item without a symbol on the wrapper.
      if (!data.every(item => item?.symbol === symbol || (
        item?.strategySubIdTwo?.symbol === symbol && item?.strategySubIdThree?.symbol === symbol
      ))) return null;
      const identities = new Set();
      for (const item of data) {
        if (item.symbol !== symbol) continue;
        if (!sameNativeOrder(item, item)) return null;
        const key = String(item.orderId);
        if (identities.has(key)) return null;
        identities.add(key);
      }
      if (!data.length && !list.emptyState) return null;
      found = { host, hostFiber, list };
    }
  }
  return found;
}

/**
 * React.memo keeps the previous props object when a new element has equal props.
 * Match the element's exact type, key and complete props to its current fiber,
 * then require unique mounted DOM in order. This also preserves paired wrappers
 * without inventing their order identity. Prune matched rows so the check visits
 * list structure rather than every cell or the application's tree.
 */
function windowMatchesDom(host, hostFiber, elements) {
  const types = new Map();
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index];
    if (!element.type || !element.props) return false;
    if (!types.has(element.type)) types.set(element.type, new Map());
    const keys = types.get(element.type);
    if (keys.has(element.key)) return false;
    keys.set(element.key, index);
  }
  const nodes = new Array(elements.length);
  function collectHosts(fiber, result) {
    if (fiber.tag === 5) {
      result.push(fiber.stateNode);
      return;
    }
    for (let child = fiber.child; child; child = child.sibling) {
      collectHosts(child, result);
    }
  }
  function visit(fiber) {
    for (let child = fiber; child; child = child.sibling) {
      const index = types.get(child.elementType)?.get(child.key);
      if (index !== undefined) {
        // A MemoComponent wrapper can commit new props while its custom comparison
        // retains stale inner DOM. Only the directly rendered row can prove this window.
        if (child.tag === 14) return false;
        const props = elements[index].props;
        const committed = child.memoizedProps;
        if (!committed || Object.keys(committed).length !== Object.keys(props).length
          || !Object.keys(props).every(key => Object.hasOwn(committed, key) && Object.is(props[key], committed[key]))) return false;
        if (nodes[index] || findCurrentReactFiber(child) !== child) return false;
        const rowNodes = [];
        collectHosts(child, rowNodes);
        if (!rowNodes.length || rowNodes.some(node => !node.isConnected || !host.contains(node))) return false;
        nodes[index] = rowNodes;
      } else if (!visit(child.child)) return false;
    }
    return true;
  }
  if (!visit(hostFiber.child)) return false;
  let previous = null;
  for (let index = 0; index < nodes.length; index += 1) {
    if (!nodes[index]) return false;
    for (const node of nodes[index]) {
      if (previous && !(previous.compareDocumentPosition(node) & 4)) return false;
      previous = node;
    }
  }
  return true;
}

export function readNativeOpenOrderWindow(root, symbol) {
  const owner = readCommittedList(root, symbol);
  if (!owner) return null;
  const { host, hostFiber, list } = owner;
  const { data } = list;
  const body = hostFiber.memoizedProps?.children?.[1];
  if (!data.length) return body?.props && body === list.emptyState && windowMatchesDom(host, hostFiber, [body])
    ? { host, data, complete: true } : null;
  const rows = body?.props?.children?.[1];
  if (!Array.isArray(rows) || !rows.every(row => row?.props) || !windowMatchesDom(host, hostFiber, rows)) return null;
  const offsets = data.flatMap((item, index) => represents(item, rows[0]) ? [index] : []);
  const offset = offsets.length === 1 ? offsets[0] : -1;
  const aligned = offset >= 0 && rows.every((row, i) => represents(data[offset + i], row));
  // Equal-length replacements can leave the old window mounted until a scroll near the top.
  return { host, data, count: rows.length, offset: aligned ? offset : -1,
    complete: aligned && offset === 0 && rows.length === data.length };
}
