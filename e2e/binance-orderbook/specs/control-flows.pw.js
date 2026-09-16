import { test, expect } from '../test.js';

import {
  CURRENT_SYMBOL,
  POSITION_SETS,
  createCancelScenario,
} from '../scenarios/cancel-current-symbol.js';
import {
  openUserscriptScenario,
  readFixtureState,
} from '../helpers/userscript-page.js';
import { installScenarioClock, pauseScenarioClock } from '../helpers/scenario-clock.js';
import {
  assertResponsiveInteraction,
  finishInteractionProbe,
  installInteractionProbe,
} from '../helpers/interaction-probe.js';

const PANEL_SELECTOR = '#jh-binance-close-qty-multiplier-panel';

async function readRect(locator) {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error('Expected a visible control rectangle');
  return rect;
}

async function expectStandardDisabledStyle(locator) {
  await expect(locator).toHaveCSS('background-color', 'rgb(245, 245, 245)');
  await expect(locator).toHaveCSS('border-color', 'rgb(213, 217, 226)');
  await expect(locator).toHaveCSS('color', 'rgb(183, 189, 198)');
  await expect(locator).toHaveCSS('opacity', '0.65');
  await expect(locator).toHaveCSS('cursor', 'not-allowed');
}

test('user increases the quantity multiplier with local feedback and unchanged operation status', async ({ page }) => {
  // Given the open panel has multiplier 1 and a stable operation status.
  const scenario = createCancelScenario({
    ui: { tradeMode: 'OPEN', orderbookPrecision: '0.1' },
  });
  const { errors } = await openUserscriptScenario(page, scenario);
  const panel = page.locator(PANEL_SELECTOR);
  const status = panel.locator('#jh-binance-ladder-status');
  const statusBefore = await status.textContent();
  const input = panel.locator('#jh-binance-close-qty-multiplier-input');
  const increment = panel.locator('#jh-binance-close-qty-multiplier-inc');

  await expect(input).toHaveValue('1');
  await increment.evaluate((button) => {
    const events = [];
    // The 140 ms feedback can end before Playwright's click round trip returns.
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        events.push({
          feedback: button.getAttribute(mutation.attributeName),
          backgroundColor: getComputedStyle(button).backgroundColor,
          sameButton: document.getElementById(button.id) === button,
          connected: button.isConnected,
          multiplier: document.getElementById('jh-binance-close-qty-multiplier-input').value,
          status: document.getElementById('jh-binance-ladder-status').textContent,
        });
      }
    });
    observer.observe(button, {
      attributes: true,
      attributeFilter: ['data-jh-press-feedback'],
    });
    window.__MULTIPLIER_FEEDBACK_PROBE__ = { events, observer };
  });
  // When the user presses the increment control.
  try {
    await increment.click();
    // Then the same button flashes once, the multiplier becomes 2, and the operation status stays unchanged.
    await expect.poll(() => page.evaluate(() => window.__MULTIPLIER_FEEDBACK_PROBE__.events), {
      timeout: 1_000,
    }).toEqual([
      {
        feedback: 'true',
        backgroundColor: 'rgb(245, 245, 245)',
        sameButton: true,
        connected: true,
        multiplier: '2',
        status: statusBefore,
      },
      {
        feedback: null,
        backgroundColor: 'rgb(255, 255, 255)',
        sameButton: true,
        connected: true,
        multiplier: '2',
        status: statusBefore,
      },
    ]);
    await expect(input).toHaveValue('2');
    await expect(status).toHaveText(statusBefore);
    await expect(increment).not.toHaveAttribute('data-jh-press-feedback', 'true');
  } finally {
    await page.evaluate(() => {
      window.__MULTIPLIER_FEEDBACK_PROBE__.observer.disconnect();
      delete window.__MULTIPLIER_FEEDBACK_PROBE__;
    });
  }
  expect(errors).toEqual([]);
});

test('user sees one order remain pending until its matching Binance response succeeds', async ({ page }) => {
  // Given a single-order response is held independently of the page clock.
  const scenario = createCancelScenario({
    ui: { tradeMode: 'OPEN', orderbookPrecision: '0.1' },
    host: { submitApiResponses: [{ outcome: 'success', delivery: 'manual' }] },
  });
  const { errors, pendingSubmitSequences, releaseSubmitResponse } = await openUserscriptScenario(page, scenario);
  const panel = page.locator(PANEL_SELECTOR);
  const status = panel.locator('#jh-binance-ladder-status');
  const ladderGroup = panel.locator('[data-panel-group="ladder"]');

  await expect(ladderGroup.locator('#jh-binance-ladder-status')).toHaveCount(0);
  // When the user selects a bid price to submit one order.
  await page.locator('#futuresOrderbook .bid-light.emit-price').first().click();
  // Then confirmation stays pending with no success toast until that exact response is released.
  await expect(status).toContainText('单击开多确认中');
  expect(pendingSubmitSequences()).toEqual([1]);
  expect((await readFixtureState(page)).events.filter(({ type }) => type === 'order-submit-api-success'))
    .toEqual([]);
  await expect(page.getByRole('alert')).toHaveCount(0);

  // When the held response for that exact order succeeds.
  await releaseSubmitResponse(1);

  // Then one acknowledged submission is shown without issuing another request.
  await expect(status).toContainText('单击开多已提交', { timeout: 3_000 });

  const events = (await readFixtureState(page)).events;
  expect(events.filter((event) => event.type === 'order-submitted')).toHaveLength(1);
  expect(events.filter((event) => event.type === 'order-submit-api-success')).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('user switches between native open and close modes without moving the direction controls', async ({ page }) => {
  // Given the current symbol has only a long position and the panel starts in open mode.
  const scenario = createCancelScenario({
    positions: POSITION_SETS.current,
    ui: { tradeMode: 'OPEN' },
  });
  const { errors } = await openUserscriptScenario(page, scenario);
  const panel = page.locator(PANEL_SELECTOR);
  const status = panel.locator('#jh-binance-ladder-status');
  const statusBefore = await status.textContent();
  const directionGroup = panel.locator('[data-panel-group="direction"]');
  const initialRect = await readRect(directionGroup);

  await expect(panel.getByRole('radio', { name: '开多' })).toBeEnabled();
  await expect(panel.getByRole('radio', { name: '开空' })).toBeEnabled();
  await expect(status).toHaveText(statusBefore);
  await installInteractionProbe(page, '#position-direction [data-trade-mode="CLOSE"]');
  // When the user selects the native close tab.
  await page.locator('#position-direction [data-trade-mode="CLOSE"]').click();
  // Then only closing the long position is available and the controls retain their geometry and status.
  await expect(panel.getByRole('radio', { name: '平多' })).toBeEnabled();
  await expect(panel.getByRole('radio', { name: '平空' })).toBeDisabled();
  await expect(panel.getByRole('button', { name: '阶梯平多' })).toBeEnabled();
  await expect(panel.getByRole('button', { name: '阶梯平空' })).toBeDisabled();
  await expect(page.locator('.order-entry').getByRole('button', { name: '平多' })).toBeEnabled();
  await expect(page.locator('.order-entry').getByRole('button', { name: '平空' })).toBeDisabled();
  await expect(status).toHaveText(statusBefore);
  const closeProbe = await finishInteractionProbe(page);
  assertResponsiveInteraction(expect, closeProbe);
  expect(await readRect(directionGroup)).toEqual(initialRect);

  // When the user switches back to the native open tab.
  await page.locator('#position-direction [data-trade-mode="OPEN"]').click();

  // Then both open directions return in the same position with unchanged status.
  await expect(panel.getByRole('radio', { name: '开多' })).toBeEnabled();
  await expect(panel.getByRole('radio', { name: '开空' })).toBeEnabled();
  await expect(status).toHaveText(statusBefore);
  expect(await readRect(directionGroup)).toEqual(initialRect);

  const state = await readFixtureState(page);
  expect(state.tradeMode).toBe('OPEN');
  expect(state.events.filter((event) => event.type === 'trade-mode').map((event) => event.value)).toEqual([
    'CLOSE',
    'OPEN',
  ]);
  expect(errors).toEqual([]);
});

test('user selects one precision shortcut and updates exactly one native option', async ({ page }) => {
  // Given the current native precision is 0.1 and a closed 0.01 shortcut is available.
  const scenario = createCancelScenario({
    ui: { orderbookPrecision: '0.1' },
  });
  const { errors } = await openUserscriptScenario(page, scenario);
  const panel = page.locator(PANEL_SELECTOR);
  const status = panel.locator('#jh-binance-ladder-status');
  const statusBefore = await status.textContent();
  const precisionGroup = panel.locator('[data-panel-group="precision"]');
  const initialRect = await readRect(precisionGroup);
  const target = panel.locator('[data-orderbook-precision-value="0.01"]');

  await expect(target).toBeVisible({ timeout: 4_000 });
  await expect(target).toBeEnabled({ timeout: 8_000 });
  const selectionsBefore = (await readFixtureState(page)).events
    .filter((event) => event.type === 'precision-selected').length;
  await installInteractionProbe(page, '[data-orderbook-precision-value="0.01"]');
  // When the user selects the 0.01 shortcut.
  await target.click();
  // Then the native precision becomes 0.01 once without moving the panel or changing operation status.
  await expect(target).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#futuresOrderbook .tick-content')).toHaveText('0.01');
  await expect(page.locator('.bn-select-bubble')).toHaveCount(0);
  await expect(status).toHaveText(statusBefore);
  const probe = await finishInteractionProbe(page);
  assertResponsiveInteraction(expect, probe);
  expect(await readRect(precisionGroup)).toEqual(initialRect);

  const state = await readFixtureState(page);
  expect(state.orderbookPrecision).toBe('0.01');
  expect(state.events.filter((event) => event.type === 'precision-selected').slice(selectionsBefore)).toEqual([
    expect.objectContaining({ value: '0.01' }),
  ]);
  expect(errors).toEqual([]);
});

test('user refreshes precision recommendations from the currently visible trades', async ({ page }) => {
  // Given visible trades contain repeated 0.01 movements and refresh is enabled.
  const scenario = createCancelScenario({
    ui: { orderbookPrecision: '0.1' },
  });
  const { errors } = await openUserscriptScenario(page, scenario);
  const panel = page.locator(PANEL_SELECTOR);
  const refresh = panel.locator('[data-orderbook-precision-refresh]');

  await expect(refresh).toBeEnabled({ timeout: 8_000 });
  await installInteractionProbe(page, '[data-orderbook-precision-refresh]');
  // When the user refreshes the precision recommendation.
  await refresh.click();
  // Then the recommendation updates promptly, saves the visible moves, and returns to idle.
  await expect(refresh).toBeEnabled();
  await expect(refresh).toHaveAttribute('data-orderbook-precision-refresh-state', 'success');
  await expect(refresh).toHaveAttribute('aria-label', '精度推荐已更新');
  await expect(panel.locator('[data-orderbook-precision-value="0.01"]'))
    .toHaveAttribute('aria-label', '切换价格精度到 0.01，推荐档位');
  const probe = await finishInteractionProbe(page);
  assertResponsiveInteraction(expect, probe);
  expect(await page.evaluate((symbol) => JSON.parse(
    localStorage.getItem(`jh_binance_orderbook_precision_samples_v3:${symbol}`)
  ), scenario.currentSymbol)).toEqual(['0.01', '0.01', '0.01', '0.01', '0.01']);
  await expect(refresh).toHaveAttribute('data-orderbook-precision-refresh-state', 'idle', { timeout: 2_000 });
  expect(errors).toEqual([]);
});

test('user gets an explicit insufficient-movement result from flat visible trades', async ({ page }) => {
  // Given every visible latest trade has the same price and operation status is stable.
  const scenario = createCancelScenario({
    ui: { orderbookPrecision: '0.1' },
  });
  const { errors } = await openUserscriptScenario(page, scenario);
  const panel = page.locator(PANEL_SELECTOR);
  const status = panel.locator('#jh-binance-ladder-status');
  const statusBefore = await status.textContent();
  await page.locator('.tradew-tradelist .price.emit-price').evaluateAll((nodes) => {
    nodes.forEach((node) => { node.textContent = '81.00'; });
  });

  const refresh = panel.locator('[data-orderbook-precision-refresh]');
  // When the user requests a fresh precision recommendation.
  await refresh.click();
  // Then the panel explains the missing movement and removes the stale recommendation.
  await expect(refresh).toHaveAttribute('data-orderbook-precision-refresh-state', 'retry');
  await expect(refresh).toHaveAttribute('aria-label', '近期价格变化不足，请稍后重试');
  await expect(status).toHaveText(statusBefore);
  await expect(panel.locator('[aria-label*="推荐档位"]')).toHaveCount(0);
  expect(await page.evaluate((symbol) => JSON.parse(
    localStorage.getItem(`jh_binance_orderbook_precision_samples_v3:${symbol}`)
  ), scenario.currentSymbol)).toEqual([]);
  expect(errors).toEqual([]);
});

test('user starts and stops a ladder while action positions and response budgets stay stable', async ({ page }) => {
  // Given both open directions are enabled and their control rectangles are recorded on the real clock.
  const scenario = createCancelScenario({
    ui: { tradeMode: 'OPEN', orderbookPrecision: '0.1' },
  });
  const { errors } = await openUserscriptScenario(page, scenario);
  const panel = page.locator(PANEL_SELECTOR);
  const startLong = panel.getByRole('button', { name: '阶梯开多' });
  const startShort = panel.getByRole('button', { name: '阶梯开空' });
  const cancel = panel.getByRole('button', { name: '撤单' });
  const stop = panel.getByRole('button', { name: '停止开多' });

  await expect(startLong).toBeEnabled();
  await expect(startShort).toBeEnabled();
  await expect(stop).toHaveCount(0);
  const startLongRect = await readRect(startLong);
  const startShortRect = await readRect(startShort);
  const cancelRect = await readRect(cancel);
  await installInteractionProbe(page, '[data-ladder-action="OPEN_LONG"]');
  // When the user starts an open-long ladder.
  await startLong.click();
  // Then the active action becomes Stop in the same slot while the other direction is disabled.
  await expect(startLong).toHaveCount(0);
  await expect(startShort).toBeDisabled();
  await expect(stop).toBeEnabled();
  await expectStandardDisabledStyle(startShort);
  const stopRect = await readRect(stop);
  expect(stopRect).toEqual(startLongRect);
  expect(await readRect(startShort)).toEqual(startShortRect);
  expect(await readRect(cancel)).toEqual(cancelRect);
  const submissionsBeforeStop = (await readFixtureState(page)).events
    .filter((event) => event.type === 'order-submitted').length;

  // When the user stops the active ladder.
  await stop.click();

  // Then the controls return to their original slots within the real-time response budget.
  const status = panel.locator('#jh-binance-ladder-status');
  await expect(status).toContainText('阶梯开多已停止');
  await expect(startLong).toBeEnabled();
  await expect(startShort).toBeEnabled();
  await expect(stop).toHaveCount(0);
  const probe = await finishInteractionProbe(page);
  assertResponsiveInteraction(expect, probe);

  const state = await readFixtureState(page);
  const submissionsAfterStop = state.events
    .filter((event) => event.type === 'order-submitted').length;
  await expect(status).toHaveText(
    `阶梯开多已停止 · 已挂 ${submissionsAfterStop}/5 笔`,
  );
  expect(submissionsAfterStop).toBeLessThanOrEqual(submissionsBeforeStop + 1);
  expect((await readFixtureState(page)).events
    .filter((event) => event.type === 'order-submitted')).toHaveLength(submissionsAfterStop);
  expect(errors).toEqual([]);
});

test('user starts closing a short position while unavailable close-long controls stay disabled', async ({ page }) => {
  // Given the account has only a current-symbol short position.
  const scenario = createCancelScenario({
    positions: [{ symbol: CURRENT_SYMBOL, side: 'SHORT', quantity: '0.1' }],
    ui: { tradeMode: 'CLOSE', orderbookPrecision: '0.1' },
  });
  const { errors } = await openUserscriptScenario(page, scenario);
  const panel = page.locator(PANEL_SELECTOR);
  const closeLong = panel.getByRole('button', { name: '阶梯平多' });
  const closeShort = panel.getByRole('button', { name: '阶梯平空' });

  await expect(closeLong).toBeDisabled();
  await expectStandardDisabledStyle(closeLong);
  await expect(closeShort).toBeEnabled();
  // When the user starts the close-short ladder.
  await closeShort.click();
  // Then the short action becomes Stop and the unavailable long action retains the standard disabled style.
  await expect(panel.getByRole('button', { name: '停止平空' })).toBeEnabled();
  await expect(closeLong).toBeDisabled();
  await expectStandardDisabledStyle(closeLong);
  expect(errors).toEqual([]);
});

test('user starts closing a short position and temporarily disables the available opposite direction', async ({ page }) => {
  // Given both current-symbol position directions can be closed.
  const scenario = createCancelScenario({
    positions: [
      { symbol: CURRENT_SYMBOL, side: 'LONG', quantity: '0.1' },
      { symbol: CURRENT_SYMBOL, side: 'SHORT', quantity: '0.1' },
    ],
    ui: { tradeMode: 'CLOSE', orderbookPrecision: '0.1' },
  });
  const { errors } = await openUserscriptScenario(page, scenario);
  const panel = page.locator(PANEL_SELECTOR);
  const closeLong = panel.getByRole('button', { name: '阶梯平多' });
  const closeShort = panel.getByRole('button', { name: '阶梯平空' });

  await expect(closeLong).toBeEnabled();
  await expect(closeShort).toBeEnabled();
  // When the user starts the close-short ladder.
  await closeShort.click();
  // Then only the short Stop action remains enabled while the long action uses the standard disabled style.
  await expect(panel.getByRole('button', { name: '停止平空' })).toBeEnabled();
  await expect(closeLong).toBeDisabled();
  await expectStandardDisabledStyle(closeLong);
  expect(errors).toEqual([]);
});

test('user completes a five-level open ladder with valid prices and quantities', async ({ page }) => {
  // Given the open-long plan contains five levels and native submissions can succeed.
  test.setTimeout(15_000);
  const scenario = createCancelScenario({
    ui: { tradeMode: 'OPEN', orderbookPrecision: '0.1' },
  });
  const { errors } = await openUserscriptScenario(page, scenario);
  const panel = page.locator(PANEL_SELECTOR);
  const startLong = panel.getByRole('button', { name: '阶梯开多' });
  const stop = panel.getByRole('button', { name: '停止开多' });

  // When the user starts the complete ladder.
  await startLong.click();
  // Then five valid orders are acknowledged, the original controls return, and each next input is written promptly.
  await expect(panel.locator('#jh-binance-ladder-status')).toHaveText('阶梯开多已完成 · 已挂 5/5 笔', {
    timeout: 12_000,
  });
  await expect(startLong).toBeEnabled();
  await expect(stop).toHaveCount(0);

  const submissions = (await readFixtureState(page)).events
    .filter((event) => event.type === 'order-submitted');
  expect(submissions).toHaveLength(5);
  expect(submissions.every((event) => event.action === '开多')).toBe(true);
  expect(submissions.every((event) => Number(event.price) < 81.1)).toBe(true);
  expect(submissions.every((event) => Number(event.quantity) > 0)).toBe(true);
  const events = (await readFixtureState(page)).events;
  for (let index = 0; index < submissions.length - 1; index += 1) {
    const nextInputWrite = events.find(
      (event) => event.type === 'trade-input-written' && event.at > submissions[index].at,
    );
    expect(nextInputWrite.at - submissions[index].at).toBeLessThan(700);
  }
  expect(errors).toEqual([]);
});

test('user keeps the second ladder order pending when the first order toast arrives late', async ({ page }) => {
  // Given the first response succeeds, its toast is delayed, and the second response requires explicit release.
  await installScenarioClock(page);
  const scenario = createCancelScenario({
    ui: { tradeMode: 'OPEN', orderbookPrecision: '0.1' },
    host: {
      submitFeedbackDelayMs: 500,
      submitApiResponses: [
        { outcome: 'success', delivery: 'immediate' },
        { outcome: 'success', delivery: 'manual' },
        ...Array.from({ length: 3 }, () => ({ outcome: 'success', delivery: 'immediate' })),
      ],
    },
  });
  const { errors, pendingSubmitSequences, releaseSubmitResponse } = await openUserscriptScenario(page, scenario);
  const panel = page.locator(PANEL_SELECTOR);

  // When the user starts the ladder and the page advances until the earlier toast arrives.
  await panel.getByRole('button', { name: '阶梯开多' }).click();
  await expect.poll(pendingSubmitSequences).toEqual([2]);
  await pauseScenarioClock(page);
  await page.clock.runFor(500);
  const pending = (await readFixtureState(page)).events;
  // Then only two orders exist and the second remains unacknowledged until its own response is released.
  expect(pending.filter(({ type }) => type === 'order-submitted')).toHaveLength(2);
  expect(pending.filter(({ type }) => type === 'order-submit-feedback'))
    .toEqual([expect.objectContaining({ submitSequence: 1, outcome: 'success' })]);
  expect(pending.filter(({ type }) => type === 'order-submit-api-success')).toHaveLength(1);

  // When the second order's own response is released and the clock resumes.
  await releaseSubmitResponse(2);
  await page.clock.resume();

  // Then all five levels finish only after their own API acknowledgements.
  await expect(panel.locator('#jh-binance-ladder-status')).toHaveText(
    '阶梯开多已完成 · 已挂 5/5 笔',
    { timeout: 12_000 },
  );

  const events = (await readFixtureState(page)).events;
  const submissions = events.filter((event) => event.type === 'order-submitted');
  expect(submissions).toHaveLength(5);
  for (let index = 0; index < submissions.length - 1; index += 1) {
    const acknowledgement = events.find(
      (event) => event.type === 'order-submit-api-success'
        && event.submitSequence === submissions[index].submitSequence,
    );
    expect(acknowledgement.at).toBeLessThan(submissions[index + 1].at);
  }
  expect(errors).toEqual([]);
});

test('user completes a ladder only after each native submit control becomes ready again', async ({ page }) => {
  // Given each native submit stays busy for 450 ms and clears the inputs when it becomes ready.
  const scenario = createCancelScenario({
    ui: { tradeMode: 'OPEN', orderbookPrecision: '0.1' },
    host: {
      submitButtonBusyMs: 450,
      submitButtonBusyAttribute: 'aria-busy',
      submitButtonClearsInputsWhenReady: true,
    },
  });
  const { errors } = await openUserscriptScenario(page, scenario);
  const panel = page.locator(PANEL_SELECTOR);

  // When the user starts the five-level ladder.
  await panel.getByRole('button', { name: '阶梯开多' }).click();
  // Then every submission uses restored nonempty inputs and no click occurs while the native control is busy.
  await expect(panel.locator('#jh-binance-ladder-status')).toHaveText(
    '阶梯开多已完成 · 已挂 5/5 笔',
    { timeout: 12_000 },
  );

  const state = await readFixtureState(page);
  const submissions = state.events.filter((event) => event.type === 'order-submitted');
  expect(submissions).toHaveLength(5);
  expect(submissions.every((event) => Number(event.price) > 0)).toBe(true);
  expect(submissions.every((event) => Number(event.quantity) > 0)).toBe(true);
  expect(state.events.filter((event) => event.type === 'order-submit-while-busy')).toEqual([]);
  for (let index = 1; index < submissions.length; index += 1) {
    expect(submissions[index].at - submissions[index - 1].at).toBeGreaterThanOrEqual(450);
  }
  expect(errors).toEqual([]);
});

test('user opens a flat symbol and its leverage resets independently of positions on other symbols', async ({ page }) => {
  // Given only another symbol has a position and the current symbol starts at 5x.
  const scenario = createCancelScenario({
    positions: POSITION_SETS.other,
    ui: { tradeMode: 'OPEN', leverage: 5 },
  });
  // When the user opens the current-symbol panel.
  const { errors } = await openUserscriptScenario(page, scenario);

  // Then exactly one current-symbol leverage adjustment sets it to 2x.
  await expect.poll(async () => (await readFixtureState(page)).leverage, {
    timeout: 3_000,
  }).toBe(2);
  const adjustments = (await readFixtureState(page)).events
    .filter((event) => event.type === 'leverage-adjusted');
  expect(adjustments).toEqual([
    expect.objectContaining({ symbol: 'HYPEUSDT', leverage: 2 }),
  ]);
  expect(errors).toEqual([]);
});

test('user keeps the existing leverage while holding a current-symbol position', async ({ page }) => {
  // Given the current symbol has a position and starts at 5x.
  await installScenarioClock(page);
  const scenario = createCancelScenario({
    positions: POSITION_SETS.current,
    ui: { tradeMode: 'OPEN', leverage: 5 },
  });
  const { errors } = await openUserscriptScenario(page, scenario);

  // When the page clock advances through five seconds of leverage scheduling.
  await pauseScenarioClock(page);
  await page.clock.runFor(5_000);
  // Then the leverage remains 5x and no adjustment request is made.
  const state = await readFixtureState(page);
  expect(state.leverage).toBe(5);
  expect(state.events.filter((event) => event.type === 'leverage-adjusted')).toEqual([]);
  expect(errors).toEqual([]);
});

test('user stops an active ladder and a late response cannot submit another level', async ({ page }) => {
  // Given the first native submission remains pending and its busy cleanup is scheduled.
  await installScenarioClock(page);
  const scenario = createCancelScenario({
    host: {
      submitButtonBusyMs: 450,
      submitApiResponses: [
        { outcome: 'success', delivery: 'manual' },
        ...Array.from({ length: 4 }, () => ({ outcome: 'success', delivery: 'immediate' })),
      ],
    },
  });
  const { errors, pendingSubmitSequences, releaseSubmitResponse } = await openUserscriptScenario(page, scenario);
  const panel = page.locator(PANEL_SELECTOR);
  await panel.getByRole('button', { name: '阶梯开多', exact: true }).click();
  await expect.poll(pendingSubmitSequences).toEqual([1]);
  await pauseScenarioClock(page);

  // When the user stops the ladder before that response arrives.
  await panel.getByRole('button', { name: '停止开多', exact: true }).click();
  await page.clock.runFor(100);

  // Then the stop is visible and only the original submit has reached the host.
  const status = panel.locator('#jh-binance-ladder-status');
  await expect(status).toContainText('阶梯开多已停止');
  expect((await readFixtureState(page)).events.filter(({ type }) => type === 'order-submitted'))
    .toHaveLength(1);

  // When the pending response succeeds and all former inter-order timers are advanced.
  await releaseSubmitResponse(1);
  await expect.poll(async () => (await readFixtureState(page)).events
    .filter(({ type }) => type === 'order-submit-api-success').length).toBe(1);
  await page.clock.runFor(5_000);

  // Then native readiness and late success cannot restart the stopped ladder.
  await expect(status).toContainText('阶梯开多已停止');
  await expect(panel.getByRole('button', { name: '阶梯开多', exact: true })).toBeEnabled();
  const state = await readFixtureState(page);
  expect(state.events.filter(({ type }) => type === 'submit-button-ready')).toHaveLength(1);
  expect(state.events.filter(({ type }) => type === 'order-submitted')).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('user sees a confirmed order rejection without a fabricated success or automatic resubmit', async ({ page }) => {
  // Given the next native request has one explicit rejection response.
  await installScenarioClock(page);
  const scenario = createCancelScenario({
    host: { submitApiResponses: [{
      outcome: 'rejected', delivery: 'immediate', code: '90800001', message: 'Fixture rejection',
    }] },
  });
  const { errors } = await openUserscriptScenario(page, scenario);

  // When the user submits one order from the orderbook.
  await page.locator('#futuresOrderbook .bid-light.emit-price').first().click();

  // Then the matching rejection is shown and no successful submission is reported.
  const status = page.locator('#jh-binance-ladder-status');
  await expect(status).toContainText('90800001');
  await expect(status).not.toContainText('已提交');
  await expect(page.getByRole('alert')).toHaveText('订单提交失败');

  // When the page clock advances beyond the submit deadline and recovery cooldowns.
  await pauseScenarioClock(page);
  await page.clock.runFor(15_000);

  // Then exactly one request remains rejected and there is no automatic retry.
  const events = (await readFixtureState(page)).events;
  expect(events.filter(({ type }) => type === 'order-submitted')).toHaveLength(1);
  expect(events.filter(({ type }) => type === 'order-submit-api-rejected'))
    .toEqual([expect.objectContaining({ submitSequence: 1, code: '90800001' })]);
  expect(events.filter(({ type }) => type === 'order-submit-api-success')).toEqual([]);
  expect(errors).toEqual([]);
});

test('user ends a single close round on an unknown submission even when a late success arrives', async ({ page }) => {
  // Given a single close round can submit once but its response is held by the network fixture.
  await installScenarioClock(page);
  const scenario = createCancelScenario({
    positions: [{ symbol: CURRENT_SYMBOL, side: 'LONG', quantity: '100' }],
    ui: { tradeMode: 'CLOSE' },
    host: { submitApiResponses: [{ outcome: 'unknown', delivery: 'manual' }] },
  });
  const { errors, pendingSubmitSequences, releaseSubmitResponse } = await openUserscriptScenario(page, scenario);
  const panel = page.locator(PANEL_SELECTOR);
  const status = panel.locator('#jh-binance-ladder-status');

  // When the user starts an ordinary close round and the response deadline has not yet elapsed.
  await panel.getByRole('button', { name: '阶梯平多', exact: true }).click();
  await expect.poll(pendingSubmitSequences).toEqual([1]);
  await pauseScenarioClock(page);
  await page.clock.runFor(11_000);

  // Then the order remains unacknowledged and no further level is submitted.
  await expect(status).not.toContainText('未确认');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect((await readFixtureState(page)).events.filter(({ type }) => type === 'order-submitted'))
    .toHaveLength(1);

  // When the page crosses the twelve-second response deadline.
  await page.clock.runFor(2_000);

  // Then the single round ends with an explicit unknown-outcome message.
  await expect(status).toContainText('未确认');
  await expect(status).toContainText('下单请求仍未返回');
  await expect(panel.getByRole('button', { name: '停止平多', exact: true })).toHaveCount(0);
  const terminalStatus = await status.textContent();

  // When the held response succeeds late and multiple potential recovery windows pass.
  await releaseSubmitResponse(1, { outcome: 'success' });
  await expect.poll(async () => (await readFixtureState(page)).events
    .filter(({ type }) => type === 'order-submit-api-success').length).toBe(1);
  await page.clock.runFor(10_000);

  // Then the terminal result stays visible without cancellation, recovery, or resubmission.
  await expect(status).toHaveText(terminalStatus);
  const events = (await readFixtureState(page)).events;
  expect(events.filter(({ type }) => type === 'order-submitted')).toHaveLength(1);
  expect(events.filter(({ type }) => type.includes('cancel'))).toEqual([]);
  expect(errors).toEqual([]);
});
