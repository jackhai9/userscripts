import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { JSDOM } from 'jsdom';

import { renderBinanceFuturesFixture } from '../../e2e/binance-orderbook/fixtures/binance-futures.js';
import {
  CURRENT_SYMBOL,
  OTHER_SYMBOL,
  ORDER_SETS,
  createCancelScenario,
} from '../../e2e/binance-orderbook/scenarios/cancel-current-symbol.js';

const protectedOrders = [
  { ...ORDER_SETS.current[0], id: 'conditional-current', kind: 'conditional' },
  { ...ORDER_SETS.other[0], id: 'conditional-other', kind: 'conditional' },
];
const mixedOrders = [...ORDER_SETS.both, ...protectedOrders];

function openNativeHost(t, scenario) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const submission = Promise.withResolvers();
  const dom = new JSDOM(renderBinanceFuturesFixture(scenario), {
    url: 'https://www.binance.com/zh-CN/futures/' + CURRENT_SYMBOL,
    runScripts: 'dangerously',
    beforeParse(window) {
      window.fetch = (path) => {
        if (path === '/bapi/futures/v1/private/future/order/place-order') {
          return submission.promise;
        }
        assert.equal(path, '/bapi/fixture-bootstrap');
        return Promise.resolve(new Response(JSON.stringify({ success: true })));
      };
    },
  });
  t.after(async () => {
    await setImmediate();
    dom.window.close();
  });
  return {
    document: dom.window.document,
    fixture: {
      snapshot: () => structuredClone(dom.window.__BINANCE_FIXTURE__.snapshot()),
      switchSymbol: (symbol) => dom.window.__BINANCE_FIXTURE__.switchSymbol(symbol),
      setPositions: (positions) => dom.window.__BINANCE_FIXTURE__.setPositions(positions),
      setOrders: (orders) => dom.window.__BINANCE_FIXTURE__.setOrders(orders),
    },
    async respond(payload) {
      submission.resolve(new Response(JSON.stringify(payload), {
        headers: { 'content-type': 'application/json' },
      }));
      // Let the response body stream and its registered promise handlers settle.
      await setImmediate();
    },
  };
}

test('user can detect an unfiltered cancellation because the fake removes other-symbol basic orders', (t) => {
  // Given mixed basic and conditional orders with the symbol filter disabled.
  const host = openNativeHost(t, createCancelScenario({
    orders: mixedOrders,
    ui: { accountTab: 'openOrders', hideOtherSymbols: false },
  }));

  // When a caller uses native cancel without first restricting the symbol.
  host.document.querySelector('[data-cancel-all]').click();
  host.document.querySelector('[data-dialog-action="confirm"]').click();
  t.mock.timers.tick(0);

  // Then the fake exposes the unsafe result instead of correcting the caller's scope.
  const state = host.fixture.snapshot();
  assert.deepEqual(state.orders, protectedOrders);
  assert.equal(state.orders.some((order) => order.id === 'other-1'), false);
  const request = state.events.find(({ type }) => type === 'cancel-requested');
  assert.equal(request.hideOtherSymbols, false);
  assert.equal(request.openOrdersSubTab, 'basic');
  assert.deepEqual(request.orderIds, ['current-1', 'other-1']);
});

test('user can detect cancellation from the wrong order sub-tab', (t) => {
  // Given conditional orders are selected while current-symbol basic orders also exist.
  const host = openNativeHost(t, createCancelScenario({
    orders: mixedOrders,
    ui: { accountTab: 'openOrders', openOrdersSubTab: 'conditional', hideOtherSymbols: true },
  }));

  // When a caller confirms that native scope without selecting Basic orders.
  host.document.querySelector('[data-cancel-all]').click();
  host.document.querySelector('[data-dialog-action="confirm"]').click();
  t.mock.timers.tick(0);

  // Then the current conditional order is removed and the untouched basic order proves the mistake.
  const state = host.fixture.snapshot();
  assert.deepEqual(state.orders, [...ORDER_SETS.both, protectedOrders[1]]);
  const request = state.events.find(({ type }) => type === 'cancel-requested');
  assert.equal(request.openOrdersSubTab, 'conditional');
  assert.deepEqual(request.orderIds, ['conditional-current']);
});

for (const switchBeforeConfirmation of [true, false]) {
  test(`user keeps the initiating cancellation symbol when the page changes ${switchBeforeConfirmation ? 'before confirmation' : 'during delayed clearing'}`, (t) => {
    // Given one captured current-symbol scope and a delayed native cancellation.
    const host = openNativeHost(t, createCancelScenario({
      orders: mixedOrders,
      ui: { accountTab: 'openOrders', hideOtherSymbols: true },
      host: { clearDelayMs: 500 },
    }));
    host.document.querySelector('[data-cancel-all]').click();

    // When the page changes symbol around confirmation and its pending host timer expires.
    if (switchBeforeConfirmation) host.fixture.switchSymbol(OTHER_SYMBOL);
    host.document.querySelector('[data-dialog-action="confirm"]').click();
    if (!switchBeforeConfirmation) host.fixture.switchSymbol(OTHER_SYMBOL);
    t.mock.timers.tick(499);
    assert.deepEqual(host.fixture.snapshot().orders, mixedOrders);
    t.mock.timers.tick(1);

    // Then only the originally captured basic order disappears.
    const state = host.fixture.snapshot();
    assert.equal(state.currentSymbol, OTHER_SYMBOL);
    assert.deepEqual(state.orders, [ORDER_SETS.both[1], ...protectedOrders]);
    const request = state.events.find(({ type }) => type === 'cancel-requested');
    assert.equal(request.symbol, CURRENT_SYMBOL);
    assert.equal(request.hideOtherSymbols, true);
    assert.deepEqual(request.orderIds, ['current-1']);
  });
}

for (const [outcome, payload, text] of [
  ['success', { success: true }, '订单已提交成功'],
  ['rejected', { success: false, code: '90800001', message: 'Fixture rejection' }, '订单提交失败'],
]) {
  test(`user receives native feedback for the actual ${outcome} response`, async (t) => {
    // Given the native request has no response yet.
    const host = openNativeHost(t, createCancelScenario());
    host.document.querySelector('.order-entry button').click();
    assert.equal(host.document.querySelector('[role="alert"]'), null);
    assert.deepEqual(host.fixture.snapshot().events.map(({ type }) => type), ['order-submitted']);

    // When the declared API response reaches the native caller.
    await host.respond(payload);

    // Then both the ledger and toast reflect that response, with no fabricated success.
    assert.equal(host.document.querySelector('[role="alert"]').textContent, text);
    const events = host.fixture.snapshot().events;
    assert.deepEqual(events.map(({ type }) => type), [
      'order-submitted', 'order-submit-api-' + outcome, 'order-submit-feedback',
    ]);
    assert.equal(events[2].outcome, outcome);
  });
}

test('user receives no fabricated success while a native submit remains unanswered', (t) => {
  // Given a native order request whose response remains pending.
  const host = openNativeHost(t, createCancelScenario());
  host.document.querySelector('.order-entry button').click();

  // When the response deadline and a further cooldown elapse on the host clock.
  t.mock.timers.tick(20_000);

  // Then no response or toast is invented merely because time passed.
  assert.equal(host.document.querySelector('[role="alert"]'), null);
  assert.deepEqual(host.fixture.snapshot().events.map(({ type }) => type), ['order-submitted']);
});

test('user sees an unrecognized native response remain unknown', async (t) => {
  // Given a native form has no recognized response for its next submit.
  const host = openNativeHost(t, createCancelScenario());

  // When an unrecognized API payload reaches the submitted order.
  host.document.querySelector('.order-entry button').click();
  await host.respond({ result: 'unrecognized' });

  // Then the ledger retains unknown and the host does not invent a success toast.
  assert.deepEqual(host.fixture.snapshot().events.map(({ type }) => type), [
    'order-submitted', 'order-submit-api-unknown',
  ]);
  assert.equal(host.document.querySelector('[role="alert"]'), null);
});

test('user cannot configure undeclared order kinds or invalid submit outcomes', () => {
  // Given order-kind, pending-response, and rejection-reason declarations can be invalid.
  const invalidOrders = { orders: [{ id: 'missing-kind' }] };
  const invalidUnknown = {
    host: { submitApiResponses: [{ outcome: 'unknown', delivery: 'immediate' }] },
  };
  const invalidRejection = {
    host: { submitApiResponses: [{ outcome: 'rejected', delivery: 'immediate' }] },
  };

  // When a caller attempts to build a scenario from each invalid declaration.
  const constructOrders = () => createCancelScenario(invalidOrders);
  const constructUnknown = () => createCancelScenario(invalidUnknown);
  const constructRejection = () => createCancelScenario(invalidRejection);

  // Then each contract violation is rejected with its specific reason.
  assert.throws(constructOrders, /declare.*kind/);
  assert.throws(constructUnknown, /unknown.*pending/);
  assert.throws(constructRejection, /code and message/);
});

test('user can detect an unsafe row cancellation because the fake removes exactly the clicked other-symbol order', (t) => {
  // Given the native list contains both symbols and a delayed row cancellation.
  const host = openNativeHost(t, createCancelScenario({
    orders: mixedOrders,
    ui: { accountTab: 'openOrders' },
    host: { rowCancelDelayMs: 200 },
  }));
  const icon = host.document.querySelector('[data-order-id="other-1"] svg');

  // When a caller clicks the wrong visible SVG row and navigates before clearing.
  icon.dispatchEvent(new host.document.defaultView.MouseEvent('click', { bubbles: true }));
  host.fixture.switchSymbol(OTHER_SYMBOL);
  t.mock.timers.tick(199);
  assert.deepEqual(host.fixture.snapshot().orders, mixedOrders);
  t.mock.timers.tick(1);

  // Then only that captured ID is removed; the fixture has not corrected the caller to the original symbol.
  const state = host.fixture.snapshot();
  assert.deepEqual(state.orders, [ORDER_SETS.current[0], ...protectedOrders]);
  assert.deepEqual(state.events.filter(({ type }) => type.startsWith('row-cancel')).map(({ type, orderId }) => ({ type, orderId })), [
    { type: 'row-cancel-requested', orderId: 'other-1' },
    { type: 'row-cancel-cleared', orderId: 'other-1' },
  ]);
});

for (const action of ['cancel', 'confirm']) {
  test(`user must explicitly ${action} a native row dialog before its captured cancellation can settle`, (t) => {
    // Given row cancellation requires a native decision and releases declared quantity only after clearing.
    const host = openNativeHost(t, createCancelScenario({
      orders: mixedOrders,
      ui: { accountTab: 'openOrders', openableQuantity: '0.04' },
      host: { rowCancelMode: 'dialog', openableQuantityAfterRowCancel: '10' },
    }));
    host.document.querySelector('[data-order-id="current-1"] svg')
      .dispatchEvent(new host.document.defaultView.MouseEvent('click', { bubbles: true }));
    t.mock.timers.tick(1000);
    assert.deepEqual(host.fixture.snapshot().orders, mixedOrders);
    assert.equal(host.fixture.snapshot().dialogOpen, true);

    // When the user makes the declared native dialog decision.
    host.document.querySelector('[data-row-dialog-action="' + action + '"]').click();
    t.mock.timers.tick(0);

    // Then cancellation and released quantity match that decision exactly.
    const state = host.fixture.snapshot();
    assert.equal(state.dialogOpen, false);
    assert.deepEqual(state.orders, action === 'confirm' ? [ORDER_SETS.both[1], ...protectedOrders] : mixedOrders);
    assert.equal(state.openableQuantity, action === 'confirm' ? '10' : '0.04');
    assert.equal(host.document.querySelector('[data-testid="max-buy-amount"]').textContent,
      '可开 ' + (action === 'confirm' ? '10' : '0.04') + ' HYPE');
  });
}

test('user sees an unconfirmed row request stay unconfirmed after its deadline', (t) => {
  // Given the host is explicitly unable to confirm a row cancellation.
  const host = openNativeHost(t, createCancelScenario({
    orders: ORDER_SETS.current,
    ui: { accountTab: 'openOrders' },
    host: { rowCancelMode: 'unchanged' },
  }));

  // When the caller clicks the SVG and all modeled response time has elapsed.
  host.document.querySelector('.open-order-row svg')
    .dispatchEvent(new host.document.defaultView.MouseEvent('click', { bubbles: true }));
  t.mock.timers.tick(5000);

  // Then no row removal or successful cancellation is fabricated.
  assert.deepEqual(host.fixture.snapshot().orders, ORDER_SETS.current);
  assert.deepEqual(host.fixture.snapshot().events.map(({ type }) => type), ['row-cancel-requested']);
});

for (const invalid of [
  { ui: { openableQuantity: null } },
  { host: { rowCancelMode: 'repair-scope' } },
  { host: { rowCancelDelayMs: -1 } },
  { host: { openableQuantityAfterRowCancel: -1 } },
]) {
  test(`user cannot configure an ambiguous row host boundary ${JSON.stringify(invalid)}`, () => {
    // Given the row boundary contains an invalid quantity, outcome, or delay.
    const scenario = invalid;

    // When the caller declares that native boundary.
    const construct = () => createCancelScenario(scenario);

    // Then the host refuses the configuration instead of assigning silent behavior.
    assert.throws(construct, /Openable quantity|Row cancellation/);
  });
}

test('user can discover later native pages only by scrolling the declared host list to its bottom', (t) => {
  // Given the external list has five explicit rows but initially mounts only two.
  const orders = Array.from({ length: 5 }, (_, index) => ({
    ...ORDER_SETS.current[0], id: 'page-' + index, price: String(80 + index),
    symbol: index === 4 ? OTHER_SYMBOL : CURRENT_SYMBOL,
  }));
  const host = openNativeHost(t, createCancelScenario({
    orders, ui: { accountTab: 'openOrders' }, host: { orderRowsPageSize: 2 },
  }));
  const content = host.document.querySelector('.orders-content');
  Object.defineProperties(content, {
    clientHeight: { value: 96 },
    scrollHeight: { get: () => content.querySelectorAll('.open-order-row').length * 80 },
  });
  const mountedIds = () => Array.from(content.querySelectorAll('[data-order-id]'), row => row.dataset.orderId);
  assert.deepEqual(mountedIds(), ['page-0', 'page-1']);

  // When an ordinary scroll stops before the bottom of the current page.
  content.scrollTop = 10;
  content.dispatchEvent(new host.document.defaultView.Event('scroll'));

  // Then no later page is fabricated by a non-bottom scroll.
  assert.deepEqual(mountedIds(), ['page-0', 'page-1']);

  // When two actual bottom events expose the remaining pages.
  content.scrollTop = 64;
  content.dispatchEvent(new host.document.defaultView.Event('scroll'));
  assert.deepEqual(mountedIds(), ['page-0', 'page-1', 'page-2', 'page-3']);
  content.scrollTop = 224;
  content.dispatchEvent(new host.document.defaultView.Event('scroll'));

  // Then the final unfiltered page includes its real other-symbol row and the account remains unchanged.
  assert.deepEqual(mountedIds(), ['page-0', 'page-1', 'page-2', 'page-3', 'page-4']);
  assert.deepEqual(host.fixture.snapshot().orders, orders);
  assert.deepEqual(host.fixture.snapshot().events.filter(({ type }) => type === 'order-rows-page-loaded')
    .map(({ ids }) => ids.length), [4, 5]);
});

test('user sees native row mounting wait for its declared host deadline', (t) => {
  // Given the account tabs and filter are committed before React mounts its current rows.
  const host = openNativeHost(t, createCancelScenario({
    orders: mixedOrders, ui: { accountTab: 'openOrders' }, host: { orderRowsMountDelayMs: 200 },
  }));
  assert.equal(host.document.querySelectorAll('.open-order-row').length, 0);
  assert.equal(host.document.querySelector('[data-orders-loading]').textContent, 'Loading orders');

  // When the host reaches the exact row-mount deadline.
  t.mock.timers.tick(199);
  assert.equal(host.document.querySelectorAll('.open-order-row').length, 0);
  t.mock.timers.tick(1);

  // Then real current and other-symbol basic rows appear without modifying account state.
  assert.deepEqual(Array.from(host.document.querySelectorAll('[data-order-id]'), row => row.dataset.orderId),
    ['current-1', 'other-1']);
  assert.equal(host.document.querySelector('[data-orders-loading]'), null);
  assert.deepEqual(host.fixture.snapshot().orders, mixedOrders);
});

test('user cannot receive an old delayed native row mount in a newly selected symbol scope', (t) => {
  // Given one symbol-filtered mount is pending while another symbol has different orders.
  const host = openNativeHost(t, createCancelScenario({
    orders: mixedOrders, ui: { accountTab: 'openOrders', hideOtherSymbols: true },
    host: { orderRowsMountDelayMs: 200 },
  }));
  t.mock.timers.tick(100);

  // When the symbol changes before the retired mount would complete.
  host.fixture.switchSymbol(OTHER_SYMBOL);
  t.mock.timers.tick(100);

  // Then the old callback cannot publish rows into the new pending view.
  assert.equal(host.document.querySelectorAll('.open-order-row').length, 0);
  assert.deepEqual(host.fixture.snapshot().events.filter(({ type }) => type === 'order-rows-mounted'), []);

  // When the new symbol reaches its own host mount deadline.
  t.mock.timers.tick(100);

  // Then only that symbol's actual row becomes visible.
  assert.deepEqual(Array.from(host.document.querySelectorAll('[data-order-id]'), row => row.dataset.orderId), ['other-1']);
  assert.deepEqual(host.fixture.snapshot().events.filter(({ type }) => type === 'order-rows-mounted').map(({ ids }) => ids),
    [['other-1']]);
});

test('user can observe different native cancellation results for the actual requested row IDs', (t) => {
  // Given one row has an unresolved cancellation while another row is confirmed normally.
  const host = openNativeHost(t, createCancelScenario({
    orders: mixedOrders, ui: { accountTab: 'openOrders' },
    host: { rowCancelModesById: { 'current-1': 'unchanged' } },
  }));
  const clickRow = id => host.document.querySelector('[data-order-id="' + id + '"] svg')
    .dispatchEvent(new host.document.defaultView.MouseEvent('click', { bubbles: true }));

  // When the caller requests both concrete rows in order.
  clickRow('current-1');
  clickRow('other-1');
  t.mock.timers.tick(1000);

  // Then only the explicitly successful other-symbol request changes state and the unresolved row remains.
  assert.deepEqual(host.fixture.snapshot().orders, [ORDER_SETS.current[0], ...protectedOrders]);
  assert.deepEqual(host.fixture.snapshot().events.filter(({ type }) => type === 'row-cancel-cleared').map(({ orderId }) => orderId),
    ['other-1']);
  assert.deepEqual(host.fixture.snapshot().events.filter(({ type }) => type === 'row-cancel-requested').map(({ orderId }) => orderId),
    ['current-1', 'other-1']);
});

for (const host of [
  { orderRowsPageSize: 0 },
  { orderRowsMountDelayMs: -1 },
  { rowCancelModesById: { missing: 'clear' } },
  { rowCancelModesById: { 'current-1': 'invent-success' } },
]) {
  test(`user cannot create an ambiguous paged native order fixture ${JSON.stringify(host)}`, () => {
    // Given the declared host has invalid pagination, timing, or row-specific outcomes.
    const scenario = { orders: mixedOrders, host };

    // When a caller constructs the fixture from that declaration.
    const construct = () => createCancelScenario(scenario);

    // Then construction fails before any native DOM or account action occurs.
    assert.throws(construct, /Native row/);
  });
}

test('user receives native account count publications without losing the observed tab identities', (t) => {
  // Given the account has no positions or orders and the close form has zero available quantities.
  const host = openNativeHost(t, createCancelScenario({ ui: { tradeMode: 'CLOSE', accountTab: 'openOrders' } }));
  const tabs = host.document.querySelector('#account-tabs');
  const positionTab = tabs.querySelector('[data-account-tab="positions"]');
  const ordersTab = tabs.querySelector('[data-account-tab="openOrders"]');
  const position = { symbol: CURRENT_SYMBOL, side: 'SHORT', quantity: '4.5' };

  // When independent native publications add a position and both kinds of orders.
  host.fixture.setPositions([position]);
  host.fixture.setOrders(mixedOrders);

  // Then the existing observed elements carry the new counts and the form reflects the exact native quantity.
  assert.equal(host.document.querySelector('#account-tabs'), tabs);
  assert.equal(host.document.querySelector('[data-account-tab="positions"]'), positionTab);
  assert.equal(host.document.querySelector('[data-account-tab="openOrders"]'), ordersTab);
  assert.equal(positionTab.textContent, '仓位(1)');
  assert.equal(ordersTab.textContent, '当前委托(4)');
  assert.equal(host.document.querySelector('[data-open-orders-sub-tab="basic"]').textContent, '基础单(2)');
  assert.equal(host.document.querySelector('[data-open-orders-sub-tab="conditional"]').textContent, '条件委托(2)');
  assert.equal(host.document.querySelector('[data-testid="max-buy-amount"]').textContent, '可平 4.5 HYPE');
  assert.deepEqual(host.fixture.snapshot().positions, [position]);
  assert.deepEqual(host.fixture.snapshot().orders, mixedOrders);

  // When a later native publication clears both account collections.
  host.fixture.setPositions([]);
  host.fixture.setOrders([]);

  // Then the same counters return to zero and the obsolete native cancellation control disappears.
  assert.equal(host.document.querySelector('#account-tabs'), tabs);
  assert.equal(positionTab.textContent, '仓位(0)');
  assert.equal(ordersTab.textContent, '当前委托(0)');
  assert.equal(host.document.querySelector('[data-testid="max-buy-amount"]').textContent, '可平 0 HYPE');
  assert.equal(host.document.querySelector('[data-cancel-all]'), null);
  assert.deepEqual(host.fixture.snapshot().positions, []);
  assert.deepEqual(host.fixture.snapshot().orders, []);
});

test('user receives a native order drawing only after acceptance and its full chart save after 100 milliseconds', async (t) => {
  // Given the native chart contains one existing order and the new submit response is pending.
  const host = openNativeHost(t, createCancelScenario({
    orders: ORDER_SETS.current,
    host: { orderDrawingEvents: true },
  }));
  const api = host.document.querySelector('.chart-widget-root iframe').contentWindow.tradingViewApi;
  const drawings = [];
  api.subscribe('drawing_event', (drawingId, eventType) => {
    drawings.push({ drawingId, eventType, toolname: api.activeChart().getShapeById(drawingId).lineDataSource().toolname });
  });
  host.document.querySelector('.order-entry button').click();
  assert.deepEqual(drawings, []);

  // When the accepted response reaches the native caller and 99 milliseconds pass.
  await host.respond({ success: true });
  t.mock.timers.tick(99);

  // Then the real native shape API identifies the order while persistence still waits for its deadline.
  assert.deepEqual(drawings, [{ drawingId: 'order-submitted-1', eventType: 'create', toolname: 'LineToolOrder' }]);
  assert.deepEqual(host.fixture.snapshot().events.filter(({ type }) => type === 'chart-save-requested'), []);
  assert.deepEqual(host.fixture.snapshot().events.filter(({ type }) => type === 'chart-saved'), []);

  // When the complete native serialization delay elapses.
  t.mock.timers.tick(1);

  // Then exactly one native save contains both original and accepted order drawings.
  const events = host.fixture.snapshot().events;
  const snapshot = { checked: true, drawingIds: ['order-current-1', 'order-submitted-1'] };
  assert.deepEqual(events.filter(({ type }) => type === 'chart-save-requested').map(({ drawingId, eventType, snapshot }) => ({ drawingId, eventType, snapshot })),
    [{ drawingId: 'order-submitted-1', eventType: 'create', snapshot }]);
  assert.deepEqual(events.filter(({ type }) => type === 'chart-saved').map(({ snapshot }) => snapshot), [snapshot]);
});

for (const [outcome, payload] of [
  ['rejected', { success: false, code: '90800001', message: 'Fixture rejection' }],
  ['unknown', { result: 'unrecognized' }],
]) {
  test(`user receives no native order drawing from ${outcome} submission results`, async (t) => {
    // Given native chart event modeling is enabled for a pending submit.
    const host = openNativeHost(t, createCancelScenario({ host: { orderDrawingEvents: true } }));
    host.document.querySelector('.order-entry button').click();

    // When the explicit non-success payload arrives and every chart deadline passes.
    await host.respond(payload);
    t.mock.timers.tick(1_000);

    // Then neither an order shape nor chart persistence is fabricated.
    assert.deepEqual(host.fixture.snapshot().events.filter(({ type }) => type.startsWith('chart-')), []);
    const api = host.document.querySelector('.chart-widget-root iframe').contentWindow.tradingViewApi;
    assert.throws(() => api.activeChart().getShapeById('order-submitted-1'), /No native chart order drawing exists/);
  });
}

for (const changed of ['symbol', 'visibility']) {
  test(`user receives no off-chart order drawing when ${changed} changes before acceptance`, async (t) => {
    // Given the native request belongs to the original visible chart context.
    const host = openNativeHost(t, createCancelScenario({
      host: { orderDrawingEvents: true },
    }));
    host.document.querySelector('.order-entry button').click();

    // When a late successful response belongs to an unavailable order-drawing context.
    if (changed === 'symbol') host.fixture.switchSymbol(OTHER_SYMBOL);
    else host.document.querySelector('[data-chart-orders-checkbox]').click();
    await host.respond({ success: true });
    t.mock.timers.tick(1_000);

    // Then the API success stays visible without drawing an order into the wrong chart.
    assert.equal(host.fixture.snapshot().events.filter(({ type }) => type === 'order-submit-api-success').length, 1);
    assert.deepEqual(host.fixture.snapshot().events.filter(({ type }) => [
      'chart-drawing-event', 'chart-save-requested', 'chart-saved',
    ].includes(type)), []);
  });
}

test('user receives native drawing removals only for the clicked visible-chart order and can unsubscribe from later events', async (t) => {
  // Given both symbols have native orders while only the current-symbol drawing belongs to this chart.
  const host = openNativeHost(t, createCancelScenario({
    orders: ORDER_SETS.both,
    ui: { accountTab: 'openOrders' },
    host: { orderDrawingEvents: true },
  }));
  const api = host.document.querySelector('.chart-widget-root iframe').contentWindow.tradingViewApi;
  const drawings = [];
  const listener = (drawingId, eventType) => drawings.push({ drawingId, eventType });
  api.subscribe('drawing_event', listener);

  // When native row actions cancel both IDs and their chart serialization delay completes.
  host.document.querySelector('[data-order-id="current-1"] svg')
    .dispatchEvent(new host.document.defaultView.MouseEvent('click', { bubbles: true }));
  host.document.querySelector('[data-order-id="other-1"] svg')
    .dispatchEvent(new host.document.defaultView.MouseEvent('click', { bubbles: true }));
  t.mock.timers.tick(0);
  t.mock.timers.tick(100);

  // Then only the actual current chart drawing emits removal and its final save is empty.
  assert.deepEqual(drawings, [{ drawingId: 'order-current-1', eventType: 'remove' }]);
  assert.deepEqual(host.fixture.snapshot().events.filter(({ type }) => type === 'chart-saved').map(({ snapshot }) => snapshot),
    [{ checked: true, drawingIds: [] }]);
  assert.deepEqual(host.fixture.snapshot().orders, []);
  assert.throws(() => api.activeChart().getShapeById('order-current-1'), /No native chart order drawing exists/);

  // When the listener unsubscribes before a later accepted native submission.
  api.unsubscribe('drawing_event', listener);
  host.document.querySelector('.order-entry button').click();
  await host.respond({ success: true });
  t.mock.timers.tick(100);

  // Then the native chart still saves, but the removed subscriber cannot receive the create event.
  assert.deepEqual(drawings, [{ drawingId: 'order-current-1', eventType: 'remove' }]);
  assert.deepEqual(host.fixture.snapshot().events.filter(({ type }) => type === 'chart-saved').map(({ snapshot }) => snapshot), [
    { checked: true, drawingIds: [] },
    { checked: true, drawingIds: ['order-submitted-1'] },
  ]);
});

for (const enabled of [null, 'true', 1]) {
  test(`user cannot configure native drawing events with the ambiguous value ${JSON.stringify(enabled)}`, () => {
    // Given the host option contains an unsupported non-boolean value.
    const scenario = { host: { orderDrawingEvents: enabled } };

    // When the caller attempts to construct that native scenario.
    const construct = () => createCancelScenario(scenario);

    // Then the explicit drawing-mode contract rejects the value before any page can load.
    assert.throws(construct, /Native order drawing events must be explicitly enabled or disabled/);
  });
}
