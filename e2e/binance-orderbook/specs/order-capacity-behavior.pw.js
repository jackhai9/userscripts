import { test, expect } from '../test.js';
import { CURRENT_SYMBOL, OTHER_SYMBOL, createCancelScenario } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario, readFixtureState } from '../helpers/userscript-page.js';
import { installScenarioClock, pauseScenarioClock } from '../helpers/scenario-clock.js';

const STATUS = '#jh-binance-ladder-status';
const capacityRejection = { outcome: 'rejected', delivery: 'immediate', code: '90802025', message: 'Maximum open orders' };
const success = { outcome: 'success', delivery: 'immediate' };

function capacityOrders(count) {
  return [
    ...Array.from({ length: count }, (_, index) => ({
      id: 'same-' + index, symbol: CURRENT_SYMBOL, kind: 'basic', side: '平空',
      price: String(81 + index), quantity: '1',
    })),
    { id: 'opposite', symbol: CURRENT_SYMBOL, kind: 'basic', side: '平多', price: '999', quantity: '1' },
    { id: 'other', symbol: OTHER_SYMBOL, kind: 'basic', side: '平空', price: '999', quantity: '1' },
    { id: 'conditional', symbol: CURRENT_SYMBOL, kind: 'conditional', side: '平空', price: '999', quantity: '1' },
  ];
}

async function openCapacity(page, orders, host = {}, ui = {}) {
  await installScenarioClock(page);
  const scenario = createCancelScenario({
    positions: [{ symbol: CURRENT_SYMBOL, side: 'SHORT', quantity: '100' }],
    orders,
    ui: { tradeMode: 'CLOSE', accountTab: 'openOrders', hideOtherSymbols: false, ...ui },
    host: {
      submitApiResponses: [capacityRejection, success, success, success, success, { ...success, delivery: 'manual' }],
      ...host,
    },
  });
  const context = await openUserscriptScenario(page, scenario);
  await pauseScenarioClock(page);
  return { scenario, ...context };
}

/** Advance only the modeled host clock; every pass observes actual page state. */
async function advanceTo(page, description, readReached, { step = 250, limit = 25000 } = {}) {
  for (let elapsed = 0; elapsed <= limit; elapsed += step) {
    if (await readReached()) return;
    if (elapsed < limit) await page.clock.runFor(step);
  }
  throw new Error('The native scenario did not reach ' + description + ': ' + await page.locator(STATUS).textContent());
}

async function startContinuous(page) {
  await page.locator('[data-ladder-action="CLOSE_SHORT"]').evaluate(button => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }));
  });
}

async function finishFirstRound(page, context) {
  await advanceTo(page, 'the final pending response in the first round', async () => context.pendingSubmitSequences().includes(6));
  await context.releaseSubmitResponse(6);
  await advanceTo(page, 'five acknowledged orders', async () => (await page.locator(STATUS).textContent()).includes('累计 5 笔'),
    { step: 50, limit: 1000 });
  await page.locator('[data-ladder-stop]').evaluate(button => button.click());
  await page.clock.runFor(1000);
}

for (const mountDelay of [0, 120]) {
  test(`user frees only the fifty farthest same-direction slots with a native row mount delay of ${mountDelay} ms`, async ({ page }) => {
    // Given sixty matching orders span native pages and unrelated farther orders must remain untouched.
    const orders = capacityOrders(60);
    const context = await openCapacity(page, orders, { orderRowsPageSize: 8, orderRowsMountDelayMs: mountDelay });
    const initialScroll = await page.locator('.orders-content').evaluate(element => {
      element.scrollTop = 12;
      return element.scrollTop;
    });

    // When the continuous close round receives a capacity rejection and the user stops after its completed recovery round.
    await startContinuous(page);
    await finishFirstRound(page, context);

    // Then the full list determines exactly fifty farthest cancellations and preserves all other orders and confirmed progress.
    const state = await readFixtureState(page);
    expect(state.events.filter(({ type }) => type === 'row-cancel-cleared').map(({ orderId }) => orderId))
      .toEqual(Array.from({ length: 50 }, (_, index) => 'same-' + (59 - index)));
    expect(state.orders).toEqual([...orders.slice(0, 10), ...orders.slice(60)]);
    expect(state.events.filter(({ type }) => type === 'order-rows-page-loaded').some(({ ids }) => ids.includes('same-59'))).toBe(true);
    expect(state.events.filter(({ type }) => type === 'order-submit-api-success')).toHaveLength(5);
    expect(state.events.filter(({ type }) => type === 'order-submitted')).toHaveLength(6);
    expect(state.events.filter(({ type }) => type === 'cancel-requested')).toEqual([]);
    expect(state.accountTab).toBe('openOrders');
    expect(state.hideOtherSymbols).toBe(false);
    expect(state.showOrders).toBe(true);
    expect(await page.locator('.orders-content').evaluate(element => element.scrollTop)).toBe(initialScroll);
    await expect(page.locator(STATUS)).toContainText('累计 5 笔');
    await expect(page.locator(STATUS)).toContainText('撤 50 笔');
    expect(context.errors).toEqual([]);
});
}

test('user waits for the native order list to mount before choosing capacity cancellations', async ({ page }) => {
  // Given the Basic scope appears before any of its delayed native rows are rendered.
  const orders = capacityOrders(3);
  const context = await openCapacity(page, orders, { orderRowsMountDelayMs: 900 });
  expect(await page.locator('.open-order-row').count()).toBe(0);

  // When the real continuous close workflow receives its first capacity rejection.
  await startContinuous(page);
  await advanceTo(page, 'a capacity-rejected request', async () => (await readFixtureState(page)).events
    .some(({ type }) => type === 'order-submit-api-rejected'), { step: 50, limit: 1500 });

  // Then a still-unmounted list has not been treated as permission to submit or cancel.
  expect((await readFixtureState(page)).events.filter(({ type }) => type === 'row-cancel-requested')).toEqual([]);

  // When the delayed native rows arrive and the captured round completes.
  await finishFirstRound(page, context);

  // Then the actual three same-direction rows are cancelled in distance order before five successful replacements.
  const state = await readFixtureState(page);
  expect(state.events.filter(({ type }) => type === 'row-cancel-cleared').map(({ orderId }) => orderId))
    .toEqual(['same-2', 'same-1', 'same-0']);
  expect(state.orders).toEqual(orders.slice(3));
  expect(state.events.filter(({ type }) => type === 'order-submitted')).toHaveLength(6);
  expect(context.errors).toEqual([]);
});

test('user retains one confirmed released slot when the next native cancellation remains unconfirmed', async ({ page }) => {
  // Given the farthest cancellation succeeds but the next row stays present past its deadline.
  const orders = capacityOrders(3);
  const context = await openCapacity(page, orders, { rowCancelModesById: { 'same-1': 'unchanged' } });

  // When the actual continuous close round recovers from capacity and then completes its pending orders.
  await startContinuous(page);
  await finishFirstRound(page, context);

  // Then only the one confirmed removal is counted; the unresolved row and the unattempted row remain.
  const state = await readFixtureState(page);
  expect(state.events.filter(({ type }) => type === 'row-cancel-requested').map(({ orderId }) => orderId))
    .toEqual(['same-2', 'same-1']);
  expect(state.events.filter(({ type }) => type === 'row-cancel-cleared').map(({ orderId }) => orderId))
    .toEqual(['same-2']);
  expect(state.orders).toEqual(orders.filter(({ id }) => id !== 'same-2'));
  await expect(page.locator(STATUS)).toContainText('累计 5 笔');
  await expect(page.locator(STATUS)).toContainText('撤 1 笔');
  expect(context.errors).toEqual([]);
});

test('user receives a bounded capacity recovery failure when no matching native row can be found', async ({ page }) => {
  // Given only opposite-direction, other-symbol, and conditional orders exist.
  const orders = capacityOrders(0);
  const context = await openCapacity(page, orders, { submitApiResponses: [capacityRejection] });

  // When a capacity-rejected continuous close round searches the fully observed native scope.
  await startContinuous(page);
  await advanceTo(page, 'the precise no-matching-row reason', async () => (await page.locator(STATUS).textContent())
    .includes('未找到平空方向的可撤基础单'), { step: 50, limit: 2500 });
  await page.locator('[data-ladder-stop]').evaluate(button => button.click());
  await page.clock.runFor(1000);

  // Then no unrelated cancellation or second submit is issued and all orders are retained.
  const state = await readFixtureState(page);
  expect(state.orders).toEqual(orders);
  expect(state.events.filter(({ type }) => type === 'row-cancel-requested')).toEqual([]);
  expect(state.events.filter(({ type }) => type === 'order-submitted')).toHaveLength(1);
  await expect(page.locator(STATUS)).toContainText('已停止');
  expect(context.errors).toEqual([]);
});

for (const [name, retainedOrders, restoredSubTab] of [
  ['a short opposite-direction list', [capacityOrders(0)[0]], 'basic'],
  ['only another symbol', [capacityOrders(0)[1]], 'basic'],
  ['an explicit empty list', [], 'basic'],
  ['the original Conditional list', Array.from({ length: 10 }, (_, index) => ({
    ...capacityOrders(0)[2], id: 'conditional-' + index,
  })), 'conditional'],
]) {
  test(`user finishes delayed scroll restoration with ${name} after freeing capacity`, async ({ page }) => {
    // Given the original native scroll position belongs to a list that will change after cancellations.
    const orders = [...capacityOrders(10).slice(0, 10), ...retainedOrders];
    const context = await openCapacity(page, orders, { orderRowsPageSize: 8, orderRowsMountDelayMs: 120 },
      { openOrdersSubTab: restoredSubTab });
    await advanceTo(page, 'the original visible rows', async () => await page.locator('.open-order-row').count() === 8,
      { step: 20, limit: 200 });
    await page.locator('.orders-content').evaluate(element => { element.scrollTop = 12; });

    // When the user completes one capacity recovery round through the actual continuous action.
    await startContinuous(page);
    await finishFirstRound(page, context);

    // Then mounted short and empty lists complete immediately and a still-scrollable Conditional list restores its position.
    const state = await readFixtureState(page);
    expect(state.orders).toEqual(retainedOrders);
    expect(state.openOrdersSubTab).toBe(restoredSubTab);
    expect(state.hideOtherSymbols).toBe(false);
    expect(await page.locator('.orders-content').evaluate(element => element.scrollTop))
      .toBe(restoredSubTab === 'conditional' ? 12 : 0);
    const filterRestoredAt = state.events.filter(event => event.type === 'hide-other-symbols' && event.value === false).at(-1).at;
    const resumedAt = state.events.filter(event => event.type === 'order-submitted')[1].at;
    expect(resumedAt - filterRestoredAt).toBeLessThan(1000);
    expect(state.events.filter(({ type }) => type === 'row-cancel-cleared')).toHaveLength(10);
    expect(state.events.filter(({ type }) => type === 'order-submit-api-success')).toHaveLength(5);
    expect(state.events.filter(({ type }) => type === 'cancel-requested')).toEqual([]);
    expect(context.errors).toEqual([]);
  });
}

test('user keeps the new symbol scope when a route switch interrupts delayed scroll restoration', async ({ page }) => {
  // Given capacity recovery has an original scroll position and restoration rows arrive after their filter.
  const context = await openCapacity(page, capacityOrders(10), { orderRowsPageSize: 8, orderRowsMountDelayMs: 300 });
  await advanceTo(page, 'the original visible rows', async () => await page.locator('.open-order-row').count() === 8,
    { step: 20, limit: 400 });
  await page.locator('.orders-content').evaluate(element => { element.scrollTop = 12; });
  await startContinuous(page);
  // A 100 ms probe still observes the 300 ms native mount window while keeping
  // ten-row cancellation progress bounded under precise coverage instrumentation.
  await advanceTo(page, 'the filter restored before its rows', async () => (await readFixtureState(page)).events
    .some(event => event.type === 'hide-other-symbols' && event.value === false), { step: 100, limit: 25000 });
  expect(await page.locator('[data-orders-loading]').count()).toBe(1);

  // When Binance changes symbol while the old restoration is waiting for the native rows.
  await page.evaluate(symbol => window.__BINANCE_FIXTURE__.switchSymbol(symbol), OTHER_SYMBOL);
  await page.clock.runFor(3000);

  // Then old cleanup cannot change the new scope, and the rejected order is never retried for the new symbol.
  const state = await readFixtureState(page);
  expect(new URL(page.url()).pathname).toBe('/zh-CN/futures/' + OTHER_SYMBOL);
  expect(state.events.filter(({ type }) => type === 'order-submitted')).toHaveLength(1);
  expect(state.events.filter(({ type }) => type === 'row-cancel-cleared')).toHaveLength(10);
  expect(state.events.filter(({ type }) => type === 'cancel-requested')).toEqual([]);
  expect(await page.locator('.orders-content').evaluate(element => element.scrollTop)).toBe(0);
  expect(context.errors).toEqual([]);
});

test('user does not cancel another capacity batch after a second confirmed rejection in the same round', async ({ page }) => {
  // Given sixty matching rows exist and the native API rejects both the initial and resumed submission.
  const orders = capacityOrders(60);
  const context = await openCapacity(page, orders, {
    orderRowsPageSize: 8, submitApiResponses: [capacityRejection, capacityRejection],
  });

  // When one full recovery still cannot satisfy capacity and the user stops in the declared recovery wait.
  await startContinuous(page);
  await advanceTo(page, 'the second rejected response', async () => (await readFixtureState(page)).events
    .filter(({ type }) => type === 'order-submit-api-rejected').length === 2);
  await page.clock.runFor(100);
  await page.locator('[data-ladder-stop]').evaluate(button => button.click());
  await page.clock.runFor(3000);

  // Then only the first fifty cancellations are counted and no duplicated or third submission occurs.
  const state = await readFixtureState(page);
  expect(state.orders).toEqual([...orders.slice(0, 10), ...orders.slice(60)]);
  expect(state.events.filter(({ type }) => type === 'row-cancel-cleared')).toHaveLength(50);
  expect(state.events.filter(({ type }) => type === 'order-submitted')).toHaveLength(2);
  expect(state.events.filter(({ type }) => type === 'order-submit-api-success')).toEqual([]);
  await expect(page.locator(STATUS)).toContainText('撤 50 笔');
  await expect(page.locator(STATUS)).toContainText('累计 0 笔');
  expect(context.errors).toEqual([]);
});
