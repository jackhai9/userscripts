import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = await readFile(new URL('../../../src/binance-orderbook-trade/index.user.js', import.meta.url), 'utf8');
const generatedSource = await readFile(new URL('../../../scripts/binance-orderbook-trade.user.js', import.meta.url), 'utf8');
const ladderPlanSource = await readFile(new URL('../../../src/binance-orderbook-trade/core/ladder-plan.js', import.meta.url), 'utf8');
const chartSaveCoalescerSource = await readFile(new URL('../../../src/binance-orderbook-trade/core/chart-save-coalescer.js', import.meta.url), 'utf8');

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

test('route changes are event-driven with one low-frequency watchdog', () => {
  assert.doesNotMatch(source, /function startSymbolChangeTimer\(\)/);
  assert.doesNotMatch(source, /function startRenderPanelTimer\(\)/);
  assert.match(source, /installSpaRouteChangeListener\(window, syncRouteState\)/);
  assert.match(source, /const ROUTE_WATCHDOG_MS = 5000;/);
  const startRouteBody = readFunctionBody('startRouteWatcher');
  assert.match(startRouteBody, /setInterval/);
  assert.match(startRouteBody, /ROUTE_WATCHDOG_MS/);
  const stopTradingBody = readFunctionBody('stopTradingTimers');
  assert.doesNotMatch(stopTradingBody, /stopSymbolChangeTimer|stopRenderPanelTimer/);
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

test('fixed ladder panel avoids rebuilding unchanged body markup', () => {
  const ladderBody = readFunctionBody('refreshLadderPanel');
  assert.match(ladderBody, /ladderPanelBodySignature/);
  assert.match(ladderBody, /body\.innerHTML = bodyHtml/);
  assert.doesNotMatch(ladderBody, /body\.innerHTML !== bodyHtml/);
  assert.match(ladderBody, /const cancelLabel = ui\(cancelPresentation\.label\)/);
  assert.match(ladderBody, /cancelButton\.textContent = cancelLabel/);
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
  assert.match(panelBody, /title="\$\{ui\(PANEL_COPY\.tooltip\.ladderMaker\)\}"[^`]*color:\$\{PRIMARY_EMPHASIS_COLOR\}[^`]*font-weight:\$\{PRIMARY_EMPHASIS_FONT_WEIGHT\}[^`]*\$\{ui\(PANEL_COPY\.section\.ladderMaker\)\}/);
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

test('ladder execution waits for the current semantic action button before every submit', () => {
  const executeBody = readFunctionBody('executeLadderPlan');
  const readyButtonBody = readFunctionBody('waitForReadyLadderSubmitButton');

  assert.match(readyButtonBody, /await waitForTradeActionButtonFrameState/);
  assert.match(readyButtonBody, /plan\.spec\.buttonGetter/);
  assert.match(source, /const TRADE_ACTION_BUTTON_READY_TIMEOUT_SECONDS = 3;/);
  assert.match(source, /const TRADE_ACTION_BUTTON_READY_TIMEOUT_MS = TRADE_ACTION_BUTTON_READY_TIMEOUT_SECONDS \* 1000;/);
  assert.match(readyButtonBody, /下单按钮 \$\{TRADE_ACTION_BUTTON_READY_TIMEOUT_SECONDS\} 秒内未恢复可点击/);
  assert.doesNotMatch(readyButtonBody, /持续处理中/);
  assert.doesNotMatch(executeBody, /const button = plan\.spec\.buttonGetter\(\);\s*if/);
  assert.match(readyButtonBody, /isSubmitButtonBusy/);
  assert.doesNotMatch(source, /LADDER_ORDER_DELAY_MS/);
  assert.match(executeBody, /await waitForReadyLadderSubmitButton\(plan\)[\s\S]*syncTradeInputs/);
  assert.match(executeBody, /syncTradeInputs[\s\S]*await waitForReadyLadderSubmitButton\(plan\)/);
  assert.match(executeBody, /assertSubmittedPriceMatchesExpectedPrice[\s\S]*button\.click\(\)/);
  assert.match(executeBody, /assertSubmittedQtyMatchesExpectedQty[\s\S]*button\.click\(\)/);
});

test('trade input synchronization confirms live controlled values instead of sleeping', () => {
  const setInputBody = readFunctionBody('setInputValueReact');
  const syncBody = readFunctionBody('syncTradeInputs');
  const executeBody = readFunctionBody('executeLadderPlan');

  assert.match(setInputBody, /HTMLInputElement\.prototype/);
  assert.match(setInputBody, /dispatchEvent\(new Event\('input'/);
  assert.match(setInputBody, /dispatchEvent\(new Event\('change'/);
  assert.match(setInputBody, /input\.blur\(\)/);
  assert.doesNotMatch(setInputBody, /dispatchEvent\(new Event\('blur'/);
  assert.equal((syncBody.match(/createTradeInputStateReader/g) || []).length, 1);
  assert.match(syncBody, /createBoundedInputWriter/);
  assert.match(syncBody, /resolveInputs:\s*resolveSynchronizedTradeInputs/);
  assert.equal((syncBody.match(/writeValue:\s*writeTradeInputValue/g) || []).length, 1);
  assert.match(syncBody, /requiredStableMismatchFrames:\s*TRADE_INPUT_SYNC_STABLE_FRAMES/);
  assert.match(syncBody, /requiredStableMismatchMs:\s*stableDurationMs/);
  assert.equal((syncBody.match(/maxWriteAttempts,/g) || []).length, 2);
  assert.equal((syncBody.match(/isRecoveryWriteAllowed,/g) || []).length, 1);
  assert.equal((syncBody.match(/requiredStableMatchFrames:/g) || []).length, 1);
  assert.match(syncBody, /requiredStableMatchMs:\s*stableDurationMs/);
  assert.equal(
    (syncBody.match(/recoverProvisionalMatchRollback:\s*settleControlledForm/g) || []).length,
    1,
  );
  assert.match(syncBody, /isScriptOwnedTradeInputRecoveryState/);
  assert.match(syncBody, /field[\s\S]*preWriteValue[\s\S]*rollbackValue[\s\S]*submittedValue/);
  assert.match(syncBody, /previousSubmittedInputs\?\.submittedQty/);
  assert.match(syncBody, /previousSubmittedInputs\?\.submittedPrice/);
  assert.doesNotMatch(syncBody, /isRecoveryWriteAllowed\s*=\s*settleControlledForm[\s\S]*=>\s*true/);
  assert.match(syncBody, /settleControlledForm[\s\S]*LADDER_INPUT_SETTLE_STABLE_MS/);
  assert.match(source, /const LADDER_INPUT_SETTLE_TIMEOUT_MS = 1200;/);
  assert.match(source, /const LADDER_INPUT_SETTLE_STABLE_MS = 180;/);
  assert.match(source, /const LADDER_INPUT_SETTLE_MAX_WRITES = 5;/);
  assert.equal((syncBody.match(/waitForTradeFormFrameState/g) || []).length, 1);
  assert.doesNotMatch(syncBody, /includePrice:\s*false/);
  assert.match(syncBody, /includePrice:\s*true/);
  assert.match(syncBody, /findPriceInput\(\)/);
  assert.match(syncBody, /findQtyInput\(\)/);
  assert.match(syncBody, /assertSubmittedPriceMatchesExpectedPrice/);
  assert.match(syncBody, /assertSubmittedQtyMatchesExpectedQty/);
  assert.doesNotMatch(syncBody, /delay\(/);
  assert.match(executeBody, /syncTradeInputs\(order\.price,\s*order\.qty,\s*\{[\s\S]*priceLabel:\s*'计划价'[\s\S]*settleControlledForm:\s*true[\s\S]*previousSubmittedInputs:\s*previousAcknowledgedInputs/);
  assert.equal((executeBody.match(/previousAcknowledgedInputs\s*=/g) || []).length, 2);
  assert.ok(
    executeBody.indexOf('previousAcknowledgedInputs = {')
      > executeBody.indexOf('await waitForOrderSubmitAcknowledgement'),
  );
  assert.doesNotMatch(executeBody, /await delay\(90\)|await delay\(120\)/);
  const clickSyncCall = source.match(/syncTradeInputs\(clickedPrice,\s*qtyPlan\.qty,\s*\{[\s\S]*?\}\);/)?.[0] || '';
  assert.match(clickSyncCall, /priceLabel:\s*'点击价'/);
  assert.doesNotMatch(clickSyncCall, /settleControlledForm/);
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
  assert.match(retryBody, /await executeLadderPlan\(\s*plan,\s*progress,\s*setExecutionStatus,\s*abortSignal/);
  assert.match(retryBody, /getReplaceableLadderOpenOrdersPlan\(plan,\s*e\)/);
  assert.match(retryBody, /cancelCurrentSymbolOpenOrdersForPlan\(\s*replacementPlan,\s*progress,\s*setExecutionStatus,\s*abortSignal/);
  assert.doesNotMatch(retryBody, /cancelCurrentSymbolOpenOrders\(\{\s*waitUntilCleared: true\s*\}\)/);
  assert.match(retryBody, /replacementContext = createLadderExpectedContext\(replacementPlan\)/);
  assert.match(retryBody, /buildLadderPlan\(actionType,\s*replacementContext\)/);
  assert.doesNotMatch(retryBody, /findCurrentSymbolCancelAllButton/);

  const startBody = readFunctionBody('startLadder');
  assert.match(startBody, /const spec = getLadderActionSpec\(actionType\)/);
  assert.doesNotMatch(startBody, /cancelCurrentSymbolOpenOrders\(\{\s*waitUntilCleared: true\s*\}\)/);
  assert.match(startBody, /runLadderPlanWithOpenOrderReplacement\(\s*actionType,\s*progress,\s*setExecutionStatus,\s*abortController\.signal/);
});

test('continuous close recovers a confirmed max-open-orders rejection by freeing farthest slots', () => {
  const acknowledgementBody = readFunctionBody('waitForOrderSubmitAcknowledgement');
  const executeBody = readFunctionBody('executeLadderPlan');
  const loadRowsBody = readFunctionBody('loadAllCurrentSymbolOpenOrderRows');
  const cancelPlanBody = readFunctionBody('cancelCurrentSymbolOpenOrdersForPlan');
  const startBody = readFunctionBody('startLadder');

  assert.match(source, /const MAX_OPEN_ORDERS_RECOVERY_CANCEL_COUNT = 50;/);
  assert.match(acknowledgementBody, /isBinanceMaxOpenOrdersErrorCode\(capturedApiErrors\[0\]\.code\)/);
  assert.match(acknowledgementBody, /createLadderMaxOpenOrdersError\(capturedApiErrors\[0\]\)/);
  assert.match(source, /if \(apiError\.success !== false\) throw new Error\('最大挂单限制响应缺少 success=false'\)/);
  assert.match(startBody, /allowMaxOpenOrdersRecovery:\s*continuousSession && spec\.mode === 'CLOSE'/);
  assert.match(executeBody, /isRecoverableMaxOpenOrdersFailure\([\s\S]*options\?\.allowMaxOpenOrdersRecovery/);
  assert.match(executeBody, /strategy:\s*'farthest_for_capacity'/);
  assert.match(executeBody, /if \(maxOpenOrdersRecoveryAttempts > 0\)/);

  const recoveryIndex = executeBody.indexOf("{ strategy: 'farthest_for_capacity' }");
  const retryIndex = executeBody.indexOf('continue;', recoveryIndex);
  const doneIndex = executeBody.indexOf('done++;', recoveryIndex);
  assert.ok(recoveryIndex >= 0 && recoveryIndex < retryIndex && retryIndex < doneIndex);

  assert.match(loadRowsBody, /scrollOpenOrderRowsToBottom\(scrollContainer\)/);
  assert.match(loadRowsBody, /loadedCount > beforeCount/);
  assert.match(loadRowsBody, /stableEndPasses >= 2/);
  assert.match(loadRowsBody, /OPEN_ORDERS_LAZY_LOAD_TIMEOUT_MS/);
  assert.match(cancelPlanBody, /loadAllCurrentSymbolOpenOrderRows\([\s\S]*selectFarthestOpenOrders\(/);
  assert.match(cancelPlanBody, /MAX_OPEN_ORDERS_RECOVERY_CANCEL_COUNT/);
  assert.doesNotMatch(cancelPlanBody, /findCurrentSymbolCancelAllButton/);
});

test('capacity recovery waits through an unrendered open-orders list instead of treating it as empty', () => {
  const loadRowsBody = readFunctionBody('loadAllCurrentSymbolOpenOrderRows');

  assert.doesNotMatch(loadRowsBody, /if \(!scrollContainer\) return readCurrentSymbolOpenOrderRows/);
  assert.match(loadRowsBody, /readCurrentSymbolOpenOrderRowsState\(refreshedRoot,\s*symbol,\s*plan\)/);
  assert.match(loadRowsBody, /if \(!scrollContainer && settledState\) return settledState\.rows;/);
  assert.match(loadRowsBody, /waitForAccountOrdersState\([\s\S]*readCurrentSymbolOpenOrderRowsState/);
  assert.match(loadRowsBody, /scrollOpenOrderRowsToBottom\(scrollContainer\);[\s\S]*const growthRemainingMs = deadline - Date\.now\(\);/);
});

test('capacity recovery skips an unconfirmed row cancellation without claiming the slot was released', () => {
  const cancelOneRowBody = readFunctionBody('cancelOneOpenOrderRowForPlan');
  const cancelFarthestBody = readFunctionBody('cancelFarthestOpenOrderRowsForPlan');

  assert.match(cancelOneRowBody, /createOpenOrderCancellationUnconfirmedError\('待替换挂单仍存在，已停止重新挂单'\)/);
  assert.match(cancelOneRowBody, /createOpenOrderCancellationUnconfirmedError\('待替换挂单状态未稳定，已停止重新挂单'\)/);
  assert.match(cancelFarthestBody, /catch \(error\) \{[\s\S]*isOpenOrderCancellationUnconfirmedError\(error\)/);
  assert.match(cancelFarthestBody, /unconfirmedCount \+= 1;[\s\S]*break;/);
  assert.match(cancelFarthestBody, /releasedCount \+= 1;/);

  const unconfirmedCatchStart = cancelFarthestBody.indexOf('catch (error) {');
  const unconfirmedBreak = cancelFarthestBody.indexOf('break;', unconfirmedCatchStart);
  const releasedCountIncrement = cancelFarthestBody.indexOf('releasedCount += 1;', unconfirmedBreak);
  assert.ok(
    unconfirmedCatchStart >= 0
    && unconfirmedCatchStart < unconfirmedBreak
    && unconfirmedBreak < releasedCountIncrement,
  );
});

test('open and close ladders reprice only remaining orders after explicit maker conflicts', () => {
  const retryBody = readFunctionBody('isRetryableLadderMakerPriceFailure');
  assert.match(retryBody, /plan\?\.spec\?\.mode !== 'OPEN'/);
  assert.match(retryBody, /plan\?\.spec\?\.mode !== 'CLOSE'/);
  assert.match(retryBody, /error\?\.ladderFailureKind === 'maker_price_conflict'/);
  assert.match(retryBody, /isBinancePostOnlyMakerRejectCode\(error\?\.binanceCode\)/);
  assert.match(retryBody, /maker_price_conflict'\) return error\.safeNoSubmit === true/);
  assert.match(retryBody, /isBinancePostOnlyMakerRejectCode\(error\?\.binanceCode\) && error\.safeNoSubmit === true/);
  assert.match(source, /const LADDER_REPRICE_PAUSE_EVERY_ATTEMPTS = 5;/);
  assert.match(source, /const LADDER_REPRICE_PAUSE_MS = 3000;/);
  assert.match(generatedSource, /const LADDER_REPRICE_PAUSE_EVERY_ATTEMPTS = 5;/);
  assert.doesNotMatch(source, /LADDER_REPRICE_MAX_ATTEMPTS/);

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
  assert.match(observeBody, /code,\s*message: payloadSummary\.message,\s*success: payloadSummary\.success/);
  assert.match(observeBody, /capture\.responseDiagnostics\.push/);
  assert.match(observeBody, /bodyKind: 'non_json'/);
  assert.match(observeBody, /bodyKind: 'invalid_json'/);
  assert.match(observeBody, /summarizeBinancePlaceOrderPayload\(payload\)/);

  const trackBody = readFunctionBody('trackLadderSubmitResponse');
  assert.match(trackBody, /capture\.resolveRequestStarted\(\)/);
  assert.match(trackBody, /bodyKind: 'network_error'/);
  assert.match(trackBody, /bodyKind: 'observation_error'/);
  assert.doesNotMatch(trackBody, /\.catch\(\(\) => null\)/);

  const observationBody = readFunctionBody('waitForLadderSubmitResponseObservations');
  assert.match(observationBody, /capture\.responseObservations\.slice\(\)/);
  assert.match(observationBody, /Promise\.race\(\[/);
  assert.match(observationBody, /delay\(timeoutMs\)/);
  assert.match(observationBody, /diagnostics: capture\.responseDiagnostics\.slice\(\)/);

  const acknowledgementBody = readFunctionBody('waitForOrderSubmitAcknowledgement');
  assert.match(acknowledgementBody, /waitForOrderSubmitStartOrFailureFeedback\(/);
  assert.match(acknowledgementBody, /await waitForLadderSubmitResponseObservations\(/);
  assert.match(acknowledgementBody, /capturedApiErrors\.length === 1/);
  assert.match(acknowledgementBody, /isBinancePostOnlyMakerRejectCode\(capturedApiErrors\[0\]\.code\)/);
  assert.match(acknowledgementBody, /capturedApiErrors\.length === 0/);
  assert.match(acknowledgementBody, /mode === 'CLOSE'/);
  assert.match(acknowledgementBody, /isPostOnlyMakerRejectionFeedback\(failureActivity\.message\)/);
  assert.match(acknowledgementBody, /createLadderMakerPriceConflictError\(failureActivity\.message\)/);
  assert.match(acknowledgementBody, /capturedApiSuccesses\.length === 1/);
  assert.match(acknowledgementBody, /formatBinancePlaceOrderResponseDiagnostic/);
  assert.doesNotMatch(acknowledgementBody, /LADDER_SUBMIT_POLL_MS|await delay\(/);
  assert.doesNotMatch(acknowledgementBody, /acknowledgement\.status === 'success'/);
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
  assert.match(executeBody, /consecutiveRepriceAttempts/);
  assert.match(executeBody, /LADDER_REPRICE_PAUSE_EVERY_ATTEMPTS/);
  assert.match(executeBody, /LADDER_REPRICE_PAUSE_MS/);
  assert.doesNotMatch(executeBody, /throw new Error\(`盘口连续移动/);
  assert.match(executeBody, /beginLadderSubmitResponseCapture\(\)/);
  const readyButtonBody = readFunctionBody('waitForReadyLadderSubmitButton');
  assert.match(readyButtonBody, /!isSubmitButtonBusy\(candidate\)/);
  assert.match(source, /button\.getAttribute\('aria-busy'\) === 'true'/);
  assert.match(executeBody, /endLadderSubmitResponseCapture\(submitCaptureId\)/);
  assert.match(executeBody, /waitForOrderSubmitAcknowledgement\([\s\S]*plan\.spec\.mode/);
  assert.match(
    executeBody,
    /const button = await waitForReadyLadderSubmitButton\(plan\);\s*throwIfAborted\(abortSignal\);\s*assertLadderExecutionContext\(plan\);/,
  );
  assert.match(executeBody, /refreshRemainingLadderOrders\(plan,\s*done\)/);
  assert.match(executeBody, /lastRepriceApiErrorCode/);
  assert.match(executeBody, /return \{ done, repriceAttempts, lastRepriceApiErrorCode \}/);
  assert.match(executeBody, /盘口持续移动/);
  assert.doesNotMatch(executeBody, /binanceCode\s*=\s*BINANCE_GTX_ORDER_REJECT_CODE/);

  assert.match(generatedSource, /90805022/);
  assert.match(generatedSource, /isBinancePostOnlyMakerRejectCode/);
  assert.match(generatedSource, /beginLadderSubmitResponseCapture/);
  assert.match(generatedSource, /刷新盘口/);
  assert.doesNotMatch(generatedSource, /自动刷新盘口/);
  assert.match(generatedSource, /isPostOnlyMakerRejectionFeedback/);
});

test('an in-flight order request receives a separate response deadline', () => {
  assert.match(source, /const LADDER_SUBMIT_START_TIMEOUT_MS = 3500;/);
  assert.match(source, /const LADDER_SUBMIT_RESPONSE_TIMEOUT_MS = 12000;/);

  const acknowledgementBody = readFunctionBody('waitForOrderSubmitAcknowledgement');
  assert.match(
    acknowledgementBody,
    /waitForOrderSubmitStartOrFailureFeedback\([\s\S]*LADDER_SUBMIT_START_TIMEOUT_MS/,
  );
  assert.match(
    acknowledgementBody,
    /waitForLadderSubmitResponseObservations\([\s\S]*LADDER_SUBMIT_RESPONSE_TIMEOUT_MS/,
  );
  assert.match(acknowledgementBody, /LADDER_SUBMIT_RESPONSE_TIMEOUT_MS,[\s\S]*abortSignal/);
  assert.doesNotMatch(acknowledgementBody, /remainingAckMs|Date\.now\(\) - startedAt/);

  const responseBody = readFunctionBody('waitForLadderSubmitResponseObservations');
  assert.match(responseBody, /waitForPromiseOrAbort\([\s\S]*abortSignal/);

  const executeBody = readFunctionBody('executeLadderPlan');
  assert.match(
    executeBody,
    /waitForOrderSubmitAcknowledgement\([\s\S]*plan\.spec\.mode,[\s\S]*abortSignal/,
  );
});

test('bapi headers wake leverage checks without startup or 500ms polling sleeps', () => {
  const waitBody = readFunctionBody('waitForBncHeaders');
  const cacheBody = readFunctionBody('cacheBncHeaders');
  assert.match(waitBody, /bncHeadersReady/);
  assert.match(waitBody, /BNC_HEADERS_READY_TIMEOUT_MS/);
  assert.doesNotMatch(waitBody, /delay\(500\)|for\s*\(/);
  assert.match(cacheBody, /resolveBncHeadersReady\(\)/);
  assert.match(cacheBody, /queueAutoOpenLeveragePositionCheck\('headers_ready'\)/);
  assert.doesNotMatch(source, /AUTO_OPEN_LEVERAGE_DELAY_MS/);
  assert.doesNotMatch(source, /queueAutoOpenLeveragePositionCheck\('init'\)/);
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
  assert.match(source, /activeUiLocale === 'en' \? '52px' : '36px'/);
  assert.match(source, /repeat\(4,minmax\(0,1fr\)\) 32px;align-items:center;gap:4px;height:32px;overflow:hidden/);
  assert.doesNotMatch(source, /buttonBaseStyle = `width:68px;height:24px/);
  assert.match(readFunctionBody('renderOrderbookPrecisionShortcut'), /height:32px[^`]*font-size:12px;line-height:30px/);
  assert.match(readFunctionBody('renderOrderbookPrecisionShortcutSlots'), /while \(slots\.length < ORDERBOOK_PRECISION_SHORTCUT_LIMIT\)/);
  assert.doesNotMatch(source, /data-orderbook-precision-status/);

  const ladderBody = readFunctionBody('refreshLadderPanel');
  const actionButtonBody = readFunctionBody('ladderActionButton');
  assert.match(ladderBody, /statusRow\.style\.visibility !== 'visible'/);
  assert.doesNotMatch(ladderBody, /statusRow\.style\.display/);
  assert.match(source, new RegExp(`id="\\$\\{LADDER_STATUS_ROW_ID\\}"[^>]*display:flex;[^>]*height:18px;[^>]*visibility:visible;[^>]*white-space:nowrap;overflow:hidden`));
  assert.match(source, new RegExp(`id="\\$\\{LADDER_STATUS_ID\\}"[^>]*flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis`));
  assert.match(source, new RegExp(`id="\\$\\{USDT_REBALANCE_ACTION_ID\\}"[^>]*data-usdt-rebalance="true" hidden`));
  assert.match(actionButtonBody, /white-space:nowrap;overflow:hidden;text-overflow:ellipsis/);
  assert.match(ladderBody, /data-ladder-cancel-symbol="true"[^`]*white-space:nowrap;overflow:hidden;text-overflow:ellipsis/);
});

test('floating panel stays below Binance native portal overlays', () => {
  const floatingBody = readFunctionBody('placePanelFloating');
  const panelBody = readFunctionBody('ensurePanel');

  assert.match(source, /const PANEL_Z_INDEX = 1000/);
  assert.match(floatingBody, /panel\.style\.zIndex = String\(PANEL_Z_INDEX\)/);
  assert.match(panelBody, /panel\.style\.zIndex = String\(PANEL_Z_INDEX\)/);
  assert.doesNotMatch(source, /panel\.style\.zIndex = '999999'/);
});

test('panel keeps controls in cohesive ordered semantic groups', () => {
  const ensurePanelBody = readFunctionBody('ensurePanel');
  const precisionBody = readFunctionBody('refreshOrderbookPrecisionRecommendation');
  const ladderRowsBody = readFunctionBody('getLadderControlSections');
  const ladderPanelBody = readFunctionBody('refreshLadderPanel');
  const singleZoneIndex = ensurePanelBody.indexOf('data-panel-zone="single-order"');
  const directionIndex = ensurePanelBody.indexOf('data-panel-group="direction"');
  const modeHintIndex = ensurePanelBody.indexOf('id="${MODE_HINT_ID}"');
  const multiplierIndex = ensurePanelBody.indexOf('data-panel-group="multiplier"');
  const quantityMinIndex = ensurePanelBody.indexOf('id="jh-binance-close-qty-min"');
  const ladderIndex = ensurePanelBody.indexOf('data-panel-group="ladder"');

  assert.ok(singleZoneIndex >= 0);
  assert.ok(directionIndex > singleZoneIndex);
  assert.ok(modeHintIndex > directionIndex);
  assert.ok(multiplierIndex > modeHintIndex);
  assert.ok(quantityMinIndex > multiplierIndex);
  assert.ok(ladderIndex > quantityMinIndex);
  assert.match(ensurePanelBody, /data-panel-group="multiplier" style="margin-top:8px;"/);
  assert.match(precisionBody, /margin-top:10px;/);
  assert.match(source, /const PANEL_DIVIDER_COLOR = '#ededed'/);
  assert.match(ensurePanelBody, /data-panel-group="ladder" style="margin:12px -10px 0;padding:11px 10px 0;border-top:2px solid \$\{PANEL_DIVIDER_COLOR\}/);
  assert.match(ensurePanelBody, /PANEL_COPY\.section\.singleOrder/);
  assert.match(ensurePanelBody, /PANEL_COPY\.section\.ladderMaker/);
  assert.match(ladderPanelBody, /ORDERBOOK_PRECISION_RECOMMENDATION_ID/);
  assert.ok(
    ladderPanelBody.indexOf('...controlSections.optionRows')
      < ladderPanelBody.indexOf('ORDERBOOK_PRECISION_RECOMMENDATION_ID'),
  );
  assert.match(ladderRowsBody, /PANEL_COPY\.field\.ratio/);
  assert.match(ladderRowsBody, /PANEL_COPY\.field\.orderCount/);
  assert.match(ladderRowsBody, /PANEL_COPY\.field\.interval/);
});

test('multiplier row reads as a labeled value followed by decrement and increment controls', () => {
  const ensurePanelBody = readFunctionBody('ensurePanel');
  const refreshBody = readFunctionBody('refreshComputedInfo');
  const labelIndex = ensurePanelBody.indexOf('id="${MULTIPLIER_HINT_ID}"');
  const inputIndex = ensurePanelBody.indexOf('id="${INPUT_ID}"');
  const suffixIndex = ensurePanelBody.indexOf('PANEL_COPY.field.multiplierUnit');
  const decrementIndex = ensurePanelBody.indexOf('id="${DEC_ID}"');
  const incrementIndex = ensurePanelBody.indexOf('id="${INC_ID}"');

  assert.ok(labelIndex >= 0);
  assert.ok(inputIndex > labelIndex);
  assert.ok(suffixIndex > inputIndex);
  assert.ok(decrementIndex > suffixIndex);
  assert.ok(incrementIndex > decrementIndex);
  assert.match(ensurePanelBody, /data-multiplier-controls style="display:flex;align-items:center;justify-content:flex-start;gap:6px;height:32px;overflow:hidden/);
  assert.match(refreshBody, /multiplierHintText = PANEL_COPY\.field\.minimumOpenQuantity/);
  assert.match(refreshBody, /multiplierHintText = PANEL_COPY\.field\.minimumCloseQuantity/);
  assert.match(refreshBody, /let multiplierHintText = PANEL_COPY\.field\.minimumOrderQuantity/);
});

test('multiplier clicks use non-blocking local feedback without writing business status', () => {
  const feedbackBody = readFunctionBody('showMultiplierPressFeedback');
  assert.match(feedbackBody, /button\.setAttribute\(MULTIPLIER_PRESS_FEEDBACK_ATTR, 'true'\)/);
  assert.match(feedbackBody, /MULTIPLIER_PRESS_FEEDBACK_MS/);
  assert.match(feedbackBody, /button\.removeAttribute\(MULTIPLIER_PRESS_FEEDBACK_ATTR\)/);
  assert.doesNotMatch(feedbackBody, /disabled|setLadderStatus/);
  assert.match(source, /if \(updateMultiplier\(String\(current \+ 1\), context\)\) \{\s*showMultiplierPressFeedback\(incBtn\);/);
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
  assert.match(ensurePanelBody, /id="\$\{SIDE_LONG_ID\}"[^>]*border:0;/);
  assert.match(ensurePanelBody, /id="\$\{SIDE_SHORT_ID\}"[^>]*border:0;/);
  assert.match(ensurePanelBody, /border-left:1px solid var\(--color-InputLine\)/);
  assert.match(refreshBody, /let hintText = ui\(PANEL_COPY\.field\.clickOrderbook\)/);
  assert.doesNotMatch(refreshBody, /hintText = '仓位确认中'/);
  assert.match(refreshBody, /hintTitle = ui\(isUsingCache/);
  assert.match(refreshBody, /hintText = ui\(PANEL_COPY\.state\.noClosablePosition\)/);
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
  assert.match(apiErrorBody, /Maker 挂单被拒绝（错误码 \$\{apiErrorCode\}）/);
  assert.match(diagnosticsBody, /错误码 \$\{lastRepriceApiErrorCode\}/);
  assert.doesNotMatch(source, /错误码：/);
  assert.doesNotMatch(source, /\(\$\{apiErrorCode\}\)/);
});

test('ladder minimum quantity failure explains safe manual options', () => {
  const buildBody = readFunctionBody('buildLadderPlan');
  assert.match(buildBody, /const minRequiredQtyByLevel = spec\.mode === 'OPEN'/);
  assert.match(buildBody, /getQtyRuleContext\(startSymbol,\s*spec\.mode,\s*price\)\.effectiveMinQty \|\| ruleContext\.baseMinQty/);
  assert.match(buildBody, /fitLadderPlanForMinimumQty\(\{\s*baseQty,\s*minRequiredQty,\s*minRequiredQtyByLevel,\s*percent,\s*levels,\s*stepSize: ruleContext\.stepSize,\s*\}\)/);
  assert.doesNotMatch(buildBody, /setLadderOpenPercent|setLadderLevels/);
  assert.match(buildBody, /allocation = autoFit\.allocation/);
  assert.match(buildBody, /percent = autoFit\.percent/);
  assert.match(buildBody, /minRequiredQty = autoFit\.minRequiredQty \|\| minRequiredQty/);
  assert.match(buildBody, /autoFitLevels = autoFit\.levels/);
  assert.match(buildBody, /autoFitPercent: autoFitPercent/);
  assert.match(buildBody, /autoFitLevels/);
  assert.match(buildBody, /createLadderMinimumQtyFailure\(\{\s*spec,\s*symbol: startSymbol,\s*precision: startPrecision,\s*mode: spec\.mode,\s*minRequiredQty,\s*baseQty,\s*percent,\s*levels,\s*optionContext,\s*minimumPercent: autoFit\.minimumPercent,\s*maxAutoFitPercent: autoFit\.maxPercent,\s*replacementTotalQty: spec\.mode === 'OPEN' \? multiplyDecimalByInt\(minRequiredQty,\s*levels\) : null,\s*\}\)/);

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
  assert.match(errorBody, /precision,\s*optionContext,\s*totalQty: replacementTotalQty/);
  assert.match(errorBody, /replacementTotalQty/);
  assert.doesNotMatch(errorBody, /allowPartialReplacement/);
  assert.match(errorBody, /脚本只会尝试替换当前交易对的同向开仓基础单，不会自动全撤/);
  assert.match(errorBody, /脚本不会自动撤单/);
  assert.doesNotMatch(errorBody, /将自动撤单/);

  const replacementPlanBody = readFunctionBody('getOpenLadderMinimumQtyReplacementPlan');
  assert.match(replacementPlanBody, /plan\.optionContext/);

  const percentBody = readFunctionBody('computeMinimumLadderPercent', ladderPlanSource);
  assert.match(percentBody, /parseDecimalString\(baseQty\)/);
  assert.match(percentBody, /decimalToStepCount\(minRequiredQty,\s*stepSize,\s*'ceil'\)/);
  assert.match(percentBody, /formatStepCount\(minSteps \* BigInt\(requestedLevels\),\s*stepSize\)/);
  assert.match(percentBody, /formatDecimalParts\(scaledPercent,\s*2\)/);

  const fitBody = readFunctionBody('fitLadderPlanForMinimumQty', ladderPlanSource);
  assert.match(ladderPlanSource, /export const MAX_AUTO_FIT_LADDER_PERCENT = '100'/);
  assert.match(fitBody, /const maxPercent = MAX_AUTO_FIT_LADDER_PERCENT/);
  assert.match(fitBody, /getMinRequiredQtyForLevels\(minRequiredQty,\s*minRequiredQtyByLevel,\s*candidateLevels\)/);
  assert.match(fitBody, /for \(let candidateLevels = requestedLevels; candidateLevels >= 1; candidateLevels -= 1\)/);
  assert.match(fitBody, /computeMinimumLadderPercent\(baseQty,\s*candidateMinRequiredQty,\s*candidateLevels,\s*stepSize\)/);
  assert.match(fitBody, /compareDecimalStrings\(candidatePercent,\s*maxPercent\) > 0/);
  assert.match(fitBody, /allocateLadderQuantities\(fitTotalQty,\s*candidateLevels,\s*stepSize,\s*candidateMinRequiredQty\)/);
  assert.match(fitBody, /minRequiredQty: candidateMinRequiredQty/);
  assert.match(fitBody, /levels: candidateLevels/);

  assert.doesNotMatch(source, /getMaxAutoFitLadderPercent|Math\.max\(\.\.\.LADDER_OPEN_PERCENTS\)/);

  const statusBody = readFunctionBody('setLadderStatus');
  assert.match(statusBody, /statusEl\.title =/);

  const startBody = readFunctionBody('startLadder');
  assert.match(startBody, /const failureMessage = localizeKnownUiStatus/);
  assert.match(startBody, /const failureText = formatFailedLadderProgress\(spec\.statusLabel, failureMessage, progress\)/);
  assert.match(startBody, /formatFailedLadderProgress\(\s*spec\.statusLabel,\s*localizeKnownUiStatus/);
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

test('Option or Alt click continuously repeats close ladders only after readiness and cooldown', () => {
  const continuousBody = readFunctionBody('startContinuousLadder');
  const startBody = readFunctionBody('startLadder');
  const executeBody = readFunctionBody('executeLadderPlan');
  const readinessBody = readFunctionBody('readContinuousLadderReadiness');
  const stopBody = readFunctionBody('stopLadder');
  const actionButtonBody = readFunctionBody('ladderActionButton');
  const executionButtonBody = readFunctionBody('ladderExecutionButton');
  const controlSectionsBody = readFunctionBody('getLadderControlSections');

  assert.match(source, /if \(event\.altKey && getLadderActionSpec\(actionType\)\?\.mode === 'CLOSE'\)/);
  assert.match(source, /startContinuousLadder\(actionType\)/);
  assert.match(continuousBody, /spec\.mode !== 'CLOSE'\) return startLadder\(actionType\)/);
  assert.match(continuousBody, /while \(true\)/);
  assert.match(
    continuousBody,
    /await startLadder\(\s*actionType,\s*continuousProgress,\s*chartSaveCoalescer/,
  );
  assert.match(continuousBody, /recordContinuousLadderRound\(continuousProgress, outcome\)/);
  assert.match(continuousBody, /resolveContinuousLadderRecovery\(outcome\.error\)/);
  assert.match(continuousBody, /recovery\?\.cooldownMs/);
  assert.match(continuousBody, /continue/);
  assert.match(continuousBody, /setContinuousLadderProgressStatus\(/);
  assert.match(continuousBody, /await waitForContinuousLadderNextRound\(/);
  assert.match(
    continuousBody,
    /readContinuousLadderReadiness\(\s*actionType,\s*actionSymbol,\s*positionCheckState/,
  );
  assert.match(continuousBody, /onWaitStateChange:/);
  assert.match(continuousBody, /formatContinuousLadderWaitProgress\(/);
  assert.match(startBody, /formatActiveContinuousLadderProgress\(/);
  assert.match(startBody, /activeContinuousLadderRoundProgress = progress/);
  assert.match(startBody, /runLadderPlanWithOpenOrderReplacement\([\s\S]*setExecutionStatus/);
  assert.match(executeBody, /setExecutionStatus\(/);
  assert.doesNotMatch(executeBody, /setLadderStatus\(/);

  assert.match(readinessBody, /isCurrentObservedSymbol\(actionSymbol\)/);
  assert.match(readinessBody, /getActiveTradeMode\(\) !== spec\.mode/);
  assert.match(readinessBody, /document\.hidden/);
  assert.match(readinessBody, /!readCurrentOrderbookPrecisionValue\(\)/);
  assert.match(readinessBody, /!isCloseSnapshotReady\(actionSymbol\)/);
  assert.match(readinessBody, /const button = spec\.buttonGetter\(\)/);
  assert.match(readinessBody, /isSubmitButtonBusy\(button\)/);

  assert.match(stopBody, /continuousLadderAbortController\.abort\(stoppedError\)/);
  assert.match(stopBody, /formatActiveContinuousLadderProgress\(/);
  assert.match(actionButtonBody, /PANEL_COPY\.tooltip\.continuousClose/);
  assert.doesNotMatch(source, /Continuous trading (?:stopped|failed)/);
  assert.match(executionButtonBody, /activeLadderActionType \|\| activeContinuousLadderActionType/);
  assert.match(executionButtonBody, /PANEL_COPY\.action\.stopLadderByAction\[actionType\]/);
  assert.doesNotMatch(source, /stopContinuousLadderByAction/);
  assert.match(executionButtonBody, /white-space:nowrap;overflow:hidden/);
  assert.match(controlSectionsBody, /!!ladderTask \|\| !!continuousLadderTask/);
});

test('continuous close captures only owned order-line saves and restores the chart method', () => {
  const startCoalescingBody = readFunctionBody('startContinuousChartSaveCoalescing');
  const stopCoalescingBody = readFunctionBody('stopContinuousChartSaveCoalescing');
  const continuousBody = readFunctionBody('startContinuousLadder');
  const startLadderBody = readFunctionBody('startLadder');
  const executeBody = readFunctionBody('executeLadderPlan');

  assert.match(chartSaveCoalescerSource, /export function createTradingViewContinuousSaveController/);
  assert.match(chartSaveCoalescerSource, /toolName !== 'LineToolOrder'/);
  assert.match(chartSaveCoalescerSource, /IGNORED_DRAWING_EVENT_TYPES\.has\(eventType\)/);
  assert.match(chartSaveCoalescerSource, /eventType === 'remove'/);
  assert.match(chartSaveCoalescerSource, /beginSubmitCapture/);
  assert.match(chartSaveCoalescerSource, /completeSubmitCapture/);
  assert.match(chartSaveCoalescerSource, /getStats/);
  assert.match(chartSaveCoalescerSource, /api\.subscribe\('drawing_event', handleDrawingEvent\)/);
  assert.match(chartSaveCoalescerSource, /api\.unsubscribe\('drawing_event', handleDrawingEvent\)/);
  assert.match(chartSaveCoalescerSource, /burst\.originalSaveChart\.apply/);
  assert.doesNotMatch(chartSaveCoalescerSource, /saveToJSON|orderUpdate|ordersFullUpdate/);
  assert.match(startCoalescingBody, /findBinanceTradingViewTarget\(document\)/);
  assert.match(startCoalescingBody, /CONTINUOUS_CHART_REMOVE_SAVE_QUIET_MS/);
  assert.match(startCoalescingBody, /CONTINUOUS_CHART_REMOVE_SAVE_MAX_WAIT_MS/);
  assert.match(startCoalescingBody, /CONTINUOUS_CHART_SUBMIT_EVENT_WAIT_MS/);
  assert.match(continuousBody, /const chartSaveCoalescer = startContinuousChartSaveCoalescing\(\)/);
  assert.match(continuousBody, /startLadder\(\s*actionType,\s*continuousProgress,\s*chartSaveCoalescer/);
  assert.match(continuousBody, /stopContinuousChartSaveCoalescing\(chartSaveCoalescer\)/);
  assert.match(stopCoalescingBody, /coalescer\.stop\(\)/);
  assert.match(startLadderBody, /chartSaveController\?\.beginRound\(\)/);
  assert.match(startLadderBody, /chartSaveController\.endRound\(chartSaveRound\)/);
  assert.match(executeBody, /chartSaveController\?\.beginSubmitCapture\(/);
  assert.match(executeBody, /chartSaveController\.completeSubmitCapture\(chartSubmitCapture\)/);
  assert.ok(executeBody.indexOf('beginSubmitCapture') < executeBody.indexOf('button.click()'));
  assert.ok(executeBody.indexOf('button.click()') < executeBody.indexOf('waitForOrderSubmitAcknowledgement'));
  assert.ok(executeBody.indexOf('waitForOrderSubmitAcknowledgement') < executeBody.indexOf('completeSubmitCapture'));
  assert.match(source, /continuousChartSaveController\?\.flush\(\)/);
  assert.match(source, /continuousChartSaveController\?\.getStats\(\)/);
});

test('trade input frame synchronization reuses only its initially proven form root', () => {
  const syncBody = readFunctionBody('syncTradeInputs');
  const findBody = readFunctionBody('findTradeInputs');

  assert.match(findBody, /findActiveTradeInputsDom\(document/);
  assert.match(syncBody, /const inputs = findTradeInputs\(\)/);
  assert.match(syncBody, /createTradeInputResolver\(document, \{/);
  assert.match(syncBody, /initialRoot: observationRoot/);
  assert.match(syncBody, /resolveInputs: resolveSynchronizedTradeInputs/);
  assert.doesNotMatch(syncBody, /resolveInputs: findTradeInputs/);
});

test('open ladder stops immediately only for a confirmed zero available balance', () => {
  const readOpenQtyBody = readFunctionBody('readOpenBaseQtyForLadder');
  assert.match(readOpenQtyBody, /isConfirmedZeroOpenBalance\(quantity\.qty\)/);
  assert.match(readOpenQtyBody, /confirmedZeroOpenBalance/);
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

test('user-facing trading failures preserve one precise reason and shared terminology', () => {
  const buildBody = readFunctionBody('buildLadderPlan');
  const cancelBody = readFunctionBody('runCancelCurrentSymbolOpenOrders');
  const replaceBody = readFunctionBody('cancelCurrentSymbolOpenOrdersForPlan');

  assert.match(buildBody, /getUnavailableLadderQuantityMessage\(/);
  assert.match(buildBody, /normalizeDecimalString\(base\?\.qty \?\? ''\)/);
  assert.match(buildBody, /base\?\.confirmedZeroOpenBalance === true/);
  assert.match(source, /normalizeDecimalString\(available\?\.amount \?\? ''\)/);
  assert.match(buildBody, /读取交易规则时交易对已变化/);
  assert.match(buildBody, /读取交易规则时价格精度已变化/);
  assert.match(buildBody, /交易规则尚未就绪，请稍后重试/);
  assert.doesNotMatch(buildBody, /失败或|未就绪或|未读取到可用可/);
  assert.doesNotMatch(source, /订单簿缩放值|缩放下拉|缩放调整|当前缩放|原生缩放|撤本币|状态丢失|上下文丢失/);
  assert.doesNotMatch(source, /未找到价格或数量输入框|执行中价格或数量输入框丢失/);
  assert.doesNotMatch(source, /未定位当前交易对|下单 API 成功响应|当前委托\/历史成交/);
  assert.doesNotMatch(source, /observer root is unavailable|Binance chart OpenOrders/);
  assert.doesNotMatch(cancelBody, /未定位到|当前币|逐行撤单/);
  assert.doesNotMatch(replaceBody, /未定位到|当前币|逐行撤单/);
});

test('ladder replacement cancels visible current-symbol same-direction rows up to planned quantity', () => {
  const readRowsBody = readFunctionBody('readCurrentSymbolOpenOrderRows');
  const readRowElementsBody = readFunctionBody('readOpenOrderRowElements');
  assert.match(readRowsBody, /readOpenOrderRowElements\(root\)/);
  assert.match(readRowElementsBody, /findOpenOrderRowElements\(root/);
  assert.match(readRowElementsBody, /BINANCE_PAGE_TEXT\.accountOrders\.rowCancel/);
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
  const cancelOneRowBody = readFunctionBody('cancelOneOpenOrderRowForPlan');
  assert.match(cancelOpenOrderRowsBody, /let currentRoot = root/);
  assert.match(cancelOpenOrderRowsBody, /readCurrentSymbolOpenOrderRows\(currentRoot,\s*plan\.symbol,\s*plan\)/);
  assert.match(cancelOpenOrderRowsBody, /const remainingQty = subtractDecimalStrings\(plan\.totalQty,\s*cancelQty\)/);
  assert.match(cancelOpenOrderRowsBody, /allowPartial: true/);
  assert.doesNotMatch(cancelOpenOrderRowsBody, /allowPartialEnd/);
  assert.doesNotMatch(cancelOpenOrderRowsBody, /partial: true/);
  assert.match(cancelOpenOrderRowsBody, /const refreshedRoot = getActiveOpenOrdersScope\(\)/);
  assert.match(cancelOpenOrderRowsBody, /currentRoot = refreshedRoot/);
  assert.match(cancelOpenOrderRowsBody, /currentRoot = row\.root \|\| currentRoot/);
  assert.match(cancelOpenOrderRowsBody, /cancelOneOpenOrderRowForPlan\(/);
  assert.match(cancelOneRowBody, /clickDomTarget\(row\.cancelButton\)/);
  assert.match(cancelOneRowBody, /waitForOpenOrderRowCancellationOutcome\(/);
  assert.match(cancelOneRowBody, /outcome\.status === 'dialog_open'/);
  assert.match(cancelOneRowBody, /confirmOpenOrderRowKeyCountBelow\(\s*plan\.symbol,\s*row\.key,\s*previousKeyCount,\s*abortSignal/);
  assert.doesNotMatch(cancelOneRowBody, /waitForNewVisibleDialog/);
  assert.match(cancelOneRowBody, /const dialogClosed = await waitForDialogToClose\([\s\S]*abortSignal/);
  assert.match(cancelOneRowBody, /DialogNotClosedError/);
  assert.doesNotMatch(cancelOneRowBody, /waitForOpenOrderRowKeyCountBelow\(row\.root/);
  assert.doesNotMatch(cancelOneRowBody, /row\.cancelButton\.click\(\)/);
  assert.doesNotMatch(cancelOpenOrderRowsBody, /for \(const row of rowsToCancel\)/);

  const waitForRowRemovalBody = readFunctionBody('waitForOpenOrderRowKeyCountBelow');
  assert.match(waitForRowRemovalBody, /const activeRoot = getActiveOpenOrdersScope\(\)/);
  assert.match(waitForRowRemovalBody, /activeRoot && countOpenOrderRowsByKey\(activeRoot,\s*symbol,\s*key\) < previousCount/);
  assert.match(waitForRowRemovalBody, /createAccountOrdersMutationSignal/);
  assert.match(waitForRowRemovalBody, /mutationSignal\.waitForChange/);
  assert.match(waitForRowRemovalBody, /mutationSignal\.dispose\(\)/);
  assert.doesNotMatch(waitForRowRemovalBody, /delay\(/);
  assert.doesNotMatch(cancelOpenOrderRowsBody, /delay\(260\)/);

  const cancellationOutcomeBody = readFunctionBody('readOpenOrderRowCancellationOutcome');
  const dialogIndex = cancellationOutcomeBody.indexOf('findNewVisibleDialog(dialogsBefore)');
  const rowCountIndex = cancellationOutcomeBody.indexOf('countOpenOrderRowsByKey');
  assert.ok(dialogIndex >= 0 && rowCountIndex >= 0 && dialogIndex < rowCountIndex);
  assert.match(cancellationOutcomeBody, /status: 'dialog_open'/);
  assert.match(cancellationOutcomeBody, /status: 'row_removed'/);

  const waitForOutcomeBody = readFunctionBody('waitForOpenOrderRowCancellationOutcome');
  assert.match(waitForOutcomeBody, /createAccountOrdersMutationSignal/);
  assert.match(waitForOutcomeBody, /createDialogMutationSignal/);
  assert.match(waitForOutcomeBody, /Promise\.race/);
  assert.match(waitForOutcomeBody, /accountSignal\.dispose\(\)/);
  assert.match(waitForOutcomeBody, /dialogSignal\.dispose\(\)/);
  assert.doesNotMatch(waitForOutcomeBody, /waitForNewVisibleDialog/);

  const confirmRemovalBody = readFunctionBody('confirmOpenOrderRowKeyCountBelow');
  assert.match(confirmRemovalBody, /LADDER_REPLACE_ROW_SETTLE_MS/);
  assert.match(confirmRemovalBody, /countOpenOrderRowsByKey/);
  assert.match(confirmRemovalBody, /createAccountOrdersMutationSignal/);

  const cancelRowsBody = readFunctionBody('cancelCurrentSymbolOpenOrdersForPlan');
  assert.match(cancelRowsBody, /if \(!isCurrentObservedSymbol\(symbol\) \|\| symbol !== plan\?\.symbol\)/);
  assert.match(cancelRowsBody, /activateOpenOrdersBasicSubTab\(\s*openOrdersScope,\s*abortSignal[\s\S]*openOrdersScope = await waitForActiveOpenOrdersScope\(abortSignal\)/);
  assert.match(cancelRowsBody, /if \(!openOrdersScope\) \{\s*const message = '未找到当前委托面板'/);
  assert.match(cancelRowsBody, /waitForCurrentSymbolOpenOrderRows\(\s*openOrdersScope,\s*symbol,\s*plan,\s*abortSignal/);
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

test('stopping a ladder aborts replacement waits before another cancel or submit click', () => {
  const startBody = readFunctionBody('startLadder');
  const stopBody = readFunctionBody('stopLadder');
  const runBody = readFunctionBody('runLadderPlanWithOpenOrderReplacement');
  const executeBody = readFunctionBody('executeLadderPlan');
  const cancelPlanBody = readFunctionBody('cancelCurrentSymbolOpenOrdersForPlan');
  const cancelRowsBody = readFunctionBody('cancelOpenOrderRowsForPlan');
  const cancelOneRowBody = readFunctionBody('cancelOneOpenOrderRowForPlan');
  const waitOutcomeBody = readFunctionBody('waitForOpenOrderRowCancellationOutcome');

  assert.match(source, /let ladderAbortController = null/);
  assert.match(startBody, /const abortController = new AbortController\(\)/);
  assert.match(startBody, /runLadderPlanWithOpenOrderReplacement\(\s*actionType,\s*progress,\s*setExecutionStatus,\s*abortController\.signal/);
  assert.match(stopBody, /const stoppedError = createLadderStoppedError\(\)/);
  assert.match(stopBody, /ladderAbortController\.abort\(stoppedError\)/);
  assert.match(runBody, /cancelCurrentSymbolOpenOrdersForPlan\(\s*replacementPlan,\s*progress,\s*setExecutionStatus,\s*abortSignal/);
  assert.match(runBody, /throwIfAborted\(abortSignal\)[\s\S]*buildLadderPlan/);
  assert.match(executeBody, /throwIfAborted\(abortSignal\)[\s\S]*button\.click\(\)/);
  assert.match(cancelPlanBody, /cancelOpenOrderRowsForPlan\(\s*openOrdersScope,\s*plan,\s*progress,\s*setExecutionStatus,\s*abortSignal/);
  assert.match(cancelPlanBody, /isLadderStoppedError\(e\)[\s\S]*throw e/);
  assert.match(cancelPlanBody, /previousOpenOrdersSubTabIdentity = getOpenOrdersSubTabIdentity\([\s\S]*activateOpenOrdersBasicSubTab\(/);
  assert.match(cancelPlanBody, /symbolFilterOriginalChecked = getCheckboxCheckedState\([\s\S]*ensureOpenOrdersLimitedToCurrentSymbol\(/);
  assert.match(cancelRowsBody, /throwIfAborted\(abortSignal\)[\s\S]*cancelOneOpenOrderRowForPlan\(/);
  assert.match(cancelOneRowBody, /throwIfAborted\(abortSignal\)[\s\S]*clickDomTarget\(row\.cancelButton\)/);
  assert.match(cancelOneRowBody, /waitForOpenOrderRowCancellationOutcome\([\s\S]*abortSignal/);
  assert.match(cancelOneRowBody, /waitForDialogToClose\([\s\S]*abortSignal/);
  assert.match(waitOutcomeBody, /waitForPromiseOrAbort\([\s\S]*abortSignal/);
});

test('stopping a ladder preserves confirmed submit and cancel progress', () => {
  const startBody = readFunctionBody('startLadder');
  const runBody = readFunctionBody('runLadderPlanWithOpenOrderReplacement');
  const executeBody = readFunctionBody('executeLadderPlan');
  const cancelPlanBody = readFunctionBody('cancelCurrentSymbolOpenOrdersForPlan');
  const cancelRowsBody = readFunctionBody('cancelOpenOrderRowsForPlan');
  const cancelOneRowBody = readFunctionBody('cancelOneOpenOrderRowForPlan');

  assert.match(startBody, /const progress = createLadderProgress\(\)/);
  assert.match(startBody, /runLadderPlanWithOpenOrderReplacement\(\s*actionType,\s*progress,\s*setExecutionStatus,\s*abortController\.signal/);
  assert.match(startBody, /isLadderStoppedError\(e\)[\s\S]*formatStoppedLadderProgress\(spec\.statusLabel, progress\)/);
  assert.match(startBody, /formatCompletedLadderProgress\(\s*spec\.statusLabel,\s*done,\s*plan\.orders\.length,\s*progress/);
  assert.match(runBody, /buildLadderPlan\(actionType,\s*replacementContext\)[\s\S]*setLadderPlannedOrders\(progress,\s*plan\.orders\.length\)/);
  assert.match(runBody, /executeLadderPlan\(\s*plan,\s*progress,\s*setExecutionStatus,\s*abortSignal/);
  assert.match(runBody, /cancelCurrentSymbolOpenOrdersForPlan\(\s*replacementPlan,\s*progress,\s*setExecutionStatus,\s*abortSignal/);
  assert.match(executeBody, /waitForOrderSubmitAcknowledgement\([\s\S]*recordLadderSubmittedOrder\(progress\)/);
  assert.match(cancelPlanBody, /cancelOpenOrderRowsForPlan\(\s*openOrdersScope,\s*plan,\s*progress,\s*setExecutionStatus,\s*abortSignal/);
  assert.match(cancelOneRowBody, /confirmOpenOrderRowKeyCountBelow\([\s\S]*recordLadderCancelledOrder\(progress\)/);

  const acknowledgementIndex = executeBody.indexOf('await waitForOrderSubmitAcknowledgement(');
  const acknowledgementFinallyIndex = executeBody.indexOf('} finally {', acknowledgementIndex);
  const submitRecordIndex = executeBody.indexOf('recordLadderSubmittedOrder(progress)');
  assert.ok(
    acknowledgementIndex >= 0
    && acknowledgementIndex < acknowledgementFinallyIndex
    && acknowledgementFinallyIndex < submitRecordIndex,
  );
  assert.doesNotMatch(
    executeBody.slice(acknowledgementIndex, acknowledgementFinallyIndex),
    /throwIfAborted/,
  );

  const cancellationConfirmationIndex = cancelOneRowBody.indexOf('await confirmOpenOrderRowKeyCountBelow(');
  const cancelRecordIndex = cancelOneRowBody.indexOf('recordLadderCancelledOrder(progress)');
  assert.ok(cancellationConfirmationIndex >= 0 && cancellationConfirmationIndex < cancelRecordIndex);
  assert.doesNotMatch(cancelOneRowBody.slice(cancellationConfirmationIndex, cancelRecordIndex), /throwIfAborted/);
});

test('ladder task statuses name the active action and observed outcome', () => {
  const executeBody = readFunctionBody('executeLadderPlan');
  const startBody = readFunctionBody('startLadder');
  const stopBody = readFunctionBody('stopLadder');
  const cancelPlanBody = readFunctionBody('cancelCurrentSymbolOpenOrdersForPlan');
  const planStatusBody = readFunctionBody('formatLadderPlanStatus');
  const replacementStatusBody = readFunctionBody('formatOpenOrdersReplacementStatus');

  assert.match(executeBody, /localizedActionStatus\(\s*plan\.spec\.statusLabel,\s*`挂单 \$\{done \+ 1\}\/\$\{plan\.orders\.length\} 确认中`/);
  assert.match(executeBody, /localizedActionStatus\(\s*plan\.spec\.statusLabel,\s*`已挂 \$\{done\}\/\$\{plan\.orders\.length\} 笔`/);
  assert.match(executeBody, /combineLocalizedText\(\[plan\.spec\.statusLabel, repriceDetail\], '：'\)/);
  assert.match(startBody, /localizedActionStatus\(spec\.statusLabel, '尚未开始：仓位确认中'/);
  assert.match(startBody, /formatInterruptedLadderProgress\(\s*spec\.statusLabel,\s*localizedText\('交易对已切换', 'Symbol changed'\),\s*progress/);
  assert.match(startBody, /formatFailedLadderProgress\(spec\.statusLabel, failureMessage, progress\)/);
  assert.match(stopBody, /formatActiveContinuousLadderProgress\(\s*activeSpec\.statusLabel,\s*localizedText\('停止中', 'Stopping'\)/);
  assert.match(stopBody, /localizedActionStatus\(activeSpec\.statusLabel, '停止中', ' stopping'\)/);
  assert.match(cancelPlanBody, /setPlanStepStatus\(`撤销 \$\{rowsToCancel\.length\} 笔同向挂单`\)/);
  assert.match(planStatusBody, /localizedActionStatus\(plan\.spec\.statusLabel, '计划', ' plan'\)/);
  assert.doesNotMatch(planStatusBody, /%\/|\/幅/);
  assert.match(replacementStatusBody, /plan\.spec\.statusLabel/);
  assert.match(replacementStatusBody, /formatOpenOrdersReplacementDetail\(plan\)/);
  assert.match(cancelPlanBody, /const setPlanStepStatus = \(message\) =>/);
  assert.doesNotMatch(cancelPlanBody, /setLadderStatus\(message\)/);
});

test('panel statuses omit the current full symbol and compact the retained interrupted symbol', () => {
  const cancelBody = readFunctionBody('runCancelCurrentSymbolOpenOrders');
  const cancelRowsBody = readFunctionBody('cancelOpenOrderRowsForPlan');
  const cancelPlanBody = readFunctionBody('cancelCurrentSymbolOpenOrdersForPlan');
  const replacementStatusBody = readFunctionBody('formatOpenOrdersReplacementStatus');

  for (const body of [cancelBody, cancelRowsBody, cancelPlanBody, replacementStatusBody]) {
    assert.doesNotMatch(body, /`[^`]*\$\{symbol\}/);
    assert.doesNotMatch(body, /`[^`]*\$\{plan\.symbol\}/);
  }
  assert.match(cancelBody, /const interruptedBaseAsset = formatStatusBaseAsset\(symbol\)/);
  assert.match(cancelBody, /`原交易对 \$\{interruptedBaseAsset\} 页面已离开，撤单确认跟踪已停止`/);
  assert.match(source, /const clickedBaseAsset = formatStatusBaseAsset\(qtyPlan\.symbol\)/);
  assert.match(source, /const currentBaseAsset = currentSymbol \? formatStatusBaseAsset\(currentSymbol\) : '未知'/);
  assert.doesNotMatch(source, /点击时 \$\{qtyPlan\.symbol\}/);
});

test('bulk cancel removes real chart order drawings with one coalesced save before opening the native dialog', () => {
  assert.match(chartSaveCoalescerSource, /api\.subscribe\('drawing_event'/);
  assert.match(chartSaveCoalescerSource, /function coalescedSaveChart/);
  assert.match(chartSaveCoalescerSource, /originalSaveChart\.apply\(pendingSave\.thisValue, pendingSave\.args\)/);
  assert.match(source, /coalesceTradingViewDrawingSaves/);
  assert.doesNotMatch(source, /tradingProperties\.showOrders/);

  const toggleBody = readFunctionBody('toggleBinanceChartOrdersWithCoalescedSave');
  assert.match(toggleBody, /coalesceTradingViewDrawingSaves/);
  assert.match(toggleBody, /checkbox\.click\(\)/);
  assert.match(toggleBody, /waitForBinanceChartOrdersPopover\(target, expectedChecked\)/);
  assert.match(toggleBody, /expectDrawingEvents \? \{\} : \{ eventDiscoveryTimeoutMs: 0 \}/);

  const hideBody = readFunctionBody('hideBinanceChartOrdersForBulkCancel');
  assert.match(hideBody, /state\.originalChecked = current\.checked/);
  assert.match(hideBody, /writeChartOrdersRecoveryRecord\(\)/);
  assert.match(hideBody, /state\.changed = true/);
  assert.match(hideBody, /toggleBinanceChartOrdersWithCoalescedSave\([\s\S]*false,[\s\S]*true/);
  assert.match(hideBody, /closeBinanceChartOrdersPopover\(target\)/);

  const restoreBody = readFunctionBody('restoreBinanceChartOrdersAfterBulkCancel');
  assert.match(restoreBody, /assertSameBinanceChartOrdersTarget\(target, getBinanceChartOrdersTarget\(\)\)/);
  assert.match(restoreBody, /current\.checked !== state\.originalChecked/);
  assert.match(restoreBody, /toggleBinanceChartOrdersWithCoalescedSave/);
  assert.match(restoreBody, /clearChartOrdersRecoveryRecord\(\)/);

  const cancelBody = readFunctionBody('runCancelCurrentSymbolOpenOrders');
  const targetIndex = cancelBody.indexOf('chartOrdersTarget = getBinanceChartOrdersTarget()');
  const hideIndex = cancelBody.indexOf(
    'await hideBinanceChartOrdersForBulkCancel(chartOrdersTarget, chartOrdersState)'
  );
  const destructiveClickIndex = cancelBody.indexOf('cancelAllButton.click()');
  const watcherIndex = cancelBody.indexOf('createBinanceCancelAllDialogDecisionWatcher()');
  const chartRestoreIndex = cancelBody.indexOf('await restoreBinanceChartOrdersAfterBulkCancel(');
  const symbolGuardedRestoreIndex = cancelBody.indexOf('if (restoreTemporaryUiState && isCurrentObservedSymbol(symbol))');
  const postHideBody = cancelBody.slice(hideIndex);
  const freshScopeIndex = postHideBody.indexOf('openOrdersScope = await waitForActiveOpenOrdersScope()');
  const freshFilterIndex = postHideBody.indexOf('isOpenOrdersScopeConfirmedForSymbol(openOrdersScope, symbol)');
  const freshButtonIndex = postHideBody.indexOf(
    'cancelAllButton = findCurrentSymbolCancelAllButton(openOrdersScope)'
  );
  const postHideClickIndex = postHideBody.indexOf('cancelAllButton.click()');

  assert.ok(targetIndex !== -1 && hideIndex !== -1);
  assert.ok(watcherIndex !== -1 && destructiveClickIndex !== -1);
  assert.ok(targetIndex < hideIndex);
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
  assert.match(cancelBody, /restoreChartOrdersState = false[\s\S]*status: 'aborted'/);
  assert.ok(chartRestoreIndex !== -1 && symbolGuardedRestoreIndex !== -1);
  assert.ok(
    symbolGuardedRestoreIndex < chartRestoreIndex,
    'temporary account UI must recover before chart-order visibility'
  );
  assert.match(cancelBody, /if \(restoreTemporaryUiState && isCurrentObservedSymbol\(symbol\)\)[\s\S]*await restoreAccountOrdersTab\([\s\S]*let chartOrdersRestoreSucceeded/);
  assert.match(cancelBody, /let chartOrdersRestoreSucceeded[\s\S]*await restoreBinanceChartOrdersAfterBulkCancel\(/);
});

test('bulk cancel distinguishes native confirm from cancellation before clear polling', () => {
  const watcherBody = readFunctionBody('createBinanceCancelAllDialogDecisionWatcher');
  assert.match(watcherBody, /event\.preventDefault\(\)[\s\S]*event\.stopImmediatePropagation\(\)/);
  assert.equal(watcherBody.match(/rejectInvalidDialogAction\(event, error\)/g)?.length, 2);
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
  const invalidDialogBranch = cancelBody.match(
    /catch \(error\) \{\s*restoreTemporaryUiState = false;([\s\S]*?)status: 'dialog_contract_invalid'/,
  )?.[1] || '';
  assert.notEqual(invalidDialogBranch, '');
  assert.doesNotMatch(invalidDialogBranch, /restoreChartOrdersState = false/);
  assert.doesNotMatch(invalidDialogBranch, /图表当前委托保持隐藏/);
});

test('chart Open Orders reload recovery remains pending until restoration succeeds', () => {
  assert.match(source, /chartOrdersRecoveryPendingAtStartup =\s*sessionStorage\.getItem\(CHART_ORDERS_RECOVERY_STORAGE_KEY\) !== null/);

  const hideBody = readFunctionBody('hideBinanceChartOrdersForBulkCancel');
  const stateIndex = hideBody.indexOf('state.originalChecked = current.checked');
  const writeIndex = hideBody.indexOf('writeChartOrdersRecoveryRecord()');
  const toggleIndex = hideBody.indexOf('toggleBinanceChartOrdersWithCoalescedSave(');
  assert.ok(
    stateIndex !== -1
      && writeIndex !== -1
      && toggleIndex !== -1
      && stateIndex < writeIndex
      && writeIndex < toggleIndex,
  );

  const recoverBody = readFunctionBody('recoverChartOrdersStateAfterReload');
  assert.match(recoverBody, /recovery\.status === 'invalid'/);
  assert.doesNotMatch(recoverBody, /expired/);
  assert.match(recoverBody, /clearChartOrdersRecoveryRecord\(\)/);
  assert.match(recoverBody, /findBinanceChartOrdersTargetDom\(document\)/);
  assert.match(recoverBody, /originalChecked: recovery\.record\.originalChecked/);
  assert.match(recoverBody, /restoreBinanceChartOrdersAfterBulkCancel\(target/);

  const scheduleBody = readFunctionBody('scheduleChartOrdersRecovery');
  assert.match(scheduleBody, /!chartOrdersRecoveryPendingAtStartup/);
  assert.match(scheduleBody, /cancelCurrentSymbolOpenOrdersTask/);
  assert.match(scheduleBody, /document\.hidden/);
  assert.match(scheduleBody, /recoverChartOrdersStateAfterReload\(\)/);

  const syncRouteBody = readFunctionBody('syncRouteState');
  assert.match(syncRouteBody, /scheduleChartOrdersRecovery\(\)/);
  assert.match(source, /startTradingTimers\(\);\s*scheduleChartOrdersRecovery\(\);/);
});

test('Binance SPA locale changes rebuild only the userscript panel and preserve task state', () => {
  assert.match(source, /let activeUiLocale = resolveUiLocaleFromPathname\(location\.pathname\)/);
  const syncRouteBody = readFunctionBody('syncRouteState');
  assert.match(syncRouteBody, /const nextUiLocale = resolveUiLocaleFromPathname\(location\.pathname\)/);
  assert.match(syncRouteBody, /const uiLocaleChanged = nextUiLocale !== activeUiLocale/);
  assert.match(syncRouteBody, /activeUiLocale = nextUiLocale;\s*removePanel\(\);/);
  assert.match(syncRouteBody, /const needsRender = uiLocaleChanged \|\| !wasTrading/);
  assert.doesNotMatch(syncRouteBody, /abort|stopLadder|clearSymbolOwnedRuntimeState\(.*uiLocale/);

  const statusBody = readFunctionBody('setLadderStatus');
  assert.match(statusBody, /ladderStatusText = localizeKnownUiStatus\(text\)/);
  assert.match(statusBody, /const renderedText = ui\(ladderStatusText\)/);
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

  assert.match(cancelBody, /chartOrdersDefinitivelyCleared = clearResult\.definitivelyCleared === true/);
  assert.match(cancelBody, /chartOrdersDefinitivelyCleared && getOpenOrdersTabCount\(\) === 0/);
  assert.match(cancelBody, /!chartOrdersStillDefinitivelyCleared/);
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
  assert.match(cancelBody, /restoreChartOrdersState = false/);
  assert.match(cancelBody, /dialogDecision\.status === 'aborted'[\s\S]*status: 'aborted'/);
  assert.doesNotMatch(cancelBody, /dialogDecision\.status === 'dialog_not_closed'/);
  assert.match(cancelBody, /finally\s*\{[\s\S]*if \(restoreTemporaryUiState && isCurrentObservedSymbol\(symbol\)\)/);

  const panelBody = readFunctionBody('refreshLadderPanel');
  assert.match(panelBody, /cancelCurrentSymbolOpenOrdersTask/);
  assert.match(panelBody, /resolveCancelSymbolButtonPresentation\(\{/);
  assert.match(panelBody, /noOrdersFeedback: cancelNoOrdersFeedbackActive/);
  assert.match(source, /let activeLadderActionType = null/);
  assert.match(source, /let activeLadderPanelContext = null/);
  assert.match(source, /#\$\{PANEL_ID\} button:disabled/);
  assert.doesNotMatch(source, /data-ladder-preserve-tone|preserveTone/);
  assert.match(panelBody, /controlSections\.actionButtons/);
  assert.doesNotMatch(panelBody, /grid-column:span 2/);
  assert.match(panelBody, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(panelBody, /actionColumnCount/);
  assert.match(panelBody, /data-ladder-cancel-symbol="true"[^`]*>\$\{ui\(PANEL_COPY\.action\.cancel\)\}<\/button>/);
  assert.match(panelBody, /cancelButton\.textContent = cancelLabel/);

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
  assert.match(cancelRunBody, /const message = '撤单已取消';\s*successStatusMessage = message;/);
  assert.doesNotMatch(cancelRunBody, /，已恢复页面状态/);
  assert.match(cancelRunBody, /撤单确认弹窗已打开/);
  assert.match(cancelRunBody, /撤单已确认，等待挂单清空/);
  assert.match(cancelRunBody, /未能恢复隐藏其他合约状态/);
  assert.match(cancelRunBody, /未能恢复图表当前委托显示/);
  const noOrdersReturnIndex = cancelRunBody.indexOf("status: 'no_orders'");
  const blockLadderActionsIndex = cancelRunBody.indexOf('cancelCurrentSymbolOpenOrdersBlocksLadderActions = true');
  assert.notEqual(noOrdersReturnIndex, -1);
  assert.notEqual(blockLadderActionsIndex, -1);
  assert.ok(noOrdersReturnIndex < blockLadderActionsIndex);
  assert.match(cancelRunBody, /cancelCurrentSymbolOpenOrdersBlocksLadderActions = true;[\s\S]*scheduleRenderPanel\(\);/);

  const startBody = readFunctionBody('startLadder');
  assert.match(startBody, /if \(cancelCurrentSymbolOpenOrdersTask\)[\s\S]*localizedActionStatus\(spec\.statusLabel, '尚未开始：撤单处理中'/);
  const actionRowsBody = readFunctionBody('getLadderControlSections');
  assert.match(actionRowsBody, /actionDisabled = ladderRunning[\s\S]*\|\| !!singleOrderTask[\s\S]*\|\| cancelCurrentSymbolOpenOrdersBlocksLadderActions/);
  assert.doesNotMatch(actionRowsBody, /!!cancelCurrentSymbolOpenOrdersTask/);
  assert.match(actionRowsBody, /ladderExecutionButton\('OPEN_LONG',[\s\S]*actionDisabled\)/);
  assert.match(startBody, /activeLadderActionType = actionType/);
  assert.match(startBody, /activeLadderPanelContext = \{[\s\S]*mode: spec\.mode,[\s\S]*symbol: actionSymbol,[\s\S]*precision: readCurrentOrderbookPrecisionValue\(\)/);
  assert.match(startBody, /finally\(\(\) => \{[\s\S]*activeLadderActionType = null/);
  assert.match(startBody, /finally\(\(\) => \{[\s\S]*activeLadderPanelContext = null/);
  assert.match(panelBody, /const mode = activeLadderPanelContext\?\.mode/);
  assert.match(panelBody, /const symbol = activeLadderPanelContext\?\.symbol/);
  assert.match(panelBody, /const precision = activeLadderPanelContext\?\.precision/);
});

test('stable panel refreshes avoid writing unchanged text and state attributes', () => {
  const statusBody = readFunctionBody('setLadderStatus');
  assert.match(statusBody, /statusEl\.textContent !== renderedText/);
  assert.match(statusBody, /statusEl\.title !== renderedTitle/);

  const panelBody = readFunctionBody('refreshLadderPanel');
  assert.doesNotMatch(panelBody, /toggle|expanded/);
  assert.match(panelBody, /status\.textContent !== renderedText/);
  assert.match(panelBody, /rebalanceButton\.hidden/);

  const computedBody = readFunctionBody('refreshComputedInfo');
  assert.match(computedBody, /formulaPrefixEl\.textContent !== formulaPrefixText/);
  assert.match(computedBody, /finalEl\.textContent !== finalText/);
  assert.match(computedBody, /minEl\.textContent !== constraintText/);
  assert.match(computedBody, /calculationEl\.title !== calculationTitle/);
  assert.match(computedBody, /multiplierHintEl\.textContent !== renderedMultiplierHint/);
  assert.match(computedBody, /hintEl\.textContent !== hintText/);
  assert.match(computedBody, /hintEl\.title !== hintTitle/);
  assert.match(computedBody, /decBtn\.disabled !== decrementDisabled/);
  assert.match(computedBody, /sideLongBtn\.getAttribute\('aria-checked'\) !== String\(isActive\)/);
  assert.match(computedBody, /sideLongBtn\.tabIndex !== desiredTabIndex/);
  assert.match(computedBody, /sideShortBtn\.getAttribute\('aria-checked'\) !== String\(isActive\)/);
  assert.match(computedBody, /sideShortBtn\.tabIndex !== desiredTabIndex/);
});

test('orderbook precision recommendation marks one shortcut without applying it automatically', () => {
  assert.match(source, /ORDERBOOK_PRECISION_INITIAL_TRADE_LIMIT = 10/);
  assert.match(source, /ORDERBOOK_PRECISION_TRADE_EXPANSION_STEP = 10/);
  assert.match(source, /ORDERBOOK_PRECISION_MIN_EFFECTIVE_MOVES = 5/);
  assert.doesNotMatch(source, /ORDERBOOK_PRECISION_MANUAL_SAMPLE_DURATION_MS/);
  assert.doesNotMatch(source, /ORDERBOOK_PRECISION_SAMPLE_POLL_MS/);
  assert.doesNotMatch(source, /ORDERBOOK_PRECISION_SAMPLE_DURATION_MS/);
  assert.doesNotMatch(source, /ORDERBOOK_PRECISION_SAMPLE_PAUSE_MS/);
  assert.match(source, /LOCAL_ORDERBOOK_PRECISION_SAMPLES_PREFIX = 'jh_binance_orderbook_precision_samples_v3'/);
  assert.match(source, /ORDERBOOK_PRECISION_SHORTCUT_LIMIT = 4/);
  assert.doesNotMatch(source, /data-orderbook-precision-apply/);
  assert.match(source, /data-orderbook-precision-value/);
  assert.doesNotMatch(source, /data-orderbook-precision-adjust/);
  assert.match(source, /data-orderbook-precision-refresh/);
  assert.doesNotMatch(source, /orderbookPrecisionPendingRequest/);
  assert.doesNotMatch(source, /orderbookPrecisionSampleTimer/);
  assert.doesNotMatch(source, /mergePrecisionSamples/);
  assert.match(source, /orderbookPrecisionOptionsLoadAttemptedSymbol/);

  const sampleBody = readFunctionBody('refreshOrderbookPrecisionSamplesNow');
  assert.match(sampleBody, /recommendOrderbookPrecisionWithExpandingWindow\(\{/);
  assert.match(sampleBody, /prices: getLatestTradePrices\(\)/);
  assert.match(sampleBody, /options: ORDERBOOK_PRECISION_CANDIDATE_OPTIONS/);
  assert.match(sampleBody, /initialLimit: ORDERBOOK_PRECISION_INITIAL_TRADE_LIMIT/);
  assert.match(sampleBody, /expansionStep: ORDERBOOK_PRECISION_TRADE_EXPANSION_STEP/);
  assert.match(sampleBody, /minSamples: ORDERBOOK_PRECISION_MIN_EFFECTIVE_MOVES/);
  assert.match(sampleBody, /saveStoredOrderbookPrecisionSamples/);
  assert.match(sampleBody, /samples: latestSamples,[\s\S]*recommendation,/);
  assert.match(sampleBody, /status: recommendation \? 'ready' : PANEL_COPY\.status\.precisionInsufficient/);
  assert.doesNotMatch(sampleBody, /setLadderStatus/);
  assert.doesNotMatch(sampleBody, /setTimeout|setInterval|await delay/);
  assert.doesNotMatch(sampleBody, /getCurrentOrderbookDisplayStep|fallbackMovement/);

  const refreshBody = readFunctionBody('refreshOrderbookPrecisionRecommendation');
  const refreshButtonBody = readFunctionBody('renderOrderbookPrecisionRefreshButton');
  const refreshFeedbackBody = readFunctionBody('showOrderbookPrecisionRefreshFeedback');
  assert.match(refreshBody, /recommendOrderbookPrecision/);
  assert.doesNotMatch(refreshBody, /resolveOrderbookPrecisionSampleState|orderbookPrecisionSampleTimer/);
  assert.match(refreshButtonBody, /data-orderbook-precision-refresh="true"[\s\S]*disabled/);
  assert.match(refreshButtonBody, /data-orderbook-precision-refresh-state="\$\{feedbackState\}"/);
  assert.match(refreshButtonBody, /PANEL_COPY\.status\.precisionUpdated/);
  assert.match(refreshButtonBody, /PANEL_COPY\.status\.precisionInsufficient/);
  assert.match(refreshFeedbackBody, /ORDERBOOK_PRECISION_REFRESH_FEEDBACK_MS/);
  assert.match(sampleBody, /showOrderbookPrecisionRefreshFeedback\(symbol, recommendation \? 'success' : 'retry'\)/);
  assert.match(refreshBody, /const controlsBusy = selectionBusy/);
  assert.match(refreshBody, /getOrderbookPrecisionShortcutOptions\([\s\S]*ORDERBOOK_PRECISION_SHORTCUT_LIMIT/);
  assert.match(refreshBody, /queueOrderbookPrecisionOptionsLoad\(symbol\)/);
  assert.match(refreshButtonBody, /formatPrecisionRefreshTooltip\(ORDERBOOK_PRECISION_INITIAL_TRADE_LIMIT\)/);
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
  assert.doesNotMatch(refreshBody, /buttonBaseStyle|precisionMessage|更新推荐/);
  assert.match(refreshBody, /margin-top:10px;/);
  assert.match(refreshBody, /PANEL_COPY\.field\.pricePrecision/);
  assert.match(refreshBody, /PANEL_COPY\.tooltip\.pricePrecision/);
  assert.match(refreshBody, /renderOrderbookPrecisionShortcutSlots\(shortcutOptions, current, recommendation, controlsBusy\)/);
  assert.match(refreshBody, /activeUiLocale === 'en' \? '52px' : '36px'/);
  assert.match(refreshBody, /repeat\(4,minmax\(0,1fr\)\) 32px/);
  assert.match(refreshBody, /renderOrderbookPrecisionRefreshButton\(symbol, !canRefresh\)/);
  assert.match(refreshButtonBody, /data-orderbook-precision-refresh="true"[^`]*\$\{feedback\.icon\}/);
  assert.doesNotMatch(refreshBody, /data-orderbook-precision-status/);

  assert.equal((source.match(/PANEL_COPY\.field\.interval, PANEL_COPY\.tooltip\.interval, LADDER_STEP_OPTIONS/g) || []).length, 2);
  assert.doesNotMatch(source, /data-ladder-step-action|function ladderStepRow/);
  assert.doesNotMatch(source, /function formatOrderbookPrecisionBusyStatus/);
  assert.doesNotMatch(source, /function startInitialOrderbookPrecisionSample/);

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
  assert.doesNotMatch(source, /startInitialOrderbookPrecisionSample|orderbookPrecisionInitialSampledSymbols/);

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

  const ladderRowsBody = readFunctionBody('getLadderControlSections');
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
  assert.match(startBody, /setStartStatus\(\s*localizedActionStatus\(spec\.statusLabel, '尚未开始：仓位确认中'/);

  assert.match(source, /if \(getActiveTradeMode\(\) === 'CLOSE' && !isCloseSnapshotReady\(clickedSymbol\)\) \{\s*warn\('仓位确认中'\);\s*setLadderStatus\('单击下单未执行：仓位确认中'\);\s*return;/);
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
  assert.match(accountWaitBody, /waitForAccountOrdersMutationState\(\s*observationRoot,\s*readState,\s*timeoutMs,\s*abortSignal/);

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
  assert.match(refreshBody, /finalText = ui\(PANEL_COPY\.state\.waitingPricePrecision\)/);
  assert.match(refreshBody, /finalText = ui\(PANEL_COPY\.state\.waitingTradeMode\)/);
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
  assert.match(buildBody, /createContinuousRecoverableLadderError\(\s*'market_data_not_ready',\s*'未识别价格精度'/);
  assert.match(buildBody, /precision: startPrecision/);
  assert.match(buildBody, /const optionContext = readLadderOptionContext\(spec,\s*startSymbol,\s*startPrecision\)/);
  assert.match(buildBody, /areLadderOptionContextsEqual\(/);

  const contextBody = readFunctionBody('assertLadderExecutionContext');
  assert.match(contextBody, /readCurrentOrderbookPrecisionValue\(\) !== plan\.precision/);
  assert.match(contextBody, /createContinuousRecoverableLadderError\(\s*'precision_changed'/);
  assert.match(contextBody, /hasLadderOptionContextChanged\(plan\)/);
  assert.match(contextBody, /createContinuousRecoverableLadderError\(\s*'options_changed'/);

  const replacementBody = readFunctionBody('createLadderExpectedContext');
  assert.match(replacementBody, /symbol: plan\.symbol/);
  assert.match(replacementBody, /mode: plan\.spec\.mode/);
  assert.match(replacementBody, /precision: plan\.precision/);
});

test('continuous close ladders recover only from tagged pre-submit transients', () => {
  const syncBody = readFunctionBody('syncTradeInputs');
  const priceAssertionBody = readFunctionBody('assertSubmittedPriceMatchesExpectedPrice');
  const quantityAssertionBody = readFunctionBody('assertSubmittedQtyMatchesExpectedQty');
  const buttonBody = readFunctionBody('waitForReadyLadderSubmitButton');
  const executeBody = readFunctionBody('executeLadderPlan');
  const buildBody = readFunctionBody('buildLadderPlan');
  const makerBody = readFunctionBody('assertLadderMakerPrice');
  const repriceBody = readFunctionBody('refreshRemainingLadderOrders');
  const recoveryBody = readFunctionBody('createContinuousRecoverableLadderError');

  assert.match(syncBody, /createContinuousRecoverableLadderError\(\s*'input_unstable'/);
  assert.match(priceAssertionBody, /createContinuousRecoverableLadderError\(\s*'input_unstable'/);
  assert.match(quantityAssertionBody, /createContinuousRecoverableLadderError\(\s*'input_unstable'/);
  assert.match(buttonBody, /createContinuousRecoverableLadderError\(\s*'controls_not_ready'/);
  assert.match(executeBody, /createContinuousRecoverableLadderError\(\s*'controls_not_ready'/);
  assert.match(buildBody, /createContinuousRecoverableLadderError\(\s*'market_data_not_ready'/);
  assert.match(makerBody, /createContinuousRecoverableLadderError\(\s*'market_data_not_ready'/);
  assert.match(repriceBody, /createContinuousRecoverableLadderError\(\s*'market_data_not_ready'/);
  assert.match(recoveryBody, /error\.safeNoSubmit = true/);
  assert.match(recoveryBody, /error\.continuousRecoveryKind = kind/);
});

test('continuous close ladders continue after an explicitly tagged unconfirmed submission', () => {
  const acknowledgementBody = readFunctionBody('waitForOrderSubmitAcknowledgement');
  const recoveryBody = readFunctionBody('createContinuousUnconfirmedSubmitError');
  const generatedRecoveryBody = readFunctionBody(
    'createContinuousUnconfirmedSubmitError',
    generatedSource,
  );
  const panelCopyImport = source.match(
    /import \{([^}]*)\} from '\.\/contracts\/panel-copy\.js';/,
  );

  assert.notEqual(panelCopyImport, null);
  assert.match(panelCopyImport[1], /\bisLocalizedText\b/);
  assert.match(acknowledgementBody, /createContinuousUnconfirmedSubmitError\(/);
  assert.doesNotMatch(acknowledgementBody, /未确认\$\{label\}成功[\s\S]*已停止/);
  assert.match(recoveryBody, /if \(!isLocalizedText\(message\)\)/);
  assert.match(recoveryBody, /error\.continuousRecoveryKind = 'submit_unconfirmed'/);
  assert.doesNotMatch(recoveryBody, /error\.safeNoSubmit = true/);

  const generatedGuard = generatedRecoveryBody.match(
    /if \(!([A-Za-z_$][\w$]*)\(message\)\)/,
  );
  assert.notEqual(generatedGuard, null);
  assert.match(
    generatedSource,
    new RegExp(`(?:function|var|let|const)\\s+${generatedGuard[1]}\\b`),
  );
});

test('continuous close defers temporary startup, position, capacity, and open-order failures', () => {
  const continuousBody = readFunctionBody('startContinuousLadder');
  const planBody = readFunctionBody('buildLadderPlan');
  const minimumBody = readFunctionBody('createLadderMinimumQtyFailure');
  const executeBody = readFunctionBody('executeLadderPlan');
  const replacementBody = readFunctionBody('runLadderPlanWithOpenOrderReplacement');
  const readinessBody = readFunctionBody('readContinuousLadderReadiness');
  const confirmationBody = readFunctionBody('throwIfClosePositionCompleted');
  const roundRecoveryBody = readFunctionBody('createContinuousRoundRecoveryError');

  assert.match(continuousBody, /outcome\.status !== 'not_started'/);
  assert.match(continuousBody, /waitForContinuousLadderNextRound/);
  assert.match(planBody, /createContinuousRecoverableLadderError\(\s*'position_quantity_not_ready'/);
  assert.match(minimumBody, /mode === 'CLOSE'[\s\S]*continuousRecoveryKind = 'position_quantity_not_ready'/);
  assert.match(executeBody, /createContinuousRoundRecoveryError\(\s*'order_capacity_not_ready'/);
  assert.match(replacementBody, /createContinuousRoundRecoveryError\(\s*'open_orders_not_ready'/);
  assert.match(readinessBody, /resolveContinuousLadderRecovery\(error\)/);
  assert.match(confirmationBody, /createContinuousRecoverableLadderError\(\s*'position_state_not_ready'/);
  assert.match(confirmationBody, /skipImmediateCloseRecheck = true/);
  assert.match(roundRecoveryBody, /removeContinuousTerminalWording\(message\)/);
});

test('continuous close backs off rate limits and unconfirmed server responses without swallowing fatal rejections', () => {
  const acknowledgementBody = readFunctionBody('waitForOrderSubmitAcknowledgement');
  const positionFetchBody = readFunctionBody('fetchCurrentPositionsPayload');

  assert.match(acknowledgementBody, /resolveBinanceSubmitResponseRecovery/);
  assert.match(acknowledgementBody, /createContinuousRoundRecoveryError\(/);
  assert.match(positionFetchBody, /error\.httpStatus = resp\.status/);
  assert.match(source, /\[401,\s*403\]\.includes\(error\?\.httpStatus\)/);
});

test('confirmed directional flat state ends close ladders without masking uncertain outcomes', () => {
  const startBody = readFunctionBody('startLadder');
  const planBody = readFunctionBody('buildLadderPlan');
  const replacementBody = readFunctionBody('runLadderPlanWithOpenOrderReplacement');
  const readinessBody = readFunctionBody('readContinuousLadderReadiness');
  const confirmationBody = readFunctionBody('throwIfClosePositionCompleted');

  assert.match(confirmationBody, /fetchCurrentSymbolPositionSideState/);
  assert.match(confirmationBody, /state\.status === 'flat'/);
  assert.match(confirmationBody, /throw createClosePositionCompletedError\(\)/);
  assert.match(planBody, /await throwIfClosePositionCompleted\(\{ spec, symbol: startSymbol \}\)/);
  assert.match(startBody, /spec\.mode === 'CLOSE'[\s\S]*e\?\.safeNoSubmit === true[\s\S]*e\.skipImmediateCloseRecheck !== true/);
  assert.match(startBody, /status: 'position_closed'/);
  assert.doesNotMatch(startBody, /未确认.*throwIfClosePositionCompleted/);
  assert.match(replacementBody, /!\['symbol_changed', 'dialog_not_closed'\]\.includes\(result\.status\)/);
  assert.match(replacementBody, /await throwIfClosePositionCompleted\(replacementPlan, abortSignal\)/);
  assert.match(readinessBody, /CONTINUOUS_CLOSE_POSITION_CHECK_MS/);
});

test('single-order sizing and submission retain the captured orderbook precision', () => {
  const resolveBody = readFunctionBody('resolveTargetQty');
  assert.match(resolveBody, /const precision = readCurrentOrderbookPrecisionValue\(\)/);
  assert.match(resolveBody, /if \(!precision\) throw new Error\('未识别价格精度'\)/);
  assert.match(resolveBody, /loadMultiplier\(tradeMode, symbol, precision\)/);
  assert.match(resolveBody, /precision,/);
  assert.match(source, /readCurrentOrderbookPrecisionValue\(\) !== qtyPlan\.precision/);
  assert.match(source, /const submitCaptureId = beginLadderSubmitResponseCapture\(\)/);
  assert.match(source, /await waitForOrderSubmitAcknowledgement\([\s\S]*submitCaptureId,[\s\S]*action\.mode/);
  assert.match(source, /setLadderStatus\(`单击\$\{action\.side\}已提交 · \$\{clickedPrice\} × \$\{qtyPlan\.qty\}`\)/);
  assert.match(source, /singleOrderTask = null;[\s\S]*scheduleRenderPanel\(\)/);
});

test('precision shortcut selection and refresh do not commit after a symbol switch', () => {
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

  assert.doesNotMatch(source, /runOrderbookPrecisionSampleRound|scheduleOrderbookPrecisionSampleRound/);
  assert.doesNotMatch(source, /orderbookPrecisionInitialSampledSymbols|startInitialOrderbookPrecisionSample/);

  const clearBody = readFunctionBody('clearSymbolOwnedRuntimeState');
  assert.match(clearBody, /orderbookPrecisionOptionsLoadRequestedSymbol = null/);
  assert.match(clearBody, /status: recommendation \? 'ready' : PANEL_COPY\.status\.precisionInsufficient/);
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
  const fetchPayloadBody = readFunctionBody('fetchCurrentPositionsPayload');
  const fetchBody = readFunctionBody('fetchCurrentSymbolPositionState');
  assert.match(fetchBody, /resolveSymbolPositionStatus\(payload, symbol\)/);
  assert.match(fetchBody, /await fetchCurrentPositionsPayload\(\)/);
  assert.match(fetchPayloadBody, /body: JSON\.stringify\(\{\}\)/);

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
  assert.match(observationBody, /positionChanged = positionCount !== lastObservedAccountPositionCount/);
  assert.match(observationBody, /openOrdersChanged = openOrdersCount !== lastObservedAccountOpenOrdersCount/);
  assert.match(observationBody, /queueAutoOpenLeveragePositionCheck\(triggerSource\)/);
  assert.match(observationBody, /updateUsdtRebalanceEligibilityFromAccountCounts\(positionCount, openOrdersCount\)/);

  const checkBody = readFunctionBody('runAutoOpenLeveragePositionCheck');
  assert.match(checkBody, /await fetchCurrentSymbolPositionState\(symbol\)/);
  assert.match(checkBody, /observeAutoOpenLeveragePositionState/);
  assert.match(checkBody, /observation\.shouldReset \|\| resetIfFlat/);
});

test('USDT rebalance waits for global flat stability and requires zero open orders', () => {
  assert.match(source, /const USDT_REBALANCE_FLAT_STABLE_MS = 3000;/);
  const eligibilityBody = readFunctionBody('confirmUsdtRebalanceEligibility');
  assert.match(eligibilityBody, /readAccountPositionCount\(\) !== 0/);
  assert.match(eligibilityBody, /getOpenOrdersTabCount\(\) !== 0/);
  assert.match(eligibilityBody, /resolveAllFuturesPositionStatus\(await fetchCurrentPositionsPayload\(\)\)/);
  assert.match(eligibilityBody, /positionState\.status !== 'flat'/);
  assert.match(eligibilityBody, /usdtRebalanceEligible = true/);
});

test('USDT rebalance uses direct Binance BAPI only after one explicit plan confirmation', () => {
  assert.match(source, /BINANCE_WALLET_BALANCE_BAPI_PATH = '\/bapi\/asset\/v2\/private\/asset-service\/wallet\/balance\?needBalanceDetail=true&quoteAsset=USDT'/);
  assert.match(source, /BINANCE_FUTURES_MAX_WITHDRAW_BAPI_PATH = '\/bapi\/futures\/v1\/private\/future\/user-data\/getMaxWithdrawAmount'/);
  assert.match(source, /BINANCE_WALLET_TRANSFER_BAPI_PATH = '\/bapi\/asset\/v1\/private\/asset-service\/wallet\/transfer'/);
  const readBalancesBody = readFunctionBody('readCurrentUsdtRebalanceBalances');
  assert.match(readBalancesBody, /body: \{ assetName: 'USDT' \}/);
  assert.match(readBalancesBody, /withFuturesTransferableBalance/);
  const runBody = readFunctionBody('runUsdtRebalance');
  assert.match(runBody, /await showUsdtRebalanceDialog\(document, buildUsdtRebalanceDialogModel\(plan\)\)/);
  assert.doesNotMatch(source, /window\.confirm\(/);
  assert.match(runBody, /await assertUsdtRebalanceTradingState\(\)/);
  assert.match(runBody, /areUsdtBalancesEqual\(currentBalances, expectedBalances\)/);
  assert.match(runBody, /await submitUsdtRebalanceTransfer\(transfer\)/);
  assert.match(runBody, /applyUsdtTransferToBalances\(expectedBalances, transfer\)/);
  const submitBody = readFunctionBody('submitUsdtRebalanceTransfer');
  assert.match(submitBody, /asset: 'USDT'/);
  assert.match(submitBody, /amount: transfer\.amount/);
  assert.match(submitBody, /kindType: transfer\.kindType/);
  assert.match(submitBody, /payload\?\.success !== true/);
  assert.doesNotMatch(source, /orderform-transfer-button/);
});
