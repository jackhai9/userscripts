import { test, expect } from '../test.js';

import {
  CURRENT_SYMBOL,
  OTHER_SYMBOL,
  createCancelScenario,
} from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario, readFixtureState } from '../helpers/userscript-page.js';

const PANEL_SELECTOR = '#jh-binance-close-qty-multiplier-panel';
const NATIVE_ROOT_SELECTOR = '#futuresOrderbook .orderbook-tickSize';

async function expectPrecisionOptions(page, options, current) {
  const panel = page.locator(PANEL_SELECTOR);
  await expect.poll(() => panel.locator('[data-orderbook-precision-value]').evaluateAll((nodes) => (
    nodes.map((node) => node.getAttribute('data-orderbook-precision-value'))
  )), { timeout: 8_000 }).toEqual(options);
  await expect(panel.locator('[data-orderbook-precision-value="' + current + '"]'))
    .toHaveAttribute('aria-pressed', 'true');
  await expect(panel.locator('[data-orderbook-precision-value]').first()).toBeEnabled();
}

test('user sees every native precision shortcut without an automatic precision selection', async ({ page }) => {
  // Given the native precision menu contains three micro-price options and starts at the smallest.
  const options = ['0.000001', '0.00001', '0.0001'];
  // When the user opens the generated panel with its native dropdown closed.
  const { errors } = await openUserscriptScenario(page, createCancelScenario({
    ui: { orderbookPrecision: options[0] },
    host: { precisionOptions: options },
  }));

  // Then bootstrap reads and closes the owned menu without selecting any option.
  await expectPrecisionOptions(page, options, options[0]);
  await expect(page.locator(NATIVE_ROOT_SELECTOR + ' .tick-content')).toHaveText(options[0]);
  await expect(page.locator(NATIVE_ROOT_SELECTOR + ' [aria-controls]')).toHaveCount(0);
  await expect(page.locator(NATIVE_ROOT_SELECTOR + ' .bn-select.active')).toHaveCount(0);
  await expect(page.locator('.bn-select-bubble')).toHaveCount(0);
  const state = await readFixtureState(page);
  expect(state.orderbookPrecision).toBe(options[0]);
  expect(state.events.filter((event) => event.type.startsWith('precision-')).map((event) => event.type))
    .toEqual(['precision-overlay-opened', 'precision-overlay-closed']);
  expect(errors).toEqual([]);
});

test('user changes precision through the native portal and sees matching panel shortcuts', async ({ page }) => {
  // Given the generated shortcuts match the current native precision options.
  const scenario = createCancelScenario();
  const { errors } = await openUserscriptScenario(page, scenario);
  await expectPrecisionOptions(page, scenario.host.precisionOptions, scenario.ui.orderbookPrecision);

  // When the user opens the native portal and selects 0.001.
  await page.locator(NATIVE_ROOT_SELECTOR + ' .bn-select-trigger').click();
  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible();
  await expect(page.locator('body > .bn-select-bubble.active')).toBeVisible();
  await expect(page.locator(NATIVE_ROOT_SELECTOR + ' [role="listbox"]')).toHaveCount(0);
  await listbox.getByRole('option', { name: '0.001', exact: true }).click();

  // Then the exact selection updates the native field and panel once and closes its portal.
  await expectPrecisionOptions(page, scenario.host.precisionOptions, '0.001');
  await expect(page.locator(NATIVE_ROOT_SELECTOR + ' .tick-content')).toHaveText('0.001');
  await expect(listbox).toHaveCount(0);
  expect((await readFixtureState(page)).events.filter((event) => event.type === 'precision-selected'))
    .toEqual([expect.objectContaining({ symbol: CURRENT_SYMBOL, value: '0.001' })]);
  expect(errors).toEqual([]);
});

for (const scope of ['select', 'root']) {
  test(`user uses precision shortcuts after replacing the native ${scope} for the same symbol`, async ({ page }) => {
    // Given the current symbol has a ready native Select and its original node identities are captured.
    const scenario = createCancelScenario();
    const { errors } = await openUserscriptScenario(page, scenario);
    await expectPrecisionOptions(page, scenario.host.precisionOptions, scenario.ui.orderbookPrecision);
    const previousRoot = await page.locator(NATIVE_ROOT_SELECTOR).elementHandle();
    const previousSelect = await page.locator(NATIVE_ROOT_SELECTOR + ' .bn-select').elementHandle();
    // When the host replaces the specified native control and the user selects 0.01.
    const replacement = await page.evaluate((input) => (
      window.__BINANCE_FIXTURE__.replacePrecisionControl(input)
    ), {
      scope,
      symbol: CURRENT_SYMBOL,
      value: scenario.ui.orderbookPrecision,
      options: scenario.host.precisionOptions,
    });

    // Then the shortcut uses the new owned listbox and never selects from the detached control.
    expect(await previousRoot.evaluate((node) => node.isConnected)).toBe(scope === 'select');
    expect(await previousSelect.evaluate((node) => node.isConnected)).toBe(false);
    expect(replacement.listboxId).not.toBe(replacement.previousListboxId);

    // When the user applies the precision shortcut against the replacement control.
    await page.locator(PANEL_SELECTOR + ' [data-orderbook-precision-value="0.01"]').click();

    // Then the native selection comes from the replacement's exact owned listbox.
    await expectPrecisionOptions(page, scenario.host.precisionOptions, '0.01');
    await expect(page.locator(NATIVE_ROOT_SELECTOR + ' .tick-content')).toHaveText('0.01');
    await expect(page.locator('.bn-select-bubble')).toHaveCount(0);
    expect((await readFixtureState(page)).events.filter((event) => event.type === 'precision-selected'))
      .toEqual([expect.objectContaining({
        symbol: CURRENT_SYMBOL,
        value: '0.01',
        listboxId: replacement.listboxId,
      })]);
    expect(errors).toEqual([]);
  });
}

test('user restores symbol-specific precision shortcuts after switching from A to B and back', async ({ page }) => {
  // Given the first symbol has its own native options and the second symbol uses whole-number options.
  const scenario = createCancelScenario();
  const { errors } = await openUserscriptScenario(page, scenario);
  await expectPrecisionOptions(page, scenario.host.precisionOptions, scenario.ui.orderbookPrecision);
  const otherOptions = ['1', '10', '100', '1000'];
  // When the user switches to the other symbol and later returns to the original symbol.
  await page.evaluate((input) => window.__BINANCE_FIXTURE__.replacePrecisionControl(input), {
    scope: 'root',
    symbol: OTHER_SYMBOL,
    value: '10',
    options: otherOptions,
  });

  // Then each selection belongs to that symbol and current native portal without submitting or cancelling orders.
  await expect(page).toHaveURL('https://www.binance.com/zh-CN/futures/' + OTHER_SYMBOL);
  await expectPrecisionOptions(page, otherOptions, '10');

  // When the user selects the other symbol's whole-number precision.
  await page.locator(PANEL_SELECTOR + ' [data-orderbook-precision-value="100"]').click();

  // Then that symbol's native field and numeric shortcuts both select 100.
  await expectPrecisionOptions(page, otherOptions, '100');
  await expect(page.locator(NATIVE_ROOT_SELECTOR + ' .tick-content')).toHaveText('100');

  // When the user returns to the original symbol with its remembered native precision.
  await page.evaluate((input) => window.__BINANCE_FIXTURE__.replacePrecisionControl(input), {
    scope: 'root',
    symbol: CURRENT_SYMBOL,
    value: scenario.ui.orderbookPrecision,
    options: scenario.host.precisionOptions,
  });

  // Then the original symbol's options and selected precision are restored.
  await expect(page).toHaveURL('https://www.binance.com/zh-CN/futures/' + CURRENT_SYMBOL);
  await expectPrecisionOptions(page, scenario.host.precisionOptions, scenario.ui.orderbookPrecision);

  // When the user chooses 0.01 from the original symbol's restored shortcuts.
  await page.locator(PANEL_SELECTOR + ' [data-orderbook-precision-value="0.01"]').click();

  // Then the two selections remain attached to their own symbols without financial actions.
  await expectPrecisionOptions(page, scenario.host.precisionOptions, '0.01');
  await expect(page.locator(NATIVE_ROOT_SELECTOR + ' .tick-content')).toHaveText('0.01');
  await expect(page.locator('.bn-select-bubble')).toHaveCount(0);
  const state = await readFixtureState(page);
  expect(state.events.filter((event) => event.type === 'precision-selected').map(({ symbol, value }) => (
    { symbol, value }
  ))).toEqual([
    { symbol: OTHER_SYMBOL, value: '100' },
    { symbol: CURRENT_SYMBOL, value: '0.01' },
  ]);
  expect(state.events.filter((event) => ['order-submitted', 'cancel-requested'].includes(event.type)))
    .toEqual([]);
  expect(errors).toEqual([]);
});
