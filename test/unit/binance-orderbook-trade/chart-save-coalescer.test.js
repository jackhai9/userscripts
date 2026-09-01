import test from 'node:test';
import assert from 'node:assert/strict';

import {
  coalesceTradingViewDrawingSaves,
  createTradingViewContinuousSaveController,
  createTradingViewRemovalSaveController,
} from '../../../src/binance-orderbook-trade/core/chart-save-coalescer.js';

function createTradingViewApi() {
  const listeners = new Map();
  const saved = [];
  const drawingToolNames = new Map();
  const api = {
    activeChart() {
      return {
        getShapeById(drawingId) {
          const toolname = drawingToolNames.get(String(drawingId));
          if (!toolname) throw new Error('There is no such shape');
          return { lineDataSource: () => ({ toolname }) };
        },
      };
    },
    saveChart(...args) {
      saved.push({ thisValue: this, args });
    },
    subscribe(name, callback) {
      const callbacks = listeners.get(name) || new Set();
      callbacks.add(callback);
      listeners.set(name, callbacks);
    },
    unsubscribe(name, callback) {
      listeners.get(name)?.delete(callback);
    },
    emit(name, ...args) {
      for (const callback of listeners.get(name) || []) callback(...args);
    },
  };
  return {
    api,
    saved,
    listeners,
    setDrawingToolName(drawingId, toolname) {
      drawingToolNames.set(String(drawingId), toolname);
    },
  };
}

function expectedContinuousStats(overrides = {}) {
  return {
    deferredSubmitSaveCount: 0,
    fullSaveCount: 0,
    orderEventCount: 0,
    removeEventCount: 0,
    saveRequestCount: 0,
    ...overrides,
  };
}

function createManualTimers() {
  let now = 0;
  let sequence = 0;
  const timers = new Map();
  const setTimeoutFn = (callback, delayMs) => {
    sequence += 1;
    timers.set(sequence, { callback, at: now + delayMs });
    return sequence;
  };
  const clearTimeoutFn = (timerId) => timers.delete(timerId);
  const advance = (elapsedMs) => {
    const deadline = now + elapsedMs;
    while (true) {
      const next = Array.from(timers.entries())
        .filter(([, timer]) => timer.at <= deadline)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
      if (!next) break;
      const [timerId, timer] = next;
      timers.delete(timerId);
      now = timer.at;
      timer.callback();
    }
    now = deadline;
  };
  return { advance, clearTimeoutFn, setTimeoutFn, timers };
}

test('bulk removal controller keeps unrelated saves synchronous before the first remove', async () => {
  const { api, saved, listeners } = createTradingViewApi();
  const originalSaveChart = api.saveChart;
  const controller = createTradingViewRemovalSaveController(api, { eventDiscoveryMs: 0 });

  assert.notEqual(api.saveChart, originalSaveChart);
  api.saveChart('unrelated');
  assert.deepEqual(saved.map((entry) => entry.args), [['unrelated']]);
  assert.deepEqual(await controller.finish(), {
    fullSaveCount: 0,
    removeEventCount: 0,
    saveRequestCount: 0,
    synchronousSaveCount: 1,
  });

  assert.equal(api.saveChart, originalSaveChart);
  assert.deepEqual(saved.map((entry) => entry.args), [['unrelated']]);
  assert.equal(listeners.get('drawing_event')?.size, 0);
});

test('bulk removal controller persists one final snapshot across separate remove bursts', async () => {
  const { api, saved, listeners } = createTradingViewApi();
  const originalSaveChart = api.saveChart;
  const timers = createManualTimers();
  const controller = createTradingViewRemovalSaveController(api, {
    settleQuietMs: 20,
    maxWaitMs: 100,
    eventDiscoveryMs: 10,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  api.emit('drawing_event', 'order-1', 'remove');
  api.saveChart('snapshot-1');
  timers.advance(20);
  assert.notEqual(api.saveChart, originalSaveChart);
  assert.deepEqual(saved, []);

  api.saveChart('unrelated-between-bursts');
  api.emit('drawing_event', 'order-2', 'remove');
  api.saveChart('snapshot-2');
  const completion = controller.finish();
  timers.advance(20);
  const result = await completion;

  assert.deepEqual(result, {
    fullSaveCount: 1,
    removeEventCount: 2,
    saveRequestCount: 2,
    synchronousSaveCount: 1,
  });
  assert.deepEqual(saved.map((entry) => entry.args), [
    ['unrelated-between-bursts'],
    ['snapshot-2'],
  ]);
  assert.equal(api.saveChart, originalSaveChart);
  assert.equal(listeners.get('drawing_event')?.size, 0);
});

test('bulk removal controller waits briefly for delayed remove events before finishing', async () => {
  const { api, saved } = createTradingViewApi();
  const timers = createManualTimers();
  const controller = createTradingViewRemovalSaveController(api, {
    settleQuietMs: 20,
    maxWaitMs: 100,
    eventDiscoveryMs: 30,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  const completion = controller.finish();
  timers.advance(10);
  api.emit('drawing_event', 'order-1', 'remove');
  api.saveChart('snapshot-1');
  timers.advance(20);

  assert.deepEqual(await completion, {
    fullSaveCount: 1,
    removeEventCount: 1,
    saveRequestCount: 1,
    synchronousSaveCount: 0,
  });
  assert.deepEqual(saved.map((entry) => entry.args), [['snapshot-1']]);
});

test('bulk removal controller ignores non-remove drawing events', async () => {
  const { api, saved } = createTradingViewApi();
  const controller = createTradingViewRemovalSaveController(api, { eventDiscoveryMs: 0 });

  api.emit('drawing_event', 'order-1', 'properties_changed');
  api.saveChart('unrelated');

  assert.deepEqual(await controller.finish(), {
    fullSaveCount: 0,
    removeEventCount: 0,
    saveRequestCount: 0,
    synchronousSaveCount: 1,
  });
  assert.deepEqual(saved.map((entry) => entry.args), [['unrelated']]);
});

test('bulk removal controller discards an older removal snapshot after a later synchronous save', async () => {
  const { api, saved } = createTradingViewApi();
  const timers = createManualTimers();
  const controller = createTradingViewRemovalSaveController(api, {
    settleQuietMs: 20,
    maxWaitMs: 100,
    eventDiscoveryMs: 0,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  api.emit('drawing_event', 'order-1', 'remove');
  api.saveChart('removal-snapshot');
  timers.advance(20);
  api.saveChart('newer-unrelated-snapshot');

  assert.deepEqual(await controller.finish(), {
    fullSaveCount: 0,
    removeEventCount: 1,
    saveRequestCount: 1,
    synchronousSaveCount: 1,
  });
  assert.deepEqual(saved.map((entry) => entry.args), [['newer-unrelated-snapshot']]);
});

test('bulk removal controller preserves an externally replaced chart save method', async () => {
  const { api, saved, listeners } = createTradingViewApi();
  const timers = createManualTimers();
  const controller = createTradingViewRemovalSaveController(api, {
    settleQuietMs: 20,
    maxWaitMs: 100,
    eventDiscoveryMs: 0,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  api.emit('drawing_event', 'order-1', 'remove');
  api.saveChart('old-removal-snapshot');
  const foreignSaves = [];
  const foreignSaveChart = (...args) => foreignSaves.push(args);
  api.saveChart = foreignSaveChart;
  api.saveChart('newer-foreign-snapshot');
  timers.advance(20);

  await assert.rejects(controller.finish(), /图表保存接口在删除事件合并期间发生变化/);
  assert.equal(api.saveChart, foreignSaveChart);
  assert.deepEqual(saved, []);
  assert.deepEqual(foreignSaves, [['newer-foreign-snapshot']]);
  assert.equal(listeners.get('drawing_event')?.size, 0);
});

test('bulk removal controller drops a settled snapshot after external save ownership changes', async () => {
  const { api, saved } = createTradingViewApi();
  const timers = createManualTimers();
  const controller = createTradingViewRemovalSaveController(api, {
    settleQuietMs: 20,
    maxWaitMs: 100,
    eventDiscoveryMs: 0,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  api.emit('drawing_event', 'order-1', 'remove');
  api.saveChart('old-removal-snapshot');
  timers.advance(20);
  const foreignSaves = [];
  const foreignSaveChart = (...args) => foreignSaves.push(args);
  api.saveChart = foreignSaveChart;
  api.saveChart('newer-foreign-snapshot');

  await assert.rejects(
    controller.finish(),
    /图表保存接口在删除事件监视期间发生变化/,
  );
  assert.equal(api.saveChart, foreignSaveChart);
  assert.deepEqual(saved, []);
  assert.deepEqual(foreignSaves, [['newer-foreign-snapshot']]);
});

test('bulk removal controller restores the chart API before a final save error', async () => {
  const { api, listeners } = createTradingViewApi();
  const originalSaveChart = function saveChart() {
    throw new Error('final save failed');
  };
  api.saveChart = originalSaveChart;
  const timers = createManualTimers();
  const controller = createTradingViewRemovalSaveController(api, {
    settleQuietMs: 20,
    maxWaitMs: 100,
    eventDiscoveryMs: 0,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  api.emit('drawing_event', 'order-1', 'remove');
  api.saveChart('snapshot-1');
  const completion = controller.finish();
  timers.advance(20);

  await assert.rejects(completion, /final save failed/);
  assert.equal(api.saveChart, originalSaveChart);
  assert.equal(listeners.get('drawing_event')?.size, 0);
});

test('bulk removal controller settles after an external replacement when the original save throws', async () => {
  const { api, listeners } = createTradingViewApi();
  api.saveChart = function saveChart() {
    throw new Error('original save failed');
  };
  const timers = createManualTimers();
  const controller = createTradingViewRemovalSaveController(api, {
    settleQuietMs: 20,
    maxWaitMs: 100,
    eventDiscoveryMs: 0,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  api.emit('drawing_event', 'order-1', 'remove');
  api.saveChart('pending-snapshot');
  const foreignSaveChart = () => {};
  api.saveChart = foreignSaveChart;
  timers.advance(20);

  await assert.rejects(
    controller.finish(),
    /图表保存接口在删除事件合并期间发生变化/,
  );
  assert.equal(api.saveChart, foreignSaveChart);
  assert.equal(listeners.get('drawing_event')?.size, 0);
});

test('continuous remove-save controller leaves unrelated chart saves synchronous', () => {
  const { api, saved } = createTradingViewApi();
  const originalSaveChart = api.saveChart;
  const timers = createManualTimers();
  const coalescer = createTradingViewContinuousSaveController(api, {
    settleQuietMs: 20,
    maxWaitMs: 100,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  api.saveChart('unrelated');
  assert.deepEqual(saved.map((entry) => entry.args), [['unrelated']]);

  assert.deepEqual(coalescer.stop(), expectedContinuousStats());
  assert.equal(api.saveChart, originalSaveChart);
});

test('continuous remove-save controller persists only the final save in one remove burst', () => {
  const { api, saved } = createTradingViewApi();
  const timers = createManualTimers();
  const coalescer = createTradingViewContinuousSaveController(api, {
    settleQuietMs: 20,
    maxWaitMs: 100,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  api.emit('drawing_event', 'order-1', 'remove');
  api.saveChart('snapshot-1');
  timers.advance(10);
  api.emit('drawing_event', 'order-2', 'remove');
  api.saveChart('snapshot-2');
  timers.advance(10);
  api.emit('drawing_event', 'order-3', 'remove');
  api.saveChart('snapshot-3');
  timers.advance(19);
  assert.deepEqual(saved, []);
  timers.advance(1);
  assert.deepEqual(saved.map((entry) => entry.args), [['snapshot-3']]);

  assert.deepEqual(coalescer.stop(), expectedContinuousStats({
    fullSaveCount: 1,
    removeEventCount: 3,
    saveRequestCount: 3,
  }));
});

test('continuous remove-save controller flushes at its maximum wait during sustained removals', () => {
  const { api, saved } = createTradingViewApi();
  const timers = createManualTimers();
  const coalescer = createTradingViewContinuousSaveController(api, {
    settleQuietMs: 50,
    maxWaitMs: 100,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  api.emit('drawing_event', 'order-1', 'remove');
  api.saveChart('snapshot-1');
  for (let index = 2; index <= 5; index += 1) {
    timers.advance(20);
    api.emit('drawing_event', `order-${index}`, 'remove');
    api.saveChart(`snapshot-${index}`);
  }
  timers.advance(20);
  assert.deepEqual(saved.map((entry) => entry.args), [['snapshot-5']]);

  coalescer.stop();
});

test('continuous remove-save controller flushes pending state and restores the original method on stop', () => {
  const { api, saved } = createTradingViewApi();
  const originalSaveChart = api.saveChart;
  const timers = createManualTimers();
  const coalescer = createTradingViewContinuousSaveController(api, {
    settleQuietMs: 20,
    maxWaitMs: 100,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  api.emit('drawing_event', 'order-1', 'remove');
  api.saveChart('pending-final');
  assert.deepEqual(coalescer.stop(), expectedContinuousStats({
    fullSaveCount: 1,
    removeEventCount: 1,
    saveRequestCount: 1,
  }));
  assert.deepEqual(saved.map((entry) => entry.args), [['pending-final']]);
  assert.equal(api.saveChart, originalSaveChart);
  assert.equal(timers.timers.size, 0);

  api.saveChart('after-stop');
  assert.deepEqual(saved.map((entry) => entry.args), [['pending-final'], ['after-stop']]);
});

test('continuous remove-save controller ignores non-remove drawing events', () => {
  const { api, saved } = createTradingViewApi();
  const coalescer = createTradingViewContinuousSaveController(api);

  api.emit('drawing_event', 'order-1', 'properties_changed');
  api.saveChart('properties');

  assert.deepEqual(saved.map((entry) => entry.args), [['properties']]);
  assert.deepEqual(coalescer.stop(), expectedContinuousStats());
});

test('continuous remove-save controller does not replace another active save wrapper', () => {
  const { api, saved } = createTradingViewApi();
  const controller = createTradingViewContinuousSaveController(api);
  const sessionSaveChart = api.saveChart;
  const foreignSaves = [];
  api.saveChart = (...args) => foreignSaves.push(args);

  api.emit('drawing_event', 'order-1', 'remove');
  api.saveChart('foreign');
  assert.deepEqual(foreignSaves, [['foreign']]);
  assert.deepEqual(saved, []);

  api.saveChart = sessionSaveChart;
  assert.deepEqual(controller.stop(), expectedContinuousStats({ removeEventCount: 1 }));
});

test('continuous remove-save controller restores the chart method when the final save throws', () => {
  const { api, listeners } = createTradingViewApi();
  const originalSaveChart = function saveChart() {
    throw new Error('final save failed');
  };
  api.saveChart = originalSaveChart;
  const controller = createTradingViewContinuousSaveController(api);

  api.emit('drawing_event', 'order-1', 'remove');
  api.saveChart('pending');

  assert.throws(() => controller.stop(), /final save failed/);
  assert.equal(api.saveChart, originalSaveChart);
  assert.equal(listeners.get('drawing_event')?.size, 0);
});

test('continuous submit captures five order-line saves and replays only the final round snapshot', async () => {
  const {
    api,
    saved,
    setDrawingToolName,
  } = createTradingViewApi();
  const originalSaveChart = api.saveChart;
  const timers = createManualTimers();
  const controller = createTradingViewContinuousSaveController(api, {
    settleQuietMs: 20,
    maxWaitMs: 100,
    submitEventDiscoveryMs: 10,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });
  const round = controller.beginRound();

  for (let index = 1; index <= 5; index += 1) {
    const drawingId = `order-${index}`;
    setDrawingToolName(drawingId, 'LineToolOrder');
    const capture = controller.beginSubmitCapture(round);
    api.emit('drawing_event', drawingId, 'properties_changed');
    api.saveChart(`snapshot-${index}`);
    const completion = controller.completeSubmitCapture(capture);
    timers.advance(20);
    assert.deepEqual(await completion, { matched: true, status: 'captured' });
    assert.equal(api.saveChart, originalSaveChart);
    assert.deepEqual(saved, []);
  }

  assert.deepEqual(controller.endRound(round), expectedContinuousStats({
    deferredSubmitSaveCount: 5,
    fullSaveCount: 1,
    orderEventCount: 5,
    saveRequestCount: 5,
  }));
  assert.deepEqual(saved.map((entry) => entry.args), [['snapshot-5']]);
  controller.stop();
});

test('continuous submit capture keeps the final save from multiple order-line events', async () => {
  const { api, saved, setDrawingToolName } = createTradingViewApi();
  const timers = createManualTimers();
  const controller = createTradingViewContinuousSaveController(api, {
    settleQuietMs: 20,
    maxWaitMs: 100,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });
  const round = controller.beginRound();
  const capture = controller.beginSubmitCapture(round);
  setDrawingToolName('order-1', 'LineToolOrder');
  setDrawingToolName('order-2', 'LineToolOrder');

  api.emit('drawing_event', 'order-1', 'properties_changed');
  api.saveChart('snapshot-1');
  timers.advance(10);
  api.emit('drawing_event', 'order-2', 'properties_changed');
  api.saveChart('snapshot-2');
  const completion = controller.completeSubmitCapture(capture);
  timers.advance(20);

  assert.deepEqual(await completion, { matched: true, status: 'captured' });
  controller.endRound(round);
  assert.deepEqual(saved.map((entry) => entry.args), [['snapshot-2']]);
  assert.deepEqual(controller.stop(), expectedContinuousStats({
    deferredSubmitSaveCount: 1,
    fullSaveCount: 1,
    orderEventCount: 2,
    saveRequestCount: 2,
  }));
});

test('continuous submit capture keeps an existing remove burst independent', async () => {
  const { api, saved, setDrawingToolName } = createTradingViewApi();
  const timers = createManualTimers();
  const controller = createTradingViewContinuousSaveController(api, {
    settleQuietMs: 20,
    maxWaitMs: 100,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });
  const round = controller.beginRound();
  const capture = controller.beginSubmitCapture(round);
  setDrawingToolName('order-1', 'LineToolOrder');

  api.emit('drawing_event', 'removed-order', 'remove');
  api.saveChart('remove-snapshot');
  api.emit('drawing_event', 'order-1', 'properties_changed');
  api.saveChart('order-snapshot');
  const completion = controller.completeSubmitCapture(capture);
  timers.advance(20);

  assert.deepEqual(await completion, { matched: true, status: 'captured' });
  assert.deepEqual(saved.map((entry) => entry.args), [['remove-snapshot']]);
  controller.endRound(round);
  assert.deepEqual(saved.map((entry) => entry.args), [
    ['remove-snapshot'],
    ['order-snapshot'],
  ]);
  controller.stop();
});

test('continuous remove burst supersedes an older deferred submit snapshot', async () => {
  const { api, saved, setDrawingToolName } = createTradingViewApi();
  const timers = createManualTimers();
  const controller = createTradingViewContinuousSaveController(api, {
    settleQuietMs: 20,
    maxWaitMs: 100,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });
  const round = controller.beginRound();
  const capture = controller.beginSubmitCapture(round);
  setDrawingToolName('order-1', 'LineToolOrder');

  api.emit('drawing_event', 'order-1', 'properties_changed');
  api.saveChart('order-snapshot');
  api.emit('drawing_event', 'removed-order', 'remove');
  api.saveChart('newer-remove-snapshot');
  timers.advance(20);

  assert.deepEqual(await controller.completeSubmitCapture(capture), {
    matched: true,
    status: 'captured',
  });
  controller.endRound(round);
  assert.deepEqual(saved.map((entry) => entry.args), [['newer-remove-snapshot']]);
  controller.stop();
});

test('continuous submit capture ignores position lines and leaves their saves synchronous', async () => {
  const { api, saved, setDrawingToolName } = createTradingViewApi();
  const timers = createManualTimers();
  const controller = createTradingViewContinuousSaveController(api, {
    settleQuietMs: 20,
    maxWaitMs: 100,
    submitEventDiscoveryMs: 10,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });
  const round = controller.beginRound();
  const capture = controller.beginSubmitCapture(round);
  setDrawingToolName('position-1', 'LineToolPosition');

  api.emit('drawing_event', 'position-1', 'properties_changed');
  api.saveChart('position-snapshot');
  const completion = controller.completeSubmitCapture(capture);
  timers.advance(10);

  assert.deepEqual(await completion, { matched: false, status: 'no-order-event' });
  assert.deepEqual(saved.map((entry) => entry.args), [['position-snapshot']]);
  controller.endRound(round);
  controller.stop();
});

test('continuous submit capture ignores click and move events for order lines', async () => {
  const { api, saved, setDrawingToolName } = createTradingViewApi();
  const timers = createManualTimers();
  const controller = createTradingViewContinuousSaveController(api, {
    submitEventDiscoveryMs: 10,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });
  const round = controller.beginRound();
  const capture = controller.beginSubmitCapture(round);
  setDrawingToolName('order-1', 'LineToolOrder');

  api.emit('drawing_event', 'order-1', 'click');
  api.emit('drawing_event', 'order-1', 'move');
  api.saveChart('interaction-snapshot');
  const completion = controller.completeSubmitCapture(capture);
  timers.advance(10);

  assert.deepEqual(await completion, { matched: false, status: 'no-order-event' });
  assert.deepEqual(saved.map((entry) => entry.args), [['interaction-snapshot']]);
  controller.endRound(round);
  controller.stop();
});

test('continuous submit capture restores saveChart before unrelated saves outside the capture', async () => {
  const { api, saved, setDrawingToolName } = createTradingViewApi();
  const originalSaveChart = api.saveChart;
  const timers = createManualTimers();
  const controller = createTradingViewContinuousSaveController(api, {
    settleQuietMs: 20,
    maxWaitMs: 100,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });
  const round = controller.beginRound();
  const capture = controller.beginSubmitCapture(round);
  setDrawingToolName('order-1', 'LineToolOrder');

  api.emit('drawing_event', 'order-1', 'properties_changed');
  api.saveChart('order-snapshot');
  const completion = controller.completeSubmitCapture(capture);
  timers.advance(20);
  await completion;
  assert.equal(api.saveChart, originalSaveChart);

  api.saveChart('unrelated-snapshot');
  assert.deepEqual(saved.map((entry) => entry.args), [['unrelated-snapshot']]);
  controller.endRound(round);
  assert.deepEqual(saved.map((entry) => entry.args), [
    ['unrelated-snapshot'],
    ['order-snapshot'],
  ]);
  controller.stop();
});

test('continuous submit capture flushes the pending round snapshot on stop', async () => {
  const { api, saved, listeners, setDrawingToolName } = createTradingViewApi();
  const originalSaveChart = api.saveChart;
  const timers = createManualTimers();
  const controller = createTradingViewContinuousSaveController(api, {
    settleQuietMs: 20,
    maxWaitMs: 100,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });
  const round = controller.beginRound();
  const capture = controller.beginSubmitCapture(round);
  setDrawingToolName('order-1', 'LineToolOrder');
  api.emit('drawing_event', 'order-1', 'properties_changed');
  api.saveChart('pending-round');
  const completion = controller.completeSubmitCapture(capture);
  timers.advance(20);
  await completion;

  assert.deepEqual(controller.stop(), expectedContinuousStats({
    deferredSubmitSaveCount: 1,
    fullSaveCount: 1,
    orderEventCount: 1,
    saveRequestCount: 1,
  }));
  assert.deepEqual(saved.map((entry) => entry.args), [['pending-round']]);
  assert.equal(api.saveChart, originalSaveChart);
  assert.equal(listeners.get('drawing_event')?.size, 0);
});

test('continuous submit capture flushes pending state while keeping the round active', async () => {
  const { api, saved, setDrawingToolName } = createTradingViewApi();
  const timers = createManualTimers();
  const controller = createTradingViewContinuousSaveController(api, {
    settleQuietMs: 20,
    maxWaitMs: 100,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });
  const round = controller.beginRound();
  setDrawingToolName('order-1', 'LineToolOrder');
  const firstCapture = controller.beginSubmitCapture(round);
  api.emit('drawing_event', 'order-1', 'properties_changed');
  api.saveChart('snapshot-1');
  const firstCompletion = controller.completeSubmitCapture(firstCapture);
  timers.advance(20);
  await firstCompletion;

  controller.flush();
  assert.deepEqual(saved.map((entry) => entry.args), [['snapshot-1']]);

  setDrawingToolName('order-2', 'LineToolOrder');
  const secondCapture = controller.beginSubmitCapture(round);
  api.emit('drawing_event', 'order-2', 'properties_changed');
  api.saveChart('snapshot-2');
  const secondCompletion = controller.completeSubmitCapture(secondCapture);
  timers.advance(20);
  await secondCompletion;

  controller.endRound(round);
  assert.deepEqual(saved.map((entry) => entry.args), [['snapshot-1'], ['snapshot-2']]);
  controller.stop();
});

test('continuous submit capture does not wait for discovery after a lifecycle flush', async () => {
  const { api } = createTradingViewApi();
  const controller = createTradingViewContinuousSaveController(api);
  const round = controller.beginRound();
  const capture = controller.beginSubmitCapture(round);

  controller.flush();

  assert.deepEqual(await controller.completeSubmitCapture(capture), {
    matched: false,
    status: 'flushed',
  });
  controller.endRound(round);
  controller.stop();
});

test('continuous submit ownership expires from the moment capture is armed', async () => {
  const { api } = createTradingViewApi();
  const timers = createManualTimers();
  const controller = createTradingViewContinuousSaveController(api, {
    submitEventDiscoveryMs: 10,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });
  const round = controller.beginRound();
  const capture = controller.beginSubmitCapture(round);

  timers.advance(10);

  assert.deepEqual(await controller.completeSubmitCapture(capture), {
    matched: false,
    status: 'no-order-event',
  });
  controller.endRound(round);
  controller.stop();
});

test('continuous submit capture skips optimization when another save wrapper is active', async () => {
  const { api, saved, setDrawingToolName } = createTradingViewApi();
  const controller = createTradingViewContinuousSaveController(api);
  const round = controller.beginRound();
  const capture = controller.beginSubmitCapture(round);
  const foreignSaves = [];
  const sessionSaveChart = api.saveChart;
  api.saveChart = (...args) => foreignSaves.push(args);
  setDrawingToolName('order-1', 'LineToolOrder');

  api.emit('drawing_event', 'order-1', 'properties_changed');
  assert.deepEqual(await controller.completeSubmitCapture(capture), {
    matched: true,
    status: 'save-chart-busy',
  });
  api.saveChart('foreign-order-snapshot');
  assert.deepEqual(foreignSaves, [['foreign-order-snapshot']]);
  assert.deepEqual(saved, []);

  api.saveChart = sessionSaveChart;
  controller.endRound(round);
  controller.stop();
});

test('continuous submit capture preserves a wrapper installed during its active burst', async () => {
  const { api, saved, setDrawingToolName } = createTradingViewApi();
  const timers = createManualTimers();
  const controller = createTradingViewContinuousSaveController(api, {
    settleQuietMs: 20,
    maxWaitMs: 100,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });
  const round = controller.beginRound();
  const capture = controller.beginSubmitCapture(round);
  const sessionSaveChart = api.saveChart;
  setDrawingToolName('order-1', 'LineToolOrder');
  api.emit('drawing_event', 'order-1', 'properties_changed');
  api.saveChart('pending-round');

  const foreignSaves = [];
  const replacedSaveChart = api.saveChart;
  api.saveChart = function foreignSaveChart(...args) {
    foreignSaves.push({ thisValue: this, args });
    return replacedSaveChart.apply(this, args);
  };
  timers.advance(20);

  assert.deepEqual(await controller.completeSubmitCapture(capture), {
    matched: true,
    status: 'save-chart-replaced',
  });
  assert.deepEqual(foreignSaves, []);
  assert.deepEqual(saved.map((entry) => entry.args), [['pending-round']]);
  assert.notEqual(api.saveChart, sessionSaveChart);

  controller.endRound(round);
  api.saveChart = sessionSaveChart;
  controller.stop();
});

test('continuous submit final replay preserves a wrapper installed after capture', async () => {
  const { api, saved, setDrawingToolName } = createTradingViewApi();
  const timers = createManualTimers();
  const controller = createTradingViewContinuousSaveController(api, {
    settleQuietMs: 20,
    maxWaitMs: 100,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });
  const round = controller.beginRound();
  const capture = controller.beginSubmitCapture(round);
  setDrawingToolName('order-1', 'LineToolOrder');
  api.emit('drawing_event', 'order-1', 'properties_changed');
  api.saveChart('pending-round');
  const completion = controller.completeSubmitCapture(capture);
  timers.advance(20);
  await completion;

  const sessionSaveChart = api.saveChart;
  const foreignSaves = [];
  api.saveChart = function foreignSaveChart(...args) {
    foreignSaves.push({ thisValue: this, args });
    return sessionSaveChart.apply(this, args);
  };
  controller.endRound(round);

  assert.deepEqual(foreignSaves.map((entry) => entry.args), [['pending-round']]);
  assert.deepEqual(saved.map((entry) => entry.args), [['pending-round']]);
  api.saveChart = sessionSaveChart;
  controller.stop();
});

test('continuous submit final replay restores saveChart when the original save throws', async () => {
  const { api, setDrawingToolName } = createTradingViewApi();
  const originalSaveChart = function saveChart() {
    throw new Error('round save failed');
  };
  api.saveChart = originalSaveChart;
  const timers = createManualTimers();
  const controller = createTradingViewContinuousSaveController(api, {
    settleQuietMs: 20,
    maxWaitMs: 100,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });
  const round = controller.beginRound();
  const capture = controller.beginSubmitCapture(round);
  setDrawingToolName('order-1', 'LineToolOrder');
  api.emit('drawing_event', 'order-1', 'properties_changed');
  api.saveChart('pending-round');
  const completion = controller.completeSubmitCapture(capture);
  timers.advance(20);
  await completion;

  assert.throws(() => controller.endRound(round), /round save failed/);
  assert.equal(api.saveChart, originalSaveChart);
  controller.stop();
});

for (const drawingCount of [1, 5, 70, 120, 199, 200]) {
  test(`coalesces ${drawingCount} drawing saves into one final full save`, async () => {
    const { api, saved, listeners } = createTradingViewApi();
    const originalSaveChart = api.saveChart;

    const result = await coalesceTradingViewDrawingSaves(
      api,
      () => {
        for (let index = 0; index < drawingCount; index += 1) {
          api.emit('drawing_event', `order-${index}`, 'remove');
        }
        setTimeout(() => {
          for (let index = 0; index < drawingCount; index += 1) {
            api.saveChart(`snapshot-${index}`);
          }
        }, 0);
        return 'hidden';
      },
      { settleQuietMs: 1, timeoutMs: 100 },
    );

    assert.deepEqual(result, {
      actionResult: 'hidden',
      drawingEventCount: drawingCount,
      saveRequestCount: drawingCount,
      fullSaveCount: 1,
    });
    assert.equal(saved.length, 1);
    assert.equal(saved[0].thisValue, api);
    assert.deepEqual(saved[0].args, [`snapshot-${drawingCount - 1}`]);
    assert.equal(api.saveChart, originalSaveChart);
    assert.equal(listeners.get('drawing_event')?.size, 0);
  });
}

test('persists the cumulative final snapshot', async () => {
  const { api, saved } = createTradingViewApi();
  const snapshots = [
    { drawings: ['order-1'] },
    { drawings: ['order-1', 'order-2'] },
    { drawings: ['order-1', 'order-2', 'order-3'] },
  ];

  await coalesceTradingViewDrawingSaves(api, () => {
    for (const drawingId of snapshots.at(-1).drawings) {
      api.emit('drawing_event', drawingId, 'properties_changed');
    }
    setTimeout(() => {
      for (const snapshot of snapshots) api.saveChart(snapshot);
    }, 0);
  }, { settleQuietMs: 1, timeoutMs: 100 });

  assert.deepEqual(saved.map((entry) => entry.args[0]), [snapshots.at(-1)]);
});

test('waits for drawing events that arrive after the checkbox state changes', async () => {
  const { api, saved } = createTradingViewApi();

  const result = await coalesceTradingViewDrawingSaves(
    api,
    () => {
      setTimeout(() => {
        api.emit('drawing_event', 'order-1', 'remove');
        api.emit('drawing_event', 'order-2', 'remove');
        setTimeout(() => {
          api.saveChart('snapshot-1');
          api.saveChart('snapshot-2');
        }, 5);
      }, 10);
      return 'checkbox-changed';
    },
    { eventDiscoveryTimeoutMs: 50, settleQuietMs: 1, timeoutMs: 100 },
  );

  assert.deepEqual(result, {
    actionResult: 'checkbox-changed',
    drawingEventCount: 2,
    saveRequestCount: 2,
    fullSaveCount: 1,
  });
  assert.deepEqual(saved.map((entry) => entry.args), [['snapshot-2']]);
});

test('waits for interleaved drawing saves split across macrotasks', async () => {
  const { api, saved } = createTradingViewApi();

  const result = await coalesceTradingViewDrawingSaves(
    api,
    () => {
      for (let index = 0; index < 3; index += 1) {
        setTimeout(() => {
          api.emit('drawing_event', `order-${index}`, 'remove');
          api.saveChart(`snapshot-${index}`);
        }, index * 5);
      }
      return 'checkbox-changed';
    },
    {
      eventDiscoveryTimeoutMs: 20,
      settleQuietMs: 10,
      timeoutMs: 100,
    },
  );

  assert.deepEqual(result, {
    actionResult: 'checkbox-changed',
    drawingEventCount: 3,
    saveRequestCount: 3,
    fullSaveCount: 1,
  });
  assert.deepEqual(saved.map((entry) => entry.args), [['snapshot-2']]);
});

test('ignores drawing events that do not schedule chart saves', async () => {
  const { api, saved } = createTradingViewApi();

  const result = await coalesceTradingViewDrawingSaves(
    api,
    () => {
      api.emit('drawing_event', 'order-1', 'click');
      api.emit('drawing_event', 'order-1', 'move');
      return 'unchanged';
    },
    { eventDiscoveryTimeoutMs: 5 },
  );

  assert.deepEqual(result, {
    actionResult: 'unchanged',
    drawingEventCount: 0,
    saveRequestCount: 0,
    fullSaveCount: 0,
  });
  assert.deepEqual(saved, []);
});

test('skips discovery when the caller proves that no drawings can exist', async () => {
  const { api, saved } = createTradingViewApi();
  let timerCalls = 0;

  const result = await coalesceTradingViewDrawingSaves(
    api,
    () => 'definitively-empty',
    {
      eventDiscoveryTimeoutMs: 0,
      setTimeoutFn() {
        timerCalls += 1;
        throw new Error('drawing discovery timer must not start');
      },
    },
  );

  assert.deepEqual(result, {
    actionResult: 'definitively-empty',
    drawingEventCount: 0,
    saveRequestCount: 0,
    fullSaveCount: 0,
  });
  assert.equal(timerCalls, 0);
  assert.deepEqual(saved, []);
});

test('restores saveChart and its subscription after action failure', async () => {
  const { api, saved, listeners } = createTradingViewApi();
  const originalSaveChart = api.saveChart;

  await assert.rejects(
    coalesceTradingViewDrawingSaves(api, () => {
      api.emit('drawing_event', 'order-1', 'remove');
      throw new Error('chart toggle failed');
    }),
    /chart toggle failed/,
  );

  assert.equal(api.saveChart, originalSaveChart);
  assert.equal(listeners.get('drawing_event')?.size, 0);
  api.saveChart('after-error');
  assert.deepEqual(saved.map((entry) => entry.args), [['after-error']]);
});

test('times out when drawing events do not produce matching save requests', async () => {
  const { api, saved } = createTradingViewApi();
  const originalSaveChart = api.saveChart;

  await assert.rejects(
    coalesceTradingViewDrawingSaves(
      api,
      () => api.emit('drawing_event', 'order-1', 'remove'),
      { timeoutMs: 10 },
    ),
    /图表保存请求数量不一致：预期 1，实际 0/,
  );

  assert.equal(api.saveChart, originalSaveChart);
  api.saveChart('after-timeout');
  assert.deepEqual(saved.map((entry) => entry.args), [['after-timeout']]);
});

test('restores the original method when the final full save throws', async () => {
  const { api } = createTradingViewApi();
  const originalSaveChart = function saveChart() {
    throw new Error('save failed');
  };
  api.saveChart = originalSaveChart;

  await assert.rejects(
    coalesceTradingViewDrawingSaves(api, () => {
      api.emit('drawing_event', 'order-1', 'properties_changed');
      setTimeout(() => api.saveChart('snapshot'), 0);
    }, { settleQuietMs: 1, timeoutMs: 100 }),
    /save failed/,
  );

  assert.equal(api.saveChart, originalSaveChart);
});
