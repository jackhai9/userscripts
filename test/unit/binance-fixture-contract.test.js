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
