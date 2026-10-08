import { test, expect } from '../test.js';
import { CURRENT_SYMBOL, OTHER_SYMBOL, createCancelScenario } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario, readFixtureState } from '../helpers/userscript-page.js';
import { installScenarioClock, pauseScenarioClock } from '../helpers/scenario-clock.js';

const STATUS = '#jh-binance-ladder-status';
const REDUCE_ONLY_REJECTION = {
  success: false, code: '90802022', message: 'Reduce-only order failed',
};

function tailOrders(levels) {
  const order = (id, overrides = {}) => ({
    id, symbol: CURRENT_SYMBOL, kind: 'basic', side: '平空', price: '83', quantity: '0.01',
    ...overrides,
  });
  return [
    ...Array.from({ length: levels }, (_, index) => order(`tail-${index + 1}`, { price: String(83 + index) })),
    order('opposite-direction', { side: '平多' }),
    order('other-symbol', { symbol: OTHER_SYMBOL }),
    order('conditional-current', { kind: 'conditional' }),
  ];
}

/** Browser locks and fetch delivery stay asynchronous while business timers use the page clock. */
async function advanceUntil(page, ready, message) {
  for (let step = 0; step < 240; step += 1) {
    if (await ready()) return;
    await page.clock.runFor(100);
  }
  expect(await ready(), message).toBe(true);
}

async function hasTerminalStatus(page) {
  return /当前方向已无持仓|失败|已中止/.test(await page.locator(STATUS).textContent());
}

async function openTailRecovery(page, {
  tailQuantity,
  levels,
  rowCancelMode = 'clear',
  finishAfterSubmissions = null,
  holdFlatResponse = false,
}) {
  await installScenarioClock(page);
  const scenario = createCancelScenario({
    positions: [{ symbol: CURRENT_SYMBOL, side: 'SHORT', quantity: '0.03' }],
    orders: tailOrders(levels),
    ui: {
      tradeMode: 'CLOSE', accountTab: 'history', openOrdersSubTab: 'conditional',
      hideOtherSymbols: false, orderbookPrecision: '0.1',
    },
    host: { rowCancelMode },
  });
  const host = await openUserscriptScenario(page, scenario);
  const flatResponse = Promise.withResolvers();
  const positionResponses = [];
  let flatRequests = 0;
  let submissions = 0;
  await page.route('**/bapi/futures/v1/private/future/order/place-order', async (route) => {
    submissions += 1;
    expect(submissions).toBeLessThanOrEqual(finishAfterSubmissions ?? 3);
    if (submissions === 3) {
      await page.evaluate(({ symbol, quantity }) => {
        window.__BINANCE_FIXTURE__.setPositions([{ symbol, side: 'SHORT', quantity }]);
      }, { symbol: CURRENT_SYMBOL, quantity: tailQuantity });
    }
    if (submissions === finishAfterSubmissions) {
      await page.evaluate(() => window.__BINANCE_FIXTURE__.setPositions([]));
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(submissions === 3 ? REDUCE_ONLY_REJECTION : { success: true }),
    });
  });
  await page.route('**/bapi/futures/v6/private/future/user-data/user-position', async (route) => {
    const submittedBeforeRead = submissions;
    const { positions } = await readFixtureState(page);
    if (positions.length === 0) {
      flatRequests += 1;
      if (holdFlatResponse) await flatResponse.promise;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: positions.map(position => ({
          symbol: position.symbol,
          positionSide: position.side,
          positionAmount: `-${position.quantity}`,
        })),
      }),
    });
    positionResponses.push({ positions, submissions: submittedBeforeRead });
  });
  await page.locator('[data-ladder-group="levels"][data-ladder-value="3"]').click();
  await page.locator('[data-ladder-group="percent"][data-ladder-value="5"]').click();
  await pauseScenarioClock(page);
  return {
    ...host,
    scenario,
    positionResponses,
    flatRequests: () => flatRequests,
    releaseFlatResponse: () => flatResponse.resolve(),
  };
}

function submittedOrders(state) {
  return state.events.filter(({ type }) => type === 'order-submitted')
    .map(({ action, price, quantity }) => ({ action, price, quantity }));
}

function expectRestoredScope(state) {
  expect(state.accountTab).toBe('history');
  expect(state.openOrdersSubTab).toBe('conditional');
  expect(state.hideOtherSymbols).toBe(false);
  expect(state.showOrders).toBe(true);
  expect(state.events.filter(({ type }) => type === 'cancel-requested' || type === 'dialog-opened')).toEqual([]);
}

const INITIAL_SUBMISSIONS = [
  { action: '平空', price: '80.9', quantity: '0.01' },
  { action: '平空', price: '80.4', quantity: '0.01' },
  { action: '平空', price: '79.9', quantity: '0.01' },
];

for (const tail of [
  { label: 'one minimum unit', quantity: '0.01', levels: 1 },
  { label: 'two minimum units', quantity: '0.02', levels: 2 },
]) {
  test(`user replaces only the remaining ${tail.label} after two close orders succeeded`, async ({ page }, testInfo) => {
    // Given two accepted orders precede a reduce-only rejection after the position has already shrunk below the original three-level plan.
    const host = await openTailRecovery(page, {
      tailQuantity: tail.quantity,
      levels: tail.levels,
      finishAfterSubmissions: 3 + tail.levels,
      holdFlatResponse: true,
    });

    // When the user starts continuous close-short and the unchanged authoritative tail enters scoped replacement.
    await page.locator('[data-ladder-action="CLOSE_SHORT"]').click({ modifiers: ['Alt'] });
    await advanceUntil(page, async () => {
      const state = await readFixtureState(page);
      return (host.flatRequests() > 0
        && state.events.filter(({ type }) => type === 'order-submit-api-success').length === 2 + tail.levels)
        || await hasTerminalStatus(page);
    },
      'The remaining tail must be replaced before authoritative flat confirmation');

    // Then the new order count fits the latest quantity, only matching Basic rows are cancelled, and completion still waits for the API.
    const state = await readFixtureState(page);
    expect(state.events.filter(({ type }) => type === 'row-cancel-requested').map(({ orderId }) => orderId))
      .toEqual(Array.from({ length: tail.levels }, (_, index) => `tail-${index + 1}`));
    expect(state.events.filter(({ type }) => type === 'row-cancel-cleared').map(({ orderId }) => orderId))
      .toEqual(Array.from({ length: tail.levels }, (_, index) => `tail-${index + 1}`));
    expect(state.orders).toEqual(host.scenario.orders.slice(tail.levels));
    expect(submittedOrders(state)).toEqual([
      ...INITIAL_SUBMISSIONS,
      ...INITIAL_SUBMISSIONS.slice(0, tail.levels),
    ]);
    expect(state.events.filter(({ type }) => type === 'order-submit-api-success')).toHaveLength(2 + tail.levels);
    expect(state.events.filter(({ type }) => type === 'order-submit-api-rejected').map(({ code }) => code))
      .toEqual(['90802022']);
    expect(host.positionResponses.filter(({ positions, submissions }) => positions.length === 1 && submissions === 3)
      .every(({ positions }) => positions[0].quantity === tail.quantity)).toBe(true);
    expect(host.positionResponses.filter(({ positions, submissions }) => positions.length === 1 && submissions === 3).length)
      .toBeGreaterThanOrEqual(2);
    expect(host.flatRequests()).toBeGreaterThanOrEqual(1);
    await expect(page.locator(STATUS)).not.toContainText('当前方向已无持仓');
    expectRestoredScope(state);

    // When the exchange confirms that the final accepted replacement filled the remaining position.
    host.releaseFlatResponse();
    await advanceUntil(page, () => hasTerminalStatus(page), 'The flat response must finish continuous close');

    // Then the session finishes with cumulative accepted submissions and no additional cancellation or retry.
    await expect(page.locator(STATUS)).toContainText('连续阶梯平空');
    await expect(page.locator(STATUS)).toContainText('当前方向已无持仓');
    await expect(page.locator(STATUS)).toContainText(`累计 ${2 + tail.levels} 笔`);
    expect(host.positionResponses.some(({ positions }) => positions.length === 0)).toBe(true);
    await page.clock.runFor(10_000);
    const completed = await readFixtureState(page);
    expect(submittedOrders(completed)).toEqual(submittedOrders(state));
    expect(completed.events.filter(({ type }) => type === 'row-cancel-requested')).toHaveLength(tail.levels);
    expect(host.errors).toEqual([]);
    const screenshot = testInfo.outputPath('tail-recovery-completed.png');
    await page.screenshot({ path: screenshot });
    await testInfo.attach('tail-recovery-completed', {
      path: screenshot, contentType: 'image/png',
    });
  });
}

test('user retains two confirmed close submissions when the tail cannot meet the minimum quantity', async ({ page }) => {
  // Given a native fill leaves less than one exchange minimum unit after the first two submissions succeeded.
  const host = await openTailRecovery(page, { tailQuantity: '0.001', levels: 1 });

  // When continuous close tries to prepare replacement for the unchanged authoritative tail.
  await page.locator('[data-ladder-action="CLOSE_SHORT"]').click({ modifiers: ['Alt'] });
  await advanceUntil(page, () => hasTerminalStatus(page), 'Invalid tail planning must stop before native cancellation');

  // Then the minimum refusal and original native error preserve partial progress and every existing order.
  await expect(page.locator(STATUS)).toContainText('数量低于最小下单量 0.01');
  await expect(page.locator(STATUS)).toContainText('90802022');
  await expect(page.locator(STATUS)).toContainText('本轮 2/3 笔');
  await expect(page.locator(STATUS)).toContainText('累计 2 笔');
  await page.clock.runFor(10_000);
  const state = await readFixtureState(page);
  expect(submittedOrders(state)).toEqual(INITIAL_SUBMISSIONS);
  expect(state.orders).toEqual(host.scenario.orders);
  expect(state.events.filter(({ type }) => /cancel/.test(type))).toEqual([]);
  expectRestoredScope(state);
  expect(host.errors).toEqual([]);
});

test('user retains two confirmed close submissions when native tail cancellation is unconfirmed', async ({ page }) => {
  // Given the remaining minimum-sized Basic close order never disappears after its native row cancellation request.
  const host = await openTailRecovery(page, { tailQuantity: '0.01', levels: 1, rowCancelMode: 'unchanged' });

  // When continuous close attempts exactly one scoped cancellation for the freshly planned tail.
  await page.locator('[data-ladder-action="CLOSE_SHORT"]').click({ modifiers: ['Alt'] });
  await advanceUntil(page, () => hasTerminalStatus(page), 'Unconfirmed native cancellation must stop replacement');

  // Then the failure retains the accepted two-of-three progress and never submits or cancels again.
  await expect(page.locator(STATUS)).toContainText('待替换挂单仍存在，已停止重新挂单');
  await expect(page.locator(STATUS)).toContainText('90802022');
  await expect(page.locator(STATUS)).toContainText('本轮 2/3 笔');
  await expect(page.locator(STATUS)).toContainText('累计 2 笔');
  await page.clock.runFor(10_000);
  const state = await readFixtureState(page);
  expect(submittedOrders(state)).toEqual(INITIAL_SUBMISSIONS);
  expect(state.orders).toEqual(host.scenario.orders);
  expect(state.events.filter(({ type }) => type === 'row-cancel-requested').map(({ orderId }) => orderId))
    .toEqual(['tail-1']);
  expect(state.events.filter(({ type }) => type === 'row-cancel-cleared')).toEqual([]);
  expectRestoredScope(state);
  expect(host.errors).toEqual([]);
});

test('user keeps partial close progress when the position becomes flat during native tail cancellation', async ({ page }) => {
  // Given the remaining minimum-sized close order requires the user's native cancellation decision.
  const host = await openTailRecovery(page, {
    tailQuantity: '0.01', levels: 1, rowCancelMode: 'dialog', holdFlatResponse: true,
  });

  // When continuous close reaches the tail's native row dialog after two accepted submissions.
  await page.locator('[data-ladder-action="CLOSE_SHORT"]').click({ modifiers: ['Alt'] });
  const confirm = page.locator('[data-row-dialog-action="confirm"]');
  await advanceUntil(page, async () => await confirm.isVisible() || await hasTerminalStatus(page),
    'The remaining tail must reach its native cancellation decision');

  // Then the script preserves partial progress and leaves the original order for the user to confirm.
  await expect(confirm).toBeVisible();
  await expect(page.locator(STATUS)).toContainText('本轮 2/3 笔');
  await expect(page.locator(STATUS)).toContainText('累计 2 笔');
  const pending = await readFixtureState(page);
  expect(pending.orders).toEqual(host.scenario.orders);
  expect(submittedOrders(pending)).toEqual(INITIAL_SUBMISSIONS);
  expect(pending.events.filter(({ type }) => type === 'row-cancel-cleared')).toEqual([]);

  // When a position publication becomes flat and the user confirms the outstanding native cancellation.
  await page.evaluate(() => window.__BINANCE_FIXTURE__.setPositions([]));
  await confirm.click();
  await advanceUntil(page, async () => {
    const state = await readFixtureState(page);
    return (host.flatRequests() > 0
      && state.events.filter(({ type }) => type === 'row-cancel-cleared').length === 1)
      || await hasTerminalStatus(page);
  },
    'A flat position after cancellation still requires the authoritative API response');

  // Then no replacement is submitted and the original two-of-three progress remains while confirmation is pending.
  await expect(page.locator(STATUS)).not.toContainText('当前方向已无持仓');
  await expect(page.locator(STATUS)).toContainText('本轮 2/3 笔');
  await expect(page.locator(STATUS)).toContainText('累计 2 笔');
  const cancelled = await readFixtureState(page);
  expect(cancelled.orders).toEqual(host.scenario.orders.slice(1));
  expect(cancelled.events.filter(({ type }) => type === 'row-cancel-cleared').map(({ orderId }) => orderId))
    .toEqual(['tail-1']);
  expect(submittedOrders(cancelled)).toEqual(INITIAL_SUBMISSIONS);
  expect(host.flatRequests()).toBeGreaterThanOrEqual(1);

  // When the position API confirms the flat position after cancellation.
  host.releaseFlatResponse();
  await advanceUntil(page, () => hasTerminalStatus(page), 'Confirmed flat must end the active recovery round');

  // Then the completed summary retains both accepted submissions and exactly one cancellation without another submit.
  await expect(page.locator(STATUS)).toHaveText(
    '连续阶梯平空 · 已结束 · 当前方向已无持仓 · 0/1 轮 · 累计 2 笔 · 撤 1 笔',
  );
  await page.clock.runFor(10_000);
  const completed = await readFixtureState(page);
  expect(submittedOrders(completed)).toEqual(INITIAL_SUBMISSIONS);
  expect(completed.events.filter(({ type }) => type === 'row-cancel-requested').map(({ orderId }) => orderId))
    .toEqual(['tail-1']);
  expectRestoredScope(completed);
  expect(host.errors).toEqual([]);
});
