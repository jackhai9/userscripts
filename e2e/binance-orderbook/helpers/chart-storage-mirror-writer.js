import { readFile } from 'node:fs/promises';
import { openStorageLab, STORAGE_LAB_ORIGIN } from './chart-storage-lab.js';

/** Route only the new writer; the existing lab owns every other request. */
export async function openMirrorWriterLab(page, { limits = {} } = {}) {
  await openStorageLab(page, { install: false });
  await page.route(`${STORAGE_LAB_ORIGIN}/mirror-writer.js`, async route => {
    await route.fulfill({
      contentType: 'text/javascript',
      body: await readFile(new URL('../../../experiments/binance-chart-storage/mirror-writer.js', import.meta.url), 'utf8'),
    });
  });
  await page.evaluate(async limits => {
    const { createChartMirrorWriter } = await import('/mirror-writer.js');
    window.__MIRROR_WRITER__ = {
      writer: createChartMirrorWriter({ limits }),
      nativeCalls: 0,
      nativeThunk() {
        window.__MIRROR_WRITER__.nativeCalls += 1;
        throw new Error('An active mirror batch must not replay its native expression');
      },
    };
  }, limits);
}

/** Native request events retain a real write lock without a synthetic clock. */
export async function holdMirrorWriteLock(page) {
  await page.evaluate(() => {
    const transaction = window.__STORAGE_LAB__.native._dbInfo.db.transaction('keyvaluepairs', 'readwrite');
    const store = transaction.objectStore('keyvaluepairs');
    const pulses = [];
    const lock = {
      released: false,
      progress: () => new Promise(resolve => pulses.push(resolve)),
      completion: new Promise((resolve, reject) => {
        transaction.addEventListener('complete', () => resolve('complete'), { once: true });
        transaction.addEventListener('abort', () => reject(transaction.error), { once: true });
      }),
    };
    function hold() {
      store.get('#TV_SYMBOL-LOCK').onsuccess = () => {
        for (const resolve of pulses.splice(0)) resolve();
        if (!lock.released) hold();
      };
    }
    window.__MIRROR_WRITE_LOCK__ = lock;
    hold();
  });
  await page.evaluate(() => window.__MIRROR_WRITE_LOCK__.progress());
}

export async function releaseMirrorWriteLock(page) {
  await page.evaluate(async () => {
    window.__MIRROR_WRITE_LOCK__.released = true;
    await window.__MIRROR_WRITE_LOCK__.completion;
  });
}
