import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const source = await readFile(new URL('../../../src/binance-strategy29-bollinger/dom/panel-position.js', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const fixtureUrl = 'https://panel.example.test/';

async function install(page) {
  await page.evaluate(async url => {
    const { installPanelPosition } = await import(url);
    window.savedPositions = [];
    window.panelPosition = installPanelPosition(document, document.querySelector('section'), document.querySelector('header'), {
      initialPosition: JSON.parse(localStorage.getItem('position') ?? '{"left":100,"top":300}'),
      savePosition(position) {
        window.savedPositions.push(position);
        localStorage.setItem('position', JSON.stringify(position));
      },
    });
  }, moduleUrl);
}

test('header drag crosses a chart iframe, releases capture and restores the saved position', async ({ page }) => {
  await page.route(fixtureUrl, route => route.fulfill({ contentType: 'text/html', body: `
    <iframe style="position:fixed;inset:0;width:100%;height:100%;border:0"
      srcdoc="<button onclick='document.body.dataset.clicked=1'>Chart control</button>"></iframe>
    <section style="position:fixed;width:340px;height:200px;background:white">
      <header style="height:34px;background:gray">Strategy 29 <button>Collapse</button></header>
    </section>` }));
  await page.goto(fixtureUrl);
  await install(page);
  await page.mouse.move(170, 315);
  await page.mouse.down();
  await page.mouse.move(230, 275);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.savedPositions)).toEqual([{ left: 160, top: 260 }]);
  await expect(page.locator('section')).toHaveCSS('left', '160px');
  await expect(page.locator('section')).toHaveCSS('top', '260px');
  await page.frameLocator('iframe').getByRole('button', { name: 'Chart control' }).click();
  await expect(page.frameLocator('iframe').locator('body')).toHaveAttribute('data-clicked', '1');
  await page.reload();
  await install(page);
  await expect(page.locator('section')).toHaveCSS('left', '160px');
  await expect(page.locator('section')).toHaveCSS('top', '260px');
  await page.locator('header button').click();
  expect(await page.evaluate(() => window.savedPositions)).toEqual([]);
});
