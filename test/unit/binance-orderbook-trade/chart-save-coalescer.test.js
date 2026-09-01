import test from 'node:test';
import assert from 'node:assert/strict';

import {
  coalesceTradingViewDrawingSaves,
  createTradingViewRemoveSaveBurstController,
} from '../../../src/binance-orderbook-trade/core/chart-save-coalescer.js';

function createTradingViewApi() {
  const listeners = new Map();
  const saved = [];
  const api = {
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
  return { api, saved, listeners };
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

test('continuous remove-save controller leaves unrelated chart saves synchronous', () => {
  const { api, saved } = createTradingViewApi();
  const originalSaveChart = api.saveChart;
  const timers = createManualTimers();
  const coalescer = createTradingViewRemoveSaveBurstController(api, {
    settleQuietMs: 20,
    maxWaitMs: 100,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  api.saveChart('unrelated');
  assert.deepEqual(saved.map((entry) => entry.args), [['unrelated']]);

  assert.deepEqual(coalescer.stop(), {
    fullSaveCount: 0,
    removeEventCount: 0,
    saveRequestCount: 0,
  });
  assert.equal(api.saveChart, originalSaveChart);
});

test('continuous remove-save controller persists only the final save in one remove burst', () => {
  const { api, saved } = createTradingViewApi();
  const timers = createManualTimers();
  const coalescer = createTradingViewRemoveSaveBurstController(api, {
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

  assert.deepEqual(coalescer.stop(), {
    fullSaveCount: 1,
    removeEventCount: 3,
    saveRequestCount: 3,
  });
});

test('continuous remove-save controller flushes at its maximum wait during sustained removals', () => {
  const { api, saved } = createTradingViewApi();
  const timers = createManualTimers();
  const coalescer = createTradingViewRemoveSaveBurstController(api, {
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
  const coalescer = createTradingViewRemoveSaveBurstController(api, {
    settleQuietMs: 20,
    maxWaitMs: 100,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  api.emit('drawing_event', 'order-1', 'remove');
  api.saveChart('pending-final');
  assert.deepEqual(coalescer.stop(), {
    fullSaveCount: 1,
    removeEventCount: 1,
    saveRequestCount: 1,
  });
  assert.deepEqual(saved.map((entry) => entry.args), [['pending-final']]);
  assert.equal(api.saveChart, originalSaveChart);
  assert.equal(timers.timers.size, 0);

  api.saveChart('after-stop');
  assert.deepEqual(saved.map((entry) => entry.args), [['pending-final'], ['after-stop']]);
});

test('continuous remove-save controller ignores non-remove drawing events', () => {
  const { api, saved } = createTradingViewApi();
  const coalescer = createTradingViewRemoveSaveBurstController(api);

  api.emit('drawing_event', 'order-1', 'properties_changed');
  api.saveChart('properties');

  assert.deepEqual(saved.map((entry) => entry.args), [['properties']]);
  assert.deepEqual(coalescer.stop(), {
    fullSaveCount: 0,
    removeEventCount: 0,
    saveRequestCount: 0,
  });
});

test('continuous remove-save controller does not replace another active save wrapper', () => {
  const { api, saved } = createTradingViewApi();
  const controller = createTradingViewRemoveSaveBurstController(api);
  const sessionSaveChart = api.saveChart;
  const foreignSaves = [];
  api.saveChart = (...args) => foreignSaves.push(args);

  api.emit('drawing_event', 'order-1', 'remove');
  api.saveChart('foreign');
  assert.deepEqual(foreignSaves, [['foreign']]);
  assert.deepEqual(saved, []);

  api.saveChart = sessionSaveChart;
  assert.deepEqual(controller.stop(), {
    fullSaveCount: 0,
    removeEventCount: 1,
    saveRequestCount: 0,
  });
});

test('continuous remove-save controller restores the chart method when the final save throws', () => {
  const { api, listeners } = createTradingViewApi();
  const originalSaveChart = function saveChart() {
    throw new Error('final save failed');
  };
  api.saveChart = originalSaveChart;
  const controller = createTradingViewRemoveSaveBurstController(api);

  api.emit('drawing_event', 'order-1', 'remove');
  api.saveChart('pending');

  assert.throws(() => controller.stop(), /final save failed/);
  assert.equal(api.saveChart, originalSaveChart);
  assert.equal(listeners.get('drawing_event')?.size, 0);
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
