import { test, expect } from '@playwright/test';

import {
  ORDER_SETS,
  POSITION_SETS,
  createCancelScenario,
} from '../scenarios/cancel-current-symbol.js';
import {
  openUserscriptScenario,
  readFixtureState,
} from '../helpers/userscript-page.js';
import {
  assertStableGeometry,
  finishInteractionProbe,
  installInteractionProbe,
} from '../helpers/interaction-probe.js';

const CANCEL_BUTTON_SELECTOR = '[data-ladder-cancel-symbol="true"]';

function otherSymbolOrders(scenario) {
  return scenario.orders.filter((order) => order.symbol !== scenario.currentSymbol);
}

async function expectRestoredState(page, scenario) {
  await expect.poll(async () => {
    const state = await readFixtureState(page);
    return {
      accountTab: state.accountTab,
      openOrdersSubTab: state.openOrdersSubTab,
      hideOtherSymbols: state.hideOtherSymbols,
      showOrders: state.showOrders,
    };
  }).toEqual({
    accountTab: scenario.ui.accountTab,
    openOrdersSubTab: scenario.ui.openOrdersSubTab,
    hideOtherSymbols: scenario.ui.hideOtherSymbols,
    showOrders: scenario.ui.showOrders,
  });
}

test('no position and no orders returns immediate stable no-order feedback', async ({ page }) => {
  const scenario = createCancelScenario();
  const { errors } = await openUserscriptScenario(page, scenario);
  await installInteractionProbe(page, CANCEL_BUTTON_SELECTOR);

  await page.getByRole('button', { name: '撤本币挂单' }).click();
  await expect(page.getByRole('button', { name: '无挂单' })).toBeVisible();

  const state = await readFixtureState(page);
  expect(state.dialogOpen).toBe(false);
  expect(state.orders).toEqual([]);
  await expectRestoredState(page, scenario);
  const probe = await finishInteractionProbe(page);
  expect(probe.firstFeedbackMs).not.toBeNull();
  expect(probe.firstFeedbackMs).toBeLessThanOrEqual(100);
  expect(probe.longTasks).toEqual([]);
  assertStableGeometry(expect, probe.baseline, probe.current);
  expect(errors).toEqual([]);
});

test('other-symbol position and orders never open a current-symbol cancel dialog', async ({ page }) => {
  const scenario = createCancelScenario({
    positions: POSITION_SETS.other,
    orders: ORDER_SETS.other,
    ui: { hideOtherSymbols: false, accountTab: 'positions' },
  });
  const { errors } = await openUserscriptScenario(page, scenario);

  await page.getByRole('button', { name: '撤本币挂单' }).click();
  await expect(page.getByRole('button', { name: '无挂单' })).toBeVisible();

  const state = await readFixtureState(page);
  expect(state.dialogOpen).toBe(false);
  expect(state.orders).toEqual(otherSymbolOrders(scenario));
  await expectRestoredState(page, scenario);
  expect(errors).toEqual([]);
});

test('cancelling the native dialog preserves current and other orders and restores UI', async ({ page }) => {
  const scenario = createCancelScenario({
    positions: POSITION_SETS.both,
    orders: ORDER_SETS.both,
    ui: {
      hideOtherSymbols: false,
      accountTab: 'positions',
      openOrdersSubTab: 'conditional',
      showOrders: true,
    },
  });
  const { errors } = await openUserscriptScenario(page, scenario);
  await installInteractionProbe(page, CANCEL_BUTTON_SELECTOR);

  await page.getByRole('button', { name: '撤本币挂单' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect.poll(async () => (await readFixtureState(page)).showOrders).toBe(false);
  await page.getByRole('button', { name: '取消' }).click();
  await expect(page.getByText('HYPEUSDT 已取消撤单，已恢复页面状态')).toBeVisible();

  const state = await readFixtureState(page);
  expect(state.orders).toEqual(ORDER_SETS.both);
  await expectRestoredState(page, scenario);
  const probe = await finishInteractionProbe(page);
  expect(probe.firstFeedbackMs).not.toBeNull();
  expect(probe.firstFeedbackMs).toBeLessThanOrEqual(100);
  expect(probe.longTasks).toEqual([]);
  assertStableGeometry(expect, probe.baseline, probe.current);
  expect(errors).toEqual([]);
});

test('confirming with mixed-symbol orders clears only the current symbol', async ({ page }) => {
  const scenario = createCancelScenario({
    positions: POSITION_SETS.both,
    orders: ORDER_SETS.both,
    ui: { hideOtherSymbols: false, accountTab: 'positions', showOrders: true },
  });
  const { errors } = await openUserscriptScenario(page, scenario);

  await page.getByRole('button', { name: '撤本币挂单' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '确认' }).click();
  await expect(page.getByText('HYPEUSDT 撤单流程结束，已恢复筛选状态')).toBeVisible();

  const state = await readFixtureState(page);
  expect(state.orders).toEqual(otherSymbolOrders(scenario));
  expect(state.events.filter((event) => event.type === 'cancel-requested')).toHaveLength(1);
  await expectRestoredState(page, scenario);
  expect(errors).toEqual([]);
});

test('an originally enabled symbol filter remains enabled after confirmation', async ({ page }) => {
  const scenario = createCancelScenario({
    positions: POSITION_SETS.current,
    orders: ORDER_SETS.both,
    ui: { hideOtherSymbols: true, accountTab: 'openOrders', showOrders: false },
  });
  const { errors } = await openUserscriptScenario(page, scenario);

  await page.getByRole('button', { name: '撤本币挂单' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '确认' }).click();
  await expect(page.getByText('HYPEUSDT 撤单流程结束，已恢复筛选状态')).toBeVisible();

  const state = await readFixtureState(page);
  expect(state.orders).toEqual(otherSymbolOrders(scenario));
  await expectRestoredState(page, scenario);
  expect(state.events.filter((event) => event.type === 'show-orders')).toEqual([]);
  expect(errors).toEqual([]);
});

test('the cancel workflow remains single-flight during rapid repeated clicks', async ({ page }) => {
  const scenario = createCancelScenario({
    positions: POSITION_SETS.current,
    orders: ORDER_SETS.current,
    host: { mutationDelayMs: 20 },
  });
  const { errors } = await openUserscriptScenario(page, scenario);

  await page.locator(CANCEL_BUTTON_SELECTOR).evaluate((button) => {
    button.click();
    button.click();
  });
  await expect(page.getByRole('dialog')).toBeVisible();
  const state = await readFixtureState(page);
  expect(state.events.filter((event) => event.type === 'dialog-opened')).toHaveLength(1);
  await page.getByRole('button', { name: '取消' }).click();
  await expectRestoredState(page, scenario);
  expect(errors).toEqual([]);
});
