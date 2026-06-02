import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = await readFile(new URL('../../../src/binance-orderbook-trade/index.user.js', import.meta.url), 'utf8');
const ladderPlanSource = await readFile(new URL('../../../src/binance-orderbook-trade/core/ladder-plan.js', import.meta.url), 'utf8');

function readFunctionBody(name, sourceText = source) {
  const start = sourceText.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const braceStart = sourceText.indexOf('{', start);
  let depth = 0;
  for (let index = braceStart; index < sourceText.length; index += 1) {
    const char = sourceText[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return sourceText.slice(braceStart + 1, index);
  }
  assert.fail(`${name} body should be closed`);
}

test('symbol-change polling is stopped while the tab is hidden', () => {
  assert.doesNotMatch(source, /\n  setInterval\(checkSymbolChangeForLeverage,\s*500\);/);
  assert.match(source, /function startSymbolChangeTimer\(\)/);
  assert.match(source, /function stopSymbolChangeTimer\(\)/);
  const stopTradingBody = readFunctionBody('stopTradingTimers');
  assert.match(stopTradingBody, /stopSymbolChangeTimer\(\)/);
  const visibilityBody = source.match(/document\.addEventListener\('visibilitychange', \(\) => \{([\s\S]*?)\n  \}\);/)?.[1] || '';
  assert.match(visibilityBody, /stopTradingTimers\(\)/);
  assert.match(visibilityBody, /syncRouteState\(\)/);
});

test('permanent trade-mode observer is scoped to the trade tab root', () => {
  const observerBody = readFunctionBody('ensureTradeModeTabObserver');
  assert.doesNotMatch(observerBody, /observe\(document\.body/);
  assert.match(observerBody, /getTradeModeObserverRoot\(\)/);
});

test('cancel-symbol flow restores temporary symbol filter through cleanup path', () => {
  const cancelBody = readFunctionBody('cancelCurrentSymbolOpenOrders');
  assert.match(cancelBody, /finally\s*\{/);
  assert.match(cancelBody, /await waitForNewVisibleDialog\(dialogsBefore\)/);
  assert.match(cancelBody, /restoreOpenOrdersSymbolFilter\(openOrdersScope,\s*symbolFilterOriginalChecked\)/);
});

test('expanded ladder panel avoids rebuilding unchanged body markup', () => {
  const ladderBody = readFunctionBody('refreshLadderPanel');
  assert.match(ladderBody, /ladderPanelBodySignature/);
  assert.match(ladderBody, /body\.innerHTML = bodyHtml/);
});

test('route watcher owns non-trading page pause instead of business timers spinning forever', () => {
  assert.match(source, /function startRouteWatcher\(\)/);
  assert.match(source, /function pauseForNonTradingPage\(\)/);
  const pauseBody = readFunctionBody('pauseForNonTradingPage');
  assert.match(pauseBody, /stopTradingTimers\(\)/);
  assert.doesNotMatch(pauseBody, /stopRouteWatcher\(\)/);
});

test('Post Only synthetic click helper dispatches a single click event', () => {
  const clickBody = readFunctionBody('clickElementLikeUser');
  assert.match(clickBody, /dispatchEvent\(new MouseEvent\('click'/);
  assert.doesNotMatch(clickBody, /\.click\?\.\(\)/);
});

test('close ladder retries with replacement only after Binance reduce-only conflict feedback', () => {
  const replaceBody = readFunctionBody('isReplaceableCloseLadderOpenOrdersFailure');
  assert.match(replaceBody, /plan\?\.spec\?\.mode !== 'CLOSE'/);
  assert.match(replaceBody, /isReduceOnlyOpenOrdersConflictFeedback\(error\?\.message/);

  const retryBody = readFunctionBody('runLadderPlanWithOpenOrderReplacement');
  assert.match(retryBody, /await executeLadderPlan\(plan\)/);
  assert.match(retryBody, /isReplaceableCloseLadderOpenOrdersFailure\(plan,\s*e\)/);
  assert.match(retryBody, /cancelCurrentSymbolOpenOrdersForPlan\(plan\)/);
  assert.doesNotMatch(retryBody, /cancelCurrentSymbolOpenOrders\(\{\s*waitUntilCleared: true\s*\}\)/);
  assert.match(retryBody, /const replacementSymbol = plan\.symbol/);
  assert.match(retryBody, /plan = await buildLadderPlan\(actionType,\s*replacementSymbol\)/);
  assert.doesNotMatch(retryBody, /result[\s\S]*plan = await buildLadderPlan\(actionType\);/);

  const startBody = readFunctionBody('startLadder');
  assert.match(startBody, /const spec = getLadderActionSpec\(actionType\)/);
  assert.doesNotMatch(startBody, /cancelCurrentSymbolOpenOrders\(\{\s*waitUntilCleared: true\s*\}\)/);
  assert.match(startBody, /runLadderPlanWithOpenOrderReplacement\(actionType\)/);
});

test('ladder minimum quantity failure explains safe manual options', () => {
  const buildBody = readFunctionBody('buildLadderPlan');
  assert.match(buildBody, /const minRequiredQtyByLevel = spec\.mode === 'OPEN'/);
  assert.match(buildBody, /getQtyRuleContext\(startSymbol,\s*spec\.mode,\s*price\)\.effectiveMinQty \|\| ruleContext\.baseMinQty/);
  assert.match(buildBody, /fitLadderPlanForMinimumQty\(\{\s*baseQty,\s*minRequiredQty,\s*minRequiredQtyByLevel,\s*percent,\s*levels,\s*stepSize: ruleContext\.stepSize,\s*maxPercent: getMaxAutoFitLadderPercent\(spec\.mode\),\s*\}\)/);
  assert.match(buildBody, /allocation = autoFit\.allocation/);
  assert.match(buildBody, /percent = autoFit\.percent/);
  assert.match(buildBody, /minRequiredQty = autoFit\.minRequiredQty \|\| minRequiredQty/);
  assert.match(buildBody, /autoFitLevels = autoFit\.levels/);
  assert.match(buildBody, /autoFitPercent: autoFitPercent/);
  assert.match(buildBody, /autoFitLevels/);
  assert.match(buildBody, /createLadderMinimumQtyFailure\(\{\s*mode: spec\.mode,\s*minRequiredQty,\s*baseQty,\s*percent,\s*levels,\s*minimumPercent: autoFit\.minimumPercent,\s*maxAutoFitPercent: autoFit\.maxPercent,\s*\}\)/);

  const errorBody = readFunctionBody('createLadderMinimumQtyFailure');
  assert.match(errorBody, /数量低于最小下单量/);
  assert.match(errorBody, /error\.statusTitle/);
  assert.match(errorBody, /当前\$\{percentLabel\}/);
  assert.match(errorBody, /至少需要\$\{percentLabel\}/);
  assert.match(errorBody, /自动上限/);
  assert.match(errorBody, /当前档位/);
  assert.match(errorBody, /开仓比例/);
  assert.match(errorBody, /平仓比例/);
  assert.match(errorBody, /自动提高比例/);
  assert.match(errorBody, /自动降档/);
  assert.match(errorBody, /脚本不会自动撤单/);
  assert.doesNotMatch(errorBody, /将自动撤单/);

  const percentBody = readFunctionBody('computeMinimumLadderPercent', ladderPlanSource);
  assert.match(percentBody, /parseDecimalString\(baseQty\)/);
  assert.match(percentBody, /decimalToStepCount\(minRequiredQty,\s*stepSize,\s*'ceil'\)/);
  assert.match(percentBody, /formatStepCount\(minSteps \* BigInt\(requestedLevels\),\s*stepSize\)/);
  assert.match(percentBody, /formatDecimalParts\(scaledPercent,\s*2\)/);

  const fitBody = readFunctionBody('fitLadderPlanForMinimumQty', ladderPlanSource);
  assert.match(fitBody, /getMinRequiredQtyForLevels\(minRequiredQty,\s*minRequiredQtyByLevel,\s*candidateLevels\)/);
  assert.match(fitBody, /for \(let candidateLevels = requestedLevels; candidateLevels >= 1; candidateLevels -= 1\)/);
  assert.match(fitBody, /computeMinimumLadderPercent\(baseQty,\s*candidateMinRequiredQty,\s*candidateLevels,\s*stepSize\)/);
  assert.match(fitBody, /compareDecimalStrings\(candidatePercent,\s*maxPercent\) > 0/);
  assert.match(fitBody, /allocateLadderQuantities\(fitTotalQty,\s*candidateLevels,\s*stepSize,\s*candidateMinRequiredQty\)/);
  assert.match(fitBody, /minRequiredQty: candidateMinRequiredQty/);
  assert.match(fitBody, /levels: candidateLevels/);

  const maxBody = readFunctionBody('getMaxAutoFitLadderPercent');
  assert.match(maxBody, /Math\.max\(\.\.\.LADDER_OPEN_PERCENTS\)/);
  assert.match(maxBody, /100/);

  const statusBody = readFunctionBody('setLadderStatus');
  assert.match(statusBody, /statusEl\.title =/);

  const startBody = readFunctionBody('startLadder');
  assert.match(startBody, /setLadderStatus\(e\?\.message \|\| '执行失败',\s*e\?\.statusTitle\)/);
});

test('close ladder replacement cancels visible current-symbol rows up to planned quantity', () => {
  const readRowsBody = readFunctionBody('readCurrentSymbolOpenOrderRows');
  assert.match(readRowsBody, /querySelectorAll\('\.list-item-container'\)/);
  assert.match(readRowsBody, /cells\[5\]/);
  assert.match(readRowsBody, /sideText/);
  assert.match(readRowsBody, /isOpenOrderRowCurrentSymbol\(row\.symbolText,\s*symbol\)/);
  assert.match(readRowsBody, /isOpenOrderRowForClosePlan\(row\.sideText,\s*plan\)/);
  assert.doesNotMatch(readRowsBody, /symbolText\.includes\(symbol\)/);

  const cancelButtonBody = readFunctionBody('findOpenOrderRowCancelButton');
  assert.match(cancelButtonBody, /aria-label="撤销挂单"/);
  assert.match(cancelButtonBody, /const target = icon\.closest\('button, \[role="button"\], a, \[tabindex\]'\) \|\| icon/);
  assert.doesNotMatch(cancelButtonBody, /\|\| icon\.parentElement \|\| icon/);

  const selectRowsBody = readFunctionBody('selectOpenOrderRowsToCancelForPlan');
  assert.match(selectRowsBody, /allowPartial = false/);
  assert.match(selectRowsBody, /isOpenOrderRowForClosePlan\(row\.sideText,\s*plan\)/);
  assert.match(selectRowsBody, /compareDecimalStrings\(cancelQty,\s*plan\.totalQty\)/);
  assert.match(selectRowsBody, /addDecimalStrings\(cancelQty,\s*row\.qty\)/);
  assert.match(selectRowsBody, /allowPartial && rowsToCancel\.length > 0/);
  assert.match(selectRowsBody, /return compareDecimalStrings\(cancelQty,\s*plan\.totalQty\) >= 0/);
  assert.match(selectRowsBody, /: \[\]/);

  const directionBody = readFunctionBody('isOpenOrderRowForClosePlan');
  assert.match(directionBody, /includes\('平多'\)/);
  assert.match(directionBody, /includes\('CLOSELONG'\)/);
  assert.match(directionBody, /includes\('平空'\)/);
  assert.match(directionBody, /includes\('CLOSESHORT'\)/);
  assert.doesNotMatch(directionBody, /includes\('SELL'\)/);
  assert.doesNotMatch(directionBody, /includes\('BUY'\)/);

  const waitRowsBody = readFunctionBody('waitForCurrentSymbolOpenOrderRows');
  assert.match(waitRowsBody, /openOrdersCount/);
  assert.match(waitRowsBody, /LADDER_REPLACE_OPEN_ORDERS_CLEAR_TIMEOUT_MS/);

  const cancelOpenOrderRowsBody = readFunctionBody('cancelOpenOrderRowsForPlan');
  assert.match(cancelOpenOrderRowsBody, /readCurrentSymbolOpenOrderRows\(root,\s*plan\.symbol,\s*plan\)/);
  assert.match(cancelOpenOrderRowsBody, /const remainingQty = subtractDecimalStrings\(plan\.totalQty,\s*cancelQty\)/);
  assert.match(cancelOpenOrderRowsBody, /allowPartial: true/);
  assert.doesNotMatch(cancelOpenOrderRowsBody, /for \(const row of rowsToCancel\)/);

  const cancelRowsBody = readFunctionBody('cancelCurrentSymbolOpenOrdersForPlan');
  assert.match(cancelRowsBody, /const openOrdersCount = getOpenOrdersTabCount\(\)/);
  assert.match(cancelRowsBody, /activateOpenOrdersBasicSubTab\(openOrdersScope\)[\s\S]*openOrdersScope = await waitForActiveOpenOrdersScope\(\)/);
  assert.match(cancelRowsBody, /if \(!openOrdersScope\) \{\s*const message = '未定位到当前委托面板'/);
  assert.match(cancelRowsBody, /waitForCurrentSymbolOpenOrderRows\(openOrdersScope,\s*symbol,\s*plan,\s*\{\s*openOrdersCount,\s*\}\)/);
  assert.match(cancelRowsBody, /getClosePlanDirectionLabel\(plan\)/);
  assert.match(cancelRowsBody, /selectOpenOrderRowsToCancelForPlan\(plan,\s*rows,\s*\{\s*allowPartial: true\s*\}\)/);
  assert.match(cancelRowsBody, /await cancelOpenOrderRowsForPlan\(openOrdersScope,\s*plan\)/);
  assert.doesNotMatch(cancelRowsBody, /findCurrentSymbolCancelAllButton/);
});

test('cancel current-symbol open orders can wait until replacement orders are cleared', () => {
  const cancelBody = readFunctionBody('cancelCurrentSymbolOpenOrders');
  assert.match(cancelBody, /waitUntilCleared = false/);
  assert.match(cancelBody, /waitForNoCurrentSymbolOpenOrders\(openOrdersScope,\s*symbol,\s*symbolFilter\.ok\)/);
  assert.match(cancelBody, /return \{ ok: true, status: 'cleared'/);
  assert.match(cancelBody, /return \{ ok: false, status: 'not_cleared'/);
});
