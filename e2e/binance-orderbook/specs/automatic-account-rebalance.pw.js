import { test, expect, reloadPageWithCoverage } from '../test.js';
import { ACCOUNT_PATHS, createAccountRebalanceApi } from '../fixtures/account-rebalance-api.js';
import { createCancelScenario, ORDER_SETS } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario, readFixtureState } from '../helpers/userscript-page.js';
import { installScenarioClock, pauseScenarioClock } from '../helpers/scenario-clock.js';

const PREFIX = 'userscripts:automatic-usdt-rebalance:v1:';
const EXCESS = { FUNDING: '0', MAIN: '0', UMFUTURE: '100' };
const TARGET = { FUNDING: '50', MAIN: '40', UMFUTURE: '10' };
const transfers = api => api.snapshot().requests.filter(r => r.pathname === ACCOUNT_PATHS.transfer);

async function episodes(page) {
  return page.evaluate(prefix => Object.keys(localStorage).filter(k => k.startsWith(prefix))
    .map(k => JSON.parse(localStorage.getItem(k)).status), PREFIX);
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
  expect(transfers(api)).toEqual([]);
  expect(api.snapshot().balances).toEqual(below);

  // When a manual deposit changes balances and the user reloads the same empty episode.
  api.setBalances(EXCESS);
  await reloadPageWithCoverage(page);
  await becomeFlat(page);
  await expect(page.locator('[data-usdt-rebalance]')).toBeEnabled();

  // Then reloading never creates a second automatic execution entitlement.
  expect(await episodes(page)).toEqual(['consumed']);
  expect(transfers(api)).toEqual([]);
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

  // Then shared locking and durable state permit only the two planned transfers.
  await expect.poll(() => api.snapshot().balances).toEqual(TARGET);
  await expect.poll(() => episodes(page)).toEqual(['consumed']);
  expect(transfers(api)).toHaveLength(2);
  expect(await episodes(second)).toEqual(['consumed']);
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
  await expect(page.locator('#jh-binance-ladder-status')).toContainText('previous outcome');

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
  await expect(page.locator('#jh-binance-ladder-status')).toContainText('identity');
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
  await expect(page.locator('#jh-binance-ladder-status')).toContainText('ordinary');
  expect(transfers(api)).toEqual([]);
  expect(api.snapshot().balances).toEqual(EXCESS);
});
