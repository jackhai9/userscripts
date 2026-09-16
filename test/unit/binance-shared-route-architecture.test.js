import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const sourceEntries = [
  {
    name: 'orderbook trade',
    path: '../../src/binance-orderbook-trade/index.user.js',
  },
  {
    name: 'trading data',
    path: '../../src/binance-trading-data/index.user.js',
  },
  {
    name: 'CoinMarketCap data',
    path: '../../src/binance-coinmarketcap-data/index.user.js',
  },
];

async function readRepoFile(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), 'utf8');
}

test('user receives one shared owner for Binance futures route parsing', async () => {
  // Given all consumers share the declared futures-route module.
  const path = '../../src/shared/binance-futures-route.js';
  // When its public source contract is inspected.
  const source = await readRepoFile(path);
  // Then route recognition and symbol parsing remain defined by that module.
  assert.match(source, /const FUTURES_TRADING_PATH_RE = /);
  assert.match(source, /export function parseFuturesTradingSymbolFromPathname/);
  assert.match(source, /export function isFuturesTradingPathname/);
});

for (const entry of sourceEntries) {
  test(`user gets the shared futures route contract in ${entry.name}`, async () => {
    // Given this installer's declared editable entry.
    const path = entry.path;
    // When its route dependency is inspected.
    const source = await readRepoFile(path);
    // Then the installer imports the shared parser without keeping private copies.
    assert.match(source, /from '\.\.\/shared\/binance-futures-route\.js';/);
    assert.doesNotMatch(source, /const FUTURES_TRADING_PATH_RE = /);
    assert.doesNotMatch(source, /location\.pathname\.match\(\/\\\/futures\\\//);
    assert.doesNotMatch(source, /document\.title[\s\S]*match\(\(\?\:/);
  });
}
