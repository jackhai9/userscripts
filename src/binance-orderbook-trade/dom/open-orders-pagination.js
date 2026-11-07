function committedProps(host) {
  const key = Object.keys(host).find(name => name.startsWith('__reactProps$'));
  return key && host[key];
}

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
    const children = committedProps(host.parentElement)?.children;
    if (!Array.isArray(children)) continue;
    for (const child of children) {
      const list = child?.props?.children?.props;
      if (list?.conRef?.current !== host) continue;
      if (found || list.loading !== false || list.hasMore !== undefined || list.loadMore !== undefined
        || !Array.isArray(list.data) || typeof list.renderItem !== 'function') return null;
      const data = list.data;
      // The checkbox can commit before the data reflects its new filter. Binance represents
      // paired strategy legs as a single item without a symbol on the wrapper.
      if (!data.every(item => item?.symbol === symbol || (
        item?.strategySubIdTwo?.symbol === symbol && item?.strategySubIdThree?.symbol === symbol
      ))) return null;
      if (!data.length && !list.emptyState) return null;
      found = { host, list };
    }
  }
  return found;
}

export function readNativeOpenOrderWindow(root, symbol) {
  const owner = readCommittedList(root, symbol);
  if (!owner) return null;
  const { host, list } = owner;
  const { data } = list;
  const body = committedProps(host)?.children?.[1];
  if (!data.length) return body === list.emptyState ? { host, data, complete: true } : null;
  const rows = body?.props?.children?.[1];
  if (!Array.isArray(rows)) return null;
  const offset = data.findIndex(item => represents(item, rows[0]));
  const aligned = offset >= 0 && rows.every((row, i) => represents(data[offset + i], row));
  // Equal-length replacements can leave the old window mounted until a scroll near the top.
  return { host, data, count: rows.length, offset: aligned ? offset : -1,
    complete: aligned && offset === 0 && rows.length === data.length };
}
