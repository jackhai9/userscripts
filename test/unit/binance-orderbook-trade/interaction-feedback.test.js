import test from 'node:test';
import assert from 'node:assert/strict';

import {
  keepInteractionFeedbackVisible,
  remainingInteractionFeedbackMs,
} from '../../../src/binance-orderbook-trade/core/interaction-feedback.js';

test('calculates only the remaining interaction feedback duration', () => {
  assert.equal(remainingInteractionFeedbackMs({
    startedAtMs: 100,
    nowMs: 124,
    minimumMs: 240,
  }), 216);
  assert.equal(remainingInteractionFeedbackMs({
    startedAtMs: 100,
    nowMs: 400,
    minimumMs: 240,
  }), 0);
});

test('keeps an immediate failure pending until its feedback window is visible', async () => {
  const expectedError = new Error('insufficient funds');
  let releaseDelay;
  let requestedDelayMs = null;
  let settled = false;
  const task = keepInteractionFeedbackVisible(Promise.reject(expectedError), {
    startedAtMs: 100,
    minimumMs: 240,
    now: () => 124,
    delay: (ms) => {
      requestedDelayMs = ms;
      return new Promise((resolve) => { releaseDelay = resolve; });
    },
  });
  const observed = task.then(
    () => { settled = true; },
    (error) => {
      settled = true;
      throw error;
    },
  );

  await Promise.resolve();
  await Promise.resolve();

  assert.equal(requestedDelayMs, 216);
  assert.equal(settled, false);

  releaseDelay();
  await assert.rejects(observed, expectedError);
  assert.equal(settled, true);
});

test('does not delay a task that already exceeded the feedback window', async () => {
  let delayCalls = 0;
  const value = await keepInteractionFeedbackVisible(Promise.resolve('done'), {
    startedAtMs: 100,
    minimumMs: 240,
    now: () => 400,
    delay: async () => { delayCalls += 1; },
  });

  assert.equal(value, 'done');
  assert.equal(delayCalls, 0);
});
