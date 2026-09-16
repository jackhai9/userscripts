import { test, expect } from '../test.js';
import { CURRENT_SYMBOL, createCancelScenario } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario, readFixtureState } from '../helpers/userscript-page.js';
import { installScenarioClock, pauseScenarioClock } from '../helpers/scenario-clock.js';
import {
  installNativeCloseQuantityTransition,
  installNativePostOnlyTransition,
  installOrderEntryReadProbe,
} from '../../../test/helpers/order-entry-host-boundaries.js';

const PANEL = '#jh-binance-close-qty-multiplier-panel';
const STATUS = '#jh-binance-ladder-status';
const LONG = '#jh-binance-close-side-long';
const SHORT = '#jh-binance-close-side-short';

async function orderSubmissions(page) {
  return (await readFixtureState(page)).events.filter(({ type }) => type === 'order-submitted');
}

test('user waits for the native Post Only selection before the ladder can submit its exact orders', async ({ page }) => {
  // Given the current native order type is Limit and selecting Post Only requires a separate host commit.
  await installScenarioClock(page);
  const host = await openUserscriptScenario(page, createCancelScenario({
    ui: { openableQuantity: '100' },
    host: { submitApiResponses: Array.from({ length: 3 }, () => ({ outcome: 'success', delivery: 'immediate' })) },
  }));
  await page.locator('[data-ladder-group="levels"][data-ladder-value="3"]').click();
  const native = await page.evaluateHandle(installNativePostOnlyTransition);
  await pauseScenarioClock(page);

  // When the actual ladder action requests Post Only but the native tab remains uncommitted for 650 ms.
  await page.locator('[data-ladder-action="OPEN_LONG"]').evaluate(button => button.click());
  await expect.poll(() => native.evaluate(boundary => boundary.snapshot())).toEqual({
    requests: 1, committed: false, selected: ['LIMIT'],
  });
  await page.clock.runFor(650);

  // Then the real entrypoint remains in preparation without submitting under the unconfirmed order type.
  await expect(page.locator(STATUS)).toHaveText('阶梯开多准备中');
  expect(await orderSubmissions(page)).toEqual([]);
  expect((await readFixtureState(page)).events.filter(({ type }) => type === 'trade-input-written')).toEqual([]);
  expect(await native.evaluate(boundary => boundary.snapshot())).toEqual({
    requests: 1, committed: false, selected: ['LIMIT'],
  });

  // When the native selection commits while the application clock remains paused.
  const committedAt = await native.evaluate(boundary => {
    boundary.commit();
    return performance.now();
  });

  // Then the mutation releases the real next input operation without an additional fixed sleep.
  await expect.poll(async () => (await readFixtureState(page)).events
    .filter(({ type }) => type === 'trade-input-written')
    .map(({ id, value, at }) => ({ id, value, at }))).toEqual([
    { id: 'limitPrice-open', value: '80.9', at: committedAt },
  ]);
  expect(await orderSubmissions(page)).toEqual([]);

  // When the native form completes its separate stability checks for the selected three-order ladder.
  await page.clock.resume();

  // Then every exact order is acknowledged under the single committed Post Only selection.
  await expect(page.locator(STATUS)).toContainText('已挂 3/3', { timeout: 8000 });
  expect((await orderSubmissions(page)).map(({ price, quantity }) => ({ price, quantity }))).toEqual([
    { price: '80.9', quantity: '0.66' },
    { price: '80.4', quantity: '0.66' },
    { price: '79.9', quantity: '0.68' },
  ]);
  expect(await native.evaluate(boundary => boundary.snapshot())).toEqual({
    requests: 1, committed: true, selected: ['POST_ONLY'],
  });
  await native.evaluate(boundary => boundary.dispose());
  await native.dispose();
  expect(host.errors).toEqual([]);
});

test('user keeps stable watchdog refreshes independent of orderbook size and limits panel layout checks', async ({ page }, testInfo) => {
  // Given the actual panel is stable beside one thousand additional native orderbook rows.
  await installScenarioClock(page);
  const host = await openUserscriptScenario(page, createCancelScenario({
    positions: [{ symbol: CURRENT_SYMBOL, side: 'LONG', quantity: '3' }],
  }));
  await page.locator('#futuresOrderbook').evaluate(book => {
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 1000; index += 1) {
      const row = document.createElement('div');
      row.className = 'row-content';
      const price = document.createElement('span');
      price.className = 'bid-light emit-price';
      price.textContent = (80 - index / 100).toFixed(2);
      row.append(price);
      fragment.append(row);
    }
    book.append(fragment);
  });
  await pauseScenarioClock(page);
  await page.clock.runFor(5000);
  await expect(page.locator('#jh-binance-close-qty-final')).toHaveText('0.07');
  const probe = await page.evaluateHandle(installOrderEntryReadProbe);

  // When three actual five-second route watchdog cycles refresh the unchanged native page.
  await page.clock.runFor(15000);
  const counts = await probe.evaluate(boundary => boundary.dispose());
  await probe.dispose();

  // Then refreshes never scan or measure book rows and perform only one panel layout check per cycle.
  expect(counts.orderbookScans).toBe(0);
  expect(counts.orderbookLayoutReads).toBe(0);
  expect(counts.spacerRectReads).toBe(3);
  expect(counts.panelHeightReads).toBe(3);
  expect(counts.panelMutations).toBe(0);
  await expect(page.locator(PANEL)).toHaveCount(1);
  await expect(page.locator('#jh-binance-close-qty-final')).toHaveText('0.07');
  expect(await orderSubmissions(page)).toEqual([]);
  expect(host.errors).toEqual([]);
  await testInfo.attach('native-dom-operation-counts', { body: JSON.stringify(counts, null, 2), contentType: 'application/json' });
});

test('user receives the first confirmed close quantities before the generic trade-form debounce can expire', async ({ page }) => {
  // Given the native mode transition commits separately from the first close-quantity snapshot.
  await installScenarioClock(page);
  const host = await openUserscriptScenario(page, createCancelScenario({
    positions: [{ symbol: CURRENT_SYMBOL, side: 'LONG', quantity: '3' }],
  }));
  const native = await page.evaluateHandle(installNativeCloseQuantityTransition);
  await pauseScenarioClock(page);
  await page.locator('[data-trade-mode="CLOSE"]').evaluate(tab => tab.click());
  await page.clock.runFor(200);
  await expect(page.locator('#jh-binance-trade-mode-hint')).toHaveAttribute('title', '平仓模式：正在确认可平仓位');
  await expect(page.locator(LONG)).toBeEnabled();
  await expect(page.locator(SHORT)).toBeEnabled();
  await expect(page.locator('[data-ladder-action="CLOSE_SHORT"]')).toBeEnabled();
  const debounceStartedAt = await page.locator('.order-entry button').first().evaluate(button => {
    button.classList.add('quantity-pending');
    return performance.now();
  });
  await page.clock.runFor(16);
  await expect(page.locator('#jh-binance-trade-mode-hint')).toHaveAttribute('title', '平仓模式：正在确认可平仓位');

  // When the native quantity publication arrives while the generic 50 ms debounce is still pending.
  const publishedAt = await native.evaluate(boundary => {
    boundary.publish({ longQty: '3', shortQty: '0' });
    return performance.now();
  });
  await page.clock.runFor(16);

  // Then the next frame uses the fresh long-only snapshot without waiting for the debounce deadline.
  expect(await page.evaluate(startedAt => performance.now() - startedAt, publishedAt)).toBe(16);
  expect(await page.evaluate(startedAt => performance.now() - startedAt, debounceStartedAt)).toBe(32);
  await expect(page.locator('[data-testid="max-sell-amount"]')).toHaveText('可平 3 HYPE');
  await expect(page.locator('[data-testid="max-buy-amount"]')).toHaveText('可平 0 HYPE');
  await expect(page.locator(LONG)).toBeEnabled();
  await expect(page.locator(SHORT)).toBeDisabled();
  await expect(page.locator('[data-ladder-action="CLOSE_LONG"]')).toBeEnabled();
  await expect(page.locator('[data-ladder-action="CLOSE_SHORT"]')).toBeDisabled();
  await expect(page.locator('#jh-binance-trade-mode-hint')).toHaveAttribute('title', '平仓模式：当前仅有多仓，单击订单簿价格后将平多');
  expect(await orderSubmissions(page)).toEqual([]);
  expect((await readFixtureState(page)).events.filter(({ type }) => /cancel/.test(type))).toEqual([]);
  await native.evaluate(boundary => boundary.dispose());
  await native.dispose();
  expect(host.errors).toEqual([]);
});
