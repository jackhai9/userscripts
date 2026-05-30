// ==UserScript==
// @name         【自写】Binance 订单簿单击下单
// @namespace    binance.orderbook.trade
// @icon         https://avatars.githubusercontent.com/u/5935568?s=128
// @version      2.7.5
// @author       jackhai9
// @description  单击订单簿价格，按当前开仓/平仓 tab 自动填数量并执行下单，内置数量倍率面板
// @match        https://www.binance.com/*/futures/*
// @match        https://www.binance.com/futures/*
// @updateURL    https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-orderbook-trade.user.js
// @downloadURL  https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-orderbook-trade.user.js
// @run-at       document-start
// @grant        none
// ==/UserScript==
(() => {
  // src/binance-orderbook-trade/core/cancel-orders.js
  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }
  function isOpenOrdersTabText(text) {
    const normalized = normalizeText(text);
    return /^当前\s*委托(?:\(|\s|$)/.test(normalized) || /^Open Orders(?:\(|\s|$)/i.test(normalized);
  }
  function parseOpenOrdersTabCount(text) {
    const normalized = normalizeText(text);
    const match = /(?:当前\s*委托|Open Orders)\s*\(?\s*(\d+)\s*\)?/i.exec(normalized);
    return match ? Number(match[1]) : null;
  }
  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function normalizeContractCandidate(candidate, separator) {
    const normalized = String(candidate || "").toUpperCase();
    if (separator === ":") {
      const timeJoinedMatch = /^\d{1,2}([A-Z][A-Z0-9]*USDT)$/.exec(normalized);
      if (timeJoinedMatch) return timeJoinedMatch[1];
    }
    return normalized;
  }
  function isTimestampJoinedCandidate(candidate, symbol) {
    const normalizedCandidate = String(candidate || "").toUpperCase();
    const normalizedSymbol = String(symbol || "").toUpperCase();
    if (!normalizedCandidate || !normalizedSymbol || !normalizedCandidate.endsWith(normalizedSymbol)) {
      return false;
    }
    const prefix = normalizedCandidate.slice(0, -normalizedSymbol.length);
    return /^\d{1,2}$/.test(prefix);
  }
  function hasVisibleContractText(text, symbol) {
    const normalizedSymbol = String(symbol || "").toUpperCase();
    if (!normalizedSymbol) return false;
    const symbolPattern = escapeRegExp(normalizedSymbol);
    return new RegExp(`(?:^|[^A-Z0-9]|\\d{1,2}:\\d{2})${symbolPattern}\\s*永续`, "i").test(String(text || ""));
  }
  function readVisibleOpenOrderSymbolsText(text) {
    const normalized = String(text || "").toUpperCase();
    const symbols = /* @__PURE__ */ new Set();
    const pattern = /([A-Z0-9]{2,30}USDT)\s*永续/g;
    let match = pattern.exec(normalized);
    while (match) {
      const separator = normalized[match.index - 1] || "";
      if (!/[A-Z0-9]/.test(separator)) {
        symbols.add(normalizeContractCandidate(match[1], separator));
      }
      match = pattern.exec(normalized);
    }
    return Array.from(symbols);
  }
  function isOpenOrdersScopeLimitedToSymbolText(text, symbol) {
    const normalizedSymbol = String(symbol || "").toUpperCase();
    if (!normalizedSymbol) return false;
    const visibleSymbols = readVisibleOpenOrderSymbolsText(text);
    return visibleSymbols.length > 0 && visibleSymbols.every((visibleSymbol) => visibleSymbol === normalizedSymbol || hasVisibleContractText(text, normalizedSymbol) && isTimestampJoinedCandidate(visibleSymbol, normalizedSymbol));
  }
  function hasCurrentSymbolOpenOrdersEvidence({
    scopeText,
    symbol,
    symbolFilterOk,
    openOrdersCount,
    cancelAllAvailable
  }) {
    const normalizedSymbol = String(symbol || "").toUpperCase();
    if (!normalizedSymbol) return false;
    const visibleSymbols = readVisibleOpenOrderSymbolsText(scopeText);
    if (visibleSymbols.some((visibleSymbol) => visibleSymbol === normalizedSymbol || hasVisibleContractText(scopeText, normalizedSymbol) && isTimestampJoinedCandidate(visibleSymbol, normalizedSymbol))) return true;
    if (visibleSymbols.length > 0) return false;
    return Boolean(symbolFilterOk && (openOrdersCount !== null && openOrdersCount > 0 || cancelAllAvailable));
  }

  // src/binance-orderbook-trade/core/decimal.js
  function pow10(exp) {
    let result = 1n;
    for (let i = 0; i < exp; i += 1) result *= 10n;
    return result;
  }
  function parseDecimalString(value) {
    const raw = String(value || "").replace(/,/g, "").trim();
    if (!/^\d+(\.\d+)?$/.test(raw)) return null;
    const [intPart, fracPart = ""] = raw.split(".");
    return {
      digits: BigInt(intPart + fracPart),
      scale: fracPart.length
    };
  }
  function formatDecimalParts(digits, scale) {
    const negative = digits < 0n;
    const absDigits = negative ? -digits : digits;
    const raw = absDigits.toString();
    if (scale === 0) return `${negative ? "-" : ""}${raw}`;
    const padded = raw.padStart(scale + 1, "0");
    const head = padded.slice(0, -scale) || "0";
    const tail = padded.slice(-scale).replace(/0+$/, "");
    return `${negative ? "-" : ""}${tail ? `${head}.${tail}` : head}`;
  }
  function normalizeDecimalString(value) {
    const parsed = parseDecimalString(value);
    return parsed ? formatDecimalParts(parsed.digits, parsed.scale) : null;
  }
  function compareDecimalStrings(a, b) {
    const left = parseDecimalString(a);
    const right = parseDecimalString(b);
    if (!left || !right) return null;
    const scale = Math.max(left.scale, right.scale);
    const leftDigits = left.digits * pow10(scale - left.scale);
    const rightDigits = right.digits * pow10(scale - right.scale);
    if (leftDigits === rightDigits) return 0;
    return leftDigits > rightDigits ? 1 : -1;
  }
  function addDecimalStrings(a, b) {
    const left = parseDecimalString(a);
    const right = parseDecimalString(b);
    if (!left || !right) return null;
    const scale = Math.max(left.scale, right.scale);
    const leftDigits = left.digits * pow10(scale - left.scale);
    const rightDigits = right.digits * pow10(scale - right.scale);
    return formatDecimalParts(leftDigits + rightDigits, scale);
  }
  function subtractDecimalStrings(a, b) {
    const left = parseDecimalString(a);
    const right = parseDecimalString(b);
    if (!left || !right) return null;
    const scale = Math.max(left.scale, right.scale);
    const leftDigits = left.digits * pow10(scale - left.scale);
    const rightDigits = right.digits * pow10(scale - right.scale);
    if (leftDigits < rightDigits) return null;
    return formatDecimalParts(leftDigits - rightDigits, scale);
  }
  function maxDecimalString(a, b) {
    if (!a) return normalizeDecimalString(b);
    if (!b) return normalizeDecimalString(a);
    const cmp = compareDecimalStrings(a, b);
    if (cmp == null) return normalizeDecimalString(a) || normalizeDecimalString(b);
    return cmp >= 0 ? normalizeDecimalString(a) : normalizeDecimalString(b);
  }
  function ceilQtyByNotional(notional, price, stepSize) {
    const n = parseDecimalString(notional);
    const p = parseDecimalString(price);
    const s = parseDecimalString(stepSize);
    if (!n || !p || !s || p.digits <= 0n || s.digits <= 0n) return null;
    let numerator = n.digits;
    let denominator = p.digits * s.digits;
    const exp = p.scale + s.scale - n.scale;
    if (exp >= 0) {
      numerator *= pow10(exp);
    } else {
      denominator *= pow10(-exp);
    }
    const steps = (numerator + denominator - 1n) / denominator;
    return formatDecimalParts(steps * s.digits, s.scale);
  }
  function multiplyDecimalByInt(decimalValue, intValue) {
    const raw = String(decimalValue || "").trim();
    const multiplier = String(intValue || "").trim();
    if (!/^\d+(\.\d+)?$/.test(raw)) return null;
    if (!/^\d+$/.test(multiplier) || Number(multiplier) <= 0) return null;
    const parts = raw.split(".");
    const intPart = parts[0];
    const fracPart = parts[1] || "";
    const scale = fracPart.length;
    const base = BigInt(intPart + fracPart);
    const multi = BigInt(multiplier);
    const product = (base * multi).toString();
    if (scale === 0) return product;
    const padded = product.padStart(scale + 1, "0");
    const head = padded.slice(0, -scale) || "0";
    const tail = padded.slice(-scale).replace(/0+$/, "");
    return tail ? `${head}.${tail}` : head;
  }
  function multiplyDecimalByRatio(decimalValue, numerator, denominator) {
    const parsed = parseDecimalString(decimalValue);
    const num = BigInt(Number(numerator));
    const den = BigInt(Number(denominator));
    if (!parsed || num <= 0n || den <= 0n) return null;
    const digits = parsed.digits * num / den;
    return formatDecimalParts(digits, parsed.scale);
  }
  function isPositiveDecimalString(value) {
    const parsed = parseDecimalString(value);
    return !!parsed && parsed.digits > 0n;
  }

  // src/binance-orderbook-trade/core/quantity.js
  function pow102(exp) {
    let result = 1n;
    for (let i = 0; i < exp; i += 1) result *= 10n;
    return result;
  }
  function decimalToStepCount(decimalValue, stepSize, rounding = "floor") {
    const value = parseDecimalString(decimalValue);
    const step = parseDecimalString(stepSize);
    if (!value || !step || step.digits <= 0n) return null;
    const scale = Math.max(value.scale, step.scale);
    const valueDigits = value.digits * pow102(scale - value.scale);
    const stepDigits = step.digits * pow102(scale - step.scale);
    if (rounding === "ceil") return (valueDigits + stepDigits - 1n) / stepDigits;
    return valueDigits / stepDigits;
  }
  function formatStepCount(stepCount, stepSize) {
    const step = parseDecimalString(stepSize);
    if (!step || step.digits <= 0n || stepCount == null || stepCount < 0n) return null;
    return formatDecimalParts(stepCount * step.digits, step.scale);
  }
  function allocateLadderQuantities(totalQty, desiredLevels, stepSize, minRequiredQty) {
    const totalSteps = decimalToStepCount(totalQty, stepSize, "floor");
    const minSteps = decimalToStepCount(minRequiredQty, stepSize, "ceil");
    const requestedLevels = Number(desiredLevels);
    if (!totalSteps || !minSteps || totalSteps <= 0n || minSteps <= 0n || requestedLevels <= 0) {
      return null;
    }
    const maxExecutableLevels = totalSteps / minSteps;
    const actualLevels = Math.min(requestedLevels, Number(maxExecutableLevels));
    if (actualLevels < 1) return null;
    const levelCount = BigInt(actualLevels);
    const baseSteps = totalSteps / levelCount;
    if (baseSteps < minSteps) return null;
    const quantities = [];
    let remainingSteps = totalSteps;
    for (let i = 0; i < actualLevels; i += 1) {
      const isLast = i === actualLevels - 1;
      const steps = isLast ? remainingSteps : baseSteps;
      if (steps < minSteps) {
        if (quantities.length === 0) return null;
        const previous = decimalToStepCount(quantities.pop(), stepSize, "floor");
        const merged = previous + steps;
        if (merged < minSteps) return null;
        quantities.push(formatStepCount(merged, stepSize));
        remainingSteps = 0n;
        break;
      }
      quantities.push(formatStepCount(steps, stepSize));
      remainingSteps -= steps;
    }
    return {
      requestedLevels,
      actualLevels: quantities.length,
      totalQty: formatStepCount(totalSteps, stepSize),
      quantities
    };
  }

  // src/binance-orderbook-trade/core/ladder-plan.js
  var LADDER_ACTION_SPECS = {
    OPEN_LONG: {
      mode: "OPEN",
      label: "阶梯开多",
      priceSide: "BID",
      orderSide: "BUY",
      side: "LONG"
    },
    OPEN_SHORT: {
      mode: "OPEN",
      label: "阶梯开空",
      priceSide: "ASK",
      orderSide: "SELL",
      side: "SHORT"
    },
    CLOSE_LONG: {
      mode: "CLOSE",
      label: "阶梯平多",
      priceSide: "ASK",
      orderSide: "SELL",
      side: "LONG"
    },
    CLOSE_SHORT: {
      mode: "CLOSE",
      label: "阶梯平空",
      priceSide: "BID",
      orderSide: "BUY",
      side: "SHORT"
    }
  };
  function getLadderActionSpec(actionType) {
    const spec = LADDER_ACTION_SPECS[actionType];
    return spec ? { ...spec } : null;
  }
  function getLadderPercentForMode(mode, openPercent, closePercent) {
    if (mode === "OPEN") return openPercent;
    if (mode === "CLOSE") return closePercent;
    return null;
  }

  // src/binance-orderbook-trade/dom/account-orders.js
  function getNormalizedText(el) {
    return normalizeText(el?.textContent || "");
  }
  function hasAccountOrdersTabs(node, isVisibleElement) {
    const tabTexts = Array.from(node.querySelectorAll('[role="tab"]')).filter(isVisibleElement).map(getNormalizedText).join(" ");
    return /(仓位|Positions)/i.test(tabTexts) && /(当前\s*委托|Open Orders)/i.test(tabTexts) && /(历史委托|Order History|历史成交|Trade History|资金流水|Transaction)/i.test(tabTexts);
  }
  function containsNestedAccountOrdersGroupOutsideTab(node, tab, isVisibleElement) {
    return Array.from(node.children).some((child) => !child.contains(tab) && hasAccountOrdersTabs(child, isVisibleElement));
  }
  function hasOpenOrdersPanelText(node) {
    return /(基础单|条件委托|Open Orders|成交数量|只减仓|只做Maker|生效时间|追单)/i.test(getNormalizedText(node));
  }
  function hasOpenOrdersPanelEvidence(node, {
    findHideOtherSymbolCheckbox,
    findCurrentSymbolCancelAllButton
  }) {
    if (findCurrentSymbolCancelAllButton(node)) return true;
    return Boolean(findHideOtherSymbolCheckbox(node) && hasOpenOrdersPanelText(node));
  }
  function isAccountOrdersTab(tab, { isVisibleElement }) {
    let node = tab.parentElement;
    let depth = 0;
    while (node && node !== tab.ownerDocument.body && depth < 5) {
      if (hasAccountOrdersTabs(node, isVisibleElement) && !containsNestedAccountOrdersGroupOutsideTab(node, tab, isVisibleElement)) {
        return true;
      }
      node = node.parentElement;
      depth += 1;
    }
    return false;
  }
  function getAccountOrdersTabGroup(tab, { isVisibleElement }) {
    let node = tab?.parentElement;
    let depth = 0;
    while (node && node !== tab.ownerDocument.body && depth < 5) {
      if (hasAccountOrdersTabs(node, isVisibleElement) && !containsNestedAccountOrdersGroupOutsideTab(node, tab, isVisibleElement)) {
        return node;
      }
      node = node.parentElement;
      depth += 1;
    }
    return null;
  }
  function findOpenOrdersTab(root, { isVisibleElement }) {
    const tabs = Array.from(root.querySelectorAll('[role="tab"]')).filter((tab) => isVisibleElement(tab) && isOpenOrdersTabText(getNormalizedText(tab)));
    return tabs.find((tab) => isAccountOrdersTab(tab, { isVisibleElement })) || tabs[0] || null;
  }
  function findSelectedAccountOrdersTab(root, { isVisibleElement }) {
    const openOrdersTab = findOpenOrdersTab(root, { isVisibleElement });
    if (!openOrdersTab) return null;
    const tabGroup = getAccountOrdersTabGroup(openOrdersTab, { isVisibleElement });
    if (!tabGroup) return null;
    return Array.from(tabGroup.querySelectorAll('[role="tab"][aria-selected="true"]')).filter(isVisibleElement)[0] || null;
  }
  function getActiveOpenOrdersScope(root, {
    isVisibleElement,
    findHideOtherSymbolCheckbox,
    findCurrentSymbolCancelAllButton
  }) {
    const tab = findOpenOrdersTab(root, { isVisibleElement });
    if (!tab || tab.getAttribute("aria-selected") !== "true") return null;
    const doc = root.ownerDocument || root;
    const paneId = tab.getAttribute("aria-controls");
    const pane = paneId ? doc.getElementById(paneId) : null;
    if (pane && isVisibleElement(pane) && hasOpenOrdersPanelEvidence(pane, {
      findHideOtherSymbolCheckbox,
      findCurrentSymbolCancelAllButton
    })) {
      return pane;
    }
    let node = tab.parentElement;
    let depth = 0;
    while (node && node !== doc.body && depth < 8) {
      if (hasOpenOrdersPanelEvidence(node, {
        findHideOtherSymbolCheckbox,
        findCurrentSymbolCancelAllButton
      })) {
        return node;
      }
      node = node.parentElement;
      depth += 1;
    }
    return null;
  }

  // src/binance-orderbook-trade/dom/trade-form.js
  function buttonTextMatches(button, patterns) {
    const text = (button?.textContent || "").trim().toLowerCase();
    return patterns.some((pattern) => text.includes(pattern));
  }
  function isOwnPanelButton(button, panelId) {
    return !!button?.closest?.(`#${panelId}`);
  }
  function isTradeModeTab(node, { panelId }) {
    if (!node?.matches?.('[role="tab"]')) return false;
    if (node.closest(`#${panelId}`)) return false;
    if (!node.matches('#position-direction [role="tab"], .bn-tabs__buySell [role="tab"], [role="tab"].bn-tab__buySell')) {
      return false;
    }
    const text = (node.textContent || "").trim();
    return text.includes("开仓") || text.includes("平仓");
  }
  function isTradeActionButton(node, { panelId }) {
    if (!node?.matches) return false;
    const button = node.matches("button") ? node : node.closest("button");
    if (!button || isOwnPanelButton(button, panelId)) return false;
    return buttonTextMatches(button, [
      "开多",
      "open long",
      "开空",
      "open short",
      "平多",
      "close long",
      "平空",
      "close short"
    ]);
  }
  function collectTradeButtonsFromScopes(scopes, mode, {
    panelId,
    isVisibleElement
  }) {
    const modePatterns = mode === "OPEN" ? ["开多", "open long", "开空", "open short"] : ["平多", "close long", "平空", "close short"];
    const buttons = [];
    const seen = /* @__PURE__ */ new Set();
    const collectFrom = (scope) => {
      if (!scope) return;
      for (const candidate of scope.querySelectorAll("button")) {
        if (seen.has(candidate) || isOwnPanelButton(candidate, panelId) || !isVisibleElement(candidate)) continue;
        seen.add(candidate);
        if (buttonTextMatches(candidate, modePatterns)) buttons.push(candidate);
      }
    };
    for (const scope of scopes) collectFrom(scope);
    return buttons;
  }

  // src/binance-orderbook-trade/core/orderbook.js
  function inferOrderbookDisplayStep(prices) {
    let displayStep = null;
    for (let i = 1; i < prices.length; i += 1) {
      const prev = prices[i - 1];
      const current = prices[i];
      let diff = subtractDecimalStrings(current, prev) || subtractDecimalStrings(prev, current);
      diff = normalizeDecimalString(diff);
      if (!diff || !isPositiveDecimalString(diff)) continue;
      if (!displayStep || compareDecimalStrings(diff, displayStep) < 0) displayStep = diff;
    }
    return displayStep;
  }
  function calculateDisplayStepPrice(bestPrice, displayStep, side, offsetRows) {
    let price = bestPrice;
    for (let i = 0; i < offsetRows; i += 1) {
      price = side === "ASK" ? addDecimalStrings(price, displayStep) : subtractDecimalStrings(price, displayStep);
      if (!price || !isPositiveDecimalString(price)) return null;
    }
    return price;
  }
  function planBufferedMakerPrices({
    prices,
    side,
    levels,
    ladderStep,
    bufferLevels = 1,
    defaultStep = 1,
    minStep = 1,
    maxStep = 5
  }) {
    const step = Math.max(minStep, Math.min(Number(ladderStep) || defaultStep, maxStep));
    const bestPrice = prices[0] || null;
    const displayStep = inferOrderbookDisplayStep(prices);
    const result = [];
    for (let i = 0; i < levels; i += 1) {
      const offsetRows = bufferLevels + i * step;
      const price = prices[offsetRows] || (bestPrice && displayStep ? calculateDisplayStepPrice(bestPrice, displayStep, side, offsetRows) : null);
      if (price) result.push(price);
    }
    return result;
  }

  // src/binance-orderbook-trade/index.user.js
  (function() {
    "use strict";
    const CFG = {
      // true=只填数量；false=填数量并自动点“开多/开空/平多/平空”
      SAFE_MODE: false,
      // Only suppress duplicate dispatch from the same physical click, not deliberate fast clicks.
      COOLDOWN_MS: 150,
      DEBUG: false
    };
    const LOCAL_QTY_MULTIPLIER_PREFIX = "jh_binance_qty_multiplier_v2";
    const LOCAL_CLOSE_SIDE_KEY = "jh_binance_close_side";
    const LOCAL_OPEN_SIDE_KEY = "jh_binance_open_side";
    const LOCAL_LADDER_EXPANDED_KEY = "jh_binance_ladder_expanded";
    const LOCAL_LADDER_OPEN_PERCENT_KEY = "jh_binance_ladder_open_percent";
    const LOCAL_LADDER_CLOSE_PERCENT_KEY = "jh_binance_ladder_close_percent";
    const LOCAL_LADDER_LEVELS_KEY = "jh_binance_ladder_levels";
    const LOCAL_LADDER_STEP_KEY = "jh_binance_ladder_step";
    const BINANCE_PERSIST_KEY = "persist:futures-trade-ui";
    const BINANCE_POST_ONLY_ORDER_TYPE = "POST_ONLY";
    const BINANCE_POST_ONLY_TIME_IN_FORCE = "GTC";
    const PANEL_ID = "jh-binance-close-qty-multiplier-panel";
    const SPACER_ID = "jh-binance-close-qty-multiplier-spacer";
    const INPUT_ID = "jh-binance-close-qty-multiplier-input";
    const DEC_ID = "jh-binance-close-qty-multiplier-dec";
    const INC_ID = "jh-binance-close-qty-multiplier-inc";
    const SIDE_LONG_ID = "jh-binance-close-side-long";
    const SIDE_SHORT_ID = "jh-binance-close-side-short";
    const LADDER_TOGGLE_ID = "jh-binance-ladder-toggle";
    const LADDER_BODY_ID = "jh-binance-ladder-body";
    const LADDER_STATUS_ID = "jh-binance-ladder-status";
    const DEFAULT_MULTIPLIER = "1";
    const DEFAULT_CLOSE_SIDE = "LONG";
    const DEFAULT_OPEN_SIDE = "LONG";
    const DEFAULT_LADDER_OPEN_PERCENT = 30;
    const DEFAULT_LADDER_CLOSE_PERCENT = 30;
    const DEFAULT_LADDER_LEVELS = 5;
    const DEFAULT_LADDER_STEP = 1;
    const LADDER_OPEN_PERCENTS = [10, 30, 50, 70];
    const LADDER_CLOSE_PERCENTS = [0.3, 1, 5, 10, 30, 100];
    const LADDER_LEVEL_OPTIONS = [3, 5, 7, 9];
    const LADDER_STEP_MIN = 1;
    const LADDER_STEP_MAX = 5;
    const LADDER_ORDER_DELAY_MS = 520;
    const LADDER_SUBMIT_ACK_TIMEOUT_MS = 3500;
    const LADDER_SUBMIT_POLL_MS = 80;
    const LADDER_MAKER_BUFFER_LEVELS = 1;
    const LADDER_OPEN_QTY_READY_TIMEOUT_MS = 1200;
    const LADDER_OPEN_QTY_POLL_MS = 80;
    const SINGLE_ORDER_PRICE_SYNC_DELAY_MS = 90;
    const SINGLE_ORDER_QTY_SYNC_DELAY_MS = 120;
    const DEFAULT_OPEN_LEVERAGE = 3;
    const AUTO_OPEN_LEVERAGE_DELAY_MS = 120;
    const AUTO_OPEN_LEVERAGE_DEDUPE_MS = 1200;
    const DOM_LOOKUP_CACHE_MS = 250;
    const INPUT_BORDER_COLOR = "var(--color-InputLine)";
    const INPUT_ERROR_COLOR = "var(--color-Error)";
    const INPUT_FOCUS_COLOR = "var(--color-PrimaryYellow)";
    const INPUT_DEFAULT_BG = "transparent";
    const DISABLED_CONTROL_BORDER = "#d5d9e2";
    const DISABLED_CONTROL_BG = "#f5f5f5";
    const DISABLED_CONTROL_TEXT = "#b7bdc6";
    const DISABLED_CONTROL_OPACITY = "0.65";
    const LADDER_CONTROL_BUTTON_HEIGHT = 32;
    const LADDER_CONTROL_BUTTON_FONT_SIZE = 14;
    const PANEL_BOTTOM_TOOLTIP_GAP = 12;
    let lastTs = 0;
    let isEditingMultiplier = false;
    let renderPanelQueued = false;
    let renderPanelFollowUpTimer = 0;
    let tradeUiMutationObserver = null;
    let tradeUiMutationTimeout = 0;
    let tradeUiMutationDebounceTimer = 0;
    let lastConfirmedCloseState = null;
    let lastDisplayCloseState = null;
    let closeGuard = null;
    let lastAppliedCacheSnapshot = "";
    let autoOpenLeverageTask = null;
    let lastAutoOpenLeverage = { symbol: null, at: 0 };
    let tradeButtonCache = { mode: null, expiresAt: 0, buttons: [] };
    let tradeScopeCache = { activeTab: null, expiresAt: 0, scopes: [] };
    let ladderTask = null;
    let ladderStopRequested = false;
    let ladderStatusText = "空闲";
    const controlledNativeButtons = /* @__PURE__ */ new Set();
    const MODE_HINT_ID = "jh-binance-trade-mode-hint";
    const NATIVE_ACTION_DISABLED_ATTR = "data-jh-native-action-disabled";
    const PREFIX = "[订单簿下单]";
    (function injectNativeDisabledStyle() {
      const styleId = "jh-native-action-disabled-style";
      if (document.getElementById(styleId)) return;
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
      button[${NATIVE_ACTION_DISABLED_ATTR}="true"] {
        background: ${DISABLED_CONTROL_BG} !important;
        color: ${DISABLED_CONTROL_TEXT} !important;
        border-color: ${DISABLED_CONTROL_BORDER} !important;
        opacity: ${DISABLED_CONTROL_OPACITY} !important;
        cursor: not-allowed !important;
        pointer-events: none !important;
      }
    `;
      (document.head || document.documentElement).appendChild(style);
    })();
    function emit(level, ...args) {
      if (!CFG.DEBUG && level !== "ERR") return;
      console.error(PREFIX, `[${level}]`, ...args);
    }
    function log(...args) {
      emit("LOG", ...args);
    }
    function warn(...args) {
      emit("WARN", ...args);
    }
    function err(...args) {
      emit("ERR", ...args);
    }
    function parseJsonSafe(raw) {
      if (!raw || typeof raw !== "string") return null;
      try {
        return JSON.parse(raw);
      } catch (_e) {
        return null;
      }
    }
    function parsePersistedField(state, key) {
      const value = state?.[key];
      if (typeof value === "string") return parseJsonSafe(value) || {};
      return value && typeof value === "object" ? value : {};
    }
    function readPersistedBinanceOrderForm() {
      try {
        const state = parseJsonSafe(window.localStorage?.getItem(BINANCE_PERSIST_KEY));
        return parsePersistedField(state, "futuresOrderForm");
      } catch (_e) {
        return {};
      }
    }
    function isPersistedPostOnlyOrderType() {
      const form = readPersistedBinanceOrderForm();
      return form.orderType === BINANCE_POST_ONLY_ORDER_TYPE && form.subOrderType === BINANCE_POST_ONLY_ORDER_TYPE;
    }
    function ensurePostOnlyPreferencePersisted() {
      try {
        const raw = window.localStorage?.getItem(BINANCE_PERSIST_KEY);
        const state = parseJsonSafe(raw) || {};
        const form = parsePersistedField(state, "futuresOrderForm");
        const nextForm = {
          ...form,
          orderType: BINANCE_POST_ONLY_ORDER_TYPE,
          subOrderType: BINANCE_POST_ONLY_ORDER_TYPE,
          timeInForce: BINANCE_POST_ONLY_TIME_IN_FORCE
        };
        if (form.orderType === nextForm.orderType && form.subOrderType === nextForm.subOrderType && form.timeInForce === nextForm.timeInForce) {
          return { ok: true, changed: false };
        }
        const nextState = {
          ...state,
          futuresOrderForm: JSON.stringify(nextForm),
          _persist: state._persist || JSON.stringify({ version: 1, rehydrated: true })
        };
        window.localStorage?.setItem(BINANCE_PERSIST_KEY, JSON.stringify(nextState));
        return { ok: true, changed: true };
      } catch (e) {
        return { ok: false, changed: false, error: e };
      }
    }
    const postOnlyPreferenceInit = ensurePostOnlyPreferencePersisted();
    if (!postOnlyPreferenceInit.ok) {
      warn("无法写入只做Maker偏好", postOnlyPreferenceInit.error);
    } else if (postOnlyPreferenceInit.changed) {
      log("已写入只做Maker偏好，Binance 会在页面初始化时读取");
    }
    function setInputValueReact(input, value) {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(new Event("blur", { bubbles: true }));
    }
    function delay(ms) {
      return new Promise((resolve) => {
        window.setTimeout(resolve, ms);
      });
    }
    function isValidOption(value, options) {
      const num = Number(value);
      return options.includes(num);
    }
    function loadNumberOption(key, options, fallback) {
      const stored = localStorage.getItem(key);
      return isValidOption(stored, options) ? Number(stored) : fallback;
    }
    function saveNumberOption(key, value, options) {
      if (!isValidOption(value, options)) return;
      localStorage.setItem(key, String(Number(value)));
    }
    function isLadderExpanded() {
      return localStorage.getItem(LOCAL_LADDER_EXPANDED_KEY) === "true";
    }
    function setLadderExpanded(expanded) {
      localStorage.setItem(LOCAL_LADDER_EXPANDED_KEY, expanded ? "true" : "false");
      scheduleRenderPanel();
    }
    function getLadderOpenPercent() {
      return loadNumberOption(LOCAL_LADDER_OPEN_PERCENT_KEY, LADDER_OPEN_PERCENTS, DEFAULT_LADDER_OPEN_PERCENT);
    }
    function setLadderOpenPercent(value) {
      saveNumberOption(LOCAL_LADDER_OPEN_PERCENT_KEY, value, LADDER_OPEN_PERCENTS);
      scheduleRenderPanel();
    }
    function getLadderClosePercent() {
      return loadNumberOption(LOCAL_LADDER_CLOSE_PERCENT_KEY, LADDER_CLOSE_PERCENTS, DEFAULT_LADDER_CLOSE_PERCENT);
    }
    function setLadderClosePercent(value) {
      saveNumberOption(LOCAL_LADDER_CLOSE_PERCENT_KEY, value, LADDER_CLOSE_PERCENTS);
      scheduleRenderPanel();
    }
    function getLadderLevels() {
      return loadNumberOption(LOCAL_LADDER_LEVELS_KEY, LADDER_LEVEL_OPTIONS, DEFAULT_LADDER_LEVELS);
    }
    function setLadderLevels(value) {
      saveNumberOption(LOCAL_LADDER_LEVELS_KEY, value, LADDER_LEVEL_OPTIONS);
      scheduleRenderPanel();
    }
    function getLadderStep() {
      const value = Number(localStorage.getItem(LOCAL_LADDER_STEP_KEY) || DEFAULT_LADDER_STEP);
      if (!Number.isInteger(value)) return DEFAULT_LADDER_STEP;
      return Math.max(LADDER_STEP_MIN, Math.min(value, LADDER_STEP_MAX));
    }
    function setLadderStep(value) {
      const num = Number(value);
      if (!Number.isInteger(num)) return;
      localStorage.setItem(LOCAL_LADDER_STEP_KEY, String(Math.max(LADDER_STEP_MIN, Math.min(num, LADDER_STEP_MAX))));
      scheduleRenderPanel();
    }
    function setLadderStatus(text) {
      ladderStatusText = String(text || "空闲");
      const statusEl = document.getElementById(LADDER_STATUS_ID);
      if (statusEl) statusEl.textContent = ladderStatusText;
    }
    function isValidMultiplier(value) {
      return /^\d+$/.test(String(value || "").trim()) && Number(value) > 0;
    }
    function applyInputVisualState(input, multiplier) {
      if (!input) return;
      const isFocused = document.activeElement === input;
      const isValid = isValidMultiplier(multiplier);
      if (!isValid) {
        input.style.borderColor = INPUT_ERROR_COLOR;
        input.style.background = INPUT_DEFAULT_BG;
        input.style.boxShadow = "none";
        return;
      }
      input.style.borderColor = isFocused ? INPUT_FOCUS_COLOR : INPUT_BORDER_COLOR;
      input.style.background = INPUT_DEFAULT_BG;
      input.style.boxShadow = "none";
    }
    function findQtyInput() {
      return document.querySelector('input[id^="unitAmount-"]') || document.querySelector('input[aria-label="数量"]') || document.querySelector('input[placeholder="数量"]');
    }
    function findPriceInput() {
      return document.querySelector('input[id^="limitPrice-"]') || document.querySelector('input[aria-label="委托价格"]') || document.querySelector('input[placeholder="委托价格"]') || null;
    }
    function isOwnPanelButton2(button) {
      return !!button?.closest?.(`#${PANEL_ID}`);
    }
    function getActiveTradeMode() {
      const activeTab = document.querySelector('#position-direction [role="tab"][aria-selected="true"]') || document.querySelector('.bn-tabs__buySell [role="tab"][aria-selected="true"]') || document.querySelector('[role="tab"].bn-tab__buySell[aria-selected="true"]');
      const text = (activeTab?.textContent || "").trim();
      if (text.includes("开仓")) return "OPEN";
      if (text.includes("平仓")) return "CLOSE";
      return "UNKNOWN";
    }
    function getCurrentOrderType() {
      const activeTab = findVisibleTradeScopeElement(
        '[role="tab"][aria-selected="true"][data-tab-key]',
        (tab) => !isTradeModeTab2(tab)
      );
      return String(activeTab?.getAttribute("data-tab-key") || "LIMIT").toUpperCase();
    }
    function isPostOnlyOrderTypeActive() {
      const orderType = getCurrentOrderType();
      if (!orderType.includes("CONDITIONAL") && !orderType.includes(BINANCE_POST_ONLY_ORDER_TYPE)) return false;
      return !!findVisibleTradeScopeElement(
        '[role="tab"], [role="combobox"], .bn-select-field-input, .bn-select-trigger, .bn-select-field',
        (el) => /只做Maker|Post Only/i.test((el.textContent || "").replace(/\s+/g, " ").trim())
      );
    }
    function getActiveTradeTab() {
      return document.querySelector('#position-direction [role="tab"][aria-selected="true"]') || document.querySelector('.bn-tabs__buySell [role="tab"][aria-selected="true"]') || document.querySelector('[role="tab"].bn-tab__buySell[aria-selected="true"]') || null;
    }
    function isTradeModeTab2(node) {
      return isTradeModeTab(node, { panelId: PANEL_ID });
    }
    function isVisibleElement(el) {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return false;
      return !!(el.getClientRects().length && (el.offsetWidth || el.offsetHeight));
    }
    function buttonTextMatches2(button, patterns) {
      const text = (button?.textContent || "").trim().toLowerCase();
      return patterns.some((pattern) => text.includes(pattern));
    }
    function isTradeActionButton2(node) {
      return isTradeActionButton(node, { panelId: PANEL_ID });
    }
    function isTradeUiNode(node) {
      if (!(node instanceof Element)) return false;
      if (node.closest(`#${PANEL_ID}`) || node.closest(`#${SPACER_ID}`)) return false;
      if (isTradeModeTab2(node) || isTradeActionButton2(node)) return true;
      return !!node.closest(
        '#position-direction, .bn-tabs__buySell, [data-testid="max-sell-amount"], [data-testid="max-buy-amount"], input[id^="unitAmount-"], input[id^="limitPrice-"]'
      );
    }
    function mutationTouchesTradeUi(mutation) {
      if (!mutation) return false;
      if (mutation.type === "attributes") {
        return isTradeUiNode(mutation.target);
      }
      if (mutation.type === "characterData") {
        return isTradeUiNode(mutation.target?.parentElement || null);
      }
      if (mutation.type === "childList") {
        if (isTradeUiNode(mutation.target)) return true;
        for (const node of mutation.addedNodes || []) {
          if (isTradeUiNode(node)) return true;
          if (node instanceof Element && node.querySelector?.(
            '#position-direction [role="tab"], .bn-tabs__buySell [role="tab"], [data-testid="max-sell-amount"], [data-testid="max-buy-amount"], input[id^="unitAmount-"], input[id^="limitPrice-"], button'
          )) {
            return true;
          }
        }
      }
      return false;
    }
    function invalidateTradeButtonCache() {
      tradeButtonCache = { mode: null, expiresAt: 0, buttons: [] };
      tradeScopeCache = { activeTab: null, expiresAt: 0, scopes: [] };
    }
    function getTradeSearchScopes() {
      const now = Date.now();
      const activeTab = getActiveTradeTab();
      if (tradeScopeCache.activeTab === activeTab && tradeScopeCache.expiresAt > now && tradeScopeCache.scopes.every((scope) => scope?.isConnected)) {
        return tradeScopeCache.scopes;
      }
      const scopes = [];
      const seen = /* @__PURE__ */ new Set();
      const pushScope = (node) => {
        if (!node || seen.has(node)) return;
        seen.add(node);
        scopes.push(node);
      };
      const paneId = activeTab?.getAttribute("aria-controls");
      if (paneId) pushScope(document.getElementById(paneId));
      const tabRoot = activeTab?.closest("#position-direction") || activeTab?.closest(".bn-tabs__buySell") || activeTab?.parentElement || null;
      if (tabRoot) {
        let node = tabRoot.parentElement;
        let depth = 0;
        while (node && node !== document.body && depth < 6) {
          pushScope(node);
          node = node.parentElement;
          depth += 1;
        }
      }
      tradeScopeCache = activeTab && scopes.length ? {
        activeTab,
        expiresAt: now + DOM_LOOKUP_CACHE_MS,
        scopes
      } : { activeTab: null, expiresAt: 0, scopes: [] };
      return scopes;
    }
    function findVisibleElementInScopes(scopes, selector, predicate = () => true) {
      const seen = /* @__PURE__ */ new Set();
      for (const scope of scopes) {
        if (!scope) continue;
        for (const el of scope.querySelectorAll(selector)) {
          if (seen.has(el) || !isVisibleElement(el) || el.closest(`#${PANEL_ID}`)) continue;
          seen.add(el);
          if (predicate(el)) return el;
        }
      }
      return null;
    }
    function findVisibleTradeScopeElement(selector, predicate) {
      return findVisibleElementInScopes(getTradeSearchScopes(), selector, predicate);
    }
    function getTradeMutationRoot() {
      return getTradeSearchScopes()[0] || findQtyFormItem(findQtyInput())?.parentElement || null;
    }
    function collectTradeButtons(mode) {
      const now = Date.now();
      if (tradeButtonCache.mode === mode && tradeButtonCache.expiresAt > now) {
        return tradeButtonCache.buttons;
      }
      const buttons = collectTradeButtonsFromScopes(getTradeSearchScopes(), mode, {
        panelId: PANEL_ID,
        isVisibleElement
      });
      tradeButtonCache = {
        mode,
        expiresAt: now + DOM_LOOKUP_CACHE_MS,
        buttons
      };
      return buttons;
    }
    function findTradeButton(patterns, mode) {
      return collectTradeButtons(mode).find((candidate) => buttonTextMatches2(candidate, patterns)) || null;
    }
    function findCloseLongButton() {
      return findTradeButton(["平多", "close long"], "CLOSE");
    }
    function findCloseShortButton() {
      return findTradeButton(["平空", "close short"], "CLOSE");
    }
    function findOpenLongButton() {
      return findTradeButton(["开多", "open long"], "OPEN");
    }
    function findOpenShortButton() {
      return findTradeButton(["开空", "open short"], "OPEN");
    }
    let cachedBncHeaders = null;
    const HEADER_KEYS_TO_CACHE = [
      "csrftoken",
      "bnc-uuid",
      "device-info",
      "fvideo-id",
      "clienttype",
      "x-passthrough-token"
    ];
    function readHeaderValue(headers, key) {
      if (!headers) return null;
      if (typeof headers.get === "function") {
        return headers.get(key) || headers.get(key.toUpperCase()) || null;
      }
      return headers[key] || headers[key.toUpperCase()] || headers[key.toLowerCase()] || null;
    }
    function extractHeadersFromFetchArgs(args) {
      const url = typeof args[0] === "string" ? args[0] : args[0] instanceof Request ? args[0].url : args[0]?.url || "";
      if (!url.includes("/bapi/")) return null;
      let headers = args[1]?.headers;
      if (!headers && args[0] instanceof Request) {
        headers = args[0].headers;
      }
      if (!headers) return null;
      const snapshot = {};
      for (const key of HEADER_KEYS_TO_CACHE) {
        const val = readHeaderValue(headers, key);
        if (val != null && val !== "") snapshot[key] = val;
      }
      return snapshot.csrftoken ? snapshot : null;
    }
    (function installFetchInterceptor() {
      const originalFetch = window.fetch;
      window.fetch = function(...args) {
        try {
          const snapshot = extractHeadersFromFetchArgs(args);
          if (snapshot) cachedBncHeaders = snapshot;
        } catch (_e) {
        }
        return originalFetch.apply(this, args);
      };
    })();
    function getBncHeaders() {
      const base = cachedBncHeaders || {};
      return {
        "content-type": "application/json",
        ...base,
        "x-trace-id": crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        "x-ui-request-trace": crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
      };
    }
    async function adjustLeverageApi(symbol, leverage) {
      if (!cachedBncHeaders) {
        throw new Error("bapi header 尚未缓存");
      }
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 5e3);
      try {
        const resp = await fetch(
          "https://www.binance.com/bapi/futures/v1/private/future/user-data/adjustLeverage",
          {
            method: "POST",
            headers: getBncHeaders(),
            body: JSON.stringify({ symbol, leverage }),
            credentials: "include",
            signal: controller.signal
          }
        );
        if (!resp.ok) throw new Error(`adjustLeverage HTTP ${resp.status}`);
        const data = await resp.json();
        if (!data.success) throw new Error(data.message || `code=${data.code}`);
        return data;
      } finally {
        window.clearTimeout(timer);
      }
    }
    function findOrderbookRow(node) {
      if (!node) return null;
      return node.closest("#futuresOrderbook .row-content");
    }
    function findClickedPriceNode(node) {
      if (!node) return null;
      const priceNode = node.closest("#futuresOrderbook .ask-light.emit-price, #futuresOrderbook .bid-light.emit-price");
      if (!priceNode) return null;
      return findOrderbookRow(priceNode) ? priceNode : null;
    }
    function findPriceNodeFromRow(row) {
      if (!row) return null;
      return row.querySelector(".ask-light.emit-price, .bid-light.emit-price");
    }
    function parsePrice(node) {
      const txt = (node.textContent || "").replace(/,/g, "").trim();
      return /^\d+(\.\d+)?$/.test(txt) ? txt : null;
    }
    function parseNumber(text) {
      if (text == null) return null;
      const n = Number(String(text).replace(/,/g, "").trim());
      return Number.isFinite(n) ? n : null;
    }
    function getOrderbookPrices(side, levels) {
      const isBid = side === "BID";
      const selector = isBid ? "#futuresOrderbook .bid-light.emit-price" : "#futuresOrderbook .ask-light.emit-price";
      let prices = Array.from(document.querySelectorAll(selector)).filter((node) => isVisibleElement(node) && findOrderbookRow(node)).map((node) => parsePrice(node)).filter(Boolean);
      if (!isBid) prices = prices.reverse();
      const deduped = [];
      for (const price of prices) {
        if (!deduped.includes(price)) deduped.push(price);
        if (deduped.length >= levels) break;
      }
      return deduped;
    }
    function getBestOrderbookPrice(side) {
      return getOrderbookPrices(side, 1)[0] || null;
    }
    function getBufferedMakerPrices(side, levels, ladderStep = DEFAULT_LADDER_STEP) {
      const step = Math.max(LADDER_STEP_MIN, Math.min(Number(ladderStep) || DEFAULT_LADDER_STEP, LADDER_STEP_MAX));
      const requiredDepth = LADDER_MAKER_BUFFER_LEVELS + (levels - 1) * step + 1;
      const prices = getOrderbookPrices(side, requiredDepth);
      return planBufferedMakerPrices({
        prices,
        side,
        levels,
        ladderStep: step,
        bufferLevels: LADDER_MAKER_BUFFER_LEVELS,
        defaultStep: DEFAULT_LADDER_STEP,
        minStep: LADDER_STEP_MIN,
        maxStep: LADDER_STEP_MAX
      });
    }
    function getLadderActionSpec2(actionType) {
      const spec = getLadderActionSpec(actionType);
      if (!spec) return null;
      const buttonGetters = {
        OPEN_LONG: findOpenLongButton,
        OPEN_SHORT: findOpenShortButton,
        CLOSE_LONG: findCloseLongButton,
        CLOSE_SHORT: findCloseShortButton
      };
      return {
        ...spec,
        buttonGetter: buttonGetters[actionType]
      };
    }
    function findTradeModeTabByMode(mode) {
      const label = mode === "OPEN" ? "开仓" : "平仓";
      const tabs = document.querySelectorAll(
        '#position-direction [role="tab"], .bn-tabs__buySell [role="tab"], [role="tab"].bn-tab__buySell'
      );
      return Array.from(tabs).find((tab) => (tab.textContent || "").includes(label)) || null;
    }
    function findConditionalOrderTab() {
      return findVisibleTradeScopeElement('[role="tab"]', (tab) => {
        const text = (tab.textContent || "").trim();
        const key = String(tab.getAttribute("data-tab-key") || "").toUpperCase();
        return key === "CONDITIONAL" || text.includes("条件委托") || /只做Maker|Post Only/i.test(text);
      });
    }
    function findConditionalSubtypeCombobox() {
      const tab = findConditionalOrderTab();
      if (!tab) return null;
      return Array.from(tab.querySelectorAll('[role="combobox"], .bn-select-trigger, .bn-select-field')).find(isVisibleElement) || null;
    }
    function clickElementLikeUser(el) {
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const clientX = (rect.left + rect.right) / 2;
      const clientY = (rect.top + rect.bottom) / 2;
      const PointerCtor = window.PointerEvent || MouseEvent;
      el.dispatchEvent(new PointerCtor("pointerdown", { bubbles: true, clientX, clientY }));
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX, clientY }));
      el.dispatchEvent(new PointerCtor("pointerup", { bubbles: true, clientX, clientY }));
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX, clientY }));
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX, clientY }));
      el.click?.();
    }
    function findPostOnlyOption() {
      const options = document.querySelectorAll('[role="option"], [role="menuitem"], .bn-select-option');
      return Array.from(options).find((el) => {
        if (!isVisibleElement(el)) return false;
        const text = (el.textContent || "").replace(/\s+/g, " ").trim();
        return /只做Maker|Post Only/i.test(text) && text.length < 120;
      }) || null;
    }
    async function activateTradeMode(mode) {
      if (getActiveTradeMode() === mode) return true;
      const tab = findTradeModeTabByMode(mode);
      if (!tab) return false;
      tab.click();
      await delay(260);
      invalidateTradeButtonCache();
      scheduleRenderPanel();
      return getActiveTradeMode() === mode;
    }
    async function ensurePostOnlyOrderType() {
      if (isPostOnlyOrderTypeActive()) return true;
      const tab = findConditionalOrderTab();
      if (!tab) return false;
      if (!getCurrentOrderType().includes("CONDITIONAL")) {
        tab.click();
        await delay(320);
      }
      if (isPostOnlyOrderTypeActive()) return true;
      const combo = findConditionalSubtypeCombobox();
      if (!combo) return false;
      clickElementLikeUser(combo);
      await delay(260);
      const option = findPostOnlyOption();
      if (!option) return false;
      clickElementLikeUser(option);
      await delay(360);
      return isPostOnlyOrderTypeActive();
    }
    async function readOpenBaseQtyForLadder(spec, referencePrice) {
      const priceInput = findPriceInput();
      if (!priceInput || !referencePrice) return null;
      setInputValueReact(priceInput, referencePrice);
      const startedAt = Date.now();
      while (Date.now() - startedAt < LADDER_OPEN_QTY_READY_TIMEOUT_MS) {
        const openLongBtn2 = findOpenLongButton();
        const openShortBtn2 = findOpenShortButton();
        const { longQty: longQty2, shortQty: shortQty2, qtySource: qtySource2 } = readOpenableQty(openLongBtn2, openShortBtn2);
        const qty = spec.side === "LONG" ? longQty2 : shortQty2;
        if (qty != null && isPositiveDecimalString(String(qty))) {
          return { qty, qtySource: qtySource2 };
        }
        await delay(LADDER_OPEN_QTY_POLL_MS);
      }
      const openLongBtn = findOpenLongButton();
      const openShortBtn = findOpenShortButton();
      const { longQty, shortQty, qtySource } = readOpenableQty(openLongBtn, openShortBtn);
      return {
        qty: spec.side === "LONG" ? longQty : shortQty,
        qtySource
      };
    }
    function readCloseBaseQtyForLadder(spec) {
      const raw = readCloseContext();
      const display = resolveDisplayCloseState(raw, getCurrentSymbol());
      const qty = spec.side === "LONG" ? display.longQty : display.shortQty;
      return {
        qty: qty != null ? normalizeDecimalString(String(qty)) : null,
        qtySource: display.qtySource
      };
    }
    async function buildLadderPlan(actionType) {
      const spec = getLadderActionSpec2(actionType);
      if (!spec) throw new Error("未知阶梯动作");
      const startSymbol = getCurrentSymbol();
      if (!startSymbol) throw new Error("未识别当前交易对");
      const modeReady = await activateTradeMode(spec.mode);
      if (!modeReady || getCurrentSymbol() !== startSymbol) throw new Error("切换开仓/平仓失败或交易对已变化");
      const postOnlyReady = await ensurePostOnlyOrderType();
      if (!postOnlyReady) throw new Error("请刷新页面让只做Maker (Post Only) 生效后重试，脚本不会用普通限价继续");
      const levels = getLadderLevels();
      const ladderStep = getLadderStep();
      const prices = getBufferedMakerPrices(spec.priceSide, levels, ladderStep);
      if (prices.length < levels) {
        throw new Error(`订单簿${spec.priceSide === "BID" ? "买盘" : "卖盘"}不足 ${levels} 档，档幅 ${ladderStep}`);
      }
      const rules = await ensureRules(startSymbol);
      if (!rules || getCurrentSymbol() !== startSymbol) throw new Error("交易规则未就绪或交易对已变化");
      const ruleContext = getQtyRuleContext(startSymbol, spec.mode, prices[0]);
      if (ruleContext.status !== "ready" || !ruleContext.stepSize || !ruleContext.baseMinQty) {
        throw new Error("数量步进/最小量未就绪");
      }
      const minRequiredQty = spec.mode === "OPEN" ? prices.map((price) => getQtyRuleContext(startSymbol, spec.mode, price).effectiveMinQty).filter(Boolean).reduce((maxQty, qty) => maxDecimalString(maxQty, qty), ruleContext.baseMinQty) : ruleContext.baseMinQty;
      const base = spec.mode === "OPEN" ? await readOpenBaseQtyForLadder(spec, prices[0]) : readCloseBaseQtyForLadder(spec);
      if (getCurrentSymbol() !== startSymbol || getActiveTradeMode() !== spec.mode || !isPostOnlyOrderTypeActive()) {
        throw new Error("读取可用数量后交易上下文已变化，已停止");
      }
      const baseQty = normalizeDecimalString(base?.qty || "");
      if (!baseQty || !isPositiveDecimalString(baseQty)) {
        throw new Error(`未读取到可用${spec.mode === "OPEN" ? "可开" : "可平"}数量`);
      }
      const percent = getLadderPercentForMode(spec.mode, getLadderOpenPercent(), getLadderClosePercent());
      if (percent == null) throw new Error("未知阶梯模式");
      const totalQty = multiplyDecimalByRatio(baseQty, percent, 100);
      const allocation = allocateLadderQuantities(totalQty, levels, ruleContext.stepSize, minRequiredQty);
      if (!allocation || allocation.actualLevels < 1) {
        throw new Error(`目标数量小于最小下单量 ${minRequiredQty}，无法阶梯${spec.mode === "OPEN" ? "开仓" : "平仓"}`);
      }
      const orderPrices = prices.slice(0, allocation.actualLevels);
      return {
        spec,
        symbol: startSymbol,
        percent,
        ladderStep,
        levels: allocation.actualLevels,
        requestedLevels: allocation.requestedLevels,
        baseQty,
        totalQty: allocation.totalQty,
        minRequiredQty,
        prices: orderPrices,
        qtySource: base.qtySource,
        orders: orderPrices.map((price, index) => ({ price, qty: allocation.quantities[index] }))
      };
    }
    function assertLadderMakerPrice(plan, price) {
      const oppositeSide = plan.spec.orderSide === "BUY" ? "ASK" : "BID";
      const oppositePrice = getBestOrderbookPrice(oppositeSide);
      if (!oppositePrice) throw new Error("盘口已刷新，未读取到对手盘价格");
      const cmp = compareDecimalStrings(price, oppositePrice);
      if (cmp == null) throw new Error("盘口价格校验失败");
      if (plan.spec.orderSide === "BUY" && cmp >= 0) {
        throw new Error(`盘口已移动，买单 ${price} 可能吃单，对手卖一 ${oppositePrice}`);
      }
      if (plan.spec.orderSide === "SELL" && cmp <= 0) {
        throw new Error(`盘口已移动，卖单 ${price} 可能吃单，对手买一 ${oppositePrice}`);
      }
    }
    function assertLadderExecutionContext(plan) {
      if (getCurrentSymbol() !== plan.symbol) throw new Error("执行中交易对变化，已停止");
      if (getActiveTradeMode() !== plan.spec.mode) throw new Error("执行中开仓/平仓模式变化，已停止");
      if (!isPostOnlyOrderTypeActive()) throw new Error("执行中只做Maker (Post Only) 状态丢失，请刷新页面后重试");
    }
    function assertSubmittedPriceMatchesClickedPrice(clickedPrice, submittedPrice) {
      const clicked = normalizeDecimalString(clickedPrice);
      const submitted = normalizeDecimalString(submittedPrice);
      const cmp = compareDecimalStrings(clicked, submitted);
      if (cmp !== 0) {
        throw new Error(`价格框未同步，点击价 ${clicked || clickedPrice}，当前提交价 ${submitted || submittedPrice || "-"}`);
      }
    }
    function isSubmitButtonBusy(button) {
      if (!button) return false;
      const text = (button.textContent || "").toLowerCase();
      const cls = String(button.className || "").toLowerCase();
      return button.disabled || button.getAttribute("aria-disabled") === "true" || button.getAttribute("data-loading") === "true" || text.includes("提交中") || text.includes("placing") || text.includes("loading") || cls.includes("loading") || !!button.querySelector('[class*="loading"], [class*="spinner"], [aria-busy="true"]');
    }
    function readVisibleOrderFeedbackText() {
      const selectors = [
        '[role="alert"]',
        "[aria-live]",
        '[class*="toast"]',
        '[class*="Toast"]',
        '[class*="message"]',
        '[class*="Message"]',
        '[class*="notification"]',
        '[class*="Notification"]'
      ];
      const seen = /* @__PURE__ */ new Set();
      for (const el of document.querySelectorAll(selectors.join(","))) {
        if (seen.has(el) || !isVisibleElement(el)) continue;
        seen.add(el);
        const text = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (!text || text.length > 300) continue;
        if (/订单|委托|下单|order|failed|error|成功|失败/i.test(text)) return text;
      }
      return "";
    }
    function classifyOrderFeedback(text) {
      if (!text) return "none";
      if (/失败|拒绝|错误|不足|过期|取消|failed|rejected|error|insufficient/i.test(text)) return "failure";
      if (/成功|已提交|已下单|委托已|order placed|submitted|success/i.test(text)) return "success";
      return "unknown";
    }
    async function waitForOrderSubmitAcknowledgement(button, label, previousFeedback) {
      const startedAt = Date.now();
      let sawBusy = isSubmitButtonBusy(button);
      while (Date.now() - startedAt < LADDER_SUBMIT_ACK_TIMEOUT_MS) {
        const feedback = readVisibleOrderFeedbackText();
        if (feedback && feedback !== previousFeedback) {
          const feedbackType = classifyOrderFeedback(feedback);
          if (feedbackType === "failure") throw new Error(feedback);
          if (feedbackType === "success") return;
        }
        const busy = isSubmitButtonBusy(button);
        if (busy) sawBusy = true;
        if (sawBusy && !busy) return;
        await delay(LADDER_SUBMIT_POLL_MS);
      }
      throw new Error(`未确认${label}已提交，已停止；请核对当前委托/历史成交`);
    }
    async function executeLadderPlan(plan) {
      const priceInput = findPriceInput();
      const qtyInput = findQtyInput();
      if (!priceInput || !qtyInput) throw new Error("未找到价格或数量输入框");
      let done = 0;
      for (const order of plan.orders) {
        if (ladderStopRequested) break;
        assertLadderExecutionContext(plan);
        if (!await ensurePostOnlyOrderType()) throw new Error("执行中只做Maker (Post Only) 状态丢失，请刷新页面后重试");
        assertLadderExecutionContext(plan);
        assertLadderMakerPrice(plan, order.price);
        const currentPriceInput = findPriceInput();
        const currentQtyInput = findQtyInput();
        if (!currentPriceInput || !currentQtyInput) throw new Error("执行中价格或数量输入框丢失");
        setInputValueReact(currentPriceInput, order.price);
        await delay(90);
        setInputValueReact(currentQtyInput, order.qty);
        await delay(120);
        const submittedPrice = normalizeDecimalString(currentPriceInput.value);
        if (!submittedPrice) throw new Error("执行中价格输入框值无效");
        assertSubmittedPriceMatchesClickedPrice(order.price, submittedPrice);
        assertLadderExecutionContext(plan);
        assertLadderMakerPrice(plan, submittedPrice);
        const button = plan.spec.buttonGetter();
        if (!button || button.disabled || button.getAttribute("aria-disabled") === "true") {
          throw new Error(`未找到可点击的${plan.spec.label}按钮`);
        }
        if (!CFG.SAFE_MODE) {
          const previousFeedback = readVisibleOrderFeedbackText();
          button.click();
          setLadderStatus(`${plan.spec.label} ${done + 1}/${plan.orders.length} 确认中`);
          waitForTradeUiMutation({ timeoutMs: 500 });
          await waitForOrderSubmitAcknowledgement(button, plan.spec.label, previousFeedback);
        }
        done++;
        setLadderStatus(`${plan.spec.label} ${done}/${plan.orders.length}`);
        await delay(LADDER_ORDER_DELAY_MS);
      }
      return done;
    }
    async function startLadder(actionType) {
      if (ladderTask) {
        setLadderStatus("正在执行，先点停止");
        return;
      }
      ladderStopRequested = false;
      const spec = getLadderActionSpec2(actionType);
      setLadderStatus(`${spec?.label || "阶梯"} 准备中`);
      ladderTask = (async () => {
        const plan = await buildLadderPlan(actionType);
        const levelText = plan.levels === plan.requestedLevels ? `${plan.levels}档` : `${plan.levels}/${plan.requestedLevels}档`;
        const stepText = plan.ladderStep > DEFAULT_LADDER_STEP ? `/幅${plan.ladderStep}` : "";
        setLadderStatus(`${plan.spec.label} ${plan.percent}%/${levelText}${stepText}`);
        const done = await executeLadderPlan(plan);
        setLadderStatus(ladderStopRequested ? `已停止 ${done}/${plan.orders.length}` : `完成 ${done}/${plan.orders.length}`);
      })().catch((e) => {
        err("Maker 阶梯执行失败:", e);
        setLadderStatus(e?.message || "执行失败");
      }).finally(() => {
        ladderTask = null;
        ladderStopRequested = false;
        scheduleRenderPanel();
      });
      scheduleRenderPanel();
      await ladderTask;
    }
    function stopLadder() {
      if (!ladderTask) {
        setLadderStatus("空闲");
        return;
      }
      ladderStopRequested = true;
      setLadderStatus("停止中");
      scheduleRenderPanel();
    }
    function findVisibleElementByText(selector, patterns, root = document) {
      for (const el of root.querySelectorAll(selector)) {
        if (!isVisibleElement(el)) continue;
        const text = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (patterns.some((pattern) => pattern.test(text))) return el;
      }
      return null;
    }
    function findVisibleTextElement(patterns, root = document) {
      const candidates = Array.from(root.querySelectorAll('button, [role="button"], a, [tabindex], div, span')).filter(isVisibleElement).map((el) => ({
        el,
        text: (el.textContent || "").replace(/\s+/g, " ").trim(),
        rect: el.getBoundingClientRect()
      })).filter(({ text }) => patterns.some((pattern) => pattern.test(text)));
      candidates.sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height);
      return candidates[0]?.el || null;
    }
    function getNormalizedText2(el) {
      return normalizeText(el?.textContent || "");
    }
    function getAccountOrdersTabGroup2(tab) {
      return getAccountOrdersTabGroup(tab, { isVisibleElement });
    }
    function findOpenOrdersTab2() {
      return findOpenOrdersTab(document, { isVisibleElement });
    }
    function getOpenOrdersTabCount() {
      const tab = findOpenOrdersTab2();
      if (!tab) return null;
      return parseOpenOrdersTabCount(getNormalizedText2(tab));
    }
    function findSelectedAccountOrdersTab2() {
      return findSelectedAccountOrdersTab(document, { isVisibleElement });
    }
    async function activateOpenOrdersTab() {
      const tab = findOpenOrdersTab2();
      if (!tab) return false;
      if (tab.getAttribute("aria-selected") === "true") return true;
      tab.click();
      await delay(350);
      const activeTab = findOpenOrdersTab2();
      return activeTab?.getAttribute("aria-selected") === "true";
    }
    async function restoreAccountOrdersTab(previousTab) {
      if (!previousTab || !previousTab.isConnected || !isVisibleElement(previousTab)) return true;
      if (previousTab.getAttribute("aria-selected") === "true") return true;
      previousTab.click();
      await delay(250);
      return previousTab.getAttribute("aria-selected") === "true";
    }
    function getActiveOpenOrdersScope2() {
      return getActiveOpenOrdersScope(document, {
        isVisibleElement,
        findHideOtherSymbolCheckbox,
        findCurrentSymbolCancelAllButton
      });
    }
    async function waitForActiveOpenOrdersScope() {
      const deadline = Date.now() + 2200;
      while (Date.now() < deadline) {
        const scope = getActiveOpenOrdersScope2();
        if (scope) return scope;
        await delay(100);
      }
      return getActiveOpenOrdersScope2();
    }
    function findCurrentSymbolCancelAllButton(root) {
      if (!root) return null;
      const button = findVisibleElementByText(
        'button, [role="button"], a',
        [/^全撤$/, /^全部撤单$/, /^撤销全部$/, /^Cancel All$/i],
        root
      ) || findVisibleTextElement([/^全撤$/, /^全部撤单$/, /^撤销全部$/, /^Cancel All$/i], root);
      if (!button || button.disabled || button.getAttribute("aria-disabled") === "true") return null;
      return button;
    }
    function findHideOtherSymbolCheckbox(root) {
      if (!root) return null;
      return Array.from(root.querySelectorAll('[role="checkbox"][name="hideOtherSymbol"]')).find(isVisibleElement) || null;
    }
    function getCheckboxCheckedState(checkbox) {
      if (!checkbox) return null;
      const ariaChecked = checkbox.getAttribute("aria-checked");
      if (ariaChecked === "true") return true;
      if (ariaChecked === "false") return false;
      if (typeof checkbox.checked === "boolean") return checkbox.checked;
      const input = checkbox.matches('input[type="checkbox"]') ? checkbox : checkbox.querySelector('input[type="checkbox"]');
      if (input && typeof input.checked === "boolean") return input.checked;
      if (checkbox.hasAttribute("checked")) return true;
      return null;
    }
    function readVisibleOpenOrderSymbols(root) {
      return readVisibleOpenOrderSymbolsText(root?.textContent || "");
    }
    function isOpenOrdersScopeLimitedToSymbol(root, symbol) {
      return isOpenOrdersScopeLimitedToSymbolText(root?.textContent || "", symbol);
    }
    function hasCurrentSymbolOpenOrders(root, symbol, symbolFilterOk, cancelAllButton) {
      return hasCurrentSymbolOpenOrdersEvidence({
        scopeText: root?.textContent || "",
        symbol,
        symbolFilterOk,
        openOrdersCount: getOpenOrdersTabCount(),
        cancelAllAvailable: Boolean(cancelAllButton)
      });
    }
    async function waitForCurrentSymbolOpenOrders(root, symbol, symbolFilterOk) {
      const deadline = Date.now() + 1600;
      while (Date.now() < deadline) {
        const cancelAllButton2 = findCurrentSymbolCancelAllButton(root);
        if (hasCurrentSymbolOpenOrders(root, symbol, symbolFilterOk, cancelAllButton2)) {
          return { hasOrders: true, cancelAllButton: cancelAllButton2 };
        }
        await delay(100);
      }
      const cancelAllButton = findCurrentSymbolCancelAllButton(root);
      return {
        hasOrders: hasCurrentSymbolOpenOrders(root, symbol, symbolFilterOk, cancelAllButton),
        cancelAllButton
      };
    }
    async function setHideOtherSymbolChecked(root, desiredChecked) {
      const checkbox = findHideOtherSymbolCheckbox(root);
      if (!checkbox) return false;
      const currentChecked = getCheckboxCheckedState(checkbox);
      if (currentChecked === desiredChecked) return true;
      if (currentChecked === null) return false;
      checkbox.click();
      const deadline = Date.now() + 1e3;
      while (Date.now() < deadline) {
        await delay(80);
        const nextChecked = getCheckboxCheckedState(findHideOtherSymbolCheckbox(root));
        if (nextChecked === desiredChecked) return true;
      }
      return false;
    }
    async function ensureOpenOrdersLimitedToCurrentSymbol(root, symbol) {
      const checkbox = findHideOtherSymbolCheckbox(root);
      if (!checkbox) {
        return {
          ok: isOpenOrdersScopeLimitedToSymbol(root, symbol),
          originalChecked: null
        };
      }
      const originalChecked = getCheckboxCheckedState(checkbox);
      if (originalChecked === null) {
        return {
          ok: isOpenOrdersScopeLimitedToSymbol(root, symbol),
          originalChecked
        };
      }
      const ok = originalChecked || await setHideOtherSymbolChecked(root, true);
      return {
        ok: ok || isOpenOrdersScopeLimitedToSymbol(root, symbol),
        originalChecked
      };
    }
    async function restoreOpenOrdersSymbolFilter(root, originalChecked) {
      if (originalChecked !== false) return true;
      return setHideOtherSymbolChecked(root, false);
    }
    function getVisibleDialogs() {
      return Array.from(document.querySelectorAll(
        '[role="dialog"], [class*="modal"], [class*="Modal"], [class*="popover"], [class*="Popover"], [class*="drawer"], [class*="Drawer"]'
      )).filter(isVisibleElement);
    }
    function findVisibleDialogConfirm(dialogsBefore) {
      const previousDialogs = dialogsBefore || /* @__PURE__ */ new Set();
      for (const dialog of getVisibleDialogs()) {
        if (previousDialogs.has(dialog)) continue;
        const button = findVisibleElementByText(
          'button, [role="button"]',
          [/^确认$/, /^确定$/, /^Confirm$/i],
          dialog
        );
        if (button) return { button, dialog };
      }
      return null;
    }
    async function waitForDialogToClose(dialog) {
      while (dialog.isConnected && isVisibleElement(dialog)) {
        await delay(500);
      }
    }
    async function cancelCurrentSymbolOpenOrders() {
      const symbol = getCurrentSymbol();
      if (!symbol) {
        setLadderStatus("未识别当前交易对");
        return;
      }
      const previousAccountOrdersTab = findSelectedAccountOrdersTab2();
      setLadderStatus(`查找 ${symbol} 当前委托`);
      const tabReady = await activateOpenOrdersTab();
      if (!tabReady || getCurrentSymbol() !== symbol) {
        await restoreAccountOrdersTab(previousAccountOrdersTab);
        setLadderStatus("当前委托页未就绪或交易对已变化");
        return;
      }
      const openOrdersScope = await waitForActiveOpenOrdersScope();
      if (!openOrdersScope) {
        await restoreAccountOrdersTab(previousAccountOrdersTab);
        setLadderStatus("未定位到当前委托面板");
        return;
      }
      const symbolFilter = await ensureOpenOrdersLimitedToCurrentSymbol(openOrdersScope, symbol);
      if (!symbolFilter.ok) {
        await restoreAccountOrdersTab(previousAccountOrdersTab);
        setLadderStatus("未确认只显示当前币挂单");
        return;
      }
      const openOrdersEvidence = await waitForCurrentSymbolOpenOrders(openOrdersScope, symbol, symbolFilter.ok);
      if (!openOrdersEvidence.hasOrders) {
        await restoreOpenOrdersSymbolFilter(openOrdersScope, symbolFilter.originalChecked);
        await restoreAccountOrdersTab(previousAccountOrdersTab);
        setLadderStatus(`${symbol} 当前币无挂单`);
        return;
      }
      const { cancelAllButton } = openOrdersEvidence;
      if (!cancelAllButton) {
        await restoreAccountOrdersTab(previousAccountOrdersTab);
        setLadderStatus("未找到当前委托全撤按钮");
        return;
      }
      const dialogsBefore = new Set(getVisibleDialogs());
      cancelAllButton.click();
      await delay(300);
      if (getCurrentSymbol() !== symbol) {
        await restoreAccountOrdersTab(previousAccountOrdersTab);
        setLadderStatus("确认撤单前交易对已变化");
        return;
      }
      const confirm = findVisibleDialogConfirm(dialogsBefore);
      if (confirm) {
        setLadderStatus(`${symbol} 撤单确认弹窗已打开`);
        waitForTradeUiMutation({ timeoutMs: 800 });
        await waitForDialogToClose(confirm.dialog);
        const restored = await restoreOpenOrdersSymbolFilter(openOrdersScope, symbolFilter.originalChecked);
        if (!restored) {
          await restoreAccountOrdersTab(previousAccountOrdersTab);
          setLadderStatus("未能恢复隐藏其他合约状态");
          return;
        }
        await restoreAccountOrdersTab(previousAccountOrdersTab);
        setLadderStatus(`${symbol} 撤单流程结束，已恢复筛选状态`);
        return;
      } else {
        setLadderStatus(`${symbol} 撤单已点击，请核对当前委托`);
        waitForTradeUiMutation({ timeoutMs: 800 });
        const restored = await restoreOpenOrdersSymbolFilter(openOrdersScope, symbolFilter.originalChecked);
        if (!restored) setLadderStatus("未能恢复隐藏其他合约状态");
        await restoreAccountOrdersTab(previousAccountOrdersTab);
        return;
      }
    }
    function readQtyByDataTestId(testId) {
      const el = document.querySelector(`[data-testid="${testId}"]`);
      if (!el) return null;
      const txt = (el.textContent || "").replace(/,/g, "");
      const m = txt.match(/(\d+(?:\.\d+)?)/);
      if (!m) return null;
      return parseNumber(m[1]);
    }
    function readCloseableQtyByTestIds() {
      const longQty = readQtyByDataTestId("max-sell-amount");
      const shortQty = readQtyByDataTestId("max-buy-amount");
      if (longQty == null && shortQty == null) return null;
      return { longQty, shortQty, qtySource: "testid" };
    }
    function getButtonTextSearchRoot(button) {
      if (!button) return null;
      const localRoot = button.closest('[class*="order"], [data-testid*="order"]');
      if (localRoot && localRoot !== document.body) return localRoot;
      return getTradeSearchScopes().find((scope) => scope && scope !== document.body && scope.contains(button)) || null;
    }
    function readCloseableQtyNearButton(button) {
      if (!button) return null;
      const btnRect = button.getBoundingClientRect();
      const root = getButtonTextSearchRoot(button);
      if (!root) return null;
      let best = null;
      let bestScore = Infinity;
      const nodes = root.querySelectorAll("div, span, p, small");
      for (const node of nodes) {
        const text = (node.textContent || "").trim();
        if (!text.includes("可平")) continue;
        const m = text.match(/可平\s*([\d,]*\.?\d+)/);
        if (!m) continue;
        const qty = parseNumber(m[1]);
        if (!(qty >= 0)) continue;
        const r = node.getBoundingClientRect();
        if (!r || !Number.isFinite(r.left)) continue;
        const nodeX = (r.left + r.right) / 2;
        const btnX = (btnRect.left + btnRect.right) / 2;
        const dy = r.top - btnRect.bottom;
        if (dy < -16 || dy > 200) continue;
        const dx = Math.abs(nodeX - btnX);
        const score = dx + Math.abs(dy) * 2;
        if (score < bestScore) {
          bestScore = score;
          best = qty;
        }
      }
      return best;
    }
    function readCloseableQty(closeLongBtn, closeShortBtn) {
      const fromTestId = readCloseableQtyByTestIds();
      if (fromTestId) return fromTestId;
      return {
        longQty: readCloseableQtyNearButton(closeLongBtn),
        shortQty: readCloseableQtyNearButton(closeShortBtn),
        qtySource: "near_button"
      };
    }
    function readQtyTextNearButton(button, label) {
      if (!button) return null;
      const btnRect = button.getBoundingClientRect();
      const root = getButtonTextSearchRoot(button);
      if (!root) return null;
      let best = null;
      let bestScore = Infinity;
      const nodes = root.querySelectorAll("div, span, p, small");
      const re = new RegExp(`${label}\\s*([\\d,]*\\.?\\d+)`, "g");
      for (const node of nodes) {
        const text = (node.textContent || "").replace(/\s+/g, " ").trim();
        if (!text.includes(label)) continue;
        const matches = Array.from(text.matchAll(re));
        if (!matches.length) continue;
        const r = node.getBoundingClientRect();
        if (!r || !Number.isFinite(r.left)) continue;
        const nodeX = (r.left + r.right) / 2;
        const btnX = (btnRect.left + btnRect.right) / 2;
        const dy = r.top - btnRect.bottom;
        if (dy < -32 || dy > 240) continue;
        const dx = Math.abs(nodeX - btnX);
        const score = dx + Math.abs(dy) * 2;
        if (score >= bestScore) continue;
        const matchIndex = matches.length > 1 && btnX < nodeX ? 0 : matches.length - 1;
        const qty = normalizeDecimalString(matches[matchIndex]?.[1] || "");
        if (!qty) continue;
        bestScore = score;
        best = qty;
      }
      return best;
    }
    function readOpenableQty(openLongBtn, openShortBtn) {
      return {
        longQty: readQtyTextNearButton(openLongBtn, "可开"),
        shortQty: readQtyTextNearButton(openShortBtn, "可开"),
        qtySource: "near_button"
      };
    }
    function normalizeCloseSide(value) {
      return String(value || "LONG").toUpperCase() === "SHORT" ? "SHORT" : "LONG";
    }
    function loadCloseSide() {
      return normalizeCloseSide(localStorage.getItem(LOCAL_CLOSE_SIDE_KEY) || DEFAULT_CLOSE_SIDE);
    }
    function saveCloseSide(value) {
      localStorage.setItem(LOCAL_CLOSE_SIDE_KEY, normalizeCloseSide(value));
    }
    function updateCloseSide(value) {
      saveCloseSide(value);
      scheduleRenderPanel();
    }
    function loadOpenSide() {
      return normalizeCloseSide(localStorage.getItem(LOCAL_OPEN_SIDE_KEY) || DEFAULT_OPEN_SIDE);
    }
    function saveOpenSide(value) {
      localStorage.setItem(LOCAL_OPEN_SIDE_KEY, normalizeCloseSide(value));
    }
    function updateOpenSide(value) {
      saveOpenSide(value);
      scheduleRenderPanel();
    }
    function readCloseContext() {
      const closeLongBtn = findCloseLongButton();
      const closeShortBtn = findCloseShortButton();
      const { longQty, shortQty, qtySource } = readCloseableQty(closeLongBtn, closeShortBtn);
      const knowsLong = longQty != null;
      const knowsShort = shortQty != null;
      const hasLong = longQty > 0;
      const hasShort = shortQty > 0;
      return { closeLongBtn, closeShortBtn, longQty, shortQty, qtySource, knowsLong, knowsShort, hasLong, hasShort };
    }
    function resolveDisplayCloseState(rawCloseContext, symbol) {
      const cache = symbol && lastConfirmedCloseState?.symbol === symbol ? lastConfirmedCloseState : null;
      const isPending = !rawCloseContext.knowsLong && !rawCloseContext.knowsShort;
      const isUsingCache = rawCloseContext.longQty == null && cache?.longQty != null || rawCloseContext.shortQty == null && cache?.shortQty != null;
      let longQty = rawCloseContext.longQty ?? cache?.longQty ?? null;
      let shortQty = rawCloseContext.shortQty ?? cache?.shortQty ?? null;
      const guard = closeGuard && closeGuard.symbol === symbol && Date.now() < closeGuard.expiresAt ? closeGuard : null;
      if (guard && (rawCloseContext.knowsLong || rawCloseContext.knowsShort)) {
        const rawLong = rawCloseContext.longQty;
        const rawShort = rawCloseContext.shortQty;
        const isNewSnapshot = rawLong !== guard.lastRawLong || rawShort !== guard.lastRawShort;
        guard.lastRawLong = rawLong;
        guard.lastRawShort = rawShort;
        if (isNewSnapshot) {
          if (rawLong === 0) {
            guard.longZeroStreak++;
          } else if (rawLong > 0) {
            guard.longZeroStreak = 0;
          }
          if (rawShort === 0) {
            guard.shortZeroStreak++;
          } else if (rawShort > 0) {
            guard.shortZeroStreak = 0;
          }
        }
        const ZERO_CONFIRM_THRESHOLD = 2;
        if (rawLong === 0 && cache?.longQty > 0 && guard.longZeroStreak < ZERO_CONFIRM_THRESHOLD) {
          longQty = cache.longQty;
        }
        if (rawShort === 0 && cache?.shortQty > 0 && guard.shortZeroStreak < ZERO_CONFIRM_THRESHOLD) {
          shortQty = cache.shortQty;
        }
      }
      const knowsLong = longQty != null;
      const knowsShort = shortQty != null;
      const hasLong = longQty > 0;
      const hasShort = shortQty > 0;
      if (symbol && getActiveTradeMode() === "CLOSE" && (rawCloseContext.knowsLong || rawCloseContext.knowsShort)) {
        const closeMode = hasLong && hasShort ? "dual" : hasLong ? "single_long" : hasShort ? "single_short" : "unknown";
        lastConfirmedCloseState = {
          symbol,
          longQty,
          shortQty,
          closeMode,
          longDisabled: !hasLong,
          shortDisabled: !hasShort
        };
      }
      const result = {
        ...rawCloseContext,
        symbol,
        longQty,
        shortQty,
        knowsLong,
        knowsShort,
        hasLong,
        hasShort,
        isUsingCache,
        isPending
      };
      lastDisplayCloseState = result;
      return result;
    }
    function getCachedCloseState(symbol) {
      return symbol && lastConfirmedCloseState?.symbol === symbol ? lastConfirmedCloseState : null;
    }
    function hasPositionInDom(symbol) {
      const rows = document.querySelectorAll(
        '[class*="position"] tr, [class*="position"] [role="row"], [data-testid*="position"] tr, [data-testid*="position"] [role="row"]'
      );
      for (const row of rows) {
        if (!isVisibleElement(row)) continue;
        const text = (row.textContent || "").toUpperCase();
        if (text.includes(symbol)) return true;
      }
      return false;
    }
    function readCurrentLeverageFromDom() {
      const leverageButton = findVisibleTradeScopeElement('button, [role="button"]', (el) => {
        const text2 = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (text2.length > 48) return false;
        return /(?:全仓|逐仓|cross|isolated)\s*\d{1,3}\s*[xX]/i.test(text2);
      });
      const text = (leverageButton?.textContent || "").replace(/\s+/g, " ").trim();
      const match = text.match(/(?:全仓|逐仓|cross|isolated)\s*(\d{1,3})\s*[xX]/i);
      return match ? Number(match[1]) : null;
    }
    function getCachedPositionState(symbol) {
      if (hasPositionInDom(symbol)) {
        return { status: "has_position", source: "dom" };
      }
      const cache = getCachedCloseState(symbol);
      if (!cache) return { status: "unknown", source: "close_cache_miss" };
      const longQty = typeof cache.longQty === "number" ? cache.longQty : null;
      const shortQty = typeof cache.shortQty === "number" ? cache.shortQty : null;
      if (!(longQty >= 0) || !(shortQty >= 0)) {
        return { status: "unknown", source: "close_cache_partial" };
      }
      const hasPosition = longQty > 0 || shortQty > 0;
      return {
        status: hasPosition ? "has_position" : "flat",
        source: "close_cache",
        longQty,
        shortQty,
        closeMode: cache.closeMode
      };
    }
    function isStableOpenContext(symbol) {
      return getActiveTradeMode() === "OPEN" && getCurrentSymbol() === symbol;
    }
    async function autoResetOpenLeverageToDefault(symbol, positionState, triggerSource) {
      await delay(AUTO_OPEN_LEVERAGE_DELAY_MS);
      if (!isStableOpenContext(symbol)) return false;
      if (!cachedBncHeaders) {
        for (let i = 0; i < 10; i++) {
          await delay(500);
          if (cachedBncHeaders || !isStableOpenContext(symbol)) break;
        }
      }
      if (!cachedBncHeaders) {
        log("bapi header 尚未缓存，跳过杠杆重置", symbol);
        return false;
      }
      if (!isStableOpenContext(symbol)) return false;
      if (hasPositionInDom(symbol)) {
        log("延迟后发现持仓，跳过杠杆重置", symbol);
        return false;
      }
      const currentLeverage = readCurrentLeverageFromDom();
      if (currentLeverage === DEFAULT_OPEN_LEVERAGE) {
        log("开仓杠杆已是默认值", symbol, `${DEFAULT_OPEN_LEVERAGE}x`, triggerSource);
        return true;
      }
      try {
        await adjustLeverageApi(symbol, DEFAULT_OPEN_LEVERAGE);
      } catch (e) {
        err("自动重置杠杆失败", symbol, `${DEFAULT_OPEN_LEVERAGE}x`, e.message || e);
        return false;
      }
      log(
        "无仓切回开仓，已自动重置杠杆",
        symbol,
        `${DEFAULT_OPEN_LEVERAGE}x`,
        triggerSource,
        positionState.source
      );
      return true;
    }
    function queueAutoOpenLeverageReset(triggerSource) {
      const symbol = getCurrentSymbol();
      if (!symbol) return;
      const positionState = getCachedPositionState(symbol);
      if (positionState.status === "has_position") return;
      if (positionState.status !== "flat") return;
      if (!isStableOpenContext(symbol) && triggerSource === "mutation") return;
      const now = Date.now();
      if (autoOpenLeverageTask) return;
      if (lastAutoOpenLeverage.symbol === symbol && now - lastAutoOpenLeverage.at < AUTO_OPEN_LEVERAGE_DEDUPE_MS) {
        return;
      }
      lastAutoOpenLeverage = { symbol, at: now };
      autoOpenLeverageTask = autoResetOpenLeverageToDefault(symbol, positionState, triggerSource).catch((e) => {
        err("自动重置开仓杠杆失败:", e);
        return false;
      }).finally(() => {
        autoOpenLeverageTask = null;
      });
    }
    function applyCachedNativeCloseButtonState() {
      if (getActiveTradeMode() !== "CLOSE") return false;
      const cache = getCachedCloseState(getCurrentSymbol());
      if (!cache) return false;
      const closeLongBtn = findCloseLongButton();
      const closeShortBtn = findCloseShortButton();
      if (!closeLongBtn && !closeShortBtn) return false;
      const snapshot = `${cache.closeMode}|${cache.longQty}|${cache.shortQty}`;
      if (snapshot !== lastAppliedCacheSnapshot) {
        lastAppliedCacheSnapshot = snapshot;
        const activeGuard = closeGuard && Date.now() < closeGuard.expiresAt ? closeGuard : null;
        log(
          "应用缓存按钮状态",
          cache.closeMode,
          "long=",
          cache.longQty,
          cache.longDisabled ? "(禁)" : "(启)",
          "short=",
          cache.shortQty,
          cache.shortDisabled ? "(禁)" : "(启)",
          activeGuard ? `guard:${activeGuard.expiresAt - Date.now()}ms L0x${activeGuard.longZeroStreak} S0x${activeGuard.shortZeroStreak} raw=${activeGuard.lastRawLong}/${activeGuard.lastRawShort}` : "no-guard"
        );
      }
      if (closeLongBtn) {
        setNativeActionButtonDisabled(closeLongBtn, !!cache.longDisabled);
      }
      if (closeShortBtn) {
        setNativeActionButtonDisabled(closeShortBtn, !!cache.shortDisabled);
      }
      return true;
    }
    function applyCachedCloseUiState() {
      if (getActiveTradeMode() !== "CLOSE") return false;
      const cache = getCachedCloseState(getCurrentSymbol());
      if (!cache) return false;
      applyCachedNativeCloseButtonState();
      renderPanel();
      return true;
    }
    function resolveCloseAction() {
      const display = lastDisplayCloseState;
      const currentSymbol = getCurrentSymbol();
      if (!display || display.symbol !== currentSymbol) return null;
      const { longQty, shortQty, qtySource, hasLong, hasShort } = display;
      const closeLongBtn = findCloseLongButton();
      const closeShortBtn = findCloseShortButton();
      if (hasLong && hasShort) {
        const sideCfg = loadCloseSide();
        if (sideCfg === "SHORT") {
          return { side: "平空", button: closeShortBtn, by: "dual_panel", longQty, shortQty, qtySource };
        }
        return { side: "平多", button: closeLongBtn, by: "dual_panel", longQty, shortQty, qtySource };
      }
      if (hasLong) return { side: "平多", button: closeLongBtn, by: "single_long", longQty, shortQty, qtySource };
      if (hasShort) return { side: "平空", button: closeShortBtn, by: "single_short", longQty, shortQty, qtySource };
      return null;
    }
    function resolveOpenAction() {
      const openLongBtn = findOpenLongButton();
      const openShortBtn = findOpenShortButton();
      const sideCfg = loadOpenSide();
      if (sideCfg === "SHORT") {
        return { side: "开空", button: openShortBtn, by: "open_panel", mode: "OPEN" };
      }
      return { side: "开多", button: openLongBtn, by: "open_panel", mode: "OPEN" };
    }
    function resolveTradeAction() {
      const mode = getActiveTradeMode();
      if (mode === "OPEN") {
        return resolveOpenAction();
      }
      const closeAction = resolveCloseAction();
      return closeAction ? { ...closeAction, mode: "CLOSE" } : null;
    }
    function getCurrentSymbol() {
      const m = location.pathname.match(/\/futures\/([A-Z0-9_]+)/i);
      if (m && m[1]) return m[1].toUpperCase();
      const title = document.title || "";
      const t = title.match(/([A-Z0-9_]{6,})\s+U/i);
      return t && t[1] ? t[1].toUpperCase() : null;
    }
    let appDataCache = { text: "", parsed: null };
    let rulesCache = {};
    let rulesInflight = {};
    let rulesFailedUntil = {};
    const RULES_RETRY_COOLDOWN_MS = 5e3;
    async function ensureRules(symbol) {
      if (!symbol || rulesCache[symbol]) return rulesCache[symbol];
      if (rulesInflight[symbol]) return rulesInflight[symbol];
      if (rulesFailedUntil[symbol] > Date.now()) return null;
      const promise = (async () => {
        try {
          const resp = await fetch(`https://fapi.binance.com/fapi/v1/exchangeInfo?symbol=${symbol}`);
          if (!resp.ok) {
            rulesFailedUntil[symbol] = Date.now() + RULES_RETRY_COOLDOWN_MS;
            return null;
          }
          const data = await resp.json();
          const sInfo = data.symbols?.find((s) => s.symbol === symbol);
          if (!sInfo) {
            rulesFailedUntil[symbol] = Date.now() + RULES_RETRY_COOLDOWN_MS;
            return null;
          }
          const filters = sInfo.filters || [];
          const lot = filters.find((f) => f.filterType === "LOT_SIZE") || {};
          const marketLot = filters.find((f) => f.filterType === "MARKET_LOT_SIZE") || {};
          const minN = filters.find((f) => f.filterType === "MIN_NOTIONAL") || {};
          const entry = {
            limitMinQty: lot.minQty ? String(lot.minQty) : null,
            limitStepSize: lot.stepSize ? String(lot.stepSize) : null,
            marketMinQty: marketLot.minQty ? String(marketLot.minQty) : null,
            marketStepSize: marketLot.stepSize ? String(marketLot.stepSize) : null,
            minNotional: minN.notional ? String(minN.notional) : null
          };
          rulesCache[symbol] = entry;
          delete rulesFailedUntil[symbol];
          log("exchangeInfo:", symbol, entry);
          return entry;
        } catch (_e) {
          rulesFailedUntil[symbol] = Date.now() + RULES_RETRY_COOLDOWN_MS;
          return null;
        } finally {
          delete rulesInflight[symbol];
        }
      })();
      rulesInflight[symbol] = promise;
      return promise;
    }
    function readMarkPriceFromAppData(symbol) {
      try {
        const el = document.querySelector("#__APP_DATA");
        if (!el || !el.textContent) return null;
        let data;
        if (el.textContent === appDataCache.text) {
          data = appDataCache.parsed;
        } else {
          data = JSON.parse(el.textContent);
          appDataCache = { text: el.textContent, parsed: data };
        }
        if (!data) return null;
        const reactQueryData = data?.appState?.loader?.dataByRouteId?.bd56?.reactQueryData;
        const markPrice = reactQueryData?.[`queryMarkPrice,${symbol}`]?.markPrice || null;
        const toStr = (v) => {
          if (typeof v === "string" && v) return v;
          if (typeof v === "number" && Number.isFinite(v)) return String(v);
          return null;
        };
        return toStr(markPrice);
      } catch (_e) {
        return null;
      }
    }
    function getReferencePrice(symbol, priceOverride) {
      const fromOverride = normalizeDecimalString(priceOverride);
      if (fromOverride) return fromOverride;
      const priceInput = findPriceInput();
      const fromInput = normalizeDecimalString(priceInput?.value || "");
      if (fromInput) return fromInput;
      const fromAppData = readMarkPriceFromAppData(symbol);
      return normalizeDecimalString(fromAppData);
    }
    function getQtyRuleContext(symbol, tradeMode, priceOverride) {
      const rules = symbol ? rulesCache[symbol] : null;
      if (!rules) return { status: "pending" };
      const orderType = getCurrentOrderType();
      const isMarketOrder = orderType.includes("MARKET");
      const baseMinQty = normalizeDecimalString(
        (isMarketOrder ? rules.marketMinQty : rules.limitMinQty) || rules.limitMinQty
      );
      const stepSize = normalizeDecimalString(
        (isMarketOrder ? rules.marketStepSize : rules.limitStepSize) || rules.limitStepSize
      );
      if (!baseMinQty || !stepSize) return { status: "pending" };
      const referencePrice = getReferencePrice(symbol, priceOverride);
      const minNotionalQty = tradeMode === "OPEN" && rules.minNotional && referencePrice && stepSize ? ceilQtyByNotional(rules.minNotional, referencePrice, stepSize) : null;
      const effectiveMinQty = maxDecimalString(baseMinQty, minNotionalQty);
      return {
        status: "ready",
        orderType,
        baseMinQty,
        stepSize,
        minNotional: normalizeDecimalString(rules.minNotional),
        referencePrice,
        minNotionalQty,
        effectiveMinQty
      };
    }
    function multiplierKey(mode, symbol) {
      const normalizedSymbol = String(symbol || getCurrentSymbol() || "").toUpperCase();
      if (!normalizedSymbol) return null;
      const normalizedMode = mode === "OPEN" ? "OPEN" : "CLOSE";
      return `${LOCAL_QTY_MULTIPLIER_PREFIX}:${normalizedMode}:${normalizedSymbol}`;
    }
    function loadMultiplier(mode, symbol) {
      const key = multiplierKey(mode || getActiveTradeMode(), symbol);
      if (!key) return DEFAULT_MULTIPLIER;
      const value = localStorage.getItem(key);
      return isValidMultiplier(value) ? String(value) : DEFAULT_MULTIPLIER;
    }
    function saveMultiplier(value, mode, symbol) {
      const key = multiplierKey(mode || getActiveTradeMode(), symbol);
      if (!key) return;
      localStorage.setItem(key, value);
    }
    function sanitizeMultiplier(value) {
      return isValidMultiplier(value) ? String(value).trim() : DEFAULT_MULTIPLIER;
    }
    function updateMultiplier(nextValue) {
      const input = document.getElementById(INPUT_ID);
      const normalized = sanitizeMultiplier(nextValue);
      isEditingMultiplier = false;
      saveMultiplier(normalized, getActiveTradeMode(), getCurrentSymbol());
      if (input) input.value = normalized;
      renderPanel();
    }
    function setNativeActionButtonDisabled(button, disabled) {
      if (!button) return;
      const alreadyDisabled = button.getAttribute(NATIVE_ACTION_DISABLED_ATTR) === "true";
      if (disabled === alreadyDisabled) {
        if (disabled) controlledNativeButtons.add(button);
        else controlledNativeButtons.delete(button);
        return;
      }
      if (disabled) {
        button.setAttribute(NATIVE_ACTION_DISABLED_ATTR, "true");
        button.disabled = true;
        button.setAttribute("aria-disabled", "true");
        controlledNativeButtons.add(button);
        return;
      }
      button.removeAttribute(NATIVE_ACTION_DISABLED_ATTR);
      button.disabled = false;
      button.setAttribute("aria-disabled", "false");
      controlledNativeButtons.delete(button);
    }
    function syncNativeCloseButtons(tradeMode, closeContext) {
      const { closeLongBtn, closeShortBtn, knowsLong, knowsShort, hasLong, hasShort } = closeContext;
      const desiredStates = /* @__PURE__ */ new Map();
      if (tradeMode === "CLOSE") {
        if (knowsLong) desiredStates.set(closeLongBtn, !hasLong);
        if (knowsShort) desiredStates.set(closeShortBtn, !hasShort);
      }
      for (const button of Array.from(controlledNativeButtons)) {
        if (!button.isConnected) {
          controlledNativeButtons.delete(button);
          continue;
        }
        if (desiredStates.get(button) !== true) {
          setNativeActionButtonDisabled(button, false);
        }
      }
      for (const [button, shouldDisable] of desiredStates.entries()) {
        if (!button) continue;
        const isDisabledByUs = button.getAttribute(NATIVE_ACTION_DISABLED_ATTR) === "true";
        if (shouldDisable === isDisabledByUs) continue;
        setNativeActionButtonDisabled(button, shouldDisable);
      }
    }
    function ladderOptionButton(label, value, selected, group) {
      const activeStyle = selected ? "border-color:var(--color-PrimaryYellow);background:var(--color-BadgeBg);color:#1e2329;font-weight:600;" : "border-color:#d5d9e2;background:#ffffff;color:#5e6673;font-weight:500;";
      return `<button type="button" data-ladder-group="${group}" data-ladder-value="${value}" style="height:24px;min-width:34px;padding:0 6px;border-radius:5px;border:1px solid #d5d9e2;font-size:12px;line-height:22px;cursor:pointer;${activeStyle}">${label}</button>`;
    }
    function ladderOptionRow(title, options, selected, group, suffix = "") {
      return [
        '<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-top:6px;">',
        `<span style="width:28px;color:#76808f;font-size:12px;">${title}</span>`,
        ...options.map((value) => ladderOptionButton(`${value}${suffix}`, value, Number(value) === Number(selected), group)),
        "</div>"
      ].join("");
    }
    function ladderStepRow() {
      const value = getLadderStep();
      const decDisabled = value <= LADDER_STEP_MIN;
      const incDisabled = value >= LADDER_STEP_MAX;
      const stepButton = (action, label, disabled) => {
        const disabledAttrs = disabled ? ' disabled aria-disabled="true"' : "";
        const style = disabled ? `border-color:${DISABLED_CONTROL_BORDER};background:${DISABLED_CONTROL_BG};color:${DISABLED_CONTROL_TEXT};cursor:not-allowed;opacity:${DISABLED_CONTROL_OPACITY};` : "border-color:#d5d9e2;background:#ffffff;color:#5e6673;cursor:pointer;opacity:1;";
        return `<button type="button" data-ladder-step-action="${action}"${disabledAttrs} style="width:28px;height:24px;padding:0;border-radius:5px;border:1px solid #d5d9e2;font-size:14px;line-height:22px;${style}">${label}</button>`;
      };
      return [
        '<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-top:6px;">',
        '<span style="width:28px;color:#76808f;font-size:12px;">幅</span>',
        stepButton("dec", "-", decDisabled),
        `<span style="min-width:26px;height:24px;border:1px solid #d5d9e2;border-radius:5px;background:#ffffff;color:#1e2329;font-size:12px;font-weight:600;line-height:22px;text-align:center;">${value}</span>`,
        stepButton("inc", "+", incDisabled),
        "</div>"
      ].join("");
    }
    function ladderActionButton(actionType, label, tone, disabled = false) {
      const isBuyTone = tone === "BUY";
      const borderColor = disabled ? DISABLED_CONTROL_BORDER : isBuyTone ? "var(--color-Buy)" : "var(--color-Sell)";
      const background = disabled ? DISABLED_CONTROL_BG : isBuyTone ? "var(--color-GreenAlpha01)" : "var(--color-RedAlpha01)";
      const color = disabled ? DISABLED_CONTROL_TEXT : borderColor;
      const disabledAttrs = disabled ? ' disabled aria-disabled="true"' : "";
      return `<button type="button" data-ladder-action="${actionType}"${disabledAttrs} style="height:${LADDER_CONTROL_BUTTON_HEIGHT}px;border:1px solid ${borderColor};border-radius:6px;background:${background};color:${color};font-size:${LADDER_CONTROL_BUTTON_FONT_SIZE}px;line-height:${LADDER_CONTROL_BUTTON_HEIGHT - 2}px;cursor:${disabled ? "not-allowed" : "pointer"};opacity:${disabled ? DISABLED_CONTROL_OPACITY : "1"};">${label}</button>`;
    }
    function getLadderActionRows(tradeMode, closeContext) {
      const ladderRunning = !!ladderTask;
      if (tradeMode === "OPEN") {
        return [
          ladderOptionRow("开", LADDER_OPEN_PERCENTS, getLadderOpenPercent(), "openPercent", "%"),
          ladderOptionRow("档", LADDER_LEVEL_OPTIONS, getLadderLevels(), "levels", ""),
          ladderStepRow(),
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:8px;">',
          ladderActionButton("OPEN_LONG", "阶梯开多", "BUY", ladderRunning),
          ladderActionButton("OPEN_SHORT", "阶梯开空", "SELL", ladderRunning),
          "</div>"
        ];
      }
      const closeLongDisabled = ladderRunning || (closeContext?.knowsLong ? !closeContext.hasLong : false);
      const closeShortDisabled = ladderRunning || (closeContext?.knowsShort ? !closeContext.hasShort : false);
      return [
        ladderOptionRow("平", LADDER_CLOSE_PERCENTS, getLadderClosePercent(), "closePercent", "%"),
        ladderOptionRow("档", LADDER_LEVEL_OPTIONS, getLadderLevels(), "levels", ""),
        ladderStepRow(),
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:8px;">',
        ladderActionButton("CLOSE_SHORT", "阶梯平空", "BUY", closeShortDisabled),
        ladderActionButton("CLOSE_LONG", "阶梯平多", "SELL", closeLongDisabled),
        "</div>"
      ];
    }
    function refreshLadderPanel(panel, tradeMode, closeContext) {
      const toggle = panel.querySelector(`#${LADDER_TOGGLE_ID}`);
      const body = panel.querySelector(`#${LADDER_BODY_ID}`);
      const status = panel.querySelector(`#${LADDER_STATUS_ID}`);
      const expanded = isLadderExpanded();
      const mode = tradeMode === "OPEN" ? "OPEN" : "CLOSE";
      if (toggle) {
        toggle.textContent = `Maker 阶梯 ${expanded ? "▾" : "▸"}`;
      }
      if (body) {
        body.style.display = expanded ? "block" : "none";
        if (expanded) {
          const stopDisabled = !ladderTask;
          const stopDisabledAttrs = stopDisabled ? ' disabled aria-disabled="true"' : "";
          const stopStyle = stopDisabled ? `border-color:${DISABLED_CONTROL_BORDER};background:${DISABLED_CONTROL_BG};color:${DISABLED_CONTROL_TEXT};cursor:not-allowed;opacity:${DISABLED_CONTROL_OPACITY};` : "border-color:#d5d9e2;background:#ffffff;color:#5e6673;cursor:pointer;opacity:1;";
          body.innerHTML = [
            ...getLadderActionRows(mode, closeContext),
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:4px;">',
            `<button type="button" data-ladder-stop="true"${stopDisabledAttrs} style="height:${LADDER_CONTROL_BUTTON_HEIGHT}px;border:1px solid #d5d9e2;border-radius:6px;font-size:${LADDER_CONTROL_BUTTON_FONT_SIZE}px;line-height:${LADDER_CONTROL_BUTTON_HEIGHT - 2}px;${stopStyle}">停止阶梯挂单</button>`,
            `<button type="button" data-ladder-cancel-symbol="true" style="height:${LADDER_CONTROL_BUTTON_HEIGHT}px;border:1px solid #d5d9e2;border-radius:6px;background:#ffffff;color:#5e6673;font-size:${LADDER_CONTROL_BUTTON_FONT_SIZE}px;line-height:${LADDER_CONTROL_BUTTON_HEIGHT - 2}px;cursor:pointer;">撤本币挂单</button>`,
            "</div>"
          ].join("");
        }
      }
      if (status) {
        status.textContent = ladderStatusText;
        status.style.display = expanded || ladderTask || ladderStatusText !== "空闲" ? "block" : "none";
      }
    }
    function refreshComputedInfo(panel, multiplier, qtyRuleContext) {
      const minEl = panel.querySelector("#jh-binance-close-qty-min");
      const finalEl = panel.querySelector("#jh-binance-close-qty-final");
      const hintEl = panel.querySelector(`#${MODE_HINT_ID}`);
      const decBtn = panel.querySelector(`#${DEC_ID}`);
      const incBtn = panel.querySelector(`#${INC_ID}`);
      const sideLongBtn = panel.querySelector(`#${SIDE_LONG_ID}`);
      const sideShortBtn = panel.querySelector(`#${SIDE_SHORT_ID}`);
      const tradeMode = getActiveTradeMode();
      const rulesPending = qtyRuleContext?.status !== "ready";
      const effectiveMinQty = rulesPending ? null : qtyRuleContext?.effectiveMinQty || null;
      const finalQty = effectiveMinQty ? multiplyDecimalByInt(effectiveMinQty, multiplier) : null;
      const closeSide = loadCloseSide();
      const openSide = loadOpenSide();
      const closeContext = resolveDisplayCloseState(readCloseContext(), getCurrentSymbol());
      const { knowsLong, knowsShort, hasLong, hasShort, isPending, isUsingCache } = closeContext;
      const closeMode = hasLong && hasShort ? "dual" : hasLong ? "single_long" : hasShort ? "single_short" : "unknown";
      if (minEl) {
        if (rulesPending) {
          minEl.textContent = "最小量读取中";
        } else if (tradeMode === "OPEN" && qtyRuleContext?.minNotionalQty && qtyRuleContext?.referencePrice) {
          minEl.textContent = `最小 ${effectiveMinQty} (>=${qtyRuleContext.minNotional}U @ ${qtyRuleContext.referencePrice})`;
        } else if (effectiveMinQty) {
          minEl.textContent = `最小 ${effectiveMinQty}`;
        } else {
          minEl.textContent = "最小量读取中";
        }
      }
      if (finalEl) {
        if (rulesPending) {
          finalEl.textContent = "--";
        } else if (isValidMultiplier(multiplier) && finalQty && effectiveMinQty) {
          finalEl.textContent = `${effectiveMinQty} x ${multiplier} = ${finalQty}`;
        } else {
          finalEl.textContent = "请输入正整数倍数";
        }
      }
      if (hintEl) {
        if (tradeMode === "OPEN") {
          const action = openSide === "LONG" ? "开多" : "开空";
          hintEl.textContent = `开仓模式：单击订单簿价格后将${CFG.SAFE_MODE ? "填数量" : action}`;
        } else if (isPending && !isUsingCache) {
          hintEl.textContent = "平仓模式：正在读取可平仓位";
        } else if (isPending && isUsingCache) {
          hintEl.textContent = "平仓模式：正在刷新可平仓位，暂沿用上次识别结果";
        } else if (closeMode === "single_long") {
          hintEl.textContent = `平仓模式：当前仅有多仓，单击订单簿价格后将${CFG.SAFE_MODE ? "填数量" : "平多"}`;
        } else if (closeMode === "single_short") {
          hintEl.textContent = `平仓模式：当前仅有空仓，单击订单簿价格后将${CFG.SAFE_MODE ? "填数量" : "平空"}`;
        } else if (closeMode === "dual") {
          const action = closeSide === "LONG" ? "平多" : "平空";
          hintEl.textContent = `平仓模式：双向持仓时单击订单簿价格后将${CFG.SAFE_MODE ? "填数量" : action}`;
        } else {
          hintEl.textContent = "平仓模式：暂未识别到可平仓位";
        }
      }
      if (decBtn) {
        decBtn.disabled = Number(multiplier) <= 1;
        decBtn.style.opacity = decBtn.disabled ? "0.45" : "1";
        decBtn.style.cursor = decBtn.disabled ? "not-allowed" : "pointer";
      }
      if (incBtn) {
        incBtn.style.opacity = "1";
        incBtn.style.cursor = "pointer";
      }
      if (sideLongBtn) {
        const isOpenMode = tradeMode === "OPEN";
        const isDisabled = isOpenMode ? false : knowsLong ? !hasLong : false;
        const isActive = isOpenMode ? openSide === "LONG" : closeMode === "single_long" || closeMode !== "single_short" && closeSide === "LONG";
        sideLongBtn.textContent = isOpenMode ? "开多" : "平多";
        sideLongBtn.style.order = isOpenMode ? "0" : "1";
        sideLongBtn.disabled = isDisabled;
        sideLongBtn.style.borderColor = isDisabled ? DISABLED_CONTROL_BORDER : isActive ? isOpenMode ? "var(--color-Buy)" : "var(--color-Sell)" : "var(--color-InputLine)";
        sideLongBtn.style.background = isDisabled ? DISABLED_CONTROL_BG : isActive ? isOpenMode ? "var(--color-GreenAlpha01)" : "var(--color-RedAlpha01)" : "#ffffff";
        sideLongBtn.style.color = isDisabled ? DISABLED_CONTROL_TEXT : isActive ? isOpenMode ? "var(--color-Buy)" : "var(--color-Sell)" : "#5e6673";
        sideLongBtn.style.opacity = isDisabled ? DISABLED_CONTROL_OPACITY : "1";
        sideLongBtn.style.cursor = isDisabled ? "not-allowed" : "pointer";
      }
      if (sideShortBtn) {
        const isOpenMode = tradeMode === "OPEN";
        const isDisabled = isOpenMode ? false : knowsShort ? !hasShort : false;
        const isActive = isOpenMode ? openSide === "SHORT" : closeMode === "single_short" || closeMode !== "single_long" && closeSide === "SHORT";
        sideShortBtn.textContent = isOpenMode ? "开空" : "平空";
        sideShortBtn.style.order = isOpenMode ? "1" : "0";
        sideShortBtn.disabled = isDisabled;
        sideShortBtn.style.borderColor = isDisabled ? DISABLED_CONTROL_BORDER : isActive ? isOpenMode ? "var(--color-Sell)" : "var(--color-Buy)" : "var(--color-InputLine)";
        sideShortBtn.style.background = isDisabled ? DISABLED_CONTROL_BG : isActive ? isOpenMode ? "var(--color-RedAlpha01)" : "var(--color-GreenAlpha01)" : "#ffffff";
        sideShortBtn.style.color = isDisabled ? DISABLED_CONTROL_TEXT : isActive ? isOpenMode ? "var(--color-Sell)" : "var(--color-Buy)" : "#5e6673";
        sideShortBtn.style.opacity = isDisabled ? DISABLED_CONTROL_OPACITY : "1";
        sideShortBtn.style.cursor = isDisabled ? "not-allowed" : "pointer";
      }
      syncNativeCloseButtons(tradeMode, closeContext);
      refreshLadderPanel(panel, tradeMode, closeContext);
    }
    function findQtyFormItem(input) {
      if (!input) return null;
      return input.closest('div[target^="unitAmount-"]') || input.closest(".bn-formItem") || input.parentElement || null;
    }
    function ensureSpacer(host, panelHeight) {
      let spacer = document.getElementById(SPACER_ID);
      if (!host || !host.parentElement) {
        if (spacer) spacer.remove();
        return null;
      }
      if (!spacer) {
        spacer = document.createElement("div");
        spacer.id = SPACER_ID;
      }
      spacer.style.width = "100%";
      spacer.style.height = `${panelHeight}px`;
      spacer.style.margin = "8px 0 0 0";
      spacer.style.pointerEvents = "none";
      if (spacer.parentElement !== host.parentElement) {
        host.parentElement.insertBefore(spacer, host.nextSibling);
      } else if (spacer.previousElementSibling !== host) {
        host.parentElement.insertBefore(spacer, host.nextSibling);
      }
      return spacer;
    }
    function placePanelFloating(panel, anchorRect) {
      if (panel.parentElement !== document.body) {
        document.body.appendChild(panel);
      }
      panel.style.position = "fixed";
      panel.style.maxWidth = "none";
      panel.style.margin = "0";
      panel.style.zIndex = "999999";
      if (!anchorRect || !anchorRect.width || !anchorRect.height) {
        panel.style.visibility = "hidden";
        panel.style.pointerEvents = "none";
        return;
      }
      const margin = 8;
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      const panelWidth = Math.min(Math.max(anchorRect.width, 280), viewportWidth - margin * 2);
      const estimatedHeight = Math.max(panel.offsetHeight || 0, 76);
      let left = anchorRect.left;
      left = Math.max(margin, Math.min(left, viewportWidth - panelWidth - margin));
      let top = anchorRect.top;
      top = Math.max(margin, Math.min(top, viewportHeight - estimatedHeight - margin));
      panel.style.width = `${Math.round(panelWidth)}px`;
      panel.style.left = `${Math.round(left)}px`;
      panel.style.top = `${Math.round(top)}px`;
      panel.style.right = "";
      panel.style.bottom = "";
      panel.style.visibility = "visible";
      panel.style.pointerEvents = "auto";
    }
    function positionPanel(panel) {
      const qtyInput = findQtyInput();
      const host = findQtyFormItem(qtyInput);
      const spacer = ensureSpacer(host, Math.max((panel.offsetHeight || 0) + PANEL_BOTTOM_TOOLTIP_GAP, 76));
      const anchorRect = spacer?.getBoundingClientRect() || qtyInput?.getBoundingClientRect() || null;
      placePanelFloating(panel, anchorRect);
    }
    function ensurePanel() {
      let panel = document.getElementById(PANEL_ID);
      if (panel) return panel;
      panel = document.createElement("div");
      panel.id = PANEL_ID;
      panel.style.position = "fixed";
      panel.style.zIndex = "999999";
      panel.style.width = "320px";
      panel.style.padding = "8px 10px";
      panel.style.borderRadius = "10px";
      panel.style.background = "#ffffff";
      panel.style.border = "1px solid #eaecef";
      panel.style.color = "#1e2329";
      panel.style.fontSize = "13px";
      panel.style.lineHeight = "18px";
      panel.style.fontFamily = "BinancePlex, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      panel.style.boxShadow = "none";
      panel.style.visibility = "hidden";
      panel.innerHTML = [
        '<div style="display:flex;align-items:center;justify-content:flex-start;gap:8px;margin-bottom:6px;flex-wrap:wrap;">',
        `<label style="display:flex;align-items:center;gap:6px;"><button id="${INC_ID}" type="button" style="width:32px;height:32px;padding:0;border-radius:6px;border:1px solid #d5d9e2;background:#ffffff;color:#5e6673;font-size:18px;line-height:30px;cursor:pointer;">+</button><button id="${DEC_ID}" type="button" style="width:32px;height:32px;padding:0;border-radius:6px;border:1px solid #d5d9e2;background:#ffffff;color:#5e6673;font-size:18px;line-height:30px;cursor:pointer;">-</button><input id="${INPUT_ID}" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" style="width:60px;height:32px;padding:0 8px;border-radius:8px;border:1px solid ${INPUT_BORDER_COLOR};background:${INPUT_DEFAULT_BG};color:#1e2329;caret-color:${INPUT_FOCUS_COLOR};outline:none;font-size:15px;line-height:32px;transition:border-color .16s ease,background-color .16s ease,box-shadow .16s ease;"><span style="font-size:13px;font-weight:500;color:#5e6673;">倍</span></label>`,
        "</div>",
        '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">',
        '<span id="jh-binance-close-qty-min" style="color:#76808f;"></span>',
        '<span id="jh-binance-close-qty-final" style="font-weight:600;color:#1e2329;"></span>',
        "</div>",
        `<div style="display:flex;align-items:center;gap:4px;margin-top:6px;"><button id="${SIDE_SHORT_ID}" type="button" style="min-width:54px;height:32px;padding:0 12px;border-radius:6px;border:1px solid var(--color-InputLine);background:#ffffff;color:#5e6673;font-size:14px;line-height:30px;cursor:pointer;">平空</button><button id="${SIDE_LONG_ID}" type="button" style="min-width:54px;height:32px;padding:0 12px;border-radius:6px;border:1px solid var(--color-InputLine);background:#ffffff;color:#5e6673;font-size:14px;line-height:30px;cursor:pointer;">平多</button></div>`,
        `<div id="${MODE_HINT_ID}" style="margin-top:6px;color:#76808f;"></div>`,
        '<div style="margin-top:8px;padding-top:8px;border-top:1px solid #eef0f2;">',
        `<button id="${LADDER_TOGGLE_ID}" type="button" style="width:100%;height:28px;padding:0 8px;border-radius:6px;border:1px solid #d5d9e2;background:#ffffff;color:#1e2329;text-align:left;font-size:13px;font-weight:600;cursor:pointer;">Maker 阶梯 ▸</button>`,
        `<div id="${LADDER_BODY_ID}" style="display:none;"></div>`,
        `<div id="${LADDER_STATUS_ID}" style="display:none;margin-top:6px;color:#76808f;font-size:13px;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">空闲</div>`,
        "</div>"
      ].join("");
      document.body.appendChild(panel);
      const input = panel.querySelector(`#${INPUT_ID}`);
      const decBtn = panel.querySelector(`#${DEC_ID}`);
      const incBtn = panel.querySelector(`#${INC_ID}`);
      const sideLongBtn = panel.querySelector(`#${SIDE_LONG_ID}`);
      const sideShortBtn = panel.querySelector(`#${SIDE_SHORT_ID}`);
      const ladderToggle = panel.querySelector(`#${LADDER_TOGGLE_ID}`);
      if (input) {
        input.value = loadMultiplier(getActiveTradeMode(), getCurrentSymbol());
        input.addEventListener("focus", () => {
          isEditingMultiplier = true;
          applyInputVisualState(input, input.value);
          input.select();
        });
        input.addEventListener("input", () => {
          const value = String(input.value || "").replace(/[^\d]/g, "");
          if (input.value !== value) input.value = value;
          if (isValidMultiplier(value)) {
            saveMultiplier(value, getActiveTradeMode(), getCurrentSymbol());
          }
          const symbol = getCurrentSymbol() || "-";
          const qtyRuleContext = getQtyRuleContext(symbol !== "-" ? symbol : null, getActiveTradeMode());
          refreshComputedInfo(panel, value, qtyRuleContext);
          applyInputVisualState(input, value);
        });
        input.addEventListener("blur", () => {
          const value = String(input.value || "").trim();
          const normalized = sanitizeMultiplier(value);
          isEditingMultiplier = false;
          saveMultiplier(normalized, getActiveTradeMode(), getCurrentSymbol());
          input.value = normalized;
          applyInputVisualState(input, normalized);
          renderPanel();
        });
        applyInputVisualState(input, input.value);
      }
      if (decBtn) {
        decBtn.addEventListener("click", () => {
          const current = Number(loadMultiplier(getActiveTradeMode(), getCurrentSymbol()));
          updateMultiplier(String(Math.max(1, current - 1)));
        });
      }
      if (incBtn) {
        incBtn.addEventListener("click", () => {
          const current = Number(loadMultiplier(getActiveTradeMode(), getCurrentSymbol()));
          updateMultiplier(String(current + 1));
        });
      }
      if (sideLongBtn) {
        sideLongBtn.addEventListener("click", () => {
          if (getActiveTradeMode() === "OPEN") {
            updateOpenSide("LONG");
            return;
          }
          updateCloseSide("LONG");
        });
      }
      if (sideShortBtn) {
        sideShortBtn.addEventListener("click", () => {
          if (getActiveTradeMode() === "OPEN") {
            updateOpenSide("SHORT");
            return;
          }
          updateCloseSide("SHORT");
        });
      }
      if (ladderToggle) {
        ladderToggle.addEventListener("click", () => {
          setLadderExpanded(!isLadderExpanded());
        });
      }
      panel.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;
        const optionBtn = target.closest("[data-ladder-group][data-ladder-value]");
        if (optionBtn) {
          const group = optionBtn.getAttribute("data-ladder-group");
          const value = Number(optionBtn.getAttribute("data-ladder-value"));
          if (group === "openPercent") setLadderOpenPercent(value);
          if (group === "closePercent") setLadderClosePercent(value);
          if (group === "levels") setLadderLevels(value);
          return;
        }
        const stepBtn = target.closest("[data-ladder-step-action]");
        if (stepBtn) {
          if (stepBtn.disabled || stepBtn.getAttribute("aria-disabled") === "true") return;
          const delta = stepBtn.getAttribute("data-ladder-step-action") === "inc" ? 1 : -1;
          setLadderStep(getLadderStep() + delta);
          return;
        }
        const actionBtn = target.closest("[data-ladder-action]");
        if (actionBtn) {
          if (actionBtn.disabled || actionBtn.getAttribute("aria-disabled") === "true") return;
          startLadder(actionBtn.getAttribute("data-ladder-action"));
          return;
        }
        const stopBtn = target.closest("[data-ladder-stop]");
        if (stopBtn) {
          if (stopBtn.disabled || stopBtn.getAttribute("aria-disabled") === "true") return;
          stopLadder();
          return;
        }
        const cancelSymbolBtn = target.closest("[data-ladder-cancel-symbol]");
        if (cancelSymbolBtn) {
          if (cancelSymbolBtn.disabled || cancelSymbolBtn.getAttribute("aria-disabled") === "true") return;
          cancelCurrentSymbolOpenOrders();
        }
      });
      return panel;
    }
    function renderPanel() {
      const panel = ensurePanel();
      const input = panel.querySelector(`#${INPUT_ID}`);
      const symbol = getCurrentSymbol() || "-";
      if (symbol !== "-" && !rulesCache[symbol]) {
        ensureRules(symbol).then((rules) => {
          if (rules) scheduleRenderPanel();
        });
      }
      const storedMultiplier = loadMultiplier(getActiveTradeMode(), symbol !== "-" ? symbol : null);
      if (input && !isEditingMultiplier && input.value !== storedMultiplier) {
        input.value = storedMultiplier;
      }
      const multiplier = input ? String((isEditingMultiplier ? input.value : storedMultiplier) || "").trim() : storedMultiplier;
      const qtyRuleContext = getQtyRuleContext(symbol !== "-" ? symbol : null, getActiveTradeMode());
      refreshComputedInfo(panel, multiplier, qtyRuleContext);
      if (input) {
        applyInputVisualState(input, multiplier);
      }
      positionPanel(panel);
    }
    function scheduleRenderPanel(options = {}) {
      const followUpMs = Number(options.followUpMs) > 0 ? Number(options.followUpMs) : 0;
      if (!renderPanelQueued) {
        renderPanelQueued = true;
        window.requestAnimationFrame(() => {
          renderPanelQueued = false;
          renderPanel();
        });
      }
      if (followUpMs > 0) {
        window.clearTimeout(renderPanelFollowUpTimer);
        renderPanelFollowUpTimer = window.setTimeout(() => {
          renderPanel();
        }, followUpMs);
      }
    }
    function clearTradeUiMutationWait() {
      if (tradeUiMutationObserver) {
        tradeUiMutationObserver.disconnect();
        tradeUiMutationObserver = null;
      }
      if (tradeUiMutationTimeout) {
        window.clearTimeout(tradeUiMutationTimeout);
        tradeUiMutationTimeout = 0;
      }
      if (tradeUiMutationDebounceTimer) {
        window.clearTimeout(tradeUiMutationDebounceTimer);
        tradeUiMutationDebounceTimer = 0;
      }
    }
    function waitForTradeUiMutation(options = {}) {
      const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 500;
      clearTradeUiMutationWait();
      if (!document.body) {
        scheduleRenderPanel({ followUpMs: timeoutMs });
        return;
      }
      tradeUiMutationObserver = new MutationObserver((mutations) => {
        let matched = false;
        for (const mutation of mutations) {
          if (mutationTouchesTradeUi(mutation)) {
            matched = true;
            break;
          }
        }
        if (!matched) return;
        invalidateTradeButtonCache();
        applyCachedNativeCloseButtonState();
        window.clearTimeout(tradeUiMutationDebounceTimer);
        tradeUiMutationDebounceTimer = window.setTimeout(() => {
          tradeUiMutationDebounceTimer = 0;
          scheduleRenderPanel();
        }, 50);
      });
      const mutationRoot = getTradeMutationRoot();
      if (!mutationRoot) {
        scheduleRenderPanel({ followUpMs: timeoutMs });
        return;
      }
      tradeUiMutationObserver.observe(mutationRoot, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["aria-selected", "disabled", "aria-disabled", "class", "value"]
      });
      tradeUiMutationTimeout = window.setTimeout(() => {
        clearTradeUiMutationWait();
        scheduleRenderPanel();
      }, timeoutMs);
    }
    function installUiSyncObservers() {
      document.addEventListener("click", (event) => {
        const tab = event.target instanceof Element ? event.target.closest('[role="tab"]') : null;
        if (!isTradeModeTab2(tab)) return;
        const isEnteringClose = (tab.textContent || "").includes("平仓") && tab.getAttribute("aria-selected") !== "true";
        const isEnteringOpen = (tab.textContent || "").includes("开仓") && tab.getAttribute("aria-selected") !== "true";
        if (isEnteringClose) {
          invalidateTradeButtonCache();
          closeGuard = {
            symbol: getCurrentSymbol(),
            expiresAt: Date.now() + 500,
            longZeroStreak: 0,
            shortZeroStreak: 0,
            lastRawLong: void 0,
            lastRawShort: void 0
          };
        }
        if (isEnteringOpen) {
          invalidateTradeButtonCache();
          window.requestAnimationFrame(() => {
            queueAutoOpenLeverageReset("click");
          });
        }
        window.requestAnimationFrame(() => {
          applyCachedCloseUiState();
        });
        scheduleRenderPanel();
        waitForTradeUiMutation();
      }, true);
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type !== "attributes") continue;
          if (mutation.attributeName !== "aria-selected") continue;
          if (!isTradeModeTab2(mutation.target)) continue;
          const isEnteringClose = (mutation.target.textContent || "").includes("平仓") && mutation.target.getAttribute("aria-selected") === "true";
          const isEnteringOpen = (mutation.target.textContent || "").includes("开仓") && mutation.target.getAttribute("aria-selected") === "true";
          if (isEnteringClose) {
            invalidateTradeButtonCache();
            closeGuard = {
              symbol: getCurrentSymbol(),
              expiresAt: Date.now() + 500,
              longZeroStreak: 0,
              shortZeroStreak: 0,
              lastRawLong: void 0,
              lastRawShort: void 0
            };
          }
          if (isEnteringOpen) {
            invalidateTradeButtonCache();
            queueAutoOpenLeverageReset("mutation");
          }
          applyCachedCloseUiState();
          scheduleRenderPanel();
          waitForTradeUiMutation();
          return;
        }
      });
      const startObserve = () => {
        if (!document.body) return;
        observer.observe(document.body, {
          subtree: true,
          attributes: true,
          attributeFilter: ["aria-selected"]
        });
      };
      if (document.body) {
        startObserve();
      } else {
        window.addEventListener("DOMContentLoaded", startObserve, { once: true });
      }
    }
    function resolveTargetQty(tradeMode, priceOverride) {
      const symbol = getCurrentSymbol();
      const qtyRuleContext = getQtyRuleContext(symbol, tradeMode, priceOverride);
      if (qtyRuleContext.status !== "ready" || !qtyRuleContext.effectiveMinQty) {
        if (symbol && !rulesCache[symbol]) ensureRules(symbol);
        return null;
      }
      const multiplier = loadMultiplier(tradeMode, symbol);
      const qty = multiplyDecimalByInt(qtyRuleContext.effectiveMinQty, multiplier);
      if (!qty) return null;
      return {
        qty,
        source: `MULTIPLIER(${multiplier}x @ ${qtyRuleContext.effectiveMinQty})`,
        symbol,
        rule: qtyRuleContext
      };
    }
    document.addEventListener("click", async (e) => {
      try {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
        const priceNode = findClickedPriceNode(e.target);
        if (!priceNode) return;
        if (!e.isTrusted) return;
        if (CFG.DEBUG) {
          log("命中订单簿价格 click", {
            targetClass: e.target?.className || "",
            targetText: (e.target?.textContent || "").trim().slice(0, 24)
          });
        }
        const now = Date.now();
        if (CFG.COOLDOWN_MS > 0 && now - lastTs < CFG.COOLDOWN_MS) {
          if (CFG.DEBUG) warn("跳过：cooldown");
          return;
        }
        const clickedPrice = parsePrice(priceNode);
        if (!clickedPrice) {
          if (CFG.DEBUG) warn("跳过：价格解析失败");
          return;
        }
        const qtyInput = findQtyInput();
        if (!qtyInput) {
          warn("未找到数量输入框");
          return;
        }
        const priceInput = findPriceInput();
        if (!priceInput) {
          warn("未找到价格输入框");
          return;
        }
        const action = resolveTradeAction();
        if (!action || !action.button) {
          warn(`未找到可用${getActiveTradeMode() === "OPEN" ? "开仓" : "平仓"}动作`);
          return;
        }
        const qtyPlan = resolveTargetQty(action.mode, clickedPrice);
        if (!qtyPlan || !qtyPlan.qty) {
          warn("未找到可用数量来源（数量倍率/有效最小量）");
          return;
        }
        lastTs = now;
        setInputValueReact(priceInput, clickedPrice);
        await delay(SINGLE_ORDER_PRICE_SYNC_DELAY_MS);
        setInputValueReact(qtyInput, qtyPlan.qty);
        await delay(SINGLE_ORDER_QTY_SYNC_DELAY_MS);
        const submittedPriceInput = findPriceInput() || priceInput;
        assertSubmittedPriceMatchesClickedPrice(clickedPrice, submittedPriceInput.value);
        const currentSymbol = getCurrentSymbol();
        if (currentSymbol !== qtyPlan.symbol) {
          throw new Error(`交易对已变化，点击时 ${qtyPlan.symbol}，当前 ${currentSymbol || "-"}`);
        }
        if (getActiveTradeMode() !== action.mode) {
          throw new Error("开仓/平仓模式已变化，已停止提交");
        }
        const currentAction = resolveTradeAction();
        if (!currentAction || currentAction.mode !== action.mode || currentAction.side !== action.side || !currentAction.button || currentAction.button.disabled || currentAction.button.getAttribute("aria-disabled") === "true") {
          throw new Error(`提交前${action.side}按钮状态已变化，已停止`);
        }
        log(
          "已填价格/数量",
          clickedPrice,
          qtyPlan.qty,
          "来源",
          qtyPlan.source,
          "symbol",
          qtyPlan.symbol,
          "effectiveMinQty",
          qtyPlan.rule?.effectiveMinQty,
          "referencePrice",
          qtyPlan.rule?.referencePrice,
          "触发价格",
          clickedPrice,
          "mode",
          action.mode,
          "action",
          action.side,
          "by",
          action.by,
          "qtySource",
          action.qtySource,
          "longQty",
          action.longQty,
          "shortQty",
          action.shortQty
        );
        if (CFG.SAFE_MODE) {
          warn(`SAFE_MODE=true，仅填价格/数量，不点击${action.side}`);
          return;
        }
        currentAction.button.click();
        scheduleRenderPanel();
        waitForTradeUiMutation({ timeoutMs: 400 });
        log(`已点击${action.side}`);
      } catch (e2) {
        err("click handler 异常:", e2);
        warn(e2?.message || "订单簿点击提交失败");
      }
    }, true);
    window.addEventListener("storage", (event) => {
      if (event.key?.startsWith(`${LOCAL_QTY_MULTIPLIER_PREFIX}:`) || event.key === LOCAL_CLOSE_SIDE_KEY || event.key === LOCAL_OPEN_SIDE_KEY || event.key === LOCAL_LADDER_EXPANDED_KEY || event.key === LOCAL_LADDER_OPEN_PERCENT_KEY || event.key === LOCAL_LADDER_CLOSE_PERCENT_KEY || event.key === LOCAL_LADDER_LEVELS_KEY || event.key === LOCAL_LADDER_STEP_KEY) scheduleRenderPanel();
    });
    installUiSyncObservers();
    let lastObservedSymbol = getCurrentSymbol();
    function checkSymbolChangeForLeverage() {
      const symbol = getCurrentSymbol();
      if (!symbol || symbol === lastObservedSymbol) return;
      lastObservedSymbol = symbol;
      isEditingMultiplier = false;
      invalidateTradeButtonCache();
      scheduleRenderPanel();
      if (getActiveTradeMode() === "OPEN") {
        queueAutoOpenLeverageReset("symbol_change");
      }
    }
    setInterval(checkSymbolChangeForLeverage, 500);
    window.setTimeout(() => {
      if (getActiveTradeMode() === "OPEN") queueAutoOpenLeverageReset("init");
    }, 1500);
    let renderPanelTimer = document.hidden ? null : setInterval(renderPanel, 1e3);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        clearInterval(renderPanelTimer);
        renderPanelTimer = null;
      } else if (!renderPanelTimer) {
        renderPanel();
        renderPanelTimer = setInterval(renderPanel, 1e3);
      }
    });
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", renderPanel, { once: true });
    } else {
      renderPanel();
    }
    window.__TM_CLOSE_LONG_DEBUG__ = {
      cfg: CFG,
      get cachedCloseState() {
        return getCachedCloseState(getCurrentSymbol());
      },
      get displayCloseState() {
        return lastDisplayCloseState;
      },
      get closeGuard() {
        return closeGuard;
      },
      findQtyInput,
      findPriceInput,
      findCloseLongButton,
      findCloseShortButton,
      findOpenLongButton,
      findOpenShortButton,
      findOrderbookRow,
      findClickedPriceNode,
      findPriceNodeFromRow,
      getCachedPositionState,
      resolveCloseAction,
      resolveTradeAction,
      resolveTargetQty,
      getOrderbookPrices,
      readPersistedBinanceOrderForm,
      isPersistedPostOnlyOrderType,
      ensurePostOnlyPreferencePersisted,
      ensurePostOnlyOrderType,
      buildLadderPlan,
      startLadder,
      stopLadder,
      cancelCurrentSymbolOpenOrders,
      queueAutoOpenLeverageReset,
      renderPanel
    };
    log("脚本加载完成", location.href);
  })();
})();
