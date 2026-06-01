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
  assert.deepEqual(readConstArray('LADDER_OPEN_PERCENTS'), [2, 10, 30, 50, 70]);
  assert.deepEqual(readConstArray('LADDER_CLOSE_PERCENTS'), [0.3, 1, 5, 10, 30, 100]);
});

test('ladder default percents are available options', () => {
  assert.equal(readConstArray('LADDER_OPEN_PERCENTS').includes(readConstNumber('DEFAULT_LADDER_OPEN_PERCENT')), true);
  assert.equal(readConstArray('LADDER_CLOSE_PERCENTS').includes(readConstNumber('DEFAULT_LADDER_CLOSE_PERCENT')), true);
});

test('ladder default values match the conservative per-symbol presets', () => {
  assert.equal(readConstNumber('DEFAULT_LADDER_OPEN_PERCENT'), 2);
  assert.equal(readConstNumber('DEFAULT_LADDER_CLOSE_PERCENT'), 0.3);
  assert.equal(readConstNumber('DEFAULT_LADDER_LEVELS'), 5);
  assert.equal(readConstNumber('DEFAULT_LADDER_STEP'), 1);
});

test('ladder option persistence is scoped by the current symbol', () => {
  assert.match(source, /function ladderOptionStorageKey\(/);
  assert.match(source, /getCurrentSymbol\(\)/);
  assert.match(source, /\`\$\{baseKey\}:\$\{normalizedSymbol\}\`/);
  assert.match(source, /loadNumberOption\(LOCAL_LADDER_OPEN_PERCENT_KEY,\s*LADDER_OPEN_PERCENTS,\s*DEFAULT_LADDER_OPEN_PERCENT,\s*getCurrentSymbol\(\)\)/);
  assert.match(source, /saveNumberOption\(LOCAL_LADDER_CLOSE_PERCENT_KEY,\s*value,\s*LADDER_CLOSE_PERCENTS,\s*getCurrentSymbol\(\)\)/);
  assert.match(source, /loadNumberOption\(LOCAL_LADDER_LEVELS_KEY,\s*LADDER_LEVEL_OPTIONS,\s*DEFAULT_LADDER_LEVELS,\s*getCurrentSymbol\(\)\)/);
  assert.match(source, /ladderOptionStorageKey\(LOCAL_LADDER_STEP_KEY,\s*getCurrentSymbol\(\)\)/);
  assert.match(source, /localStorage\.setItem\(storageKey,\s*String\(Number\(value\)\)\)/);
});

test('storage events refresh symbol-scoped ladder option keys', () => {
  assert.match(source, /function isLadderOptionStorageKey\(/);
  assert.match(source, /key\.startsWith\(`\$\{LOCAL_LADDER_OPEN_PERCENT_KEY\}:`\)/);
  assert.match(source, /key\.startsWith\(`\$\{LOCAL_LADDER_CLOSE_PERCENT_KEY\}:`\)/);
  assert.match(source, /key\.startsWith\(`\$\{LOCAL_LADDER_LEVELS_KEY\}:`\)/);
  assert.match(source, /key\.startsWith\(`\$\{LOCAL_LADDER_STEP_KEY\}:`\)/);
  assert.match(source, /isLadderOptionStorageKey\(event\.key\)/);
});
