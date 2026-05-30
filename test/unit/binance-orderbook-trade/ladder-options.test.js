import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = await readFile(new URL('../../../src/binance-orderbook-trade/index.user.js', import.meta.url), 'utf8');

function readConstArray(name) {
  const match = new RegExp(`const ${name} = \\[([^\\]]+)\\];`).exec(source);
  assert.ok(match, `${name} should be defined`);
  return match[1].split(',').map((value) => Number(value.trim()));
}

test('ladder percent options match configured open and close presets', () => {
  assert.deepEqual(readConstArray('LADDER_OPEN_PERCENTS'), [10, 30, 50, 70]);
  assert.deepEqual(readConstArray('LADDER_CLOSE_PERCENTS'), [1, 5, 10, 30, 100]);
});
