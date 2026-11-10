import { test, expect } from '../test.js';
import { CURRENT_SYMBOL, OTHER_SYMBOL, createCancelScenario } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario, readFixtureState } from '../helpers/userscript-page.js';
import { installScenarioClock, pauseScenarioClock } from '../helpers/scenario-clock.js';

const ACTIONS = [
  { action: 'OPEN_LONG', label: '开多', opposite: '开空', mode: 'OPEN', side: 'LONG' },
  { action: 'OPEN_SHORT', label: '开空', opposite: '开多', mode: 'OPEN', side: 'SHORT' },
  { action: 'CLOSE_LONG', label: '平多', opposite: '平空', mode: 'CLOSE', side: 'LONG' },
  { action: 'CLOSE_SHORT', label: '平空', opposite: '平多', mode: 'CLOSE', side: 'SHORT' },
];

function replacementOrders(direction, quantity = '0.2') {
  const order = (id, side, extra = {}) => ({
    id, symbol: CURRENT_SYMBOL, kind: 'basic', side, price: '82', quantity, ...extra,
  });
  return [
    order('target-1', direction.label, { price: '83' }),
    order('target-2', direction.label, { price: '84' }),
    order('same-direction-extra', direction.label, { price: '85' }),
    order('opposite-direction', direction.opposite),
    order('other-symbol', direction.label, { symbol: OTHER_SYMBOL }),
    order('conditional-current', direction.label, { kind: 'conditional' }),
  ].map((item, index) => ({ ...item, orderId: 1001 + index, clientOrderId: item.id + '-client' }));
}

function scenarioFor(direction, overrides = {}) {
  return createCancelScenario({
    positions: [{ symbol: CURRENT_SYMBOL, side: direction.side, quantity: '100' }],
    orders: replacementOrders(direction),
    ...overrides,
    ui: {
      tradeMode: direction.mode, accountTab: 'history', openOrdersSubTab: 'conditional',
      hideOtherSymbols: false, openableQuantity: direction.mode === 'OPEN' ? '0.04' : '10',
      ...overrides.ui,
    },
    host: {
      openableQuantityAfterRowCancel: '10',
      submitApiResponses: [
        ...(direction.mode === 'CLOSE' ? [{
          outcome: 'rejected', delivery: 'immediate', code: '90802022', message: 'Reduce only order rejected',
        }] : []),
        ...Array.from({ length: 5 }, () => ({ outcome: 'success', delivery: 'immediate' })),
      ],
      ...overrides.host,
    },
  });
}

for (const direction of ACTIONS) {
  test(`user replaces only the required current-symbol basic ${direction.label} rows before completing the ladder`, async ({ page }) => {
    // Given matching, opposite, unrelated, and conditional rows coexist behind a different account tab.
    const scenario = scenarioFor(direction);
    const { errors } = await openUserscriptScenario(page, scenario, { replacementStream: true });
    const status = page.locator('#jh-binance-ladder-status');

    // When a minimum-quantity shortage or explicit reduce-only rejection triggers the real replacement workflow.
    await page.locator('[data-ladder-action="' + direction.action + '"]').click();

    // Then only enough matching SVG rows are cancelled, the complete ladder succeeds, and the original view returns.
    await expect(status).toContainText('已完成', { timeout: 12000 });
    await expect(status).toContainText('已挂 5/5');
    await expect(status).toContainText('已撤 2');
    const state = await readFixtureState(page);
    expect(state.events.filter(({ type }) => type === 'row-cancel-cleared').map(({ orderId }) => orderId))
      .toEqual(['target-1', 'target-2']);
    expect(state.orders).toEqual(scenario.orders.slice(2));
    expect(state.accountTab).toBe('history');
    expect(state.openOrdersSubTab).toBe('conditional');
    expect(state.hideOtherSymbols).toBe(false);
    expect(state.showOrders).toBe(true);
    expect(state.events.filter(({ type }) => type === 'cancel-requested' || type === 'dialog-opened')).toEqual([]);
    expect(state.events.filter(({ type }) => type === 'order-submit-api-success')).toHaveLength(5);
    expect(state.events.filter(({ type }) => type === 'order-submitted').map(({ action }) => action))
      .toEqual(Array(direction.mode === 'OPEN' ? 5 : 6).fill(direction.label));
    expect(errors).toEqual([]);
  });
}

for (const [name, orders, reason] of [
  ['insufficient matching quantity', replacementOrders(ACTIONS[0], '0.01'), '同向可撤挂单总量不足本轮目标'],
  ['opposite-direction orders only', replacementOrders(ACTIONS[0]).filter(order => order.id === 'opposite-direction'), '未找到开多方向的可撤基础单'],
  ['no basic orders', replacementOrders(ACTIONS[0]).filter(order => order.kind === 'conditional'), '未找到开多方向的可撤基础单'],
]) {
  test(`user keeps existing orders when replacement finds ${name}`, async ({ page }) => {
    // Given the visible native order scope cannot cover the captured replacement quantity.
    const scenario = scenarioFor(ACTIONS[0], { orders });
    const { errors } = await openUserscriptScenario(page, scenario, { replacementStream: true });

    // When the actual open-long ladder reaches its minimum-quantity replacement preflight.
    await page.locator('[data-ladder-action="OPEN_LONG"]').click();

    // Then the specific refusal preserves every order and restores the original account scope.
    await expect(page.locator('#jh-binance-ladder-status')).toContainText(reason);
    const state = await readFixtureState(page);
    expect(state.orders).toEqual(scenario.orders);
    expect(state.accountTab).toBe('history');
    expect(state.openOrdersSubTab).toBe('conditional');
    expect(state.hideOtherSymbols).toBe(false);
    expect(state.events.filter(({ type }) => type === 'row-cancel-requested' || type === 'order-submitted')).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('user can stop replacement while a native row decision is pending without another cancellation or submit', async ({ page }) => {
  // Given native row cancellation needs a user decision and cannot complete automatically.
  await installScenarioClock(page);
  const scenario = scenarioFor(ACTIONS[0], { host: { rowCancelMode: 'dialog' } });
  const { errors } = await openUserscriptScenario(page, scenario, { replacementStream: true });
  await page.locator('[data-ladder-action="OPEN_LONG"]').click();
  await expect(page.locator('[data-row-dialog-action="confirm"]')).toBeVisible();
  const before = await readFixtureState(page);
  expect(before.orders).toEqual(scenario.orders);
  expect(before.events.filter(({ type }) => type === 'row-cancel-cleared')).toEqual([]);

  // When the user stops the ladder and declines the outstanding native cancellation.
  await page.locator('[data-ladder-stop]').evaluate(button => button.click());
  await expect(page.locator('#jh-binance-ladder-status')).toContainText('阶梯开多已停止');
  await expect(page.locator('[data-row-dialog-action="cancel"]')).toBeVisible();
  const pending = await readFixtureState(page);
  expect(pending.accountTab).toBe('openOrders');
  expect(pending.openOrdersSubTab).toBe('basic');
  expect(pending.hideOtherSymbols).toBe(true);
  await page.locator('[data-row-dialog-action="cancel"]').click();
  await pauseScenarioClock(page);
  await page.clock.runFor(10000);

  // Then the stopped workflow has one unconfirmed request, no cancellations, and no submitted order.
  await expect(page.locator('#jh-binance-ladder-status')).toContainText('阶梯开多已停止');
  const state = await readFixtureState(page);
  expect(state.orders).toEqual(scenario.orders);
  expect(state.events.filter(({ type }) => type === 'row-cancel-requested')).toHaveLength(1);
  expect(state.events.filter(({ type }) => type === 'row-cancel-cleared' || type === 'order-submitted')).toEqual([]);
  expect(errors).toEqual([]);
});

test('user must confirm each native row dialog before replacement can continue', async ({ page }) => {
  // Given enough matching rows exist but each native row action requires explicit confirmation.
  const scenario = scenarioFor(ACTIONS[0], { host: { rowCancelMode: 'dialog' } });
  const { errors } = await openUserscriptScenario(page, scenario, { replacementStream: true });

  // When the ladder opens the first native row dialog.
  await page.locator('[data-ladder-action="OPEN_LONG"]').click();
  const confirm = page.locator('[data-row-dialog-action="confirm"]');
  await expect(confirm).toBeVisible();

  // Then the script leaves the decision to the user with all orders still present.
  expect((await readFixtureState(page)).orders).toEqual(scenario.orders);
  expect((await readFixtureState(page)).events.filter(({ type }) => type === 'order-submitted')).toEqual([]);

  // When the user confirms the two required native cancellations in sequence.
  await confirm.click();
  await expect.poll(async () => (await readFixtureState(page)).events
    .filter(({ type }) => type === 'row-dialog-opened').length).toBe(2);
  await confirm.click();

  // Then only those two rows are removed and the real planner submits five acknowledged replacements.
  await expect(page.locator('#jh-binance-ladder-status')).toContainText('已挂 5/5', { timeout: 12000 });
  const state = await readFixtureState(page);
  expect(state.orders).toEqual(scenario.orders.slice(2));
  expect(state.events.filter(({ type }) => type === 'order-submit-api-success')).toHaveLength(5);
  expect(state.events.filter(({ type }) => type === 'cancel-requested')).toEqual([]);
  expect(errors).toEqual([]);
});

test('user counts the pending replacement cancellation after Stop and sends no further orders', async ({ page }) => {
  // Given the first cancellation is held by the native endpoint.
  const scenario = scenarioFor(ACTIONS[0]);
  const host = await openUserscriptScenario(page, scenario, { replacementStream: true, holdRowCancelResponses: true });
  await page.locator('[data-ladder-action="OPEN_LONG"]').click();
  const first = scenario.orders[0];
  await expect.poll(host.pendingCancelOrderIds).toEqual([first.orderId]);

  // When Stop arrives before the exact matching cancellation receipt.
  await page.locator('[data-ladder-stop]').evaluate(button => button.click());
  host.releaseCancelResponse(first.orderId);

  // Then the completed cancellation counts once, and no other cancellation or submission follows.
  const status = page.locator('#jh-binance-ladder-status');
  await expect(status).toContainText('阶梯开多已停止');
  await expect(status).toContainText('已撤 1 笔');
  const state = await readFixtureState(page);
  expect(state.events.filter(({ type }) => type === 'row-cancel-requested').map(({ orderId }) => orderId))
    .toEqual([first.id]);
  expect(state.events.filter(({ type }) => type === 'order-submitted')).toEqual([]);
  expect(host.errors).toEqual([]);
});

test('user stops replacement when the clicked row disappears but the response identifies another order', async ({ page }) => {
  // Given the first native row cancellation is pending and enough eligible rows remain.
  const scenario = scenarioFor(ACTIONS[0]);
  const host = await openUserscriptScenario(page, scenario, { replacementStream: true, holdRowCancelResponses: true });
  await page.locator('[data-ladder-action="OPEN_LONG"]').click();
  const [first, other] = scenario.orders;
  await expect.poll(host.pendingCancelOrderIds).toEqual([first.orderId]);

  // When the native list remounts without the first row and the exchange returns an unrelated ID.
  await page.evaluate(rows => window.__BINANCE_FIXTURE__.setOrders(rows), scenario.orders.slice(1));
  host.releaseCancelResponse(first.orderId, { status: 200, body: {
    success: true, code: '000000',
    data: { orderId: other.orderId, clientOrderId: other.clientOrderId, status: 'CANCELED' },
  } });

  // Then the replacement fails without claiming a cancellation or clicking another target.
  const status = page.locator('#jh-binance-ladder-status');
  await expect(status).toContainText('阶梯开多失败');
  await expect(status).not.toContainText('已撤');
  const state = await readFixtureState(page);
  expect(state.orders).toEqual(scenario.orders.slice(1));
  expect(state.events.filter(({ type }) => type === 'row-cancel-requested').map(({ orderId }) => orderId))
    .toEqual([first.id]);
  expect(state.events.filter(({ type }) => type === 'order-submitted')).toEqual([]);
  expect(host.errors).toEqual([]);
});

function terminalFor(order, executedQty) {
  return { s: order.symbol, i: order.orderId, c: order.clientOrderId, x: 'CANCELED', X: 'CANCELED',
    q: order.quantity, z: executedQty };
}

test('user stops replacement when a fill leaves the originally selected orders unable to cover the plan', async ({ page }) => {
  // Given only the first two eligible orders are needed at preflight.
  const scenario = scenarioFor(ACTIONS[0]);
  const host = await openUserscriptScenario(page, scenario, {
    replacementStream: true, holdRowCancelResponses: true, holdTerminalUpdates: true,
  });
  await page.locator('[data-ladder-action="OPEN_LONG"]').click();
  const [first] = scenario.orders;
  await expect.poll(host.pendingCancelOrderIds).toEqual([first.orderId]);

  // When intervening fills leave only 0.01 of the first order cancelled.
  host.publishTerminalUpdate(terminalFor(first, '0.19'));
  host.releaseCancelResponse(first.orderId);

  // Then the known cancellation counts once and neither the second target nor the spare is sacrificed.
  const status = page.locator('#jh-binance-ladder-status');
  await expect(status).toContainText('同向可撤挂单数量不足');
  await expect(status).toContainText('已撤 1 笔');
  const state = await readFixtureState(page);
  expect(state.events.filter(({ type }) => type === 'row-cancel-requested').map(({ orderId }) => orderId))
    .toEqual([first.id]);
  expect(state.events.filter(({ type }) => type === 'order-submitted')).toEqual([]);
  expect(host.errors).toEqual([]);
});

test('user requires a trusted account event even after the exchange confirms and removes the order', async ({ page }) => {
  // Given a successful cancellation awaits its server-originated final quantity.
  await installScenarioClock(page);
  const scenario = scenarioFor(ACTIONS[0]);
  const host = await openUserscriptScenario(page, scenario, { replacementStream: true, holdTerminalUpdates: true });
  await page.locator('[data-ladder-action="OPEN_LONG"]').click();
  const first = scenario.orders[0];
  await expect.poll(async () => (await readFixtureState(page)).orders).toEqual(scenario.orders.slice(1));

  // When page code dispatches a matching synthetic message and the native response deadline expires.
  await page.evaluate(order => {
    window.__fixtureReplacementSocket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ data: { e: 'ORDER_TRADE_UPDATE', o: order } }),
    }));
  }, terminalFor(first, '0'));
  await page.clock.runFor(13000);

  // Then the HTTP success counts while the unverified quantity never authorizes another cancel or a replacement.
  const status = page.locator('#jh-binance-ladder-status');
  await expect(status).toContainText('无法确认已撤挂单数量');
  await expect(status).toContainText('已撤 1 笔');
  const state = await readFixtureState(page);
  expect(state.events.filter(({ type }) => type === 'row-cancel-requested').map(({ orderId }) => orderId))
    .toEqual([first.id]);
  expect(state.events.filter(({ type }) => type === 'order-submitted')).toEqual([]);
  expect(host.errors).toEqual([]);
});

test('user can cancel the second selected order while its predecessor remains visible after both receipts', async ({ page }) => {
  // Given the native list lags its confirmed cancellations and each HTTP response is held separately.
  await installScenarioClock(page);
  const scenario = scenarioFor(ACTIONS[0], { host: { rowCancelDelayMs: 3000 } });
  const host = await openUserscriptScenario(page, scenario, {
    replacementStream: true, holdRowCancelResponses: true, holdTerminalUpdates: true,
  });
  await page.locator('[data-ladder-action="OPEN_LONG"]').click();
  const [first, second] = scenario.orders;
  await expect.poll(host.pendingCancelOrderIds).toEqual([first.orderId]);

  // When the first HTTP receipt arrives alone and a terminal update follows while the same row stays mounted.
  host.releaseCancelResponse(first.orderId);
  await expect.poll(async () => (await readFixtureState(page)).events.filter(({ type }) =>
    type === 'row-cancel-response').map(({ orderId }) => orderId)).toEqual([first.id]);
  expect(host.pendingCancelOrderIds()).toEqual([]);
  host.publishTerminalUpdate(terminalFor(first, '0'));

  // Then exactly the second selected ID is clicked without waiting for the first row's removal.
  await expect.poll(host.pendingCancelOrderIds).toEqual([second.orderId]);
  expect((await readFixtureState(page)).orders).toEqual(scenario.orders);
  // When the final cancellation is confirmed but its order still appears in the native list.
  host.publishTerminalUpdate(terminalFor(second, '0'));
  host.releaseCancelResponse(second.orderId);
  await expect.poll(async () => (await readFixtureState(page)).events.filter(({ type }) =>
    type === 'row-cancel-response').map(({ orderId }) => orderId)).toEqual([first.id, second.id]);
  await page.clock.runFor(500);

  // Then the script stays in the scoped list until its batch disappears, and only then replaces it.
  const pending = await readFixtureState(page);
  expect(pending.orders).toEqual(scenario.orders);
  expect(pending.accountTab).toBe('openOrders');
  expect(pending.events.filter(({ type }) => type === 'order-submitted')).toEqual([]);
  await page.clock.runFor(3000);
  await expect(page.locator('#jh-binance-ladder-status')).toContainText('已挂 5/5', { timeout: 10000 });
  expect((await readFixtureState(page)).orders).toEqual(scenario.orders.slice(2));
  expect(host.errors).toEqual([]);
});

test('user preserves a new order that remounts with the next selected row’s display values', async ({ page }) => {
  // Given the second selected order can be replaced externally while the first click awaits its receipt.
  const scenario = scenarioFor(ACTIONS[0]);
  const host = await openUserscriptScenario(page, scenario, { replacementStream: true, holdRowCancelResponses: true });
  await page.locator('[data-ladder-action="OPEN_LONG"]').click();
  const [first, second] = scenario.orders;
  await expect.poll(host.pendingCancelOrderIds).toEqual([first.orderId]);

  // When a different order takes the second row's place with identical visible values and the first cancellation succeeds.
  const newOrder = { ...second, id: 'external', orderId: 2345, clientOrderId: 'external' };
  const remounted = scenario.orders.map(item => item === second ? newOrder : item);
  await page.evaluate(orders => window.__BINANCE_FIXTURE__.setOrders(orders), remounted);
  host.releaseCancelResponse(first.orderId);

  // Then the new ID is untouched and the ladder reports only its confirmed first cancellation.
  const status = page.locator('#jh-binance-ladder-status');
  await expect(status).toContainText('无法确认待替换订单');
  await expect(status).toContainText('已撤 1 笔');
  const state = await readFixtureState(page);
  expect(state.orders).toContainEqual(newOrder);
  expect(state.events.filter(({ type }) => type === 'row-cancel-requested').map(({ orderId }) => orderId))
    .toEqual([first.id]);
  expect(state.events.filter(({ type }) => type === 'order-submitted')).toEqual([]);
  expect(host.errors).toEqual([]);
});

test('user continues reduce-only close recovery when a selected order fills before its cancellation', async ({ page }) => {
  // Given continuous close hits a reduce-only rejection while the authoritative position is unchanged.
  test.setTimeout(40_000);
  const direction = ACTIONS[2];
  const rejected = { outcome: 'rejected', delivery: 'immediate', code: '90802022', message: 'Reduce only order rejected' };
  const accepted = Array.from({ length: 15 }, () => ({ outcome: 'success', delivery: 'immediate' }));
  const scenario = scenarioFor(direction, { host: { submitApiResponses: [rejected, ...accepted] } });
  const host = await openUserscriptScenario(page, scenario, { replacementStream: true, holdRowCancelResponses: true });
  const unchanged = ['100', '100'];
  const reads = [];
  let filled = false;
  await page.route('**/bapi/futures/v6/private/future/user-data/user-position', async route => {
    const quantity = unchanged.length ? unchanged.shift() : filled ? '99.8' : '100';
    reads.push(quantity);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      success: true, data: [{ symbol: CURRENT_SYMBOL, positionSide: direction.side, positionAmount: quantity }],
    }) });
  });
  await page.locator('[data-ladder-action="' + direction.action + '"]').click({ modifiers: ['Alt'] });
  const [first, second] = scenario.orders;
  await expect.poll(host.pendingCancelOrderIds, { timeout: 15_000 }).toEqual([first.orderId]);

  // When the second selected order fills and leaves the native list before the first cancellation completes.
  await page.evaluate(rows => window.__BINANCE_FIXTURE__.setOrders(rows), scenario.orders.filter(order => order !== second));
  filled = true;
  host.releaseCancelResponse(first.orderId);

  // Then the runner rereads the decreased position and submits the rebuilt plan instead of failing the task.
  const status = page.locator('#jh-binance-ladder-status');
  await expect(status).toContainText('待替换挂单已成交或消失', { timeout: 10_000 });
  await expect.poll(async () => (await readFixtureState(page)).events
    .filter(({ type }) => type === 'order-submit-api-success').length, { timeout: 15_000 }).toBeGreaterThanOrEqual(5);
  expect(reads).toContain('99.8');
  await expect(status).not.toContainText('失败');

  // When the user stops the task.
  await page.locator('[data-ladder-stop]').click();

  // Then only the first selected order was ever cancelled and the filled order was never clicked.
  await expect(page.locator('[data-ladder-stop]')).toHaveCount(0, { timeout: 10_000 });
  await expect(status).not.toContainText('失败');
  const state = await readFixtureState(page);
  expect(state.events.filter(({ type }) => type === 'row-cancel-requested').map(({ orderId }) => orderId))
    .toEqual([first.id]);
  expect(host.errors).toEqual([]);
});

test('user stops reduce-only close recovery when a selected order disappears but the position never decreases', async ({ page }) => {
  // Given every close submission is rejected as reduce-only while the authoritative position stays unchanged.
  test.setTimeout(40_000);
  const direction = ACTIONS[2];
  const rejected = { outcome: 'rejected', delivery: 'immediate', code: '90802022', message: 'Reduce only order rejected' };
  const scenario = scenarioFor(direction, { host: { submitApiResponses: Array.from({ length: 6 }, () => rejected) } });
  const host = await openUserscriptScenario(page, scenario, { replacementStream: true, holdRowCancelResponses: true });
  await page.route('**/bapi/futures/v6/private/future/user-data/user-position', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, data: [{ symbol: CURRENT_SYMBOL, positionSide: direction.side, positionAmount: '100' }] }),
  }));
  await page.locator('[data-ladder-action="' + direction.action + '"]').click({ modifiers: ['Alt'] });
  const [first, second] = scenario.orders;
  await expect.poll(host.pendingCancelOrderIds, { timeout: 15_000 }).toEqual([first.orderId]);

  // When the second selected order leaves the list without any position decrease.
  await page.evaluate(rows => window.__BINANCE_FIXTURE__.setOrders(rows), scenario.orders.filter(order => order !== second));
  host.releaseCancelResponse(first.orderId);

  // Then the runner stops on the persisting conflict without cancelling the spare order.
  const status = page.locator('#jh-binance-ladder-status');
  await expect(status).toContainText('替换后仍有只减仓冲突', { timeout: 25_000 });
  const state = await readFixtureState(page);
  expect(state.events.filter(({ type }) => type === 'row-cancel-requested').map(({ orderId }) => orderId))
    .toEqual([first.id]);
  expect(state.orders).toContainEqual(expect.objectContaining({ id: 'same-direction-extra' }));
  expect(host.errors).toEqual([]);
});

test('user stops reduce-only close recovery when a selected order is committed but not rendered', async ({ page }) => {
  // Given the native list renders two rows at a time and a reduce-only replacement awaits its first cancellation.
  test.setTimeout(40_000);
  const direction = ACTIONS[2];
  const scenario = scenarioFor(direction, { host: { orderRowsPageSize: 2 } });
  const host = await openUserscriptScenario(page, scenario, { replacementStream: true, holdRowCancelResponses: true });
  await page.route('**/bapi/futures/v6/private/future/user-data/user-position', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, data: [{ symbol: CURRENT_SYMBOL, positionSide: direction.side, positionAmount: '100' }] }),
  }));
  await page.locator('[data-ladder-action="' + direction.action + '"]').click({ modifiers: ['Alt'] });
  const [first, second, ...rest] = scenario.orders;
  await expect.poll(host.pendingCancelOrderIds, { timeout: 15_000 }).toEqual([first.orderId]);

  // When an external order is listed ahead of the second target, pushing it out of the rendered rows only.
  const external = { ...second, id: 'external', orderId: 2345, clientOrderId: 'external', price: '86' };
  await page.evaluate(rows => window.__BINANCE_FIXTURE__.setOrders(rows), [first, external, second, ...rest]);
  host.releaseCancelResponse(first.orderId);

  // Then the still-committed target stays unconfirmable and the task stops without clicking it or the external order.
  const status = page.locator('#jh-binance-ladder-status');
  await expect(status).toContainText('无法确认待替换订单', { timeout: 15_000 });
  const state = await readFixtureState(page);
  expect(state.events.filter(({ type }) => type === 'row-cancel-requested').map(({ orderId }) => orderId))
    .toEqual([first.id]);
  expect(state.orders).toContainEqual(external);
  expect(host.errors).toEqual([]);
});

test('user retains a newly selected Conditional tab while the cancelled batch is clearing', async ({ page }) => {
  // Given both native cancellations are accepted but their rows remain on the current Basic tab.
  const scenario = scenarioFor(ACTIONS[0], { host: { rowCancelDelayMs: 5000 } });
  const host = await openUserscriptScenario(page, scenario, { replacementStream: true });
  await page.locator('[data-ladder-action="OPEN_LONG"]').click();
  await expect.poll(async () => (await readFixtureState(page)).events.filter(({ type }) =>
    type === 'row-cancel-response').map(({ orderId }) => orderId)).toEqual(['target-1', 'target-2']);

  // When the user switches to Conditional before the completed batch's list update.
  await page.locator('[data-open-orders-sub-tab="conditional"]').click();

  // Then no trade is submitted, both HTTP receipts count, and cleanup keeps the user's new scope.
  const status = page.locator('#jh-binance-ladder-status');
  await expect(status).toContainText('当前委托范围已变化');
  await expect(status).toContainText('已撤 2 笔');
  const state = await readFixtureState(page);
  expect(state.openOrdersSubTab).toBe('conditional');
  expect(state.accountTab).toBe('openOrders');
  expect(state.hideOtherSymbols).toBe(true);
  expect(state.events.filter(({ type }) => type === 'order-submitted')).toEqual([]);
  expect(host.errors).toEqual([]);
});
