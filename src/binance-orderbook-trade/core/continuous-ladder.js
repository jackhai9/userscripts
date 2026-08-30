import {
  throwIfAborted,
  waitForPromiseOrAbort,
} from './abort.js';
import { snapshotLadderProgress } from './ladder-progress.js';

export const CONTINUOUS_LADDER_COOLDOWN_MS = 1000;
export const CONTINUOUS_LADDER_READY_CHECK_MS = 50;
export const CONTINUOUS_LADDER_RECOVERY_COOLDOWN_MS = 3000;

const CONTINUOUS_LADDER_RECOVERY = Object.freeze({
  input_unstable: {
    cooldownMs: CONTINUOUS_LADDER_RECOVERY_COOLDOWN_MS,
  },
  controls_not_ready: {
    cooldownMs: CONTINUOUS_LADDER_RECOVERY_COOLDOWN_MS,
  },
  market_data_not_ready: {
    cooldownMs: CONTINUOUS_LADDER_RECOVERY_COOLDOWN_MS,
  },
  precision_changed: {
    cooldownMs: CONTINUOUS_LADDER_COOLDOWN_MS,
    reason: '价格精度已变化，下一轮按新精度继续',
  },
  options_changed: {
    cooldownMs: CONTINUOUS_LADDER_COOLDOWN_MS,
    reason: '比例、笔数或间距已变化，下一轮按新设置继续',
  },
});

const recordedRoundOutcomes = new WeakSet();
const CONTINUOUS_LADDER_PHASE_TEXT = Object.freeze({
  running: null,
  stopping: '停止中',
  stopped: '已停止',
  failed: '失败',
  interrupted: '已中止',
});

function assertContinuousLadderProgress(progress) {
  if (
    !progress
    || !Number.isInteger(progress.startedRounds)
    || progress.startedRounds < 0
    || !Number.isInteger(progress.completedRounds)
    || progress.completedRounds < 0
    || progress.completedRounds > progress.startedRounds
    || !Number.isInteger(progress.submittedOrders)
    || progress.submittedOrders < 0
    || !Number.isInteger(progress.cancelledOrders)
    || progress.cancelledOrders < 0
    || (progress.startedRounds === 0) !== (progress.lastRound === null)
  ) {
    throw new Error('连续阶梯进度状态无效');
  }
  if (progress.lastRound !== null) snapshotLadderProgress(progress.lastRound);
}

export function createContinuousLadderProgress() {
  return {
    startedRounds: 0,
    completedRounds: 0,
    submittedOrders: 0,
    cancelledOrders: 0,
    lastRound: null,
  };
}

/**
 * Recovers only when the failed submission attempt is proven not to have sent an order.
 */
export function resolveContinuousLadderRecovery(error) {
  if (error?.safeNoSubmit !== true) return null;
  const recovery = CONTINUOUS_LADDER_RECOVERY[error.continuousRecoveryKind];
  if (!recovery) return null;
  return {
    cooldownMs: recovery.cooldownMs,
    reason: recovery.reason || error.message,
  };
}

export function recordContinuousLadderRound(progress, outcome) {
  assertContinuousLadderProgress(progress);
  if (!outcome || typeof outcome !== 'object') {
    throw new Error('连续阶梯本轮结果无效');
  }
  if (recordedRoundOutcomes.has(outcome)) {
    throw new Error('连续阶梯本轮结果已记录');
  }
  if (!['completed', 'position_closed', 'stopped', 'failed', 'interrupted'].includes(outcome.status)) {
    throw new Error('连续阶梯本轮结果无效');
  }
  const roundProgress = snapshotLadderProgress(outcome.progress);
  progress.startedRounds += 1;
  if (outcome.status === 'completed') progress.completedRounds += 1;
  progress.submittedOrders += roundProgress.submittedOrders;
  progress.cancelledOrders += roundProgress.cancelledOrders;
  progress.lastRound = {
    status: outcome.status,
    ...roundProgress,
  };
  recordedRoundOutcomes.add(outcome);
  assertContinuousLadderProgress(progress);
}

function buildContinuousLadderProgressParts(label, phase, progress) {
  if (typeof label !== 'string' || label.trim() === '') {
    throw new Error('连续阶梯动作名称无效');
  }
  const phaseText = CONTINUOUS_LADDER_PHASE_TEXT[phase];
  if (!Object.hasOwn(CONTINUOUS_LADDER_PHASE_TEXT, phase)) {
    throw new Error('连续阶梯阶段无效');
  }
  assertContinuousLadderProgress(progress);

  const parts = [`连续${label}`];
  if (phaseText !== null) parts.push(phaseText);
  parts.push(progress.startedRounds === 0
    ? '0 轮'
    : `${progress.completedRounds}/${progress.startedRounds} 轮`);
  if (progress.lastRound?.plannedOrders !== null) {
    parts.push(
      `本轮 ${progress.lastRound.currentPlanSubmittedOrders}/${progress.lastRound.plannedOrders} 笔`,
    );
  } else if (progress.lastRound?.submittedOrders > 0) {
    parts.push(`本轮 ${progress.lastRound.submittedOrders} 笔`);
  }
  parts.push(`累计 ${progress.submittedOrders} 笔`);
  if (progress.cancelledOrders > 0) parts.push(`撤 ${progress.cancelledOrders} 笔`);
  return parts;
}

export function formatActiveContinuousLadderProgress(
  label,
  detail,
  progress,
  roundProgress,
) {
  if (typeof label !== 'string' || label.trim() === '') {
    throw new Error('连续阶梯动作名称无效');
  }
  if (detail !== null && (typeof detail !== 'string' || detail.trim() === '')) {
    throw new Error('连续阶梯当前进度信息无效');
  }
  assertContinuousLadderProgress(progress);
  const round = snapshotLadderProgress(roundProgress);

  const parts = [`连续${label}`];
  if (detail !== null) parts.push(detail);
  parts.push(`${progress.completedRounds}/${progress.startedRounds + 1} 轮`);
  if (round.plannedOrders !== null) {
    parts.push(`本轮 ${round.currentPlanSubmittedOrders}/${round.plannedOrders} 笔`);
  } else if (round.submittedOrders > 0) {
    parts.push(`本轮 ${round.submittedOrders} 笔`);
  }
  parts.push(`累计 ${progress.submittedOrders + round.submittedOrders} 笔`);
  const cancelledOrders = progress.cancelledOrders + round.cancelledOrders;
  if (cancelledOrders > 0) parts.push(`撤 ${cancelledOrders} 笔`);
  return parts.join(' · ');
}

export function formatContinuousLadderProgress(label, phase, progress, reason = null) {
  if (reason !== null && (typeof reason !== 'string' || reason.trim() === '')) {
    throw new Error('连续阶梯停止原因无效');
  }
  const parts = buildContinuousLadderProgressParts(label, phase, progress);
  if (reason !== null) parts.push(reason);
  return parts.join(' · ');
}

export function formatContinuousLadderPositionClosedProgress(label, progress) {
  if (typeof label !== 'string' || label.trim() === '') {
    throw new Error('连续阶梯动作名称无效');
  }
  assertContinuousLadderProgress(progress);
  const parts = [
    `连续${label}`,
    '已结束',
    '当前方向已无持仓',
    progress.startedRounds === 0
      ? '0 轮'
      : `${progress.completedRounds}/${progress.startedRounds} 轮`,
    `累计 ${progress.submittedOrders} 笔`,
  ];
  if (progress.cancelledOrders > 0) parts.push(`撤 ${progress.cancelledOrders} 笔`);
  return parts.join(' · ');
}

export function formatContinuousLadderWaitReason(phase, cooldownMs) {
  if (!Number.isFinite(cooldownMs) || cooldownMs < 0) {
    throw new Error('连续阶梯轮间等待时间无效');
  }
  if (phase === 'waiting_ready') return '等待按钮恢复';
  if (phase !== 'cooldown') throw new Error('连续阶梯等待阶段无效');
  const duration = cooldownMs % 1000 === 0
    ? `${cooldownMs / 1000}s`
    : `${cooldownMs}ms`;
  return `${duration} 后继续`;
}

export function formatContinuousLadderWaitProgress(label, progress, phase, cooldownMs) {
  const parts = buildContinuousLadderProgressParts(label, 'running', progress);
  parts.splice(1, 0, formatContinuousLadderWaitReason(phase, cooldownMs));
  return parts.join(' · ');
}

function assertReadinessState(state) {
  if (!['ready', 'waiting', 'stopped'].includes(state?.status)) {
    throw new Error('连续阶梯按钮就绪状态无效');
  }
  return state;
}

async function waitUntilReadyOrStopped({
  readReadiness,
  delay,
  signal,
  readyCheckMs,
  cooldownMs,
  onWaitStateChange,
  waitingAlreadyReported,
}) {
  let reported = waitingAlreadyReported;
  while (true) {
    throwIfAborted(signal);
    const state = assertReadinessState(await readReadiness());
    if (state.status !== 'waiting') return state;
    if (!reported) {
      onWaitStateChange({ phase: 'waiting_ready', cooldownMs });
      reported = true;
    }
    await waitForPromiseOrAbort(delay(readyCheckMs), signal);
  }
}

/**
 * Starts the inter-round cooldown only after readiness is observed. If readiness
 * is lost during the cooldown, a new full cooldown starts after it returns.
 */
export async function waitForContinuousLadderNextRound({
  readReadiness,
  delay,
  signal = null,
  cooldownMs = CONTINUOUS_LADDER_COOLDOWN_MS,
  readyCheckMs = CONTINUOUS_LADDER_READY_CHECK_MS,
  onWaitStateChange = () => {},
}) {
  if (!(cooldownMs >= 0)) throw new Error('连续阶梯轮间等待时间无效');
  if (!(readyCheckMs > 0)) throw new Error('连续阶梯按钮检查间隔无效');
  if (typeof onWaitStateChange !== 'function') {
    throw new Error('连续阶梯等待状态回调无效');
  }

  let waitingAlreadyReported = false;
  while (true) {
    const readyState = await waitUntilReadyOrStopped({
      readReadiness,
      delay,
      signal,
      readyCheckMs,
      cooldownMs,
      onWaitStateChange,
      waitingAlreadyReported,
    });
    if (readyState.status === 'stopped') return readyState;

    waitingAlreadyReported = false;
    onWaitStateChange({ phase: 'cooldown', cooldownMs });
    await waitForPromiseOrAbort(delay(cooldownMs), signal);
    throwIfAborted(signal);
    const afterCooldown = assertReadinessState(await readReadiness());
    if (afterCooldown.status !== 'waiting') return afterCooldown;
    onWaitStateChange({ phase: 'waiting_ready', cooldownMs });
    waitingAlreadyReported = true;
  }
}
