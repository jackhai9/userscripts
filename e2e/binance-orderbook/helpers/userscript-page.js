import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

import { renderBinanceFuturesFixture } from '../fixtures/binance-futures.js';

const USERSCRIPT_PATH = fileURLToPath(
  new URL('../../../scripts/binance-orderbook-trade.user.js', import.meta.url),
);

export async function openUserscriptScenario(page, scenario) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error?.stack || error)));
  const userscriptSource = await readFile(USERSCRIPT_PATH, 'utf8');
  await page.route('https://www.binance.com/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/__binance_orderbook_userscript__.js') {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: userscriptSource,
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: renderBinanceFuturesFixture(scenario),
    });
  });
  await page.route('https://fapi.binance.com/fapi/v1/exchangeInfo**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        symbols: [scenario.currentSymbol, 'BTCUSDT'].map((symbol) => ({
          symbol,
          filters: [
            { filterType: 'LOT_SIZE', minQty: '0.01', stepSize: '0.01' },
            { filterType: 'MARKET_LOT_SIZE', minQty: '0.01', stepSize: '0.01' },
            { filterType: 'MIN_NOTIONAL', notional: '5' },
          ],
        })),
      }),
    });
  });

  await page.goto(`https://www.binance.com/zh-CN/futures/${scenario.currentSymbol}`);
  await page.locator('#jh-binance-close-qty-multiplier-panel').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: '撤本币挂单' }).waitFor({ state: 'visible' });
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  return { errors };
}

export async function readFixtureState(page) {
  return page.evaluate(() => window.__BINANCE_FIXTURE__.snapshot());
}
