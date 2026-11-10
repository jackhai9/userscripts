import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createNativeCancelReceipts } from '../../../src/binance-orderbook-trade/core/capacity-cancel-receipts.js';

const first = { symbol: 'AINUSDT', orderId: 11, clientOrderId: 'one' };
const second = { symbol: 'AINUSDT', orderId: 12, clientOrderId: 'two' };
const receipt = order => Response.json({ code: '000000', success: true, data: { ...order, status: 'CANCELED' } });

test('user attributes reversed cancellation receipts only to their original orders', async () => {
  // Given two distinct orders await native cancellation.
  const receipts = createNativeCancelReceipts(12000);
  const a = receipts.expect(first);
  const b = receipts.expect(second);
  const delayed = Promise.withResolvers();

  // When the second response is returned first, and the first request receives its neighbor's response.
  receipts.observe(JSON.stringify(first), delayed.promise);
  receipts.observe(JSON.stringify(second), Promise.resolve(receipt(second)));
  const secondConfirmed = await b.result;
  delayed.resolve(receipt(second));

  // Then only the second order was confirmed.
  assert.equal(secondConfirmed, true);
  assert.equal(await a.result, false);
});

test('user leaves a timed out cancellation unconfirmed even if its late success arrives', async t => {
  // Given a native cancellation request outlives its receipt deadline.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const receipts = createNativeCancelReceipts(12000);
  const ticket = receipts.expect(first);
  const delayed = Promise.withResolvers();
  receipts.observe(JSON.stringify(first), delayed.promise);

  // When the response arrives only after the deadline.
  t.mock.timers.tick(12000);
  delayed.resolve(receipt(first));

  // Then the operation retains its unknown result.
  assert.equal(await ticket.result, false);
  assert.equal(ticket.hasStarted, true);
});

test('user drains both native requests without counting an ambiguous duplicate cancellation', async () => {
  // Given Binance starts two requests for the same expected identity.
  const receipts = createNativeCancelReceipts(12000);
  const ticket = receipts.expect(first);
  const one = Promise.withResolvers();
  const two = Promise.withResolvers();
  receipts.observe(JSON.stringify(first), one.promise);
  receipts.observe(JSON.stringify(first), two.promise);

  // When only one of the requests has returned its cancellation.
  one.resolve(new Response(null, { status: 503 }));
  await setImmediate();
  const firstOutcome = await Promise.race([ticket.result, Promise.resolve('pending')]);

  // Then subsequent clicks are blocked while the other request is outstanding.
  assert.equal(firstOutcome, 'pending');
  assert.equal(receipts.admissionClosed, true);

  // When the second native response arrives.
  two.resolve(receipt(first));

  // Then neither response counts as one uniquely attributable cancellation.
  assert.equal(await ticket.result, false);
});

const quantity = { origQty: '1.00000001', executedQty: '0.1' };
const terminal = { s: first.symbol, i: first.orderId, c: first.clientOrderId,
  x: 'CANCELED', X: 'CANCELED', q: '1.00000001', z: '0.10000001' };

test('user releases only the exact unfilled quantity regardless of terminal event delivery before HTTP', async () => {
  // Given one cancellation is pending for a partly filled order.
  const receipts = createNativeCancelReceipts(12000);
  const ticket = receipts.expect(first, quantity);
  const delayed = Promise.withResolvers();
  receipts.observe(JSON.stringify(first), delayed.promise);

  // When the final fill quantity arrives twice before its matching HTTP response.
  receipts.observeOrderUpdate(terminal);
  receipts.observeOrderUpdate(terminal);
  delayed.resolve(receipt(first));

  // Then the single receipt releases only the remaining decimal quantity.
  assert.equal(await ticket.result, true);
  assert.equal(await ticket.released, '0.9');
});

test('user drains a second HTTP request without granting quantity when it starts before the terminal event', async () => {
  // Given the first receipt confirmed but its account update is still pending.
  const receipts = createNativeCancelReceipts(12000);
  const ticket = receipts.expect(first, quantity);
  receipts.observe(JSON.stringify(first), Promise.resolve(receipt(first)));
  assert.equal(await ticket.result, true);

  // When a second request starts, the matching terminal event arrives, and Stop closes the quantity wait.
  const secondRequest = Promise.withResolvers();
  receipts.observe(JSON.stringify(first), secondRequest.promise);
  receipts.observeOrderUpdate(terminal);
  ticket.stopQuantityWait();

  // Then the ambiguous request is drained before the task closes, with zero authorized quantity.
  assert.equal(await Promise.race([ticket.released, Promise.resolve('pending')]), 'pending');
  assert.equal(receipts.admissionClosed, true);
  secondRequest.resolve(receipt(first));
  assert.equal(await ticket.released, null);
});

for (const [reason, change] of [
  ['a different symbol', { s: 'BTCUSDT' }], ['a different order', { i: 12 }],
  ['a different client ID', { c: 'foreign' }], ['a fill execution', { x: 'TRADE' }],
  ['a filled order', { X: 'FILLED' }], ['a missing original amount', { q: undefined }],
  ['an amended original quantity', { q: '2' }], ['a negative total fill', { z: '-1' }],
  ['a fill lower than the preflight', { z: '0' }], ['an excess fill', { z: '2' }],
]) {
  test(`user keeps the HTTP count without granting replacement quantity for ${reason}`, async t => {
    // Given the HTTP result already confirms a cancellation.
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const receipts = createNativeCancelReceipts(12000);
    const ticket = receipts.expect(first, quantity);
    receipts.observe(JSON.stringify(first), Promise.resolve(receipt(first)));
    assert.equal(await ticket.result, true);

    // When an unusable account event arrives, the original request deadline expires, and a valid event arrives late.
    receipts.observeOrderUpdate({ ...terminal, ...change });
    t.mock.timers.tick(12000);
    receipts.observeOrderUpdate(terminal);

    // Then the confirmed cancellation never grants a replacement quantity.
    assert.equal(await ticket.released, null);
  });
}

const fill = { s: first.symbol, i: first.orderId, c: first.clientOrderId,
  x: 'TRADE', X: 'FILLED', q: '1.00000001', z: '1.00000001' };

test('user proves a lost cancellation race only with the exact whole-order fill, in any arrival order', async () => {
  // Given one batch starts from a fill seen before it, one saw the fill before the lookup, and one sees it after.
  const prior = createNativeCancelReceipts(12000, [fill]);
  const early = createNativeCancelReceipts(12000);
  early.observeOrderUpdate(fill);
  const late = createNativeCancelReceipts(12000);
  const pending = late.filled(first, quantity);

  // When the fill reaches the second batch.
  late.observeOrderUpdate(fill);

  // Then every batch attributes the fill to that order.
  assert.equal(await prior.filled(first, quantity), true);
  assert.equal(await early.filled(first, quantity), true);
  assert.equal(await pending, true);
});

for (const [reason, change] of [
  ['a partial fill', { X: 'PARTIALLY_FILLED', z: '0.5' }], ['a fill below the original amount', { z: '0.9' }],
  ['an amended original quantity', { q: '2', z: '2' }], ['a different order', { i: 12 }],
  ['a different client ID', { c: 'foreign' }], ['a different symbol', { s: 'BTCUSDT' }],
  ['a cancellation frame', { x: 'CANCELED', X: 'CANCELED' }], ['a malformed amount', { z: '1e0' }],
  ['a liquidation frame', { x: 'CALCULATED' }],
]) {
  test(`user does not treat ${reason} as proof that the order filled`, async () => {
    // Given a batch awaits fill evidence for one order.
    const receipts = createNativeCancelReceipts(12000);
    const pending = receipts.filled(first, quantity);

    // When only a non-qualifying account frame arrives.
    receipts.observeOrderUpdate({ ...fill, ...change });
    await setImmediate();

    // Then the evidence remains absent.
    assert.equal(await Promise.race([pending, Promise.resolve('absent')]), 'absent');
  });
}

for (const [name, response, expected] of [
  ['a rejected cancellation', () => Response.json({ success: false, code: '-2011', data: null }), 'response code -2011 status undefined'],
  ['an HTTP failure', () => new Response(null, { status: 503 }), 'HTTP 503'],
  ['an unreadable body', () => new Response('not json', { status: 200 }), 'unreadable response SyntaxError'],
  ['a transport failure', () => Promise.reject(new TypeError('Failed to fetch')), 'no response TypeError'],
  ['a success for another order', () => receipt(second), 'response for another order'],
]) {
  test(`user can see why a cancellation stayed unconfirmed after ${name}`, async () => {
    // Given one native cancellation request is in flight.
    const receipts = createNativeCancelReceipts(12000);
    const ticket = receipts.expect(first);

    // When its response is not a matching success.
    receipts.observe(JSON.stringify(first), Promise.resolve(response()));

    // Then the result is unconfirmed and names the reason.
    assert.equal(await ticket.result, false);
    assert.equal(ticket.failure, expected);
  });
}

test('user can see that a cancellation stayed unconfirmed because its response timed out', async t => {
  // Given a native cancellation request never returns.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const receipts = createNativeCancelReceipts(12000);
  const ticket = receipts.expect(first);
  receipts.observe(JSON.stringify(first), new Promise(() => {}));

  // When the receipt deadline passes.
  t.mock.timers.tick(12000);

  // Then the timeout is recorded as the reason.
  assert.equal(await ticket.result, false);
  assert.equal(ticket.failure, 'response timeout');
});

test('user can see that a confirmed cancellation stayed unreleased because its account event timed out', async t => {
  // Given the HTTP response confirmed a quantity-tracked cancellation.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const receipts = createNativeCancelReceipts(12000);
  const ticket = receipts.expect(first, quantity);
  receipts.observe(JSON.stringify(first), Promise.resolve(receipt(first)));
  assert.equal(await ticket.result, true);

  // When no terminal account event arrives before the deadline.
  t.mock.timers.tick(12000);

  // Then no quantity is released and the reason names the missing account event.
  assert.equal(await ticket.released, null);
  assert.equal(ticket.failure, 'account event timeout');
});
