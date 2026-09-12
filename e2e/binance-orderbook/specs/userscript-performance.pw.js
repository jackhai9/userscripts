import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';

const artifact = name => fileURLToPath(new URL(`../../../scripts/${name}.user.js`, import.meta.url));

test('CMC valuation updates coalesce while real layout reads stay on the metric cards', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.abort('blockedbyclient'));
  await page.route('https://coinmarketcap.com/zh/currencies/bitcoin/', route => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html><head><meta charset="utf-8"><style>
      body { font: 14px Arial; color: #172032; background: #f8fafc; }
      #stats { margin: 160px 0 0 24px; width: 300px; display: grid; gap: 16px; }
      [data-role="group-item"] { display: flex; justify-content: space-between; padding: 14px; background: white; }
      #prices { margin-top: 40px; }
    </style></head><body><section id="stats">
      <div data-role="group-item"><span id="cap">市值</span><i data-test="icon-market-cap-explainer"></i><span>$123M</span></div>
      <div data-role="group-item"><span id="fdv">FDV</span><i data-test="icon-fully-diluted-mcap-explainer"></i><span>$456M</span></div>
    </section><section id="prices">${Array.from({ length: 1000 }, (_, index) => `<div class="quote"><span>${index}</span><p>Price</p></div>`).join('')}</section></body></html>`,
  }));
  await page.goto('https://coinmarketcap.com/zh/currencies/bitcoin/');
  await page.evaluate(() => {
    const stats = { layoutReads: 0, quoteLayoutReads: 0, scans: 0 };
    window.performanceFixture = stats;
    const rect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (...args) {
      stats.layoutReads += 1;
      if (this.closest('#prices')) stats.quoteLayoutReads += 1;
      return Reflect.apply(rect, this, args);
    };
    const query = document.querySelectorAll.bind(document);
    document.querySelectorAll = selector => {
      if (selector === 'span,p,div') stats.scans += 1;
      return query(selector);
    };
  });
  await page.addScriptTag({ path: artifact('coinmarketcap-valuation-helper') });
  await expect(page.locator('#cap')).toHaveText('流通市值');
  await expect(page.locator('#fdv')).toHaveText('FDV/总估值');
  await expect(page.locator('.jh-cmc-valuation-highlight')).toHaveCount(2);
  const result = await page.evaluate(async () => {
    const stats = window.performanceFixture;
    const before = { ...stats };
    for (let index = 0; index < 10; index += 1) {
      document.querySelector('.quote span').firstChild.data = String(index + 1000);
      await Promise.resolve();
    }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      initialQuoteLayoutReads: before.quoteLayoutReads,
      quoteLayoutReads: stats.quoteLayoutReads - before.quoteLayoutReads,
      scans: stats.scans - before.scans,
      layoutReads: stats.layoutReads - before.layoutReads,
    };
  });
  expect(result).toEqual({ initialQuoteLayoutReads: 0, quoteLayoutReads: 0, scans: 1, layoutReads: 8 });
  expect(errors).toEqual([]);
  await testInfo.attach('operation-counts', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  await page.locator('#stats').screenshot({ path: testInfo.outputPath('valuation-cards.png') });
});

test('m3u8 discovery inspects one changed video in a real 100-video document', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.abort('blockedbyclient'));
  await page.route('https://njav.com/watch/fixture', route => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html><body>${Array.from({ length: 100 }, (_, index) => `<video id="v${index}" preload="none"><source></video>`).join('')}</body></html>`,
  }));
  await page.goto('https://njav.com/watch/fixture');
  await page.evaluate(() => {
    const stats = { documentScans: 0, videoIds: [], requests: [] };
    window.performanceFixture = stats;
    window.XMLHttpRequest = class {
      open(_method, url) { stats.requests.push(url); }
      send() {}
    };
    const query = document.querySelectorAll.bind(document);
    document.querySelectorAll = selector => {
      if (selector === 'video') stats.documentScans += 1;
      return query(selector);
    };
    const elementQuery = Element.prototype.querySelectorAll;
    Element.prototype.querySelectorAll = function (selector) {
      if (this.tagName === 'VIDEO' && selector === 'source') stats.videoIds.push(this.id);
      return Reflect.apply(elementQuery, this, [selector]);
    };
  });
  await page.addScriptTag({ path: artifact('m3u8-downloader') });
  const result = await page.evaluate(async () => {
    const stats = window.performanceFixture;
    stats.documentScans = 0;
    stats.videoIds.length = 0;
    document.querySelector('#v42 source').src = 'https://media.example/changed.m3u8';
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return stats;
  });
  expect(result).toEqual({ documentScans: 0, videoIds: ['v42'], requests: ['https://media.example/changed.m3u8'] });
  expect(errors).toEqual([]);
  await testInfo.attach('operation-counts', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
});
