import {
  formatDecimalParts,
  normalizeDecimalString,
  parseDecimalString,
} from './decimal.js';

const USDT_SCALE = 8;
const ACCOUNT_ORDER = ['FUNDING', 'MAIN', 'UMFUTURE'];

/**
 * The private transfer BAPI uses the current page bundle's account codes, which
 * intentionally differ from the public universal-transfer API enum names.
 */
export const USDT_REBALANCE_ACCOUNTS = Object.freeze({
  FUNDING: Object.freeze({
    walletName: 'Funding',
    bapiCode: 'CARD',
    label: '资金',
    ratio: 50,
  }),
  MAIN: Object.freeze({
    walletName: 'Spot',
    bapiCode: 'MAIN',
    label: '现货',
    ratio: 40,
  }),
  UMFUTURE: Object.freeze({
    walletName: 'USDⓈ-M Futures',
    bapiCode: 'FUTURE',
    label: 'U本位合约',
    ratio: 10,
  }),
});

function parsePositionAmount(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^-?(?:\d+\.?\d*|\.\d+)$/.test(value.trim())) {
    return Number(value);
  }
  throw new Error(`持仓数量无效：${String(value)}`);
}

function requireDecimal(value, message) {
  const normalized = normalizeDecimalString(value);
  if (normalized == null) throw new Error(message);
  return normalized;
}

function decimalToUnits(value) {
  const normalized = requireDecimal(value, `USDT 余额无效：${String(value)}`);
  const parsed = parseDecimalString(normalized);
  if (parsed.scale > USDT_SCALE) throw new Error('USDT 余额精度超过 8 位');
  return parsed.digits * (10n ** BigInt(USDT_SCALE - parsed.scale));
}

function unitsToDecimal(units) {
  return formatDecimalParts(units, USDT_SCALE);
}

function isZeroDecimal(value) {
  return decimalToUnits(value) === 0n;
}

export function resolveAllFuturesPositionStatus(payload) {
  if (payload?.success !== true) throw new Error(payload?.message || '持仓接口返回失败');
  if (!Array.isArray(payload.data)) throw new Error('持仓接口数据格式异常');
  let positionCount = 0;
  for (const position of payload.data) {
    if (!position || typeof position.symbol !== 'string' || !position.symbol) {
      throw new Error('持仓接口缺少交易对');
    }
    if (parsePositionAmount(position.positionAmount) !== 0) positionCount += 1;
  }
  return {
    status: positionCount === 0 ? 'flat' : 'has_position',
    positionCount,
  };
}

function readWalletUsdtBalance(wallet, account) {
  if (wallet.activate !== true) throw new Error(`${account.label}账户未启用`);
  if (!Array.isArray(wallet.assetBalances)) {
    throw new Error(`${account.label}账户余额格式异常`);
  }
  const matches = wallet.assetBalances.filter((asset) => asset?.asset === 'USDT');
  if (matches.length > 1) throw new Error(`${account.label}账户存在重复的 USDT 余额`);
  if (matches.length === 0) return '0';
  const balance = matches[0];
  const free = requireDecimal(balance.free, `${account.label}账户 USDT 可用余额无效`);
  const locked = requireDecimal(balance.locked, `${account.label}账户 USDT 锁定余额无效`);
  const freeze = requireDecimal(balance.freeze, `${account.label}账户 USDT 冻结余额无效`);
  const withdrawing = requireDecimal(
    balance.withdrawing,
    `${account.label}账户 USDT 划出中余额无效`,
  );
  if (![locked, freeze, withdrawing].every(isZeroDecimal)) {
    throw new Error(`${account.label}账户仍有不可划转 USDT`);
  }
  return free;
}

export function parseUsdtWalletBalances(payload) {
  if (payload?.success !== true) throw new Error(payload?.message || '钱包余额接口返回失败');
  if (!Array.isArray(payload.data)) throw new Error('钱包余额接口数据格式异常');
  const balances = {};
  for (const accountCode of ACCOUNT_ORDER) {
    const account = USDT_REBALANCE_ACCOUNTS[accountCode];
    const matches = payload.data.filter((wallet) => wallet?.walletName === account.walletName);
    if (matches.length === 0) throw new Error(`钱包余额缺少 ${account.label}账户`);
    if (matches.length > 1) throw new Error(`钱包余额存在重复的${account.label}账户`);
    const free = readWalletUsdtBalance(matches[0], account);
    balances[accountCode] = accountCode === 'UMFUTURE' ? null : free;
  }
  return balances;
}

export function withFuturesTransferableBalance(balances, payload) {
  if (payload?.success !== true) {
    throw new Error(`U本位可划转余额读取失败：${payload?.message || '未知错误'}`);
  }
  const transferable = requireDecimal(payload.data, 'U本位可划转余额无效');
  return {
    FUNDING: balances.FUNDING,
    MAIN: balances.MAIN,
    UMFUTURE: transferable,
  };
}

export function buildUsdtRebalancePlan(rawBalances) {
  const beforeUnits = Object.fromEntries(
    ACCOUNT_ORDER.map((accountCode) => [accountCode, decimalToUnits(rawBalances[accountCode])]),
  );
  const totalUnits = ACCOUNT_ORDER.reduce((sum, accountCode) => sum + beforeUnits[accountCode], 0n);
  const targetUnits = {
    FUNDING: totalUnits * 50n / 100n,
    MAIN: totalUnits * 40n / 100n,
    UMFUTURE: 0n,
  };
  targetUnits.UMFUTURE = totalUnits - targetUnits.FUNDING - targetUnits.MAIN;

  const donors = ACCOUNT_ORDER
    .filter((accountCode) => beforeUnits[accountCode] > targetUnits[accountCode])
    .map((accountCode) => ({
      accountCode,
      remaining: beforeUnits[accountCode] - targetUnits[accountCode],
    }));
  const recipients = ACCOUNT_ORDER
    .filter((accountCode) => beforeUnits[accountCode] < targetUnits[accountCode])
    .map((accountCode) => ({
      accountCode,
      remaining: targetUnits[accountCode] - beforeUnits[accountCode],
    }));

  const transfers = [];
  let donorIndex = 0;
  let recipientIndex = 0;
  while (donorIndex < donors.length && recipientIndex < recipients.length) {
    const donor = donors[donorIndex];
    const recipient = recipients[recipientIndex];
    const amount = donor.remaining < recipient.remaining ? donor.remaining : recipient.remaining;
    if (amount <= 0n) throw new Error('USDT 再平衡计划出现非正划转金额');
    transfers.push({
      from: donor.accountCode,
      to: recipient.accountCode,
      kindType: [
        USDT_REBALANCE_ACCOUNTS[donor.accountCode].bapiCode,
        USDT_REBALANCE_ACCOUNTS[recipient.accountCode].bapiCode,
      ].join('_'),
      amount: unitsToDecimal(amount),
    });
    donor.remaining -= amount;
    recipient.remaining -= amount;
    if (donor.remaining === 0n) donorIndex += 1;
    if (recipient.remaining === 0n) recipientIndex += 1;
  }
  if (
    donors.some((donor) => donor.remaining !== 0n)
    || recipients.some((recipient) => recipient.remaining !== 0n)
  ) {
    throw new Error('USDT 再平衡计划未闭合');
  }
  if (transfers.length > 2) throw new Error('USDT 再平衡计划超过两笔划转');

  return {
    total: unitsToDecimal(totalUnits),
    before: Object.fromEntries(
      ACCOUNT_ORDER.map((accountCode) => [accountCode, unitsToDecimal(beforeUnits[accountCode])]),
    ),
    targets: Object.fromEntries(
      ACCOUNT_ORDER.map((accountCode) => [accountCode, unitsToDecimal(targetUnits[accountCode])]),
    ),
    transfers,
  };
}

export function applyUsdtTransferToBalances(rawBalances, transfer) {
  if (!ACCOUNT_ORDER.includes(transfer?.from) || !ACCOUNT_ORDER.includes(transfer?.to)) {
    throw new Error('USDT 划转账户无效');
  }
  if (transfer.from === transfer.to) throw new Error('USDT 划转账户不能相同');
  const balances = Object.fromEntries(
    ACCOUNT_ORDER.map((accountCode) => [accountCode, decimalToUnits(rawBalances[accountCode])]),
  );
  const amount = decimalToUnits(transfer.amount);
  if (amount <= 0n) throw new Error('USDT 划转金额必须大于 0');
  if (balances[transfer.from] < amount) throw new Error('USDT 划出账户余额不足');
  balances[transfer.from] -= amount;
  balances[transfer.to] += amount;
  return Object.fromEntries(
    ACCOUNT_ORDER.map((accountCode) => [accountCode, unitsToDecimal(balances[accountCode])]),
  );
}

export function areUsdtBalancesEqual(left, right) {
  return ACCOUNT_ORDER.every(
    (accountCode) => decimalToUnits(left?.[accountCode]) === decimalToUnits(right?.[accountCode]),
  );
}
