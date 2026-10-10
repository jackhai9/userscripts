const SCENARIO_EPOCH = new Date('2026-09-12T12:00:00Z');

/** Install before navigation so every application timer belongs to this clock. */
export async function installScenarioClock(page) {
  await page.clock.install({ time: SCENARIO_EPOCH });
}

/**
 * Call only at controlled lifecycle gates; performance tests retain native time.
 * Clock has no atomic pause-now API. Fix Date before the pause command, then
 * restore elapsed monotonic time once timers are stopped. During the handshake,
 * Date can briefly move back to the sampled value while timers still advance.
 */
export async function pauseScenarioClock(page) {
  const sampled = await page.evaluate(() => ({ time: Date.now(), ticks: performance.now() }));
  await page.clock.setFixedTime(sampled.time);
  await page.clock.pauseAt(sampled.time);
  const pausedTicks = await page.evaluate(() => performance.now());
  await page.clock.setSystemTime(sampled.time + pausedTicks - sampled.ticks);
}
