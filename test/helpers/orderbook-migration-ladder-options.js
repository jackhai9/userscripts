import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from 'espree';
import { JSDOM } from 'jsdom';

import {
  loadModeSymbolPrecisionNumberOption,
  migrateModeSymbolPrecisionNumberOption,
  saveModeSymbolPrecisionNumberOption,
} from '../../src/binance-orderbook-trade/core/panel-options.js';
import { shouldDisableCloseControl } from '../../src/binance-orderbook-trade/core/close-action.js';
import { normalizeDecimalString } from '../../src/binance-orderbook-trade/core/decimal.js';
import { parseTradeModeLabel } from '../../src/binance-orderbook-trade/dom/trade-form.js';
import { parseFuturesTradingSymbolFromPathname } from '../../src/shared/binance-futures-route.js';
import {
  PANEL_COPY, combineLocalizedText, formatLocalizedText, localizedText,
} from '../../src/binance-orderbook-trade/contracts/panel-copy.js';

const source = readFileSync(new URL('../../src/binance-orderbook-trade/index.user.js', import.meta.url), 'utf8');
const program = parse(source, { ecmaVersion: 'latest', sourceType: 'module', range: true });
const runtime = program.body.find((node) => node.type === 'ExpressionStatement'
  && node.expression.type === 'CallExpression'
  && node.expression.callee.type === 'FunctionExpression').expression.callee.body.body;

const constants = new Set([
  'LOCAL_LADDER_OPEN_PERCENT_KEY', 'LOCAL_LADDER_CLOSE_PERCENT_KEY',
  'LOCAL_LADDER_OPEN_LEVELS_KEY', 'LOCAL_LADDER_CLOSE_LEVELS_KEY',
  'LOCAL_LADDER_OPEN_STEP_KEY', 'LOCAL_LADDER_CLOSE_STEP_KEY',
  'DEFAULT_LADDER_OPEN_PERCENT', 'DEFAULT_LADDER_CLOSE_PERCENT',
  'DEFAULT_LADDER_LEVELS', 'DEFAULT_LADDER_STEP',
  'LADDER_OPEN_PERCENTS', 'LADDER_CLOSE_PERCENTS', 'LADDER_LEVEL_OPTIONS',
  'LADDER_STEP_MIN', 'LADDER_STEP_MAX', 'LADDER_STEP_OPTIONS',
  'LADDER_PERCENT_STORAGE_KEYS', 'LADDER_LEVELS_STORAGE_KEYS', 'LADDER_STEP_STORAGE_KEYS',
  'PRIMARY_EMPHASIS_COLOR', 'PRIMARY_EMPHASIS_FONT_WEIGHT', 'CONTROL_BORDER_COLOR',
  'CONTROL_BACKGROUND_COLOR', 'CONTROL_TEXT_COLOR', 'CONTROL_FONT_WEIGHT',
  'MUTED_TEXT_COLOR', 'NEUTRAL_CONTROL_STYLE',
  'LADDER_CONTROL_BUTTON_HEIGHT', 'LADDER_CONTROL_BUTTON_FONT_SIZE',
]);
const functions = new Set([
  'getCurrentSymbol', 'getActiveTradeMode', 'isOrderbookPrecisionNumericText',
  'findOrderbookPrecisionTrigger', 'readCurrentOrderbookPrecisionValue',
  'getLadderOpenPercent', 'setLadderOpenPercent', 'getLadderClosePercent', 'setLadderClosePercent',
  'getLadderLevels', 'setLadderLevels', 'getLadderStep', 'setLadderStep',
  'readLadderOptionContext', 'areLadderOptionContextsEqual', 'hasLadderOptionContextChanged',
  'getPanelOptionContext', 'ui', 'ladderOptionButton', 'ladderOptionRow',
  'ladderActionButton', 'ladderExecutionButton', 'getLadderControlSections',
  'localizedActionStatus', 'formatLadderPlanDetail', 'formatLadderPlanStatus',
]);
const declarations = runtime.filter((node) => (
  (node.type === 'VariableDeclaration' && node.declarations.some((entry) => constants.has(entry.id.name)))
  || (node.type === 'FunctionDeclaration' && functions.has(node.id.name))
));
assert.equal(declarations.length, constants.size + functions.size);
const fixtureSource = declarations.map((node) => source.slice(...node.range)).join('\n');

/** Executes original preference and rendering functions against real DOM and Storage boundaries. */
export function createLadderOptionHarness() {
  const dom = new JSDOM(`
    <div id="position-direction"><div role="tab" aria-selected="true">Open</div></div>
    <div id="futuresOrderbook"><div class="orderbook-tickSize"><span class="tick-content">0.01</span></div></div>
  `, { url: 'https://fixture.example/en/futures/BTCUSDT' });
  const scheduledRenders = [];
  const context = vm.createContext({
    document: dom.window.document,
    location: dom.window.location,
    localStorage: dom.window.localStorage,
    loadModeSymbolPrecisionNumberOption,
    migrateModeSymbolPrecisionNumberOption,
    saveModeSymbolPrecisionNumberOption,
    shouldDisableCloseControl,
    normalizeDecimalString,
    parseTradeModeLabel,
    parseFuturesTradingSymbolFromPathname,
    PANEL_COPY, combineLocalizedText, formatLocalizedText, localizedText,
    activeUiLocale: 'en',
    ladderTask: null,
    continuousLadderTask: null,
    singleOrderTask: null,
    cancelCurrentSymbolOpenOrdersBlocksLadderActions: false,
    activeLadderActionType: null,
    activeContinuousLadderActionType: null,
    scheduleRenderPanel() { scheduledRenders.push('render'); },
  });
  vm.runInContext(fixtureSource, context, { filename: 'orderbook-ladder-options-fixture.js' });
  return {
    context,
    document: dom.window.document,
    storage: dom.window.localStorage,
    scheduledRenders,
    setNativeContext({ symbol, mode, precision }) {
      dom.reconfigure({ url: `https://fixture.example/en/futures/${symbol}` });
      dom.window.document.querySelector('[role="tab"]').textContent = mode;
      dom.window.document.querySelector('.tick-content').textContent = precision;
    },
    close() { dom.window.close(); },
  };
}
