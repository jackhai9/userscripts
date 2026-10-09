import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const output = new URL('../../../output/data-panels-preview/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', output), 'utf8'));
for (const artifact of manifest.artifacts) {
  const source = await readFile(new URL(`../../../scripts/${artifact.name}.user.js`, import.meta.url), 'utf8');
  assert.equal(createHash('sha256').update(source).digest('hex'), artifact.sha256, `Stale preview artifact: ${artifact.name}`);
}
const cases = [
  { name: 'desktop-zh-light', locale: 'zh-CN', theme: 'light', viewport: { width: 1600, height: 1200 } },
  { name: 'desktop-en-dark', locale: 'en', theme: 'dark', viewport: { width: 1600, height: 1200 } },
  { name: 'mobile-zh-light', locale: 'zh-CN', theme: 'light', viewport: { width: 390, height: 844 } },
  { name: 'mobile-en-dark', locale: 'en', theme: 'dark', viewport: { width: 320, height: 900 } },
];
const checks = [];
const browser = await chromium.launch({ headless: true });
try {
  for (const scenario of cases) {
    const context = await browser.newContext({ viewport: scenario.viewport });
    await context.setOffline(true);
    const page = await context.newPage();
    const errors = [];
    const externalRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/^https?:/.test(request.url())) externalRequests.push(request.url()); });
    await page.goto(new URL('index.html', output).href);
    const frame = page.frameLocator('#preview-frame');
    await expect(frame.locator('#jh-binance-cmc-data-panel-footer a')).toHaveText('CMC data-api');
    if (scenario.locale !== 'zh-CN') await page.locator('#locale').selectOption(scenario.locale);
    if (scenario.theme !== 'light') await page.locator('#theme').selectOption(scenario.theme);
    await expect(frame.locator('#jh-binance-trading-data-panel .td-title')).toHaveText(scenario.locale === 'zh-CN' ? '交易数据' : 'Trading data');
    await expect(frame.locator('#jh-binance-cmc-data-panel .cmc-title')).toHaveText(scenario.locale === 'zh-CN' ? 'CMC 数据' : 'CMC data');
    await expect(frame.locator('#jh-binance-trading-data-panel')).toHaveCSS('background-color', scenario.theme === 'dark' ? 'rgb(30, 35, 41)' : 'rgb(255, 255, 255)');
    await expect(frame.locator('[data-role="current-funding"]')).toHaveText('0.00378%');
    await expect(frame.locator('[data-metric="funding"] .td-last-value')).toHaveText('0.000029%');
    await expect(frame.locator('[data-role="funding-period"]')).toHaveText(scenario.locale === 'zh-CN' ? '当前 · 4小时' : 'Current · 4h');
    if (scenario.viewport.width < 500) await frame.locator('[data-metric="funding"]').scrollIntoViewIfNeeded();
    const readings = await page.locator('#preview-frame').evaluate(element => {
      const document = element.contentDocument;
      return {
        viewport: { width: element.contentWindow.innerWidth, height: element.contentWindow.innerHeight },
        versions: element.contentWindow.previewEvidence.versions,
        panels: ['jh-binance-trading-data-panel', 'jh-binance-cmc-data-panel'].map(id => {
          const panel = document.getElementById(id);
          const body = document.getElementById(`${id}-body`);
          const { x, y, width, height } = panel.getBoundingClientRect();
          return {
            id, x, y, width, height, bodyWidth: body.clientWidth, bodyScrollWidth: body.scrollWidth,
            minFont: Math.min(...[...panel.querySelectorAll('small')].filter(node => node.getClientRects().length).map(node => parseFloat(element.contentWindow.getComputedStyle(node).fontSize))),
          };
        }),
      };
    });
    const [trading, cmc] = readings.panels;
    const overlap = Math.max(0, Math.min(trading.x + trading.width, cmc.x + cmc.width) - Math.max(trading.x, cmc.x))
      * Math.max(0, Math.min(trading.y + trading.height, cmc.y + cmc.height) - Math.max(trading.y, cmc.y));
    assert.equal(overlap, 0);
    for (const panel of readings.panels) {
      assert.ok(panel.minFont >= 11, `${panel.id} annotation font is below 11px`);
      assert.ok(panel.bodyScrollWidth <= panel.bodyWidth, `${panel.id} has horizontal overflow`);
      assert.ok(panel.x >= 0 && panel.x + panel.width <= readings.viewport.width, `${panel.id} exceeds viewport width`);
      assert.ok(panel.y >= 0 && panel.y + panel.height <= readings.viewport.height, `${panel.id} exceeds viewport height`);
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(externalRequests, []);
    assert.deepEqual(readings.versions, manifest.artifacts);
    await page.screenshot({ path: fileURLToPath(new URL(`${scenario.name}.png`, output)), fullPage: true });
    checks.push({ ...scenario, ...readings, overlap, errors, externalRequests: externalRequests.length });
    await context.close();
  }
} finally {
  await browser.close();
}
await writeFile(new URL('browser-checks.json', output), JSON.stringify(checks, null, 2) + '\n');
console.log(JSON.stringify(checks.map(({ name, overlap, errors, externalRequests }) => ({ name, overlap, errors, externalRequests }))));
