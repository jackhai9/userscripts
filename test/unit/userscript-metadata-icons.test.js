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

function metadataValue(source, key) {
  const match = source.match(new RegExp(`^// @${key}\\s+(.+)$`, 'm'));
  return match?.[1]?.trim() ?? '';
}

test('userscript dashboard icons are embedded and do not depend on GitHub avatar loading', async () => {
  for (const path of iconSources) {
    const source = await readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
    const icon = metadataValue(source, 'icon');
    const icon64 = metadataValue(source, 'icon64');

    assert.equal(icon.startsWith('data:image/svg+xml,'), true, `${path} @icon should be an embedded SVG data URI`);
    assert.equal(icon64, icon, `${path} @icon64 should match @icon for Tampermonkey dashboard use`);
    assert.equal(source.includes('avatars.githubusercontent.com'), false, `${path} should not depend on a remote avatar icon`);
  }
});
