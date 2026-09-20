import { test, expect } from '../test.js';
import { CURRENT_SYMBOL, createCancelScenario } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario, readFixtureState } from '../helpers/userscript-page.js';
import { installScenarioClock, pauseScenarioClock } from '../helpers/scenario-clock.js';
import { installSimulatedVisibility, setSimulatedVisibility } from '../helpers/simulated-visibility.js';

const PANEL = '#jh-binance-close-qty-multiplier-panel';
const STATUS = '#jh-binance-ladder-status';
const POSITION_PATH = '**/bapi/futures/v6/private/future/user-data/user-position';

test.afterEach(async ({ page }, testInfo) => {
  const observation = await page.evaluate(() => {
    const probe = window.__CONTINUOUS_STATUS_PROBE__;
    if (!probe) return null;
    const snapshot = {
      phases: probe.events,
      nativeButtons: Array.from(document.querySelectorAll('.order-entry button'), (button) => ({
        text: button.textContent,
        disabled: button.disabled,
        display: getComputedStyle(button).display,
      })),
      precision: document.querySelector('#futuresOrderbook .tick-content')?.textContent,
      stopButtons: document.querySelectorAll('[data-ladder-stop]').length,
    };
    probe.observer.disconnect();
    delete window.__CONTINUOUS_STATUS_PROBE__;
    return snapshot;
  });
  if (testInfo.status !== testInfo.expectedStatus && observation !== null) {
    await testInfo.attach('continuous-readiness.json', {
      body: Buffer.from(JSON.stringify(observation, null, 2)),
      contentType: 'application/json',
    });
  }
});

/** Observe rendered phases so timing assertions start at the actual transition. */
async function observeContinuousStatus(page) {
  await page.locator(STATUS).evaluate((status) => {
    const events = [];
    const observer = new MutationObserver(() => {
      events.push({ at: performance.now(), text: status.textContent });
    });
    observer.observe(status, { childList: true, characterData: true, subtree: true });
    window.__CONTINUOUS_STATUS_PROBE__ = { events, observer };
  });
}

async function advanceFromStatus(page, text, elapsed) {
  const remaining = await page.evaluate(({ text, elapsed }) => {
    const event = window.__CONTINUOUS_STATUS_PROBE__.events
      .filter((entry) => entry.text.includes(text)).at(-1);
    if (!event) throw new Error(`The rendered phase was not observed: ${text}`);
    return event.at + elapsed - performance.now();
  }, { text, elapsed });
  expect(remaining).toBeGreaterThanOrEqual(0);
  await page.clock.runFor(remaining);
}

async function readSubmissions(page) {
  return (await readFixtureState(page)).events.filter(({ type }) => type === 'order-submitted');
}

function observePositionRequests(page) {
  let requests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/bapi/futures/v6/private/future/user-data/user-position') {
      requests += 1;
    }
  });
  return () => requests;
}

/** The last order of each round and the next round's first order are network gates. */
async function openPendingFirstRound(page) {
  await installScenarioClock(page);
  const host = await openUserscriptScenario(page, createCancelScenario({
    positions: [{ symbol: CURRENT_SYMBOL, side: 'SHORT', quantity: '100' }],
    ui: { tradeMode: 'CLOSE', orderbookPrecision: '0.1' },
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
  const panel = page.locator(PANEL);
  await panel.locator('[data-ladder-group="levels"][data-ladder-value="3"]').click();
  await observeContinuousStatus(page);
  await panel.getByRole('button', { name: '阶梯平空', exact: true }).click({ modifiers: ['Alt'] });
  await expect.poll(host.pendingSubmitSequences).toEqual([3]);
  await pauseScenarioClock(page);
  return {
    ...host,
    panel,
    status: panel.locator(STATUS),
    nativeButton: page.locator('.order-entry').getByRole('button', {
      name: '平空', exact: true, includeHidden: true,
    }),
  };
}

async function stopContinuousRound(page, host) {
  await host.panel.getByRole('button', { name: '停止平空', exact: true }).click();
  await page.clock.runFor(100);
  await expect(host.status).toContainText('已停止');
}

/** Hold the first position response; the second explicitly confirms flat. */
async function gatePositionRecheck(page, firstResponse) {
  const release = Promise.withResolvers();
  let requests = 0;
  await page.route(POSITION_PATH, async (route) => {
    requests += 1;
    expect(requests).toBeLessThanOrEqual(2);
    if (requests === 1) {
      await release.promise;
      await route.fulfill(firstResponse);
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [] }),
    });
  });
  return {
    requestCount: () => requests,
    async releaseFirst() {
      const received = page.waitForResponse(POSITION_PATH);
      release.resolve();
      const response = await received;
      await response.finished();
    },
  };
}

test('user completes two close-short rounds with a full cooldown and exact cumulative progress', async ({ page }) => {
  // Given the first three-order round is waiting for its final acknowledgement.
  const host = await openPendingFirstRound(page);

  // When that acknowledgement completes the first round.
  await host.releaseSubmitResponse(3);

  // Then the confirmed total is three and the next round cannot start before one second.
  await expect(host.status).toHaveText('连续阶梯平空 · 1s 后继续 · 1/1 轮 · 本轮 3/3 笔 · 累计 3 笔');
  await advanceFromStatus(page, '1s 后继续', 999);
  expect(await readSubmissions(page)).toHaveLength(3);
  expect(host.pendingSubmitSequences()).toEqual([]);

  // When the full cooldown passes and the second round receives its own acknowledgements.
  await page.clock.resume();
  await expect.poll(host.pendingSubmitSequences).toEqual([4]);
  await host.releaseSubmitResponse(4);
  await expect.poll(host.pendingSubmitSequences).toEqual([6]);
  await pauseScenarioClock(page);
  await host.releaseSubmitResponse(6);

  // Then both rounds preserve their initial direction and only six confirmed orders are counted.
  await expect(host.status).toHaveText('连续阶梯平空 · 1s 后继续 · 2/2 轮 · 本轮 3/3 笔 · 累计 6 笔');
  await stopContinuousRound(page, host);
  const submissions = await readSubmissions(page);
  expect(submissions.map(({ action, price, quantity }) => ({ action, price, quantity }))).toEqual([
    { action: '平空', price: '80.9', quantity: '0.1' },
    { action: '平空', price: '80.4', quantity: '0.1' },
    { action: '平空', price: '79.9', quantity: '0.1' },
    { action: '平空', price: '80.9', quantity: '0.1' },
    { action: '平空', price: '80.4', quantity: '0.1' },
    { action: '平空', price: '79.9', quantity: '0.1' },
  ]);
  expect(host.errors).toEqual([]);
});

test('user continues a confirmed close round while hidden and can stop the next hidden round', async ({ page }) => {
  // Given the first round's final native acknowledgement is held after a visible user click.
  const host = await openPendingFirstRound(page);
  await installSimulatedVisibility(page);

  // When the tab becomes hidden and the held acknowledgement completes.
  await setSimulatedVisibility(page, true);
  await host.releaseSubmitResponse(3);
  await page.clock.resume();

  // Then the next round begins after its readiness check without a foreground frame.
  await expect.poll(host.pendingSubmitSequences, { timeout: 10_000 }).toEqual([4]);
  expect((await readSubmissions(page)).map(({ action }) => action)).toEqual(Array(4).fill('平空'));

  // When Stop is clicked while that fourth native response remains held.
  await host.panel.locator('[data-ladder-stop]').evaluate(button => button.click());
  await host.releaseSubmitResponse(4);
  await setSimulatedVisibility(page, false);

  // Then no later order starts and the acknowledged progress remains exact.
  await expect(host.status).toContainText('已停止');
  expect(await readSubmissions(page)).toHaveLength(4);
  expect(host.errors).toEqual([]);
});

test('user waits for a disabled close button and then receives a complete cooldown', async ({ page }) => {
  // Given the current round can finish while the native close button is disabled.
  const host = await openPendingFirstRound(page);
  await host.nativeButton.evaluate((button) => { button.disabled = true; });

  // When the final response succeeds and the button stays unavailable for two seconds.
  await host.releaseSubmitResponse(3);
  await expect(host.status).toContainText('等待按钮恢复');
  await page.clock.runFor(2_000);

  // Then the waiting runner preserves the three confirmed submissions.
  expect(await readSubmissions(page)).toHaveLength(3);
  await expect(host.status).toContainText('累计 3 笔');

  // When the native host enables its close button again.
  await host.nativeButton.evaluate((button) => { button.disabled = false; });
  await page.clock.runFor(50);

  // Then a new full second is required before the fourth order can begin.
  await expect(host.status).toContainText('1s 后继续');
  await advanceFromStatus(page, '1s 后继续', 999);
  expect(await readSubmissions(page)).toHaveLength(3);
  await page.clock.resume();
  await expect.poll(host.pendingSubmitSequences).toEqual([4]);
  await pauseScenarioClock(page);
  await stopContinuousRound(page, host);
  await host.releaseSubmitResponse(4);
  await expect.poll(async () => (await readFixtureState(page)).events
    .filter(({ type }) => type === 'order-submit-api-success').length).toBe(4);
  await page.clock.runFor(5_000);
  expect(await readSubmissions(page)).toHaveLength(4);
  expect(host.errors).toEqual([]);
});

test('user stops during the inter-round cooldown before any next-round submission', async ({ page }) => {
  // Given one close round has completed and its cooldown is active.
  const host = await openPendingFirstRound(page);
  await host.releaseSubmitResponse(3);
  await expect(host.status).toContainText('1s 后继续');
  await advanceFromStatus(page, '1s 后继续', 500);

  // When the user presses Stop and several possible round intervals pass.
  await stopContinuousRound(page, host);
  await page.clock.runFor(5_000);

  // Then the completed round remains counted and no new order can restart it.
  await expect(host.status).toHaveText('连续阶梯平空 · 已停止 · 1/1 轮 · 本轮 3/3 笔 · 累计 3 笔');
  await expect(host.panel.getByRole('button', { name: '阶梯平空', exact: true })).toBeEnabled();
  expect(await readSubmissions(page)).toHaveLength(3);
  expect(host.pendingSubmitSequences()).toEqual([]);
  expect(host.errors).toEqual([]);
});

test('user restarts the full cooldown when the close button becomes busy before it expires', async ({ page }) => {
  // Given a completed round is halfway through its inter-round cooldown.
  const host = await openPendingFirstRound(page);
  await host.releaseSubmitResponse(3);
  await expect(host.status).toContainText('1s 后继续');
  await advanceFromStatus(page, '1s 后继续', 500);

  // When the native button becomes busy and the original cooldown expires.
  await host.nativeButton.evaluate((button) => { button.setAttribute('aria-busy', 'true'); });
  await advanceFromStatus(page, '1s 后继续', 1_050);

  // Then no next-round request is sent while readiness is lost.
  await expect(host.status).toContainText('等待按钮恢复');
  expect(await readSubmissions(page)).toHaveLength(3);

  // When the host clears the busy state.
  await host.nativeButton.evaluate((button) => { button.removeAttribute('aria-busy'); });
  await page.clock.runFor(50);

  // Then the recovered button must pass another complete cooldown before the next request.
  await expect(host.status).toContainText('1s 后继续');
  await advanceFromStatus(page, '1s 后继续', 999);
  expect(await readSubmissions(page)).toHaveLength(3);
  await page.clock.resume();
  await expect.poll(host.pendingSubmitSequences).toEqual([4]);
  await pauseScenarioClock(page);
  await stopContinuousRound(page, host);
  await host.releaseSubmitResponse(4);
  await expect.poll(async () => (await readFixtureState(page)).events
    .filter(({ type }) => type === 'order-submit-api-success').length).toBe(4);
  await page.clock.runFor(5_000);
  expect(await readSubmissions(page)).toHaveLength(4);
  expect(host.errors).toEqual([]);
});

test('user stops while waiting for a busy button and readiness cannot revive the session', async ({ page }) => {
  // Given one completed round is waiting for native loading to finish.
  const host = await openPendingFirstRound(page);
  await host.nativeButton.evaluate((button) => { button.setAttribute('data-loading', 'true'); });
  await host.releaseSubmitResponse(3);
  await expect(host.status).toContainText('等待按钮恢复');

  // When the user stops and the native host later clears its loading state.
  await stopContinuousRound(page, host);
  await host.nativeButton.evaluate((button) => { button.removeAttribute('data-loading'); });
  await page.clock.runFor(5_000);

  // Then the completed progress remains terminal and no next-round order appears.
  await expect(host.status).toHaveText('连续阶梯平空 · 已停止 · 1/1 轮 · 本轮 3/3 笔 · 累计 3 笔');
  expect(await readSubmissions(page)).toHaveLength(3);
  expect(host.pendingSubmitSequences()).toEqual([]);
  expect(host.errors).toEqual([]);
});

test('user stops a pending continuous order without counting its late acknowledgement', async ({ page }) => {
  // Given two orders are confirmed and the third response is still held by the native host.
  const host = await openPendingFirstRound(page);

  // When the user stops before the third acknowledgement arrives.
  await stopContinuousRound(page, host);

  // Then the stopped round counts only the two acknowledged orders.
  await expect(host.status).toHaveText('连续阶梯平空 · 已停止 · 0/1 轮 · 本轮 2/3 笔 · 累计 2 笔');
  const terminalStatus = await host.status.textContent();

  // When the third response succeeds after the stop and former recovery deadlines pass.
  await host.releaseSubmitResponse(3);
  await expect.poll(async () => (await readFixtureState(page)).events
    .filter(({ type }) => type === 'order-submit-api-success').length).toBe(3);
  await page.clock.runFor(15_000);

  // Then neither the confirmed total nor the request count is revived by the late response.
  await expect(host.status).toHaveText(terminalStatus);
  expect(await readSubmissions(page)).toHaveLength(3);
  expect(host.pendingSubmitSequences()).toEqual([]);
  expect(host.errors).toEqual([]);
});

test('user ends continuous closing when the native trade mode changes during cooldown', async ({ page }) => {
  // Given one close round is complete and another has not yet started.
  const host = await openPendingFirstRound(page);
  await host.releaseSubmitResponse(3);
  await expect(host.status).toContainText('1s 后继续');

  // When the user switches the native form to opening positions.
  await page.locator('#position-direction [data-trade-mode="OPEN"]').click();
  await page.clock.runFor(1_100);

  // Then the continuous session stops with the mode-change reason and preserves its confirmed total.
  await expect(host.status).toContainText('已停止');
  await expect(host.status).toContainText('开仓/平仓模式已切换');
  await expect(host.status).toContainText('累计 3 笔');
  expect((await readFixtureState(page)).tradeMode).toBe('OPEN');
  expect(await readSubmissions(page)).toHaveLength(3);
  expect(host.errors).toEqual([]);
});

test('user ends continuous closing when the symbol changes while waiting for readiness', async ({ page }) => {
  // Given the original symbol has one completed round waiting for a disabled close button.
  const host = await openPendingFirstRound(page);
  await host.nativeButton.evaluate((button) => { button.disabled = true; });
  await host.releaseSubmitResponse(3);
  await expect(host.status).toContainText('等待按钮恢复');

  // When the native fixture navigates to another futures symbol.
  await page.evaluate(() => window.__BINANCE_FIXTURE__.switchSymbol('BTCUSDT'));
  await page.clock.runFor(100);

  // Then the original session stops with its symbol-change reason and creates no BTC order.
  await expect(host.status).toContainText('已停止');
  await expect(host.status).toContainText('交易对已切换');
  expect((await readFixtureState(page)).currentSymbol).toBe('BTCUSDT');
  expect(await readSubmissions(page)).toHaveLength(3);

  // When the user returns to the original symbol after the stop.
  await page.evaluate(symbol => window.__BINANCE_FIXTURE__.switchSymbol(symbol), CURRENT_SYMBOL);
  await page.clock.runFor(5_000);

  // Then returning to the original route does not restart the former session.
  expect(await readSubmissions(page)).toHaveLength(3);
  await expect(host.panel.locator('[data-ladder-stop]')).toHaveCount(0);
  expect(host.errors).toEqual([]);
});

test('user waits for an invisible close button before starting another round', async ({ page }) => {
  // Given the last acknowledgement can arrive after the host hides its native close button.
  const host = await openPendingFirstRound(page);
  await host.nativeButton.evaluate((button) => { button.style.display = 'none'; });

  // When the first round finishes while that button has no rendered geometry.
  await host.releaseSubmitResponse(3);
  await expect(host.status).toContainText('等待按钮恢复');
  await page.clock.runFor(2_000);

  // Then the runner holds the next round without fabricating a new submission.
  expect(await readSubmissions(page)).toHaveLength(3);

  // When the native host renders its button again.
  await host.nativeButton.evaluate((button) => { button.style.display = ''; });
  // The native-button lookup caches visible results for 250 milliseconds.
  await page.clock.runFor(300);

  // Then readiness starts a new full cooldown that the user can still stop.
  await expect(host.status).toContainText('1s 后继续');
  await advanceFromStatus(page, '1s 后继续', 999);
  expect(await readSubmissions(page)).toHaveLength(3);
  await expect(host.panel.getByRole('button', { name: '停止平空', exact: true })).toHaveCount(1);
  await stopContinuousRound(page, host);
  expect(host.errors).toEqual([]);
});

test('user ends the session when the authoritative position has no current-symbol short quantity', async ({ page }) => {
  // Given the native button is unavailable while stale DOM still shows a short position.
  const host = await openPendingFirstRound(page);
  const position = await gatePositionRecheck(page, {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      success: true,
      data: [
        { symbol: CURRENT_SYMBOL, positionSide: 'LONG', positionAmount: '100' },
        { symbol: 'BTCUSDT', positionSide: 'SHORT', positionAmount: '-2' },
      ],
    }),
  });
  await host.nativeButton.evaluate((button) => { button.disabled = true; });
  await page.clock.runFor(1_000);
  await host.releaseSubmitResponse(3);
  await expect.poll(position.requestCount).toBe(1);

  // When the authoritative response contains only the opposite direction and another symbol.
  await position.releaseFirst();

  // Then the current short session ends with its confirmed total instead of waiting forever.
  await expect(host.status).toHaveText('连续阶梯平空 · 已结束 · 当前方向已无持仓 · 1/1 轮 · 累计 3 笔');
  await page.clock.runFor(10_000);
  expect(position.requestCount()).toBe(1);
  expect(await readSubmissions(page)).toHaveLength(3);
  expect((await readFixtureState(page)).events.filter(({ type }) => type.includes('cancel'))).toEqual([]);
  expect(host.errors).toEqual([]);
});

for (const { description, response, recheckAfterMs } of [
  {
    description: 'an explicit HTTP 429 retry interval',
    response: { status: 429, headers: { 'retry-after': '2' } },
    recheckAfterMs: 2_000,
  },
  {
    description: 'an explicit HTTP 418 retry interval',
    response: { status: 418, headers: { 'retry-after': '4' } },
    recheckAfterMs: 4_000,
  },
  {
    description: 'the temporary position-server recovery interval',
    response: { status: 503 },
    recheckAfterMs: 3_000,
  },
  {
    description: 'the one-second position-check cadence when Retry-After is explicitly zero',
    response: { status: 429, headers: { 'retry-after': '0' } },
    recheckAfterMs: 1_000,
  },
]) {
  test(`user honors ${description} before rechecking a blocked close session`, async ({ page }) => {
    // Given the completed round has a disabled button and the next position response will require recovery.
    const host = await openPendingFirstRound(page);
    const position = await gatePositionRecheck(page, {
      ...response,
      contentType: 'application/json',
      body: JSON.stringify({ success: false }),
    });
    await host.nativeButton.evaluate((button) => { button.disabled = true; });
    await page.clock.runFor(1_000);
    await host.releaseSubmitResponse(3);
    await expect.poll(position.requestCount).toBe(1);

    // When the failed response arrives and the recovery interval has not quite elapsed.
    await position.releaseFirst();
    await expect(host.status).toContainText('等待按钮恢复');
    await advanceFromStatus(page, '等待按钮恢复', recheckAfterMs - 1);

    // Then the runner holds both the position recheck and all further orders.
    expect(position.requestCount()).toBe(1);
    expect(await readSubmissions(page)).toHaveLength(3);

    // When the interval expires and the next readiness tick observes it.
    await page.clock.runFor(51);

    // Then the second authoritative response ends the session on flat with no extra order.
    await expect.poll(position.requestCount).toBe(2);
    await expect(host.status).toHaveText('连续阶梯平空 · 已结束 · 当前方向已无持仓 · 1/1 轮 · 累计 3 笔');
    expect(await readSubmissions(page)).toHaveLength(3);
    expect(host.errors).toEqual([]);
  });
}

for (const { description, response, message } of [
  {
    description: 'an expired authentication response',
    response: { status: 401, body: JSON.stringify({ success: false }) },
    message: '持仓接口异常：HTTP 401',
  },
  {
    description: 'a permanent position client error',
    response: { status: 400, body: JSON.stringify({ success: false }) },
    message: '持仓接口异常：HTTP 400',
  },
  {
    description: 'a malformed position payload',
    response: { status: 200, body: JSON.stringify({ success: true, data: {} }) },
    message: '持仓接口数据格式异常',
  },
]) {
  test(`user gets a terminal failure for ${description} while the close button is blocked`, async ({ page }) => {
    // Given a completed close round needs an authoritative recheck while its native button is disabled.
    const host = await openPendingFirstRound(page);
    const position = await gatePositionRecheck(page, {
      ...response, contentType: 'application/json',
    });
    await host.nativeButton.evaluate((button) => { button.disabled = true; });
    await page.clock.runFor(1_000);
    await host.releaseSubmitResponse(3);
    await expect.poll(position.requestCount).toBe(1);

    // When the authoritative endpoint returns the unrecoverable response.
    await position.releaseFirst();

    // Then the failure reason is visible and all later recovery windows remain inactive.
    await expect(host.status).toHaveText(`连续阶梯平空 · 失败 · 1/1 轮 · 本轮 3/3 笔 · 累计 3 笔 · ${message}`);
    await page.clock.runFor(15_000);
    expect(position.requestCount()).toBe(1);
    expect(await readSubmissions(page)).toHaveLength(3);
    await expect(host.panel.locator('[data-ladder-stop]')).toHaveCount(0);
    expect(host.errors).toEqual([]);
  });
}

test('user stops while price precision is missing and its return cannot revive the session', async ({ page }) => {
  // Given the current round is pending and subsequent position requests can be observed.
  const host = await openPendingFirstRound(page);
  const positionReads = observePositionRequests(page);
  const precision = page.locator('#futuresOrderbook .tick-content');

  // When the native precision text disappears as the final order is acknowledged.
  await precision.evaluate((element) => { element.textContent = ''; });
  await host.releaseSubmitResponse(3);
  await expect(host.status).toContainText('等待按钮恢复');
  await page.clock.runFor(2_000);

  // Then missing market controls hold the next round while the running session remains stoppable.
  expect(positionReads()).toBe(0);
  expect(await readSubmissions(page)).toHaveLength(3);
  await expect(host.panel.getByRole('button', { name: '停止平空', exact: true })).toHaveCount(1);
  await expect(host.panel.getByRole('button', { name: '停止平空', exact: true })).toBeEnabled();

  // When the user stops while precision is still missing and the native value returns later.
  await stopContinuousRound(page, host);
  const terminalStatus = await host.status.textContent();
  await precision.evaluate((element) => { element.textContent = '0.1'; });
  await page.clock.runFor(3_000);

  // Then recovered precision cannot revive submissions or position polling after the stop.
  await expect(host.status).toHaveText(terminalStatus);
  expect(await readSubmissions(page)).toHaveLength(3);
  expect(positionReads()).toBe(0);
  await expect(host.panel.locator('[data-ladder-stop]')).toHaveCount(0);
  expect(host.errors).toEqual([]);
});

test('user restores a new precision promptly and uses its profile after a complete cooldown', async ({ page }) => {
  // Given a completed three-order round is waiting on missing native precision.
  const host = await openPendingFirstRound(page);
  const positionReads = observePositionRequests(page);
  const precision = page.locator('#futuresOrderbook .tick-content');
  await precision.evaluate((element) => { element.textContent = ''; });
  await host.releaseSubmitResponse(3);
  await expect(host.status).toContainText('等待按钮恢复');
  await page.clock.runFor(2_000);
  expect(positionReads()).toBe(0);

  // When the same native tick-size root publishes a replacement Select at precision 0.01.
  const restoredAt = await page.evaluate((symbol) => {
    window.__BINANCE_FIXTURE__.replacePrecisionControl({
      scope: 'select', symbol, value: '0.01', options: ['0.001', '0.01', '0.1', '1'],
    });
    return performance.now();
  }, CURRENT_SYMBOL);
  await page.clock.runFor(100);

  // Then controls and the new profile recover within 100 milliseconds, without waiting for the five-second watchdog.
  await expect(host.panel.locator('[data-ladder-group]')).toHaveCount(14);
  await expect(host.panel.getByRole('button', { name: '停止平空', exact: true })).toBeEnabled();
  await expect(host.panel.locator('[data-orderbook-precision-value="0.01"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(host.panel.getByText('等待价格精度', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => performance.now()) - restoredAt).toBe(100);
  await expect(host.status).toContainText('1s 后继续');
  await advanceFromStatus(page, '1s 后继续', 999);
  expect(await readSubmissions(page)).toHaveLength(3);

  // When the full cooldown expires and the next round reaches its first pending request.
  await page.clock.resume();
  await expect.poll(host.pendingSubmitSequences).toEqual([4]);
  await pauseScenarioClock(page);

  // Then the new precision uses its default five-order profile instead of the prior three-order allocation.
  await expect(host.status).toContainText('本轮 0/5 笔');
  expect((await readFixtureState(page)).orderbookPrecision).toBe('0.01');
  expect((await readSubmissions(page)).map(({ quantity }) => quantity)).toEqual(['0.1', '0.1', '0.1', '0.06']);
  expect(positionReads()).toBe(0);
  await stopContinuousRound(page, host);
  await host.releaseSubmitResponse(4);
  await expect.poll(async () => (await readFixtureState(page)).events
    .filter(({ type }) => type === 'order-submit-api-success').length).toBe(4);
  await page.clock.runFor(3_000);
  expect(await readSubmissions(page)).toHaveLength(4);
  expect(positionReads()).toBe(0);
  expect(host.errors).toEqual([]);
});

test('user advances an unconfirmed continuous order to a new round without counting a late success', async ({ page }) => {
  // Given two orders are confirmed and the third has no response before its twelve-second deadline.
  const host = await openPendingFirstRound(page);
  await advanceFromStatus(page, '第 3 笔确认中', 11_999);
  await expect(host.status).not.toContainText('未确认');
  expect(await readSubmissions(page)).toHaveLength(3);

  // When the pending request crosses its response deadline.
  await page.clock.runFor(51);

  // Then the continuous policy keeps the two confirmed orders and starts a three-second recovery cooldown.
  await expect(host.status).toContainText('3s 后继续');
  await expect(host.status).toContainText('下单请求仍未返回');
  await expect(host.status).toContainText('累计 2 笔');
  await advanceFromStatus(page, '3s 后继续', 2_999);
  expect(await readSubmissions(page)).toHaveLength(3);

  // When the recovery deadline passes and the old response arrives while the next round is pending.
  await page.clock.resume();
  await expect.poll(host.pendingSubmitSequences).toEqual([3, 4]);
  await pauseScenarioClock(page);
  await host.releaseSubmitResponse(3);
  await expect.poll(async () => (await readFixtureState(page)).events
    .filter(({ type }) => type === 'order-submit-api-success').length).toBe(3);

  // Then the next round starts at its first price and the old acknowledgement cannot inflate its total.
  await expect(host.status).toContainText('本轮 0/3 笔');
  await expect(host.status).toContainText('累计 2 笔');
  const submissions = await readSubmissions(page);
  expect(submissions.map(({ action, price }) => ({ action, price }))).toEqual([
    { action: '平空', price: '80.9' },
    { action: '平空', price: '80.4' },
    { action: '平空', price: '79.9' },
    { action: '平空', price: '80.9' },
  ]);
  await stopContinuousRound(page, host);
  await host.releaseSubmitResponse(4);
  await expect.poll(async () => (await readFixtureState(page)).events
    .filter(({ type }) => type === 'order-submit-api-success').length).toBe(4);
  await page.clock.runFor(15_000);
  expect(await readSubmissions(page)).toHaveLength(4);
  await expect(host.status).toContainText('累计 2 笔');
  expect(host.errors).toEqual([]);
});

for (const [description, headers] of [
  ['missing', {}],
  ['invalid', { 'retry-after': 'not-a-delay' }],
]) {
  test(`user waits the default ten seconds when position Retry-After is ${description}`, async ({ page }) => {
    // Given a completed round has a disabled button and the first position response is rate limited.
    const host = await openPendingFirstRound(page);
    const position = await gatePositionRecheck(page, {
      status: 429,
      headers,
      contentType: 'application/json',
      body: JSON.stringify({ success: false }),
    });
    await host.nativeButton.evaluate((button) => { button.disabled = true; });
    await page.clock.runFor(1_000);
    await host.releaseSubmitResponse(3);
    await expect.poll(position.requestCount).toBe(1);

    // When that response arrives without usable retry timing and 9,999 milliseconds pass.
    await position.releaseFirst();
    await expect(host.status).toContainText('等待按钮恢复');
    await advanceFromStatus(page, '等待按钮恢复', 9_999);

    // Then no second position request or additional order is allowed before the default deadline.
    expect(position.requestCount()).toBe(1);
    expect(await readSubmissions(page)).toHaveLength(3);
    await expect(host.status).toContainText('等待按钮恢复');

    // When the ten-second deadline passes and the next readiness check runs.
    await page.clock.runFor(51);

    // Then exactly one new recheck confirms flat and the continuous session ends.
    await expect.poll(position.requestCount).toBe(2);
    await expect(host.status).toHaveText('连续阶梯平空 · 已结束 · 当前方向已无持仓 · 1/1 轮 · 累计 3 笔');
    expect(await readSubmissions(page)).toHaveLength(3);
    expect(host.errors).toEqual([]);
  });
}
