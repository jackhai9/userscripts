import { test, expect } from '../test.js';
import { CURRENT_SYMBOL, OTHER_SYMBOL, createCancelScenario } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario, readFixtureState } from '../helpers/userscript-page.js';
import { installScenarioClock, pauseScenarioClock } from '../helpers/scenario-clock.js';

const STATUS = '#jh-binance-ladder-status';
const success = count => Array.from({ length: count }, () => ({ outcome: 'success', delivery: 'immediate' }));
const REDUCE_ONLY = { outcome: 'rejected', delivery: 'immediate', code: '90802022', message: 'Reduce only order rejected' };

async function submissions(page) {
  return (await readFixtureState(page)).events.filter(({ type }) => type === 'order-submitted');
}

async function orderTypes(page, count) {
  return (await submissions(page)).slice(0, count).map(({ orderType }) => orderType);
}

/** Keeps every status line so transient explanations can be asserted after the task moves on. */
async function recordStatusHistory(page) {
  await page.evaluate(selector => {
    const status = document.querySelector(selector);
    window.__statusHistory = [status.textContent];
    new MutationObserver(() => window.__statusHistory.push(status.textContent))
      .observe(status, { childList: true, subtree: true, characterData: true });
  }, STATUS);
  return () => page.evaluate(() => window.__statusHistory);
}

async function chooseLadder(page, { levels = 3, taker }) {
  await page.locator(`[data-ladder-group="levels"][data-ladder-value="${levels}"]`).click();
  await page.locator(`[data-ladder-group="taker"][data-ladder-value="${taker}"]`).click();
  await expect(page.locator(`[data-ladder-group="taker"][data-ladder-value="${taker}"]`)).toHaveAttribute('aria-pressed', 'true');
}

function openScenario(host = {}) {
  return createCancelScenario({ ui: { openableQuantity: '10' }, host: { submitApiResponses: success(3), ...host } });
}

function closeScenario(host = {}, overrides = {}) {
  return createCancelScenario({
    positions: [{ symbol: CURRENT_SYMBOL, side: 'LONG', quantity: '100' }],
    ...overrides,
    ui: { tradeMode: 'CLOSE', ...overrides.ui },
    host: { submitApiResponses: success(30), ...host },
  });
}

async function startContinuousClose(page) {
  await page.locator('[data-ladder-action="CLOSE_LONG"]').click({ modifiers: ['Alt'] });
}

async function stopTask(page) {
  await page.locator('[data-ladder-stop]').click();
  await expect(page.locator('[data-ladder-stop]')).toHaveCount(0, { timeout: 10_000 });
}

for (const [percent, takers] of [[0, 0], [20, 1], [50, 1], [80, 2]]) {
  test(`user sends ${takers} of three one-round ladder orders as market orders first at taker ${percent}%`, async ({ page }) => {
    // Given an open-long ladder of three orders and the selected taker share.
    const host = await openUserscriptScenario(page, openScenario(), { replacementStream: true });
    await chooseLadder(page, { taker: percent });

    // When the user runs the ladder once.
    await page.locator('[data-ladder-action="OPEN_LONG"]').click();
    await expect.poll(async () => (await submissions(page)).length, { timeout: 15_000 }).toBe(3);
    await expect(page.locator('[data-ladder-stop]')).toHaveCount(0, { timeout: 10_000 });

    // Then the market orders come first without a price, the rest are Post Only, and the form returns to Post Only.
    const sent = await submissions(page);
    expect(sent.map(({ orderType }) => orderType))
      .toEqual([...Array(takers).fill('MARKET'), ...Array(3 - takers).fill('POST_ONLY')]);
    expect(sent.slice(0, takers).map(({ price }) => price)).toEqual(Array(takers).fill(''));
    expect(sent.slice(takers).every(({ price }) => Number(price) > 0)).toBe(true);
    expect(new Set(sent.map(({ quantity }) => quantity)).size).toBe(1);
    expect((await readFixtureState(page)).orderType).toBe('POST_ONLY');
    await expect(page.locator(STATUS)).not.toContainText('失败');
    expect(host.errors).toEqual([]);
  });
}

test('user gets an opening short market order raised when its maker-sized notional falls below the minimum at the bid', async ({ page }) => {
  // Given an open-short ladder sized at the ask-side maker price: 0.07 × 81.03 clears 5.67, but 0.07 × 80.9 does not.
  const host = await openUserscriptScenario(page, openScenario({ minNotional: '5.67' }), { replacementStream: true });
  await chooseLadder(page, { taker: 50 });

  // When the user runs it once.
  await page.locator('[data-ladder-action="OPEN_SHORT"]').click();
  await expect.poll(async () => (await submissions(page)).length, { timeout: 15_000 }).toBe(3);
  await expect(page.locator('[data-ladder-stop]')).toHaveCount(0, { timeout: 10_000 });

  // Then the market order covers 101% of the minimum at the 80.9 bid while the makers keep the planned size.
  const sent = await submissions(page);
  expect(sent.map(({ orderType, quantity }) => [orderType, quantity])).toEqual([
    ['MARKET', '0.08'], ['POST_ONLY', '0.07'], ['POST_ONLY', '0.07'],
  ]);
  await expect(page.locator(STATUS)).not.toContainText('失败');
  expect(host.errors).toEqual([]);
});

test('user keeps an opening long market order at its planned size when it already clears the minimum at the bid', async ({ page }) => {
  // Given an open-long ladder sized at bid-side maker prices.
  const host = await openUserscriptScenario(page, openScenario({ minNotional: '5.67' }), { replacementStream: true });
  await chooseLadder(page, { taker: 50 });

  // When the user runs it once.
  await page.locator('[data-ladder-action="OPEN_LONG"]').click();
  await expect.poll(async () => (await submissions(page)).length, { timeout: 15_000 }).toBe(3);
  await expect(page.locator('[data-ladder-stop]')).toHaveCount(0, { timeout: 10_000 });

  // Then the market order is the first planned order, unchanged.
  const sent = await submissions(page);
  expect(sent.map(({ orderType, quantity }) => [orderType, quantity])).toEqual([
    ['MARKET', '0.08'], ['POST_ONLY', '0.08'], ['POST_ONLY', '0.08'],
  ]);
  expect(host.errors).toEqual([]);
});

for (const [name, host, reason] of [
  ['the minimum notional is unknown', { minNotional: null }, '无法按市价核对最小下单金额'],
  ['the raised quantity exceeds the market maximum', { minNotional: '5.67', marketLotSize: { minQty: '0.01', stepSize: '0.01', maxQty: '0.07' } }, '数量超过市价单最大数量'],
]) {
  test(`user sees an opening taker slot placed as Post Only when ${name}`, async ({ page }) => {
    // Given an open-short ladder whose market quantity cannot be confirmed.
    const scenarioHost = await openUserscriptScenario(page, openScenario(host), { replacementStream: true });
    await chooseLadder(page, { taker: 50 });

    // When the user runs it once.
    await page.locator('[data-ladder-action="OPEN_SHORT"]').click();
    await expect.poll(async () => (await submissions(page)).length, { timeout: 15_000 }).toBe(3);
    await expect(page.locator('[data-ladder-stop]')).toHaveCount(0, { timeout: 10_000 });

    // Then every order is Post Only and the final status keeps the reason.
    expect(await orderTypes(page, 3)).toEqual(['POST_ONLY', 'POST_ONLY', 'POST_ONLY']);
    await expect(page.locator(STATUS)).toContainText(`本轮吃单改为挂单：${reason}`);
    expect(scenarioHost.errors).toEqual([]);
  });
}

test('user keeps a closing market order at its planned size because reduce-only orders have no minimum notional', async ({ page }) => {
  // Given a close-long ladder whose orders are far below the minimum notional.
  const host = await openUserscriptScenario(page, closeScenario({ minNotional: '1000' }), { replacementStream: true });
  await chooseLadder(page, { taker: 50 });

  // When the user runs it once.
  await page.locator('[data-ladder-action="CLOSE_LONG"]').click();
  await expect.poll(async () => (await submissions(page)).length, { timeout: 15_000 }).toBe(3);
  await expect(page.locator('[data-ladder-stop]')).toHaveCount(0, { timeout: 10_000 });

  // Then every order, including the market one, keeps the same planned quantity.
  const sent = await submissions(page);
  expect(sent[0].orderType).toBe('MARKET');
  expect(new Set(sent.map(({ quantity }) => quantity)).size).toBe(1);
  expect(host.errors).toEqual([]);
});

test('user sees a continuous close carry fractional taker orders from round to round', async ({ page }) => {
  // Given a continuous close of three orders per round at taker 50%.
  test.setTimeout(40_000);
  const host = await openUserscriptScenario(page, closeScenario(), { replacementStream: true });
  await chooseLadder(page, { taker: 50 });

  // When three rounds run.
  await startContinuousClose(page);
  await expect.poll(async () => (await submissions(page)).length, { timeout: 25_000 }).toBeGreaterThanOrEqual(9);
  await stopTask(page);

  // Then the rounds take one, two, and one market order (1.5 per round), each before that round's makers.
  expect(await orderTypes(page, 9)).toEqual([
    'MARKET', 'POST_ONLY', 'POST_ONLY',
    'MARKET', 'MARKET', 'POST_ONLY',
    'MARKET', 'POST_ONLY', 'POST_ONLY',
  ]);
  expect((await readFixtureState(page)).orderType).toBe('POST_ONLY');
  expect(host.errors).toEqual([]);
});

test('user changes the taker share during a continuous close and it applies from the next round', async ({ page }) => {
  // Given a continuous close running with taker off.
  test.setTimeout(40_000);
  const host = await openUserscriptScenario(page, closeScenario(), { replacementStream: true });
  await chooseLadder(page, { taker: 0 });
  const history = await recordStatusHistory(page);
  await startContinuousClose(page);
  await expect.poll(async () => (await submissions(page)).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);

  // When the user selects 80% while the first round is still placing orders.
  await page.locator('[data-ladder-group="taker"][data-ladder-value="80"]').click();
  await expect.poll(async () => (await submissions(page)).length, { timeout: 25_000 }).toBeGreaterThanOrEqual(6);
  await stopTask(page);

  // Then the running round stays Post Only and the next round sends two of its three orders at market.
  expect(await orderTypes(page, 6)).toEqual(['POST_ONLY', 'POST_ONLY', 'POST_ONLY', 'MARKET', 'MARKET', 'POST_ONLY']);
  expect((await history()).some(text => text.includes('已变化'))).toBe(false);
  expect(host.errors).toEqual([]);
});

for (const [name, scenario, options, reason] of [
  ['the quantity is below the market minimum', openScenario({ marketLotSize: { minQty: '1000', stepSize: '0.01', maxQty: '1000000' } }),
    { replacementStream: true }, '数量低于市价单最小数量'],
  ['account order updates are not connected', openScenario(), {}, '未连接到账户订单更新'],
]) {
  test(`user sees taker orders placed as Post Only with the reason when ${name}`, async ({ page }) => {
    // Given a one-round ladder at taker 50% that cannot send a market order.
    const host = await openUserscriptScenario(page, scenario, options);
    await chooseLadder(page, { taker: 50 });
    const history = await recordStatusHistory(page);

    // When the user runs the ladder.
    await page.locator('[data-ladder-action="OPEN_LONG"]').click();
    await expect.poll(async () => (await submissions(page)).length, { timeout: 15_000 }).toBe(3);
    await expect(page.locator('[data-ladder-stop]')).toHaveCount(0, { timeout: 10_000 });

    // Then every order is Post Only and the status explained why.
    expect(await orderTypes(page, 3)).toEqual(['POST_ONLY', 'POST_ONLY', 'POST_ONLY']);
    expect((await history()).some(text => text.includes(`本轮吃单改为挂单：${reason}`))).toBe(true);
    expect(host.errors).toEqual([]);
  });
}

test('user retries a reduce-only rejected market order once after the conflicting orders are replaced', async ({ page }) => {
  // Given a continuous close whose first market order is rejected as reduce-only while close orders rest on the book.
  test.setTimeout(40_000);
  const resting = ['83', '84', '85'].map((price, index) => ({
    id: `resting-${index}`, symbol: CURRENT_SYMBOL, kind: 'basic', side: '平多', price, quantity: '0.2',
    orderId: 2001 + index, clientOrderId: `resting-${index}-client`,
  }));
  const host = await openUserscriptScenario(page, closeScenario(
    { submitApiResponses: [REDUCE_ONLY, ...success(30)], openableQuantityAfterRowCancel: '10' },
    { orders: resting, ui: { accountTab: 'openOrders', hideOtherSymbols: true } },
  ), { replacementStream: true });
  await chooseLadder(page, { taker: 50 });

  // When the round runs through reduce-only recovery.
  await startContinuousClose(page);
  await expect.poll(async () => (await submissions(page)).length, { timeout: 25_000 }).toBeGreaterThanOrEqual(4);
  await stopTask(page);

  // Then the rejected slot is sent at market once more after a cancellation, followed by the round's makers.
  const state = await readFixtureState(page);
  const events = state.events.filter(({ type }) => ['order-submitted', 'row-cancel-requested'].includes(type));
  const firstCancel = events.findIndex(({ type }) => type === 'row-cancel-requested');
  const sent = events.filter(({ type }) => type === 'order-submitted');
  expect(firstCancel).toBeGreaterThan(0);
  expect(events[0].orderType).toBe('MARKET');
  expect(events.slice(firstCancel).find(({ type }) => type === 'order-submitted').orderType).toBe('MARKET');
  expect(sent.slice(0, 4).map(({ orderType }) => orderType)).toEqual(['MARKET', 'MARKET', 'POST_ONLY', 'POST_ONLY']);
  expect(state.orderType).toBe('POST_ONLY');
  expect(host.errors).toEqual([]);
});

for (const [name, response] of [
  ['an HTTP 503 that carries an error code', { status: 503, body: { success: false, code: '90802022', message: 'Service unavailable' } }],
  ['a timeout code whose execution status is unknown', { status: 200, body: { success: false, code: '-1007', message: 'Timeout waiting for response from backend server' } }],
]) {
  test(`user ends a continuous close after ${name} instead of sending another market order`, async ({ page }) => {
    // Given a continuous close whose first market order gets a response that does not prove a rejection.
    test.setTimeout(40_000);
    const host = await openUserscriptScenario(page, closeScenario(), { replacementStream: true });
    let requests = 0;
    await page.route('**/bapi/futures/v1/private/future/order/place-order', async route => {
      requests += 1;
      if (requests > 1) return route.fallback();
      await route.fulfill({ status: response.status, contentType: 'application/json', body: JSON.stringify(response.body) });
    });
    await chooseLadder(page, { taker: 50 });

    // When no account frame confirms that order.
    await startContinuousClose(page);

    // Then the session stops with the unconfirmed taker and never sends a second market order.
    await expect(page.locator(STATUS)).toContainText('吃单结果未确认，已停止', { timeout: 25_000 });
    await expect(page.locator('[data-ladder-stop]')).toHaveCount(0, { timeout: 10_000 });
    expect(await orderTypes(page, 10)).toEqual(['MARKET']);
    expect((await readFixtureState(page)).orderType).toBe('POST_ONLY');
    expect(host.errors).toEqual([]);
  });
}

async function failFirstPlaceOrderWith503(page) {
  let requests = 0;
  await page.route('**/bapi/futures/v1/private/future/order/place-order', async route => {
    requests += 1;
    if (requests === 1) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false }) });
      return;
    }
    await route.fallback();
  });
}

test('user continues after an unknown market-order response once the account stream proves the order exists', async ({ page }) => {
  // Given a one-round ladder whose market order receives a service error.
  const host = await openUserscriptScenario(page, openScenario({ submitApiResponses: success(2) }), { replacementStream: true });
  await failFirstPlaceOrderWith503(page);
  await chooseLadder(page, { taker: 50 });

  // When the account stream reports that exact order while its outcome is being resolved.
  await page.locator('[data-ladder-action="OPEN_LONG"]').click();
  await expect.poll(async () => (await submissions(page)).length, { timeout: 15_000 }).toBe(1);
  const [taker] = await submissions(page);
  host.publishTerminalUpdate({ s: CURRENT_SYMBOL, c: taker.clientOrderId, S: 'BUY', ps: 'LONG', o: 'MARKET', x: 'NEW', X: 'NEW', i: 9001, q: taker.quantity, z: '0' });

  // Then the order counts as placed and the makers follow without a second market order.
  await expect.poll(async () => (await submissions(page)).length, { timeout: 15_000 }).toBe(3);
  await expect(page.locator('[data-ladder-stop]')).toHaveCount(0, { timeout: 10_000 });
  expect(await orderTypes(page, 3)).toEqual(['MARKET', 'POST_ONLY', 'POST_ONLY']);
  await expect(page.locator(STATUS)).not.toContainText('失败');
  expect(host.errors).toEqual([]);
});

test('user stops after an unknown market-order response that the account stream never confirms', async ({ page }) => {
  // Given a one-round ladder whose market order receives a service error.
  test.setTimeout(30_000);
  const host = await openUserscriptScenario(page, openScenario({ submitApiResponses: success(2) }), { replacementStream: true });
  await failFirstPlaceOrderWith503(page);
  await chooseLadder(page, { taker: 50 });

  // When no account frame for that order arrives.
  await page.locator('[data-ladder-action="OPEN_LONG"]').click();

  // Then the task stops without retrying the market order or placing makers, back on Post Only.
  await expect(page.locator(STATUS)).toContainText('吃单结果未确认，已停止', { timeout: 20_000 });
  expect(await orderTypes(page, 5)).toEqual(['MARKET']);
  expect((await readFixtureState(page)).orderType).toBe('POST_ONLY');
  expect(host.errors).toEqual([]);
});

test('user stops during a pending market order without another click and returns to Post Only', async ({ page }) => {
  // Given a one-round ladder whose market order response is held.
  const host = await openUserscriptScenario(page, openScenario({
    submitApiResponses: [{ outcome: 'success', delivery: 'manual' }, ...success(2)],
  }), { replacementStream: true });
  await chooseLadder(page, { taker: 50 });
  await page.locator('[data-ladder-action="OPEN_LONG"]').click();
  await expect.poll(host.pendingSubmitSequences, { timeout: 15_000 }).toEqual([1]);

  // When the user stops and the response then arrives.
  await page.locator('[data-ladder-stop]').click();
  await host.releaseSubmitResponse(1);
  await expect(page.locator('[data-ladder-stop]')).toHaveCount(0, { timeout: 10_000 });

  // Then the sent market order counts, nothing else is submitted, and the form is Post Only again.
  await expect(page.locator(STATUS)).toContainText('阶梯开多已停止 · 已挂 1/3 笔');
  expect(await orderTypes(page, 5)).toEqual(['MARKET']);
  await expect.poll(async () => (await readFixtureState(page)).orderType).toBe('POST_ONLY');
  expect(host.errors).toEqual([]);
});

for (const [name, taker, overrides, field] of [
  ['a market order whose quantity differs from the plan', 50, { quantity: 999 }, '数量'],
  ['a Post Only order sent as a market order', 0, { type: 'MARKET' }, '订单类型'],
  ['a market order for another symbol', 50, { symbol: OTHER_SYMBOL }, '交易对'],
]) {
  test(`user blocks ${name} before it reaches the exchange`, async ({ page }) => {
    // Given the native request body deviates from the planned order.
    const host = await openUserscriptScenario(page, openScenario({ placeOrderBodyOverrides: overrides }), { replacementStream: true });
    await chooseLadder(page, { taker });

    // When the user runs the ladder.
    await page.locator('[data-ladder-action="OPEN_LONG"]').click();

    // Then the request is blocked, the task stops, and nothing reaches the order endpoint.
    await expect(page.locator(STATUS)).toContainText(`下单请求与计划不一致（${field}），已拦截并停止`, { timeout: 15_000 });
    const state = await readFixtureState(page);
    expect(state.events.filter(({ type }) => type === 'order-submit-request-failed')).toHaveLength(1);
    expect(state.events.filter(({ type }) => type.startsWith('order-submit-api-'))).toEqual([]);
    expect(state.orderType).toBe('POST_ONLY');
    expect(host.errors).toEqual([]);
  });
}

test('user stops without any order when the page has no market order tab', async ({ page }) => {
  // Given a native form that offers only Limit and Post Only.
  const host = await openUserscriptScenario(page, openScenario({ orderTypeTabs: ['LIMIT', 'POST_ONLY'] }), { replacementStream: true });
  await chooseLadder(page, { taker: 50 });

  // When the user runs the ladder.
  await page.locator('[data-ladder-action="OPEN_LONG"]').click();

  // Then the taker step stops the task before any submission.
  await expect(page.locator(STATUS)).toContainText('未能切换到市价单，已停止吃单', { timeout: 15_000 });
  expect(await submissions(page)).toEqual([]);
  expect((await readFixtureState(page)).orderType).toBe('POST_ONLY');
  expect(host.errors).toEqual([]);
});

async function openDialogOnMarketClick(page, { blockRequest }) {
  await page.evaluate(blockRequest => document.addEventListener('click', event => {
    const marketActive = document.querySelector('.order-type-tabs [data-tab-key="MARKET"][aria-selected="true"]');
    if (!marketActive || event.target.textContent !== '开多' || document.querySelector('#market-confirm')) return;
    // A native confirmation holds the request until the user decides; a late unrelated dialog does not.
    if (blockRequest) event.stopPropagation();
    const dialog = document.createElement('div');
    dialog.id = 'market-confirm';
    dialog.setAttribute('role', 'dialog');
    dialog.textContent = '确认下单';
    document.body.append(dialog);
  }, true), blockRequest);
}

test('user stops when a confirmation dialog holds the market order and leaves it unconfirmed', async ({ page }) => {
  // Given the native page asks for confirmation before sending market orders.
  test.setTimeout(30_000);
  const host = await openUserscriptScenario(page, openScenario(), { replacementStream: true });
  await chooseLadder(page, { taker: 50 });
  await openDialogOnMarketClick(page, { blockRequest: true });

  // When the user runs the ladder.
  await page.locator('[data-ladder-action="OPEN_LONG"]').click();

  // Then the task stops with the dialog still open and nothing was sent.
  await expect(page.locator(STATUS)).toContainText('吃单后出现确认弹窗，未自动确认，已停止', { timeout: 15_000 });
  await expect(page.locator('#market-confirm')).toBeVisible();
  expect(await submissions(page)).toEqual([]);
  expect(host.errors).toEqual([]);
});

test('user counts a placed market order and stops when an unrelated dialog appears after it', async ({ page }) => {
  // Given a dialog that appears while the market order is still sent and accepted.
  const host = await openUserscriptScenario(page, openScenario(), { replacementStream: true });
  await chooseLadder(page, { taker: 50 });
  await openDialogOnMarketClick(page, { blockRequest: false });

  // When the user runs the ladder.
  await page.locator('[data-ladder-action="OPEN_LONG"]').click();

  // Then the accepted order is counted, no maker follows, and the dialog is left alone.
  await expect(page.locator(STATUS)).toContainText('已挂 1/3 笔', { timeout: 15_000 });
  await expect(page.locator(STATUS)).toContainText('吃单已提交，但随后出现新的弹窗，未处理该弹窗，已停止');
  await expect(page.locator('#market-confirm')).toBeVisible();
  expect(await orderTypes(page, 5)).toEqual(['MARKET']);
  expect(host.errors).toEqual([]);
});

test('user reads a four-line taker summary that tracks fills and later prices', async ({ page }) => {
  // Given a completed one-round ladder that sent two market orders.
  await installScenarioClock(page);
  const host = await openUserscriptScenario(page, openScenario(), { replacementStream: true });
  await chooseLadder(page, { taker: 80 });
  await page.locator('[data-ladder-action="OPEN_LONG"]').click();
  await expect.poll(async () => (await submissions(page)).length, { timeout: 15_000 }).toBe(3);
  await expect(page.locator('[data-ladder-stop]')).toHaveCount(0, { timeout: 10_000 });
  const [first, second] = await submissions(page);

  // When both fill, the second above the first, with the best ask between them, and 30 seconds pass.
  const fill = (order, price) => ({ s: CURRENT_SYMBOL, c: order.clientOrderId, S: 'BUY', ps: 'LONG', o: 'MARKET', x: 'TRADE', X: 'FILLED', i: 1, ap: price, z: order.quantity });
  host.publishTerminalUpdate(fill(first, '80'));
  host.publishTerminalUpdate(fill(second, '82'));
  const title = page.locator('#jh-binance-ladder-title');
  await expect.poll(() => title.getAttribute('title')).toContain('共 2 笔，成交价逐笔走高 1 次');
  await pauseScenarioClock(page);
  const beforeSamples = await title.getAttribute('title');
  await page.clock.runFor(5_100);
  const afterFive = await title.getAttribute('title');
  await page.clock.runFor(25_100);

  // Then the summary keeps four lines and judges later asks against each fill for a long position.
  expect(beforeSamples.split('\n')).toEqual([
    '吃单统计 · 阶梯开多', '共 2 笔，成交价逐笔走高 1 次', '5 秒后：统计中 2', '30 秒后：统计中 2',
  ]);
  expect(afterFive.split('\n')[2]).toBe('5 秒后：有利 1 · 不利 1');
  await expect.poll(async () => (await title.getAttribute('title')).split('\n')[3]).toBe('30 秒后：有利 1 · 不利 1');
  expect(host.errors).toEqual([]);
});
