import { test, expect } from '../test.js';

import {
  OTHER_SYMBOL,
  ORDER_SETS,
  POSITION_SETS,
  createCancelScenario,
} from '../scenarios/cancel-current-symbol.js';
import {
  openUserscriptScenario,
  readFixtureState,
} from '../helpers/userscript-page.js';
import {
  assertResponsiveInteraction,
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

  await page.getByRole('button', { name: '撤单' }).click();
  await expect(page.getByRole('button', { name: '无挂单' })).toBeVisible();

  const state = await readFixtureState(page);
  expect(state.dialogOpen).toBe(false);
  expect(state.orders).toEqual([]);
  await expectRestoredState(page, scenario);
  const probe = await finishInteractionProbe(page);
  assertResponsiveInteraction(expect, probe);
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

  await page.getByRole('button', { name: '撤单' }).click();
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

  await page.getByRole('button', { name: '撤单' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect.poll(async () => (await readFixtureState(page)).showOrders).toBe(false);
  await page.getByRole('button', { name: '取消' }).click();
  await expect(page.getByText('撤单已取消')).toBeVisible();

  const state = await readFixtureState(page);
  expect(state.orders).toEqual(ORDER_SETS.both);
  await expectRestoredState(page, scenario);
  const probe = await finishInteractionProbe(page);
  assertResponsiveInteraction(expect, probe);
  assertStableGeometry(expect, probe.baseline, probe.current);
  expect(errors).toEqual([]);
});

test('a 70-order drawing burst split across tasks performs one full save per toggle', async ({ page }) => {
  const orders = Array.from({ length: 70 }, (_, index) => ({
    id: `current-${index + 1}`,
    symbol: 'HYPEUSDT',
    side: 'SELL',
    price: String(90 + (index / 100)),
    quantity: '0.01',
  }));
  const scenario = createCancelScenario({
    positions: POSITION_SETS.current,
    orders,
    ui: { hideOtherSymbols: false, accountTab: 'positions', showOrders: true },
  });
  const { errors } = await openUserscriptScenario(page, scenario);
  await installInteractionProbe(page, CANCEL_BUTTON_SELECTOR);

  await page.getByRole('button', { name: '撤单' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect.poll(async () => (await readFixtureState(page)).showOrders).toBe(false);
  await page.getByRole('button', { name: '取消' }).click();
  await expect(page.getByText('撤单已取消')).toBeVisible();

  const state = await readFixtureState(page);
  expect(state.orders).toEqual(orders);
  expect(
    state.events.filter((event) => event.type === 'chart-save-requested'),
  ).toHaveLength(140);
  expect(state.events.filter((event) => event.type === 'chart-saved')).toHaveLength(2);
  expect(
    state.events
      .filter((event) => event.type === 'chart-orders-checked')
      .map((event) => event.value),
  ).toEqual([false, true]);
  for (const checked of [false, true]) {
    const checkedIndex = state.events.findIndex(
      (event) => event.type === 'chart-orders-checked' && event.value === checked,
    );
    const popoverClosedIndex = state.events.findIndex(
      (event, index) => index > checkedIndex && event.type === 'chart-orders-popover-closed',
    );
    const finalSaveRequestIndex = state.events.findLastIndex(
      (event) => event.type === 'chart-save-requested' && event.checked === checked,
    );
    const fullSaveIndex = state.events.findIndex(
      (event, index) => index > finalSaveRequestIndex
        && event.type === 'chart-saved'
        && event.snapshot.checked === checked,
    );
    expect(popoverClosedIndex).toBeGreaterThan(checkedIndex);
    expect(popoverClosedIndex).toBeLessThan(finalSaveRequestIndex);
    expect(popoverClosedIndex).toBeLessThan(fullSaveIndex);
  }
  await expectRestoredState(page, scenario);
  const probe = await finishInteractionProbe(page);
  assertResponsiveInteraction(expect, probe);
  assertStableGeometry(expect, probe.baseline, probe.current);
  expect(errors).toEqual([]);
});

test('a popover close failure does not discard coalesced chart saves', async ({ page }) => {
  const scenario = createCancelScenario({
    positions: POSITION_SETS.current,
    orders: ORDER_SETS.current,
    ui: { hideOtherSymbols: false, accountTab: 'positions', showOrders: true },
    host: { chartOrdersPopoverCloseMode: 'stuck' },
  });
  const { errors } = await openUserscriptScenario(page, scenario);

  await page.getByRole('button', { name: '撤单' }).click();
  await expect(page.getByText('未能恢复图表当前委托显示')).toBeVisible({ timeout: 6_000 });

  const state = await readFixtureState(page);
  expect(state.dialogOpen).toBe(false);
  expect(state.orders).toEqual(ORDER_SETS.current);
  expect(state.showOrders).toBe(true);
  expect(state.events.filter((event) => event.type === 'chart-save-requested')).toHaveLength(2);
  expect(state.events.filter((event) => event.type === 'chart-saved')).toHaveLength(2);
  expect(
    state.events.filter((event) => event.type === 'chart-orders-popover-close-requested'),
  ).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('confirming with mixed-symbol orders clears only the current symbol', async ({ page }) => {
  const scenario = createCancelScenario({
    positions: POSITION_SETS.both,
    orders: ORDER_SETS.both,
    ui: { hideOtherSymbols: false, accountTab: 'positions', showOrders: true },
  });
  const { errors } = await openUserscriptScenario(page, scenario);

  await page.getByRole('button', { name: '撤单' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '确认' }).click();
  await expect(page.getByText('撤单已完成')).toBeVisible();

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

  await page.getByRole('button', { name: '撤单' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '确认' }).click();
  await expect(page.getByText('撤单已完成')).toBeVisible();

  const state = await readFixtureState(page);
  expect(state.orders).toEqual(otherSymbolOrders(scenario));
  await expectRestoredState(page, scenario);
  expect(state.events.filter((event) => event.type === 'chart-orders-checked')).toEqual([]);
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

for (const closeMethod of ['Escape', 'backdrop']) {
  test(`closing the native dialog with ${closeMethod} is a cancellation and restores UI`, async ({ page }) => {
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

    await page.getByRole('button', { name: '撤单' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    if (closeMethod === 'Escape') {
      await page.keyboard.press('Escape');
    } else {
      await page.locator('.bn-modal-root').click({ position: { x: 4, y: 4 } });
    }
    await expect(page.getByText('撤单已取消')).toBeVisible();

    const state = await readFixtureState(page);
    expect(state.orders).toEqual(ORDER_SETS.both);
    expect(state.events.filter((event) => event.type === 'cancel-requested')).toEqual([]);
    await expectRestoredState(page, scenario);
    expect(errors).toEqual([]);
  });
}

test('a BFCache pagehide does not abort the active native dialog', async ({ page }) => {
  const scenario = createCancelScenario({
    positions: POSITION_SETS.current,
    orders: ORDER_SETS.current,
    ui: { hideOtherSymbols: false, accountTab: 'positions', showOrders: true },
  });
  const { errors } = await openUserscriptScenario(page, scenario);

  await page.getByRole('button', { name: '撤单' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', {
    persisted: true,
  })));
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '取消' }).click();
  await expect(page.getByText('撤单已取消')).toBeVisible();
  await expectRestoredState(page, scenario);
  expect(errors).toEqual([]);
});

test('a real pagehide aborts dialog tracking without mutating orders', async ({ page }) => {
  const scenario = createCancelScenario({
    positions: POSITION_SETS.current,
    orders: ORDER_SETS.current,
    ui: { hideOtherSymbols: false, accountTab: 'positions', showOrders: true },
  });
  const { errors } = await openUserscriptScenario(page, scenario);

  await page.getByRole('button', { name: '撤单' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', {
    persisted: false,
  })));
  await expect(page.getByText('原交易对 HYPE 页面已离开，撤单确认跟踪已停止')).toBeVisible();

  const state = await readFixtureState(page);
  expect(state.orders).toEqual(ORDER_SETS.current);
  expect(state.events.filter((event) => event.type === 'cancel-requested')).toEqual([]);
  expect(state.showOrders).toBe(false);
  expect(state.hideOtherSymbols).toBe(true);
  expect(errors).toEqual([]);
});

test('a missing native dialog stops cleanly and restores temporary UI state', async ({ page }) => {
  const scenario = createCancelScenario({
    positions: POSITION_SETS.current,
    orders: ORDER_SETS.current,
    ui: { hideOtherSymbols: false, accountTab: 'positions', showOrders: true },
    host: { dialogMode: 'missing' },
  });
  const { errors } = await openUserscriptScenario(page, scenario);

  await page.getByRole('button', { name: '撤单' }).click();
  await expect(page.getByText('未识别到撤单确认弹窗，未继续撤单流程')).toBeVisible({
    timeout: 3_000,
  });

  const state = await readFixtureState(page);
  expect(state.orders).toEqual(ORDER_SETS.current);
  await expectRestoredState(page, scenario);
  expect(errors).toEqual([]);
});

for (const dialogMode of ['extraAction', 'missingPrimary']) {
  test(`an invalid ${dialogMode} dialog contract blocks the action and restores chart orders`, async ({ page }) => {
    const scenario = createCancelScenario({
      positions: POSITION_SETS.current,
      orders: ORDER_SETS.current,
      ui: { hideOtherSymbols: false, accountTab: 'positions', showOrders: true },
      host: { dialogMode },
    });
    const { errors } = await openUserscriptScenario(page, scenario);

    await page.getByRole('button', { name: '撤单' }).click();
    await expect(page.getByText(
      '撤单确认弹窗结构异常，未执行弹窗操作',
    )).toBeVisible();

    const state = await readFixtureState(page);
    expect(state.orders).toEqual(ORDER_SETS.current);
    expect(state.events.filter((event) => event.type === 'cancel-requested')).toEqual([]);
    expect(
      state.events
        .filter((event) => event.type === 'chart-orders-checked')
        .map((event) => event.value),
    ).toEqual([false, true]);
    expect(state.showOrders).toBe(true);
    expect(state.hideOtherSymbols).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('a delayed confirmation keeps visible progress and clears only the current symbol', async ({ page }) => {
  const scenario = createCancelScenario({
    positions: POSITION_SETS.both,
    orders: ORDER_SETS.both,
    ui: { hideOtherSymbols: false, accountTab: 'positions', showOrders: true },
    host: { clearDelayMs: 250 },
  });
  const { errors } = await openUserscriptScenario(page, scenario);

  await page.getByRole('button', { name: '撤单' }).click();
  await page.getByRole('button', { name: '确认' }).click();
  await expect(page.getByText('撤单已确认，等待挂单清空')).toBeVisible();
  await expect(page.getByText('撤单已完成')).toBeVisible();

  const state = await readFixtureState(page);
  expect(state.orders).toEqual(otherSymbolOrders(scenario));
  await expectRestoredState(page, scenario);
  expect(errors).toEqual([]);
});

test('dialog tracking survives React replacing the native dialog subtree', async ({ page }) => {
  const scenario = createCancelScenario({
    positions: POSITION_SETS.current,
    orders: ORDER_SETS.current,
    ui: { hideOtherSymbols: false, accountTab: 'positions', showOrders: true },
    host: { dialogReplacementDelayMs: 20 },
  });
  const { errors } = await openUserscriptScenario(page, scenario);

  await page.getByRole('button', { name: '撤单' }).click();
  await expect.poll(async () => (
    await readFixtureState(page)
  ).events.filter((event) => event.type === 'dialog-replaced').length).toBe(1);
  await page.getByRole('button', { name: '取消' }).click();
  await expect(page.getByText('撤单已取消')).toBeVisible();

  const state = await readFixtureState(page);
  expect(state.orders).toEqual(ORDER_SETS.current);
  await expectRestoredState(page, scenario);
  expect(errors).toEqual([]);
});

test('a confirmed dialog that does not clear current orders reports incomplete cancellation', async ({ page }) => {
  test.setTimeout(15_000);
  const scenario = createCancelScenario({
    positions: POSITION_SETS.current,
    orders: ORDER_SETS.current,
    ui: { hideOtherSymbols: false, accountTab: 'positions', showOrders: true },
    host: { clearMode: 'none' },
  });
  const { errors } = await openUserscriptScenario(page, scenario);

  await page.getByRole('button', { name: '撤单' }).click();
  await page.getByRole('button', { name: '确认' }).click();
  await expect(page.getByText('当前交易对挂单仍存在，撤单未完成')).toBeVisible({
    timeout: 10_000,
  });

  const state = await readFixtureState(page);
  expect(state.orders).toEqual(ORDER_SETS.current);
  await expectRestoredState(page, scenario);
  expect(errors).toEqual([]);
});

test('a symbol change before the dialog decision stops the captured-symbol workflow', async ({ page }) => {
  const scenario = createCancelScenario({
    positions: POSITION_SETS.both,
    orders: ORDER_SETS.both,
    ui: { hideOtherSymbols: false, accountTab: 'positions', showOrders: true },
  });
  const { errors } = await openUserscriptScenario(page, scenario);

  await page.getByRole('button', { name: '撤单' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.evaluate((symbol) => {
    history.pushState({}, '', `/zh-CN/futures/${symbol}`);
  }, OTHER_SYMBOL);
  await expect.poll(() => page.evaluate(() => location.pathname)).toContain(OTHER_SYMBOL);
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: '取消' }).click();
  await expect(page.getByText('确认撤单前交易对已变化')).toBeVisible();

  const state = await readFixtureState(page);
  expect(state.orders).toEqual(ORDER_SETS.both);
  expect(state.events.filter((event) => event.type === 'cancel-requested')).toEqual([]);
  expect(errors).toEqual([]);
});
