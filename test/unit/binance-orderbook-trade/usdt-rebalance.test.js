import { captureThrownError } from '../../helpers/orderbook-migration-errors.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyUsdtTransferToBalances,
  areUsdtBalancesEqual,
  buildUsdtRebalancePlan,
  parseUsdtWalletBalances,
  resolveAllFuturesPositionStatus,
  USDT_REBALANCE_ACCOUNTS,
  withFuturesTransferableBalance,
} from '../../../src/binance-orderbook-trade/core/usdt-rebalance.js';

test("user sees that wallet response and private transfer use stable account codes from the current page bundle", () => {
  // Given the account identities shared by balance responses and transfer requests
  const accounts = USDT_REBALANCE_ACCOUNTS;

  // When response and transfer identities are projected for every supported wallet
  const codes = {
    funding: {
      response: accounts.FUNDING.accountType,
      transfer: accounts.FUNDING.bapiCode,
    },
    spot: {
      response: accounts.MAIN.accountType,
      transfer: accounts.MAIN.bapiCode,
    },
    futures: {
      response: accounts.UMFUTURE.accountType,
      transfer: accounts.UMFUTURE.bapiCode,
    },
  };

  // Then each wallet uses the same stable exchange account code on both paths
  assert.deepEqual(codes, {
    funding: { response: 'CARD', transfer: 'CARD' },
    spot: { response: 'MAIN', transfer: 'MAIN' },
    futures: { response: 'FUTURE', transfer: 'FUTURE' },
  });
});

test("user sees that all futures positions must be zero before rebalance is eligible", () => {
  // Given the wallet response and account balances are available
  const scenarioInputs = [{
    success: true,
    data: [
      { symbol: 'BTCUSDT', positionAmount: '0' },
      { symbol: 'ETHUSDT', positionAmount: '-0.25' },
    ],
  }];

  // When the USDT eligibility or transfer plan is evaluated
  const observed = resolveAllFuturesPositionStatus(...scenarioInputs);

  // Then sees that all futures positions must be zero before rebalance is eligible
  assert.deepEqual(observed, {
    status: 'has_position',
    positionCount: 1,
  });

  assert.deepEqual(resolveAllFuturesPositionStatus({
    success: true,
    data: [
      { symbol: 'BTCUSDT', positionAmount: '0.000' },
      { symbol: 'ETHUSDT', positionAmount: 0 },
    ],
  }), {
    status: 'flat',
    positionCount: 0,
  });
});

test("user sees that all-position resolver rejects failed and malformed responses", () => {
  // Given the wallet response and account balances are available
  const scenarioInputs = [{ success: false, data: [] }];

  // When the USDT eligibility or transfer plan is evaluated
  const observedFailure = captureThrownError(() => resolveAllFuturesPositionStatus(...scenarioInputs));

  // Then sees that all-position resolver rejects failed and malformed responses
  assert.match(observedFailure.message, /持仓接口返回失败/);
  assert.throws(
    () => resolveAllFuturesPositionStatus({
      success: true,
      data: [{ symbol: 'BTCUSDT', positionAmount: 'unknown' }],
    }),
    /持仓数量无效/,
  );
});

test("user sees that wallet response reads exact USDT free balances for spot and funding", () => {
  // Given the wallet response and account balances are available
  const scenarioInputs = [{
    success: true,
    data: [
      {
        activate: true,
        accountType: 'MAIN',
        walletName: '现货账户',
        assetBalances: [{
          asset: 'USDT', free: '40.5', locked: '0', freeze: '0', withdrawing: '0',
        }],
      },
      {
        activate: true,
        accountType: 'CARD',
        walletName: '资金账户',
        assetBalances: [{
          asset: 'USDT', free: '50', locked: '0', freeze: '0', withdrawing: '0',
        }],
      },
      {
        activate: true,
        accountType: 'FUTURE',
        walletName: '合约账户（U本位）',
        assetBalances: [{
          asset: 'USDT', free: '12', locked: '0', freeze: '0', withdrawing: '0',
        }],
      },
    ],
  }];

  // When the USDT eligibility or transfer plan is evaluated
  const observed = parseUsdtWalletBalances(...scenarioInputs);

  // Then sees that wallet response reads exact USDT free balances for spot and funding
  assert.deepEqual(observed, {
    MAIN: '40.5',
    FUNDING: '50',
    UMFUTURE: null,
  });
});

test("user sees that wallet response rejects locked, frozen, withdrawing, missing, and duplicate balances", () => {
  // Given the wallet response and account balances are available
  const wallet = (accountType, overrides = {}) => ({
    activate: true,
    accountType,
    walletName: `localized-${accountType}`,
    assetBalances: [{
      asset: 'USDT', free: '1', locked: '0', freeze: '0', withdrawing: '0', ...overrides,
    }],
  });

  // When the USDT eligibility or transfer plan is evaluated
  const observedFailure = captureThrownError(() => parseUsdtWalletBalances({
      success: true,
      data: [wallet('MAIN', { locked: '0.1' }), wallet('CARD'), wallet('FUTURE')],
    }));

  // Then sees that wallet response rejects locked, frozen, withdrawing, missing, and duplicate balances
  assert.match(observedFailure.message, /现货账户仍有不可划转 USDT/);
  assert.throws(
    () => parseUsdtWalletBalances({
      success: true,
      data: [wallet('MAIN'), wallet('CARD', { freeze: '0.1' }), wallet('FUTURE')],
    }),
    /资金账户仍有不可划转 USDT/,
  );
  assert.throws(
    () => parseUsdtWalletBalances({
      success: true,
      data: [wallet('MAIN'), wallet('CARD'), wallet('FUTURE', { withdrawing: '0.1' })],
    }),
    /U本位合约账户仍有不可划转 USDT/,
  );
  assert.throws(
    () => parseUsdtWalletBalances({
      success: true,
      data: [wallet('MAIN'), wallet('CARD')],
    }),
    /缺少 U本位合约账户/,
  );
  assert.throws(
    () => parseUsdtWalletBalances({
      success: true,
      data: [wallet('MAIN'), wallet('MAIN'), wallet('CARD'), wallet('FUTURE')],
    }),
    /重复的现货账户/,
  );
});

test("user sees that futures transferable amount replaces wallet free amount", () => {
  // Given the wallet response and account balances are available
  const scenarioInputs = [{
    MAIN: '40',
    FUNDING: '50',
    UMFUTURE: null,
  }, {
    success: true,
    data: '10.25',
  }];

  // When the USDT eligibility or transfer plan is evaluated
  const observed = withFuturesTransferableBalance(...scenarioInputs);

  // Then sees that futures transferable amount replaces wallet free amount
  assert.deepEqual(observed, {
    MAIN: '40',
    FUNDING: '50',
    UMFUTURE: '10.25',
  });
  assert.throws(
    () => withFuturesTransferableBalance({ MAIN: '40', FUNDING: '50', UMFUTURE: null }, {
      success: false,
      message: 'failed',
    }),
    /U本位可划转余额读取失败：failed/,
  );
});

test("user sees that rebalance plan allocates total USDT to funding, spot, and futures as 5:4:1", () => {
  // Given the wallet response and account balances are available
  const scenarioInputs = [{
    FUNDING: '0',
    MAIN: '100',
    UMFUTURE: '0',
  }];

  // When the USDT eligibility or transfer plan is evaluated
  const observed = buildUsdtRebalancePlan(...scenarioInputs);

  // Then sees that rebalance plan allocates total USDT to funding, spot, and futures as 5:4:1
  assert.deepEqual(observed, {
    total: '100',
    before: { FUNDING: '0', MAIN: '100', UMFUTURE: '0' },
    targets: { FUNDING: '50', MAIN: '40', UMFUTURE: '10' },
    transfers: [
      { from: 'MAIN', to: 'FUNDING', kindType: 'MAIN_CARD', amount: '50' },
      { from: 'MAIN', to: 'UMFUTURE', kindType: 'MAIN_FUTURE', amount: '10' },
    ],
  });
});

test("user sees that rebalance plan uses at most two transfers and assigns decimal dust to futures", () => {
  // Given the wallet response and account balances are available
  const scenarioInputs = [{
    FUNDING: '70.00000001',
    MAIN: '10',
    UMFUTURE: '20',
  }];

  // When the USDT eligibility or transfer plan is evaluated
  const plan = buildUsdtRebalancePlan(...scenarioInputs);


  // Then sees that rebalance plan uses at most two transfers and assigns decimal dust to futures
  assert.deepEqual(plan.targets, {
    FUNDING: '50',
    MAIN: '40',
    UMFUTURE: '10.00000001',
  });
  assert.deepEqual(plan.transfers, [
    { from: 'FUNDING', to: 'MAIN', kindType: 'CARD_MAIN', amount: '20.00000001' },
    { from: 'UMFUTURE', to: 'MAIN', kindType: 'FUTURE_MAIN', amount: '9.99999999' },
  ]);
  assert.ok(plan.transfers.length <= 2);
});

test("user sees that rebalance plan is empty when balances already match 5:4:1", () => {
  // Given the wallet response and account balances are available
  const scenarioInputs = [{
    FUNDING: '5',
    MAIN: '4',
    UMFUTURE: '1',
  }];

  // When the USDT eligibility or transfer plan is evaluated
  const observed = buildUsdtRebalancePlan(...scenarioInputs).transfers;

  // Then sees that rebalance plan is empty when balances already match 5:4:1
  assert.deepEqual(observed, []);
});

test("user sees that rebalance plan rejects unsupported USDT precision instead of rounding", () => {
  // Given the wallet response and account balances are available
  const scenarioInputs = [{
      FUNDING: '1.000000001',
      MAIN: '0',
      UMFUTURE: '0',
    }];

  // When the USDT eligibility or transfer plan is evaluated
  const observedFailure = captureThrownError(() => buildUsdtRebalancePlan(...scenarioInputs));

  // Then sees that rebalance plan rejects unsupported USDT precision instead of rounding
  assert.match(observedFailure.message, /USDT 余额精度超过 8 位/);
});

test("user sees that confirmed transfers advance the expected balance snapshot exactly", () => {
  // Given the wallet response and account balances are available
  const scenarioInputs = [{
    FUNDING: '0', MAIN: '100', UMFUTURE: '0',
  }, {
    from: 'MAIN', to: 'FUNDING', amount: '50',
  }];

  // When the USDT eligibility or transfer plan is evaluated
  const next = applyUsdtTransferToBalances(...scenarioInputs);


  // Then sees that confirmed transfers advance the expected balance snapshot exactly
  assert.deepEqual(next, { FUNDING: '50', MAIN: '50', UMFUTURE: '0' });
  assert.equal(areUsdtBalancesEqual(next, {
    FUNDING: '50.00000000', MAIN: '50', UMFUTURE: '0.0',
  }), true);
  assert.equal(areUsdtBalancesEqual(next, {
    FUNDING: '50', MAIN: '49.99999999', UMFUTURE: '0',
  }), false);
});

function availableWallet(accountType, overrides = {}) {
  return {
    accountType,
    activate: true,
    assetBalances: [{ asset: 'USDT', free: '1', locked: '0', freeze: '0', withdrawing: '0' }],
    ...overrides,
  };
}

for (const { label, payload, message } of [
  { label: 'missing position response', payload: null, message: '持仓接口返回失败' },
  { label: 'exchange position rejection', payload: { success: false, message: 'position denied' }, message: 'position denied' },
  { label: 'non-list position data', payload: { success: true, data: {} }, message: '持仓接口数据格式异常' },
  { label: 'missing position entry', payload: { success: true, data: [null] }, message: '持仓接口缺少交易对' },
  { label: 'missing position symbol', payload: { success: true, data: [{ positionAmount: '0' }] }, message: '持仓接口缺少交易对' },
  { label: 'empty position symbol', payload: { success: true, data: [{ symbol: '', positionAmount: '0' }] }, message: '持仓接口缺少交易对' },
]) {
  test(`user cannot rebalance with ${label}`, () => {
    // Given the exchange returned an incomplete or rejected all-position response
    const response = payload;

    // When eligibility is evaluated from that response
    const failure = captureThrownError(() => resolveAllFuturesPositionStatus(response));

    // Then the response failure remains explicit instead of confirming a flat account
    assert.equal(failure.message, message);
  });
}

test('user counts nonzero numeric and signed decimal positions across all contracts', () => {
  // Given positions include long, short, numeric, and signed zero amounts
  const payload = { success: true, data: [
    { symbol: 'BTCUSDT', positionAmount: 1 },
    { symbol: 'ETHUSDT', positionAmount: '-.25' },
    { symbol: 'SOLUSDT', positionAmount: '-0.000' },
    { symbol: '4USDT', positionAmount: '0.' },
  ] };

  // When all futures positions are evaluated
  const result = resolveAllFuturesPositionStatus(payload);

  // Then both nonzero positions block rebalance and signed zero does not
  assert.deepEqual(result, { status: 'has_position', positionCount: 2 });
});

for (const { label, payload, message } of [
  { label: 'missing wallet response', payload: null, message: '钱包余额接口返回失败' },
  { label: 'wallet rejection', payload: { success: false, message: 'wallet denied' }, message: 'wallet denied' },
  { label: 'non-list wallet data', payload: { success: true, data: {} }, message: '钱包余额接口数据格式异常' },
  { label: 'inactive funding wallet', payload: { success: true, data: [availableWallet('CARD', { activate: false })] }, message: '资金账户未启用' },
  { label: 'missing asset list', payload: { success: true, data: [availableWallet('CARD', { assetBalances: null })] }, message: '资金账户余额格式异常' },
  { label: 'duplicate USDT balance', payload: { success: true, data: [availableWallet('CARD', { assetBalances: [{ asset: 'USDT' }, { asset: 'USDT' }] })] }, message: '资金账户存在重复的 USDT 余额' },
  { label: 'unreadable free balance', payload: { success: true, data: [availableWallet('CARD', { assetBalances: [{ asset: 'USDT', free: 'unknown' }] })] }, message: '资金账户 USDT 可用余额无效' },
]) {
  test(`user cannot rebalance with ${label}`, () => {
    // Given the exchange wallet response violates the named balance contract
    const response = payload;

    // When supported wallet balances are read
    const failure = captureThrownError(() => parseUsdtWalletBalances(response));

    // Then the unavailable wallet is not treated as a zero or spendable balance
    assert.equal(failure.message, message);
  });
}

test('user treats an absent USDT asset as zero while ignoring unrelated assets and wallets', () => {
  // Given active wallets contain only other assets and one unrelated wallet entry
  const response = { success: true, data: [
    null,
    availableWallet('OTHER'),
    availableWallet('CARD', { assetBalances: [null, { asset: 'BTC', free: '12' }] }),
    availableWallet('MAIN', { assetBalances: [] }),
    availableWallet('FUTURE', { assetBalances: [] }),
  ] };

  // When available USDT balances are read
  const balances = parseUsdtWalletBalances(response);

  // Then absent USDT is zero and futures still requires its transferable endpoint
  assert.deepEqual(balances, { FUNDING: '0', MAIN: '0', UMFUTURE: null });
});

test('user receives explicit failures when the futures transferable amount is unavailable', () => {
  // Given wallet balances are known but transferable responses are missing or malformed
  const balances = { FUNDING: '5', MAIN: '4', UMFUTURE: null };
  const responses = [null, { success: false }, { success: true, data: '-1' }];

  // When transferable futures balances are applied
  const failures = responses.map((response) => captureThrownError(() => withFuturesTransferableBalance(balances, response)));

  // Then every missing or invalid transferable amount blocks a usable account snapshot
  assert.deepEqual(failures.map((error) => error.message), [
    'U本位可划转余额读取失败：未知错误', 'U本位可划转余额读取失败：未知错误', 'U本位可划转余额无效',
  ]);
  assert.deepEqual(balances, { FUNDING: '5', MAIN: '4', UMFUTURE: null });
});

test('user cannot apply transfers with unsupported accounts or invalid amounts', () => {
  // Given a confirmed account snapshot and invalid proposed transfer requests
  const balances = { FUNDING: '5', MAIN: '4', UMFUTURE: '1' };
  const transfers = [
    null,
    { from: 'OTHER', to: 'MAIN', amount: '1' },
    { from: 'MAIN', to: 'OTHER', amount: '1' },
    { from: 'MAIN', to: 'MAIN', amount: '1' },
    { from: 'MAIN', to: 'FUNDING', amount: '0' },
    { from: 'MAIN', to: 'FUNDING', amount: '5' },
    { from: 'MAIN', to: 'FUNDING', amount: '-1' },
  ];

  // When the expected post-transfer balance is calculated for each request
  const failures = transfers.map((transfer) => captureThrownError(() => applyUsdtTransferToBalances(balances, transfer)));

  // Then every invalid transfer fails and the original balances remain unchanged
  assert.deepEqual(failures.map((error) => error.message), [
    'USDT 划转账户无效', 'USDT 划转账户无效', 'USDT 划转账户无效',
    'USDT 划转账户不能相同', 'USDT 划转金额必须大于 0', 'USDT 划出账户余额不足', 'USDT 余额无效：-1',
  ]);
  assert.deepEqual(balances, { FUNDING: '5', MAIN: '4', UMFUTURE: '1' });
});

test('user receives an empty balanced plan when all available wallets are empty', () => {
  // Given all three supported wallets have a confirmed zero available balance
  const balances = { FUNDING: '0.00000000', MAIN: '0', UMFUTURE: '0' };

  // When the 5:4:1 rebalance is planned
  const plan = buildUsdtRebalancePlan(balances);

  // Then the plan contains exact zero targets and no transfer requests
  assert.deepEqual(plan, {
    total: '0', before: { FUNDING: '0', MAIN: '0', UMFUTURE: '0' },
    targets: { FUNDING: '0', MAIN: '0', UMFUTURE: '0' }, transfers: [],
  });
});

test('user cannot compare an incomplete balance snapshot with confirmed balances', () => {
  // Given one side of the expected balance comparison is unavailable
  const balances = { FUNDING: '5', MAIN: '4', UMFUTURE: '1' };

  // When either incomplete snapshot is compared
  const failures = [
    captureThrownError(() => areUsdtBalancesEqual(null, balances)),
    captureThrownError(() => areUsdtBalancesEqual(balances, null)),
  ];

  // Then an unavailable snapshot never passes as a confirmed balance match
  assert.deepEqual(failures.map((error) => error.message), ['USDT 余额无效：undefined', 'USDT 余额无效：undefined']);
});
