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
}) {
  await installScenarioClock(page);
  const scenario = createCancelScenario({
    positions: [{ symbol: CURRENT_SYMBOL, side: positionSide, quantity: (initialLevels / 100).toFixed(2) }],
    orders: tailOrders(levels, positionSide),
    ui: {
      tradeMode: 'CLOSE', accountTab: 'history', openOrdersSubTab: 'conditional',
      hideOtherSymbols: false, orderbookPrecision: '0.1',
    },
    host: { rowCancelMode, rowCancelDelayMs },
  });
  const host = await openUserscriptScenario(page, scenario, { replacementStream: true });
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
  'The native host must receive both scoped cancellation responses before publishing its new list');
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

test('user resumes close replacement before the deadline when source props change without a DOM mutation', async ({ page }) => {
  // Given both cancellation receipts succeeded and a final position publication is observed with the old source still mounted.
  const host = await openStaleCloseLongTail(page);
  await startCloseLongAndWaitForCancellations(page, host);
  await page.locator('.orders-content').evaluate(content => {
    const list = content.parentElement.__reactProps$fixture.children[2].props.children.props;
    const oldRows = content.__reactProps$fixture.children[1].props.children[1];
    let data = list.data;
    const reads = [];
    const mutations = [];
    const observer = new MutationObserver(records => mutations.push(...records.map(record => record.type)));
    observer.observe(content.closest('#account-widget'), {
      subtree: true, childList: true, characterData: true, attributes: true,
    });
    // Observe only the fixture's source boundary; production readers and waits remain unchanged.
    Object.defineProperty(list, 'data', {
      configurable: true,
      get() {
        mutations.push(...observer.takeRecords().map(record => record.type));
        reads.push({ at: Date.now(), ids: data.map(order => order.orderId), mutations: [...mutations] });
        return data;
      },
    });
    window.__TAIL_SOURCE_PROBE__ = {
      snapshot: () => ({ reads, mutations, now: Date.now() }),
      publish() {
        observer.takeRecords();
        mutations.length = 0;
        const lastReadAt = reads.at(-1).at;
        data = [{ ...data[0], orderId: 2001, clientOrderId: 'new-order' }, ...data.slice(2)];
        return {
          publishedAt: Date.now(), lastReadAt,
          source: data.map(order => order.orderId),
          window: oldRows.map(row => row.props.orderId),
        };
      },
      disconnect: () => observer.disconnect(),
    };
  });
  await page.evaluate(position => window.__BINANCE_FIXTURE__.setPositions([position]),
    { symbol: CURRENT_SYMBOL, side: 'LONG', quantity: '0.01' });
  await expect.poll(() => page.evaluate(() => window.__TAIL_SOURCE_PROBE__.snapshot().reads.length)).toBeGreaterThan(0);
  await page.clock.runFor(100);
  const waiting = await page.evaluate(() => window.__TAIL_SOURCE_PROBE__.snapshot());
  expect(waiting.reads.at(-1).ids).toEqual([1001, 1002, 1003]);
  const positionReadsBeforePublication = host.positionResponses.length;

  // When the complete source removes both IDs after the final observed commit, without touching any DOM node.
  const published = await page.evaluate(() => window.__TAIL_SOURCE_PROBE__.publish());
  expect(published.source).toEqual([2001, 1003]);
  expect(published.window).toEqual([1001, 1002, 1003]);
  expect(published.publishedAt).toBeGreaterThan(published.lastReadAt);
  await advanceUntil(page, () => hasTerminalStatus(page),
    'A props-only publication must resume and finish before the 6500ms list deadline', 4_500);

  // Then the bounded recheck observes no DOM mutation, rereads the smaller position, and submits only its remaining unit.
  const observed = await page.evaluate(() => {
    const snapshot = window.__TAIL_SOURCE_PROBE__.snapshot();
    window.__TAIL_SOURCE_PROBE__.disconnect();
    return snapshot;
  });
  const updatedRead = observed.reads.find(({ ids }) => ids[0] === 2001);
  expect(updatedRead.mutations).toEqual([]);
  expect(updatedRead.at - published.publishedAt).toBeLessThanOrEqual(250);
  expect(observed.now - published.lastReadAt).toBeLessThan(6500);
  expect(host.positionResponses.slice(positionReadsBeforePublication)
    .some(({ submissions, positions }) => submissions === 5 && positions[0]?.quantity === '0.01')).toBe(true);
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

for (const condition of ['cleared', 'empty']) {
  test(`user replaces only the confirmed remaining position when cancelled rows stay mounted and source is ${condition}`, async ({ page }) => {
    // Given four close-long submissions succeed and the fifth is rejected, while both cancelled rows stay in the host for a minute.
    const host = await openStaleCloseLongTail(page);

    // When the committed Basic source excludes both targets and a fill leaves only one minimum unit.
    await startCloseLongAndWaitForCancellations(page, host);
    await page.evaluate(position => window.__BINANCE_FIXTURE__.setPositions([position]),
      { symbol: CURRENT_SYMBOL, side: 'LONG', quantity: '0.01' });
    const source = await publishTailSource(page, condition);
    expect(source.source).toEqual(condition === 'empty' ? [] : [2001, 1003]);
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

for (const condition of [
  'contains a cancelled ID', 'is loading', 'has more pages', 'has an invalid native ID', 'contains another symbol',
]) {
  test(`user keeps four accepted submissions when the committed Basic source ${condition}`, async ({ page }) => {
    // Given the two cancellations are confirmed while the native order list still displays their rows.
    const host = await openStaleCloseLongTail(page);

    // When the native source cannot confirm the batch's absence before the list-check deadline.
    await startCloseLongAndWaitForCancellations(page, host);
    await publishTailSource(page, condition);
    await advanceUntil(page, () => hasTerminalStatus(page), 'Contradictory or unknown order state must end recovery');

    // Then four accepted orders and both cancellations count once without another financial action.
    await expect(page.locator(STATUS)).toContainText('失败');
    await expect(page.locator(STATUS)).toContainText(condition === 'contains a cancelled ID'
      ? '待替换挂单仍存在，已停止重新挂单'
      : '无法核实当前委托完整数据，已停止重新挂单');
    await expect(page.locator(STATUS)).toContainText('本轮 4/5 笔');
    await expect(page.locator(STATUS)).toContainText('累计 4 笔');
    await expect(page.locator(STATUS)).toContainText('撤 2 笔');
    await page.clock.runFor(10_000);
    const state = await readFixtureState(page);
    expect(submittedOrders(state)).toHaveLength(5);
    expect(state.events.filter(({ type }) => type === 'row-cancel-requested').map(({ orderId }) => orderId))
      .toEqual(['tail-1', 'tail-2']);
    expectRestoredScope(state);
    expect(host.errors).toEqual([]);
  });
}

test('user can stop close replacement while the committed Basic source still contains cancelled rows', async ({ page }) => {
  // Given both cancellations are confirmed while their old rows remain in the Basic source.
  const host = await openStaleCloseLongTail(page);
  await startCloseLongAndWaitForCancellations(page, host);

  // When the user stops before the delayed list commit removes those rows.
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

test('user keeps the new symbol when an old close replacement is waiting for its Basic source update', async ({ page }) => {
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
