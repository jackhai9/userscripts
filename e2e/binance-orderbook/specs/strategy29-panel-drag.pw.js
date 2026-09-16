import { readFile } from 'node:fs/promises';
import { test, expect, reloadPageWithCoverage } from '../test.js';

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

test('user drags a panel across the chart iframe and restores its saved position after reload', async ({ page }) => {
  // Given a positioned panel overlays an interactive chart iframe and has persistent position storage.
  await page.route(fixtureUrl, route => route.fulfill({ contentType: 'text/html', body: `
    <iframe style="position:fixed;inset:0;width:100%;height:100%;border:0"
      srcdoc="<button onclick='document.body.dataset.clicked=1'>Chart control</button>"></iframe>
    <section style="position:fixed;width:340px;height:200px;background:white">
      <header style="height:34px;background:gray">Strategy 29 <button>Collapse</button></header>
    </section>` }));
  await page.goto(fixtureUrl);
  await install(page);
  // When the user drags the panel header across the iframe and releases the pointer.
  await page.mouse.move(170, 315);
  await page.mouse.down();
  await page.mouse.move(230, 275);
  await page.mouse.up();
  // Then the panel stores the exact new position, releases the chart, and restores the saved location after reload.
  await expect.poll(() => page.evaluate(() => window.savedPositions)).toEqual([{ left: 160, top: 260 }]);
  await expect(page.locator('section')).toHaveCSS('left', '160px');
  await expect(page.locator('section')).toHaveCSS('top', '260px');

  // When the user clicks the chart after releasing the panel header.
  await page.frameLocator('iframe').getByRole('button', { name: 'Chart control' }).click();

  // Then pointer capture no longer blocks the chart control.
  await expect(page.frameLocator('iframe').locator('body')).toHaveAttribute('data-clicked', '1');

  // When the user reloads the page and the panel is installed again.
  await reloadPageWithCoverage(page);
  await install(page);

  // Then the panel restores the exact saved position.
  await expect(page.locator('section')).toHaveCSS('left', '160px');
  await expect(page.locator('section')).toHaveCSS('top', '260px');

  // When the user clicks the header's collapse button without dragging.
  await page.locator('header button').click();

  // Then no spurious drag position is saved.
  expect(await page.evaluate(() => window.savedPositions)).toEqual([]);
});
