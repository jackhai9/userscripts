import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { openStorageLab, STORAGE_LAB_ORIGIN } from './chart-storage-lab.js';

const fixtureRoot = new URL('../../../test/fixtures/binance-chart-storage/', import.meta.url);
const sha = value => createHash('sha256').update(value).digest('hex');

/** Keep the executable fixture tied to every exact source slice recorded by extraction. */
async function verifiedFixture() {
  const [source, manifestText] = await Promise.all([
    readFile(new URL('host-persistence.js', fixtureRoot), 'utf8'),
    readFile(new URL('host-persistence-manifest.json', fixtureRoot), 'utf8'),
  ]);
  const manifest = JSON.parse(manifestText);
  assert.equal(sha(source), manifest.fixture.sha256, 'Host persistence fixture hash changed');
  for (const fragment of manifest.fragments) {
    assert.equal(sha(source.slice(...fragment.fixture_utf16_range)), fragment.sha256, fragment.label);
  }
  return source;
}

/** The existing lab still blocks all external requests; this adds one exact local asset. */
export async function openChartHostWorkflows(page, options) {
  await openStorageLab(page, options);
  const source = await verifiedFixture();
  await page.context().route(`${STORAGE_LAB_ORIGIN}/host-persistence.js`, route => route.fulfill({
    contentType: 'text/javascript', body: source,
  }));
  await page.addScriptTag({ url: `${STORAGE_LAB_ORIGIN}/host-persistence.js` });
  await page.evaluate(() => {
    let runtimeRequire;
    self.webpackChunkfutures_trade_ui.push([
      ['codex-chart-host-workflows-entry'], {}, require => { runtimeRequire = require; },
    ]);
    window.__CHART_HOST__ = {
      tradingView: runtimeRequire('codex-chart-host-tv'),
      basic: runtimeRequire('codex-chart-host-basic'),
      mirror: runtimeRequire('codex-chart-host-mirror'),
    };
  });
}
