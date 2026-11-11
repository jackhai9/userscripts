import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateLadderTakerOrders,
  createTakerCarry,
  returnUnspentTakerOrders,
  validateMarketOrderQty,
  isConfirmedTakerRejection,
  matchPlaceOrderRequest,
  createTakerStats,
  recordTakerSubmitted,
  applyTakerOrderUpdate,
  recordTakerSample,
  formatTakerStatsLines,
} from '../../../src/binance-orderbook-trade/core/ladder-taker.js';
import { localizedText } from '../../../src/shared/ui-locale.js';

test('user gets at least one taker order in a one-round ladder whenever a ratio is selected', () => {
  // Given one-round ladders with three or five levels
  const cases = [[3, 0, 0], [3, 20, 1], [3, 50, 1], [3, 80, 2], [5, 20, 1], [5, 50, 2], [5, 80, 4], [1, 80, 1]];

  // When each ratio is allocated without a session carry
  const counts = cases.map(([levels, percent]) => allocateLadderTakerOrders({ levels, percent }));

  // Then the count is the floored share, raised to one for any nonzero ratio
  assert.deepEqual(counts, cases.map(([, , expected]) => expected));
});

test('user sees a continuous session carry fractional taker orders so the session matches the ratio', () => {
  // Given a continuous session with three levels per round at 20%
  const carry = createTakerCarry();

  // When ten rounds are allocated
  const counts = Array.from({ length: 10 }, () => allocateLadderTakerOrders({ levels: 3, percent: 20, carry }));

  // Then six taker orders are spread over thirty orders, never two in one round
  assert.deepEqual(counts, [0, 1, 0, 1, 1, 0, 1, 0, 1, 1]);
  assert.equal(counts.reduce((sum, count) => sum + count, 0), 6);
});

test('user restarts the carry when the ratio changes and turning taker off discards it', () => {
  // Given a session that owes part of a taker order at 50%
  const carry = createTakerCarry();
  assert.equal(allocateLadderTakerOrders({ levels: 3, percent: 50, carry }), 1);

  // When the user switches to 80%, then to 关, then back to 80%
  const after80 = allocateLadderTakerOrders({ levels: 3, percent: 80, carry });
  const off = allocateLadderTakerOrders({ levels: 3, percent: 0, carry });
  const resumed = allocateLadderTakerOrders({ levels: 3, percent: 80, carry });

  // Then 80% starts from zero and 关 leaves nothing owed
  assert.deepEqual([after80, off, resumed], [2, 0, 2]);
});

test('user never gets more market orders in a round than the selected share after repeated failed rounds', () => {
  // Given a 20% session whose rounds keep failing before any click
  const carry = createTakerCarry();
  const failed = [];
  for (let round = 0; round < 6; round += 1) {
    const count = allocateLadderTakerOrders({ levels: 3, percent: 20, carry });
    failed.push(count);
    returnUnspentTakerOrders(carry, count);
  }

  // When the session recovers and runs five rounds
  const recovered = Array.from({ length: 5 }, () => allocateLadderTakerOrders({ levels: 3, percent: 20, carry }));

  // Then no round exceeds one of three orders, and at most one owed order survives the failures
  assert.ok([...failed, ...recovered].every(count => count <= 1));
  assert.deepEqual(recovered, [1, 1, 0, 1, 1]);
});

test('user is told why a quantity cannot be sent as a market order', () => {
  // Given the symbol's market lot rules
  const rules = { minQty: '0.1', stepSize: '0.1', maxQty: '100' };

  // When planned quantities are checked
  const results = ['0.3', '0.05', '0.35', '120', '100'].map(qty => validateMarketOrderQty(qty, rules));

  // Then only quantities inside the min, step, and max rules are accepted
  assert.deepEqual(results.map(result => result.ok), [true, false, false, false, true]);
  assert.deepEqual(results.filter(result => !result.ok).map(result => result.reason), ['below_min', 'off_step', 'above_max']);
  assert.deepEqual(validateMarketOrderQty('1', { minQty: '1', stepSize: null, maxQty: '10' }), { ok: false, reason: 'rules_missing' });
});

const marketBody = {
  symbol: 'JCTUSDT', type: 'MARKET', side: 'SELL', positionSide: 'LONG', quantity: 1,
  newClientOrderId: 'web_abc', placeType: 'order-form',
};
const takerExpectation = { kind: 'taker', symbol: 'JCTUSDT', side: 'SELL', positionSide: 'LONG', quantity: '1' };

test('user lets only the exact planned market order through as a taker request', () => {
  // Given the observed native market close-long request body
  const body = JSON.stringify(marketBody);

  // When it is matched against the planned taker order
  const result = matchPlaceOrderRequest(body, takerExpectation);

  // Then it is accepted and its client order ID is kept for fill tracking
  assert.deepEqual(result, { ok: true, clientOrderId: 'web_abc' });
});

for (const [name, change, reason] of [
  ['a limit order', { type: 'LIMIT' }, 'type'],
  ['another symbol', { symbol: 'BTCUSDT' }, 'symbol'],
  ['the opposite side', { side: 'BUY' }, 'side'],
  ['a one-way position', { positionSide: 'BOTH' }, 'positionSide'],
  ['a different quantity', { quantity: 2 }, 'quantity'],
  ['a missing client order ID', { newClientOrderId: undefined }, 'clientOrderId'],
]) {
  test(`user blocks a taker request with ${name}`, () => {
    // Given a request body that differs from the planned market order
    const body = JSON.stringify({ ...marketBody, ...change });

    // When it is matched
    const result = matchPlaceOrderRequest(body, takerExpectation);

    // Then it is refused with the mismatching field
    assert.deepEqual(result, { ok: false, reason });
  });
}

test('user blocks a maker request that would be sent as a market order', () => {
  // Given maker expectations and two request bodies
  const maker = { kind: 'maker' };

  // When a limit body, a market body, and unreadable bodies are matched
  const results = [
    matchPlaceOrderRequest(JSON.stringify({ ...marketBody, type: 'LIMIT' }), maker),
    matchPlaceOrderRequest(JSON.stringify(marketBody), maker),
    matchPlaceOrderRequest('not json', maker),
    matchPlaceOrderRequest(undefined, maker),
  ];

  // Then only the limit body passes
  assert.deepEqual(results, [
    { ok: true, clientOrderId: 'web_abc' },
    { ok: false, reason: 'type' },
    { ok: false, reason: 'body' },
    { ok: false, reason: 'body' },
  ]);
});

test('user accepts a decimal quantity sent as a JSON number', () => {
  // Given a market body with a small numeric quantity
  const body = JSON.stringify({ ...marketBody, quantity: 0.0000001 });

  // When it is matched against the decimal string plan
  const result = matchPlaceOrderRequest(body, { ...takerExpectation, quantity: '0.0000001' });

  // Then the exponent-formatted number equals the plan
  assert.equal(result.ok, true);
});

function fill(clientOrderId, price, extra = {}) {
  return { s: 'JCTUSDT', S: 'SELL', ps: 'LONG', c: clientOrderId, o: 'MARKET', x: 'TRADE', X: 'FILLED', ap: price, z: '1', ...extra };
}

test('user sees a compact four-line summary of taker fills and later price moves', () => {
  // Given a close-long session with three market orders
  const stats = createTakerStats({ label: localizedText('连续阶梯平多', 'Continuous close long'), positionSide: 'LONG' });
  for (const id of ['a', 'b', 'c']) recordTakerSubmitted(stats, { clientOrderId: id, symbol: 'JCTUSDT', side: 'SELL', positionSide: 'LONG' });

  // When fills arrive with rising prices, and later prices are sampled
  applyTakerOrderUpdate(stats, fill('a', '0.005'));
  applyTakerOrderUpdate(stats, fill('b', '0.0051', { X: 'PARTIALLY_FILLED' }));
  applyTakerOrderUpdate(stats, fill('b', '0.0052'));
  applyTakerOrderUpdate(stats, fill('c', '0.0051'));
  recordTakerSample(stats, 'a', 5, '0.0052');
  recordTakerSample(stats, 'b', 5, '0.0050');
  recordTakerSample(stats, 'c', 5, '0.0051');
  recordTakerSample(stats, 'a', 30, '0.0053');
  recordTakerSample(stats, 'b', 30, null);

  // Then the summary counts rising fills and favorable moves for a long position
  assert.deepEqual(formatTakerStatsLines(stats, 'zh-CN'), [
    '吃单统计 · 连续阶梯平多',
    '共 3 笔，成交价逐笔走高 1 次',
    '5 秒后：有利 1 · 不利 1 · 持平 1',
    '30 秒后：有利 1 · 无数据 1 · 统计中 1',
  ]);
});

test('user sees short-position fills judged in the opposite direction and unfilled orders counted', () => {
  // Given a close-short session with two buys, one of which expires
  const stats = createTakerStats({ label: localizedText('连续阶梯平空', 'Continuous close short'), positionSide: 'SHORT' });
  for (const id of ['a', 'b', 'c']) recordTakerSubmitted(stats, { clientOrderId: id, symbol: 'JCTUSDT', side: 'BUY', positionSide: 'SHORT' });

  // When fills, an expiry, and an unrelated frame arrive
  applyTakerOrderUpdate(stats, fill('a', '0.006', { S: 'BUY', ps: 'SHORT' }));
  applyTakerOrderUpdate(stats, fill('b', '0.005', { S: 'BUY', ps: 'SHORT' }));
  applyTakerOrderUpdate(stats, fill('c', '0', { S: 'BUY', ps: 'SHORT', x: 'EXPIRED', X: 'EXPIRED', z: '0' }));
  applyTakerOrderUpdate(stats, fill('a', '0.001', { S: 'SELL' }));
  recordTakerSample(stats, 'a', 5, '0.0059');
  recordTakerSample(stats, 'b', 5, '0.0051');

  // Then lower fills and lower later prices are favorable, and the expiry is reported
  assert.deepEqual(formatTakerStatsLines(stats, 'en'), [
    'Taker stats · Continuous close short',
    '3 orders · 1 fill below the previous · 1 unfilled',
    'After 5s: favorable 1 · unfavorable 1',
    'After 30s: pending 2',
  ]);
});

const settled = (httpStatus, payload, code) => ({
  responseDiagnostics: [{ httpStatus, bodyKind: 'json', payloadSummary: payload }],
  apiErrors: code === null ? [] : [{ code, success: payload.success }],
  apiSuccesses: [],
});

test('user retries a market order slot only after one definite exchange rejection', () => {
  // Given settled responses with different evidence
  const cases = [
    settled(200, { success: false, code: '90802022' }, 90802022),
    settled(503, { success: false, code: '90802022' }, 90802022),
    settled(200, { success: false, code: '-1007' }, -1007),
    settled(200, { success: false, code: '-1000' }, -1000),
    settled(200, { success: true }, null),
    { responseDiagnostics: [], apiErrors: [], apiSuccesses: [] },
    { ...settled(200, { success: false, code: '90802022' }, 90802022), responseDiagnostics: [
      { httpStatus: 200, bodyKind: 'json', payloadSummary: { success: false } },
      { httpStatus: 200, bodyKind: 'json', payloadSummary: { success: false } },
    ] },
  ];

  // When each is classified
  const confirmed = cases.map(isConfirmedTakerRejection);

  // Then only the 2xx rejection with a definite code is a non-submission
  assert.deepEqual(confirmed, [true, false, false, false, false, false, false]);
});

test('user sees a market order that expired after a partial fill counted at its average price', () => {
  // Given a pending close-long market order
  const stats = createTakerStats({ label: localizedText('阶梯平多', 'Close long'), positionSide: 'LONG' });
  recordTakerSubmitted(stats, { clientOrderId: 'a', symbol: 'JCTUSDT', side: 'SELL', positionSide: 'LONG' });

  // When it expires after part of it traded
  const filled = applyTakerOrderUpdate(stats, fill('a', '0.0052', { x: 'EXPIRED', X: 'EXPIRED', z: '0.4' }));

  // Then the filled part counts as a fill with that price
  assert.equal(filled.fillPrice, '0.0052');
  assert.equal(formatTakerStatsLines(stats, 'zh-CN')[1], '共 1 笔，成交价逐笔走高 0 次');
});
