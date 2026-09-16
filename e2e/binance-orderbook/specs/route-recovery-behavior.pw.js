import { test, expect, reloadPageWithCoverage } from '../test.js';
import {
  CURRENT_SYMBOL,
  OTHER_SYMBOL,
  ORDER_SETS,
  createCancelScenario,
} from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario, readFixtureState } from '../helpers/userscript-page.js';
import { installScenarioClock, pauseScenarioClock } from '../helpers/scenario-clock.js';

const PANEL = '#jh-binance-close-qty-multiplier-panel';
const STATUS = '#jh-binance-ladder-status';
const RECOVERY_KEY = 'binance-orderbook-trade:chart-orders-recovery:v2';
const RECOVERY_RECORD = JSON.stringify({ version: 2, originalChecked: true, createdAtMs: 1_000 });
const POSITION_PATH = '/bapi/futures/v6/private/future/user-data/user-position';

async function eventsOfType(page, type) {
  return (await readFixtureState(page)).events.filter(event => event.type === type);
}

async function readRecoveryRecord(page) {
  return page.evaluate(key => sessionStorage.getItem(key), RECOVERY_KEY);
}

async function changeRoute(page, path) {
  await page.evaluate(nextPath => history.pushState({}, '', nextPath), path);
}

/** Keep timing assertions relative to the native operation that scheduled the work. */
async function advanceFromNativeEvent(page, type, elapsed) {
  const remaining = await page.evaluate(({ type, elapsed }) => {
    const event = window.__BINANCE_FIXTURE__.snapshot().events
      .filter(entry => entry.type === type).at(-1);
    if (!event) throw new Error(`Native event was not observed: ${type}`);
    return event.at + elapsed - performance.now();
  }, { type, elapsed });
  expect(remaining).toBeGreaterThanOrEqual(0);
  await page.clock.runFor(remaining);
}

async function openPendingCloseRound(page) {
  await installScenarioClock(page);
  const host = await openUserscriptScenario(page, createCancelScenario({
    positions: [{ symbol: CURRENT_SYMBOL, side: 'SHORT', quantity: '100' }],
    ui: { tradeMode: 'CLOSE' },
    host: {
      submitApiResponses: [
        { outcome: 'success', delivery: 'immediate' },
        { outcome: 'success', delivery: 'immediate' },
        { outcome: 'success', delivery: 'manual' },
        { outcome: 'success', delivery: 'manual' },
        { outcome: 'success', delivery: 'immediate' },
        { outcome: 'success', delivery: 'manual' },
      ],
    },
  }));
  await page.locator('[data-ladder-group="levels"][data-ladder-value="3"]').click();
  await page.locator('[data-ladder-action="CLOSE_SHORT"]').click({ modifiers: ['Alt'] });
  await expect.poll(host.pendingSubmitSequences).toEqual([3]);
  await pauseScenarioClock(page);
  return host;
}

/** Delay delivery only; the already contracted fixture still owns the response. */
async function holdRulesResponse(page, symbol) {
  const requested = Promise.withResolvers();
  const released = Promise.withResolvers();
  const url = `https://fapi.binance.com/fapi/v1/exchangeInfo?symbol=${symbol}`;
  let requestCount = 0;
  await page.route(url, async route => {
    requestCount += 1;
    expect(route.request().method()).toBe('GET');
    expect(requestCount).toBe(1);
    requested.resolve();
    await released.promise;
    await route.fallback();
  });
  return {
    requested: requested.promise,
    requestCount: () => requestCount,
    async release() {
      const received = page.waitForResponse(url);
      released.resolve();
      const response = await received;
      await response.finished();
    },
  };
}

async function reloadWithRecoveryRecord(page, scenario, record = RECOVERY_RECORD) {
  await installScenarioClock(page);
  const host = await openUserscriptScenario(page, scenario);
  await page.evaluate(({ key, record }) => sessionStorage.setItem(key, record), {
    key: RECOVERY_KEY,
    record,
  });
  await reloadPageWithCoverage(page);
  await page.locator(PANEL).waitFor({ state: 'visible' });
  await page.locator('#jh-binance-ladder-body').waitFor({ state: 'visible' });
  await pauseScenarioClock(page);
  return host;
}

test('user preserves an active close ladder and exact round totals across SPA locale changes', async ({ page }) => {
  // Given two acknowledged orders and the third pending order belong to one continuous round.
  const host = await openPendingCloseRound(page);
  const originalPanel = await page.locator(PANEL).elementHandle();
  await expect(page.locator(STATUS)).toHaveText('连续阶梯平空 · 第 3 笔确认中 · 0/1 轮 · 本轮 2/3 笔 · 累计 2 笔');

  // When the SPA changes only the language while the third response remains pending.
  await changeRoute(page, `/en/futures/${CURRENT_SYMBOL}`);
  await page.clock.runFor(32);

  // Then the rebuilt English panel keeps the same pending operation and confirmed counters.
  expect(await originalPanel.evaluate(element => element.isConnected)).toBe(false);
  await originalPanel.dispose();
  await expect(page.locator(PANEL)).toHaveCount(1);
  await expect(page.locator(STATUS)).toHaveText('Continuous Close Short · Order 3 confirming · 0/1 rounds · This round 2/3 · Total 2');
  await expect(page.getByRole('button', { name: 'Stop Close Short', exact: true })).toBeEnabled();
  expect(host.pendingSubmitSequences()).toEqual([3]);
  expect(await eventsOfType(page, 'order-submit-api-success')).toHaveLength(2);

  // When the original response succeeds and the same session starts its second round.
  await host.releaseSubmitResponse(3);
  await expect.poll(async () => (await eventsOfType(page, 'order-submit-api-success')).length).toBe(3);
  // The native chart has a separate 250 ms order-drawing discovery window.
  await page.clock.runFor(250);
  await expect(page.locator(STATUS)).toHaveText('Continuous Close Short · Continue in 1s · 1/1 rounds · This round 3/3 · Total 3');
  await page.clock.resume();
  await expect.poll(host.pendingSubmitSequences).toEqual([4]);
  await pauseScenarioClock(page);
  await changeRoute(page, `/zh-CN/futures/${CURRENT_SYMBOL}`);
  await page.clock.runFor(32);

  // Then changing back preserves the first round and the second round's pending first order.
  await expect(page.locator(STATUS)).toHaveText('连续阶梯平空 · 第 1 笔确认中 · 1/2 轮 · 本轮 0/3 笔 · 累计 3 笔');
  await expect(page.getByRole('button', { name: '停止平空', exact: true })).toBeEnabled();
  expect(await eventsOfType(page, 'order-submitted')).toHaveLength(4);

  // When the remaining acknowledgements finish the second round and the user stops.
  await host.releaseSubmitResponse(4);
  await page.clock.resume();
  await expect.poll(host.pendingSubmitSequences).toEqual([6]);
  await pauseScenarioClock(page);
  await host.releaseSubmitResponse(6);
  await expect.poll(async () => (await eventsOfType(page, 'order-submit-api-success')).length).toBe(6);
  await page.clock.runFor(250);
  await expect(page.locator(STATUS)).toHaveText('连续阶梯平空 · 1s 后继续 · 2/2 轮 · 本轮 3/3 笔 · 累计 6 笔');
  await page.getByRole('button', { name: '停止平空', exact: true }).click();
  await page.clock.runFor(5_000);

  // Then no locale change resets or duplicates the six original-direction submissions.
  await expect(page.locator(STATUS)).toHaveText('连续阶梯平空 · 已停止 · 2/2 轮 · 本轮 3/3 笔 · 累计 6 笔');
  expect((await eventsOfType(page, 'order-submitted')).map(({ action, price, quantity }) => ({
    action, price, quantity,
  }))).toEqual([
    { action: '平空', price: '80.9', quantity: '0.1' },
    { action: '平空', price: '80.4', quantity: '0.1' },
    { action: '平空', price: '79.9', quantity: '0.1' },
    { action: '平空', price: '80.9', quantity: '0.1' },
    { action: '平空', price: '80.4', quantity: '0.1' },
    { action: '平空', price: '79.9', quantity: '0.1' },
  ]);
  expect(host.errors).toEqual([]);
});

test('user leaves a futures route while an order is pending without allowing a later ladder submission', async ({ page }) => {
  // Given the first order is pending and the remaining four orders have never been submitted.
  await installScenarioClock(page);
  const host = await openUserscriptScenario(page, createCancelScenario({
    positions: [{ symbol: CURRENT_SYMBOL, side: 'LONG', quantity: '1' }],
    host: { submitApiResponses: [{ outcome: 'success', delivery: 'manual' }] },
  }));
  await page.locator('[data-ladder-action="OPEN_LONG"]').click();
  await expect.poll(host.pendingSubmitSequences).toEqual([1]);
  await pauseScenarioClock(page);
  let positionRequests = 0;
  page.on('request', request => {
    if (new URL(request.url()).pathname === POSITION_PATH) positionRequests += 1;
  });

  // When navigation leaves futures before the native acknowledgement arrives.
  await changeRoute(page, '/zh-CN/markets');
  await page.clock.runFor(32);

  // Then the trading panel is removed while the one earlier request remains pending.
  await expect(page.locator(PANEL)).toHaveCount(0);
  await expect(page.locator('#jh-binance-close-qty-multiplier-spacer')).toHaveCount(0);
  expect(host.pendingSubmitSequences()).toEqual([1]);
  expect(await eventsOfType(page, 'order-submitted')).toHaveLength(1);

  // When the earlier response succeeds and two watchdog intervals pass off the trading route.
  await host.releaseSubmitResponse(1);
  await page.clock.runFor(10_000);

  // Then the old ladder cannot submit its second order or issue a new position read.
  expect(await eventsOfType(page, 'order-submitted')).toHaveLength(1);
  expect(await eventsOfType(page, 'order-submit-api-success')).toHaveLength(1);
  expect(positionRequests).toBe(0);
  await expect(page.locator(PANEL)).toHaveCount(0);

  // When the user returns to the original futures page.
  await changeRoute(page, `/zh-CN/futures/${CURRENT_SYMBOL}`);
  await page.clock.runFor(5_000);

  // Then the restored panel reports interruption and does not restart its abandoned ladder.
  await expect(page.locator(PANEL)).toHaveCount(1);
  await expect(page.locator(STATUS)).toContainText('交易对已切换');
  await expect(page.locator('[data-ladder-stop]')).toHaveCount(0);
  expect(await eventsOfType(page, 'order-submitted')).toHaveLength(1);
  expect(host.errors).toEqual([]);
});

test('user leaving futures stops readiness position polls and does not revive the continuous session on return', async ({ page }) => {
  // Given a completed close round is waiting for a disabled native button and has polled its position.
  const host = await openPendingCloseRound(page);
  let positionRequests = 0;
  page.on('request', request => {
    if (new URL(request.url()).pathname === POSITION_PATH) positionRequests += 1;
  });
  await page.locator('.order-entry').getByRole('button', { name: '平空', exact: true })
    .evaluate(button => { button.disabled = true; });
  const positionResponse = page.waitForResponse(response => new URL(response.url()).pathname === POSITION_PATH);
  await host.releaseSubmitResponse(3);
  await expect.poll(async () => (await eventsOfType(page, 'order-submit-api-success')).length).toBe(3);
  await page.clock.runFor(250);
  await expect(page.locator(STATUS)).toContainText('等待按钮恢复');
  await (await positionResponse).finished();
  expect(positionRequests).toBe(1);

  // When the user leaves futures and more than ten readiness deadlines pass.
  await changeRoute(page, '/zh-CN/markets');
  await page.clock.runFor(10_000);

  // Then business work is stopped and the watchdog never recreates the panel off-route.
  await expect(page.locator(PANEL)).toHaveCount(0);
  expect(positionRequests).toBe(1);
  expect(await eventsOfType(page, 'order-submitted')).toHaveLength(3);
  expect(host.pendingSubmitSequences()).toEqual([]);

  // When the native button becomes ready and the user returns to an English futures page.
  await page.locator('.order-entry').getByRole('button', { name: '平空', exact: true })
    .evaluate(button => { button.disabled = false; });
  await changeRoute(page, `/en/futures/${CURRENT_SYMBOL}`);
  await page.clock.runFor(5_000);

  // Then one account-observer refresh is allowed, but readiness polling and trading stay stopped.
  await expect(page.locator(STATUS)).toHaveText('Continuous Close Short · Stopped · 1/1 rounds · This round 3/3 · Total 3 · Symbol changed');
  await expect(page.locator('[data-ladder-stop]')).toHaveCount(0);
  expect(positionRequests).toBe(2);
  expect(await eventsOfType(page, 'order-submitted')).toHaveLength(3);
  expect(host.errors).toEqual([]);
});

for (const changed of ['symbol', 'precision']) {
  test(`user refuses a stale ladder when ${changed} changes during awaited exchange-rule bootstrap`, async ({ page }) => {
    // Given the new symbol's native exchange rules remain pending while the user starts a ladder.
    await installScenarioClock(page);
    const host = await openUserscriptScenario(page, createCancelScenario());
    const rules = await holdRulesResponse(page, OTHER_SYMBOL);
    await page.evaluate(symbol => window.__BINANCE_FIXTURE__.switchSymbol(symbol), OTHER_SYMBOL);
    await rules.requested;
    await expect(page.locator('#jh-binance-close-qty-final')).toHaveText('最小量读取中');
    await page.locator('[data-ladder-action="OPEN_LONG"]').click();
    await expect(page.locator(STATUS)).toHaveText('阶梯开多准备中');
    await pauseScenarioClock(page);
    expect(await eventsOfType(page, 'order-submitted')).toEqual([]);

    // When the native context changes before the existing exchange-rule response is delivered.
    if (changed === 'symbol') {
      await page.evaluate(symbol => window.__BINANCE_FIXTURE__.switchSymbol(symbol), CURRENT_SYMBOL);
    } else {
      await page.locator('#futuresOrderbook .bn-select-trigger').click();
      await page.getByRole('option', { name: '0.01', exact: true }).click();
    }
    await rules.release();
    await page.clock.runFor(1_000);

    // Then no order is submitted from the stale context and the completed task exposes its specific refusal.
    await expect(page.locator(STATUS)).toContainText(changed === 'symbol'
      ? '交易对已切换'
      : '读取交易规则时价格精度已变化，已停止');
    await expect(page.locator('[data-ladder-stop]')).toHaveCount(0);
    expect(rules.requestCount()).toBe(1);
    expect(await eventsOfType(page, 'order-submitted')).toEqual([]);
    expect(await eventsOfType(page, 'cancel-requested')).toEqual([]);
    expect((await readFixtureState(page)).currentSymbol).toBe(changed === 'symbol' ? CURRENT_SYMBOL : OTHER_SYMBOL);
    expect(host.errors).toEqual([]);
  });
}

test('user keeps a reload recovery record until the chart is ready and its final restored drawing is saved', async ({ page }) => {
  // Given a real reload discovers an old recovery record while the chart toolbar is unavailable.
  const host = await reloadWithRecoveryRecord(page, createCancelScenario({
    orders: ORDER_SETS.current,
    ui: { showOrders: false },
    host: { mutationDelayMs: 500 },
  }));
  await page.locator('.chart-toolbar').evaluate(toolbar => { toolbar.style.display = 'none'; });
  expect(await readRecoveryRecord(page)).toBe(RECOVERY_RECORD);

  // When two route-watchdog checks run before the native chart becomes available.
  await page.clock.runFor(10_000);

  // Then the recovery record remains pending and no chart toggle or save has been fabricated.
  expect(await readRecoveryRecord(page)).toBe(RECOVERY_RECORD);
  expect((await readFixtureState(page)).showOrders).toBe(false);
  expect(await eventsOfType(page, 'chart-orders-checked')).toEqual([]);
  expect(await eventsOfType(page, 'chart-saved')).toEqual([]);

  // When the toolbar returns and route synchronization starts native restoration.
  await page.locator('.chart-toolbar').evaluate(toolbar => { toolbar.style.display = ''; });
  await changeRoute(page, `/en/futures/${CURRENT_SYMBOL}`);
  await expect.poll(async () => (await readFixtureState(page)).showOrders).toBe(true);
  await advanceFromNativeEvent(page, 'chart-orders-checked', 499);

  // Then checking the box alone cannot clear the record before the host publishes its drawing save.
  expect(await readRecoveryRecord(page)).toBe(RECOVERY_RECORD);
  expect(await eventsOfType(page, 'chart-save-requested')).toEqual([]);
  expect(await eventsOfType(page, 'chart-saved')).toEqual([]);

  // When the drawing arrives and the full coalesced-save quiet period completes.
  await page.clock.runFor(1);
  expect(await eventsOfType(page, 'chart-save-requested')).toHaveLength(1);
  await page.clock.runFor(49);
  expect(await readRecoveryRecord(page)).toBe(RECOVERY_RECORD);
  expect(await eventsOfType(page, 'chart-saved')).toEqual([]);
  await page.clock.runFor(1);

  // Then exactly the final restored snapshot is saved and only now is the recovery record removed.
  await expect.poll(() => readRecoveryRecord(page)).toBe(null);
  expect((await eventsOfType(page, 'chart-saved')).map(({ snapshot }) => snapshot)).toEqual([
    { checked: true, drawingCount: 1, finalOrderId: 'current-1' },
  ]);
  await expect(page.locator('#chart-orders-menu')).not.toHaveClass(/active/);
  expect((await readFixtureState(page)).orders).toEqual(ORDER_SETS.current);
  expect(await eventsOfType(page, 'order-submitted')).toEqual([]);
  expect(host.errors).toEqual([]);
});

test('user clears a valid reload journal without toggling an already restored chart', async ({ page }) => {
  // Given a real reload retains a valid journal although native order drawings are already enabled.
  const host = await reloadWithRecoveryRecord(page, createCancelScenario({
    orders: ORDER_SETS.current,
    ui: { showOrders: true },
  }));
  expect(await readRecoveryRecord(page)).toBe(RECOVERY_RECORD);

  // When the current native chart is checked during a locale-only route transition.
  await changeRoute(page, `/en/futures/${CURRENT_SYMBOL}`);

  // Then restoration closes the menu and clears the journal without any toggle or chart save.
  await expect.poll(() => readRecoveryRecord(page)).toBe(null);
  expect((await readFixtureState(page)).showOrders).toBe(true);
  expect(await eventsOfType(page, 'chart-orders-popover-opened')).toHaveLength(1);
  expect(await eventsOfType(page, 'chart-orders-popover-closed')).toHaveLength(1);
  expect(await eventsOfType(page, 'chart-orders-checked')).toEqual([]);
  expect(await eventsOfType(page, 'chart-saved')).toEqual([]);
  expect(host.errors).toEqual([]);
});

test('user keeps the reload journal when native chart restoration cannot close its menu', async ({ page }) => {
  // Given the native host explicitly refuses to close the chart orders menu after reload.
  const host = await reloadWithRecoveryRecord(page, createCancelScenario({
    orders: ORDER_SETS.current,
    ui: { showOrders: false },
    host: { chartOrdersPopoverCloseMode: 'stuck' },
  }));

  // When restoration checks the box but reaches the native menu-close deadline.
  await changeRoute(page, `/en/futures/${CURRENT_SYMBOL}`);
  await expect.poll(async () => (await readFixtureState(page)).showOrders).toBe(true);
  await page.clock.runFor(2_000);

  // Then a successful chart save alone does not falsely complete restoration.
  expect(await readRecoveryRecord(page)).toBe(RECOVERY_RECORD);
  expect(await eventsOfType(page, 'chart-orders-checked')).toHaveLength(1);
  expect(await eventsOfType(page, 'chart-saved')).toHaveLength(1);
  await expect(page.locator('#chart-orders-menu')).toHaveClass(/active/);

  // When another route transition retries the still pending native cleanup.
  await changeRoute(page, `/zh-CN/futures/${CURRENT_SYMBOL}`);
  await page.clock.runFor(2_000);

  // Then the record remains retryable without toggling the already restored order drawings again.
  expect(await readRecoveryRecord(page)).toBe(RECOVERY_RECORD);
  expect(await eventsOfType(page, 'chart-orders-checked')).toHaveLength(1);
  expect(await eventsOfType(page, 'chart-orders-popover-close-requested')).toHaveLength(2);
  expect((await readFixtureState(page)).orders).toEqual(ORDER_SETS.current);
  expect(await eventsOfType(page, 'cancel-requested')).toEqual([]);
  expect(host.errors).toEqual([]);
});

for (const [name, record] of [
  ['malformed', '{'],
  ['unsupported', JSON.stringify({ version: 1, originalChecked: true, createdAtMs: 1_000 })],
]) {
  test(`user discards ${name} reload data without changing native chart visibility`, async ({ page }) => {
    // Given invalid persisted recovery data exists before the generated userscript loads again.
    const host = await reloadWithRecoveryRecord(page, createCancelScenario({
      orders: ORDER_SETS.current,
      ui: { showOrders: false },
    }), record);

    // When the reloaded page and two later route-watchdog checks process that journal.
    await page.clock.runFor(10_000);

    // Then the invalid record is removed without any chart or order mutation.
    expect(await readRecoveryRecord(page)).toBe(null);
    expect((await readFixtureState(page)).showOrders).toBe(false);
    expect((await readFixtureState(page)).orders).toEqual(ORDER_SETS.current);
    expect(await eventsOfType(page, 'chart-orders-popover-opened')).toEqual([]);
    expect(await eventsOfType(page, 'chart-orders-checked')).toEqual([]);
    expect(await eventsOfType(page, 'chart-saved')).toEqual([]);
    expect(await eventsOfType(page, 'order-submitted')).toEqual([]);
    expect(host.errors).toEqual([]);
  });
}

test('user does not restore chart visibility after the pending reload journal is removed', async ({ page }) => {
  // Given startup has a valid record but has not yet found the native chart target.
  const host = await reloadWithRecoveryRecord(page, createCancelScenario({ ui: { showOrders: false } }));
  expect(await readRecoveryRecord(page)).toBe(RECOVERY_RECORD);

  // When that session record is cleared before route synchronization can restore it.
  await page.evaluate(key => sessionStorage.removeItem(key), RECOVERY_KEY);
  await changeRoute(page, `/en/futures/${CURRENT_SYMBOL}`);
  await page.clock.runFor(10_000);

  // Then the pending recovery stops and later watchdog checks preserve the native hidden state.
  expect(await readRecoveryRecord(page)).toBe(null);
  expect((await readFixtureState(page)).showOrders).toBe(false);
  expect(await eventsOfType(page, 'chart-orders-popover-opened')).toEqual([]);
  expect(await eventsOfType(page, 'chart-orders-checked')).toEqual([]);
  expect(host.errors).toEqual([]);
});
