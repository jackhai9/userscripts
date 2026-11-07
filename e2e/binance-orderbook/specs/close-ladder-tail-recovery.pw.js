import { test, expect } from '../test.js';
import { CURRENT_SYMBOL, OTHER_SYMBOL, createCancelScenario } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario, readFixtureState } from '../helpers/userscript-page.js';
import { installScenarioClock, pauseScenarioClock } from '../helpers/scenario-clock.js';

const STATUS = '#jh-binance-ladder-status';
const REDUCE_ONLY_REJECTION = {
  success: false, code: '90802022', message: 'Reduce-only order failed',
};

function tailOrders(levels, positionSide) {
  const closeLong = positionSide === 'LONG';
  const order = (id, overrides = {}) => ({
    id, symbol: CURRENT_SYMBOL, kind: 'basic', side: closeLong ? '平多' : '平空', price: '83', quantity: '0.01',
    ...overrides,
  });
  return [
    ...Array.from({ length: levels }, (_, index) => order(`tail-${index + 1}`, { price: String(83 + index) })),
    order('opposite-direction', { side: closeLong ? '平空' : '平多' }),
    order('other-symbol', { symbol: OTHER_SYMBOL }),
    order('conditional-current', { kind: 'conditional' }),
  ].map((item, index) => ({ ...item, orderId: 1001 + index, clientOrderId: item.id + '-client' }));
}

/** Browser locks and fetch delivery stay asynchronous while business timers use the page clock. */
async function advanceUntil(page, ready, message, timeoutMs = 24_000) {
  for (let elapsed = 0; elapsed < timeoutMs; elapsed += 250) {
    if (await ready()) return;
    await page.clock.runFor(250);
  }
  expect(await ready(), message).toBe(true);
}

async function hasTerminalStatus(page) {
  // A native remount can remove the status until the next simulated animation frame.
  return (await page.locator(STATUS).allTextContents()).some(text => /当前方向已无持仓|失败|已中止/.test(text));
}

async function openTailRecovery(page, {
  tailQuantity,
  levels,
  rowCancelMode = 'clear',
  rowCancelDelayMs = 0,
  positionSide = 'SHORT',
  initialLevels = 3,
  finishAfterSubmissions = null,
  holdFlatResponse = false,
  orders,
  holdRowCancelResponses = false,
  holdTerminalUpdates = false,
}) {
  await installScenarioClock(page);
  const scenario = createCancelScenario({
    positions: [{ symbol: CURRENT_SYMBOL, side: positionSide, quantity: (initialLevels / 100).toFixed(2) }],
    orders: orders ?? tailOrders(levels, positionSide),
    ui: {
      tradeMode: 'CLOSE', accountTab: 'history', openOrdersSubTab: 'conditional',
      hideOtherSymbols: false, orderbookPrecision: '0.1',
    },
    host: { rowCancelMode, rowCancelDelayMs },
  });
  const host = await openUserscriptScenario(page, scenario, {
    replacementStream: true, holdRowCancelResponses, holdTerminalUpdates,
  });
  const flatResponse = Promise.withResolvers();
  const positionResponses = [];
  let flatRequests = 0;
  let submissions = 0;
  await page.route('**/bapi/futures/v1/private/future/order/place-order', async (route) => {
    submissions += 1;
    expect(submissions).toBeLessThanOrEqual(finishAfterSubmissions ?? initialLevels);
    if (submissions === initialLevels) {
      await page.evaluate(position => {
        window.__BINANCE_FIXTURE__.setPositions([position]);
      }, { symbol: CURRENT_SYMBOL, side: positionSide, quantity: tailQuantity });
    }
    if (submissions === finishAfterSubmissions) {
      await page.evaluate(() => window.__BINANCE_FIXTURE__.setPositions([]));
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(submissions === initialLevels ? REDUCE_ONLY_REJECTION : { success: true }),
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
          positionAmount: position.side === 'SHORT' ? `-${position.quantity}` : position.quantity,
        })),
      }),
    });
    positionResponses.push({ positions, submissions: submittedBeforeRead });
  });
  await page.locator(`[data-ladder-group="levels"][data-ladder-value="${initialLevels}"]`).click();
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

for (const firstReceipt of ['HTTP', 'terminal stream']) {
  test(`user replaces the exact mixed-type remaining quantity only after ${firstReceipt} and its matching cancellation receipt`, async ({ page }) => {
    // Given four native close-long rows have mixed numeric/string fills and release only three minimum units together.
    const executedQuantities = [0, '0', 0.005, '0.005'];
    const orders = tailOrders(4, 'LONG').map((order, index) => index < 4
      ? { ...order, executedQty: executedQuantities[index] } : order);
    const host = await openTailRecovery(page, {
      positionSide: 'LONG', initialLevels: 5, levels: 4, tailQuantity: '0.03', orders,
      finishAfterSubmissions: 8, holdRowCancelResponses: true, holdTerminalUpdates: true,
    });
    const terminalFor = order => ({
      s: order.symbol, i: order.orderId, c: order.clientOrderId, x: 'CANCELED', X: 'CANCELED',
      q: order.quantity, z: String(order.executedQty),
    });

    // When continuous close reaches its first scoped cancellation and receives only one required receipt.
    await page.locator('[data-ladder-action="CLOSE_LONG"]').click({ modifiers: ['Alt'] });
    await advanceUntil(page, async () => host.pendingCancelOrderIds().includes(orders[0].orderId)
      || await hasTerminalStatus(page), 'The mixed-type quantity preflight must admit the first row');
    expect(host.pendingCancelOrderIds()).toEqual([orders[0].orderId]);
    if (firstReceipt === 'HTTP') {
      host.releaseCancelResponse(orders[0].orderId);
      await advanceUntil(page, async () => (await readFixtureState(page)).events
        .some(({ type, orderId }) => type === 'row-cancel-response' && orderId === orders[0].id),
      'The first cancellation HTTP receipt must reach the host');
    } else {
      await page.evaluate(() => {
        window.__MIXED_QUANTITY_TERMINAL_DELIVERY__ = new Promise(resolve => {
          window.__fixtureReplacementSocket.addEventListener('message', event => {
            resolve(JSON.parse(event.data).data.o.i);
          }, { once: true });
        });
      });
      host.publishTerminalUpdate(terminalFor(orders[0]));
      expect(await page.evaluate(() => window.__MIXED_QUANTITY_TERMINAL_DELIVERY__)).toBe(orders[0].orderId);
    }
    await page.clock.runFor(500);

    // Then neither the next native cancellation nor any replacement can run before both receipts agree.
    const pending = await readFixtureState(page);
    expect(pending.events.filter(({ type }) => type === 'row-cancel-requested').map(({ orderId }) => orderId))
      .toEqual([orders[0].id]);
    expect(submittedOrders(pending).map(({ action, quantity }) => ({ action, quantity })))
      .toEqual(Array(5).fill({ action: '平多', quantity: '0.01' }));
    expect(pending.events.filter(({ type }) => type === 'order-submit-api-success')).toHaveLength(4);

    // When the missing first receipt and both exact receipts for each subsequent selected row arrive.
    if (firstReceipt === 'HTTP') host.publishTerminalUpdate(terminalFor(orders[0]));
    else host.releaseCancelResponse(orders[0].orderId);
    for (const order of orders.slice(1, 4)) {
      await advanceUntil(page, () => host.pendingCancelOrderIds().includes(order.orderId),
        'The next selected native row must await its own receipts');
      host.publishTerminalUpdate(terminalFor(order));
      host.releaseCancelResponse(order.orderId);
    }
    await advanceUntil(page, () => hasTerminalStatus(page), 'The three-unit replacement must finish continuous close');

    // Then exact remaining quantities select all four targets, preserve unrelated rows, and submit only the fresh three-unit tail.
    const state = await readFixtureState(page);
    await expect(page.locator(STATUS)).toContainText('当前方向已无持仓');
    await expect(page.locator(STATUS)).toContainText('累计 7 笔');
    await expect(page.locator(STATUS)).toContainText('撤 4 笔');
    for (const type of ['row-cancel-requested', 'row-cancel-response', 'row-cancel-cleared']) {
      expect(state.events.filter(event => event.type === type).map(({ orderId }) => orderId))
        .toEqual(orders.slice(0, 4).map(({ id }) => id));
    }
    expect(state.orders).toEqual(orders.slice(4));
    expect(submittedOrders(state).map(({ action, quantity }) => ({ action, quantity })))
      .toEqual(Array(8).fill({ action: '平多', quantity: '0.01' }));
    expect(state.events.filter(({ type }) => type === 'order-submit-api-rejected').map(({ code }) => code))
      .toEqual(['90802022']);
    expect(state.events.filter(({ type }) => type === 'order-submit-api-success')).toHaveLength(7);
    expect(host.positionResponses.some(({ submissions, positions }) => submissions === 5
      && positions[0]?.quantity === '0.03')).toBe(true);
    expectRestoredScope(state);
    expect(host.errors).toEqual([]);
  });
}

test('user preserves every order when a later selected native row has an invalid executed quantity string', async ({ page }) => {
  // Given the first close-long row is valid but the second required row has a non-decimal executed quantity.
  const orders = tailOrders(2, 'LONG').map((order, index) => index < 2
    ? { ...order, executedQty: index === 0 ? 0 : '0tail' } : order);
  const host = await openTailRecovery(page, {
    positionSide: 'LONG', initialLevels: 5, levels: 2, tailQuantity: '0.02', orders,
  });

  // When continuous close preflights all required targets after four accepted submissions and a native rejection.
  await page.locator('[data-ladder-action="CLOSE_LONG"]').click({ modifiers: ['Alt'] });
  await advanceUntil(page, () => hasTerminalStatus(page), 'Invalid executed quantity must stop before any cancellation');

  // Then the exact quantity failure retains partial progress and prevents cancellation of even the earlier valid row.
  await expect(page.locator(STATUS)).toContainText('无法确认原生订单数量，已停止撤单');
  await expect(page.locator(STATUS)).toContainText('90802022');
  await expect(page.locator(STATUS)).toContainText('本轮 4/5 笔');
  await expect(page.locator(STATUS)).toContainText('累计 4 笔');
  await page.clock.runFor(10_000);
  const state = await readFixtureState(page);
  expect(state.orders).toEqual(orders);
  expect(state.events.filter(({ type }) => /cancel/.test(type))).toEqual([]);
  expect(submittedOrders(state).map(({ action, quantity }) => ({ action, quantity })))
    .toEqual(Array(5).fill({ action: '平多', quantity: '0.01' }));
  expect(state.events.filter(({ type }) => type === 'order-submit-api-success')).toHaveLength(4);
  expectRestoredScope(state);
  expect(host.errors).toEqual([]);
});

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
  await expect(page.locator(STATUS)).toContainText('未收到匹配的成功撤单回执，已停止重新挂单');
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

async function openStaleCloseLongTail(page) {
  return openTailRecovery(page, {
    positionSide: 'LONG', initialLevels: 5, levels: 2, tailQuantity: '0.02',
    rowCancelDelayMs: 60_000, finishAfterSubmissions: 6,
  });
}

async function startCloseLongAndWaitForCancellations(page, host) {
  await page.locator('[data-ladder-action="CLOSE_LONG"]').click({ modifiers: ['Alt'] });
  await advanceUntil(page, async () => (await readFixtureState(page)).events
    .filter(({ type }) => type === 'row-cancel-response').length === 2,
  'The native host must receive both scoped cancellation responses while the old rows remain');
  const state = await readFixtureState(page);
  expect(submittedOrders(state).map(({ action, quantity }) => [action, quantity]))
    .toEqual(Array(5).fill(['平多', '0.01']));
  expect(state.events.filter(({ type }) => type === 'order-submit-api-success')).toHaveLength(4);
  expect(state.events.filter(({ type }) => type === 'order-submit-api-rejected').map(({ code }) => code))
    .toEqual(['90802022']);
  expect(state.events.filter(({ type }) => type === 'row-cancel-response').map(({ orderId }) => orderId))
    .toEqual(['tail-1', 'tail-2']);
  expect(state.orders).toEqual(host.scenario.orders);
}

/** A native owner can publish new source data without replacing its mounted row window. */
async function publishTailSource(page, condition) {
  return page.locator('.orders-content').evaluate((host, condition) => {
    const list = host.parentElement.__reactProps$fixture.children[2].props.children.props;
    const oldRows = host.__reactProps$fixture.children[1].props.children[1];
    const [first, second] = list.data;
    const newOrder = { ...first, orderId: 2001, clientOrderId: 'new-order' };
    list.data = [newOrder, ...list.data.slice(2)];
    if (condition === 'empty') list.data = [];
    if (condition === 'contains a cancelled ID') list.data.push(second);
    if (condition === 'is loading') list.loading = true;
    if (condition === 'has more pages') list.hasMore = true;
    if (condition === 'has an invalid native ID') list.data[0].orderId = 'invalid';
    if (condition === 'contains another symbol') list.data[0].symbol = 'BTCUSDT';
    // Deliver a host commit to the MutationObserver while the mounted rows retain their old props.
    host.style.overflowAnchor = 'none';
    return { source: list.data.map(order => order.orderId), window: oldRows.map(row => row.props.orderId) };
  }, condition);
}

test('user replaces the fresh remaining position after terminal receipts while cancelled source rows remain unchanged', async ({ page }) => {
  // Given four close-long orders succeeded before rejection and both cancelled identities remain in the native source and mounted rows.
  const host = await openStaleCloseLongTail(page);
  await startCloseLongAndWaitForCancellations(page, host);

  // When an additional fill leaves one minimum unit after both matching cancellation receipts have arrived.
  await page.evaluate(position => window.__BINANCE_FIXTURE__.setPositions([position]),
    { symbol: CURRENT_SYMBOL, side: 'LONG', quantity: '0.01' });
  await advanceUntil(page, () => hasTerminalStatus(page), 'Terminal receipts must allow the fresh remaining unit to be replaced');

  // Then the accepted replacement finishes the position while the stale source is never published or cancelled again.
  await expect(page.locator(STATUS)).toContainText('当前方向已无持仓');
  await expect(page.locator(STATUS)).toContainText('累计 5 笔');
  await expect(page.locator(STATUS)).toContainText('撤 2 笔');
  const state = await readFixtureState(page);
  expect(state.orders).toEqual(host.scenario.orders);
  expect(submittedOrders(state)).toHaveLength(6);
  expect(submittedOrders(state)[5]).toMatchObject({ action: '平多', quantity: '0.01' });
  expect(host.positionResponses.some(({ submissions, positions }) =>
    submissions === 5 && positions[0]?.quantity === '0.01')).toBe(true);
  expect(state.events.filter(({ type }) => type === 'row-cancel-requested').map(({ orderId }) => orderId))
    .toEqual(['tail-1', 'tail-2']);
  expect(state.events.filter(({ type }) => type === 'row-cancel-cleared')).toEqual([]);
  expectRestoredScope(state);
  expect(host.errors).toEqual([]);
});

test('user waits for the recovery cooldown and caps replacement by the smaller current DOM quantity despite stale source rows', async ({ page }) => {
  // Given both matching cancellations succeeded while their source remains unchanged and the authoritative position is two units.
  const host = await openStaleCloseLongTail(page);
  await startCloseLongAndWaitForCancellations(page, host);
  const cancellation = (await readFixtureState(page)).events.filter(({ type }) => type === 'row-cancel-response').at(-1);
  const elapsed = await page.evaluate(at => performance.now() - at, cancellation.at);
  expect(elapsed).toBeLessThan(2999);

  // When the native closeable display shrinks independently of the API position before three seconds have elapsed.
  await page.locator('[data-testid="max-sell-amount"]').evaluate(element => { element.textContent = '可平 0.01 HYPE'; });
  await page.clock.runFor(2999 - elapsed);

  // Then receipts alone have not bypassed the recovery cooldown or submitted the stale two-unit quantity.
  expect(submittedOrders(await readFixtureState(page))).toHaveLength(5);

  // When the cooldown completes and the authoritative API still reports two remaining units.
  await advanceUntil(page, () => hasTerminalStatus(page), 'Fresh API and DOM quantities must bound the replacement');

  // Then the smaller current DOM amount limits the accepted replacement to one unit and the stale rows remain untouched.
  const recoveryQuantities = host.positionResponses
    .filter(({ submissions, positions }) => submissions === 5 && positions.length > 0)
    .map(({ positions }) => positions[0].quantity);
  expect(recoveryQuantities.length).toBeGreaterThanOrEqual(3);
  expect([...new Set(recoveryQuantities)]).toEqual(['0.02']);
  await expect(page.locator(STATUS)).toContainText('当前方向已无持仓');
  await expect(page.locator(STATUS)).toContainText('累计 5 笔');
  await expect(page.locator(STATUS)).toContainText('撤 2 笔');
  const state = await readFixtureState(page);
  expect(state.orders).toEqual(host.scenario.orders);
  expect(submittedOrders(state)).toHaveLength(6);
  expect(submittedOrders(state)[5]).toMatchObject({ action: '平多', quantity: '0.01' });
  expect(state.events.filter(({ type }) => type === 'order-submit-api-success')).toHaveLength(5);
  expect(state.events.filter(({ type }) => type === 'row-cancel-requested').map(({ orderId }) => orderId))
    .toEqual(['tail-1', 'tail-2']);
  expectRestoredScope(state);
  expect(host.errors).toEqual([]);
});

for (const condition of [
  'cleared', 'empty', 'contains a cancelled ID', 'is loading', 'has more pages',
  'has an invalid native ID', 'contains another symbol',
]) {
  test(`user replaces only the confirmed remaining position when cancelled rows stay mounted and source is ${condition}`, async ({ page }) => {
    // Given four close-long submissions succeed and the fifth is rejected, while both cancelled rows stay in the host for a minute.
    const host = await openStaleCloseLongTail(page);
    let source;
    await page.route('**/bapi/futures/v1/private/future/order/cancel-order', async route => {
      if (route.request().postDataJSON().orderId === 1002) {
        source = await publishTailSource(page, condition);
        await page.evaluate(position => window.__BINANCE_FIXTURE__.setPositions([position]),
          { symbol: CURRENT_SYMBOL, side: 'LONG', quantity: '0.01' });
      }
      await route.fallback();
    });

    // When an independent source publication and fill precede the final matching receipt while the original Basic scope is active.
    await startCloseLongAndWaitForCancellations(page, host);
    const expectedIds = condition === 'empty' ? [] : [condition === 'has an invalid native ID' ? 'invalid' : 2001, 1003];
    if (condition === 'contains a cancelled ID') expectedIds.push(1002);
    expect(source.source).toEqual(expectedIds);
    expect(source.window).toEqual([1001, 1002, 1003]);
    await advanceUntil(page, () => hasTerminalStatus(page), 'The remaining unit must be submitted and confirmed flat');

    // Then the script rereads the smaller position, submits one unit, and leaves every stale or unrelated row alone.
    await expect(page.locator(STATUS)).toContainText('当前方向已无持仓');
    await expect(page.locator(STATUS)).toContainText('累计 5 笔');
    await expect(page.locator(STATUS)).toContainText('撤 2 笔');
    expect(host.positionResponses.some(({ submissions, positions }) =>
      submissions === 5 && positions[0]?.quantity === '0.01')).toBe(true);
    await page.clock.runFor(10_000);
    const state = await readFixtureState(page);
    expect(state.orders).toEqual(host.scenario.orders);
    expect(submittedOrders(state)).toHaveLength(6);
    expect(submittedOrders(state)[5]).toMatchObject({ action: '平多', quantity: '0.01' });
    expect(state.events.filter(({ type }) => type === 'order-submit-api-success')).toHaveLength(5);
    expect(state.events.filter(({ type }) => type === 'row-cancel-requested').map(({ orderId }) => orderId))
      .toEqual(['tail-1', 'tail-2']);
    expectRestoredScope(state);
    expect(host.errors).toEqual([]);
  });
}

/** Model subsequent exchange outcomes while retaining every already-cancelled native row. */
async function openFollowupTailRecovery(page, mode) {
  const host = await openStaleCloseLongTail(page);
  const sameRound = mode === 'same round';
  const alternateConflict = mode === 'alternate identity conflict';
  const conflict = mode === 'identity conflict' || alternateConflict;
  const newOrder = {
    ...host.scenario.orders[0], id: 'new-tail', orderId: 2001, clientOrderId: 'new-tail-client',
    quantity: sameRound ? '0.01' : '0.02', price: '82',
  };
  const publishedOrders = [
    ...host.scenario.orders.map((order, index) => conflict && index === 0
      ? { ...order, clientOrderId: 'different-client-for-cancelled-id' } : order),
    newOrder,
  ];
  let submissions = 0;
  await page.route('**/bapi/futures/v1/private/future/order/cancel-order', async route => {
    const identity = route.request().postDataJSON();
    expect(route.request().method()).toBe('POST');
    const order = [...host.scenario.orders, newOrder].find(item => item.symbol === identity.symbol
      && item.orderId === identity.orderId && item.clientOrderId === identity.clientOrderId);
    if (!order) throw new Error('Native cancellation must use an exact declared order identity');
    host.publishTerminalUpdate({
      s: order.symbol, i: order.orderId, c: order.clientOrderId, x: 'CANCELED', X: 'CANCELED',
      q: order.quantity, z: '0',
    });
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ success: true, code: '000000', data: {
        orderId: identity.orderId, clientOrderId: identity.clientOrderId, status: 'CANCELED',
      } }),
    });
  });
  await page.route('**/bapi/futures/v1/private/future/order/place-order', async route => {
    submissions += 1;
    expect(submissions).toBeLessThanOrEqual(mode === 'identity conflict' ? 8 : sameRound ? 9 : 10);
    if (submissions === 5 || (sameRound && submissions === 7)) {
      await page.evaluate(position => window.__BINANCE_FIXTURE__.setPositions([position]), {
        symbol: CURRENT_SYMBOL, side: 'LONG', quantity: submissions === 5 ? '0.02' : '0.01',
      });
    }
    if (submissions === (sameRound ? 8 : 7)) {
      await page.evaluate(orders => window.__BINANCE_FIXTURE__.setOrders(orders), publishedOrders);
      if (alternateConflict) {
        await page.evaluate(previousOrder => {
          const observed = [];
          const observer = new MutationObserver(() => {
            const row = document.querySelector('[data-order-id="tail-1"]');
            if (!row) return;
            const owner = row.__reactFiber$fixture.return;
            owner.alternate = { memoizedProps: {
              ...owner.memoizedProps, clientOrderId: previousOrder.clientOrderId,
            } };
            observed.push({
              orderId: owner.memoizedProps.orderId,
              currentClientOrderId: owner.memoizedProps.clientOrderId,
              previousClientOrderId: owner.alternate.memoizedProps.clientOrderId,
            });
          });
          observer.observe(document.querySelector('#account-widget'), { subtree: true, childList: true });
          window.__TAIL_NATIVE_IDENTITY_PROBE__ = {
            snapshot: () => observed,
            finish() { observer.disconnect(); return observed; },
          };
        }, host.scenario.orders[0]);
      }
    }
    if (submissions === (sameRound ? 9 : 10)) {
      await page.evaluate(() => window.__BINANCE_FIXTURE__.setPositions([]));
    }
    const rejected = (sameRound ? [5, 7, 8] : [5, 8]).includes(submissions);
    const response = rejected && submissions === 8 && !sameRound
      ? { success: false, code: '90802025', message: 'Maximum open orders' }
      : rejected ? REDUCE_ONLY_REJECTION : { success: true };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
  });
  return { ...host, publishedOrders };
}

for (const mode of ['same round', 'next round capacity']) {
  test(`user cancels only a new order during ${mode} recovery while earlier terminal rows stay mounted`, async ({ page }) => {
    // Given old cancellation receipts release two units and later native publications retain those identities beside one new close order.
    const host = await openFollowupTailRecovery(page, mode);

    // When another rejection needs a fresh cancellation batch in the same continuous-close session.
    await page.locator('[data-ladder-action="CLOSE_LONG"]').click({ modifiers: ['Alt'] });
    await advanceUntil(page, () => hasTerminalStatus(page), 'The fresh batch must exclude already-confirmed cancellations', 35_000);

    // Then only the new identity releases quantity or capacity, each cancellation counts once, and the remaining position finishes.
    await expect(page.locator(STATUS)).toContainText('当前方向已无持仓');
    await expect(page.locator(STATUS)).toContainText(`累计 ${mode === 'same round' ? 6 : 8} 笔`);
    await expect(page.locator(STATUS)).toContainText('撤 3 笔');
    const state = await readFixtureState(page);
    expect(state.orders).toEqual(host.publishedOrders);
    expect(state.events.filter(({ type }) => type === 'row-cancel-requested').map(({ orderId }) => orderId))
      .toEqual(['tail-1', 'tail-2', 'new-tail']);
    expect(state.events.filter(({ type }) => type === 'row-cancel-cleared')).toEqual([]);
    expect(state.events.filter(({ type }) => type === 'order-submit-api-rejected').map(({ code }) => code))
      .toEqual(mode === 'same round' ? ['90802022', '90802022', '90802022'] : ['90802022', '90802025']);
    expect(submittedOrders(state).map(({ quantity }) => quantity)).toEqual(Array(mode === 'same round' ? 9 : 10).fill('0.01'));
    expectRestoredScope(state);
    expect(host.errors).toEqual([]);
  });
}

test('user stops later capacity recovery when a cancelled order ID returns with a different client identity', async ({ page }) => {
  // Given the first recovery confirms both identities and the next native publication changes one cancelled order's client ID.
  const host = await openFollowupTailRecovery(page, 'identity conflict');

  // When a later continuous round receives a capacity rejection with the conflicting native identity still present.
  await page.locator('[data-ladder-action="CLOSE_LONG"]').click({ modifiers: ['Alt'] });
  await advanceUntil(page, () => hasTerminalStatus(page), 'Conflicting terminal identities must stop the session');

  // Then the identity conflict is terminal and cannot cancel another row or restart after the normal recovery delay.
  await expect(page.locator(STATUS)).toContainText('失败');
  await expect(page.locator(STATUS)).toContainText('已撤订单身份发生冲突，已停止重新挂单');
  await expect(page.locator(STATUS)).toContainText('累计 6 笔');
  await expect(page.locator(STATUS)).toContainText('撤 2 笔');
  await page.clock.runFor(10_000);
  const state = await readFixtureState(page);
  expect(state.orders).toEqual(host.publishedOrders);
  expect(submittedOrders(state)).toHaveLength(8);
  expect(state.events.filter(({ type }) => type === 'row-cancel-requested').map(({ orderId }) => orderId))
    .toEqual(['tail-1', 'tail-2']);
  expect(state.events.filter(({ type }) => type === 'order-submit-api-rejected').map(({ code }) => code))
    .toEqual(['90802022', '90802025']);
  expectRestoredScope(state);
  expect(host.errors).toEqual([]);
});

test('user never retries later capacity recovery when current and alternate native row identities disagree', async ({ page }) => {
  // Given a cancelled ID is republished with a new current client ID while its native React alternate still owns the old client ID.
  const host = await openFollowupTailRecovery(page, 'alternate identity conflict');

  // When a later capacity rejection reads the conflicting native row before checking the confirmed-cancellation map.
  await page.locator('[data-ladder-action="CLOSE_LONG"]').click({ modifiers: ['Alt'] });
  await advanceUntil(page, () => page.evaluate(() => window.__TAIL_NATIVE_IDENTITY_PROBE__?.snapshot().length > 0),
    'The native Basic row must expose the current/alternate identity conflict');
  await page.clock.runFor(10_000);
  await advanceUntil(page, async () => await hasTerminalStatus(page)
    || submittedOrders(await readFixtureState(page)).length > 8,
  'The conflict must terminate instead of entering another continuous round');

  // Then no retry submission or further cancellation occurs after the recovery delay and the native identity failure remains terminal.
  const state = await readFixtureState(page);
  expect(submittedOrders(state)).toHaveLength(8);
  await expect(page.locator(STATUS)).toContainText('失败');
  await expect(page.locator(STATUS)).toContainText('订单行身份发生变化，已停止撤单');
  await expect(page.locator(STATUS)).toContainText('累计 6 笔');
  await expect(page.locator(STATUS)).toContainText('撤 2 笔');
  expect(state.orders).toEqual(host.publishedOrders);
  expect(state.events.filter(({ type }) => type === 'row-cancel-requested').map(({ orderId }) => orderId))
    .toEqual(['tail-1', 'tail-2']);
  const nativeIdentities = await page.evaluate(() => window.__TAIL_NATIVE_IDENTITY_PROBE__.finish());
  expect(nativeIdentities).toContainEqual({
    orderId: 1001, currentClientOrderId: 'different-client-for-cancelled-id', previousClientOrderId: 'tail-1-client',
  });
  expectRestoredScope(state);
  expect(host.errors).toEqual([]);
});

test('user can stop close replacement during its recovery cooldown while cancelled rows remain mounted', async ({ page }) => {
  // Given both cancellations are confirmed while their old rows remain in the Basic source.
  const host = await openStaleCloseLongTail(page);
  await startCloseLongAndWaitForCancellations(page, host);

  // When the user stops during the post-cancellation cooldown before the old rows disappear.
  await page.locator('[data-ladder-stop]').evaluate(button => button.click());
  await advanceUntil(page, async () => (await page.locator(STATUS).allTextContents()).some(text => text.includes('已停止')),
    'Stop must prevent the late snapshot from starting a replacement');

  // Then the stopped task keeps its four accepted submissions and two cancellations.
  await expect(page.locator(STATUS)).toContainText('累计 4 笔');
  await expect(page.locator(STATUS)).toContainText('撤 2 笔');
  await page.clock.runFor(61_000);
  const state = await readFixtureState(page);
  expect(submittedOrders(state)).toHaveLength(5);
  expect(state.events.filter(({ type }) => type === 'row-cancel-requested').map(({ orderId }) => orderId))
    .toEqual(['tail-1', 'tail-2']);
  expect(state.events.filter(({ type }) => type === 'row-cancel-cleared').map(({ orderId }) => orderId))
    .toEqual(['tail-1', 'tail-2']);
  expectRestoredScope(state);
  expect(host.errors).toEqual([]);
});

test('user keeps the new symbol when an old close replacement is waiting for its recovery cooldown', async ({ page }) => {
  // Given both native cancellations succeeded while the original symbol's source still contains the old rows.
  const host = await openStaleCloseLongTail(page);
  await startCloseLongAndWaitForCancellations(page, host);

  // When the user changes symbols before the delayed cancellation publications arrive.
  await page.evaluate(symbol => window.__BINANCE_FIXTURE__.switchSymbol(symbol), OTHER_SYMBOL);
  await page.clock.runFor(61_000);

  // Then the old task never submits, cancels or restores its original symbol scope over the new selection.
  const state = await readFixtureState(page);
  expect(state.currentSymbol).toBe(OTHER_SYMBOL);
  expect(submittedOrders(state)).toHaveLength(5);
  expect(state.events.filter(({ type }) => type === 'order-submit-api-success')).toHaveLength(4);
  expect(state.events.filter(({ type }) => type === 'row-cancel-requested').map(({ orderId }) => orderId))
    .toEqual(['tail-1', 'tail-2']);
  expect(state.events.filter(({ type }) => type === 'row-cancel-cleared').map(({ orderId }) => orderId))
    .toEqual(['tail-1', 'tail-2']);
  expect(host.errors).toEqual([]);
});
