import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { JSDOM } from 'jsdom';
import { readNativeOpenOrderWindow } from '../../../src/binance-orderbook-trade/dom/open-orders-pagination.js';

const h = React.createElement;
const style = { overflowY: 'auto' };
const emptyState = h('div', null, 'No orders');
function OrderRow(props) {
  return h('div', { 'data-order-id': props.orderId }, ...Array.from({ length: 10 }, (_, i) => h('span', { key: i }, String(i))));
}
const renderItem = item => h(OrderRow, { ...item, key: item.orderId });
const MemoizedOrderRow = React.memo(OrderRow);
const renderMemoizedItem = item => h(MemoizedOrderRow, { ...item, key: item.orderId });

for (const field of ['orderId', 'price']) {
  test(`user refuses stale rendered ${field} hidden by a custom memo comparison`, t => {
    // Given a custom comparator retains a mounted order despite changed props
    const FrozenRow = React.memo(props => h('div', {
      'data-order-id': props.orderId, 'data-price': props.price,
    }), () => true);
    const renderFrozen = item => h(FrozenRow, { ...item, key: 'stable-row' });
    const data = [{ symbol: 'AINUSDT', orderId: 1, clientOrderId: 'one', price: '200' }];
    const list = mountList(t, []);
    list.render(data, data, { renderItem: renderFrozen });

    // When the list commits new source values while the inner row bails out
    const current = [{ ...data[0], [field]: field === 'price' ? '100' : 2 }];
    list.render(current, current, { renderItem: renderFrozen });
    const observed = readNativeOpenOrderWindow(list.container, 'AINUSDT');

    // Then unchanged DOM cannot prove that the new source is fully rendered
    assert.equal(list.host.querySelector('[data-order-id]').dataset.orderId, '1');
    assert.equal(list.host.querySelector('[data-price]').dataset.price, '200');
    assert.equal(observed === null, true);
  });
}
function NativeList({ conRef, data, windowRows, renderItem: renderRow }) {
  return h('div', { ref: conRef, style }, null,
    data.length ? h('div', null, null, windowRows.map(renderRow)) : emptyState);
}
const MemoizedNativeList = React.memo(NativeList);
const orders = (count, start = 0) => Array.from({ length: count }, (_, i) => ({
  symbol: 'AINUSDT', orderId: start + i + 1, clientOrderId: `client-${start + i + 1}`,
}));
function mountList(t, data, windowRows = data, { memoized = false } = {}) {
  const dom = new JSDOM('<main></main>');
  const previousWindow = globalThis.window;
  globalThis.window = dom.window;
  const container = dom.window.document.querySelector('main');
  const root = createRoot(container);
  const conRef = React.createRef();
  function render(nextData, nextWindow = nextData, extra = {}) {
    flushSync(() => root.render(h('div', null, null, h(React.Fragment, null,
      h(memoized ? MemoizedNativeList : NativeList, { conRef, data: nextData, windowRows: nextWindow,
        loading: false, renderItem, emptyState, ...extra })))));
  }
  render(data, windowRows);
  t.after(() => { flushSync(() => root.unmount()); globalThis.window = previousWindow; dom.window.close(); });
  return { container, host: conRef.current, render, root };
}
const cachedProps = node => node[Object.keys(node).find(key => key.startsWith('__reactProps$'))];

test('user reads the actual fifty-row window after children-only commits leave both event caches stale', t => {
  // Given a real React list initially commits all two hundred orders
  const initial = orders(200);
  const list = mountList(t, initial);
  const hostCache = cachedProps(list.host);
  const parentCache = cachedProps(list.host.parentElement);

  // When a fill replaces the data and resets the native window without changing host attributes
  const current = initial.slice(1);
  list.render(current, current.slice(0, 50));
  const observed = readNativeOpenOrderWindow(list.container, 'AINUSDT');

  // Then committed data and visible rows win over both stale event-props caches
  assert.equal(cachedProps(list.host), hostCache);
  assert.equal(cachedProps(list.host.parentElement), parentCache);
  assert.equal(parentCache.children[1].props.children.props.data.length, 200);
  assert.equal(hostCache.children[1].props.children[1].length, 200);
  assert.equal(list.host.querySelectorAll('[data-order-id]').length, 50);
  assert.equal(observed?.data.length, 199);
  assert.equal(observed?.data[0].orderId, 2);
  assert.equal(observed?.count, 50);
  assert.equal(observed?.offset, 0);
  assert.equal(observed?.complete, false);
});

test('user waits for the complete current window across alternating React commits', t => {
  // Given a two hundred order list begins with fifty mounted rows
  const data = orders(200);
  const list = mountList(t, data, data.slice(0, 50));

  // When successive native pages are committed on alternating fiber branches
  const observations = [50, 100, 150, 200, 50, 200].map(count => {
    list.render(data, data.slice(0, count));
    return readNativeOpenOrderWindow(list.container, 'AINUSDT');
  });

  // Then only full ordered windows authorize complete-list ranking
  assert.deepEqual(observations.map(value => value?.count), [50, 100, 150, 200, 50, 200]);
  assert.deepEqual(observations.map(value => value?.complete), [false, false, false, true, false, true]);
});

test('user rejects an equal-length window whose order identities no longer match current data', t => {
  // Given the old native window contains fifty orders
  const initial = orders(50);
  const list = mountList(t, initial);

  // When the whole list is replaced while the native window still renders previous IDs
  const current = orders(50, 200);
  list.render(current, initial);
  const observed = readNativeOpenOrderWindow(list.container, 'AINUSDT');

  // Then equal counts cannot authorize ranking mismatched orders
  assert.equal(observed?.data[0].orderId, 201);
  assert.equal(observed?.count, 50);
  assert.equal(observed?.offset, -1);
  assert.equal(observed?.complete, false);
});

test('user does not accept a committed window after its DOM order is changed externally', t => {
  // Given the native list has two committed order rows
  const list = mountList(t, orders(2));
  const rows = list.host.querySelectorAll('[data-order-id]');

  // When external DOM changes reverse the mounted order without a React commit
  rows[0].parentElement.append(rows[0]);
  const observed = readNativeOpenOrderWindow(list.container, 'AINUSDT');

  // Then the contradictory DOM cannot prove list completeness
  assert.equal(observed === null, true);
});

test('user cannot read a native list after its React root is unmounted', t => {
  // Given the native list is mounted with an accessible scroll host
  const list = mountList(t, orders(2));

  // When React unmounts and an external caller reattaches the old host
  flushSync(() => list.root.unmount());
  list.container.append(list.host);
  const observed = readNativeOpenOrderWindow(list.container, 'AINUSDT');

  // Then detached React ownership cannot authorize complete-list ranking
  assert.equal(observed === null, true);
});

test('user reads the committed window when React shares children after a memo bailout', t => {
  // Given a memoized native list has already produced alternate fibers
  const data = orders(80);
  const list = mountList(t, data, data.slice(0, 50), { memoized: true });
  list.render(data, data);

  // When parent-only commits reuse the memoized native list children
  const observations = Array.from({ length: 4 }, () => {
    list.render(data, data);
    return readNativeOpenOrderWindow(list.container, 'AINUSDT');
  });

  // Then shared bailout paths still resolve the full committed eighty-row window
  assert.deepEqual(observations.map(value => [value?.count, value?.complete]),
    [[80, true], [80, true], [80, true], [80, true]]);
});

test('user accepts only the mounted native empty state after the last order disappears', t => {
  // Given the native list starts with one order
  const list = mountList(t, orders(1));

  // When a committed removal replaces it with the native empty state
  list.render([]);
  const observed = readNativeOpenOrderWindow(list.container, 'AINUSDT');

  // Then the empty committed list is complete and contains no stale rows
  assert.equal(observed?.data.length, 0);
  assert.equal(observed?.complete, true);
  assert.equal(list.host.querySelectorAll('[data-order-id]').length, 0);
});

test('user cannot rank a list whose current loading or symbol-filter contract is unsettled', t => {
  // Given the native list initially satisfies the requested symbol scope
  const data = orders(2);
  const list = mountList(t, data);

  // When loading, external pagination, or another symbol contradicts the scoped snapshot
  const observations = [
    [data, { loading: true }],
    [data, { hasMore: false }],
    [data, { loadMore() {} }],
    [[{ ...data[0], symbol: 'BTCUSDT' }], {}],
  ].map(([nextData, extra]) => {
    list.render(nextData, nextData, extra);
    return readNativeOpenOrderWindow(list.container, 'AINUSDT') === null;
  });

  // Then every unsettled native contract remains unavailable for ranking
  assert.deepEqual(observations, [true, true, true, true]);
});

test('user preserves paired strategy wrappers when their committed DOM and both leg symbols match', t => {
  // Given one native item wraps two strategy legs of the current symbol
  const [first, second] = orders(2);
  const data = [{ strategySubIdTwo: first, strategySubIdThree: second }];
  const list = mountList(t, []);
  const renderPair = item => h(React.Fragment, { key: item.strategySubIdTwo.orderId },
    renderItem(item.strategySubIdTwo), renderItem(item.strategySubIdThree));
  function PairedRow(props) { return renderPair(props); }

  // When the native list commits one wrapper backed by two actual order rows
  list.render(data, data, { renderItem: item => h(PairedRow, { ...item, key: 'pair' }) });
  const observed = readNativeOpenOrderWindow(list.container, 'AINUSDT');

  // Then completeness counts the native wrapper while preserving both mounted legs
  assert.equal(observed?.count, 1);
  assert.equal(observed?.complete, true);
  assert.equal(list.host.querySelectorAll('[data-order-id]').length, 2);
});

test('user rejects duplicate source identities even when every rendered row matches its props', t => {
  // Given two native records incorrectly share one order identity with different quantities
  const [order] = orders(1);
  const data = [{ ...order, origQty: '1' }, { ...order, origQty: '2' }];
  const list = mountList(t, []);

  // When both records are committed as distinct rendered elements
  list.render(data, data, { renderItem: (item, index) => h(OrderRow, { ...item, key: index }) });
  const observed = readNativeOpenOrderWindow(list.container, 'AINUSDT');

  // Then ambiguous source identity cannot establish a complete list
  assert.equal(observed?.complete === true, false);
});

test('user reads unchanged memoized rows when a new native window reuses their committed DOM', t => {
  // Given memoized native rows are mounted with their original element props
  const data = orders(2);
  const list = mountList(t, []);
  list.render(data, data, { renderItem: renderMemoizedItem });
  const initialNodes = Array.from(list.host.querySelectorAll('[data-order-id]'));

  // When a native list commit creates equal row props and React bails out those rows
  list.render(data, data, { renderItem: renderMemoizedItem });
  const observed = readNativeOpenOrderWindow(list.container, 'AINUSDT');

  // Then the unchanged current rows prove the complete window through their mounted DOM
  assert.equal(observed?.count, 2);
  assert.equal(observed?.complete, true);
  assert.deepEqual(Array.from(list.host.querySelectorAll('[data-order-id]')), initialNodes);
});

