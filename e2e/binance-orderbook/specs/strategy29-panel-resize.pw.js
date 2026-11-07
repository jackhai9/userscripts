import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { test, expect } from '../test.js';

const bundle = await build({ entryPoints: ['src/binance-strategy29-bollinger/dom/strategy29-summary-panel.js'],
  bundle: true, write: false, format: 'iife', globalName: 'summaryApi' });
const status = JSON.parse(await readFile(new URL('../../../test/fixtures/strategy29-gateway-status.json', import.meta.url)));
const events = JSON.parse(await readFile(new URL('../../../test/fixtures/strategy29-gateway-events.json', import.meta.url)));

/** Two animation boundaries include native resize delivery and its resulting paint. */
async function finishLayout(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function expectInsideViewport(page) {
  await expect.poll(() => page.evaluate(() => {
    const box = document.getElementById('jh-strategy29-summary-panel').getBoundingClientRect();
    return box.left >= 0 && box.top >= 0 && box.right <= innerWidth + 0.5 && box.bottom <= innerHeight + 0.5;
  })).toBe(true);
}

test('user receives same-size summary updates without forced geometry while native resizing preserves viewport bounds', async ({ page }) => {
  // Given the real panel starts at the bottom of a browser viewport with native resize delivery instrumentation.
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1100, height: 1000 });
  await page.setContent('<!doctype html><html><body style="background:#0b0e11"></body></html>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(({ status, events }) => {
    window.panelEvidence = { reads: 0, deliveries: 0, disconnected: 0, observations: [], positions: [], collapsed: [] };
    window.addEventListener('error', event => { window.panelEvidence.error = event.message; });
    const NativeResizeObserver = window.ResizeObserver;
    window.ResizeObserver = class extends NativeResizeObserver {
      constructor(callback) {
        super((entries, observer) => {
          window.panelEvidence.deliveries += 1;
          callback(entries, observer);
        });
      }
      observe(target, options) {
        window.panelEvidence.observations.push({ id: target.id, box: options.box });
        super.observe(target, options);
      }
      disconnect() {
        window.panelEvidence.disconnected += 1;
        super.disconnect();
      }
    };
    window.summaryPanel = summaryApi.createStrategy29SummaryPanel(document, 'BTC/USDT:USDT', {
      locale: 'en', loadPosition: () => ({ left: 730, top: 960 }),
      savePosition: value => window.panelEvidence.positions.push(value),
      loadCollapsed: () => false, saveCollapsed: value => window.panelEvidence.collapsed.push(value),
    });
    window.summaryElement = document.getElementById('jh-strategy29-summary-panel');
    const nativeRect = window.summaryElement.getBoundingClientRect;
    window.summaryElement.getBoundingClientRect = function () {
      window.panelEvidence.reads += 1;
      return nativeRect.call(this);
    };
    window.summaryPanel.renderStatus(status);
    window.summaryPanel.addEvents(events.events, events.observed_at_ms);
  }, { status, events });
  await finishLayout(page);
  await expectInsideViewport(page);
  const initial = await page.evaluate(() => ({ ...window.panelEvidence, height: window.summaryElement.offsetHeight }));
  expect(initial.observations).toEqual([{ id: 'jh-strategy29-summary-panel', box: 'border-box' }]);
  expect(initial.deliveries).toBeGreaterThan(0);

  // When ten polling cycles change freshness within the existing border box.
  await page.evaluate(({ status, events }) => {
    window.panelEvidence.reads = 0;
    window.panelEvidence.deliveries = 0;
    for (let index = 1; index <= 10; index += 1) {
      window.summaryPanel.renderStatus({ ...status, observed_at_ms: status.observed_at_ms + index * 1000 });
      window.summaryPanel.addEvents([], events.observed_at_ms + index * 1000);
    }
  }, { status, events });
  await finishLayout(page);

  // Then native observation reports no size change and polling performs no geometry read or position save.
  expect(await page.evaluate(() => ({ reads: window.panelEvidence.reads, deliveries: window.panelEvidence.deliveries,
    positions: window.panelEvidence.positions, rows: window.summaryElement.querySelectorAll('[data-role=remote-event]').length })))
    .toEqual({ reads: 0, deliveries: 0, positions: [], rows: 2 });

  // When expanding diagnostics grows the panel at the viewport bottom.
  await page.locator('[data-role=diagnostics] > summary').click();
  await finishLayout(page);

  // Then actual border-box growth moves the panel inside the viewport without a resize loop.
  await expectInsideViewport(page);
  expect(await page.locator('#jh-strategy29-summary-panel').evaluate(node => node.offsetHeight)).toBeGreaterThan(initial.height);
  expect(await page.evaluate(() => window.panelEvidence.deliveries)).toBe(1);

  // When the user folds the panel and drags its header toward the viewport bottom.
  await page.locator('[data-role=collapse]').click();
  await finishLayout(page);
  const header = await page.locator('#jh-strategy29-summary-panel header').boundingBox();
  await page.mouse.move(header.x + 35, header.y + 15);
  await page.mouse.down();
  await page.mouse.move(990, 980, { steps: 4 });
  await page.mouse.up();
  await finishLayout(page);

  // Then pointer completion persists exactly one bounded position and a folded presentation.
  await expectInsideViewport(page);
  expect(await page.evaluate(() => window.panelEvidence.positions.length)).toBe(1);
  expect(await page.evaluate(() => window.panelEvidence.collapsed)).toEqual([true]);

  // When the user expands the panel, switches language and shrinks the viewport.
  await page.locator('[data-role=collapse]').click();
  await finishLayout(page);
  await expectInsideViewport(page);
  await page.evaluate(() => window.summaryPanel.setLocale('zh-CN'));
  await finishLayout(page);
  await expectInsideViewport(page);
  await page.setViewportSize({ width: 700, height: 680 });
  await finishLayout(page);

  // Then the translated content remains visible, event identities survive, and only the drag saved coordinates.
  await expectInsideViewport(page);
  await expect(page.locator('#jh-strategy29-summary-panel header strong')).toHaveText('Strategy 29 汇总');
  expect(await page.locator('[data-role=remote-event]').evaluateAll(nodes => nodes.map(node => node.dataset.eventId)))
    .toEqual(events.events.toSorted((left, right) => right.bar_close_ms - left.bar_close_ms || right.sequence - left.sequence).map(event => event.event_id));
  expect(await page.evaluate(() => window.panelEvidence.positions.length)).toBe(1);
  expect(await page.evaluate(() => window.panelEvidence.collapsed)).toEqual([true, false]);
  await page.screenshot({ path: '/tmp/strategy29-panel-resize.png' });

  // When the panel is destroyed and its retained element changes size off-document.
  await page.evaluate(() => {
    window.summaryPanel.destroy();
    window.panelEvidence.reads = 0;
    window.panelEvidence.deliveries = 0;
    window.summaryElement.style.width = '200px';
    window.dispatchEvent(new Event('resize'));
  });
  await finishLayout(page);

  // Then the native observer is disconnected and teardown leaves no geometry work or browser error.
  expect(await page.evaluate(() => ({ reads: window.panelEvidence.reads, deliveries: window.panelEvidence.deliveries,
    disconnected: window.panelEvidence.disconnected, attached: window.summaryElement.isConnected, error: window.panelEvidence.error ?? null })))
    .toEqual({ reads: 0, deliveries: 0, disconnected: 1, attached: false, error: null });
  expect(errors).toEqual([]);
});
