import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

import { renderBinanceFuturesFixture } from '../fixtures/binance-futures.js';

const USERSCRIPT_PATH = fileURLToPath(
  new URL('../../../scripts/binance-orderbook-trade.user.js', import.meta.url),
);
const evidenceByPage = new WeakMap();

function submitResponseBody(response) {
  if (response.outcome === 'success') return { success: true };
  if (response.outcome === 'rejected'
    && typeof response.code === 'string' && response.code
    && typeof response.message === 'string' && response.message) {
    return { success: false, code: response.code, message: response.message };
  }
  throw new Error('A released submit response must explicitly succeed or reject with a reason');
}

function readUserscriptVersion(source) {
  const match = source.match(/^\/\/\s*@version\s+(\S+)/m);
  if (!match) throw new Error('Generated userscript is missing @version metadata');
  return match[1];
}

export function readScenarioEvidence(page) {
  return evidenceByPage.get(page) || null;
}

export async function openUserscriptScenario(page, scenario, { beforeOrderbook = '', afterOrderbook = '' } = {}) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error?.stack || error)));
  const userscriptSource = await readFile(USERSCRIPT_PATH, 'utf8');
  const userscript = {
    version: readUserscriptVersion(userscriptSource),
    sha256: createHash('sha256').update(userscriptSource).digest('hex'),
  };
  evidenceByPage.set(page, { scenario, userscript, errors });
  let placeOrderRequestCount = 0;
  const pendingSubmitResponses = new Map();
  await page.route('https://www.binance.com/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/__binance_orderbook_userscript__.js') {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: beforeOrderbook + '\n' + userscriptSource + '\n' + afterOrderbook,
      });
      return;
    }
    if (url.pathname === '/bapi/fixture-bootstrap') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
      return;
    }
    if (url.pathname === '/bapi/futures/v1/private/future/order/place-order') {
      let response = scenario.host.submitApiResponses[placeOrderRequestCount];
      placeOrderRequestCount += 1;
      if (!response) {
        throw new Error('Fixture received an undeclared order request');
      }
      let delivered;
      if (response.delivery === 'manual') {
        const release = Promise.withResolvers();
        delivered = Promise.withResolvers();
        pendingSubmitResponses.set(placeOrderRequestCount, { response, release, delivered });
        response = await release.promise;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(submitResponseBody(response)),
      });
      delivered?.resolve();
      return;
    }
    if (url.pathname === '/bapi/futures/v6/private/future/user-data/user-position') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: scenario.positions.map((position) => ({
            symbol: position.symbol,
            positionSide: position.side,
            positionAmount: position.side === 'SHORT'
              ? `-${position.quantity}`
              : position.quantity,
          })),
        }),
      });
      return;
    }
    if (url.pathname === '/bapi/futures/v1/private/future/user-data/adjustLeverage') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
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
  await page.locator('#jh-binance-ladder-body').waitFor({ state: 'visible' });
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  return {
    errors,
    userscript,
    /** Network delivery is controlled separately from the page's simulated clock. */
    async releaseSubmitResponse(submitSequence, response) {
      const pending = pendingSubmitResponses.get(submitSequence);
      if (!pending) throw new Error('No pending submit response exists for this sequence');
      const settledResponse = response === undefined ? pending.response : response;
      submitResponseBody(settledResponse);
      pendingSubmitResponses.delete(submitSequence);
      pending.release.resolve(settledResponse);
      await pending.delivered.promise;
    },
    pendingSubmitSequences: () => [...pendingSubmitResponses.keys()],
  };
}

export async function readFixtureState(page) {
  return page.evaluate(() => window.__BINANCE_FIXTURE__.snapshot());
}
