import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTINUOUS_LADDER_COOLDOWN_MS,
  CONTINUOUS_LADDER_READY_CHECK_MS,
  createContinuousLadderProgress,
  formatContinuousLadderProgress,
  formatContinuousLadderWaitReason,
  recordContinuousLadderRound,
  waitForContinuousLadderNextRound,
} from '../../../src/binance-orderbook-trade/core/continuous-ladder.js';

function roundProgress({
  submittedOrders,
  cancelledOrders = 0,
  plannedOrders,
  currentPlanSubmittedOrders,
}) {
  return {
    submittedOrders,
    cancelledOrders,
    plannedOrders,
    currentPlanSubmittedOrders,
  };
}

test('continuous ladder status summarizes completed rounds and cumulative submissions', () => {
  const progress = createContinuousLadderProgress();
  const completedRound = roundProgress({
    submittedOrders: 3,
    plannedOrders: 3,
    currentPlanSubmittedOrders: 3,
  });

  recordContinuousLadderRound(progress, { status: 'completed', progress: completedRound });
  recordContinuousLadderRound(progress, { status: 'completed', progress: completedRound });

  assert.deepEqual(progress, {
    startedRounds: 2,
    completedRounds: 2,
    submittedOrders: 6,
    cancelledOrders: 0,
    lastRound: {
      status: 'completed',
      submittedOrders: 3,
      cancelledOrders: 0,
      plannedOrders: 3,
      currentPlanSubmittedOrders: 3,
    },
  });
  assert.equal(
    formatContinuousLadderProgress('阶梯平空', 'running', progress),
    '阶梯平空连续中 · 2/2 轮 · 本轮 3/3 笔 · 累计 6 笔',
  );
});

test('continuous ladder stopped status separates completed rounds from a partial round', () => {
  const progress = createContinuousLadderProgress();
  const completedRound = roundProgress({
    submittedOrders: 3,
    plannedOrders: 3,
    currentPlanSubmittedOrders: 3,
  });
  recordContinuousLadderRound(progress, { status: 'completed', progress: completedRound });
  recordContinuousLadderRound(progress, { status: 'completed', progress: completedRound });
  recordContinuousLadderRound(progress, {
    status: 'stopped',
    progress: roundProgress({
      submittedOrders: 1,
      plannedOrders: 3,
      currentPlanSubmittedOrders: 1,
    }),
  });

  assert.equal(
    formatContinuousLadderProgress('阶梯平空', 'stopped', progress),
    '阶梯平空连续已停止 · 2/3 轮 · 本轮 1/3 笔 · 累计 7 笔',
  );
});

test('continuous ladder status shows cancellations only when they occurred', () => {
  const progress = createContinuousLadderProgress();
  recordContinuousLadderRound(progress, {
    status: 'failed',
    progress: roundProgress({
      submittedOrders: 2,
      cancelledOrders: 1,
      plannedOrders: 3,
      currentPlanSubmittedOrders: 2,
    }),
  });

  assert.equal(
    formatContinuousLadderProgress('阶梯平多', 'failed', progress, '下单按钮 3 秒内未恢复可点击'),
    '阶梯平多连续失败 · 0/1 轮 · 本轮 2/3 笔 · 累计 2 笔 · 撤 1 笔 · 下单按钮 3 秒内未恢复可点击',
  );
});

test('continuous ladder progress rejects an invalid or duplicate round outcome', () => {
  const progress = createContinuousLadderProgress();
  const outcome = {
    status: 'completed',
    progress: roundProgress({
      submittedOrders: 1,
      plannedOrders: 1,
      currentPlanSubmittedOrders: 1,
    }),
  };
  recordContinuousLadderRound(progress, outcome);

  assert.throws(
    () => recordContinuousLadderRound(progress, outcome),
    /Continuous ladder round was already recorded/,
  );
  assert.throws(
    () => formatContinuousLadderProgress('阶梯平空', 'unknown', progress),
    /Invalid continuous ladder phase/,
  );
});

test('continuous ladder starts its cooldown only after the previous round is ready', async () => {
  const states = [
    { status: 'waiting' },
    { status: 'waiting' },
    { status: 'ready' },
    { status: 'ready' },
  ];
  const delays = [];
  const waitStates = [];

  const result = await waitForContinuousLadderNextRound({
    readReadiness: () => states.shift(),
    delay: async (ms) => delays.push(ms),
    onWaitStateChange: (state) => waitStates.push(state),
  });

  assert.deepEqual(result, { status: 'ready' });
  assert.deepEqual(delays, [
    CONTINUOUS_LADDER_READY_CHECK_MS,
    CONTINUOUS_LADDER_READY_CHECK_MS,
    CONTINUOUS_LADDER_COOLDOWN_MS,
  ]);
  assert.deepEqual(waitStates, [
    { phase: 'waiting_ready', cooldownMs: CONTINUOUS_LADDER_COOLDOWN_MS },
    { phase: 'cooldown', cooldownMs: CONTINUOUS_LADDER_COOLDOWN_MS },
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
  const waitStates = [];

  const result = await waitForContinuousLadderNextRound({
    readReadiness: () => states.shift(),
    delay: async (ms) => delays.push(ms),
    onWaitStateChange: (state) => waitStates.push(state),
  });

  assert.deepEqual(result, { status: 'ready' });
  assert.deepEqual(delays, [
    CONTINUOUS_LADDER_COOLDOWN_MS,
    CONTINUOUS_LADDER_READY_CHECK_MS,
    CONTINUOUS_LADDER_COOLDOWN_MS,
  ]);
  assert.deepEqual(waitStates, [
    { phase: 'cooldown', cooldownMs: CONTINUOUS_LADDER_COOLDOWN_MS },
    { phase: 'waiting_ready', cooldownMs: CONTINUOUS_LADDER_COOLDOWN_MS },
    { phase: 'cooldown', cooldownMs: CONTINUOUS_LADDER_COOLDOWN_MS },
  ]);
});

test('continuous ladder wait reasons distinguish readiness from the actual cooldown', () => {
  assert.equal(
    formatContinuousLadderWaitReason('waiting_ready', CONTINUOUS_LADDER_COOLDOWN_MS),
    '等待按钮恢复',
  );
  assert.equal(
    formatContinuousLadderWaitReason('cooldown', CONTINUOUS_LADDER_COOLDOWN_MS),
    '等待 1s 后继续下一轮',
  );
  assert.throws(
    () => formatContinuousLadderWaitReason('unknown', CONTINUOUS_LADDER_COOLDOWN_MS),
    /Invalid continuous ladder wait phase/,
  );
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
