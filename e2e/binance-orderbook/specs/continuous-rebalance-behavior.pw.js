import { test, expect } from '../test.js';
import { ACCOUNT_PATHS, createAccountRebalanceApi } from '../fixtures/account-rebalance-api.js';
import { CURRENT_SYMBOL, OTHER_SYMBOL, ORDER_SETS, createCancelScenario } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario, readFixtureState } from '../helpers/userscript-page.js';
import { installScenarioClock, pauseScenarioClock } from '../helpers/scenario-clock.js';
import { installSimulatedVisibility, setSimulatedVisibility } from '../helpers/simulated-visibility.js';

const ACTION = '[data-usdt-rebalance]';
const STATUS = '#jh-binance-ladder-status';
const OTHER_POSITION = { symbol: OTHER_SYMBOL, side: 'LONG', quantity: '1' };
const API_OTHER_POSITION = { symbol: OTHER_SYMBOL, positionSide: 'LONG', positionAmount: '1' };

/** Keep the last acknowledgement pending while native account updates settle. */
async function openPendingClose(page, side) {
  await installScenarioClock(page);
  const host = await openUserscriptScenario(page, createCancelScenario({
    positions: [{ symbol: CURRENT_SYMBOL, side, quantity: '100' }],
    ui: { tradeMode: 'CLOSE' },
    host: { submitApiResponses: [
      { outcome: 'success', delivery: 'immediate' },
      { outcome: 'success', delivery: 'immediate' },
      { outcome: 'success', delivery: 'manual' },
    ] },
  }));
  const panel = page.locator('#jh-binance-close-qty-multiplier-panel');
  await panel.locator('[data-ladder-group="levels"][data-ladder-value="3"]').click();
  const action = side === 'LONG' ? '平多' : '平空';
  await panel.getByRole('button', { name: `阶梯${action}`, exact: true }).click({ modifiers: ['Alt'] });
  await expect.poll(host.pendingSubmitSequences).toEqual([3]);
  await pauseScenarioClock(page);

  const api = createAccountRebalanceApi({ FUNDING: '100', MAIN: '0', UMFUTURE: '0' });
  await page.route('https://www.binance.com/bapi/**', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (!api.supports(pathname)) return route.fallback();
    const body = request.postData() === null ? undefined : request.postDataJSON();
    const response = api.handle({ pathname, method: request.method(), body });
    await route.fulfill({ status: response.status, contentType: 'application/json', body: JSON.stringify(response.body) });
  });
  return { ...host, api, action };
}

async function publishAccount(page, positions = [], orders = []) {
  await page.evaluate(({ positions, orders }) => {
    window.__BINANCE_FIXTURE__.setPositions(positions);
    window.__BINANCE_FIXTURE__.setOrders(orders);
  }, { positions, orders });
}

async function finishClose(page, host) {
  await host.releaseSubmitResponse(3);
  await page.clock.runFor(50);
  await expect(page.locator(STATUS)).toHaveText(
    `连续阶梯${host.action} · 已结束 · 当前方向已无持仓 · 1/1 轮 · 累计 3 笔`,
  );
}

async function expectNoAdditionalTrading(page, host) {
  const events = (await readFixtureState(page)).events;
  expect(events.filter(({ type }) => type === 'order-submitted').map(({ action }) => action))
    .toEqual(Array(3).fill(host.action));
  expect(events.filter(({ type }) => /cancel-requested/.test(type))).toEqual([]);
  expect(host.api.snapshot().requests.filter(({ pathname }) => pathname === ACCOUNT_PATHS.transfer)).toEqual([]);
  expect(host.errors).toEqual([]);
}

for (const side of ['LONG', 'SHORT']) {
  test(`user regains rebalance after continuous ${side} closing misses its flat check while busy`, async ({ page }) => {
    // Given the final close acknowledgement is held while the account becomes flat.
    const host = await openPendingClose(page, side);
    await publishAccount(page);

    // When the full flat window expires before the continuous task has finished.
    await page.clock.runFor(2000);

    // Then the busy task prevents qualification even though both counters are zero.
    await expect(page.locator('[data-account-tab="positions"]')).toHaveText('仓位(0)');
    await expect(page.locator('[data-account-tab="openOrders"]')).toHaveText('当前委托(0)');
    await expect(page.getByRole('button', { name: `停止${host.action}`, exact: true })).toBeVisible();
    await expect(page.locator(ACTION)).toBeHidden();

    // When the final acknowledgement arrives without another account-counter change.
    await finishClose(page, host);
    let qualificationRequested = false;
    const release = Promise.withResolvers();
    await page.route(`https://www.binance.com${ACCOUNT_PATHS.positions}`, async route => {
      qualificationRequested = true;
      await release.promise;
      await route.fallback();
    });
    const requestsBefore = host.api.snapshot().requests.length;
    await page.clock.runFor(1949);

    // Then the renewed full two-second window still prevents an early check.
    expect(host.api.snapshot().requests).toHaveLength(requestsBefore);
    expect(qualificationRequested).toBe(false);
    await expect(page.locator(ACTION)).toBeHidden();

    // When the renewed deadline passes but its fresh authoritative response is held.
    await page.clock.runFor(51);
    await expect.poll(() => qualificationRequested).toBe(true);

    // Then prior flat evidence cannot expose the action before the new response.
    await expect(page.locator(ACTION)).toBeHidden();

    // When the fresh response confirms all account positions are flat.
    const response = page.waitForResponse(`https://www.binance.com${ACCOUNT_PATHS.positions}`);
    release.resolve();
    await (await response).finished();
    await page.clock.runFor(32);

    // Then the action returns automatically without any extra order or transfer.
    await expect.poll(async () => {
      await page.clock.runFor(32);
      return page.locator(ACTION).isEnabled();
    }).toBe(true);
    await expect(page.locator(ACTION)).toBeVisible();
    await expect(page.locator(ACTION)).toBeEnabled();
    await expectNoAdditionalTrading(page, host);
  });
}

for (const blocker of ['native position', 'native order', 'API position']) {
  test(`user cannot rebalance after continuous closing while another ${blocker} remains`, async ({ page }) => {
    // Given a pending close still has unrelated account activity.
    const host = await openPendingClose(page, 'LONG');
    if (blocker !== 'native order') host.api.setPositions([API_OTHER_POSITION]);
    await publishAccount(page,
      blocker === 'native position' ? [OTHER_POSITION] : [],
      blocker === 'native order' ? ORDER_SETS.other : [],
    );

    // When the current direction finishes and another full qualification window passes.
    await page.clock.runFor(2000);
    await finishClose(page, host);
    await page.clock.runFor(2050);

    // Then current-direction completion cannot expose a globally unsafe rebalance action.
    await expect(page.locator(ACTION)).toBeHidden();
    if (blocker === 'API position') {
      expect(host.api.snapshot().requests.filter(({ pathname }) => pathname === ACCOUNT_PATHS.positions).length)
        .toBeGreaterThanOrEqual(3);
    }
    await expectNoAdditionalTrading(page, host);
  });
}

test('user qualifies after returning to a page where continuous closing finished while hidden', async ({ page }) => {
  // Given a continuous close is pending with its visible position snapshot settled.
  const host = await openPendingClose(page, 'LONG');
  await installSimulatedVisibility(page);
  await page.clock.runFor(32);

  // When the page hides before the flat account update and final acknowledgement arrive.
  await setSimulatedVisibility(page, true);
  await publishAccount(page);
  await host.releaseSubmitResponse(3);
  await page.clock.runFor(2050);

  // Then the next round detects flat before submitting, while the hidden page cannot qualify.
  await expect(page.locator(STATUS)).toHaveText(
    '连续阶梯平多 · 已结束 · 当前方向已无持仓 · 1/2 轮 · 累计 3 笔',
  );
  await expect(page.locator(ACTION)).toBeHidden();
  const completedRequests = host.api.snapshot().requests.length;

  // When another full eligibility interval passes while the completed page stays hidden.
  await page.clock.runFor(2000);

  // Then completion cannot start a hidden account qualification request.
  expect(host.api.snapshot().requests).toHaveLength(completedRequests);
  await expect(page.locator(ACTION)).toBeHidden();

  // When the page returns and completes a fresh visible flat window.
  await setSimulatedVisibility(page, false);
  await page.clock.runFor(1999);

  // Then the action is still hidden before the full two seconds.
  await expect(page.locator(ACTION)).toBeHidden();

  // When the remaining millisecond passes and the fresh flat response arrives.
  const response = page.waitForResponse(`https://www.binance.com${ACCOUNT_PATHS.positions}`);
  await page.clock.runFor(1);
  await (await response).finished();
  await page.clock.runFor(32);

  // Then returning visibility restores the manual action without automatic transfers.
  await expect(page.locator(ACTION)).toBeVisible();
  await expectNoAdditionalTrading(page, host);
});
