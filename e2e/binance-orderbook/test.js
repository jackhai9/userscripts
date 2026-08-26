import { test as base, expect } from '@playwright/test';

import {
  readFixtureState,
  readScenarioEvidence,
} from './helpers/userscript-page.js';

function jsonAttachment(value) {
  return {
    body: Buffer.from(`${JSON.stringify(value, null, 2)}\n`),
    contentType: 'application/json',
  };
}

export const test = base.extend({
  // Failure evidence belongs to the test runner boundary so every future scenario
  // receives the same diagnostics without duplicating cleanup code in each spec.
  failureEvidence: [async ({ page }, use, testInfo) => {
    await use();
    if (testInfo.status === testInfo.expectedStatus) return;

    const evidence = readScenarioEvidence(page);
    if (!evidence) return;
    await testInfo.attach('scenario.json', jsonAttachment(evidence.scenario));
    await testInfo.attach('userscript.json', jsonAttachment(evidence.userscript));
    await testInfo.attach('page-errors.json', jsonAttachment(evidence.errors));

    if (!page.isClosed()) {
      const fixtureState = await readFixtureState(page).catch((error) => ({
        unavailable: String(error?.message || error),
      }));
      await testInfo.attach('fixture-state.json', jsonAttachment(fixtureState));
      const interaction = await page.evaluate(() => (
        window.__UI_INTERACTION_PROBE__?.finish?.() || null
      )).catch((error) => ({ unavailable: String(error?.message || error) }));
      if (interaction) await testInfo.attach('interaction.json', jsonAttachment(interaction));
    }
  }, { auto: true }],
});

export { expect };
