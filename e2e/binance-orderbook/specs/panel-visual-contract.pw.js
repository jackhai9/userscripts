import { test, expect } from '../test.js';

import { POSITION_SETS, createCancelScenario } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario } from '../helpers/userscript-page.js';
import { readPanelVisualContract } from '../helpers/visual-contract.js';

const PANEL_SELECTOR = '#jh-binance-close-qty-multiplier-panel';

async function expectPrecisionReady(page) {
  await expect(page.locator(PANEL_SELECTOR).locator('[data-orderbook-precision-value="0.01"]'))
    .toBeEnabled({ timeout: 8_000 });
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

async function expectVisualContract(page, name) {
  const contract = await readPanelVisualContract(page);
  expect(`${JSON.stringify(contract, null, 2)}\n`).toMatchSnapshot(name);
}

test('open panel matches the fixed visual contract', async ({ page }) => {
  await openUserscriptScenario(page, createCancelScenario({
    ui: { tradeMode: 'OPEN' },
  }));
  await expectPrecisionReady(page);
  await expectVisualContract(page, 'open-fixed.visual.json');
});

test('close panel matches the disabled-state visual contract', async ({ page }) => {
  await openUserscriptScenario(page, createCancelScenario({
    positions: POSITION_SETS.current,
    ui: { tradeMode: 'CLOSE' },
  }));
  const panel = page.locator(PANEL_SELECTOR);
  await expect(panel.getByRole('radio', { name: '平多' })).toBeEnabled();
  await expect(panel.getByRole('radio', { name: '平空' })).toBeDisabled();
  await expectPrecisionReady(page);
  await expectVisualContract(page, 'close-fixed.visual.json');
});
