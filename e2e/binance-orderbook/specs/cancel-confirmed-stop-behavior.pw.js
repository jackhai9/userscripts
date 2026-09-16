import { test, expect } from '../test.js';
import { CURRENT_SYMBOL, OTHER_SYMBOL, createCancelScenario } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario, readFixtureState } from '../helpers/userscript-page.js';
import { installScenarioClock, pauseScenarioClock } from '../helpers/scenario-clock.js';

const STATUS = '#jh-binance-ladder-status';
const CANCELLATION_ORDER = ['farthest', 'middle', 'nearest'];

function capacityOrders() {
  return [
    { id: 'nearest', symbol: CURRENT_SYMBOL, kind: 'basic', side: '平空', price: '82', quantity: '1' },
    { id: 'middle', symbol: CURRENT_SYMBOL, kind: 'basic', side: '平空', price: '84', quantity: '1' },
    { id: 'farthest', symbol: CURRENT_SYMBOL, kind: 'basic', side: '平空', price: '86', quantity: '1' },
    { id: 'opposite', symbol: CURRENT_SYMBOL, kind: 'basic', side: '平多', price: '999', quantity: '1' },
    { id: 'other-symbol', symbol: OTHER_SYMBOL, kind: 'basic', side: '平空', price: '999', quantity: '1' },
    { id: 'conditional', symbol: CURRENT_SYMBOL, kind: 'conditional', side: '平空', price: '999', quantity: '1' },
  ];
}

function rowEvents(state, type) {
  return state.events.filter(event => event.type === type).map(({ orderId }) => orderId);
}

/** The rendered release status proves settlement; a delayed native mount leaves the next row pending. */
async function stopOnConfirmedStatus(page, confirmedCount) {
  await page.locator(STATUS).evaluate((status, count) => {
    const observation = { phases: [], stop: null, observer: null };
    observation.observer = new MutationObserver(() => {
      const text = status.textContent;
      observation.phases.push({ at: performance.now(), text });
      if (observation.stop !== null || !text.includes(`释放挂单名额 ${count}/3`)) return;
      const stopButton = document.querySelector('[data-ladder-stop]');
      if (!stopButton || stopButton.getClientRects().length === 0 || stopButton.disabled) {
        throw new Error('The confirmed cancellation must expose an enabled native Stop button');
      }
      observation.stop = {
        at: performance.now(),
        text,
        loading: document.querySelector('[data-orders-loading]') !== null,
        mountedOrderIds: Array.from(document.querySelectorAll('[data-order-id]'), row => row.dataset.orderId),
        fixture: window.__BINANCE_FIXTURE__.snapshot(),
      };
      stopButton.click();
      observation.stop.clickedAt = performance.now();
      observation.stop.afterText = status.textContent;
    });
    observation.observer.observe(status, { childList: true, characterData: true, subtree: true });
    window.__CANCEL_CONFIRMED_STOP_OBSERVATION__ = observation;
  }, confirmedCount);
}

async function readObservation(page) {
  return page.evaluate(() => {
    const { phases, stop } = window.__CANCEL_CONFIRMED_STOP_OBSERVATION__;
    return { phases, stop };
  });
}

/** Observe real fixture clearing without claiming that the userscript has confirmed it yet. */
async function advanceToClearedCount(page, count) {
  for (let elapsed = 0; elapsed <= 6000; elapsed += 20) {
    const state = await readFixtureState(page);
    const cleared = state.events.filter(({ type }) => type === 'row-cancel-cleared');
    if (cleared.length === count) return cleared.at(-1).at;
    if (cleared.length > count) throw new Error('The native clock advanced beyond the requested cancellation');
    if (elapsed < 6000) await page.clock.runFor(20);
  }
  throw new Error('The native cancellation did not clear: ' + await page.locator(STATUS).textContent());
}

test.afterEach(async ({ page }, testInfo) => {
  const evidence = await page.evaluate(() => {
    const observation = window.__CANCEL_CONFIRMED_STOP_OBSERVATION__;
    if (!observation) return null;
    observation.observer.disconnect();
    delete window.__CANCEL_CONFIRMED_STOP_OBSERVATION__;
    return { phases: observation.phases, stop: observation.stop };
  });
  if (testInfo.status !== testInfo.expectedStatus) {
    await testInfo.attach('confirmed-cancellation-stop.json', {
      body: Buffer.from(JSON.stringify(evidence, null, 2)),
      contentType: 'application/json',
    });
  }
});

for (const confirmedCount of [1, 2]) {
  test(`user retains a confirmed cancellation count of ${confirmedCount} when Stop follows settlement before the next native row mounts`, async ({ page }) => {
    // Given three eligible rows coexist with protected scopes and each native rerender takes longer than settlement.
    await installScenarioClock(page);
    const orders = capacityOrders();
    const scenario = createCancelScenario({
      positions: [{ symbol: CURRENT_SYMBOL, side: 'SHORT', quantity: '100' }],
      orders,
      ui: { tradeMode: 'CLOSE', accountTab: 'openOrders', hideOtherSymbols: false },
      host: {
        rowCancelDelayMs: 60,
        orderRowsMountDelayMs: 320,
        submitApiResponses: [
          { outcome: 'rejected', delivery: 'immediate', code: '90802025', message: 'Maximum open orders' },
          ...Array.from({ length: 5 }, () => ({ outcome: 'success', delivery: 'immediate' })),
        ],
      },
    });
    const { errors } = await openUserscriptScenario(page, scenario);
    await pauseScenarioClock(page);
    await stopOnConfirmedStatus(page, confirmedCount);
    const cancelledIds = CANCELLATION_ORDER.slice(0, confirmedCount);
    const remainingOrders = orders.filter(({ id }) => !cancelledIds.includes(id));

    // When the actual continuous close receives a capacity rejection and its selected row disappears for 239 ms.
    await page.locator('[data-ladder-action="CLOSE_SHORT"]').evaluate(button => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }));
    });
    const clearedAt = await advanceToClearedCount(page, confirmedCount);
    const beforeDeadline = await page.evaluate(at => at + 239 - performance.now(), clearedAt);
    expect(beforeDeadline).toBeGreaterThanOrEqual(0);
    await page.clock.runFor(beforeDeadline);

    // Then native removal alone has neither confirmed this row nor triggered Stop or a subsequent cancellation.
    const unsettled = await readFixtureState(page);
    expect(unsettled.orders).toEqual(remainingOrders);
    expect(rowEvents(unsettled, 'row-cancel-requested')).toEqual(cancelledIds);
    expect(rowEvents(unsettled, 'row-cancel-cleared')).toEqual(cancelledIds);
    expect((await readObservation(page)).stop).toBeNull();
    await expect(page.locator(STATUS)).not.toContainText(`释放挂单名额 ${confirmedCount}/3`);
    await expect(page.locator('[data-orders-loading]')).toBeVisible();
    expect(await page.locator('[data-order-id]').count()).toBe(0);

    // When the final millisecond settles the removal and its real status observer immediately clicks Stop.
    await page.clock.runFor(1);

    // Then the same virtual instant preserves the confirmed count before the next native cancellation can start.
    const { stop } = await readObservation(page);
    const counts = `0/1 轮 · 本轮 0/5 笔 · 累计 0 笔 · 撤 ${confirmedCount} 笔`;
    expect(stop.at - clearedAt).toBe(240);
    expect(stop.clickedAt).toBe(stop.at);
    expect(stop.text).toBe(`连续阶梯平空 · 释放挂单名额 ${confirmedCount}/3 · ${counts}`);
    expect(stop.afterText).toBe(`连续阶梯平空 · 停止中 · ${counts}`);
    expect(stop.loading).toBe(true);
    expect(stop.mountedOrderIds).toEqual([]);
    expect(stop.fixture.orders).toEqual(remainingOrders);
    expect(rowEvents(stop.fixture, 'row-cancel-requested')).toEqual(cancelledIds);
    expect(rowEvents(stop.fixture, 'row-cancel-cleared')).toEqual(cancelledIds);
    expect(stop.fixture.events.filter(({ type }) => type === 'order-submitted')
      .map(({ submitSequence, action }) => ({ submitSequence, action })))
      .toEqual([{ submitSequence: 1, action: '平空' }]);

    // When native rows finish mounting and every cancellation, submit, and continuous cooldown deadline passes.
    await page.clock.runFor(10000);

    // Then the stopped session keeps exact confirmed progress, all untouched orders, and no recovery submit.
    const state = await readFixtureState(page);
    await expect(page.locator(STATUS)).toHaveText(`连续阶梯平空 · 已停止 · ${counts}`);
    expect(state.orders).toEqual(remainingOrders);
    expect(rowEvents(state, 'row-cancel-requested')).toEqual(cancelledIds);
    expect(rowEvents(state, 'row-cancel-cleared')).toEqual(cancelledIds);
    expect(state.events.filter(({ type }) => type === 'order-submitted')
      .map(({ submitSequence, action }) => ({ submitSequence, action })))
      .toEqual([{ submitSequence: 1, action: '平空' }]);
    expect(state.events.filter(({ type }) => type === 'order-submit-api-rejected')
      .map(({ submitSequence, code }) => ({ submitSequence, code })))
      .toEqual([{ submitSequence: 1, code: '90802025' }]);
    expect(state.events.filter(({ type }) => [
      'order-submit-api-success', 'cancel-requested', 'cancel-cleared', 'dialog-opened', 'row-dialog-opened',
    ].includes(type))).toEqual([]);
    expect(state.accountTab).toBe('openOrders');
    expect(state.openOrdersSubTab).toBe('basic');
    expect(state.hideOtherSymbols).toBe(false);
    expect(state.showOrders).toBe(true);
    await expect(page.getByRole('button', { name: '停止平空', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '阶梯平空', exact: true })).toBeEnabled();
    expect(errors).toEqual([]);
  });
}
