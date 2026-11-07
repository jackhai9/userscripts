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
