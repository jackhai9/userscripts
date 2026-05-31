import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const scripts = [
  {
    name: 'CoinMarketCap data panel',
    path: '../../scripts/binance-coinmarketcap-data.user.js',
  },
  {
    name: 'trading data panel',
    path: '../../scripts/binance-trading-data.user.js',
  },
];

async function readScript(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

function readFunctionBody(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return source.slice(braceStart + 1, index);
  }
  assert.fail(`${name} body should be closed`);
}

for (const script of scripts) {
  test(`${script.name} excludes Binance wallet futures paths`, async () => {
    const source = await readScript(script.path);
    assert.match(source, /\/\/ @exclude\s+https:\/\/www\.binance\.com\/\*\/my\/wallet\/futures\/\*/);
    assert.match(source, /\/\/ @exclude\s+https:\/\/www\.binance\.com\/my\/wallet\/futures\/\*/);
  });

  test(`${script.name} parses only actual futures trading page symbols`, async () => {
    const source = await readScript(script.path);
    assert.match(source, /\b(?:const|var) FUTURES_TRADING_PATH_RE = \/\^\\\/\(\?:\[a-z\]\{2\}/);
    assert.match(source, /function isFuturesTradingPage\(\)/);
    assert.match(source, /if \(!isFuturesTradingPage\(\)\) return;/);

    const getSymbolBody = readFunctionBody(source, 'getCurrentSymbol');
    assert.match(getSymbolBody, /parseFuturesTradingSymbolFromPathname\(location\.pathname\)/);
    assert.doesNotMatch(getSymbolBody, /document\.title/);
    assert.doesNotMatch(getSymbolBody, /\/\\\/futures\\\/\(\[A-Z0-9_\]\+\)/);
  });
}
