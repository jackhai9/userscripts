import { test, expect } from '../test.js';
import { CURRENT_SYMBOL, createCancelScenario } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario, readFixtureState } from '../helpers/userscript-page.js';
import { installScenarioClock, pauseScenarioClock } from '../helpers/scenario-clock.js';
import { installFrameObservationHost } from '../helpers/ladder-frame-observation-host.js';

const STATUS = '#jh-binance-ladder-status';

async function submissions(page) {
  return (await readFixtureState(page)).events.filter(event => event.type === 'order-submitted')
    .map(({ action, price, quantity }) => ({ action, price, quantity }));
}

async function openHeldLadder(page, { continuous = false } = {}) {
  await installScenarioClock(page);
  const host = await openUserscriptScenario(page, createCancelScenario({
    positions: [{ symbol: CURRENT_SYMBOL, side: 'SHORT', quantity: '100' }],
    ui: { tradeMode: 'CLOSE' },
    host: { submitApiResponses: Array.from({ length: 3 }, (_, index) => ({
      outcome: 'success', delivery: continuous && index === 2 ? 'manual' : 'immediate',
    })) },
  }));
  await page.locator('[data-ladder-group="levels"][data-ladder-value="3"]').click();
  await page.evaluate(install => {
    window.__FRAME_OBSERVATION_HOST__ = (0, eval)(`(${install})`)(window);
    document.querySelector('#unitAmount-close').addEventListener('input', () => {
      window.__INPUT_OBSERVATION_STARTED_AT__ = performance.now();
    }, { once: true });
    document.querySelector('#limitPrice-close').addEventListener('input', () => {
      window.__FRAME_OBSERVATION_HOST__.hold();
    }, { once: true });
  }, installFrameObservationHost.toString());
  await pauseScenarioClock(page);
  await page.locator('[data-ladder-action="CLOSE_SHORT"]').evaluate((button, altKey) => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey }));
  }, continuous);
  for (let frame = 0; frame < 100; frame += 1) {
    if (await page.evaluate(() => window.__FRAME_OBSERVATION_HOST__.snapshot().held)) break;
    await page.clock.runFor(16);
  }
  expect(await page.evaluate(() => window.__FRAME_OBSERVATION_HOST__.snapshot().held)).toBe(true);
  return host;
}

async function advanceInputAge(page, age) {
  const remaining = await page.evaluate(age => window.__INPUT_OBSERVATION_STARTED_AT__ + age - performance.now(), age);
  expect(remaining).toBeGreaterThanOrEqual(0);
  await page.clock.runFor(remaining);
}

test('user completes exactly the planned ladder after foreground paint observations exceed the initial deadline', async ({ page }, testInfo) => {
  // Given a real generated ladder has written its first quantity while foreground paints are held.
  const { errors } = await openHeldLadder(page);

  // When independent timers cross the initial input observation deadline.
  await advanceInputAge(page, 1250);

  // Then the ladder remains active without submitting an unobserved input.
  expect(await submissions(page)).toEqual([]);
  await expect(page.locator('[data-ladder-stop]')).toBeEnabled();
  await expect(page.locator(STATUS)).not.toContainText('未稳定');

  // When additional independent observations settle and ordinary paints resume.
  await page.clock.runFor(300);
  await page.evaluate(() => window.__FRAME_OBSERVATION_HOST__.release());
  await page.clock.resume();

  // Then exactly the captured plan reaches the native order boundary.
  await expect(page.locator(STATUS)).toContainText('已挂 3/3');
  expect(await submissions(page)).toEqual([
    { action: '平空', price: '80.9', quantity: '0.1' },
    { action: '平空', price: '80.4', quantity: '0.1' },
    { action: '平空', price: '79.9', quantity: '0.1' },
  ]);
  expect(errors).toEqual([]);
  await testInfo.attach('completed-ladder.png', { body: await page.screenshot(), contentType: 'image/png' });
});

test('user keeps the continuous-close round intact when foreground input paints are delayed', async ({ page }) => {
  // Given a continuous close holds foreground paints on its first price write.
  const host = await openHeldLadder(page, { continuous: true });

  // When the initial deadline expires before independent input observations complete.
  await advanceInputAge(page, 1250);

  // Then the same round remains active without reporting an input recovery or submitting early.
  expect(await submissions(page)).toEqual([]);
  await expect(page.locator(STATUS)).not.toContainText('未稳定');
  await expect(page.locator(STATUS)).not.toContainText('下一轮');

  // When supplemental observations complete and normal painting resumes.
  await page.clock.runFor(300);
  await page.evaluate(() => window.__FRAME_OBSERVATION_HOST__.release());
  await page.clock.resume();
  await expect.poll(host.pendingSubmitSequences).toEqual([3]);

  // Then the original three prices reach native submission without restarting the round.
  expect(await submissions(page)).toEqual([
    { action: '平空', price: '80.9', quantity: '0.1' },
    { action: '平空', price: '80.4', quantity: '0.1' },
    { action: '平空', price: '79.9', quantity: '0.1' },
  ]);

  // When the user stops while the third native response is held.
  await pauseScenarioClock(page);
  await page.locator('[data-ladder-stop]').evaluate(button => button.click());
  await host.releaseSubmitResponse(3);
  await expect.poll(async () => (await readFixtureState(page)).events
    .filter(event => event.type === 'order-submit-api-success').length).toBe(3);
  await page.clock.runFor(30000);

  // Then stopping prevents a later continuous round despite the delayed native response.
  expect(await submissions(page)).toHaveLength(3);
  expect(host.errors).toEqual([]);
});

for (const change of ['Stop', 'symbol', 'mode']) {
  test(`user prevents submission when ${change} changes during supplemental input observation`, async ({ page }) => {
    // Given the generated ladder is still observing its first input after the initial deadline.
    const { errors } = await openHeldLadder(page);
    await advanceInputAge(page, 1250);
    await expect(page.locator('[data-ladder-stop]')).toBeEnabled();
    expect(await submissions(page)).toEqual([]);

    // When user intent or native trading context changes before stability is established.
    if (change === 'Stop') await page.locator('[data-ladder-stop]').evaluate(button => button.click());
    if (change === 'symbol') await page.evaluate(() => window.__BINANCE_FIXTURE__.switchSymbol('BTCUSDT'));
    if (change === 'mode') await page.locator('[data-trade-mode="OPEN"]').evaluate(tab => tab.click());
    await page.clock.runFor(3000);
    await page.evaluate(() => window.__FRAME_OBSERVATION_HOST__.release());
    await page.clock.runFor(3000);

    // Then stale values never reach the native submit boundary after either deadline.
    expect(await submissions(page)).toEqual([]);
    await expect(page.locator('[data-ladder-stop]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('user keeps an externally changed price and submits nothing when the supplemental deadline expires', async ({ page }) => {
  // Given the first order still needs independent observations after its initial deadline.
  const { errors } = await openHeldLadder(page);
  await advanceInputAge(page, 1250);
  expect(await submissions(page)).toEqual([]);
  await expect(page.locator(STATUS)).not.toContainText('未稳定');

  // When the native form receives a price outside the script-owned rollback states.
  await page.locator('#limitPrice-close').evaluate(input => {
    input.value = '99';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.clock.runFor(3000);
  await page.evaluate(() => window.__FRAME_OBSERVATION_HOST__.release());
  await page.clock.runFor(1000);

  // Then the bounded observation refuses submission and preserves the external price.
  expect(await submissions(page)).toEqual([]);
  await expect(page.locator('#limitPrice-close')).toHaveValue('99');
  await expect(page.locator(STATUS)).toContainText('价格框未同步');
  await expect(page.locator('[data-ladder-stop]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
