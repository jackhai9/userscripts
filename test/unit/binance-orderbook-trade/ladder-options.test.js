import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isModeSymbolOptionStorageKey,
  loadModeSymbolNumberOption,
  modeSymbolOptionStorageKey,
  saveModeSymbolNumberOption,
} from '../../../src/binance-orderbook-trade/core/panel-options.js';

const source = await readFile(new URL('../../../src/binance-orderbook-trade/index.user.js', import.meta.url), 'utf8');

const MODE_KEYS = {
  OPEN: 'jh_binance_ladder_open_levels',
  CLOSE: 'jh_binance_ladder_close_levels',
};
const STEP_KEYS = {
  OPEN: 'jh_binance_ladder_open_step',
  CLOSE: 'jh_binance_ladder_close_step',
};

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    entries() {
      return [...values.entries()];
    },
  };
}

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

test('ladder default values match the per-symbol presets', () => {
  assert.equal(readConstNumber('DEFAULT_LADDER_OPEN_PERCENT'), 2);
  assert.equal(readConstNumber('DEFAULT_LADDER_CLOSE_PERCENT'), 0.3);
  assert.equal(readConstNumber('DEFAULT_LADDER_LEVELS'), 5);
  assert.equal(readConstNumber('DEFAULT_LADDER_STEP'), 5);
});

test('new symbols default open and close ladder step to five without replacing saved values', () => {
  const storage = createStorage();
  const options = [1, 2, 3, 4, 5];

  assert.equal(loadModeSymbolNumberOption(storage, STEP_KEYS, 'OPEN', 'ETHUSDT', options, 5), 5);
  assert.equal(loadModeSymbolNumberOption(storage, STEP_KEYS, 'CLOSE', 'ETHUSDT', options, 5), 5);

  saveModeSymbolNumberOption(storage, STEP_KEYS, 'OPEN', 'BTCUSDT', 1, options);
  saveModeSymbolNumberOption(storage, STEP_KEYS, 'CLOSE', 'BTCUSDT', 3, options);
  assert.equal(loadModeSymbolNumberOption(storage, STEP_KEYS, 'OPEN', 'BTCUSDT', options, 5), 1);
  assert.equal(loadModeSymbolNumberOption(storage, STEP_KEYS, 'CLOSE', 'BTCUSDT', options, 5), 3);
});

test('ladder option persistence is scoped by the current symbol', () => {
  const storage = createStorage();
  saveModeSymbolNumberOption(storage, MODE_KEYS, 'OPEN', 'BTCUSDT', 3, [3, 5, 7, 9]);
  saveModeSymbolNumberOption(storage, MODE_KEYS, 'OPEN', 'ETHUSDT', 7, [3, 5, 7, 9]);

  assert.equal(loadModeSymbolNumberOption(storage, MODE_KEYS, 'OPEN', 'BTCUSDT', [3, 5, 7, 9], 5), 3);
  assert.equal(loadModeSymbolNumberOption(storage, MODE_KEYS, 'OPEN', 'ETHUSDT', [3, 5, 7, 9], 5), 7);
});

test('ladder option persistence separates open and close mode for one symbol', () => {
  const storage = createStorage();
  saveModeSymbolNumberOption(storage, MODE_KEYS, 'OPEN', 'BTCUSDT', 3, [3, 5, 7, 9]);
  saveModeSymbolNumberOption(storage, MODE_KEYS, 'CLOSE', 'BTCUSDT', 9, [3, 5, 7, 9]);

  assert.equal(loadModeSymbolNumberOption(storage, MODE_KEYS, 'OPEN', 'BTCUSDT', [3, 5, 7, 9], 5), 3);
  assert.equal(loadModeSymbolNumberOption(storage, MODE_KEYS, 'CLOSE', 'BTCUSDT', [3, 5, 7, 9], 5), 9);
  assert.deepEqual(storage.entries(), [
    ['jh_binance_ladder_open_levels:BTCUSDT', '3'],
    ['jh_binance_ladder_close_levels:BTCUSDT', '9'],
  ]);
});

test('ladder option persistence rejects unknown mode and skips missing symbol writes', () => {
  const storage = createStorage();

  assert.throws(() => modeSymbolOptionStorageKey(MODE_KEYS, 'UNKNOWN', 'BTCUSDT'), /Unknown trade mode/);
  assert.equal(modeSymbolOptionStorageKey(MODE_KEYS, 'OPEN', ''), null);
  assert.equal(loadModeSymbolNumberOption(storage, MODE_KEYS, 'OPEN', '', [3, 5, 7, 9], 5), 5);
  assert.equal(saveModeSymbolNumberOption(storage, MODE_KEYS, 'OPEN', '', 3, [3, 5, 7, 9]), false);
  assert.deepEqual(storage.entries(), []);
});

test('storage events accept six mode-scoped keys and reject legacy shared keys', () => {
  const keys = [
    'jh_binance_ladder_open_percent',
    'jh_binance_ladder_close_percent',
    'jh_binance_ladder_open_levels',
    'jh_binance_ladder_close_levels',
    'jh_binance_ladder_open_step',
    'jh_binance_ladder_close_step',
  ];
  for (const key of keys) {
    assert.equal(isModeSymbolOptionStorageKey(`${key}:BTCUSDT`, keys), true);
  }
  assert.equal(isModeSymbolOptionStorageKey('jh_binance_ladder_levels:BTCUSDT', keys), false);
  assert.equal(isModeSymbolOptionStorageKey('jh_binance_ladder_step:BTCUSDT', keys), false);
});

test('ladder execution and UI updates use one captured mode-symbol context', () => {
  assert.match(source, /getLadderLevels\(spec\.mode,\s*startSymbol\)/);
  assert.match(source, /getLadderStep\(spec\.mode,\s*startSymbol\)/);
  assert.match(source, /getLadderOpenPercent\(startSymbol\)/);
  assert.match(source, /getLadderClosePercent\(startSymbol\)/);
  assert.match(source, /const optionContext = \{ mode: getActiveTradeMode\(\), symbol: getCurrentSymbol\(\) \}/);
  assert.match(source, /setLadderLevels\(value, optionContext\.mode, optionContext\.symbol\)/);
  assert.match(source, /getLadderStep\(optionContext\.mode, optionContext\.symbol\)/);
  assert.match(source, /setLadderStep\([^\n]+, optionContext\.mode, optionContext\.symbol\)/);
  assert.match(source, /plan\.ladderStep === DEFAULT_LADDER_STEP \? '' : `\/幅\$\{plan\.ladderStep\}`/);
});

test('close ladder buttons match the Binance native long-short order', () => {
  const closeLongButton = "ladderActionButton('CLOSE_LONG', '阶梯平多', 'SELL', closeLongDisabled)";
  const closeShortButton = "ladderActionButton('CLOSE_SHORT', '阶梯平空', 'BUY', closeShortDisabled)";

  assert.notEqual(source.indexOf(closeLongButton), -1);
  assert.notEqual(source.indexOf(closeShortButton), -1);
  assert.ok(source.indexOf(closeLongButton) < source.indexOf(closeShortButton));
});

test('close side buttons match the Binance native long-short order', () => {
  const closeLongButton = `<button id="\${SIDE_LONG_ID}"`;
  const closeShortButton = `<button id="\${SIDE_SHORT_ID}"`;

  assert.notEqual(source.indexOf(closeLongButton), -1);
  assert.notEqual(source.indexOf(closeShortButton), -1);
  assert.ok(source.indexOf(closeLongButton) < source.indexOf(closeShortButton));
  assert.match(source, /sideLongBtn\.style\.order = '0'/);
  assert.match(source, /sideShortBtn\.style\.order = '1'/);
});
