import { readFile } from 'node:fs/promises';
import { test, expect } from '../test.js';
import { createCancelScenario, CURRENT_SYMBOL } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario } from '../helpers/userscript-page.js';
import { installMarkerOverlayHost } from '../helpers/marker-overlay-host.js';

const strategy29 = await readFile(new URL('../../../scripts/binance-strategy29-bollinger.user.js', import.meta.url), 'utf8');

function strategy29Sandbox(source) {
  return `{
    const unsafeWindow = window;
    const GM_xmlhttpRequest = () => { throw new Error('Strategy29 remote summary must remain disabled in this fixture'); };
    const GM_getValue = (_key, fallback) => fallback;
    const GM_setValue = () => {};
    const GM_registerMenuCommand = () => {};
    ${source}
  }`;
}

for (const first of [true, false]) {
  test(`user runs independent Strategy29 and orderbook scripts together (Strategy29 first=${first})`, async ({ page }) => {
    // Given both complete generated artifacts are injected in the declared order with the remote summary disabled.
    const sandboxedStrategy29 = strategy29Sandbox(strategy29);
    const { errors } = await openUserscriptScenario(page, createCancelScenario(), first
      ? { beforeOrderbook: sandboxedStrategy29 } : { afterOrderbook: sandboxedStrategy29 });
    await page.addScriptTag({ content: `window.installMarkerOverlayHost = ${installMarkerOverlayHost.toString()};` });
    // When the host exposes a ready chart with deterministic candles and drawing operations.
    await page.evaluate(symbol => {
      const api = document.querySelector('.chart-widget-root iframe').contentWindow.tradingViewApi;
      const shapes = new Map();
      let sequence = 0, seed = 29, close = 100;
      const rows = Array.from({ length: 512 }, (_, index) => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const open = close;
        close = Math.max(1, close + (seed / 4294967296 - 0.5) * 4);
        return { 0: (index + 1) * 60, 1: open, 2: Math.max(open, close) + 0.5,
          3: Math.min(open, close) - 0.5, 4: close };
      });
      const subscription = () => {
        const callbacks = new Map();
        return { subscribe: (owner, callback) => callbacks.set(owner, callback),
          unsubscribe: owner => callbacks.delete(owner) };
      };
      const intervals = subscription(), loaded = subscription();
      const chart = {
        hasModel: () => true, dataReady: () => true, resolution: () => '1',
        symbol: () => symbol, onIntervalChanged: () => intervals, onDataLoaded: () => loaded,
        exportData: async () => ({ schema: ['time', 'open', 'high', 'low', 'close'].map(type => ({ type })), data: rows }),
        getAllShapes: () => [...shapes].map(([id, s]) => ({ id, name: s.options.shape })),
        getShapeById: id => shapes.get(id),
        removeEntity: id => shapes.delete(id),
        createShape: async (point, options) => {
          const id = 's29-' + (++sequence);
          const properties = { ...options.overrides, icon: options.icon };
          shapes.set(id, { options, getPoints: () => [point], getProperties: () => properties,
            setProperties: next => Object.assign(properties, next) });
          return id;
        },
      };
      api.activeChart = () => chart;
      api.saveChart = callback => callback({ drawings: ['foreign-channel'] });
      window.installMarkerOverlayHost({ document: document.querySelector('.chart-widget-root iframe').contentDocument,
        chart, rows: rows.map(row => [row[0], row[1], row[2], row[3], row[4]]) });
    }, CURRENT_SYMBOL);
    // Then Strategy29 draws nine markers with the current orderbook coordination owner and no native shapes.
    await expect.poll(() => page.evaluate(() => window.__TM_STRATEGY29_DEBUG__.diagnostics.layerSize)).toBe(9);
    expect(await page.evaluate(() => ({
      nativeShapes: document.querySelector('.chart-widget-root iframe').contentWindow.tradingViewApi.activeChart().getAllShapes().length,
      owners: [...window[Symbol.for('jh-userscripts.chart-mutation-owners')].predicates.keys()],
    }))).toEqual({ nativeShapes: 0, owners: ['orderbook'] });
    // When the same complete Strategy29 artifact is injected again.
    await page.addScriptTag({ content: sandboxedStrategy29 });

    // Then the existing page singleton keeps exactly nine markers.
    expect(await page.evaluate(() => window.__TM_STRATEGY29_DEBUG__.diagnostics.layerSize)).toBe(9);

    // When the Strategy29 runtime is disposed.
    await page.evaluate(() => window.__TM_STRATEGY29_DEBUG__.dispose());

    // Then its chart shapes are all removed without uncaught errors.
    expect(await page.evaluate(() => document.querySelector('.chart-widget-root iframe').contentWindow.tradingViewApi.activeChart().getAllShapes())).toEqual([]);
    expect(errors).toEqual([]);
  });
}
