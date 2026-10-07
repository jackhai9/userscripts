import { readFile } from 'node:fs/promises';
import { openStorageLab, STORAGE_LAB_ORIGIN } from './chart-storage-lab.js';

/** Exercise the production writer against the captured native localForage driver. */
export async function openProductionMirrorWriterLab(page, { limits = {} } = {}) {
  await openStorageLab(page, { install: false });
  await page.route(`${STORAGE_LAB_ORIGIN}/{production-writer,json}.js`, async route => {
    const filename = new URL(route.request().url()).pathname === '/production-writer.js'
      ? 'mirror-writer.js' : 'json.js';
    await route.fulfill({
      contentType: 'text/javascript',
      body: await readFile(new URL(`../../../src/binance-chart-storage/${filename}`, import.meta.url), 'utf8'),
    });
  });
  await page.evaluate(async limits => {
    const { createChartMirrorWriter } = await import('/production-writer.js');
    const state = {
      writer: createChartMirrorWriter({ limits }),
      nativeCalls: 0,
      nativeThunk() {
        state.nativeCalls += 1;
        throw new Error('An optimized mirror must not replay its native expression');
      },
      dispatch(entries, target = window.__STORAGE_LAB__.native) {
        return state.writer.dispatch(target, entries, () => {
          state.nativeCalls += 1;
          return entries.map(([key, value]) => target.setItem(key, value));
        });
      },
    };
    window.__MIRROR_WRITER__ = state;
  }, limits);
}
