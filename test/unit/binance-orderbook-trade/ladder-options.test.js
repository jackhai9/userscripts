import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isModeSymbolOptionStorageKey,
  loadModeSymbolPrecisionNumberOption,
  migrateModeSymbolPrecisionNumberOption,
  modeSymbolPrecisionOptionStorageKey,
  saveModeSymbolPrecisionNumberOption,
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
const MULTIPLIER_KEYS = {
  OPEN: 'jh_binance_qty_multiplier_v2:OPEN',
  CLOSE: 'jh_binance_qty_multiplier_v2:CLOSE',
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
  assert.deepEqual(readConstArray('LADDER_CLOSE_PERCENTS'), [0.3, 1, 5, 10, 30]);
});

test('retired close 100 percent profiles explicitly migrate to the close default', () => {
  const storage = createStorage();
  const percentKeys = {
    OPEN: 'jh_binance_ladder_open_percent',
    CLOSE: 'jh_binance_ladder_close_percent',
  };
  const options = [0.3, 1, 5, 10, 30];
  storage.setItem('jh_binance_ladder_close_percent:BTCUSDT:0.01', '100');

  assert.equal(
    migrateModeSymbolPrecisionNumberOption(
      storage,
      percentKeys,
      'CLOSE',
      'BTCUSDT',
      '0.01',
      100,
      0.3,
      options,
    ),
    true,
  );
  assert.equal(
    loadModeSymbolPrecisionNumberOption(storage, percentKeys, 'CLOSE', 'BTCUSDT', '0.01', options, 0.3),
    0.3,
  );
  assert.deepEqual(storage.entries(), [
    ['jh_binance_ladder_close_percent:BTCUSDT:0.01', '0.3'],
  ]);
  assert.match(
    source,
    /if \(migrated\) \{\s*setLadderStatus\(`平仓量 100% 已调整为 \$\{DEFAULT_LADDER_CLOSE_PERCENT\}%`\);\s*\}/,
  );
});

test('retired option migration rejects an unsupported replacement', () => {
  const storage = createStorage();
  assert.throws(
    () => migrateModeSymbolPrecisionNumberOption(
      storage,
      MODE_KEYS,
      'CLOSE',
      'BTCUSDT',
      '0.01',
      100,
      0.3,
      [1, 5, 10],
    ),
    /Invalid replacement option: 0\.3/,
  );
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

  assert.equal(loadModeSymbolPrecisionNumberOption(storage, STEP_KEYS, 'OPEN', 'ETHUSDT', '0.01', options, 5), 5);
  assert.equal(loadModeSymbolPrecisionNumberOption(storage, STEP_KEYS, 'CLOSE', 'ETHUSDT', '0.01', options, 5), 5);

  saveModeSymbolPrecisionNumberOption(storage, STEP_KEYS, 'OPEN', 'BTCUSDT', '0.01', 1, options);
  saveModeSymbolPrecisionNumberOption(storage, STEP_KEYS, 'CLOSE', 'BTCUSDT', '0.01', 3, options);
  assert.equal(loadModeSymbolPrecisionNumberOption(storage, STEP_KEYS, 'OPEN', 'BTCUSDT', '0.01', options, 5), 1);
  assert.equal(loadModeSymbolPrecisionNumberOption(storage, STEP_KEYS, 'CLOSE', 'BTCUSDT', '0.01', options, 5), 3);
});

test('ladder option persistence is scoped by the current symbol', () => {
  const storage = createStorage();
  saveModeSymbolPrecisionNumberOption(storage, MODE_KEYS, 'OPEN', 'BTCUSDT', '0.01', 3, [3, 5, 7, 9]);
  saveModeSymbolPrecisionNumberOption(storage, MODE_KEYS, 'OPEN', 'ETHUSDT', '0.01', 7, [3, 5, 7, 9]);

  assert.equal(loadModeSymbolPrecisionNumberOption(storage, MODE_KEYS, 'OPEN', 'BTCUSDT', '0.01', [3, 5, 7, 9], 5), 3);
  assert.equal(loadModeSymbolPrecisionNumberOption(storage, MODE_KEYS, 'OPEN', 'ETHUSDT', '0.01', [3, 5, 7, 9], 5), 7);
});

test('ladder option persistence separates open and close mode for one symbol', () => {
  const storage = createStorage();
  saveModeSymbolPrecisionNumberOption(storage, MODE_KEYS, 'OPEN', 'BTCUSDT', '0.01', 3, [3, 5, 7, 9]);
  saveModeSymbolPrecisionNumberOption(storage, MODE_KEYS, 'CLOSE', 'BTCUSDT', '0.01', 9, [3, 5, 7, 9]);

  assert.equal(loadModeSymbolPrecisionNumberOption(storage, MODE_KEYS, 'OPEN', 'BTCUSDT', '0.01', [3, 5, 7, 9], 5), 3);
  assert.equal(loadModeSymbolPrecisionNumberOption(storage, MODE_KEYS, 'CLOSE', 'BTCUSDT', '0.01', [3, 5, 7, 9], 5), 9);
  assert.deepEqual(storage.entries(), [
    ['jh_binance_ladder_open_levels:BTCUSDT:0.01', '3'],
    ['jh_binance_ladder_close_levels:BTCUSDT:0.01', '9'],
  ]);
});

test('ladder option persistence separates orderbook precision for one symbol and mode', () => {
  const storage = createStorage();
  const options = [3, 5, 7, 9];
  saveModeSymbolPrecisionNumberOption(storage, MODE_KEYS, 'OPEN', 'BTCUSDT', '0.01', 3, options);
  saveModeSymbolPrecisionNumberOption(storage, MODE_KEYS, 'OPEN', 'BTCUSDT', '0.001', 9, options);

  assert.equal(loadModeSymbolPrecisionNumberOption(storage, MODE_KEYS, 'OPEN', 'BTCUSDT', '0.01', options, 5), 3);
  assert.equal(loadModeSymbolPrecisionNumberOption(storage, MODE_KEYS, 'OPEN', 'BTCUSDT', '0.001', options, 5), 9);
});

test('quantity multiplier keys share the symbol-mode-precision identity', () => {
  assert.equal(
    modeSymbolPrecisionOptionStorageKey(MULTIPLIER_KEYS, 'OPEN', 'btcusdt', '0.01'),
    'jh_binance_qty_multiplier_v2:OPEN:BTCUSDT:0.01',
  );
  assert.equal(
    modeSymbolPrecisionOptionStorageKey(MULTIPLIER_KEYS, 'CLOSE', 'BTCUSDT', '0.001'),
    'jh_binance_qty_multiplier_v2:CLOSE:BTCUSDT:0.001',
  );
});

test('ladder option persistence rejects unknown mode and skips incomplete context', () => {
  const storage = createStorage();

  assert.throws(() => modeSymbolPrecisionOptionStorageKey(MODE_KEYS, 'UNKNOWN', 'BTCUSDT', '0.01'), /Unknown trade mode/);
  assert.equal(modeSymbolPrecisionOptionStorageKey(MODE_KEYS, 'OPEN', '', '0.01'), null);
  assert.equal(modeSymbolPrecisionOptionStorageKey(MODE_KEYS, 'OPEN', 'BTCUSDT', ''), null);
  assert.equal(loadModeSymbolPrecisionNumberOption(storage, MODE_KEYS, 'OPEN', '', '0.01', [3, 5, 7, 9], 5), null);
  assert.equal(loadModeSymbolPrecisionNumberOption(storage, MODE_KEYS, 'OPEN', 'BTCUSDT', '', [3, 5, 7, 9], 5), null);
  assert.equal(saveModeSymbolPrecisionNumberOption(storage, MODE_KEYS, 'OPEN', '', '0.01', 3, [3, 5, 7, 9]), false);
  assert.equal(saveModeSymbolPrecisionNumberOption(storage, MODE_KEYS, 'OPEN', 'BTCUSDT', '', 3, [3, 5, 7, 9]), false);
  assert.deepEqual(storage.entries(), []);
});

test('new precision profiles do not inherit legacy symbol-only values', () => {
  const storage = createStorage();
  storage.setItem('jh_binance_ladder_open_levels:BTCUSDT', '9');

  assert.equal(
    loadModeSymbolPrecisionNumberOption(storage, MODE_KEYS, 'OPEN', 'BTCUSDT', '0.01', [3, 5, 7, 9], 5),
    5,
  );
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
    assert.equal(isModeSymbolOptionStorageKey(`${key}:BTCUSDT:0.01`, keys), true);
    assert.equal(isModeSymbolOptionStorageKey(`${key}:BTCUSDT`, keys), false);
  }
  assert.equal(isModeSymbolOptionStorageKey('jh_binance_ladder_levels:BTCUSDT', keys), false);
  assert.equal(isModeSymbolOptionStorageKey('jh_binance_ladder_step:BTCUSDT', keys), false);
});

test('ladder execution and UI updates use one captured mode-symbol-precision context', () => {
  assert.match(source, /getLadderLevels\(spec\.mode,\s*startSymbol,\s*startPrecision\)/);
  assert.match(source, /getLadderStep\(spec\.mode,\s*startSymbol,\s*startPrecision\)/);
  assert.match(source, /getLadderOpenPercent\(startSymbol,\s*startPrecision\)/);
  assert.match(source, /getLadderClosePercent\(startSymbol,\s*startPrecision\)/);
  assert.match(source, /spec\.mode === 'OPEN' \? getLadderOpenPercent\(startSymbol, startPrecision\) : null/);
  assert.match(source, /spec\.mode === 'CLOSE' \? getLadderClosePercent\(startSymbol, startPrecision\) : null/);
  assert.match(source, /const optionContext = getPanelOptionContext\(\)/);
  assert.match(source, /setLadderLevels\(value, optionContext\.mode, optionContext\.symbol, optionContext\.precision\)/);
  assert.match(source, /setLadderStep\(value, optionContext\.mode, optionContext\.symbol, optionContext\.precision\)/);
  assert.match(source, /plan\.ladderStep === DEFAULT_LADDER_STEP \? '' : `\/幅\$\{plan\.ladderStep\}`/);
});

test('open and close ladder percentage rows share the centralized ratio label', () => {
  assert.equal((source.match(/ladderOptionRow\(PANEL_COPY\.field\.ratio, PANEL_COPY\.tooltip\.ratio,/g) || []).length, 2);
});

test('ladder quantity levels and step options share one stable five-slot grid', () => {
  const optionRow = source.match(/function ladderOptionRow[\s\S]*?\n  }/)?.[0] || '';

  assert.match(optionRow, /grid-template-columns:36px repeat\(5,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(optionRow, /flex-wrap/);
  assert.match(source, /data-ladder-value="\$\{value\}" style="box-sizing:border-box;width:100%;min-width:0;height:28px/);
  assert.equal((source.match(/ladderOptionRow\(PANEL_COPY\.field\.orderCount, PANEL_COPY\.tooltip\.orderCount, LADDER_LEVEL_OPTIONS/g) || []).length, 2);
  assert.equal((source.match(/ladderOptionRow\(PANEL_COPY\.field\.interval, PANEL_COPY\.tooltip\.interval, LADDER_STEP_OPTIONS/g) || []).length, 2);
  assert.doesNotMatch(source, /data-ladder-step-action|function ladderStepRow/);
});

test('close ladder buttons match the Binance native long-short order', () => {
  const closeLongButton = "ladderActionButton('CLOSE_LONG', PANEL_COPY.action.closeLong, 'SELL', closeLongDisabled)";
  const closeShortButton = "ladderActionButton('CLOSE_SHORT', PANEL_COPY.action.closeShort, 'BUY', closeShortDisabled)";

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
