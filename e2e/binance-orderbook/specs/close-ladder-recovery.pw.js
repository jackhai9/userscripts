import { test, expect } from '../test.js';
import { CURRENT_SYMBOL, createCancelScenario } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario, readFixtureState } from '../helpers/userscript-page.js';

test('user retains partial close progress through reduce-only rejections until the position is confirmed flat', async ({ page }) => {
  // Given two native close submissions can succeed before repeated reduce-only rejections and decreasing authoritative positions.
  test.setTimeout(30_000);
  const scenario = createCancelScenario({
    positions: [{ symbol: CURRENT_SYMBOL, side: 'SHORT', quantity: '100' }],
    ui: { tradeMode: 'CLOSE', orderbookPrecision: '0.1' },
  });
  const { errors } = await openUserscriptScenario(page, scenario);
  let submissions = 0;
  const quantities = ['100', '80', '80', '60', '0'];
  let positionReads = 0;
  await page.route('**/bapi/futures/v1/private/future/order/place-order', async (route) => {
    submissions += 1;
    expect(submissions).toBeLessThanOrEqual(5);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(submissions <= 2 ? { success: true } : {
        success: false, code: '90802022', message: 'Reduce-only order failed',
      }),
    });
  });
  await page.route('**/bapi/futures/v6/private/future/user-data/user-position', async (route) => {
    const quantity = quantities[positionReads++];
    expect(quantity).not.toBeUndefined();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: [{ symbol: CURRENT_SYMBOL, positionSide: 'SHORT', positionAmount: `-${quantity}` }],
      }),
    });
  });
  const panel = page.locator('#jh-binance-close-qty-multiplier-panel');
  // When the user starts continuous close-short trading.
  await panel.getByRole('button', { name: '阶梯平空', exact: true }).click({ modifiers: ['Alt'] });
  const status = panel.locator('#jh-binance-ladder-status');
  // Then the runner rechecks position progress, preserves the two confirmed submissions, and ends on confirmed flat without cancellations.
  await expect(status).toContainText('只减仓冲突，3s 后复核仓位', { timeout: 8_000 });
  await expect(status).toContainText('当前方向已无持仓', { timeout: 18_000 });
  await expect(status).toContainText('连续阶梯平空');
  await expect(status).toContainText('累计 2 笔');
  expect(submissions).toBe(5);
  expect(positionReads).toBe(5);
  const events = (await readFixtureState(page)).events;
  const orders = events.filter(({ type }) => type === 'order-submitted');
  expect(orders.map(({ quantity }) => quantity)).toEqual(['0.06', '0.06', '0.06', '0.04', '0.03']);
  expect(events.filter(({ type }) => /cancel/.test(type))).toEqual([]);
  expect(errors).toEqual([]);
});

test('user can finish continuous close on confirmed flat even when the native button becomes disabled', async ({ page }) => {
  // Given the first close request is rejected and the position response disables the native submit button.
  const scenario = createCancelScenario({
    positions: [{ symbol: CURRENT_SYMBOL, side: 'SHORT', quantity: '100' }],
    ui: { tradeMode: 'CLOSE', orderbookPrecision: '0.1' },
  });
  const { errors } = await openUserscriptScenario(page, scenario);
  let submissions = 0;
  let positionReads = 0;
  await page.route('**/bapi/futures/v1/private/future/order/place-order', async (route) => {
    submissions += 1;
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ success: false, code: 90802022, message: 'Reduce-only order failed' }),
    });
  });
  await page.route('**/bapi/futures/v6/private/future/user-data/user-position', async (route) => {
    positionReads += 1;
    expect(positionReads).toBeLessThanOrEqual(2);
    if (positionReads === 1) {
      await page.getByRole('button', { name: '平空', exact: true }).evaluate((button) => {
        button.disabled = true;
      });
    }
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [{
        symbol: CURRENT_SYMBOL, positionSide: 'SHORT', positionAmount: positionReads === 1 ? '-100' : '0',
      }] }),
    });
  });
  const panel = page.locator('#jh-binance-close-qty-multiplier-panel');
  // When the user starts continuous close-short trading.
  await panel.getByRole('button', { name: '阶梯平空', exact: true }).click({ modifiers: ['Alt'] });
  // Then the authoritative flat position ends the session after one submit and two position reads.
  await expect(panel.locator('#jh-binance-ladder-status')).toContainText('当前方向已无持仓', { timeout: 10_000 });
  expect(submissions).toBe(1);
  expect(positionReads).toBe(2);
  expect(errors).toEqual([]);
});

test('user stops on a capacity rejection during reduce-only recovery without cancelling orders', async ({ page }) => {
  // Given a reduce-only rejection is followed by position progress and then a capacity rejection.
  const scenario = createCancelScenario({
    positions: [{ symbol: CURRENT_SYMBOL, side: 'SHORT', quantity: '100' }],
    ui: { tradeMode: 'CLOSE', orderbookPrecision: '0.1' },
  });
  const { errors } = await openUserscriptScenario(page, scenario);
  let submissions = 0;
  let positionReads = 0;
  await page.route('**/bapi/futures/v1/private/future/order/place-order', async (route) => {
    submissions += 1;
    expect(submissions).toBeLessThanOrEqual(2);
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(submissions === 1
        ? { success: false, code: 90802022 }
        : { success: false, code: 90802025, message: 'Maximum open orders' }),
    });
  });
  await page.route('**/bapi/futures/v6/private/future/user-data/user-position', async (route) => {
    positionReads += 1;
    expect(positionReads).toBeLessThanOrEqual(2);
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [{
        symbol: CURRENT_SYMBOL, positionSide: 'SHORT', positionAmount: positionReads === 1 ? '-100' : '-80',
      }] }),
    });
  });
  const panel = page.locator('#jh-binance-close-qty-multiplier-panel');
  // When the user starts continuous close-short trading.
  await panel.getByRole('button', { name: '阶梯平空', exact: true }).click({ modifiers: ['Alt'] });
  const status = panel.locator('#jh-binance-ladder-status');
  // Then the specific native capacity failure stays visible and no batch cancellation begins.
  await expect(status).toContainText('失败', { timeout: 10_000 });
  await expect(status).toContainText('Maximum open orders');
  await expect(status).toContainText('90802025');
  await expect(status).toContainText('只减仓订单被拒绝');
  await expect(status).not.toContainText('null');
  expect(submissions).toBe(2);
  expect(positionReads).toBe(2);
  expect((await readFixtureState(page)).events.filter(({ type }) => /cancel/.test(type))).toEqual([]);
  expect(errors).toEqual([]);
});
