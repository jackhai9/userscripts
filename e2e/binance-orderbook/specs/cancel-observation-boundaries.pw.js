import { test, expect } from '../test.js';
import { CURRENT_SYMBOL, OTHER_SYMBOL, ORDER_SETS, POSITION_SETS, createCancelScenario } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario, readFixtureState } from '../helpers/userscript-page.js';
import { installScenarioClock, pauseScenarioClock } from '../helpers/scenario-clock.js';

const STATUS = '#jh-binance-ladder-status';

async function beginCancellation(page, options = null) {
  await page.evaluate(options => {
    window.__CANCEL_TEST_RESULT__ = null;
    window.__TM_CLOSE_LONG_DEBUG__.cancelCurrentSymbolOpenOrders(options).then(result => {
      window.__CANCEL_TEST_RESULT__ = result;
    });
  }, options);
}

async function cancelResult(page) {
  return page.evaluate(() => window.__CANCEL_TEST_RESULT__);
}

for (const changed of ['symbol', 'scope', 'filter']) {
  test(`user stops cancellation observation when its ${changed} changes after native confirmation`, async ({ page }) => {
    // Given the native host accepts one scoped cancellation but does not claim its orders are cleared.
    await installScenarioClock(page);
    const scenario = createCancelScenario({
      positions: POSITION_SETS.both, orders: ORDER_SETS.both,
      ui: { accountTab: 'openOrders', hideOtherSymbols: true }, host: { clearMode: 'none' },
    });
    const host = await openUserscriptScenario(page, scenario);
    await pauseScenarioClock(page);
    await beginCancellation(page);
    await page.clock.runFor(100);
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.locator('[data-dialog-action="confirm"]').click();
    await page.clock.runFor(100);
    await expect(page.locator(STATUS)).toHaveText('撤单已确认，等待挂单清空');

    // When native navigation or UI replacement invalidates the observed cancellation scope.
    await page.evaluate(changed => {
      if (changed === 'symbol') window.__BINANCE_FIXTURE__.switchSymbol('BTCUSDT');
      if (changed === 'scope') document.querySelector('#OPEN_ORDERS').remove();
      if (changed === 'filter') document.querySelector('[role="checkbox"][name="hideOtherSymbol"]').click();
    }, changed);
    await page.clock.runFor(9000);

    // Then the exact loss of evidence is reported without a second request or a fabricated cleared result.
    const expected = {
      symbol: { status: 'symbol_changed', message: '等待撤单完成时交易对已变化' },
      scope: { status: 'scope_not_found', message: '等待撤单完成时未找到当前委托面板' },
      filter: { status: 'symbol_filter_not_confirmed', message: '等待撤单完成时未确认仅显示当前交易对挂单' },
    }[changed];
    await expect.poll(() => cancelResult(page)).toEqual({ ok: false, ...expected });
    const state = await readFixtureState(page);
    expect(state.orders).toEqual(scenario.orders);
    expect(state.currentSymbol).toBe(changed === 'symbol' ? OTHER_SYMBOL : CURRENT_SYMBOL);
    expect(state.events.filter(({ type }) => type === 'cancel-requested')).toHaveLength(1);
    expect(state.events.filter(({ type }) => type === 'cancel-cleared' || type === 'order-submitted')).toEqual([]);
    expect(host.errors).toEqual([]);
  });
}

for (const clear of [true, false]) {
  test(`user receives an explicit ${clear ? 'cleared' : 'still-open'} result from the cancellation completion contract`, async ({ page }) => {
    // Given both symbols have orders and completion must be observed before any caller can continue.
    await installScenarioClock(page);
    const scenario = createCancelScenario({
      positions: POSITION_SETS.both, orders: ORDER_SETS.both,
      ui: { accountTab: 'openOrders', hideOtherSymbols: true },
      host: { clearMode: clear ? 'capturedScope' : 'none' },
    });
    const host = await openUserscriptScenario(page, scenario);
    await pauseScenarioClock(page);

    // When the completion-aware public action receives the user's native confirmation.
    await beginCancellation(page, { waitUntilCleared: true });
    await page.clock.runFor(100);
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.locator('[data-dialog-action="confirm"]').click();
    await page.clock.runFor(7000);

    // Then only confirmed clearing permits a successful result; another symbol is preserved in either case.
    await expect.poll(() => cancelResult(page)).toEqual(clear
      ? { ok: true, status: 'cleared' }
      : { ok: false, status: 'not_cleared', message: '当前交易对挂单仍存在，已停止重新挂单' });
    await expect(page.locator(STATUS)).toHaveText(clear
      ? '原挂单已撤，继续阶梯挂单' : '当前交易对挂单仍存在，已停止重新挂单');
    const state = await readFixtureState(page);
    expect(state.orders).toEqual(clear ? scenario.orders.filter(order => order.symbol === OTHER_SYMBOL) : scenario.orders);
    expect(state.events.filter(({ type }) => type === 'cancel-requested')).toHaveLength(1);
    expect(state.events.filter(({ type }) => type === 'order-submitted')).toEqual([]);
    expect(host.errors).toEqual([]);
  });
}

test('user cannot open a cancellation dialog if navigation changes symbol while selecting current orders', async ({ page }) => {
  // Given selecting the current-orders tab coincides with a native route change.
  await installScenarioClock(page);
  const scenario = createCancelScenario({ positions: POSITION_SETS.both, orders: ORDER_SETS.both });
  const host = await openUserscriptScenario(page, scenario);
  await pauseScenarioClock(page);
  await page.locator('[data-account-tab="openOrders"]').evaluate(tab => {
    tab.addEventListener('click', () => window.__BINANCE_FIXTURE__.switchSymbol('BTCUSDT'), { once: true });
  });

  // When the actual cancellation action tries to open the captured symbol's current orders.
  await beginCancellation(page);
  await page.clock.runFor(100);

  // Then the new route cannot inherit the pending financial action or its original order IDs.
  await expect.poll(() => cancelResult(page)).toEqual({
    ok: false, status: 'symbol_changed', message: '打开当前委托时交易对已变化',
  });
  const state = await readFixtureState(page);
  expect(state.currentSymbol).toBe(OTHER_SYMBOL);
  expect(state.orders).toEqual(scenario.orders);
  expect(state.events.filter(({ type }) => type === 'dialog-opened' || type === 'cancel-requested')).toEqual([]);
  expect(host.errors).toEqual([]);
});
