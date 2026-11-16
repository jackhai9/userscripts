import { test, expect } from '../test.js';
import { CURRENT_SYMBOL, createCancelScenario } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario, readFixtureState } from '../helpers/userscript-page.js';

const RUNNING = '[data-jh-action-running="true"]';
const STOP = '[data-ladder-stop]';
const STATUS = '#jh-binance-ladder-status';

function scenario(mode, response = { outcome: 'success', delivery: 'manual' }) {
  return createCancelScenario({
    positions: ['LONG', 'SHORT'].map(side => ({ symbol: CURRENT_SYMBOL, side, quantity: '100' })),
    ui: { tradeMode: mode, openableQuantity: '10' },
    host: { submitApiResponses: [response] },
  });
}

async function expectIndicator(button, animation) {
  await expect(button).toHaveAttribute('data-jh-action-running', 'true');
  await expect(button).toHaveAttribute('aria-busy', 'true');
  expect(await button.evaluate(element => {
    const style = getComputedStyle(element, '::after');
    return { animation: style.animationName, content: style.content, pointerEvents: style.pointerEvents, height: style.height };
  })).toEqual({ animation, content: '""', pointerEvents: 'none', height: '3px' });
}

for (const action of ['OPEN_LONG', 'OPEN_SHORT', 'CLOSE_LONG', 'CLOSE_SHORT']) {
  test(`user sees ${action} running without changing button size or the ability to stop`, async ({ page }, testInfo) => {
    // Given a real ladder can hold its first native response.
    const host = await openUserscriptScenario(page, scenario(action.split('_')[0]));
    const button = page.locator(`[data-ladder-action="${action}"]`);
    const before = await button.boundingBox();
    // When the ladder waits for that response.
    await button.click();
    await expect.poll(host.pendingSubmitSequences).toEqual([1]);
    // Then only the running direction has a moving marker, with the original dimensions.
    await expect(page.locator(RUNNING)).toHaveCount(1);
    await expectIndicator(page.locator(STOP), 'jh-action-running');
    const after = await page.locator(STOP).boundingBox();
    expect(after.width).toBeCloseTo(before.width, 1);
    expect(after.height).toBeCloseTo(before.height, 1);
    const transforms = await page.locator(STOP).evaluate(async button => {
      const animation = button.getAnimations({ subtree: true }).find(item => item.animationName === 'jh-action-running');
      animation.pause();
      animation.currentTime = 250;
      await new Promise(requestAnimationFrame);
      const first = getComputedStyle(button, '::after').transform;
      animation.currentTime = 700;
      await new Promise(requestAnimationFrame);
      return [first, getComputedStyle(button, '::after').transform];
    });
    expect(transforms[0]).not.toBe(transforms[1]);
    if (action === 'CLOSE_SHORT') {
      await page.locator('#jh-binance-close-qty-multiplier-panel').screenshot({ path: testInfo.outputPath('running-panel.png') });
    }
    // When the user stops and the in-flight response completes.
    await page.locator(STOP).click();
    await host.releaseSubmitResponse(1);
    // Then the marker disappears and no later order is submitted.
    await expect(page.locator(RUNNING)).toHaveCount(0);
    await expect(page.locator(STOP)).toHaveCount(0);
    expect((await readFixtureState(page)).events.filter(event => event.type === 'order-submitted')).toHaveLength(1);
    expect(host.errors).toEqual([]);
  });
}

for (const action of ['OPEN_LONG', 'OPEN_SHORT', 'CLOSE_LONG', 'CLOSE_SHORT']) {
  test(`user sees the actual single ${action} direction busy until its response completes`, async ({ page }) => {
    // Given a single order has a gated response and both direction choices exist.
    const [mode, side] = action.split('_');
    const host = await openUserscriptScenario(page, scenario(mode));
    const button = page.locator(`#jh-binance-close-side-${side.toLowerCase()}`);
    await button.click();
    // When a price click submits the selected direction.
    await page.locator('#futuresOrderbook .bid-light.emit-price').first().click();
    await expect.poll(host.pendingSubmitSequences).toEqual([1]);
    // Then the actual direction is marked, without turning a preference button into Stop.
    await expect(page.locator(RUNNING)).toHaveCount(1);
    await expectIndicator(button, 'jh-action-running');
    await expect(button).toHaveAttribute('role', 'radio');
    // When the exact response succeeds.
    await host.releaseSubmitResponse(1);
    // Then the marker is removed after one submitted order.
    await expect(page.locator(RUNNING)).toHaveCount(0);
    await expect(button).not.toHaveAttribute('aria-busy', 'true');
    await expect(page.locator(STATUS)).toContainText('已提交');
    expect((await readFixtureState(page)).events.filter(event => event.type === 'order-submitted')).toHaveLength(1);
    expect(host.errors).toEqual([]);
  });
}

test('user retains a static running marker for continuous close when reduced motion is requested', async ({ page }) => {
  // Given reduced motion is enabled and a continuous close can await its first response.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const host = await openUserscriptScenario(page, scenario('CLOSE'));
  // When the user starts continuous close-short.
  await page.locator('[data-ladder-action="CLOSE_SHORT"]').click({ modifiers: ['Alt'] });
  await expect.poll(host.pendingSubmitSequences).toEqual([1]);
  // Then the running marker remains visible without animation and Stop remains operable.
  await expectIndicator(page.locator(STOP), 'none');
  await expect(page.locator(STOP)).toBeEnabled();
  // When the user stops and the pending response completes.
  await page.locator(STOP).click();
  await host.releaseSubmitResponse(1);
  // Then the continuous task releases its indicator without another submission.
  await expect(page.locator(RUNNING)).toHaveCount(0);
  expect((await readFixtureState(page)).events.filter(event => event.type === 'order-submitted')).toHaveLength(1);
  expect(host.errors).toEqual([]);
});

test('user keeps the pending single-order marker on its captured direction after changing preferences', async ({ page }) => {
  // Given a pending open-long order and an independently editable short preference.
  const host = await openUserscriptScenario(page, scenario('OPEN'));
  await page.locator('#futuresOrderbook .bid-light.emit-price').first().click();
  await expect.poll(host.pendingSubmitSequences).toEqual([1]);
  // When the user selects short while the long response remains pending.
  await page.locator('#jh-binance-close-side-short').click();
  // Then the preference changes but the running marker still belongs to the submitted long.
  await expect(page.locator('#jh-binance-close-side-short')).toHaveAttribute('aria-checked', 'true');
  await expectIndicator(page.locator('#jh-binance-close-side-long'), 'jh-action-running');
  await expect(page.locator('#jh-binance-close-side-short')).not.toHaveAttribute('aria-busy', 'true');
  // When that one order completes.
  await host.releaseSubmitResponse(1);
  // Then the original action completes once and its marker clears.
  await expect(page.locator(RUNNING)).toHaveCount(0);
  expect((await readFixtureState(page)).events.filter(event => event.type === 'order-submitted').map(event => event.action)).toEqual(['开多']);
  expect(host.errors).toEqual([]);
});

for (const change of ['mode', 'symbol']) {
  test(`user never sees a pending single-order marker on a different ${change}`, async ({ page }) => {
    // Given a pending single open-long request on the original symbol.
    const host = await openUserscriptScenario(page, scenario('OPEN'));
    await page.locator('#futuresOrderbook .bid-light.emit-price').first().click();
    await expect.poll(host.pendingSubmitSequences).toEqual([1]);
    await expectIndicator(page.locator('#jh-binance-close-side-long'), 'jh-action-running');
    // When the displayed native context changes before the response arrives.
    if (change === 'mode') await page.locator('[data-trade-mode="CLOSE"]').click();
    else await page.evaluate(() => window.__BINANCE_FIXTURE__.switchSymbol('BTCUSDT'));
    // Then the old operation is not presented as active in the new context.
    await expect(page.locator(RUNNING)).toHaveCount(0);
    await host.releaseSubmitResponse(1);
    expect((await readFixtureState(page)).events.filter(event => event.type === 'order-submitted')).toHaveLength(1);
    expect(host.errors).toEqual([]);
  });
}

for (const kind of ['single', 'ladder']) {
  test(`user loses the running marker when a ${kind} order is rejected`, async ({ page }) => {
    // Given the provider has a gated rejection response.
    const host = await openUserscriptScenario(page, scenario('OPEN', {
      outcome: 'rejected', delivery: 'manual', code: '-2010', message: 'Order rejected by fixture',
    }));
    // When an order starts and the provider rejects it.
    if (kind === 'single') await page.locator('#futuresOrderbook .bid-light.emit-price').first().click();
    else await page.locator('[data-ladder-action="OPEN_LONG"]').click();
    await expect.poll(host.pendingSubmitSequences).toEqual([1]);
    await expect(page.locator(RUNNING)).toHaveCount(1);
    await host.releaseSubmitResponse(1);
    // Then failure is visible and no running indicator is left behind.
    await expect(page.locator(RUNNING)).toHaveCount(0);
    await expect(page.locator(STATUS)).toContainText('失败');
    expect((await readFixtureState(page)).events.filter(event => event.type === 'order-submitted')).toHaveLength(1);
    expect(host.errors).toEqual([]);
  });
}
