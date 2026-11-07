import { test, expect } from '../test.js';
import { readFixtureState } from '../helpers/userscript-page.js';
import { STATUS, advanceTo, capacityOrders, capacityRejection, finishFirstRound, openCapacity, startContinuous } from '../helpers/order-capacity-scenario.js';

const holdReceipts = { holdRowCancelResponses: true };

function clickedIds(state) {
  return state.events.filter(({ type }) => type === 'row-cancel-requested').map(({ orderId }) => orderId);
}

async function waitForRequests(page, host, ids) {
  await advanceTo(page, 'native cancel POSTs for ' + ids.join(', '),
    () => ids.every(id => host.pendingCancelOrderIds().includes(id)), { step: 25, limit: 1800 });
  expect(host.pendingCancelOrderIds().sort()).toEqual([...ids].sort());
}

test('user drains two in-flight cancellations after Stop and counts only matching receipts', async ({ page }) => {
  // Given the two farthest cancellations are held at the native HTTP boundary.
  const orders = capacityOrders(4);
  const host = await openCapacity(page, orders, {}, {}, holdReceipts);
  await startContinuous(page);
  await waitForRequests(page, host, [1003, 1002]);

  // When the user stops before either response, and the second cancellation confirms first.
  await page.locator('[data-ladder-stop]').evaluate(button => button.click());
  host.releaseCancelResponse(1002);
  await advanceTo(page, 'one receipt counted while stopping', async () => (await page.locator(STATUS).textContent()).includes('撤 1 笔'),
    { step: 25, limit: 500 });

  // Then the task keeps its Stop phase and the remaining in-flight cancellation stays attached.
  await expect(page.locator(STATUS)).toContainText('停止中');
  expect(clickedIds(await readFixtureState(page))).toEqual(['same-3', 'same-2']);
  expect(host.pendingCancelOrderIds()).toEqual([1003]);

  // When the first request also succeeds after Stop.
  host.releaseCancelResponse(1003);
  await advanceTo(page, 'the stopped status', async () => (await page.locator(STATUS).textContent()).includes('已停止'));

  // Then both receipts count, no third click or replacement occurred, and the original filter was restored.
  const state = await readFixtureState(page);
  await expect(page.locator(STATUS)).toContainText('累计 0 笔 · 撤 2 笔');
  expect(clickedIds(state)).toEqual(['same-3', 'same-2']);
  expect(state.events.filter(({ type }) => type === 'order-submitted')).toHaveLength(1);
  expect(state.orders).toEqual(orders.filter(({ id }) => !['same-3', 'same-2'].includes(id)));
  expect(state.hideOtherSymbols).toBe(false);
  expect(host.errors).toEqual([]);
});

test('user refills one free slot after an out-of-order receipt while the cancelled row is still visible', async ({ page }) => {
  // Given the first two requests are held and native row removal lags behind the API.
  const orders = capacityOrders(4);
  const host = await openCapacity(page, orders, { rowCancelDelayMs: 3500 }, {}, holdReceipts);
  await startContinuous(page);
  await waitForRequests(page, host, [1003, 1002]);

  // When the second receipt arrives first, while the first request and both rows remain.
  host.releaseCancelResponse(1002);
  await waitForRequests(page, host, [1003, 1001]);

  // Then the third target owns the released worker, independent of the native list rerender.
  const state = await readFixtureState(page);
  expect(state.orders).toEqual(orders);
  expect(clickedIds(state)).toEqual(['same-3', 'same-2', 'same-1']);
  await expect(page.locator(STATUS)).toContainText('撤 1 笔');

  // When Stop is followed by the two outstanding receipts in reverse dispatch order.
  await page.locator('[data-ladder-stop]').evaluate(button => button.click());
  host.releaseCancelResponse(1001);
  host.releaseCancelResponse(1003);
  await advanceTo(page, 'completion after all three receipts', async () => (await page.locator(STATUS).textContent()).includes('已停止'));

  // Then the nearest target was never dispatched and only the confirmed three count.
  await expect(page.locator(STATUS)).toContainText('累计 0 笔 · 撤 3 笔');
  expect(clickedIds(await readFixtureState(page))).toEqual(['same-3', 'same-2', 'same-1']);
  expect(host.errors).toEqual([]);
});

const valid = { success: true, code: '000000', data: { orderId: 1001, clientOrderId: 'client-1', status: 'CANCELED' } };
for (const [reason, response] of [
  ['another in-flight order identity', { status: 200, body: { ...valid, data: { ...valid.data, orderId: 1002, clientOrderId: 'client-2' } } }],
  ['a different client order ID', { status: 200, body: { ...valid, data: { ...valid.data, clientOrderId: 'foreign' } } }],
  ['a different symbol', { status: 200, body: { ...valid, data: { ...valid.data, symbol: 'BTCUSDT' } } }],
  ['a non-cancelled status', { status: 200, body: { ...valid, data: { ...valid.data, status: 'FILLED' } } }],
  ['an exchange rejection', { status: 200, body: { success: false, code: '200002', message: 'Order unavailable' } }],
  ['a nonzero exchange code', { status: 200, body: { ...valid, code: '000001' } }],
  ['an unexpected HTTP success status', { status: 201, body: valid }],
  ['an HTTP error', { status: 502, body: valid }],
]) {
  test(`user retains one confirmed released slot when the second response carries ${reason}`, async ({ page }) => {
    // Given two requests are in flight while a third eligible order remains untouched.
    const orders = capacityOrders(3);
    const host = await openCapacity(page, orders, {}, {}, holdReceipts);
    await startContinuous(page);
    await waitForRequests(page, host, [1002, 1001]);

    // When the second response is invalid and even its DOM row disappears independently.
    await page.evaluate(remaining => window.__BINANCE_FIXTURE__.setOrders(remaining), orders.filter(({ orderId }) => orderId !== 1001));
    host.releaseCancelResponse(1001, response);
    await advanceTo(page, 'native consumption of the invalid response', async () => (await readFixtureState(page)).events
      .some(({ type, orderId }) => type === 'row-cancel-response' && orderId === 'same-1'), { step: 25, limit: 500 });
    host.releaseCancelResponse(1002);
    await finishFirstRound(page, host);

    // Then only the matching receipt counted, dispatch stopped on the invalid receipt, and the round used the known slot.
    const state = await readFixtureState(page);
    expect(clickedIds(state)).toEqual(['same-2', 'same-1']);
    expect(state.orders).toEqual(orders.filter(({ orderId }) => ![1001, 1002].includes(orderId)));
    await expect(page.locator(STATUS)).toContainText('累计 5 笔 · 撤 1 笔');
    expect(host.errors).toEqual([]);
  });
}

test('user counts a target that vanished before dispatch as a free slot without claiming a cancellation', async ({ page }) => {
  // Given two requests occupy the window while the third selected order can fill independently.
  const orders = capacityOrders(3);
  const host = await openCapacity(page, orders, {}, {}, holdReceipts);
  await startContinuous(page);
  await waitForRequests(page, host, [1002, 1001]);

  // When the nearest selected row disappears externally before the window can dispatch it.
  await page.evaluate(remaining => window.__BINANCE_FIXTURE__.setOrders(remaining), orders.filter(({ orderId }) => orderId !== 1000));
  host.releaseCancelResponse(1001);
  await advanceTo(page, 'the confirmed and externally released slots', async () => (await page.locator(STATUS).textContent())
    .includes('释放挂单名额 2/3'), { step: 25, limit: 1800 });

  // Then one receipt and one externally released slot are distinguished before the remaining response arrives.
  await expect(page.locator(STATUS)).toContainText('撤 1 笔');
  host.releaseCancelResponse(1002);
  await finishFirstRound(page, host);
  const state = await readFixtureState(page);
  expect(clickedIds(state)).toEqual(['same-2', 'same-1']);
  expect(state.orders).toEqual(orders.slice(3));
  await expect(page.locator(STATUS)).toContainText('累计 5 笔 · 撤 2 笔');
  expect(host.errors).toEqual([]);
});

test('user decides a native row dialog before any further capacity cancellation is dispatched', async ({ page }) => {
  // Given the farthest native Basic order opens a confirmation instead of issuing its POST.
  const orders = capacityOrders(3);
  const host = await openCapacity(page, orders, { rowCancelModesById: { 'same-2': 'dialog' } }, {}, holdReceipts);
  await startContinuous(page);
  await advanceTo(page, 'the native row dialog', async () => (await readFixtureState(page)).dialogOpen);

  // When the confirmation remains open on the paused scenario clock.
  await page.clock.runFor(500);
  expect(host.pendingCancelOrderIds()).toEqual([]);
  expect(clickedIds(await readFixtureState(page))).toEqual(['same-2']);
  await expect(page.locator('[data-row-dialog-action="confirm"]')).toBeVisible();

  // Then only the user's own confirmation sends the captured request.
  await page.locator('[data-row-dialog-action="confirm"]').evaluate(button => button.click());
  await expect.poll(() => host.pendingCancelOrderIds().includes(1002)).toBe(true);
  await page.locator('[data-ladder-stop]').evaluate(button => button.click());
  const issued = host.pendingCancelOrderIds();
  for (const id of issued) host.releaseCancelResponse(id);
  await advanceTo(page, 'completion after the confirmed dialog', async () => (await page.locator(STATUS).textContent()).includes('已停止'));
  const state = await readFixtureState(page);
  expect(state.events.filter(({ type }) => type === 'dialog-closed').map(({ action }) => action)).toEqual(['row-confirm']);
  expect(state.events.filter(({ type }) => type === 'order-submitted')).toHaveLength(1);
  await expect(page.locator(STATUS)).toContainText('撤 ' + issued.length + ' 笔');
  expect(host.errors).toEqual([]);
});

test('user retains all rows and ends the continuous session when a dismissed dialog releases no slot', async ({ page }) => {
  // Given the native cancel button requires the user to decide.
  const orders = capacityOrders(3);
  const host = await openCapacity(page, orders, { rowCancelModesById: { 'same-2': 'dialog' } }, {}, holdReceipts);
  await startContinuous(page);
  await advanceTo(page, 'the native confirmation', async () => (await readFixtureState(page)).dialogOpen);

  // When the user dismisses the dialog without authorizing the cancellation.
  await page.locator('[data-row-dialog-action="cancel"]').evaluate(button => button.click());
  await advanceTo(page, 'the round ending without a confirmed receipt', async () => (await page.locator(STATUS).textContent())
    .includes('未收到匹配的成功撤单回执'), { step: 50, limit: 4500 });
  await page.clock.runFor(4000);

  // Then the scope is restored and all orders survive without another native click or submit.
  const state = await readFixtureState(page);
  expect(clickedIds(state)).toEqual(['same-2']);
  expect(state.orders).toEqual(orders);
  expect(state.hideOtherSymbols).toBe(false);
  expect(host.pendingCancelOrderIds()).toEqual([]);
  expect(state.events.filter(({ type }) => type === 'order-submitted')).toHaveLength(1);
  await expect(page.locator('[data-ladder-stop]')).toHaveCount(0);
  await expect(page.locator(STATUS)).toContainText('累计 0 笔');
  await expect(page.locator(STATUS)).not.toContainText('撤 1 笔');
  expect(host.errors).toEqual([]);
});

test('user drains unanswered requests to their deadline and ignores late successes after Stop', async ({ page }) => {
  // Given two native POSTs are held by the exchange and the nearest row has not been clicked.
  const orders = capacityOrders(3);
  const host = await openCapacity(page, orders, {}, {}, holdReceipts);
  await startContinuous(page);
  await waitForRequests(page, host, [1002, 1001]);

  // When the user presses Stop and Binance does not reply within the native receipt deadline.
  await page.locator('[data-ladder-stop]').evaluate(button => button.click());
  await page.clock.runFor(12000);
  await advanceTo(page, 'stopped after pending receipt deadlines', async () => (await page.locator(STATUS).textContent()).includes('已停止'));
  const finalStatus = await page.locator(STATUS).textContent();
  expect(finalStatus).toContain('累计 0 笔');
  expect(finalStatus).not.toContain('撤 ');
  expect((await readFixtureState(page)).orders).toEqual(orders);

  // Then even eventual native success cannot reopen the task, count either unknown result, or dispatch more work.
  host.releaseCancelResponse(1001);
  host.releaseCancelResponse(1002);
  await advanceTo(page, 'both late responses consumed by the native page', async () => (await readFixtureState(page)).events
    .filter(({ type }) => type === 'row-cancel-cleared').length === 2, { step: 25, limit: 500 });
  await expect(page.locator(STATUS)).toHaveText(finalStatus);
  const state = await readFixtureState(page);
  expect(clickedIds(state)).toEqual(['same-2', 'same-1']);
  expect(state.orders).toEqual(orders.filter(({ orderId }) => ![1001, 1002].includes(orderId)));
  expect(state.events.filter(({ type }) => type === 'order-submitted')).toHaveLength(1);
  expect(host.errors).toEqual([]);
});

test('user keeps a newly selected Conditional scope while two previously issued cancellations drain', async ({ page }) => {
  // Given the capacity recovery has issued two cancellations in the current-symbol Basic scope.
  const orders = capacityOrders(3);
  const host = await openCapacity(page, orders, {}, {}, holdReceipts);
  await startContinuous(page);
  await waitForRequests(page, host, [1002, 1001]);

  // When the user selects Conditional before the two Basic-order receipts arrive.
  await page.locator('[data-open-orders-sub-tab="conditional"]').evaluate(tab => tab.click());
  await advanceTo(page, 'the selected Conditional list', async () => (await readFixtureState(page)).openOrdersSubTab === 'conditional');
  host.releaseCancelResponse(1001);
  host.releaseCancelResponse(1002);
  await advanceTo(page, 'the changed-scope reason', async () => (await page.locator(STATUS).textContent()).includes('当前委托范围已变化'));

  // Then only those two receipts count, and neither another click nor restoration overwrites the user's selection.
  const state = await readFixtureState(page);
  expect(state.openOrdersSubTab).toBe('conditional');
  expect(clickedIds(state)).toEqual(['same-2', 'same-1']);
  expect(state.events.filter(({ type }) => type === 'order-submitted')).toHaveLength(1);
  await expect(page.locator(STATUS)).toContainText('累计 0 笔 · 撤 2 笔');
  expect(host.errors).toEqual([]);
});

test('user ends the session before a later capacity batch can click an order with an unknown prior result', async ({ page }) => {
  // Given both the first and second round will encounter a confirmed capacity rejection.
  const orders = capacityOrders(3);
  const success = { outcome: 'success', delivery: 'immediate' };
  const host = await openCapacity(page, orders, {
    submitApiResponses: [capacityRejection, ...Array(5).fill(success), capacityRejection],
  }, {}, holdReceipts);
  await startContinuous(page);
  await waitForRequests(page, host, [1002, 1001]);

  // When an invalid receipt leaves the middle order unknown but the farthest cancellation frees one slot.
  host.releaseCancelResponse(1001, { status: 200, body: { ...valid, data: { ...valid.data, clientOrderId: 'foreign' } } });
  await advanceTo(page, 'the mismatched receipt consumed by Binance', async () => (await readFixtureState(page)).events
    .some(({ type, orderId }) => type === 'row-cancel-response' && orderId === 'same-1'), { step: 25, limit: 500 });
  host.releaseCancelResponse(1002);
  await advanceTo(page, 'the first completed round and second capacity rejection', async () => (await readFixtureState(page)).events
    .filter(({ type }) => type === 'order-submit-api-rejected').length === 2);

  // Then the new batch stops before any click, leaving both the unknown and untouched orders intact.
  await advanceTo(page, 'the terminal unknown-order reason', async () => (await page.locator(STATUS).textContent())
    .includes('本次连续任务已有未确认的撤单'));
  await page.clock.runFor(4000);
  const state = await readFixtureState(page);
  expect(host.pendingCancelOrderIds()).toEqual([]);
  expect(clickedIds(state)).toEqual(['same-2', 'same-1']);
  expect(state.orders).toEqual(orders.filter(({ orderId }) => orderId !== 1002));
  expect(state.events.filter(({ type }) => type === 'order-submit-api-success')).toHaveLength(5);
  expect(state.events.filter(({ type }) => type === 'order-submitted')).toHaveLength(7);
  await expect(page.locator('[data-ladder-stop]')).toHaveCount(0);
  await expect(page.locator(STATUS)).toContainText('累计 5 笔 · 撤 1 笔');
  expect(host.errors).toEqual([]);
});
