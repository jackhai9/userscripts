import { readFile } from 'node:fs/promises';
import { test, expect } from '../test.js';
import { createCancelScenario, CURRENT_SYMBOL } from '../scenarios/cancel-current-symbol.js';
import { openUserscriptScenario } from '../helpers/userscript-page.js';

const strategy29 = await readFile(new URL('../../../scripts/binance-strategy29-bollinger.user.js', import.meta.url), 'utf8');

for (const first of [true, false]) {
  test(`independent generated scripts share chart coordination (Strategy29 first=${first})`, async ({ page }) => {
    const { errors } = await openUserscriptScenario(page, createCancelScenario(), first
      ? { beforeOrderbook: strategy29 } : { afterOrderbook: strategy29 });
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
    }, CURRENT_SYMBOL);
    await expect.poll(() => page.evaluate(() => window.__TM_STRATEGY29_DEBUG__.diagnostics.layerSize)).toBe(9);
    expect(await page.evaluate(() => ({
      embedded: Object.hasOwn(window.__TM_CLOSE_LONG_DEBUG__, 'bollingerAlertState'),
      controller: document.querySelector('.chart-widget-root iframe').contentWindow.tradingViewApi[
        Symbol.for('jh-userscripts.chart-marker-save-controller')].version,
      owners: [...window[Symbol.for('jh-userscripts.chart-mutation-owners')].predicates.keys()],
    }))).toEqual({ embedded: false, controller: 1, owners: ['orderbook'] });
    // Reinjecting the complete standalone artifact must reuse its page singleton.
    await page.addScriptTag({ content: strategy29 });
    expect(await page.evaluate(() => window.__TM_STRATEGY29_DEBUG__.diagnostics.layerSize)).toBe(9);
    await page.evaluate(() => window.__TM_STRATEGY29_DEBUG__.dispose());
    expect(await page.evaluate(() => document.querySelector('.chart-widget-root iframe').contentWindow.tradingViewApi.activeChart().getAllShapes())).toEqual([]);
    expect(errors).toEqual([]);
  });
}
