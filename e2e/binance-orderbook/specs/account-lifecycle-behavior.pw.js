import { test, expect } from '../test.js';
import { ACCOUNT_PATHS } from '../fixtures/account-rebalance-api.js';
import { CURRENT_SYMBOL, OTHER_SYMBOL, ORDER_SETS } from '../scenarios/cancel-current-symbol.js';
import { LEVERAGE_PATH, THIRD_SYMBOL, openAccountLifecycleHost } from '../helpers/account-lifecycle-host.js';
import { readFixtureState } from '../helpers/userscript-page.js';

const ACTION = '[data-usdt-rebalance]';
const POSITION_TAB = '[data-account-tab="positions"]';
const OPEN_TAB = '#position-direction [data-trade-mode="OPEN"]';
const CLOSE_TAB = '#position-direction [data-trade-mode="CLOSE"]';
const CURRENT_POSITION = { symbol: CURRENT_SYMBOL, side: 'LONG', quantity: '1' };
const OTHER_POSITION = { symbol: OTHER_SYMBOL, side: 'LONG', quantity: '2' };
const API_CURRENT_POSITION = { symbol: CURRENT_SYMBOL, positionSide: 'LONG', positionAmount: '1' };
const API_OTHER_POSITION = { symbol: OTHER_SYMBOL, positionSide: 'LONG', positionAmount: '2' };

async function openSettledAccount(page, options) {
  const host = await openAccountLifecycleHost(page, options);
  await host.releaseHeaders();
  await host.waitForPositionResponses(2);
  await page.clock.runFor(32);
  return host;
}

async function expectEligible(page) {
  await page.clock.runFor(32);
  await expect(page.locator(ACTION)).toBeVisible();
  await expect(page.locator(ACTION)).toBeEnabled();
}

async function switchSymbol(page, symbol) {
  await page.evaluate(value => window.__BINANCE_FIXTURE__.switchSymbol(value), symbol);
  await page.clock.runFor(32);
}

test('user receives independently declared account API data after native counters change', async ({ page }) => {
  // Given bootstrap headers are held and the offline API declares an empty account.
  const host = await openAccountLifecycleHost(page);
  const sequence = host.holdPositionResponse();
  await host.setNativePositions([CURRENT_POSITION]);

  // When a native account request is captured before a later server-side position update.
  const response = page.evaluate(async pathname => {
    const result = await fetch(pathname, { method: 'POST', body: JSON.stringify({}) });
    return result.json();
  }, ACCOUNT_PATHS.positions);
  await expect.poll(host.pendingPositionResponses).toEqual([sequence]);
  host.api.setPositions([API_OTHER_POSITION]);

  // Then the DOM mutation cannot rewrite the already captured HTTP response.
  await expect(page.locator(POSITION_TAB)).toHaveText('仓位(1)');
  expect((await host.snapshot()).bootstrapHeld).toBe(true);
  expect((await host.snapshot()).requests.map(request => request.settled)).toEqual([false]);

  // When the captured response is deliberately released.
  await host.releasePositionResponse(sequence);

  // Then the caller receives the captured empty account and no trading action occurs.
  expect(await response).toEqual({ success: true, data: [] });
  expect((await readFixtureState(page)).positions).toEqual([CURRENT_POSITION]);
  await host.expectNoTradingActions();
});

for (const elapsed of [1000, 5500]) {
  test(`user wakes a pending leverage check when native headers arrive after ${elapsed} milliseconds`, async ({ page }) => {
    // Given the native bootstrap has not reached the real interceptor and leverage starts at five.
    const host = await openAccountLifecycleHost(page, { leverage: 5 });

    // When the page advances while no captured request headers are available.
    await page.clock.runFor(elapsed);
    const releaseAt = await page.evaluate(() => Date.now());

    // Then neither position requests nor leverage adjustments can begin from missing headers.
    expect((await host.snapshot()).requests).toEqual([]);
    expect((await readFixtureState(page)).leverage).toBe(5);
    expect(host.leverageRequests).toEqual([]);

    // When the actual native bootstrap is released without advancing the page clock.
    expect(await host.releaseHeaders()).toBe(200);
    await expect.poll(async () => (await readFixtureState(page)).leverage).toBe(2);

    // Then the header event immediately wakes fresh position checks and one current-symbol reset.
    expect(host.leverageRequests).toEqual([{ symbol: CURRENT_SYMBOL, leverage: 2 }]);
    const requests = (await host.snapshot()).requests;
    expect(requests.filter(request => request.pathname === ACCOUNT_PATHS.positions).map(request => request.at))
      .toEqual(expect.arrayContaining([releaseAt]));
    expect(requests.find(request => request.pathname === LEVERAGE_PATH).at).toBe(releaseAt);
    await host.expectNoTradingActions();
  });
}

test('user keeps close-mode leverage unchanged when previously missing native headers arrive', async ({ page }) => {
  // Given an open-mode check waits for native headers with leverage five.
  const host = await openAccountLifecycleHost(page, { leverage: 5 });

  // When the native user selects Close before the bootstrap is released.
  await page.locator(CLOSE_TAB).evaluate(tab => tab.click());
  await page.clock.runFor(32);
  await host.releaseHeaders();
  await host.waitForPositionResponses(1);
  await page.clock.runFor(1000);

  // Then the old open request cannot adjust the leverage in the new mode.
  expect((await readFixtureState(page)).tradeMode).toBe('CLOSE');
  expect((await readFixtureState(page)).leverage).toBe(5);
  expect(host.leverageRequests).toEqual([]);
  await host.expectNoTradingActions();
});

test('user requires a fresh flat position response immediately before adjusting leverage', async ({ page }) => {
  // Given the first position response is flat but the next native read is held.
  const host = await openAccountLifecycleHost(page, { leverage: 5 });
  const finalRead = host.holdPositionResponse(2);
  await host.releaseHeaders();
  await expect.poll(host.pendingPositionResponses).toContain(finalRead);

  // When the authoritative second response reports a position that the native DOM has not published.
  await host.releasePositionResponse(finalRead, { status: 200, body: { success: true, data: [API_CURRENT_POSITION] } });
  await host.waitForPositionResponses(2);

  // Then a stale flat observation never authorizes a leverage request.
  await expect(page.locator(POSITION_TAB)).toHaveText('仓位(0)');
  expect((await readFixtureState(page)).leverage).toBe(5);
  expect(host.leverageRequests).toEqual([]);
  await host.expectNoTradingActions();
});

test('user replays only the latest symbol after a busy account position check', async ({ page }) => {
  // Given the first symbol has one held native position response.
  const host = await openAccountLifecycleHost(page, { leverage: 5 });
  const firstRead = host.holdPositionResponse(1);
  await host.releaseHeaders();
  await expect.poll(host.pendingPositionResponses).toEqual([firstRead]);

  // When the native route visits B and then C before the original response arrives.
  await switchSymbol(page, OTHER_SYMBOL);
  await switchSymbol(page, THIRD_SYMBOL);
  await host.releasePositionResponse(firstRead);
  await expect.poll(async () => (await readFixtureState(page)).leverage).toBe(2);

  // Then the superseded B request is not fetched and only C receives a reset.
  const positionSymbols = (await host.snapshot()).requests
    .filter(request => request.pathname === ACCOUNT_PATHS.positions).map(request => request.symbol);
  expect(positionSymbols[0]).toBe(CURRENT_SYMBOL);
  expect(positionSymbols.slice(1).every(symbol => symbol === THIRD_SYMBOL)).toBe(true);
  expect(positionSymbols.slice(1).length).toBeGreaterThanOrEqual(2);
  expect(host.leverageRequests).toEqual([{ symbol: THIRD_SYMBOL, leverage: 2 }]);
  await host.expectNoTradingActions();
});

test('user replays only the latest reset after switching symbols during its final position read', async ({ page }) => {
  // Given the original reset is busy on its final authoritative read.
  const host = await openAccountLifecycleHost(page, { leverage: 5 });
  const finalRead = host.holdPositionResponse(2);
  await host.releaseHeaders();
  await expect.poll(host.pendingPositionResponses).toContain(finalRead);

  // When separate B and C account observations request a reset while the original task remains busy.
  await switchSymbol(page, OTHER_SYMBOL);
  await expect.poll(async () => (await host.snapshot()).requests
    .filter(request => request.pathname === ACCOUNT_PATHS.positions && request.symbol === OTHER_SYMBOL && request.settled).length)
    .toBeGreaterThanOrEqual(1);
  await switchSymbol(page, THIRD_SYMBOL);
  await expect.poll(async () => (await host.snapshot()).requests
    .filter(request => request.pathname === ACCOUNT_PATHS.positions && request.symbol === THIRD_SYMBOL && request.settled).length)
    .toBeGreaterThanOrEqual(1);
  await host.releasePositionResponse(finalRead);
  await expect.poll(async () => (await readFixtureState(page)).leverage).toBe(2);

  // Then neither the original symbol nor the overwritten pending symbol can adjust leverage.
  expect(host.leverageRequests).toEqual([{ symbol: THIRD_SYMBOL, leverage: 2 }]);
  expect((await readFixtureState(page)).currentSymbol).toBe(THIRD_SYMBOL);
  await host.expectNoTradingActions();
});

test('user refreshes current-symbol position evidence when an account position count changes', async ({ page }) => {
  // Given the current and another symbol both have native and authoritative positions.
  const host = await openSettledAccount(page, {
    leverage: 5,
    positions: [CURRENT_POSITION, OTHER_POSITION],
    apiPositions: [API_CURRENT_POSITION, API_OTHER_POSITION],
  });
  const before = host.api.snapshot().requests.filter(request => request.pathname === ACCOUNT_PATHS.positions).length;

  // When the current position closes and the account counter falls from two to one.
  host.api.setPositions([API_OTHER_POSITION]);
  await host.setNativePositions([OTHER_POSITION]);
  await expect.poll(async () => (await readFixtureState(page)).leverage).toBe(2);

  // Then fresh current-symbol API checks permit one reset despite the other open position.
  await expect(page.locator(POSITION_TAB)).toHaveText('仓位(1)');
  const reads = host.api.snapshot().requests.filter(request => request.pathname === ACCOUNT_PATHS.positions);
  expect(reads.length).toBeGreaterThanOrEqual(before + 2);
  expect(reads.slice(before).map(request => request.body)).toEqual(Array(reads.length - before).fill({}));
  expect(host.leverageRequests).toEqual([{ symbol: CURRENT_SYMBOL, leverage: 2 }]);
  await host.expectNoTradingActions();
});

test('user does not repeat account HTTP checks while counts and symbol remain unchanged', async ({ page }) => {
  // Given a held position has been observed and an open order prevents rebalance qualification.
  const host = await openSettledAccount(page, {
    leverage: 5, positions: [CURRENT_POSITION], apiPositions: [API_CURRENT_POSITION],
  });
  const before = host.api.snapshot().requests;

  // When unrelated native counter text is redelivered and five seconds of page time elapse.
  await host.setNativePositions([CURRENT_POSITION]);
  await page.clock.runFor(5000);

  // Then stable observations and the route watchdog create no periodic account requests.
  expect(host.api.snapshot().requests).toEqual(before);
  expect(host.leverageRequests).toEqual([]);
  expect((await readFixtureState(page)).leverage).toBe(5);
  await host.expectNoTradingActions();
});

test('user preserves the existing leverage after an HTTP rejection and can retry from a later native mode change', async ({ page }) => {
  // Given a flat current symbol receives a declared HTTP failure from its first reset.
  const host = await openAccountLifecycleHost(page, { leverage: 5 });
  host.failNextLeverage(503);
  await host.releaseHeaders();
  await host.waitForPositionResponses(2);
  await expect.poll(async () => (await host.snapshot()).requests
    .filter(request => request.pathname === LEVERAGE_PATH && request.status === 503).length).toBe(1);

  // When the user observes the failed reset before any new native context transition.
  const rejected = await readFixtureState(page);

  // Then the HTTP rejection never changes native leverage or reports a successful adjustment.
  expect(rejected.leverage).toBe(5);
  expect(rejected.events.filter(event => event.type === 'leverage-adjusted')).toEqual([]);

  // When the user returns from Close to Open after the declared reset deduplication window.
  await page.locator(CLOSE_TAB).evaluate(tab => tab.click());
  await page.clock.runFor(1300);
  await page.locator(OPEN_TAB).evaluate(tab => tab.click());
  await page.clock.runFor(32);
  await expect.poll(async () => (await readFixtureState(page)).leverage).toBe(2);

  // Then the new transition obtains fresh evidence and exactly one successful native adjustment.
  expect(host.leverageRequests).toEqual(Array(2).fill({ symbol: CURRENT_SYMBOL, leverage: 2 }));
  expect((await readFixtureState(page)).events.filter(event => event.type === 'leverage-adjusted'))
    .toEqual([expect.objectContaining({ symbol: CURRENT_SYMBOL, leverage: 2 })]);
  await host.expectNoTradingActions();
});

test('user qualifies for account rebalance only after the full three-second flat window and its API response', async ({ page }) => {
  // Given a settled flat account still has one native open order.
  const host = await openSettledAccount(page);
  const sequence = host.holdPositionResponse();
  const startedAt = await host.setNativeOrders([]);

  // When the stable no-order window advances to one millisecond before its deadline.
  await page.clock.runFor(2999);

  // Then no qualification request or rebalance action is exposed early.
  expect(host.pendingPositionResponses()).toEqual([]);
  await expect(page.locator(ACTION)).toBeHidden();

  // When the last millisecond expires but the authoritative response is still held.
  await page.clock.runFor(1);
  await expect.poll(host.pendingPositionResponses).toEqual([sequence]);

  // Then exactly the full window precedes the API request and HTTP completion is still required.
  const latest = (await host.snapshot()).requests.filter(request => request.pathname === ACCOUNT_PATHS.positions).at(-1);
  expect(latest.at).toBe(startedAt + 3000);
  await expect(page.locator(ACTION)).toBeHidden();

  // When the explicit flat response arrives.
  await host.releasePositionResponse(sequence);
  await host.waitForPositionResponses(sequence);

  // Then the eligible action appears without any transfer or order request.
  await expectEligible(page);
  await host.expectNoTradingActions();
});

for (const changed of ['position', 'open order']) {
  test(`user restarts the full rebalance window when a native ${changed} reappears`, async ({ page }) => {
    // Given the account has already spent fifteen hundred milliseconds with no positions or orders.
    const host = await openSettledAccount(page);
    await host.setNativeOrders([]);
    await page.clock.runFor(1500);

    // When an account activity arrives and clears again before the original deadline.
    if (changed === 'position') {
      host.api.setPositions([API_CURRENT_POSITION]);
      await host.setNativePositions([CURRENT_POSITION]);
      host.api.setPositions([]);
      await host.setNativePositions([]);
    } else {
      await host.setNativeOrders(ORDER_SETS.other);
      await host.setNativeOrders([]);
    }
    await page.clock.runFor(2999);

    // Then the original flat time is discarded and the new window remains incomplete.
    await expect(page.locator(ACTION)).toBeHidden();

    // When the new activity-free window reaches three full seconds.
    await page.clock.runFor(1);
    await host.waitForPositionResponses(3);

    // Then fresh authoritative flat evidence permits the action without side effects.
    await expectEligible(page);
    await host.expectNoTradingActions();
  });
}

for (const changed of ['position', 'open order']) {
  test(`user discards a stale flat qualification response after a native ${changed} arrives`, async ({ page }) => {
    // Given the full flat window has started an authoritative request that is still pending.
    const host = await openSettledAccount(page);
    const sequence = host.holdPositionResponse();
    await host.setNativeOrders([]);
    await page.clock.runFor(3000);
    await expect.poll(host.pendingPositionResponses).toEqual([sequence]);

    // When native account activity invalidates qualification before the captured flat response returns.
    if (changed === 'position') {
      host.api.setPositions([API_CURRENT_POSITION]);
      await host.setNativePositions([CURRENT_POSITION]);
    } else {
      await host.setNativeOrders(ORDER_SETS.other);
    }
    await host.releasePositionResponse(sequence);
    await host.waitForPositionResponses(sequence);
    await page.clock.runFor(32);

    // Then the stale flat response cannot expose an action for the changed account.
    await expect(page.locator(ACTION)).toBeHidden();
    expect((await readFixtureState(page))[changed === 'position' ? 'positions' : 'orders'].length).toBe(1);
    await host.expectNoTradingActions();
  });
}

for (const [name, response] of [
  ['other-symbol position', { status: 200, body: { success: true, data: [API_OTHER_POSITION] } }],
  ['malformed position payload', { status: 200, body: { success: true, data: null } }],
  ['HTTP service failure', { status: 503, body: { success: false } }],
]) {
  test(`user cannot qualify from zero DOM counts when the API reports ${name}`, async ({ page }) => {
    // Given native counters are ready to become empty after initial account observation.
    const host = await openSettledAccount(page);
    host.api.failNext(ACCOUNT_PATHS.positions, response);

    // When the empty account completes its window and receives non-flat or invalid authoritative evidence.
    await host.setNativeOrders([]);
    await page.clock.runFor(3000);
    await host.waitForPositionResponses(3);
    await page.clock.runFor(32);

    // Then DOM zero alone cannot authorize the account action or any financial request.
    await expect(page.locator(POSITION_TAB)).toHaveText('仓位(0)');
    await expect(page.locator('[data-account-tab="openOrders"]')).toHaveText('当前委托(0)');
    await expect(page.locator(ACTION)).toBeHidden();
    await host.expectNoTradingActions();
  });
}

test('user previews balances published during qualification instead of an earlier account snapshot', async ({ page }) => {
  // Given the account begins its flat window with one hundred USDT in Funding.
  const host = await openSettledAccount(page);
  await host.setNativeOrders([]);
  await page.clock.runFor(1500);

  // When a native wallet update moves twenty USDT to Spot before qualification completes.
  host.api.setBalances({ FUNDING: '80', MAIN: '20', UMFUTURE: '0' });
  await page.clock.runFor(1500);
  await host.waitForPositionResponses(3);
  await expectEligible(page);

  // Then qualification has not cached balances or sent an account transfer.
  expect(host.api.snapshot().requests.filter(request => request.pathname === ACCOUNT_PATHS.wallets)).toEqual([]);
  await host.expectNoTradingActions();

  // When the user opens the now-eligible account preview.
  await page.locator(ACTION).evaluate(button => button.click());
  const dialog = page.getByRole('dialog', { name: '账户再平衡' });

  // Then the reviewed plan uses the newly published balances and remains unexecuted.
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('20 USDT');
  await expect(dialog).toContainText('10 USDT');
  await expect(dialog).not.toContainText('40 USDT');
  expect(host.api.snapshot().balances).toEqual({ FUNDING: '80', MAIN: '20', UMFUTURE: '0' });
  await dialog.getByRole('button', { name: '取消', exact: true }).evaluate(button => button.click());
  await host.expectNoTradingActions();
});
