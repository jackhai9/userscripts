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
  installLivePerformanceProbe,
  validateLivePerformanceProbeSnapshot,
} from '../helpers/live-performance-probe.js';

test('live probe captures a no-order run and destroys every listener', async ({ page }) => {
  await openUserscriptScenario(page, createCancelScenario());
  await installLivePerformanceProbe(page);
  const firstArm = await armLivePerformanceProbe(page, 'cancel-current-symbol-no-orders');
  const secondArm = await armLivePerformanceProbe(page, 'cancel-current-symbol-no-orders');
  expect(secondArm.sessionId).toBe(firstArm.sessionId);

  await page.getByRole('button', { name: '撤单' }).click();
  await expect(page.getByRole('button', { name: '撤单' })).toBeEnabled();
  const snapshot = await finishLivePerformanceProbe(page);
  expect(() => validateLivePerformanceProbeSnapshot(snapshot)).not.toThrow();
  expect(snapshot.events.map((event) => event.kind)).toContain('first-feedback');

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

  await page.getByRole('button', { name: '撤单' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.waitForTimeout(1_000);
  const waiting = await page.evaluate(() => window.__BINANCE_LIVE_PERFORMANCE_PROBE__.snapshot());
  expect(waiting.finishedAtMonotonicMs).toBeNull();
  expect(waiting.events.map((event) => event.kind)).toContain('dialog-visible');

  await page.getByRole('button', { name: '取消' }).click();
  await expect(page.getByText('HYPEUSDT 已取消撤单，已恢复页面状态')).toBeVisible();
  const snapshot = await finishLivePerformanceProbe(page);
  expect(() => validateLivePerformanceProbeSnapshot(snapshot)).not.toThrow();
  expect(snapshot.events.map((event) => event.kind)).toEqual(expect.arrayContaining([
    'dialog-visible',
    'dialog-action',
    'dialog-hidden',
  ]));
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
    panel.innerHTML = '<button data-probe-cancel="true">Probe cancel</button><p>Idle</p>';
    document.body.append(panel);
  });
  await installLivePerformanceProbe(page, {
    panelSelector: '#probe-panel',
    cancelButtonSelector: '[data-probe-cancel="true"]',
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
