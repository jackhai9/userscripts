import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = await readFile(new URL('../../src/binance-coinmarketcap-data/index.user.js', import.meta.url), 'utf8');
const start = source.indexOf('  function baseAssetFromSymbol(');
const end = source.indexOf('  function normalizeCmcAsset(', start);
assert(start >= 0 && end > start);
const { baseAssetFromSymbol, cmcSymbolFromBaseAsset } = new Function(
  `${source.slice(start, end)}\nreturn { baseAssetFromSymbol, cmcSymbolFromBaseAsset };`,
)();

test('CMC mapping retains Unicode and numeric base assets and removes only supported multipliers', () => {
  for (const [symbol, expected] of [
    ['龙虾USDT', '龙虾'], ['币安人生USDC', '币安人生'], ['4USDT', '4'],
    ['1INCHUSDT', '1INCH'], ['1000PEPEUSDT', 'PEPE'], ['1000龙虾USDT', '龙虾'],
    ['1000000龙虾USDT', '龙虾'], ['10000001USDT', '10000001'],
  ]) {
    assert.equal(cmcSymbolFromBaseAsset(baseAssetFromSymbol(symbol)), expected, symbol);
  }
});
