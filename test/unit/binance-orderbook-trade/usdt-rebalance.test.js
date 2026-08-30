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

test('wallet response and private transfer use stable account codes from the current page bundle', () => {
  assert.deepEqual({
    funding: {
      response: USDT_REBALANCE_ACCOUNTS.FUNDING.accountType,
      transfer: USDT_REBALANCE_ACCOUNTS.FUNDING.bapiCode,
    },
    spot: {
      response: USDT_REBALANCE_ACCOUNTS.MAIN.accountType,
      transfer: USDT_REBALANCE_ACCOUNTS.MAIN.bapiCode,
    },
    futures: {
      response: USDT_REBALANCE_ACCOUNTS.UMFUTURE.accountType,
      transfer: USDT_REBALANCE_ACCOUNTS.UMFUTURE.bapiCode,
    },
  }, {
    funding: { response: 'CARD', transfer: 'CARD' },
    spot: { response: 'MAIN', transfer: 'MAIN' },
    futures: { response: 'FUTURE', transfer: 'FUTURE' },
  });
});

test('all futures positions must be zero before rebalance is eligible', () => {
  assert.deepEqual(resolveAllFuturesPositionStatus({
    success: true,
    data: [
      { symbol: 'BTCUSDT', positionAmount: '0' },
      { symbol: 'ETHUSDT', positionAmount: '-0.25' },
    ],
  }), {
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

test('all-position resolver rejects failed and malformed responses', () => {
  assert.throws(
    () => resolveAllFuturesPositionStatus({ success: false, data: [] }),
    /持仓接口返回失败/,
  );
  assert.throws(
    () => resolveAllFuturesPositionStatus({
      success: true,
      data: [{ symbol: 'BTCUSDT', positionAmount: 'unknown' }],
    }),
    /持仓数量无效/,
  );
});

test('wallet response reads exact USDT free balances for spot and funding', () => {
  assert.deepEqual(parseUsdtWalletBalances({
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
  }), {
    MAIN: '40.5',
    FUNDING: '50',
    UMFUTURE: null,
  });
});

test('wallet response rejects locked, frozen, withdrawing, missing, and duplicate balances', () => {
  const wallet = (accountType, overrides = {}) => ({
    activate: true,
    accountType,
    walletName: `localized-${accountType}`,
    assetBalances: [{
      asset: 'USDT', free: '1', locked: '0', freeze: '0', withdrawing: '0', ...overrides,
    }],
  });

  assert.throws(
    () => parseUsdtWalletBalances({
      success: true,
      data: [wallet('MAIN', { locked: '0.1' }), wallet('CARD'), wallet('FUTURE')],
    }),
    /现货账户仍有不可划转 USDT/,
  );
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

test('futures transferable amount replaces wallet free amount', () => {
  assert.deepEqual(withFuturesTransferableBalance({
    MAIN: '40',
    FUNDING: '50',
    UMFUTURE: null,
  }, {
    success: true,
    data: '10.25',
  }), {
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

test('rebalance plan allocates total USDT to funding, spot, and futures as 5:4:1', () => {
  assert.deepEqual(buildUsdtRebalancePlan({
    FUNDING: '0',
    MAIN: '100',
    UMFUTURE: '0',
  }), {
    total: '100',
    before: { FUNDING: '0', MAIN: '100', UMFUTURE: '0' },
    targets: { FUNDING: '50', MAIN: '40', UMFUTURE: '10' },
    transfers: [
      { from: 'MAIN', to: 'FUNDING', kindType: 'MAIN_CARD', amount: '50' },
      { from: 'MAIN', to: 'UMFUTURE', kindType: 'MAIN_FUTURE', amount: '10' },
    ],
  });
});

test('rebalance plan uses at most two transfers and assigns decimal dust to futures', () => {
  const plan = buildUsdtRebalancePlan({
    FUNDING: '70.00000001',
    MAIN: '10',
    UMFUTURE: '20',
  });
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

test('rebalance plan is empty when balances already match 5:4:1', () => {
  assert.deepEqual(buildUsdtRebalancePlan({
    FUNDING: '5',
    MAIN: '4',
    UMFUTURE: '1',
  }).transfers, []);
});

test('rebalance plan rejects unsupported USDT precision instead of rounding', () => {
  assert.throws(
    () => buildUsdtRebalancePlan({
      FUNDING: '1.000000001',
      MAIN: '0',
      UMFUTURE: '0',
    }),
    /USDT 余额精度超过 8 位/,
  );
});

test('confirmed transfers advance the expected balance snapshot exactly', () => {
  const next = applyUsdtTransferToBalances({
    FUNDING: '0', MAIN: '100', UMFUTURE: '0',
  }, {
    from: 'MAIN', to: 'FUNDING', amount: '50',
  });
  assert.deepEqual(next, { FUNDING: '50', MAIN: '50', UMFUTURE: '0' });
  assert.equal(areUsdtBalancesEqual(next, {
    FUNDING: '50.00000000', MAIN: '50', UMFUTURE: '0.0',
  }), true);
  assert.equal(areUsdtBalancesEqual(next, {
    FUNDING: '50', MAIN: '49.99999999', UMFUTURE: '0',
  }), false);
});
