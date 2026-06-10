import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const iconSources = [
  'src/binance-orderbook-trade/index.user.js',
  'scripts/binance-orderbook-trade.user.js',
  'src/binance-trading-data/index.user.js',
  'scripts/binance-trading-data.user.js',
  'src/binance-coinmarketcap-data/index.user.js',
  'scripts/binance-coinmarketcap-data.user.js',
  'src/m3u8-downloader/index.user.js',
  'scripts/m3u8-downloader.user.js',
  'scripts/auto_refresh.user.js',
  'scripts/coinmarketcap-valuation-helper.user.js',
];

const expectedDashboardIcon = 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%23f0b90b%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2242%22%20text-anchor%3D%22middle%22%20font-family%3D%22Arial%2C%20sans-serif%22%20font-size%3D%2230%22%20font-weight%3D%22800%22%20fill%3D%22%23111827%22%3EJ%3C%2Ftext%3E%3C%2Fsvg%3E';

function metadataValue(source, key) {
  const match = source.match(new RegExp(`^// @${key}\\s+(.+)$`, 'm'));
  return match?.[1]?.trim() ?? '';
}

test('userscript dashboard icons are embedded and do not depend on GitHub avatar loading', async () => {
  for (const path of iconSources) {
    const source = await readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
    const icon = metadataValue(source, 'icon');
    const icon64 = metadataValue(source, 'icon64');

    assert.equal(icon, expectedDashboardIcon, `${path} @icon should use the agreed J dashboard SVG`);
    assert.equal(icon64, icon, `${path} @icon64 should match @icon for Tampermonkey dashboard use`);
    assert.equal(source.includes('avatars.githubusercontent.com'), false, `${path} should not depend on a remote avatar icon`);
  }
});
