import { test, expect } from '../test.js';
import { createCancelScenario } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario, readFixtureState } from '../helpers/userscript-page.js';

const PANEL = '#jh-binance-close-qty-multiplier-panel';
const ALERT = '#jh-binance-chart-contract-alert';

test('user sees a persistent panel alert when the TradingView bootstrap no longer matches the save filter', async ({ page }) => {
  // Given the generated orderbook runs on a trading page with its panel ready and no dependency break.
  const consoleErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  const host = await openUserscriptScenario(page, createCancelScenario());
  await expect(page.locator(PANEL)).toBeVisible();
  await expect(page.locator(ALERT)).toBeHidden();

  // When a TradingView frame finishes its bootstrap without the widgetReady hook.
  await page.evaluate(() => new Promise(resolve => {
    const frame = document.createElement('iframe');
    frame.id = 'tradingview_contract_probe';
    frame.addEventListener('load', () => queueMicrotask(() => queueMicrotask(() => {
      frame.contentWindow.dispatchEvent(new frame.contentWindow.Event('innerWindowLoad'));
      resolve();
    })), { once: true });
    document.querySelector('.chart-widget-root').append(frame);
  }));

  // Then the panel shows the alert with the broken dependency, and the native save state is exposed for diagnosis.
  await expect(page.locator(ALERT)).toBeVisible();
  await expect(page.locator(ALERT)).toHaveText('⚠ 图表保存保护失效，需更新脚本');
  await expect(page.locator(ALERT)).toHaveAttribute('title', /^币安图表依赖已变化：图表启动钩子。已回退币安原生保存.*widgetReady/);
  expect(await page.evaluate(() => self.__BINANCE_CHART_STORAGE__.orderLineSaves().breaks)).toEqual([
    { reason: 'bootstrap', detail: 'TradingView bootstrap no longer defines widgetReady at innerWindowLoad' },
  ]);
  expect(consoleErrors.filter(text => text.includes('Chart save protection dependency changed'))).toHaveLength(1);

  // When the panel re-renders after a user edit.
  await page.locator('#jh-binance-close-qty-multiplier-input').fill('2');
  await page.locator('#jh-binance-close-qty-multiplier-input').blur();

  // Then the alert remains until the page reloads, and no financial action was taken.
  await expect(page.locator(ALERT)).toBeVisible();
  expect((await readFixtureState(page)).events.filter(({ type }) => ['order-submitted', 'cancel-requested'].includes(type))).toEqual([]);
  expect(host.errors).toEqual([]);
});
