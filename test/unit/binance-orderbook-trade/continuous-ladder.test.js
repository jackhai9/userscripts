import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatLocalizedText,
  localizedText,
  UI_LOCALE_EN,
  UI_LOCALE_ZH_CN,
} from '../../../src/binance-orderbook-trade/contracts/panel-copy.js';

import {
  CONTINUOUS_LADDER_COOLDOWN_MS,
  CONTINUOUS_LADDER_LONG_RECOVERY_COOLDOWN_MS,
  CONTINUOUS_LADDER_READY_CHECK_MS,
  CONTINUOUS_LADDER_RECOVERY_COOLDOWN_MS,
  createContinuousLadderProgress,
  formatActiveContinuousLadderProgress,
  formatContinuousLadderProgress,
  formatContinuousLadderPositionClosedProgress,
  formatContinuousLadderWaitProgress,
  formatContinuousLadderWaitReason,
  recordContinuousLadderRound,
  resolveContinuousLadderRecovery,
  waitForContinuousLadderNextRound,
} from '../../../src/binance-orderbook-trade/core/continuous-ladder.js';

const zh = (value) => formatLocalizedText(value, UI_LOCALE_ZH_CN);
const en = (value) => formatLocalizedText(value, UI_LOCALE_EN);

test('user sees zero-round progress when continuous close stops before the first round', () => {
  // Given a continuous session that has not received any round outcome.
  const progress = createContinuousLadderProgress();
  const label = localizedText('阶梯平空', 'Close Short');

  // When the user stops the session before its first round can start.
  const message = formatContinuousLadderProgress(label, 'stopped', progress);

  // Then both locales report zero work without trying to display a nonexistent plan.
  assert.equal(zh(message), '连续阶梯平空 · 已停止 · 0 轮 · 累计 0 笔');
  assert.equal(en(message), 'Continuous Close Short · Stopped · 0 rounds · Total 0');
});

test('user sees a readiness wait before continuous close has any recorded round', () => {
  // Given a session whose first attempt could not start on the trading page.
  const progress = createContinuousLadderProgress();
  const label = localizedText('阶梯平空', 'Close Short');

  // When the continuous session reports that it is waiting for the button.
  const message = formatContinuousLadderWaitProgress(label, progress, 'waiting_ready', 1000);

  // Then the wait preserves the action identity and accurate zero-round totals.
  assert.equal(zh(message), '连续阶梯平空 · 等待按钮恢复 · 0 轮 · 累计 0 笔');
  assert.equal(en(message), 'Continuous Close Short · Waiting for button · 0 rounds · Total 0');
});

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

test('user sees completed close rounds and cumulative confirmed submissions', () => {
  // Given two completed rounds with three confirmed orders in each.
  const progress = createContinuousLadderProgress();
  const completedRound = roundProgress({
    submittedOrders: 3,
    plannedOrders: 3,
    currentPlanSubmittedOrders: 3,
  });

  // When both round outcomes are recorded.
  recordContinuousLadderRound(progress, { status: 'completed', progress: completedRound });
  recordContinuousLadderRound(progress, { status: 'completed', progress: completedRound });

  // Then the detached progress and displayed counters show two rounds and six submissions.
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
    zh(formatContinuousLadderProgress('阶梯平空', 'running', progress)),
    '连续阶梯平空 · 2/2 轮 · 本轮 3/3 笔 · 累计 6 笔',
  );
});

test('user sees a stopped partial round separately from completed rounds', () => {
  // Given two completed close rounds and a third round stopped after one order.
  const progress = createContinuousLadderProgress();
  const completedRound = roundProgress({
    submittedOrders: 3,
    plannedOrders: 3,
    currentPlanSubmittedOrders: 3,
  });
  // When the completed and stopped outcomes are recorded.
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

  // Then the status keeps two completed rounds, three started rounds, and seven submissions.
  assert.equal(
    zh(formatContinuousLadderProgress('阶梯平空', 'stopped', progress)),
    '连续阶梯平空 · 已停止 · 2/3 轮 · 本轮 1/3 笔 · 累计 7 笔',
  );
});

test('user sees confirmed cancellations alongside a failed continuous close round', () => {
  // Given a failed round with two submissions and one confirmed cancellation.
  const progress = createContinuousLadderProgress();
  // When the failed round is recorded.
  recordContinuousLadderRound(progress, {
    status: 'failed',
    progress: roundProgress({
      submittedOrders: 2,
      cancelledOrders: 1,
      plannedOrders: 3,
      currentPlanSubmittedOrders: 2,
    }),
  });

  // Then the status preserves cancellation count and the concrete failure reason.
  assert.equal(
    zh(formatContinuousLadderProgress('阶梯平多', 'failed', progress, '下单按钮 3 秒内未恢复可点击')),
    '连续阶梯平多 · 失败 · 0/1 轮 · 本轮 2/3 笔 · 累计 2 笔 · 撤 1 笔 · 下单按钮 3 秒内未恢复可点击',
  );
});

test('user sees the active close round combined with earlier confirmed work', () => {
  // Given two completed three-order rounds and a live partial round.
  const progress = createContinuousLadderProgress();
  const completedRound = roundProgress({
    submittedOrders: 3,
    plannedOrders: 3,
    currentPlanSubmittedOrders: 3,
  });
  // When the completed rounds are recorded before the live progress is displayed.
  recordContinuousLadderRound(progress, { status: 'completed', progress: completedRound });
  recordContinuousLadderRound(progress, { status: 'completed', progress: completedRound });

  // Then the continuous action identity includes live order and cancellation totals.
  assert.equal(
    zh(formatActiveContinuousLadderProgress(
      '阶梯平空',
      '第 2 笔确认中',
      progress,
      roundProgress({
        submittedOrders: 1,
        cancelledOrders: 1,
        plannedOrders: 3,
        currentPlanSubmittedOrders: 1,
      }),
    )),
    '连续阶梯平空 · 第 2 笔确认中 · 2/3 轮 · 本轮 1/3 笔 · 累计 7 笔 · 撤 1 笔',
  );
});

test('user cannot count the same completed round twice or render an unknown phase', () => {
  // Given one completed close-round outcome and an empty session aggregate.
  const progress = createContinuousLadderProgress();
  const outcome = {
    status: 'completed',
    progress: roundProgress({
      submittedOrders: 1,
      plannedOrders: 1,
      currentPlanSubmittedOrders: 1,
    }),
  };
  // When the round is recorded once.
  recordContinuousLadderRound(progress, outcome);

  // Then a duplicate outcome and an unknown display phase are explicitly rejected.
  assert.throws(
    () => recordContinuousLadderRound(progress, outcome),
    /连续阶梯本轮结果已记录/,
  );
  assert.throws(
    () => formatContinuousLadderProgress('阶梯平空', 'unknown', progress),
    /连续阶梯阶段无效/,
  );
});

test('user retries only failures covered by the continuous-close recovery policy', () => {
  // Given explicit recovery kinds with the submission evidence and error text captured by the round.
  const cases = [
    { kind: 'input_unstable', message: '价格框或数量框未稳定', safeNoSubmit: true, expectedMs: CONTINUOUS_LADDER_RECOVERY_COOLDOWN_MS },
    { kind: 'market_data_not_ready', message: '盘口数据未就绪', safeNoSubmit: true, expectedMs: CONTINUOUS_LADDER_RECOVERY_COOLDOWN_MS },
    { kind: 'controls_not_ready', message: 'Controls unavailable', safeNoSubmit: true, expectedMs: CONTINUOUS_LADDER_RECOVERY_COOLDOWN_MS },
    { kind: 'position_state_not_ready', message: 'Position unavailable', safeNoSubmit: true, expectedMs: CONTINUOUS_LADDER_RECOVERY_COOLDOWN_MS },
    { kind: 'submit_unconfirmed', message: '仍未确认订单结果', safeNoSubmit: false, expectedMs: CONTINUOUS_LADDER_RECOVERY_COOLDOWN_MS },
    { kind: 'open_orders_not_ready', message: '当前委托列表暂未就绪', expectedMs: CONTINUOUS_LADDER_RECOVERY_COOLDOWN_MS },
    { kind: 'order_capacity_not_ready', message: 'Order capacity unavailable', expectedMs: CONTINUOUS_LADDER_RECOVERY_COOLDOWN_MS },
    { kind: 'position_quantity_not_ready', message: '当前方向暂无可平数量', safeNoSubmit: true, expectedMs: CONTINUOUS_LADDER_LONG_RECOVERY_COOLDOWN_MS },
    { kind: 'rate_limited', message: '请求频率受限', cooldownMs: 17000, expectedMs: 17000 },
  ];
  const errors = cases.map((entry) => Object.assign(new Error(entry.message), {
    continuousRecoveryKind: entry.kind,
    safeNoSubmit: entry.safeNoSubmit,
    continuousRecoveryCooldownMs: entry.cooldownMs,
  }));
  const precisionChanged = Object.assign(new Error('价格精度已变化'), { safeNoSubmit: true, continuousRecoveryKind: 'precision_changed' });
  const optionsChanged = Object.assign(new Error('阶梯设置已变化'), { safeNoSubmit: true, continuousRecoveryKind: 'options_changed' });
  const unsupported = Object.assign(new Error('未知错误'), { safeNoSubmit: true, continuousRecoveryKind: 'unknown' });

  // When the next-round recovery policies are resolved.
  const recoveries = errors.map(resolveContinuousLadderRecovery);
  const precisionRecovery = resolveContinuousLadderRecovery(precisionChanged);
  const optionsRecovery = resolveContinuousLadderRecovery(optionsChanged);
  const unsupportedRecovery = resolveContinuousLadderRecovery(unsupported);

  // Then each supported kind keeps its cooldown and reason while unknown kinds are terminal.
  recoveries.forEach((recovery, index) => assert.deepEqual(recovery, { cooldownMs: cases[index].expectedMs, reason: cases[index].message }));
  assert.equal(precisionRecovery.cooldownMs, CONTINUOUS_LADDER_COOLDOWN_MS);
  assert.equal(zh(precisionRecovery.reason), '价格精度已变化，下一轮按新精度继续');
  assert.equal(en(precisionRecovery.reason), 'Precision changed; the next round will use the new precision');
  assert.equal(optionsRecovery.cooldownMs, CONTINUOUS_LADDER_COOLDOWN_MS);
  assert.equal(zh(optionsRecovery.reason), '比例、笔数或间距已变化，下一轮按新设置继续');
  assert.equal(en(optionsRecovery.reason), 'Ratio, orders, or gap changed; the next round will use the new settings');
  assert.equal(unsupportedRecovery, null);
});

test('user keeps partial-round progress when changed settings defer the next round', () => {
  // Given two confirmed orders followed by a safe settings-change failure.
  const progress = createContinuousLadderProgress();
  const optionsChanged = new Error('执行中比例、笔数或间距已变化');
  optionsChanged.safeNoSubmit = true;
  optionsChanged.continuousRecoveryKind = 'options_changed';
  const outcome = {
    status: 'failed',
    error: optionsChanged,
    progress: roundProgress({
      submittedOrders: 2,
      plannedOrders: 3,
      currentPlanSubmittedOrders: 2,
    }),
  };

  // When the partial outcome is recorded and its recovery policy is resolved.
  recordContinuousLadderRound(progress, outcome);
  const recovery = resolveContinuousLadderRecovery(optionsChanged);

  // Then the one-second wait retains the partial counts and explains the new settings.
  assert.equal(recovery.cooldownMs, CONTINUOUS_LADDER_COOLDOWN_MS);
  assert.equal(zh(recovery.reason), '比例、笔数或间距已变化，下一轮按新设置继续');
  assert.equal(
    zh(formatContinuousLadderWaitProgress(
      '阶梯平空',
      progress,
      'cooldown',
      recovery.cooldownMs,
    )),
    '连续阶梯平空 · 1s 后继续 · 0/1 轮 · 本轮 2/3 笔 · 累计 2 笔',
  );
});

test('user waits for button readiness before the full inter-round cooldown', async () => {
  // Given two unavailable button checks followed by stable readiness and an injected delay adapter.
  const states = [
    { status: 'waiting' },
    { status: 'waiting' },
    { status: 'ready' },
    { status: 'ready' },
  ];
  const delays = [];
  const waitStates = [];

  // When the next-round readiness workflow runs.
  const result = await waitForContinuousLadderNextRound({
    readReadiness: () => states.shift(),
    delay: async (ms) => delays.push(ms),
    onWaitStateChange: (state) => waitStates.push(state),
  });

  // Then readiness checks precede exactly one full cooldown and the two visible wait phases.
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

test('user restarts the full cooldown after the close button loses readiness', async () => {
  // Given a ready button that becomes unavailable during the first cooldown.
  const states = [
    { status: 'ready' },
    { status: 'waiting' },
    { status: 'waiting' },
    { status: 'ready' },
    { status: 'ready' },
  ];
  const delays = [];
  const waitStates = [];

  // When the next-round readiness workflow rechecks the button.
  const result = await waitForContinuousLadderNextRound({
    readReadiness: () => states.shift(),
    delay: async (ms) => delays.push(ms),
    onWaitStateChange: (state) => waitStates.push(state),
  });

  // Then readiness recovery starts a new full cooldown without duplicate waiting notices.
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

test('user distinguishes button readiness from the actual cooldown duration', () => {
  // Given one second and a fractional-second cooldown plus an unsupported phase.
  const waits = [['waiting_ready', CONTINUOUS_LADDER_COOLDOWN_MS], ['cooldown', CONTINUOUS_LADDER_COOLDOWN_MS], ['cooldown', 250]];

  // When the visible waiting reasons are formatted.
  const reasons = waits.map(([phase, ms]) => zh(formatContinuousLadderWaitReason(phase, ms)));
  const invalidPhase = () => formatContinuousLadderWaitReason('unknown', CONTINUOUS_LADDER_COOLDOWN_MS);

  // Then readiness has its own text, durations stay exact, and unknown phases are rejected.
  assert.deepEqual(reasons, ['等待按钮恢复', '1s 后继续', '250ms 后继续']);
  assert.throws(invalidPhase, /连续阶梯等待阶段无效/);
});

test('user sees the current wait phase before continuous-round counters', () => {
  // Given two completed three-order close rounds.
  const progress = createContinuousLadderProgress();
  // When the completed rounds are recorded.
  recordContinuousLadderRound(progress, {
    status: 'completed',
    progress: roundProgress({
      submittedOrders: 3,
      plannedOrders: 3,
      currentPlanSubmittedOrders: 3,
    }),
  });
  recordContinuousLadderRound(progress, {
    status: 'completed',
    progress: roundProgress({
      submittedOrders: 3,
      plannedOrders: 3,
      currentPlanSubmittedOrders: 3,
    }),
  });

  // Then cooldown and button-wait text occupy the phase slot ahead of the same counters.
  assert.equal(
    zh(formatContinuousLadderWaitProgress(
      '阶梯平空',
      progress,
      'cooldown',
      CONTINUOUS_LADDER_COOLDOWN_MS,
    )),
    '连续阶梯平空 · 1s 后继续 · 2/2 轮 · 本轮 3/3 笔 · 累计 6 笔',
  );
  assert.equal(
    zh(formatContinuousLadderWaitProgress(
      '阶梯平空',
      progress,
      'waiting_ready',
      CONTINUOUS_LADDER_COOLDOWN_MS,
    )),
    '连续阶梯平空 · 等待按钮恢复 · 2/2 轮 · 本轮 3/3 笔 · 累计 6 笔',
  );
});

test('user ends continuous closing immediately when readiness confirms a flat position', async () => {
  // Given a terminal position-flat readiness result.
  const delays = [];
  const stopped = { status: 'stopped', reason: 'position_flat' };

  // When the next-round workflow checks readiness.
  const result = await waitForContinuousLadderNextRound({
    readReadiness: () => stopped,
    delay: async (ms) => delays.push(ms),
  });

  // Then the exact terminal result is returned without any cooldown.
  assert.equal(result, stopped);
  assert.deepEqual(delays, []);
});

test('user can end continuous closing from an asynchronous flat-position confirmation', async () => {
  // Given an asynchronous readiness adapter that confirms the position is flat.
  const delays = [];
  // When the next-round workflow awaits that confirmation.
  const result = await waitForContinuousLadderNextRound({
    readReadiness: async () => ({ status: 'stopped', reason: 'position_flat' }),
    delay: async (ms) => delays.push(ms),
  });

  // Then the flat result ends the wait without a cooldown.
  assert.deepEqual(result, { status: 'stopped', reason: 'position_flat' });
  assert.deepEqual(delays, []);
});

test('user sees an ended close session after the position is confirmed flat', () => {
  // Given a flat-position outcome with one confirmed cancellation and no submissions.
  const progress = createContinuousLadderProgress();
  // When the outcome is recorded.
  recordContinuousLadderRound(progress, {
    status: 'position_closed',
    progress: roundProgress({
      submittedOrders: 0,
      cancelledOrders: 1,
      plannedOrders: 3,
      currentPlanSubmittedOrders: 0,
    }),
  });

  // Then the session reports ended, the flat reason, and its real cancellation total.
  assert.equal(
    zh(formatContinuousLadderPositionClosedProgress('阶梯平空', progress)),
    '连续阶梯平空 · 已结束 · 当前方向已无持仓 · 0/1 轮 · 累计 0 笔 · 撤 1 笔',
  );
});

test('user sees continuous close counters and wait text in English', () => {
  // Given an English close action and one completed three-order round.
  const progress = createContinuousLadderProgress();
  // When the completed outcome is recorded.
  recordContinuousLadderRound(progress, {
    status: 'completed',
    progress: roundProgress({
      submittedOrders: 3,
      plannedOrders: 3,
      currentPlanSubmittedOrders: 3,
    }),
  });

  // Then English phase and order counters use the same progress values.
  assert.equal(
    en(formatContinuousLadderWaitProgress(
      localizedText('阶梯平空', 'Close Short'),
      progress,
      'cooldown',
      CONTINUOUS_LADDER_COOLDOWN_MS,
    )),
    'Continuous Close Short · Continue in 1s · 1/1 rounds · This round 3/3 · Total 3',
  );
});

test('user can stop a continuous close wait without completing its pending delay', async () => {
  // Given a ready button, a pending delay, and a user stop signal.
  const abortController = new AbortController();
  const stoppedError = new Error('stopped');
  stoppedError.name = 'LadderStoppedError';
  // When the wait starts and the user aborts it.
  const task = waitForContinuousLadderNextRound({
    readReadiness: () => ({ status: 'ready' }),
    delay: () => new Promise(() => {}),
    signal: abortController.signal,
  });
  abortController.abort(stoppedError);

  // Then the original stop error terminates the wait immediately.
  await assert.rejects(
    task,
    (error) => error === stoppedError,
  );
});

test('user stops before a cooldown when the readiness adapter returns an unknown state', async () => {
  // Given a readiness adapter that cannot supply a supported status.
  const delays = [];
  const options = { readReadiness: () => ({ status: 'unknown' }), delay: async (ms) => delays.push(ms) };

  // When the continuous close workflow asks whether another round can start.
  const completion = waitForContinuousLadderNextRound(options);

  // Then the invalid state is reported before any cooldown is scheduled.
  await assert.rejects(completion, /连续阶梯按钮就绪状态无效/);
  assert.deepEqual(delays, []);
});

for (const safeNoSubmit of [false, undefined]) {
  test(`user cannot recover an unstable input when no-submit evidence is ${String(safeNoSubmit)}`, () => {
    // Given an input-instability failure without proof that no order was submitted.
    const error = Object.assign(new Error('Input unstable'), { continuousRecoveryKind: 'input_unstable', safeNoSubmit });

    // When continuous mode considers the recovery policy.
    const recovery = resolveContinuousLadderRecovery(error);

    // Then input instability alone cannot authorize another round.
    assert.equal(recovery, null);
  });
}

test('user keeps a localized recovery reason supplied by the failing adapter', () => {
  // Given a safe no-submit failure with localized text rather than only a raw error message.
  const reason = localizedText('盘口未就绪', 'Market data unavailable');
  const error = Object.assign(new Error('Raw adapter failure'), {
    continuousRecoveryKind: 'market_data_not_ready', safeNoSubmit: true, localizedText: reason,
  });

  // When the next-round recovery reason is resolved.
  const recovery = resolveContinuousLadderRecovery(error);
  const absent = resolveContinuousLadderRecovery(null);

  // Then the original localized reason survives and missing errors create no recovery policy.
  assert.deepEqual(recovery, { cooldownMs: CONTINUOUS_LADDER_RECOVERY_COOLDOWN_MS, reason });
  assert.equal(absent, null);
});

for (const cooldownMs of [-1, NaN, Infinity]) {
  test(`user cannot schedule a continuous recovery with invalid cooldown ${String(cooldownMs)}`, () => {
    // Given an explicit rate-limit recovery with an invalid cooldown override.
    const error = Object.assign(new Error('Rate limited'), {
      continuousRecoveryKind: 'rate_limited', continuousRecoveryCooldownMs: cooldownMs,
    });

    // When the cooldown and its display text are validated.
    const resolve = () => resolveContinuousLadderRecovery(error);
    const format = () => formatContinuousLadderWaitReason('cooldown', cooldownMs);

    // Then both execution and presentation reject the invalid duration.
    assert.throws(resolve, /连续阶梯恢复等待时间无效/);
    assert.throws(format, /连续阶梯轮间等待时间无效/);
  });
}

test('user keeps completed-round counters detached from later progress changes', () => {
  // Given one completed close round and its mutable live progress object.
  const progress = createContinuousLadderProgress();
  const live = roundProgress({ submittedOrders: 3, plannedOrders: 3, currentPlanSubmittedOrders: 3 });
  const outcome = { status: 'completed', progress: live };

  // When the round is recorded and the old live object subsequently changes.
  recordContinuousLadderRound(progress, outcome);
  live.submittedOrders = 4;
  live.currentPlanSubmittedOrders = 0;
  live.cancelledOrders = 2;

  // Then the recorded round and cumulative totals retain the confirmed snapshot.
  assert.deepEqual(progress, {
    startedRounds: 1, completedRounds: 1, submittedOrders: 3, cancelledOrders: 0,
    lastRound: { status: 'completed', submittedOrders: 3, cancelledOrders: 0, plannedOrders: 3, currentPlanSubmittedOrders: 3 },
  });
});

for (const outcome of [null, 'completed', { status: 'unknown' }]) {
  test(`user cannot record a missing or unknown round outcome ${JSON.stringify(outcome)}`, () => {
    // Given a fresh session and an outcome that lacks the required round contract.
    const progress = createContinuousLadderProgress();
    const initial = structuredClone(progress);

    // When that outcome is offered to the continuous-round aggregate.
    const record = () => recordContinuousLadderRound(progress, outcome);

    // Then invalid outcomes do not change any completed or submitted counter.
    assert.throws(record, /连续阶梯本轮结果无效/);
    assert.deepEqual(progress, initial);
  });
}

test('user sees a flat-position end state before any close round has started', () => {
  // Given a session whose first readiness read confirms a flat position.
  const progress = createContinuousLadderProgress();
  const label = localizedText('阶梯平空', 'Close Short');

  // When the confirmed-flat session is formatted.
  const message = formatContinuousLadderPositionClosedProgress(label, progress);

  // Then the ended status reports zero rounds and zero submissions without cancellation text.
  assert.equal(zh(message), '连续阶梯平空 · 已结束 · 当前方向已无持仓 · 0 轮 · 累计 0 笔');
  assert.equal(en(message), 'Continuous Close Short · Ended · No position in this direction · 0 rounds · Total 0');
});

test('user sees the first active round while its plan and phase detail are not ready', () => {
  // Given an empty session and a current round that has not built a plan or submitted orders.
  const progress = createContinuousLadderProgress();
  const current = roundProgress({ submittedOrders: 0, plannedOrders: null, currentPlanSubmittedOrders: 0 });

  // When active continuous progress is displayed without a phase detail.
  const message = formatActiveContinuousLadderProgress('阶梯平多', null, progress, current);

  // Then the round identity and total remain visible without invented plan or cancellation counts.
  assert.equal(zh(message), '连续阶梯平多 · 0/1 轮 · 累计 0 笔');
});

for (const { name, options, expectedError } of [
  { name: 'negative cooldown', options: { cooldownMs: -1 }, expectedError: /连续阶梯轮间等待时间无效/ },
  { name: 'zero readiness-check interval', options: { readyCheckMs: 0 }, expectedError: /连续阶梯按钮检查间隔无效/ },
  { name: 'non-callable phase callback', options: { onWaitStateChange: null }, expectedError: /连续阶梯等待状态回调无效/ },
]) {
  test(`user cannot start the next-round wait with a ${name}`, async () => {
    // Given invalid wait configuration and adapters that record any attempted work.
    const operations = [];
    const adapters = {
      readReadiness: () => { operations.push('read'); return { status: 'ready' }; },
      delay: async () => { operations.push('delay'); },
    };

    // When the configured next-round wait is started.
    const completion = waitForContinuousLadderNextRound({ ...adapters, ...options });

    // Then configuration fails before a readiness read or delay can run.
    await assert.rejects(completion, expectedError);
    assert.deepEqual(operations, []);
  });
}

test('user stops if the position becomes flat during the final cooldown', async () => {
  // Given a ready button followed by an authoritative flat-position result after cooldown.
  const states = [{ status: 'ready' }, { status: 'stopped', reason: 'position_flat' }];
  const waits = [];

  // When the next-round workflow completes its cooldown and reads fresh readiness.
  const result = await waitForContinuousLadderNextRound({
    readReadiness: () => states.shift(), delay: async (ms) => waits.push(ms),
  });

  // Then the flat result ends the session after one cooldown without starting another wait.
  assert.deepEqual(result, { status: 'stopped', reason: 'position_flat' });
  assert.deepEqual(waits, [CONTINUOUS_LADDER_COOLDOWN_MS]);
});

test('user sees an authoritative readiness-read failure without another automatic check', async () => {
  // Given a readiness adapter that fails before it can confirm the close button state.
  const failure = new Error('Position response unavailable');
  let reads = 0;
  const waits = [];

  // When the next-round workflow asks the adapter for readiness.
  const completion = waitForContinuousLadderNextRound({
    readReadiness: async () => { reads += 1; throw failure; },
    delay: async (ms) => waits.push(ms),
  });

  // Then the original failure propagates without a blind retry or cooldown.
  await assert.rejects(completion, (error) => error === failure);
  assert.equal(reads, 1);
  assert.deepEqual(waits, []);
});

test('user cannot start the next close round one millisecond before the full cooldown', async () => {
  // Given a manual clock, a ready close button, and a one-second next-round cooldown.
  let now = 0;
  let pending = null;
  let finished = false;
  const delayStarted = Promise.withResolvers();
  const delay = (ms) => {
    const deferred = Promise.withResolvers();
    pending = { deadline: now + ms, deferred };
    delayStarted.resolve();
    return deferred.promise;
  };
  const advance = (ms) => {
    now += ms;
    if (pending && now >= pending.deadline) {
      pending.deferred.resolve();
      pending = null;
    }
  };

  // When the cooldown starts and virtual time advances to 999 ms.
  const completion = waitForContinuousLadderNextRound({ readReadiness: () => ({ status: 'ready' }), delay })
    .then((result) => { finished = true; return result; });
  await delayStarted.promise;
  advance(999);

  // Then readiness alone cannot finish the remaining millisecond of cooldown.
  assert.equal(finished, false);
  assert.equal(now, 999);
  assert.equal(pending.deadline, 1000);

  // When virtual time reaches the complete cooldown duration.
  advance(1);
  const result = await completion;

  // Then a fresh readiness check permits the next round exactly at 1000 ms.
  assert.deepEqual(result, { status: 'ready' });
  assert.equal(finished, true);
  assert.equal(now, 1000);
  assert.equal(pending, null);
});
