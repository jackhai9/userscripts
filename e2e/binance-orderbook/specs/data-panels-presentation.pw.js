import { test, expect } from '../test.js';
import { cmcDetail, tradingDataset } from '../../../test/helpers/data-media-migration-host.js';
import {
  createDataPanelsFixture, installDataPanels, DATA_PANEL_NOW, DATA_PANELS, POSITION_AUDIT_KEY,
} from '../helpers/data-panels-host.js';
import { installSimulatedVisibility, setSimulatedVisibility } from '../helpers/simulated-visibility.js';

const SIDE_BY_SIDE = { trading: { left: 1040, top: 60 }, cmc: { left: 520, top: 60 } };

async function completedLayoutFrames(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function storedLayout(page) {
  return page.evaluate(({ panels, key }) => ({
    positions: Object.fromEntries(panels.map(item => [item.name, JSON.parse(localStorage.getItem(item.key))])),
    writes: JSON.parse(localStorage.getItem(key)),
  }), { panels: DATA_PANELS, key: POSITION_AUDIT_KEY });
}

function presentationDataset() {
  const dataset = tradingDataset(DATA_PANEL_NOW, { ratio: 1.234567, funding: 0.00000029 });
  dataset.fundingRate = [
    { symbol: 'BTCUSDT', fundingTime: DATA_PANEL_NOW - 28_800_000, fundingRate: '0.0001' },
    { symbol: 'BTCUSDT', fundingTime: DATA_PANEL_NOW - 14_400_000, fundingRate: '0.00005' },
    { symbol: 'BTCUSDT', fundingTime: DATA_PANEL_NOW, fundingRate: '0.00000029' },
  ];
  return dataset;
}

test('user retains both data panels and expanded details through ten simulated background returns', async ({ page, context }, testInfo) => {
  // Given both generated panels are loaded with expanded details under a controlled browser clock
  const fixture = await createDataPanelsFixture(context, { dataset: presentationDataset() });
  await fixture.open(page, { locale: 'en', controlledClock: true, viewport: { width: 1366, height: 768 } });
  await installSimulatedVisibility(page);
  const trading = page.locator('#jh-binance-trading-data-panel');
  const cmc = page.locator('#jh-binance-cmc-data-panel');
  await trading.locator('[data-metric="funding"] .td-spark-button').click();
  await cmc.locator('[data-expand-metric="fdv"]').click();
  const updated = await trading.locator('[data-role="updated-at"]').textContent();
  await page.evaluate(() => {
    window.retainedDataPanelRows = [...document.querySelectorAll('#jh-binance-trading-data-panel-rows > tr, #jh-binance-cmc-data-panel-rows > tr')];
  });

  // When visibility and suspended animation frames simulate ten one-second tab absences
  for (let index = 0; index < 10; index++) {
    await setSimulatedVisibility(page, true);
    await page.clock.runFor(1_000);
    await setSimulatedVisibility(page, false);
  }

  // Then existing rows, details and funding stay readable without a duplicate HTTP request or fresh history timestamp
  expect(await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#jh-binance-trading-data-panel-rows > tr, #jh-binance-cmc-data-panel-rows > tr')];
    return rows.length === window.retainedDataPanelRows.length && rows.every((row, index) => row === window.retainedDataPanelRows[index]);
  })).toBe(true);
  await expect(trading.locator('[data-role="current-funding"]')).toHaveText('0.00378%');
  await expect(trading.locator('[data-role="funding-countdown"]')).toHaveText('Countdown 03:59:50');
  await expect(trading.locator('[data-role="updated-at"]')).toHaveText(updated);
  await expect(trading.locator('[data-metric="funding"] .td-spark-button')).toHaveAttribute('aria-expanded', 'true');
  await expect(cmc.locator('[data-expand-metric="fdv"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(cmc.locator('#jh-binance-cmc-data-panel-explanation-fdv')).toBeVisible();
  expect(fixture.requests).toHaveLength(10);
  expect(fixture.gmRequests).toHaveLength(3);
  expect(fixture.errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('background-panels-en.png'), fullPage: true });
});

test('user sees an expired funding quote withdrawn immediately after a simulated background settlement', async ({ page, context }) => {
  // Given a generated trading panel has a current quote whose settlement is two seconds away
  const dataset = presentationDataset();
  dataset.premiumIndex.nextFundingTime = DATA_PANEL_NOW + 2_000;
  const fixture = await createDataPanelsFixture(context, { dataset });
  await fixture.open(page, { controlledClock: true, panels: ['trading'] });
  await installSimulatedVisibility(page);
  const trading = page.locator('#jh-binance-trading-data-panel');
  const updated = await trading.locator('[data-role="updated-at"]').textContent();

  // When the tab returns after settlement with no newer funding response available
  await setSimulatedVisibility(page, true);
  await page.clock.runFor(3_000);
  await setSimulatedVisibility(page, false);

  // Then the expired quote is unavailable while settled history and its receipt time remain intact
  await expect(trading.locator('[data-role="current-funding"]')).toHaveText('--');
  await expect(trading.locator('[data-role="funding-countdown"]')).toHaveText('倒计时 等待更新');
  await expect(trading.locator('[data-metric="funding"] .td-last-value')).toHaveText('0.000029%');
  await expect(trading.locator('[data-role="updated-at"]')).toHaveText(updated);
  expect(fixture.requests).toHaveLength(10);
  expect(fixture.errors).toEqual([]);
});

test('user switches both real panels between Chinese and English while retaining precise rates', async ({ page, context }) => {
  // Given the generated panels receive a tiny settled rate and a distinct current rate
  const fixture = await createDataPanelsFixture(context, { dataset: presentationDataset() });
  await fixture.open(page, { positions: SIDE_BY_SIDE });
  const trading = page.locator('#jh-binance-trading-data-panel');
  const cmc = page.locator('#jh-binance-cmc-data-panel');

  // When the Chinese route finishes rendering the current historical response
  await expect(trading.locator('[data-metric="funding"] .td-last-value')).toHaveText('0.000029%');

  // Then names, ratios, current funding and confirmed interval retain their distinct meanings
  await expect(trading.locator('.td-title')).toHaveText('交易数据');
  await expect(cmc.locator('.cmc-title')).toHaveText('CMC 数据');
  await expect(trading.locator('[data-metric="top-accounts"] .td-number')).toHaveText('1.23');
  await expect(trading.locator('[data-role="current-funding"]')).toHaveText('0.00378%');
  await expect(trading.locator('[data-role="funding-period"]')).toHaveText('当前 · 4小时');
  await expect(trading.locator('[data-role="funding-countdown"]')).toHaveText('倒计时 04:00:00');
  await expect(trading.locator('[data-metric="funding"] [data-history-index]')).toHaveCount(3);
  await expect(trading.locator('[data-metric="taker"] .td-unit')).toHaveText('买/卖比');

  // When the same SPA changes to its English route
  await page.evaluate(() => history.pushState({}, '', '/en/futures/BTCUSDT'));

  // Then both panels change their labels without changing the observed numerical values
  await expect(trading.locator('.td-title')).toHaveText('Trading data');
  await expect(cmc.locator('.cmc-title')).toHaveText('CMC data');
  await expect(trading.locator('[data-metric="top-accounts"] .td-name')).toHaveText('Top Trader Long/Short Ratio (Accounts)');
  await expect(trading.locator('[data-metric="top-accounts"] .td-number')).toHaveText('1.23');
  await expect(trading.locator('[data-metric="funding"] .td-last-value')).toHaveText('0.000029%');
  await expect(trading.locator('[data-role="funding-period"]')).toHaveText('Current · 4h');
  await expect(trading.locator('#jh-binance-trading-data-panel-close')).toHaveAttribute('aria-label', 'Close');
  await expect(cmc.locator('#jh-binance-cmc-data-panel-refresh')).toHaveAttribute('aria-label', 'Refresh');
  expect(fixture.errors).toEqual([]);
});

test('user inspects settled history by click and keyboard without joining the current funding rate', async ({ page, context }) => {
  // Given three settled observations accompany an independent current funding snapshot
  const fixture = await createDataPanelsFixture(context, { dataset: presentationDataset() });
  await fixture.open(page, { locale: 'en', positions: SIDE_BY_SIDE });
  const trading = page.locator('#jh-binance-trading-data-panel');
  const chart = trading.locator('[data-metric="funding"] .td-spark-button');

  // When the user opens the last settled point and moves to its predecessor
  await chart.locator('[data-history-index="2"]').click();
  await expect(trading.locator('.td-history-detail time')).toHaveAttribute('datetime', new Date(DATA_PANEL_NOW).toISOString());
  await chart.press('ArrowLeft');

  // Then the detail contains that exact historical time and rate while the current snapshot remains separate
  await expect(trading.locator('.td-history-detail time')).toHaveAttribute('datetime', new Date(DATA_PANEL_NOW - 14_400_000).toISOString());
  await expect(trading.locator('.td-history-value')).toHaveText('0.005%');
  await expect(chart).toHaveAttribute('aria-label', /0\.005%/);
  await expect(trading.locator('[data-role="current-funding"]')).toHaveText('0.00378%');
  await expect(chart.locator('[data-history-index]')).toHaveCount(3);

  // When keyboard navigation selects the first and last observed records and closes inspection
  await chart.press('Home');
  await expect(trading.locator('.td-history-detail time')).toHaveAttribute('datetime', new Date(DATA_PANEL_NOW - 28_800_000).toISOString());
  await chart.press('End');
  await expect(trading.locator('.td-history-value')).toHaveText('0.000029%');
  await chart.press('Escape');

  // Then details close without removing the accessible history control
  await expect(trading.locator('.td-history-detail')).toHaveCount(0);
  await expect(chart).toHaveAttribute('aria-expanded', 'false');
  expect(fixture.errors).toEqual([]);
});

test('user reads separate taker quantities and can expand the CMC interpretation', async ({ page, context }) => {
  // Given both panels have complete public response fixtures with taker buy and sell quantities
  const fixture = await createDataPanelsFixture(context, { dataset: presentationDataset() });
  await fixture.open(page, { locale: 'en', positions: SIDE_BY_SIDE });
  const trading = page.locator('#jh-binance-trading-data-panel');
  const cmc = page.locator('#jh-binance-cmc-data-panel');

  // When the user opens taker history and the CMC price interpretation
  await trading.locator('[data-metric="taker"] .td-spark-button').click();
  await cmc.locator('[data-metric="price"] .cmc-reading-button').click();

  // Then chart details expose both quantity units while interpretation has a visible explanatory row
  await expect(trading.locator('[data-metric="taker"] .td-buy-bar')).toHaveCount(1);
  await expect(trading.locator('[data-metric="taker"] .td-sell-bar')).toHaveCount(1);
  await expect(trading.locator('.td-history-value')).toHaveText('Buy 123.46 BTC · Sell 100 BTC · Buy/sell ratio 1.23');
  await expect(trading.locator('[data-metric="taker"] .td-number')).toHaveText('1.23');
  await expect(cmc.locator('#jh-binance-cmc-data-panel-explanation-price')).toBeVisible();
  await expect(cmc.locator('[data-metric="price"] .cmc-reading-button')).toHaveAttribute('aria-expanded', 'true');
  expect(fixture.errors).toEqual([]);
});

test('user sees the calibrated countdown advance while historical nodes and update time stay unchanged', async ({ page, context }) => {
  // Given the generated trading script runs on a controlled browser clock with complete history
  const fixture = await createDataPanelsFixture(context, { dataset: presentationDataset() });
  await fixture.open(page, { controlledClock: true, panels: ['trading'] });
  const trading = page.locator('#jh-binance-trading-data-panel');
  await expect(trading.locator('[data-role="current-funding"]')).toHaveText('0.00378%');
  const updated = await trading.locator('[data-role="updated-at"]').textContent();
  await page.evaluate(() => {
    window.dataPanelClockNodes = {
      row: document.querySelector('#jh-binance-trading-data-panel [data-metric="funding"]'),
      chart: document.querySelector('#jh-binance-trading-data-panel [data-metric="funding"] svg'),
      footer: document.querySelector('#jh-binance-trading-data-panel-footer'),
    };
  });

  // When exactly one second of business time elapses
  await page.clock.runFor(1_000);

  // Then countdown and age advance without rebuilding settled history or its update timestamp
  await expect(trading.locator('[data-role="funding-countdown"]')).toHaveText('倒计时 03:59:59');
  await expect(trading.locator('[data-role="updated-at"]')).toHaveText(updated);
  await expect(trading.locator('[data-role="elapsed"]')).toHaveText('1秒前');
  expect(await page.evaluate(() => ({
    row: window.dataPanelClockNodes.row === document.querySelector('#jh-binance-trading-data-panel [data-metric="funding"]'),
    chart: window.dataPanelClockNodes.chart === document.querySelector('#jh-binance-trading-data-panel [data-metric="funding"] svg'),
    footer: window.dataPanelClockNodes.footer === document.querySelector('#jh-binance-trading-data-panel-footer'),
  }))).toEqual({ row: true, chart: true, footer: true });
  expect(fixture.errors).toEqual([]);
});

for (const locale of ['zh-CN', 'en']) {
  for (const width of [1366, 320]) {
    test(`user reads a tiny CMC price and ${locale} changes inside their own column at ${width}px`, async ({ page, context }) => {
      // Given a token price needs all fourteen fractional digits to remain distinguishable from zero
      const detail = cmcDetail();
      detail.statistics.price = 0.00000000001234;
      const fixture = await createDataPanelsFixture(context, { detail });

      // When the complete CMC panel renders at the requested width
      await fixture.open(page, { locale, panels: ['cmc'], viewport: { width, height: 768 } });
      const cmc = page.locator('#jh-binance-cmc-data-panel');

      // Then the precise price and changes remain readable without crossing into another column
      await expect(cmc.locator('[data-metric="price"] .cmc-number')).toHaveText('$0.00000000001234');
      const crossing = await cmc.evaluate(panel => [...panel.querySelectorAll('.cmc-number, .cmc-change, .cmc-unit')].flatMap(node => {
        const range = document.createRange();
        range.selectNodeContents(node);
        const text = range.getBoundingClientRect();
        const cell = node.closest('td').getBoundingClientRect();
        return text.left < cell.left || text.right > cell.right
          ? [{ text: node.textContent, left: text.left - cell.left, right: text.right - cell.right }]
          : [];
      }));
      expect(crossing).toEqual([]);
      const body = await cmc.locator('[id$="-body"]').evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }));
      expect(body.scrollWidth).toBeLessThanOrEqual(body.width);
      expect(fixture.errors).toEqual([]);
    });
  }

  test(`user reads every ${locale} data row on a laptop without scrolling and can open the signal rules`, async ({ page, context }) => {
    // Given both panels have complete data and no saved position on a laptop-sized screen
    const fixture = await createDataPanelsFixture(context, { dataset: presentationDataset() });

    // When the generated scripts render their default expanded panels
    await fixture.open(page, { locale, viewport: { width: 1366, height: 768 } });
    const trading = page.locator('#jh-binance-trading-data-panel');
    await expect(trading.locator('[data-role="current-funding"]')).toHaveText('0.00378%');

    // Then all rows and both footers fit without vertical or horizontal scrolling
    await expect(trading.locator('tr[data-metric]')).toHaveCount(8);
    await expect(page.locator('#jh-binance-cmc-data-panel tr[data-metric]')).toHaveCount(12);
    for (const { id } of DATA_PANELS) {
      const body = page.locator(`#${id}-body`);
      const dimensions = await body.evaluate(element => ({
        height: element.clientHeight, scrollHeight: element.scrollHeight,
        width: element.clientWidth, scrollWidth: element.scrollWidth,
      }));
      expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.height);
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width);
      await expect(page.locator(`#${id}-footer`)).toBeInViewport({ ratio: 1 });
    }
    await expect(trading.locator('.td-method-note')).toBeHidden();

    // When the user asks for the composite signal methodology
    await trading.locator('.td-composite-line').click();

    // Then the settled-rate voting rule is available on demand
    await expect(trading.locator('.td-method-note')).toBeVisible();
    await expect(trading.locator('.td-method-note')).toContainText(locale === 'zh-CN' ? '资金费率投票使用最新已结算值' : 'the funding vote uses the latest settled rate');
    expect(fixture.errors).toEqual([]);
  });

  test(`user reads ${locale} panels in both themes on a narrow screen without tiny text or horizontal overflow`, async ({ page, context }) => {
    // Given both generated panels are rendered on a narrow viewport in the light theme
    const fixture = await createDataPanelsFixture(context, { dataset: presentationDataset() });
    await fixture.open(page, { locale, viewport: { width: 390, height: 844 } });
    const lightColors = await page.evaluate(ids => ids.map(id => getComputedStyle(document.getElementById(id)).color), DATA_PANELS.map(panel => panel.id));

    // When the user changes to the dark theme and narrows the viewport further
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width: 320, height: 680 });
    await completedLayoutFrames(page);

    // Then theme colors change while every visible annotation stays readable and within its panel width
    const readings = await page.evaluate(ids => ids.map(id => {
      const panel = document.getElementById(id);
      const body = document.getElementById(`${id}-body`);
      const rect = panel.getBoundingClientRect();
      return {
        color: getComputedStyle(panel).color, right: rect.right,
        bodyWidth: body.clientWidth, bodyScrollWidth: body.scrollWidth,
        minFont: Math.min(...[...panel.querySelectorAll('small')].filter(node => node.getClientRects().length > 0).map(node => parseFloat(getComputedStyle(node).fontSize))),
      };
    }), DATA_PANELS.map(panel => panel.id));
    for (let index = 0; index < readings.length; index += 1) {
      expect(readings[index].color).not.toBe(lightColors[index]);
      expect(readings[index].right).toBeLessThanOrEqual(320);
      expect(readings[index].bodyScrollWidth).toBeLessThanOrEqual(readings[index].bodyWidth);
      expect(readings[index].minFont).toBeGreaterThanOrEqual(11);
    }
    expect(fixture.errors).toEqual([]);
  });
}

test('user can see both expanded panels at their default desktop positions without overlap', async ({ page, context }) => {
  // Given a desktop has no saved position for either panel
  const fixture = await createDataPanelsFixture(context, { dataset: presentationDataset() });

  // When both generated panels finish their first real render
  await fixture.open(page);

  // Then the two default panels do not hide each other
  const trading = await page.locator('#jh-binance-trading-data-panel').boundingBox();
  const cmc = await page.locator('#jh-binance-cmc-data-panel').boundingBox();
  const overlapWidth = Math.max(0, Math.min(trading.x + trading.width, cmc.x + cmc.width) - Math.max(trading.x, cmc.x));
  const overlapHeight = Math.max(0, Math.min(trading.y + trading.height, cmc.y + cmc.height) - Math.max(trading.y, cmc.y));
  expect({ overlapArea: overlapWidth * overlapHeight, trading, cmc }).toMatchObject({ overlapArea: 0 });
  expect(fixture.errors).toEqual([]);
});

for (const installation of [['trading', 'cmc'], ['cmc', 'trading']]) {
  test(`user receives separate desktop columns and narrow-screen scroll areas when ${installation[0]} loads first`, async ({ page, context }) => {
    // Given neither panel has saved coordinates and scripts load in the specified order
    const fixture = await createDataPanelsFixture(context, { dataset: presentationDataset() });
    await fixture.open(page, { panels: installation });
    const trading = page.locator('#jh-binance-trading-data-panel');
    const cmc = page.locator('#jh-binance-cmc-data-panel');

    // When both generated scripts have completed their first desktop render
    await expect(trading.locator('[data-role="updated-at"]')).toContainText('更新于');
    await expect(cmc.locator('#jh-binance-cmc-data-panel-footer a')).toHaveText('CMC data-api');

    // Then each desktop panel has its own column regardless of installation order
    expect(await trading.boundingBox()).toMatchObject({ x: 1200, y: 60, width: 384 });
    expect(await cmc.boundingBox()).toMatchObject({ x: 800, y: 60, width: 384 });

    // When the viewport becomes too narrow for adjacent columns
    await page.setViewportSize({ width: 320, height: 680 });
    await completedLayoutFrames(page);

    // Then both headers stay reachable above separate scrolling bodies with an eight-pixel gap
    const readings = await page.evaluate(ids => ids.map(id => {
      const panel = document.getElementById(id);
      const body = document.getElementById(`${id}-body`);
      const { x, y, width, height, bottom } = panel.getBoundingClientRect();
      return { x, y, width, height, bottom, bodyHeight: body.clientHeight, bodyScrollHeight: body.scrollHeight };
    }), DATA_PANELS.map(panel => panel.id));
    expect(readings[0].y).toBe(8);
    expect(readings[1].y - readings[0].bottom).toBeCloseTo(8, 1);
    expect(readings[1].bottom).toBeLessThanOrEqual(680);
    expect(Math.abs(readings[0].height - readings[1].height)).toBeLessThanOrEqual(1);
    for (const reading of readings) {
      expect(reading.x).toBeGreaterThanOrEqual(0);
      expect(reading.x + reading.width).toBeLessThanOrEqual(320);
      expect(reading.bodyHeight).toBeGreaterThan(0);
      expect(reading.bodyScrollHeight).toBeGreaterThan(reading.bodyHeight);
    }
    expect(await page.evaluate(({ panels, key }) => ({
      positions: panels.map(panel => localStorage.getItem(panel.key)), writes: JSON.parse(localStorage.getItem(key)),
    }), { panels: DATA_PANELS, key: POSITION_AUDIT_KEY })).toEqual({ positions: [null, null], writes: [] });
    expect(fixture.errors).toEqual([]);
  });
}

for (const panel of DATA_PANELS) {
  test(`user gets an independent top-right default when only the ${panel.name} script is installed`, async ({ page, context }) => {
    // Given a desktop has no prior position preference and only one data script
    const fixture = await createDataPanelsFixture(context, { dataset: presentationDataset() });

    // When the selected generated script finishes its initial response
    await fixture.open(page, { panels: [panel.name] });

    // Then its full panel uses the single-panel top-right default and creates no saved coordinates
    expect(await page.locator(`#${panel.id}`).boundingBox()).toMatchObject({ x: 1600 - panel.width - 16, y: 60, width: panel.width });
    await expect(page.locator(`#${DATA_PANELS.find(candidate => candidate.name !== panel.name).id}`)).toHaveCount(0);
    expect(await page.evaluate(({ positionKey, auditKey }) => ({
      position: localStorage.getItem(positionKey), writes: JSON.parse(localStorage.getItem(auditKey)),
    }), { positionKey: panel.key, auditKey: POSITION_AUDIT_KEY })).toEqual({ position: null, writes: [] });
    expect(fixture.errors).toEqual([]);
  });

  test(`user keeps saved coordinates when the ${panel.name} panel closes and the remaining panel is removed by navigation`, async ({ page, context }) => {
    // Given each panel has a distinct user-saved position
    const fixture = await createDataPanelsFixture(context, { dataset: presentationDataset() });
    await fixture.open(page, { positions: SIDE_BY_SIDE });
    const remaining = DATA_PANELS.find(candidate => candidate.name !== panel.name);

    // When the user closes one panel and resizes the surviving panel's viewport
    await page.locator(`#${panel.id}-close`).click();
    await page.setViewportSize({ width: 1360, height: 900 });
    await completedLayoutFrames(page);

    // Then the remaining panel projects its saved preference and closing writes no coordinates
    await expect(page.locator(`#${panel.id}`)).toBeHidden();
    expect(await page.locator(`#${remaining.id}`).boundingBox()).toMatchObject({
      x: Math.min(SIDE_BY_SIDE[remaining.name].left, 1360 - remaining.width),
      y: SIDE_BY_SIDE[remaining.name].top,
    });
    expect(await page.evaluate(({ panels, key }) => ({
      positions: Object.fromEntries(panels.map(item => [item.name, JSON.parse(localStorage.getItem(item.key))])),
      writes: JSON.parse(localStorage.getItem(key)),
    }), { panels: DATA_PANELS, key: POSITION_AUDIT_KEY })).toEqual({ positions: SIDE_BY_SIDE, writes: [] });

    // When navigation removes the active panel and the desktop size returns
    await page.evaluate(() => history.pushState({}, '', '/en/futures'));
    await expect(page.locator(`#${remaining.id}`)).toHaveCount(0);
    await page.setViewportSize({ width: 1600, height: 1200 });

    // Then removed layout listeners cannot replace either stored user preference
    expect(await page.evaluate(({ panels, key }) => ({
      positions: Object.fromEntries(panels.map(item => [item.name, JSON.parse(localStorage.getItem(item.key))])),
      writes: JSON.parse(localStorage.getItem(key)),
    }), { panels: DATA_PANELS, key: POSITION_AUDIT_KEY })).toEqual({ positions: SIDE_BY_SIDE, writes: [] });
    expect(fixture.errors).toEqual([]);
  });
}

test('user releases a stationary CMC header after the trading panel mounts without saving its automatic move', async ({ page, context }) => {
  // Given only CMC is mounted and its header has a pressed mouse without any movement
  const fixture = await createDataPanelsFixture(context);
  await fixture.open(page, { panels: ['cmc'] });
  const header = await page.locator('#jh-binance-cmc-data-panel-header').boundingBox();
  await page.mouse.move(header.x + 14, header.y + 14);
  await page.mouse.down();

  // When trading mounts and automatically moves the CMC panel into the adjacent column
  await installDataPanels(page, { panels: ['trading'] });
  await expect.poll(async () => (await page.locator('#jh-binance-cmc-data-panel').boundingBox()).x).toBe(800);
  await page.mouse.up();
  await completedLayoutFrames(page);

  // Then the layout event cancels the stationary gesture and cannot turn it into a saved drag
  expect(await storedLayout(page)).toEqual({ positions: { trading: null, cmc: null }, writes: [] });
  expect(fixture.errors).toEqual([]);
});

test('user releases a stationary CMC header after its peer closes without saving its automatic move', async ({ page, context }) => {
  // Given both panels are mounted and the CMC header is pressed without pointer movement
  const fixture = await createDataPanelsFixture(context);
  await fixture.open(page);
  const header = await page.locator('#jh-binance-cmc-data-panel-header').boundingBox();
  await page.mouse.move(header.x + 14, header.y + 14);
  await page.mouse.down();

  // When keyboard activation closes trading while the mouse remains pressed on CMC
  await page.locator('#jh-binance-trading-data-panel-close').focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await page.locator('#jh-binance-cmc-data-panel').boundingBox()).x).toBe(1200);
  await page.mouse.up();
  await completedLayoutFrames(page);

  // Then the automatic single-panel layout cannot be recorded as a completed user drag
  expect(await storedLayout(page)).toEqual({ positions: { trading: null, cmc: null }, writes: [] });
  expect(fixture.errors).toEqual([]);
});

test('user keeps the one saved panel coordinate when the other panel uses an automatic layout', async ({ page, context }) => {
  // Given only CMC has a saved position even though it overlaps the usual trading column
  const fixture = await createDataPanelsFixture(context);
  const saved = { left: 1080, top: 60 };
  await fixture.open(page, { positions: { cmc: saved } });

  // When the desktop shrinks and then returns to its original size
  await page.setViewportSize({ width: 1000, height: 760 });
  await expect.poll(async () => (await page.locator('#jh-binance-cmc-data-panel').boundingBox()).x).toBe(616);
  await page.setViewportSize({ width: 1600, height: 1200 });
  await completedLayoutFrames(page);

  // Then the exact saved preference returns and automatic layout does not replace either position key
  expect(await page.locator('#jh-binance-cmc-data-panel').boundingBox()).toMatchObject({ x: saved.left, y: saved.top });
  expect(await storedLayout(page)).toEqual({ positions: { trading: null, cmc: saved }, writes: [] });
  expect(fixture.errors).toEqual([]);
});

test('user saves a collapsed panel lower once and expands a body that fits the remaining viewport height', async ({ page, context }) => {
  // Given a fully loaded trading panel is collapsed at its default position without a stored preference
  const fixture = await createDataPanelsFixture(context);
  await fixture.open(page, { panels: ['trading'] });
  const panel = page.locator('#jh-binance-trading-data-panel');
  await expect(panel.locator('[data-role="current-funding"]')).toHaveText('0.00378%');
  await expect(panel.locator('[data-role="funding-period"]')).toHaveText('当前 · 4小时');
  const initial = await panel.boundingBox();
  const target = { left: 80, top: 900 };
  await page.locator('#jh-binance-trading-data-panel-collapse').click();
  await expect(page.locator('#jh-binance-trading-data-panel-body')).toBeHidden();
  await page.mouse.move(initial.x + 14, initial.y + 14);
  await page.mouse.down();

  // When the user drags the collapsed header lower and expands the saved panel again
  await page.mouse.move(target.left + 14, target.top + 14, { steps: 3 });
  await page.mouse.up();
  await completedLayoutFrames(page);
  await page.locator('#jh-binance-trading-data-panel-collapse').click();
  await expect(page.locator('#jh-binance-trading-data-panel-body')).toBeVisible();

  // Then one saved preference owns the position while automatic height recalculation writes nothing else
  const final = await panel.boundingBox();
  expect(final).toMatchObject({ x: target.left, y: target.top });
  expect(final.height).toBeLessThan(initial.height);
  expect(final.y + final.height).toBeLessThanOrEqual(1192);
  expect(await storedLayout(page)).toEqual({
    positions: { trading: target, cmc: null },
    writes: [{ key: DATA_PANELS[0].key, value: target }],
  });
  expect(fixture.errors).toEqual([]);
});
