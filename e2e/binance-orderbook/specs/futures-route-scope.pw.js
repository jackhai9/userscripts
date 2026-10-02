import { test, expect } from '../test.js';
import { createCancelScenario } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario, readFixtureState } from '../helpers/userscript-page.js';
import { installScenarioClock, pauseScenarioClock } from '../helpers/scenario-clock.js';

test('user can enter a trading route after the orderbook installer starts on home', async ({ page }) => {
  // Given the real installer starts on home while an isolated native host is available.
  await page.route('**/*', route => route.abort('blockedbyclient'));
  await installScenarioClock(page);
  const businessRequests = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname.includes('/fapi/')) businessRequests.push(request.url());
  });

  // When another non-trading route precedes entry into a supported contract without reinjection.
  const host = await openUserscriptScenario(page, createCancelScenario({ currentSymbol: 'USUSDT' }), {
    beforeOrderbook: "history.replaceState({}, '', '/zh-CN/futures/home');",
    afterNavigation: async () => {
      await expect(page.locator('#jh-binance-close-qty-multiplier-panel')).toHaveCount(0);
      expect(await page.evaluate(() => typeof window.__TM_CLOSE_LONG_DEBUG__)).toBe('undefined');
      expect(businessRequests).toEqual([]);
      await page.evaluate(() => history.pushState({}, '', '/zh-CN/futures/quiz'));
      await expect(page.locator('#jh-binance-close-qty-multiplier-panel')).toHaveCount(0);
      await page.evaluate(() => history.pushState({}, '', '/zh-CN/futures/USUSDT'));
    },
  });
  await pauseScenarioClock(page);

  // Then the installer starts exactly once and creates its trading panel.
  await expect(page.locator('#jh-binance-close-qty-multiplier-panel')).toBeVisible();
  await expect(page.locator('#jh-binance-close-qty-multiplier-panel')).toHaveCount(1);
  await page.evaluate(() => { window.routeTestFetch = window.fetch; window.routeTestWebSocket = window.WebSocket; });

  // When repeated route notifications accompany leaving and returning to trading.
  await page.evaluate(() => {
    history.pushState({}, '', '/zh-CN/futures/home');
    history.pushState({}, '', '/zh-CN/futures/USUSDT');
    dispatchEvent(new PopStateEvent('popstate'));
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.clock.runFor(1000);

  // Then the original network observers and single panel remain owned by one runtime.
  await expect(page.locator('#jh-binance-close-qty-multiplier-panel')).toHaveCount(1);
  expect(await page.evaluate(() => [window.fetch === window.routeTestFetch, window.WebSocket === window.routeTestWebSocket])).toEqual([true, true]);
  expect((await readFixtureState(page)).events.filter(event => ['order-submitted', 'cancel-requested'].includes(event.type))).toEqual([]);
  expect(host.errors).toEqual([]);
});

test('user sees the orderbook panel only on supported trading routes across SPA navigation', async ({ page }) => {
  // Given the generated installer has mounted on a supported contract in an isolated host.
  await page.route('**/*', route => route.abort('blockedbyclient'));
  await installScenarioClock(page);
  const host = await openUserscriptScenario(page, createCancelScenario());
  await pauseScenarioClock(page);
  const panel = page.locator('#jh-binance-close-qty-multiplier-panel');
  await expect(panel).toBeVisible();
  const tradingPath = await page.evaluate(() => location.pathname);

  // When SPA navigation visits each non-trading futures page with stale trading DOM still present.
  for (const path of ['/zh-CN/futures/home', '/zh-CN/futures/', '/zh-CN/futures/quiz', '/zh-CN/futures/multipleChart', '/zh-CN/futures/multi-symbols', `${tradingPath}/calculator`]) {
    await page.evaluate(path => history.pushState({}, '', path), path);
    await page.clock.runFor(1000);
    // Then the off-route panel is removed even though the old orderbook DOM remains.
    await expect(panel).toHaveCount(0);
  }

  // When the user returns to the original supported contract.
  await page.evaluate(path => history.pushState({}, '', path), tradingPath);
  await page.clock.runFor(1000);

  // Then one panel resumes without any order placement or cancellation.
  await expect(panel).toBeVisible();
  await expect(panel).toHaveCount(1);
  expect((await readFixtureState(page)).events.filter(event => ['order-submitted', 'cancel-requested'].includes(event.type))).toEqual([]);
  expect(host.errors).toEqual([]);
});
