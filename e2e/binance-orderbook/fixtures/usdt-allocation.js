import { USDT_REBALANCE_TARGET_PERCENTS } from '../../../src/binance-orderbook-trade/config.js';

const SCALE = 8;
const ACCOUNTS = ['FUNDING', 'MAIN', 'UMFUTURE'];

/**
 * Fixture balances follow the shipped allocation so every scenario keeps its transfer
 * shape for any valid configuration. A 200 USDT total gives each account an integer
 * target of at least 2 USDT, which leaves room for whole-unit perturbations.
 */
export const REBALANCE_TOTAL = 200;

function units(value) {
  const text = String(value);
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.');
  const magnitude = BigInt(whole) * 10n ** BigInt(SCALE) + BigInt(fraction.padEnd(SCALE, '0'));
  return negative ? -magnitude : magnitude;
}

function amount(value) {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  const whole = absolute / 10n ** BigInt(SCALE);
  const fraction = (absolute % 10n ** BigInt(SCALE)).toString().padStart(SCALE, '0').replace(/0+$/, '');
  return sign + whole + (fraction ? '.' + fraction : '');
}

export const REBALANCE_TARGET = Object.freeze(Object.fromEntries(ACCOUNTS.map(account => [
  account, String(USDT_REBALANCE_TARGET_PERCENTS[account] * REBALANCE_TOTAL / 100),
])));

export const REBALANCE_PERCENTS = USDT_REBALANCE_TARGET_PERCENTS;

const gcd = (left, right) => (right === 0 ? left : gcd(right, left % right));
const RATIO_DIVISOR = ACCOUNTS.reduce((value, account) => gcd(value, USDT_REBALANCE_TARGET_PERCENTS[account]), 0);
/** Reduced Funding:Spot:Futures label the panel must show, derived without production code. */
export const REBALANCE_RATIO = ACCOUNTS.map(account => USDT_REBALANCE_TARGET_PERCENTS[account] / RATIO_DIVISOR).join(':');

/** An allocation that is still exact after every balance is multiplied by a whole factor. */
export function scaledTarget(factor) {
  return Object.fromEntries(ACCOUNTS.map(account => [account, String(Number(REBALANCE_TARGET[account]) * factor)]));
}

/** Shift the exact targets by known amounts; the shifts must conserve the total. */
export function shiftedFromTarget(shifts) {
  const balances = Object.fromEntries(ACCOUNTS.map(account => [
    account, units(REBALANCE_TARGET[account]) + units(shifts[account] ?? '0'),
  ]));
  if (ACCOUNTS.reduce((sum, account) => sum + balances[account], 0n) !== units(REBALANCE_TOTAL)) {
    throw new Error('Fixture shifts must conserve the rebalance total');
  }
  if (ACCOUNTS.some(account => balances[account] < 0n)) throw new Error('Fixture balance cannot be negative');
  return Object.fromEntries(ACCOUNTS.map(account => [account, amount(balances[account])]));
}

/** All USDT starts in one account, as on a fresh deposit or a full Futures withdrawal. */
export function allIn(account) {
  return Object.fromEntries(ACCOUNTS.map(code => [code, code === account ? String(REBALANCE_TOTAL) : '0']));
}

export function transferBody(amountValue, kindType) {
  return { asset: 'USDT', amount: amount(units(amountValue)), kindType };
}
