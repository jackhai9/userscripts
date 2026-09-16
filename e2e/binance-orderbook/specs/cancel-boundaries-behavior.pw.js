import { test, expect } from '../test.js';
import {
  ORDER_SETS,
  POSITION_SETS,
  createCancelScenario,
} from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario, readFixtureState } from '../helpers/userscript-page.js';
import { installScenarioClock, pauseScenarioClock } from '../helpers/scenario-clock.js';

const CANCEL = '[data-ladder-cancel-symbol="true"]';
const STATUS = '#jh-binance-ladder-status';
const FILTER = '[role="checkbox"][name="hideOtherSymbol"]';
const ALL_ORDERS = [
  ...ORDER_SETS.both,
  ...ORDER_SETS.both.map((order) => ({
    ...order,
    id: `conditional-${order.id}`,
    kind: 'conditional',
  })),
];

function expectOrdersUntouched(state, scenario) {
  expect(state.orders).toEqual(scenario.orders);
  expect(state.events.filter(({ type }) => [
    'cancel-requested',
    'cancel-cleared',
    'row-cancel-requested',
    'row-cancel-cleared',
    'order-submitted',
  ].includes(type))).toEqual([]);
  expect(state.events.filter(({ type }) => [
    'chart-orders-checked',
    'chart-save-requested',
    'chart-saved',
  ].includes(type))).toEqual([]);
  expect(state.showOrders).toBe(scenario.ui.showOrders);
}

function expectOriginalUi(state, scenario) {
  expect({
    accountTab: state.accountTab,
    openOrdersSubTab: state.openOrdersSubTab,
    hideOtherSymbols: state.hideOtherSymbols,
    showOrders: state.showOrders,
  }).toEqual({
    accountTab: scenario.ui.accountTab,
    openOrdersSubTab: scenario.ui.openOrdersSubTab,
    hideOtherSymbols: scenario.ui.hideOtherSymbols,
    showOrders: scenario.ui.showOrders,
  });
}

test('user keeps all orders when the current-orders tab is missing', async ({ page }) => {
  // Given both symbols have Basic and conditional orders but the current-orders tab is absent.
  const scenario = createCancelScenario({ positions: POSITION_SETS.both, orders: ALL_ORDERS });
  await installScenarioClock(page);
  const { errors } = await openUserscriptScenario(page, scenario);
  await pauseScenarioClock(page);
  await page.locator('[data-account-tab="openOrders"]').evaluate((tab) => tab.remove());

  // When the user requests cancellation and the bounded restoration lookup expires.
  await page.locator(CANCEL).click();
  await page.clock.runFor(2300);

  // Then the panel reports the missing tab without opening confirmation or changing account state.
  await expect(page.locator(STATUS)).toHaveText('未能打开当前委托');
  await expect(page.locator(CANCEL)).toBeEnabled();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const state = await readFixtureState(page);
  expectOrdersUntouched(state, scenario);
  expectOriginalUi(state, scenario);
  expect(state.events.filter(({ type }) => type === 'account-tab')).toEqual([]);
  expect(state.events.filter(({ type }) => type === 'dialog-opened')).toEqual([]);
  expect(errors).toEqual([]);
});

test('user sees a bounded refusal when the current-orders tab never becomes selected', async ({ page }) => {
  // Given the visible current-orders tab has not acquired its native click handler.
  const scenario = createCancelScenario({ positions: POSITION_SETS.both, orders: ALL_ORDERS });
  await installScenarioClock(page);
  const { errors } = await openUserscriptScenario(page, scenario);
  await pauseScenarioClock(page);
  await page.locator('[data-account-tab="openOrders"]').evaluate((tab) => {
    tab.replaceWith(tab.cloneNode(true));
  });

  // When the user requests cancellation before the tab-selection deadline.
  await page.locator(CANCEL).click();
  await page.clock.runFor(2100);

  // Then selection remains pending and no confirmation or cancellation has occurred.
  await expect(page.locator(CANCEL)).toBeDisabled();
  await expect(page.locator(STATUS)).not.toHaveText('未能打开当前委托');
  await expect(page.locator('[data-account-tab="positions"]')).toHaveAttribute('aria-selected', 'true');
  expectOrdersUntouched(await readFixtureState(page), scenario);

  // When the selection and restoration lookup deadlines both expire.
  await page.clock.runFor(2400);

  // Then the action is ready again with an explicit failure and every original order preserved.
  await expect(page.locator(STATUS)).toHaveText('未能打开当前委托');
  await expect(page.locator(CANCEL)).toBeEnabled();
  const state = await readFixtureState(page);
  expectOrdersUntouched(state, scenario);
  expectOriginalUi(state, scenario);
  expect(state.events.filter(({ type }) => type === 'dialog-opened')).toEqual([]);
  expect(state.events.filter(({ type }) => type === 'account-tab')).toEqual([]);
  expect(errors).toEqual([]);
});

for (const scopeState of ['missing', 'duplicated']) {
  test(`user cannot cancel orders when the selected current-orders panel is ${scopeState}`, async ({ page }) => {
    // Given the selected tab has either no matching panel or two competing visible panels.
    const scenario = createCancelScenario({
      positions: POSITION_SETS.both,
      orders: ALL_ORDERS,
      ui: { accountTab: 'openOrders', hideOtherSymbols: true, showOrders: false },
    });
    await installScenarioClock(page);
    const { errors } = await openUserscriptScenario(page, scenario);
    await pauseScenarioClock(page);
    await page.locator('#OPEN_ORDERS').evaluate((scope, scopeState) => {
      if (scopeState === 'missing') scope.remove();
      else scope.after(scope.cloneNode(true));
    }, scopeState);

    // When the user requests cancellation before the unique-panel discovery deadline.
    await page.locator(CANCEL).click();
    await page.clock.runFor(2100);

    // Then the workflow remains pending without selecting an unverified cancellation scope.
    await expect(page.locator(CANCEL)).toBeDisabled();
    await expect(page.locator(STATUS)).not.toHaveText('未找到当前委托面板');
    expectOrdersUntouched(await readFixtureState(page), scenario);

    // When the discovery and restoration lookup deadlines expire.
    await page.clock.runFor(2400);

    // Then a missing-panel result preserves all orders and the original tab, filter, and chart setting.
    await expect(page.locator(STATUS)).toHaveText('未找到当前委托面板');
    await expect(page.locator(CANCEL)).toBeEnabled();
    const state = await readFixtureState(page);
    expectOrdersUntouched(state, scenario);
    expectOriginalUi(state, scenario);
    expect(state.events.filter(({ type }) => type === 'dialog-opened')).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('user preserves conditional orders when the Basic sub-tab is missing', async ({ page }) => {
  // Given conditional orders are visible but the native Basic sub-tab has disappeared.
  const scenario = createCancelScenario({
    positions: POSITION_SETS.both,
    orders: ALL_ORDERS,
    ui: { accountTab: 'openOrders', openOrdersSubTab: 'conditional' },
  });
  await installScenarioClock(page);
  const { errors } = await openUserscriptScenario(page, scenario);
  await pauseScenarioClock(page);
  await page.locator('[data-open-orders-sub-tab="basic"]').evaluate((tab) => tab.remove());

  // When the user requests cancellation from the userscript panel.
  await page.locator(CANCEL).click();
  await page.clock.runFor(100);

  // Then Basic selection fails explicitly without using the conditional panel's cancellation control.
  await expect(page.locator(STATUS)).toHaveText('未找到当前委托基础单');
  await expect(page.locator(CANCEL)).toBeEnabled();
  await expect(page.locator('[data-open-orders-sub-tab="conditional"]')).toHaveAttribute('aria-selected', 'true');
  const state = await readFixtureState(page);
  expectOrdersUntouched(state, scenario);
  expectOriginalUi(state, scenario);
  expect(state.events.filter(({ type }) => type === 'dialog-opened')).toEqual([]);
  expect(state.events.filter(({ type }) => type === 'open-orders-sub-tab')).toEqual([]);
  expect(errors).toEqual([]);
});

test('user cannot cancel conditional orders when Basic selection never commits', async ({ page }) => {
  // Given the visible Basic tab lacks its native handler while conditional orders remain selected.
  const scenario = createCancelScenario({
    positions: POSITION_SETS.both,
    orders: ALL_ORDERS,
    ui: { accountTab: 'openOrders', openOrdersSubTab: 'conditional', showOrders: false },
  });
  await installScenarioClock(page);
  const { errors } = await openUserscriptScenario(page, scenario);
  await pauseScenarioClock(page);
  await page.locator('[data-open-orders-sub-tab="basic"]').evaluate((tab) => {
    tab.replaceWith(tab.cloneNode(true));
  });

  // When the user requests cancellation and Basic selection is still within its deadline.
  await page.locator(CANCEL).click();
  await page.clock.runFor(2100);

  // Then the action remains pending with conditional orders preserved and no confirmation.
  await expect(page.locator(CANCEL)).toBeDisabled();
  await expect(page.locator('[data-open-orders-sub-tab="conditional"]')).toHaveAttribute('aria-selected', 'true');
  expectOrdersUntouched(await readFixtureState(page), scenario);

  // When the Basic-selection deadline expires.
  await page.clock.runFor(200);

  // Then the script refuses cancellation and leaves the original conditional view intact.
  await expect(page.locator(STATUS)).toHaveText('未找到当前委托基础单');
  await expect(page.locator(CANCEL)).toBeEnabled();
  const state = await readFixtureState(page);
  expectOrdersUntouched(state, scenario);
  expectOriginalUi(state, scenario);
  expect(state.events.filter(({ type }) => type === 'dialog-opened')).toEqual([]);
  expect(errors).toEqual([]);
});

for (const filterState of ['missing', 'indeterminate']) {
  test(`user keeps both symbols' orders when the symbol filter is ${filterState}`, async ({ page }) => {
    // Given both symbols are visible and the filter cannot report a usable checked state.
    const scenario = createCancelScenario({
      positions: POSITION_SETS.both,
      orders: ALL_ORDERS,
      ui: { accountTab: 'openOrders', hideOtherSymbols: false },
    });
    await installScenarioClock(page);
    const { errors } = await openUserscriptScenario(page, scenario);
    await pauseScenarioClock(page);
    await page.locator(FILTER).evaluate((filter, filterState) => {
      if (filterState === 'missing') filter.remove();
      else filter.setAttribute('aria-checked', 'mixed');
    }, filterState);

    // When the user requests current-symbol cancellation.
    await page.locator(CANCEL).click();
    await page.clock.runFor(100);

    // Then the unverified filter prevents confirmation and all orders and chart settings survive.
    await expect(page.locator(STATUS)).toHaveText('未确认仅显示当前交易对挂单');
    await expect(page.locator(CANCEL)).toBeEnabled();
    const state = await readFixtureState(page);
    expectOrdersUntouched(state, scenario);
    expectOriginalUi(state, scenario);
    expect(state.events.filter(({ type }) => type === 'dialog-opened')).toEqual([]);
    expect(state.events.filter(({ type }) => type === 'hide-other-symbols')).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('user cannot cancel while the symbol checkbox ignores its requested change', async ({ page }) => {
  // Given all-symbol orders are visible and the filter has not acquired its native click handler.
  const scenario = createCancelScenario({
    positions: POSITION_SETS.both,
    orders: ALL_ORDERS,
    ui: { accountTab: 'openOrders', hideOtherSymbols: false },
  });
  await installScenarioClock(page);
  const { errors } = await openUserscriptScenario(page, scenario);
  await pauseScenarioClock(page);
  await page.locator(FILTER).evaluate((filter) => filter.replaceWith(filter.cloneNode(true)));

  // When cancellation requests the filter but its one-second acknowledgement is still pending.
  await page.locator(CANCEL).click();
  await page.clock.runFor(900);

  // Then no cancellation occurs while the checkbox still reports the original unchecked state.
  await expect(page.locator(CANCEL)).toBeDisabled();
  await expect(page.locator(FILTER)).toHaveAttribute('aria-checked', 'false');
  expectOrdersUntouched(await readFixtureState(page), scenario);

  // When the checkbox acknowledgement deadline expires.
  await page.clock.runFor(200);

  // Then the panel reports unconfirmed filtering without opening the native confirmation.
  await expect(page.locator(STATUS)).toHaveText('未确认仅显示当前交易对挂单');
  await expect(page.locator(CANCEL)).toBeEnabled();
  const state = await readFixtureState(page);
  expectOrdersUntouched(state, scenario);
  expectOriginalUi(state, scenario);
  expect(state.events.filter(({ type }) => type === 'dialog-opened')).toEqual([]);
  expect(state.events.filter(({ type }) => type === 'hide-other-symbols')).toEqual([]);
  expect(errors).toEqual([]);
});

test('user cannot cancel when a checked symbol filter still exposes another symbol row', async ({ page }) => {
  // Given the checkbox is checked but a stale other-symbol row remains in the native Basic list.
  const scenario = createCancelScenario({
    positions: POSITION_SETS.both,
    orders: ALL_ORDERS,
    ui: { accountTab: 'openOrders', hideOtherSymbols: true, showOrders: false },
  });
  await installScenarioClock(page);
  const { errors } = await openUserscriptScenario(page, scenario);
  await pauseScenarioClock(page);
  await page.locator('#OPEN_ORDERS .orders-content').evaluate((content, otherOrder) => {
    const staleRow = content.querySelector('.open-order-row').cloneNode(true);
    staleRow.dataset.orderId = otherOrder.id;
    const cells = staleRow.querySelectorAll('span');
    cells[1].textContent = `${otherOrder.symbol} 永续`;
    cells[3].textContent = otherOrder.side;
    cells[4].textContent = otherOrder.price;
    cells[5].textContent = otherOrder.quantity;
    content.append(staleRow);
  }, ORDER_SETS.both[1]);

  // When the user requests cancellation while the filtered-row settling deadline is still pending.
  await page.locator(CANCEL).click();
  await page.clock.runFor(1500);

  // Then the script waits for row evidence instead of trusting the checked box alone.
  await expect(page.locator(CANCEL)).toBeDisabled();
  await expect(page.locator(FILTER)).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#OPEN_ORDERS .open-order-row')).toHaveCount(2);
  expectOrdersUntouched(await readFixtureState(page), scenario);

  // When the stale other-symbol row outlasts the filter-settling deadline.
  await page.clock.runFor(200);

  // Then the mixed scope is refused and both Basic and conditional orders remain unchanged.
  await expect(page.locator(STATUS)).toHaveText('未确认仅显示当前交易对挂单');
  await expect(page.locator(CANCEL)).toBeEnabled();
  const state = await readFixtureState(page);
  expectOrdersUntouched(state, scenario);
  expectOriginalUi(state, scenario);
  expect(state.events.filter(({ type }) => type === 'dialog-opened')).toEqual([]);
  expect(errors).toEqual([]);
});

for (const controlState of ['missing', 'duplicated', 'disabled']) {
  test(`user receives a safe refusal when the native cancel control is ${controlState}`, async ({ page }) => {
    // Given confirmed current-symbol Basic rows remain but their cancel control is not uniquely usable.
    const scenario = createCancelScenario({
      positions: POSITION_SETS.both,
      orders: ALL_ORDERS,
      ui: { accountTab: 'openOrders', hideOtherSymbols: true },
    });
    await installScenarioClock(page);
    const { errors } = await openUserscriptScenario(page, scenario);
    await pauseScenarioClock(page);
    await page.locator('[data-cancel-all]').evaluate((control, controlState) => {
      if (controlState === 'missing') control.remove();
      else if (controlState === 'duplicated') control.after(control.cloneNode(true));
      else control.setAttribute('aria-disabled', 'true');
    }, controlState);

    // When the user requests cancellation from the userscript panel.
    await page.locator(CANCEL).click();
    await page.clock.runFor(100);

    // Then a missing-control result preserves orders without clicking an ambiguous or disabled control.
    await expect(page.locator(STATUS)).toHaveText('未找到当前委托的全撤按钮');
    await expect(page.locator(CANCEL)).toBeEnabled();
    const state = await readFixtureState(page);
    expectOrdersUntouched(state, scenario);
    expectOriginalUi(state, scenario);
    expect(state.events.filter(({ type }) => type === 'dialog-opened')).toEqual([]);
    expect(errors).toEqual([]);
  });
}
