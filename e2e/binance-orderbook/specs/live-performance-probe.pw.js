import { test, expect } from '../test.js';

import {
  ORDER_SETS,
  POSITION_SETS,
  createCancelScenario,
} from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario } from '../helpers/userscript-page.js';
import { installScenarioClock, pauseScenarioClock } from '../helpers/scenario-clock.js';
import {
  armLivePerformanceProbe,
  createLivePerformanceProbeExpression,
  destroyLivePerformanceProbe,
  finishLivePerformanceProbe,
  finishLivePerformanceProbeWhenReady,
  installLivePerformanceProbe,
  prepareLivePerformanceProbeCompletion,
  validateLivePerformanceProbeSnapshot,
} from '../helpers/live-performance-probe.js';

test('user receives complete no-order evidence and can dispose the performance probe', async ({ page }) => {
  // Given an empty account has a live probe armed idempotently for the no-order action.
  await openUserscriptScenario(page, createCancelScenario());
  await installLivePerformanceProbe(page);
  const firstArm = await armLivePerformanceProbe(page, 'cancel-current-symbol-no-orders');
  const secondArm = await armLivePerformanceProbe(page, 'cancel-current-symbol-no-orders');
  expect(secondArm.sessionId).toBe(firstArm.sessionId);

  await prepareLivePerformanceProbeCompletion(page, 'no-orders');
  // When the user requests cancellation after page-owned completion tracking is prepared.
  await page.getByRole('button', { name: '撤单' }).click();
  // Then the real-time capture finishes promptly and ignores later mutations and clicks after disposal.
  const snapshot = await finishLivePerformanceProbeWhenReady(page);
  await expect(page.getByRole('button', { name: '无挂单' })).toBeEnabled();
  expect(() => validateLivePerformanceProbeSnapshot(snapshot)).not.toThrow();
  expect(snapshot.events.map((event) => event.kind)).toContain('first-feedback');
  const firstFeedback = snapshot.events.find((event) => event.kind === 'first-feedback');
  expect(snapshot.finishedAtMonotonicMs - snapshot.startedAtMonotonicMs - firstFeedback.atMs)
    .toBeLessThan(50);
  expect(snapshot.lastSemanticState.statusText).toBe('当前交易对无挂单');

  const finishedEventCount = snapshot.events.length;

  // When a mutation and two real rendering frames occur after capture completion.
  await page.evaluate(async () => {
    const panel = document.querySelector('#jh-binance-close-qty-multiplier-panel');
    panel?.setAttribute('data-after-finish', 'ignored');
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });

  // Then disconnected mutation observers cannot append another event.
  const frozen = await page.evaluate(() => window.__BINANCE_LIVE_PERFORMANCE_PROBE__.snapshot());
  expect(frozen.events).toHaveLength(finishedEventCount);

  const beforeDestroy = snapshot.events.length;

  // When the user destroys the probe and clicks the action again.
  await destroyLivePerformanceProbe(page);
  await page.getByRole('button', { name: '撤单' }).click();

  // Then no probe remains and the completed capture stays immutable.
  expect(await page.evaluate(() => window.__BINANCE_LIVE_PERFORMANCE_PROBE__)).toBeUndefined();
  expect(snapshot.events).toHaveLength(beforeDestroy);
});

test('user can leave confirmation open for a minute and dismiss the replaced native dialog', async ({ page }) => {
  // Given a lifecycle clock controls a native dialog that will be replaced after opening.
  await installScenarioClock(page);
  const scenario = createCancelScenario({
    positions: POSITION_SETS.current,
    orders: ORDER_SETS.current,
    host: { dialogReplacementDelayMs: 20 },
  });
  await openUserscriptScenario(page, scenario);
  await installLivePerformanceProbe(page);
  await armLivePerformanceProbe(page, 'cancel-dialog-cancel');

  await prepareLivePerformanceProbeCompletion(page, 'dialog-cancel', { timeoutMs: 120_000 });
  // When the user opens confirmation and a full minute passes without a decision.
  await page.getByRole('button', { name: '撤单' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await pauseScenarioClock(page);
  await page.clock.runFor(60_000);
  // Then the probe remains unfinished and continues tracking the dialog until the user cancels.
  const waiting = await page.evaluate(() => window.__BINANCE_LIVE_PERFORMANCE_PROBE__.snapshot());
  expect(waiting.finishedAtMonotonicMs).toBeNull();
  expect(waiting.events.map((event) => event.kind)).toContain('dialog-visible');

  await page.getByRole('button', { name: '取消' }).evaluate((button) => {
    button.parentElement.classList.add('bn-modal-footer');
  });

  // When the user decides to cancel through the replacement dialog.
  await page.clock.resume();
  await page.getByRole('button', { name: '取消' }).click();

  // Then completion records the decision and final cancellation state.
  const snapshot = await finishLivePerformanceProbeWhenReady(page);
  await expect(page.getByText('撤单已取消')).toBeVisible();
  expect(() => validateLivePerformanceProbeSnapshot(snapshot)).not.toThrow();
  expect(snapshot.events.map((event) => event.kind)).toEqual(expect.arrayContaining([
    'dialog-visible',
    'dialog-action',
    'dialog-hidden',
  ]));
  await destroyLivePerformanceProbe(page);
});

test('user receives completed cancellation evidence only after native cleanup finishes', async ({ page }) => {
  // Given the current symbol has a Basic order and page-owned completion tracking is prepared.
  const scenario = createCancelScenario({
    positions: POSITION_SETS.current,
    orders: ORDER_SETS.current,
  });
  await openUserscriptScenario(page, scenario);
  await installLivePerformanceProbe(page);
  await armLivePerformanceProbe(page, 'cancel-dialog-confirm');

  await prepareLivePerformanceProbeCompletion(page, 'dialog-confirm');
  // When the user opens and confirms the native cancellation.
  await page.getByRole('button', { name: '撤单' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '确认' }).click();
  // Then the completed capture contains a primary decision and the final cancellation status.
  const snapshot = await finishLivePerformanceProbeWhenReady(page);

  expect(() => validateLivePerformanceProbeSnapshot(snapshot)).not.toThrow();
  expect(snapshot.events.find((event) => event.kind === 'dialog-action')?.detail?.primary).toBe(true);
  expect(snapshot.lastSemanticState.statusText).toBe('撤单已完成');
  await destroyLivePerformanceProbe(page);
});

test('user retains evidence of a final long host task in the completed capture', async ({ page }) => {
  // Given a real 80 ms host stall is attached to the cancellation click.
  await openUserscriptScenario(page, createCancelScenario());
  await installLivePerformanceProbe(page);
  await armLivePerformanceProbe(page, 'cancel-current-symbol-no-orders-long-task');
  await page.locator('[data-ladder-cancel-symbol="true"]').evaluate((button) => {
    button.addEventListener('click', () => {
      const deadline = performance.now() + 80;
      while (performance.now() < deadline) {
        // Intentional deterministic host stall for performance-observer coverage.
      }
    }, { once: true });
  });

  await prepareLivePerformanceProbeCompletion(page, 'no-orders');
  // When the user requests cancellation while the real performance observers are active.
  await page.getByRole('button', { name: '撤单' }).click();
  // Then the final long task is included before the observers disconnect.
  const snapshot = await finishLivePerformanceProbeWhenReady(page);

  expect(snapshot.longTasks.some((entry) => entry.duration >= 75)).toBe(true);
  await destroyLivePerformanceProbe(page);
});

test('user cannot rearm a performance sample until prior no-order feedback clears', async ({ page }) => {
  // Given an empty-account sample is armed and completion tracking is prepared.
  await openUserscriptScenario(page, createCancelScenario());
  await installLivePerformanceProbe(page);
  await armLivePerformanceProbe(page, 'cancel-current-symbol-no-orders-first');

  await prepareLivePerformanceProbeCompletion(page, 'no-orders');
  // When the user completes one no-order action and immediately tries to arm another sample.
  await page.getByRole('button', { name: '撤单' }).click();
  await finishLivePerformanceProbeWhenReady(page);
  await expect(page.getByRole('button', { name: '无挂单' })).toBeEnabled();
  // Then rearming fails until the normal cancellation action becomes ready again.
  await expect(page.evaluate(() => (
    window.__BINANCE_LIVE_PERFORMANCE_PROBE__.arm('cancel-current-symbol-no-orders-too-soon')
  ))).rejects.toThrow(/cannot arm before the cancel UI is fully ready/);

  await expect(page.getByRole('button', { name: '撤单' })).toBeEnabled();
  const rearmed = await armLivePerformanceProbe(page, 'cancel-current-symbol-no-orders-second');
  expect(rearmed.startedAtMonotonicMs).toBeNull();
  await destroyLivePerformanceProbe(page);
});

test('user receives serializable evidence for uncaught errors and unhandled rejections', async ({ page }) => {
  // Given a live probe is armed on an empty-account fixture.
  await openUserscriptScenario(page, createCancelScenario());
  await installLivePerformanceProbe(page);
  await armLivePerformanceProbe(page, 'serializable-errors');

  // When the user requests cancellation and the host emits an error and an unhandled rejection.
  await page.getByRole('button', { name: '撤单' }).click();
  await page.evaluate(() => {
    window.dispatchEvent(new ErrorEvent('error', { message: 'probe test error' }));
    const rejection = new Event('unhandledrejection');
    Object.defineProperty(rejection, 'reason', { value: new Error('probe test rejection') });
    window.dispatchEvent(rejection);
  });
  // Then both error kinds retain their messages in a serializable capture.
  const snapshot = await finishLivePerformanceProbe(page);
  expect(snapshot.errors).toEqual([
    expect.objectContaining({ type: 'error', message: 'probe test error' }),
    expect.objectContaining({ type: 'unhandledrejection', message: 'Error: probe test rejection' }),
  ]);
  expect(() => JSON.stringify(snapshot)).not.toThrow();
  await destroyLivePerformanceProbe(page);
});

test('user receives feedback evidence after the host replaces an armed panel', async ({ page }) => {
  // Given a custom cancellation panel has an armed live performance probe.
  await openUserscriptScenario(page, createCancelScenario());
  await page.evaluate(() => {
    const panel = document.createElement('section');
    panel.id = 'probe-panel';
    panel.innerHTML = '<button data-probe-cancel="true">Probe cancel</button><p id="probe-status">Idle</p>';
    document.body.append(panel);
  });
  await installLivePerformanceProbe(page, {
    panelSelector: '#probe-panel',
    cancelButtonSelector: '[data-probe-cancel="true"]',
    readyCancelButtonText: 'Probe cancel',
    statusSelector: '#probe-status',
  });
  await armLivePerformanceProbe(page, 'replaced-panel-before-click');
  // When the host replaces the panel and the user clicks its new cancellation button.
  await page.evaluate(() => {
    const oldPanel = document.querySelector('#probe-panel');
    const newPanel = oldPanel.cloneNode(true);
    oldPanel.replaceWith(newPanel);
    const cancelButton = newPanel.querySelector('[data-probe-cancel="true"]');
    cancelButton.addEventListener('click', () => {
      cancelButton.disabled = true;
      cancelButton.textContent = 'Probe processing';
    });
  });

  await page.getByRole('button', { name: 'Probe cancel' }).click();
  // Then the probe reacquires the replacement and records first feedback.
  await expect(page.getByRole('button', { name: 'Probe processing' })).toBeDisabled();
  const snapshot = await finishLivePerformanceProbe(page);
  expect(() => validateLivePerformanceProbeSnapshot(snapshot)).not.toThrow();
  expect(snapshot.events.map((event) => event.kind)).toContain('first-feedback');
  await destroyLivePerformanceProbe(page);
});

test('user receives an explicit overflow failure from a directly injected performance probe', async ({ page }) => {
  // Given a raw evaluation installs a live probe with a one-event limit.
  await openUserscriptScenario(page, createCancelScenario());
  await page.evaluate(createLivePerformanceProbeExpression({ eventLimit: 1 }));
  await page.evaluate(() => window.__BINANCE_LIVE_PERFORMANCE_PROBE__.arm('overflow'));

  // When the user requests cancellation and generates more events than the declared limit.
  await page.getByRole('button', { name: '撤单' }).click();
  // Then the capture reports discarded events and fails strict validation.
  await expect(page.getByRole('button', { name: '撤单' })).toBeEnabled();
  const snapshot = await page.evaluate(() => window.__BINANCE_LIVE_PERFORMANCE_PROBE__.finish());
  expect(snapshot.dropped.events).toBeGreaterThan(0);
  expect(() => validateLivePerformanceProbeSnapshot(snapshot)).toThrow(/events overflowed/);
  await destroyLivePerformanceProbe(page);
});
