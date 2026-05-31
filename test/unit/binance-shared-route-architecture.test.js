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

test('shared Binance futures route helper owns route parsing logic', async () => {
  const source = await readRepoFile('../../src/shared/binance-futures-route.js');
  assert.match(source, /const FUTURES_TRADING_PATH_RE = /);
  assert.match(source, /export function parseFuturesTradingSymbolFromPathname/);
  assert.match(source, /export function isFuturesTradingPathname/);
});

for (const entry of sourceEntries) {
  test(`${entry.name} source imports shared Binance futures route helper`, async () => {
    const source = await readRepoFile(entry.path);
    assert.match(source, /from '\.\.\/shared\/binance-futures-route\.js';/);
    assert.doesNotMatch(source, /const FUTURES_TRADING_PATH_RE = /);
    assert.doesNotMatch(source, /location\.pathname\.match\(\/\\\/futures\\\//);
    assert.doesNotMatch(source, /document\.title[\s\S]*match\(\(\?\:/);
  });
}
