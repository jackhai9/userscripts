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
  ];
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
    const { errors } = await openUserscriptScenario(page, scenario);
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
    const { errors } = await openUserscriptScenario(page, scenario);

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
  const { errors } = await openUserscriptScenario(page, scenario);
  await page.locator('[data-ladder-action="OPEN_LONG"]').click();
  await expect(page.locator('[data-row-dialog-action="confirm"]')).toBeVisible();
  const before = await readFixtureState(page);
  expect(before.orders).toEqual(scenario.orders);
  expect(before.events.filter(({ type }) => type === 'row-cancel-cleared')).toEqual([]);

  // When the user stops the ladder and declines the outstanding native cancellation.
  await page.locator('[data-ladder-stop]').evaluate(button => button.click());
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
  const { errors } = await openUserscriptScenario(page, scenario);

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
