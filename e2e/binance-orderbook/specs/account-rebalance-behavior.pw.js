import { test, expect } from '../test.js';
import { ACCOUNT_PATHS, createAccountRebalanceApi } from '../fixtures/account-rebalance-api.js';
import { createCancelScenario } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario, readFixtureState } from '../helpers/userscript-page.js';
import { installScenarioClock, pauseScenarioClock } from '../helpers/scenario-clock.js';
import { installSimulatedVisibility, setSimulatedVisibility } from '../helpers/simulated-visibility.js';
import {
  REBALANCE_PERCENTS, REBALANCE_RATIO, REBALANCE_TARGET, REBALANCE_TOTAL, allIn, transferBody,
} from '../fixtures/usdt-allocation.js';

/** All USDT in Funding always plans one Spot and one Futures transfer for any valid allocation. */
const FUNDED = allIn('FUNDING');
const FUNDED_TRANSFERS = [
  transferBody(REBALANCE_TARGET.MAIN, 'CARD_MAIN'),
  transferBody(REBALANCE_TARGET.UMFUTURE, 'CARD_FUTURE'),
];
const FUNDED_AMOUNTS = FUNDED_TRANSFERS.map(transfer => transfer.amount + ' USDT');

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
  // Manual scenarios start after this empty episode has already been consumed.
  await page.evaluate(async () => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('fixture-account'));
    const accountKey = 'userscripts:automatic-usdt-rebalance:v1:'
      + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(accountKey, JSON.stringify({ version: 1, status: 'consumed' }));
  });
  await page.clock.runFor(2000);
  const action = page.locator('[data-usdt-rebalance]');
  await expect(action).toBeVisible();
  await expect(action).toBeEnabled();
  await expect(page.locator('#jh-binance-auto-rebalance-status')).toHaveText('本轮不再自动执行账户再平衡');
  return { api, errors, action, status: page.locator('#jh-binance-ladder-status') };
}

test('user completes exactly two USDT transfers only after confirming the complete account plan', async ({ page }) => {
  // Given a globally flat account holds all USDT in Funding and satisfies the stability window.
  const { api, errors, action, status } = await openRebalance(page, FUNDED);
  await expect(action).toHaveAttribute('title', `将资金、现货和 U 本位账户的 USDT 按 ${REBALANCE_RATIO} 分配`);

  // When the user opens the account plan.
  await action.evaluate(button => button.click());
  const dialog = page.getByRole('dialog', { name: '账户再平衡' });
  await expect(dialog).toBeVisible();

  // Then the preview names the configured allocation and both transfers while the account remains unchanged.
  await expect(dialog.locator('.jh-rebalance-dialog-summary')).toHaveText(
    `目标分配：资金 ${REBALANCE_PERCENTS.FUNDING}% / 现货 ${REBALANCE_PERCENTS.MAIN}% / U本位 ${REBALANCE_PERCENTS.UMFUTURE}%`,
  );
  await expect(dialog.locator('.jh-rebalance-dialog-transfer-amount')).toHaveText(FUNDED_AMOUNTS);
  expect(api.snapshot().requests.filter(request => request.pathname === ACCOUNT_PATHS.transfer)).toEqual([]);
  expect(api.snapshot().balances).toEqual(FUNDED);

  // When the user confirms the reviewed plan once.
  await dialog.getByRole('button', { name: '确认再平衡', exact: true }).click();

  // Then the two explicit native requests reach the configured target and ordinary trading is untouched.
  await expect(status).toHaveText('账户再平衡已完成 · 2/2 笔');
  expect(api.snapshot().requests.filter(request => request.pathname === ACCOUNT_PATHS.transfer).map(request => request.body))
    .toEqual(FUNDED_TRANSFERS);
  expect(api.snapshot().balances).toEqual(REBALANCE_TARGET);
  expect((await readFixtureState(page)).events.filter(({ type }) => /order-submitted|cancel-requested/.test(type))).toEqual([]);
  expect(errors).toEqual([]);
});

test('user completes a confirmed account rebalance after the tab becomes hidden', async ({ page }) => {
  // Given the user has reviewed a two-transfer plan while the trading page is visible.
  const { api, errors, action, status } = await openRebalance(page, FUNDED);
  await installSimulatedVisibility(page);
  await action.evaluate(button => button.click());
  const dialog = page.getByRole('dialog', { name: '账户再平衡' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.jh-rebalance-dialog-transfer-amount')).toHaveText(FUNDED_AMOUNTS);

  // When confirmation is clicked and the tab hides in the same event turn.
  await dialog.getByRole('button', { name: '确认再平衡', exact: true }).evaluate(button => {
    button.click();
    window.__SIMULATED_VISIBILITY__.setHidden(true);
  });

  // Then each transfer still requires fresh account checks and reaches the reviewed target.
  await expect.poll(() => api.snapshot().requests.filter(request => request.pathname === ACCOUNT_PATHS.transfer))
    .toHaveLength(2);
  await setSimulatedVisibility(page, false);
  await expect(status).toHaveText('账户再平衡已完成 · 2/2 笔');
  expect(api.snapshot().balances).toEqual(REBALANCE_TARGET);
  expect(errors).toEqual([]);
});

test('user cancels an account preview without sending a transfer', async ({ page }) => {
  // Given a flat account has a valid two-transfer rebalance plan.
  const { api, errors, action, status } = await openRebalance(page, FUNDED);
  await action.evaluate(button => button.click());
  const dialog = page.getByRole('dialog', { name: '账户再平衡' });
  await expect(dialog).toBeVisible();

  // When the user declines the preview.
  await dialog.getByRole('button', { name: '取消', exact: true }).evaluate(button => button.click());

  // Then both the user-visible result and the native account retain the cancelled decision.
  await expect(status).toHaveText('账户再平衡已取消');
  expect(api.snapshot().requests.filter(request => request.pathname === ACCOUNT_PATHS.transfer)).toEqual([]);
  expect(api.snapshot().balances).toEqual(FUNDED);
  expect(errors).toEqual([]);
});

test('user sees a translated manual rebalance refusal after account identity changes', async ({ page }) => {
  // Given the user previews a valid allocation under the original account identity.
  const { api, errors, action, status } = await openRebalance(page, FUNDED);
  await action.evaluate(button => button.click());
  const dialog = page.getByRole('dialog', { name: '账户再平衡' });
  await expect(dialog).toBeVisible();
  api.setIdentity({ userId: 'changed-fixture-account', isExistFutureAccount: true, isPortfolioMarginRetailUser: false });

  // When the user confirms after switching accounts outside the script.
  await dialog.getByRole('button', { name: '确认再平衡', exact: true }).click();

  // Then both the refusal body and tooltip explain the changed account in Chinese.
  await expect(status).toHaveText('账户再平衡失败 · 确认后账户身份已变化');
  await expect(status).toHaveAttribute('title', '确认后账户身份已变化');
  expect(api.snapshot().requests.filter(request => request.pathname === ACCOUNT_PATHS.transfer)).toEqual([]);

  // When the same refused operation is retained on an English route.
  await page.evaluate(() => {
    history.pushState({}, '', location.pathname.replace('/zh-CN/', '/en/'));
    window.__TM_CLOSE_LONG_DEBUG__.renderPanel();
  });

  // Then the body and tooltip translate without repeating the confirmation or transfer.
  await expect(status).toHaveText('Account rebalance failed · Account identity changed after confirmation');
  await expect(status).toHaveAttribute('title', 'Account identity changed after confirmation');
  expect(api.snapshot().requests.filter(request => request.pathname === ACCOUNT_PATHS.transfer)).toEqual([]);
  expect(errors).toEqual([]);
});

test('user with already balanced wallets receives a no-transfer result', async ({ page }) => {
  // Given a globally flat account already holds the exact configured allocation.
  const { api, errors, action, status } = await openRebalance(page, REBALANCE_TARGET);

  // When the user requests an account rebalance.
  await action.evaluate(button => button.click());

  // Then no confirmation or transfer is needed and the result states the configured ratio.
  await expect(status).toHaveText(`USDT 已按 ${REBALANCE_RATIO} 分配`);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(api.snapshot().requests.filter(request => request.pathname === ACCOUNT_PATHS.transfer)).toEqual([]);
  expect(api.snapshot().balances).toEqual(REBALANCE_TARGET);

  // When the same page switches to its English route.
  await page.evaluate(() => {
    history.pushState({}, '', location.pathname.replace('/zh-CN/', '/en/'));
    window.__TM_CLOSE_LONG_DEBUG__.renderPanel();
  });

  // Then the retained result and the action tooltip name the same ratio in English.
  await expect(status).toHaveText(`USDT is already allocated at ${REBALANCE_RATIO}`);
  await expect(page.locator('[data-usdt-rebalance]')).toHaveAttribute('title',
    `Allocate USDT across Funding, Spot, and USDⓈ-M Futures accounts at a ${REBALANCE_RATIO} ratio`);
  expect(api.snapshot().requests.filter(request => request.pathname === ACCOUNT_PATHS.transfer)).toEqual([]);
  expect(errors).toEqual([]);
});

for (const changed of ['balance', 'position']) {
  test(`user stops account transfers when the authoritative ${changed} changes during confirmation`, async ({ page }) => {
    // Given a preview is open for an initially flat account with a known wallet snapshot.
    const { api, errors, action, status } = await openRebalance(page, FUNDED);
    await action.evaluate(button => button.click());
    const dialog = page.getByRole('dialog', { name: '账户再平衡' });
    await expect(dialog).toBeVisible();

    // When external account activity changes the snapshot before confirmation.
    if (changed === 'balance') api.setBalances({ ...FUNDED, FUNDING: String(REBALANCE_TOTAL + 1) });
    else api.setPositions([{ symbol: 'BTCUSDT', positionAmount: '1' }]);
    await dialog.getByRole('button', { name: '确认再平衡', exact: true }).click();

    // Then the fresh account response blocks every transfer with a specific explanation.
    await expect(status).toContainText(changed === 'balance' ? '账户余额已变化' : '全账户仍有持仓');
    expect(api.snapshot().requests.filter(request => request.pathname === ACCOUNT_PATHS.transfer)).toEqual([]);
    expect(api.snapshot().balances).toEqual(changed === 'balance' ? { ...FUNDED, FUNDING: String(REBALANCE_TOTAL + 1) } : FUNDED);
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
    const { api, errors, action, status } = await openRebalance(page, FUNDED);
    api.failNext(ACCOUNT_PATHS[endpoint], response);

    // When the user requests a fresh account plan.
    await action.evaluate(button => button.click());

    // Then the specific failure is shown without offering an unverified transfer plan.
    await expect(status).toContainText('账户再平衡失败');
    await expect(status).toContainText(message);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(api.snapshot().requests.filter(request => request.pathname === ACCOUNT_PATHS.transfer)).toEqual([]);
    expect(api.snapshot().balances).toEqual(FUNDED);
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
    const { api, errors, action, status } = await openRebalance(page, FUNDED);
    api.failNext(ACCOUNT_PATHS.transfer, response);
    await action.evaluate(button => button.click());
    const dialog = page.getByRole('dialog', { name: '账户再平衡' });
    await expect(dialog).toBeVisible();

    // When the user confirms the plan and the native endpoint returns its rejection.
    await dialog.getByRole('button', { name: '确认再平衡', exact: true }).click();

    // Then exactly the first request was sent and the remaining transfer is not attempted.
    await expect(status).toHaveText('账户再平衡失败 · ' + message);
    expect(api.snapshot().requests.filter(request => request.pathname === ACCOUNT_PATHS.transfer).map(request => request.body))
      .toEqual([FUNDED_TRANSFERS[0]]);
    expect(api.snapshot().balances).toEqual(FUNDED);
    expect(errors).toEqual([]);
  });
}

test('user sees a partial account result when an acknowledged transfer never appears in the balances', async ({ page }) => {
  // Given the account acknowledges transfers but has not published their balance changes.
  const { api, errors, action, status } = await openRebalance(page,
    FUNDED, { commitTransfers: false });
  await action.evaluate(button => button.click());
  const dialog = page.getByRole('dialog', { name: '账户再平衡' });
  await expect(dialog).toBeVisible();
  await pauseScenarioClock(page);
  const walletReadsBeforeConfirmation = api.snapshot().requests.filter(request => request.pathname === ACCOUNT_PATHS.wallets).length;

  // When the user confirms and the first balance observation still has the old values.
  await dialog.getByRole('button', { name: '确认再平衡', exact: true }).evaluate(button => button.click());
  await expect.poll(() => api.snapshot().requests.filter(request => request.pathname === ACCOUNT_PATHS.wallets).length).toBe(walletReadsBeforeConfirmation + 2);
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
  expect(api.snapshot().balances).toEqual(FUNDED);
  expect(errors).toEqual([]);
});

test('user sees one completed account transfer when the next transfer fails after balance confirmation', async ({ page }) => {
  // Given balance publication is held independently of the first transfer acknowledgement.
  const { api, errors, action, status } = await openRebalance(page,
    FUNDED, { commitTransfers: false });
  await action.evaluate(button => button.click());
  const dialog = page.getByRole('dialog', { name: '账户再平衡' });
  await expect(dialog).toBeVisible();
  await pauseScenarioClock(page);
  const walletReadsBeforeConfirmation = api.snapshot().requests.filter(request => request.pathname === ACCOUNT_PATHS.wallets).length;
  await dialog.getByRole('button', { name: '确认再平衡', exact: true }).evaluate(button => button.click());
  await expect.poll(() => api.snapshot().requests.filter(request => request.pathname === ACCOUNT_PATHS.wallets).length).toBe(walletReadsBeforeConfirmation + 2);
  await page.clock.runFor(1);

  // When the account publishes the first transfer and explicitly rejects the next request.
  api.failNext(ACCOUNT_PATHS.transfer, { status: 200, body: { success: false, message: 'Second transfer denied' } });
  api.commitPendingTransfers();
  await page.clock.runFor(1000);

  // Then the first exact balance change remains, two requests were attempted, and the partial count is one.
  await expect(status).toHaveText('账户再平衡部分完成 · 1/2 笔 · Second transfer denied');
  expect(api.snapshot().requests.filter(request => request.pathname === ACCOUNT_PATHS.transfer).map(request => request.body))
    .toEqual(FUNDED_TRANSFERS);
  expect(api.snapshot().balances).toEqual({
    FUNDING: String(REBALANCE_TOTAL - Number(REBALANCE_TARGET.MAIN)), MAIN: REBALANCE_TARGET.MAIN, UMFUTURE: '0',
  });
  expect(api.snapshot().pendingTransfers).toBe(0);
  expect(errors).toEqual([]);
});
