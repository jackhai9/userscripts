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
    zh(formatContinuousLadderProgress('阶梯平空', 'running', progress)),
    '连续阶梯平空 · 2/2 轮 · 本轮 3/3 笔 · 累计 6 笔',
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
    zh(formatContinuousLadderProgress('阶梯平空', 'stopped', progress)),
    '连续阶梯平空 · 已停止 · 2/3 轮 · 本轮 1/3 笔 · 累计 7 笔',
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
    zh(formatContinuousLadderProgress('阶梯平多', 'failed', progress, '下单按钮 3 秒内未恢复可点击')),
    '连续阶梯平多 · 失败 · 0/1 轮 · 本轮 2/3 笔 · 累计 2 笔 · 撤 1 笔 · 下单按钮 3 秒内未恢复可点击',
  );
});

test('active continuous ladder status keeps the continuous action and live round totals', () => {
  const progress = createContinuousLadderProgress();
  const completedRound = roundProgress({
    submittedOrders: 3,
    plannedOrders: 3,
    currentPlanSubmittedOrders: 3,
  });
  recordContinuousLadderRound(progress, { status: 'completed', progress: completedRound });
  recordContinuousLadderRound(progress, { status: 'completed', progress: completedRound });

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
    /连续阶梯本轮结果已记录/,
  );
  assert.throws(
    () => formatContinuousLadderProgress('阶梯平空', 'unknown', progress),
    /连续阶梯阶段无效/,
  );
});

test('continuous ladder retries only explicitly designed recoverable failures', () => {
  const inputUnstable = new Error('价格框或数量框未稳定');
  inputUnstable.safeNoSubmit = true;
  inputUnstable.continuousRecoveryKind = 'input_unstable';
  assert.deepEqual(resolveContinuousLadderRecovery(inputUnstable), {
    cooldownMs: CONTINUOUS_LADDER_RECOVERY_COOLDOWN_MS,
    reason: '价格框或数量框未稳定',
  });

  const marketDataNotReady = new Error('盘口数据未就绪');
  marketDataNotReady.safeNoSubmit = true;
  marketDataNotReady.continuousRecoveryKind = 'market_data_not_ready';
  assert.deepEqual(resolveContinuousLadderRecovery(marketDataNotReady), {
    cooldownMs: CONTINUOUS_LADDER_RECOVERY_COOLDOWN_MS,
    reason: '盘口数据未就绪',
  });

  const precisionChanged = new Error('价格精度已变化');
  precisionChanged.safeNoSubmit = true;
  precisionChanged.continuousRecoveryKind = 'precision_changed';
  const precisionRecovery = resolveContinuousLadderRecovery(precisionChanged);
  assert.equal(precisionRecovery.cooldownMs, CONTINUOUS_LADDER_COOLDOWN_MS);
  assert.equal(zh(precisionRecovery.reason), '价格精度已变化，下一轮按新精度继续');
  assert.equal(en(precisionRecovery.reason), 'Precision changed; the next round will use the new precision');

  const optionsChanged = new Error('阶梯设置已变化');
  optionsChanged.safeNoSubmit = true;
  optionsChanged.continuousRecoveryKind = 'options_changed';
  const optionsRecovery = resolveContinuousLadderRecovery(optionsChanged);
  assert.equal(optionsRecovery.cooldownMs, CONTINUOUS_LADDER_COOLDOWN_MS);
  assert.equal(zh(optionsRecovery.reason), '比例、笔数或间距已变化，下一轮按新设置继续');
  assert.equal(en(optionsRecovery.reason), 'Ratio, orders, or gap changed; the next round will use the new settings');

  const unknownOutcome = new Error('仍未确认订单结果');
  unknownOutcome.safeNoSubmit = false;
  unknownOutcome.continuousRecoveryKind = 'submit_unconfirmed';
  assert.deepEqual(resolveContinuousLadderRecovery(unknownOutcome), {
    cooldownMs: CONTINUOUS_LADDER_RECOVERY_COOLDOWN_MS,
    reason: '仍未确认订单结果',
  });

  const openOrdersNotReady = new Error('当前委托列表暂未就绪');
  openOrdersNotReady.continuousRecoveryKind = 'open_orders_not_ready';
  assert.deepEqual(resolveContinuousLadderRecovery(openOrdersNotReady), {
    cooldownMs: CONTINUOUS_LADDER_RECOVERY_COOLDOWN_MS,
    reason: '当前委托列表暂未就绪',
  });

  const positionQuantityNotReady = new Error('当前方向暂无可平数量');
  positionQuantityNotReady.safeNoSubmit = true;
  positionQuantityNotReady.continuousRecoveryKind = 'position_quantity_not_ready';
  assert.deepEqual(resolveContinuousLadderRecovery(positionQuantityNotReady), {
    cooldownMs: CONTINUOUS_LADDER_LONG_RECOVERY_COOLDOWN_MS,
    reason: '当前方向暂无可平数量',
  });

  const rateLimited = new Error('请求频率受限');
  rateLimited.continuousRecoveryKind = 'rate_limited';
  rateLimited.continuousRecoveryCooldownMs = 17000;
  assert.deepEqual(resolveContinuousLadderRecovery(rateLimited), {
    cooldownMs: 17000,
    reason: '请求频率受限',
  });

  const unsupported = new Error('未知错误');
  unsupported.safeNoSubmit = true;
  unsupported.continuousRecoveryKind = 'unknown';
  assert.equal(resolveContinuousLadderRecovery(unsupported), null);
});

test('a settings change preserves the partial round before the next round uses new settings', () => {
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

  recordContinuousLadderRound(progress, outcome);
  const recovery = resolveContinuousLadderRecovery(optionsChanged);

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
    zh(formatContinuousLadderWaitReason('waiting_ready', CONTINUOUS_LADDER_COOLDOWN_MS)),
    '等待按钮恢复',
  );
  assert.equal(
    zh(formatContinuousLadderWaitReason('cooldown', CONTINUOUS_LADDER_COOLDOWN_MS)),
    '1s 后继续',
  );
  assert.throws(
    () => formatContinuousLadderWaitReason('unknown', CONTINUOUS_LADDER_COOLDOWN_MS),
    /连续阶梯等待阶段无效/,
  );
});

test('continuous ladder wait status puts the current wait before progress counters', () => {
  const progress = createContinuousLadderProgress();
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

test('continuous ladder supports an asynchronous confirmed-flat readiness check', async () => {
  const delays = [];
  const result = await waitForContinuousLadderNextRound({
    readReadiness: async () => ({ status: 'stopped', reason: 'position_flat' }),
    delay: async (ms) => delays.push(ms),
  });

  assert.deepEqual(result, { status: 'stopped', reason: 'position_flat' });
  assert.deepEqual(delays, []);
});

test('continuous ladder formats confirmed flat as an ended outcome without a failed round detail', () => {
  const progress = createContinuousLadderProgress();
  recordContinuousLadderRound(progress, {
    status: 'position_closed',
    progress: roundProgress({
      submittedOrders: 0,
      cancelledOrders: 1,
      plannedOrders: 3,
      currentPlanSubmittedOrders: 0,
    }),
  });

  assert.equal(
    zh(formatContinuousLadderPositionClosedProgress('阶梯平空', progress)),
    '连续阶梯平空 · 已结束 · 当前方向已无持仓 · 0/1 轮 · 累计 0 笔 · 撤 1 笔',
  );
});

test('continuous ladder progress renders its counters in English', () => {
  const progress = createContinuousLadderProgress();
  recordContinuousLadderRound(progress, {
    status: 'completed',
    progress: roundProgress({
      submittedOrders: 3,
      plannedOrders: 3,
      currentPlanSubmittedOrders: 3,
    }),
  });

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
    /连续阶梯按钮就绪状态无效/,
  );
});
