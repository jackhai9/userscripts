import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'acorn';

const source = await readFile(new URL('../../../src/binance-orderbook-trade/index.user.js', import.meta.url), 'utf8');
const generatedSource = await readFile(new URL('../../../scripts/binance-orderbook-trade.user.js', import.meta.url), 'utf8');
const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });

/** Static checks cover distribution, module boundaries, and CSS contracts only. */
function readFunctionBody(name) {
  let declaration;
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (['FunctionDeclaration', 'FunctionExpression'].includes(node.type) && node.id?.name === name) declaration = node;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(ast);
  assert.notEqual(declaration, undefined, name + ' must retain its module boundary');
  return source.slice(declaration.body.start + 1, declaration.body.end - 1);
}

test('user installs the same version and update endpoints declared by the editable source', () => {
  // Given the editable entrypoint and the generated installation artifact.
  const inputs = [source, generatedSource];
  // When their distribution metadata is parsed independently.
  const metadata = inputs.map(input => Object.fromEntries(Array.from(
    input.matchAll(/^\/\/ @(version|updateURL|downloadURL)\s+(\S+)\s*$/gm),
    ([, key, value]) => [key, value],
  )));
  // Then both have a valid identical version and canonical update endpoints.
  assert.match(metadata[0].version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(metadata[1], metadata[0]);
  assert.equal(metadata[0].updateURL, 'https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-orderbook-trade.user.js');
  assert.equal(metadata[0].downloadURL, metadata[0].updateURL);
});

test('user receives an event-driven route integration with one declared watchdog', () => {
  // Given the entrypoint owns route integration with shared route notification.
  const name = 'startRouteWatcher';
  // When the shipped integration boundary is inspected.
  const integration = readFunctionBody(name);
  // Then it retains the event subscription and one five-second watchdog.
  assert.match(source, /installSpaRouteChangeListener\(window, syncRouteState\)/);
  assert.match(source, /const ROUTE_WATCHDOG_MS = 5000;/);
  assert.equal((integration.match(/setInterval\(/g) || []).length, 1);
  assert.match(integration, /ROUTE_WATCHDOG_MS/);
  assert.doesNotMatch(source, /function startSymbolChangeTimer\(|function startRenderPanelTimer\(/);
});

test('user receives permanent native observers scoped to their owning controls', () => {
  // Given the mode and precision integrations observe their own components.
  const names = ['ensureTradeModeTabObserver', 'ensureOrderbookPrecisionObserver'];
  // When their observer declarations are inspected.
  const [tradeMode, precision] = names.map(readFunctionBody);
  // Then neither watches the document body and precision subscribes to its root text.
  assert.match(tradeMode, /getTradeModeObserverRoot\(\)/);
  assert.doesNotMatch(tradeMode, /observe\(document\.body/);
  assert.match(precision, /document\.querySelector\('#futuresOrderbook \.orderbook-tickSize'\)/);
  assert.match(precision, /orderbookPrecisionObserver\.observe\(root,/);
  assert.match(precision, /childList: true/);
  assert.match(precision, /characterData: true/);
  assert.doesNotMatch(precision, /observe\(document\.body/);
});

test('user receives shared emphasis styles for numeric values and selected options', () => {
  // Given the precision choices and ladder options share the visual contract.
  const names = ['renderOrderbookPrecisionShortcut', 'ladderOptionButton'];
  // When their shipped styles are inspected.
  const buttons = names.map(readFunctionBody);
  // Then selected values use the agreed black medium-weight text and native yellow border.
  assert.match(source, /const PRIMARY_EMPHASIS_COLOR = '#000000';/);
  assert.match(source, /const PRIMARY_EMPHASIS_FONT_WEIGHT = '500';/);
  for (const button of buttons) {
    assert.match(button, /border-color:var\(--color-PrimaryYellow\)/);
    assert.match(button, /color:\$\{PRIMARY_EMPHASIS_COLOR\};font-weight:\$\{PRIMARY_EMPHASIS_FONT_WEIGHT\}/);
  }
});

test('user receives disabled styles only for panel buttons and explicitly owned native controls', () => {
  // Given the panel owns one disabled-state stylesheet.
  const name = 'injectDisabledControlStyle';
  // When its emitted CSS contract is inspected.
  const style = readFunctionBody(name);
  // Then native controls require an explicit ownership marker and panel controls retain explicit colors.
  assert.match(style, /#\$\{PANEL_ID\} button:disabled/);
  assert.match(style, /button\[\$\{NATIVE_ACTION_DISABLED_ATTR\}="true"\]/);
  assert.doesNotMatch(style, /^\s*button:disabled\s*\{/m);
  assert.match(source, /const CONTROL_BORDER_COLOR = '#d5d9e2';/);
  assert.match(source, /const CONTROL_BACKGROUND_COLOR = '#ffffff';/);
  assert.match(source, /const CONTROL_TEXT_COLOR = '#5e6673';/);
  assert.match(source, /const MUTED_TEXT_COLOR = '#76808f';/);
});

test('user receives fixed single-line layout slots for dynamic text and actions', () => {
  // Given panel text and action controls have a declared layout contract.
  const names = ['ensurePanel', 'ladderActionButton', 'ladderExecutionButton'];
  // When their markup and styles are inspected.
  const [panel, action, stop] = names.map(readFunctionBody);
  // Then changing text cannot wrap or collapse the reserved status row.
  assert.match(panel, /data-multiplier-calculation style="display:flex;align-items:center;gap:7px;height:18px;margin-top:4px;overflow:hidden;white-space:nowrap/);
  assert.match(panel, /data-panel-group="direction" style="display:flex;align-items:center;justify-content:flex-start;gap:6px;height:32px;overflow:hidden/);
  assert.match(panel, /id="\$\{LADDER_STATUS_ROW_ID\}"[^>]*display:flex;[^>]*height:18px;[^>]*visibility:visible;[^>]*white-space:nowrap;overflow:hidden/);
  assert.match(action, /white-space:nowrap;overflow:hidden;text-overflow:ellipsis/);
  assert.match(stop, /white-space:nowrap;overflow:hidden/);
});

test('user receives a floating panel below the native Binance portal layer', () => {
  // Given creation and floating placement share one stacking contract.
  const names = ['ensurePanel', 'placePanelFloating'];
  // When their stacking declarations are inspected.
  const bodies = names.map(readFunctionBody);
  // Then both use the agreed level without the former overlay-blocking level.
  assert.match(source, /const PANEL_Z_INDEX = 1000/);
  for (const body of bodies) assert.match(body, /panel\.style\.zIndex = String\(PANEL_Z_INDEX\)/);
  assert.doesNotMatch(source, /panel\.style\.zIndex = '999999'/);
});

test('user receives semantic panel groups and multiplier controls in the declared visual order', () => {
  // Given the template declares separate groups and ordered multiplier controls.
  const groupMarkers = ['data-panel-zone="single-order"', 'data-panel-group="direction"',
    'id="${MODE_HINT_ID}"', 'data-panel-group="multiplier"', 'id="jh-binance-close-qty-min"', 'data-panel-group="ladder"'];
  const multiplierMarkers = ['id="${MULTIPLIER_HINT_ID}"', 'id="${INPUT_ID}"',
    'PANEL_COPY.field.multiplierUnit', 'id="${DEC_ID}"', 'id="${INC_ID}"'];
  // When the markers are located in the shipped template.
  const panel = readFunctionBody('ensurePanel');
  const groups = [groupMarkers, multiplierMarkers].map(markers => markers.map(marker => panel.indexOf(marker)));
  // Then every marker exists in order and the ladder keeps its own divider.
  for (const positions of groups) {
    for (const position of positions) assert.ok(position >= 0);
    for (let index = 1; index < positions.length; index += 1) assert.ok(positions[index] > positions[index - 1]);
  }
  assert.match(panel, /data-panel-group="ladder" style="margin:12px -10px 0;padding:11px 10px 0;border-top:2px solid \$\{PANEL_DIVIDER_COLOR\}/);
  assert.match(source, /const PANEL_DIVIDER_COLOR = '#ededed'/);
});

test('user receives accessible two-direction radio markup with a shared boundary', () => {
  // Given native direction choices use the panel radio group.
  const name = 'ensurePanel';
  // When its accessibility and CSS declarations are inspected.
  const panel = readFunctionBody(name);
  // Then exactly two radios share one labelled group and an internal divider.
  assert.match(panel, /data-side-selector role="radiogroup" aria-labelledby="\$\{MODE_HINT_ID\}"/);
  assert.equal((panel.match(/role="radio" aria-checked="false"/g) || []).length, 2);
  assert.match(panel, /id="\$\{SIDE_LONG_ID\}"[^>]*border:0;/);
  assert.match(panel, /id="\$\{SIDE_SHORT_ID\}"[^>]*border:0;/);
  assert.match(panel, /border-left:1px solid var\(--color-InputLine\)/);
});
