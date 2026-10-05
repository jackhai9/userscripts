import test from 'node:test';
import assert from 'node:assert/strict';
import {
  coalesceTradingViewDrawingSaves,
  createTradingViewContinuousSaveController,
  createTradingViewRemovalSaveController,
} from '../../../src/binance-orderbook-trade/core/chart-save-coalescer.js';
import { createTradingViewApi, createManualTimers } from './chart-save-test-host.js';

const chartSaveFactories = [
  { name: 'continuous closing', create: (api, options) => createTradingViewContinuousSaveController(api, options) },
  { name: 'bulk removal', create: (api, options) => createTradingViewRemovalSaveController(api, options) },
  { name: 'a single drawing action', create: (api, options) => coalesceTradingViewDrawingSaves(api, () => {}, options) },
];

for (const { name, create } of chartSaveFactories) {
  for (const { missing, change, expectedError } of [
    { missing: 'chart API', change: () => null, expectedError: /图表接口不可用/ },
    { missing: 'save method', change: (api) => ({ ...api, saveChart: null }), expectedError: /图表保存接口不可用/ },
    { missing: 'event subscription', change: (api) => ({ ...api, subscribe: null }), expectedError: /图表事件接口不可用/ },
    { missing: 'event unsubscription', change: (api) => ({ ...api, unsubscribe: null }), expectedError: /图表事件接口不可用/ },
  ]) {
    test(`user cannot start ${name} chart saving without the ${missing}`, async () => {
      // Given a chart host missing one required capability.
      const { api, listeners, saved } = createTradingViewApi();
      const unavailable = change(api);

      // When the chart-save lifecycle is requested from that host.
      const start = async () => create(unavailable);

      // Then the missing capability is reported before subscriptions or chart writes begin.
      await assert.rejects(start, expectedError);
      assert.equal(listeners.size, 0);
      assert.deepEqual(saved, []);
    });
  }
}

for (const { name, create, options, expectedError } of [
  { name: 'continuous-save quiet window', create: createTradingViewContinuousSaveController, options: { settleQuietMs: 0 }, expectedError: /图表保存合并静默时间无效/ },
  { name: 'continuous-save maximum wait', create: createTradingViewContinuousSaveController, options: { maxWaitMs: 119 }, expectedError: /图表保存合并最长等待时间无效/ },
  { name: 'order-line discovery wait', create: createTradingViewContinuousSaveController, options: { submitEventDiscoveryMs: -1 }, expectedError: /订单线事件等待时间无效/ },
  { name: 'order-line type adapter', create: createTradingViewContinuousSaveController, options: { getDrawingToolName: null }, expectedError: /订单线类型解析依赖异常/ },
  { name: 'removal quiet window', create: createTradingViewRemovalSaveController, options: { settleQuietMs: 0 }, expectedError: /删除事件保存合并静默时间无效/ },
  { name: 'removal maximum wait', create: createTradingViewRemovalSaveController, options: { maxWaitMs: 139 }, expectedError: /删除事件保存合并最长等待时间无效/ },
  { name: 'removal discovery wait', create: createTradingViewRemovalSaveController, options: { eventDiscoveryMs: -1 }, expectedError: /删除事件发现时间无效/ },
  { name: 'drawing action', create: (api) => coalesceTradingViewDrawingSaves(api, null), options: {}, expectedError: /图表操作不可用/ },
  { name: 'drawing discovery wait', create: (api, config) => coalesceTradingViewDrawingSaves(api, () => {}, config), options: { eventDiscoveryTimeoutMs: -1 }, expectedError: /图表事件等待时间无效/ },
  { name: 'drawing settle window', create: (api, config) => coalesceTradingViewDrawingSaves(api, () => {}, config), options: { settleQuietMs: 0 }, expectedError: /图表保存稳定等待时间无效/ },
  { name: 'drawing response deadline', create: (api, config) => coalesceTradingViewDrawingSaves(api, () => {}, config), options: { timeoutMs: 0 }, expectedError: /图表保存超时时间无效/ },
]) {
  test(`user gets an explicit error for an invalid ${name}`, async () => {
    // Given a valid chart host and one invalid lifecycle option.
    const { api, listeners, saved } = createTradingViewApi();
    const originalSaveChart = api.saveChart;

    // When the chart-save lifecycle validates the option.
    const start = async () => create(api, options);

    // Then validation fails before taking over the chart or subscribing to events.
    await assert.rejects(start, expectedError);
    assert.equal(api.saveChart, originalSaveChart);
    assert.equal(listeners.size, 0);
    assert.deepEqual(saved, []);
  });
}

for (const { name, create } of chartSaveFactories.slice(1)) {
  test(`user keeps the original chart API if ${name} cannot install a save wrapper`, async () => {
    // Given a chart host whose save accessor refuses replacement.
    const { api, listeners } = createTradingViewApi();
    const originalSaveChart = api.saveChart;
    Object.defineProperty(api, 'saveChart', { configurable: true, get: () => originalSaveChart, set() {} });

    // When the lifecycle tries to take ownership of chart saving.
    const start = async () => create(api);

    // Then wrapper installation fails explicitly and its event listener is removed.
    await assert.rejects(start, /图表保存接口无法/);
    assert.equal(api.saveChart, originalSaveChart);
    assert.equal(listeners.get('drawing_event').size, 0);
  });
}

test('user gets a drawing-save error if the continuous chart host refuses the burst wrapper', () => {
  // Given a continuous controller on a chart whose save accessor refuses assignment.
  const { api, listeners, saved } = createTradingViewApi();
  const originalSaveChart = api.saveChart;
  const timers = createManualTimers();
  Object.defineProperty(api, 'saveChart', { configurable: true, get: () => originalSaveChart, set() {} });
  const controller = createTradingViewContinuousSaveController(api, timers);

  // When a removal tries to start a temporary save burst.
  const remove = () => api.emit('drawing_event', 'order-1', 'remove');

  // Then the explicit ownership error leaves the original method and no burst timer.
  assert.throws(remove, /图表保存接口无法启用删除事件合并/);
  assert.equal(api.saveChart, originalSaveChart);
  assert.equal(timers.timers.size, 0);
  assert.deepEqual(saved, []);
  controller.stop();
  assert.equal(listeners.get('drawing_event').size, 0);
});


for (const drawingCount of [1, 5, 70, 120, 199, 200]) {
  test(`user receives ${drawingCount} drawing-save callbacks from one final serialization`, async () => {
    // Given a real native serializer and a drawing action with a bounded quiet window.
    const h = createTradingViewApi(), timers = createManualTimers(), received = [];
    const original = h.api.saveChart;
    const completion = coalesceTradingViewDrawingSaves(h.api, () => {
      for (let index = 0; index < drawingCount; index += 1) h.event();
      return 'hidden';
    }, { settleQuietMs: 10, timeoutMs: 100, ...timers });

    // When every native callback arrives and the final chart state settles.
    await Promise.resolve();
    for (let index = 0; index < drawingCount; index += 1) h.api.saveChart(value => received.push(value));
    h.snapshot.drawings.push({ id: 'latest-line', points: [3] });
    timers.advance(10);
    const result = await completion;

    // Then serialization is shared while each requested callback receives the complete current chart.
    assert.deepEqual(result, { actionResult: 'hidden', drawingEventCount: drawingCount, saveRequestCount: drawingCount, fullSaveCount: 1 });
    assert.equal(h.calls.length, 1);
    assert.equal(received.length, drawingCount);
    assert.equal(received.every(value => value.drawings[1].id === 'latest-line'), true);
    assert.equal(h.api.saveChart, original);
    assert.equal(timers.timers.size, 0);
  });
}

for (const ending of ['endRound', 'flush', 'stop']) {
  test(`user receives all callbacks from five order captures when continuous closing reaches ${ending}`, async () => {
    // Given a continuous round and a chart that identifies native order drawings.
    const h = createTradingViewApi(), timers = createManualTimers(), received = [];
    const original = h.api.saveChart;
    h.setDrawingToolName('order-1', 'LineToolOrder');
    const controller = createTradingViewContinuousSaveController(h.api, { settleQuietMs: 10, ...timers });
    const round = controller.beginRound();

    // When five submit captures settle before the round lifecycle is completed.
    for (let index = 0; index < 5; index += 1) {
      const capture = controller.beginSubmitCapture(round);
      h.event('properties_changed');
      h.api.saveChart(value => received.push(value));
      h.api.saveChart(value => received.push(value));
      timers.advance(10);
      assert.deepEqual(await controller.completeSubmitCapture(capture), { matched: true, status: 'captured' });
    }
    assert.equal(received.length, 0);
    if (ending === 'endRound') controller.endRound(round);
    if (ending === 'flush') controller.flush();
    if (ending === 'stop') controller.stop();

    // Then one native serialization delivers every accepted callback across all submit captures.
    assert.equal(received.length, 10);
    assert.equal(h.calls.length, 1);
    assert.equal(controller.getStats().deferredSubmitSaveCount, 5);
    assert.equal(controller.getStats().fullSaveCount, 1);
    assert.equal(h.api.saveChart, original);
    if (ending !== 'stop') controller.stop();
    assert.equal(timers.timers.size, 0);
    assert.equal(h.listeners.get('drawing_event').size, 0);
  });
}

for (const ordering of ['remove-first', 'submit-first']) {
  test(`user retains both removal and submission callbacks during ${ordering} continuous work`, async () => {
    // Given an active round with a native order-line capture.
    const h = createTradingViewApi(), timers = createManualTimers(), received = [];
    h.setDrawingToolName('order-1', 'LineToolOrder');
    const controller = createTradingViewContinuousSaveController(h.api, { settleQuietMs: 10, ...timers });
    const round = controller.beginRound();
    const capture = controller.beginSubmitCapture(round);

    // When remove and submit bursts occur in either order before the round ends.
    for (const event of ordering === 'remove-first' ? ['remove', 'properties_changed'] : ['properties_changed', 'remove']) {
      h.event(event);
      h.api.saveChart(() => received.push(event));
      timers.advance(10);
    }
    await controller.completeSubmitCapture(capture);
    controller.endRound(round);
    controller.stop();

    // Then neither the newer burst nor final-round cleanup discards an earlier callback.
    assert.deepEqual(received, ordering === 'remove-first' ? ['remove', 'properties_changed'] : ['properties_changed', 'remove']);
    assert.equal(h.calls.length, ordering === 'remove-first' ? 2 : 1);
    assert.equal(timers.timers.size, 0);
  });
}

test('user receives all removal callbacks across separated bursts and an unrelated synchronous save', async () => {
  // Given a removal controller that spans multiple native event bursts.
  const h = createTradingViewApi(), timers = createManualTimers(), received = [];
  const controller = createTradingViewRemovalSaveController(h.api, { settleQuietMs: 10, eventDiscoveryMs: 0, ...timers });
  h.event();
  h.api.saveChart(() => received.push('first'));
  timers.advance(10);

  // When an unrelated save occurs between the first and second removal bursts.
  const result = h.api.saveChart(() => { received.push('outside'); return 19; });
  h.event();
  h.api.saveChart(() => received.push('second'));
  const completion = controller.finish();
  timers.advance(10);
  const stats = await completion;

  // Then the first callback is flushed before the synchronous call and later callbacks finish normally.
  assert.equal(result, 19);
  assert.deepEqual(received, ['first', 'outside', 'second']);
  assert.equal(h.calls.length, 3);
  assert.deepEqual(stats, { fullSaveCount: 2, removeEventCount: 2, saveRequestCount: 2, synchronousSaveCount: 1 });
});

for (const ending of ['action-error', 'missing-save-timeout', 'quiet-timeout']) {
  test(`user receives accepted callbacks even when a drawing action ends with ${ending}`, async () => {
    // Given an action that accepts one callback before its controlled failure boundary.
    const h = createTradingViewApi(), timers = createManualTimers(), received = [];
    const original = h.api.saveChart;
    const failure = new Error('Native action failed');
    const completion = coalesceTradingViewDrawingSaves(h.api, () => {
      h.event();
      h.api.saveChart(value => received.push(value));
      if (ending === 'missing-save-timeout') h.event();
      if (ending === 'action-error') throw failure;
    }, { settleQuietMs: 20, timeoutMs: 10, ...timers });

    // When the action fails or reaches the exact response deadline.
    await Promise.resolve();
    timers.advance(10);

    // Then callbacks are delivered after restoring ownership and the original failure remains visible.
    await assert.rejects(completion, ending === 'action-error' ? failure : ending === 'missing-save-timeout'
      ? /预期 2，实际 1/ : /未在 10 毫秒内完成/);
    assert.deepEqual(received, [h.snapshot]);
    assert.equal(h.calls.length, 1);
    assert.equal(h.api.saveChart, original);
    assert.equal(h.listeners.get('drawing_event').size, 0);
    assert.equal(timers.timers.size, 0);
  });
}

test('user reaches the continuous-save maximum deadline despite repeated removal events', () => {
  // Given a busy removal stream with a shorter maximum wait than its sustained duration.
  const h = createTradingViewApi(), timers = createManualTimers(), received = [];
  const controller = createTradingViewContinuousSaveController(h.api, { settleQuietMs: 20, maxWaitMs: 40, ...timers });

  // When removals continue every ten milliseconds through the maximum deadline.
  for (let index = 0; index < 4; index += 1) {
    h.event();
    h.api.saveChart(() => received.push(index));
    timers.advance(10);
  }

  // Then every accepted callback completes at the cap without waiting for another quiet period.
  assert.deepEqual(received, [0, 1, 2, 3]);
  assert.equal(h.calls.length, 1);
  assert.equal(timers.timers.size, 0);
  controller.stop();
});

for (const ending of ['deadline', 'flush', 'stop']) {
  test(`user completes an unmatched submit capture at ${ending} without claiming position or interaction events`, async () => {
    // Given an armed order capture with only position-line and interaction events.
    const h = createTradingViewApi(), timers = createManualTimers();
    const controller = createTradingViewContinuousSaveController(h.api, { submitEventDiscoveryMs: 10, ...timers });
    const round = controller.beginRound();
    const capture = controller.beginSubmitCapture(round);
    h.setDrawingToolName('order-1', 'LineToolPosition');

    // When unrelated events arrive and discovery reaches its chosen lifecycle boundary.
    h.event('properties_changed');
    h.event('click');
    h.event('move');
    const direct = h.api.saveChart(() => 42);
    if (ending === 'deadline') timers.advance(10);
    else controller[ending]();
    const result = await controller.completeSubmitCapture(capture);

    // Then no order event is claimed and unrelated saves remain synchronous.
    assert.equal(direct, 42);
    assert.deepEqual(result, { matched: false, status: ending === 'deadline' ? 'no-order-event' : ending === 'flush' ? 'flushed' : 'stopped' });
    assert.equal(controller.getStats().orderEventCount, 0);
    if (ending !== 'stop') { controller.endRound(round); controller.stop(); }
    assert.equal(timers.timers.size, 0);
  });
}

test('user receives a late native save normally after stopping a matched capture', async () => {
  // Given an order event whose native delayed save has not arrived.
  const h = createTradingViewApi(), timers = createManualTimers();
  h.setDrawingToolName('order-1', 'LineToolOrder');
  const controller = createTradingViewContinuousSaveController(h.api, timers);
  const round = controller.beginRound();
  const capture = controller.beginSubmitCapture(round);
  h.event('properties_changed');

  // When stopping precedes the delayed native callback request.
  controller.stop();
  const captured = await controller.completeSubmitCapture(capture);
  const returned = h.api.saveChart(() => 23);

  // Then the capture is closed and ordinary native saving resumes without dropping a request.
  assert.deepEqual(captured, { matched: true, status: 'captured' });
  assert.equal(returned, 23);
  assert.equal(h.calls.length, 1);
  assert.equal(timers.timers.size, 0);
  assert.throws(() => controller.beginRound(), /已停止/);
  assert.throws(() => controller.stop(), /已停止/);
});

for (const mode of ['continuous', 'removal', 'action']) {
  test(`user regains save ownership when the native ${mode} serializer throws`, async () => {
    // Given a native serialization failure and an accepted callback.
    const h = createTradingViewApi(), timers = createManualTimers();
    const original = h.api.saveChart;
    const failure = new Error('Native serialization failed');
    h.setSaveFailure(failure);
    let controller;
    let completion;
    if (mode === 'continuous') controller = createTradingViewContinuousSaveController(h.api, timers);
    if (mode === 'removal') controller = createTradingViewRemovalSaveController(h.api, { settleQuietMs: 10, eventDiscoveryMs: 0, ...timers });
    if (mode === 'action') completion = coalesceTradingViewDrawingSaves(h.api, () => h.event(), { settleQuietMs: 10, ...timers });
    else h.event();
    let delivered = false;
    h.api.saveChart(() => { delivered = true; });

    // When final delivery attempts the failing native serialization exactly once.
    if (mode === 'continuous') assert.throws(() => controller.stop(), failure);
    else {
      await Promise.resolve();
      if (mode === 'removal') completion = controller.finish();
      timers.advance(10);
      await assert.rejects(completion, failure);
    }

    // Then no snapshot is fabricated and all temporary ownership is released.
    assert.equal(delivered, false);
    assert.equal(h.calls.length, 1);
    assert.equal(h.api.saveChart, original);
    assert.equal(h.listeners.get('drawing_event').size, 0);
    assert.equal(timers.timers.size, 0);
  });
}

for (const mode of ['removal', 'action']) {
  test(`user waits for delayed ${mode} drawing discovery before delivering callbacks`, async () => {
    // Given a lifecycle started before native drawing events become visible.
    const h = createTradingViewApi(), timers = createManualTimers(), received = [];
    let controller;
    const completion = mode === 'removal'
      ? (controller = createTradingViewRemovalSaveController(h.api, { settleQuietMs: 10, eventDiscoveryMs: 30, ...timers })).finish()
      : coalesceTradingViewDrawingSaves(h.api, () => 'changed', { settleQuietMs: 10, eventDiscoveryTimeoutMs: 30, ...timers });
    await Promise.resolve();

    // When a delayed event arrives before discovery expires and its callback reaches the quiet deadline.
    timers.advance(5);
    h.event();
    h.api.saveChart(value => received.push(value));
    await Promise.resolve();
    timers.advance(10);
    const result = await completion;

    // Then delayed native work is included and all owned timers and subscriptions are removed.
    assert.equal(result.fullSaveCount, 1);
    assert.deepEqual(received, [h.snapshot]);
    assert.equal(timers.timers.size, 0);
    assert.equal(h.listeners.get('drawing_event').size, 0);
    if (controller) await assert.rejects(controller.finish(), /已结束/);
  });

  test(`user finishes empty ${mode} discovery without inventing a native save`, async () => {
    // Given a chart with no native drawing events during its discovery window.
    const h = createTradingViewApi(), timers = createManualTimers();
    const completion = mode === 'removal'
      ? createTradingViewRemovalSaveController(h.api, { eventDiscoveryMs: 10, ...timers }).finish()
      : coalesceTradingViewDrawingSaves(h.api, () => 'empty', { eventDiscoveryTimeoutMs: 10, ...timers });

    // When the complete discovery deadline passes without any event or callback.
    await Promise.resolve();
    timers.advance(10);
    const result = await completion;

    // Then no native serialization is fabricated and lifecycle resources are released.
    assert.equal(result.fullSaveCount, 0);
    assert.deepEqual(h.calls, []);
    assert.equal(timers.timers.size, 0);
    assert.equal(h.listeners.get('drawing_event').size, 0);
  });
}

test('user restores an inherited native save method before delivering callback snapshots', async () => {
  // Given a chart that inherits its save method from a prototype.
  const h = createTradingViewApi(), timers = createManualTimers(), received = [];
  const original = h.api.saveChart;
  delete h.api.saveChart;
  Object.setPrototypeOf(h.api, { saveChart: original });

  // When a drawing action captures a callback and settles.
  const completion = coalesceTradingViewDrawingSaves(h.api, () => {
    h.event();
    h.api.saveChart(value => { assert.equal(Object.hasOwn(h.api, 'saveChart'), false); received.push(value); });
  }, { settleQuietMs: 10, ...timers });
  await Promise.resolve();
  timers.advance(10);
  await completion;

  // Then ownership returns to the original prototype and the callback receives the native JSON snapshot.
  assert.equal(h.api.saveChart, original);
  assert.equal(Object.hasOwn(h.api, 'saveChart'), false);
  assert.deepEqual(received, [h.snapshot]);
});

test('user cannot overlap or end a continuous round with an unresolved capture', async () => {
  // Given one active round and its unresolved order-line capture.
  const h = createTradingViewApi(), timers = createManualTimers();
  const controller = createTradingViewContinuousSaveController(h.api, timers);
  const round = controller.beginRound();
  const capture = controller.beginSubmitCapture(round);

  // When callers attempt mismatched or overlapping round operations.
  const anotherRound = () => controller.beginRound();
  const anotherCapture = () => controller.beginSubmitCapture(round);
  const earlyEnd = () => controller.endRound(round);
  const wrongRound = () => controller.endRound({});

  // Then lifecycle assertions prevent overlap while stop completes the existing capture exactly once.
  assert.throws(anotherRound, /已有图表保存轮次/);
  assert.throws(anotherCapture, /已有订单线保存捕获/);
  assert.throws(earlyEnd, /仍有订单线捕获/);
  assert.throws(wrongRound, /轮次不匹配/);
  await assert.rejects(controller.completeSubmitCapture({}), /捕获不匹配/);
  controller.stop();
  assert.deepEqual(await controller.completeSubmitCapture(capture), { matched: false, status: 'stopped' });
  assert.equal(timers.timers.size, 0);
});

test('user can flush and continue the same continuous round without losing either callback batch', async () => {
  // Given a continuous round with a declared native order-line adapter.
  const h = createTradingViewApi(), timers = createManualTimers(), received = [];
  h.setDrawingToolName('order-1', 'LineToolOrder');
  const controller = createTradingViewContinuousSaveController(h.api, { settleQuietMs: 10, ...timers });
  const round = controller.beginRound();

  // When one captured callback is flushed before another capture in the same round.
  for (let index = 0; index < 2; index += 1) {
    const capture = controller.beginSubmitCapture(round);
    h.event('properties_changed');
    h.api.saveChart(() => received.push(index));
    timers.advance(10);
    await controller.completeSubmitCapture(capture);
    if (index === 0) controller.flush();
  }
  controller.endRound(round);
  controller.stop();

  // Then each detached batch is serialized once and both callback requests complete.
  assert.deepEqual(received, [0, 1]);
  assert.equal(h.calls.length, 2);
  assert.equal(timers.timers.size, 0);
});

test('user preserves settled round callbacks when a foreign owner replaces the restored native save method', async () => {
  // Given a captured order callback deferred until the continuous round ends.
  const h = createTradingViewApi(), timers = createManualTimers(), received = [];
  h.setDrawingToolName('order-1', 'LineToolOrder');
  const controller = createTradingViewContinuousSaveController(h.api, { settleQuietMs: 10, ...timers });
  const round = controller.beginRound();
  const capture = controller.beginSubmitCapture(round);
  h.event('properties_changed');
  h.api.saveChart(value => received.push(value));
  timers.advance(10);
  await controller.completeSubmitCapture(capture);
  const foreign = () => 83;
  h.api.saveChart = foreign;

  // When the round ends after native-save ownership has changed.
  controller.endRound(round);
  controller.stop();

  // Then the original accepted callback completes without involving or replacing the new owner.
  assert.deepEqual(received, [h.snapshot]);
  assert.equal(h.calls.length, 1);
  assert.equal(h.api.saveChart, foreign);
});
