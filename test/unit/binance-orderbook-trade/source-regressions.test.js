import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = await readFile(new URL('../../../src/binance-orderbook-trade/index.user.js', import.meta.url), 'utf8');
const generatedSource = await readFile(new URL('../../../scripts/binance-orderbook-trade.user.js', import.meta.url), 'utf8');
const ladderPlanSource = await readFile(new URL('../../../src/binance-orderbook-trade/core/ladder-plan.js', import.meta.url), 'utf8');
const tradingViewOrdersSource = await readFile(new URL('../../../src/binance-orderbook-trade/core/tradingview-orders.js', import.meta.url), 'utf8');

function readFunctionBody(name, sourceText = source) {
  const start = sourceText.indexOf(`function ${name}(`);
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

function readUserscriptVersion(sourceText) {
  const match = sourceText.match(/^\/\/ @version\s+(\S+)\s*$/m);
  assert.notEqual(match, null, 'userscript version metadata should exist');
  return match[1];
}

test('source and generated userscript versions stay synchronized', () => {
  const sourceVersion = readUserscriptVersion(source);
  const generatedVersion = readUserscriptVersion(generatedSource);

  assert.match(sourceVersion, /^\d+\.\d+\.\d+$/);
  assert.equal(generatedVersion, sourceVersion);
});

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

test('close snapshot validation refreshes button scope before checking close actions', () => {
  const waitStart = source.indexOf('function waitForTradeUiMutation');
  const waitEnd = source.indexOf('function handleTradeModeTabTransition', waitStart);
  const waitBody = source.slice(waitStart, waitEnd);
  const invalidateIndex = waitBody.indexOf('invalidateTradeButtonCache()');
  const closeButtonIndex = waitBody.indexOf('findCloseLongButton()');

  assert.notEqual(waitStart, -1);
  assert.notEqual(waitEnd, -1);
  assert.notEqual(invalidateIndex, -1);
  assert.notEqual(closeButtonIndex, -1);
  assert.ok(invalidateIndex < closeButtonIndex);
  assert.match(waitBody, /closeQuantityChanged[\s\S]*findCloseLongButton\(\)[\s\S]*findCloseShortButton\(\)[\s\S]*snapshotReady = true/);
});

test('cancel-symbol flow restores temporary symbol filter through cleanup path', () => {
  const cancelBody = readFunctionBody('runCancelCurrentSymbolOpenOrders');
  assert.match(cancelBody, /finally\s*\{/);
  assert.match(cancelBody, /await waitForBinanceCancelAllDialogDecision\(/);
  assert.match(cancelBody, /restoreOpenOrdersSymbolFilter\(openOrdersScope,\s*symbolFilterOriginalChecked,\s*symbol\)/);
});

test('expanded ladder panel avoids rebuilding unchanged body markup', () => {
  const ladderBody = readFunctionBody('refreshLadderPanel');
  assert.match(ladderBody, /ladderPanelBodySignature/);
  assert.match(ladderBody, /body\.innerHTML = bodyHtml/);
  assert.doesNotMatch(ladderBody, /body\.innerHTML !== bodyHtml/);
  assert.match(ladderBody, /cancelButton\.textContent = cancelPresentation\.label/);
  assert.match(ladderBody, /cancelButton\.disabled = cancelPresentation\.disabled/);
});

test('panel primary values and ladder selections share the Binance emphasis standard', () => {
  assert.match(source, /const PRIMARY_EMPHASIS_COLOR = '#000000';/);
  assert.match(source, /const PRIMARY_EMPHASIS_FONT_WEIGHT = '500';/);

  const precisionShortcutBody = readFunctionBody('renderOrderbookPrecisionShortcut');
  assert.match(precisionShortcutBody, /border-color:var\(--color-PrimaryYellow\)[^`]*color:\$\{PRIMARY_EMPHASIS_COLOR\};font-weight:\$\{PRIMARY_EMPHASIS_FONT_WEIGHT\}/);

  const optionBody = readFunctionBody('ladderOptionButton');
  assert.match(optionBody, /color:\$\{PRIMARY_EMPHASIS_COLOR\};font-weight:\$\{PRIMARY_EMPHASIS_FONT_WEIGHT\}/);

  const panelBody = readFunctionBody('ensurePanel');
  assert.match(panelBody, /id="\$\{INPUT_ID\}"[^`]*color:\$\{PRIMARY_EMPHASIS_COLOR\}[^`]*font-weight:\$\{PRIMARY_EMPHASIS_FONT_WEIGHT\}/);
  assert.match(panelBody, /id="jh-binance-close-qty-final"[^`]*font-weight:\$\{PRIMARY_EMPHASIS_FONT_WEIGHT\}[^`]*color:\$\{PRIMARY_EMPHASIS_COLOR\}/);
  assert.match(panelBody, /id="\$\{LADDER_TOGGLE_ID\}"[^`]*color:\$\{PRIMARY_EMPHASIS_COLOR\}[^`]*font-weight:\$\{PRIMARY_EMPHASIS_FONT_WEIGHT\}/);
});

test('panel buttons inherit one scoped disabled-state contract', () => {
  assert.match(source, /const CONTROL_BORDER_COLOR = '#d5d9e2';/);
  assert.match(source, /const CONTROL_BACKGROUND_COLOR = '#ffffff';/);
  assert.match(source, /const CONTROL_TEXT_COLOR = '#5e6673';/);
  assert.match(source, /const CONTROL_FONT_WEIGHT = '500';/);
  assert.match(source, /const MUTED_TEXT_COLOR = '#76808f';/);
  assert.match(source, /const NEUTRAL_CONTROL_STYLE = `[^`]*font-weight:\$\{CONTROL_FONT_WEIGHT\}[^`]*`;/);

  const disabledStyleBody = readFunctionBody('injectDisabledControlStyle');
  assert.match(disabledStyleBody, /#\$\{PANEL_ID\} button:disabled/);
  assert.match(disabledStyleBody, /background: \$\{DISABLED_CONTROL_BG\} !important/);
  assert.match(disabledStyleBody, /color: \$\{DISABLED_CONTROL_TEXT\} !important/);
  assert.match(disabledStyleBody, /border-color: \$\{DISABLED_CONTROL_BORDER\} !important/);
  assert.match(disabledStyleBody, /opacity: \$\{DISABLED_CONTROL_OPACITY\} !important/);
  assert.match(disabledStyleBody, /font-weight: \$\{CONTROL_FONT_WEIGHT\} !important/);
  assert.match(disabledStyleBody, /button\[\$\{NATIVE_ACTION_DISABLED_ATTR\}="true"\]\s*\{\s*pointer-events: none !important/);

  const renderBody = readFunctionBody('renderPanel');
  assert.doesNotMatch(renderBody, /style\.opacity = .*0\.45/);
  assert.doesNotMatch(renderBody, /style\.cursor = .*not-allowed/);
  assert.doesNotMatch(source, /0\.45/);
});

test('route watcher owns non-trading page pause instead of business timers spinning forever', () => {
  assert.match(source, /function startRouteWatcher\(\)/);
  assert.match(source, /function pauseForNonTradingPage\(\)/);
  const pauseBody = readFunctionBody('pauseForNonTradingPage');
  assert.match(pauseBody, /stopTradingTimers\(\)/);
  assert.doesNotMatch(pauseBody, /stopRouteWatcher\(\)/);
});

test('trade mode and Post Only switches wait for observed state instead of fixed sleeps', () => {
  const activateBody = readFunctionBody('activateTradeMode');
  const ensureBody = readFunctionBody('ensurePostOnlyOrderType');
  const findPostOnlyBody = readFunctionBody('findPostOnlyOrderTab');

  assert.match(activateBody, /waitForTradeFormMutationState/);
  assert.doesNotMatch(activateBody, /delay\(/);
  assert.match(ensureBody, /waitForTradeFormMutationState/);
  assert.doesNotMatch(ensureBody, /delay\(/);
  assert.match(findPostOnlyBody, /BINANCE_POST_ONLY_ORDER_TYPE/);
  assert.match(findPostOnlyBody, /BINANCE_PAGE_TEXT\.postOnly/);
  assert.doesNotMatch(source, /findConditionalSubtypeCombobox|findPostOnlyOption|clickElementLikeUser/);
});

test('labeled quantity matching resets its global regexp for every DOM node', () => {
  const readBody = readFunctionBody('readQtyTextNearButton');
  assert.match(readBody, /new RegExp\([^;]+, 'gi'\)/);
  assert.match(readBody, /re\.lastIndex = 0;\s*const matches = Array\.from\(text\.matchAll\(re\)\)/);
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
  assert.match(retryBody, /replacementContext = createLadderExpectedContext\(replacementPlan\)/);
  assert.match(retryBody, /buildLadderPlan\(actionType,\s*replacementContext\)/);
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
  assert.match(generatedSource, /刷新盘口/);
  assert.doesNotMatch(generatedSource, /自动刷新盘口/);
  assert.match(generatedSource, /isPostOnlyMakerRejectionFeedback/);
});

test('stable panel renders avoid repeated orderbook scans and layout writes', () => {
  const triggerBody = readFunctionBody('findOrderbookPrecisionTrigger');
  assert.match(triggerBody, /#futuresOrderbook \.orderbook-tickSize/);
  assert.match(triggerBody, /\.tick-content/);
  assert.doesNotMatch(triggerBody, /querySelectorAll/);
  assert.doesNotMatch(triggerBody, /isVisibleElement/);

  const precisionBody = readFunctionBody('refreshOrderbookPrecisionRecommendation');
  assert.match(precisionBody, /const recommendationHtml =/);
  assert.match(precisionBody, /if \(el\.innerHTML !== recommendationHtml\)/);

  const renderBody = readFunctionBody('renderPanel');
  const invalidationIndex = renderBody.indexOf('if (panelPositionInvalidated ||');
  const positionIndex = renderBody.indexOf('positionPanel(panel)');
  assert.notEqual(invalidationIndex, -1);
  assert.notEqual(positionIndex, -1);
  assert.ok(invalidationIndex < positionIndex);
  assert.match(renderBody, /panelPositionInvalidated \|\| !isPanelPositionCurrent\(panel\)/);
  assert.doesNotMatch(renderBody, /panel\.innerHTML|panelHtml/);

  const observeSizeBody = readFunctionBody('observePanelSize');
  assert.match(observeSizeBody, /new ResizeObserver/);
  assert.match(observeSizeBody, /panelObservedSize === nextSize/);
  assert.match(observeSizeBody, /panelPositionInvalidated = true/);
  assert.match(observeSizeBody, /scheduleRenderPanel\(\)/);

  const currentPositionBody = readFunctionBody('isPanelPositionCurrent');
  assert.match(currentPositionBody, /findTradePanelInsertionPoint\(document\)/);
  assert.match(currentPositionBody, /spacer\.parentElement !== insertionPoint\.parent/);
  assert.match(currentPositionBody, /spacer\.nextElementSibling !== insertionPoint\.before/);
  assert.match(currentPositionBody, /spacer\.getBoundingClientRect\(\)/);
  assert.match(currentPositionBody, /calculateFloatingPanelLayout/);
  assert.match(currentPositionBody, /Number\.parseFloat\(panel\.style\.top\) === layout\.top/);

  const positionBody = readFunctionBody('positionPanel');
  assert.match(positionBody, /findTradePanelInsertionPoint\(document\)/);
  assert.doesNotMatch(positionBody, /findQtyInput\(\)/);
  assert.doesNotMatch(positionBody, /findQtyFormItem\(/);
});

test('dynamic panel text keeps fixed single-line slots', () => {
  assert.match(source, /data-multiplier-calculation style="display:flex;align-items:center;gap:7px;height:18px;margin-top:4px;overflow:hidden;white-space:nowrap/);
  assert.match(source, /data-panel-group="direction" style="display:flex;align-items:center;justify-content:flex-start;gap:6px;height:32px;overflow:hidden/);
  assert.match(source, /data-side-selector role="radiogroup"[^>]*display:grid;grid-template-columns:54px 54px;[^>]*border-radius:6px;[^>]*overflow:hidden/);
  assert.match(source, new RegExp(`id="\\$\\{MODE_HINT_ID\\}" style="width:78px;flex:0 0 78px;[^\"]*white-space:nowrap;overflow:hidden;text-overflow:ellipsis`));
  assert.match(source, /grid-template-columns:78px repeat\(4,minmax\(0,1fr\)\);align-items:center;gap:4px;height:32px;overflow:hidden/);
  assert.match(source, /grid-template-columns:78px repeat\(4,minmax\(0,1fr\)\);align-items:center;gap:4px;height:24px;margin-top:6px;overflow:hidden/);
  assert.match(source, /buttonBaseStyle = `width:68px;height:24px;[^`]*font-size:12px;line-height:22px;`/);
  assert.match(readFunctionBody('renderOrderbookPrecisionShortcut'), /height:32px[^`]*font-size:12px;line-height:30px/);
  assert.match(readFunctionBody('renderOrderbookPrecisionShortcutSlots'), /while \(slots\.length < ORDERBOOK_PRECISION_SHORTCUT_LIMIT\)/);
  assert.doesNotMatch(source, /data-orderbook-precision-status/);

  const ladderBody = readFunctionBody('refreshLadderPanel');
  assert.match(ladderBody, /const statusVisibility = expanded \|\| ladderTask \|\| ladderStatusText !== '空闲' \? 'visible' : 'hidden'/);
  assert.match(ladderBody, /status\.style\.visibility !== statusVisibility/);
  assert.doesNotMatch(ladderBody, /status\.style\.display/);
  assert.match(source, new RegExp(`id="\\$\\{LADDER_STATUS_ID\\}"[^>]*height:18px;[^>]*visibility:hidden;[^>]*white-space:nowrap;overflow:hidden;text-overflow:ellipsis`));
});

test('panel keeps controls in cohesive ordered semantic groups', () => {
  const ensurePanelBody = readFunctionBody('ensurePanel');
  const precisionBody = readFunctionBody('refreshOrderbookPrecisionRecommendation');
  const ladderRowsBody = readFunctionBody('getLadderActionRows');
  const directionIndex = ensurePanelBody.indexOf('data-panel-group="direction"');
  const modeHintIndex = ensurePanelBody.indexOf('id="${MODE_HINT_ID}"');
  const multiplierIndex = ensurePanelBody.indexOf('data-panel-group="multiplier"');
  const quantityMinIndex = ensurePanelBody.indexOf('id="jh-binance-close-qty-min"');
  const precisionIndex = ensurePanelBody.indexOf('data-panel-group="precision"');
  const ladderIndex = ensurePanelBody.indexOf('data-panel-group="ladder"');

  assert.ok(directionIndex >= 0);
  assert.ok(modeHintIndex > directionIndex);
  assert.ok(multiplierIndex > modeHintIndex);
  assert.ok(quantityMinIndex > multiplierIndex);
  assert.ok(precisionIndex > quantityMinIndex);
  assert.ok(ladderIndex > precisionIndex);
  assert.match(ensurePanelBody, /data-panel-group="multiplier" style="margin-top:12px;"/);
  assert.match(precisionBody, /margin-top:12px;/);
  assert.match(ensurePanelBody, /data-panel-group="ladder" style="margin-top:12px;padding-top:12px;border-top:/);
  assert.equal((ladderRowsBody.match(/gap:4px;margin-top:12px/g) || []).length, 2);
});

test('multiplier row reads as a labeled value followed by decrement and increment controls', () => {
  const ensurePanelBody = readFunctionBody('ensurePanel');
  const refreshBody = readFunctionBody('refreshComputedInfo');
  const labelIndex = ensurePanelBody.indexOf('id="${MULTIPLIER_HINT_ID}"');
  const inputIndex = ensurePanelBody.indexOf('id="${INPUT_ID}"');
  const suffixIndex = ensurePanelBody.indexOf('>倍</span>');
  const decrementIndex = ensurePanelBody.indexOf('id="${DEC_ID}"');
  const incrementIndex = ensurePanelBody.indexOf('id="${INC_ID}"');

  assert.ok(labelIndex >= 0);
  assert.ok(inputIndex > labelIndex);
  assert.ok(suffixIndex > inputIndex);
  assert.ok(decrementIndex > suffixIndex);
  assert.ok(incrementIndex > decrementIndex);
  assert.match(ensurePanelBody, /data-multiplier-controls style="display:flex;align-items:center;justify-content:flex-start;gap:6px;height:32px;overflow:hidden/);
  assert.match(refreshBody, /multiplierHintText = '最小开仓量的'/);
  assert.match(refreshBody, /multiplierHintText = '最小平仓量的'/);
  assert.match(refreshBody, /let multiplierHintText = '最小下单量的'/);
});

test('multiplier calculation keeps the formula primary and separates the notional constraint visually', () => {
  const ensurePanelBody = readFunctionBody('ensurePanel');
  const refreshBody = readFunctionBody('refreshComputedInfo');

  assert.match(ensurePanelBody, /data-multiplier-calculation/);
  assert.match(ensurePanelBody, /data-multiplier-constraint-divider/);
  assert.match(refreshBody, /`\$\{effectiveMinQty\} × \$\{multiplier\} =`/);
  assert.match(refreshBody, /finalText = finalQty/);
  assert.match(refreshBody, /`≥\$\{qtyRuleContext\.minNotional\}U @ \$\{qtyRuleContext\.referencePrice\}`/);
  assert.match(refreshBody, /constraintDividerEl\.style\.display = constraintText \? 'block' : 'none'/);
  assert.doesNotMatch(refreshBody, /最小 \$\{effectiveMinQty\} \(>=/);
});

test('direction selector is a compact mutually exclusive radio group', () => {
  const ensurePanelBody = readFunctionBody('ensurePanel');
  const refreshBody = readFunctionBody('refreshComputedInfo');

  assert.match(ensurePanelBody, /data-side-selector role="radiogroup" aria-labelledby="\$\{MODE_HINT_ID\}"/);
  assert.equal((ensurePanelBody.match(/role="radio" aria-checked="false"/g) || []).length, 2);
  assert.equal((ensurePanelBody.match(/border:0;/g) || []).length, 2);
  assert.match(ensurePanelBody, /border-left:1px solid var\(--color-InputLine\)/);
  assert.match(refreshBody, /let hintText = '单击订单簿时'/);
  assert.doesNotMatch(refreshBody, /hintText = '仓位确认中'/);
  assert.match(refreshBody, /hintTitle = isUsingCache/);
  assert.match(refreshBody, /hintText = '暂无可平仓位'/);
  assert.doesNotMatch(refreshBody, /正在读取仓位|正在刷新仓位|暂未识别仓位/);
  assert.match(
    refreshBody,
    /const rawCloseReady = !closeContext\.isPending\s*&& rawCloseContext\.knowsLong\s*&& rawCloseContext\.knowsShort/
  );
  assert.ok(refreshBody.indexOf('!rawCloseReady') < refreshBody.indexOf("closeMode === 'single_long'"));
  assert.match(refreshBody, /sideLongBtn\.setAttribute\('aria-checked', String\(isActive\)\)/);
  assert.match(refreshBody, /sideShortBtn\.setAttribute\('aria-checked', String\(isActive\)\)/);
  assert.match(refreshBody, /const desiredTabIndex = isActive \? 0 : -1/);
  assert.match(refreshBody, /sideShortBtn\.tabIndex !== desiredTabIndex/);
  assert.match(refreshBody, /sideLongBtn\.style\.boxShadow = isActive && !isDisabled/);
  assert.match(refreshBody, /sideShortBtn\.style\.boxShadow = isActive && !isDisabled/);
  assert.doesNotMatch(refreshBody, /style\.borderColor/);
  assert.match(ensurePanelBody, /\['ArrowRight', 'ArrowDown'\]\.includes\(event\.key\)/);
  assert.match(ensurePanelBody, /\['ArrowLeft', 'ArrowUp'\]\.includes\(event\.key\)/);
  assert.match(ensurePanelBody, /const enabledButtons = \[sideLongBtn, sideShortBtn\]\.filter\(\(button\) => button && !button\.disabled\)/);
  assert.match(ensurePanelBody, /nextButton\.focus\(\)/);
  assert.match(ensurePanelBody, /nextButton\.click\(\)/);
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
  assert.match(buildBody, /createLadderMinimumQtyFailure\(\{\s*spec,\s*symbol: startSymbol,\s*precision: startPrecision,\s*mode: spec\.mode,\s*minRequiredQty,\s*baseQty,\s*percent,\s*levels,\s*minimumPercent: autoFit\.minimumPercent,\s*maxAutoFitPercent: autoFit\.maxPercent,\s*replacementTotalQty: spec\.mode === 'OPEN' \? multiplyDecimalByInt\(minRequiredQty,\s*levels\) : null,\s*\}\)/);

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

test('ladder actions keep only their final UI feedback visible for a minimum window', () => {
  const startBody = readFunctionBody('startLadder');
  assert.match(startBody, /const actionSymbol = getCurrentSymbol\(\)/);
  assert.match(startBody, /keepInteractionFeedbackVisible\(/);
  assert.match(startBody, /minimumMs: LADDER_ACTION_FEEDBACK_MIN_MS/);
  assert.match(startBody, /wasStopped/);
  assert.match(startBody, /isCurrentObservedSymbol\(actionSymbol\)/);

  for (const name of [
    'runLadderPlanWithOpenOrderReplacement',
    'executeLadderPlan',
    'cancelCurrentSymbolOpenOrdersForPlan',
  ]) {
    assert.doesNotMatch(readFunctionBody(name), /keepInteractionFeedbackVisible/);
  }
});

test('open ladder stops immediately only for a confirmed zero available balance', () => {
  const readOpenQtyBody = readFunctionBody('readOpenBaseQtyForLadder');
  assert.match(readOpenQtyBody, /isConfirmedZeroOpenBalance\(qty\)/);
  assert.match(readOpenQtyBody, /return \{ qty, qtySource \}/);
  assert.match(readOpenQtyBody, /waitForTradeFormMutationState/);
  assert.doesNotMatch(readOpenQtyBody, /delay\(/);

  const confirmedZeroBody = readFunctionBody('isConfirmedZeroOpenBalance');
  assert.match(confirmedZeroBody, /readTradeAvailableBalance/);
  assert.match(confirmedZeroBody, /normalizeDecimalString/);
  assert.match(confirmedZeroBody, /compareDecimalStrings\(normalizedQty, '0'\) === 0/);
  assert.match(confirmedZeroBody, /compareDecimalStrings\(normalizedBalance, '0'\) === 0/);

  const readOpenableBody = readFunctionBody('readOpenableQty');
  assert.match(readOpenableBody, /readOpenableQtyByTestIds\(\)/);
  const readOpenableByTestIdsBody = readFunctionBody('readOpenableQtyByTestIds');
  assert.match(readOpenableByTestIdsBody, /qtySource: 'testid'/);
});

test('ladder replacement cancels visible current-symbol same-direction rows up to planned quantity', () => {
  const readRowsBody = readFunctionBody('readCurrentSymbolOpenOrderRows');
  assert.match(readRowsBody, /findOpenOrderRowElements\(root/);
  assert.match(readRowsBody, /BINANCE_PAGE_TEXT\.accountOrders\.rowCancel/);
  assert.doesNotMatch(readRowsBody, /list-item-container/);
  assert.match(readRowsBody, /cells\[5\]/);
  assert.match(readRowsBody, /sideText/);
  assert.match(readRowsBody, /isOpenOrderRowCurrentSymbol\(row\.symbolText,\s*symbol\)/);
  assert.match(readRowsBody, /isOpenOrderRowForPlan\(row\.sideText,\s*plan\)/);
  assert.doesNotMatch(readRowsBody, /symbolText\.includes\(symbol\)/);

  const cancelButtonBody = readFunctionBody('findOpenOrderRowCancelButton');
  assert.match(cancelButtonBody, /matchesBinancePageText/);
  assert.match(cancelButtonBody, /BINANCE_PAGE_TEXT\.accountOrders\.rowCancel/);
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
  assert.match(directionBody, /plan\.spec\?\.mode === 'CLOSE'/);
  assert.match(directionBody, /includesCompactBinancePageText/);
  assert.match(directionBody, /BINANCE_PAGE_TEXT\.tradeAction\.OPEN_LONG/);
  assert.match(directionBody, /BINANCE_PAGE_TEXT\.tradeAction\.OPEN_SHORT/);
  assert.match(directionBody, /BINANCE_PAGE_TEXT\.tradeAction\.CLOSE_LONG/);
  assert.match(directionBody, /BINANCE_PAGE_TEXT\.tradeAction\.CLOSE_SHORT/);
  assert.doesNotMatch(directionBody, /includes\('SELL'\)/);
  assert.doesNotMatch(directionBody, /includes\('BUY'\)/);

  const waitRowsBody = readFunctionBody('waitForCurrentSymbolOpenOrderRows');
  assert.match(waitRowsBody, /waitForAccountOrdersState/);
  assert.match(waitRowsBody, /readCurrentSymbolOpenOrderRowsState\(root,\s*symbol,\s*plan\)/);
  assert.match(waitRowsBody, /status !== 'other_direction'/);
  assert.match(waitRowsBody, /LADDER_REPLACE_ROW_SETTLE_MS/);
  assert.doesNotMatch(waitRowsBody, /openOrdersCount/);
  assert.doesNotMatch(waitRowsBody, /LADDER_REPLACE_OPEN_ORDERS_CLEAR_TIMEOUT_MS/);

  const rowStateBody = readFunctionBody('readCurrentSymbolOpenOrderRowsState');
  assert.match(rowStateBody, /readCurrentSymbolOpenOrderRows\(currentRoot,\s*symbol,\s*plan\)/);
  assert.match(rowStateBody, /readCurrentSymbolOpenOrderRows\(currentRoot,\s*symbol\)/);
  assert.match(rowStateBody, /isFilteredCurrentSymbolOpenOrdersEmpty/);
  assert.match(rowStateBody, /status: 'matched'/);
  assert.match(rowStateBody, /status: 'other_direction'/);
  assert.match(rowStateBody, /status: 'empty'/);
  assert.match(rowStateBody, /rows: \[\]/);

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
  assert.match(waitForRowRemovalBody, /createAccountOrdersMutationSignal/);
  assert.match(waitForRowRemovalBody, /mutationSignal\.waitForChange/);
  assert.match(waitForRowRemovalBody, /mutationSignal\.dispose\(\)/);
  assert.doesNotMatch(waitForRowRemovalBody, /delay\(/);
  assert.doesNotMatch(cancelOpenOrderRowsBody, /delay\(260\)/);

  const cancelRowsBody = readFunctionBody('cancelCurrentSymbolOpenOrdersForPlan');
  assert.match(cancelRowsBody, /if \(!isCurrentObservedSymbol\(symbol\) \|\| symbol !== plan\?\.symbol\)/);
  assert.match(cancelRowsBody, /activateOpenOrdersBasicSubTab\(openOrdersScope\)[\s\S]*openOrdersScope = await waitForActiveOpenOrdersScope\(\)/);
  assert.match(cancelRowsBody, /if \(!openOrdersScope\) \{\s*const message = '未定位到当前委托面板'/);
  assert.match(cancelRowsBody, /waitForCurrentSymbolOpenOrderRows\(openOrdersScope,\s*symbol,\s*plan\)/);
  assert.doesNotMatch(cancelRowsBody, /const openOrdersCount = getOpenOrdersTabCount\(\)/);
  assert.match(cancelRowsBody, /getPlanDirectionLabel\(plan\)/);
  assert.match(cancelRowsBody, /selectOpenOrderRowsToCancelForPlan\(plan,\s*rows\)/);
  assert.match(cancelRowsBody, /finally\s*\{[\s\S]*openOrdersScope = await waitForActiveOpenOrdersScope\(\)[\s\S]*restoreOpenOrdersSymbolFilter\(openOrdersScope/);
  assert.match(cancelRowsBody, /restoreTemporaryUiState = false/);
  assert.match(cancelRowsBody, /status = e\?\.name === 'DialogNotClosedError' \? 'dialog_not_closed' : 'row_cancel_failed'/);
  assert.match(cancelRowsBody, /finally\s*\{\s*if \(restoreTemporaryUiState && isCurrentObservedSymbol\(symbol\)\)/);
  assert.doesNotMatch(cancelRowsBody, /BinanceChartOrders|chartOrders|ChartOrders/);
  assert.doesNotMatch(cancelRowsBody, /allowPartialEnd/);
  assert.doesNotMatch(cancelRowsBody, /findCurrentSymbolCancelAllButton/);
});

test('bulk cancel hides TradingView orders before opening the native dialog and restores them independently', () => {
  assert.match(tradingViewOrdersSource, /applyOverrides/);
  assert.match(tradingViewOrdersSource, /tradingProperties\.showOrders/);
  assert.doesNotMatch(source, /coalesceTradingViewDrawingSaves/);

  const hideBody = readFunctionBody('hideTradingViewOrdersForBulkCancel');
  assert.match(hideBody, /assertTradingViewOrdersTarget\(api, state\)[\s\S]*state\.originalVisible[\s\S]*writeTradingViewOrdersRecoveryRecord\(\)/);
  assert.match(hideBody, /hideTradingViewOrders\(api, state\)/);
  assert.match(hideBody, /catch \(error\)[\s\S]*if \(!state\.changed\) clearTradingViewOrdersRecoveryRecord\(\)[\s\S]*throw error/);
  assert.match(hideBody, /waitForTwoAnimationFrames\(\)/);
  assert.match(hideBody, /assertTradingViewOrdersVisibility\(state, false\)/);
  assert.doesNotMatch(hideBody, /checkbox|popover|saveChart/);

  const restoreBody = readFunctionBody('restoreTradingViewOrdersAfterBulkCancel');
  assert.match(restoreBody, /const api = getCurrentBinanceTradingViewApi\(\)/);
  assert.match(restoreBody, /assertTradingViewOrdersTarget\(api, state\)/);
  assert.match(restoreBody, /restoreTradingViewOrders\(api, state\)/);
  assert.match(restoreBody, /assertTradingViewOrdersVisibility\(state, state\.originalVisible\)/);
  assert.match(restoreBody, /clearTradingViewOrdersRecoveryRecord\(\)/);
  assert.doesNotMatch(restoreBody, /checkbox|popover|saveChart/);

  const cancelBody = readFunctionBody('runCancelCurrentSymbolOpenOrders');
  const apiIndex = cancelBody.indexOf('const tradingViewApi = getCurrentBinanceTradingViewApi()');
  const visibilityCaptureIndex = cancelBody.indexOf('tradingViewOrdersState = captureTradingViewOrdersVisibility(');
  const hideIndex = cancelBody.indexOf(
    'await hideTradingViewOrdersForBulkCancel(tradingViewApi, tradingViewOrdersState)'
  );
  const destructiveClickIndex = cancelBody.indexOf('cancelAllButton.click()');
  const watcherIndex = cancelBody.indexOf('createBinanceCancelAllDialogDecisionWatcher()');
  const chartRestoreIndex = cancelBody.indexOf('await restoreTradingViewOrdersAfterBulkCancel(');
  const symbolGuardedRestoreIndex = cancelBody.indexOf('if (restoreTemporaryUiState && isCurrentObservedSymbol(symbol))');
  const postHideBody = cancelBody.slice(hideIndex);
  const freshScopeIndex = postHideBody.indexOf('openOrdersScope = await waitForActiveOpenOrdersScope()');
  const freshFilterIndex = postHideBody.indexOf('isOpenOrdersScopeConfirmedForSymbol(openOrdersScope, symbol)');
  const freshButtonIndex = postHideBody.indexOf(
    'cancelAllButton = findCurrentSymbolCancelAllButton(openOrdersScope)'
  );
  const postHideClickIndex = postHideBody.indexOf('cancelAllButton.click()');

  assert.ok(apiIndex !== -1 && visibilityCaptureIndex !== -1 && hideIndex !== -1);
  assert.ok(watcherIndex !== -1 && destructiveClickIndex !== -1);
  assert.ok(apiIndex < visibilityCaptureIndex && visibilityCaptureIndex < hideIndex);
  assert.ok(hideIndex < destructiveClickIndex);
  assert.ok(watcherIndex < destructiveClickIndex, 'dialog decision watcher must exist before destructive click');
  assert.ok(freshScopeIndex !== -1 && freshFilterIndex !== -1 && freshButtonIndex !== -1);
  assert.ok(
    freshScopeIndex < freshFilterIndex && freshFilterIndex < freshButtonIndex && freshButtonIndex < postHideClickIndex,
    'the active scope, symbol filter, and cancel button must be reacquired after hiding'
  );
  assert.match(cancelBody, /status: 'chart_orders_not_hidden'/);
  assert.match(cancelBody, /dialogDecision\.status === 'cancelled'[\s\S]*status: 'cancelled'/);
  assert.match(cancelBody, /dialogDecision\.status === 'cancelled'[\s\S]*return \{ ok: false, status: 'cancelled'[\s\S]*waitForCurrentSymbolOpenOrdersCleared/);
  assert.match(cancelBody, /dialogDecisionWatcher\.dispose\(\)/);
  assert.match(cancelBody, /restoreTradingViewOrdersState = false[\s\S]*status: 'aborted'/);
  assert.ok(chartRestoreIndex !== -1 && symbolGuardedRestoreIndex !== -1);
  assert.ok(
    symbolGuardedRestoreIndex < chartRestoreIndex,
    'temporary account UI must recover before chart-order visibility'
  );
  assert.match(cancelBody, /if \(restoreTemporaryUiState && isCurrentObservedSymbol\(symbol\)\)[\s\S]*await restoreAccountOrdersTab\([\s\S]*let tradingViewOrdersRestoreSucceeded/);
  assert.match(cancelBody, /let tradingViewOrdersRestoreSucceeded[\s\S]*await restoreTradingViewOrdersAfterBulkCancel\(/);
});

test('bulk cancel distinguishes native confirm from cancellation before clear polling', () => {
  const watcherBody = readFunctionBody('createBinanceCancelAllDialogDecisionWatcher');
  assert.match(watcherBody, /document\.addEventListener\('click', handleClick, true\)/);
  assert.match(watcherBody, /document\.addEventListener\('keydown', handleKeydown, true\)/);
  assert.match(watcherBody, /findBinanceCancelAllDialog\(document, isVisibleElement\)/);
  assert.match(watcherBody, /classifyBinanceCancelAllDialogAction\(contract, eventTarget\)/);
  assert.match(watcherBody, /event\.key !== 'Escape' && event\.key !== 'Enter' && event\.key !== ' '/);
  assert.match(watcherBody, /classifyBinanceCancelAllDialogKeyboardAction\(/);

  const decisionBody = readFunctionBody('waitForBinanceCancelAllDialogDecision');
  assert.match(decisionBody, /resolveCancelDialogDecision\(\{/);
  assert.match(decisionBody, /dialogVisible: Boolean\(contract\)/);
  assert.match(decisionBody, /aborted: lifecycleSignal\.aborted/);
  assert.doesNotMatch(decisionBody, /closeDeadline/);

  const cancelBody = readFunctionBody('runCancelCurrentSymbolOpenOrders');
  const watcherIndex = cancelBody.indexOf('createBinanceCancelAllDialogDecisionWatcher()');
  const clickIndex = cancelBody.indexOf('cancelAllButton.click()');
  const cancelledIndex = cancelBody.indexOf("dialogDecision.status === 'cancelled'");
  const clearIndex = cancelBody.indexOf('waitForCurrentSymbolOpenOrdersCleared(openOrdersScope, symbol)');
  assert.ok(watcherIndex < clickIndex, 'decision watcher must be installed before opening the dialog');
  assert.ok(clickIndex < cancelledIndex && cancelledIndex < clearIndex);
  assert.match(cancelBody, /status: 'dialog_not_found'/);
  assert.match(cancelBody, /status: 'dialog_contract_invalid'/);
});

test('TradingView showOrders reload recovery is journaled, bounded, and retried only from startup state', () => {
  assert.match(source, /tradingViewOrdersRecoveryPendingAtStartup =\s*sessionStorage\.getItem\(TRADINGVIEW_ORDERS_RECOVERY_STORAGE_KEY\) !== null/);

  const hideBody = readFunctionBody('hideTradingViewOrdersForBulkCancel');
  const validateIndex = hideBody.indexOf('assertTradingViewOrdersTarget(api, state)');
  const writeIndex = hideBody.indexOf('writeTradingViewOrdersRecoveryRecord()');
  const hideIndex = hideBody.indexOf('hideTradingViewOrders(');
  assert.ok(
    validateIndex !== -1
      && writeIndex !== -1
      && hideIndex !== -1
      && validateIndex < writeIndex
      && writeIndex < hideIndex,
  );

  const recoverBody = readFunctionBody('recoverChartOrdersStateAfterReload');
  assert.match(recoverBody, /recovery\.status === 'invalid' \|\| recovery\.status === 'expired'/);
  assert.match(recoverBody, /clearTradingViewOrdersRecoveryRecord\(\)/);
  assert.match(recoverBody, /findBinanceTradingViewTargetDom\(document\)/);
  assert.match(recoverBody, /state\.originalVisible = recovery\.record\.originalVisible/);
  assert.match(recoverBody, /restoreTradingViewOrdersAfterBulkCancel\(state\)/);

  const scheduleBody = readFunctionBody('scheduleChartOrdersRecovery');
  assert.match(scheduleBody, /!tradingViewOrdersRecoveryPendingAtStartup/);
  assert.match(scheduleBody, /cancelCurrentSymbolOpenOrdersTask/);
  assert.match(scheduleBody, /document\.hidden/);
  assert.match(scheduleBody, /recoverChartOrdersStateAfterReload\(\)/);

  const syncRouteBody = readFunctionBody('syncRouteState');
  assert.match(syncRouteBody, /scheduleChartOrdersRecovery\(\)/);
  assert.match(source, /startTradingTimers\(\);\s*scheduleChartOrdersRecovery\(\);/);
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
  assert.match(source, /CANCEL_OPEN_ORDERS_CLEAR_SETTLE_MS = 1200/);
  assert.match(waitBody, /const openOrdersCount = getOpenOrdersTabCount\(\)/);
  assert.match(waitBody, /isCurrentSymbolOpenOrdersClearCandidate\(\{/);
  assert.match(waitBody, /isCurrentSymbolOpenOrdersDefinitivelyClear\(\{[\s\S]*definitivelyCleared: true/);
  assert.match(waitBody, /updateOpenOrdersClearStability\(\{/);
  assert.match(waitBody, /clearCandidateSince = stability\.clearCandidateSince/);
  assert.match(waitBody, /if \(stability\.cleared\)[\s\S]*definitivelyCleared: false/);
  assert.match(waitBody, /while \(true\)/);
  assert.match(waitBody, /shouldContinueOpenOrdersClearObservation\(\{/);
  assert.match(waitBody, /createAccountOrdersMutationSignal/);
  assert.match(waitBody, /mutationSignal\.waitForChange/);
  assert.match(waitBody, /mutationSignal\.dispose\(\)/);
  assert.match(waitBody, /clearCandidateSince \+ CANCEL_OPEN_ORDERS_CLEAR_SETTLE_MS/);
  assert.doesNotMatch(waitBody, /Math\.min\(deadline/);
  assert.doesNotMatch(waitBody, /delay\(/);
  assert.doesNotMatch(waitBody, /while \(Date\.now\(\) < deadline\)/);
  assert.doesNotMatch(waitBody, /hasCurrentSymbolOpenOrders\(/);

  const clearWaitIndex = cancelBody.indexOf('waitForCurrentSymbolOpenOrdersCleared(openOrdersScope, symbol)');
  const successIndex = cancelBody.indexOf("return { ok: true, status: 'cleared'");
  const cleanupIndex = cancelBody.lastIndexOf('finally {');
  const restoreIndex = cancelBody.indexOf('restoreOpenOrdersSymbolFilter(', cleanupIndex);
  assert.ok(clearWaitIndex !== -1 && successIndex !== -1 && cleanupIndex !== -1 && restoreIndex !== -1);
  assert.ok(clearWaitIndex < successIndex, 'clearing must be confirmed before success');
  assert.ok(successIndex < cleanupIndex && cleanupIndex < restoreIndex, 'page state restores only after the clear result');

  assert.doesNotMatch(cancelBody, /chartOrdersDefinitivelyCleared|expectDrawingEvents/);
});

test('cancel current-symbol open orders are single-flight and follow the native dialog lifecycle', () => {
  const wrapperBody = readFunctionBody('cancelCurrentSymbolOpenOrders');
  assert.match(source, /let cancelCurrentSymbolOpenOrdersTask = null/);
  assert.match(wrapperBody, /if \(cancelCurrentSymbolOpenOrdersTask\) return cancelCurrentSymbolOpenOrdersTask/);
  assert.match(wrapperBody, /if \(ladderTask\)[\s\S]*status: 'ladder_running'/);
  assert.match(wrapperBody, /runCancelCurrentSymbolOpenOrders\(options\)/);
  assert.match(wrapperBody, /cancelCurrentSymbolOpenOrdersTask = task/);
  assert.match(wrapperBody, /cancelCurrentSymbolOpenOrdersTask = null/);

  const waitDialogBody = readFunctionBody('waitForDialogToClose');
  assert.match(source, /ROW_CANCEL_DIALOG_CLOSE_TIMEOUT_MS/);
  assert.match(waitDialogBody, /waitForDialogMutationState/);
  assert.doesNotMatch(waitDialogBody, /delay\(/);

  const watcherBody = readFunctionBody('createBinanceCancelAllDialogDecisionWatcher');
  assert.match(watcherBody, /new AbortController\(\)/);
  assert.match(watcherBody, /window\.addEventListener\('pagehide', handlePageHide\)/);
  assert.match(watcherBody, /if \(!event\.persisted\) \{[\s\S]*lifecycleController\.abort\(\)[\s\S]*dialogSignal\.notify\(\)/);
  assert.match(watcherBody, /window\.removeEventListener\('pagehide', handlePageHide\)/);

  const decisionBody = readFunctionBody('waitForBinanceCancelAllDialogDecision');
  assert.match(decisionBody, /aborted: lifecycleSignal\.aborted/);
  assert.match(decisionBody, /watcher\.dialogSignal\.waitForChange/);
  assert.doesNotMatch(decisionBody, /delay\(/);
  assert.doesNotMatch(decisionBody, /closeDeadline/);

  const cancelBody = readFunctionBody('runCancelCurrentSymbolOpenOrders');
  assert.match(cancelBody, /restoreTemporaryUiState = false/);
  assert.match(cancelBody, /restoreTradingViewOrdersState = false/);
  assert.match(cancelBody, /dialogDecision\.status === 'aborted'[\s\S]*status: 'aborted'/);
  assert.doesNotMatch(cancelBody, /dialogDecision\.status === 'dialog_not_closed'/);
  assert.match(cancelBody, /finally\s*\{[\s\S]*if \(restoreTemporaryUiState && isCurrentObservedSymbol\(symbol\)\)/);

  const panelBody = readFunctionBody('refreshLadderPanel');
  assert.match(panelBody, /cancelCurrentSymbolOpenOrdersTask/);
  assert.match(panelBody, /resolveCancelSymbolButtonPresentation\(\{/);
  assert.match(panelBody, /noOrdersFeedback: cancelNoOrdersFeedbackActive/);
  assert.match(panelBody, /data-ladder-cancel-symbol="true"[^`]*>撤本币挂单<\/button>/);
  assert.match(panelBody, /cancelButton\.textContent = cancelPresentation\.label/);

  assert.match(source, /const CANCEL_NO_ORDERS_FEEDBACK_MS = 600/);
  const feedbackBody = readFunctionBody('showCancelNoOrdersFeedback');
  assert.match(feedbackBody, /cancelNoOrdersFeedbackActive = true/);
  assert.match(feedbackBody, /CANCEL_NO_ORDERS_FEEDBACK_MS/);
  const cancelWrapperBody = readFunctionBody('cancelCurrentSymbolOpenOrders');
  assert.match(cancelWrapperBody, /result\?\.status === 'no_orders'/);
  assert.match(cancelWrapperBody, /showCancelNoOrdersFeedback\(\)/);
  assert.match(cancelWrapperBody, /cancelCurrentSymbolOpenOrdersBlocksLadderActions = false[\s\S]*runCancelCurrentSymbolOpenOrders/);
  assert.match(cancelWrapperBody, /finally\s*\{[\s\S]*cancelCurrentSymbolOpenOrdersBlocksLadderActions = false/);
  const cancelRunBody = readFunctionBody('runCancelCurrentSymbolOpenOrders');
  assert.doesNotMatch(cancelRunBody, /CANCEL_NO_ORDERS_FEEDBACK_MS|showCancelNoOrdersFeedback/);
  const zeroCountFastPathIndex = cancelRunBody.indexOf('getOpenOrdersTabCount() === 0');
  const restoreContextIndex = cancelRunBody.indexOf('const previousAccountOrdersTabIdentity');
  const activateOpenOrdersTabIndex = cancelRunBody.indexOf('activateOpenOrdersTab()');
  assert.notEqual(zeroCountFastPathIndex, -1);
  assert.notEqual(restoreContextIndex, -1);
  assert.notEqual(activateOpenOrdersTabIndex, -1);
  assert.ok(zeroCountFastPathIndex < restoreContextIndex);
  assert.ok(zeroCountFastPathIndex < activateOpenOrdersTabIndex);
  assert.doesNotMatch(cancelRunBody, /查找 \$\{symbol\} 当前委托/);
  assert.doesNotMatch(cancelRunBody, /正在隐藏 \$\{symbol\} 图表当前委托/);
  assert.doesNotMatch(cancelRunBody, /正在恢复页面状态/);
  assert.match(cancelRunBody, /撤单确认弹窗已打开/);
  assert.match(cancelRunBody, /已确认撤单，等待当前币挂单清空/);
  assert.match(cancelRunBody, /未能恢复隐藏其他合约状态/);
  assert.match(cancelRunBody, /未能恢复图表当前委托显示/);
  const noOrdersReturnIndex = cancelRunBody.indexOf("status: 'no_orders'");
  const blockLadderActionsIndex = cancelRunBody.indexOf('cancelCurrentSymbolOpenOrdersBlocksLadderActions = true');
  assert.notEqual(noOrdersReturnIndex, -1);
  assert.notEqual(blockLadderActionsIndex, -1);
  assert.ok(noOrdersReturnIndex < blockLadderActionsIndex);
  assert.match(cancelRunBody, /cancelCurrentSymbolOpenOrdersBlocksLadderActions = true;[\s\S]*scheduleRenderPanel\(\);/);

  const startBody = readFunctionBody('startLadder');
  assert.match(startBody, /if \(cancelCurrentSymbolOpenOrdersTask\)[\s\S]*撤本币挂单处理中，请等待完成/);
  const actionRowsBody = readFunctionBody('getLadderActionRows');
  assert.match(actionRowsBody, /actionDisabled = ladderRunning \|\| cancelCurrentSymbolOpenOrdersBlocksLadderActions/);
  assert.doesNotMatch(actionRowsBody, /!!cancelCurrentSymbolOpenOrdersTask/);
  assert.match(actionRowsBody, /ladderActionButton\('OPEN_LONG',[\s\S]*actionDisabled\)/);
});

test('stable panel refreshes avoid writing unchanged text and state attributes', () => {
  const statusBody = readFunctionBody('setLadderStatus');
  assert.match(statusBody, /statusEl\.textContent !== ladderStatusText/);
  assert.match(statusBody, /statusEl\.title !== statusTitle/);

  const panelBody = readFunctionBody('refreshLadderPanel');
  assert.match(panelBody, /toggle\.textContent !== toggleText/);
  assert.match(panelBody, /status\.textContent !== ladderStatusText/);

  const computedBody = readFunctionBody('refreshComputedInfo');
  assert.match(computedBody, /formulaPrefixEl\.textContent !== formulaPrefixText/);
  assert.match(computedBody, /finalEl\.textContent !== finalText/);
  assert.match(computedBody, /minEl\.textContent !== constraintText/);
  assert.match(computedBody, /calculationEl\.title !== calculationTitle/);
  assert.match(computedBody, /multiplierHintEl\.textContent !== multiplierHintText/);
  assert.match(computedBody, /hintEl\.textContent !== hintText/);
  assert.match(computedBody, /hintEl\.title !== hintTitle/);
  assert.match(computedBody, /decBtn\.disabled !== decrementDisabled/);
  assert.match(computedBody, /sideLongBtn\.getAttribute\('aria-checked'\) !== String\(isActive\)/);
  assert.match(computedBody, /sideLongBtn\.tabIndex !== desiredTabIndex/);
  assert.match(computedBody, /sideShortBtn\.getAttribute\('aria-checked'\) !== String\(isActive\)/);
  assert.match(computedBody, /sideShortBtn\.tabIndex !== desiredTabIndex/);
});

test('orderbook precision recommendation marks one shortcut without applying it automatically', () => {
  assert.match(source, /ORDERBOOK_PRECISION_MANUAL_SAMPLE_DURATION_MS = 6000/);
  assert.match(source, /ORDERBOOK_PRECISION_SAMPLE_DURATION_MS = ORDERBOOK_PRECISION_MANUAL_SAMPLE_DURATION_MS/);
  assert.doesNotMatch(source, /ORDERBOOK_PRECISION_SAMPLE_PAUSE_MS/);
  assert.match(source, /LOCAL_ORDERBOOK_PRECISION_SAMPLES_PREFIX = 'jh_binance_orderbook_precision_samples_v3'/);
  assert.match(source, /ORDERBOOK_PRECISION_SHORTCUT_LIMIT = 4/);
  assert.doesNotMatch(source, /data-orderbook-precision-apply/);
  assert.match(source, /data-orderbook-precision-value/);
  assert.doesNotMatch(source, /data-orderbook-precision-adjust/);
  assert.match(source, /data-orderbook-precision-refresh/);
  assert.match(source, /orderbookPrecisionPendingRequest/);
  assert.match(source, /orderbookPrecisionOptionsLoadAttemptedSymbol/);

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
  assert.match(refreshBody, /const controlsBusy = busy \|\| selectionBusy/);
  assert.match(refreshBody, /getOrderbookPrecisionShortcutOptions\([\s\S]*ORDERBOOK_PRECISION_SHORTCUT_LIMIT/);
  assert.match(refreshBody, /queueOrderbookPrecisionOptionsLoad\(symbol\)/);
  assert.match(refreshBody, /shortcutOptions\.includes\(recommendation\)/);
  const shortcutBody = readFunctionBody('renderOrderbookPrecisionShortcut');
  assert.match(shortcutBody, /const recommended = value === recommendation/);
  assert.match(shortcutBody, /position:absolute;top:3px;right:3px;width:6px;height:6px/);
  assert.match(shortcutBody, /background:var\(--color-PrimaryYellow\)/);
  const precisionChangeBody = readFunctionBody('handleOrderbookPrecisionChange');
  assert.match(precisionChangeBody, /readVisibleOrderbookPrecisionOptionValues\(\)/);
  assert.match(precisionChangeBody, /nativeOptionsChanged/);
  assert.doesNotMatch(refreshBody, /样本/);
  assert.doesNotMatch(refreshBody, /sampleText/);
  assert.doesNotMatch(refreshBody, /当前 \$\{currentText\}/);
  assert.doesNotMatch(refreshBody, /fallbackMovement/);
  assert.doesNotMatch(refreshBody, /applyRecommendedOrderbookPrecision\(\)/);
  assert.match(refreshBody, /buttonBaseStyle = `width:68px;height:24px;[^`]*padding:0;[^`]*font-size:12px;line-height:22px;/);
  assert.match(refreshBody, /margin-top:12px;[^`]*font-size:12px;/);
  assert.match(refreshBody, /当前缩放 \$\{current \|\| '--'\}[^`]*订单簿缩放/);
  assert.match(refreshBody, /renderOrderbookPrecisionShortcutSlots\(shortcutOptions, current, recommendation, controlsBusy\)/);
  assert.match(refreshBody, /grid-template-columns:78px repeat\(4,minmax\(0,1fr\)\);[^']*height:24px;margin-top:6px/);
  assert.match(refreshBody, /grid-column:1;[^`]*>\$\{precisionMessage\}<\/span>/);
  assert.match(refreshBody, /data-orderbook-precision-refresh="true"[^`]*grid-column:2;justify-self:start;/);
  const messageIndex = refreshBody.indexOf('>\${precisionMessage}</span>');
  const refreshButtonIndex = refreshBody.indexOf('data-orderbook-precision-refresh="true"');
  assert.ok(messageIndex >= 0, 'recommendation or transient status should be rendered');
  assert.ok(messageIndex < refreshButtonIndex, 'precision message should stay before the update button');
  assert.match(refreshBody, />更新推荐<\/button>/);
  assert.doesNotMatch(refreshBody, /data-orderbook-precision-status/);

  assert.equal((source.match(/ladderOptionRow\('幅', LADDER_STEP_OPTIONS/g) || []).length, 2);
  assert.doesNotMatch(source, /data-ladder-step-action|function ladderStepRow/);

  const busyStatusBody = readFunctionBody('formatOrderbookPrecisionBusyStatus');
  assert.match(busyStatusBody, /Math\.ceil\(remainingMs \/ 1000\)/);
  assert.match(busyStatusBody, /刷新中 \$\{remainingSeconds\}s/);

  assert.doesNotMatch(source, /function runApplyRecommendedOrderbookPrecision/);
  assert.doesNotMatch(source, /function applyRecommendedOrderbookPrecision/);

  const loadBody = readFunctionBody('runLoadOrderbookPrecisionOptions');
  assert.match(loadBody, /waitForStableOrderbookPrecisionOptions\(symbol\)/);
  assert.match(loadBody, /nativeOptions: snapshot\.values/);

  const stableLoadBody = readFunctionBody('waitForStableOrderbookPrecisionOptions');
  assert.match(stableLoadBody, /while \(!document\.hidden && isFuturesTradingPage\(\) && isCurrentObservedSymbol\(symbol\)\)/);
  assert.match(stableLoadBody, /findOrderbookPrecisionTrigger\(\)/);
  assert.match(stableLoadBody, /currentTrigger\?\.element === trigger\.element/);
  assert.match(stableLoadBody, /values\.includes\(startPrecision\)/);
  assert.match(stableLoadBody, /finally\s*\{[\s\S]*if \(!optionsInitiallyVisible\)[\s\S]*closeOrderbookPrecisionOptions\(trigger\.element, cleanupPrecision, true\)/);
  assert.match(stableLoadBody, /await delay\(ORDERBOOK_PRECISION_READY_POLL_MS\)/);

  const closeOptionsBody = readFunctionBody('closeOrderbookPrecisionOptions');
  assert.match(closeOptionsBody, /findVisibleOrderbookPrecisionOption\(currentPrecision, triggerElement\)/);
  assert.match(closeOptionsBody, /dispatchOrderbookPrecisionToggleSequence\(toggleTarget\)/);

  const selectBody = readFunctionBody('runSelectOrderbookPrecision');
  assert.match(selectBody, /getOrderbookPrecisionShortcutOptions\([\s\S]*ORDERBOOK_PRECISION_SHORTCUT_LIMIT/);
  assert.match(selectBody, /shortcutOptions\.includes\(targetPrecision\)/);
  assert.match(selectBody, /clickAndConfirmOrderbookPrecisionOption\(\{/);
  const selectValidationIndex = selectBody.indexOf('if (!options.length || !values.includes(startPrecision))');
  const selectCommitIndex = selectBody.indexOf('nativeOptions: values');
  assert.ok(selectValidationIndex >= 0, 'precision selection should validate the complete option list');
  assert.ok(selectValidationIndex < selectCommitIndex, 'precision selection should validate before replacing cached options');

  const selectionBody = readFunctionBody('runOrderbookPrecisionSelectionTask');
  assert.match(selectionBody, /if \(orderbookPrecisionSelectionTask\) return orderbookPrecisionSelectionTask/);
  assert.match(readFunctionBody('selectOrderbookPrecision'), /runOrderbookPrecisionSelectionTask/);
  assert.match(readFunctionBody('queueOrderbookPrecisionOptionsLoad'), /runOrderbookPrecisionSelectionTask\(runLoadOrderbookPrecisionOptions\)/);

  const confirmBody = readFunctionBody('clickAndConfirmOrderbookPrecisionOption');
  assert.match(confirmBody, /waitForOrderbookPrecisionValue/);
  const valueWaitBody = readFunctionBody('waitForOrderbookPrecisionValue');
  assert.match(valueWaitBody, /isCurrentObservedSymbol\(symbol\)/);
  assert.match(valueWaitBody, /current === targetPrecision/);
  assert.match(valueWaitBody, /current && current !== startPrecision/);

  const openOptionsBody = readFunctionBody('openOrderbookPrecisionOptions');
  assert.match(openOptionsBody, /if \(getVisibleOrderbookPrecisionOptionNodes\(triggerElement\)\.length\) return true/);
  assert.match(openOptionsBody, /triggerElement\.matches\?\.\('\.tick-content'\)/);
  assert.match(openOptionsBody, /triggerElement\.closest\?\.\('\.bn-tooltips-ele'\)/);
  assert.match(openOptionsBody, /clickTarget\.closest\('#futuresOrderbook \.orderbook-tickSize'\)/);
  assert.match(openOptionsBody, /clickDomTarget\(clickTarget\)/);
  const deferIndex = openOptionsBody.indexOf('await delay(0)');
  const clickIndex = openOptionsBody.indexOf('clickDomTarget(clickTarget)');
  assert.ok(deferIndex >= 0, 'native precision click should leave the shortcut click event first');
  assert.ok(deferIndex < clickIndex, 'native precision click must run after the event-loop handoff');
  assert.match(openOptionsBody, /!triggerElement\.isConnected \|\| !clickTarget\.isConnected/);
  assert.match(openOptionsBody, /return waitForVisibleOrderbookPrecisionOptions\(triggerElement\)/);
  assert.doesNotMatch(openOptionsBody, /candidates|for \(const target|dispatchOrderbookPrecisionToggleSequence/);

  const openEventBody = readFunctionBody('dispatchOrderbookPrecisionOpenEvent');
  assert.match(openEventBody, /PointerEvent/);
  assert.match(openEventBody, /MouseEvent/);
  const toggleSequenceBody = readFunctionBody('dispatchOrderbookPrecisionToggleSequence');
  assert.match(toggleSequenceBody, /pointerdown/);
  assert.match(toggleSequenceBody, /mousedown/);
  assert.match(toggleSequenceBody, /pointerup/);
  assert.match(toggleSequenceBody, /mouseup/);
  assert.match(toggleSequenceBody, /click/);

  const waitOptionsBody = readFunctionBody('waitForVisibleOrderbookPrecisionOptions');
  assert.match(waitOptionsBody, /getVisibleOrderbookPrecisionOptionNodes\(triggerElement\)\.length/);
  assert.match(waitOptionsBody, /await delay\(50\)/);
  assert.match(source, /function waitForVisibleOrderbookPrecisionOptions\(triggerElement, timeoutMs = ORDERBOOK_PRECISION_OPTION_WAIT_MS\)/);

  const bootstrapReadyBody = readFunctionBody('waitForOrderbookPrecisionBootstrapReady');
  assert.match(bootstrapReadyBody, /getOrderbookPrices\('BID', 1\)/);
  assert.match(bootstrapReadyBody, /getOrderbookPrices\('ASK', 1\)/);
  assert.match(bootstrapReadyBody, /isCurrentObservedSymbol\(symbol\)/);

  assert.match(closeOptionsBody, /waitForVisibleOrderbookPrecisionOptions\(triggerElement, ORDERBOOK_PRECISION_OPTION_WAIT_MS\)/);
  assert.match(closeOptionsBody, /findVisibleOrderbookPrecisionOption\(currentPrecision, triggerElement\)/);
  assert.match(closeOptionsBody, /waitForOrderbookPrecisionOptionsClosed\(triggerElement\)/);

  const queueOptionsBody = readFunctionBody('queueOrderbookPrecisionOptionsLoad');
  assert.match(source, /function queueOrderbookPrecisionOptionsLoad\(symbol, force = false\)/);
  assert.match(queueOptionsBody, /!force && orderbookPrecisionOptionsLoadAttemptedSymbol === symbol/);
  assert.match(queueOptionsBody, /orderbookPrecisionOptionsLoadAttemptedSymbol = symbol/);
  assert.match(queueOptionsBody, /finally\s*\{[\s\S]*document\.hidden[\s\S]*orderbookPrecisionOptionsLoadAttemptedSymbol = null/);
  assert.match(queueOptionsBody, /finally\s*\{[\s\S]*orderbookPrecisionOptionsLoadRequestedSymbol === symbol[\s\S]*orderbookPrecisionOptionsLoadRequestedSymbol = null/);

  const manualRefreshBody = readFunctionBody('refreshOrderbookPrecisionSamplesNow');
  assert.match(manualRefreshBody, /!orderbookPrecisionState\.nativeOptions\.length[\s\S]*queueOrderbookPrecisionOptionsLoad\(symbol, true\)/);

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
  assert.match(optionsBody, /readOrderbookPrecisionOptionValue\(node\)/);
  assert.match(optionsBody, /getVisibleOrderbookPrecisionOverlay\(triggerElement\)/);
  assert.match(optionsBody, /node\.closest\('\.ob-ticksize-overlay'\) === overlay/);
  assert.doesNotMatch(optionsBody, /document\.querySelectorAll/);
  assert.doesNotMatch(optionsBody, /ORDERBOOK_PRECISION_CANDIDATE_OPTIONS/);

  const overlayBody = readFunctionBody('getVisibleOrderbookPrecisionOverlay');
  assert.match(overlayBody, /tickSize\.querySelectorAll\('\.ob-ticksize-overlay'\)/);
  assert.match(overlayBody, /overlays\.length === 1/);
  assert.match(overlayBody, /tickSize\.closest\('#futuresOrderbook'\)/);

  const optionValueBody = readFunctionBody('readOrderbookPrecisionOptionValue');
  assert.match(optionValueBody, /\.ob-ticksize-item/);
  assert.match(optionValueBody, /querySelector\('span'\)/);

  const findOptionBody = readFunctionBody('findVisibleOrderbookPrecisionOption');
  assert.match(findOptionBody, /getVisibleOrderbookPrecisionOptionNodes\(triggerElement\)/);
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
  assert.match(actionBody, /isCloseSnapshotReady\(currentSymbol\)/);
  assert.match(actionBody, /const rawCloseContext = readCloseContext\(currentSymbol\)/);
  assert.match(actionBody, /resolveConfirmedCloseDirection\(rawCloseContext/);
  assert.doesNotMatch(actionBody, /lastDisplayCloseState/);

  const closeBaseBody = readFunctionBody('readCloseBaseQtyForLadder');
  assert.match(closeBaseBody, /isCloseSnapshotReady\(symbol\)/);
  assert.match(closeBaseBody, /const raw = readCloseContext\(symbol\)/);
  assert.match(closeBaseBody, /raw\.knowsLong && raw\.knowsShort/);
  assert.doesNotMatch(closeBaseBody, /resolveDisplayCloseState/);

  const refreshBody = readFunctionBody('refreshComputedInfo');
  assert.match(refreshBody, /const rawCloseContext = readCloseContext\(\)/);
  assert.match(refreshBody, /syncNativeCloseButtons\(tradeMode, rawCloseContext\)/);
  assert.doesNotMatch(refreshBody, /closeContext\.isPending \|\|/);
  assert.equal((refreshBody.match(/shouldDisableCloseControl\(/g) || []).length, 2);

  const ladderRowsBody = readFunctionBody('getLadderActionRows');
  assert.doesNotMatch(ladderRowsBody, /closePending/);
  assert.equal((ladderRowsBody.match(/shouldDisableCloseControl\(/g) || []).length, 2);
  assert.doesNotMatch(source, /applyCachedNativeCloseButtonState/);
});

test('confirmed close-quantity mutations bypass the generic trade UI debounce', () => {
  const waitStart = source.indexOf('function waitForTradeUiMutation');
  const waitEnd = source.indexOf('function handleTradeModeTabTransition', waitStart);
  const waitBody = source.slice(waitStart, waitEnd);
  const snapshotReadyIndex = waitBody.indexOf('closeGuard.snapshotReady = true');
  const immediateRenderIndex = waitBody.indexOf('scheduleRenderPanel()', snapshotReadyIndex);
  const debounceIndex = waitBody.indexOf('tradeUiMutationDebounceTimer = window.setTimeout');

  assert.notEqual(snapshotReadyIndex, -1);
  assert.notEqual(immediateRenderIndex, -1);
  assert.notEqual(debounceIndex, -1);
  assert.ok(snapshotReadyIndex < immediateRenderIndex);
  assert.ok(immediateRenderIndex < debounceIndex);
  assert.match(waitBody, /closeGuard\.snapshotReady = true;[\s\S]*window\.clearTimeout\(tradeUiMutationDebounceTimer\);[\s\S]*scheduleRenderPanel\(\);[\s\S]*return;/);
});

test('pending close actions report position confirmation without starting execution', () => {
  const startBody = readFunctionBody('startLadder');
  assert.match(startBody, /spec\?\.mode === 'CLOSE' && !isCloseSnapshotReady\(actionSymbol\)/);
  assert.match(startBody, /setLadderStatus\('仓位确认中'\)/);

  assert.match(source, /if \(getActiveTradeMode\(\) === 'CLOSE' && !isCloseSnapshotReady\(clickedSymbol\)\) \{\s*warn\('仓位确认中'\);\s*return;/);
});

test('cancel flow rechecks the captured symbol before destructive click and cleanup', () => {
  const waitBody = readFunctionBody('waitForCurrentSymbolOpenOrders');
  assert.match(waitBody, /isCurrentObservedSymbol\(symbol\)/);
  assert.match(waitBody, /waitForAccountOrdersState/);
  assert.doesNotMatch(waitBody, /delay\(/);
  assert.match(waitBody, /isFilteredCurrentSymbolOpenOrdersEmpty/);
  assert.match(waitBody, /getCheckboxCheckedState\(findHideOtherSymbolCheckbox\(currentRoot\)\)/);
  const hasOrdersBody = readFunctionBody('hasCurrentSymbolOpenOrders');
  assert.doesNotMatch(hasOrdersBody, /getOpenOrdersTabCount\(\)/);
  assert.match(
    waitBody,
    /isCurrentSymbolOpenOrdersDefinitivelyClear\(\{[\s\S]*return \{ hasOrders: false, cancelAllButton: null \}/,
    'a confirmed account-wide zero count should end the pre-cancel observation immediately',
  );

  const cancelBody = readFunctionBody('runCancelCurrentSymbolOpenOrders');
  assert.ok(
    cancelBody.indexOf('if (!isCurrentObservedSymbol(symbol))') < cancelBody.indexOf('const previousAccountOrdersTab'),
    'cancel flow should reject an unobserved symbol before changing tabs'
  );
  assert.match(cancelBody, /if \(!isCurrentObservedSymbol\(symbol\)\)[\s\S]*cancelAllButton\.click\(\)/);
  assert.match(cancelBody, /finally\s*\{[\s\S]*if \(restoreTemporaryUiState && isCurrentObservedSymbol\(symbol\)\) \{/);
  assert.match(cancelBody, /restoreOpenOrdersSubTab\(previousOpenOrdersSubTabIdentity, symbol\)/);
  assert.match(cancelBody, /restoreAccountOrdersTab\(previousAccountOrdersTabIdentity, symbol\)/);
  assert.match(cancelBody, /getAccountOrdersTabIdentity\(findSelectedAccountOrdersTab\(\)\)/);

  const accountWaitBody = readFunctionBody('waitForAccountOrdersState');
  assert.match(accountWaitBody, /getAccountOrdersObservationRoot\(\) \|\| document\.body/);
  assert.match(accountWaitBody, /waitForAccountOrdersMutationState\(observationRoot, readState, timeoutMs\)/);

  const activateTabBody = readFunctionBody('activateOpenOrdersTab');
  assert.doesNotMatch(activateTabBody, /delay\(/);
  const activateBasicBody = readFunctionBody('activateOpenOrdersBasicSubTab');
  assert.doesNotMatch(activateBasicBody, /delay\(/);

  const filterBody = readFunctionBody('ensureOpenOrdersLimitedToCurrentSymbol');
  assert.match(filterBody, /if \(!checkbox\)[\s\S]*ok: false/);
  assert.doesNotMatch(filterBody, /ok: isOpenOrdersScopeLimitedToSymbol/);
  assert.match(filterBody, /await waitForAccountOrdersState/);
  assert.match(filterBody, /getActiveOpenOrdersScope\(\)/);
  assert.match(filterBody, /isCurrentSymbolOpenOrdersFilterReady/);
  assert.doesNotMatch(filterBody, /delay\(/);

  const restoreFilterBody = readFunctionBody('restoreOpenOrdersSymbolFilter');
  assert.match(restoreFilterBody, /setHideOtherSymbolChecked\(root, false, symbol\)/);
  assert.doesNotMatch(restoreFilterBody, /isCurrentSymbolOpenOrdersFilterReady/);
});

test('multiplier edits retain their captured symbol, mode, and orderbook precision', () => {
  assert.match(source, /let multiplierEditContext = null/);
  assert.match(source, /function beginMultiplierEdit\(/);
  assert.match(source, /function isMultiplierEditContextCurrent\(/);
  assert.match(source, /precision: readCurrentOrderbookPrecisionValue\(\)/);
  assert.match(source, /context\.precision === readCurrentOrderbookPrecisionValue\(\)/);
  assert.match(source, /saveMultiplier\(\s*value,\s*multiplierEditContext\.mode,\s*multiplierEditContext\.symbol,\s*multiplierEditContext\.precision,?\s*\)/);
  assert.match(source, /saveMultiplier\(normalized, editContext\.mode, editContext\.symbol, editContext\.precision\)/);
  const updateBody = readFunctionBody('updateMultiplier');
  assert.match(updateBody, /isCurrentObservedSymbol\(context\.symbol\)/);
  assert.match(updateBody, /context\.precision !== readCurrentOrderbookPrecisionValue\(\)/);
  assert.match(updateBody, /saveMultiplier\(normalized, context\.mode, context\.symbol, context\.precision\)/);
  assert.match(source, /updateMultiplier\([^\n]+, context\)/);
});

test('panel numeric options wait for a complete mode-symbol-precision context', () => {
  const contextBody = readFunctionBody('getPanelOptionContext');
  assert.match(contextBody, /\['OPEN', 'CLOSE'\]\.includes\(context\.mode\)/);
  assert.match(contextBody, /context\.symbol && context\.precision/);

  const renderBody = readFunctionBody('renderPanel');
  assert.match(renderBody, /const optionContext = getPanelOptionContext\(\)/);
  assert.match(renderBody, /const storedMultiplier = optionContext/);

  const refreshBody = readFunctionBody('refreshComputedInfo');
  assert.match(refreshBody, /finalText = '等待订单簿缩放值'/);
  assert.match(refreshBody, /finalText = '等待开仓\/平仓状态'/);
  assert.match(refreshBody, /const numericContextReady = modeReady && precisionReady/);
});

test('precision changes invalidate edits and immediately rerender the panel', () => {
  assert.match(source, /let orderbookPrecisionObserver = null/);
  assert.match(source, /let lastObservedOrderbookPrecision = null/);
  const ensureBody = readFunctionBody('ensureOrderbookPrecisionObserver');
  assert.match(ensureBody, /findOrderbookPrecisionTrigger\(\)/);
  assert.match(ensureBody, /new MutationObserver/);
  assert.match(ensureBody, /handleOrderbookPrecisionChange\(\)/);
  assert.match(ensureBody, /characterData: true/);
  const changeBody = readFunctionBody('handleOrderbookPrecisionChange');
  assert.match(changeBody, /stopMultiplierEdit\(\)/);
  assert.match(changeBody, /ladderPanelBodySignature = ''/);
  assert.match(changeBody, /scheduleRenderPanel\(\)/);
  const stopBody = readFunctionBody('stopTradingTimers');
  assert.match(stopBody, /stopOrderbookPrecisionObserver\(\)/);
});

test('ladder plans fail closed when orderbook precision changes', () => {
  const buildBody = readFunctionBody('buildLadderPlan');
  assert.match(buildBody, /const startPrecision = readCurrentOrderbookPrecisionValue\(\)/);
  assert.match(buildBody, /if \(!startPrecision\) throw new Error\('未识别订单簿缩放值'\)/);
  assert.match(buildBody, /precision: startPrecision/);

  const contextBody = readFunctionBody('assertLadderExecutionContext');
  assert.match(contextBody, /readCurrentOrderbookPrecisionValue\(\) !== plan\.precision/);

  const replacementBody = readFunctionBody('createLadderExpectedContext');
  assert.match(replacementBody, /symbol: plan\.symbol/);
  assert.match(replacementBody, /mode: plan\.spec\.mode/);
  assert.match(replacementBody, /precision: plan\.precision/);
});

test('single-order sizing and submission retain the captured orderbook precision', () => {
  const resolveBody = readFunctionBody('resolveTargetQty');
  assert.match(resolveBody, /const precision = readCurrentOrderbookPrecisionValue\(\)/);
  assert.match(resolveBody, /if \(!precision\) throw new Error\('未识别订单簿缩放值'\)/);
  assert.match(resolveBody, /loadMultiplier\(tradeMode, symbol, precision\)/);
  assert.match(resolveBody, /precision,/);
  assert.match(source, /readCurrentOrderbookPrecisionValue\(\) !== qtyPlan\.precision/);
});

test('precision shortcut selection and sampling do not commit after a symbol switch', () => {
  const confirmBody = readFunctionBody('clickAndConfirmOrderbookPrecisionOption');
  assert.match(confirmBody, /!isCurrentObservedSymbol\(symbol\)/);
  assert.match(confirmBody, /readCurrentOrderbookPrecisionValue\(\) !== startPrecision/);
  assert.match(confirmBody, /clickDomTarget\(option\)/);

  const selectBody = readFunctionBody('runSelectOrderbookPrecision');
  assert.match(selectBody, /const symbol = getCurrentSymbol\(\)/);
  assert.match(selectBody, /readCurrentOrderbookPrecisionValue\(\) !== startPrecision/);

  const loadBody = readFunctionBody('runLoadOrderbookPrecisionOptions');
  assert.match(loadBody, /const symbol = getCurrentSymbol\(\)/);
  assert.match(loadBody, /!snapshot \|\| !isCurrentObservedSymbol\(symbol\)/);
  const stableLoadBody = readFunctionBody('waitForStableOrderbookPrecisionOptions');
  assert.match(stableLoadBody, /isCurrentObservedSymbol\(symbol\)/);
  assert.match(stableLoadBody, /currentTrigger\.value === startPrecision/);

  const roundBody = readFunctionBody('runOrderbookPrecisionSampleRound');
  assert.match(roundBody, /request\.symbol/);
  assert.match(roundBody, /orderbookPrecisionInitialSampledSymbols\.add\(symbol\)/);
  const initialBody = readFunctionBody('startInitialOrderbookPrecisionSample');
  assert.doesNotMatch(initialBody, /orderbookPrecisionInitialSampledSymbols\.add\(symbol\)/);
  const scheduleBody = readFunctionBody('scheduleOrderbookPrecisionSampleRound');
  assert.match(scheduleBody, /orderbookPrecisionActiveRequest\?\.symbol === symbol/);
  assert.match(scheduleBody, /orderbookPrecisionPendingRequest\?\.symbol === symbol/);

  const clearBody = readFunctionBody('clearSymbolOwnedRuntimeState');
  assert.match(clearBody, /orderbookPrecisionOptionsLoadRequestedSymbol = null/);
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

test('auto leverage reset is authorized by a fresh current-symbol position response', () => {
  assert.match(
    source,
    /BINANCE_USER_POSITION_BAPI_PATH = '\/bapi\/futures\/v6\/private\/future\/user-data\/user-position'/,
  );
  const fetchBody = readFunctionBody('fetchCurrentSymbolPositionState');
  assert.match(fetchBody, /resolveSymbolPositionStatus\(payload, symbol\)/);
  assert.match(fetchBody, /body: JSON\.stringify\(\{\}\)/);

  const resetBody = readFunctionBody('autoResetOpenLeverageToDefault');
  const positionCheckIndex = resetBody.indexOf('await fetchCurrentSymbolPositionState(symbol)');
  const leverageRequestIndex = resetBody.indexOf('await adjustLeverageApi(symbol, DEFAULT_OPEN_LEVERAGE)');
  assert.ok(positionCheckIndex >= 0);
  assert.ok(leverageRequestIndex > positionCheckIndex);
  assert.match(resetBody, /finalPositionState\.status !== 'flat'/);
  assert.doesNotMatch(source, /function hasPositionInDom/);
  assert.match(generatedSource, /\/bapi\/futures\/v6\/private\/future\/user-data\/user-position/);
  assert.match(generatedSource, /function resolveSymbolPositionStatus/);
  assert.doesNotMatch(generatedSource, /function hasPositionInDom/);
});

test('account position count changes schedule symbol-specific API checks', () => {
  const observationBody = readFunctionBody('handleAccountPositionObservation');
  assert.match(observationBody, /positionCount === lastObservedAccountPositionCount/);
  assert.match(observationBody, /queueAutoOpenLeveragePositionCheck\(triggerSource\)/);

  const checkBody = readFunctionBody('runAutoOpenLeveragePositionCheck');
  assert.match(checkBody, /await fetchCurrentSymbolPositionState\(symbol\)/);
  assert.match(checkBody, /observeAutoOpenLeveragePositionState/);
  assert.match(checkBody, /observation\.shouldReset \|\| resetIfFlat/);
});
