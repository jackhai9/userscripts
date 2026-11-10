import { test, expect } from '../test.js';
import { CURRENT_SYMBOL, createCancelScenario } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario, readFixtureState } from '../helpers/userscript-page.js';

test('user sees ladder progress change only the status text node, never its child nodes', async ({ page }) => {
  // Given an open-long ladder can submit all five orders and the status line is observed.
  const scenario = createCancelScenario({
    positions: [{ symbol: CURRENT_SYMBOL, side: 'LONG', quantity: '100' }],
    ui: { tradeMode: 'OPEN', openableQuantity: '10' },
    host: { submitApiResponses: Array.from({ length: 5 }, () => ({ outcome: 'success', delivery: 'immediate' })) },
  });
  const { errors } = await openUserscriptScenario(page, scenario);
  await page.evaluate(() => {
    const status = document.getElementById('jh-binance-ladder-status');
    window.__statusMutationTypes = [];
    new MutationObserver(records => window.__statusMutationTypes.push(...records.map(record => record.type)))
      .observe(status, { childList: true, subtree: true, characterData: true });
  });

  // When the user runs the ladder to completion.
  await page.locator('[data-ladder-action="OPEN_LONG"]').click();
  await expect.poll(async () => (await readFixtureState(page)).events
    .filter(({ type }) => type === 'order-submit-api-success').length, { timeout: 15_000 }).toBe(5);
  await expect(page.locator('[data-ladder-stop]')).toHaveCount(0, { timeout: 10_000 });

  // Then every progress update was a character-data change of the same text node.
  const types = await page.evaluate(() => window.__statusMutationTypes);
  expect(types.length).toBeGreaterThan(3);
  expect([...new Set(types)]).toEqual(['characterData']);
  expect(errors).toEqual([]);
});
