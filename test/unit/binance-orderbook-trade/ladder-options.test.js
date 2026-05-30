import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = await readFile(new URL('../../../src/binance-orderbook-trade/index.user.js', import.meta.url), 'utf8');

function readConstArray(name) {
  const match = new RegExp(`const ${name} = \\[([^\\]]+)\\];`).exec(source);
  assert.ok(match, `${name} should be defined`);
  return match[1].split(',').map((value) => Number(value.trim()));
}

function readConstNumber(name) {
  const match = new RegExp(`const ${name} = ([0-9.]+);`).exec(source);
  assert.ok(match, `${name} should be defined`);
  return Number(match[1]);
}

test('ladder percent options match configured open and close presets', () => {
  assert.deepEqual(readConstArray('LADDER_OPEN_PERCENTS'), [10, 30, 50, 70]);
  assert.deepEqual(readConstArray('LADDER_CLOSE_PERCENTS'), [0.3, 1, 5, 10, 30, 100]);
});

test('ladder default percents are available options', () => {
  assert.equal(readConstArray('LADDER_OPEN_PERCENTS').includes(readConstNumber('DEFAULT_LADDER_OPEN_PERCENT')), true);
  assert.equal(readConstArray('LADDER_CLOSE_PERCENTS').includes(readConstNumber('DEFAULT_LADDER_CLOSE_PERCENT')), true);
});
