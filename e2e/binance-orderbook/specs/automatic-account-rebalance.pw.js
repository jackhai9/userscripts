import { test, expect, reloadPageWithCoverage } from '../test.js';
import { ACCOUNT_PATHS, createAccountRebalanceApi } from '../fixtures/account-rebalance-api.js';
import { createCancelScenario, CURRENT_SYMBOL, ORDER_SETS } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario, readFixtureState } from '../helpers/userscript-page.js';
import { installScenarioClock, pauseScenarioClock } from '../helpers/scenario-clock.js';

const PREFIX = 'userscripts:automatic-usdt-rebalance:v1:';
const EXCESS = { FUNDING: '0', MAIN: '0', UMFUTURE: '100' };
const TARGET = { FUNDING: '50', MAIN: '40', UMFUTURE: '10' };
const transfers = api => api.snapshot().requests.filter(r => r.pathname === ACCOUNT_PATHS.transfer);

async function episodeRecords(page) {
  return page.evaluate(prefix => Object.keys(localStorage).filter(k => k.startsWith(prefix))
    .map(k => JSON.parse(localStorage.getItem(k))), PREFIX);
}

async function episodes(page) {
  return (await episodeRecords(page)).map(record => record.status);
}

async function openAutomatic(page, api) {
  await installScenarioClock(page);
  const loaded = await openUserscriptScenario(page, createCancelScenario({ orders: ORDER_SETS.current }));
  await pauseScenarioClock(page);
  await page.route('https://www.binance.com/bapi/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!api.supports(url.pathname)) return route.fallback();
    expect(url.search).toBe(url.pathname === ACCOUNT_PATHS.wallets
      ? '?needBalanceDetail=true&quoteAsset=USDT' : '');
    const response = api.handle({ pathname: url.pathname, method: request.method(),
      body: request.postData() === null ? undefined : request.postDataJSON() });
    await route.fulfill({ status: response.status, contentType: 'application/json', body: JSON.stringify(response.body) });
  });
  return loaded;
}

async function becomeFlat(page) {
  await page.evaluate(() => window.__BINANCE_FIXTURE__.setOrders([]));
  await page.clock.runFor(32);
  await page.clock.runFor(2000);
}

async function switchLocale(page, locale) {
  await page.evaluate(({ locale, symbol }) => {
    history.pushState({}, '', `/${locale}/futures/${symbol}`);
    window.__TM_CLOSE_LONG_DEBUG__.renderPanel();
  }, { locale, symbol: CURRENT_SYMBOL });
}

async function expectAutomaticStatus(page, text, title = text) {
  const status = page.locator('#jh-binance-auto-rebalance-status');
  await expect(status).toHaveText(text);
  await expect(status).toHaveAttribute('title', title);
}

test('user sees a localized account lock refusal without starting an order', async ({ page }) => {
  // Given another account operation holds the browser lock while orders prevent rebalancing.
  const api = createAccountRebalanceApi(EXCESS);
  await openAutomatic(page, api);
  await page.evaluate(() => new Promise(resolve => {
    navigator.locks.request('userscripts:usdt-account-operation:v1', () => new Promise(release => {
      window.__RELEASE_TRANSFER_LOCK__ = release;
      resolve();
    }));
  }));
  try {
    // When the user requests a ladder while that account operation is still pending.
    await page.getByRole('button', { name: '阶梯开多', exact: true }).click();

    // Then the refusal is Chinese and neither a trade nor transfer starts.
    const status = page.locator('#jh-binance-ladder-status');
    await expect(status).toHaveText('账户操作已阻止：其他标签页正在划转资金');
    await expect(status).toHaveAttribute('title', '账户操作已阻止：其他标签页正在划转资金');
    expect(transfers(api)).toEqual([]);
    expect((await readFixtureState(page)).events.filter(e => /order-submitted|cancel-requested/.test(e.type))).toEqual([]);

    // When the same refusal is retained through an English SPA route change.
    await switchLocale(page, 'en');

    // Then both text and tooltip translate without retrying the blocked operation.
    await expect(status).toHaveText('Account operation blocked: another tab is transferring funds');
    await expect(status).toHaveAttribute('title', 'Account operation blocked: another tab is transferring funds');
    expect(transfers(api)).toEqual([]);
    expect((await readFixtureState(page)).events.filter(e => /order-submitted|cancel-requested/.test(e.type))).toEqual([]);
  } finally {
    await page.evaluate(() => window.__RELEASE_TRANSFER_LOCK__());
  }
});

test('user sees automatic rebalance status through SPA locale changes without repeating transfers', async ({ page }) => {
  // Given a Chinese account page with an external transfer response held pending.
  const api = createAccountRebalanceApi(EXCESS);
  const { errors } = await openAutomatic(page, api);
  let releaseTransfer;
  const transferResponse = new Promise(resolve => { releaseTransfer = resolve; });
  await page.route('https://www.binance.com' + ACCOUNT_PATHS.transfer, async route => {
    await transferResponse;
    await route.fallback();
  });

  try {
    // When the account first becomes empty before its qualification deadline.
    await page.evaluate(() => window.__BINANCE_FIXTURE__.setOrders([]));
    await page.clock.runFor(32);

    // Then the waiting status and tooltip use Chinese and no transfer has started.
    await expectAutomaticStatus(page, '自动再平衡：等待账户持续无持仓、无挂单');
    expect(transfers(api)).toEqual([]);

    // When the empty account qualifies and its first transfer waits for the response.
    await page.clock.runFor(2000);

    // Then the progress text and tooltip use the Chinese page language.
    await expectAutomaticStatus(page, '自动再平衡中 · 1/2 笔');
    expect(await episodes(page)).toEqual(['in_flight']);

    // When the same SPA page switches to English during the pending transfer.
    await switchLocale(page, 'en');

    // Then the rebuilt panel translates the retained progress and tooltip.
    await expectAutomaticStatus(page, 'Automatic USDT transfer 1/2');

    // When the same pending operation returns to the Chinese route.
    await switchLocale(page, 'zh-CN');

    // Then the retained progress returns to Chinese without a duplicate request.
    await expectAutomaticStatus(page, '自动再平衡中 · 1/2 笔');
    expect(transfers(api)).toEqual([]);

    // When the external response is released and the automatic plan completes.
    releaseTransfer();

    // Then both planned withdrawals complete once and retain a Chinese result.
    await expect.poll(() => api.snapshot().balances).toEqual(TARGET);
    await expectAutomaticStatus(page, '已自动进行账户再平衡');
    expect(transfers(api)).toHaveLength(2);
    expect(await episodes(page)).toEqual(['consumed']);

    // When the completed account page switches to English without reloading.
    await switchLocale(page, 'en');

    // Then the completed result and tooltip translate while the episode stays consumed.
    await expectAutomaticStatus(page, 'Account automatically rebalanced');
    expect(transfers(api)).toHaveLength(2);
    expect(await episodes(page)).toEqual(['consumed']);

    // When the completed account returns to Chinese and its watchdog advances.
    await switchLocale(page, 'zh-CN');
    await page.clock.runFor(5000);

    // Then the result returns to Chinese and no repeated allocation occurs.
    await expectAutomaticStatus(page, '已自动进行账户再平衡');
    expect(transfers(api)).toHaveLength(2);
    expect(api.snapshot().balances).toEqual(TARGET);
    expect(await episodes(page)).toEqual(['consumed']);
    expect(errors).toEqual([]);
  } finally {
    releaseTransfer();
  }
});

for (const diagnostic of [
  { name: 'unknown raw', zh: 'Fixture transfer refusal <unrecognized>', en: 'Fixture transfer refusal <unrecognized>' },
  { name: 'known localized', zh: '账户余额已变化，已停止账户再平衡', en: 'Account balances changed; account rebalance stopped' },
]) {
  test(`user retains ${diagnostic.name} diagnostics when automatic rebalance failure changes locale`, async ({ page }) => {
    // Given the external transfer endpoint refuses with a concrete diagnostic.
    const api = createAccountRebalanceApi(EXCESS);
    api.failNext(ACCOUNT_PATHS.transfer, { status: 200, body: { success: false, message: diagnostic.zh } });
    await openAutomatic(page, api);

    // When the automatic workflow attempts its first withdrawal.
    await becomeFlat(page);

    // Then the Chinese failure prefix preserves the diagnostic in text and tooltip.
    await expectAutomaticStatus(page, `自动再平衡已停止：${diagnostic.zh}`, diagnostic.zh);
    expect(transfers(api)).toHaveLength(1);
    expect(api.snapshot().balances).toEqual(EXCESS);
    expect(await episodes(page)).toEqual(['in_flight']);

    // When the failed account page switches to English without another transfer attempt.
    await switchLocale(page, 'en');

    // Then only known diagnostics translate and unknown details remain byte-for-byte intact.
    await expectAutomaticStatus(page, `Automatic USDT transfer stopped: ${diagnostic.en}`, diagnostic.en);
    expect(transfers(api)).toHaveLength(1);

    // When the same failed operation returns to the Chinese route.
    await switchLocale(page, 'zh-CN');

    // Then the original Chinese status returns without clearing the unresolved episode.
    await expectAutomaticStatus(page, `自动再平衡已停止：${diagnostic.zh}`, diagnostic.zh);
    expect(transfers(api)).toHaveLength(1);
    expect(await episodes(page)).toEqual(['in_flight']);
  });
}

test('user automatically withdraws excess once after a stable empty account without a confirmation dialog', async ({ page }) => {
  // Given all funds are in Futures while a native order blocks qualification.
  const api = createAccountRebalanceApi(EXCESS);
  const { errors } = await openAutomatic(page, api);

  // When the account becomes flat and stays empty for the qualification window.
  await becomeFlat(page);

  // Then only Futures withdrawals occur and the episode is durably consumed.
  await expect.poll(() => api.snapshot().balances).toEqual(TARGET);
  await expect.poll(() => episodes(page)).toEqual(['consumed']);
  expect(transfers(api).map(r => r.body)).toEqual([
    { asset: 'USDT', amount: '50', kindType: 'FUTURE_CARD' },
    { asset: 'USDT', amount: '40', kindType: 'FUTURE_MAIN' },
  ]);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await readFixtureState(page)).events.filter(e => /order-submitted|cancel-requested/.test(e.type))).toEqual([]);
  expect(errors).toEqual([]);

  // When the user reloads after every planned transfer and balance has been confirmed.
  await reloadPageWithCoverage(page);
  await becomeFlat(page);

  // Then the completed result survives without repeating a transfer.
  await expectAutomaticStatus(page, '已自动进行账户再平衡');
  expect(await episodeRecords(page)).toEqual([
    { version: 1, status: 'consumed', outcome: 'automatic_completed' },
  ]);
  expect(transfers(api)).toHaveLength(2);
  expect(api.snapshot().balances).toEqual(TARGET);
});

test('user keeps reserves after a loss and does not repeat an empty episode after reload', async ({ page }) => {
  // Given Futures is below its allocation and reserves remain untouched.
  const below = { FUNDING: '50', MAIN: '40', UMFUTURE: '0' };
  const api = createAccountRebalanceApi(below);
  await openAutomatic(page, api);

  // When automatic qualification completes without any excess to transfer.
  await becomeFlat(page);

  // Then no reserve funds are moved and the zero-transfer episode is consumed.
  await expect.poll(() => episodes(page)).toEqual(['consumed']);
  await expectAutomaticStatus(page, '自动再平衡：合约账户无多余 USDT');
  expect(transfers(api)).toEqual([]);
  expect(api.snapshot().balances).toEqual(below);

  // When a manual deposit changes balances and the user reloads the same empty episode.
  api.setBalances(EXCESS);
  await reloadPageWithCoverage(page);
  await becomeFlat(page);
  await expect(page.locator('[data-usdt-rebalance]')).toBeEnabled();

  // Then reloading never creates a second automatic execution entitlement.
  await expectAutomaticStatus(page, '本轮不再自动执行账户再平衡');
  expect(await episodes(page)).toEqual(['consumed']);
  expect(transfers(api)).toEqual([]);

  // When the retained no-transfer episode is displayed in English.
  await switchLocale(page, 'en');

  // Then the message describes the episode without claiming a completed transfer or current balance.
  await expectAutomaticStatus(page, 'No further automatic rebalance in this round');
  expect(await episodeRecords(page)).toEqual([{ version: 1, status: 'consumed' }]);
  expect(api.snapshot().balances).toEqual(EXCESS);
  expect(transfers(api)).toEqual([]);
});

test('user does not see a completed transfer inferred from an older episode record', async ({ page }) => {
  // Given an earlier script stored a consumed episode without a financial outcome.
  const api = createAccountRebalanceApi(EXCESS);
  await openAutomatic(page, api);
  await page.evaluate(async prefix => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('fixture-account'));
    const accountKey = prefix + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(accountKey, JSON.stringify({ version: 1, status: 'consumed' }));
  }, PREFIX);

  // When the current script observes the same empty episode.
  await becomeFlat(page);

  // Then the old record remains protected without claiming success or moving funds.
  await expectAutomaticStatus(page, '本轮不再自动执行账户再平衡');
  expect(await episodeRecords(page)).toEqual([{ version: 1, status: 'consumed' }]);
  expect(transfers(api)).toEqual([]);
  expect(api.snapshot().balances).toEqual(EXCESS);
});

test('user sees a localized refusal for an invalid persisted completion outcome', async ({ page }) => {
  // Given a stored completion marker conflicts with its in-flight protection.
  const api = createAccountRebalanceApi(EXCESS);
  await openAutomatic(page, api);
  await page.evaluate(async prefix => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('fixture-account'));
    const accountKey = prefix + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(accountKey, JSON.stringify({ version: 1, status: 'in_flight', outcome: 'automatic_completed' }));
  }, PREFIX);

  // When the script reads the conflicting record on the Chinese route.
  await becomeFlat(page);

  // Then the refusal explains the invalid result without moving funds or resetting the record.
  await expectAutomaticStatus(page, '自动再平衡已停止：自动再平衡结果记录无效', '自动再平衡结果记录无效');
  expect(await episodeRecords(page)).toEqual([
    { version: 1, status: 'in_flight', outcome: 'automatic_completed' },
  ]);
  expect(transfers(api)).toEqual([]);

  // When the same refusal is retained on the English route.
  await switchLocale(page, 'en');

  // Then both its text and tooltip translate without retrying the refused action.
  await expectAutomaticStatus(page, 'Automatic USDT transfer stopped: Invalid automatic rebalance episode outcome', 'Invalid automatic rebalance episode outcome');
  expect(transfers(api)).toEqual([]);
});

test('user does not see a manual rebalance reported as an automatic completion after reload', async ({ page }) => {
  // Given automatic qualification left the reserves alone and the user reviewed a manual plan.
  const api = createAccountRebalanceApi({ FUNDING: '100', MAIN: '0', UMFUTURE: '0' });
  await openAutomatic(page, api);
  await becomeFlat(page);
  await expectAutomaticStatus(page, '自动再平衡：合约账户无多余 USDT');
  await page.clock.runFor(32);
  await expect(page.locator('[data-usdt-rebalance]')).toBeVisible();
  await page.locator('[data-usdt-rebalance]').click();
  const dialog = page.getByRole('dialog', { name: '账户再平衡' });
  await expect(dialog).toBeVisible();

  // When the user confirms the complete manual allocation.
  await dialog.getByRole('button', { name: '确认再平衡', exact: true }).click();

  // Then the manual result reaches its target without an automatic completion marker.
  await expect(page.locator('#jh-binance-ladder-status')).toHaveText('账户再平衡已完成 · 2/2 笔');
  expect(await episodeRecords(page)).toEqual([{ version: 1, status: 'consumed' }]);
  expect(api.snapshot().balances).toEqual(TARGET);
  expect(transfers(api)).toHaveLength(2);

  // When the user reloads the same account episode.
  await reloadPageWithCoverage(page);
  await becomeFlat(page);

  // Then no automatic completion or duplicate transfer is reported.
  await expectAutomaticStatus(page, '本轮不再自动执行账户再平衡');
  expect(transfers(api)).toHaveLength(2);
});

test('user sees automatic completion only after the final transferred balance is confirmed', async ({ page }) => {
  // Given the only planned transfer will be acknowledged before its balance is published.
  const before = { FUNDING: '50', MAIN: '30', UMFUTURE: '20' };
  const api = createAccountRebalanceApi(before, { commitTransfers: false });
  await openAutomatic(page, api);

  // When the server accepts the transfer while its wallet still has the old balance.
  await becomeFlat(page);
  await expect.poll(() => api.snapshot().pendingTransfers).toBe(1);
  await expect.poll(() => api.snapshot().requests.filter(r => r.pathname === ACCOUNT_PATHS.wallets).length).toBe(3);

  // Then the result remains pending and cannot carry a completed marker.
  await expectAutomaticStatus(page, '自动再平衡中 · 1/1 笔');
  expect(await episodeRecords(page)).toEqual([{ version: 1, status: 'in_flight' }]);
  expect(api.snapshot().balances).toEqual(before);

  // When the authoritative balance publishes the accepted transfer.
  api.commitPendingTransfers();
  await page.clock.runFor(1000);

  // Then the complete result is shown and persisted only after the balance matches.
  await expectAutomaticStatus(page, '已自动进行账户再平衡');
  expect(await episodeRecords(page)).toEqual([
    { version: 1, status: 'consumed', outcome: 'automatic_completed' },
  ]);
  expect(api.snapshot().balances).toEqual(TARGET);
  expect(transfers(api)).toHaveLength(1);
});

test('user does not see partial automatic transfers reported as completed after reload', async ({ page }) => {
  // Given the next account check will fail after the first transfer has committed.
  const api = createAccountRebalanceApi(EXCESS);
  await openAutomatic(page, api);
  await page.route('https://www.binance.com' + ACCOUNT_PATHS.transfer, async route => {
    const response = api.handle({ pathname: ACCOUNT_PATHS.transfer, method: 'POST', body: route.request().postDataJSON() });
    api.failNext(ACCOUNT_PATHS.identity, { status: 401, body: { success: false } });
    await route.fulfill({ status: response.status, contentType: 'application/json', body: JSON.stringify(response.body) });
  });

  // When the automatic plan stops between the first and second transfer.
  await becomeFlat(page);

  // Then a confirmed partial transfer does not claim the whole plan completed.
  await expectAutomaticStatus(page, '自动再平衡已停止：Binance 登录态已失效', 'Binance 登录态已失效');
  expect(api.snapshot().balances).toEqual({ FUNDING: '50', MAIN: '0', UMFUTURE: '50' });
  expect(await episodeRecords(page)).toEqual([{ version: 1, status: 'consumed' }]);
  expect(transfers(api)).toHaveLength(1);

  // When the user reloads the partially processed episode.
  await reloadPageWithCoverage(page);
  await becomeFlat(page);

  // Then the result remains non-successful and the remaining transfer is not retried.
  await expectAutomaticStatus(page, '本轮不再自动执行账户再平衡');
  expect(transfers(api)).toHaveLength(1);
  expect(api.snapshot().balances).toEqual({ FUNDING: '50', MAIN: '0', UMFUTURE: '50' });
});

for (const kind of ['basic', 'conditional']) {
  test(`user keeps funds when an authoritative other-symbol ${kind} order is missing from native counters`, async ({ page }) => {
    // Given an API order exists even though the visible counters will show zero.
    const api = createAccountRebalanceApi(EXCESS);
    api.setOrders({ basic: [], conditional: [], [kind]: [{ symbol: 'BTCUSDT' }] });
    await openAutomatic(page, api);

    // When native counters qualify but fresh all-symbol order reads disagree.
    await becomeFlat(page);

    // Then the server-side order prevents every transfer.
    await expect.poll(() => api.snapshot().requests.filter(r => r.pathname === ACCOUNT_PATHS.conditionalOrders).length).toBeGreaterThan(0);
    await expect(page.locator('[data-usdt-rebalance]')).toBeEnabled();
    expect(transfers(api)).toEqual([]);
    expect(api.snapshot().balances).toEqual(EXCESS);
  });
}

test('user receives one automatic allocation across two simultaneous currency tabs', async ({ page, context }) => {
  // Given two pages share one browser storage partition and one account.
  const api = createAccountRebalanceApi(EXCESS);
  await openAutomatic(page, api);
  await page.clock.resume();
  const second = await context.newPage();
  await openAutomatic(second, api);

  // When both pages qualify for the same empty account at the same time.
  await Promise.all([page, second].map(tab => tab.evaluate(() => window.__BINANCE_FIXTURE__.setOrders([]))));
  await page.clock.runFor(2032);
  await second.clock.runFor(2032);

  // Then shared locking and durable state permit only the two planned transfers.
  await expect.poll(() => api.snapshot().balances).toEqual(TARGET);
  await expect.poll(() => episodes(page)).toEqual(['consumed']);
  expect(transfers(api)).toHaveLength(2);
  expect(await episodes(second)).toEqual(['consumed']);
  await expectAutomaticStatus(page, '已自动进行账户再平衡');
  await expectAutomaticStatus(second, '已自动进行账户再平衡');
});

test('user qualifies again only after independently verified new account activity', async ({ page }) => {
  // Given the first automatic episode has completed.
  const api = createAccountRebalanceApi(EXCESS);
  await openAutomatic(page, api);
  await becomeFlat(page);
  await expect.poll(() => episodes(page)).toEqual(['consumed']);

  // When a new server-side order is observed before its later removal.
  api.setOrders({ basic: [{ symbol: 'BTCUSDT' }], conditional: [] });
  await page.evaluate(orders => window.__BINANCE_FIXTURE__.setOrders(orders), ORDER_SETS.other);
  await page.clock.runFor(32);
  await expect.poll(() => episodes(page)).toEqual(['active']);
  expect(await episodeRecords(page)).toEqual([{ version: 1, status: 'active' }]);
  api.setOrders({ basic: [], conditional: [] });
  api.setBalances(EXCESS);
  await becomeFlat(page);

  // Then this distinct empty episode performs its own single allocation.
  await expect.poll(() => transfers(api).length).toBe(4);
  await expect.poll(() => episodes(page)).toEqual(['consumed']);
  expect(api.snapshot().balances).toEqual(TARGET);
});

test('user never repeats a transfer with an unknown response after reloading', async ({ page }) => {
  // Given the server commits a transfer but its response is lost.
  const api = createAccountRebalanceApi(EXCESS);
  await openAutomatic(page, api);
  let interrupted = false;
  await page.route('https://www.binance.com' + ACCOUNT_PATHS.transfer, async route => {
    if (interrupted) return route.fallback();
    interrupted = true;
    api.handle({ pathname: ACCOUNT_PATHS.transfer, method: 'POST', body: route.request().postDataJSON() });
    await route.abort('failed');
  });

  // When the first transfer response fails after the server has moved funds.
  await becomeFlat(page);

  // Then the pending record survives and no second transfer is attempted.
  await expect.poll(() => episodes(page)).toEqual(['in_flight']);
  await expect(page.locator('[data-usdt-rebalance]')).toBeEnabled();
  expect(transfers(api)).toHaveLength(1);
  expect(api.snapshot().balances).toEqual({ FUNDING: '50', MAIN: '0', UMFUTURE: '50' });

  // When the user reloads the page with the unresolved operation.
  await reloadPageWithCoverage(page);
  await becomeFlat(page);
  await expectAutomaticStatus(page, '自动再平衡已阻止：请先核实上次划转结果');

  // Then no automatic retry can duplicate the unknown transaction.
  expect(transfers(api)).toHaveLength(1);
  expect(await episodes(page)).toEqual(['in_flight']);
});

test('user keeps funds when the account identity indicates portfolio margin', async ({ page }) => {
  // Given this account does not satisfy the ordinary Futures mode contract.
  const api = createAccountRebalanceApi(EXCESS);
  api.setIdentity({ userId: 'portfolio-fixture', isExistFutureAccount: true, isPortfolioMarginRetailUser: true });
  await openAutomatic(page, api);

  // When the visible account becomes flat.
  await becomeFlat(page);

  // Then the unverified account mode is refused before any wallet transfer.
  await expectAutomaticStatus(page, '自动再平衡已停止：账户身份或模式不受支持或尚未核实', '账户身份或模式不受支持或尚未核实');
  expect(transfers(api)).toEqual([]);
  expect(await episodes(page)).toEqual([]);
});

test('user completes automatic allocation after another account observer releases its shared lock', async ({ page }) => {
  // Given an independent observer owns the same real browser shared lock.
  const api = createAccountRebalanceApi(EXCESS);
  await openAutomatic(page, api);
  await page.evaluate(() => new Promise(resolve => {
    navigator.locks.request('userscripts:usdt-account-operation:v1', { mode: 'shared' }, () => new Promise(release => {
      window.__RELEASE_ACCOUNT_OBSERVER__ = release;
      resolve();
    }));
  }));

  // When the flat qualification window expires while that observer is still running.
  await becomeFlat(page);
  await expect.poll(() => page.evaluate(async () => (await navigator.locks.query()).pending
    .filter(lock => lock.name === 'userscripts:usdt-account-operation:v1').length)).toBe(1);

  // Then no transfer starts before exclusive ownership is available.
  expect(transfers(api)).toEqual([]);

  // When the observer releases its lock without another counter change.
  await page.evaluate(() => window.__RELEASE_ACCOUNT_OBSERVER__());

  // Then the waiting operation reacquires fresh evidence and completes exactly once.
  await expect.poll(() => api.snapshot().balances).toEqual(TARGET);
  await expect.poll(() => episodes(page)).toEqual(['consumed']);
  expect(transfers(api)).toHaveLength(2);
});

test('user cannot auto-transfer from a copy-trading query route', async ({ page }) => {
  // Given a regular account page switches to the native copy-trading query mode.
  const api = createAccountRebalanceApi(EXCESS);
  await openAutomatic(page, api);
  await page.evaluate(() => history.replaceState(null, '', location.pathname + '?cl=public'));

  // When its native account counters become empty.
  await becomeFlat(page);

  // Then the unverified route is refused before any transfer.
  await expectAutomaticStatus(page, '自动再平衡已停止：自动划转仅支持普通 U 本位合约账户', '自动划转仅支持普通 U 本位合约账户');
  expect(transfers(api)).toEqual([]);
  expect(api.snapshot().balances).toEqual(EXCESS);
});

test('user sees a paused automatic check when new orders invalidate a pending transfer lock', async ({ page }) => {
  // Given another operation owns the lock while this flat account waits for access.
  const api = createAccountRebalanceApi(EXCESS);
  await openAutomatic(page, api);
  await page.evaluate(() => new Promise(resolve => {
    navigator.locks.request('userscripts:usdt-account-operation:v1', () => new Promise(release => {
      window.__RELEASE_TRANSFER_LOCK__ = release;
      resolve();
    }));
  }));
  await becomeFlat(page);
  await expectAutomaticStatus(page, '自动再平衡：等待账户操作完成');

  // When a new native order invalidates the pending flat qualification.
  await page.evaluate(orders => window.__BINANCE_FIXTURE__.setOrders(orders), ORDER_SETS.current);
  await page.clock.runFor(32);
  await page.evaluate(() => window.__RELEASE_TRANSFER_LOCK__());

  // Then the obsolete request is cancelled and the visible waiting state ends.
  await expectAutomaticStatus(page, '自动再平衡已暂停：执行条件已变化');
  await expect.poll(() => page.evaluate(async () => (await navigator.locks.query()).pending.length)).toBe(0);
  expect(transfers(api)).toEqual([]);
  expect(api.snapshot().balances).toEqual(EXCESS);
});
