import { captureThrownError } from '../../helpers/orderbook-migration-errors.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLadderOptionHarness } from '../../helpers/orderbook-migration-ladder-options.js';
import { PANEL_COPY, formatLocalizedText, localizedText } from '../../../src/binance-orderbook-trade/contracts/panel-copy.js';

import {
  isModeSymbolOptionStorageKey,
  loadModeSymbolPrecisionNumberOption,
  migrateModeSymbolPrecisionNumberOption,
  modeSymbolPrecisionOptionStorageKey,
  saveModeSymbolPrecisionNumberOption,
} from '../../../src/binance-orderbook-trade/core/panel-options.js';

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

test('user can save and restore each supported open and close percentage', (t) => {
  // Given native symbol and precision context and the supported choices for each mode
  const f = createLadderOptionHarness();
  t.after(() => f.close());
  const openChoices = [2, 10, 30, 50, 70];
  const closeChoices = [0.3, 1, 5, 10, 30];

  // When each choice passes through the real preference setter and getter
  const openResults = openChoices.map((value) => {
    const saved = f.context.setLadderOpenPercent(value);
    return { saved, restored: f.context.getLadderOpenPercent() };
  });
  const closeResults = closeChoices.map((value) => {
    const saved = f.context.setLadderClosePercent(value);
    return { saved, restored: f.context.getLadderClosePercent() };
  });

  // Then every supported value round-trips and the final choices remain mode-scoped
  assert.deepEqual(openResults, [
    { saved: true, restored: 2 }, { saved: true, restored: 10 }, { saved: true, restored: 30 },
    { saved: true, restored: 50 }, { saved: true, restored: 70 },
  ]);
  assert.deepEqual(closeResults, [
    { saved: true, restored: 0.3 }, { saved: true, restored: 1 }, { saved: true, restored: 5 },
    { saved: true, restored: 10 }, { saved: true, restored: 30 },
  ]);
  assert.equal(f.storage.getItem('jh_binance_ladder_open_percent:BTCUSDT:0.01'), '70');
  assert.equal(f.storage.getItem('jh_binance_ladder_close_percent:BTCUSDT:0.01'), '30');
  assert.equal(f.storage.length, 2);
});

test("user sees that retired close 100 percent profiles explicitly migrate to the close default", () => {
  // Given the symbol mode precision and saved ladder preferences are available
  const storage = createStorage();
  const percentKeys = {
    OPEN: 'jh_binance_ladder_open_percent',
    CLOSE: 'jh_binance_ladder_close_percent',
  };
  const options = [0.3, 1, 5, 10, 30];
  // When the ladder preference contract is evaluated
  storage.setItem('jh_binance_ladder_close_percent:BTCUSDT:0.01', '100');

  // Then sees that retired close 100 percent profiles explicitly migrate to the close default
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
});

test("user sees that retired option migration rejects an unsupported replacement", () => {
  // Given the symbol mode precision and saved ladder preferences are available
  const storage = createStorage();
  // When the ladder preference contract is evaluated
  const observedFailure = captureThrownError(() => migrateModeSymbolPrecisionNumberOption(
      storage,
      MODE_KEYS,
      'CLOSE',
      'BTCUSDT',
      '0.01',
      100,
      0.3,
      [1, 5, 10],
    ));

  // Then sees that retired option migration rejects an unsupported replacement
  assert.match(observedFailure.message, /替换选项无效：0\.3/);
});

test('user sees exactly one default percentage selected in each native mode', (t) => {
  // Given a fresh preference store and both native trading modes
  const f = createLadderOptionHarness();
  t.after(() => f.close());
  const rows = ['OPEN', 'CLOSE'].map(() => f.document.createElement('section'));

  // When the production option renderer loads and displays each mode's defaults
  for (const [index, mode] of ['OPEN', 'CLOSE'].entries()) {
    rows[index].innerHTML = f.context.getLadderControlSections(mode, null, 'BTCUSDT', '0.01').optionRows.join('');
  }

  // Then the default choice exists once and is visibly selected among all five choices
  const percentButtons = rows.map((row) => Array.from(row.querySelectorAll('[data-ladder-group="percent"]')));
  assert.deepEqual(percentButtons.map((buttons) => buttons.length), [5, 5]);
  assert.deepEqual(percentButtons.map((buttons) => buttons
    .filter((button) => button.style.background === 'var(--color-BadgeBg)')
    .map((button) => button.textContent)), [['2%'], ['0.3%']]);
});

test('user receives the initial mode-specific plan options without saving defaults', (t) => {
  // Given a newly visited symbol has no saved ladder preferences
  const f = createLadderOptionHarness();
  t.after(() => f.close());

  // When the production preference reader captures each mode's plan options
  const defaults = ['OPEN', 'CLOSE'].map((mode) =>
    f.context.readLadderOptionContext({ mode }, 'BTCUSDT', '0.01'));

  // Then each plan receives its initial percentage, order count, and gap without a storage write
  assert.deepEqual(JSON.parse(JSON.stringify(defaults)), [
    { percent: 2, levels: 5, ladderStep: 5 },
    { percent: 0.3, levels: 5, ladderStep: 5 },
  ]);
  assert.equal(f.storage.length, 0);
});

test("user sees that new symbols default open and close ladder step to five without replacing saved values", () => {
  // Given the symbol mode precision and saved ladder preferences are available
  const storage = createStorage();
  const options = [1, 2, 3, 4, 5];

  // When the ladder preference contract is evaluated
  const observed = loadModeSymbolPrecisionNumberOption(storage, STEP_KEYS, 'OPEN', 'ETHUSDT', '0.01', options, 5);

  // Then sees that new symbols default open and close ladder step to five without replacing saved values
  assert.equal(observed, 5);
  assert.equal(loadModeSymbolPrecisionNumberOption(storage, STEP_KEYS, 'CLOSE', 'ETHUSDT', '0.01', options, 5), 5);

  saveModeSymbolPrecisionNumberOption(storage, STEP_KEYS, 'OPEN', 'BTCUSDT', '0.01', 1, options);
  saveModeSymbolPrecisionNumberOption(storage, STEP_KEYS, 'CLOSE', 'BTCUSDT', '0.01', 3, options);
  assert.equal(loadModeSymbolPrecisionNumberOption(storage, STEP_KEYS, 'OPEN', 'BTCUSDT', '0.01', options, 5), 1);
  assert.equal(loadModeSymbolPrecisionNumberOption(storage, STEP_KEYS, 'CLOSE', 'BTCUSDT', '0.01', options, 5), 3);
});

test("user sees that ladder option persistence is scoped by the current symbol", () => {
  // Given the symbol mode precision and saved ladder preferences are available
  const storage = createStorage();
  saveModeSymbolPrecisionNumberOption(storage, MODE_KEYS, 'OPEN', 'BTCUSDT', '0.01', 3, [3, 5, 7, 9]);
  // When the ladder preference contract is evaluated
  saveModeSymbolPrecisionNumberOption(storage, MODE_KEYS, 'OPEN', 'ETHUSDT', '0.01', 7, [3, 5, 7, 9]);

  // Then sees that ladder option persistence is scoped by the current symbol
  assert.equal(loadModeSymbolPrecisionNumberOption(storage, MODE_KEYS, 'OPEN', 'BTCUSDT', '0.01', [3, 5, 7, 9], 5), 3);
  assert.equal(loadModeSymbolPrecisionNumberOption(storage, MODE_KEYS, 'OPEN', 'ETHUSDT', '0.01', [3, 5, 7, 9], 5), 7);
});

test("user sees that ladder option persistence separates open and close mode for one symbol", () => {
  // Given the symbol mode precision and saved ladder preferences are available
  const storage = createStorage();
  saveModeSymbolPrecisionNumberOption(storage, MODE_KEYS, 'OPEN', 'BTCUSDT', '0.01', 3, [3, 5, 7, 9]);
  // When the ladder preference contract is evaluated
  saveModeSymbolPrecisionNumberOption(storage, MODE_KEYS, 'CLOSE', 'BTCUSDT', '0.01', 9, [3, 5, 7, 9]);

  // Then sees that ladder option persistence separates open and close mode for one symbol
  assert.equal(loadModeSymbolPrecisionNumberOption(storage, MODE_KEYS, 'OPEN', 'BTCUSDT', '0.01', [3, 5, 7, 9], 5), 3);
  assert.equal(loadModeSymbolPrecisionNumberOption(storage, MODE_KEYS, 'CLOSE', 'BTCUSDT', '0.01', [3, 5, 7, 9], 5), 9);
  assert.deepEqual(storage.entries(), [
    ['jh_binance_ladder_open_levels:BTCUSDT:0.01', '3'],
    ['jh_binance_ladder_close_levels:BTCUSDT:0.01', '9'],
  ]);
});

test("user sees that ladder option persistence separates orderbook precision for one symbol and mode", () => {
  // Given the symbol mode precision and saved ladder preferences are available
  const storage = createStorage();
  const options = [3, 5, 7, 9];
  saveModeSymbolPrecisionNumberOption(storage, MODE_KEYS, 'OPEN', 'BTCUSDT', '0.01', 3, options);
  // When the ladder preference contract is evaluated
  saveModeSymbolPrecisionNumberOption(storage, MODE_KEYS, 'OPEN', 'BTCUSDT', '0.001', 9, options);

  // Then sees that ladder option persistence separates orderbook precision for one symbol and mode
  assert.equal(loadModeSymbolPrecisionNumberOption(storage, MODE_KEYS, 'OPEN', 'BTCUSDT', '0.01', options, 5), 3);
  assert.equal(loadModeSymbolPrecisionNumberOption(storage, MODE_KEYS, 'OPEN', 'BTCUSDT', '0.001', options, 5), 9);
});

test("user sees that quantity multiplier keys share the symbol-mode-precision identity", () => {
  // Given the symbol mode precision and saved ladder preferences are available
  const scenarioInputs = [MULTIPLIER_KEYS, 'OPEN', 'btcusdt', '0.01'];

  // When the ladder preference contract is evaluated
  const observed = modeSymbolPrecisionOptionStorageKey(...scenarioInputs);

  // Then sees that quantity multiplier keys share the symbol-mode-precision identity
  assert.equal(
    observed,
    'jh_binance_qty_multiplier_v2:OPEN:BTCUSDT:0.01',
  );
  assert.equal(
    modeSymbolPrecisionOptionStorageKey(MULTIPLIER_KEYS, 'CLOSE', 'BTCUSDT', '0.001'),
    'jh_binance_qty_multiplier_v2:CLOSE:BTCUSDT:0.001',
  );
});

test("user sees that ladder option persistence rejects unknown mode and skips incomplete context", () => {
  // Given the symbol mode precision and saved ladder preferences are available
  const storage = createStorage();

  // When the ladder preference contract is evaluated
  const observedFailure = captureThrownError(() => modeSymbolPrecisionOptionStorageKey(MODE_KEYS, 'UNKNOWN', 'BTCUSDT', '0.01'));

  // Then sees that ladder option persistence rejects unknown mode and skips incomplete context
  assert.match(observedFailure.message, /未知交易模式/);
  assert.equal(modeSymbolPrecisionOptionStorageKey(MODE_KEYS, 'OPEN', '', '0.01'), null);
  assert.equal(modeSymbolPrecisionOptionStorageKey(MODE_KEYS, 'OPEN', 'BTCUSDT', ''), null);
  assert.equal(loadModeSymbolPrecisionNumberOption(storage, MODE_KEYS, 'OPEN', '', '0.01', [3, 5, 7, 9], 5), null);
  assert.equal(loadModeSymbolPrecisionNumberOption(storage, MODE_KEYS, 'OPEN', 'BTCUSDT', '', [3, 5, 7, 9], 5), null);
  assert.equal(saveModeSymbolPrecisionNumberOption(storage, MODE_KEYS, 'OPEN', '', '0.01', 3, [3, 5, 7, 9]), false);
  assert.equal(saveModeSymbolPrecisionNumberOption(storage, MODE_KEYS, 'OPEN', 'BTCUSDT', '', 3, [3, 5, 7, 9]), false);
  assert.deepEqual(storage.entries(), []);
});

test("user sees that new precision profiles do not inherit legacy symbol-only values", () => {
  // Given the symbol mode precision and saved ladder preferences are available
  const storage = createStorage();
  // When the ladder preference contract is evaluated
  storage.setItem('jh_binance_ladder_open_levels:BTCUSDT', '9');

  // Then sees that new precision profiles do not inherit legacy symbol-only values
  assert.equal(
    loadModeSymbolPrecisionNumberOption(storage, MODE_KEYS, 'OPEN', 'BTCUSDT', '0.01', [3, 5, 7, 9], 5),
    5,
  );
});

test("user sees that storage events accept six mode-scoped keys and reject legacy shared keys", () => {
  // Given the symbol mode precision and saved ladder preferences are available
  const keys = [
    'jh_binance_ladder_open_percent',
    'jh_binance_ladder_close_percent',
    'jh_binance_ladder_open_levels',
    'jh_binance_ladder_close_levels',
    'jh_binance_ladder_open_step',
    'jh_binance_ladder_close_step',
  ];
  // When the ladder preference contract is evaluated
  for (const key of keys) {
    assert.equal(isModeSymbolOptionStorageKey(`${key}:BTCUSDT:0.01`, keys), true);
    assert.equal(isModeSymbolOptionStorageKey(`${key}:BTCUSDT`, keys), false);
  }
  // Then sees that storage events accept six mode-scoped keys and reject legacy shared keys
  assert.equal(isModeSymbolOptionStorageKey('jh_binance_ladder_levels:BTCUSDT', keys), false);
  assert.equal(isModeSymbolOptionStorageKey('jh_binance_ladder_step:BTCUSDT', keys), false);
});

test("user keeps a captured symbol mode and precision when native page context changes", (t) => {
  // Given saved open preferences and a captured native BTC context
  const f = createLadderOptionHarness();
  t.after(() => f.close());
  f.context.setLadderOpenPercent(30, 'BTCUSDT', '0.01');
  f.context.setLadderLevels(7, 'OPEN', 'BTCUSDT', '0.01');
  f.context.setLadderStep(2, 'OPEN', 'BTCUSDT', '0.01');
  const captured = f.context.getPanelOptionContext();

  // When the page changes to ETH close mode before the captured options are read and updated
  f.setNativeContext({ symbol: 'ETHUSDT', mode: 'Close', precision: '0.1' });
  const options = f.context.readLadderOptionContext({ mode: captured.mode }, captured.symbol, captured.precision);
  f.context.setLadderLevels(9, captured.mode, captured.symbol, captured.precision);
  const current = f.context.getPanelOptionContext();
  const otherOptions = f.context.readLadderOptionContext({ mode: current.mode }, current.symbol, current.precision);

  // Then captured reads and writes remain scoped to BTC open mode at its original precision
  assert.deepEqual(JSON.parse(JSON.stringify(captured)), { symbol: 'BTCUSDT', mode: 'OPEN', precision: '0.01' });
  assert.deepEqual(JSON.parse(JSON.stringify(options)), { percent: 30, levels: 7, ladderStep: 2 });
  assert.deepEqual(JSON.parse(JSON.stringify(current)), { symbol: 'ETHUSDT', mode: 'CLOSE', precision: '0.1' });
  assert.deepEqual(JSON.parse(JSON.stringify(otherOptions)), { percent: 0.3, levels: 5, ladderStep: 5 });
  assert.equal(f.storage.getItem('jh_binance_ladder_open_levels:BTCUSDT:0.01'), '9');
  assert.equal(f.storage.getItem('jh_binance_ladder_close_levels:ETHUSDT:0.1'), null);
});

test("user sees the same ratio label with mode-specific percentages in both ladder panels", (t) => {
  // Given both trading modes have native symbol and precision context
  const f = createLadderOptionHarness();
  t.after(() => f.close());
  const closeContext = { knowsLong: true, hasLong: true, knowsShort: true, hasShort: true };
  const rows = ['OPEN', 'CLOSE'].map(() => f.document.createElement('section'));

  // When the real panel sections render their option rows
  for (const [index, mode] of ['OPEN', 'CLOSE'].entries()) {
    const sections = f.context.getLadderControlSections(mode, closeContext, 'BTCUSDT', '0.01');
    rows[index].innerHTML = sections.optionRows.join('');
  }

  // Then both modes show the shared ratio label while retaining their own selectable percentages
  assert.deepEqual(rows.map((row) => row.querySelector('span').textContent), [
    formatLocalizedText(PANEL_COPY.field.ratio, 'en'), formatLocalizedText(PANEL_COPY.field.ratio, 'en'),
  ]);
  assert.deepEqual(Array.from(rows[0].querySelectorAll('[data-ladder-group="percent"]'), (button) => button.textContent), ['2%', '10%', '30%', '50%', '70%']);
  assert.deepEqual(Array.from(rows[1].querySelectorAll('[data-ladder-group="percent"]'), (button) => button.textContent), ['0.3%', '1%', '5%', '10%', '30%']);
});

test("user sees a stable five-column option grid in both supported panel languages", (t) => {
  // Given five gap options and both supported interface locales
  const f = createLadderOptionHarness();
  t.after(() => f.close());
  const rows = ['en', 'zh-CN'].map(() => f.document.createElement('section'));

  // When the real option row renderer produces each localized row
  for (const [index, locale] of ['en', 'zh-CN'].entries()) {
    f.context.activeUiLocale = locale;
    rows[index].innerHTML = f.context.ladderOptionRow(PANEL_COPY.field.interval, PANEL_COPY.tooltip.interval, [1, 2, 3, 4, 5], 3, 'step');
  }

  // Then localized label widths preserve five fixed control columns and compact buttons
  assert.deepEqual(rows.map((row) => row.firstElementChild.style.gridTemplateColumns), ['52px repeat(5,minmax(0,1fr))', '36px repeat(5,minmax(0,1fr))']);
  for (const row of rows) {
    assert.equal(row.firstElementChild.style.display, 'grid');
    assert.equal(row.querySelectorAll('button').length, 5);
    assert.deepEqual(Array.from(row.querySelectorAll('button'), (button) => [button.style.width, button.style.minWidth, button.style.height]), Array.from({ length: 5 }, () => ['100%', '0px', '28px']));
    assert.equal(row.querySelector('[data-ladder-value="3"]').style.fontWeight, '500');
  }
});

test("user sees close-long before close-short with their native sell and buy colors", (t) => {
  // Given confirmed long and short positions are available for closing
  const f = createLadderOptionHarness();
  t.after(() => f.close());
  const closeContext = { knowsLong: true, hasLong: true, knowsShort: true, hasShort: true };
  const panel = f.document.createElement('section');

  // When the real close-mode action buttons render
  const sections = f.context.getLadderControlSections('CLOSE', closeContext, 'BTCUSDT', '0.01');
  panel.innerHTML = sections.actionButtons.join('');

  // Then long and short actions keep the native order direction and available state
  const buttons = Array.from(panel.querySelectorAll('button'));
  assert.deepEqual(buttons.map((button) => button.dataset.ladderAction), ['CLOSE_LONG', 'CLOSE_SHORT']);
  assert.deepEqual(buttons.map((button) => button.textContent), ['Close Long', 'Close Short']);
  assert.deepEqual(buttons.map((button) => button.style.color), ['var(--color-Sell)', 'var(--color-Buy)']);
  assert.deepEqual(buttons.map((button) => button.disabled), [false, false]);
});

test('user sees the captured ladder plan quantities and reduced order count in both languages', (t) => {
  // Given a reduced ladder plan retains its original order count and gap
  const f = createLadderOptionHarness();
  t.after(() => f.close());
  const plan = { percent: 30, levels: 3, requestedLevels: 5, ladderStep: 2, spec: { statusLabel: localizedText('阶梯开多', 'Open Long') } };

  // When the real plan detail and status formatters render the captured values
  const detail = f.context.formatLadderPlanDetail(plan);
  const status = f.context.formatLadderPlanStatus(plan);
  const unchanged = f.context.formatLadderPlanDetail({ ...plan, requestedLevels: 3 });

  // Then both locales preserve percent actual-versus-requested orders and price gap
  assert.equal(formatLocalizedText(detail, 'zh-CN'), '30% / 3/5档 / 幅2');
  assert.equal(formatLocalizedText(detail, 'en'), '30% / 3/5 orders / gap 2');
  assert.equal(formatLocalizedText(status, 'zh-CN'), '阶梯开多计划：30% / 3/5档 / 幅2');
  assert.equal(formatLocalizedText(status, 'en'), 'Open Long plan：30% / 3/5 orders / gap 2');
  assert.equal(formatLocalizedText(unchanged, 'zh-CN'), '30% / 3档 / 幅2');
  assert.equal(formatLocalizedText(unchanged, 'en'), '30% / 3 orders / gap 2');
});

test('user observes native context changes through the fixture DOM and real Storage contract', (t) => {
  // Given a fresh native DOM and the browser storage used by the preference functions
  const f = createLadderOptionHarness();
  t.after(() => f.close());
  const initial = f.context.getPanelOptionContext();

  // When the native page changes and the user saves one supported preference
  f.setNativeContext({ symbol: '4USDT', mode: 'Close', precision: '0.001' });
  const current = f.context.getPanelOptionContext();
  const saved = f.context.setLadderClosePercent(5);

  // Then real DOM reads and Storage preserve the full new context and one scheduled render
  assert.deepEqual(JSON.parse(JSON.stringify(initial)), { symbol: 'BTCUSDT', mode: 'OPEN', precision: '0.01' });
  assert.deepEqual(JSON.parse(JSON.stringify(current)), { symbol: '4USDT', mode: 'CLOSE', precision: '0.001' });
  assert.equal(f.document.querySelector('[role="tab"]').textContent, 'Close');
  assert.equal(f.document.querySelector('.tick-content').textContent, '0.001');
  assert.equal(saved, true);
  assert.equal(f.storage.length, 1);
  assert.equal(f.storage.getItem('jh_binance_ladder_close_percent:4USDT:0.001'), '5');
  assert.deepEqual(f.scheduledRenders, ['render']);
});
