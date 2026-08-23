import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = await readFile(new URL('../../../src/binance-orderbook-trade/index.user.js', import.meta.url), 'utf8');
const generatedSource = await readFile(new URL('../../../scripts/binance-orderbook-trade.user.js', import.meta.url), 'utf8');
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
  const cancelBody = readFunctionBody('runCancelCurrentSymbolOpenOrders');
  assert.match(cancelBody, /finally\s*\{/);
  assert.match(cancelBody, /await waitForNewVisibleDialog\(dialogsBefore\)/);
  assert.match(cancelBody, /restoreOpenOrdersSymbolFilter\(openOrdersScope,\s*symbolFilterOriginalChecked,\s*symbol\)/);
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

test('ladder retries with restricted open-order replacement after supported feedback', () => {
  const replaceBody = readFunctionBody('isReplaceableCloseLadderOpenOrdersFailure');
  assert.match(replaceBody, /plan\?\.spec\?\.mode !== 'CLOSE'/);
  assert.match(replaceBody, /isReduceOnlyOpenOrdersConflictFeedback\(error\?\.message/);

  const openReplaceBody = readFunctionBody('isReplaceableOpenLadderOpenOrdersFailure');
  assert.match(openReplaceBody, /plan\?\.spec\?\.mode !== 'OPEN'/);
  assert.match(openReplaceBody, /isOpenLadderOpenOrdersCapacityFeedback\(error\?\.message/);

  const replacePlanBody = readFunctionBody('getReplaceableLadderOpenOrdersPlan');
  assert.match(replacePlanBody, /isReplaceableCloseLadderOpenOrdersFailure\(plan,\s*error\)/);
  assert.match(replacePlanBody, /isReplaceableOpenLadderOpenOrdersFailure\(plan,\s*error\)/);
  assert.match(replacePlanBody, /getOpenLadderMinimumQtyReplacementPlan\(error\)/);

  const retryBody = readFunctionBody('runLadderPlanWithOpenOrderReplacement');
  assert.match(retryBody, /await executeLadderPlan\(plan\)/);
  assert.match(retryBody, /getReplaceableLadderOpenOrdersPlan\(plan,\s*e\)/);
  assert.match(retryBody, /cancelCurrentSymbolOpenOrdersForPlan\(replacementPlan\)/);
  assert.doesNotMatch(retryBody, /cancelCurrentSymbolOpenOrders\(\{\s*waitUntilCleared: true\s*\}\)/);
  assert.match(retryBody, /replacementSymbol = replacementPlan\.symbol/);
  assert.match(retryBody, /buildLadderPlan\(actionType,\s*replacementSymbol\)/);
  assert.doesNotMatch(retryBody, /findCurrentSymbolCancelAllButton/);

  const startBody = readFunctionBody('startLadder');
  assert.match(startBody, /const spec = getLadderActionSpec\(actionType\)/);
  assert.doesNotMatch(startBody, /cancelCurrentSymbolOpenOrders\(\{\s*waitUntilCleared: true\s*\}\)/);
  assert.match(startBody, /runLadderPlanWithOpenOrderReplacement\(actionType\)/);
});

test('open and close ladders reprice only remaining orders after explicit maker conflicts', () => {
  const retryBody = readFunctionBody('isRetryableLadderMakerPriceFailure');
  assert.match(retryBody, /plan\?\.spec\?\.mode !== 'OPEN'/);
  assert.match(retryBody, /plan\?\.spec\?\.mode !== 'CLOSE'/);
  assert.match(retryBody, /error\?\.ladderFailureKind === 'maker_price_conflict'/);
  assert.match(retryBody, /isBinancePostOnlyMakerRejectCode\(error\?\.binanceCode\)/);
  assert.match(retryBody, /maker_price_conflict'\) return error\.safeNoSubmit === true/);
  assert.match(retryBody, /isBinancePostOnlyMakerRejectCode\(error\?\.binanceCode\) && error\.safeNoSubmit === true/);
  assert.match(source, /const LADDER_REPRICE_MAX_ATTEMPTS = 5;/);
  assert.match(generatedSource, /const LADDER_REPRICE_MAX_ATTEMPTS = 5;/);

  const interceptBody = readFunctionBody('installFetchInterceptor');
  assert.match(interceptBody, /activeLadderSubmitCapture/);
  assert.match(interceptBody, /trackLadderSubmitResponse/);
  assert.match(interceptBody, /getFetchRequestMethod\(args\) === 'POST'/);
  assert.match(interceptBody, /isBinancePlaceOrderRequestUrl\(requestUrl\)/);
  assert.doesNotMatch(interceptBody, /requestUrl\.includes\('\/bapi\/'\)/);
  assert.doesNotMatch(interceptBody, /Post Only|未作为Maker|不会记录/);

  const requestUrlBody = readFunctionBody('isBinancePlaceOrderRequestUrl');
  assert.match(requestUrlBody, /requestUrl\.origin === window\.location\.origin/);
  assert.match(requestUrlBody, /requestUrl\.pathname === BINANCE_PLACE_ORDER_BAPI_PATH/);

  const observeBody = readFunctionBody('observeLadderSubmitResponse');
  assert.match(observeBody, /response\.ok/);
  assert.match(observeBody, /isBinancePlaceOrderSuccessPayload\(payload\)/);
  assert.match(observeBody, /capture\.apiSuccesses\.push\(\{ requestUrl \}\)/);
  assert.match(observeBody, /capture\.apiErrors\.push\(\{ requestUrl, code \}\)/);

  const observationBody = readFunctionBody('waitForLadderSubmitResponseObservations');
  assert.match(observationBody, /capture\.responseObservations\.slice\(\)/);
  assert.match(observationBody, /Promise\.race\(\[/);
  assert.match(observationBody, /delay\(timeoutMs\)/);

  const acknowledgementBody = readFunctionBody('waitForOrderSubmitAcknowledgement');
  const apiCodeReadIndex = acknowledgementBody.indexOf('readLadderSubmitApiErrors(submitCaptureId)');
  const pendingFailureIndex = acknowledgementBody.indexOf('if (pendingFailure)');
  const apiSuccessReadIndex = acknowledgementBody.indexOf('readLadderSubmitApiSuccesses(submitCaptureId)');
  assert.notEqual(apiCodeReadIndex, -1);
  assert.notEqual(apiSuccessReadIndex, -1);
  assert.ok(apiCodeReadIndex < pendingFailureIndex);
  assert.ok(pendingFailureIndex < apiSuccessReadIndex);
  assert.match(acknowledgementBody, /await waitForLadderSubmitResponseObservations\(/);
  assert.match(acknowledgementBody, /capturedApiErrorsNow\.length === 1/);
  assert.match(acknowledgementBody, /isBinancePostOnlyMakerRejectCode\(capturedApiErrorsNow\[0\]\.code\)/);
  assert.match(acknowledgementBody, /createLadderSubmitApiError\(capturedApiErrorsNow\[0\]\.code\)/);
  assert.match(acknowledgementBody, /capturedApiErrors\.length === 1/);
  assert.match(acknowledgementBody, /isBinancePostOnlyMakerRejectCode\(capturedApiErrors\[0\]\.code\)/);
  assert.match(acknowledgementBody, /capturedApiErrors\.length === 0/);
  assert.match(acknowledgementBody, /mode === 'CLOSE'/);
  assert.match(acknowledgementBody, /isPostOnlyMakerRejectionFeedback\(pendingFailure\.message\)/);
  assert.match(acknowledgementBody, /createLadderMakerPriceConflictError\(pendingFailure\.message\)/);
  assert.match(acknowledgementBody, /capturedApiSuccessesNow\.length === 1/);
  assert.doesNotMatch(source, /LADDER_SUBMIT_API_CODE_GRACE_MS/);

  const repriceBody = readFunctionBody('refreshRemainingLadderOrders');
  assert.match(repriceBody, /assertLadderExecutionContext\(plan\)/);
  assert.match(repriceBody, /getBufferedMakerPrices\(plan\.spec\.priceSide,\s*remainingCount,\s*plan\.ladderStep\)/);
  assert.match(repriceBody, /repriceRemainingLadderOrders\(\{/);
  assert.match(repriceBody, /plan\.spec\.mode === 'OPEN'/);
  assert.match(repriceBody, /getQtyRuleContext\(plan\.symbol,\s*'OPEN',\s*order\.price\)/);
  assert.match(repriceBody, /compareDecimalStrings\(order\.qty,\s*ruleContext\.effectiveMinQty\)/);
  assert.match(repriceBody, /数量 \$\{order\.qty\} 低于最小下单量 \$\{ruleContext\.effectiveMinQty\}/);
  assert.doesNotMatch(repriceBody, /buildLadderPlan\(/);
  assert.doesNotMatch(repriceBody, /cancelCurrentSymbolOpenOrders/);

  const executeBody = readFunctionBody('executeLadderPlan');
  assert.match(executeBody, /LADDER_REPRICE_MAX_ATTEMPTS/);
  assert.match(executeBody, /beginLadderSubmitResponseCapture\(\)/);
  assert.match(executeBody, /endLadderSubmitResponseCapture\(submitCaptureId\)/);
  assert.match(executeBody, /waitForOrderSubmitAcknowledgement\([\s\S]*plan\.spec\.mode/);
  assert.match(executeBody, /refreshRemainingLadderOrders\(plan,\s*done\)/);
  assert.match(executeBody, /lastRepriceApiErrorCode/);
  assert.match(executeBody, /return \{ done, repriceAttempts, lastRepriceApiErrorCode \}/);
  assert.match(executeBody, /盘口连续移动/);
  assert.doesNotMatch(executeBody, /binanceCode\s*=\s*BINANCE_GTX_ORDER_REJECT_CODE/);

  assert.match(generatedSource, /90805022/);
  assert.match(generatedSource, /isBinancePostOnlyMakerRejectCode/);
  assert.match(generatedSource, /beginLadderSubmitResponseCapture/);
  assert.match(generatedSource, /自动刷新盘口/);
  assert.match(generatedSource, /isPostOnlyMakerRejectionFeedback/);
});

test('stable panel renders avoid repeated orderbook scans and layout reads', () => {
  const triggerBody = readFunctionBody('findOrderbookPrecisionTrigger');
  assert.match(triggerBody, /#futuresOrderbook \.orderbook-tickSize/);
  assert.match(triggerBody, /\.tick-content/);
  assert.doesNotMatch(triggerBody, /querySelectorAll/);
  assert.doesNotMatch(triggerBody, /isVisibleElement/);

  const precisionBody = readFunctionBody('refreshOrderbookPrecisionRecommendation');
  assert.match(precisionBody, /const recommendationHtml =/);
  assert.match(precisionBody, /if \(el\.innerHTML !== recommendationHtml\)/);

  const renderBody = readFunctionBody('renderPanel');
  const signatureIndex = renderBody.indexOf('if (panelPositionSignature !== panelHtml)');
  const positionIndex = renderBody.indexOf('positionPanel(panel)');
  assert.notEqual(signatureIndex, -1);
  assert.notEqual(positionIndex, -1);
  assert.ok(signatureIndex < positionIndex);
});

test('ladder feedback labels captured API codes without exposing bare numbers', () => {
  const apiErrorBody = readFunctionBody('createLadderSubmitApiError');
  const diagnosticsBody = readFunctionBody('formatLadderRepriceDiagnostics');
  const executeBody = readFunctionBody('executeLadderPlan');
  assert.match(apiErrorBody, /Maker 挂单被拒绝（错误码 \$\{apiErrorCode\}）/);
  assert.match(diagnosticsBody, /错误码 \$\{lastRepriceApiErrorCode\}/);
  assert.match(executeBody, /错误码 \$\{lastRepriceApiErrorCode\}/);
  assert.doesNotMatch(source, /错误码：/);
  assert.doesNotMatch(source, /\(\$\{apiErrorCode\}\)/);
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
  assert.match(buildBody, /createLadderMinimumQtyFailure\(\{\s*spec,\s*symbol: startSymbol,\s*mode: spec\.mode,\s*minRequiredQty,\s*baseQty,\s*percent,\s*levels,\s*minimumPercent: autoFit\.minimumPercent,\s*maxAutoFitPercent: autoFit\.maxPercent,\s*replacementTotalQty: spec\.mode === 'OPEN' \? multiplyDecimalByInt\(minRequiredQty,\s*levels\) : null,\s*\}\)/);

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
  assert.match(errorBody, /openOrdersReplacementPlan/);
  assert.match(errorBody, /replacementTotalQty/);
  assert.doesNotMatch(errorBody, /allowPartialReplacement/);
  assert.match(errorBody, /脚本只会尝试替换当前币同向开仓基础单，不会自动全撤/);
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

test('ladder replacement cancels visible current-symbol same-direction rows up to planned quantity', () => {
  const readRowsBody = readFunctionBody('readCurrentSymbolOpenOrderRows');
  assert.match(readRowsBody, /querySelectorAll\('\.list-item-container'\)/);
  assert.match(readRowsBody, /cells\[5\]/);
  assert.match(readRowsBody, /sideText/);
  assert.match(readRowsBody, /isOpenOrderRowCurrentSymbol\(row\.symbolText,\s*symbol\)/);
  assert.match(readRowsBody, /isOpenOrderRowForPlan\(row\.sideText,\s*plan\)/);
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
  assert.match(selectRowsBody, /isOpenOrderRowForPlan\(row\.sideText,\s*plan\)/);
  assert.match(selectRowsBody, /compareDecimalStrings\(cancelQty,\s*plan\.totalQty\)/);
  assert.match(selectRowsBody, /addDecimalStrings\(cancelQty,\s*row\.qty\)/);
  assert.match(selectRowsBody, /allowPartial && rowsToCancel\.length > 0/);
  assert.match(selectRowsBody, /return compareDecimalStrings\(cancelQty,\s*plan\.totalQty\) >= 0/);
  assert.match(selectRowsBody, /: \[\]/);

  const directionBody = readFunctionBody('isOpenOrderRowForPlan');
  assert.match(directionBody, /plan\.spec\?\.mode === 'OPEN'/);
  assert.match(directionBody, /includes\('开多'\)/);
  assert.match(directionBody, /includes\('OPENLONG'\)/);
  assert.match(directionBody, /includes\('开空'\)/);
  assert.match(directionBody, /includes\('OPENSHORT'\)/);
  assert.match(directionBody, /plan\.spec\?\.mode === 'CLOSE'/);
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
  assert.doesNotMatch(cancelOpenOrderRowsBody, /allowPartialEnd/);
  assert.doesNotMatch(cancelOpenOrderRowsBody, /partial: true/);
  assert.match(cancelOpenOrderRowsBody, /const refreshedRoot = getActiveOpenOrdersScope\(\)/);
  assert.match(cancelOpenOrderRowsBody, /currentRoot = refreshedRoot/);
  assert.match(cancelOpenOrderRowsBody, /currentRoot = row\.root \|\| currentRoot/);
  assert.match(cancelOpenOrderRowsBody, /clickDomTarget\(row\.cancelButton\)/);
  assert.match(cancelOpenOrderRowsBody, /waitForOpenOrderRowKeyCountBelow\(plan\.symbol,\s*row\.key,\s*previousKeyCount\)/);
  assert.match(cancelOpenOrderRowsBody, /const dialogClosed = await waitForDialogToClose\(dialog\)/);
  assert.match(cancelOpenOrderRowsBody, /DialogNotClosedError/);
  assert.doesNotMatch(cancelOpenOrderRowsBody, /waitForOpenOrderRowKeyCountBelow\(row\.root/);
  assert.doesNotMatch(cancelOpenOrderRowsBody, /row\.cancelButton\.click\(\)/);
  assert.doesNotMatch(cancelOpenOrderRowsBody, /for \(const row of rowsToCancel\)/);

  const waitForRowRemovalBody = readFunctionBody('waitForOpenOrderRowKeyCountBelow');
  assert.match(waitForRowRemovalBody, /const activeRoot = getActiveOpenOrdersScope\(\)/);
  assert.match(waitForRowRemovalBody, /activeRoot && countOpenOrderRowsByKey\(activeRoot,\s*symbol,\s*key\) < previousCount/);

  const cancelRowsBody = readFunctionBody('cancelCurrentSymbolOpenOrdersForPlan');
  assert.match(cancelRowsBody, /if \(!isCurrentObservedSymbol\(symbol\) \|\| symbol !== plan\?\.symbol\)/);
  assert.match(cancelRowsBody, /const openOrdersCount = getOpenOrdersTabCount\(\)/);
  assert.match(cancelRowsBody, /activateOpenOrdersBasicSubTab\(openOrdersScope\)[\s\S]*openOrdersScope = await waitForActiveOpenOrdersScope\(\)/);
  assert.match(cancelRowsBody, /if \(!openOrdersScope\) \{\s*const message = '未定位到当前委托面板'/);
  assert.match(cancelRowsBody, /waitForCurrentSymbolOpenOrderRows\(openOrdersScope,\s*symbol,\s*plan,\s*\{\s*openOrdersCount,\s*\}\)/);
  assert.match(cancelRowsBody, /getPlanDirectionLabel\(plan\)/);
  assert.match(cancelRowsBody, /selectOpenOrderRowsToCancelForPlan\(plan,\s*rows\)/);
  assert.match(cancelRowsBody, /finally\s*\{[\s\S]*openOrdersScope = await waitForActiveOpenOrdersScope\(\)[\s\S]*restoreOpenOrdersSymbolFilter\(openOrdersScope/);
  assert.match(cancelRowsBody, /restoreTemporaryUiState = false/);
  assert.match(cancelRowsBody, /status = e\?\.name === 'DialogNotClosedError' \? 'dialog_not_closed' : 'row_cancel_failed'/);
  assert.match(cancelRowsBody, /finally\s*\{\s*if \(restoreTemporaryUiState && isCurrentObservedSymbol\(symbol\)\)/);
  assert.doesNotMatch(cancelRowsBody, /allowPartialEnd/);
  assert.doesNotMatch(cancelRowsBody, /findCurrentSymbolCancelAllButton/);
});

test('cancel current-symbol open orders wait for confirmed clearing before restoring page state', () => {
  const cancelBody = readFunctionBody('runCancelCurrentSymbolOpenOrders');
  assert.match(cancelBody, /waitUntilCleared = false/);
  assert.match(cancelBody, /waitForCurrentSymbolOpenOrdersCleared\(openOrdersScope,\s*symbol\)/);
  const scopeRefreshes = cancelBody.match(/openOrdersScope = await waitForActiveOpenOrdersScope\(\)/g) || [];
  assert.ok(scopeRefreshes.length >= 4, 'cancel flow should reacquire active scope after each Binance rerender boundary');
  assert.match(cancelBody, /return \{ ok: true, status: 'cleared'/);
  assert.match(cancelBody, /return \{ ok: false, status: 'not_cleared'/);
  assert.doesNotMatch(cancelBody, /status: 'dialog_closed'/);

  const waitBody = readFunctionBody('waitForCurrentSymbolOpenOrdersCleared');
  assert.match(waitBody, /const refreshedRoot = getActiveOpenOrdersScope\(\)/);
  assert.match(waitBody, /isOpenOrdersScopeConfirmedForSymbol\(currentRoot,\s*symbol\)/);
  assert.match(waitBody, /hasCurrentSymbolOpenOrders\(currentRoot,\s*symbol,\s*true,\s*cancelAllButton\)/);

  const clearWaitIndex = cancelBody.indexOf('waitForCurrentSymbolOpenOrdersCleared(openOrdersScope, symbol)');
  const successIndex = cancelBody.indexOf("return { ok: true, status: 'cleared'");
  const cleanupIndex = cancelBody.indexOf('finally {');
  const restoreIndex = cancelBody.indexOf('restoreOpenOrdersSymbolFilter(', cleanupIndex);
  assert.ok(clearWaitIndex !== -1 && successIndex !== -1 && cleanupIndex !== -1 && restoreIndex !== -1);
  assert.ok(clearWaitIndex < successIndex, 'clearing must be confirmed before success');
  assert.ok(successIndex < cleanupIndex && cleanupIndex < restoreIndex, 'page state restores only after the clear result');
});

test('cancel current-symbol open orders are single-flight and dialog timeout does not restore Binance UI', () => {
  const wrapperBody = readFunctionBody('cancelCurrentSymbolOpenOrders');
  assert.match(source, /let cancelCurrentSymbolOpenOrdersTask = null/);
  assert.match(wrapperBody, /if \(cancelCurrentSymbolOpenOrdersTask\) return cancelCurrentSymbolOpenOrdersTask/);
  assert.match(wrapperBody, /if \(ladderTask\)[\s\S]*status: 'ladder_running'/);
  assert.match(wrapperBody, /runCancelCurrentSymbolOpenOrders\(options\)/);
  assert.match(wrapperBody, /cancelCurrentSymbolOpenOrdersTask = task/);
  assert.match(wrapperBody, /cancelCurrentSymbolOpenOrdersTask = null/);

  const waitDialogBody = readFunctionBody('waitForDialogToClose');
  assert.match(source, /CANCEL_DIALOG_CLOSE_TIMEOUT_MS/);
  assert.match(waitDialogBody, /const deadline = Date\.now\(\) \+ timeoutMs/);
  assert.match(waitDialogBody, /return false/);

  const cancelBody = readFunctionBody('runCancelCurrentSymbolOpenOrders');
  assert.match(cancelBody, /restoreTemporaryUiState = false/);
  assert.match(cancelBody, /status: 'dialog_not_closed'/);
  assert.match(cancelBody, /finally\s*\{\s*if \(restoreTemporaryUiState && isCurrentObservedSymbol\(symbol\)\)/);

  const panelBody = readFunctionBody('refreshLadderPanel');
  assert.match(panelBody, /cancelCurrentSymbolOpenOrdersTask/);
  assert.match(panelBody, /data-ladder-cancel-symbol="true"\$\{cancelDisabledAttrs\}/);
  assert.match(panelBody, /撤单处理中/);

  const startBody = readFunctionBody('startLadder');
  assert.match(startBody, /if \(cancelCurrentSymbolOpenOrdersTask\)[\s\S]*撤本币挂单处理中，请等待完成/);
  const actionRowsBody = readFunctionBody('getLadderActionRows');
  assert.match(actionRowsBody, /actionDisabled = ladderRunning \|\| !!cancelCurrentSymbolOpenOrdersTask/);
  assert.match(actionRowsBody, /ladderActionButton\('OPEN_LONG',[\s\S]*actionDisabled\)/);
});

test('orderbook precision recommendation is sampled and manually applied only', () => {
  assert.match(source, /ORDERBOOK_PRECISION_MANUAL_SAMPLE_DURATION_MS = 6000/);
  assert.match(source, /ORDERBOOK_PRECISION_SAMPLE_DURATION_MS = ORDERBOOK_PRECISION_MANUAL_SAMPLE_DURATION_MS/);
  assert.doesNotMatch(source, /ORDERBOOK_PRECISION_SAMPLE_PAUSE_MS/);
  assert.match(source, /LOCAL_ORDERBOOK_PRECISION_SAMPLES_PREFIX = 'jh_binance_orderbook_precision_samples_v3'/);
  assert.match(source, /data-orderbook-precision-apply/);
  assert.match(source, /data-orderbook-precision-refresh/);
  assert.match(source, /orderbookPrecisionPendingRequest/);

  const sampleBody = readFunctionBody('runOrderbookPrecisionSampleRound');
  assert.match(sampleBody, /collectNonZeroPriceMoves/);
  assert.match(sampleBody, /saveStoredOrderbookPrecisionSamples\(symbol,\s*newSamples\)/);
  assert.doesNotMatch(sampleBody, /mergePrecisionSamples\(\s*readStoredOrderbookPrecisionSamples/);
  assert.match(sampleBody, /waitForLatestTradePricesReady/);
  assert.match(sampleBody, /ORDERBOOK_PRECISION_SAMPLE_DURATION_MS/);
  assert.match(sampleBody, /getLatestTradePrices/);
  assert.doesNotMatch(sampleBody, /getCurrentOrderbookDisplayStep/);
  assert.doesNotMatch(sampleBody, /fallbackMovement/);
  assert.match(sampleBody, /orderbookPrecisionPendingRequest/);
  assert.doesNotMatch(sampleBody, /ORDERBOOK_PRECISION_SAMPLE_PAUSE_MS/);
  assert.match(sampleBody, /orderbookPrecisionState[\s\S]*sampleEndsAt: deadline/);
  assert.match(sampleBody, /scheduleRenderPanel\(\{ followUpMs: 1000 \}\)/);

  const refreshBody = readFunctionBody('refreshOrderbookPrecisionRecommendation');
  assert.match(refreshBody, /recommendOrderbookPrecision/);
  assert.match(refreshBody, /resolveOrderbookPrecisionSampleState/);
  assert.match(refreshBody, /scheduled: Boolean\(orderbookPrecisionSampleTimer\)/);
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
  assert.match(scheduleBody, /if \(force && !sameInitialIsActive && !sameInitialIsPending\)/);
  assert.match(scheduleBody, /orderbookPrecisionPendingRequest = request/);
  assert.match(scheduleBody, /durationMs/);

  const initialBody = readFunctionBody('startInitialOrderbookPrecisionSample');
  assert.match(initialBody, /orderbookPrecisionInitialSampledSymbols\.has\(symbol\)/);

  const triggerBody = readFunctionBody('findOrderbookPrecisionTrigger');
  assert.match(triggerBody, /#futuresOrderbook \.orderbook-tickSize/);
  assert.match(triggerBody, /tickSize\?\.querySelector\('\.tick-content'\)/);
  assert.doesNotMatch(triggerBody, /clickableSelector/);
  assert.doesNotMatch(triggerBody, /querySelectorAll/);

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

test('close state is committed only for the currently observed symbol', () => {
  const readBody = readFunctionBody('readCloseContext');
  assert.match(readBody, /isCurrentObservedSymbol\(expectedSymbol\)/);

  const resolveBody = readFunctionBody('resolveDisplayCloseState');
  assert.match(resolveBody, /rawCloseContext\.symbol === symbol/);
  assert.match(resolveBody, /isCurrentObservedSymbol\(symbol\)/);

  const symbolChangeBody = readFunctionBody('checkSymbolChangeForLeverage');
  assert.match(symbolChangeBody, /clearSymbolOwnedRuntimeState\(symbol\)/);
});

test('close execution and close-ladder sizing reject display cache', () => {
  const actionBody = readFunctionBody('resolveCloseAction');
  assert.match(actionBody, /const rawCloseContext = readCloseContext\(\)/);
  assert.match(actionBody, /resolveConfirmedCloseDirection\(rawCloseContext/);
  assert.doesNotMatch(actionBody, /lastDisplayCloseState/);

  const closeBaseBody = readFunctionBody('readCloseBaseQtyForLadder');
  assert.match(closeBaseBody, /const raw = readCloseContext\(\)/);
  assert.match(closeBaseBody, /raw\.knowsLong && raw\.knowsShort/);
  assert.doesNotMatch(closeBaseBody, /resolveDisplayCloseState/);

  const refreshBody = readFunctionBody('refreshComputedInfo');
  assert.match(refreshBody, /const rawCloseContext = readCloseContext\(\)/);
  assert.match(refreshBody, /syncNativeCloseButtons\(tradeMode, rawCloseContext\)/);
  assert.doesNotMatch(source, /applyCachedNativeCloseButtonState/);
});

test('cancel flow rechecks the captured symbol before destructive click and cleanup', () => {
  const waitBody = readFunctionBody('waitForCurrentSymbolOpenOrders');
  assert.match(waitBody, /isCurrentObservedSymbol\(symbol\)/);

  const cancelBody = readFunctionBody('runCancelCurrentSymbolOpenOrders');
  assert.ok(
    cancelBody.indexOf('if (!isCurrentObservedSymbol(symbol))') < cancelBody.indexOf('const previousAccountOrdersTab'),
    'cancel flow should reject an unobserved symbol before changing tabs'
  );
  assert.match(cancelBody, /if \(!isCurrentObservedSymbol\(symbol\)\)[\s\S]*cancelAllButton\.click\(\)/);
  assert.match(cancelBody, /finally\s*\{\s*if \(restoreTemporaryUiState && isCurrentObservedSymbol\(symbol\)\) \{/);
  assert.match(cancelBody, /restoreOpenOrdersSubTab\(previousOpenOrdersSubTab, symbol\)/);
  assert.match(cancelBody, /restoreAccountOrdersTab\(previousAccountOrdersTab, symbol\)/);
});

test('multiplier edits retain their captured symbol and mode', () => {
  assert.match(source, /let multiplierEditContext = null/);
  assert.match(source, /function beginMultiplierEdit\(/);
  assert.match(source, /function isMultiplierEditContextCurrent\(/);
  assert.match(source, /saveMultiplier\(value, multiplierEditContext\.mode, multiplierEditContext\.symbol\)/);
  assert.match(source, /saveMultiplier\(normalized, editContext\.mode, editContext\.symbol\)/);
  const updateBody = readFunctionBody('updateMultiplier');
  assert.match(updateBody, /isCurrentObservedSymbol\(context\.symbol\)/);
  assert.match(updateBody, /saveMultiplier\(normalized, context\.mode, context\.symbol\)/);
  assert.match(source, /updateMultiplier\([^\n]+, context\)/);
});

test('precision apply and sampling do not commit after a symbol switch', () => {
  const applyBody = readFunctionBody('applyRecommendedOrderbookPrecision');
  assert.match(applyBody, /const symbol = getCurrentSymbol\(\)/);
  assert.match(applyBody, /if \(!isCurrentObservedSymbol\(symbol\)\) return false/);
  assert.match(applyBody, /if \(!isCurrentObservedSymbol\(symbol\)\) return false;\s*clickDomTarget\(option\)/);

  const roundBody = readFunctionBody('runOrderbookPrecisionSampleRound');
  assert.match(roundBody, /request\.symbol/);
  assert.match(roundBody, /orderbookPrecisionInitialSampledSymbols\.add\(symbol\)/);
  const initialBody = readFunctionBody('startInitialOrderbookPrecisionSample');
  assert.doesNotMatch(initialBody, /orderbookPrecisionInitialSampledSymbols\.add\(symbol\)/);
  const scheduleBody = readFunctionBody('scheduleOrderbookPrecisionSampleRound');
  assert.match(scheduleBody, /orderbookPrecisionActiveRequest\?\.symbol === symbol/);
  assert.match(scheduleBody, /orderbookPrecisionPendingRequest\?\.symbol === symbol/);

  const clearBody = readFunctionBody('clearSymbolOwnedRuntimeState');
  assert.match(clearBody, /status: recommendation \? 'ready' : '数据不足'/);
  assert.doesNotMatch(clearBody, /status: '采样中'/);
});

test('busy leverage reset retains and replays the latest symbol request', () => {
  assert.match(source, /const DEFAULT_OPEN_LEVERAGE = 2;/);
  assert.match(source, /let pendingAutoOpenLeverageReset = null/);
  const queueBody = readFunctionBody('queueAutoOpenLeverageReset');
  assert.match(queueBody, /pendingAutoOpenLeverageReset = \{ symbol, triggerSource \}/);
  assert.match(queueBody, /autoOpenLeverageTask !== task/);
  assert.match(queueBody, /queueAutoOpenLeverageReset\(pending\.triggerSource\)/);
});

test('position rows use exact symbol tokens instead of substring matching', () => {
  const positionBody = readFunctionBody('hasPositionInDom');
  assert.match(positionBody, /isOpenOrderRowCurrentSymbol\(row\.textContent, symbol\)/);
  assert.doesNotMatch(positionBody, /text\.includes\(symbol\)/);
});
