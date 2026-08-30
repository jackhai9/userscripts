import {
  throwIfAborted,
  waitForPromiseOrAbort,
} from './abort.js';
import { snapshotLadderProgress } from './ladder-progress.js';

export const CONTINUOUS_LADDER_COOLDOWN_MS = 1000;
export const CONTINUOUS_LADDER_READY_CHECK_MS = 50;

const recordedRoundOutcomes = new WeakSet();
const CONTINUOUS_LADDER_PHASE_TEXT = Object.freeze({
  running: '连续中',
  stopping: '连续停止中',
  stopped: '连续已停止',
  failed: '连续失败',
  interrupted: '连续已中止',
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
    throw new Error('Invalid continuous ladder progress');
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

export function recordContinuousLadderRound(progress, outcome) {
  assertContinuousLadderProgress(progress);
  if (!outcome || typeof outcome !== 'object') {
    throw new Error('Invalid continuous ladder round outcome');
  }
  if (recordedRoundOutcomes.has(outcome)) {
    throw new Error('Continuous ladder round was already recorded');
  }
  if (!['completed', 'stopped', 'failed', 'interrupted'].includes(outcome.status)) {
    throw new Error('Invalid continuous ladder round outcome');
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

export function formatContinuousLadderProgress(label, phase, progress, reason = null) {
  if (typeof label !== 'string' || label.trim() === '') {
    throw new Error('Invalid continuous ladder label');
  }
  const phaseText = CONTINUOUS_LADDER_PHASE_TEXT[phase];
  if (!phaseText) throw new Error('Invalid continuous ladder phase');
  if (reason !== null && (typeof reason !== 'string' || reason.trim() === '')) {
    throw new Error('Invalid continuous ladder reason');
  }
  assertContinuousLadderProgress(progress);

  const parts = [`${label}${phaseText}`];
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
  if (reason !== null) parts.push(reason);
  return parts.join(' · ');
}

export function formatContinuousLadderWaitReason(phase, cooldownMs) {
  if (!Number.isFinite(cooldownMs) || cooldownMs < 0) {
    throw new Error('Invalid continuous ladder cooldown');
  }
  if (phase === 'waiting_ready') return '等待按钮恢复';
  if (phase !== 'cooldown') throw new Error('Invalid continuous ladder wait phase');
  const duration = cooldownMs % 1000 === 0
    ? `${cooldownMs / 1000}s`
    : `${cooldownMs}ms`;
  return `等待 ${duration} 后继续下一轮`;
}

function assertReadinessState(state) {
  if (!['ready', 'waiting', 'stopped'].includes(state?.status)) {
    throw new Error('Invalid continuous ladder readiness state');
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
    const state = assertReadinessState(readReadiness());
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
  if (!(cooldownMs >= 0)) throw new Error('Invalid continuous ladder cooldown');
  if (!(readyCheckMs > 0)) throw new Error('Invalid continuous ladder readiness interval');
  if (typeof onWaitStateChange !== 'function') {
    throw new Error('Invalid continuous ladder wait-state callback');
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
    const afterCooldown = assertReadinessState(readReadiness());
    if (afterCooldown.status !== 'waiting') return afterCooldown;
    onWaitStateChange({ phase: 'waiting_ready', cooldownMs });
    waitingAlreadyReported = true;
  }
}
