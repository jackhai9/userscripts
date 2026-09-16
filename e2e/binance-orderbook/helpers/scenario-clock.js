const SCENARIO_EPOCH = new Date('2026-09-12T12:00:00Z');

/** Install before navigation so every application timer belongs to this clock. */
export async function installScenarioClock(page) {
  await page.clock.install({ time: SCENARIO_EPOCH });
}

/** Call only in lifecycle tests; performance-budget scenarios retain the native clock. */
export async function pauseScenarioClock(page) {
  const pageNow = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(pageNow + 100);
}
