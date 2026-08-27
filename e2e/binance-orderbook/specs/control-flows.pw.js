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

test('native open and close tabs drive one stable panel direction selector', async ({ page }) => {
  const scenario = createCancelScenario({
    positions: POSITION_SETS.current,
    ui: { tradeMode: 'OPEN' },
  });
  const { errors } = await openUserscriptScenario(page, scenario);
  const panel = page.locator(PANEL_SELECTOR);
  const directionGroup = panel.locator('[data-panel-group="direction"]');
  const initialRect = await readRect(directionGroup);

  await expect(panel.getByRole('radio', { name: '开多' })).toBeEnabled();
  await expect(panel.getByRole('radio', { name: '开空' })).toBeEnabled();
  await installInteractionProbe(page, '#position-direction [data-trade-mode="CLOSE"]');
  await page.locator('#position-direction [data-trade-mode="CLOSE"]').click();
  await expect(panel.getByRole('radio', { name: '平多' })).toBeEnabled();
  await expect(panel.getByRole('radio', { name: '平空' })).toBeDisabled();
  await expect(panel.getByRole('button', { name: '阶梯平多' })).toBeEnabled();
  await expect(panel.getByRole('button', { name: '阶梯平空' })).toBeDisabled();
  await expect(page.locator('.order-entry').getByRole('button', { name: '平多' })).toBeEnabled();
  await expect(page.locator('.order-entry').getByRole('button', { name: '平空' })).toBeDisabled();
  const closeProbe = await finishInteractionProbe(page);
  assertResponsiveInteraction(expect, closeProbe);
  expect(await readRect(directionGroup)).toEqual(initialRect);

  await page.locator('#position-direction [data-trade-mode="OPEN"]').click();
  await expect(panel.getByRole('radio', { name: '开多' })).toBeEnabled();
  await expect(panel.getByRole('radio', { name: '开空' })).toBeEnabled();
  expect(await readRect(directionGroup)).toEqual(initialRect);

  const state = await readFixtureState(page);
  expect(state.tradeMode).toBe('OPEN');
  expect(state.events.filter((event) => event.type === 'trade-mode').map((event) => event.value)).toEqual([
    'CLOSE',
    'OPEN',
  ]);
  expect(errors).toEqual([]);
});

test('a precision shortcut selects the exact native orderbook option once', async ({ page }) => {
  const scenario = createCancelScenario({
    ui: { orderbookPrecision: '0.1' },
  });
  const { errors } = await openUserscriptScenario(page, scenario);
  const panel = page.locator(PANEL_SELECTOR);
  const precisionGroup = panel.locator('[data-panel-group="precision"]');
  const initialRect = await readRect(precisionGroup);
  const target = panel.locator('[data-orderbook-precision-value="0.01"]');

  await expect(target).toBeVisible({ timeout: 4_000 });
  await expect(target).toBeEnabled({ timeout: 8_000 });
  const selectionsBefore = (await readFixtureState(page)).events
    .filter((event) => event.type === 'precision-selected').length;
  await installInteractionProbe(page, '[data-orderbook-precision-value="0.01"]');
  await target.click();
  await expect(target).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#futuresOrderbook .tick-content')).toHaveText('0.01');
  await expect(page.locator('.ob-ticksize-overlay')).toHaveCount(0);
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

test('precision refresh uses the visible latest trades immediately without a sampling wait', async ({ page }) => {
  const scenario = createCancelScenario({
    ui: { orderbookPrecision: '0.1' },
  });
  const { errors } = await openUserscriptScenario(page, scenario);
  const panel = page.locator(PANEL_SELECTOR);
  const refresh = panel.locator('[data-orderbook-precision-refresh]');

  await expect(refresh).toBeEnabled({ timeout: 8_000 });
  await installInteractionProbe(page, '[data-orderbook-precision-refresh]');
  await refresh.click();
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

test('precision refresh explains when the complete visible trade list still lacks movement', async ({ page }) => {
  const scenario = createCancelScenario({
    ui: { orderbookPrecision: '0.1' },
  });
  const { errors } = await openUserscriptScenario(page, scenario);
  const panel = page.locator(PANEL_SELECTOR);
  await page.locator('.tradew-tradelist .price.emit-price').evaluateAll((nodes) => {
    nodes.forEach((node) => { node.textContent = '81.00'; });
  });

  const refresh = panel.locator('[data-orderbook-precision-refresh]');
  await refresh.click();
  await expect(refresh).toHaveAttribute('data-orderbook-precision-refresh-state', 'retry');
  await expect(refresh).toHaveAttribute('aria-label', '近期价格变化不足，请稍后重试');
  await expect(panel.locator('#jh-binance-ladder-status'))
    .toHaveText('近期价格变化不足，请稍后重试');
  await expect(panel.locator('[aria-label*="推荐档位"]')).toHaveCount(0);
  expect(await page.evaluate((symbol) => JSON.parse(
    localStorage.getItem(`jh_binance_orderbook_precision_samples_v3:${symbol}`)
  ), scenario.currentSymbol)).toEqual([]);
  expect(errors).toEqual([]);
});

test('starting a ladder preserves action slots and turns only the active action into stop', async ({ page }) => {
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
  await startLong.click();
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
  await stop.click();
  await expect(panel.locator('#jh-binance-ladder-status')).toContainText('已停止');
  await expect(startLong).toBeEnabled();
  await expect(startShort).toBeEnabled();
  await expect(stop).toHaveCount(0);
  const probe = await finishInteractionProbe(page);
  assertResponsiveInteraction(expect, probe);

  const state = await readFixtureState(page);
  const submissionsAfterStop = state.events
    .filter((event) => event.type === 'order-submitted').length;
  expect(submissionsAfterStop).toBeLessThanOrEqual(submissionsBeforeStop + 1);
  await page.waitForTimeout(700);
  expect((await readFixtureState(page)).events
    .filter((event) => event.type === 'order-submitted')).toHaveLength(submissionsAfterStop);
  expect(errors).toEqual([]);
});

test('starting close short keeps unavailable close long in the standard disabled style', async ({ page }) => {
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
  await closeShort.click();
  await expect(panel.getByRole('button', { name: '停止平空' })).toBeEnabled();
  await expect(closeLong).toBeDisabled();
  await expectStandardDisabledStyle(closeLong);
  expect(errors).toEqual([]);
});

test('starting close short disables close long with the standard disabled style', async ({ page }) => {
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
  await closeShort.click();
  await expect(panel.getByRole('button', { name: '停止平空' })).toBeEnabled();
  await expect(closeLong).toBeDisabled();
  await expectStandardDisabledStyle(closeLong);
  expect(errors).toEqual([]);
});

test('a complete ladder submits the planned five native orders and restores controls', async ({ page }) => {
  test.setTimeout(15_000);
  const scenario = createCancelScenario({
    ui: { tradeMode: 'OPEN', orderbookPrecision: '0.1' },
  });
  const { errors } = await openUserscriptScenario(page, scenario);
  const panel = page.locator(PANEL_SELECTOR);
  const startLong = panel.getByRole('button', { name: '阶梯开多' });
  const stop = panel.getByRole('button', { name: '停止开多' });

  await startLong.click();
  await expect(panel.locator('#jh-binance-ladder-status')).toContainText('完成 5/5', {
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
  expect(errors).toEqual([]);
});

test('auto leverage resets only a flat current symbol and ignores other-symbol positions', async ({ page }) => {
  const scenario = createCancelScenario({
    positions: POSITION_SETS.other,
    ui: { tradeMode: 'OPEN', leverage: 5 },
  });
  const { errors } = await openUserscriptScenario(page, scenario);

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

test('auto leverage preserves the current leverage while the current symbol has a position', async ({ page }) => {
  const scenario = createCancelScenario({
    positions: POSITION_SETS.current,
    ui: { tradeMode: 'OPEN', leverage: 5 },
  });
  const { errors } = await openUserscriptScenario(page, scenario);

  await page.waitForTimeout(500);
  const state = await readFixtureState(page);
  expect(state.leverage).toBe(5);
  expect(state.events.filter((event) => event.type === 'leverage-adjusted')).toEqual([]);
  expect(errors).toEqual([]);
});
