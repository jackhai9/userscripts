import { test, expect } from '../test.js';

import {
  ORDER_SETS,
  POSITION_SETS,
  createCancelScenario,
} from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario } from '../helpers/userscript-page.js';
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

test('live probe captures a no-order run and destroys every listener', async ({ page }) => {
  await openUserscriptScenario(page, createCancelScenario());
  await installLivePerformanceProbe(page);
  const firstArm = await armLivePerformanceProbe(page, 'cancel-current-symbol-no-orders');
  const secondArm = await armLivePerformanceProbe(page, 'cancel-current-symbol-no-orders');
  expect(secondArm.sessionId).toBe(firstArm.sessionId);

  await prepareLivePerformanceProbeCompletion(page, 'no-orders');
  await page.getByRole('button', { name: '撤单' }).click();
  const snapshot = await finishLivePerformanceProbeWhenReady(page);
  await expect(page.getByRole('button', { name: '无挂单' })).toBeEnabled();
  expect(() => validateLivePerformanceProbeSnapshot(snapshot)).not.toThrow();
  expect(snapshot.events.map((event) => event.kind)).toContain('first-feedback');
  const firstFeedback = snapshot.events.find((event) => event.kind === 'first-feedback');
  expect(snapshot.finishedAtMonotonicMs - snapshot.startedAtMonotonicMs - firstFeedback.atMs)
    .toBeLessThan(50);
  expect(snapshot.lastSemanticState.statusText).toBe('HYPEUSDT 当前币无挂单');

  const finishedEventCount = snapshot.events.length;
  await page.evaluate(() => {
    const panel = document.querySelector('#jh-binance-close-qty-multiplier-panel');
    panel?.setAttribute('data-after-finish', 'ignored');
  });
  await page.waitForTimeout(20);
  const frozen = await page.evaluate(() => window.__BINANCE_LIVE_PERFORMANCE_PROBE__.snapshot());
  expect(frozen.events).toHaveLength(finishedEventCount);

  const beforeDestroy = snapshot.events.length;
  await destroyLivePerformanceProbe(page);
  await page.getByRole('button', { name: '撤单' }).click();
  expect(await page.evaluate(() => window.__BINANCE_LIVE_PERFORMANCE_PROBE__)).toBeUndefined();
  expect(snapshot.events).toHaveLength(beforeDestroy);
});

test('live probe has no user-decision deadline and follows a replaced portal dialog', async ({ page }) => {
  const scenario = createCancelScenario({
    positions: POSITION_SETS.current,
    orders: ORDER_SETS.current,
    host: { dialogReplacementDelayMs: 20 },
  });
  await openUserscriptScenario(page, scenario);
  await installLivePerformanceProbe(page);
  await armLivePerformanceProbe(page, 'cancel-dialog-cancel');

  await prepareLivePerformanceProbeCompletion(page, 'dialog-cancel');
  await page.getByRole('button', { name: '撤单' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.waitForTimeout(1_000);
  const waiting = await page.evaluate(() => window.__BINANCE_LIVE_PERFORMANCE_PROBE__.snapshot());
  expect(waiting.finishedAtMonotonicMs).toBeNull();
  expect(waiting.events.map((event) => event.kind)).toContain('dialog-visible');

  await page.getByRole('button', { name: '取消' }).evaluate((button) => {
    button.parentElement.classList.add('bn-modal-footer');
  });

  await page.getByRole('button', { name: '取消' }).click();
  const snapshot = await finishLivePerformanceProbeWhenReady(page);
  await expect(page.getByText('HYPEUSDT 已取消撤单，已恢复页面状态')).toBeVisible();
  expect(() => validateLivePerformanceProbeSnapshot(snapshot)).not.toThrow();
  expect(snapshot.events.map((event) => event.kind)).toEqual(expect.arrayContaining([
    'dialog-visible',
    'dialog-action',
    'dialog-hidden',
  ]));
  await destroyLivePerformanceProbe(page);
});

test('live completion waits for confirmed cancellation cleanup', async ({ page }) => {
  const scenario = createCancelScenario({
    positions: POSITION_SETS.current,
    orders: ORDER_SETS.current,
  });
  await openUserscriptScenario(page, scenario);
  await installLivePerformanceProbe(page);
  await armLivePerformanceProbe(page, 'cancel-dialog-confirm');

  await prepareLivePerformanceProbeCompletion(page, 'dialog-confirm');
  await page.getByRole('button', { name: '撤单' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '确认' }).click();
  const snapshot = await finishLivePerformanceProbeWhenReady(page);

  expect(() => validateLivePerformanceProbeSnapshot(snapshot)).not.toThrow();
  expect(snapshot.events.find((event) => event.kind === 'dialog-action')?.detail?.primary).toBe(true);
  expect(snapshot.lastSemanticState.statusText).toBe('HYPEUSDT 撤单流程结束，已恢复筛选状态');
  await destroyLivePerformanceProbe(page);
});

test('live completion flushes the final long task before disconnecting observers', async ({ page }) => {
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
  await page.getByRole('button', { name: '撤单' }).click();
  const snapshot = await finishLivePerformanceProbeWhenReady(page);

  expect(snapshot.longTasks.some((entry) => entry.duration >= 75)).toBe(true);
  await destroyLivePerformanceProbe(page);
});

test('live probe rejects a sample while prior no-order feedback is still visible', async ({ page }) => {
  await openUserscriptScenario(page, createCancelScenario());
  await installLivePerformanceProbe(page);
  await armLivePerformanceProbe(page, 'cancel-current-symbol-no-orders-first');

  await prepareLivePerformanceProbeCompletion(page, 'no-orders');
  await page.getByRole('button', { name: '撤单' }).click();
  await finishLivePerformanceProbeWhenReady(page);
  await expect(page.getByRole('button', { name: '无挂单' })).toBeEnabled();
  await expect(page.evaluate(() => (
    window.__BINANCE_LIVE_PERFORMANCE_PROBE__.arm('cancel-current-symbol-no-orders-too-soon')
  ))).rejects.toThrow(/cannot arm before the cancel UI is fully ready/);

  await expect(page.getByRole('button', { name: '撤单' })).toBeEnabled();
  const rearmed = await armLivePerformanceProbe(page, 'cancel-current-symbol-no-orders-second');
  expect(rearmed.startedAtMonotonicMs).toBeNull();
  await destroyLivePerformanceProbe(page);
});

test('live probe serializes uncaught errors and unhandled rejections', async ({ page }) => {
  await openUserscriptScenario(page, createCancelScenario());
  await installLivePerformanceProbe(page);
  await armLivePerformanceProbe(page, 'serializable-errors');

  await page.getByRole('button', { name: '撤单' }).click();
  await page.evaluate(() => {
    window.dispatchEvent(new ErrorEvent('error', { message: 'probe test error' }));
    const rejection = new Event('unhandledrejection');
    Object.defineProperty(rejection, 'reason', { value: new Error('probe test rejection') });
    window.dispatchEvent(rejection);
  });
  const snapshot = await finishLivePerformanceProbe(page);
  expect(snapshot.errors).toEqual([
    expect.objectContaining({ type: 'error', message: 'probe test error' }),
    expect.objectContaining({ type: 'unhandledrejection', message: 'Error: probe test rejection' }),
  ]);
  expect(() => JSON.stringify(snapshot)).not.toThrow();
  await destroyLivePerformanceProbe(page);
});

test('live probe follows a userscript panel replaced after arm and before click', async ({ page }) => {
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
  await expect(page.getByRole('button', { name: 'Probe processing' })).toBeDisabled();
  const snapshot = await finishLivePerformanceProbe(page);
  expect(() => validateLivePerformanceProbeSnapshot(snapshot)).not.toThrow();
  expect(snapshot.events.map((event) => event.kind)).toContain('first-feedback');
  await destroyLivePerformanceProbe(page);
});

test('live probe reports overflow and supports raw Runtime.evaluate injection', async ({ page }) => {
  await openUserscriptScenario(page, createCancelScenario());
  await page.evaluate(createLivePerformanceProbeExpression({ eventLimit: 1 }));
  await page.evaluate(() => window.__BINANCE_LIVE_PERFORMANCE_PROBE__.arm('overflow'));

  await page.getByRole('button', { name: '撤单' }).click();
  await expect(page.getByRole('button', { name: '撤单' })).toBeEnabled();
  const snapshot = await page.evaluate(() => window.__BINANCE_LIVE_PERFORMANCE_PROBE__.finish());
  expect(snapshot.dropped.events).toBeGreaterThan(0);
  expect(() => validateLivePerformanceProbeSnapshot(snapshot)).toThrow(/events overflowed/);
  await destroyLivePerformanceProbe(page);
});
