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
import { installScenarioClock, pauseScenarioClock } from '../helpers/scenario-clock.js';
import { installSimulatedVisibility, setSimulatedVisibility } from '../helpers/simulated-visibility.js';
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

test('user receives immediate no-order feedback when the account is empty', async ({ page }) => {
  // Given the current-symbol page has no positions or orders and real-time interaction probes are armed.
  const scenario = createCancelScenario();
  const { errors } = await openUserscriptScenario(page, scenario);
  await installInteractionProbe(page, CANCEL_BUTTON_SELECTOR);

  // When the user requests cancellation.
  await page.getByRole('button', { name: '撤单' }).click();
  // Then the panel reports no orders promptly without opening a dialog or moving other controls.
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

test('user cannot cancel orders on another symbol through the current-symbol action', async ({ page }) => {
  // Given only another symbol has positions and orders, and the symbol filter starts disabled.
  const scenario = createCancelScenario({
    positions: POSITION_SETS.other,
    orders: ORDER_SETS.other,
    ui: { hideOtherSymbols: false, accountTab: 'positions' },
  });
  const { errors } = await openUserscriptScenario(page, scenario);

  // When the user requests current-symbol cancellation.
  await page.getByRole('button', { name: '撤单' }).click();
  // Then the panel reports no current orders and preserves every other-symbol order.
  await expect(page.getByRole('button', { name: '无挂单' })).toBeVisible();

  const state = await readFixtureState(page);
  expect(state.dialogOpen).toBe(false);
  expect(state.orders).toEqual(otherSymbolOrders(scenario));
  await expectRestoredState(page, scenario);
  expect(errors).toEqual([]);
});

test('user dismisses native cancellation and keeps every order and original UI setting', async ({ page }) => {
  // Given both symbols have orders and the initial view uses the conditional sub-tab.
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

  // When the user opens the native confirmation and chooses Cancel.
  await page.getByRole('button', { name: '撤单' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect.poll(async () => (await readFixtureState(page)).showOrders).toBe(true);
  await page.getByRole('button', { name: '取消' }).click();
  // Then all orders and original tabs, filters, chart visibility, and control geometry are restored.
  await expect(page.getByText('撤单已取消')).toBeVisible();

  const state = await readFixtureState(page);
  expect(state.orders).toEqual(ORDER_SETS.both);
  await expectRestoredState(page, scenario);
  const probe = await finishInteractionProbe(page);
  assertResponsiveInteraction(expect, probe);
  assertStableGeometry(expect, probe.baseline, probe.current);
  expect(errors).toEqual([]);
});

test('user cancels seventy orders while chart drawings stay visible and save once at completion', async ({ page }) => {
  // Given seventy current-symbol Basic orders are drawn on the chart.
  const orders = Array.from({ length: 70 }, (_, index) => ({
    id: `current-${index + 1}`,
    symbol: 'HYPEUSDT',
    kind: 'basic',
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

  // When the user requests cancellation and confirms the native dialog.
  await page.getByRole('button', { name: '撤单' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect.poll(async () => (await readFixtureState(page)).showOrders).toBe(true);
  await page.getByRole('button', { name: '确认' }).click();
  // Then all seventy orders disappear and their drawing removals produce one final chart save.
  await expect(page.getByText('撤单已完成')).toBeVisible();

  const state = await readFixtureState(page);
  expect(state.orders).toEqual([]);
  expect(
    state.events.filter((event) => event.type === 'chart-save-requested'),
  ).toHaveLength(70);
  expect(state.events.filter((event) => event.type === 'chart-saved')).toHaveLength(1);
  expect(
    state.events
      .filter((event) => event.type === 'chart-orders-checked')
      .map((event) => event.value),
  ).toEqual([]);
  const finalSaveRequestIndex = state.events.findLastIndex(
    (event) => event.type === 'chart-save-requested',
  );
  const fullSaveIndex = state.events.findIndex((event) => event.type === 'chart-saved');
  expect(fullSaveIndex).toBeGreaterThan(finalSaveRequestIndex);
  await expectRestoredState(page, scenario);
  const probe = await finishInteractionProbe(page);
  assertResponsiveInteraction(expect, probe);
  assertStableGeometry(expect, probe.baseline, probe.current);
  expect(errors).toEqual([]);
});

test('user dismisses cancellation even when the unrelated chart orders popover cannot close', async ({ page }) => {
  // Given current-symbol orders exist while the chart orders popover has a stuck-close behavior.
  const scenario = createCancelScenario({
    positions: POSITION_SETS.current,
    orders: ORDER_SETS.current,
    ui: { hideOtherSymbols: false, accountTab: 'positions', showOrders: true },
    host: { chartOrdersPopoverCloseMode: 'stuck' },
  });
  const { errors } = await openUserscriptScenario(page, scenario);

  // When the user opens the native cancellation dialog and cancels it.
  await page.getByRole('button', { name: '撤单' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '取消' }).click();
  // Then orders and drawings remain intact without any chart-popover or chart-save operation.
  await expect(page.getByText('撤单已取消')).toBeVisible();

  const state = await readFixtureState(page);
  expect(state.dialogOpen).toBe(false);
  expect(state.orders).toEqual(ORDER_SETS.current);
  expect(state.showOrders).toBe(true);
  expect(state.events.filter((event) => event.type === 'chart-save-requested')).toHaveLength(0);
  expect(state.events.filter((event) => event.type === 'chart-saved')).toHaveLength(0);
  expect(
    state.events.filter((event) => event.type === 'chart-orders-popover-close-requested'),
  ).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('user confirms cancellation for the current symbol while other-symbol orders survive', async ({ page }) => {
  // Given both symbols have positions and Basic orders, with the filter initially disabled.
  const scenario = createCancelScenario({
    positions: POSITION_SETS.both,
    orders: ORDER_SETS.both,
    ui: { hideOtherSymbols: false, accountTab: 'positions', showOrders: true },
  });
  const { errors } = await openUserscriptScenario(page, scenario);

  // When the user requests and confirms current-symbol cancellation.
  await page.getByRole('button', { name: '撤单' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '确认' }).click();
  // Then only the current-symbol order is removed by one native cancellation request.
  await expect(page.getByText('撤单已完成')).toBeVisible();

  const state = await readFixtureState(page);
  expect(state.orders).toEqual(otherSymbolOrders(scenario));
  expect(state.events.filter((event) => event.type === 'cancel-requested')).toHaveLength(1);
  await expectRestoredState(page, scenario);
  expect(errors).toEqual([]);
});

test('user finishes confirmed current-symbol cancellation after the tab becomes hidden', async ({ page }) => {
  // Given a native confirmation is open for current and other-symbol Basic orders.
  const scenario = createCancelScenario({
    positions: POSITION_SETS.both,
    orders: ORDER_SETS.both,
    ui: { hideOtherSymbols: false, accountTab: 'positions', showOrders: true },
  });
  const { errors } = await openUserscriptScenario(page, scenario);
  await installSimulatedVisibility(page);
  await page.getByRole('button', { name: '撤单' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // When the user confirms, then moves the page to a background tab.
  await dialog.getByRole('button', { name: '确认' }).evaluate(button => {
    button.click();
    window.__SIMULATED_VISIBILITY__.setHidden(true);
  });

  // Then only the captured current-symbol order is cancelled and UI state is restored.
  await expect.poll(async () => (await readFixtureState(page)).events
    .filter(({ type }) => type === 'cancel-requested')).toHaveLength(1);
  await setSimulatedVisibility(page, false);
  await expect(page.getByText('撤单已完成')).toBeVisible();
  expect((await readFixtureState(page)).orders).toEqual(otherSymbolOrders(scenario));
  await expectRestoredState(page, scenario);
  expect(errors).toEqual([]);
});

test('user keeps an already enabled symbol filter after confirming cancellation', async ({ page }) => {
  // Given the initial open-orders view has Hide Other Symbols enabled and chart orders hidden.
  const scenario = createCancelScenario({
    positions: POSITION_SETS.current,
    orders: ORDER_SETS.both,
    ui: { hideOtherSymbols: true, accountTab: 'openOrders', showOrders: false },
  });
  const { errors } = await openUserscriptScenario(page, scenario);

  // When the user confirms the current-symbol cancellation.
  await page.getByRole('button', { name: '撤单' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '确认' }).click();
  // Then other-symbol orders survive and the original filter and chart visibility remain unchanged.
  await expect(page.getByText('撤单已完成')).toBeVisible();

  const state = await readFixtureState(page);
  expect(state.orders).toEqual(otherSymbolOrders(scenario));
  await expectRestoredState(page, scenario);
  expect(state.events.filter((event) => event.type === 'chart-orders-checked')).toEqual([]);
  expect(errors).toEqual([]);
});

test('user can click cancellation twice rapidly without opening duplicate dialogs', async ({ page }) => {
  // Given current-symbol orders exist and host UI mutations are delayed.
  const scenario = createCancelScenario({
    positions: POSITION_SETS.current,
    orders: ORDER_SETS.current,
    host: { mutationDelayMs: 20 },
  });
  const { errors } = await openUserscriptScenario(page, scenario);

  // When the user issues two cancellation clicks before the host commits its state.
  await page.locator(CANCEL_BUTTON_SELECTOR).evaluate((button) => {
    button.click();
    button.click();
  });
  // Then exactly one native dialog is opened and cancellation can restore the original view.
  await expect(page.getByRole('dialog')).toBeVisible();
  const state = await readFixtureState(page);
  expect(state.events.filter((event) => event.type === 'dialog-opened')).toHaveLength(1);
  await page.getByRole('button', { name: '取消' }).click();
  await expectRestoredState(page, scenario);
  expect(errors).toEqual([]);
});

for (const closeMethod of ['Escape', 'backdrop']) {
  test(`user dismisses native cancellation with ${closeMethod} and restores the original view`, async ({ page }) => {
    // Given both symbols have orders and temporary cancellation filtering must be restored.
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

    // When the user opens confirmation and dismisses it using the selected native closing method.
    await page.getByRole('button', { name: '撤单' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    if (closeMethod === 'Escape') {
      await page.keyboard.press('Escape');
    } else {
      await page.locator('.bn-modal-root').click({ position: { x: 4, y: 4 } });
    }
    // Then all orders remain and no native cancel request is sent.
    await expect(page.getByText('撤单已取消')).toBeVisible();

    const state = await readFixtureState(page);
    expect(state.orders).toEqual(ORDER_SETS.both);
    expect(state.events.filter((event) => event.type === 'cancel-requested')).toEqual([]);
    await expectRestoredState(page, scenario);
    expect(errors).toEqual([]);
  });
}

test('user can resume a cancellation dialog after a BFCache pagehide', async ({ page }) => {
  // Given the current symbol has orders and the native cancellation dialog can open.
  const scenario = createCancelScenario({
    positions: POSITION_SETS.current,
    orders: ORDER_SETS.current,
    ui: { hideOtherSymbols: false, accountTab: 'positions', showOrders: true },
  });
  const { errors } = await openUserscriptScenario(page, scenario);

  // When the page enters BFCache while confirmation is open, then the user dismisses the dialog.
  await page.getByRole('button', { name: '撤单' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', {
    persisted: true,
  })));
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '取消' }).click();
  // Then the active workflow accepts the decision and restores the original UI.
  await expect(page.getByText('撤单已取消')).toBeVisible();
  await expectRestoredState(page, scenario);
  expect(errors).toEqual([]);
});

test('user leaving the page stops cancellation tracking without changing orders', async ({ page }) => {
  // Given current-symbol orders exist before the native cancellation dialog opens.
  const scenario = createCancelScenario({
    positions: POSITION_SETS.current,
    orders: ORDER_SETS.current,
    ui: { hideOtherSymbols: false, accountTab: 'positions', showOrders: true },
  });
  const { errors } = await openUserscriptScenario(page, scenario);

  // When the page leaves without BFCache while confirmation is pending.
  await page.getByRole('button', { name: '撤单' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', {
    persisted: false,
  })));
  // Then tracking ends with the original orders intact and no native cancellation request.
  await expect(page.getByText('原交易对 HYPE 页面已离开，撤单确认跟踪已停止')).toBeVisible();

  const state = await readFixtureState(page);
  expect(state.orders).toEqual(ORDER_SETS.current);
  expect(state.events.filter((event) => event.type === 'cancel-requested')).toEqual([]);
  expect(state.showOrders).toBe(true);
  expect(state.hideOtherSymbols).toBe(true);
  expect(errors).toEqual([]);
});

test('user sees a clear failure when the native cancellation dialog never appears', async ({ page }) => {
  // Given the native host is configured not to render the requested dialog.
  const scenario = createCancelScenario({
    positions: POSITION_SETS.current,
    orders: ORDER_SETS.current,
    ui: { hideOtherSymbols: false, accountTab: 'positions', showOrders: true },
    host: { dialogMode: 'missing' },
  });
  const { errors } = await openUserscriptScenario(page, scenario);

  // When the user requests current-symbol cancellation.
  await page.getByRole('button', { name: '撤单' }).click();
  // Then the panel reports the missing confirmation and restores the original order view.
  await expect(page.getByText('未识别到撤单确认弹窗，未继续撤单流程')).toBeVisible({
    timeout: 3_000,
  });

  const state = await readFixtureState(page);
  expect(state.orders).toEqual(ORDER_SETS.current);
  await expectRestoredState(page, scenario);
  expect(errors).toEqual([]);
});

for (const dialogMode of ['extraAction', 'missingPrimary']) {
  test(`user cannot continue cancellation through an invalid ${dialogMode} native dialog`, async ({ page }) => {
    // Given the host renders the selected malformed native-dialog contract.
    const scenario = createCancelScenario({
      positions: POSITION_SETS.current,
      orders: ORDER_SETS.current,
      ui: { hideOtherSymbols: false, accountTab: 'positions', showOrders: true },
      host: { dialogMode },
    });
    const { errors } = await openUserscriptScenario(page, scenario);

    // When the user requests cancellation.
    await page.getByRole('button', { name: '撤单' }).click();
    // Then the script reports the structural error without cancel requests or chart mutations.
    await expect(page.getByText(
      '撤单确认弹窗结构异常，未执行弹窗操作',
    )).toBeVisible();

    const state = await readFixtureState(page);
    expect(state.orders).toEqual(ORDER_SETS.current);
    expect(state.events.filter((event) => event.type === 'cancel-requested')).toEqual([]);
    expect(state.events.filter((event) => event.type === 'chart-orders-checked')).toEqual([]);
    expect(state.showOrders).toBe(true);
    expect(state.hideOtherSymbols).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('user sees cancellation progress while the current-symbol clear is delayed', async ({ page }) => {
  // Given both symbols have orders and the native clear is delayed by 250 ms.
  const scenario = createCancelScenario({
    positions: POSITION_SETS.both,
    orders: ORDER_SETS.both,
    ui: { hideOtherSymbols: false, accountTab: 'positions', showOrders: true },
    host: { clearDelayMs: 250 },
  });
  const { errors } = await openUserscriptScenario(page, scenario);

  // When the user confirms the native cancellation.
  await page.getByRole('button', { name: '撤单' }).click();
  await page.getByRole('button', { name: '确认' }).click();
  // Then progress stays visible until only the captured current-symbol orders are cleared.
  await expect(page.getByText('撤单已确认，等待挂单清空')).toBeVisible();
  await expect(page.getByText('撤单已完成')).toBeVisible();

  const state = await readFixtureState(page);
  expect(state.orders).toEqual(otherSymbolOrders(scenario));
  await expectRestoredState(page, scenario);
  expect(errors).toEqual([]);
});

test('user can dismiss cancellation after the host replaces the dialog subtree', async ({ page }) => {
  // Given the host replaces the current-symbol confirmation dialog after it opens.
  const scenario = createCancelScenario({
    positions: POSITION_SETS.current,
    orders: ORDER_SETS.current,
    ui: { hideOtherSymbols: false, accountTab: 'positions', showOrders: true },
    host: { dialogReplacementDelayMs: 20 },
  });
  const { errors } = await openUserscriptScenario(page, scenario);

  // When the user opens confirmation, waits for replacement, and chooses Cancel.
  await page.getByRole('button', { name: '撤单' }).click();
  await expect.poll(async () => (
    await readFixtureState(page)
  ).events.filter((event) => event.type === 'dialog-replaced').length).toBe(1);
  await page.getByRole('button', { name: '取消' }).click();
  // Then the replacement decision is observed and all orders and UI settings are restored.
  await expect(page.getByText('撤单已取消')).toBeVisible();

  const state = await readFixtureState(page);
  expect(state.orders).toEqual(ORDER_SETS.current);
  await expectRestoredState(page, scenario);
  expect(errors).toEqual([]);
});

test('user receives an incomplete-cancellation result when confirmed orders never clear', async ({ page }) => {
  // Given the native host accepts confirmation but intentionally leaves the current orders unchanged.
  test.setTimeout(15_000);
  const scenario = createCancelScenario({
    positions: POSITION_SETS.current,
    orders: ORDER_SETS.current,
    ui: { hideOtherSymbols: false, accountTab: 'positions', showOrders: true },
    host: { clearMode: 'none' },
  });
  const { errors } = await openUserscriptScenario(page, scenario);

  // When the user requests cancellation and confirms it.
  await page.getByRole('button', { name: '撤单' }).click();
  await page.getByRole('button', { name: '确认' }).click();
  // Then the script reports incomplete clearing and preserves the remaining orders and original UI.
  await expect(page.getByText('当前交易对挂单仍存在，撤单未完成')).toBeVisible({
    timeout: 10_000,
  });

  const state = await readFixtureState(page);
  expect(state.orders).toEqual(ORDER_SETS.current);
  await expectRestoredState(page, scenario);
  expect(errors).toEqual([]);
});

test('user stops the original cancellation workflow by changing symbol during confirmation', async ({ page }) => {
  // Given both symbols have orders and the page clock controls route-change observation.
  await installScenarioClock(page);
  const scenario = createCancelScenario({
    positions: POSITION_SETS.both,
    orders: ORDER_SETS.both,
    ui: { hideOtherSymbols: false, accountTab: 'positions', showOrders: true },
  });
  const { errors } = await openUserscriptScenario(page, scenario);

  // When the user opens confirmation, switches symbol, advances the route timer, and dismisses the dialog.
  await page.getByRole('button', { name: '撤单' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await pauseScenarioClock(page);
  await page.evaluate((symbol) => {
    window.__BINANCE_FIXTURE__.switchSymbol(symbol);
  }, OTHER_SYMBOL);
  await expect.poll(() => page.evaluate(() => location.pathname)).toContain(OTHER_SYMBOL);
  await page.clock.runFor(600);
  await page.getByRole('button', { name: '取消' }).click();
  // Then the original workflow reports the symbol change and neither symbol loses orders.
  await expect(page.getByText('确认撤单前交易对已变化')).toBeVisible();

  const state = await readFixtureState(page);
  expect(state.orders).toEqual(ORDER_SETS.both);
  expect(state.events.filter((event) => event.type === 'cancel-requested')).toEqual([]);
  expect(errors).toEqual([]);
});

test('user cancels only current-symbol basic orders while keeping conditional orders intact', async ({ page }) => {
  // Given both symbols have Basic and conditional orders and the initial tab is conditional.
  const protectedOrders = ORDER_SETS.both.map((order) => ({
    ...order, id: 'conditional-' + order.id, kind: 'conditional',
  }));
  const scenario = createCancelScenario({
    orders: [...ORDER_SETS.both, ...protectedOrders],
    ui: { accountTab: 'openOrders', openOrdersSubTab: 'conditional', hideOtherSymbols: false },
  });
  const { errors } = await openUserscriptScenario(page, scenario);

  // When the user requests cancellation and accepts the native confirmation.
  await page.getByRole('button', { name: '撤单', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '确认', exact: true }).click();

  // Then the host receives a filtered Basic scope and every protected order survives.
  await expect(page.getByText('撤单已完成')).toBeVisible();
  const state = await readFixtureState(page);
  expect(state.orders).toEqual([ORDER_SETS.both[1], ...protectedOrders]);
  expect(state.events.filter(({ type }) => type === 'cancel-requested')).toEqual([
    expect.objectContaining({
      symbol: scenario.currentSymbol,
      accountTab: 'openOrders',
      openOrdersSubTab: 'basic',
      hideOtherSymbols: true,
      orderIds: ['current-1'],
    }),
  ]);
  await expectRestoredState(page, scenario);
  expect(errors).toEqual([]);
});
