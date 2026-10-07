import assert from 'node:assert/strict';
import test from 'node:test';
import { ACCOUNT_PATHS, createAccountRebalanceApi } from '../../e2e/binance-orderbook/fixtures/account-rebalance-api.js';

test('user reads an explicit standard futures identity independently of positions', () => {
  // Given an account fixture with no positions and a stable account identity
  const api = createAccountRebalanceApi({ FUNDING: '0', MAIN: '0', UMFUTURE: '100' });

  // When the caller requests the identity with the native empty POST body
  const initial = api.handle({ pathname: ACCOUNT_PATHS.identity, method: 'POST', body: {} });
  api.setIdentity({ userId: 'fixture-second-account', isExistFutureAccount: false, isPortfolioMarginRetailUser: true });
  const updated = api.handle({ pathname: ACCOUNT_PATHS.identity, method: 'POST', body: {} });
  const positions = api.handle({ pathname: ACCOUNT_PATHS.positions, method: 'POST', body: {} });

  // Then identity changes are explicit and never inferred from flat position state
  assert.deepEqual(initial, { status: 200, body: { success: true, code: '000000', data: {
    userId: 'fixture-account', isExistFutureAccount: true, isPortfolioMarginRetailUser: false,
  } } });
  assert.deepEqual(updated.body.data, {
    userId: 'fixture-second-account', isExistFutureAccount: false, isPortfolioMarginRetailUser: true,
  });
  assert.deepEqual(positions.body.data, []);
});

test('user reads every basic and conditional order across symbols independently of positions', () => {
  // Given basic and conditional orders exist on different symbols without positions
  const api = createAccountRebalanceApi({ FUNDING: '0', MAIN: '0', UMFUTURE: '100' });
  const orders = {
    basic: [{ symbol: 'BTCUSDT', orderId: 'basic-one' }, { symbol: 'ETHUSDT', orderId: 'basic-two' }],
    conditional: [{ symbol: 'SOLUSDT', algoId: 'conditional-one' }],
  };
  api.setOrders(orders);

  // When both all-symbol order endpoints and positions are read
  const basic = api.handle({ pathname: ACCOUNT_PATHS.basicOrders, method: 'POST', body: {} });
  const conditional = api.handle({ pathname: ACCOUNT_PATHS.conditionalOrders, method: 'POST', body: { algoType: 'CONDITIONAL' } });
  const positions = api.handle({ pathname: ACCOUNT_PATHS.positions, method: 'POST', body: {} });

  // Then the complete arrays preserve other-symbol orders and positions remain independent
  assert.deepEqual(basic, { status: 200, body: { success: true, code: '000000', data: orders.basic } });
  assert.deepEqual(conditional, { status: 200, body: { success: true, code: '000000', data: orders.conditional } });
  assert.equal(basic.body.data.length + conditional.body.data.length, 3);
  assert.deepEqual(positions.body.data, []);
});

for (const { key, method, body } of [
  { key: 'identity', method: 'GET', body: {} },
  { key: 'identity', method: 'POST', body: { userId: 'scoped' } },
  { key: 'basicOrders', method: 'POST', body: { symbol: 'BTCUSDT' } },
  { key: 'basicOrders', method: 'POST', body: { page: 1 } },
  { key: 'basicOrders', method: 'POST', body: undefined },
  { key: 'conditionalOrders', method: 'POST', body: {} },
  { key: 'conditionalOrders', method: 'POST', body: { algoType: 'OTHER' } },
  { key: 'conditionalOrders', method: 'POST', body: { algoType: 'CONDITIONAL', symbol: 'BTCUSDT' } },
]) {
  test(`user rejects an invalid ${key} request with ${method} ${JSON.stringify(body)}`, () => {
    // Given the independent fixture requires the exact public endpoint contract
    const api = createAccountRebalanceApi({ FUNDING: '0', MAIN: '0', UMFUTURE: '100' });

    // When the caller sends a scoped, missing, or otherwise incorrect request
    const request = () => api.handle({ pathname: ACCOUNT_PATHS[key], method, body });

    // Then the fixture exposes the request mismatch instead of inventing an empty response
    assert.throws(request, /wrong HTTP method|Unexpected .* request/);
  });
}

test('user receives an account order read failure without changing balances or transferring funds', () => {
  // Given the next all-symbol basic order read fails before any transfer
  const balances = { FUNDING: '0', MAIN: '0', UMFUTURE: '100' };
  const api = createAccountRebalanceApi(balances);
  api.failNext(ACCOUNT_PATHS.basicOrders, { status: 503, body: { success: false, code: 'FIXTURE_FAILURE' } });

  // When the caller reads the account basic orders
  const response = api.handle({ pathname: ACCOUNT_PATHS.basicOrders, method: 'POST', body: {} });

  // Then the declared failure is returned and all funds stay in their original wallet
  assert.deepEqual(response, { status: 503, body: { success: false, code: 'FIXTURE_FAILURE' } });
  assert.deepEqual(api.snapshot().balances, balances);
  assert.deepEqual(api.snapshot().requests.map(request => request.pathname), [ACCOUNT_PATHS.basicOrders]);
});

test('user can detect a wrong transfer direction because the native account fake applies the actual request', () => {
  // Given balances are held by an independently modeled external account boundary.
  const api = createAccountRebalanceApi({ FUNDING: '50.12345678', MAIN: '40', UMFUTURE: '10' });

  // When a caller moves funds in a direction that does not follow the intended target ratio.
  const response = api.handle({ pathname: ACCOUNT_PATHS.transfer, method: 'POST',
    body: { asset: 'USDT', amount: '0.12345678', kindType: 'CARD_FUTURE' } });

  // Then the wrong request remains observable, exact balances change accordingly, and no plan is repaired.
  assert.deepEqual(response, { status: 200, body: { success: true } });
  assert.deepEqual(api.snapshot().balances, { FUNDING: '50', MAIN: '40', UMFUTURE: '10.12345678' });
  assert.deepEqual(api.snapshot().requests[0].body, { asset: 'USDT', amount: '0.12345678', kindType: 'CARD_FUTURE' });
});

test('user can hold an acknowledged transfer until its balance update is explicitly committed', () => {
  // Given native acknowledgement and the later balance publication are separate events.
  const api = createAccountRebalanceApi({ FUNDING: '100', MAIN: '0', UMFUTURE: '0' }, { commitTransfers: false });

  // When a transfer is acknowledged before its balance publication.
  api.handle({ pathname: ACCOUNT_PATHS.transfer, method: 'POST', body: { asset: 'USDT', amount: '40', kindType: 'CARD_MAIN' } });

  // Then the old balances and exactly one pending transfer remain visible.
  assert.deepEqual(api.snapshot().balances, { FUNDING: '100', MAIN: '0', UMFUTURE: '0' });
  assert.equal(api.snapshot().pendingTransfers, 1);

  // When the native account publishes the completed transfer.
  api.commitPendingTransfers();

  // Then the amount moves once and the pending queue becomes empty.
  assert.deepEqual(api.snapshot().balances, { FUNDING: '60', MAIN: '40', UMFUTURE: '0' });
  assert.equal(api.snapshot().pendingTransfers, 0);
});

test('user receives a declared HTTP rejection without an invented transfer or balance change', () => {
  // Given the next transfer response is a declared upstream rejection.
  const api = createAccountRebalanceApi({ FUNDING: '100', MAIN: '0', UMFUTURE: '0' });
  api.failNext(ACCOUNT_PATHS.transfer, { status: 403, body: { success: false, message: 'Fixture rejection' } });

  // When a valid transfer request reaches that external boundary.
  const response = api.handle({ pathname: ACCOUNT_PATHS.transfer, method: 'POST', body: { asset: 'USDT', amount: '40', kindType: 'CARD_MAIN' } });

  // Then the original rejection and balances remain authoritative.
  assert.deepEqual(response, { status: 403, body: { success: false, message: 'Fixture rejection' } });
  assert.deepEqual(api.snapshot().balances, { FUNDING: '100', MAIN: '0', UMFUTURE: '0' });
  assert.equal(api.snapshot().requests.length, 1);
});

test('user receives wallet and position payloads from the declared external account state', () => {
  // Given every wallet and a current position are explicitly configured.
  const api = createAccountRebalanceApi({ FUNDING: '50', MAIN: '40', UMFUTURE: '10' });
  api.setPositions([{ symbol: 'BTCUSDT', positionAmount: '1' }]);

  // When the caller reads each supported account endpoint.
  const wallets = api.handle({ pathname: ACCOUNT_PATHS.wallets, method: 'GET' });
  const positions = api.handle({ pathname: ACCOUNT_PATHS.positions, method: 'POST', body: {} });
  const transferable = api.handle({ pathname: ACCOUNT_PATHS.withdrawable, method: 'POST', body: { assetName: 'USDT' } });

  // Then stable account codes and exact amounts reach the caller without business-plan inference.
  assert.deepEqual(wallets.body.data.map(wallet => [wallet.accountType, wallet.assetBalances[0].free]),
    [['CARD', '50'], ['MAIN', '40'], ['FUTURE', '10']]);
  assert.deepEqual(positions.body, { success: true, data: [{ symbol: 'BTCUSDT', positionAmount: '1' }] });
  assert.deepEqual(transferable.body, { success: true, data: '10' });
});
