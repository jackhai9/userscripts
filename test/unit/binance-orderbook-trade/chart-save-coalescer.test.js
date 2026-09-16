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

test('user keeps unrelated chart saves synchronous before a removal starts', async () => {
  // Given a native chart API and a removal-save lifecycle with recorded saves.
  const { api, saved, listeners } = createTradingViewApi();
  const originalSaveChart = api.saveChart;
  const controller = createTradingViewRemovalSaveController(api, { eventDiscoveryMs: 0 });
  assert.notEqual(api.saveChart, originalSaveChart);

  // When the native chart requests its next snapshot.
  api.saveChart('unrelated');

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.deepEqual(saved.map((entry) => entry.args), [['unrelated']]);

  // When the removal lifecycle requests its final snapshot.
  const lifecycleResult1 = await controller.finish();

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.deepEqual(lifecycleResult1, {
    fullSaveCount: 0,
    removeEventCount: 0,
    saveRequestCount: 0,
    synchronousSaveCount: 1,
  });
  assert.equal(api.saveChart, originalSaveChart);
  assert.deepEqual(saved.map((entry) => entry.args), [['unrelated']]);
  assert.equal(listeners.get('drawing_event')?.size, 0);
});

test('user persists the latest chart snapshot across separate removal bursts', async () => {
  // Given a native chart API and a removal-save lifecycle with recorded saves.
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

  // When native drawing events and their save requests are delivered.
  api.emit('drawing_event', 'order-1', 'remove');
  api.saveChart('snapshot-1');
  timers.advance(20);

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.notEqual(api.saveChart, originalSaveChart);
  assert.deepEqual(saved, []);

  // When the native chart requests its next snapshot.
  api.saveChart('unrelated-between-bursts');
  api.emit('drawing_event', 'order-2', 'remove');
  api.saveChart('snapshot-2');
  const completion = controller.finish();
  timers.advance(20);
  const result = await completion;

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
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

test('user includes delayed removal events before the chart lifecycle finishes', async () => {
  // Given a native chart API and a removal-save lifecycle with recorded saves.
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

  // When virtual time reaches the next capture or settle deadline.
  timers.advance(10);
  api.emit('drawing_event', 'order-1', 'remove');
  api.saveChart('snapshot-1');
  timers.advance(20);

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.deepEqual(await completion, {
    fullSaveCount: 1,
    removeEventCount: 1,
    saveRequestCount: 1,
    synchronousSaveCount: 0,
  });
  assert.deepEqual(saved.map((entry) => entry.args), [['snapshot-1']]);
});

test('user saves unrelated chart changes immediately during a removal lifecycle', async () => {
  // Given a native chart API and a removal-save lifecycle with recorded saves.
  const { api, saved } = createTradingViewApi();
  const controller = createTradingViewRemovalSaveController(api, { eventDiscoveryMs: 0 });

  // When native drawing events and their save requests are delivered.
  api.emit('drawing_event', 'order-1', 'properties_changed');
  api.saveChart('unrelated');
  const lifecycleResult1 = await controller.finish();

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.deepEqual(lifecycleResult1, {
    fullSaveCount: 0,
    removeEventCount: 0,
    saveRequestCount: 0,
    synchronousSaveCount: 1,
  });
  assert.deepEqual(saved.map((entry) => entry.args), [['unrelated']]);
});

test('user keeps the newer synchronous chart snapshot over an older deferred removal', async () => {
  // Given a native chart API and a removal-save lifecycle with recorded saves.
  const { api, saved } = createTradingViewApi();
  const timers = createManualTimers();
  const controller = createTradingViewRemovalSaveController(api, {
    settleQuietMs: 20,
    maxWaitMs: 100,
    eventDiscoveryMs: 0,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  // When native drawing events and their save requests are delivered.
  api.emit('drawing_event', 'order-1', 'remove');
  api.saveChart('removal-snapshot');
  timers.advance(20);
  api.saveChart('newer-unrelated-snapshot');
  const lifecycleResult1 = await controller.finish();

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.deepEqual(lifecycleResult1, {
    fullSaveCount: 0,
    removeEventCount: 1,
    saveRequestCount: 1,
    synchronousSaveCount: 1,
  });
  assert.deepEqual(saved.map((entry) => entry.args), [['newer-unrelated-snapshot']]);
});

test('user keeps a chart save method replaced by another operation during removals', async () => {
  // Given a native chart API and a removal-save lifecycle with recorded saves.
  const { api, saved, listeners } = createTradingViewApi();
  const timers = createManualTimers();
  const controller = createTradingViewRemovalSaveController(api, {
    settleQuietMs: 20,
    maxWaitMs: 100,
    eventDiscoveryMs: 0,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  // When native drawing events and their save requests are delivered.
  api.emit('drawing_event', 'order-1', 'remove');
  api.saveChart('old-removal-snapshot');
  const foreignSaves = [];
  const foreignSaveChart = (...args) => foreignSaves.push(args);
  api.saveChart = foreignSaveChart;
  api.saveChart('newer-foreign-snapshot');
  timers.advance(20);
  const lifecycleResult1 = controller.finish();

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  await assert.rejects(lifecycleResult1, /图表保存接口在删除事件合并期间发生变化/);
  assert.equal(api.saveChart, foreignSaveChart);
  assert.deepEqual(saved, []);
  assert.deepEqual(foreignSaves, [['newer-foreign-snapshot']]);
  assert.equal(listeners.get('drawing_event')?.size, 0);
});

test('user avoids replaying a settled removal snapshot after save ownership changes', async () => {
  // Given a native chart API and a removal-save lifecycle with recorded saves.
  const { api, saved } = createTradingViewApi();
  const timers = createManualTimers();
  const controller = createTradingViewRemovalSaveController(api, {
    settleQuietMs: 20,
    maxWaitMs: 100,
    eventDiscoveryMs: 0,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  // When native drawing events and their save requests are delivered.
  api.emit('drawing_event', 'order-1', 'remove');
  api.saveChart('old-removal-snapshot');
  timers.advance(20);
  const foreignSaves = [];
  const foreignSaveChart = (...args) => foreignSaves.push(args);
  api.saveChart = foreignSaveChart;
  api.saveChart('newer-foreign-snapshot');
  const lifecycleResult1 = controller.finish();

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  await assert.rejects(
    lifecycleResult1,
    /图表保存接口在删除事件监视期间发生变化/,
  );
  assert.equal(api.saveChart, foreignSaveChart);
  assert.deepEqual(saved, []);
  assert.deepEqual(foreignSaves, [['newer-foreign-snapshot']]);
});

test('user regains chart ownership before a final removal-save failure is reported', async () => {
  // Given a native chart API and a removal-save lifecycle with recorded saves.
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

  // When native drawing events and their save requests are delivered.
  api.emit('drawing_event', 'order-1', 'remove');
  api.saveChart('snapshot-1');
  const completion = controller.finish();
  timers.advance(20);

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  await assert.rejects(completion, /final save failed/);
  assert.equal(api.saveChart, originalSaveChart);
  assert.equal(listeners.get('drawing_event')?.size, 0);
});

test('user gets the ownership error without invoking an obsolete failing save method', async () => {
  // Given a native chart API and a removal-save lifecycle with recorded saves.
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

  // When native drawing events and their save requests are delivered.
  api.emit('drawing_event', 'order-1', 'remove');
  api.saveChart('pending-snapshot');
  const foreignSaveChart = () => {};
  api.saveChart = foreignSaveChart;
  timers.advance(20);
  const lifecycleResult1 = controller.finish();

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  await assert.rejects(
    lifecycleResult1,
    /图表保存接口在删除事件合并期间发生变化/,
  );
  assert.equal(api.saveChart, foreignSaveChart);
  assert.equal(listeners.get('drawing_event')?.size, 0);
});

test('user keeps unrelated saves synchronous throughout continuous closing', () => {
  // Given a native chart API and a continuous-save controller with recorded saves.
  const { api, saved } = createTradingViewApi();
  const originalSaveChart = api.saveChart;
  const timers = createManualTimers();
  const coalescer = createTradingViewContinuousSaveController(api, {
    settleQuietMs: 20,
    maxWaitMs: 100,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  // When the native chart requests its next snapshot.
  api.saveChart('unrelated');

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.deepEqual(saved.map((entry) => entry.args), [['unrelated']]);

  // When the chart-save controller stops and releases its lifecycle.
  const lifecycleResult1 = coalescer.stop();

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.deepEqual(lifecycleResult1, expectedContinuousStats());
  assert.equal(api.saveChart, originalSaveChart);
});

test('user persists only the final snapshot from a continuous-close removal burst', () => {
  // Given a native chart API and a continuous-save controller with recorded saves.
  const { api, saved } = createTradingViewApi();
  const timers = createManualTimers();
  const coalescer = createTradingViewContinuousSaveController(api, {
    settleQuietMs: 20,
    maxWaitMs: 100,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  // When native drawing events and their save requests are delivered.
  api.emit('drawing_event', 'order-1', 'remove');
  api.saveChart('snapshot-1');
  timers.advance(10);
  api.emit('drawing_event', 'order-2', 'remove');
  api.saveChart('snapshot-2');
  timers.advance(10);
  api.emit('drawing_event', 'order-3', 'remove');
  api.saveChart('snapshot-3');
  timers.advance(19);

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.deepEqual(saved, []);

  // When virtual time reaches the next capture or settle deadline.
  timers.advance(1);

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.deepEqual(saved.map((entry) => entry.args), [['snapshot-3']]);

  // When the chart-save controller stops and releases its lifecycle.
  const lifecycleResult1 = coalescer.stop();

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.deepEqual(lifecycleResult1, expectedContinuousStats({
    fullSaveCount: 1,
    removeEventCount: 3,
    saveRequestCount: 3,
  }));
});

test('user gets a chart save at the maximum deadline during sustained removals', () => {
  // Given a native chart API and a continuous-save controller with recorded saves.
  const { api, saved } = createTradingViewApi();
  const timers = createManualTimers();
  const coalescer = createTradingViewContinuousSaveController(api, {
    settleQuietMs: 50,
    maxWaitMs: 100,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  // When native drawing events and their save requests are delivered.
  api.emit('drawing_event', 'order-1', 'remove');
  api.saveChart('snapshot-1');
  for (let index = 2; index <= 5; index += 1) {
    timers.advance(20);
    api.emit('drawing_event', `order-${index}`, 'remove');
    api.saveChart(`snapshot-${index}`);
  }
  timers.advance(20);

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.deepEqual(saved.map((entry) => entry.args), [['snapshot-5']]);
  coalescer.stop();
});

test('user flushes pending chart state and restores normal saving when stopping', () => {
  // Given a native chart API and a continuous-save controller with recorded saves.
  const { api, saved } = createTradingViewApi();
  const originalSaveChart = api.saveChart;
  const timers = createManualTimers();
  const coalescer = createTradingViewContinuousSaveController(api, {
    settleQuietMs: 20,
    maxWaitMs: 100,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  // When native drawing events and their save requests are delivered.
  api.emit('drawing_event', 'order-1', 'remove');
  api.saveChart('pending-final');
  const lifecycleResult1 = coalescer.stop();

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.deepEqual(lifecycleResult1, expectedContinuousStats({
    fullSaveCount: 1,
    removeEventCount: 1,
    saveRequestCount: 1,
  }));
  assert.deepEqual(saved.map((entry) => entry.args), [['pending-final']]);
  assert.equal(api.saveChart, originalSaveChart);
  assert.equal(timers.timers.size, 0);

  // When the native chart requests its next snapshot.
  api.saveChart('after-stop');

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.deepEqual(saved.map((entry) => entry.args), [['pending-final'], ['after-stop']]);
});

test('user saves unrelated drawing properties outside removal bursts', () => {
  // Given a native chart API and a continuous-save controller with recorded saves.
  const { api, saved } = createTradingViewApi();
  const coalescer = createTradingViewContinuousSaveController(api);

  // When native drawing events and their save requests are delivered.
  api.emit('drawing_event', 'order-1', 'properties_changed');
  api.saveChart('properties');

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.deepEqual(saved.map((entry) => entry.args), [['properties']]);

  // When the chart-save controller stops and releases its lifecycle.
  const lifecycleResult1 = coalescer.stop();

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.deepEqual(lifecycleResult1, expectedContinuousStats());
});

test('user keeps another operation in control of chart saving', () => {
  // Given a native chart API and a continuous-save controller with recorded saves.
  const { api, saved } = createTradingViewApi();
  const controller = createTradingViewContinuousSaveController(api);
  const sessionSaveChart = api.saveChart;
  const foreignSaves = [];
  api.saveChart = (...args) => foreignSaves.push(args);

  // When native drawing events and their save requests are delivered.
  api.emit('drawing_event', 'order-1', 'remove');
  api.saveChart('foreign');

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.deepEqual(foreignSaves, [['foreign']]);
  assert.deepEqual(saved, []);

  // When the next chart lifecycle operation runs.
  api.saveChart = sessionSaveChart;
  const lifecycleResult1 = controller.stop();

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.deepEqual(lifecycleResult1, expectedContinuousStats({ removeEventCount: 1 }));
});

test('user regains the original chart method after a stop-time save failure', () => {
  // Given a native chart API and a continuous-save controller with recorded saves.
  const { api, listeners } = createTradingViewApi();
  const originalSaveChart = function saveChart() {
    throw new Error('final save failed');
  };
  api.saveChart = originalSaveChart;
  const controller = createTradingViewContinuousSaveController(api);

  // When native drawing events and their save requests are delivered.
  api.emit('drawing_event', 'order-1', 'remove');
  api.saveChart('pending');

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.throws(() => controller.stop(), /final save failed/);
  assert.equal(api.saveChart, originalSaveChart);
  assert.equal(listeners.get('drawing_event')?.size, 0);
});

test('user persists one final chart snapshot after five confirmed order-line captures', async () => {
  // Given a native chart API, an active close round, and order-line capture state.
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

  // When the native chart delivers the next sequence of drawing events and saves.
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
  const lifecycleResult1 = controller.endRound(round);

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.deepEqual(lifecycleResult1, expectedContinuousStats({
    deferredSubmitSaveCount: 5,
    fullSaveCount: 1,
    orderEventCount: 5,
    saveRequestCount: 5,
  }));
  assert.deepEqual(saved.map((entry) => entry.args), [['snapshot-5']]);
  controller.stop();
});

test('user keeps the final snapshot when one submit produces several order-line changes', async () => {
  // Given a native chart API, an active close round, and order-line capture state.
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

  // When native drawing events and their save requests are delivered.
  api.emit('drawing_event', 'order-1', 'properties_changed');
  api.saveChart('snapshot-1');
  timers.advance(10);
  api.emit('drawing_event', 'order-2', 'properties_changed');
  api.saveChart('snapshot-2');
  const completion = controller.completeSubmitCapture(capture);
  timers.advance(20);

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.deepEqual(await completion, { matched: true, status: 'captured' });

  // When the active chart-save round finishes.
  controller.endRound(round);

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.deepEqual(saved.map((entry) => entry.args), [['snapshot-2']]);

  // When the chart-save controller stops and releases its lifecycle.
  const lifecycleResult1 = controller.stop();

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.deepEqual(lifecycleResult1, expectedContinuousStats({
    deferredSubmitSaveCount: 1,
    fullSaveCount: 1,
    orderEventCount: 2,
    saveRequestCount: 2,
  }));
});

test('user persists preceding removals separately from the current submit capture', async () => {
  // Given a native chart API, an active close round, and order-line capture state.
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

  // When native drawing events and their save requests are delivered.
  api.emit('drawing_event', 'removed-order', 'remove');
  api.saveChart('remove-snapshot');
  api.emit('drawing_event', 'order-1', 'properties_changed');
  api.saveChart('order-snapshot');
  const completion = controller.completeSubmitCapture(capture);
  timers.advance(20);

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.deepEqual(await completion, { matched: true, status: 'captured' });
  assert.deepEqual(saved.map((entry) => entry.args), [['remove-snapshot']]);

  // When the active chart-save round finishes.
  controller.endRound(round);

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.deepEqual(saved.map((entry) => entry.args), [
    ['remove-snapshot'],
    ['order-snapshot'],
  ]);
  controller.stop();
});

test('user keeps a newer removal snapshot over an older deferred submission', async () => {
  // Given a native chart API, an active close round, and order-line capture state.
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

  // When native drawing events and their save requests are delivered.
  api.emit('drawing_event', 'order-1', 'properties_changed');
  api.saveChart('order-snapshot');
  api.emit('drawing_event', 'removed-order', 'remove');
  api.saveChart('newer-remove-snapshot');
  timers.advance(20);
  const lifecycleResult1 = await controller.completeSubmitCapture(capture);

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.deepEqual(lifecycleResult1, {
    matched: true,
    status: 'captured',
  });

  // When the active chart-save round finishes.
  controller.endRound(round);

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.deepEqual(saved.map((entry) => entry.args), [['newer-remove-snapshot']]);
  controller.stop();
});

test('user saves position lines immediately while an order-line capture is armed', async () => {
  // Given a native chart API, an active close round, and order-line capture state.
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

  // When native drawing events and their save requests are delivered.
  api.emit('drawing_event', 'position-1', 'properties_changed');
  api.saveChart('position-snapshot');
  const completion = controller.completeSubmitCapture(capture);
  timers.advance(10);

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.deepEqual(await completion, { matched: false, status: 'no-order-event' });
  assert.deepEqual(saved.map((entry) => entry.args), [['position-snapshot']]);
  controller.endRound(round);
  controller.stop();
});

test('user does not treat order-line clicks or moves as submission drawings', async () => {
  // Given a native chart API, an active close round, and order-line capture state.
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

  // When native drawing events and their save requests are delivered.
  api.emit('drawing_event', 'order-1', 'click');
  api.emit('drawing_event', 'order-1', 'move');
  api.saveChart('interaction-snapshot');
  const completion = controller.completeSubmitCapture(capture);
  timers.advance(10);

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.deepEqual(await completion, { matched: false, status: 'no-order-event' });
  assert.deepEqual(saved.map((entry) => entry.args), [['interaction-snapshot']]);
  controller.endRound(round);
  controller.stop();
});

test('user can save unrelated chart changes after an order-line capture settles', async () => {
  // Given a native chart API, an active close round, and order-line capture state.
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

  // When native drawing events and their save requests are delivered.
  api.emit('drawing_event', 'order-1', 'properties_changed');
  api.saveChart('order-snapshot');
  const completion = controller.completeSubmitCapture(capture);
  timers.advance(20);
  await completion;

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.equal(api.saveChart, originalSaveChart);

  // When the native chart requests its next snapshot.
  api.saveChart('unrelated-snapshot');

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.deepEqual(saved.map((entry) => entry.args), [['unrelated-snapshot']]);

  // When the active chart-save round finishes.
  controller.endRound(round);

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.deepEqual(saved.map((entry) => entry.args), [
    ['unrelated-snapshot'],
    ['order-snapshot'],
  ]);
  controller.stop();
});

test('user persists the pending order-line snapshot when continuous closing stops', async () => {
  // Given a native chart API, an active close round, and order-line capture state.
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

  // When native drawing events and their save requests are delivered.
  api.emit('drawing_event', 'order-1', 'properties_changed');
  api.saveChart('pending-round');
  const completion = controller.completeSubmitCapture(capture);
  timers.advance(20);
  await completion;
  const lifecycleResult1 = controller.stop();

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.deepEqual(lifecycleResult1, expectedContinuousStats({
    deferredSubmitSaveCount: 1,
    fullSaveCount: 1,
    orderEventCount: 1,
    saveRequestCount: 1,
  }));
  assert.deepEqual(saved.map((entry) => entry.args), [['pending-round']]);
  assert.equal(api.saveChart, originalSaveChart);
  assert.equal(listeners.get('drawing_event')?.size, 0);
});

test('user can flush chart state and continue capturing the same close round', async () => {
  // Given a native chart API, an active close round, and order-line capture state.
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

  // When native drawing events and their save requests are delivered.
  api.emit('drawing_event', 'order-1', 'properties_changed');
  api.saveChart('snapshot-1');
  const firstCompletion = controller.completeSubmitCapture(firstCapture);
  timers.advance(20);
  await firstCompletion;
  controller.flush();

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.deepEqual(saved.map((entry) => entry.args), [['snapshot-1']]);

  // When the next chart lifecycle operation runs.
  setDrawingToolName('order-2', 'LineToolOrder');
  const secondCapture = controller.beginSubmitCapture(round);
  api.emit('drawing_event', 'order-2', 'properties_changed');
  api.saveChart('snapshot-2');
  const secondCompletion = controller.completeSubmitCapture(secondCapture);
  timers.advance(20);
  await secondCompletion;
  controller.endRound(round);

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.deepEqual(saved.map((entry) => entry.args), [['snapshot-1'], ['snapshot-2']]);
  controller.stop();
});

test('user finishes an unmatched order-line capture immediately on a lifecycle flush', async () => {
  // Given a native chart API, an active close round, and order-line capture state.
  const { api } = createTradingViewApi();
  const controller = createTradingViewContinuousSaveController(api);
  const round = controller.beginRound();
  const capture = controller.beginSubmitCapture(round);

  // When the active chart-save lifecycle is flushed.
  controller.flush();
  const lifecycleResult1 = await controller.completeSubmitCapture(capture);

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.deepEqual(lifecycleResult1, {
    matched: false,
    status: 'flushed',
  });
  controller.endRound(round);
  controller.stop();
});

test('user releases an unmatched order-line capture at its discovery deadline', async () => {
  // Given a native chart API, an active close round, and order-line capture state.
  const { api } = createTradingViewApi();
  const timers = createManualTimers();
  const controller = createTradingViewContinuousSaveController(api, {
    submitEventDiscoveryMs: 10,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });
  const round = controller.beginRound();
  const capture = controller.beginSubmitCapture(round);

  // When virtual time reaches the next capture or settle deadline.
  timers.advance(10);
  const lifecycleResult1 = await controller.completeSubmitCapture(capture);

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.deepEqual(lifecycleResult1, {
    matched: false,
    status: 'no-order-event',
  });
  controller.endRound(round);
  controller.stop();
});

test('user keeps an existing chart save owner when the submitted order line arrives', async () => {
  // Given a native chart API, an active close round, and order-line capture state.
  const { api, saved, setDrawingToolName } = createTradingViewApi();
  const controller = createTradingViewContinuousSaveController(api);
  const round = controller.beginRound();
  const capture = controller.beginSubmitCapture(round);
  const foreignSaves = [];
  const sessionSaveChart = api.saveChart;
  api.saveChart = (...args) => foreignSaves.push(args);
  setDrawingToolName('order-1', 'LineToolOrder');

  // When native drawing events and their save requests are delivered.
  api.emit('drawing_event', 'order-1', 'properties_changed');
  const lifecycleResult1 = await controller.completeSubmitCapture(capture);

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.deepEqual(lifecycleResult1, {
    matched: true,
    status: 'save-chart-busy',
  });

  // When the native chart requests its next snapshot.
  api.saveChart('foreign-order-snapshot');

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.deepEqual(foreignSaves, [['foreign-order-snapshot']]);
  assert.deepEqual(saved, []);
  api.saveChart = sessionSaveChart;
  controller.endRound(round);
  controller.stop();
});

test('user preserves a chart wrapper installed during an active submit capture', async () => {
  // Given a native chart API, an active close round, and order-line capture state.
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

  // When native drawing events and their save requests are delivered.
  api.emit('drawing_event', 'order-1', 'properties_changed');
  api.saveChart('pending-round');
  const foreignSaves = [];
  const replacedSaveChart = api.saveChart;
  api.saveChart = function foreignSaveChart(...args) {
    foreignSaves.push({ thisValue: this, args });
    return replacedSaveChart.apply(this, args);
  };
  timers.advance(20);
  const lifecycleResult1 = await controller.completeSubmitCapture(capture);

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.deepEqual(lifecycleResult1, {
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

test('user replays the final round snapshot through the latest chart save owner', async () => {
  // Given a native chart API, an active close round, and order-line capture state.
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

  // When native drawing events and their save requests are delivered.
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

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.deepEqual(foreignSaves.map((entry) => entry.args), [['pending-round']]);
  assert.deepEqual(saved.map((entry) => entry.args), [['pending-round']]);
  api.saveChart = sessionSaveChart;
  controller.stop();
});

test('user regains chart saving after the final round snapshot fails', async () => {
  // Given a native chart API, an active close round, and order-line capture state.
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

  // When native drawing events and their save requests are delivered.
  api.emit('drawing_event', 'order-1', 'properties_changed');
  api.saveChart('pending-round');
  const completion = controller.completeSubmitCapture(capture);
  timers.advance(20);
  await completion;

  // Then saves, capture results, and chart ownership match the observed lifecycle state.
  assert.throws(() => controller.endRound(round), /round save failed/);
  assert.equal(api.saveChart, originalSaveChart);
  controller.stop();
});

for (const drawingCount of [1, 5, 70, 120, 199, 200]) {
  test(`user persists one final chart snapshot for ${drawingCount} drawing removals`, async () => {
    // Given the chart API, original save method, and a manual timer scheduler.
    const { api, saved, listeners } = createTradingViewApi();
    const originalSaveChart = api.saveChart;
    const timers = createManualTimers();

    // When a native drawing action emits removals and matching saves arrive after the action.
    const completion = coalesceTradingViewDrawingSaves(api, () => {
      for (let index = 0; index < drawingCount; index += 1) api.emit('drawing_event', 'order-' + index, 'remove');
      return 'hidden';
    }, { settleQuietMs: 1, timeoutMs: 100, ...timers });
    await Promise.resolve();
    for (let index = 0; index < drawingCount; index += 1) api.saveChart('snapshot-' + index);
    timers.advance(1);
    const result = await completion;

    // Then exactly the last cumulative save is persisted and chart ownership is released.
    assert.deepEqual(result, { actionResult: 'hidden', drawingEventCount: drawingCount, saveRequestCount: drawingCount, fullSaveCount: 1 });
    assert.equal(saved.length, 1);
    assert.equal(saved[0].thisValue, api);
    assert.deepEqual(saved[0].args, ['snapshot-' + (drawingCount - 1)]);
    assert.equal(api.saveChart, originalSaveChart);
    assert.equal(listeners.get('drawing_event')?.size, 0);
    assert.equal(timers.timers.size, 0);
  });
}

test('user persists the cumulative final drawing snapshot', async () => {
  // Given three cumulative native chart snapshots and a manual clock.
  const { api, saved } = createTradingViewApi();
  const timers = createManualTimers();
  const snapshots = [{ drawings: ['order-1'] }, { drawings: ['order-1', 'order-2'] }, { drawings: ['order-1', 'order-2', 'order-3'] }];

  // When the drawing action completes and all three save requests settle.
  const completion = coalesceTradingViewDrawingSaves(api, () => {
    for (const drawingId of snapshots.at(-1).drawings) api.emit('drawing_event', drawingId, 'properties_changed');
  }, { settleQuietMs: 1, timeoutMs: 100, ...timers });
  await Promise.resolve();
  for (const snapshot of snapshots) api.saveChart(snapshot);
  timers.advance(1);
  await completion;

  // Then persisted drawings equal the final cumulative snapshot.
  assert.deepEqual(saved.map((entry) => entry.args[0]), [snapshots.at(-1)]);
});

test('user waits for drawing changes that follow the checkbox update', async () => {
  // Given an updated checkbox whose broker drawings have not arrived yet.
  const { api, saved } = createTradingViewApi();
  const timers = createManualTimers();

  // When drawing changes arrive at 10 ms and their saves arrive another 5 ms later.
  const completion = coalesceTradingViewDrawingSaves(api, () => 'checkbox-changed', {
    eventDiscoveryTimeoutMs: 50, settleQuietMs: 1, timeoutMs: 100, ...timers,
  });
  await Promise.resolve();
  timers.advance(10);
  api.emit('drawing_event', 'order-1', 'remove');
  api.emit('drawing_event', 'order-2', 'remove');
  timers.advance(5);
  api.saveChart('snapshot-1');
  api.saveChart('snapshot-2');
  timers.advance(1);
  const result = await completion;

  // Then both delayed changes contribute to one final snapshot.
  assert.deepEqual(result, { actionResult: 'checkbox-changed', drawingEventCount: 2, saveRequestCount: 2, fullSaveCount: 1 });
  assert.deepEqual(saved.map((entry) => entry.args), [['snapshot-2']]);
  assert.equal(timers.timers.size, 0);
});

test('user waits for a full quiet window after interleaved drawing changes and saves', async () => {
  // Given a native checkbox action and a 10 ms quiet window on a manual clock.
  const { api, saved } = createTradingViewApi();
  const timers = createManualTimers();

  // When three drawing/save pairs arrive in separate ticks five milliseconds apart.
  const completion = coalesceTradingViewDrawingSaves(api, () => 'checkbox-changed', {
    eventDiscoveryTimeoutMs: 20, settleQuietMs: 10, timeoutMs: 100, ...timers,
  });
  await Promise.resolve();
  for (let index = 0; index < 3; index += 1) {
    if (index > 0) timers.advance(5);
    api.emit('drawing_event', 'order-' + index, 'remove');
    api.saveChart('snapshot-' + index);
  }
  timers.advance(9);

  // Then no snapshot is persisted one millisecond before the final quiet window closes.
  assert.deepEqual(saved, []);

  // When the complete quiet window elapses.
  timers.advance(1);
  const result = await completion;

  // Then all three drawing changes settle into the final cumulative snapshot.
  assert.deepEqual(result, { actionResult: 'checkbox-changed', drawingEventCount: 3, saveRequestCount: 3, fullSaveCount: 1 });
  assert.deepEqual(saved.map((entry) => entry.args), [['snapshot-2']]);
});

test('user does not wait for save requests from click or move drawing events', async () => {
  // Given a manual discovery clock and drawing interactions that do not change chart data.
  const { api, saved } = createTradingViewApi();
  const timers = createManualTimers();

  // When the action emits only click and move events and discovery expires.
  const completion = coalesceTradingViewDrawingSaves(api, () => {
    api.emit('drawing_event', 'order-1', 'click');
    api.emit('drawing_event', 'order-1', 'move');
    return 'unchanged';
  }, { eventDiscoveryTimeoutMs: 5, ...timers });
  await Promise.resolve();
  timers.advance(5);
  const result = await completion;

  // Then the unchanged result contains no drawing mutations or full saves.
  assert.deepEqual(result, { actionResult: 'unchanged', drawingEventCount: 0, saveRequestCount: 0, fullSaveCount: 0 });
  assert.deepEqual(saved, []);
  assert.equal(timers.timers.size, 0);
});

test('user skips event discovery when the chart is definitively empty', async () => {
  // Given an empty-chart action and a timer adapter that rejects unexpected scheduling.
  const { api, saved } = createTradingViewApi();
  let timerCalls = 0;
  const options = {
    eventDiscoveryTimeoutMs: 0,
    setTimeoutFn() { timerCalls += 1; throw new Error('drawing discovery timer must not start'); },
  };

  // When the empty action is coalesced with discovery explicitly disabled.
  const result = await coalesceTradingViewDrawingSaves(api, () => 'definitively-empty', options);

  // Then the action completes without a timer or a chart write.
  assert.deepEqual(result, { actionResult: 'definitively-empty', drawingEventCount: 0, saveRequestCount: 0, fullSaveCount: 0 });
  assert.equal(timerCalls, 0);
  assert.deepEqual(saved, []);
});

test('user regains ordinary chart saving after the drawing action fails', async () => {
  // Given an action that emits a drawing event and then fails while toggling chart state.
  const { api, saved, listeners } = createTradingViewApi();
  const originalSaveChart = api.saveChart;
  const failure = new Error('chart toggle failed');

  // When the chart action throws before its expected save request arrives.
  const completion = coalesceTradingViewDrawingSaves(api, () => {
    api.emit('drawing_event', 'order-1', 'remove');
    throw failure;
  });

  // Then the action error is preserved and the original chart subscription and method are restored.
  await assert.rejects(completion, /chart toggle failed/);
  assert.equal(api.saveChart, originalSaveChart);
  assert.equal(listeners.get('drawing_event')?.size, 0);

  // When a later unrelated chart save is requested.
  api.saveChart('after-error');

  // Then it is persisted synchronously through the original method.
  assert.deepEqual(saved.map((entry) => entry.args), [['after-error']]);
});

test('user gets an exact missing-save count at the drawing-save deadline', async () => {
  // Given one drawing removal whose matching save request never arrives.
  const { api, saved, listeners } = createTradingViewApi();
  const originalSaveChart = api.saveChart;
  const timers = createManualTimers();

  // When the action completes and its 10 ms response deadline expires.
  const completion = coalesceTradingViewDrawingSaves(api, () => api.emit('drawing_event', 'order-1', 'remove'), { timeoutMs: 10, ...timers });
  await Promise.resolve();
  timers.advance(10);

  // Then the exact count mismatch is reported and timer, method, and listener ownership are restored.
  await assert.rejects(completion, /图表保存请求数量不一致：预期 1，实际 0/);
  assert.equal(api.saveChart, originalSaveChart);
  assert.equal(listeners.get('drawing_event')?.size, 0);
  assert.equal(timers.timers.size, 0);

  // When the user later requests an unrelated save.
  api.saveChart('after-timeout');

  // Then the ordinary save remains functional after the failed observation.
  assert.deepEqual(saved.map((entry) => entry.args), [['after-timeout']]);
});

test('user regains the original chart method when the final coalesced save fails', async () => {
  // Given a chart whose original full-save method throws.
  const { api, listeners } = createTradingViewApi();
  const originalSaveChart = function saveChart() { throw new Error('save failed'); };
  api.saveChart = originalSaveChart;
  const timers = createManualTimers();

  // When one drawing event and save request settle for final persistence.
  const completion = coalesceTradingViewDrawingSaves(api, () => api.emit('drawing_event', 'order-1', 'properties_changed'), {
    settleQuietMs: 1, timeoutMs: 100, ...timers,
  });
  await Promise.resolve();
  api.saveChart('snapshot');
  timers.advance(1);

  // Then the persistence failure does not leave the temporary save wrapper or listener installed.
  await assert.rejects(completion, /save failed/);
  assert.equal(api.saveChart, originalSaveChart);
  assert.equal(listeners.get('drawing_event')?.size, 0);
  assert.equal(timers.timers.size, 0);
});

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

test('user restores an inherited chart save method after a coalesced action', async () => {
  // Given a chart host inheriting its save method rather than owning that property.
  const { api, saved, listeners } = createTradingViewApi();
  const originalSaveChart = api.saveChart;
  const timers = createManualTimers();
  delete api.saveChart;
  Object.setPrototypeOf(api, { saveChart: originalSaveChart });

  // When one drawing event and save settle through the temporary wrapper.
  const completion = coalesceTradingViewDrawingSaves(api, () => api.emit('drawing_event', 'order-1', 'remove'), {
    settleQuietMs: 1, timeoutMs: 100, ...timers,
  });
  await Promise.resolve();
  api.saveChart('inherited-snapshot');
  timers.advance(1);
  const result = await completion;

  // Then the final snapshot uses the original receiver and the temporary own property is removed.
  assert.equal(result.fullSaveCount, 1);
  assert.equal(Object.hasOwn(api, 'saveChart'), false);
  assert.equal(api.saveChart, originalSaveChart);
  assert.equal(saved[0].thisValue, api);
  assert.deepEqual(saved.map((entry) => entry.args), [['inherited-snapshot']]);
  assert.equal(listeners.get('drawing_event').size, 0);
});

test('user preserves a foreign chart owner when a drawing action replaces the save method', async () => {
  // Given a native chart action that hands saving to another operation.
  const { api, listeners, saved } = createTradingViewApi();
  const foreignSaves = [];
  const foreignSave = (...args) => foreignSaves.push(args);

  // When the action changes save ownership before coalescer cleanup.
  const completion = coalesceTradingViewDrawingSaves(api, () => { api.saveChart = foreignSave; }, { eventDiscoveryTimeoutMs: 0 });

  // Then cleanup reports the ownership change without overwriting the new owner.
  await assert.rejects(completion, /图表保存接口在操作期间发生变化/);
  assert.equal(api.saveChart, foreignSave);
  assert.equal(listeners.get('drawing_event').size, 0);
  assert.deepEqual(saved, []);
  assert.deepEqual(foreignSaves, []);
});

test('user stops waiting at the chart-save deadline even if every drawing has requested a save', async () => {
  // Given one matching drawing/save pair whose quiet window exceeds the response deadline.
  const { api, saved, listeners } = createTradingViewApi();
  const originalSaveChart = api.saveChart;
  const timers = createManualTimers();

  // When the 10 ms deadline expires before the 20 ms quiet window.
  const completion = coalesceTradingViewDrawingSaves(api, () => {
    api.emit('drawing_event', 'order-1', 'remove');
    api.saveChart('still-changing');
  }, { settleQuietMs: 20, timeoutMs: 10, ...timers });
  await Promise.resolve();
  timers.advance(10);

  // Then a settle timeout is reported distinctly from a missing-save count and no stale save is replayed.
  await assert.rejects(completion, /图表保存未在 10 毫秒内完成/);
  assert.deepEqual(saved, []);
  assert.equal(api.saveChart, originalSaveChart);
  assert.equal(listeners.get('drawing_event').size, 0);
  assert.equal(timers.timers.size, 0);
});

test('user can stop an unmatched capture and cannot reuse its closed round lifecycle', async () => {
  // Given an active close round waiting to discover an order line.
  const { api, saved, listeners } = createTradingViewApi();
  const timers = createManualTimers();
  const controller = createTradingViewContinuousSaveController(api, timers);
  const round = controller.beginRound();
  const capture = controller.beginSubmitCapture(round);

  // When conflicting round and capture operations are attempted during that active capture.
  const duplicateRound = () => controller.beginRound();
  const duplicateCapture = () => controller.beginSubmitCapture(round);
  const wrongCaptureRound = () => controller.beginSubmitCapture({});
  const wrongEndRound = () => controller.endRound({});
  const earlyEnd = () => controller.endRound(round);
  const unknownCapture = controller.completeSubmitCapture({});

  // Then overlapping or mismatched lifecycle operations fail without altering the live capture.
  assert.throws(duplicateRound, /已有图表保存轮次正在执行/);
  assert.throws(duplicateCapture, /已有订单线保存捕获正在执行/);
  assert.throws(wrongCaptureRound, /图表保存轮次不匹配/);
  assert.throws(wrongEndRound, /结束的图表保存轮次不匹配/);
  assert.throws(earlyEnd, /结束图表保存轮次时仍有订单线捕获/);
  await assert.rejects(unknownCapture, /订单线保存捕获不匹配/);

  // When the user stops the controller before any order-line event arrives.
  const stats = controller.stop();
  const result = await controller.completeSubmitCapture(capture);

  // Then capture discovery ends immediately, resources are released, and the stopped lifecycle rejects reuse.
  assert.deepEqual(result, { matched: false, status: 'stopped' });
  assert.deepEqual(stats, expectedContinuousStats());
  assert.equal(timers.timers.size, 0);
  assert.equal(listeners.get('drawing_event').size, 0);
  assert.deepEqual(saved, []);
  assert.throws(() => controller.beginRound(), /连续图表保存控制器已停止/);
  assert.throws(() => controller.beginSubmitCapture(round), /连续图表保存控制器已停止/);
  assert.throws(() => controller.stop(), /连续图表保存控制器已停止/);
});

test('user can stop a matched capture before its delayed native save arrives', async () => {
  // Given an armed capture and a matching order line with no save request yet.
  const { api, saved, setDrawingToolName, listeners } = createTradingViewApi();
  const originalSaveChart = api.saveChart;
  const timers = createManualTimers();
  const controller = createTradingViewContinuousSaveController(api, timers);
  const round = controller.beginRound();
  const capture = controller.beginSubmitCapture(round);
  setDrawingToolName('order-1', 'LineToolOrder');

  // When the order-line event arrives and the user stops before the save callback.
  api.emit('drawing_event', 'order-1', 'properties_changed');
  const stats = controller.stop();
  const result = await controller.completeSubmitCapture(capture);

  // Then the matched capture closes without inventing a save or leaving a wrapper and timer behind.
  assert.deepEqual(result, { matched: true, status: 'captured' });
  assert.deepEqual(stats, expectedContinuousStats({ orderEventCount: 1 }));
  assert.equal(api.saveChart, originalSaveChart);
  assert.equal(listeners.get('drawing_event').size, 0);
  assert.equal(timers.timers.size, 0);
  assert.deepEqual(saved, []);

  // When the delayed native save finally arrives after stopping.
  api.saveChart('late-order-snapshot');

  // Then the original synchronous method persists it normally.
  assert.deepEqual(saved.map((entry) => entry.args), [['late-order-snapshot']]);
});

test('user leaves unrelated saves synchronous when an order drawing disappears before inspection', async () => {
  // Given an armed capture whose chart no longer has the referenced drawing.
  const { api, saved } = createTradingViewApi();
  const timers = createManualTimers();
  const controller = createTradingViewContinuousSaveController(api, { submitEventDiscoveryMs: 10, ...timers });
  const round = controller.beginRound();
  const capture = controller.beginSubmitCapture(round);

  // When the stale drawing event cannot be inspected and discovery reaches its deadline.
  api.emit('drawing_event', 'already-removed-order', 'properties_changed');
  api.saveChart('unrelated-current-snapshot');
  timers.advance(10);
  const result = await controller.completeSubmitCapture(capture);

  // Then no order line is claimed and the unrelated current snapshot is saved normally.
  assert.deepEqual(result, { matched: false, status: 'no-order-event' });
  assert.deepEqual(saved.map((entry) => entry.args), [['unrelated-current-snapshot']]);
  controller.endRound(round);
  assert.deepEqual(controller.stop(), expectedContinuousStats());
  assert.equal(timers.timers.size, 0);
});

test('user receives a deferred round-save failure after stop still releases all chart resources', async () => {
  // Given a settled order capture whose original chart save fails on final persistence.
  const { api, listeners, setDrawingToolName } = createTradingViewApi();
  const failure = new Error('Deferred round save failed');
  const originalSaveChart = () => { throw failure; };
  api.saveChart = originalSaveChart;
  const timers = createManualTimers();
  const controller = createTradingViewContinuousSaveController(api, { settleQuietMs: 20, ...timers });
  const round = controller.beginRound();
  const capture = controller.beginSubmitCapture(round);
  setDrawingToolName('order-1', 'LineToolOrder');
  api.emit('drawing_event', 'order-1', 'properties_changed');
  api.saveChart('pending-round');
  timers.advance(20);
  const captured = await controller.completeSubmitCapture(capture);

  // When the user stops and the deferred final snapshot fails to persist.
  const stop = () => controller.stop();

  // Then the persistence error survives while capture, event, method, and timer resources are closed.
  assert.deepEqual(captured, { matched: true, status: 'captured' });
  assert.throws(stop, (error) => error === failure);
  assert.equal(api.saveChart, originalSaveChart);
  assert.equal(listeners.get('drawing_event').size, 0);
  assert.equal(timers.timers.size, 0);
  assert.throws(() => controller.beginRound(), /连续图表保存控制器已停止/);
});

test('user finishes an empty removal lifecycle at its discovery deadline', async () => {
  // Given an empty chart and a manual 10 ms removal discovery window.
  const { api, saved, listeners } = createTradingViewApi();
  const originalSaveChart = api.saveChart;
  const timers = createManualTimers();
  const controller = createTradingViewRemovalSaveController(api, { eventDiscoveryMs: 10, ...timers });
  let finished = false;

  // When finish waits through the first nine milliseconds without a removal.
  const completion = controller.finish().then((result) => { finished = true; return result; });
  timers.advance(9);

  // Then discovery remains pending and no snapshot is invented.
  assert.equal(finished, false);
  assert.deepEqual(saved, []);

  // When the final discovery millisecond elapses.
  timers.advance(1);
  const result = await completion;

  // Then the empty lifecycle releases ownership and refuses a second finish.
  assert.deepEqual(result, { fullSaveCount: 0, removeEventCount: 0, saveRequestCount: 0, synchronousSaveCount: 0 });
  assert.equal(finished, true);
  assert.equal(api.saveChart, originalSaveChart);
  assert.equal(listeners.get('drawing_event').size, 0);
  assert.equal(timers.timers.size, 0);
  await assert.rejects(controller.finish(), /删除事件保存合并已结束/);
});

test('user preserves a foreign save owner installed before the first removal event', async () => {
  // Given a removal lifecycle whose monitored save method is replaced by another chart operation.
  const { api, saved, listeners } = createTradingViewApi();
  const timers = createManualTimers();
  const controller = createTradingViewRemovalSaveController(api, { eventDiscoveryMs: 0, ...timers });
  const foreignSaves = [];
  const foreignSave = (...args) => foreignSaves.push(args);
  api.saveChart = foreignSave;

  // When the first removal arrives under foreign ownership and the lifecycle finishes.
  api.emit('drawing_event', 'order-1', 'remove');
  api.saveChart('foreign-snapshot');
  const completion = controller.finish();

  // Then ownership conflict prevents stale replay and leaves the foreign save method intact.
  await assert.rejects(completion, /图表保存接口正被其他操作占用/);
  assert.equal(api.saveChart, foreignSave);
  assert.deepEqual(saved, []);
  assert.deepEqual(foreignSaves, [['foreign-snapshot']]);
  assert.equal(listeners.get('drawing_event').size, 0);
  assert.equal(timers.timers.size, 0);
});

test('user restores removal monitoring if a host makes the save method read-only between bursts', async () => {
  // Given an installed removal monitor whose host changes the save property to read-only.
  const { api, saved, listeners } = createTradingViewApi();
  const originalSaveChart = api.saveChart;
  const timers = createManualTimers();
  const controller = createTradingViewRemovalSaveController(api, { eventDiscoveryMs: 0, ...timers });
  Object.defineProperty(api, 'saveChart', { writable: false });

  // When a removal cannot install its temporary burst wrapper.
  api.emit('drawing_event', 'order-1', 'remove');
  const completion = controller.finish();

  // Then the assignment error is reported after the original property and listener are restored.
  await assert.rejects(completion, TypeError);
  assert.equal(api.saveChart, originalSaveChart);
  assert.equal(Object.getOwnPropertyDescriptor(api, 'saveChart').writable, true);
  assert.equal(listeners.get('drawing_event').size, 0);
  assert.equal(timers.timers.size, 0);
  assert.deepEqual(saved, []);
});
