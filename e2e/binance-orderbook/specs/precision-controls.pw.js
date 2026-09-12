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

test('precision bootstrap shows every native numeric shortcut without selecting an option', async ({ page }) => {
  const options = ['0.000001', '0.00001', '0.0001'];
  const { errors } = await openUserscriptScenario(page, createCancelScenario({
    ui: { orderbookPrecision: options[0] },
    host: { precisionOptions: options },
  }));

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

test('selecting a native precision portal option updates the numeric shortcuts', async ({ page }) => {
  const scenario = createCancelScenario();
  const { errors } = await openUserscriptScenario(page, scenario);
  await expectPrecisionOptions(page, scenario.host.precisionOptions, scenario.ui.orderbookPrecision);

  await page.locator(NATIVE_ROOT_SELECTOR + ' .bn-select-trigger').click();
  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible();
  await expect(page.locator('body > .bn-select-bubble.active')).toBeVisible();
  await expect(page.locator(NATIVE_ROOT_SELECTOR + ' [role="listbox"]')).toHaveCount(0);
  await listbox.getByRole('option', { name: '0.001', exact: true }).click();

  await expectPrecisionOptions(page, scenario.host.precisionOptions, '0.001');
  await expect(page.locator(NATIVE_ROOT_SELECTOR + ' .tick-content')).toHaveText('0.001');
  await expect(listbox).toHaveCount(0);
  expect((await readFixtureState(page)).events.filter((event) => event.type === 'precision-selected'))
    .toEqual([expect.objectContaining({ symbol: CURRENT_SYMBOL, value: '0.001' })]);
  expect(errors).toEqual([]);
});

for (const scope of ['select', 'root']) {
  test('precision shortcuts reacquire a replaced native ' + scope + ' for the same symbol', async ({ page }) => {
    const scenario = createCancelScenario();
    const { errors } = await openUserscriptScenario(page, scenario);
    await expectPrecisionOptions(page, scenario.host.precisionOptions, scenario.ui.orderbookPrecision);
    const previousRoot = await page.locator(NATIVE_ROOT_SELECTOR).elementHandle();
    const previousSelect = await page.locator(NATIVE_ROOT_SELECTOR + ' .bn-select').elementHandle();
    const replacement = await page.evaluate((input) => (
      window.__BINANCE_FIXTURE__.replacePrecisionControl(input)
    ), {
      scope,
      symbol: CURRENT_SYMBOL,
      value: scenario.ui.orderbookPrecision,
      options: scenario.host.precisionOptions,
    });

    expect(await previousRoot.evaluate((node) => node.isConnected)).toBe(scope === 'select');
    expect(await previousSelect.evaluate((node) => node.isConnected)).toBe(false);
    expect(replacement.listboxId).not.toBe(replacement.previousListboxId);
    await page.locator(PANEL_SELECTOR + ' [data-orderbook-precision-value="0.01"]').click();
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

test('precision shortcuts follow each symbol native menu across an A to B to A switch', async ({ page }) => {
  const scenario = createCancelScenario();
  const { errors } = await openUserscriptScenario(page, scenario);
  await expectPrecisionOptions(page, scenario.host.precisionOptions, scenario.ui.orderbookPrecision);
  const otherOptions = ['1', '10', '100', '1000'];
  await page.evaluate((input) => window.__BINANCE_FIXTURE__.replacePrecisionControl(input), {
    scope: 'root',
    symbol: OTHER_SYMBOL,
    value: '10',
    options: otherOptions,
  });

  await expect(page).toHaveURL('https://www.binance.com/zh-CN/futures/' + OTHER_SYMBOL);
  await expectPrecisionOptions(page, otherOptions, '10');
  await page.locator(PANEL_SELECTOR + ' [data-orderbook-precision-value="100"]').click();
  await expectPrecisionOptions(page, otherOptions, '100');
  await expect(page.locator(NATIVE_ROOT_SELECTOR + ' .tick-content')).toHaveText('100');

  await page.evaluate((input) => window.__BINANCE_FIXTURE__.replacePrecisionControl(input), {
    scope: 'root',
    symbol: CURRENT_SYMBOL,
    value: scenario.ui.orderbookPrecision,
    options: scenario.host.precisionOptions,
  });
  await expect(page).toHaveURL('https://www.binance.com/zh-CN/futures/' + CURRENT_SYMBOL);
  await expectPrecisionOptions(page, scenario.host.precisionOptions, scenario.ui.orderbookPrecision);
  await page.locator(PANEL_SELECTOR + ' [data-orderbook-precision-value="0.01"]').click();
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
