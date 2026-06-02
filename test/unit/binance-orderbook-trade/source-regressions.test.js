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

test('visible SVG controls do not require offset dimensions', () => {
  const visibleBody = readFunctionBody('isVisibleElement');
  assert.match(visibleBody, /Array\.from\(el\.getClientRects\(\)\)/);
  assert.match(visibleBody, /if \(!rects\.length\) return false/);
  assert.match(visibleBody, /if \(el\.offsetWidth \|\| el\.offsetHeight\) return true/);
  assert.match(visibleBody, /rects\.some\(\(rect\) => rect\.width > 0 && rect\.height > 0\)/);
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

  const clickDomTargetBody = readFunctionBody('clickDomTarget');
  assert.match(clickDomTargetBody, /typeof target\.click === 'function'/);
  assert.match(clickDomTargetBody, /new MouseEvent\('click'/);
  assert.match(clickDomTargetBody, /bubbles: true/);

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
  assert.match(waitRowsBody, /let currentRoot = root/);
  assert.match(waitRowsBody, /readCurrentSymbolOpenOrderRows\(currentRoot,\s*symbol,\s*plan\)/);
  assert.match(waitRowsBody, /const refreshedRoot = getActiveOpenOrdersScope\(\)/);
  assert.match(waitRowsBody, /if \(refreshedRoot\) currentRoot = refreshedRoot/);

  const cancelOpenOrderRowsBody = readFunctionBody('cancelOpenOrderRowsForPlan');
  assert.match(cancelOpenOrderRowsBody, /let currentRoot = root/);
  assert.match(cancelOpenOrderRowsBody, /readCurrentSymbolOpenOrderRows\(currentRoot,\s*plan\.symbol,\s*plan\)/);
  assert.match(cancelOpenOrderRowsBody, /const remainingQty = subtractDecimalStrings\(plan\.totalQty,\s*cancelQty\)/);
  assert.match(cancelOpenOrderRowsBody, /allowPartial: true/);
  assert.match(cancelOpenOrderRowsBody, /const refreshedRoot = getActiveOpenOrdersScope\(\)/);
  assert.match(cancelOpenOrderRowsBody, /currentRoot = refreshedRoot/);
  assert.match(cancelOpenOrderRowsBody, /currentRoot = row\.root \|\| currentRoot/);
  assert.match(cancelOpenOrderRowsBody, /clickDomTarget\(row\.cancelButton\)/);
  assert.doesNotMatch(cancelOpenOrderRowsBody, /row\.cancelButton\.click\(\)/);
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

test('orderbook precision recommendation is sampled and manually applied only', () => {
  assert.match(source, /ORDERBOOK_PRECISION_MANUAL_SAMPLE_DURATION_MS = 6000/);
  assert.match(source, /ORDERBOOK_PRECISION_SAMPLE_DURATION_MS = ORDERBOOK_PRECISION_MANUAL_SAMPLE_DURATION_MS/);
  assert.doesNotMatch(source, /ORDERBOOK_PRECISION_SAMPLE_PAUSE_MS/);
  assert.match(source, /LOCAL_ORDERBOOK_PRECISION_SAMPLES_PREFIX = 'jh_binance_orderbook_precision_samples_v3'/);
  assert.match(source, /data-orderbook-precision-apply/);
  assert.match(source, /data-orderbook-precision-refresh/);
  assert.match(source, /orderbookPrecisionResampleRequested/);

  const sampleBody = readFunctionBody('runOrderbookPrecisionSampleRound');
  assert.match(sampleBody, /collectNonZeroPriceMoves/);
  assert.match(sampleBody, /saveStoredOrderbookPrecisionSamples\(symbol,\s*newSamples\)/);
  assert.doesNotMatch(sampleBody, /mergePrecisionSamples\(\s*readStoredOrderbookPrecisionSamples/);
  assert.match(sampleBody, /waitForLatestTradePricesReady/);
  assert.match(sampleBody, /ORDERBOOK_PRECISION_SAMPLE_DURATION_MS/);
  assert.match(sampleBody, /getLatestTradePrices/);
  assert.doesNotMatch(sampleBody, /getCurrentOrderbookDisplayStep/);
  assert.doesNotMatch(sampleBody, /fallbackMovement/);
  assert.match(sampleBody, /orderbookPrecisionResampleRequested/);
  assert.doesNotMatch(sampleBody, /ORDERBOOK_PRECISION_SAMPLE_PAUSE_MS/);
  assert.match(sampleBody, /orderbookPrecisionState[\s\S]*sampleEndsAt: deadline/);
  assert.match(sampleBody, /scheduleRenderPanel\(\{ followUpMs: 1000 \}\)/);

  const refreshBody = readFunctionBody('refreshOrderbookPrecisionRecommendation');
  assert.match(refreshBody, /recommendOrderbookPrecision/);
  assert.match(refreshBody, /isOrderbookPrecisionBusy/);
  assert.match(refreshBody, /formatOrderbookPrecisionBusyStatus/);
  assert.match(refreshBody, /data-orderbook-precision-refresh="true"[\s\S]*disabled/);
  assert.doesNotMatch(refreshBody, /样本/);
  assert.doesNotMatch(refreshBody, /sampleText/);
  assert.doesNotMatch(refreshBody, /当前 \$\{currentText\}/);
  assert.doesNotMatch(refreshBody, /fallbackMovement/);
  assert.doesNotMatch(refreshBody, /applyRecommendedOrderbookPrecision\(\)/);
  assert.match(refreshBody, /buttonBaseStyle = 'height:32px;[^']*padding:0 12px;[^']*font-size:14px;line-height:30px;/);
  assert.match(refreshBody, /margin-top:8px;[^']*font-size:14px;/);
  const recommendationIndex = refreshBody.indexOf('<span>缩放 推荐 ${recommendationText}</span>');
  const applyButtonIndex = refreshBody.indexOf('data-orderbook-precision-apply="true"');
  const refreshButtonIndex = refreshBody.indexOf('data-orderbook-precision-refresh="true"');
  const statusTextIndex = refreshBody.lastIndexOf('statusText');
  assert.ok(recommendationIndex < applyButtonIndex, 'recommendation text should stay before the Apply button');
  assert.ok(applyButtonIndex < refreshButtonIndex, 'Apply button should stay before the Refresh button');
  assert.ok(refreshButtonIndex < statusTextIndex, 'transient precision status should stay after both buttons');

  const busyStatusBody = readFunctionBody('formatOrderbookPrecisionBusyStatus');
  assert.match(busyStatusBody, /Math\.ceil\(remainingMs \/ 1000\)/);
  assert.match(busyStatusBody, /刷新中 \$\{remainingSeconds\}s/);

  const applyBody = readFunctionBody('applyRecommendedOrderbookPrecision');
  assert.match(applyBody, /let option = findVisibleOrderbookPrecisionOption\(recommendation\)/);
  assert.match(applyBody, /if \(!option\) \{\s*await openOrderbookPrecisionOptions\(trigger\.element\)/);
  assert.doesNotMatch(applyBody, /clickDomTarget\(trigger\.element\)/);
  assert.match(applyBody, /waitForVisibleOrderbookPrecisionOption\(recommendation\)/);
  assert.doesNotMatch(applyBody, /readVisibleOrderbookPrecisionOptionValues/);
  assert.doesNotMatch(applyBody, /fallbackMovement/);

  const openOptionsBody = readFunctionBody('openOrderbookPrecisionOptions');
  assert.match(openOptionsBody, /mousedown/);
  assert.match(openOptionsBody, /pointerdown/);

  const openEventBody = readFunctionBody('dispatchOrderbookPrecisionOpenEvent');
  assert.match(openEventBody, /PointerEvent/);
  assert.match(openEventBody, /MouseEvent/);

  const waitOptionsBody = readFunctionBody('waitForVisibleOrderbookPrecisionOptions');
  assert.match(waitOptionsBody, /getVisibleOrderbookPrecisionOptionNodes\(\)\.length/);
  assert.match(waitOptionsBody, /await delay\(50\)/);

  const scheduleBody = readFunctionBody('scheduleOrderbookPrecisionSampleRound');
  assert.match(scheduleBody, /force = false/);
  assert.match(scheduleBody, /if \(force\) orderbookPrecisionResampleRequested = true/);
  assert.match(scheduleBody, /durationMs/);

  const initialBody = readFunctionBody('startInitialOrderbookPrecisionSample');
  assert.match(initialBody, /orderbookPrecisionInitialSampledSymbols\.has\(symbol\)/);

  const triggerBody = readFunctionBody('findOrderbookPrecisionTrigger');
  assert.match(triggerBody, /\.orderbook-tickSize/);
  assert.match(triggerBody, /\.tick-content/);
  assert.match(triggerBody, /node\.closest\(clickableSelector\) \|\| node\.parentElement \|\| node/);

  const optionsBody = readFunctionBody('getVisibleOrderbookPrecisionOptionNodes');
  assert.match(optionsBody, /\.ob-ticksize-item/);
  assert.match(optionsBody, /\.ob-ticksize-overlay/);
  assert.match(optionsBody, /readOrderbookPrecisionOptionValue\(node\)/);
  assert.match(optionsBody, /getOrderbookPrecisionOptionClickTarget\(node\)/);
  assert.match(optionsBody, /ORDERBOOK_PRECISION_CANDIDATE_OPTIONS\.includes/);
  assert.match(optionsBody, /popupSelector/);

  const optionValueBody = readFunctionBody('readOrderbookPrecisionOptionValue');
  assert.match(optionValueBody, /\.ob-ticksize-item/);
  assert.match(optionValueBody, /querySelector\('span'\)/);

  const optionTargetBody = readFunctionBody('getOrderbookPrecisionOptionClickTarget');
  assert.match(optionTargetBody, /closest\?\.\('\.ob-ticksize-item'\)/);

  const findOptionBody = readFunctionBody('findVisibleOrderbookPrecisionOption');
  assert.match(findOptionBody, /readOrderbookPrecisionOptionValue\(node\) === normalized/);

  const startBody = readFunctionBody('startLadder');
  assert.doesNotMatch(startBody, /applyRecommendedOrderbookPrecision/);
  assert.doesNotMatch(startBody, /runOrderbookPrecisionSampleRound/);
});
