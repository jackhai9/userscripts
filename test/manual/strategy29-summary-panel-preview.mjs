import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { build } from 'esbuild';

// Render the actual panel module with synthetic gateway data and no live connections.
const status = JSON.parse(await readFile(new URL('../fixtures/strategy29-gateway-status.json', import.meta.url), 'utf8'));
const events = JSON.parse(await readFile(new URL('../fixtures/strategy29-gateway-events.json', import.meta.url), 'utf8'));
const bundle = await build({
  stdin: {
    contents: "export { createStrategy29SummaryPanel } from './src/binance-strategy29-bollinger/dom/strategy29-summary-panel.js';",
    resolveDir: process.cwd(),
    sourcefile: 'strategy29-summary-panel-preview.js',
  },
  bundle: true,
  write: false,
  format: 'esm',
});
const sourceUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`;
const output = await mkdtemp(join(tmpdir(), 'strategy29-summary-panel-'));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent(`
    <html lang="en"><body style="margin:0;background:#181A20;color:#EAECEF;font-family:system-ui">
      <div style="height:42px;border-bottom:1px solid #2B3139;padding:14px 24px;font-weight:700">BTCUSDT · Synthetic chart · No live connection</div>
      <div style="position:relative;height:825px;background:linear-gradient(#20242c 1px,transparent 1px),linear-gradient(90deg,#20242c 1px,transparent 1px);background-size:64px 64px">
        <div style="position:absolute;left:80px;top:280px;color:#5E6673">Synthetic chart area</div>
      </div>
    </body></html>
  `);
  await page.evaluate(async ({ sourceUrl, status, events }) => {
    const { createStrategy29SummaryPanel } = await import(sourceUrl);
    const panel = createStrategy29SummaryPanel(document, 'BTC/USDT:USDT', {
      maxEvents: 8, locale: 'en', loadPosition: () => null, savePosition: value => { window.fixturePosition = value; },
    });
    panel.setConnection('connected', { zhCN: '已连接', en: 'Connected' });
    panel.renderStatus(status);
    panel.addEvents(events.events, events.observed_at_ms);
    window.fixturePanel = panel;
  }, { sourceUrl, status, events });
  const panel = page.locator('#jh-strategy29-summary-panel');
  await panel.waitFor({ state: 'visible' });
  assert.equal(await panel.locator('[data-role="unit"]').count(), 2);
  assert.equal(await panel.locator('[data-role="remote-event"]').count(), 2);
  assert.match(await panel.locator('[data-role="delivery"]').textContent(), /Global delivery/);
  assert.match(await panel.locator('[data-role="events-freshness"]').textContent(), /Events checked/);
  await panel.screenshot({ path: join(output, 'connected.png') });
  await panel.locator('[data-role="collapse"]').click();
  assert.equal(await panel.locator('[data-role="body"]').isVisible(), false);
  await panel.locator('[data-role="collapse"]').click();
  const box = await panel.boundingBox();
  assert.equal(box.width, 340);
  assert.equal(box.x >= 0 && box.y >= 0 && box.y + box.height <= 900, true);
  await page.evaluate(() => window.fixturePanel.setLocale('zh-CN'));
  assert.match(await panel.textContent(), /Strategy 29 汇总/);
  assert.match(await panel.textContent(), /看跌预警/);
  assert.match(await panel.locator('[data-role="connection"]').textContent(), /已连接/);
  await panel.screenshot({ path: join(output, 'chinese.png') });
  const beforeDrag = await panel.boundingBox();
  const header = await panel.locator('header').boundingBox();
  await page.mouse.move(header.x + 24, header.y + 14);
  await page.mouse.down();
  await page.mouse.move(224, 114, { steps: 5 });
  await page.mouse.up();
  const moved = await panel.boundingBox();
  assert.equal(Math.round(moved.x), Math.round(beforeDrag.x + 224 - header.x - 24));
  assert.equal(Math.round(moved.y), Math.round(beforeDrag.y + 114 - header.y - 14));
  assert.deepEqual(await page.evaluate(() => window.fixturePosition), { left: moved.x, top: moved.y });
  await page.evaluate(() => {
    window.fixtureResizeDelivered = false;
    window.addEventListener('resize', () => { window.fixtureResizeDelivered = true; }, { once: true });
  });
  await page.setViewportSize({ width: 390, height: 600 });
  await page.waitForFunction(() => window.fixtureResizeDelivered, null, { timeout: 5000 });
  const narrow = await panel.boundingBox();
  assert.equal(narrow.x >= 0 && narrow.y >= 0 && narrow.x + narrow.width <= 390 && narrow.y + narrow.height <= 600, true, JSON.stringify({ narrow, viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight, left: document.getElementById('jh-strategy29-summary-panel').style.left, top: document.getElementById('jh-strategy29-summary-panel').style.top })) }));
  await panel.screenshot({ path: join(output, 'chinese-narrow.png') });
  await page.evaluate(() => window.fixturePanel.setLocale('en'));
  assert.match(await panel.textContent(), /Bearish warning/);
  assert.equal(await panel.locator('[data-role="remote-event"]').count(), 2);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ output, checked: ['two-timeframe-status', 'two-events', 'global-delivery-label', 'separate-freshness', 'collapse', 'viewport', 'Chinese-English-retained-state', 'header-drag-position-storage', 'narrow-viewport'], pageErrors: errors }));
} finally {
  await browser.close();
}
