import { test, expect } from '../test.js';
import { installScenarioClock, pauseScenarioClock } from '../helpers/scenario-clock.js';

test('user pauses a running scenario despite clock transport latency and retains timer deadlines', async ({ page }) => {
  // Given a real browser clock owns a timer whose wall and monotonic deadlines agree
  await installScenarioClock(page);
  await page.setContent('<!doctype html><title>Scenario clock contract</title>');
  const initial = await page.evaluate(() => {
    window.clockEvents = [];
    const started = { wall: Date.now(), ticks: performance.now() };
    setTimeout(() => window.clockEvents.push({ wall: Date.now(), ticks: performance.now() }), 60_000);
    return started;
  });
  let pauseCalls = 0;
  const delayedTransport = {
    evaluate: (callback, argument) => page.evaluate(callback, argument),
    clock: {
      setFixedTime: time => page.clock.setFixedTime(time),
      setSystemTime: time => page.clock.setSystemTime(time),
      async pauseAt(time) {
        // The real Clock advances while the command is in transit; no business method is replaced.
        await page.clock.runFor(250);
        pauseCalls += 1;
        await page.clock.pauseAt(time);
      },
    },
  };

  // When pausing reaches the browser after the former one-hundred-millisecond buffer
  await pauseScenarioClock(delayedTransport);

  // Then one pause preserves elapsed time across both clocks without firing the future timer
  const paused = await page.evaluate(() => ({ wall: Date.now(), ticks: performance.now(), events: window.clockEvents }));
  expect(pauseCalls).toBe(1);
  expect(paused.ticks - initial.ticks).toBeGreaterThanOrEqual(250);
  expect(Math.abs((paused.wall - initial.wall) - (paused.ticks - initial.ticks))).toBeLessThanOrEqual(1);
  expect(paused.events).toEqual([]);

  // When the controlled clock reaches the timer's original monotonic deadline
  await page.clock.runFor(60_000 - (paused.ticks - initial.ticks) - 1);
  expect(await page.evaluate(() => window.clockEvents)).toEqual([]);
  await page.clock.runFor(1);

  // Then the timer fires exactly once with its original wall-clock deadline intact
  const events = await page.evaluate(() => window.clockEvents);
  expect(events).toHaveLength(1);
  expect(Math.abs(events[0].wall - initial.wall - 60_000)).toBeLessThanOrEqual(1);
  expect(Math.abs(events[0].ticks - initial.ticks - 60_000)).toBeLessThanOrEqual(1);

  // When the same scenario resumes and reaches another controlled pause
  await page.clock.resume();
  const resumed = await page.evaluate(() => {
    const started = { wall: Date.now(), ticks: performance.now() };
    setTimeout(() => window.clockEvents.push({ wall: Date.now(), ticks: performance.now() }), 60_000);
    return started;
  });
  await pauseScenarioClock(delayedTransport);
  const pausedAgain = await page.evaluate(() => ({ wall: Date.now(), ticks: performance.now() }));
  await page.clock.runFor(60_000 - (pausedAgain.ticks - resumed.ticks));

  // Then the repeated pause keeps both clock domains and the next deadline intact
  const allEvents = await page.evaluate(() => window.clockEvents);
  expect(pauseCalls).toBe(2);
  expect(Math.abs((pausedAgain.wall - resumed.wall) - (pausedAgain.ticks - resumed.ticks))).toBeLessThanOrEqual(1);
  expect(allEvents).toHaveLength(2);
  expect(Math.abs(allEvents[1].wall - resumed.wall - 60_000)).toBeLessThanOrEqual(1);
  expect(Math.abs(allEvents[1].ticks - resumed.ticks - 60_000)).toBeLessThanOrEqual(1);
});
