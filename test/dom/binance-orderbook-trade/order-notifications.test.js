import assert from 'node:assert/strict';
import test from 'node:test';

import {
  attachNativeOrderEventHost,
  createNativeNotificationModules,
  createNativeOrderDecoder,
  createNotificationHarness,
  createNotificationStreams,
  ordinaryNotificationOrder,
} from '../../helpers/binance-order-notifications.js';

test('user receives no foreign-symbol order toast or sound in a futures tab', async (t) => {
  // Given the active futures page displays BTC while native reminders are enabled
  const harness = await createNotificationHarness(t);
  const order = ordinaryNotificationOrder({ symbol: 'ETHUSDT' });

  // When the native order event and sound stream deliver another symbol
  await harness.notify(order);
  await harness.advance(30);
  await harness.advance(470);

  // Then the current tab has no unrelated visual or audible reminder
  assert.deepEqual({ toasts: harness.toasts, audio: harness.audio }, { toasts: [], audio: [] });
});

test('user host fixture reproduces the native foreign-symbol toast and sound', async (t) => {
  // Given the captured unmodified factories run in the real React host
  const harness = await createNotificationHarness(t, { patched: false, inspectSoundQueue: true });
  const order = ordinaryNotificationOrder({ symbol: 'ETHUSDT' });

  // When an unrelated native order completes through the SDK and cached-order adapter
  await harness.notify(order);
  await harness.advance(500);

  // Then the baseline delivers its original message and string queue entry without filtering
  assert.deepEqual(harness.toasts, [{ message: 'LIMIT BUY Order Filled', options: { variant: 'success' } }]);
  assert.deepEqual(harness.audio.map((event) => event.kind), ['load', 'play', 'play']);
  assert.deepEqual(harness.queueSnapshot(), ['42']);
  assert.deepEqual(harness.nativeHost.orders(), []);
});

test('user receives the current-symbol toast and sound at the original native deadlines', async (t) => {
  // Given native notifications are enabled for the displayed futures symbol
  const harness = await createNotificationHarness(t);

  // When a current-symbol fill arrives just before the native toast deadline
  await harness.notify(ordinaryNotificationOrder());
  await harness.advance(29);

  // Then both native presentation boundaries are still idle
  assert.deepEqual(harness.toasts, []);
  assert.deepEqual(harness.audio, []);

  // When the native thirty-millisecond toast deadline is reached
  await harness.advance(1);

  // Then the native message is enqueued with its success variant
  assert.deepEqual(harness.toasts, [{ message: 'LIMIT BUY Order Filled', options: { variant: 'success' } }]);
  assert.deepEqual(harness.audio, []);

  // When the sound debounce remains one millisecond short
  await harness.advance(469);

  // Then audio has not played early
  assert.deepEqual(harness.audio, []);

  // When the original five-hundred-millisecond sound deadline is reached
  await harness.advance(1);

  // Then native audio loading and both native play calls remain intact
  assert.deepEqual(harness.audio.map((event) => event.kind), ['load', 'play', 'play']);
});

for (const variantChunk of ['37511', '24132', '57898', '57276', '76905', '49426']) {
  test(`user receives only current-symbol toasts with native chunk ${variantChunk}`, async (t) => {
    // Given this captured native toast variant is mounted with sound disabled
    const harness = await createNotificationHarness(t, { variantChunk, soundEnabled: false });

    // When a foreign fill and then a current-symbol cancellation arrive
    await harness.notify(ordinaryNotificationOrder({ symbol: 'ETHUSDT' }));
    await harness.advance(30);
    await harness.notify(ordinaryNotificationOrder({ status: 'CANCELED', orderId: 43 }));
    await harness.advance(30);

    // Then only the native cancellation text is delivered
    assert.deepEqual(harness.toasts, [{ message: 'LIMIT BUY Order Canceled', options: undefined }]);
    assert.deepEqual(harness.audio, []);
  });
}

for (const symbol of ['BTCUSDT', 'ETHUSDT']) {
  test(`user sees reminders only for ${symbol} in an independently mounted futures page`, async (t) => {
    // Given this page has its own route, native state and notification provider
    const harness = await createNotificationHarness(t, { pathname: `/en/futures/${symbol}` });
    const foreignSymbol = symbol === 'BTCUSDT' ? 'ETHUSDT' : 'BTCUSDT';

    // When both account symbols deliver their native completion events
    await harness.notify(ordinaryNotificationOrder({ symbol: foreignSymbol, orderId: 43 }));
    await harness.advance(500);
    await harness.notify(ordinaryNotificationOrder({ symbol }));
    await harness.advance(500);

    // Then this page presents exactly its own order reminder
    assert.equal(harness.toasts.length, 1);
    assert.deepEqual(harness.audio, [
      { kind: 'load', pathname: `/en/futures/${symbol}` },
      { kind: 'play', pathname: `/en/futures/${symbol}` },
      { kind: 'play', pathname: `/en/futures/${symbol}` },
    ]);
  });
}

test('user filters ordinary coin-margined events received by a USDT futures tab', async (t) => {
  // Given native hooks subscribe to both account streams on the BTCUSDT page
  const harness = await createNotificationHarness(t);

  // When the coin-margined stream delivers an ordinary BTCUSD perpetual fill
  await harness.notify(ordinaryNotificationOrder({ symbol: 'BTCUSD_PERP' }), { isCM: true });
  await harness.advance(500);

  // Then neither toast nor audio leaks from that other symbol
  assert.deepEqual({ toasts: harness.toasts, audio: harness.audio }, { toasts: [], audio: [] });
  assert.equal(harness.streams.subscriptions.some((entry) => entry.isCM), true);
});

test('user keeps native reminders on a coin-margined route outside supported USD-M routes', async (t) => {
  // Given the loaded host displays a coin-margined route the USD-M parser does not recognize
  const harness = await createNotificationHarness(t, { pathname: '/en/futures/BTCUSD_PERP' });

  // When that native coin-margined order fills
  await harness.notify(ordinaryNotificationOrder({ symbol: 'BTCUSD_PERP' }), { isCM: true });
  await harness.advance(500);

  // Then the matching symbol keeps the original toast and native sound
  assert.deepEqual(harness.toasts, [{ message: 'LIMIT BUY Order Filled', options: { variant: 'success' } }]);
  assert.deepEqual(harness.audio.map((event) => event.kind), ['load', 'play', 'play']);
});

for (const outcome of [
  { status: 'PARTIALLY_FILLED', operate: 'TRADE', text: 'Partially Filled', sound: true },
  { status: 'EXPIRED', operate: 'EXPIRED', text: 'Canceled', sound: true },
  { status: 'EXPIRED_IN_MATCH', operate: 'EXPIRED', text: 'Canceled', sound: false },
]) {
  test(`user retains native ${outcome.status} reminders only for the current symbol`, async (t) => {
    // Given the current and foreign orders have the same native execution outcome
    const harness = await createNotificationHarness(t);
    const nativeEvent = { status: outcome.status, operate: outcome.operate };

    // When the foreign event is followed by the matching-symbol event
    await harness.notify(ordinaryNotificationOrder({ ...nativeEvent, symbol: 'ETHUSDT', orderId: 43 }));
    await harness.advance(500);
    await harness.notify(ordinaryNotificationOrder(nativeEvent));
    await harness.advance(500);

    // Then only the matching-symbol event keeps the original status-specific presentation
    assert.deepEqual(harness.toasts.map((toast) => toast.message), [`LIMIT BUY Order ${outcome.text}`]);
    assert.deepEqual(harness.audio.map((event) => event.kind), outcome.sound ? ['load', 'play', 'play'] : []);
  });
}

for (const types of ['LIMIT', 'MARKET', 'STOP', 'STOP_MARKET', 'TAKE_PROFIT', 'TAKE_PROFIT_MARKET', 'TRAILING_STOP_MARKET']) {
  test(`user filters foreign-symbol ordinary ${types} reminders`, async (t) => {
    // Given the order carries one of the observed ordinary Binance type discriminators
    const harness = await createNotificationHarness(t);
    const order = ordinaryNotificationOrder({ symbol: 'ETHUSDT', type: types, orderType: types, origType: types });

    // When its completion reaches the real native toast and audio paths
    await harness.notify(order);
    await harness.advance(500);

    // Then this ordinary foreign-symbol event has no visible or audible effect
    assert.deepEqual({ toasts: harness.toasts, audio: harness.audio }, { toasts: [], audio: [] });
  });
}

for (const isCM of [false, true]) {
  test(`user keeps the matching sound when a native ${isCM ? 'CM' : 'UM'} batch ends with another symbol`, async (t) => {
    // Given a single native batch contains a matching event followed by a foreign event
    const harness = await createNotificationHarness(t);
    const matching = ordinaryNotificationOrder();
    const foreign = ordinaryNotificationOrder({ symbol: 'ETHUSDT', orderId: 43 });

    // When the account stream delivers both events during the same debounce window
    await harness.emitStream([matching, foreign], { isCM });
    await harness.advance(500);

    // Then filtering does not let the unrelated trailing event erase the matching sound
    assert.deepEqual(harness.audio.map((event) => event.kind), ['load', 'play', 'play']);
  });
}

for (const risk of [
  { name: 'liquidation type', fields: { type: 'LIQUIDATION', orderType: 'LIQUIDATION' }, toast: false },
  { name: 'calculated execution', fields: { operate: 'CALCULATED' }, toast: true },
  { name: 'autoclose client identifier', fields: { clientOrderId: 'autoclose-123' }, toast: true },
  { name: 'ADL client identifier', fields: { clientOrderId: 'adl_autoclose-123' }, toast: true },
  { name: 'settlement client identifier', fields: { clientOrderId: 'settlement_autoclose-123' }, toast: true },
]) {
  test(`user retains native risk behavior for a foreign-symbol ${risk.name}`, async (t) => {
    // Given a foreign symbol carries this native risk discriminator
    const harness = await createNotificationHarness(t);
    const order = ordinaryNotificationOrder({ symbol: 'ETHUSDT', ...risk.fields });

    // When the risk event reaches both captured native presentation paths
    await harness.notify(order);
    await harness.advance(500);

    // Then filtering preserves the original risk toast policy and native sound
    assert.equal(harness.toasts.length, risk.toast ? 1 : 0);
    assert.deepEqual(harness.audio.map((event) => event.kind), ['load', 'play', 'play']);
  });
}

for (const unknown of [
  { name: 'missing client identifier', fields: { clientOrderId: undefined } },
  { name: 'missing symbol', fields: { symbol: undefined } },
  { name: 'malformed symbol', fields: { symbol: 'ETH/USDT' } },
  { name: 'unknown order type', fields: { type: 'UNRECOGNIZED', orderType: 'UNRECOGNIZED' } },
  { name: 'unknown original type', fields: { origType: 'UNRECOGNIZED' } },
  { name: 'unknown execution operation', fields: { operate: 'UNRECOGNIZED' } },
]) {
  test(`user retains native reminders for an order with ${unknown.name}`, async (t) => {
    // Given an event cannot be proven to be an ordinary foreign-symbol order
    const harness = await createNotificationHarness(t);
    const order = ordinaryNotificationOrder({ symbol: 'ETHUSDT', ...unknown.fields });

    // When the uncertain payload arrives through both original native paths
    await harness.notify(order);
    await harness.advance(500);

    // Then its native toast and audio behavior remain visible
    assert.equal(harness.toasts.length, 1);
    assert.deepEqual(harness.audio.map((event) => event.kind), ['load', 'play', 'play']);
  });
}

for (const preferences of [
  { toastEnabled: false, soundEnabled: true },
  { toastEnabled: true, soundEnabled: false },
  { toastEnabled: false, soundEnabled: false },
]) {
  test(`user keeps native reminder preferences toast=${preferences.toastEnabled} sound=${preferences.soundEnabled}`, async (t) => {
    // Given real native preference hooks initialize with the selected switches
    const harness = await createNotificationHarness(t, preferences);

    // When the displayed symbol fills after preference initialization
    await harness.notify(ordinaryNotificationOrder());
    await harness.advance(500);

    // Then each original native switch independently controls its presentation
    assert.equal(harness.toasts.length, preferences.toastEnabled ? 1 : 0);
    assert.deepEqual(harness.audio.map((event) => event.kind), preferences.soundEnabled ? ['load', 'play', 'play'] : []);
  });
}

test('user sees no stale toast after switching symbol during the native toast delay', async (t) => {
  // Given a current-symbol fill is waiting in the native thirty-millisecond throttle
  const harness = await createNotificationHarness(t);
  await harness.notify(ordinaryNotificationOrder());
  await harness.advance(29);

  // When the page switches symbols before the pending notification is enqueued
  harness.navigate('/en/futures/ETHUSDT');
  await harness.advance(1);
  await harness.advance(470);

  // Then both delayed presentation paths recheck the current route
  assert.deepEqual({ toasts: harness.toasts, audio: harness.audio }, { toasts: [], audio: [] });
});

test('user hears no stale audio after switching symbol during the native sound delay', async (t) => {
  // Given a current-symbol fill has shown its toast but audio has not started
  const harness = await createNotificationHarness(t);
  await harness.notify(ordinaryNotificationOrder());
  await harness.advance(499);
  assert.equal(harness.toasts.length, 1);

  // When the page switches symbols before the native audio deadline
  harness.navigate('/en/futures/ETHUSDT');
  await harness.advance(1);

  // Then the old symbol cannot begin playback on the new page
  assert.deepEqual(harness.audio, []);
});

test('user keeps the new-symbol audio queued when the previous-symbol cooldown completes', async (t) => {
  // Given BTC has started native audio and owns the active cooldown
  const harness = await createNotificationHarness(t);
  await harness.notify(ordinaryNotificationOrder());
  await harness.advance(500);
  assert.deepEqual(harness.audio.map((event) => event.kind), ['load', 'play', 'play']);

  // When the user switches to ETH and its fill queues during the BTC cooldown
  harness.navigate('/en/futures/ETHUSDT');
  await harness.notify(ordinaryNotificationOrder({ symbol: 'ETHUSDT', orderId: 43, clientOrderId: 'manual-43' }));
  await harness.advance(500);
  await harness.advance(1499);

  // Then the original cooldown has not played a second notification early
  assert.equal(harness.audio.filter((event) => event.kind === 'load').length, 1);

  // When the original two-second cooldown completes
  await harness.advance(1);

  // Then it consumes only the played BTC token and ETH still receives its own audio
  assert.deepEqual(harness.audio.filter((event) => event.kind === 'load'), [
    { kind: 'load', pathname: '/en/futures/BTCUSDT' },
    { kind: 'load', pathname: '/en/futures/ETHUSDT' },
  ]);
});

test('user hears no second stale play when the first native play promise resolves after navigation', async (t) => {
  // Given the first native audio play is pending on the BTC page
  const harness = await createNotificationHarness(t, { firstPlayPending: true });
  await harness.notify(ordinaryNotificationOrder());
  await harness.advance(500);
  assert.deepEqual(harness.audio.map((event) => event.kind), ['load', 'play']);

  // When the route changes before that first play promise resolves
  harness.navigate('/en/futures/ETHUSDT');
  await harness.settleFirstPlay();

  // Then the promise continuation cannot replay the old symbol on the new page
  assert.deepEqual(harness.audio.map((event) => event.kind), ['load', 'play']);
});

for (const driftModule of [39116, 55401]) {
  test(`user keeps native sound and string payloads when captured module ${driftModule} drifts`, async (t) => {
    // Given only one side of the native sound producer-provider contract can be patched
    const harness = await createNotificationHarness(t, { driftModule, inspectSoundQueue: true });

    // When a foreign-symbol ordinary fill reaches the native sound stream
    await harness.notify(ordinaryNotificationOrder({ symbol: 'ETHUSDT' }));
    await harness.advance(500);

    // Then sound stays native with its exact string payload while toast filtering remains independent
    assert.deepEqual(harness.queueSnapshot(), ['42']);
    assert.deepEqual(harness.audio.map((event) => event.kind), ['load', 'play', 'play']);
    assert.deepEqual(harness.toasts, []);
    assert.deepEqual(harness.scope.snapshot().modules[driftModule], {
      status: 'source_mismatch', reason: 'source_mismatch', attempts: 1, matches: 0,
    });
  });
}

test('user keeps native notification behavior outside a recognized futures symbol route', async (t) => {
  // Given the loaded host is on an unsupported non-futures route
  const harness = await createNotificationHarness(t, { pathname: '/en/trade/BTC_USDT' });

  // When an ordinary unrelated-symbol notification arrives
  await harness.notify(ordinaryNotificationOrder({ symbol: 'ETHUSDT' }));
  await harness.advance(500);

  // Then the scope cannot claim a futures symbol and keeps native presentation
  assert.equal(harness.toasts.length, 1);
  assert.deepEqual(harness.audio.map((event) => event.kind), ['load', 'play', 'play']);
});

test('user host stream boundary preserves single and batch payload identity and account separation', () => {
  // Given independent native account subscriptions receive the SDK boundary
  const streams = createNotificationStreams();
  const um = [];
  const cm = [];
  const unsubscribeUM = streams.getSDK({ isCM: false }).getUserOrderStream({ isPM2: false }).subscribe((value) => um.push(value));
  const unsubscribeCM = streams.getSDK({ isCM: true }).getUserOrderStream({ isPM2: true }).subscribe((value) => cm.push(value));
  const single = ordinaryNotificationOrder({ symbol: undefined });
  const batch = [ordinaryNotificationOrder({ symbol: 'BTCUSD_PERP' }), single];

  // When the distinct account streams emit unchanged payload objects
  streams.emit(single);
  streams.emit(batch, true);
  unsubscribeUM();
  streams.emit(batch);
  unsubscribeCM();

  // Then the boundary neither filters unknown fields nor crosses account channels
  assert.equal(um.length, 1);
  assert.equal(um[0], single);
  assert.equal(cm.length, 1);
  assert.equal(cm[0], batch);
  assert.equal(streams.size(false), 0);
  assert.equal(streams.size(true), 0);
});

test('user host toast adapter emits the original cached order instead of rebuilding it from the fill', () => {
  // Given the actual native event emitter and cache adapter hold a foreign-symbol order
  const dependencies = new Map([[94917, { _: (instance, Constructor) => assert.equal(instance instanceof Constructor, true) }]]);
  const NativeEmitter = createNativeNotificationModules(dependencies)(22584).b;
  const emitter = new NativeEmitter();
  const streams = createNotificationStreams();
  const host = attachNativeOrderEventHost({ streams, emitter });
  const received = [];
  emitter.on('FILLED_NORMAL_ORDER', (order) => received.push(order));
  const original = ordinaryNotificationOrder({ symbol: 'ETHUSDT', status: 'NEW', originMarker: 'cache-entry' });
  streams.emit(original);
  const cached = host.orders()[0];

  // When the completion contains a different marker and the same native identity
  streams.emit({ ...original, status: 'FILLED', originMarker: 'stream-update' });
  host.dispose();

  // Then native subscribers receive the cached shape with its original NEW status
  assert.equal(received.length, 1);
  assert.equal(received[0], cached);
  assert.equal(received[0].status, 'NEW');
  assert.equal(received[0].originMarker, 'cache-entry');
  assert.equal(received[0].symbol, 'ETHUSDT');
  assert.deepEqual(host.orders(), []);
});

test('user host SDK parser preserves the native raw websocket to normalized order contract', () => {
  // Given the captured SDK order schema and its actual field parser use a controlled transport
  const decoder = createNativeOrderDecoder('UM');
  const raw = {
    fs: 'UM', E: 1800000000123,
    o: { s: 'ETHUSDT', c: 'manual-42', i: 42, S: 'BUY', o: 'LIMIT', ot: 'LIMIT', x: 'TRADE', X: 'FILLED', p: '1.25', ap: '1.2', z: '3', q: '3', T: 1800000000000 },
  };

  // When the native transform receives the original coalesced websocket envelope
  const orders = decoder.decode({ coalscedMsg: [{ data: raw }] });

  // Then native schema mapping retains identity and uses its actual numeric conversions
  assert.equal(decoder.eventType, 'ORDER_TRADE_UPDATE');
  assert.equal(orders.length, 1);
  assert.equal(Object.getPrototypeOf(orders[0]), null);
  assert.deepEqual({
    symbol: orders[0].symbol,
    clientOrderId: orders[0].clientOrderId,
    orderId: orders[0].orderId,
    type: orders[0].type,
    orderType: orders[0].orderType,
    origType: orders[0].origType,
    operate: orders[0].operate,
    status: orders[0].status,
    price: orders[0].price,
    avgPrice: orders[0].avgPrice,
    executedQty: orders[0].executedQty,
    origQty: orders[0].origQty,
    updateTime: orders[0].updateTime,
  }, {
    symbol: 'ETHUSDT', clientOrderId: 'manual-42', orderId: 42,
    type: 'LIMIT', orderType: 'LIMIT', origType: 'LIMIT', operate: 'TRADE', status: 'FILLED',
    price: 1.25, avgPrice: 1.2, executedQty: 3, origQty: '3', updateTime: 1800000000000,
  });
});

test('user host SDK parser retains uncertain fields and applies its original account and update-time rules', () => {
  // Given an account source contains unknown fields and one foreign account packet
  const decoder = createNativeOrderDecoder('UM');
  const partial = { fs: 'UM', E: 99, o: { s: 'eth/usdt', o: 'UNRECOGNIZED', X: 'PARTIALLY_FILLED', x: 'TRADE', T: 1 } };
  const amendment = { fs: 'UM', E: 100, o: { s: 'BTCUSDT', o: 'LIMIT', X: 'NEW', x: 'AMENDMENT', T: 2 } };
  const otherAccount = { fs: 'CM', E: 101, o: { s: 'BTCUSD_PERP', X: 'FILLED' } };

  // When actual native schema logic transforms the complete coalesced batch
  const orders = decoder.decode({ coalscedMsg: [partial, amendment, otherAccount].map((data) => ({ data })) });

  // Then only the native account filter applies and unknown metadata is neither repaired nor invented
  assert.equal(orders.length, 2);
  assert.equal(orders[0].symbol, 'eth/usdt');
  assert.equal(orders[0].type, 'UNRECOGNIZED');
  assert.equal(orders[0].clientOrderId, undefined);
  assert.equal(orders[0].origType, undefined);
  assert.equal(orders[0].updateTime, 99);
  assert.equal(orders[1].updateTime, 100);
});

test('user filters the actual native normalized event produced from a foreign raw websocket order', async (t) => {
  // Given the real SDK transform creates the native order shape from its raw envelope
  const harness = await createNotificationHarness(t);
  const decoder = createNativeOrderDecoder('UM');
  const [order] = decoder.decode({ coalscedMsg: [{ data: {
    fs: 'UM', E: 1800000000123,
    o: { s: 'ETHUSDT', c: 'manual-42', i: 42, S: 'BUY', o: 'LIMIT', ot: 'LIMIT', x: 'TRADE', X: 'FILLED', T: 1800000000000 },
  } }] });

  // When that unmodified normalized order traverses the native cache, hooks and provider
  await harness.notify(order);
  await harness.advance(500);

  // Then filtering suppresses both final side effects without changing native schema fields
  assert.deepEqual({ toasts: harness.toasts, audio: harness.audio }, { toasts: [], audio: [] });
  assert.equal(order.symbol, 'ETHUSDT');
  assert.equal(order.type, 'LIMIT');
  assert.equal(order.origType, 'LIMIT');
});
