import { test, expect } from '../test.js';
import { createCancelScenario } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario, readFixtureState } from '../helpers/userscript-page.js';

const nativeSocketFixture = `
  window.__DEPTH_FIXTURE_SOCKET_COUNT__ = 0;
  window.WebSocket = class extends EventTarget {
    constructor() {
      super();
      window.__DEPTH_FIXTURE_SOCKET_COUNT__ += 1;
    }
  };
`;

async function mountDepthChart(page, symbol) {
  await page.evaluate(async (symbol) => {
    const previousFrame = document.querySelector('.chart-widget-root iframe');
    const chartApi = previousFrame.contentWindow.tradingViewApi;
    const host = document.createElement('div');
    host.style.cssText = 'position:relative;height:260px';
    const wrapper = document.createElement('div');
    wrapper.style.height = '100%';
    const frame = document.createElement('iframe');
    frame.title = 'TradingView depth fixture';
    frame.srcdoc = '<!doctype html><body style="margin:0"><div class="chart-markup-table price-axis-container" style="position:fixed;top:0;right:0;width:60px;height:260px;border-left:1px solid #ddd"></div><div id="fixture-symbol" style="padding:12px;font:14px Arial"></div></body>';
    const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
    host.append(wrapper);
    wrapper.append(frame);
    previousFrame.replaceWith(host);
    await loaded;
    frame.contentDocument.querySelector('#fixture-symbol').textContent = `${symbol} — isolated depth fixture`;
    const scale = {
      coordinateToPrice: (y) => 84 - y * 6 / 260,
      getVisiblePriceRange: () => ({ from: 78, to: 84 }),
      getMode: () => 0,
      isInverted: () => false,
    };
    frame.contentWindow.tradingViewApi = {
      ...chartApi,
      activeChart: () => ({
        hasModel: () => true,
        getAllPanesHeight: () => [260],
        getPanes: () => [{ getMainSourcePriceScale: () => scale }],
      }),
    };
    window.dispatchEvent(new Event('resize'));
  }, symbol);
}

for (const symbol of ['BTCUSDT', '龙虾USDT', '4USDT']) {
  test(`generated userscript renders native depth for ${symbol}`, async ({ page }, testInfo) => {
    await page.route('**/*', (route) => route.abort('blockedbyclient'));
    const { errors } = await openUserscriptScenario(page, createCancelScenario({ currentSymbol: symbol }), {
      beforeOrderbook: nativeSocketFixture,
    });
    const snapshotSymbols = [];
    await page.route('https://www.binance.com/fapi/v1/rpiDepth**', async (route) => {
      const url = new URL(route.request().url());
      snapshotSymbols.push(url.searchParams.get('symbol'));
      expect(url.searchParams.get('limit')).toBe('1000');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ lastUpdateId: 101, bids: [['80', '1'], ['79', '2']], asks: [['82', '3'], ['83', '4']] }),
      });
    });
    await mountDepthChart(page, symbol);
    await expect(page.locator('#jh-binance-depth-profile canvas')).toBeVisible();
    await page.evaluate(async (symbol) => {
      const socket = new WebSocket('wss://depth-fixture.invalid/ws');
      const response = fetch(`/fapi/v1/rpiDepth?${new URLSearchParams({ symbol, limit: '1000' })}`);
      socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({
        stream: `${symbol.toLowerCase()}@rpiDepth@500ms`,
        data: { e: 'depthUpdate', s: symbol, st: 1, U: 100, u: 102, pu: 99,
          b: [['80', '2'], ['79', '3']], a: [['82', '4'], ['83', '5']] },
      }) }));
      await (await response).json();
    }, symbol);
    await expect.poll(() => page.evaluate(() => window.__TM_CLOSE_LONG_DEBUG__.nativeDepthState)).toMatchObject({
      status: { symbol, status: 'ready' }, bidCount: 2, askCount: 2,
    });
    await expect(page.locator('#jh-binance-depth-profile .jh-depth-profile-status')).toHaveText('');
    await expect.poll(() => page.locator('#jh-binance-depth-profile canvas').evaluate((canvas) => {
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let green = 0, red = 0;
      for (let index = 0; index < data.length; index += 4) {
        if (data[index] === 14 && data[index + 1] === 203 && data[index + 2] === 129 && data[index + 3] === 255) green += 1;
        if (data[index] === 246 && data[index + 1] === 70 && data[index + 2] === 93 && data[index + 3] === 255) red += 1;
      }
      return { hasBids: green > 0, hasAsks: red > 0 };
    })).toEqual({ hasBids: true, hasAsks: true });
    expect(snapshotSymbols).toEqual([symbol]);
    expect(await page.evaluate(() => window.__DEPTH_FIXTURE_SOCKET_COUNT__)).toBe(1);
    const state = await readFixtureState(page);
    expect(state.orders).toEqual([]);
    expect(state.events.filter((event) => event.type === 'order-submitted' || event.type === 'cancel-requested')).toEqual([]);
    expect(errors).toEqual([]);
    await page.locator('.chart-widget-root').screenshot({ path: testInfo.outputPath('depth-profile.png') });
  });
}

for (const symbol of ['龙虾USDT', '4USDT']) {
  test(`generated cancel flow recognizes ${symbol} without consuming another contract`, async ({ page }) => {
    await page.route('**/*', (route) => route.abort('blockedbyclient'));
    const orders = [
      { id: 'current', symbol, side: 'SELL', price: '90', quantity: '0.01' },
      { id: 'other', symbol: `超级${symbol}`, side: 'SELL', price: '90', quantity: '0.01' },
    ];
    const { errors } = await openUserscriptScenario(page, createCancelScenario({ currentSymbol: symbol, orders }));
    await page.getByRole('button', { name: '撤单', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.locator('[data-order-id="current"]')).toBeVisible();
    await expect(page.locator('[data-order-id="other"]')).toHaveCount(0);
    expect((await readFixtureState(page)).events.filter((event) => event.type === 'cancel-requested')).toEqual([]);
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByText('撤单已取消')).toBeVisible();
    expect((await readFixtureState(page)).orders).toEqual(orders);

    await page.getByRole('button', { name: '撤单', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: '确认', exact: true }).click();
    await expect(page.getByText('撤单已完成')).toBeVisible();
    const state = await readFixtureState(page);
    expect(state.orders).toEqual([orders[1]]);
    expect(state.events.filter((event) => event.type === 'cancel-requested').map((event) => event.symbol)).toEqual([symbol]);
    expect(state.accountTab).toBe('positions');
    expect(state.hideOtherSymbols).toBe(false);
    expect(errors).toEqual([]);
  });
}
