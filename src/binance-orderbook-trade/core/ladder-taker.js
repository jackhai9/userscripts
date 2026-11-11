import {
  ceilQtyByNotional, compareDecimalStrings, floorDecimalToStep, maxDecimalString, multiplyDecimalByRatio, normalizeDecimalString,
} from './decimal.js';
import { formatLocalizedText } from '../../shared/ui-locale.js';

export const LADDER_TAKER_PERCENTS = Object.freeze([0, 20, 50, 80]);
export const DEFAULT_LADDER_TAKER_PERCENT = 0;
export const TAKER_SAMPLE_HORIZONS_SECONDS = Object.freeze([5, 30]);

function assertTakerPercent(percent) {
  if (!LADDER_TAKER_PERCENTS.includes(percent)) throw new Error(`Invalid taker percent: ${percent}`);
}

/** A continuous session owes fractions of taker orders across rounds, kept in percent units. */
export function createTakerCarry() {
  return { percent: null, units: 0 };
}

/**
 * Returns how many of a round's orders are sent as market orders.
 * Without a carry (one-round ladder) any nonzero ratio takes at least one order.
 * With a carry (continuous close) the fractional remainder moves to the next round,
 * so the session ratio matches the selection; a ratio change restarts the carry.
 * A round never takes more than ceil(levels × ratio), however much the session owes.
 * The carry object is updated in place.
 */
export function allocateLadderTakerOrders({ levels, percent, carry = null }) {
  if (!Number.isSafeInteger(levels) || levels < 1) throw new Error(`Invalid ladder level count: ${levels}`);
  assertTakerPercent(percent);
  if (!carry) {
    if (percent === 0) return 0;
    return Math.min(levels, Math.max(1, Math.floor((levels * percent) / 100)));
  }
  if (carry.percent !== percent) {
    carry.percent = percent;
    carry.units = 0;
  }
  if (percent === 0) return 0;
  carry.units += levels * percent;
  const count = Math.min(levels, Math.ceil((levels * percent) / 100), Math.floor(carry.units / 100));
  carry.units -= count * 100;
  return count;
}

/**
 * Taker orders allocated to a round that never reached their click remain owed to the session,
 * but at most one order is carried: repeated failed rounds cannot build a backlog of market orders.
 */
export function returnUnspentTakerOrders(carry, count) {
  if (!Number.isSafeInteger(count) || count < 0) throw new Error(`Invalid unspent taker count: ${count}`);
  carry.units = Math.min(carry.units + count * 100, 100);
}

/** Codes whose message says the exchange may still have executed the order. */
const UNKNOWN_EXECUTION_CODES = new Set([-1000, -1006, -1007, -1008]);

/**
 * True only for one settled 2xx JSON response with success=false and a definite rejection code.
 * Anything else (5xx, a timeout code, several responses) may have created the market order.
 */
export function isConfirmedTakerRejection({ responseDiagnostics, apiErrors, apiSuccesses }) {
  if (responseDiagnostics.length !== 1 || apiErrors.length !== 1 || apiSuccesses.length !== 0) return false;
  const [diagnostic] = responseDiagnostics;
  const [apiError] = apiErrors;
  return Number.isInteger(diagnostic.httpStatus) && diagnostic.httpStatus >= 200 && diagnostic.httpStatus < 300
    && diagnostic.bodyKind === 'json' && diagnostic.payloadSummary?.success === false
    && apiError.success === false && Number.isInteger(apiError.code) && !UNKNOWN_EXECUTION_CODES.has(apiError.code);
}

export function validateMarketOrderQty(qty, { minQty, stepSize, maxQty }) {
  if (!normalizeDecimalString(minQty) || !normalizeDecimalString(stepSize) || !normalizeDecimalString(maxQty)) {
    return { ok: false, reason: 'rules_missing' };
  }
  if (compareDecimalStrings(qty, minQty) < 0) return { ok: false, reason: 'below_min' };
  if (compareDecimalStrings(floorDecimalToStep(qty, stepSize), qty) !== 0) return { ok: false, reason: 'off_step' };
  if (compareDecimalStrings(qty, maxQty) > 0) return { ok: false, reason: 'above_max' };
  return { ok: true };
}

/**
 * An opening market order must reach the exchange minimum notional at the price it actually trades,
 * which is below the ladder's maker price for a short. The planned quantity is raised, never lowered,
 * so that quantity × price covers 101% of the minimum: the page's own check may use a slightly
 * different reference price than the one read just before the click.
 */
export function raiseQtyToMarketNotional({ qty, minNotional, price, stepSize }) {
  if (!normalizeDecimalString(minNotional) || compareDecimalStrings(price, '0') !== 1 || !normalizeDecimalString(stepSize)) {
    return null;
  }
  const target = multiplyDecimalByRatio(minNotional, 101, 100);
  const required = ceilQtyByNotional(target, price, stepSize);
  return required ? maxDecimalString(qty, required) : null;
}

function requestQuantityText(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null;
    return normalizeDecimalString(value.toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 21 }));
  }
  return typeof value === 'string' ? normalizeDecimalString(value) : null;
}

/**
 * Checks a native place-order body before it leaves the page. A taker must be exactly the planned
 * market order; a maker must never be a market order, which would mean the form was left on MARKET.
 */
export function matchPlaceOrderRequest(bodyText, expected) {
  let body;
  try {
    body = typeof bodyText === 'string' ? JSON.parse(bodyText) : null;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    body = null;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, reason: 'body' };
  if (expected.kind === 'maker') {
    if (body.type === 'MARKET') return { ok: false, reason: 'type' };
    return { ok: true, clientOrderId: typeof body.newClientOrderId === 'string' ? body.newClientOrderId : null };
  }
  if (expected.kind !== 'taker') throw new Error(`Unknown place-order expectation: ${expected.kind}`);
  if (body.type !== 'MARKET') return { ok: false, reason: 'type' };
  if (body.symbol !== expected.symbol) return { ok: false, reason: 'symbol' };
  if (body.side !== expected.side) return { ok: false, reason: 'side' };
  if (body.positionSide !== expected.positionSide) return { ok: false, reason: 'positionSide' };
  if (compareDecimalStrings(requestQuantityText(body.quantity), expected.quantity) !== 0) return { ok: false, reason: 'quantity' };
  if (typeof body.newClientOrderId !== 'string' || body.newClientOrderId.length === 0) return { ok: false, reason: 'clientOrderId' };
  return { ok: true, clientOrderId: body.newClientOrderId };
}

export function createTakerStats({ label, positionSide }) {
  if (!['LONG', 'SHORT'].includes(positionSide)) throw new Error(`Invalid taker stats position side: ${positionSide}`);
  return { label, positionSide, entries: [] };
}

export function recordTakerSubmitted(stats, { clientOrderId, symbol, side, positionSide }) {
  const entry = {
    clientOrderId, symbol, side, positionSide, status: 'pending', fillPrice: null,
    samples: Object.fromEntries(TAKER_SAMPLE_HORIZONS_SECONDS.map(horizon => [horizon, { state: 'pending', price: null }])),
  };
  stats.entries.push(entry);
  return entry;
}

/**
 * Applies a trusted ORDER_TRADE_UPDATE frame. Only the order's terminal FILLED average price counts;
 * an order that ends EXPIRED or CANCELED is reported as unfilled. Returns the entry that just filled.
 */
export function applyTakerOrderUpdate(stats, order) {
  const entry = stats.entries.find(item => item.clientOrderId === order?.c && item.symbol === order.s
    && item.side === order.S && item.positionSide === order.ps);
  if (!entry || entry.status !== 'pending') return null;
  if (order.X === 'FILLED') {
    const price = normalizeDecimalString(order.ap);
    if (!price) return null;
    entry.status = 'filled';
    entry.fillPrice = price;
    return entry;
  }
  if (order.X === 'EXPIRED' || order.X === 'CANCELED') {
    // A market order can expire after a partial fill; its filled part still traded at the average price.
    const partialPrice = compareDecimalStrings(order.z, '0') === 1 ? normalizeDecimalString(order.ap) : null;
    if (partialPrice && compareDecimalStrings(partialPrice, '0') === 1) {
      entry.status = 'filled';
      entry.fillPrice = partialPrice;
      return entry;
    }
    entry.status = 'unfilled';
    for (const sample of Object.values(entry.samples)) sample.state = 'unavailable';
  }
  return null;
}

/** A null price records that the market could not be read for this symbol at that time. */
export function recordTakerSample(stats, clientOrderId, horizon, price) {
  const entry = stats.entries.find(item => item.clientOrderId === clientOrderId);
  if (!entry || entry.status !== 'filled') return;
  const sample = entry.samples[horizon];
  if (!sample || sample.state !== 'pending') return;
  const normalized = normalizeDecimalString(price);
  if (!normalized) {
    sample.state = 'unavailable';
    return;
  }
  const comparison = compareDecimalStrings(normalized, entry.fillPrice);
  const favorableSign = stats.positionSide === 'LONG' ? 1 : -1;
  sample.price = normalized;
  sample.state = comparison === 0 ? 'flat' : comparison === favorableSign ? 'favorable' : 'unfavorable';
}

function countSamples(entries, horizon) {
  const counts = { favorable: 0, unfavorable: 0, flat: 0, unavailable: 0, pending: 0 };
  for (const entry of entries) {
    if (entry.status === 'unfilled') continue;
    counts[entry.samples[horizon].state] += 1;
  }
  return counts;
}

const SAMPLE_LABELS = Object.freeze({
  favorable: ['有利', 'favorable'],
  unfavorable: ['不利', 'unfavorable'],
  flat: ['持平', 'flat'],
  unavailable: ['无数据', 'no data'],
  pending: ['统计中', 'pending'],
});

/** Always four lines, whatever the number of orders, for the taker title tooltip. */
export function formatTakerStatsLines(stats, locale) {
  const zh = locale === 'zh-CN';
  const filled = stats.entries.filter(entry => entry.status === 'filled');
  const favorableSign = stats.positionSide === 'LONG' ? 1 : -1;
  let advancing = 0;
  for (let index = 1; index < filled.length; index += 1) {
    if (compareDecimalStrings(filled[index].fillPrice, filled[index - 1].fillPrice) === favorableSign) advancing += 1;
  }
  const unfilled = stats.entries.filter(entry => entry.status === 'unfilled').length;
  const higher = stats.positionSide === 'LONG';
  const totalLine = zh
    ? `共 ${stats.entries.length} 笔，成交价逐笔走${higher ? '高' : '低'} ${advancing} 次${unfilled ? ` · 未成交 ${unfilled}` : ''}`
    : `${stats.entries.length} orders · ${advancing} fill ${higher ? 'above' : 'below'} the previous${unfilled ? ` · ${unfilled} unfilled` : ''}`;
  const sampleLine = horizon => {
    const counts = countSamples(stats.entries, horizon);
    const parts = Object.entries(counts)
      .filter(([, count]) => count > 0)
      .map(([state, count]) => `${SAMPLE_LABELS[state][zh ? 0 : 1]} ${count}`);
    return zh ? `${horizon} 秒后：${parts.join(' · ') || '无'}` : `After ${horizon}s: ${parts.join(' · ') || 'none'}`;
  };
  return [
    zh ? `吃单统计 · ${formatLocalizedText(stats.label, locale)}` : `Taker stats · ${formatLocalizedText(stats.label, locale)}`,
    totalLine,
    ...TAKER_SAMPLE_HORIZONS_SECONDS.map(sampleLine),
  ];
}
