import {
  throwIfAborted,
  waitForPromiseOrAbort,
} from './abort.js';
import { snapshotLadderProgress } from './ladder-progress.js';
import {
  combineLocalizedText,
  formatLocalizedText,
  isLocalizedText,
  localizedText,
  UI_LOCALE_EN,
  UI_LOCALE_ZH_CN,
} from '../contracts/panel-copy.js';

export const CONTINUOUS_LADDER_COOLDOWN_MS = 1000;
export const CONTINUOUS_LADDER_READY_CHECK_MS = 50;
export const CONTINUOUS_LADDER_RECOVERY_COOLDOWN_MS = 3000;

const CONTINUOUS_LADDER_RECOVERY = Object.freeze({
  submit_unconfirmed: {
    cooldownMs: CONTINUOUS_LADDER_RECOVERY_COOLDOWN_MS,
    requiresSafeNoSubmit: false,
  },
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
    reason: localizedText(
      '价格精度已变化，下一轮按新精度继续',
      'Precision changed; the next round will use the new precision',
    ),
  },
  options_changed: {
    cooldownMs: CONTINUOUS_LADDER_COOLDOWN_MS,
    reason: localizedText(
      '比例、笔数或间距已变化，下一轮按新设置继续',
      'Ratio, orders, or gap changed; the next round will use the new settings',
    ),
  },
});

const recordedRoundOutcomes = new WeakSet();
const CONTINUOUS_LADDER_PHASE_TEXT = Object.freeze({
  running: null,
  stopping: localizedText('停止中', 'Stopping'),
  stopped: localizedText('已停止', 'Stopped'),
  failed: localizedText('失败', 'Failed'),
  interrupted: localizedText('已中止', 'Interrupted'),
});

function isValidLocalizedValue(value) {
  return isLocalizedText(value) || (typeof value === 'string' && value.trim() !== '');
}

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
 * Most recoveries require proof that no order was submitted. The explicit
 * submit_unconfirmed policy accepts a possible duplicate in continuous mode
 * and advances to a new round instead of retrying the uncertain order in place.
 */
export function resolveContinuousLadderRecovery(error) {
  const recovery = CONTINUOUS_LADDER_RECOVERY[error?.continuousRecoveryKind];
  if (!recovery) return null;
  if (recovery.requiresSafeNoSubmit !== false && error.safeNoSubmit !== true) return null;
  return {
    cooldownMs: recovery.cooldownMs,
    reason: recovery.reason || error.localizedText || error.message,
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
  if (!isValidLocalizedValue(label)) {
    throw new Error('连续阶梯动作名称无效');
  }
  const phaseText = CONTINUOUS_LADDER_PHASE_TEXT[phase];
  if (!Object.hasOwn(CONTINUOUS_LADDER_PHASE_TEXT, phase)) {
    throw new Error('连续阶梯阶段无效');
  }
  assertContinuousLadderProgress(progress);

  const parts = [localizedText(
    `连续${formatLocalizedText(label, UI_LOCALE_ZH_CN)}`,
    `Continuous ${formatLocalizedText(label, UI_LOCALE_EN)}`,
  )];
  if (phaseText !== null) parts.push(phaseText);
  parts.push(progress.startedRounds === 0
    ? localizedText('0 轮', '0 rounds')
    : localizedText(
      `${progress.completedRounds}/${progress.startedRounds} 轮`,
      `${progress.completedRounds}/${progress.startedRounds} rounds`,
    ));
  if (progress.lastRound?.plannedOrders !== null) {
    parts.push(localizedText(
      `本轮 ${progress.lastRound.currentPlanSubmittedOrders}/${progress.lastRound.plannedOrders} 笔`,
      `This round ${progress.lastRound.currentPlanSubmittedOrders}/${progress.lastRound.plannedOrders}`,
    ));
  } else if (progress.lastRound?.submittedOrders > 0) {
    parts.push(localizedText(
      `本轮 ${progress.lastRound.submittedOrders} 笔`,
      `This round ${progress.lastRound.submittedOrders}`,
    ));
  }
  parts.push(localizedText(
    `累计 ${progress.submittedOrders} 笔`,
    `Total ${progress.submittedOrders}`,
  ));
  if (progress.cancelledOrders > 0) {
    parts.push(localizedText(
      `撤 ${progress.cancelledOrders} 笔`,
      `Cancelled ${progress.cancelledOrders}`,
    ));
  }
  return parts;
}

export function formatActiveContinuousLadderProgress(
  label,
  detail,
  progress,
  roundProgress,
) {
  if (!isValidLocalizedValue(label)) {
    throw new Error('连续阶梯动作名称无效');
  }
  if (detail !== null && !isValidLocalizedValue(detail)) {
    throw new Error('连续阶梯当前进度信息无效');
  }
  assertContinuousLadderProgress(progress);
  const round = snapshotLadderProgress(roundProgress);

  const parts = [localizedText(
    `连续${formatLocalizedText(label, UI_LOCALE_ZH_CN)}`,
    `Continuous ${formatLocalizedText(label, UI_LOCALE_EN)}`,
  )];
  if (detail !== null) parts.push(detail);
  parts.push(localizedText(
    `${progress.completedRounds}/${progress.startedRounds + 1} 轮`,
    `${progress.completedRounds}/${progress.startedRounds + 1} rounds`,
  ));
  if (round.plannedOrders !== null) {
    parts.push(localizedText(
      `本轮 ${round.currentPlanSubmittedOrders}/${round.plannedOrders} 笔`,
      `This round ${round.currentPlanSubmittedOrders}/${round.plannedOrders}`,
    ));
  } else if (round.submittedOrders > 0) {
    parts.push(localizedText(
      `本轮 ${round.submittedOrders} 笔`,
      `This round ${round.submittedOrders}`,
    ));
  }
  parts.push(localizedText(
    `累计 ${progress.submittedOrders + round.submittedOrders} 笔`,
    `Total ${progress.submittedOrders + round.submittedOrders}`,
  ));
  const cancelledOrders = progress.cancelledOrders + round.cancelledOrders;
  if (cancelledOrders > 0) {
    parts.push(localizedText(`撤 ${cancelledOrders} 笔`, `Cancelled ${cancelledOrders}`));
  }
  return combineLocalizedText(parts, ' · ');
}

export function formatContinuousLadderProgress(label, phase, progress, reason = null) {
  if (reason !== null && !isValidLocalizedValue(reason)) {
    throw new Error('连续阶梯停止原因无效');
  }
  const parts = buildContinuousLadderProgressParts(label, phase, progress);
  if (reason !== null) parts.push(reason);
  return combineLocalizedText(parts, ' · ');
}

export function formatContinuousLadderPositionClosedProgress(label, progress) {
  if (!isValidLocalizedValue(label)) {
    throw new Error('连续阶梯动作名称无效');
  }
  assertContinuousLadderProgress(progress);
  const parts = [
    localizedText(
      `连续${formatLocalizedText(label, UI_LOCALE_ZH_CN)}`,
      `Continuous ${formatLocalizedText(label, UI_LOCALE_EN)}`,
    ),
    localizedText('已结束', 'Ended'),
    localizedText('当前方向已无持仓', 'No position in this direction'),
    progress.startedRounds === 0
      ? localizedText('0 轮', '0 rounds')
      : localizedText(
        `${progress.completedRounds}/${progress.startedRounds} 轮`,
        `${progress.completedRounds}/${progress.startedRounds} rounds`,
      ),
    localizedText(`累计 ${progress.submittedOrders} 笔`, `Total ${progress.submittedOrders}`),
  ];
  if (progress.cancelledOrders > 0) {
    parts.push(localizedText(
      `撤 ${progress.cancelledOrders} 笔`,
      `Cancelled ${progress.cancelledOrders}`,
    ));
  }
  return combineLocalizedText(parts, ' · ');
}

export function formatContinuousLadderWaitReason(phase, cooldownMs) {
  if (!Number.isFinite(cooldownMs) || cooldownMs < 0) {
    throw new Error('连续阶梯轮间等待时间无效');
  }
  if (phase === 'waiting_ready') return localizedText('等待按钮恢复', 'Waiting for button');
  if (phase !== 'cooldown') throw new Error('连续阶梯等待阶段无效');
  const duration = cooldownMs % 1000 === 0
    ? `${cooldownMs / 1000}s`
    : `${cooldownMs}ms`;
  return localizedText(`${duration} 后继续`, `Continue in ${duration}`);
}

export function formatContinuousLadderWaitProgress(label, progress, phase, cooldownMs) {
  const parts = buildContinuousLadderProgressParts(label, 'running', progress);
  parts.splice(1, 0, formatContinuousLadderWaitReason(phase, cooldownMs));
  return combineLocalizedText(parts, ' · ');
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
