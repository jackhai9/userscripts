import { test, expect } from '../test.js';
import { OTHER_SYMBOL, createCancelScenario } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario, readFixtureState } from '../helpers/userscript-page.js';
import { installScenarioClock, pauseScenarioClock } from '../helpers/scenario-clock.js';

const FINAL_QUANTITY = '#jh-binance-close-qty-final';
const STATUS = '#jh-binance-ladder-status';
const FILTERS = [
  { filterType: 'LOT_SIZE', minQty: '0.01', stepSize: '0.01' },
  { filterType: 'MARKET_LOT_SIZE', minQty: '0.2', stepSize: '0.1' },
  { filterType: 'MIN_NOTIONAL', notional: '5' },
];

async function orderSubmissions(page) {
  return (await readFixtureState(page)).events.filter(({ type }) => type === 'order-submitted');
}

async function switchToUncachedSymbol(page) {
  await page.evaluate(symbol => window.__BINANCE_FIXTURE__.switchSymbol(symbol), OTHER_SYMBOL);
  await page.clock.runFor(100);
}

for (const failure of ['http', 'missing symbol', 'invalid json', 'network']) {
  test(`user waits through the rule cooldown after a ${failure} failure before the next request recovers`, async ({ page }) => {
    // Given the current symbol is ready and the next symbol has one explicit exchange-info failure.
    await installScenarioClock(page);
    const host = await openUserscriptScenario(page, createCancelScenario());
    await expect(page.locator(FINAL_QUANTITY)).toHaveText('0.07');
    await pauseScenarioClock(page);
    let requests = 0;
    const recoveredRules = Promise.withResolvers();
    await page.route('https://fapi.binance.com/fapi/v1/exchangeInfo**', async route => {
      expect(new URL(route.request().url()).searchParams.get('symbol')).toBe(OTHER_SYMBOL);
      requests += 1;
      if (requests > 1) {
        await recoveredRules.promise;
        await route.fulfill({ json: { symbols: [{ symbol: OTHER_SYMBOL, filters: FILTERS }] } });
      } else if (failure === 'http') {
        await route.fulfill({ status: 503, json: { message: 'Exchange info unavailable' } });
      } else if (failure === 'missing symbol') {
        await route.fulfill({ json: { symbols: [] } });
      } else if (failure === 'invalid json') {
        await route.fulfill({ contentType: 'application/json', body: '{' });
      } else {
        await route.abort('failed');
      }
    });

    try {
      // When navigation loads the failed rules and a real price click occurs within the cooldown.
      await switchToUncachedSymbol(page);
      await expect.poll(() => requests).toBe(1);
      await page.clock.runFor(100);
      await page.locator('#futuresOrderbook .bid-light').first().click();

      // Then the real click reports unavailable rules and cannot submit an order.
      await expect(page.locator(FINAL_QUANTITY)).toHaveText('最小量读取中');
      await expect(page.locator(STATUS)).toHaveText('单击下单未执行：数量规则读取中');
      expect(await orderSubmissions(page)).toEqual([]);

      // When several normal refreshes occur within the five-second rule cooldown.
      await page.clock.runFor(4000);
      await page.evaluate(() => window.dispatchEvent(new Event('resize')));
      await page.clock.runFor(16);

      // Then no additional rules request or order can be produced during that cooldown.
      expect(requests).toBe(1);
      expect(await orderSubmissions(page)).toEqual([]);

      // When the cooldown ends but the recovery response is still held beyond the next browser frames.
      await page.clock.runFor(1100);
      await page.evaluate(() => window.dispatchEvent(new Event('resize')));
      await page.clock.runFor(100);
      await expect.poll(() => requests).toBe(2);
      await page.clock.runFor(100);

      // Then receiving the second request alone cannot mark the quantity rules as ready.
      await expect(page.locator(FINAL_QUANTITY)).toHaveText('最小量读取中');
      expect(await orderSubmissions(page)).toEqual([]);

      // When the successful response is released and normal browser frame scheduling resumes.
      recoveredRules.resolve();
      await page.clock.resume();

      // Then the returned quantity contract updates the panel without another request or order submission.
      await expect(page.locator(FINAL_QUANTITY)).toHaveText('0.07');
      await expect(page.locator('#jh-binance-close-qty-min')).toHaveText('≥5U @ 81');
      expect(requests).toBe(2);
      expect(await orderSubmissions(page)).toEqual([]);
      expect(host.errors).toEqual([]);
    } finally {
      recoveredRules.resolve();
    }
  });
}

for (const rule of [
  { label: 'no filters field', entry: {} },
  { label: 'empty filters', entry: { filters: [] } },
  { label: 'missing lot minimum', entry: { filters: [{ filterType: 'LOT_SIZE', stepSize: '0.01' }] } },
  { label: 'missing lot increment', entry: { filters: [{ filterType: 'LOT_SIZE', minQty: '0.01' }] } },
]) {
  test(`user cannot submit a ladder while exchange rules contain ${rule.label}`, async ({ page }) => {
    // Given an uncached symbol will return an incomplete minimum-quantity contract.
    await installScenarioClock(page);
    const host = await openUserscriptScenario(page, createCancelScenario());
    await pauseScenarioClock(page);
    let requests = 0;
    await page.route('https://fapi.binance.com/fapi/v1/exchangeInfo**', async route => {
      requests += 1;
      await route.fulfill({ json: { symbols: [{ symbol: OTHER_SYMBOL, ...rule.entry }] } });
    });
    await switchToUncachedSymbol(page);
    await expect.poll(() => requests).toBe(1);
    await page.clock.runFor(100);

    // When the user explicitly starts the ordinary open-long ladder.
    await page.locator('[data-ladder-action="OPEN_LONG"]').evaluate(button => button.click());
    await page.clock.runFor(300);
    await page.clock.resume();

    // Then the entrypoint identifies the missing quantity rules and never sends an order.
    await expect(page.locator(FINAL_QUANTITY)).toHaveText('最小量读取中');
    await expect(page.locator(STATUS)).toContainText('下单数量规则尚未就绪');
    expect(requests).toBe(1);
    expect(await orderSubmissions(page)).toEqual([]);
    expect(host.errors).toEqual([]);
  });
}

for (const rules of [
  { label: 'market-specific increments', filters: FILTERS, quantity: '0.2' },
  { label: 'the declared lot increment when market filters are absent', filters: [FILTERS[0]], quantity: '0.01' },
]) {
  test(`user sees market quantity calculated from ${rules.label}`, async ({ page }) => {
    // Given the next symbol has an explicit exchange quantity contract.
    await installScenarioClock(page);
    const host = await openUserscriptScenario(page, createCancelScenario());
    await pauseScenarioClock(page);
    let requests = 0;
    await page.route('https://fapi.binance.com/fapi/v1/exchangeInfo**', async route => {
      requests += 1;
      await route.fulfill({ json: { symbols: [{ symbol: OTHER_SYMBOL, filters: rules.filters }] } });
    });
    await switchToUncachedSymbol(page);
    await expect.poll(() => requests).toBe(1);

    // When the native page selects its Market order tab.
    await page.locator('.order-type-tabs [role="tab"]').evaluate(tab => {
      tab.dataset.tabKey = 'MARKET';
      tab.textContent = '市价';
      tab.setAttribute('aria-selected', 'true');
    });
    await page.clock.runFor(100);
    await page.clock.resume();

    // Then the panel uses the correct market minimum and increment while keeping the exchange rules cached.
    await expect(page.locator(FINAL_QUANTITY)).toHaveText(rules.quantity);
    await expect(page.locator('[data-multiplier-formula-prefix]')).toHaveText(`${rules.quantity} × 1 =`);
    expect(requests).toBe(1);
    expect(await orderSubmissions(page)).toEqual([]);
    expect(host.errors).toEqual([]);
  });
}

for (const mark of [
  { label: 'a numeric mark price', value: 10, quantity: '0.5', constraint: '≥5U @ 10' },
  { label: 'a string mark price', value: '20', quantity: '0.25', constraint: '≥5U @ 20' },
  { label: 'an unavailable mark price', value: null, quantity: '0.01', constraint: '' },
  { label: 'a malformed application payload', malformed: true, quantity: '0.01', constraint: '' },
]) {
  test(`user recalculates the minimum from ${mark.label} when the native price input is empty`, async ({ page }) => {
    // Given cached exchange rules require five USDT and the current native price is about to be cleared.
    await installScenarioClock(page);
    const host = await openUserscriptScenario(page, createCancelScenario());
    await expect(page.locator(FINAL_QUANTITY)).toHaveText('0.07');
    await pauseScenarioClock(page);

    // When the native application publishes its mark price and clears the editable limit-price field.
    await page.evaluate(mark => {
      document.querySelector('#__APP_DATA').textContent = mark.malformed
        ? '{'
        : JSON.stringify({ appState: { loader: { dataByRouteId: { bd56: { reactQueryData: {
          'queryMarkPrice,HYPEUSDT': { markPrice: mark.value },
        } } } } } });
      const input = document.querySelector('#limitPrice-open');
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      window.dispatchEvent(new Event('resize'));
    }, mark);
    await page.clock.runFor(100);

    // Then the visible quantity and notional explanation match the available reference exactly.
    await expect(page.locator(FINAL_QUANTITY)).toHaveText(mark.quantity);
    await expect(page.locator('#jh-binance-close-qty-min')).toHaveText(mark.constraint);
    expect(await orderSubmissions(page)).toEqual([]);
    expect(host.errors).toEqual([]);
  });
}

test('user sees the amount constraint separated from the formula only while an opening notional applies', async ({ page }) => {
  // Given the open panel displays both a minimum-quantity formula and its notional constraint.
  const host = await openUserscriptScenario(page, createCancelScenario());
  const divider = page.locator('[data-multiplier-constraint-divider]');
  await expect(page.locator('#jh-binance-close-qty-min')).toHaveText('≥5U @ 81');

  // When the complete open calculation is rendered.
  const geometry = await divider.boundingBox();

  // Then a fixed-width decorative divider visibly separates the two pieces of information.
  await expect(divider).toBeVisible();
  await expect(divider).toHaveAttribute('aria-hidden', 'true');
  await expect(divider).toHaveCSS('display', 'block');
  await expect(divider).toHaveCSS('flex-shrink', '0');
  await expect(divider).toHaveCSS('background-color', 'rgb(213, 217, 226)');
  expect({ width: geometry.width, height: geometry.height }).toEqual({ width: 1, height: 12 });

  // When the native page switches to a close order without an opening notional requirement.
  await page.locator('[data-trade-mode="CLOSE"]').click();

  // Then the formula remains while its obsolete constraint and divider both leave the visible calculation.
  await expect(page.locator('[data-multiplier-formula-prefix]')).toHaveText('0.01 × 1 =');
  await expect(divider).toHaveCount(1);
  await expect(divider).toBeHidden();
  await expect(divider).toHaveCSS('display', 'none');
  await expect(page.locator('#jh-binance-close-qty-min')).toBeHidden();

  // When the native form returns to open mode.
  await page.locator('[data-trade-mode="OPEN"]').click();

  // Then both the original constraint and its separator return without submitting an order.
  await expect(divider).toBeVisible();
  await expect(page.locator('#jh-binance-close-qty-min')).toHaveText('≥5U @ 81');
  expect(await orderSubmissions(page)).toEqual([]);
  expect(host.errors).toEqual([]);
});
