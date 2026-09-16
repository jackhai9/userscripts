import { test, expect } from '../test.js';
import { CURRENT_SYMBOL, OTHER_SYMBOL, createCancelScenario } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario, readFixtureState } from '../helpers/userscript-page.js';
import { installScenarioClock, pauseScenarioClock } from '../helpers/scenario-clock.js';
import { installNativePrecisionSelectionHost } from '../../../test/helpers/native-precision-selection-host.js';

const SHORTCUT = '[data-orderbook-precision-value="0.01"]';
const CURRENT = '#futuresOrderbook .tick-content';
const TRIGGER = '#futuresOrderbook .bn-select-trigger';
const OPTIONS = ['0.001', '0.01', '0.1', '1'];

async function openReady(page, { hold = false } = {}) {
  await installScenarioClock(page);
  const host = await openUserscriptScenario(page, createCancelScenario(), {
    beforeOrderbook: hold
      ? `window.__NATIVE_PRECISION_SELECTION__ = (${installNativePrecisionSelectionHost.toString()})();`
      : '',
  });
  await expect(page.locator(SHORTCUT)).toBeEnabled();
  await pauseScenarioClock(page);
  return host;
}

async function selections(page) {
  return (await readFixtureState(page)).events
    .filter(event => event.type === 'precision-selected')
    .map(({ symbol, value }) => ({ symbol, value }));
}

async function expectNoFinancialActions(page) {
  expect((await readFixtureState(page)).events.filter(event => [
    'order-submitted', 'cancel-requested', 'row-cancel-requested',
  ].includes(event.type))).toEqual([]);
}

test.afterEach(async ({ page }) => {
  await page.evaluate(() => {
    if (!window.__NATIVE_PRECISION_SELECTION__) return;
    window.__NATIVE_PRECISION_SELECTION__.dispose();
    delete window.__NATIVE_PRECISION_SELECTION__;
  });
});

test('user selecting the current precision keeps the native dropdown closed without another selection', async ({ page }) => {
  // Given the native precision and its enabled shortcut already agree.
  const host = await openReady(page);
  const before = (await readFixtureState(page)).events.filter(event => event.type.startsWith('precision-'));

  // When the user clicks the already selected shortcut.
  await page.locator('[data-orderbook-precision-value="0.1"]').click();
  await page.clock.runFor(32);

  // Then the native control and event ledger remain unchanged with no dropdown or order action.
  await expect(page.locator(CURRENT)).toHaveText('0.1');
  await expect(page.locator('.bn-select-bubble')).toHaveCount(0);
  expect((await readFixtureState(page)).events.filter(event => event.type.startsWith('precision-'))).toEqual(before);
  await expectNoFinancialActions(page);
  expect(host.errors).toEqual([]);
});

test('user applies a precision shortcut through a native dropdown that is already open', async ({ page }) => {
  // Given the user has opened the native precision menu before using the shortcut.
  const host = await openReady(page);
  await page.locator(TRIGGER).click();
  await expect(page.getByRole('listbox')).toBeVisible();

  // When the shortcut selects its existing native option.
  await page.locator(SHORTCUT).click();
  await page.clock.runFor(32);

  // Then one exact selection closes the existing menu without toggling another portal.
  await expect(page.locator(CURRENT)).toHaveText('0.01');
  await expect(page.locator('.bn-select-bubble')).toHaveCount(0);
  expect(await selections(page)).toEqual([{ symbol: CURRENT_SYMBOL, value: '0.01' }]);
  expect((await readFixtureState(page)).events.filter(event => event.type === 'precision-overlay-opened')).toHaveLength(2);
  await expectNoFinancialActions(page);
  expect(host.errors).toEqual([]);
});

for (const missing of ['current option', 'requested option']) {
  test(`user keeps the native precision when a previously cached menu loses its ${missing}`, async ({ page }) => {
    // Given the panel has cached its shortcuts before the native menu changes its available options.
    const host = await openReady(page);
    await page.locator(TRIGGER).click();
    const value = missing === 'current option' ? '0.1' : '0.01';
    await page.locator(`.bn-select-bubble [data-precision-value="${value}"]`).evaluate(option => option.remove());

    // When the user tries the cached shortcut against that current native menu.
    await page.locator(SHORTCUT).click();
    await page.clock.runFor(32);

    // Then no native selection is dispatched and the original precision remains authoritative.
    await expect(page.locator(CURRENT)).toHaveText('0.1');
    expect(await selections(page)).toEqual([]);
    const shortcuts = page.locator('[data-orderbook-precision-value]');
    expect(await shortcuts.evaluateAll(nodes => nodes.map(node => node.dataset.orderbookPrecisionValue)))
      .toEqual(missing === 'current option' ? OPTIONS : OPTIONS.filter(option => option !== '0.01'));
    await expect(shortcuts.first()).toBeEnabled();
    await expectNoFinancialActions(page);
    expect(host.errors).toEqual([]);
  });
}

for (const pendingField of ['unchanged', 'temporarily empty']) {
  test(`user waits for a native precision commit while its field is ${pendingField}`, async ({ page }) => {
    // Given the native Select accepts a click but holds its committed value.
    const host = await openReady(page, { hold: true });

    // When the user requests another precision and the native field has not committed it.
    await page.locator(SHORTCUT).click();
    await page.clock.runFor(32);
    if (pendingField === 'temporarily empty') await page.locator(CURRENT).evaluate(node => { node.textContent = ''; });
    await page.clock.runFor(500);

    // Then the precision controls remain busy without an unconfirmed selection being counted.
    await expect(page.locator(SHORTCUT)).toBeDisabled();
    await expect(page.locator(CURRENT)).toHaveText(pendingField === 'unchanged' ? '0.1' : '');
    expect(await page.evaluate(() => window.__NATIVE_PRECISION_SELECTION__.snapshot().map(({ value }) => value)))
      .toEqual(['0.01']);
    expect(await selections(page)).toEqual([]);

    // When the native Select commits the held click within its observed deadline.
    await page.evaluate(() => window.__NATIVE_PRECISION_SELECTION__.commit());
    await page.clock.runFor(100);

    // Then the field and enabled shortcut agree on one exact confirmed value.
    await expect(page.locator(CURRENT)).toHaveText('0.01');
    await expect(page.locator(SHORTCUT)).toBeEnabled();
    await expect(page.locator(SHORTCUT)).toHaveAttribute('aria-pressed', 'true');
    expect(await selections(page)).toEqual([{ symbol: CURRENT_SYMBOL, value: '0.01' }]);
    await expectNoFinancialActions(page);
    expect(host.errors).toEqual([]);
  });
}

test('user can retry precision selection only after an uncommitted native request reaches its full deadline', async ({ page }) => {
  // Given the real precision selection is waiting for the native Select's commit.
  const host = await openReady(page, { hold: true });
  await page.locator(SHORTCUT).click();
  await page.clock.runFor(32);

  // When the clock reaches one millisecond before the native confirmation deadline.
  const remaining = await page.evaluate(() => window.__NATIVE_PRECISION_SELECTION__.snapshot()[0].at + 1199 - Date.now());
  expect(remaining).toBeGreaterThan(0);
  await page.clock.runFor(remaining);

  // Then the unconfirmed request still owns disabled controls and cannot be reported as selected.
  await expect(page.locator(SHORTCUT)).toBeDisabled();
  expect(await selections(page)).toEqual([]);

  // When the deadline expires and its queued render completes.
  await page.clock.runFor(17);

  // Then controls become available without changing or automatically retrying the native precision.
  await expect(page.locator(SHORTCUT)).toBeEnabled();
  await expect(page.locator(CURRENT)).toHaveText('0.1');
  expect(await page.evaluate(() => window.__NATIVE_PRECISION_SELECTION__.snapshot().map(({ value }) => value)))
    .toEqual(['0.01']);
  expect(await selections(page)).toEqual([]);
  await expectNoFinancialActions(page);
  expect(host.errors).toEqual([]);
});

for (const transition of ['another precision', 'another symbol']) {
  test(`user abandons a pending precision selection when the native control changes to ${transition}`, async ({ page }) => {
    // Given an old native precision option has been requested but is not committed.
    const host = await openReady(page, { hold: true });
    await page.locator(SHORTCUT).click();
    await page.clock.runFor(32);
    const symbol = transition === 'another symbol' ? OTHER_SYMBOL : CURRENT_SYMBOL;

    // When the native host replaces that control with a separately committed context.
    await page.evaluate(({ symbol, options }) => window.__BINANCE_FIXTURE__.replacePrecisionControl({
      scope: 'root', symbol, value: '1', options,
    }), { symbol, options: OPTIONS });
    await page.clock.runFor(250);

    // Then the replacement context remains authoritative and the old request is never replayed.
    await expect(page.locator(CURRENT)).toHaveText('1');
    await expect(page.locator('[data-orderbook-precision-value="1"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-orderbook-precision-value="1"]')).toBeEnabled();
    await expect(page).toHaveURL(`https://www.binance.com/zh-CN/futures/${symbol}`);
    expect(await selections(page)).toEqual([]);
    expect(await page.evaluate(() => window.__NATIVE_PRECISION_SELECTION__.snapshot().map(({ value }) => value)))
      .toEqual(['0.01']);
    await expectNoFinancialActions(page);
    expect(host.errors).toEqual([]);
  });
}

test('user retains the replacement precision control when the previous native trigger detaches before opening', async ({ page }) => {
  // Given native precision shortcuts are ready before a host replacement is queued.
  const host = await openReady(page);

  // When a real shortcut click and native trigger replacement occur before the queued menu open.
  await page.evaluate(options => {
    document.querySelector('[data-orderbook-precision-value="0.01"]').click();
    window.__BINANCE_FIXTURE__.replacePrecisionControl({ scope: 'select', symbol: 'HYPEUSDT', value: '0.1', options });
  }, OPTIONS);
  await page.clock.runFor(100);

  // Then the detached trigger cannot open a portal or select a value on the replacement.
  await expect(page.locator(CURRENT)).toHaveText('0.1');
  await expect(page.locator('.bn-select-bubble')).toHaveCount(0);
  await expect(page.locator(SHORTCUT)).toBeEnabled();
  expect(await selections(page)).toEqual([]);

  // When the user explicitly selects again using the replacement control.
  await page.locator(SHORTCUT).click();
  await page.clock.runFor(100);

  // Then one selection reaches that current native owner.
  await expect(page.locator(CURRENT)).toHaveText('0.01');
  expect(await selections(page)).toEqual([{ symbol: CURRENT_SYMBOL, value: '0.01' }]);
  await expectNoFinancialActions(page);
  expect(host.errors).toEqual([]);
});

test('user starts only one native selection when two precision shortcut events arrive before the busy render', async ({ page }) => {
  // Given two enabled precision shortcuts share one idle selection controller.
  const host = await openReady(page);

  // When both native click events arrive in the same host turn.
  await page.evaluate(() => {
    document.querySelector('[data-orderbook-precision-value="0.01"]').click();
    document.querySelector('[data-orderbook-precision-value="1"]').click();
  });
  await page.clock.runFor(100);

  // Then only the first selection commits and both shortcuts recover after that one task.
  await expect(page.locator(CURRENT)).toHaveText('0.01');
  await expect(page.locator(SHORTCUT)).toBeEnabled();
  await expect(page.locator('[data-orderbook-precision-value="1"]')).toBeEnabled();
  expect(await selections(page)).toEqual([{ symbol: CURRENT_SYMBOL, value: '0.01' }]);
  await expectNoFinancialActions(page);
  expect(host.errors).toEqual([]);
});
