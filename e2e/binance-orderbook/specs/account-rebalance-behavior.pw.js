import { test, expect } from '../test.js';
import { ACCOUNT_PATHS, createAccountRebalanceApi } from '../fixtures/account-rebalance-api.js';
import { createCancelScenario } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario, readFixtureState } from '../helpers/userscript-page.js';
import { installScenarioClock, pauseScenarioClock } from '../helpers/scenario-clock.js';

async function openRebalance(page, balances, options) {
  await installScenarioClock(page);
  const { errors } = await openUserscriptScenario(page, createCancelScenario());
  const api = createAccountRebalanceApi(balances, options);
  await page.route('https://www.binance.com/bapi/**', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (!api.supports(pathname)) return route.fallback();
    const body = request.postData() === null ? undefined : request.postDataJSON();
    const response = api.handle({ pathname, method: request.method(), body });
    await route.fulfill({ status: response.status, contentType: 'application/json', body: JSON.stringify(response.body) });
  });
  await page.clock.runFor(3000);
  const action = page.locator('[data-usdt-rebalance]');
  await expect(action).toBeVisible();
  await expect(action).toBeEnabled();
  return { api, errors, action, status: page.locator('#jh-binance-ladder-status') };
}

test('user completes exactly two USDT transfers only after confirming the complete account plan', async ({ page }) => {
  // Given a globally flat account holds all 100 USDT in Funding and satisfies the stability window.
  const { api, errors, action, status } = await openRebalance(page, { FUNDING: '100', MAIN: '0', UMFUTURE: '0' });

  // When the user opens the account plan.
  await action.evaluate(button => button.click());
  const dialog = page.getByRole('dialog', { name: '账户再平衡' });
  await expect(dialog).toBeVisible();

  // Then the preview contains both transfers while the account remains unchanged.
  await expect(dialog).toContainText('40 USDT');
  await expect(dialog).toContainText('10 USDT');
  expect(api.snapshot().requests.filter(request => request.pathname === ACCOUNT_PATHS.transfer)).toEqual([]);
  expect(api.snapshot().balances).toEqual({ FUNDING: '100', MAIN: '0', UMFUTURE: '0' });

  // When the user confirms the reviewed plan once.
  await dialog.getByRole('button', { name: '确认再平衡', exact: true }).click();

  // Then the two explicit native requests reach the 5:4:1 target and ordinary trading is untouched.
  await expect(status).toHaveText('账户再平衡已完成 · 2/2 笔');
  expect(api.snapshot().requests.filter(request => request.pathname === ACCOUNT_PATHS.transfer).map(request => request.body))
    .toEqual([
      { asset: 'USDT', amount: '40', kindType: 'CARD_MAIN' },
      { asset: 'USDT', amount: '10', kindType: 'CARD_FUTURE' },
    ]);
  expect(api.snapshot().balances).toEqual({ FUNDING: '50', MAIN: '40', UMFUTURE: '10' });
  expect((await readFixtureState(page)).events.filter(({ type }) => /order-submitted|cancel-requested/.test(type))).toEqual([]);
  expect(errors).toEqual([]);
});

test('user cancels an account preview without sending a transfer', async ({ page }) => {
  // Given a flat account has a valid two-transfer rebalance plan.
  const { api, errors, action, status } = await openRebalance(page, { FUNDING: '100', MAIN: '0', UMFUTURE: '0' });
  await action.evaluate(button => button.click());
  const dialog = page.getByRole('dialog', { name: '账户再平衡' });
  await expect(dialog).toBeVisible();

  // When the user declines the preview.
  await dialog.getByRole('button', { name: '取消', exact: true }).evaluate(button => button.click());

  // Then both the user-visible result and the native account retain the cancelled decision.
  await expect(status).toHaveText('账户再平衡已取消');
  expect(api.snapshot().requests.filter(request => request.pathname === ACCOUNT_PATHS.transfer)).toEqual([]);
  expect(api.snapshot().balances).toEqual({ FUNDING: '100', MAIN: '0', UMFUTURE: '0' });
  expect(errors).toEqual([]);
});

test('user with already balanced wallets receives a no-transfer result', async ({ page }) => {
  // Given a globally flat account already holds the exact desired ratio.
  const { api, errors, action, status } = await openRebalance(page, { FUNDING: '50', MAIN: '40', UMFUTURE: '10' });

  // When the user requests an account rebalance.
  await action.evaluate(button => button.click());

  // Then no confirmation or transfer is needed and the result states the existing ratio.
  await expect(status).toHaveText('USDT 已按 5:4:1 分配');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(api.snapshot().requests.filter(request => request.pathname === ACCOUNT_PATHS.transfer)).toEqual([]);
  expect(api.snapshot().balances).toEqual({ FUNDING: '50', MAIN: '40', UMFUTURE: '10' });
  expect(errors).toEqual([]);
});

for (const changed of ['balance', 'position']) {
  test(`user stops account transfers when the authoritative ${changed} changes during confirmation`, async ({ page }) => {
    // Given a preview is open for an initially flat account with a known wallet snapshot.
    const { api, errors, action, status } = await openRebalance(page, { FUNDING: '100', MAIN: '0', UMFUTURE: '0' });
    await action.evaluate(button => button.click());
    const dialog = page.getByRole('dialog', { name: '账户再平衡' });
    await expect(dialog).toBeVisible();

    // When external account activity changes the snapshot before confirmation.
    if (changed === 'balance') api.setBalances({ FUNDING: '101', MAIN: '0', UMFUTURE: '0' });
    else api.setPositions([{ symbol: 'BTCUSDT', positionAmount: '1' }]);
    await dialog.getByRole('button', { name: '确认再平衡', exact: true }).click();

    // Then the fresh account response blocks every transfer with a specific explanation.
    await expect(status).toContainText(changed === 'balance' ? '账户余额已变化' : '全账户仍有持仓');
    expect(api.snapshot().requests.filter(request => request.pathname === ACCOUNT_PATHS.transfer)).toEqual([]);
    expect(api.snapshot().balances).toEqual({ FUNDING: changed === 'balance' ? '101' : '100', MAIN: '0', UMFUTURE: '0' });
    expect(errors).toEqual([]);
  });
}

for (const [endpoint, response, message] of [
  ['wallets', { status: 401, body: { success: false } }, 'Binance 登录态已失效'],
  ['wallets', { status: 503, body: { success: false } }, '钱包余额接口异常：HTTP 503'],
  ['wallets', { status: 200, body: { success: false, message: 'Wallet temporarily locked' } }, 'Wallet temporarily locked'],
  ['withdrawable', { status: 403, body: { success: false } }, 'U本位可划转余额接口异常：HTTP 403'],
  ['withdrawable', { status: 200, body: { success: false, message: 'Futures balance unavailable' } }, 'Futures balance unavailable'],
]) {
  test(`user sees the ${endpoint} rejection ${message} before any account transfer`, async ({ page }) => {
    // Given the account qualifies but its next authoritative balance response fails.
    const { api, errors, action, status } = await openRebalance(page, { FUNDING: '100', MAIN: '0', UMFUTURE: '0' });
    api.failNext(ACCOUNT_PATHS[endpoint], response);

    // When the user requests a fresh account plan.
    await action.evaluate(button => button.click());

    // Then the specific failure is shown without offering an unverified transfer plan.
    await expect(status).toContainText('账户再平衡失败');
    await expect(status).toContainText(message);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(api.snapshot().requests.filter(request => request.pathname === ACCOUNT_PATHS.transfer)).toEqual([]);
    expect(api.snapshot().balances).toEqual({ FUNDING: '100', MAIN: '0', UMFUTURE: '0' });
    expect(errors).toEqual([]);
  });
}

for (const [response, message] of [
  [{ status: 401, body: { success: false } }, 'Binance 登录态已失效'],
  [{ status: 403, body: { success: false } }, 'USDT 划转接口异常：HTTP 403'],
  [{ status: 200, body: { success: false, message: 'Transfer permission denied' } }, 'Transfer permission denied'],
  [{ status: 200, body: null }, 'USDT 划转失败'],
]) {
  test(`user stops after the first account transfer is rejected with ${message}`, async ({ page }) => {
    // Given the first transfer will be rejected after the user reviews a complete plan.
    const { api, errors, action, status } = await openRebalance(page, { FUNDING: '100', MAIN: '0', UMFUTURE: '0' });
    api.failNext(ACCOUNT_PATHS.transfer, response);
    await action.evaluate(button => button.click());
    const dialog = page.getByRole('dialog', { name: '账户再平衡' });
    await expect(dialog).toBeVisible();

    // When the user confirms the plan and the native endpoint returns its rejection.
    await dialog.getByRole('button', { name: '确认再平衡', exact: true }).click();

    // Then exactly the first request was sent and the remaining transfer is not attempted.
    await expect(status).toHaveText('账户再平衡失败 · ' + message);
    expect(api.snapshot().requests.filter(request => request.pathname === ACCOUNT_PATHS.transfer).map(request => request.body))
      .toEqual([{ asset: 'USDT', amount: '40', kindType: 'CARD_MAIN' }]);
    expect(api.snapshot().balances).toEqual({ FUNDING: '100', MAIN: '0', UMFUTURE: '0' });
    expect(errors).toEqual([]);
  });
}

test('user sees a partial account result when an acknowledged transfer never appears in the balances', async ({ page }) => {
  // Given the account acknowledges transfers but has not published their balance changes.
  const { api, errors, action, status } = await openRebalance(page,
    { FUNDING: '100', MAIN: '0', UMFUTURE: '0' }, { commitTransfers: false });
  await action.evaluate(button => button.click());
  const dialog = page.getByRole('dialog', { name: '账户再平衡' });
  await expect(dialog).toBeVisible();
  await pauseScenarioClock(page);

  // When the user confirms and the first balance observation still has the old values.
  await dialog.getByRole('button', { name: '确认再平衡', exact: true }).evaluate(button => button.click());
  await expect.poll(() => api.snapshot().requests.filter(request => request.pathname === ACCOUNT_PATHS.wallets).length).toBe(3);
  await page.clock.runFor(1);

  // Then the second transfer remains blocked while the first one awaits balance confirmation.
  expect(api.snapshot().pendingTransfers).toBe(1);
  expect(api.snapshot().requests.filter(request => request.pathname === ACCOUNT_PATHS.transfer)).toHaveLength(1);
  await expect(status).toHaveText('账户再平衡中 · 1/2 笔');

  // When the exact balance-confirmation deadline expires without a changed account snapshot.
  await page.clock.runFor(5000);

  // Then the visible result reports the acknowledged partial completion without sending the second transfer.
  await expect(status).toHaveText('账户再平衡部分完成 · 1/2 笔 · 划转后账户余额未及时更新');
  expect(api.snapshot().requests.filter(request => request.pathname === ACCOUNT_PATHS.transfer)).toHaveLength(1);
  expect(api.snapshot().balances).toEqual({ FUNDING: '100', MAIN: '0', UMFUTURE: '0' });
  expect(errors).toEqual([]);
});

test('user sees one completed account transfer when the next transfer fails after balance confirmation', async ({ page }) => {
  // Given balance publication is held independently of the first transfer acknowledgement.
  const { api, errors, action, status } = await openRebalance(page,
    { FUNDING: '100', MAIN: '0', UMFUTURE: '0' }, { commitTransfers: false });
  await action.evaluate(button => button.click());
  const dialog = page.getByRole('dialog', { name: '账户再平衡' });
  await expect(dialog).toBeVisible();
  await pauseScenarioClock(page);
  await dialog.getByRole('button', { name: '确认再平衡', exact: true }).evaluate(button => button.click());
  await expect.poll(() => api.snapshot().requests.filter(request => request.pathname === ACCOUNT_PATHS.wallets).length).toBe(3);
  await page.clock.runFor(1);

  // When the account publishes the first transfer and explicitly rejects the next request.
  api.failNext(ACCOUNT_PATHS.transfer, { status: 200, body: { success: false, message: 'Second transfer denied' } });
  api.commitPendingTransfers();
  await page.clock.runFor(1000);

  // Then the first exact balance change remains, two requests were attempted, and the partial count is one.
  await expect(status).toHaveText('账户再平衡部分完成 · 1/2 笔 · Second transfer denied');
  expect(api.snapshot().requests.filter(request => request.pathname === ACCOUNT_PATHS.transfer).map(request => request.body))
    .toEqual([
      { asset: 'USDT', amount: '40', kindType: 'CARD_MAIN' },
      { asset: 'USDT', amount: '10', kindType: 'CARD_FUTURE' },
    ]);
  expect(api.snapshot().balances).toEqual({ FUNDING: '60', MAIN: '40', UMFUTURE: '0' });
  expect(api.snapshot().pendingTransfers).toBe(0);
  expect(errors).toEqual([]);
});
