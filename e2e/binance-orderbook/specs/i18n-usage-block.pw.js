import { test, expect } from '../test.js';
import { createCancelScenario } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario } from '../helpers/userscript-page.js';

test('user page never creates Binance usage telemetry transactions while other databases keep working', async ({ page }) => {
  // Given the generated orderbook runs on a trading page.
  const host = await openUserscriptScenario(page, createCancelScenario());

  // When page code opens the usage database the way Binance does, and opens an unrelated database.
  const result = await page.evaluate(async () => {
    const usage = await new Promise((resolve, reject) => {
      const request = indexedDB.open('pika-i18n-usage', 1);
      request.onsuccess = () => resolve('opened');
      request.onerror = () => reject(request.error);
    }).catch(error => error.name);
    const other = await new Promise(resolve => {
      const request = indexedDB.open('fixture-translations', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('keys');
      request.onsuccess = () => { request.result.close(); resolve('opened'); };
      request.onerror = () => resolve(request.error.name);
    });
    const names = (await indexedDB.databases()).map(database => database.name);
    return { usage, other, usageExists: names.includes('pika-i18n-usage'), stats: self.__BINANCE_I18N_USAGE__.snapshot() };
  });

  // Then the usage database is never created, other databases open, and no dependency alert is shown.
  expect(result).toEqual({ usage: 'NotAllowedError', other: 'opened', usageExists: false, stats: { blocked: 1 } });
  await expect(page.locator('#jh-binance-dependency-alert')).toBeHidden();
  expect(host.errors).toEqual([]);
});

test('user sees the dependency alert when usage telemetry moves to a renamed database', async ({ page }) => {
  // Given the generated orderbook runs on a trading page with its panel visible.
  const host = await openUserscriptScenario(page, createCancelScenario());
  await expect(page.locator('#jh-binance-close-qty-multiplier-panel')).toBeVisible();

  // When page code opens a usage-like database under another name.
  await page.evaluate(() => new Promise(resolve => {
    const request = indexedDB.open('pika-i18n-usage-v2', 1);
    request.onsuccess = () => { request.result.close(); resolve(); };
  }));

  // Then the panel names the translation usage block in its alert.
  await expect(page.locator('#jh-binance-dependency-alert')).toBeVisible();
  await expect(page.locator('#jh-binance-dependency-alert')).toHaveAttribute('title', /^翻译统计拦截失效（统计数据库名称）/);
  expect(host.errors).toEqual([]);
});
