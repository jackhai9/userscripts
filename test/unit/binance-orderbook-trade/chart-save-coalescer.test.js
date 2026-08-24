import test from 'node:test';
import assert from 'node:assert/strict';

import { coalesceTradingViewDrawingSaves } from '../../../src/binance-orderbook-trade/core/chart-save-coalescer.js';

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

for (const drawingCount of [1, 5, 20, 21, 37, 40, 100, 120, 199, 200]) {
  test(`coalesces ${drawingCount} dynamic drawing saves into the final full save`, async () => {
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
      { timeoutMs: 100 },
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

test('persists the cumulative final snapshot without dropping earlier drawing state', async () => {
  const { api, saved } = createTradingViewApi();
  const cumulativeSnapshots = [
    { drawings: ['order-1'] },
    { drawings: ['order-1', 'order-2'] },
    { drawings: ['order-1', 'order-2', 'order-3'] },
  ];

  await coalesceTradingViewDrawingSaves(api, () => {
    for (const drawingId of cumulativeSnapshots.at(-1).drawings) {
      api.emit('drawing_event', drawingId, 'properties_changed');
    }
    setTimeout(() => {
      for (const snapshot of cumulativeSnapshots) api.saveChart(snapshot);
    }, 0);
  }, { timeoutMs: 100 });

  assert.deepEqual(saved.map((entry) => entry.args[0]), [cumulativeSnapshots.at(-1)]);
});

test('waits for drawing events that arrive after the visible checkbox state changes', async () => {
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
    { eventDiscoveryTimeoutMs: 50, timeoutMs: 100 },
  );

  assert.deepEqual(result, {
    actionResult: 'checkbox-changed',
    drawingEventCount: 2,
    saveRequestCount: 2,
    fullSaveCount: 1,
  });
  assert.deepEqual(saved.map((entry) => entry.args), [['snapshot-2']]);
});

test('ignores click and move drawing events because Binance does not save them', async () => {
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

test('allows a zero-drawing transition without inventing a chart save', async () => {
  const { api, saved } = createTradingViewApi();

  const result = await coalesceTradingViewDrawingSaves(
    api,
    () => 'no-orders',
    { eventDiscoveryTimeoutMs: 5 },
  );

  assert.deepEqual(result, {
    actionResult: 'no-orders',
    drawingEventCount: 0,
    saveRequestCount: 0,
    fullSaveCount: 0,
  });
  assert.deepEqual(saved, []);
});

test('skips drawing discovery when the caller proves no drawings can exist', async () => {
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

test('restores the original save method when the chart action fails', async () => {
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

test('times out when drawing events do not produce their matching save requests', async () => {
  const { api, saved } = createTradingViewApi();
  const originalSaveChart = api.saveChart;

  await assert.rejects(
    coalesceTradingViewDrawingSaves(
      api,
      () => api.emit('drawing_event', 'order-1', 'remove'),
      { timeoutMs: 10 },
    ),
    /Expected 1 TradingView saveChart requests, received 0/,
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
    }, { timeoutMs: 100 }),
    /save failed/,
  );

  assert.equal(api.saveChart, originalSaveChart);
});
