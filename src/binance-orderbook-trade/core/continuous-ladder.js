import {
  throwIfAborted,
  waitForPromiseOrAbort,
} from './abort.js';

export const CONTINUOUS_LADDER_COOLDOWN_MS = 1000;
export const CONTINUOUS_LADDER_READY_CHECK_MS = 50;

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
}) {
  while (true) {
    throwIfAborted(signal);
    const state = assertReadinessState(readReadiness());
    if (state.status !== 'waiting') return state;
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
}) {
  if (!(cooldownMs >= 0)) throw new Error('Invalid continuous ladder cooldown');
  if (!(readyCheckMs > 0)) throw new Error('Invalid continuous ladder readiness interval');

  while (true) {
    const readyState = await waitUntilReadyOrStopped({
      readReadiness,
      delay,
      signal,
      readyCheckMs,
    });
    if (readyState.status === 'stopped') return readyState;

    await waitForPromiseOrAbort(delay(cooldownMs), signal);
    throwIfAborted(signal);
    const afterCooldown = assertReadinessState(readReadiness());
    if (afterCooldown.status !== 'waiting') return afterCooldown;
  }
}
