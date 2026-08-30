import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTINUOUS_LADDER_COOLDOWN_MS,
  CONTINUOUS_LADDER_READY_CHECK_MS,
  waitForContinuousLadderNextRound,
} from '../../../src/binance-orderbook-trade/core/continuous-ladder.js';

test('continuous ladder starts its cooldown only after the previous round is ready', async () => {
  const states = [
    { status: 'waiting' },
    { status: 'waiting' },
    { status: 'ready' },
    { status: 'ready' },
  ];
  const delays = [];

  const result = await waitForContinuousLadderNextRound({
    readReadiness: () => states.shift(),
    delay: async (ms) => delays.push(ms),
  });

  assert.deepEqual(result, { status: 'ready' });
  assert.deepEqual(delays, [
    CONTINUOUS_LADDER_READY_CHECK_MS,
    CONTINUOUS_LADDER_READY_CHECK_MS,
    CONTINUOUS_LADDER_COOLDOWN_MS,
  ]);
});

test('continuous ladder restarts a full cooldown if readiness is lost', async () => {
  const states = [
    { status: 'ready' },
    { status: 'waiting' },
    { status: 'waiting' },
    { status: 'ready' },
    { status: 'ready' },
  ];
  const delays = [];

  const result = await waitForContinuousLadderNextRound({
    readReadiness: () => states.shift(),
    delay: async (ms) => delays.push(ms),
  });

  assert.deepEqual(result, { status: 'ready' });
  assert.deepEqual(delays, [
    CONTINUOUS_LADDER_COOLDOWN_MS,
    CONTINUOUS_LADDER_READY_CHECK_MS,
    CONTINUOUS_LADDER_COOLDOWN_MS,
  ]);
});

test('continuous ladder returns a terminal readiness state without another cooldown', async () => {
  const delays = [];
  const stopped = { status: 'stopped', reason: 'position_flat' };

  const result = await waitForContinuousLadderNextRound({
    readReadiness: () => stopped,
    delay: async (ms) => delays.push(ms),
  });

  assert.equal(result, stopped);
  assert.deepEqual(delays, []);
});

test('continuous ladder cooldown is abortable', async () => {
  const abortController = new AbortController();
  const stoppedError = new Error('stopped');
  stoppedError.name = 'LadderStoppedError';
  const task = waitForContinuousLadderNextRound({
    readReadiness: () => ({ status: 'ready' }),
    delay: () => new Promise(() => {}),
    signal: abortController.signal,
  });
  abortController.abort(stoppedError);

  await assert.rejects(
    task,
    (error) => error === stoppedError,
  );
});

test('continuous ladder rejects an invalid readiness contract', async () => {
  await assert.rejects(
    waitForContinuousLadderNextRound({
      readReadiness: () => ({ status: 'unknown' }),
      delay: async () => {},
    }),
    /Invalid continuous ladder readiness state/,
  );
});
