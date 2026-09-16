export const ACCOUNT_PATHS = Object.freeze({
  positions: '/bapi/futures/v6/private/future/user-data/user-position',
  wallets: '/bapi/asset/v2/private/asset-service/wallet/balance',
  withdrawable: '/bapi/futures/v1/private/future/user-data/getMaxWithdrawAmount',
  transfer: '/bapi/asset/v1/private/asset-service/wallet/transfer',
});

const ACCOUNT_CODES = { CARD: 'FUNDING', MAIN: 'MAIN', FUTURE: 'UMFUTURE' };

function units(value) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,8})?$/.test(value)) {
    throw new Error('The account fixture requires non-negative decimals with at most eight places');
  }
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole + fraction.padEnd(8, '0'));
}

function amount(value) {
  const digits = value.toString().padStart(9, '0');
  const fraction = digits.slice(-8).replace(/0+$/, '');
  return digits.slice(0, -8) + (fraction ? '.' + fraction : '');
}

/** Models an external wallet API, independently of the userscript's plan builder. */
export function createAccountRebalanceApi(initialBalances, { commitTransfers = true } = {}) {
  let balances = Object.fromEntries(['FUNDING', 'MAIN', 'UMFUTURE'].map(key => [key, units(initialBalances[key])]));
  let positions = [];
  const requests = [];
  const failures = new Map();
  const pendingTransfers = [];

  function applyTransfer(transfer) {
    if (balances[transfer.from] < transfer.value) throw new Error('Fixture account has insufficient funds');
    balances[transfer.from] -= transfer.value;
    balances[transfer.to] += transfer.value;
  }

  return {
    supports: pathname => Object.values(ACCOUNT_PATHS).includes(pathname),
    setPositions(value) { positions = structuredClone(value); },
    setBalances(value) {
      balances = Object.fromEntries(['FUNDING', 'MAIN', 'UMFUTURE'].map(key => [key, units(value[key])]));
    },
    failNext(pathname, response) {
      if (!Object.values(ACCOUNT_PATHS).includes(pathname)) throw new Error('Unknown account fixture endpoint');
      if (!Number.isInteger(response.status)) throw new Error('The response must declare its HTTP status');
      const queue = failures.get(pathname) ?? [];
      queue.push(structuredClone(response));
      failures.set(pathname, queue);
    },
    commitPendingTransfers() {
      pendingTransfers.splice(0).forEach(applyTransfer);
    },
    snapshot() {
      return {
        balances: Object.fromEntries(Object.entries(balances).map(([key, value]) => [key, amount(value)])),
        requests: structuredClone(requests),
        pendingTransfers: pendingTransfers.length,
      };
    },
    handle({ pathname, method, body }) {
      if (!Object.values(ACCOUNT_PATHS).includes(pathname)) throw new Error('Unknown account fixture endpoint');
      const expectedMethod = pathname === ACCOUNT_PATHS.wallets ? 'GET' : 'POST';
      if (method !== expectedMethod) throw new Error('Account fixture received the wrong HTTP method');
      requests.push({ pathname, method, body: structuredClone(body) });
      const failed = failures.get(pathname)?.shift();
      if (failed) return failed;
      let payload;
      if (pathname === ACCOUNT_PATHS.positions) payload = { success: true, data: structuredClone(positions) };
      if (pathname === ACCOUNT_PATHS.wallets) {
        payload = {
          success: true,
          data: Object.entries(ACCOUNT_CODES).map(([accountType, key]) => ({
            accountType, activate: true,
            assetBalances: [{ asset: 'USDT', free: amount(balances[key]), locked: '0', freeze: '0', withdrawing: '0' }],
          })),
        };
      }
      if (pathname === ACCOUNT_PATHS.withdrawable) {
        if (body?.assetName !== 'USDT' || Object.keys(body).length !== 1) throw new Error('Unexpected withdrawable-balance request');
        payload = { success: true, data: amount(balances.UMFUTURE) };
      }
      if (pathname === ACCOUNT_PATHS.transfer) {
        if (body?.asset !== 'USDT' || Object.keys(body).sort().join(',') !== 'amount,asset,kindType') throw new Error('Unexpected transfer request');
        const [fromCode, toCode, extra] = body.kindType.split('_');
        const from = ACCOUNT_CODES[fromCode];
        const to = ACCOUNT_CODES[toCode];
        if (!from || !to || from === to || extra !== undefined) throw new Error('Unexpected transfer route');
        const value = units(body.amount);
        if (value <= 0n) throw new Error('Transfer amount must be positive');
        const transfer = { from, to, value };
        if (commitTransfers) applyTransfer(transfer);
        else pendingTransfers.push(transfer);
        payload = { success: true };
      }
      return { status: 200, body: payload };
    },
  };
}
