import { test, expect } from '../test.js';

import { CANCEL_COVERING_SCENARIOS } from '../scenarios/cancel-covering-matrix.js';
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

function currentSymbolOrders(scenario) {
  return scenario.orders.filter((order) => order.symbol === scenario.currentSymbol);
}

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

for (const entry of CANCEL_COVERING_SCENARIOS) {
  test(`${entry.id} preserves the cancel-current-symbol invariants`, async ({ page }) => {
    const { scenario, vector } = entry;
    const hasCurrentOrders = currentSymbolOrders(scenario).length > 0;
    const { errors } = await openUserscriptScenario(page, scenario);
    await installInteractionProbe(page, CANCEL_BUTTON_SELECTOR);

    await page.getByRole('button', { name: '撤单' }).click();
    if (!hasCurrentOrders) {
      await expect(page.getByRole('button', { name: '无挂单' })).toBeVisible();
    } else {
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect.poll(async () => (await readFixtureState(page)).showOrders).toBe(false);
      await page.getByRole('button', {
        name: vector.dialogOutcome === 'confirm' ? '确认' : '取消',
      }).click();
      await expect(page.getByText(
        vector.dialogOutcome === 'confirm'
          ? '撤单已完成'
          : '撤单已取消',
      )).toBeVisible();
    }

    await expectRestoredState(page, scenario);
    const probe = await finishInteractionProbe(page);
    assertResponsiveInteraction(expect, probe);
    assertStableGeometry(expect, probe.baseline, probe.current);

    const state = await readFixtureState(page);
    const expectedOrders = hasCurrentOrders && vector.dialogOutcome === 'confirm'
      ? otherSymbolOrders(scenario)
      : scenario.orders;
    expect(state.orders).toEqual(expectedOrders);
    expect(state.events.filter((event) => event.type === 'dialog-opened')).toHaveLength(
      hasCurrentOrders ? 1 : 0,
    );
    expect(state.events.filter((event) => event.type === 'cancel-requested')).toHaveLength(
      hasCurrentOrders && vector.dialogOutcome === 'confirm' ? 1 : 0,
    );
    const currentOrderCount = currentSymbolOrders(scenario).length;
    const expectedChartToggleCount = hasCurrentOrders && scenario.ui.showOrders ? 2 : 0;
    const expectedChartSaveBurstCount = expectedChartToggleCount === 0
      ? 0
      : vector.dialogOutcome === 'confirm' ? 1 : 2;
    const expectedChartSaveRequestCount = expectedChartSaveBurstCount * currentOrderCount;
    expect(state.events.filter((event) => event.type === 'chart-orders-checked')).toHaveLength(
      expectedChartToggleCount,
    );
    expect(state.events.filter((event) => event.type === 'chart-save-requested')).toHaveLength(
      expectedChartSaveRequestCount,
    );
    expect(state.events.filter((event) => event.type === 'chart-saved')).toHaveLength(
      expectedChartSaveBurstCount,
    );
    expect(errors).toEqual([]);
  });
}
