// ==UserScript==
// @name         【自写】Binance 订单簿单击下单
// @namespace    binance.orderbook.trade
// @icon         data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%23f0b90b%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2249%22%20text-anchor%3D%22middle%22%20font-family%3D%22Arial%2C%20sans-serif%22%20font-size%3D%2242%22%20font-weight%3D%22800%22%20fill%3D%22%23111827%22%3EJ%3C%2Ftext%3E%3C%2Fsvg%3E
// @icon64       data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%23f0b90b%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2249%22%20text-anchor%3D%22middle%22%20font-family%3D%22Arial%2C%20sans-serif%22%20font-size%3D%2242%22%20font-weight%3D%22800%22%20fill%3D%22%23111827%22%3EJ%3C%2Ftext%3E%3C%2Fsvg%3E
// @version      2.7.177
// @author       jackhai9
// @description  单击订单簿价格，按当前开仓/平仓 tab 自动填数量并执行下单，内置数量倍率面板
// @match        https://www.binance.com/*/futures/*
// @match        https://www.binance.com/futures/*
// @exclude      https://www.binance.com/*/my/wallet/futures/*
// @exclude      https://www.binance.com/my/wallet/futures/*
// @updateURL    https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-orderbook-trade.user.js
// @downloadURL  https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-orderbook-trade.user.js
// @run-at       document-start
// @grant        none
// ==/UserScript==
(() => {
  // src/binance-orderbook-trade/contracts/binance-page-text.js
  var freezeLabels = (labels) => Object.freeze(labels);
  var BINANCE_PAGE_TEXT = Object.freeze({
    tradeMode: Object.freeze({
      OPEN: freezeLabels(["开仓", "Open"]),
      CLOSE: freezeLabels(["平仓", "Close"])
    }),
    tradeAction: Object.freeze({
      OPEN_LONG: freezeLabels(["开多", "Open Long"]),
      OPEN_SHORT: freezeLabels(["开空", "Open Short"]),
      CLOSE_LONG: freezeLabels(["平多", "Close Long"]),
      CLOSE_SHORT: freezeLabels(["平空", "Close Short"])
    }),
    availableBalance: freezeLabels(["可用", "Avbl"]),
    postOnly: freezeLabels(["只做Maker", "Post Only"]),
    submitBusy: freezeLabels(["提交中", "Placing", "Loading"]),
    openableQuantity: freezeLabels(["可开"]),
    closeableQuantity: freezeLabels(["可平"]),
    cancelAllDialog: freezeLabels(["确定取消全部订单", "Cancel all orders"]),
    accountOrders: Object.freeze({
      positionTab: freezeLabels(["仓位", "Positions"]),
      openOrdersTab: freezeLabels(["当前委托", "Open Orders"]),
      historyTab: freezeLabels([
        "历史委托",
        "Order History",
        "历史成交",
        "Trade History",
        "资金流水",
        "Transaction History"
      ]),
      basicSubTab: freezeLabels(["基础单", "Basic"]),
      conditionalSubTab: freezeLabels(["条件委托", "Conditional"]),
      panelEvidence: freezeLabels([
        "基础单",
        "Basic",
        "条件委托",
        "Conditional",
        "Open Orders",
        "成交数量",
        "只减仓",
        "只做Maker",
        "Post Only",
        "生效时间",
        "追单",
        "Chase"
      ]),
      currentSymbolEmpty: freezeLabels([
        "暂无当前委托。",
        "You have no open orders."
      ]),
      cancelAll: freezeLabels([
        "全撤",
        "全部撤单",
        "撤销全部",
        "Cancel All"
      ]),
      hideOtherSymbols: freezeLabels(["隐藏其他合约", "Hide Other Symbols"]),
      rowCancel: freezeLabels(["撤销挂单", "Cancel Order"]),
      perpetual: freezeLabels(["永续", "Perp"])
    })
  });
  function normalizeBinancePageText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }
  function normalizeForComparison(value) {
    return normalizeBinancePageText(value).toLocaleLowerCase();
  }
  function matchesBinancePageText(value, labels) {
    const normalized = normalizeForComparison(value);
    return labels.some((label) => normalizeForComparison(label) === normalized);
  }
  function includesBinancePageText(value, labels) {
    const normalized = normalizeForComparison(value);
    return labels.some((label) => normalized.includes(normalizeForComparison(label)));
  }
  function includesCompactBinancePageText(value, labels) {
    const normalized = normalizeForComparison(value).replace(/\s+/g, "");
    return labels.some((label) => normalized.includes(normalizeForComparison(label).replace(/\s+/g, "")));
  }
  function startsWithBinancePageText(value, labels) {
    const normalized = normalizeForComparison(value);
    return labels.some((label) => {
      const normalizedLabel = normalizeForComparison(label);
      return normalized === normalizedLabel || normalized.startsWith(`${normalizedLabel}(`) || normalized.startsWith(`${normalizedLabel} (`);
    });
  }
  function parseBinanceTabCount(value, labels) {
    const normalized = normalizeForComparison(value);
    for (const label of labels) {
      const normalizedLabel = normalizeForComparison(label);
      if (!normalized.startsWith(normalizedLabel)) continue;
      const suffix = normalized.slice(normalizedLabel.length);
      const match = /^\s*\(\s*(\d+)\s*\)$/.exec(suffix);
      return match ? Number(match[1]) : null;
    }
    return null;
  }
  function buildBinanceTextAlternation(labels) {
    return labels.map((label) => String(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  }
  function hasBinanceCurrentSymbolOpenOrdersEmptyText(value) {
    return includesBinancePageText(value, BINANCE_PAGE_TEXT.accountOrders.currentSymbolEmpty);
  }
  function isBinanceCancelAllText(value) {
    return matchesBinancePageText(value, BINANCE_PAGE_TEXT.accountOrders.cancelAll);
  }

  // src/binance-orderbook-trade/contracts/panel-copy.js
  var UI_LOCALE_ZH_CN = "zh-CN";
  var UI_LOCALE_EN = "en";
  var SUPPORTED_UI_LOCALES = Object.freeze([
    UI_LOCALE_ZH_CN,
    UI_LOCALE_EN
  ]);
  function localizedText(zhCN, en) {
    if (typeof zhCN !== "string" || zhCN === "" || typeof en !== "string" || en === "") {
      throw new Error("Localized UI text requires non-empty Chinese and English values");
    }
    return Object.freeze({ zhCN, en });
  }
  function isLocalizedText(value) {
    return Boolean(
      value && typeof value === "object" && typeof value.zhCN === "string" && typeof value.en === "string"
    );
  }
  function formatLocalizedText(value, locale) {
    if (typeof value === "string") return value;
    if (!isLocalizedText(value)) throw new Error("Invalid localized UI text");
    if (locale === UI_LOCALE_ZH_CN) return value.zhCN;
    if (locale === UI_LOCALE_EN) return value.en;
    throw new Error(`Unsupported UI locale: ${locale}`);
  }
  function combineLocalizedText(parts, separator = "") {
    if (!Array.isArray(parts) || typeof separator !== "string") {
      throw new Error("Invalid localized UI text composition");
    }
    return localizedText(
      parts.map((part) => formatLocalizedText(part, UI_LOCALE_ZH_CN)).join(separator),
      parts.map((part) => formatLocalizedText(part, UI_LOCALE_EN)).join(separator)
    );
  }
  function resolveUiLocaleFromPathname(pathname) {
    const firstSegment = String(pathname || "").split(/[?#]/, 1)[0].split("/").filter(Boolean)[0];
    return firstSegment?.toLowerCase() === "zh-cn" ? UI_LOCALE_ZH_CN : UI_LOCALE_EN;
  }
  var freezeCopy = (copy) => Object.freeze(copy);
  var PANEL_COPY = Object.freeze({
    section: freezeCopy({
      singleOrder: localizedText("单击下单", "Single Order"),
      ladderMaker: localizedText("阶梯下单 · Maker", "Ladder Orders · Maker")
    }),
    field: freezeCopy({
      clickOrderbook: localizedText("单击订单簿时", "On click"),
      minimumOrderQuantity: localizedText("最小下单量的", "Minimum order qty"),
      minimumOpenQuantity: localizedText("最小开仓量的", "Minimum open qty"),
      minimumCloseQuantity: localizedText("最小平仓量的", "Minimum close qty"),
      ratio: localizedText("比例", "Ratio"),
      orderCount: localizedText("笔数", "Orders"),
      interval: localizedText("间距", "Gap"),
      pricePrecision: localizedText("精度", "Precision"),
      multiplierUnit: localizedText("倍", "×")
    }),
    action: freezeCopy({
      openLong: localizedText("阶梯开多", "Open Long"),
      openShort: localizedText("阶梯开空", "Open Short"),
      closeLong: localizedText("阶梯平多", "Close Long"),
      closeShort: localizedText("阶梯平空", "Close Short"),
      cancel: localizedText("撤单", "Cancel"),
      cancelRunning: localizedText("撤单处理中", "Cancelling"),
      noOrders: localizedText("无挂单", "No Orders"),
      accountRebalance: localizedText("账户再平衡", "Account Rebalance"),
      stopLadderByAction: freezeCopy({
        OPEN_LONG: localizedText("停止开多", "Stop Open Long"),
        OPEN_SHORT: localizedText("停止开空", "Stop Open Short"),
        CLOSE_LONG: localizedText("停止平多", "Stop Close Long"),
        CLOSE_SHORT: localizedText("停止平空", "Stop Close Short")
      })
    }),
    side: freezeCopy({
      long: localizedText("多", "Long"),
      short: localizedText("空", "Short"),
      openLong: localizedText("开多", "Open Long"),
      openShort: localizedText("开空", "Open Short"),
      closeLong: localizedText("平多", "Close Long"),
      closeShort: localizedText("平空", "Close Short")
    }),
    state: freezeCopy({
      idle: localizedText("空闲", "Idle"),
      allPositionsClosed: localizedText("已全部平仓", "All positions closed"),
      waitingTradeMode: localizedText("等待开仓/平仓状态", "Waiting for trade mode"),
      waitingPricePrecision: localizedText("等待价格精度", "Waiting for precision"),
      minimumQuantityLoading: localizedText("最小量读取中", "Loading minimum qty"),
      positiveIntegerMultiplier: localizedText("请输入正整数倍数", "Enter a positive integer"),
      noClosablePosition: localizedText("暂无可平仓位", "No position to close")
    }),
    status: freezeCopy({
      precisionUpdated: localizedText("精度推荐已更新", "Precision recommendation updated"),
      precisionInsufficient: localizedText(
        "近期价格变化不足，请稍后重试",
        "Recent price movement is insufficient. Try again later."
      )
    }),
    aria: freezeCopy({
      decrementMultiplier: localizedText("减少倍数", "Decrease multiplier"),
      incrementMultiplier: localizedText("增加倍数", "Increase multiplier")
    }),
    rebalanceDialog: freezeCopy({
      targetSummary: localizedText(
        "目标分配：资金 50% / 现货 40% / U本位 10%",
        "Target allocation: Funding 50% / Spot 40% / USDⓈ-M Futures 10%"
      ),
      accountHeading: localizedText("账户", "Account"),
      currentHeading: localizedText("当前 (USDT)", "Current (USDT)"),
      targetHeading: localizedText("目标 (USDT)", "Target (USDT)"),
      transferHeading: localizedText("划转计划", "Transfer Plan"),
      cancel: localizedText("取消", "Cancel"),
      confirm: localizedText("确认再平衡", "Confirm Rebalance")
    }),
    tooltip: freezeCopy({
      singleOrder: localizedText(
        "单击订单簿中的某个价格，按当前方向和数量设置提交一笔订单。",
        "Click a price in the order book to submit one order using the current side and quantity settings."
      ),
      ladderMaker: localizedText(
        "根据当前比例、笔数、间距和价格精度设置，依次提交只做 Maker 的阶梯订单。",
        "Submit Post Only ladder orders sequentially using the current ratio, order count, gap, and precision."
      ),
      ratio: localizedText(
        "本次阶梯下单使用可开/可平数量的百分比。",
        "Percentage of the available open or close quantity used by this ladder."
      ),
      orderCount: localizedText(
        "计划拆分成多少笔阶梯订单。",
        "Number of orders in the ladder."
      ),
      interval: localizedText(
        "相邻订单跨越多少个订单簿价格级别。",
        "Number of order-book price levels between adjacent orders."
      ),
      pricePrecision: localizedText(
        "与订单簿中的价格精度联动。黄点表示推荐值。比例、笔数、间距会随所选精度恢复对应设置。",
        "Linked to the order-book price precision. The yellow dot marks the recommendation. Ratio, orders, and gap restore their saved values for the selected precision."
      ),
      continuousClose: localizedText(
        "Option/Alt + 单击：连续交易",
        "Option/Alt + click: continuous trading"
      ),
      accountRebalance: localizedText(
        "将资金、现货和 U 本位账户的 USDT 按 5:4:1 分配",
        "Allocate USDT across Funding, Spot, and USDⓈ-M Futures accounts at a 5:4:1 ratio"
      )
    })
  });
  function formatPrecisionRefreshTooltip(tradeCount) {
    const count = Number(tradeCount);
    if (!Number.isInteger(count) || count <= 1) {
      throw new Error(`价格精度成交样本数无效：${tradeCount}`);
    }
    return localizedText(
      `优先根据最新 ${count} 条成交价；价格变化不足时自动扩大范围，重新计算推荐精度。`,
      `Use the latest ${count} trades first; expand the range when price movement is insufficient and recalculate the recommended precision.`
    );
  }

  // src/binance-orderbook-trade/core/cancel-orders.js
  var PERPETUAL_LABEL_PATTERN = buildBinanceTextAlternation(
    BINANCE_PAGE_TEXT.accountOrders.perpetual
  );
  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }
  function isOpenOrdersTabText(text) {
    return startsWithBinancePageText(text, BINANCE_PAGE_TEXT.accountOrders.openOrdersTab);
  }
  function parseOpenOrdersTabCount(text) {
    return parseBinanceTabCount(text, BINANCE_PAGE_TEXT.accountOrders.openOrdersTab);
  }
  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function normalizeContractCandidate(candidate, separator) {
    const normalized = String(candidate || "").toUpperCase();
    if (separator === ":") {
      const timeJoinedMatch = /^\d{1,2}([A-Z][A-Z0-9]*(?:USDT|USDC))$/.exec(normalized);
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
    return new RegExp(
      `(?:^|[^A-Z0-9]|\\d{1,2}:\\d{2})${symbolPattern}\\s*(?:${PERPETUAL_LABEL_PATTERN})(?=\\s|$)`,
      "i"
    ).test(String(text || ""));
  }
  function readVisibleOpenOrderSymbolsText(text) {
    const normalized = String(text || "").toUpperCase();
    const symbols = /* @__PURE__ */ new Set();
    const pattern = new RegExp(
      `([A-Z0-9]{2,30}(?:USDT|USDC))\\s*(?:${PERPETUAL_LABEL_PATTERN})(?=\\s|$)`,
      "gi"
    );
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
  function isOpenOrdersScopeConfirmedForSymbolText(text, symbol, filterChecked) {
    if (filterChecked !== true) return false;
    const visibleSymbols = readVisibleOpenOrderSymbolsText(text);
    if (visibleSymbols.length > 0) return isOpenOrdersScopeLimitedToSymbolText(text, symbol);
    return true;
  }
  function isCurrentSymbolOpenOrdersFilterReady({
    scopeText,
    symbol,
    filterChecked,
    cancelAllAvailable
  }) {
    if (filterChecked !== true) return false;
    const visibleSymbols = readVisibleOpenOrderSymbolsText(scopeText);
    if (visibleSymbols.length > 0) {
      return isOpenOrdersScopeLimitedToSymbolText(scopeText, symbol);
    }
    return !cancelAllAvailable && hasBinanceCurrentSymbolOpenOrdersEmptyText(scopeText);
  }
  function isFilteredCurrentSymbolOpenOrdersEmpty({
    scopeText,
    symbol,
    filterChecked,
    cancelAllAvailable
  }) {
    if (!String(symbol || "").trim()) return false;
    if (filterChecked !== true || cancelAllAvailable) return false;
    if (!hasBinanceCurrentSymbolOpenOrdersEmptyText(scopeText)) return false;
    return readVisibleOpenOrderSymbolsText(scopeText).length === 0;
  }
  function isCurrentSymbolOpenOrdersClearCandidate({ scopeText, symbol, openOrdersCount }) {
    const visibleSymbols = readVisibleOpenOrderSymbolsText(scopeText);
    if (visibleSymbols.length > 0 && !isOpenOrdersScopeLimitedToSymbolText(scopeText, symbol)) {
      return false;
    }
    if (openOrdersCount === 0) return true;
    return visibleSymbols.length === 0;
  }
  function isCurrentSymbolOpenOrdersDefinitivelyClear({ scopeText, symbol, openOrdersCount }) {
    return openOrdersCount === 0 && isCurrentSymbolOpenOrdersClearCandidate({
      scopeText,
      symbol,
      openOrdersCount
    });
  }
  function updateOpenOrdersClearStability({
    clearCandidate,
    clearCandidateSince,
    nowMs,
    settleMs
  }) {
    if (!clearCandidate) return { clearCandidateSince: null, cleared: false };
    const nextCandidateSince = clearCandidateSince ?? nowMs;
    return {
      clearCandidateSince: nextCandidateSince,
      cleared: nowMs - nextCandidateSince >= settleMs
    };
  }
  function shouldContinueOpenOrdersClearObservation({
    nowMs,
    deadlineMs,
    clearCandidate
  }) {
    return nowMs < deadlineMs || clearCandidate;
  }
  function resolveCancelSymbolButtonPresentation({
    ladderRunning,
    cancelRunning,
    noOrdersFeedback
  }) {
    return {
      disabled: Boolean(ladderRunning || cancelRunning),
      label: cancelRunning ? PANEL_COPY.action.cancelRunning : noOrdersFeedback && !ladderRunning ? PANEL_COPY.action.noOrders : PANEL_COPY.action.cancel
    };
  }
  function hasCurrentSymbolOpenOrdersEvidence({
    scopeText,
    symbol,
    symbolFilterOk,
    cancelAllAvailable
  }) {
    const normalizedSymbol = String(symbol || "").toUpperCase();
    if (!normalizedSymbol) return false;
    const visibleSymbols = readVisibleOpenOrderSymbolsText(scopeText);
    if (visibleSymbols.some((visibleSymbol) => visibleSymbol === normalizedSymbol || hasVisibleContractText(scopeText, normalizedSymbol) && isTimestampJoinedCandidate(visibleSymbol, normalizedSymbol))) return true;
    if (visibleSymbols.length > 0) return false;
    return Boolean(symbolFilterOk && cancelAllAvailable);
  }

  // src/binance-orderbook-trade/core/close-action.js
  function resolveConfirmedCloseDirection(closeContext, selectedSide) {
    if (!closeContext?.knowsLong || !closeContext?.knowsShort) return null;
    if (closeContext.hasLong && closeContext.hasShort) {
      return selectedSide === "SHORT" ? "SHORT" : "LONG";
    }
    if (closeContext.hasLong) return "LONG";
    if (closeContext.hasShort) return "SHORT";
    return null;
  }
  function resolveCloseDisplayQuantities({
    rawLongQty,
    rawShortQty,
    cachedLongQty = null,
    cachedShortQty = null,
    transitionPending = false
  }) {
    if (transitionPending) {
      return {
        longQty: cachedLongQty,
        shortQty: cachedShortQty,
        isUsingCache: cachedLongQty != null || cachedShortQty != null,
        shouldCommit: false
      };
    }
    return {
      longQty: rawLongQty ?? cachedLongQty,
      shortQty: rawShortQty ?? cachedShortQty,
      isUsingCache: rawLongQty == null && cachedLongQty != null || rawShortQty == null && cachedShortQty != null,
      shouldCommit: rawLongQty != null || rawShortQty != null
    };
  }
  function shouldDisableCloseControl({
    actionDisabled = false,
    knowsPosition,
    hasPosition
  }) {
    return Boolean(actionDisabled || knowsPosition && !hasPosition);
  }

  // src/binance-orderbook-trade/core/auto-open-leverage.js
  var POSITION_STATUSES = /* @__PURE__ */ new Set(["unknown", "has_position", "flat"]);
  function createPositionPayloadContractError(message) {
    const error = new Error(message);
    error.name = "PositionPayloadContractError";
    return error;
  }
  function parsePositionAmount(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && /^-?(?:\d+\.?\d*|\.\d+)$/.test(value.trim())) {
      return Number(value);
    }
    throw createPositionPayloadContractError(`持仓数量无效：${String(value)}`);
  }
  function resolveSymbolPositionStatus(payload, symbol) {
    if (payload?.success !== true) throw createPositionPayloadContractError("持仓接口返回失败");
    if (!Array.isArray(payload.data)) throw createPositionPayloadContractError("持仓接口数据格式异常");
    if (!symbol) throw createPositionPayloadContractError("持仓接口缺少交易对");
    const positions = payload.data.filter((position) => position?.symbol === symbol);
    const hasPosition = positions.some((position) => parsePositionAmount(position.positionAmount) !== 0);
    return {
      status: hasPosition ? "has_position" : "flat",
      matchingPositionCount: positions.length
    };
  }
  function resolveSymbolPositionSideStatus(payload, symbol, side) {
    if (payload?.success !== true) throw createPositionPayloadContractError("持仓接口返回失败");
    if (!Array.isArray(payload.data)) throw createPositionPayloadContractError("持仓接口数据格式异常");
    if (!symbol) throw createPositionPayloadContractError("持仓接口缺少交易对");
    if (side !== "LONG" && side !== "SHORT") {
      throw createPositionPayloadContractError(`目标持仓方向无效：${String(side)}`);
    }
    const positions = payload.data.filter((position) => position?.symbol === symbol);
    let matchingPositionCount = 0;
    let hasPosition = false;
    for (const position of positions) {
      const positionSide = position.positionSide;
      if (!["BOTH", "LONG", "SHORT"].includes(positionSide)) {
        throw createPositionPayloadContractError(`持仓方向无效：${String(positionSide)}`);
      }
      const amount = parsePositionAmount(position.positionAmount);
      if (positionSide === side) {
        matchingPositionCount += 1;
        if (amount !== 0) hasPosition = true;
        continue;
      }
      if (positionSide === "BOTH") {
        matchingPositionCount += 1;
        if (side === "LONG" && amount > 0 || side === "SHORT" && amount < 0) {
          hasPosition = true;
        }
      }
    }
    return {
      status: hasPosition ? "has_position" : "flat",
      matchingPositionCount
    };
  }
  function observeAutoOpenLeveragePositionState(previousState, observation) {
    const { symbol, status } = observation;
    if (!symbol) throw new Error("自动杠杆检查缺少交易对");
    if (!POSITION_STATUSES.has(status)) {
      throw new Error(`自动杠杆持仓状态无效：${status}`);
    }
    const isSameSymbol = previousState?.symbol === symbol;
    const previousKnownStatus = isSameSymbol ? previousState.lastKnownStatus : null;
    const lastKnownStatus = status === "unknown" ? previousKnownStatus : status;
    return {
      state: { symbol, lastKnownStatus },
      shouldReset: status === "flat" && previousKnownStatus !== "flat"
    };
  }

  // src/binance-orderbook-trade/core/decimal.js
  function pow10(exp) {
    let result = 1n;
    for (let i = 0; i < exp; i += 1) result *= 10n;
    return result;
  }
  function parseDecimalString(value) {
    const raw = String(value ?? "").replace(/,/g, "").trim();
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
    const num = parseDecimalString(numerator);
    const den = parseDecimalString(denominator);
    if (!parsed || !num || !den || num.digits <= 0n || den.digits <= 0n) return null;
    const denominatorIntegerDigits = Math.max(0, den.digits.toString().length - den.scale);
    const resultScale = parsed.scale + num.scale + Math.max(0, denominatorIntegerDigits - 1);
    let scaledNumerator = parsed.digits * num.digits;
    let scaledDenominator = den.digits;
    const scaleExp = den.scale + resultScale - parsed.scale - num.scale;
    if (scaleExp >= 0) {
      scaledNumerator *= pow10(scaleExp);
    } else {
      scaledDenominator *= pow10(-scaleExp);
    }
    const digits = scaledNumerator / scaledDenominator;
    return formatDecimalParts(digits, resultScale);
  }
  function isPositiveDecimalString(value) {
    const parsed = parseDecimalString(value);
    return !!parsed && parsed.digits > 0n;
  }

  // src/binance-orderbook-trade/core/usdt-rebalance.js
  var USDT_SCALE = 8;
  var ACCOUNT_ORDER = ["FUNDING", "MAIN", "UMFUTURE"];
  var USDT_REBALANCE_ACCOUNTS = Object.freeze({
    FUNDING: Object.freeze({
      accountType: "CARD",
      bapiCode: "CARD",
      label: "资金",
      ratio: 50
    }),
    MAIN: Object.freeze({
      accountType: "MAIN",
      bapiCode: "MAIN",
      label: "现货",
      ratio: 40
    }),
    UMFUTURE: Object.freeze({
      accountType: "FUTURE",
      bapiCode: "FUTURE",
      label: "U本位合约",
      ratio: 10
    })
  });
  function parsePositionAmount2(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && /^-?(?:\d+\.?\d*|\.\d+)$/.test(value.trim())) {
      return Number(value);
    }
    throw new Error(`持仓数量无效：${String(value)}`);
  }
  function requireDecimal(value, message) {
    const normalized = normalizeDecimalString(value);
    if (normalized == null) throw new Error(message);
    return normalized;
  }
  function decimalToUnits(value) {
    const normalized = requireDecimal(value, `USDT 余额无效：${String(value)}`);
    const parsed = parseDecimalString(normalized);
    if (parsed.scale > USDT_SCALE) throw new Error("USDT 余额精度超过 8 位");
    return parsed.digits * 10n ** BigInt(USDT_SCALE - parsed.scale);
  }
  function unitsToDecimal(units) {
    return formatDecimalParts(units, USDT_SCALE);
  }
  function isZeroDecimal(value) {
    return decimalToUnits(value) === 0n;
  }
  function resolveAllFuturesPositionStatus(payload) {
    if (payload?.success !== true) throw new Error(payload?.message || "持仓接口返回失败");
    if (!Array.isArray(payload.data)) throw new Error("持仓接口数据格式异常");
    let positionCount = 0;
    for (const position of payload.data) {
      if (!position || typeof position.symbol !== "string" || !position.symbol) {
        throw new Error("持仓接口缺少交易对");
      }
      if (parsePositionAmount2(position.positionAmount) !== 0) positionCount += 1;
    }
    return {
      status: positionCount === 0 ? "flat" : "has_position",
      positionCount
    };
  }
  function readWalletUsdtBalance(wallet, account) {
    if (wallet.activate !== true) throw new Error(`${account.label}账户未启用`);
    if (!Array.isArray(wallet.assetBalances)) {
      throw new Error(`${account.label}账户余额格式异常`);
    }
    const matches = wallet.assetBalances.filter((asset) => asset?.asset === "USDT");
    if (matches.length > 1) throw new Error(`${account.label}账户存在重复的 USDT 余额`);
    if (matches.length === 0) return "0";
    const balance = matches[0];
    const free = requireDecimal(balance.free, `${account.label}账户 USDT 可用余额无效`);
    const locked = requireDecimal(balance.locked, `${account.label}账户 USDT 锁定余额无效`);
    const freeze = requireDecimal(balance.freeze, `${account.label}账户 USDT 冻结余额无效`);
    const withdrawing = requireDecimal(
      balance.withdrawing,
      `${account.label}账户 USDT 划出中余额无效`
    );
    if (![locked, freeze, withdrawing].every(isZeroDecimal)) {
      throw new Error(`${account.label}账户仍有不可划转 USDT`);
    }
    return free;
  }
  function parseUsdtWalletBalances(payload) {
    if (payload?.success !== true) throw new Error(payload?.message || "钱包余额接口返回失败");
    if (!Array.isArray(payload.data)) throw new Error("钱包余额接口数据格式异常");
    const balances = {};
    for (const accountCode of ACCOUNT_ORDER) {
      const account = USDT_REBALANCE_ACCOUNTS[accountCode];
      const matches = payload.data.filter((wallet) => wallet?.accountType === account.accountType);
      if (matches.length === 0) throw new Error(`钱包余额缺少 ${account.label}账户`);
      if (matches.length > 1) throw new Error(`钱包余额存在重复的${account.label}账户`);
      const free = readWalletUsdtBalance(matches[0], account);
      balances[accountCode] = accountCode === "UMFUTURE" ? null : free;
    }
    return balances;
  }
  function withFuturesTransferableBalance(balances, payload) {
    if (payload?.success !== true) {
      throw new Error(`U本位可划转余额读取失败：${payload?.message || "未知错误"}`);
    }
    const transferable = requireDecimal(payload.data, "U本位可划转余额无效");
    return {
      FUNDING: balances.FUNDING,
      MAIN: balances.MAIN,
      UMFUTURE: transferable
    };
  }
  function buildUsdtRebalancePlan(rawBalances) {
    const beforeUnits = Object.fromEntries(
      ACCOUNT_ORDER.map((accountCode) => [accountCode, decimalToUnits(rawBalances[accountCode])])
    );
    const totalUnits = ACCOUNT_ORDER.reduce((sum, accountCode) => sum + beforeUnits[accountCode], 0n);
    const targetUnits = {
      FUNDING: totalUnits * 50n / 100n,
      MAIN: totalUnits * 40n / 100n,
      UMFUTURE: 0n
    };
    targetUnits.UMFUTURE = totalUnits - targetUnits.FUNDING - targetUnits.MAIN;
    const donors = ACCOUNT_ORDER.filter((accountCode) => beforeUnits[accountCode] > targetUnits[accountCode]).map((accountCode) => ({
      accountCode,
      remaining: beforeUnits[accountCode] - targetUnits[accountCode]
    }));
    const recipients = ACCOUNT_ORDER.filter((accountCode) => beforeUnits[accountCode] < targetUnits[accountCode]).map((accountCode) => ({
      accountCode,
      remaining: targetUnits[accountCode] - beforeUnits[accountCode]
    }));
    const transfers = [];
    let donorIndex = 0;
    let recipientIndex = 0;
    while (donorIndex < donors.length && recipientIndex < recipients.length) {
      const donor = donors[donorIndex];
      const recipient = recipients[recipientIndex];
      const amount = donor.remaining < recipient.remaining ? donor.remaining : recipient.remaining;
      if (amount <= 0n) throw new Error("USDT 再平衡计划出现非正划转金额");
      transfers.push({
        from: donor.accountCode,
        to: recipient.accountCode,
        kindType: [
          USDT_REBALANCE_ACCOUNTS[donor.accountCode].bapiCode,
          USDT_REBALANCE_ACCOUNTS[recipient.accountCode].bapiCode
        ].join("_"),
        amount: unitsToDecimal(amount)
      });
      donor.remaining -= amount;
      recipient.remaining -= amount;
      if (donor.remaining === 0n) donorIndex += 1;
      if (recipient.remaining === 0n) recipientIndex += 1;
    }
    if (donors.some((donor) => donor.remaining !== 0n) || recipients.some((recipient) => recipient.remaining !== 0n)) {
      throw new Error("USDT 再平衡计划未闭合");
    }
    if (transfers.length > 2) throw new Error("USDT 再平衡计划超过两笔划转");
    return {
      total: unitsToDecimal(totalUnits),
      before: Object.fromEntries(
        ACCOUNT_ORDER.map((accountCode) => [accountCode, unitsToDecimal(beforeUnits[accountCode])])
      ),
      targets: Object.fromEntries(
        ACCOUNT_ORDER.map((accountCode) => [accountCode, unitsToDecimal(targetUnits[accountCode])])
      ),
      transfers
    };
  }
  function applyUsdtTransferToBalances(rawBalances, transfer) {
    if (!ACCOUNT_ORDER.includes(transfer?.from) || !ACCOUNT_ORDER.includes(transfer?.to)) {
      throw new Error("USDT 划转账户无效");
    }
    if (transfer.from === transfer.to) throw new Error("USDT 划转账户不能相同");
    const balances = Object.fromEntries(
      ACCOUNT_ORDER.map((accountCode) => [accountCode, decimalToUnits(rawBalances[accountCode])])
    );
    const amount = decimalToUnits(transfer.amount);
    if (amount <= 0n) throw new Error("USDT 划转金额必须大于 0");
    if (balances[transfer.from] < amount) throw new Error("USDT 划出账户余额不足");
    balances[transfer.from] -= amount;
    balances[transfer.to] += amount;
    return Object.fromEntries(
      ACCOUNT_ORDER.map((accountCode) => [accountCode, unitsToDecimal(balances[accountCode])])
    );
  }
  function areUsdtBalancesEqual(left, right) {
    return ACCOUNT_ORDER.every(
      (accountCode) => decimalToUnits(left?.[accountCode]) === decimalToUnits(right?.[accountCode])
    );
  }

  // src/binance-orderbook-trade/core/precision.js
  function getOrderbookPrecisionShortcutOptions(options, limit = 4) {
    const normalizedLimit = Number(limit);
    if (!Number.isInteger(normalizedLimit) || normalizedLimit < 1) {
      throw new Error(`价格精度快捷项数量无效：${limit}`);
    }
    return Array.from(new Set(sortedPositiveDecimals(options))).slice(0, normalizedLimit);
  }
  function formatOrderbookPrecisionShortcutLabel(value) {
    const normalized = normalizeDecimalString(value);
    if (!normalized || !isPositiveDecimalString(normalized)) {
      throw new Error(`价格精度快捷值无效：${value}`);
    }
    if (normalized.length <= 5) return normalized;
    const numeric = Number(normalized);
    if (!Number.isFinite(numeric)) {
      throw new Error(`价格精度快捷值不是有限数值：${value}`);
    }
    return numeric.toExponential().replace("e+", "e");
  }
  function collectNonZeroPriceMoves(prices) {
    const moves = [];
    let previous = null;
    for (const price of prices) {
      const current = normalizeDecimalString(price);
      if (!current) continue;
      if (previous) {
        const diff = subtractDecimalStrings(current, previous) || subtractDecimalStrings(previous, current);
        const normalizedDiff = normalizeDecimalString(diff);
        if (normalizedDiff && isPositiveDecimalString(normalizedDiff)) moves.push(normalizedDiff);
      }
      previous = current;
    }
    return moves;
  }
  function sortedPositiveDecimals(values) {
    return (values || []).map((value) => normalizeDecimalString(value)).filter((value) => value && isPositiveDecimalString(value)).sort((a, b) => compareDecimalStrings(a, b));
  }
  function logDistance(a, b) {
    const left = Number(a);
    const right = Number(b);
    if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) return Number.POSITIVE_INFINITY;
    return Math.abs(Math.log10(left) - Math.log10(right));
  }
  function closestPrecisionOption(sample, options) {
    let bestOption = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const option of options) {
      const distance = logDistance(sample, option);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestOption = option;
      }
    }
    return bestOption;
  }
  function recommendOrderbookPrecision({
    samples,
    options,
    minSamples = 5,
    minBucketShare = 0.25
  }) {
    const usableSamples = sortedPositiveDecimals(samples);
    const usableOptions = sortedPositiveDecimals(options);
    if (!usableOptions.length) return null;
    if (usableSamples.length < minSamples) return null;
    const bucketCounts = new Map(usableOptions.map((option) => [option, 0]));
    for (const sample of usableSamples) {
      const option = closestPrecisionOption(sample, usableOptions);
      if (option) bucketCounts.set(option, (bucketCounts.get(option) || 0) + 1);
    }
    const minimumBucketCount = Math.max(minSamples, Math.ceil(usableSamples.length * minBucketShare));
    let selectedOption = null;
    let selectedCount = 0;
    for (const option of usableOptions) {
      const count = bucketCounts.get(option) || 0;
      if (count < minimumBucketCount) continue;
      if (count > selectedCount || count === selectedCount && selectedOption && compareDecimalStrings(option, selectedOption) < 0) {
        selectedOption = option;
        selectedCount = count;
      }
    }
    return selectedOption;
  }
  function recommendOrderbookPrecisionWithExpandingWindow({
    prices,
    options,
    initialLimit = 10,
    expansionStep = 10,
    minSamples = 5,
    minBucketShare = 0.25
  }) {
    if (!Array.isArray(prices)) {
      throw new Error("价格精度成交价样本必须为数组");
    }
    if (!Number.isInteger(initialLimit) || initialLimit < 2) {
      throw new Error(`价格精度初始样本数无效：${initialLimit}`);
    }
    if (!Number.isInteger(expansionStep) || expansionStep < 1) {
      throw new Error(`价格精度样本扩展步长无效：${expansionStep}`);
    }
    if (!Number.isInteger(minSamples) || minSamples < 1) {
      throw new Error(`价格精度最小样本数无效：${minSamples}`);
    }
    let usedCount = Math.min(initialLimit, prices.length);
    let samples = [];
    let recommendation = null;
    while (true) {
      samples = collectNonZeroPriceMoves(prices.slice(0, usedCount));
      recommendation = recommendOrderbookPrecision({
        samples,
        options,
        minSamples,
        minBucketShare
      });
      if (recommendation || usedCount >= prices.length) break;
      usedCount = Math.min(usedCount + expansionStep, prices.length);
    }
    return { samples, usedCount, recommendation };
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
  var MAX_AUTO_FIT_LADDER_PERCENT = "100";
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
  function getUnavailableLadderQuantityMessage(mode, quantity, confirmedZeroOpenBalance = false) {
    if (mode !== "OPEN" && mode !== "CLOSE") {
      throw new Error(`未知阶梯数量模式：${mode}`);
    }
    const parsed = parseDecimalString(quantity);
    if (parsed?.digits > 0n) return null;
    if (mode === "OPEN") {
      if (!parsed) return "未读取到可开数量";
      return confirmedZeroOpenBalance ? "可用余额不足" : "当前可开数量为 0";
    }
    if (!parsed) return "未读取到可平数量";
    return "当前方向没有可平仓位";
  }
  function pow103(exp) {
    let result = 1n;
    for (let i = 0; i < exp; i += 1) result *= 10n;
    return result;
  }
  function computeMinimumLadderPercent(baseQty, minRequiredQty, levels, stepSize) {
    const base = parseDecimalString(baseQty);
    const requestedLevels = Number(levels);
    const minSteps = decimalToStepCount(minRequiredQty, stepSize, "ceil");
    if (!base || base.digits <= 0n || !minSteps || minSteps <= 0n || requestedLevels <= 0) return null;
    const requiredQty = formatStepCount(minSteps * BigInt(requestedLevels), stepSize);
    const required = parseDecimalString(requiredQty);
    if (!required || required.digits <= 0n) return null;
    const numerator = required.digits * 100n * pow103(base.scale + 2);
    const denominator = base.digits * pow103(required.scale);
    const scaledPercent = (numerator + denominator - 1n) / denominator;
    return formatDecimalParts(scaledPercent, 2);
  }
  function getMinRequiredQtyForLevels(minRequiredQty, minRequiredQtyByLevel, levels) {
    if (!Array.isArray(minRequiredQtyByLevel) || minRequiredQtyByLevel.length === 0) return minRequiredQty;
    const candidateMinRequiredQty = minRequiredQtyByLevel.slice(0, levels).filter(Boolean).reduce((maxQty, qty) => maxDecimalString(maxQty, qty), null);
    return candidateMinRequiredQty || minRequiredQty;
  }
  function fitLadderPlanForMinimumQty(options) {
    const { baseQty, minRequiredQty, minRequiredQtyByLevel, percent, levels, stepSize } = options;
    const maxPercent = MAX_AUTO_FIT_LADDER_PERCENT;
    const requestedLevels = Number(levels);
    let minimumPercent = null;
    if (!Number.isInteger(requestedLevels) || requestedLevels <= 0) {
      return { allocation: null, minimumPercent, maxPercent };
    }
    for (let candidateLevels = requestedLevels; candidateLevels >= 1; candidateLevels -= 1) {
      const candidateMinRequiredQty = getMinRequiredQtyForLevels(minRequiredQty, minRequiredQtyByLevel, candidateLevels);
      const candidatePercent = computeMinimumLadderPercent(baseQty, candidateMinRequiredQty, candidateLevels, stepSize);
      if (candidateLevels === requestedLevels) minimumPercent = candidatePercent;
      if (!candidatePercent || compareDecimalStrings(candidatePercent, maxPercent) > 0) continue;
      const fitPercent = compareDecimalStrings(candidatePercent, percent) > 0 ? candidatePercent : String(percent);
      const fitTotalQty = multiplyDecimalByRatio(baseQty, fitPercent, 100);
      const allocation = allocateLadderQuantities(fitTotalQty, candidateLevels, stepSize, candidateMinRequiredQty);
      if (allocation && allocation.actualLevels >= candidateLevels) {
        return {
          allocation,
          levels: candidateLevels,
          minRequiredQty: candidateMinRequiredQty,
          minimumPercent,
          maxPercent,
          percent: fitPercent
        };
      }
    }
    return { allocation: null, minimumPercent, maxPercent };
  }

  // src/binance-orderbook-trade/core/interaction-feedback.js
  function remainingInteractionFeedbackMs({
    startedAtMs,
    nowMs,
    minimumMs
  }) {
    return Math.max(0, minimumMs - Math.max(0, nowMs - startedAtMs));
  }
  async function waitForRemainingFeedback({
    startedAtMs,
    minimumMs,
    now,
    delay
  }) {
    const remainingMs = remainingInteractionFeedbackMs({
      startedAtMs,
      nowMs: now(),
      minimumMs
    });
    if (remainingMs > 0) await delay(remainingMs);
  }
  function keepInteractionFeedbackVisible(task, options) {
    return Promise.resolve(task).then(
      async (value) => {
        await waitForRemainingFeedback(options);
        return value;
      },
      async (error) => {
        await waitForRemainingFeedback(options);
        throw error;
      }
    );
  }

  // src/binance-orderbook-trade/core/abort.js
  function getAbortReason(signal) {
    if (signal?.reason instanceof Error) return signal.reason;
    const error = new Error("Operation aborted");
    error.name = "AbortError";
    return error;
  }
  function throwIfAborted(signal) {
    if (signal?.aborted) throw getAbortReason(signal);
  }
  function waitForPromiseOrAbort(task, signal) {
    if (!signal) return Promise.resolve(task);
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        callback(value);
      };
      const onAbort = () => finish(reject, getAbortReason(signal));
      signal.addEventListener("abort", onAbort, { once: true });
      Promise.resolve(task).then(
        (value) => finish(resolve, value),
        (error) => finish(reject, error)
      );
    });
  }

  // src/binance-orderbook-trade/core/ladder-progress.js
  function assertLadderProgress(progress) {
    if (!progress || !Number.isInteger(progress.submittedOrders) || progress.submittedOrders < 0 || !Number.isInteger(progress.cancelledOrders) || progress.cancelledOrders < 0 || !Number.isInteger(progress.currentPlanSubmittedOrders) || progress.currentPlanSubmittedOrders < 0 || (progress.plannedOrders === null ? progress.currentPlanSubmittedOrders !== 0 : !(Number.isInteger(progress.plannedOrders) && progress.plannedOrders > 0 && progress.currentPlanSubmittedOrders <= progress.plannedOrders))) {
      throw new Error("阶梯进度状态无效");
    }
  }
  function assertLadderLabel(label) {
    if (!(isLocalizedText(label) || typeof label === "string" && label.trim() !== "")) {
      throw new Error("阶梯动作名称无效");
    }
  }
  function assertLadderMessage(message) {
    if (!(isLocalizedText(message) || typeof message === "string" && message.trim() !== "")) {
      throw new Error("阶梯进度信息无效");
    }
  }
  function formatLadderProgressCounts(progress) {
    assertLadderProgress(progress);
    const zhCN = [];
    const en = [];
    if (progress.plannedOrders !== null) {
      zhCN.push(`已挂 ${progress.currentPlanSubmittedOrders}/${progress.plannedOrders} 笔`);
      en.push(`Placed ${progress.currentPlanSubmittedOrders}/${progress.plannedOrders}`);
    } else if (progress.submittedOrders > 0) {
      zhCN.push(`已挂 ${progress.submittedOrders} 笔`);
      en.push(`Placed ${progress.submittedOrders}`);
    }
    if (progress.cancelledOrders > 0) {
      zhCN.push(`已撤 ${progress.cancelledOrders} 笔`);
      en.push(`Cancelled ${progress.cancelledOrders}`);
    }
    return zhCN.map((text, index) => localizedText(text, en[index]));
  }
  function appendLadderProgressCounts(status, progress) {
    const counts = formatLadderProgressCounts(progress);
    return counts.length > 0 ? combineLocalizedText([status, ...counts], " · ") : status;
  }
  function createLadderProgress() {
    return {
      submittedOrders: 0,
      cancelledOrders: 0,
      plannedOrders: null,
      currentPlanSubmittedOrders: 0
    };
  }
  function snapshotLadderProgress(progress) {
    assertLadderProgress(progress);
    return {
      submittedOrders: progress.submittedOrders,
      cancelledOrders: progress.cancelledOrders,
      plannedOrders: progress.plannedOrders,
      currentPlanSubmittedOrders: progress.currentPlanSubmittedOrders
    };
  }
  function setLadderPlannedOrders(progress, plannedOrders) {
    assertLadderProgress(progress);
    if (!Number.isInteger(plannedOrders) || plannedOrders <= 0) {
      throw new Error("阶梯计划笔数无效");
    }
    progress.plannedOrders = plannedOrders;
    progress.currentPlanSubmittedOrders = 0;
  }
  function recordLadderSubmittedOrder(progress) {
    assertLadderProgress(progress);
    if (progress.plannedOrders !== null && progress.currentPlanSubmittedOrders >= progress.plannedOrders) {
      throw new Error("阶梯已挂笔数超过计划");
    }
    progress.submittedOrders += 1;
    if (progress.plannedOrders !== null) progress.currentPlanSubmittedOrders += 1;
  }
  function recordLadderCancelledOrder(progress) {
    assertLadderProgress(progress);
    progress.cancelledOrders += 1;
  }
  function formatStoppedLadderProgress(label, progress) {
    assertLadderLabel(label);
    return appendLadderProgressCounts(localizedText(
      `${formatLocalizedText(label, UI_LOCALE_ZH_CN)}已停止`,
      `${formatLocalizedText(label, UI_LOCALE_EN)} stopped`
    ), progress);
  }
  function formatInterruptedLadderProgress(label, reason, progress) {
    assertLadderLabel(label);
    assertLadderMessage(reason);
    return appendLadderProgressCounts(localizedText(
      `${formatLocalizedText(label, UI_LOCALE_ZH_CN)}已中止：${formatLocalizedText(reason, UI_LOCALE_ZH_CN)}`,
      `${formatLocalizedText(label, UI_LOCALE_EN)} interrupted: ${formatLocalizedText(reason, UI_LOCALE_EN)}`
    ), progress);
  }
  function formatFailedLadderProgress(label, message, progress) {
    assertLadderLabel(label);
    assertLadderMessage(message);
    const counts = formatLadderProgressCounts(progress);
    const details = counts.length > 0 ? combineLocalizedText([...counts, message], " · ") : message;
    return localizedText(
      `${formatLocalizedText(label, UI_LOCALE_ZH_CN)}失败：${formatLocalizedText(details, UI_LOCALE_ZH_CN)}`,
      `${formatLocalizedText(label, UI_LOCALE_EN)} failed: ${formatLocalizedText(details, UI_LOCALE_EN)}`
    );
  }
  function formatCompletedLadderProgress(label, completedOrders, totalOrders, progress) {
    assertLadderLabel(label);
    assertLadderProgress(progress);
    if (!Number.isInteger(completedOrders) || completedOrders < 0 || !Number.isInteger(totalOrders) || totalOrders < 0) {
      throw new Error("阶梯完成笔数无效");
    }
    if (completedOrders !== totalOrders) {
      throw new Error("阶梯完成进度与计划不一致");
    }
    if (progress.plannedOrders !== totalOrders || progress.currentPlanSubmittedOrders !== completedOrders) {
      throw new Error("阶梯完成进度与计划不一致");
    }
    const parts = [localizedText(
      `${formatLocalizedText(label, UI_LOCALE_ZH_CN)}已完成`,
      `${formatLocalizedText(label, UI_LOCALE_EN)} completed`
    ), localizedText(
      `已挂 ${completedOrders}/${totalOrders} 笔`,
      `Placed ${completedOrders}/${totalOrders}`
    )];
    if (progress.cancelledOrders > 0) {
      parts.push(localizedText(
        `已撤 ${progress.cancelledOrders} 笔`,
        `Cancelled ${progress.cancelledOrders}`
      ));
    }
    return combineLocalizedText(parts, " · ");
  }
  function formatPositionClosedLadderProgress(label, progress) {
    assertLadderLabel(label);
    return appendLadderProgressCounts(localizedText(
      `${formatLocalizedText(label, UI_LOCALE_ZH_CN)}已结束 · 当前方向已无持仓`,
      `${formatLocalizedText(label, UI_LOCALE_EN)} ended · No position in this direction`
    ), progress);
  }

  // src/binance-orderbook-trade/core/continuous-ladder.js
  var CONTINUOUS_LADDER_COOLDOWN_MS = 1e3;
  var CONTINUOUS_LADDER_READY_CHECK_MS = 50;
  var CONTINUOUS_LADDER_RECOVERY_COOLDOWN_MS = 3e3;
  var CONTINUOUS_LADDER_LONG_RECOVERY_COOLDOWN_MS = 1e4;
  var CONTINUOUS_LADDER_RECOVERY = Object.freeze({
    submit_unconfirmed: {
      cooldownMs: CONTINUOUS_LADDER_RECOVERY_COOLDOWN_MS,
      requiresSafeNoSubmit: false
    },
    rate_limited: {
      cooldownMs: CONTINUOUS_LADDER_LONG_RECOVERY_COOLDOWN_MS,
      requiresSafeNoSubmit: false
    },
    order_capacity_not_ready: {
      cooldownMs: CONTINUOUS_LADDER_RECOVERY_COOLDOWN_MS,
      requiresSafeNoSubmit: false
    },
    open_orders_not_ready: {
      cooldownMs: CONTINUOUS_LADDER_RECOVERY_COOLDOWN_MS,
      requiresSafeNoSubmit: false
    },
    input_unstable: {
      cooldownMs: CONTINUOUS_LADDER_RECOVERY_COOLDOWN_MS
    },
    controls_not_ready: {
      cooldownMs: CONTINUOUS_LADDER_RECOVERY_COOLDOWN_MS
    },
    market_data_not_ready: {
      cooldownMs: CONTINUOUS_LADDER_RECOVERY_COOLDOWN_MS
    },
    position_state_not_ready: {
      cooldownMs: CONTINUOUS_LADDER_RECOVERY_COOLDOWN_MS
    },
    position_quantity_not_ready: {
      cooldownMs: CONTINUOUS_LADDER_LONG_RECOVERY_COOLDOWN_MS
    },
    precision_changed: {
      cooldownMs: CONTINUOUS_LADDER_COOLDOWN_MS,
      reason: localizedText(
        "价格精度已变化，下一轮按新精度继续",
        "Precision changed; the next round will use the new precision"
      )
    },
    options_changed: {
      cooldownMs: CONTINUOUS_LADDER_COOLDOWN_MS,
      reason: localizedText(
        "比例、笔数或间距已变化，下一轮按新设置继续",
        "Ratio, orders, or gap changed; the next round will use the new settings"
      )
    }
  });
  var recordedRoundOutcomes = /* @__PURE__ */ new WeakSet();
  var CONTINUOUS_LADDER_PHASE_TEXT = Object.freeze({
    running: null,
    stopping: localizedText("停止中", "Stopping"),
    stopped: localizedText("已停止", "Stopped"),
    failed: localizedText("失败", "Failed"),
    interrupted: localizedText("已中止", "Interrupted")
  });
  function isValidLocalizedValue(value) {
    return isLocalizedText(value) || typeof value === "string" && value.trim() !== "";
  }
  function assertContinuousLadderProgress(progress) {
    if (!progress || !Number.isInteger(progress.startedRounds) || progress.startedRounds < 0 || !Number.isInteger(progress.completedRounds) || progress.completedRounds < 0 || progress.completedRounds > progress.startedRounds || !Number.isInteger(progress.submittedOrders) || progress.submittedOrders < 0 || !Number.isInteger(progress.cancelledOrders) || progress.cancelledOrders < 0 || progress.startedRounds === 0 !== (progress.lastRound === null)) {
      throw new Error("连续阶梯进度状态无效");
    }
    if (progress.lastRound !== null) snapshotLadderProgress(progress.lastRound);
  }
  function createContinuousLadderProgress() {
    return {
      startedRounds: 0,
      completedRounds: 0,
      submittedOrders: 0,
      cancelledOrders: 0,
      lastRound: null
    };
  }
  function resolveContinuousLadderRecovery(error) {
    const recovery = CONTINUOUS_LADDER_RECOVERY[error?.continuousRecoveryKind];
    if (!recovery) return null;
    if (recovery.requiresSafeNoSubmit !== false && error.safeNoSubmit !== true) return null;
    const cooldownMs = error.continuousRecoveryCooldownMs ?? recovery.cooldownMs;
    if (!Number.isFinite(cooldownMs) || cooldownMs < 0) {
      throw new Error("连续阶梯恢复等待时间无效");
    }
    return {
      cooldownMs,
      reason: recovery.reason || error.localizedText || error.message
    };
  }
  function recordContinuousLadderRound(progress, outcome) {
    assertContinuousLadderProgress(progress);
    if (!outcome || typeof outcome !== "object") {
      throw new Error("连续阶梯本轮结果无效");
    }
    if (recordedRoundOutcomes.has(outcome)) {
      throw new Error("连续阶梯本轮结果已记录");
    }
    if (!["completed", "position_closed", "stopped", "failed", "interrupted"].includes(outcome.status)) {
      throw new Error("连续阶梯本轮结果无效");
    }
    const roundProgress = snapshotLadderProgress(outcome.progress);
    progress.startedRounds += 1;
    if (outcome.status === "completed") progress.completedRounds += 1;
    progress.submittedOrders += roundProgress.submittedOrders;
    progress.cancelledOrders += roundProgress.cancelledOrders;
    progress.lastRound = {
      status: outcome.status,
      ...roundProgress
    };
    recordedRoundOutcomes.add(outcome);
    assertContinuousLadderProgress(progress);
  }
  function buildContinuousLadderProgressParts(label, phase, progress) {
    if (!isValidLocalizedValue(label)) {
      throw new Error("连续阶梯动作名称无效");
    }
    const phaseText = CONTINUOUS_LADDER_PHASE_TEXT[phase];
    if (!Object.hasOwn(CONTINUOUS_LADDER_PHASE_TEXT, phase)) {
      throw new Error("连续阶梯阶段无效");
    }
    assertContinuousLadderProgress(progress);
    const parts = [localizedText(
      `连续${formatLocalizedText(label, UI_LOCALE_ZH_CN)}`,
      `Continuous ${formatLocalizedText(label, UI_LOCALE_EN)}`
    )];
    if (phaseText !== null) parts.push(phaseText);
    parts.push(progress.startedRounds === 0 ? localizedText("0 轮", "0 rounds") : localizedText(
      `${progress.completedRounds}/${progress.startedRounds} 轮`,
      `${progress.completedRounds}/${progress.startedRounds} rounds`
    ));
    if (progress.lastRound?.plannedOrders !== null) {
      parts.push(localizedText(
        `本轮 ${progress.lastRound.currentPlanSubmittedOrders}/${progress.lastRound.plannedOrders} 笔`,
        `This round ${progress.lastRound.currentPlanSubmittedOrders}/${progress.lastRound.plannedOrders}`
      ));
    } else if (progress.lastRound?.submittedOrders > 0) {
      parts.push(localizedText(
        `本轮 ${progress.lastRound.submittedOrders} 笔`,
        `This round ${progress.lastRound.submittedOrders}`
      ));
    }
    parts.push(localizedText(
      `累计 ${progress.submittedOrders} 笔`,
      `Total ${progress.submittedOrders}`
    ));
    if (progress.cancelledOrders > 0) {
      parts.push(localizedText(
        `撤 ${progress.cancelledOrders} 笔`,
        `Cancelled ${progress.cancelledOrders}`
      ));
    }
    return parts;
  }
  function formatActiveContinuousLadderProgress(label, detail, progress, roundProgress) {
    if (!isValidLocalizedValue(label)) {
      throw new Error("连续阶梯动作名称无效");
    }
    if (detail !== null && !isValidLocalizedValue(detail)) {
      throw new Error("连续阶梯当前进度信息无效");
    }
    assertContinuousLadderProgress(progress);
    const round = snapshotLadderProgress(roundProgress);
    const parts = [localizedText(
      `连续${formatLocalizedText(label, UI_LOCALE_ZH_CN)}`,
      `Continuous ${formatLocalizedText(label, UI_LOCALE_EN)}`
    )];
    if (detail !== null) parts.push(detail);
    parts.push(localizedText(
      `${progress.completedRounds}/${progress.startedRounds + 1} 轮`,
      `${progress.completedRounds}/${progress.startedRounds + 1} rounds`
    ));
    if (round.plannedOrders !== null) {
      parts.push(localizedText(
        `本轮 ${round.currentPlanSubmittedOrders}/${round.plannedOrders} 笔`,
        `This round ${round.currentPlanSubmittedOrders}/${round.plannedOrders}`
      ));
    } else if (round.submittedOrders > 0) {
      parts.push(localizedText(
        `本轮 ${round.submittedOrders} 笔`,
        `This round ${round.submittedOrders}`
      ));
    }
    parts.push(localizedText(
      `累计 ${progress.submittedOrders + round.submittedOrders} 笔`,
      `Total ${progress.submittedOrders + round.submittedOrders}`
    ));
    const cancelledOrders = progress.cancelledOrders + round.cancelledOrders;
    if (cancelledOrders > 0) {
      parts.push(localizedText(`撤 ${cancelledOrders} 笔`, `Cancelled ${cancelledOrders}`));
    }
    return combineLocalizedText(parts, " · ");
  }
  function formatContinuousLadderProgress(label, phase, progress, reason = null) {
    if (reason !== null && !isValidLocalizedValue(reason)) {
      throw new Error("连续阶梯停止原因无效");
    }
    const parts = buildContinuousLadderProgressParts(label, phase, progress);
    if (reason !== null) parts.push(reason);
    return combineLocalizedText(parts, " · ");
  }
  function formatContinuousLadderPositionClosedProgress(label, progress) {
    if (!isValidLocalizedValue(label)) {
      throw new Error("连续阶梯动作名称无效");
    }
    assertContinuousLadderProgress(progress);
    const parts = [
      localizedText(
        `连续${formatLocalizedText(label, UI_LOCALE_ZH_CN)}`,
        `Continuous ${formatLocalizedText(label, UI_LOCALE_EN)}`
      ),
      localizedText("已结束", "Ended"),
      localizedText("当前方向已无持仓", "No position in this direction"),
      progress.startedRounds === 0 ? localizedText("0 轮", "0 rounds") : localizedText(
        `${progress.completedRounds}/${progress.startedRounds} 轮`,
        `${progress.completedRounds}/${progress.startedRounds} rounds`
      ),
      localizedText(`累计 ${progress.submittedOrders} 笔`, `Total ${progress.submittedOrders}`)
    ];
    if (progress.cancelledOrders > 0) {
      parts.push(localizedText(
        `撤 ${progress.cancelledOrders} 笔`,
        `Cancelled ${progress.cancelledOrders}`
      ));
    }
    return combineLocalizedText(parts, " · ");
  }
  function formatContinuousLadderWaitReason(phase, cooldownMs) {
    if (!Number.isFinite(cooldownMs) || cooldownMs < 0) {
      throw new Error("连续阶梯轮间等待时间无效");
    }
    if (phase === "waiting_ready") return localizedText("等待按钮恢复", "Waiting for button");
    if (phase !== "cooldown") throw new Error("连续阶梯等待阶段无效");
    const duration = cooldownMs % 1e3 === 0 ? `${cooldownMs / 1e3}s` : `${cooldownMs}ms`;
    return localizedText(`${duration} 后继续`, `Continue in ${duration}`);
  }
  function formatContinuousLadderWaitProgress(label, progress, phase, cooldownMs) {
    const parts = buildContinuousLadderProgressParts(label, "running", progress);
    parts.splice(1, 0, formatContinuousLadderWaitReason(phase, cooldownMs));
    return combineLocalizedText(parts, " · ");
  }
  function assertReadinessState(state) {
    if (!["ready", "waiting", "stopped"].includes(state?.status)) {
      throw new Error("连续阶梯按钮就绪状态无效");
    }
    return state;
  }
  async function waitUntilReadyOrStopped({
    readReadiness,
    delay,
    signal,
    readyCheckMs,
    cooldownMs,
    onWaitStateChange,
    waitingAlreadyReported
  }) {
    let reported = waitingAlreadyReported;
    while (true) {
      throwIfAborted(signal);
      const state = assertReadinessState(await readReadiness());
      if (state.status !== "waiting") return state;
      if (!reported) {
        onWaitStateChange({ phase: "waiting_ready", cooldownMs });
        reported = true;
      }
      await waitForPromiseOrAbort(delay(readyCheckMs), signal);
    }
  }
  async function waitForContinuousLadderNextRound({
    readReadiness,
    delay,
    signal = null,
    cooldownMs = CONTINUOUS_LADDER_COOLDOWN_MS,
    readyCheckMs = CONTINUOUS_LADDER_READY_CHECK_MS,
    onWaitStateChange = () => {
    }
  }) {
    if (!(cooldownMs >= 0)) throw new Error("连续阶梯轮间等待时间无效");
    if (!(readyCheckMs > 0)) throw new Error("连续阶梯按钮检查间隔无效");
    if (typeof onWaitStateChange !== "function") {
      throw new Error("连续阶梯等待状态回调无效");
    }
    let waitingAlreadyReported = false;
    while (true) {
      const readyState = await waitUntilReadyOrStopped({
        readReadiness,
        delay,
        signal,
        readyCheckMs,
        cooldownMs,
        onWaitStateChange,
        waitingAlreadyReported
      });
      if (readyState.status === "stopped") return readyState;
      waitingAlreadyReported = false;
      onWaitStateChange({ phase: "cooldown", cooldownMs });
      await waitForPromiseOrAbort(delay(cooldownMs), signal);
      throwIfAborted(signal);
      const afterCooldown = assertReadinessState(await readReadiness());
      if (afterCooldown.status !== "waiting") return afterCooldown;
      onWaitStateChange({ phase: "waiting_ready", cooldownMs });
      waitingAlreadyReported = true;
    }
  }

  // src/binance-orderbook-trade/core/status-symbol.js
  var STATUS_QUOTE_ASSETS = Object.freeze(["USDT", "USDC"]);
  function formatStatusBaseAsset(symbol) {
    if (typeof symbol !== "string") {
      throw new Error(`不支持的合约状态交易对：${symbol}`);
    }
    const normalized = symbol.trim().toUpperCase();
    const quoteAsset = STATUS_QUOTE_ASSETS.find((candidate) => normalized.endsWith(candidate));
    const baseAsset = quoteAsset ? normalized.slice(0, -quoteAsset.length) : "";
    if (!baseAsset) {
      throw new Error(`不支持的合约状态交易对：${symbol}`);
    }
    return baseAsset;
  }

  // src/binance-orderbook-trade/core/open-order-capacity.js
  function getDecimalDistance(left, right) {
    const comparison = compareDecimalStrings(left, right);
    if (comparison == null) throw new Error("Open-order distance input is invalid");
    return comparison >= 0 ? subtractDecimalStrings(left, right) : subtractDecimalStrings(right, left);
  }
  function selectFarthestOpenOrders(rows, referencePrice, limit) {
    const normalizedReference = normalizeDecimalString(referencePrice);
    if (!isPositiveDecimalString(normalizedReference)) {
      throw new Error("Open-order reference price is invalid");
    }
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error("Open-order cancellation limit is invalid");
    }
    if (!Array.isArray(rows)) throw new Error("Open-order rows are invalid");
    const ranked = rows.map((row, index) => {
      if (!row || typeof row.key !== "string" || row.key === "") {
        throw new Error("Open-order row key is invalid");
      }
      const price = normalizeDecimalString(row.price);
      if (!isPositiveDecimalString(price)) throw new Error("Open-order row price is invalid");
      return {
        row,
        index,
        distance: getDecimalDistance(price, normalizedReference)
      };
    });
    ranked.sort((left, right) => {
      const distanceComparison = compareDecimalStrings(left.distance, right.distance);
      if (distanceComparison == null) throw new Error("Open-order distance comparison failed");
      return distanceComparison === 0 ? left.index - right.index : -distanceComparison;
    });
    return ranked.slice(0, limit).map(({ row }) => row);
  }

  // src/binance-orderbook-trade/core/order-feedback.js
  function isPotentialOrderFeedbackText(text) {
    if (!text) return false;
    return /订单|委托|下单|已提交|已下单|不足|拒绝|过期|order|placed|submitted|failed|rejected|error|insufficient|失败/i.test(text);
  }
  function classifyOrderFeedback(text) {
    if (!text) return "none";
    if (/失败|拒绝|错误|不足|过期|取消|failed|rejected|error|insufficient/i.test(text)) return "failure";
    if (/已提交|已下单|委托已|order placed|submitted|placed/i.test(text) || /(订单|委托|下单|order)/i.test(text) && /成功|success/i.test(text)) {
      return "success";
    }
    return "unknown";
  }
  function evaluateOrderSubmitAcknowledgement({ feedback, isNewFeedback }) {
    if (!feedback || !isNewFeedback) return { status: "pending" };
    const feedbackType = classifyOrderFeedback(feedback);
    if (feedbackType === "failure") return { status: "failure", message: feedback };
    if (feedbackType === "success") return { status: "success" };
    return { status: "pending" };
  }
  function isReduceOnlyOpenOrdersConflictFeedback(text) {
    if (!text) return false;
    const normalized = String(text).replace(/\s+/g, "");
    return normalized.includes("只减仓订单失败") && (normalized.includes("当前挂单") || normalized.includes("挂单后重试") || normalized.includes("未平仓头寸和挂单"));
  }
  function isOpenLadderOpenOrdersCapacityFeedback(text) {
    if (!text) return false;
    const normalized = String(text).replace(/\s+/g, "").toLowerCase();
    const hasCapacityFailure = normalized.includes("余额不足") || normalized.includes("可用余额不足") || normalized.includes("可用数量不足") || normalized.includes("可开数量不足") || normalized.includes("可用保证金不足") || normalized.includes("insufficientmargin") || normalized.includes("insufficientbalance") || normalized.includes("insufficientavailablebalance") || normalized.includes("notenoughmargin") || normalized.includes("notenoughbalance") || normalized.includes("notenoughavailablebalance");
    const hasOpenOrdersHint = normalized.includes("当前挂单") || normalized.includes("取消挂单") || normalized.includes("挂单后重试") || normalized.includes("openorders") || normalized.includes("existingopenorders");
    return hasCapacityFailure && hasOpenOrdersHint;
  }
  function isPostOnlyMakerRejectionFeedback(text) {
    if (!text) return false;
    const normalized = String(text).replace(/[\s-]+/g, "").toLowerCase();
    const hasPostOnlyOrder = normalized.includes("postonly") || normalized.includes("只做maker") || normalized.includes("仅做maker");
    const hasMakerExecutionConflict = /(未|无法|不能|未能).{0,8}作为maker.{0,8}(执行|成交)/.test(normalized) || /(couldnot|cannot|wasnot|isnot).{0,12}(executed|execute|filled|fill).{0,8}as(?:a)?maker/.test(normalized);
    const hasRejection = /拒绝|驳回|reject/.test(normalized);
    return hasPostOnlyOrder && hasMakerExecutionConflict && hasRejection;
  }
  var BINANCE_POST_ONLY_MAKER_REJECT_CODES = /* @__PURE__ */ new Set([-5022, 90805022]);
  var BINANCE_MAX_OPEN_ORDERS_ERROR_CODE = 90802025;
  function isBinancePostOnlyMakerRejectCode(code) {
    return BINANCE_POST_ONLY_MAKER_REJECT_CODES.has(code);
  }
  function isBinanceMaxOpenOrdersErrorCode(code) {
    return code === BINANCE_MAX_OPEN_ORDERS_ERROR_CODE;
  }
  function parseRetryAfterMs(value) {
    if (value == null || value === "") return null;
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1e3 : null;
  }
  function resolveBinanceSubmitResponseRecovery(diagnostics, apiErrors) {
    if (!Array.isArray(diagnostics) || !Array.isArray(apiErrors)) {
      throw new Error("下单响应恢复证据无效");
    }
    const rateLimitDiagnostic = diagnostics.find(({ httpStatus }) => httpStatus === 418 || httpStatus === 429);
    const hasRateLimitCode = apiErrors.some(({ code }) => code === -1003);
    if (rateLimitDiagnostic || hasRateLimitCode) {
      return {
        kind: "rate_limited",
        cooldownMs: parseRetryAfterMs(rateLimitDiagnostic?.retryAfter) ?? 1e4
      };
    }
    if (diagnostics.some(({ httpStatus }) => httpStatus >= 500 && httpStatus <= 599)) {
      return {
        kind: "submit_unconfirmed",
        cooldownMs: 3e3
      };
    }
    return null;
  }
  function getBinanceApiErrorCode(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    if (Number.isSafeInteger(payload.code)) return payload.code === 0 ? null : payload.code;
    if (typeof payload.code !== "string" || !/^-?\d+$/.test(payload.code)) return null;
    const code = Number(payload.code);
    return Number.isSafeInteger(code) && code !== 0 ? code : null;
  }
  function isBinancePlaceOrderSuccessPayload(payload) {
    return payload != null && typeof payload === "object" && !Array.isArray(payload) && payload.success === true && getBinanceApiErrorCode(payload) == null;
  }
  function readDiagnosticScalar(value) {
    return ["string", "number", "boolean"].includes(typeof value) ? value : null;
  }
  function readDiagnosticMessage(value) {
    if (typeof value !== "string") return null;
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized ? normalized.slice(0, 160) : null;
  }
  function summarizeBinancePlaceOrderPayload(payload) {
    const payloadType = Array.isArray(payload) ? "array" : payload === null ? "null" : typeof payload;
    if (payloadType !== "object") {
      return {
        payloadType,
        payloadKeys: [],
        dataKeys: [],
        success: null,
        code: null,
        message: null
      };
    }
    const data = payload.data;
    return {
      payloadType,
      payloadKeys: Object.keys(payload).sort(),
      dataKeys: data && typeof data === "object" && !Array.isArray(data) ? Object.keys(data).sort() : [],
      success: readDiagnosticScalar(payload.success),
      code: readDiagnosticScalar(payload.code),
      message: readDiagnosticMessage(payload.message ?? payload.msg)
    };
  }
  function formatRetryAfter(value) {
    if (value == null || value === "") return null;
    return /^\d+(?:\.\d+)?$/.test(String(value)) ? `Retry-After ${value}s` : `Retry-After ${value}`;
  }
  function formatBinancePlaceOrderResponseDiagnostic(diagnostic) {
    const parts = [];
    if (diagnostic.httpStatus != null) parts.push(`HTTP ${diagnostic.httpStatus}`);
    if (diagnostic.contentType) parts.push(diagnostic.contentType);
    const retryAfter = formatRetryAfter(diagnostic.retryAfter);
    if (retryAfter) parts.push(retryAfter);
    const orderCounts = [];
    if (diagnostic.orderCount10s != null) {
      orderCounts.push(`X-MBX-ORDER-COUNT-10S=${diagnostic.orderCount10s}`);
    }
    if (diagnostic.orderCount1m != null) {
      orderCounts.push(`X-MBX-ORDER-COUNT-1M=${diagnostic.orderCount1m}`);
    }
    if (orderCounts.length > 0) parts.push(orderCounts.join(" · "));
    if (diagnostic.usedWeight1m != null) {
      parts.push(`X-MBX-USED-WEIGHT-1M=${diagnostic.usedWeight1m}`);
    }
    if (diagnostic.bodyKind === "non_json") {
      parts.push("non-JSON");
    } else if (diagnostic.bodyKind === "invalid_json") {
      parts.push(`JSON parse error${diagnostic.errorName ? ` ${diagnostic.errorName}` : ""}`);
    } else if (diagnostic.bodyKind === "network_error") {
      parts.push(`network error${diagnostic.errorName ? ` ${diagnostic.errorName}` : ""}`);
    } else if (diagnostic.bodyKind === "observation_error") {
      parts.push(`response observer error${diagnostic.errorName ? ` ${diagnostic.errorName}` : ""}`);
    } else if (diagnostic.bodyKind === "json") {
      const summary = diagnostic.payloadSummary;
      if (!summary) throw new Error("下单 JSON 响应摘要缺失");
      if (summary.success != null) parts.push(`success=${summary.success}`);
      if (summary.code != null) parts.push(`code=${summary.code}`);
      if (summary.message) parts.push(`message=${summary.message}`);
      if (summary.payloadKeys.length > 0) parts.push(`keys=${summary.payloadKeys.join(",")}`);
      else parts.push(`JSON type=${summary.payloadType}`);
      if (summary.dataKeys.length > 0) parts.push(`data.keys=${summary.dataKeys.join(",")}`);
    } else {
      throw new Error(`未知下单响应类型：${diagnostic.bodyKind}`);
    }
    return parts.join(" · ");
  }

  // src/shared/binance-futures-route.js
  var FUTURES_TRADING_PATH_RE = /^\/(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?futures\/([A-Za-z0-9_]{3,})\/?$/;
  function parseFuturesTradingSymbolFromPathname(pathname) {
    const normalized = String(pathname || "").split(/[?#]/, 1)[0];
    const match = normalized.match(FUTURES_TRADING_PATH_RE);
    return match?.[1] ? match[1].toUpperCase() : null;
  }
  function isFuturesTradingPathname(pathname) {
    return Boolean(parseFuturesTradingSymbolFromPathname(pathname));
  }

  // src/shared/spa-route-change.js
  var ROUTE_CHANGE_EVENT = "jh-userscripts:spa-route-change";
  var ROUTE_PATCH_MARKER = Symbol.for("jh-userscripts.spa-route-change-patched");
  var ROUTE_DISPATCH_STATE = Symbol.for("jh-userscripts.spa-route-change-dispatch");
  function dispatchRouteChange(view) {
    const href = view.location.href;
    if (view[ROUTE_DISPATCH_STATE]?.href === href) return;
    const state = { href };
    view[ROUTE_DISPATCH_STATE] = state;
    view.dispatchEvent(new view.Event(ROUTE_CHANGE_EVENT));
    view.queueMicrotask(() => {
      if (view[ROUTE_DISPATCH_STATE] === state) delete view[ROUTE_DISPATCH_STATE];
    });
  }
  function patchHistoryMethod(view, methodName) {
    const current = view.history[methodName];
    if (current[ROUTE_PATCH_MARKER]) return;
    function routeAwareHistoryMethod(...args) {
      const previousHref = view.location.href;
      const result = Reflect.apply(current, this, args);
      if (view.location.href !== previousHref) dispatchRouteChange(view);
      return result;
    }
    Object.defineProperty(routeAwareHistoryMethod, ROUTE_PATCH_MARKER, { value: true });
    view.history[methodName] = routeAwareHistoryMethod;
  }
  function ensureSpaRouteChangePatched(view) {
    if (!view?.history) throw new Error("SPA route patch requires a window");
    patchHistoryMethod(view, "pushState");
    patchHistoryMethod(view, "replaceState");
  }
  function installSpaRouteChangeListener(view, listener) {
    if (!view?.history || typeof listener !== "function") {
      throw new Error("SPA route listener requires a window and callback");
    }
    ensureSpaRouteChangePatched(view);
    view.addEventListener(ROUTE_CHANGE_EVENT, listener);
    view.addEventListener("popstate", listener);
    view.addEventListener("hashchange", listener);
    return () => {
      view.removeEventListener(ROUTE_CHANGE_EVENT, listener);
      view.removeEventListener("popstate", listener);
      view.removeEventListener("hashchange", listener);
    };
  }

  // src/binance-orderbook-trade/dom/account-orders.js
  function getNormalizedText(el) {
    return normalizeText(el?.textContent || "");
  }
  function getTabIdentity(el) {
    return getNormalizedText(el).replace(/\s*\(\d+\)$/, "").toLocaleLowerCase();
  }
  function createAccountOrdersMutationSignal(observationRoot) {
    const MutationObserverClass = observationRoot?.ownerDocument?.defaultView?.MutationObserver;
    if (!observationRoot || !MutationObserverClass) return null;
    let version = 0;
    let pendingFinish = null;
    const notify = () => {
      version += 1;
      pendingFinish?.("changed");
    };
    const observer = new MutationObserverClass(notify);
    observer.observe(observationRoot, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["aria-selected", "aria-checked", "class", "style"]
    });
    return {
      get version() {
        return version;
      },
      waitForChange(afterVersion, timeoutMs) {
        if (version !== afterVersion) return Promise.resolve("changed");
        return new Promise((resolve) => {
          let timer = null;
          const finish = (result) => {
            if (pendingFinish !== finish) return;
            pendingFinish = null;
            if (timer) clearTimeout(timer);
            resolve(result);
          };
          pendingFinish = finish;
          timer = setTimeout(() => finish("timeout"), timeoutMs);
        });
      },
      dispose() {
        observer.disconnect();
        pendingFinish?.("disposed");
      }
    };
  }
  async function waitForAccountOrdersMutationState(observationRoot, readState, timeoutMs, abortSignal = null) {
    throwIfAborted(abortSignal);
    const currentState = readState();
    if (currentState) return currentState;
    const signal = createAccountOrdersMutationSignal(observationRoot);
    if (!signal) return null;
    const deadline = Date.now() + timeoutMs;
    try {
      while (true) {
        throwIfAborted(abortSignal);
        const version = signal.version;
        const state = readState();
        if (state) return state;
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) return readState();
        await waitForPromiseOrAbort(
          signal.waitForChange(version, remainingMs),
          abortSignal
        );
      }
    } finally {
      signal.dispose();
    }
  }
  function hasAccountOrdersTabs(node, isVisibleElement) {
    const tabTexts = Array.from(node.querySelectorAll('[role="tab"]')).filter(isVisibleElement).map(getNormalizedText).join(" ");
    return includesBinancePageText(tabTexts, BINANCE_PAGE_TEXT.accountOrders.positionTab) && includesBinancePageText(tabTexts, BINANCE_PAGE_TEXT.accountOrders.openOrdersTab) && includesBinancePageText(tabTexts, BINANCE_PAGE_TEXT.accountOrders.historyTab);
  }
  function containsNestedAccountOrdersGroupOutsideTab(node, tab, isVisibleElement) {
    return Array.from(node.children).some((child) => !child.contains(tab) && hasAccountOrdersTabs(child, isVisibleElement));
  }
  function hasOpenOrdersPanelText(node) {
    return includesBinancePageText(
      getNormalizedText(node),
      BINANCE_PAGE_TEXT.accountOrders.panelEvidence
    );
  }
  function hasOpenOrdersPanelEvidence(node, {
    findHideOtherSymbolCheckbox,
    findCurrentSymbolCancelAllButton
  }) {
    if (findCurrentSymbolCancelAllButton(node)) return true;
    return Boolean(findHideOtherSymbolCheckbox(node) && hasOpenOrdersPanelText(node));
  }
  function isOpenOrdersBasicSubTabText(text) {
    return startsWithBinancePageText(text, BINANCE_PAGE_TEXT.accountOrders.basicSubTab);
  }
  function isOpenOrdersConditionalSubTabText(text) {
    return startsWithBinancePageText(text, BINANCE_PAGE_TEXT.accountOrders.conditionalSubTab);
  }
  function isAccountPositionTabText(text) {
    return matchesBinancePageText(text, BINANCE_PAGE_TEXT.accountOrders.positionTab) || parseBinanceTabCount(text, BINANCE_PAGE_TEXT.accountOrders.positionTab) !== null;
  }
  function parseAccountPositionTabCount(text) {
    return parseBinanceTabCount(text, BINANCE_PAGE_TEXT.accountOrders.positionTab);
  }
  function findOpenOrdersBasicSubTab(root, { isVisibleElement }) {
    return Array.from(root.querySelectorAll('[role="tab"]')).find((tab) => isVisibleElement(tab) && isOpenOrdersBasicSubTabText(getNormalizedText(tab))) || null;
  }
  function findOpenOrdersConditionalSubTab(root, { isVisibleElement }) {
    return Array.from(root.querySelectorAll('[role="tab"]')).find((tab) => isVisibleElement(tab) && isOpenOrdersConditionalSubTabText(getNormalizedText(tab))) || null;
  }
  function findSelectedOpenOrdersSubTab(root, { isVisibleElement }) {
    return Array.from(root.querySelectorAll('[role="tab"][aria-selected="true"]')).find((tab) => isVisibleElement(tab) && (isOpenOrdersBasicSubTabText(getNormalizedText(tab)) || isOpenOrdersConditionalSubTabText(getNormalizedText(tab)))) || null;
  }
  function getOpenOrdersSubTabIdentity(tab) {
    const text = getNormalizedText(tab);
    if (!isOpenOrdersBasicSubTabText(text) && !isOpenOrdersConditionalSubTabText(text)) return null;
    return getTabIdentity(tab);
  }
  function findOpenOrdersSubTabByIdentity(root, identity, { isVisibleElement }) {
    if (!root || !identity) return null;
    const tabs = Array.from(root.querySelectorAll('[role="tab"]')).filter((tab) => isVisibleElement(tab) && getOpenOrdersSubTabIdentity(tab) === identity);
    return tabs.length === 1 ? tabs[0] : null;
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
    const accountTabs = tabs.filter((tab) => isAccountOrdersTab(tab, { isVisibleElement }));
    return accountTabs.length === 1 ? accountTabs[0] : null;
  }
  function getAccountOrdersTabIdentity(tab) {
    return tab ? getTabIdentity(tab) : null;
  }
  function findAccountOrdersTabByIdentity(root, identity, { isVisibleElement }) {
    if (!identity) return null;
    const openOrdersTab = findOpenOrdersTab(root, { isVisibleElement });
    if (!openOrdersTab) return null;
    const tabGroup = getAccountOrdersTabGroup(openOrdersTab, { isVisibleElement });
    if (!tabGroup) return null;
    const tabs = Array.from(tabGroup.querySelectorAll('[role="tab"]')).filter((tab) => isVisibleElement(tab) && getAccountOrdersTabIdentity(tab) === identity);
    return tabs.length === 1 ? tabs[0] : null;
  }
  function findAccountPositionTab(root, { isVisibleElement }) {
    const accountGroups = /* @__PURE__ */ new Set();
    for (const tab of root.querySelectorAll('[role="tab"]')) {
      if (!isVisibleElement(tab) || !isOpenOrdersTabText(getNormalizedText(tab))) continue;
      const group2 = getAccountOrdersTabGroup(tab, { isVisibleElement });
      if (group2) accountGroups.add(group2);
    }
    if (accountGroups.size !== 1) return null;
    const [group] = accountGroups;
    const positionTabs = Array.from(group.querySelectorAll('[role="tab"]')).filter((tab) => isVisibleElement(tab) && isAccountPositionTabText(getNormalizedText(tab)));
    return positionTabs.length === 1 ? positionTabs[0] : null;
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
    const scopes = Array.from(root.querySelectorAll('[id="OPEN_ORDERS"]')).filter((scope) => isVisibleElement(scope) && hasOpenOrdersPanelEvidence(scope, {
      findHideOtherSymbolCheckbox,
      findCurrentSymbolCancelAllButton
    }));
    return scopes.length === 1 ? scopes[0] : null;
  }

  // src/binance-orderbook-trade/dom/trade-form.js
  function buttonTextMatches(button, labels) {
    return includesBinancePageText(button?.textContent, labels);
  }
  function isOwnPanelButton(button, panelId) {
    return !!button?.closest?.(`#${panelId}`);
  }
  var CLOSE_QUANTITY_SELECTOR = '[data-testid="max-sell-amount"], [data-testid="max-buy-amount"]';
  var TRADE_MODE_TAB_SELECTOR = [
    '#position-direction [role="tab"][aria-selected="true"]',
    '.bn-tabs__buySell [role="tab"][aria-selected="true"]',
    '[role="tab"].bn-tab__buySell[aria-selected="true"]'
  ].join(",");
  var TRADE_QTY_INPUT_SELECTOR = [
    'input[id^="unitAmount-"]',
    'input[aria-label="数量"]',
    'input[placeholder="数量"]'
  ].join(",");
  var TRADE_PRICE_INPUT_SELECTOR = [
    'input[id^="limitPrice-"]',
    'input[aria-label="委托价格"]',
    'input[placeholder="委托价格"]'
  ].join(",");
  function parseTradeModeLabel(value) {
    if (matchesBinancePageText(value, BINANCE_PAGE_TEXT.tradeMode.OPEN)) return "OPEN";
    if (matchesBinancePageText(value, BINANCE_PAGE_TEXT.tradeMode.CLOSE)) return "CLOSE";
    return null;
  }
  function readTradeAvailableBalance(root, { isVisibleElement }) {
    if (!root?.querySelectorAll || typeof isVisibleElement !== "function") return null;
    const candidates = Array.from(root.querySelectorAll("span")).filter((label) => isVisibleElement(label) && matchesBinancePageText(label.textContent, BINANCE_PAGE_TEXT.availableBalance)).map((label) => {
      const valueNodes = Array.from(label.parentElement?.children || []).filter((node) => node !== label && isVisibleElement(node));
      if (valueNodes.length !== 1) return null;
      const match = /^([\d,]+(?:\.\d+)?)\s+([A-Z0-9]+)$/.exec(
        String(valueNodes[0].textContent || "").replace(/\s+/g, " ").trim()
      );
      return match ? { amount: match[1].replace(/,/g, ""), asset: match[2] } : null;
    }).filter(Boolean);
    return candidates.length === 1 ? candidates[0] : null;
  }
  function isCloseQuantityNode(node) {
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    if (!element) return false;
    return element.matches?.(CLOSE_QUANTITY_SELECTOR) || !!element.closest?.(CLOSE_QUANTITY_SELECTOR) || !!element.querySelector?.(CLOSE_QUANTITY_SELECTOR);
  }
  function mutationTouchesCloseQuantity(mutation) {
    if (!mutation) return false;
    if (mutation.type === "characterData") return isCloseQuantityNode(mutation.target);
    if (mutation.type !== "childList") return false;
    if (isCloseQuantityNode(mutation.target)) return true;
    return Array.from(mutation.addedNodes || []).some(isCloseQuantityNode);
  }
  function findTradeFormRoot(activeTab, qtyInput) {
    if (!activeTab?.isConnected || !qtyInput?.isConnected) return null;
    if (activeTab.ownerDocument !== qtyInput.ownerDocument) return null;
    const ownerDocument = activeTab.ownerDocument;
    let candidate = qtyInput.parentElement;
    while (candidate && candidate !== ownerDocument.body && candidate !== ownerDocument.documentElement) {
      if (candidate.contains(activeTab)) return candidate;
      candidate = candidate.parentElement;
    }
    return null;
  }
  function findActiveTradeInputs(ownerDocument, {
    panelId,
    isVisibleElement,
    requirePrice = true
  }) {
    if (!ownerDocument?.querySelectorAll || typeof isVisibleElement !== "function") return null;
    const activeTabs = Array.from(ownerDocument.querySelectorAll(TRADE_MODE_TAB_SELECTOR)).filter((tab) => !tab.closest(`#${panelId}`) && isVisibleElement(tab));
    const qtyInputs = Array.from(ownerDocument.querySelectorAll(TRADE_QTY_INPUT_SELECTOR)).filter((input) => !input.closest(`#${panelId}`) && isVisibleElement(input));
    const matches = [];
    for (const activeTab of activeTabs) {
      for (const qtyInput of qtyInputs) {
        const root = findTradeFormRoot(activeTab, qtyInput);
        if (!root) continue;
        const priceInputs = Array.from(root.querySelectorAll(TRADE_PRICE_INPUT_SELECTOR)).filter((input) => !input.closest(`#${panelId}`) && isVisibleElement(input));
        if (priceInputs.length > 1 || requirePrice && priceInputs.length !== 1) continue;
        matches.push({ root, activeTab, priceInput: priceInputs[0] || null, qtyInput });
      }
    }
    return matches.length === 1 ? matches[0] : null;
  }
  function createBoundedInputWriter({ writeValue, maxWriteAttempts }) {
    if (typeof writeValue !== "function") {
      throw new Error("输入框写入依赖异常");
    }
    if (!Number.isInteger(maxWriteAttempts) || maxWriteAttempts < 1) {
      throw new Error("输入框写入次数必须为正整数");
    }
    const attemptsByInput = /* @__PURE__ */ new WeakMap();
    return (input, value) => {
      const attempts = attemptsByInput.get(input) || 0;
      if (attempts >= maxWriteAttempts) return false;
      attemptsByInput.set(input, attempts + 1);
      writeValue(input, value);
      return true;
    };
  }
  function isScriptOwnedTradeInputRecoveryState({
    preWriteValue,
    rollbackValue,
    submittedValue,
    previousSubmittedValue,
    compareValues
  }) {
    if (typeof compareValues !== "function") {
      throw new Error("输入框恢复校验依赖异常");
    }
    const isScriptOwnedOrEmpty = (value) => value === null || previousSubmittedValue != null && compareValues(previousSubmittedValue, value) === 0;
    return isScriptOwnedOrEmpty(preWriteValue) && isScriptOwnedOrEmpty(rollbackValue) && isScriptOwnedOrEmpty(submittedValue);
  }
  function createTradeInputStateReader({
    resolveInputs,
    expectedPrice,
    expectedQty,
    includePrice,
    normalizeValue,
    compareValues,
    writeValue,
    requiredStableMismatchFrames = 2,
    requiredStableMismatchMs = 0,
    requiredStableMatchFrames = 1,
    requiredStableMatchMs = 0,
    maxWriteAttempts = 2,
    recoverProvisionalMatchRollback = false,
    isRecoveryWriteAllowed = ({ rollbackValue, submittedValue }) => rollbackValue === submittedValue,
    readNowMs = Date.now
  }) {
    if (typeof resolveInputs !== "function" || typeof normalizeValue !== "function" || typeof compareValues !== "function" || typeof writeValue !== "function" || typeof isRecoveryWriteAllowed !== "function" || typeof readNowMs !== "function") {
      throw new Error("交易输入框同步依赖异常");
    }
    if (!Number.isInteger(requiredStableMismatchFrames) || requiredStableMismatchFrames < 1) {
      throw new Error("输入框回退稳定帧数必须为正整数");
    }
    if (!Number.isInteger(requiredStableMatchFrames) || requiredStableMatchFrames < 1) {
      throw new Error("输入框写入稳定帧数必须为正整数");
    }
    if (!Number.isFinite(requiredStableMismatchMs) || requiredStableMismatchMs < 0) {
      throw new Error("输入框回退稳定时间不能为负数");
    }
    if (!Number.isFinite(requiredStableMatchMs) || requiredStableMatchMs < 0) {
      throw new Error("输入框写入稳定时间不能为负数");
    }
    if (!Number.isInteger(maxWriteAttempts) || maxWriteAttempts < 1) {
      throw new Error("输入框写入次数必须为正整数");
    }
    if (typeof recoverProvisionalMatchRollback !== "boolean") {
      throw new Error("输入框临时恢复标记必须为布尔值");
    }
    const createSyncSlot = (field) => {
      let root = null;
      let input = null;
      let writeCount = 0;
      let preWriteValue = null;
      let rollbackValue = null;
      let recoveryEligible = false;
      let stableRollbackFrames = 0;
      let stableRollbackStartedAt = null;
      let stableRollbackValue = null;
      let stableMatchFrames = 0;
      let stableMatchStartedAt = null;
      const clearRecovery = () => {
        preWriteValue = null;
        rollbackValue = null;
        recoveryEligible = false;
        stableRollbackFrames = 0;
        stableRollbackStartedAt = null;
        stableRollbackValue = null;
      };
      const clearMatchStability = () => {
        stableMatchFrames = 0;
        stableMatchStartedAt = null;
      };
      const hasStableDuration = (startedAt, requiredMs, nowMs) => requiredMs === 0 || startedAt != null && nowMs - startedAt >= requiredMs;
      const observeRollbackStability = (submittedValue) => {
        const nowMs = readNowMs();
        if (stableRollbackFrames === 0 || stableRollbackValue !== submittedValue) {
          stableRollbackFrames = 1;
          stableRollbackStartedAt = nowMs;
          stableRollbackValue = submittedValue;
        } else {
          stableRollbackFrames += 1;
        }
        return stableRollbackFrames >= requiredStableMismatchFrames && hasStableDuration(stableRollbackStartedAt, requiredStableMismatchMs, nowMs);
      };
      const writeExpectedValue = (currentInput, expectedValue, submittedValue) => {
        preWriteValue = submittedValue;
        const wrote = writeValue(currentInput, expectedValue);
        if (wrote === false) {
          writeCount = maxWriteAttempts;
          clearRecovery();
          stableMatchFrames = 0;
          return;
        }
        writeCount += 1;
        const postWriteValue = normalizeValue(currentInput.value);
        const rejected = compareValues(expectedValue, postWriteValue) !== 0;
        recoveryEligible = writeCount < maxWriteAttempts && (rejected || recoverProvisionalMatchRollback);
        rollbackValue = rejected ? postWriteValue : submittedValue;
        stableRollbackFrames = 0;
        stableMatchFrames = 0;
      };
      return ({
        currentRoot,
        currentInput,
        expectedValue,
        submittedValue,
        matchesExpected
      }) => {
        if (root !== currentRoot || input !== currentInput) {
          root = currentRoot;
          input = currentInput;
          writeCount = 0;
          clearRecovery();
          clearMatchStability();
        }
        if (matchesExpected) {
          recoveryEligible = false;
          stableRollbackFrames = 0;
          stableRollbackStartedAt = null;
          stableRollbackValue = null;
          const nowMs = readNowMs();
          if (stableMatchFrames === 0) stableMatchStartedAt = nowMs;
          stableMatchFrames += 1;
          return stableMatchFrames >= requiredStableMatchFrames && hasStableDuration(stableMatchStartedAt, requiredStableMatchMs, nowMs);
        }
        if (stableMatchFrames > 0) {
          clearMatchStability();
          recoveryEligible = writeCount < maxWriteAttempts;
          stableRollbackFrames = 0;
          stableRollbackStartedAt = null;
          stableRollbackValue = null;
          if (!recoveryEligible) clearRecovery();
        }
        if (writeCount === 0) {
          writeExpectedValue(currentInput, expectedValue, submittedValue);
          return false;
        }
        if (writeCount >= maxWriteAttempts || !recoveryEligible) return false;
        if (!isRecoveryWriteAllowed({
          field,
          currentRoot,
          currentInput,
          expectedValue,
          preWriteValue,
          rollbackValue,
          submittedValue,
          writeCount
        })) {
          clearRecovery();
          return false;
        }
        if (!observeRollbackStability(submittedValue)) return false;
        writeExpectedValue(currentInput, expectedValue, submittedValue);
        return false;
      };
    };
    const syncQty = createSyncSlot("qty");
    const syncPrice = createSyncSlot("price");
    return () => {
      const inputs = resolveInputs();
      if (!inputs?.qtyInput || includePrice && !inputs.priceInput) return null;
      const submittedQty = normalizeValue(inputs.qtyInput.value);
      const qtyMatches = compareValues(expectedQty, submittedQty) === 0;
      const qtyStable = syncQty({
        currentRoot: inputs.root,
        currentInput: inputs.qtyInput,
        expectedValue: expectedQty,
        submittedValue: submittedQty,
        matchesExpected: qtyMatches
      });
      if (!qtyMatches || !qtyStable) return null;
      if (!includePrice) {
        return { ...inputs, submittedQty };
      }
      const submittedPrice = normalizeValue(inputs.priceInput.value);
      const priceMatches = compareValues(expectedPrice, submittedPrice) === 0;
      const priceStable = syncPrice({
        currentRoot: inputs.root,
        currentInput: inputs.priceInput,
        expectedValue: expectedPrice,
        submittedValue: submittedPrice,
        matchesExpected: priceMatches
      });
      if (!priceMatches || !priceStable) return null;
      return { ...inputs, submittedPrice, submittedQty };
    };
  }
  function findTradePanelInsertionPoint(root) {
    const modeTabs = root?.querySelector?.("#position-direction");
    if (!modeTabs) return null;
    const modeAndOrderTypeColumn = modeTabs.parentElement;
    const modeAndOrderTypeRow = modeAndOrderTypeColumn?.parentElement;
    const tradeHeader = modeAndOrderTypeRow?.parentElement;
    const ownerDocument = modeTabs.ownerDocument;
    const tradeModes = new Set(
      Array.from(modeTabs.querySelectorAll('[role="tab"]')).map((tab) => parseTradeModeLabel(tab.textContent)).filter(Boolean)
    );
    if (!modeAndOrderTypeColumn || !modeAndOrderTypeRow || !tradeHeader || modeAndOrderTypeRow === ownerDocument?.body || tradeHeader === ownerDocument?.documentElement || modeAndOrderTypeRow.firstElementChild !== modeAndOrderTypeColumn || modeAndOrderTypeRow.children.length !== 1 || tradeHeader.firstElementChild === modeAndOrderTypeRow || !tradeModes.has("OPEN") || !tradeModes.has("CLOSE")) {
      return null;
    }
    return {
      parent: tradeHeader,
      before: modeAndOrderTypeRow
    };
  }
  function placeTradePanelSpacer(spacer, insertionPoint) {
    const { parent, before } = insertionPoint || {};
    if (!spacer || !parent || !before || before.parentElement !== parent) return false;
    if (spacer.parentElement !== parent || spacer.nextElementSibling !== before) {
      parent.insertBefore(spacer, before);
    }
    return true;
  }
  function calculateFloatingPanelLayout({
    anchorRect,
    panelHeight,
    viewportWidth,
    viewportHeight,
    minimumWidth = 280,
    margin = 8
  }) {
    if (!anchorRect?.width || !anchorRect?.height) return null;
    const width = Math.min(
      Math.max(anchorRect.width, minimumWidth),
      viewportWidth - margin * 2
    );
    const estimatedHeight = Math.max(panelHeight, 76);
    const left = Math.max(
      margin,
      Math.min(anchorRect.left, viewportWidth - width - margin)
    );
    const top = Math.max(
      margin,
      Math.min(anchorRect.top, viewportHeight - estimatedHeight - margin)
    );
    return {
      width: Math.round(width),
      left: Math.round(left),
      top: Math.round(top)
    };
  }
  function waitForTradeFormMutationState(observationRoot, readState, timeoutMs) {
    const currentState = readState();
    if (currentState) return Promise.resolve(currentState);
    const MutationObserverClass = observationRoot?.ownerDocument?.defaultView?.MutationObserver;
    if (!observationRoot || !MutationObserverClass) return Promise.resolve(null);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearTimeout(timer);
        resolve(value);
      };
      const check = () => {
        const value = readState();
        if (value) finish(value);
      };
      const observer = new MutationObserverClass(check);
      const timer = setTimeout(() => finish(readState()), timeoutMs);
      observer.observe(observationRoot, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["aria-selected", "class"]
      });
      check();
    });
  }
  function waitForTradeFormFrameState(observationRoot, readState, timeoutMs, requiredStableFrames = 2) {
    const view = observationRoot?.ownerDocument?.defaultView;
    if (!view || typeof view.requestAnimationFrame !== "function" || typeof view.cancelAnimationFrame !== "function") {
      throw new Error("交易表单帧调度器不可用");
    }
    if (!Number.isInteger(requiredStableFrames) || requiredStableFrames < 1) {
      throw new Error("稳定帧数必须为正整数");
    }
    return new Promise((resolve) => {
      let settled = false;
      let frameHandle = 0;
      let timer = 0;
      let stableFrames = 0;
      let stableState = null;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (frameHandle) view.cancelAnimationFrame(frameHandle);
        view.clearTimeout(timer);
        resolve(value);
      };
      const check = () => {
        frameHandle = 0;
        const state = readState();
        if (state) {
          stableFrames += 1;
          stableState = state;
          if (stableFrames >= requiredStableFrames) {
            finish(stableState);
            return;
          }
        } else {
          stableFrames = 0;
          stableState = null;
        }
        frameHandle = view.requestAnimationFrame(check);
      };
      timer = view.setTimeout(() => finish(null), timeoutMs);
      frameHandle = view.requestAnimationFrame(check);
    });
  }
  function waitForTradeActionButtonFrameState(observationRoot, findButton, isVisibleElement, timeoutMs, requiredStableFrames = 2) {
    const view = observationRoot?.ownerDocument?.defaultView || observationRoot?.defaultView;
    if (!view || typeof view.requestAnimationFrame !== "function" || typeof view.cancelAnimationFrame !== "function") {
      throw new Error("下单按钮帧调度器不可用");
    }
    if (typeof findButton !== "function" || typeof isVisibleElement !== "function") {
      throw new Error("下单按钮定位器不可用");
    }
    if (!Number.isInteger(requiredStableFrames) || requiredStableFrames < 1) {
      throw new Error("稳定帧数必须为正整数");
    }
    return new Promise((resolve) => {
      let settled = false;
      let frameHandle = 0;
      let timer = 0;
      let stableFrames = 0;
      let stableButton = null;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (frameHandle) view.cancelAnimationFrame(frameHandle);
        view.clearTimeout(timer);
        resolve(value);
      };
      const check = () => {
        frameHandle = 0;
        const button = findButton();
        const actionable = Boolean(
          button && button.isConnected && isVisibleElement(button) && !button.disabled && button.getAttribute("aria-disabled") !== "true"
        );
        if (actionable) {
          if (button === stableButton) {
            stableFrames += 1;
          } else {
            stableButton = button;
            stableFrames = 1;
          }
          if (stableFrames >= requiredStableFrames) {
            finish(button);
            return;
          }
        } else {
          stableButton = null;
          stableFrames = 0;
        }
        frameHandle = view.requestAnimationFrame(check);
      };
      timer = view.setTimeout(() => finish(null), timeoutMs);
      frameHandle = view.requestAnimationFrame(check);
    });
  }
  function isTradeModeTab(node, { panelId }) {
    if (!node?.matches?.('[role="tab"]')) return false;
    if (node.closest(`#${panelId}`)) return false;
    if (!node.matches('#position-direction [role="tab"], .bn-tabs__buySell [role="tab"], [role="tab"].bn-tab__buySell')) {
      return false;
    }
    return parseTradeModeLabel(node.textContent) !== null;
  }
  function isTradeActionButton(node, { panelId }) {
    if (!node?.matches) return false;
    const button = node.matches("button") ? node : node.closest("button");
    if (!button || isOwnPanelButton(button, panelId)) return false;
    return Object.values(BINANCE_PAGE_TEXT.tradeAction).some((labels) => buttonTextMatches(button, labels));
  }
  function collectTradeButtonsFromScopes(scopes, mode, {
    panelId,
    isVisibleElement
  }) {
    const modeLabels = mode === "OPEN" ? [BINANCE_PAGE_TEXT.tradeAction.OPEN_LONG, BINANCE_PAGE_TEXT.tradeAction.OPEN_SHORT] : [BINANCE_PAGE_TEXT.tradeAction.CLOSE_LONG, BINANCE_PAGE_TEXT.tradeAction.CLOSE_SHORT];
    const buttons = [];
    const seen = /* @__PURE__ */ new Set();
    const collectFrom = (scope) => {
      if (!scope) return;
      for (const candidate of scope.querySelectorAll("button")) {
        if (seen.has(candidate) || isOwnPanelButton(candidate, panelId) || !isVisibleElement(candidate)) continue;
        seen.add(candidate);
        if (modeLabels.some((labels) => buttonTextMatches(candidate, labels))) buttons.push(candidate);
      }
    };
    for (const scope of scopes) collectFrom(scope);
    return buttons;
  }
  function parseLeverageButtonText(text) {
    const match = String(text || "").trim().match(/^(\d{1,3})\s*[xX]$/);
    if (!match) return null;
    const leverage = Number(match[1]);
    return leverage >= 1 && leverage <= 125 ? leverage : null;
  }
  function findCurrentLeverageButtonFromScopes(scopes, {
    panelId,
    isVisibleElement
  }) {
    const buttons = [];
    const seen = /* @__PURE__ */ new Set();
    for (const scope of scopes) {
      if (!scope) continue;
      for (const button of scope.querySelectorAll("button")) {
        if (seen.has(button) || isOwnPanelButton(button, panelId) || !isVisibleElement(button)) {
          continue;
        }
        seen.add(button);
        if (parseLeverageButtonText(button.textContent) != null) buttons.push(button);
      }
    }
    return buttons.length === 1 ? buttons[0] : null;
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
  function repriceRemainingLadderOrders({ orders, completedCount, prices }) {
    if (!Array.isArray(orders) || !Number.isInteger(completedCount) || completedCount < 0 || completedCount > orders.length) {
      throw new Error("已完成阶梯订单数无效");
    }
    const remainingCount = orders.length - completedCount;
    if (!Array.isArray(prices) || prices.length !== remainingCount) {
      throw new Error(`重定价数量不一致：预期 ${remainingCount} 个价格`);
    }
    if (prices.some((price) => !isPositiveDecimalString(normalizeDecimalString(price)))) {
      throw new Error("阶梯重定价价格无效");
    }
    return orders.map((order, index) => index < completedCount ? { ...order } : { ...order, price: normalizeDecimalString(prices[index - completedCount]) });
  }

  // src/binance-orderbook-trade/core/panel-options.js
  function normalizeSymbolSide(value) {
    return String(value || "LONG").toUpperCase() === "SHORT" ? "SHORT" : "LONG";
  }
  function symbolSideStorageKey(baseKey, symbol) {
    const normalizedSymbol = String(symbol || "").toUpperCase();
    return normalizedSymbol ? `${baseKey}:${normalizedSymbol}` : null;
  }
  function loadSymbolSide(storage, baseKey, symbol, fallback) {
    const storageKey = symbolSideStorageKey(baseKey, symbol);
    if (!storageKey) return normalizeSymbolSide(fallback);
    const stored = storage.getItem(storageKey);
    return normalizeSymbolSide(stored === null ? fallback : stored);
  }
  function saveSymbolSide(storage, baseKey, symbol, value) {
    const storageKey = symbolSideStorageKey(baseKey, symbol);
    if (!storageKey) return false;
    storage.setItem(storageKey, normalizeSymbolSide(value));
    return true;
  }
  function isSymbolScopedSideStorageKey(key, baseKeys) {
    return !!key && baseKeys.some((baseKey) => key.startsWith(`${baseKey}:`));
  }
  function normalizePrecisionScopeValue(precision) {
    const normalized = String(precision || "").trim();
    return /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized) && Number(normalized) > 0 ? normalized : null;
  }
  function modeSymbolPrecisionOptionStorageKey(modeKeys, mode, symbol, precision) {
    if (mode !== "OPEN" && mode !== "CLOSE") {
      throw new Error(`未知交易模式：${mode}`);
    }
    const baseKey = modeKeys[mode];
    if (!baseKey) throw new Error(`交易模式缺少存储键：${mode}`);
    const normalizedSymbol = String(symbol || "").toUpperCase();
    const normalizedPrecision = normalizePrecisionScopeValue(precision);
    return normalizedSymbol && normalizedPrecision ? `${baseKey}:${normalizedSymbol}:${normalizedPrecision}` : null;
  }
  function loadModeSymbolPrecisionNumberOption(storage, modeKeys, mode, symbol, precision, options, fallback) {
    const storageKey = modeSymbolPrecisionOptionStorageKey(modeKeys, mode, symbol, precision);
    if (!storageKey) return null;
    const storedValue = storage.getItem(storageKey);
    if (storedValue === null) return fallback;
    const stored = Number(storedValue);
    return options.includes(stored) ? stored : fallback;
  }
  function migrateModeSymbolPrecisionNumberOption(storage, modeKeys, mode, symbol, precision, retiredValue, replacementValue, options) {
    const numericReplacement = Number(replacementValue);
    if (!options.includes(numericReplacement)) {
      throw new Error(`替换选项无效：${replacementValue}`);
    }
    const storageKey = modeSymbolPrecisionOptionStorageKey(modeKeys, mode, symbol, precision);
    if (!storageKey) return false;
    const storedValue = storage.getItem(storageKey);
    if (storedValue === null || Number(storedValue) !== Number(retiredValue)) return false;
    storage.setItem(storageKey, String(numericReplacement));
    return true;
  }
  function saveModeSymbolPrecisionNumberOption(storage, modeKeys, mode, symbol, precision, value, options) {
    const numericValue = Number(value);
    if (!options.includes(numericValue)) return false;
    const storageKey = modeSymbolPrecisionOptionStorageKey(modeKeys, mode, symbol, precision);
    if (!storageKey) return false;
    storage.setItem(storageKey, String(numericValue));
    return true;
  }
  function isModeSymbolOptionStorageKey(key, baseKeys) {
    if (!key) return false;
    return baseKeys.some((baseKey) => {
      const prefix = `${baseKey}:`;
      if (!key.startsWith(prefix)) return false;
      const [symbol, precision, extra] = key.slice(prefix.length).split(":");
      return Boolean(symbol && normalizePrecisionScopeValue(precision) && extra === void 0);
    });
  }

  // src/binance-orderbook-trade/core/chart-orders-recovery.js
  var CHART_ORDERS_RECOVERY_STORAGE_KEY = "binance-orderbook-trade:chart-orders-recovery:v2";
  function createChartOrdersRecoveryRecord(nowMs) {
    if (!Number.isFinite(nowMs)) throw new Error("图表委托线恢复时间无效");
    return JSON.stringify({ version: 2, originalChecked: true, createdAtMs: nowMs });
  }
  function parseChartOrdersRecoveryRecord(rawValue, nowMs) {
    if (rawValue === null) return { status: "missing", record: null };
    if (!Number.isFinite(nowMs)) throw new Error("图表委托线恢复当前时间无效");
    let record;
    try {
      record = JSON.parse(rawValue);
    } catch {
      return { status: "invalid", record: null };
    }
    const keys = record && typeof record === "object" ? Object.keys(record).sort() : [];
    if (keys.join(",") !== "createdAtMs,originalChecked,version" || record.version !== 2 || record.originalChecked !== true || !Number.isFinite(record.createdAtMs) || record.createdAtMs > nowMs) {
      return { status: "invalid", record: null };
    }
    return { status: "valid", record };
  }

  // src/binance-orderbook-trade/core/chart-save-coalescer.js
  var IGNORED_DRAWING_EVENT_TYPES = /* @__PURE__ */ new Set(["click", "move"]);
  function validateTradingViewApi(api) {
    if (!api || typeof api !== "object") {
      throw new Error("图表接口不可用");
    }
    if (typeof api.saveChart !== "function") {
      throw new Error("图表保存接口不可用");
    }
    if (typeof api.subscribe !== "function" || typeof api.unsubscribe !== "function") {
      throw new Error("图表事件接口不可用");
    }
  }
  function restoreSaveChartMethod(api, wrapper, originalSaveChart, originalDescriptor) {
    if (api.saveChart !== wrapper) {
      throw new Error("图表保存接口在操作期间发生变化");
    }
    if (originalDescriptor) {
      Object.defineProperty(api, "saveChart", originalDescriptor);
    } else {
      delete api.saveChart;
    }
    if (api.saveChart !== originalSaveChart) {
      throw new Error("图表保存接口未能恢复");
    }
  }
  async function coalesceTradingViewDrawingSaves(api, action, {
    eventDiscoveryTimeoutMs = 800,
    settleQuietMs = 50,
    timeoutMs = 1800,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout
  } = {}) {
    validateTradingViewApi(api);
    if (typeof action !== "function") throw new Error("图表操作不可用");
    if (!Number.isFinite(eventDiscoveryTimeoutMs) || eventDiscoveryTimeoutMs < 0) {
      throw new Error("图表事件等待时间无效");
    }
    if (!Number.isFinite(settleQuietMs) || settleQuietMs <= 0) {
      throw new Error("图表保存稳定等待时间无效");
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error("图表保存超时时间无效");
    }
    const originalSaveChart = api.saveChart;
    const originalDescriptor = Object.getOwnPropertyDescriptor(api, "saveChart");
    let drawingEventCount = 0;
    let saveRequestCount = 0;
    let pendingSave = null;
    let actionFinished = false;
    let eventStartResolve;
    let settleResolve;
    let settleReject;
    let eventDiscoveryTimeout = null;
    let settleQuietTimeout = null;
    let waitTimeout = null;
    let subscribed = false;
    const drawingEventsStarted = new Promise((resolve) => {
      eventStartResolve = resolve;
    });
    const burstSettled = new Promise((resolve, reject) => {
      settleResolve = resolve;
      settleReject = reject;
    });
    const scheduleSettleIfReady = () => {
      if (settleQuietTimeout !== null) {
        clearTimeoutFn(settleQuietTimeout);
        settleQuietTimeout = null;
      }
      if (!actionFinished || drawingEventCount === 0 || saveRequestCount < drawingEventCount) {
        return;
      }
      settleQuietTimeout = setTimeoutFn(() => {
        settleQuietTimeout = null;
        settleResolve();
      }, settleQuietMs);
    };
    const handleDrawingEvent = (_drawingId, eventType) => {
      if (IGNORED_DRAWING_EVENT_TYPES.has(eventType)) return;
      drawingEventCount += 1;
      if (drawingEventCount === 1) eventStartResolve();
      scheduleSettleIfReady();
    };
    const saveChartWrapper = function coalescedSaveChart(...args) {
      saveRequestCount += 1;
      pendingSave = { thisValue: this, args };
      scheduleSettleIfReady();
    };
    api.subscribe("drawing_event", handleDrawingEvent);
    subscribed = true;
    try {
      api.saveChart = saveChartWrapper;
      if (api.saveChart !== saveChartWrapper) {
        throw new Error("图表保存接口无法临时接管");
      }
    } catch (error) {
      api.unsubscribe("drawing_event", handleDrawingEvent);
      throw error;
    }
    try {
      const actionResult = await action();
      actionFinished = true;
      scheduleSettleIfReady();
      if (drawingEventCount === 0 && eventDiscoveryTimeoutMs > 0) {
        await Promise.race([
          drawingEventsStarted,
          new Promise((resolve) => {
            eventDiscoveryTimeout = setTimeoutFn(resolve, eventDiscoveryTimeoutMs);
          })
        ]);
      }
      if (drawingEventCount > 0) {
        scheduleSettleIfReady();
        waitTimeout = setTimeoutFn(() => {
          if (saveRequestCount < drawingEventCount) {
            settleReject(new Error(
              `图表保存请求数量不一致：预期 ${drawingEventCount}，实际 ${saveRequestCount}`
            ));
            return;
          }
          settleReject(new Error(
            `图表保存未在 ${timeoutMs} 毫秒内完成`
          ));
        }, timeoutMs);
        await burstSettled;
      }
      api.unsubscribe("drawing_event", handleDrawingEvent);
      subscribed = false;
      if (pendingSave) {
        originalSaveChart.apply(pendingSave.thisValue, pendingSave.args);
      }
      return {
        actionResult,
        drawingEventCount,
        saveRequestCount,
        fullSaveCount: pendingSave ? 1 : 0
      };
    } finally {
      if (eventDiscoveryTimeout !== null) clearTimeoutFn(eventDiscoveryTimeout);
      if (settleQuietTimeout !== null) clearTimeoutFn(settleQuietTimeout);
      if (waitTimeout !== null) clearTimeoutFn(waitTimeout);
      if (subscribed) api.unsubscribe("drawing_event", handleDrawingEvent);
      restoreSaveChartMethod(api, saveChartWrapper, originalSaveChart, originalDescriptor);
    }
  }

  // src/binance-orderbook-trade/core/cancel-dialog-decision.js
  function resolveCancelDialogDecision({
    seenDialog,
    action,
    dialogVisible,
    aborted,
    nowMs,
    discoveryDeadlineMs
  }) {
    if (aborted) return "aborted";
    if (dialogVisible) return "waiting";
    if (seenDialog) return action === "confirmed" ? "confirmed" : "cancelled";
    if (nowMs >= discoveryDeadlineMs) return "not_found";
    return "waiting";
  }

  // src/binance-orderbook-trade/dom/cancel-all-dialog.js
  var CANCEL_ALL_DIALOG_CANDIDATE_SELECTOR = '[role="dialog"], [class*="modal"], [class*="Modal"]';
  var DIALOG_MUTATION_CANDIDATE_SELECTOR = [
    CANCEL_ALL_DIALOG_CANDIDATE_SELECTOR,
    '[class*="popover"]',
    '[class*="Popover"]',
    '[class*="drawer"]',
    '[class*="Drawer"]'
  ].join(", ");
  var PRIMARY_BUTTON_SELECTOR = "button.bn-button.bn-button__primary";
  function normalizeText2(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }
  function getDialogContract(dialog, isVisibleElement) {
    if (!isVisibleElement(dialog)) return null;
    if (!includesBinancePageText(
      normalizeText2(dialog.textContent),
      BINANCE_PAGE_TEXT.cancelAllDialog
    )) return null;
    const buttons = Array.from(dialog.querySelectorAll("button")).filter(isVisibleElement);
    if (!buttons.length) return null;
    if (buttons.length !== 2) {
      throw new Error(`撤单确认弹窗按钮数量异常：${buttons.length}`);
    }
    const primaryButtons = buttons.filter((button) => button.matches(PRIMARY_BUTTON_SELECTOR));
    if (primaryButtons.length !== 1) {
      throw new Error(`撤单确认按钮数量异常：${primaryButtons.length}`);
    }
    const confirmButton = primaryButtons[0];
    const cancelButton = buttons.find((button) => button !== confirmButton);
    return { dialog, confirmButton, cancelButton };
  }
  function findBinanceCancelAllDialog(document2, isVisibleElement) {
    const contracts = Array.from(document2.querySelectorAll(CANCEL_ALL_DIALOG_CANDIDATE_SELECTOR)).map((dialog) => getDialogContract(dialog, isVisibleElement)).filter(Boolean);
    if (!contracts.length) return null;
    const actionPairs = [];
    for (const contract of contracts) {
      const existing = actionPairs.find((candidate) => candidate.confirmButton === contract.confirmButton && candidate.cancelButton === contract.cancelButton);
      if (!existing) actionPairs.push(contract);
    }
    if (actionPairs.length !== 1) {
      throw new Error(`撤单确认弹窗操作区域数量异常：${actionPairs.length}`);
    }
    return contracts.reduce((innermost, contract) => innermost.dialog.contains(contract.dialog) ? contract : innermost);
  }
  function elementTouchesDialogCandidate(node) {
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    if (!element) return false;
    return element.matches?.(DIALOG_MUTATION_CANDIDATE_SELECTOR) || !!element.closest?.(DIALOG_MUTATION_CANDIDATE_SELECTOR) || !!element.querySelector?.(DIALOG_MUTATION_CANDIDATE_SELECTOR);
  }
  function mutationTouchesDialogCandidate(mutation) {
    if (!mutation) return false;
    if (mutation.type === "attributes") return elementTouchesDialogCandidate(mutation.target);
    if (mutation.type !== "childList") return false;
    if (elementTouchesDialogCandidate(mutation.target)) return true;
    return [...mutation.addedNodes, ...mutation.removedNodes].some(elementTouchesDialogCandidate);
  }
  function createDialogMutationSignal(document2) {
    const MutationObserverClass = document2?.defaultView?.MutationObserver;
    if (!document2?.body || !MutationObserverClass) return null;
    let version = 0;
    let pendingFinish = null;
    const notify = () => {
      version += 1;
      pendingFinish?.("changed");
    };
    const observer = new MutationObserverClass((mutations) => {
      if (mutations.some(mutationTouchesDialogCandidate)) notify();
    });
    observer.observe(document2.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "style", "role", "aria-hidden", "hidden"]
    });
    return {
      get version() {
        return version;
      },
      notify,
      waitForChange(afterVersion, timeoutMs = null) {
        if (version !== afterVersion) return Promise.resolve("changed");
        return new Promise((resolve) => {
          let timer = null;
          const finish = (result) => {
            if (pendingFinish !== finish) return;
            pendingFinish = null;
            if (timer) clearTimeout(timer);
            resolve(result);
          };
          pendingFinish = finish;
          if (timeoutMs !== null) timer = setTimeout(() => finish("timeout"), timeoutMs);
        });
      },
      dispose() {
        observer.disconnect();
        pendingFinish?.("disposed");
      }
    };
  }
  async function waitForDialogMutationState(document2, readState, timeoutMs, abortSignal = null) {
    throwIfAborted(abortSignal);
    const currentState = readState();
    if (currentState) return currentState;
    const signal = createDialogMutationSignal(document2);
    if (!signal) return null;
    const deadline = Date.now() + timeoutMs;
    try {
      while (true) {
        throwIfAborted(abortSignal);
        const version = signal.version;
        const state = readState();
        if (state) return state;
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) return readState();
        await waitForPromiseOrAbort(
          signal.waitForChange(version, remainingMs),
          abortSignal
        );
      }
    } finally {
      signal.dispose();
    }
  }
  function classifyBinanceCancelAllDialogAction(contract, eventTarget) {
    const button = eventTarget?.closest?.("button");
    if (!button || !contract.dialog.contains(button)) return null;
    if (button === contract.confirmButton) return "confirmed";
    if (button === contract.cancelButton) return "cancelled";
    return null;
  }
  function classifyBinanceCancelAllDialogKeyboardAction(contract, key, activeElement) {
    if (key === "Escape") return "cancelled";
    if (key === "Enter") {
      return classifyBinanceCancelAllDialogAction(contract, activeElement) || "confirmed";
    }
    if (key === " ") return classifyBinanceCancelAllDialogAction(contract, activeElement);
    return null;
  }

  // src/binance-orderbook-trade/dom/open-order-rows.js
  var MIN_OPEN_ORDER_COLUMNS = 10;
  function getVisibleDirectChildren(element, isVisibleElement) {
    return Array.from(element?.children || []).filter(isVisibleElement);
  }
  function findOpenOrderRowElement(actionIcon, root, { isVisibleElement }) {
    let candidate = actionIcon?.parentElement || null;
    while (candidate && candidate !== root) {
      if (getVisibleDirectChildren(candidate, isVisibleElement).length >= MIN_OPEN_ORDER_COLUMNS) {
        return candidate;
      }
      candidate = candidate.parentElement;
    }
    return null;
  }
  function findOpenOrderRowElements(root, {
    isVisibleElement,
    isRowCancelIcon
  }) {
    if (!root) return [];
    const rows = /* @__PURE__ */ new Set();
    for (const icon of root.querySelectorAll("svg[aria-label]")) {
      if (!isVisibleElement(icon) || !isRowCancelIcon(icon)) continue;
      const row = findOpenOrderRowElement(icon, root, { isVisibleElement });
      if (row) rows.add(row);
    }
    return Array.from(rows);
  }
  function getOpenOrderRowCells(row, { isVisibleElement }) {
    const cells = getVisibleDirectChildren(row, isVisibleElement);
    return cells.length >= MIN_OPEN_ORDER_COLUMNS ? cells : [];
  }

  // src/binance-orderbook-trade/dom/tradingview-target.js
  var CHART_ROOT_SELECTOR = ".chart-widget-root";
  function hasVisibleBox(element) {
    if (!element?.getClientRects().length) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  function findBinanceTradingViewTarget(document2) {
    const chartRoots = Array.from(document2.querySelectorAll(CHART_ROOT_SELECTOR)).filter(hasVisibleBox);
    if (!chartRoots.length) return null;
    if (chartRoots.length > 1) {
      throw new Error(`可见图表区域数量异常：${chartRoots.length}`);
    }
    const chartRoot = chartRoots[0];
    const tradingViewApis = Array.from(chartRoot.querySelectorAll("iframe")).map((frame) => frame.contentWindow?.tradingViewApi).filter(Boolean);
    if (!tradingViewApis.length) return null;
    if (tradingViewApis.length > 1) {
      throw new Error(`图表接口数量异常：${tradingViewApis.length}`);
    }
    return { chartRoot, tradingViewApi: tradingViewApis[0] };
  }

  // src/binance-orderbook-trade/dom/chart-orders.js
  var ACTIVE_POPOVER_SELECTOR = ".bn-bubble.active";
  var OPEN_ORDERS_LABEL_PATTERN = /^(?:当前委托|Open Orders)$/i;
  var LATEST_PRICE_CONTROL_SELECTOR = ".bn-tooltips-wrap.bn-tooltips-web.w-full.cursor-pointer";
  function normalizeLabel(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }
  function hasVisibleBox2(element) {
    if (!element?.getClientRects().length) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  function findBinanceChartOrdersTarget(document2) {
    const tradingViewTarget = findBinanceTradingViewTarget(document2);
    if (!tradingViewTarget) return null;
    const { chartRoot, tradingViewApi } = tradingViewTarget;
    const toolbars = Array.from(chartRoot.querySelectorAll(".flex.items-center")).filter((toolbar2) => {
      if (toolbar2.children.length < 2) return false;
      const trigger2 = toolbar2.children[toolbar2.children.length - 2];
      const latestPriceSlot = toolbar2.children[toolbar2.children.length - 1];
      const latestPriceControl = latestPriceSlot.matches(LATEST_PRICE_CONTROL_SELECTOR) ? latestPriceSlot : Array.from(latestPriceSlot.children).find((child) => child.matches(LATEST_PRICE_CONTROL_SELECTOR));
      return hasVisibleBox2(toolbar2) && hasVisibleBox2(trigger2) && trigger2.matches(".bn-tooltips-wrap.bn-tooltips-web") && hasVisibleBox2(latestPriceControl);
    });
    if (!toolbars.length) return null;
    if (toolbars.length > 1) {
      throw new Error(`图表工具栏数量异常：${toolbars.length}`);
    }
    const toolbar = toolbars[0];
    const trigger = toolbar.children[toolbar.children.length - 2];
    const popoverReferences = Array.from(
      trigger.querySelectorAll(".bn-tooltips-ele[aria-describedby]")
    );
    if (popoverReferences.length !== 1) {
      throw new Error(`图表“显示当前委托”菜单入口数量异常：${popoverReferences.length}`);
    }
    const popoverId = popoverReferences[0].getAttribute("aria-describedby");
    if (!popoverId) throw new Error("图表“显示当前委托”菜单标识缺失");
    return {
      chartRoot,
      tradingViewApi,
      toolbar,
      trigger,
      popoverId
    };
  }
  function getBinanceChartOrdersTarget(document2) {
    const target = findBinanceChartOrdersTarget(document2);
    if (!target) throw new Error("未找到图表“显示当前委托”控件");
    return target;
  }
  function assertSameBinanceChartOrdersTarget(capturedTarget, currentTarget) {
    if (!capturedTarget || !currentTarget) {
      throw new Error("未找到图表“显示当前委托”控件");
    }
    if (capturedTarget.chartRoot !== currentTarget.chartRoot || capturedTarget.tradingViewApi !== currentTarget.tradingViewApi || capturedTarget.toolbar !== currentTarget.toolbar || capturedTarget.trigger !== currentTarget.trigger || capturedTarget.popoverId !== currentTarget.popoverId) {
      throw new Error("图表“显示当前委托”控件已变化");
    }
  }
  function findActiveBinanceChartOrdersPopover(document2, target, isVisibleElement) {
    if (!target?.popoverId) throw new Error("未找到图表“显示当前委托”控件");
    const popover = document2.getElementById(target.popoverId);
    if (!popover || !popover.matches(ACTIVE_POPOVER_SELECTOR) || !isVisibleElement(popover)) {
      return null;
    }
    const checkboxes = Array.from(popover.querySelectorAll('[role="checkbox"]')).filter(isVisibleElement).filter((checkbox2) => OPEN_ORDERS_LABEL_PATTERN.test(normalizeLabel(checkbox2.textContent)));
    if (!checkboxes.length) return null;
    if (checkboxes.length > 1) {
      throw new Error(`图表“显示当前委托”选项数量异常：${checkboxes.length}`);
    }
    const checkbox = checkboxes[0];
    const checkedValue = checkbox.getAttribute("aria-checked");
    if (checkedValue !== "true" && checkedValue !== "false") {
      throw new Error(`图表“显示当前委托”状态异常：${checkedValue}`);
    }
    return { popover, checkbox, checked: checkedValue === "true" };
  }

  // src/binance-orderbook-trade/dom/usdt-rebalance-dialog.js
  var USDT_REBALANCE_DIALOG_ID = "jh-binance-usdt-rebalance-dialog";
  var STYLE_ID = "jh-binance-usdt-rebalance-dialog-style";
  function assertText(value, field) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`Invalid USDT rebalance dialog ${field}`);
    }
  }
  function assertModel(model) {
    if (!model || !Array.isArray(model.balanceRows) || !Array.isArray(model.transferRows)) {
      throw new Error("Invalid USDT rebalance dialog model");
    }
    for (const field of [
      "title",
      "targetSummary",
      "accountHeading",
      "currentHeading",
      "targetHeading",
      "transferHeading",
      "question",
      "cancelLabel",
      "confirmLabel"
    ]) {
      assertText(model[field], field);
    }
    for (const row of model.balanceRows) {
      assertText(row?.account, "balance account");
      assertText(row?.current, "current balance");
      assertText(row?.target, "target balance");
    }
    if (model.transferRows.length === 0) {
      throw new Error("USDT rebalance dialog requires at least one transfer");
    }
    for (const row of model.transferRows) {
      assertText(row?.route, "transfer route");
      assertText(row?.amount, "transfer amount");
    }
  }
  function appendTextElement(document2, parent, tagName, className, text) {
    const element = document2.createElement(tagName);
    element.className = className;
    element.textContent = text;
    parent.appendChild(element);
    return element;
  }
  function installDialogStyle(document2) {
    if (document2.getElementById(STYLE_ID)) return;
    const style = document2.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
    #${USDT_REBALANCE_DIALOG_ID} {
      box-sizing: border-box;
      width: min(440px, calc(100vw - 32px));
      max-height: calc(100vh - 32px);
      margin: auto;
      padding: 0;
      overflow: hidden;
      border: 1px solid var(--color-InputLine, #eaecef);
      border-radius: 12px;
      background: var(--color-BasicBg, #fff);
      color: var(--color-PrimaryText, #1e2329);
      box-shadow: 0 8px 32px rgba(0, 0, 0, .18);
      font-family: BinancePlex, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 14px;
      line-height: 20px;
    }
    #${USDT_REBALANCE_DIALOG_ID}::backdrop {
      background: rgba(0, 0, 0, .48);
    }
    #${USDT_REBALANCE_DIALOG_ID} .jh-rebalance-dialog-header {
      padding: 20px 24px 12px;
      font-size: 20px;
      font-weight: 600;
      line-height: 28px;
    }
    #${USDT_REBALANCE_DIALOG_ID} .jh-rebalance-dialog-body {
      max-height: calc(100vh - 190px);
      padding: 0 24px;
      overflow: auto;
    }
    #${USDT_REBALANCE_DIALOG_ID} .jh-rebalance-dialog-summary {
      margin-bottom: 16px;
      color: var(--color-SecondaryText, #474d57);
    }
    #${USDT_REBALANCE_DIALOG_ID} .jh-rebalance-dialog-table {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(92px, auto) minmax(92px, auto);
      gap: 0;
      overflow: hidden;
      border: 1px solid var(--color-InputLine, #eaecef);
      border-radius: 8px;
    }
    #${USDT_REBALANCE_DIALOG_ID} .jh-rebalance-dialog-cell {
      min-width: 0;
      padding: 9px 10px;
      overflow: hidden;
      border-bottom: 1px solid var(--color-InputLine, #eaecef);
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    #${USDT_REBALANCE_DIALOG_ID} .jh-rebalance-dialog-cell:nth-last-child(-n + 3) {
      border-bottom: 0;
    }
    #${USDT_REBALANCE_DIALOG_ID} .jh-rebalance-dialog-cell--heading {
      background: var(--color-InputBg, #f5f5f5);
      color: var(--color-TertiaryText, #707a8a);
      font-size: 12px;
      font-weight: 500;
    }
    #${USDT_REBALANCE_DIALOG_ID} .jh-rebalance-dialog-cell--number {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    #${USDT_REBALANCE_DIALOG_ID} .jh-rebalance-dialog-section-title {
      margin: 18px 0 8px;
      font-weight: 500;
    }
    #${USDT_REBALANCE_DIALOG_ID} .jh-rebalance-dialog-transfer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 8px 0;
      border-bottom: 1px solid var(--color-InputLine, #eaecef);
    }
    #${USDT_REBALANCE_DIALOG_ID} .jh-rebalance-dialog-transfer:last-child {
      border-bottom: 0;
    }
    #${USDT_REBALANCE_DIALOG_ID} .jh-rebalance-dialog-transfer-amount {
      flex: 0 0 auto;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
    }
    #${USDT_REBALANCE_DIALOG_ID} .jh-rebalance-dialog-question {
      margin-top: 14px;
      color: var(--color-SecondaryText, #474d57);
    }
    #${USDT_REBALANCE_DIALOG_ID} .jh-rebalance-dialog-footer {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      padding: 20px 24px 24px;
    }
    #${USDT_REBALANCE_DIALOG_ID} .jh-rebalance-dialog-button {
      height: 40px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
    }
    #${USDT_REBALANCE_DIALOG_ID} .jh-rebalance-dialog-button--cancel {
      border: 1px solid var(--color-InputLine, #d8dce1);
      background: var(--color-BasicBg, #fff);
      color: var(--color-PrimaryText, #1e2329);
    }
    #${USDT_REBALANCE_DIALOG_ID} .jh-rebalance-dialog-button--confirm {
      border: 1px solid var(--color-PrimaryYellow, #f0b90b);
      background: var(--color-PrimaryYellow, #f0b90b);
      color: var(--color-TextOnYellow, #202630);
    }
  `;
    (document2.head || document2.documentElement).appendChild(style);
  }
  function showUsdtRebalanceDialog(document2, model) {
    assertModel(model);
    if (document2.getElementById(USDT_REBALANCE_DIALOG_ID)) {
      throw new Error("USDT rebalance dialog is already open");
    }
    installDialogStyle(document2);
    const dialog = document2.createElement("dialog");
    dialog.id = USDT_REBALANCE_DIALOG_ID;
    dialog.setAttribute("aria-labelledby", `${USDT_REBALANCE_DIALOG_ID}-title`);
    const title = appendTextElement(
      document2,
      dialog,
      "div",
      "jh-rebalance-dialog-header",
      model.title
    );
    title.id = `${USDT_REBALANCE_DIALOG_ID}-title`;
    const body = document2.createElement("div");
    body.className = "jh-rebalance-dialog-body";
    dialog.appendChild(body);
    appendTextElement(
      document2,
      body,
      "div",
      "jh-rebalance-dialog-summary",
      model.targetSummary
    );
    const table = document2.createElement("div");
    table.className = "jh-rebalance-dialog-table";
    table.setAttribute("role", "table");
    body.appendChild(table);
    for (const heading of [model.accountHeading, model.currentHeading, model.targetHeading]) {
      appendTextElement(
        document2,
        table,
        "div",
        "jh-rebalance-dialog-cell jh-rebalance-dialog-cell--heading",
        heading
      ).setAttribute("role", "columnheader");
    }
    for (const row of model.balanceRows) {
      appendTextElement(document2, table, "div", "jh-rebalance-dialog-cell", row.account).setAttribute("role", "cell");
      appendTextElement(
        document2,
        table,
        "div",
        "jh-rebalance-dialog-cell jh-rebalance-dialog-cell--number",
        row.current
      ).setAttribute("role", "cell");
      appendTextElement(
        document2,
        table,
        "div",
        "jh-rebalance-dialog-cell jh-rebalance-dialog-cell--number",
        row.target
      ).setAttribute("role", "cell");
    }
    appendTextElement(
      document2,
      body,
      "div",
      "jh-rebalance-dialog-section-title",
      model.transferHeading
    );
    const transfers = document2.createElement("div");
    body.appendChild(transfers);
    for (const row of model.transferRows) {
      const transfer = document2.createElement("div");
      transfer.className = "jh-rebalance-dialog-transfer";
      appendTextElement(document2, transfer, "span", "jh-rebalance-dialog-transfer-route", row.route);
      appendTextElement(
        document2,
        transfer,
        "span",
        "jh-rebalance-dialog-transfer-amount",
        row.amount
      );
      transfers.appendChild(transfer);
    }
    appendTextElement(
      document2,
      body,
      "div",
      "jh-rebalance-dialog-question",
      model.question
    );
    const footer = document2.createElement("div");
    footer.className = "jh-rebalance-dialog-footer";
    dialog.appendChild(footer);
    const cancelButton = appendTextElement(
      document2,
      footer,
      "button",
      "jh-rebalance-dialog-button jh-rebalance-dialog-button--cancel",
      model.cancelLabel
    );
    cancelButton.type = "button";
    cancelButton.dataset.rebalanceDialogAction = "cancel";
    const confirmButton = appendTextElement(
      document2,
      footer,
      "button",
      "jh-rebalance-dialog-button jh-rebalance-dialog-button--confirm",
      model.confirmLabel
    );
    confirmButton.type = "button";
    confirmButton.dataset.rebalanceDialogAction = "confirm";
    document2.body.appendChild(dialog);
    dialog.showModal();
    cancelButton.focus();
    return new Promise((resolve) => {
      let settled = false;
      const finish = (confirmed) => {
        if (settled) return;
        settled = true;
        if (dialog.open) dialog.close();
        dialog.remove();
        resolve(confirmed);
      };
      cancelButton.addEventListener("click", () => finish(false));
      confirmButton.addEventListener("click", () => finish(true));
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        finish(false);
      });
      dialog.addEventListener("close", () => finish(false));
    });
  }

  // src/binance-orderbook-trade/index.user.js
  (function() {
    "use strict";
    function isFuturesTradingPage() {
      return isFuturesTradingPathname(location.pathname);
    }
    if (!isFuturesTradingPage()) return;
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
    const LOCAL_LADDER_OPEN_PERCENT_KEY = "jh_binance_ladder_open_percent";
    const LOCAL_LADDER_CLOSE_PERCENT_KEY = "jh_binance_ladder_close_percent";
    const LOCAL_LADDER_OPEN_LEVELS_KEY = "jh_binance_ladder_open_levels";
    const LOCAL_LADDER_CLOSE_LEVELS_KEY = "jh_binance_ladder_close_levels";
    const LOCAL_LADDER_OPEN_STEP_KEY = "jh_binance_ladder_open_step";
    const LOCAL_LADDER_CLOSE_STEP_KEY = "jh_binance_ladder_close_step";
    const LOCAL_ORDERBOOK_PRECISION_SAMPLES_PREFIX = "jh_binance_orderbook_precision_samples_v3";
    const BINANCE_PERSIST_KEY = "persist:futures-trade-ui";
    const BINANCE_POST_ONLY_ORDER_TYPE = "POST_ONLY";
    const BINANCE_CLOSEABLE_QUANTITY_LABEL_PATTERN = buildBinanceTextAlternation(
      BINANCE_PAGE_TEXT.closeableQuantity
    );
    const BINANCE_OPENABLE_QUANTITY_LABEL_PATTERN = buildBinanceTextAlternation(
      BINANCE_PAGE_TEXT.openableQuantity
    );
    const BINANCE_POST_ONLY_TIME_IN_FORCE = "GTC";
    const PANEL_ID = "jh-binance-close-qty-multiplier-panel";
    const PANEL_Z_INDEX = 1e3;
    const SPACER_ID = "jh-binance-close-qty-multiplier-spacer";
    const INPUT_ID = "jh-binance-close-qty-multiplier-input";
    const DEC_ID = "jh-binance-close-qty-multiplier-dec";
    const INC_ID = "jh-binance-close-qty-multiplier-inc";
    const SIDE_LONG_ID = "jh-binance-close-side-long";
    const SIDE_SHORT_ID = "jh-binance-close-side-short";
    const LADDER_BODY_ID = "jh-binance-ladder-body";
    const LADDER_STATUS_ID = "jh-binance-ladder-status";
    const LADDER_STATUS_ROW_ID = "jh-binance-ladder-status-row";
    const USDT_REBALANCE_ACTION_ID = "jh-binance-usdt-rebalance-action";
    const MULTIPLIER_PRESS_FEEDBACK_ATTR = "data-jh-press-feedback";
    const ORDERBOOK_PRECISION_RECOMMENDATION_ID = "jh-binance-orderbook-precision-recommendation";
    const DEFAULT_MULTIPLIER = "1";
    const DEFAULT_CLOSE_SIDE = "LONG";
    const DEFAULT_OPEN_SIDE = "LONG";
    const DEFAULT_LADDER_OPEN_PERCENT = 2;
    const DEFAULT_LADDER_CLOSE_PERCENT = 0.3;
    const DEFAULT_LADDER_LEVELS = 5;
    const DEFAULT_LADDER_STEP = 5;
    const LADDER_OPEN_PERCENTS = [2, 10, 30, 50, 70];
    const LADDER_CLOSE_PERCENTS = [0.3, 1, 5, 10, 30];
    const LADDER_LEVEL_OPTIONS = [3, 5, 7, 9];
    const LADDER_STEP_MIN = 1;
    const LADDER_STEP_MAX = 5;
    const LADDER_STEP_OPTIONS = [1, 2, 3, 4, 5];
    const MULTIPLIER_STORAGE_KEYS = {
      OPEN: `${LOCAL_QTY_MULTIPLIER_PREFIX}:OPEN`,
      CLOSE: `${LOCAL_QTY_MULTIPLIER_PREFIX}:CLOSE`
    };
    const LADDER_PERCENT_STORAGE_KEYS = {
      OPEN: LOCAL_LADDER_OPEN_PERCENT_KEY,
      CLOSE: LOCAL_LADDER_CLOSE_PERCENT_KEY
    };
    const LADDER_LEVELS_STORAGE_KEYS = {
      OPEN: LOCAL_LADDER_OPEN_LEVELS_KEY,
      CLOSE: LOCAL_LADDER_CLOSE_LEVELS_KEY
    };
    const LADDER_STEP_STORAGE_KEYS = {
      OPEN: LOCAL_LADDER_OPEN_STEP_KEY,
      CLOSE: LOCAL_LADDER_CLOSE_STEP_KEY
    };
    const LADDER_OPTION_STORAGE_KEYS = [
      LOCAL_LADDER_OPEN_PERCENT_KEY,
      LOCAL_LADDER_CLOSE_PERCENT_KEY,
      LOCAL_LADDER_OPEN_LEVELS_KEY,
      LOCAL_LADDER_CLOSE_LEVELS_KEY,
      LOCAL_LADDER_OPEN_STEP_KEY,
      LOCAL_LADDER_CLOSE_STEP_KEY
    ];
    const LADDER_SUBMIT_START_TIMEOUT_MS = 3500;
    const LADDER_SUBMIT_RESPONSE_TIMEOUT_MS = 12e3;
    const LADDER_ACTION_FEEDBACK_MIN_MS = 240;
    const CONTINUOUS_CLOSE_POSITION_CHECK_MS = 1e3;
    const MULTIPLIER_PRESS_FEEDBACK_MS = 140;
    const LADDER_REPLACE_OPEN_ORDERS_CLEAR_TIMEOUT_MS = 6500;
    const LADDER_REPLACE_ROW_SETTLE_MS = 240;
    const MAX_OPEN_ORDERS_RECOVERY_CANCEL_COUNT = 50;
    const OPEN_ORDERS_LAZY_LOAD_SETTLE_MS = 700;
    const OPEN_ORDERS_LAZY_LOAD_TIMEOUT_MS = 7e3;
    const CANCEL_OPEN_ORDERS_CLEAR_SETTLE_MS = 1200;
    const ROW_CANCEL_DIALOG_CLOSE_TIMEOUT_MS = 6e4;
    const CANCEL_DIALOG_DISCOVERY_TIMEOUT_MS = 1800;
    const CANCEL_NO_ORDERS_FEEDBACK_MS = 600;
    const CHART_ORDERS_MENU_TIMEOUT_MS = 1800;
    const CHART_ORDERS_MENU_POLL_MS = 50;
    const LADDER_MAKER_BUFFER_LEVELS = 1;
    const LADDER_REPRICE_PAUSE_EVERY_ATTEMPTS = 5;
    const LADDER_REPRICE_PAUSE_MS = 3e3;
    const LADDER_REPRICE_DELAY_MS = 180;
    const BINANCE_PLACE_ORDER_BAPI_PATH = "/bapi/futures/v1/private/future/order/place-order";
    const BINANCE_USER_POSITION_BAPI_PATH = "/bapi/futures/v6/private/future/user-data/user-position";
    const BINANCE_WALLET_BALANCE_BAPI_PATH = "/bapi/asset/v2/private/asset-service/wallet/balance?needBalanceDetail=true&quoteAsset=USDT";
    const BINANCE_FUTURES_MAX_WITHDRAW_BAPI_PATH = "/bapi/futures/v1/private/future/user-data/getMaxWithdrawAmount";
    const BINANCE_WALLET_TRANSFER_BAPI_PATH = "/bapi/asset/v1/private/asset-service/wallet/transfer";
    const USDT_REBALANCE_FLAT_STABLE_MS = 3e3;
    const USDT_REBALANCE_REQUEST_TIMEOUT_MS = 5e3;
    const USDT_REBALANCE_BALANCE_POLL_MS = 1e3;
    const LADDER_OPEN_QTY_READY_TIMEOUT_MS = 1200;
    const TRADE_INPUT_SYNC_TIMEOUT_MS = 350;
    const TRADE_INPUT_SYNC_STABLE_FRAMES = 2;
    const LADDER_INPUT_SETTLE_TIMEOUT_MS = 1200;
    const LADDER_INPUT_SETTLE_STABLE_MS = 180;
    const LADDER_INPUT_SETTLE_MAX_WRITES = 5;
    const ORDERBOOK_PRECISION_READY_POLL_MS = 100;
    const ORDERBOOK_PRECISION_READY_TIMEOUT_MS = 5e3;
    const ORDERBOOK_PRECISION_OPTION_WAIT_MS = 1200;
    const ORDERBOOK_PRECISION_INITIAL_TRADE_LIMIT = 10;
    const ORDERBOOK_PRECISION_TRADE_EXPANSION_STEP = 10;
    const ORDERBOOK_PRECISION_MIN_EFFECTIVE_MOVES = 5;
    const ORDERBOOK_PRECISION_SHORTCUT_LIMIT = 4;
    const ORDERBOOK_PRECISION_REFRESH_FEEDBACK_MS = 900;
    const ORDERBOOK_PRECISION_CANDIDATE_OPTIONS = [
      "0.00000001",
      "0.0000001",
      "0.000001",
      "0.00001",
      "0.0001",
      "0.001",
      "0.01",
      "0.1",
      "1",
      "10",
      "100",
      "1000"
    ];
    const DEFAULT_OPEN_LEVERAGE = 2;
    const BNC_HEADERS_READY_TIMEOUT_MS = 5e3;
    const AUTO_OPEN_LEVERAGE_DEDUPE_MS = 1200;
    const DOM_LOOKUP_CACHE_MS = 250;
    const INPUT_BORDER_COLOR = "var(--color-InputLine)";
    const INPUT_ERROR_COLOR = "var(--color-Error)";
    const INPUT_FOCUS_COLOR = "var(--color-PrimaryYellow)";
    const INPUT_DEFAULT_BG = "transparent";
    const PRIMARY_EMPHASIS_COLOR = "#000000";
    const PRIMARY_EMPHASIS_FONT_WEIGHT = "500";
    const CONTROL_BORDER_COLOR = "#d5d9e2";
    const PANEL_DIVIDER_COLOR = "#ededed";
    const CONTROL_BACKGROUND_COLOR = "#ffffff";
    const CONTROL_TEXT_COLOR = "#5e6673";
    const CONTROL_FONT_WEIGHT = "500";
    const MUTED_TEXT_COLOR = "#76808f";
    const NEUTRAL_CONTROL_STYLE = `border-color:${CONTROL_BORDER_COLOR};background:${CONTROL_BACKGROUND_COLOR};color:${CONTROL_TEXT_COLOR};font-weight:${CONTROL_FONT_WEIGHT};cursor:pointer;opacity:1;`;
    const DISABLED_CONTROL_BORDER = CONTROL_BORDER_COLOR;
    const DISABLED_CONTROL_BG = "#f5f5f5";
    const DISABLED_CONTROL_TEXT = "#b7bdc6";
    const DISABLED_CONTROL_OPACITY = "0.65";
    const LADDER_CONTROL_BUTTON_HEIGHT = 32;
    const LADDER_CONTROL_BUTTON_FONT_SIZE = 14;
    const PANEL_BOTTOM_TOOLTIP_GAP = 12;
    const TRADE_UI_STATE_TIMEOUT_MS = 1e3;
    const TRADE_ACTION_BUTTON_READY_TIMEOUT_SECONDS = 3;
    const TRADE_ACTION_BUTTON_READY_TIMEOUT_MS = TRADE_ACTION_BUTTON_READY_TIMEOUT_SECONDS * 1e3;
    const ROUTE_WATCHDOG_MS = 5e3;
    let lastTs = 0;
    let isEditingMultiplier = false;
    let multiplierEditContext = null;
    let renderPanelQueued = false;
    let renderPanelFollowUpTimer = 0;
    let tradeUiMutationObserver = null;
    let tradeUiMutationTimeout = 0;
    let tradeUiMutationDebounceTimer = 0;
    let tradeModeTabObserver = null;
    let tradeModeTabObserverRoot = null;
    let accountPositionObserver = null;
    let accountPositionObserverRoot = null;
    let lastObservedAccountPositionCount = null;
    let lastObservedAccountOpenOrdersCount = null;
    let lastObservedAccountPositionState = null;
    let lastConfirmedCloseState = null;
    let lastDisplayCloseState = null;
    let closeGuard = null;
    let autoOpenLeverageTask = null;
    let pendingAutoOpenLeverageReset = null;
    let autoOpenLeveragePositionCheckTask = null;
    let pendingAutoOpenLeveragePositionCheck = null;
    let lastAutoOpenLeverage = { symbol: null, at: 0 };
    let tradeButtonCache = { mode: null, expiresAt: 0, buttons: [] };
    let tradeScopeCache = { activeTab: null, expiresAt: 0, scopes: [] };
    let ladderTask = null;
    let continuousLadderTask = null;
    let singleOrderTask = null;
    let ladderAbortController = null;
    let continuousLadderAbortController = null;
    let activeLadderActionType = null;
    let activeContinuousLadderActionType = null;
    let activeContinuousLadderProgress = null;
    let activeContinuousLadderRoundProgress = null;
    let activeLadderPanelContext = null;
    let cancelCurrentSymbolOpenOrdersTask = null;
    let cancelCurrentSymbolOpenOrdersBlocksLadderActions = false;
    let cancelNoOrdersFeedbackActive = false;
    let cancelNoOrdersFeedbackTimer = 0;
    let chartOrdersRecoveryPendingAtStartup = sessionStorage.getItem(CHART_ORDERS_RECOVERY_STORAGE_KEY) !== null;
    let chartOrdersRecoveryTask = null;
    let chartOrdersRecoveryLastError = null;
    let ladderStopRequested = false;
    let activeUiLocale = resolveUiLocaleFromPathname(location.pathname);
    let ladderStatusText = PANEL_COPY.state.idle;
    let ladderStatusTitle = PANEL_COPY.state.idle;
    let usdtRebalanceEligibilityTimer = 0;
    let usdtRebalanceEligibilityEpoch = 0;
    let usdtRebalanceEligibilityTask = null;
    let usdtRebalanceEligible = false;
    let usdtRebalanceTask = null;
    let ladderPanelBodySignature = "";
    let panelPositionInvalidated = true;
    let panelObservedSize = "";
    let panelResizeObserver = null;
    let ladderSubmitCaptureSequence = 0;
    let activeLadderSubmitCapture = null;
    const multiplierPressFeedbackTimers = /* @__PURE__ */ new WeakMap();
    let orderbookPrecisionSelectionTask = null;
    let orderbookPrecisionOptionsLoadRequestedSymbol = null;
    let orderbookPrecisionOptionsLoadAttemptedSymbol = null;
    let orderbookPrecisionObserver = null;
    let orderbookPrecisionObserverRoot = null;
    let lastObservedOrderbookPrecision = null;
    let orderbookPrecisionRefreshFeedback = { symbol: null, state: "idle" };
    let orderbookPrecisionRefreshFeedbackTimer = null;
    let orderbookPrecisionState = {
      symbol: null,
      samples: [],
      recommendation: null,
      current: null,
      nativeOptions: [],
      nativeOptionsStatus: null,
      status: PANEL_COPY.status.precisionInsufficient
    };
    const controlledNativeButtons = /* @__PURE__ */ new Set();
    let lastObservedSymbol = getCurrentSymbol();
    const MODE_HINT_ID = "jh-binance-trade-mode-hint";
    const MULTIPLIER_HINT_ID = "jh-binance-qty-multiplier-hint";
    const NATIVE_ACTION_DISABLED_ATTR = "data-jh-native-action-disabled";
    const PREFIX = "[订单簿下单]";
    (function injectDisabledControlStyle() {
      const styleId = "jh-disabled-control-style";
      if (document.getElementById(styleId)) return;
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
      button[${NATIVE_ACTION_DISABLED_ATTR}="true"],
      #${PANEL_ID} button:disabled {
        background: ${DISABLED_CONTROL_BG} !important;
        color: ${DISABLED_CONTROL_TEXT} !important;
        border-color: ${DISABLED_CONTROL_BORDER} !important;
        opacity: ${DISABLED_CONTROL_OPACITY} !important;
        font-weight: ${CONTROL_FONT_WEIGHT} !important;
        cursor: not-allowed !important;
      }
      #${PANEL_ID} button[${MULTIPLIER_PRESS_FEEDBACK_ATTR}="true"] {
        background: ${DISABLED_CONTROL_BG} !important;
        color: ${DISABLED_CONTROL_TEXT} !important;
        border-color: ${DISABLED_CONTROL_BORDER} !important;
        opacity: ${DISABLED_CONTROL_OPACITY} !important;
      }
      button[${NATIVE_ACTION_DISABLED_ATTR}="true"] {
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
      input.blur();
    }
    function delay(ms) {
      return new Promise((resolve) => {
        window.setTimeout(resolve, ms);
      });
    }
    function createLadderStoppedError() {
      const error = new Error("已停止");
      error.name = "LadderStoppedError";
      return error;
    }
    function isLadderStoppedError(error) {
      return error?.name === "LadderStoppedError";
    }
    function createContinuousRecoverableLadderError(kind, message) {
      const localizedMessage = localizeKnownUiStatus(message);
      const error = new Error(formatLocalizedText(localizedMessage, "zh-CN"));
      error.safeNoSubmit = true;
      error.continuousRecoveryKind = kind;
      error.localizedText = localizedMessage;
      return error;
    }
    function createContinuousUnconfirmedSubmitError(message) {
      if (!isLocalizedText(message)) throw new Error("未确认下单结果文案必须提供中英文");
      const error = new Error(formatLocalizedText(message, "zh-CN"));
      error.continuousRecoveryKind = "submit_unconfirmed";
      error.localizedText = message;
      return error;
    }
    function removeContinuousTerminalWording(message) {
      const localizedMessage = localizeKnownUiStatus(message);
      const zh = formatLocalizedText(localizedMessage, "zh-CN").replace(/[，；]\s*已停止(?:重新挂单)?/g, "");
      const en = formatLocalizedText(localizedMessage, "en").replace(/;\s*(?:replacement\s+)?stopped\b/gi, "");
      return localizedText(zh, en);
    }
    function createContinuousRoundRecoveryError(kind, message, cooldownMs = null) {
      const localizedMessage = removeContinuousTerminalWording(message);
      const error = new Error(formatLocalizedText(localizedMessage, "zh-CN"));
      error.continuousRecoveryKind = kind;
      error.localizedText = localizedMessage;
      if (cooldownMs !== null) error.continuousRecoveryCooldownMs = cooldownMs;
      return error;
    }
    function getLadderOpenPercent(symbol = getCurrentSymbol(), precision = readCurrentOrderbookPrecisionValue()) {
      return loadModeSymbolPrecisionNumberOption(
        localStorage,
        LADDER_PERCENT_STORAGE_KEYS,
        "OPEN",
        symbol,
        precision,
        LADDER_OPEN_PERCENTS,
        DEFAULT_LADDER_OPEN_PERCENT
      );
    }
    function setLadderOpenPercent(value, symbol = getCurrentSymbol(), precision = readCurrentOrderbookPrecisionValue()) {
      const saved = saveModeSymbolPrecisionNumberOption(
        localStorage,
        LADDER_PERCENT_STORAGE_KEYS,
        "OPEN",
        symbol,
        precision,
        value,
        LADDER_OPEN_PERCENTS
      );
      if (!saved) return false;
      scheduleRenderPanel();
      return true;
    }
    function getLadderClosePercent(symbol = getCurrentSymbol(), precision = readCurrentOrderbookPrecisionValue()) {
      migrateModeSymbolPrecisionNumberOption(
        localStorage,
        LADDER_PERCENT_STORAGE_KEYS,
        "CLOSE",
        symbol,
        precision,
        100,
        DEFAULT_LADDER_CLOSE_PERCENT,
        LADDER_CLOSE_PERCENTS
      );
      return loadModeSymbolPrecisionNumberOption(
        localStorage,
        LADDER_PERCENT_STORAGE_KEYS,
        "CLOSE",
        symbol,
        precision,
        LADDER_CLOSE_PERCENTS,
        DEFAULT_LADDER_CLOSE_PERCENT
      );
    }
    function setLadderClosePercent(value, symbol = getCurrentSymbol(), precision = readCurrentOrderbookPrecisionValue()) {
      const saved = saveModeSymbolPrecisionNumberOption(
        localStorage,
        LADDER_PERCENT_STORAGE_KEYS,
        "CLOSE",
        symbol,
        precision,
        value,
        LADDER_CLOSE_PERCENTS
      );
      if (!saved) return false;
      scheduleRenderPanel();
      return true;
    }
    function getLadderLevels(mode = getActiveTradeMode(), symbol = getCurrentSymbol(), precision = readCurrentOrderbookPrecisionValue()) {
      return loadModeSymbolPrecisionNumberOption(
        localStorage,
        LADDER_LEVELS_STORAGE_KEYS,
        mode,
        symbol,
        precision,
        LADDER_LEVEL_OPTIONS,
        DEFAULT_LADDER_LEVELS
      );
    }
    function setLadderLevels(value, mode = getActiveTradeMode(), symbol = getCurrentSymbol(), precision = readCurrentOrderbookPrecisionValue()) {
      const saved = saveModeSymbolPrecisionNumberOption(
        localStorage,
        LADDER_LEVELS_STORAGE_KEYS,
        mode,
        symbol,
        precision,
        value,
        LADDER_LEVEL_OPTIONS
      );
      if (!saved) return false;
      scheduleRenderPanel();
      return true;
    }
    function getLadderStep(mode = getActiveTradeMode(), symbol = getCurrentSymbol(), precision = readCurrentOrderbookPrecisionValue()) {
      return loadModeSymbolPrecisionNumberOption(
        localStorage,
        LADDER_STEP_STORAGE_KEYS,
        mode,
        symbol,
        precision,
        LADDER_STEP_OPTIONS,
        DEFAULT_LADDER_STEP
      );
    }
    function setLadderStep(value, mode = getActiveTradeMode(), symbol = getCurrentSymbol(), precision = readCurrentOrderbookPrecisionValue()) {
      const numericValue = Number(value);
      if (!Number.isInteger(numericValue)) return false;
      const normalizedValue = Math.max(LADDER_STEP_MIN, Math.min(numericValue, LADDER_STEP_MAX));
      const saved = saveModeSymbolPrecisionNumberOption(
        localStorage,
        LADDER_STEP_STORAGE_KEYS,
        mode,
        symbol,
        precision,
        normalizedValue,
        LADDER_STEP_OPTIONS
      );
      if (!saved) return false;
      scheduleRenderPanel();
      return true;
    }
    function readLadderOptionContext(spec, symbol, precision) {
      const percent = spec.mode === "OPEN" ? getLadderOpenPercent(symbol, precision) : getLadderClosePercent(symbol, precision);
      return {
        percent,
        levels: getLadderLevels(spec.mode, symbol, precision),
        ladderStep: getLadderStep(spec.mode, symbol, precision)
      };
    }
    function areLadderOptionContextsEqual(left, right) {
      return left.percent === right.percent && left.levels === right.levels && left.ladderStep === right.ladderStep;
    }
    function hasLadderOptionContextChanged(plan) {
      const current = readLadderOptionContext(plan.spec, plan.symbol, plan.precision);
      return !areLadderOptionContextsEqual(current, plan.optionContext);
    }
    function ui(text) {
      return formatLocalizedText(text, activeUiLocale);
    }
    const LOCALIZED_STATUS_EXACT = /* @__PURE__ */ new Map([
      ["未知阶梯动作", "Unknown ladder action"],
      ["未识别当前交易对", "Current symbol not recognized"],
      ["交易对正在切换", "Symbol is changing"],
      ["当前交易对无挂单", "No open orders for this symbol"],
      ["打开当前委托时交易对已变化", "Symbol changed while opening Open Orders"],
      ["未能打开当前委托", "Could not open Open Orders"],
      ["未找到当前委托面板", "Open Orders panel not found"],
      ["未找到当前委托基础单", "Basic Open Orders tab not found"],
      ["未确认仅显示当前交易对挂单", "Could not confirm that only this symbol is shown"],
      ["读取挂单时交易对已变化", "Symbol changed while reading open orders"],
      ["未找到当前委托的全撤按钮", "Cancel All was not found in Open Orders"],
      ["撤单前交易对已变化", "Symbol changed before cancellation"],
      ["未能准备撤单页面，未打开确认弹窗", "Could not prepare the cancellation page; confirmation was not opened"],
      ["准备撤单时交易对已变化", "Symbol changed while preparing cancellation"],
      ["准备撤单时未找到当前委托面板", "Open Orders panel was not found while preparing cancellation"],
      ["准备撤单时未确认仅显示当前交易对挂单", "Could not confirm this-symbol-only orders while preparing cancellation"],
      ["准备撤单时未找到全撤按钮", "Cancel All was not found while preparing cancellation"],
      ["撤单确认弹窗已打开", "Cancellation confirmation opened"],
      ["撤单确认弹窗结构异常，未执行弹窗操作", "Cancellation dialog changed; no dialog action was taken"],
      ["确认撤单前交易对已变化", "Symbol changed before cancellation was confirmed"],
      ["未识别到撤单确认弹窗，未继续撤单流程", "Cancellation dialog was not detected; cancellation stopped"],
      ["撤单已取消", "Cancellation cancelled"],
      ["撤单已确认，等待挂单清空", "Cancellation confirmed; waiting for open orders to clear"],
      ["等待撤单完成时交易对已变化", "Symbol changed while waiting for cancellation"],
      ["等待撤单完成时未找到当前委托面板", "Open Orders panel was not found while waiting for cancellation"],
      ["等待撤单完成时未确认仅显示当前交易对挂单", "Could not confirm this-symbol-only orders while waiting for cancellation"],
      ["当前交易对挂单仍存在，已停止重新挂单", "Open orders still exist for this symbol; replacement stopped"],
      ["当前交易对挂单仍存在，撤单未完成", "Open orders still exist for this symbol; cancellation is incomplete"],
      ["原挂单已撤，继续阶梯挂单", "Previous orders cancelled; continuing ladder placement"],
      ["撤单已完成", "Cancellation completed"],
      ["未能恢复图表当前委托显示", "Could not restore chart open-order display"],
      ["阶梯任务运行中，请先停止阶梯挂单", "A ladder task is running; stop it first"],
      ["连续交易运行中，请先停止阶梯挂单", "Continuous trading is running; stop it first"],
      ["正在读取账户再平衡计划", "Loading account rebalance plan"],
      ["USDT 已按 5:4:1 分配", "USDT is already allocated at 5:4:1"],
      ["账户再平衡已取消", "Account rebalance cancelled"],
      ["已全部平仓", "All positions closed"],
      ["空闲", "Idle"],
      ["单击下单未执行：交易对正在切换", "Single order not placed: symbol is changing"],
      ["单击下单未执行：仓位确认中", "Single order not placed: confirming positions"],
      ["单击下单未执行：未找到数量输入框", "Single order not placed: quantity input not found"],
      ["单击下单未执行：未找到价格输入框", "Single order not placed: price input not found"],
      ["单击下单未执行：数量规则读取中", "Single order not placed: loading quantity rules"],
      ["交易对已切换", "Symbol changed"],
      ["开仓/平仓模式已切换", "Trade mode changed"],
      ["当前方向已无持仓", "No position in this direction"],
      ["价格精度已变化，下一轮按新精度继续", "Precision changed; the next round will use the new precision"],
      ["比例、笔数或间距已变化，下一轮按新设置继续", "Ratio, orders, or gap changed; the next round will use the new settings"],
      ["价格框或数量框未稳定", "Price or quantity input did not stabilize"],
      ["未找到价格输入框", "Price input not found"],
      ["未找到数量输入框", "Quantity input not found"],
      ["交易规则尚未就绪，请稍后重试", "Trading rules are not ready; try again shortly"],
      ["下单数量规则尚未就绪，请稍后重试", "Order quantity rules are not ready; try again shortly"],
      ["只做 Maker 未生效，请刷新页面后重试", "Post Only is not active; refresh the page and try again"],
      ["未识别价格精度", "Price precision not recognized"],
      ["重挂前价格精度已变化，已停止", "Precision changed before replacement; stopped"],
      ["读取交易规则时价格精度已变化，已停止", "Precision changed while reading trading rules; stopped"],
      ["读取下单数量时比例、笔数或间距已变化", "Ratio, orders, or gap changed while reading order quantity"],
      ["盘口已刷新，未读取到对手盘价格", "Order book refreshed, but the opposite-side price is unavailable"],
      ["刷新盘口后最小下单量未就绪", "Minimum order quantity is not ready after refreshing the order book"],
      ["执行中价格精度已变化，已停止", "Precision changed during execution; stopped"],
      ["执行中比例、笔数或间距已变化", "Ratio, orders, or gap changed during execution"],
      ["未能确定唯一的当前交易表单输入框", "Could not identify one active trade-form input set"],
      ["执行中价格输入框已消失", "Price input disappeared during execution"],
      ["执行中数量输入框已消失", "Quantity input disappeared during execution"],
      ["当前方向暂无可平数量", "No closable quantity in this direction"],
      ["查找当前委托", "Locating Open Orders"],
      ["未选中待替换挂单", "No replacement orders were selected"],
      ["原挂单未完成替换，已停止重新挂单", "Previous orders were not fully replaced; replacement stopped"],
      ["撤销待替换挂单前交易对已变化", "Symbol changed before cancelling replacement orders"],
      ["撤销待替换挂单时交易对已变化", "Symbol changed while cancelling replacement orders"],
      ["同向可撤挂单数量不足，已停止重新挂单", "Not enough cancellable same-direction orders; replacement stopped"],
      ["待替换挂单的撤单按钮已失效，已停止重新挂单", "Replacement-order cancel control became unavailable; replacement stopped"],
      ["待替换挂单的撤单按钮点击失败，已停止重新挂单", "Could not click the replacement-order cancel control; replacement stopped"],
      ["待替换挂单仍存在，已停止重新挂单", "Replacement orders still exist; replacement stopped"],
      ["待替换挂单状态未稳定，已停止重新挂单", "Replacement-order state did not stabilize; replacement stopped"],
      ["未能恢复隐藏其他合约状态", "Could not restore Hide Other Symbols"],
      ["账户余额已变化，已停止账户再平衡", "Account balances changed; account rebalance stopped"],
      ["划转后账户余额未及时更新", "Account balances did not update after the transfer"],
      ["当前不在可操作的合约页面", "The current page is not an operable Futures trading page"],
      ["当前仍有交易任务运行", "A trading task is still running"],
      ["未读取到全账户持仓数量", "Could not read the account-wide position count"],
      ["全账户仍有持仓", "Positions still exist in the account"],
      ["未读取到全账户当前委托数量", "Could not read the account-wide open-order count"],
      ["全账户仍有当前委托", "Open orders still exist in the account"],
      ["Binance 登录态已失效", "Binance session has expired"],
      ["Binance 请求超时", "Binance request timed out"]
    ]);
    function localizeKnownUiStatus(text) {
      if (typeof text !== "string") return text;
      const exactEnglish = LOCALIZED_STATUS_EXACT.get(text);
      if (exactEnglish) return localizedText(text, exactEnglish);
      let match = /^原交易对 (.+) 页面已离开，撤单确认跟踪已停止$/.exec(text);
      if (match) return localizedText(text, `Left the original ${match[1]} page; cancellation tracking stopped`);
      match = /^账户再平衡中 · (\d+\/\d+) 笔$/.exec(text);
      if (match) return localizedText(text, `Account rebalance · ${match[1]} transfers`);
      match = /^账户再平衡已完成 · (\d+\/\d+) 笔$/.exec(text);
      if (match) return localizedText(text, `Account rebalance completed · ${match[1]} transfers`);
      match = /^账户再平衡部分完成 · (\d+\/\d+) 笔 · (.+)$/.exec(text);
      if (match) return localizedText(
        text,
        `Account rebalance partially completed · ${match[1]} transfers · ${formatLocalizedText(localizeKnownUiStatus(match[2]), "en")}`
      );
      match = /^账户再平衡失败 · (.+)$/.exec(text);
      if (match) return localizedText(
        text,
        `Account rebalance failed · ${formatLocalizedText(localizeKnownUiStatus(match[1]), "en")}`
      );
      match = /^单击下单未执行：未找到可用(开仓|平仓)动作$/.exec(text);
      if (match) return localizedText(
        text,
        `Single order not placed: no available ${match[1] === "开仓" ? "open" : "close"} action`
      );
      const actionEnglish = {
        开多: "Open Long",
        开空: "Open Short",
        平多: "Close Long",
        平空: "Close Short"
      };
      match = /^单击(开多|开空|平多|平空)(准备中|确认中|已提交)(.*)$/.exec(text);
      if (match) {
        const phaseEnglish = {
          准备中: "preparing",
          确认中: "confirming",
          已提交: "submitted"
        }[match[2]];
        return localizedText(text, `${actionEnglish[match[1]]} single order ${phaseEnglish}${match[3]}`);
      }
      match = /^单击(开多|开空|平多|平空)失败：(.+)$/.exec(text);
      if (match) return localizedText(
        text,
        `${actionEnglish[match[1]]} single order failed: ${formatLocalizedText(localizeKnownUiStatus(match[2]), "en")}`
      );
      match = /^单击下单失败：(.+)$/.exec(text);
      if (match) return localizedText(
        text,
        `Single order failed: ${formatLocalizedText(localizeKnownUiStatus(match[1]), "en")}`
      );
      match = /^未能切换至(开仓|平仓)$/.exec(text);
      if (match) return localizedText(text, `Could not switch to ${match[1] === "开仓" ? "Open" : "Close"} mode`);
      match = /^订单簿(买盘|卖盘)不足 (\d+) 档，档幅 (\d+)$/.exec(text);
      if (match) return localizedText(
        text,
        `${match[1] === "买盘" ? "Bid" : "Ask"} depth is below ${match[2]} levels at gap ${match[3]}`
      );
      match = /^刷新后订单簿(买盘|卖盘)不足 (\d+) 档$/.exec(text);
      if (match) return localizedText(
        text,
        `After refresh, ${match[1] === "买盘" ? "bid" : "ask"} depth is below ${match[2]} levels`
      );
      match = /^读取(可开数量|可平数量)时价格精度已变化，已停止$/.exec(text);
      if (match) return localizedText(text, `Precision changed while reading ${match[1] === "可开数量" ? "openable" : "closable"} quantity; stopped`);
      match = /^下单按钮 (\d+) 秒内未(渲染完成|恢复可点击|达到可点击状态)$/.exec(text);
      if (match) {
        const ending = {
          渲染完成: "finish rendering",
          恢复可点击: "become clickable again",
          达到可点击状态: "become clickable"
        }[match[2]];
        return localizedText(text, `Order button did not ${ending} within ${match[1]} seconds`);
      }
      match = /^未找到(.*)方向的可撤基础单$/.exec(text);
      if (match) return localizedText(text, `No cancellable Basic orders found for ${match[1] || "the current"} direction`);
      match = /^撤销 (\d+) 笔同向挂单$/.exec(text);
      if (match) return localizedText(text, `Cancelling ${match[1]} same-direction orders`);
      return text;
    }
    function setLadderStatus(text = PANEL_COPY.state.idle, title = null) {
      ladderStatusText = localizeKnownUiStatus(text);
      ladderStatusTitle = localizeKnownUiStatus(title ?? text);
      const renderedText = ui(ladderStatusText);
      const renderedTitle = ui(ladderStatusTitle);
      const statusEl = document.getElementById(LADDER_STATUS_ID);
      if (statusEl) {
        if (statusEl.textContent !== renderedText) statusEl.textContent = renderedText;
        if (statusEl.title !== renderedTitle) statusEl.title = renderedTitle;
      }
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
      return findTradeInputs({ requirePrice: false })?.qtyInput || null;
    }
    function findPriceInput() {
      return findTradeInputs()?.priceInput || null;
    }
    function findTradeInputs(options = null) {
      return findActiveTradeInputs(document, {
        panelId: PANEL_ID,
        isVisibleElement,
        requirePrice: options?.requirePrice !== false
      });
    }
    function isOwnPanelButton2(button) {
      return !!button?.closest?.(`#${PANEL_ID}`);
    }
    function getActiveTradeMode() {
      const activeTab = document.querySelector('#position-direction [role="tab"][aria-selected="true"]') || document.querySelector('.bn-tabs__buySell [role="tab"][aria-selected="true"]') || document.querySelector('[role="tab"].bn-tab__buySell[aria-selected="true"]');
      return parseTradeModeLabel(activeTab?.textContent) || "UNKNOWN";
    }
    function getCurrentOrderType() {
      const activeTab = findVisibleTradeScopeElement(
        '[role="tab"][aria-selected="true"][data-tab-key]',
        (tab) => !isTradeModeTab2(tab)
      );
      return String(activeTab?.getAttribute("data-tab-key") || "LIMIT").toUpperCase();
    }
    function isPostOnlyOrderTypeActive() {
      if (getCurrentOrderType() !== BINANCE_POST_ONLY_ORDER_TYPE) return false;
      return !!findVisibleTradeScopeElement(
        '[role="tab"][aria-selected="true"][data-tab-key]',
        (tab) => String(tab.getAttribute("data-tab-key") || "").toUpperCase() === BINANCE_POST_ONLY_ORDER_TYPE && includesBinancePageText(tab.textContent, BINANCE_PAGE_TEXT.postOnly)
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
      const rects = Array.from(el.getClientRects());
      if (!rects.length) return false;
      if (el.offsetWidth || el.offsetHeight) return true;
      return rects.some((rect) => rect.width > 0 && rect.height > 0);
    }
    function buttonTextMatches2(button, labels) {
      return includesBinancePageText(button?.textContent, labels);
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
      const tradeFormRoot = findTradeFormRoot(activeTab, findQtyInput());
      pushScope(tradeFormRoot);
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
      return findTradeInputs({ requirePrice: false })?.root || null;
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
    function findTradeButton(labels, mode) {
      return collectTradeButtons(mode).find((candidate) => buttonTextMatches2(candidate, labels)) || null;
    }
    function findCloseLongButton() {
      return findTradeButton(BINANCE_PAGE_TEXT.tradeAction.CLOSE_LONG, "CLOSE");
    }
    function findCloseShortButton() {
      return findTradeButton(BINANCE_PAGE_TEXT.tradeAction.CLOSE_SHORT, "CLOSE");
    }
    function findOpenLongButton() {
      return findTradeButton(BINANCE_PAGE_TEXT.tradeAction.OPEN_LONG, "OPEN");
    }
    function findOpenShortButton() {
      return findTradeButton(BINANCE_PAGE_TEXT.tradeAction.OPEN_SHORT, "OPEN");
    }
    let cachedBncHeaders = null;
    let resolveBncHeadersReady;
    const bncHeadersReady = new Promise((resolve) => {
      resolveBncHeadersReady = resolve;
    });
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
      const url = getFetchRequestUrl(args);
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
    function getFetchRequestUrl(args) {
      return typeof args[0] === "string" ? args[0] : args[0] instanceof Request ? args[0].url : args[0]?.url || "";
    }
    function isBinancePlaceOrderRequestUrl(rawUrl) {
      const requestUrl = new URL(rawUrl, window.location.href);
      return requestUrl.origin === window.location.origin && requestUrl.pathname === BINANCE_PLACE_ORDER_BAPI_PATH;
    }
    function getFetchRequestMethod(args) {
      const method = args[1]?.method || (args[0] instanceof Request ? args[0].method : null) || "GET";
      return String(method).toUpperCase();
    }
    function beginLadderSubmitResponseCapture() {
      ladderSubmitCaptureSequence += 1;
      let resolveRequestStarted;
      const requestStarted = new Promise((resolve) => {
        resolveRequestStarted = resolve;
      });
      activeLadderSubmitCapture = {
        captureId: ladderSubmitCaptureSequence,
        apiErrors: [],
        apiSuccesses: [],
        responseDiagnostics: [],
        responseObservations: [],
        requestStarted,
        resolveRequestStarted
      };
      return activeLadderSubmitCapture.captureId;
    }
    function endLadderSubmitResponseCapture(captureId) {
      if (activeLadderSubmitCapture?.captureId === captureId) activeLadderSubmitCapture = null;
    }
    function readLadderSubmitResponseDiagnosticHeaders(response) {
      return {
        httpStatus: response.status,
        contentType: response.headers.get("content-type") || "",
        retryAfter: response.headers.get("retry-after"),
        orderCount10s: response.headers.get("x-mbx-order-count-10s"),
        orderCount1m: response.headers.get("x-mbx-order-count-1m"),
        usedWeight1m: response.headers.get("x-mbx-used-weight-1m")
      };
    }
    async function observeLadderSubmitResponse(response, capture, requestUrl) {
      const responseHeaders = readLadderSubmitResponseDiagnosticHeaders(response);
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        capture.responseDiagnostics.push({
          ...responseHeaders,
          bodyKind: "non_json",
          payloadSummary: null,
          errorName: null
        });
        return;
      }
      let payload;
      try {
        payload = await response.clone().json();
      } catch (error) {
        capture.responseDiagnostics.push({
          ...responseHeaders,
          bodyKind: "invalid_json",
          payloadSummary: null,
          errorName: error?.name || "Error"
        });
        return;
      }
      const payloadSummary = summarizeBinancePlaceOrderPayload(payload);
      capture.responseDiagnostics.push({
        ...responseHeaders,
        bodyKind: "json",
        payloadSummary,
        errorName: null
      });
      const code = getBinanceApiErrorCode(payload);
      if (code != null) {
        capture.apiErrors.push({
          requestUrl,
          code,
          message: payloadSummary.message,
          success: payloadSummary.success
        });
        return;
      }
      if (response.ok && isBinancePlaceOrderSuccessPayload(payload)) {
        capture.apiSuccesses.push({ requestUrl });
      }
    }
    function trackLadderSubmitResponse(request, capture, requestUrl) {
      const observation = request.then(
        (response) => observeLadderSubmitResponse(response, capture, requestUrl),
        (error) => {
          capture.responseDiagnostics.push({
            httpStatus: null,
            contentType: "",
            retryAfter: null,
            orderCount10s: null,
            orderCount1m: null,
            usedWeight1m: null,
            bodyKind: "network_error",
            payloadSummary: null,
            errorName: error?.name || "Error"
          });
        }
      ).catch((error) => {
        capture.responseDiagnostics.push({
          httpStatus: null,
          contentType: "",
          retryAfter: null,
          orderCount10s: null,
          orderCount1m: null,
          usedWeight1m: null,
          bodyKind: "observation_error",
          payloadSummary: null,
          errorName: error?.name || "Error"
        });
      });
      capture.responseObservations.push(observation);
      capture.resolveRequestStarted();
    }
    function cacheBncHeaders(snapshot) {
      const becameReady = !cachedBncHeaders;
      cachedBncHeaders = snapshot;
      if (!becameReady) return;
      resolveBncHeadersReady();
      resolveBncHeadersReady = null;
      queueMicrotask(() => {
        if (isFuturesTradingPage() && getActiveTradeMode() === "OPEN") {
          queueAutoOpenLeveragePositionCheck("headers_ready");
        }
      });
    }
    async function waitForLadderSubmitResponseObservations(captureId, timeoutMs, abortSignal = null) {
      const capture = activeLadderSubmitCapture?.captureId === captureId ? activeLadderSubmitCapture : null;
      if (!capture) throw new Error("下单结果跟踪状态异常，已停止");
      const observations = capture.responseObservations.slice();
      let settled = observations.length === 0;
      if (observations.length > 0) {
        const allObservations = Promise.all(observations).then(() => {
          settled = true;
        });
        await waitForPromiseOrAbort(
          Promise.race([
            allObservations,
            delay(timeoutMs)
          ]),
          abortSignal
        );
      }
      return {
        settled,
        apiErrors: capture.apiErrors.slice(),
        diagnostics: capture.responseDiagnostics.slice()
      };
    }
    function readLadderSubmitApiErrors(captureId) {
      const capture = activeLadderSubmitCapture?.captureId === captureId ? activeLadderSubmitCapture : null;
      if (!capture) throw new Error("下单结果跟踪状态异常，已停止");
      return capture.apiErrors.slice();
    }
    function readLadderSubmitApiSuccesses(captureId) {
      const capture = activeLadderSubmitCapture?.captureId === captureId ? activeLadderSubmitCapture : null;
      if (!capture) throw new Error("下单结果跟踪状态异常，已停止");
      return capture.apiSuccesses.slice();
    }
    (function installFetchInterceptor() {
      const originalFetch = window.fetch;
      window.fetch = function(...args) {
        try {
          const snapshot = extractHeadersFromFetchArgs(args);
          if (snapshot) cacheBncHeaders(snapshot);
        } catch (_e) {
        }
        const capture = activeLadderSubmitCapture;
        const requestUrl = getFetchRequestUrl(args);
        const shouldObserveResponse = capture && getFetchRequestMethod(args) === "POST" && isBinancePlaceOrderRequestUrl(requestUrl);
        const request = originalFetch.apply(this, args);
        if (shouldObserveResponse) {
          trackLadderSubmitResponse(request, capture, requestUrl);
        }
        return request;
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
        throw new Error("币安请求头尚未就绪");
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
        if (!resp.ok) throw new Error(`杠杆调整接口异常：HTTP ${resp.status}`);
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
    function getLatestTradePrices() {
      return Array.from(document.querySelectorAll(".tradew-tradelist .price.emit-price")).filter((node) => isVisibleElement(node)).map((node) => parsePrice(node)).filter(Boolean);
    }
    async function waitForOrderbookPrecisionBootstrapReady(symbol, timeoutMs = ORDERBOOK_PRECISION_READY_TIMEOUT_MS) {
      const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
      while (!document.hidden && isFuturesTradingPage() && isCurrentObservedSymbol(symbol)) {
        const trigger = findOrderbookPrecisionTrigger();
        const bid = getOrderbookPrices("BID", 1)[0] || null;
        const ask = getOrderbookPrices("ASK", 1)[0] || null;
        if (trigger?.element && bid && ask) return trigger;
        if (Date.now() >= deadline) return null;
        await delay(ORDERBOOK_PRECISION_READY_POLL_MS);
      }
      return null;
    }
    function orderbookPrecisionSamplesKey(symbol = getCurrentSymbol()) {
      const normalizedSymbol = String(symbol || "").toUpperCase();
      return normalizedSymbol ? `${LOCAL_ORDERBOOK_PRECISION_SAMPLES_PREFIX}:${normalizedSymbol}` : null;
    }
    function readStoredOrderbookPrecisionSamples(symbol = getCurrentSymbol()) {
      const key = orderbookPrecisionSamplesKey(symbol);
      if (!key) return [];
      const parsed = parseJsonSafe(localStorage.getItem(key));
      return Array.isArray(parsed) ? parsed.map((sample) => normalizeDecimalString(sample)).filter((sample) => sample && isPositiveDecimalString(sample)) : [];
    }
    function saveStoredOrderbookPrecisionSamples(symbol, samples) {
      const key = orderbookPrecisionSamplesKey(symbol);
      if (!key) return [];
      if (!Array.isArray(samples)) {
        throw new Error("最新成交价样本状态异常");
      }
      const normalizedSamples = samples.map((sample) => normalizeDecimalString(sample)).filter((sample) => sample && isPositiveDecimalString(sample));
      localStorage.setItem(key, JSON.stringify(normalizedSamples));
      return normalizedSamples;
    }
    function getOrderbookPrecisionRecommendation(symbol = getCurrentSymbol()) {
      const samples = readStoredOrderbookPrecisionSamples(symbol);
      return recommendOrderbookPrecision({
        samples,
        options: ORDERBOOK_PRECISION_CANDIDATE_OPTIONS
      });
    }
    function isOrderbookPrecisionNumericText(text) {
      const raw = String(text || "").replace(/,/g, "").trim();
      return /^(?:\d+|\d+\.\d+|0?\.\d+)$/.test(raw) && raw.length <= 16;
    }
    function isInsideOrderbookPriceRow(node) {
      return !!node?.closest?.("#futuresOrderbook .row-content");
    }
    function findOrderbookPrecisionTrigger() {
      const tickSize = document.querySelector("#futuresOrderbook .orderbook-tickSize");
      const tickContent = tickSize?.querySelector(".tick-content") || null;
      const text = (tickContent?.textContent || tickSize?.textContent || "").trim();
      if (!tickSize || !isOrderbookPrecisionNumericText(text)) return null;
      return {
        element: tickContent || tickSize,
        value: normalizeDecimalString(text)
      };
    }
    function readCurrentOrderbookPrecisionValue() {
      return findOrderbookPrecisionTrigger()?.value || null;
    }
    function handleOrderbookPrecisionChange() {
      const precision = readCurrentOrderbookPrecisionValue();
      const symbol = getCurrentSymbol();
      const nativeOptions = readVisibleOrderbookPrecisionOptionValues();
      const previousNativeOptions = orderbookPrecisionState.symbol === symbol ? orderbookPrecisionState.nativeOptions : [];
      const nativeOptionsChanged = nativeOptions.length > 0 && JSON.stringify(nativeOptions) !== JSON.stringify(previousNativeOptions);
      if (nativeOptionsChanged) {
        orderbookPrecisionState = {
          ...orderbookPrecisionState,
          symbol,
          nativeOptions,
          nativeOptionsStatus: null
        };
      }
      if (precision === lastObservedOrderbookPrecision) {
        if (nativeOptionsChanged) scheduleRenderPanel();
        return;
      }
      lastObservedOrderbookPrecision = precision;
      stopMultiplierEdit();
      ladderPanelBodySignature = "";
      scheduleRenderPanel();
    }
    function stopOrderbookPrecisionObserver() {
      if (orderbookPrecisionObserver) {
        orderbookPrecisionObserver.disconnect();
        orderbookPrecisionObserver = null;
      }
      orderbookPrecisionObserverRoot = null;
      lastObservedOrderbookPrecision = null;
    }
    function ensureOrderbookPrecisionObserver() {
      if (document.hidden || !isFuturesTradingPage()) return;
      const trigger = findOrderbookPrecisionTrigger();
      const root = trigger?.element?.closest(".orderbook-tickSize") || trigger?.element || null;
      if (!root) {
        if (orderbookPrecisionObserverRoot) stopOrderbookPrecisionObserver();
        return;
      }
      if (orderbookPrecisionObserver && orderbookPrecisionObserverRoot === root && root.isConnected) return;
      stopOrderbookPrecisionObserver();
      orderbookPrecisionObserverRoot = root;
      lastObservedOrderbookPrecision = readCurrentOrderbookPrecisionValue();
      orderbookPrecisionObserver = new MutationObserver(() => {
        handleOrderbookPrecisionChange();
      });
      orderbookPrecisionObserver.observe(root, {
        subtree: true,
        childList: true,
        characterData: true
      });
    }
    function readOrderbookPrecisionOptionValue(node) {
      if (!node) return null;
      const item = node.matches?.(".ob-ticksize-item") ? node : node.closest?.(".ob-ticksize-item");
      const textNode = item?.querySelector("span") || node;
      return normalizeDecimalString(textNode?.textContent || "");
    }
    function getVisibleOrderbookPrecisionOverlay(triggerElement = findOrderbookPrecisionTrigger()?.element) {
      const tickSize = triggerElement?.closest?.(".orderbook-tickSize");
      if (!tickSize || !tickSize.closest("#futuresOrderbook")) return null;
      const overlays = Array.from(tickSize.querySelectorAll(".ob-ticksize-overlay")).filter((overlay) => isVisibleElement(overlay));
      return overlays.length === 1 ? overlays[0] : null;
    }
    function getVisibleOrderbookPrecisionOptionNodes(triggerElement = findOrderbookPrecisionTrigger()?.element) {
      const overlay = getVisibleOrderbookPrecisionOverlay(triggerElement);
      if (!overlay) return [];
      return Array.from(overlay.querySelectorAll(".ob-ticksize-item")).filter((node) => node.closest(".ob-ticksize-overlay") === overlay).filter((node) => isVisibleElement(node)).filter((node) => isOrderbookPrecisionNumericText(readOrderbookPrecisionOptionValue(node)));
    }
    function readVisibleOrderbookPrecisionOptionValues(triggerElement = findOrderbookPrecisionTrigger()?.element) {
      const values = /* @__PURE__ */ new Set();
      for (const node of getVisibleOrderbookPrecisionOptionNodes(triggerElement)) {
        const value = readOrderbookPrecisionOptionValue(node);
        if (value) values.add(value);
      }
      return Array.from(values);
    }
    function findVisibleOrderbookPrecisionOption(value, triggerElement = findOrderbookPrecisionTrigger()?.element) {
      const normalized = normalizeDecimalString(value);
      if (!normalized) return null;
      return getVisibleOrderbookPrecisionOptionNodes(triggerElement).find((node) => readOrderbookPrecisionOptionValue(node) === normalized) || null;
    }
    function dispatchOrderbookPrecisionOpenEvent(target, type) {
      const EventCtor = type.startsWith("pointer") && typeof PointerEvent === "function" ? PointerEvent : MouseEvent;
      return target.dispatchEvent(new EventCtor(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        button: 0,
        buttons: type === "pointerup" || type === "mouseup" || type === "click" ? 0 : 1,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true
      }));
    }
    function dispatchOrderbookPrecisionToggleSequence(target) {
      dispatchOrderbookPrecisionOpenEvent(target, "pointerdown");
      dispatchOrderbookPrecisionOpenEvent(target, "mousedown");
      dispatchOrderbookPrecisionOpenEvent(target, "pointerup");
      dispatchOrderbookPrecisionOpenEvent(target, "mouseup");
      dispatchOrderbookPrecisionOpenEvent(target, "click");
    }
    async function waitForVisibleOrderbookPrecisionOptions(triggerElement, timeoutMs = ORDERBOOK_PRECISION_OPTION_WAIT_MS) {
      const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
      while (!document.hidden && isFuturesTradingPage()) {
        if (getVisibleOrderbookPrecisionOptionNodes(triggerElement).length) return true;
        if (Date.now() >= deadline) return false;
        await delay(50);
      }
      return false;
    }
    async function openOrderbookPrecisionOptions(triggerElement) {
      if (!triggerElement || !triggerElement.isConnected) return false;
      if (getVisibleOrderbookPrecisionOptionNodes(triggerElement).length) return true;
      const clickTarget = triggerElement.closest?.(".bn-tooltips-ele");
      if (!triggerElement.matches?.(".tick-content") || !clickTarget || !clickTarget.closest("#futuresOrderbook .orderbook-tickSize") || isInsideOrderbookPriceRow(clickTarget)) return false;
      await delay(0);
      if (!triggerElement.isConnected || !clickTarget.isConnected) return false;
      if (!clickDomTarget(clickTarget)) return false;
      return waitForVisibleOrderbookPrecisionOptions(triggerElement);
    }
    async function ensureVisibleOrderbookPrecisionOptions(triggerElement) {
      const currentOptions = getVisibleOrderbookPrecisionOptionNodes(triggerElement);
      if (currentOptions.length) return currentOptions;
      if (!await openOrderbookPrecisionOptions(triggerElement)) return [];
      return getVisibleOrderbookPrecisionOptionNodes(triggerElement);
    }
    async function waitForOrderbookPrecisionOptionsClosed(triggerElement, timeoutMs = ORDERBOOK_PRECISION_OPTION_WAIT_MS) {
      const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
      while (!document.hidden && isFuturesTradingPage()) {
        if (!getVisibleOrderbookPrecisionOverlay(triggerElement)) return true;
        if (Date.now() >= deadline) return false;
        await delay(50);
      }
      return !getVisibleOrderbookPrecisionOverlay(triggerElement);
    }
    async function closeOrderbookPrecisionOptions(triggerElement, currentPrecision, waitForLateOpen = false) {
      if (waitForLateOpen && !getVisibleOrderbookPrecisionOverlay(triggerElement)) {
        await waitForVisibleOrderbookPrecisionOptions(triggerElement, ORDERBOOK_PRECISION_OPTION_WAIT_MS);
      }
      if (!getVisibleOrderbookPrecisionOverlay(triggerElement)) return true;
      const currentOption = findVisibleOrderbookPrecisionOption(currentPrecision, triggerElement);
      if (currentOption) {
        if (!clickDomTarget(currentOption)) return false;
        return waitForOrderbookPrecisionOptionsClosed(triggerElement);
      }
      const tickSize = triggerElement?.closest?.(".orderbook-tickSize");
      const toggleTarget = tickSize?.querySelector?.(".tick-content") || triggerElement;
      if (!toggleTarget || !isVisibleElement(toggleTarget)) return false;
      dispatchOrderbookPrecisionToggleSequence(toggleTarget);
      return waitForOrderbookPrecisionOptionsClosed(triggerElement);
    }
    async function waitForOrderbookPrecisionValue(options, timeoutMs = ORDERBOOK_PRECISION_OPTION_WAIT_MS) {
      const { symbol, startPrecision, targetPrecision } = options;
      const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
      while (!document.hidden && isFuturesTradingPage()) {
        if (!isCurrentObservedSymbol(symbol)) return false;
        const current = readCurrentOrderbookPrecisionValue();
        if (current === targetPrecision) return true;
        if (current && current !== startPrecision) return false;
        if (Date.now() >= deadline) return false;
        await delay(50);
      }
      return false;
    }
    function renderOrderbookPrecisionShortcut(value, current, recommendation, disabled) {
      const selected = value === current;
      const recommended = value === recommendation;
      const disabledAttrs = disabled ? ' disabled aria-disabled="true"' : "";
      const title = disabled ? ui(localizedText("价格精度暂不可调整", "Precision is temporarily unavailable")) : selected && recommended ? ui(localizedText(`当前且推荐的价格精度 ${value}`, `Current and recommended precision: ${value}`)) : selected ? ui(localizedText(`当前价格精度 ${value}`, `Current precision: ${value}`)) : recommended ? ui(localizedText(`推荐价格精度 ${value}`, `Recommended precision: ${value}`)) : ui(localizedText(`切换到价格精度 ${value}`, `Switch to precision ${value}`));
      const activeStyle = selected ? `border-color:var(--color-PrimaryYellow);background:var(--color-BadgeBg);color:${PRIMARY_EMPHASIS_COLOR};font-weight:${PRIMARY_EMPHASIS_FONT_WEIGHT};` : NEUTRAL_CONTROL_STYLE;
      const recommendationMarker = recommended ? '<span aria-hidden="true" style="position:absolute;top:3px;right:3px;width:6px;height:6px;border-radius:50%;background:var(--color-PrimaryYellow);box-shadow:0 0 0 1px #fff;"></span>' : "";
      const ariaLabel = ui(localizedText(
        `切换价格精度到 ${value}${recommended ? "，推荐档位" : ""}`,
        `Switch precision to ${value}${recommended ? ", recommended" : ""}`
      ));
      return `<button type="button" data-orderbook-precision-value="${value}"${disabledAttrs} aria-pressed="${selected}" aria-label="${ariaLabel}" title="${title}" style="position:relative;box-sizing:border-box;width:100%;min-width:0;height:32px;padding:0;border-radius:6px;border:1px solid ${CONTROL_BORDER_COLOR};font-size:12px;line-height:30px;white-space:nowrap;overflow:hidden;cursor:pointer;${activeStyle}">${recommendationMarker}${formatOrderbookPrecisionShortcutLabel(value)}</button>`;
    }
    function renderOrderbookPrecisionShortcutSlots(options, current, recommendation, disabled) {
      const slots = options.map((value) => renderOrderbookPrecisionShortcut(value, current, recommendation, disabled));
      while (slots.length < ORDERBOOK_PRECISION_SHORTCUT_LIMIT) {
        slots.push('<span aria-hidden="true" style="height:32px;visibility:hidden;"></span>');
      }
      return slots;
    }
    function renderOrderbookPrecisionRefreshButton(symbol, disabled) {
      const feedbackState = orderbookPrecisionRefreshFeedback.symbol === symbol ? orderbookPrecisionRefreshFeedback.state : "idle";
      const feedback = feedbackState === "success" ? {
        label: PANEL_COPY.status.precisionUpdated,
        color: "var(--color-Buy)",
        icon: '<svg viewBox="0 0 24 24" aria-hidden="true" style="width:17px;height:17px;fill:currentColor;"><path d="m9.55 16.6-4.25-4.25 1.4-1.4 2.85 2.85 7.75-7.75 1.4 1.4Z"></path></svg>'
      } : feedbackState === "retry" ? {
        label: PANEL_COPY.status.precisionInsufficient,
        color: "var(--color-PrimaryYellow)",
        icon: '<svg viewBox="0 0 24 24" aria-hidden="true" style="width:17px;height:17px;fill:currentColor;"><path d="M11 6h2v8h-2V6Zm0 10h2v2h-2v-2Z"></path></svg>'
      } : {
        label: formatPrecisionRefreshTooltip(ORDERBOOK_PRECISION_INITIAL_TRADE_LIMIT),
        color: CONTROL_TEXT_COLOR,
        icon: '<svg viewBox="0 0 24 24" aria-hidden="true" style="width:16px;height:16px;fill:currentColor;"><path d="M19.5 7.2A8 8 0 1 0 20 15h-2.25a6 6 0 1 1-.1-5.8L15 12h7V5l-2.5 2.2Z"></path></svg>'
      };
      const disabledAttrs = disabled ? ' disabled aria-disabled="true"' : "";
      const feedbackLabel = ui(feedback.label);
      return `<button type="button" data-orderbook-precision-refresh="true" data-orderbook-precision-refresh-state="${feedbackState}"${disabledAttrs} title="${feedbackLabel}" aria-label="${feedbackLabel}" aria-live="polite" style="width:32px;height:32px;padding:0;border-radius:6px;border:1px solid ${CONTROL_BORDER_COLOR};display:flex;align-items:center;justify-content:center;${NEUTRAL_CONTROL_STYLE}color:${feedback.color};">${feedback.icon}</button>`;
    }
    function showOrderbookPrecisionRefreshFeedback(symbol, state) {
      if (!["success", "retry"].includes(state)) {
        throw new Error(`价格精度刷新反馈状态异常：${state}`);
      }
      if (orderbookPrecisionRefreshFeedbackTimer !== null) {
        window.clearTimeout(orderbookPrecisionRefreshFeedbackTimer);
      }
      orderbookPrecisionRefreshFeedback = { symbol, state };
      refreshOrderbookPrecisionRecommendation();
      orderbookPrecisionRefreshFeedbackTimer = window.setTimeout(() => {
        orderbookPrecisionRefreshFeedbackTimer = null;
        if (orderbookPrecisionRefreshFeedback.symbol !== symbol || orderbookPrecisionRefreshFeedback.state !== state) return;
        orderbookPrecisionRefreshFeedback = { symbol, state: "idle" };
        refreshOrderbookPrecisionRecommendation();
      }, ORDERBOOK_PRECISION_REFRESH_FEEDBACK_MS);
    }
    function refreshOrderbookPrecisionRecommendation(panel = document.getElementById(PANEL_ID)) {
      const el = panel?.querySelector?.(`#${ORDERBOOK_PRECISION_RECOMMENDATION_ID}`);
      if (!el) return;
      const symbol = getCurrentSymbol();
      if (!symbol) {
        el.textContent = "";
        return;
      }
      const samples = readStoredOrderbookPrecisionSamples(symbol);
      const recommendation = recommendOrderbookPrecision({
        samples,
        options: ORDERBOOK_PRECISION_CANDIDATE_OPTIONS
      });
      const current = readCurrentOrderbookPrecisionValue();
      const existingStatus = orderbookPrecisionState.symbol === symbol ? orderbookPrecisionState.status : null;
      const status = recommendation ? "ready" : existingStatus && existingStatus !== "ready" ? existingStatus : PANEL_COPY.status.precisionInsufficient;
      orderbookPrecisionState = {
        ...orderbookPrecisionState,
        symbol,
        samples,
        recommendation,
        current,
        status
      };
      const selectionBusy = Boolean(orderbookPrecisionSelectionTask);
      const controlsBusy = selectionBusy;
      const nativeOptions = orderbookPrecisionState.symbol === symbol ? orderbookPrecisionState.nativeOptions : [];
      const shortcutOptions = getOrderbookPrecisionShortcutOptions(
        nativeOptions,
        ORDERBOOK_PRECISION_SHORTCUT_LIMIT
      );
      if (!nativeOptions.length) queueOrderbookPrecisionOptionsLoad(symbol);
      const canRefresh = !controlsBusy;
      const recommendationHtml = [
        '<div style="margin-top:10px;">',
        `<div style="display:grid;grid-template-columns:${activeUiLocale === "en" ? "52px" : "36px"} repeat(4,minmax(0,1fr)) 32px;align-items:center;gap:4px;height:32px;overflow:hidden;">`,
        `<span title="${ui(PANEL_COPY.tooltip.pricePrecision)}" style="color:${MUTED_TEXT_COLOR};font-size:13px;white-space:nowrap;cursor:help;">${ui(PANEL_COPY.field.pricePrecision)}</span>`,
        ...renderOrderbookPrecisionShortcutSlots(shortcutOptions, current, recommendation, controlsBusy),
        renderOrderbookPrecisionRefreshButton(symbol, !canRefresh),
        "</div>",
        "</div>"
      ].join("");
      if (el.innerHTML !== recommendationHtml) {
        el.innerHTML = recommendationHtml;
      }
    }
    async function clickAndConfirmOrderbookPrecisionOption(options) {
      const { symbol, startPrecision, targetPrecision, triggerElement } = options;
      if (!isCurrentObservedSymbol(symbol) || readCurrentOrderbookPrecisionValue() !== startPrecision) return false;
      const option = findVisibleOrderbookPrecisionOption(targetPrecision, triggerElement);
      if (!option || !clickDomTarget(option)) return false;
      return waitForOrderbookPrecisionValue({ symbol, startPrecision, targetPrecision });
    }
    async function waitForStableOrderbookPrecisionOptions(symbol, timeoutMs = ORDERBOOK_PRECISION_READY_TIMEOUT_MS) {
      const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
      let lastPrecision = null;
      while (!document.hidden && isFuturesTradingPage() && isCurrentObservedSymbol(symbol)) {
        const remainingMs = Math.max(0, deadline - Date.now());
        const trigger = await waitForOrderbookPrecisionBootstrapReady(symbol, remainingMs);
        if (!trigger?.element) return { status: "订单簿尚未就绪" };
        const startPrecision = trigger.value;
        lastPrecision = startPrecision;
        const optionsInitiallyVisible = getVisibleOrderbookPrecisionOptionNodes(trigger.element).length > 0;
        let snapshot = null;
        let closed = true;
        try {
          const options = await ensureVisibleOrderbookPrecisionOptions(trigger.element);
          if (!isCurrentObservedSymbol(symbol)) return null;
          const currentTrigger = findOrderbookPrecisionTrigger();
          const values = readVisibleOrderbookPrecisionOptionValues(trigger.element);
          if (trigger.element.isConnected && currentTrigger?.element === trigger.element && currentTrigger.value === startPrecision && options.length > 0 && values.includes(startPrecision)) snapshot = { precision: startPrecision, values };
        } finally {
          if (!optionsInitiallyVisible) {
            const cleanupPrecision = isCurrentObservedSymbol(symbol) ? readCurrentOrderbookPrecisionValue() : startPrecision;
            closed = await closeOrderbookPrecisionOptions(trigger.element, cleanupPrecision, true);
          }
        }
        if (!closed) return { status: "无法关闭价格精度下拉" };
        if (snapshot) return snapshot;
        if (Date.now() >= deadline) break;
        await delay(ORDERBOOK_PRECISION_READY_POLL_MS);
      }
      if (!isCurrentObservedSymbol(symbol)) return null;
      return {
        status: lastPrecision ? `未找到当前价格精度 ${lastPrecision} 的选项` : "订单簿尚未就绪"
      };
    }
    async function runLoadOrderbookPrecisionOptions() {
      const symbol = getCurrentSymbol();
      if (!isCurrentObservedSymbol(symbol)) return false;
      const snapshot = await waitForStableOrderbookPrecisionOptions(symbol);
      if (!snapshot || !isCurrentObservedSymbol(symbol)) return false;
      if (!snapshot.values?.length) {
        orderbookPrecisionState = {
          ...orderbookPrecisionState,
          nativeOptionsStatus: snapshot.status
        };
        scheduleRenderPanel();
        return false;
      }
      orderbookPrecisionState = {
        ...orderbookPrecisionState,
        symbol,
        current: snapshot.precision,
        nativeOptions: snapshot.values,
        nativeOptionsStatus: null
      };
      scheduleRenderPanel();
      return true;
    }
    async function runSelectOrderbookPrecision(targetPrecision) {
      const symbol = getCurrentSymbol();
      if (!isCurrentObservedSymbol(symbol)) return false;
      const trigger = findOrderbookPrecisionTrigger();
      if (!symbol || !trigger?.element) {
        orderbookPrecisionState = { ...orderbookPrecisionState, status: "未找到价格精度下拉" };
        scheduleRenderPanel();
        return false;
      }
      const startPrecision = trigger.value;
      if (targetPrecision === startPrecision) return true;
      const options = await ensureVisibleOrderbookPrecisionOptions(trigger.element);
      if (!isCurrentObservedSymbol(symbol) || readCurrentOrderbookPrecisionValue() !== startPrecision) return false;
      const values = readVisibleOrderbookPrecisionOptionValues(trigger.element);
      if (!options.length || !values.includes(startPrecision)) {
        orderbookPrecisionState = { ...orderbookPrecisionState, status: "读取价格精度选项失败" };
        scheduleRenderPanel();
        return false;
      }
      const shortcutOptions = getOrderbookPrecisionShortcutOptions(
        values,
        ORDERBOOK_PRECISION_SHORTCUT_LIMIT
      );
      orderbookPrecisionState = {
        ...orderbookPrecisionState,
        symbol,
        nativeOptions: values,
        nativeOptionsStatus: null
      };
      if (!options.length || !shortcutOptions.includes(targetPrecision)) {
        orderbookPrecisionState = { ...orderbookPrecisionState, status: `未找到快捷精度 ${targetPrecision}` };
        scheduleRenderPanel();
        return false;
      }
      const selected = await clickAndConfirmOrderbookPrecisionOption({
        symbol,
        startPrecision,
        targetPrecision,
        triggerElement: trigger.element
      });
      if (!selected) {
        if (isCurrentObservedSymbol(symbol)) {
          orderbookPrecisionState = { ...orderbookPrecisionState, status: `价格精度未切换到 ${targetPrecision}` };
          scheduleRenderPanel();
        }
        return false;
      }
      orderbookPrecisionState = { ...orderbookPrecisionState, current: targetPrecision, status: "ready" };
      scheduleRenderPanel();
      return true;
    }
    async function runOrderbookPrecisionSelectionTask(operation) {
      if (orderbookPrecisionSelectionTask) return orderbookPrecisionSelectionTask;
      const task = operation();
      orderbookPrecisionSelectionTask = task;
      scheduleRenderPanel();
      try {
        return await task;
      } finally {
        if (orderbookPrecisionSelectionTask === task) orderbookPrecisionSelectionTask = null;
        scheduleRenderPanel();
      }
    }
    function selectOrderbookPrecision(value) {
      const targetPrecision = normalizeDecimalString(value);
      if (!targetPrecision || !isPositiveDecimalString(targetPrecision)) {
        throw new Error(`无效的价格精度快捷值: ${value}`);
      }
      return runOrderbookPrecisionSelectionTask(() => runSelectOrderbookPrecision(targetPrecision));
    }
    function queueOrderbookPrecisionOptionsLoad(symbol, force = false) {
      if (!isCurrentObservedSymbol(symbol) || document.hidden || !force && orderbookPrecisionOptionsLoadAttemptedSymbol === symbol || orderbookPrecisionOptionsLoadRequestedSymbol === symbol || orderbookPrecisionSelectionTask || !findOrderbookPrecisionTrigger()?.element) return;
      orderbookPrecisionOptionsLoadRequestedSymbol = symbol;
      window.setTimeout(async () => {
        try {
          if (!isCurrentObservedSymbol(symbol) || document.hidden || orderbookPrecisionSelectionTask) return;
          orderbookPrecisionOptionsLoadAttemptedSymbol = symbol;
          orderbookPrecisionState = {
            ...orderbookPrecisionState,
            symbol,
            nativeOptionsStatus: "读取档位"
          };
          scheduleRenderPanel();
          await runOrderbookPrecisionSelectionTask(runLoadOrderbookPrecisionOptions);
        } catch (error) {
          err("读取原生订单簿缩放档位失败:", error);
          if (isCurrentObservedSymbol(symbol)) {
            orderbookPrecisionState = {
              ...orderbookPrecisionState,
              nativeOptionsStatus: "读取价格精度选项失败"
            };
            scheduleRenderPanel();
          }
        } finally {
          if (document.hidden && orderbookPrecisionOptionsLoadAttemptedSymbol === symbol) orderbookPrecisionOptionsLoadAttemptedSymbol = null;
          if (orderbookPrecisionOptionsLoadRequestedSymbol === symbol) {
            orderbookPrecisionOptionsLoadRequestedSymbol = null;
          }
          scheduleRenderPanel();
        }
      }, 0);
    }
    function refreshOrderbookPrecisionSamplesNow() {
      const symbol = getCurrentSymbol();
      if (!symbol || !isCurrentObservedSymbol(symbol)) {
        orderbookPrecisionState = {
          ...orderbookPrecisionState,
          symbol,
          status: "未识别当前交易对"
        };
        scheduleRenderPanel();
        return;
      }
      const {
        samples: latestSamples,
        recommendation
      } = recommendOrderbookPrecisionWithExpandingWindow({
        prices: getLatestTradePrices(),
        options: ORDERBOOK_PRECISION_CANDIDATE_OPTIONS,
        initialLimit: ORDERBOOK_PRECISION_INITIAL_TRADE_LIMIT,
        expansionStep: ORDERBOOK_PRECISION_TRADE_EXPANSION_STEP,
        minSamples: ORDERBOOK_PRECISION_MIN_EFFECTIVE_MOVES
      });
      const samples = saveStoredOrderbookPrecisionSamples(symbol, latestSamples);
      orderbookPrecisionState = {
        ...orderbookPrecisionState,
        symbol,
        samples,
        recommendation,
        current: readCurrentOrderbookPrecisionValue(),
        status: recommendation ? "ready" : PANEL_COPY.status.precisionInsufficient
      };
      if (!orderbookPrecisionState.nativeOptions.length) {
        queueOrderbookPrecisionOptionsLoad(symbol, true);
      }
      refreshOrderbookPrecisionRecommendation();
      showOrderbookPrecisionRefreshFeedback(symbol, recommendation ? "success" : "retry");
      scheduleRenderPanel();
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
      const statusLabels = {
        OPEN_LONG: PANEL_COPY.action.openLong,
        OPEN_SHORT: PANEL_COPY.action.openShort,
        CLOSE_LONG: PANEL_COPY.action.closeLong,
        CLOSE_SHORT: PANEL_COPY.action.closeShort
      };
      return {
        ...spec,
        statusLabel: statusLabels[actionType],
        buttonGetter: buttonGetters[actionType]
      };
    }
    function localizedActionStatus(label, zhCN, en) {
      return localizedText(
        `${formatLocalizedText(label, "zh-CN")}${zhCN}`,
        `${formatLocalizedText(label, "en")}${en}`
      );
    }
    function localizedContinuousAction(label) {
      return localizedText(
        `连续${formatLocalizedText(label, "zh-CN")}`,
        `Continuous ${formatLocalizedText(label, "en")}`
      );
    }
    function findTradeModeTabByMode(mode) {
      const tabs = document.querySelectorAll(
        '#position-direction [role="tab"], .bn-tabs__buySell [role="tab"], [role="tab"].bn-tab__buySell'
      );
      return Array.from(tabs).find((tab) => parseTradeModeLabel(tab.textContent) === mode) || null;
    }
    function findPostOnlyOrderTab() {
      return findVisibleTradeScopeElement('[role="tab"]', (tab) => {
        const text = (tab.textContent || "").trim();
        const key = String(tab.getAttribute("data-tab-key") || "").toUpperCase();
        return key === BINANCE_POST_ONLY_ORDER_TYPE && includesBinancePageText(text, BINANCE_PAGE_TEXT.postOnly);
      });
    }
    async function activateTradeMode(mode) {
      if (getActiveTradeMode() === mode) return true;
      const tab = findTradeModeTabByMode(mode);
      if (!tab) return false;
      const mutationRoot = getTradeMutationRoot();
      tab.click();
      const activeMode = await waitForTradeFormMutationState(
        mutationRoot,
        () => getActiveTradeMode() === mode ? mode : null,
        TRADE_UI_STATE_TIMEOUT_MS
      );
      invalidateTradeButtonCache();
      scheduleRenderPanel();
      return activeMode === mode;
    }
    async function ensurePostOnlyOrderType() {
      if (isPostOnlyOrderTypeActive()) return true;
      const tab = findPostOnlyOrderTab();
      if (!tab) return false;
      const mutationRoot = getTradeMutationRoot();
      tab.click();
      const active = await waitForTradeFormMutationState(
        mutationRoot,
        () => isPostOnlyOrderTypeActive() ? true : null,
        TRADE_UI_STATE_TIMEOUT_MS
      );
      return active === true;
    }
    async function readOpenBaseQtyForLadder(spec, referencePrice) {
      const priceInput = findPriceInput();
      if (!priceInput || !referencePrice) return null;
      setInputValueReact(priceInput, referencePrice);
      const readQuantity = () => {
        const openLongBtn = findOpenLongButton();
        const openShortBtn = findOpenShortButton();
        const { longQty, shortQty, qtySource } = readOpenableQty(openLongBtn, openShortBtn);
        const qty = spec.side === "LONG" ? longQty : shortQty;
        return { qty, qtySource };
      };
      const classifyUnavailableQuantity = (quantity) => ({
        ...quantity,
        confirmedZeroOpenBalance: isConfirmedZeroOpenBalance(quantity.qty)
      });
      const mutationRoot = getTradeMutationRoot();
      const ready = await waitForTradeFormMutationState(
        mutationRoot,
        () => {
          const quantity = readQuantity();
          const { qty } = quantity;
          if (qty != null && isPositiveDecimalString(String(qty))) {
            return { ...quantity, confirmedZeroOpenBalance: false };
          }
          const classified = classifyUnavailableQuantity(quantity);
          return classified.confirmedZeroOpenBalance ? classified : null;
        },
        LADDER_OPEN_QTY_READY_TIMEOUT_MS
      );
      return ready || classifyUnavailableQuantity(readQuantity());
    }
    function readCloseBaseQtyForLadder(spec) {
      const symbol = getCurrentSymbol();
      if (!isCloseSnapshotReady(symbol)) return { qty: null, qtySource: null };
      const raw = readCloseContext(symbol);
      const hasConfirmedContext = raw.knowsLong && raw.knowsShort;
      const qty = hasConfirmedContext ? spec.side === "LONG" ? raw.longQty : raw.shortQty : null;
      return {
        qty: qty != null ? normalizeDecimalString(String(qty)) : null,
        qtySource: raw.qtySource
      };
    }
    function createClosePositionCompletedError() {
      const error = new Error("当前方向已无持仓");
      error.name = "ClosePositionCompletedError";
      return error;
    }
    function isClosePositionCompletedError(error) {
      return error?.name === "ClosePositionCompletedError";
    }
    async function throwIfClosePositionCompleted(context, abortSignal = null) {
      if (context?.spec?.mode !== "CLOSE") return;
      throwIfAborted(abortSignal);
      if (!isCurrentObservedSymbol(context.symbol)) {
        throw new Error("确认平仓结果时交易对已变化");
      }
      if (getActiveTradeMode() !== "CLOSE") {
        throw new Error("确认平仓结果时下单模式已变化");
      }
      if (!await waitForBncHeaders(context.symbol)) {
        const error = createContinuousRecoverableLadderError(
          "position_state_not_ready",
          "确认平仓结果时币安请求头尚未就绪"
        );
        error.skipImmediateCloseRecheck = true;
        throw error;
      }
      let state;
      try {
        state = await fetchCurrentSymbolPositionSideState(
          context.symbol,
          context.spec.side
        );
      } catch (error) {
        if (error?.name === "PositionPayloadContractError" || [401, 403].includes(error?.httpStatus) || error?.httpStatus >= 400 && error.httpStatus < 500 && ![418, 429].includes(error.httpStatus)) {
          throw error;
        }
        const rateLimited = [418, 429].includes(error?.httpStatus);
        const recoveryError = createContinuousRecoverableLadderError(
          rateLimited ? "rate_limited" : "position_state_not_ready",
          rateLimited ? "仓位确认请求频率受限" : "仓位确认暂未完成"
        );
        if (rateLimited) {
          const retryAfterSeconds = Number(error.retryAfter);
          recoveryError.continuousRecoveryCooldownMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0 ? retryAfterSeconds * 1e3 : 1e4;
        }
        recoveryError.skipImmediateCloseRecheck = true;
        throw recoveryError;
      }
      throwIfAborted(abortSignal);
      if (!isCurrentObservedSymbol(context.symbol)) {
        throw new Error("确认平仓结果时交易对已变化");
      }
      if (getActiveTradeMode() !== "CLOSE") {
        throw new Error("确认平仓结果时下单模式已变化");
      }
      if (state.status === "flat") throw createClosePositionCompletedError();
    }
    async function buildLadderPlan(actionType, expectedContext = null) {
      const spec = getLadderActionSpec2(actionType);
      if (!spec) throw new Error("未知阶梯动作");
      const startSymbol = getCurrentSymbol();
      if (!startSymbol) throw new Error("未识别当前交易对");
      if (expectedContext?.symbol && startSymbol !== expectedContext.symbol) {
        throw new Error("重挂前交易对已变化，已停止");
      }
      if (expectedContext?.mode && spec.mode !== expectedContext.mode) {
        throw new Error("重挂前开仓/平仓模式已变化，已停止");
      }
      const modeLabel = spec.mode === "OPEN" ? "开仓" : "平仓";
      const modeReady = await activateTradeMode(spec.mode);
      if (getCurrentSymbol() !== startSymbol) {
        throw new Error(`切换至${modeLabel}时交易对已变化，已停止`);
      }
      if (!modeReady) {
        throw createContinuousRecoverableLadderError(
          "controls_not_ready",
          `未能切换至${modeLabel}`
        );
      }
      const startPrecision = readCurrentOrderbookPrecisionValue();
      if (!startPrecision) {
        throw createContinuousRecoverableLadderError(
          "market_data_not_ready",
          "未识别价格精度"
        );
      }
      if (expectedContext?.precision && startPrecision !== expectedContext.precision) {
        throw createContinuousRecoverableLadderError(
          "precision_changed",
          "重挂前价格精度已变化，已停止"
        );
      }
      const postOnlyReady = await ensurePostOnlyOrderType();
      if (!postOnlyReady) {
        throw createContinuousRecoverableLadderError(
          "controls_not_ready",
          "只做 Maker 未生效，请刷新页面后重试"
        );
      }
      const optionContext = readLadderOptionContext(spec, startSymbol, startPrecision);
      const levels = optionContext.levels;
      const ladderStep = optionContext.ladderStep;
      const prices = getBufferedMakerPrices(spec.priceSide, levels, ladderStep);
      if (prices.length < levels) {
        throw createContinuousRecoverableLadderError(
          "market_data_not_ready",
          `订单簿${spec.priceSide === "BID" ? "买盘" : "卖盘"}不足 ${levels} 档，档幅 ${ladderStep}`
        );
      }
      const rules = await ensureRules(startSymbol);
      if (getCurrentSymbol() !== startSymbol) {
        throw new Error("读取交易规则时交易对已变化，已停止");
      }
      if (readCurrentOrderbookPrecisionValue() !== startPrecision) {
        throw createContinuousRecoverableLadderError(
          "precision_changed",
          "读取交易规则时价格精度已变化，已停止"
        );
      }
      if (!rules) {
        throw createContinuousRecoverableLadderError(
          "market_data_not_ready",
          "交易规则尚未就绪，请稍后重试"
        );
      }
      const ruleContext = getQtyRuleContext(startSymbol, spec.mode, prices[0]);
      if (ruleContext.status !== "ready" || !ruleContext.stepSize || !ruleContext.baseMinQty) {
        throw createContinuousRecoverableLadderError(
          "market_data_not_ready",
          "下单数量规则尚未就绪，请稍后重试"
        );
      }
      const minRequiredQtyByLevel = spec.mode === "OPEN" ? prices.map((price) => getQtyRuleContext(startSymbol, spec.mode, price).effectiveMinQty || ruleContext.baseMinQty) : prices.map(() => ruleContext.baseMinQty);
      let minRequiredQty = minRequiredQtyByLevel.filter(Boolean).reduce((maxQty, qty) => maxDecimalString(maxQty, qty), ruleContext.baseMinQty);
      const base = spec.mode === "OPEN" ? await readOpenBaseQtyForLadder(spec, prices[0]) : readCloseBaseQtyForLadder(spec);
      const quantityLabel = spec.mode === "OPEN" ? "可开数量" : "可平数量";
      if (getCurrentSymbol() !== startSymbol) {
        throw new Error(`读取${quantityLabel}时交易对已变化，已停止`);
      }
      if (getActiveTradeMode() !== spec.mode) {
        throw new Error(`读取${quantityLabel}时下单模式已变化，已停止`);
      }
      if (readCurrentOrderbookPrecisionValue() !== startPrecision) {
        throw createContinuousRecoverableLadderError(
          "precision_changed",
          `读取${quantityLabel}时价格精度已变化，已停止`
        );
      }
      if (!isPostOnlyOrderTypeActive()) {
        throw new Error(`读取${quantityLabel}时只做 Maker 已失效，请刷新页面后重试`);
      }
      if (!areLadderOptionContextsEqual(
        readLadderOptionContext(spec, startSymbol, startPrecision),
        optionContext
      )) {
        throw createContinuousRecoverableLadderError(
          "options_changed",
          "读取下单数量时比例、笔数或间距已变化"
        );
      }
      const baseQty = normalizeDecimalString(base?.qty ?? "");
      let unavailableQuantityMessage = getUnavailableLadderQuantityMessage(
        spec.mode,
        baseQty,
        base?.confirmedZeroOpenBalance === true
      );
      if (unavailableQuantityMessage) {
        if (!baseQty) {
          throw createContinuousRecoverableLadderError(
            "market_data_not_ready",
            unavailableQuantityMessage
          );
        }
        if (spec.mode === "CLOSE") {
          await throwIfClosePositionCompleted({ spec, symbol: startSymbol });
          const error = createContinuousRecoverableLadderError(
            "position_quantity_not_ready",
            "当前方向暂无可平数量"
          );
          error.skipImmediateCloseRecheck = true;
          throw error;
        }
        throw new Error(unavailableQuantityMessage);
      }
      let percent = optionContext.percent;
      if (percent == null) throw new Error("未知阶梯模式");
      const totalQty = multiplyDecimalByRatio(baseQty, percent, 100);
      let allocation = allocateLadderQuantities(totalQty, levels, ruleContext.stepSize, minRequiredQty);
      let autoFitPercent = null;
      let autoFitLevels = null;
      if (!allocation || allocation.actualLevels < levels) {
        const autoFit = fitLadderPlanForMinimumQty({
          baseQty,
          minRequiredQty,
          minRequiredQtyByLevel,
          percent,
          levels,
          stepSize: ruleContext.stepSize
        });
        if (autoFit.allocation) {
          allocation = autoFit.allocation;
          percent = autoFit.percent;
          minRequiredQty = autoFit.minRequiredQty || minRequiredQty;
          autoFitPercent = autoFit.percent;
          autoFitLevels = autoFit.levels;
        } else {
          throw createLadderMinimumQtyFailure({
            spec,
            symbol: startSymbol,
            precision: startPrecision,
            mode: spec.mode,
            minRequiredQty,
            baseQty,
            percent,
            levels,
            optionContext,
            minimumPercent: autoFit.minimumPercent,
            maxAutoFitPercent: autoFit.maxPercent,
            replacementTotalQty: spec.mode === "OPEN" ? multiplyDecimalByInt(minRequiredQty, levels) : null
          });
        }
      }
      const orderPrices = prices.slice(0, allocation.actualLevels);
      return {
        spec,
        symbol: startSymbol,
        precision: startPrecision,
        optionContext,
        percent,
        ladderStep,
        levels: allocation.actualLevels,
        requestedLevels: allocation.requestedLevels,
        baseQty,
        totalQty: allocation.totalQty,
        minRequiredQty,
        autoFitPercent,
        autoFitLevels,
        prices: orderPrices,
        qtySource: base.qtySource,
        orders: orderPrices.map((price, index) => ({ price, qty: allocation.quantities[index] }))
      };
    }
    function createLadderMinimumQtyFailure(options) {
      const {
        spec,
        symbol,
        precision,
        mode,
        minRequiredQty,
        percent,
        levels,
        optionContext,
        minimumPercent,
        maxAutoFitPercent,
        replacementTotalQty
      } = options;
      const percentLabel = mode === "OPEN" ? "开仓比例" : "平仓比例";
      const actionLabel = mode === "OPEN" ? "开仓" : "平仓";
      const percentHint = minimumPercent ? `，需 >= ${minimumPercent}%` : "";
      const error = new Error(`数量低于最小下单量 ${minRequiredQty}${percentHint}`);
      error.localizedText = localizedText(
        error.message,
        `Quantity is below the minimum order quantity ${minRequiredQty}${minimumPercent ? `; requires at least ${minimumPercent}%` : ""}`
      );
      const minimumText = minimumPercent ? `至少需要${percentLabel} ${minimumPercent}% 才能保持当前档位。` : "";
      const maxText = maxAutoFitPercent ? `自动上限 ${maxAutoFitPercent}%。` : "";
      const levelsText = levels ? `当前档位 ${levels} 档。` : "";
      const replacementText = mode === "OPEN" ? "脚本只会尝试替换当前交易对的同向开仓基础单，不会自动全撤。" : "脚本不会自动撤单。";
      error.statusTitle = `当前${percentLabel} ${percent}%，目标数量小于最小下单量 ${minRequiredQty}，无法阶梯${actionLabel}；${levelsText}${minimumText}${maxText}已尝试自动提高比例和自动降档；${replacementText}`;
      error.localizedStatusTitle = localizedText(
        error.statusTitle,
        `Current ${mode === "OPEN" ? "open" : "close"} ratio is ${percent}%. The target quantity is below the minimum order quantity ${minRequiredQty}, so the ladder cannot ${mode === "OPEN" ? "open" : "close"}. ${levels ? `Current plan: ${levels} orders. ` : ""}${minimumPercent ? `At least ${minimumPercent}% is required to keep the current order count. ` : ""}${maxAutoFitPercent ? `Automatic limit: ${maxAutoFitPercent}%. ` : ""}The script tried increasing the ratio and reducing the order count. ${mode === "OPEN" ? "Only same-symbol, same-direction Basic open orders may be replaced; Cancel All is never automatic." : "Orders are not cancelled automatically."}`
      );
      if (mode === "CLOSE") {
        error.safeNoSubmit = true;
        error.continuousRecoveryKind = "position_quantity_not_ready";
      }
      if (mode === "OPEN" && spec && symbol && precision && replacementTotalQty && isPositiveDecimalString(replacementTotalQty)) {
        error.openOrdersReplacementPlan = {
          spec,
          symbol,
          precision,
          optionContext,
          totalQty: replacementTotalQty
        };
      }
      return error;
    }
    function assertLadderMakerPrice(plan, price) {
      const oppositeSide = plan.spec.orderSide === "BUY" ? "ASK" : "BID";
      const oppositePrice = getBestOrderbookPrice(oppositeSide);
      if (!oppositePrice) {
        throw createContinuousRecoverableLadderError(
          "market_data_not_ready",
          "盘口已刷新，未读取到对手盘价格"
        );
      }
      const cmp = compareDecimalStrings(price, oppositePrice);
      if (cmp == null) throw new Error("盘口价格校验失败");
      if (plan.spec.orderSide === "BUY" && cmp >= 0) {
        throw createLadderMakerPriceConflictError(`盘口已移动，买单 ${price} 可能吃单，对手卖一 ${oppositePrice}`);
      }
      if (plan.spec.orderSide === "SELL" && cmp <= 0) {
        throw createLadderMakerPriceConflictError(`盘口已移动，卖单 ${price} 可能吃单，对手买一 ${oppositePrice}`);
      }
    }
    function createLadderMakerPriceConflictError(message) {
      const error = new Error(message);
      error.ladderFailureKind = "maker_price_conflict";
      error.safeNoSubmit = true;
      return error;
    }
    function isRetryableLadderMakerPriceFailure(plan, error) {
      if (plan?.spec?.mode !== "OPEN" && plan?.spec?.mode !== "CLOSE") return false;
      if (error?.ladderFailureKind === "maker_price_conflict") return error.safeNoSubmit === true;
      return isBinancePostOnlyMakerRejectCode(error?.binanceCode) && error.safeNoSubmit === true;
    }
    function isRecoverableMaxOpenOrdersFailure(plan, error, allowRecovery) {
      return allowRecovery === true && plan?.spec?.mode === "CLOSE" && error?.ladderFailureKind === "max_open_orders" && isBinanceMaxOpenOrdersErrorCode(error.binanceCode) && error.safeNoSubmit === true;
    }
    function createLadderSubmitApiError(apiErrorCode) {
      const error = new Error(`Maker 挂单被拒绝（错误码 ${apiErrorCode}）`);
      error.binanceCode = apiErrorCode;
      error.safeNoSubmit = true;
      return error;
    }
    function createLadderMaxOpenOrdersError(apiError) {
      if (apiError.success !== false) throw new Error("最大挂单限制响应缺少 success=false");
      const error = new Error(`${apiError.message || "达到最大下单限制"}（错误码 ${apiError.code}）`);
      error.binanceCode = apiError.code;
      error.ladderFailureKind = "max_open_orders";
      error.safeNoSubmit = true;
      return error;
    }
    function formatLadderRepriceDiagnostics(repriceAttempts, lastRepriceApiErrorCode) {
      if (repriceAttempts <= 0) return "";
      const zhCode = lastRepriceApiErrorCode == null ? "" : `，错误码 ${lastRepriceApiErrorCode}`;
      const enCode = lastRepriceApiErrorCode == null ? "" : `, error code ${lastRepriceApiErrorCode}`;
      return localizedText(
        `（刷新盘口 ${repriceAttempts} 次${zhCode}）`,
        ` (Order book refreshed ${repriceAttempts} times${enCode})`
      );
    }
    function refreshRemainingLadderOrders(plan, completedCount) {
      assertLadderExecutionContext(plan);
      const remainingCount = plan.orders.length - completedCount;
      if (remainingCount <= 0) throw new Error("没有待重定价的阶梯订单");
      const prices = getBufferedMakerPrices(plan.spec.priceSide, remainingCount, plan.ladderStep);
      if (prices.length !== remainingCount) {
        throw createContinuousRecoverableLadderError(
          "market_data_not_ready",
          `刷新后订单簿${plan.spec.priceSide === "BID" ? "买盘" : "卖盘"}不足 ${remainingCount} 档`
        );
      }
      const repricedOrders = repriceRemainingLadderOrders({
        orders: plan.orders,
        completedCount,
        prices
      });
      if (plan.spec.mode === "OPEN") {
        for (let index = completedCount; index < repricedOrders.length; index += 1) {
          const order = repricedOrders[index];
          const ruleContext = getQtyRuleContext(plan.symbol, "OPEN", order.price);
          if (ruleContext.status !== "ready" || !ruleContext.effectiveMinQty) {
            throw createContinuousRecoverableLadderError(
              "market_data_not_ready",
              "刷新盘口后最小下单量未就绪"
            );
          }
          const comparison = compareDecimalStrings(order.qty, ruleContext.effectiveMinQty);
          if (comparison == null) throw new Error("刷新盘口后数量校验失败，已停止");
          if (comparison < 0) {
            throw new Error(`刷新盘口后第 ${index + 1} 档数量 ${order.qty} 低于最小下单量 ${ruleContext.effectiveMinQty}，已停止`);
          }
        }
      }
      plan.orders = repricedOrders;
      return remainingCount;
    }
    function assertLadderExecutionContext(plan) {
      if (!isCurrentObservedSymbol(plan.symbol)) throw new Error("执行中交易对已变化，已停止");
      if (getActiveTradeMode() !== plan.spec.mode) throw new Error("执行中下单模式已变化，已停止");
      if (readCurrentOrderbookPrecisionValue() !== plan.precision) {
        throw createContinuousRecoverableLadderError(
          "precision_changed",
          "执行中价格精度已变化，已停止"
        );
      }
      if (hasLadderOptionContextChanged(plan)) {
        throw createContinuousRecoverableLadderError(
          "options_changed",
          "执行中比例、笔数或间距已变化"
        );
      }
      if (!isPostOnlyOrderTypeActive()) throw new Error("执行中只做 Maker 已失效，请刷新页面后重试");
    }
    function assertSubmittedPriceMatchesExpectedPrice(expectedPrice, submittedPrice, expectedLabel = "点击价") {
      const expected = normalizeDecimalString(expectedPrice);
      const submitted = normalizeDecimalString(submittedPrice);
      const cmp = compareDecimalStrings(expected, submitted);
      if (cmp !== 0) {
        throw createContinuousRecoverableLadderError(
          "input_unstable",
          `价格框未同步，${expectedLabel} ${expected || expectedPrice}，当前提交价 ${submitted || submittedPrice || "-"}`
        );
      }
    }
    function assertSubmittedQtyMatchesExpectedQty(expectedQty, submittedQty, expectedLabel = "目标量") {
      const expected = normalizeDecimalString(expectedQty);
      const submitted = normalizeDecimalString(submittedQty);
      const cmp = compareDecimalStrings(expected, submitted);
      if (cmp !== 0) {
        throw createContinuousRecoverableLadderError(
          "input_unstable",
          `数量框未同步，${expectedLabel} ${expected || expectedQty}，当前提交量 ${submitted || submittedQty || "-"}`
        );
      }
    }
    async function syncTradeInputs(expectedPrice, expectedQty, options = null) {
      const priceLabel = options?.priceLabel || "点击价";
      const qtyLabel = options?.qtyLabel || "目标量";
      const settleControlledForm = options?.settleControlledForm === true;
      const syncTimeoutMs = settleControlledForm ? LADDER_INPUT_SETTLE_TIMEOUT_MS : TRADE_INPUT_SYNC_TIMEOUT_MS;
      const stableDurationMs = settleControlledForm ? LADDER_INPUT_SETTLE_STABLE_MS : 0;
      const maxWriteAttempts = settleControlledForm ? LADDER_INPUT_SETTLE_MAX_WRITES : 2;
      const previousSubmittedInputs = settleControlledForm ? options?.previousSubmittedInputs || null : null;
      const isRecoveryWriteAllowed = settleControlledForm ? ({
        field,
        preWriteValue,
        rollbackValue,
        submittedValue
      }) => {
        if (field !== "qty" && field !== "price") {
          throw new Error("未知交易输入字段");
        }
        return isScriptOwnedTradeInputRecoveryState({
          preWriteValue,
          rollbackValue,
          submittedValue,
          previousSubmittedValue: field === "qty" ? previousSubmittedInputs?.submittedQty : previousSubmittedInputs?.submittedPrice,
          compareValues: compareDecimalStrings
        });
      } : ({ rollbackValue, submittedValue }) => rollbackValue === submittedValue;
      const writeTradeInputValue = settleControlledForm ? createBoundedInputWriter({
        writeValue: setInputValueReact,
        maxWriteAttempts
      }) : setInputValueReact;
      const inputs = findTradeInputs();
      if (!inputs) {
        throw createContinuousRecoverableLadderError(
          "controls_not_ready",
          "未能确定唯一的当前交易表单输入框"
        );
      }
      const observationRoot = inputs.root;
      const readTradeState = createTradeInputStateReader({
        resolveInputs: findTradeInputs,
        expectedPrice,
        expectedQty,
        includePrice: true,
        normalizeValue: normalizeDecimalString,
        compareValues: compareDecimalStrings,
        writeValue: writeTradeInputValue,
        requiredStableMismatchFrames: TRADE_INPUT_SYNC_STABLE_FRAMES,
        requiredStableMismatchMs: stableDurationMs,
        requiredStableMatchFrames: settleControlledForm ? TRADE_INPUT_SYNC_STABLE_FRAMES : 1,
        requiredStableMatchMs: stableDurationMs,
        maxWriteAttempts,
        recoverProvisionalMatchRollback: settleControlledForm,
        isRecoveryWriteAllowed,
        readNowMs: () => performance.now()
      });
      readTradeState();
      const synchronized = await waitForTradeFormFrameState(
        observationRoot,
        readTradeState,
        syncTimeoutMs,
        TRADE_INPUT_SYNC_STABLE_FRAMES
      );
      if (synchronized) return synchronized;
      assertSubmittedPriceMatchesExpectedPrice(
        expectedPrice,
        findPriceInput()?.value || "",
        priceLabel
      );
      assertSubmittedQtyMatchesExpectedQty(expectedQty, findQtyInput()?.value || "", qtyLabel);
      throw createContinuousRecoverableLadderError(
        "input_unstable",
        "价格框或数量框未稳定"
      );
    }
    function isSubmitButtonBusy(button) {
      if (!button) return false;
      const text = (button.textContent || "").toLowerCase();
      const cls = String(button.className || "").toLowerCase();
      return button.disabled || button.getAttribute("aria-disabled") === "true" || button.getAttribute("aria-busy") === "true" || button.getAttribute("data-loading") === "true" || includesBinancePageText(text, BINANCE_PAGE_TEXT.submitBusy) || cls.includes("loading") || !!button.querySelector('[class*="loading"], [class*="spinner"], [aria-busy="true"]');
    }
    async function waitForReadyLadderSubmitButton(plan) {
      const resolveReadyButton = () => {
        const candidate = plan.spec.buttonGetter();
        return candidate && !isSubmitButtonBusy(candidate) ? candidate : null;
      };
      const button = await waitForTradeActionButtonFrameState(
        document,
        resolveReadyButton,
        isVisibleElement,
        TRADE_ACTION_BUTTON_READY_TIMEOUT_MS
      );
      if (button) return button;
      const currentButton = plan.spec.buttonGetter();
      if (!currentButton || !currentButton.isConnected || !isVisibleElement(currentButton)) {
        throw createContinuousRecoverableLadderError(
          "controls_not_ready",
          `下单按钮 ${TRADE_ACTION_BUTTON_READY_TIMEOUT_SECONDS} 秒内未渲染完成`
        );
      }
      if (isSubmitButtonBusy(currentButton)) {
        throw createContinuousRecoverableLadderError(
          "controls_not_ready",
          `下单按钮 ${TRADE_ACTION_BUTTON_READY_TIMEOUT_SECONDS} 秒内未恢复可点击`
        );
      }
      throw createContinuousRecoverableLadderError(
        "controls_not_ready",
        `下单按钮 ${TRADE_ACTION_BUTTON_READY_TIMEOUT_SECONDS} 秒内未达到可点击状态`
      );
    }
    function readVisibleOrderFeedbackEntries() {
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
      const entries = [];
      for (const el of document.querySelectorAll(selectors.join(","))) {
        if (seen.has(el) || !isVisibleElement(el)) continue;
        seen.add(el);
        const text = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (!text || text.length > 300) continue;
        if (isPotentialOrderFeedbackText(text)) entries.push({ el, text });
      }
      return entries;
    }
    function takeOrderFeedbackSnapshot() {
      const entries = readVisibleOrderFeedbackEntries();
      return {
        elements: new Set(entries.map(({ el }) => el)),
        textByElement: new Map(entries.map(({ el, text }) => [el, text])),
        htmlByElement: new Map(entries.map(({ el }) => [el, el.innerHTML]))
      };
    }
    function readNewVisibleOrderFeedbackText(previousSnapshot) {
      const snapshot = previousSnapshot || { elements: /* @__PURE__ */ new Set(), textByElement: /* @__PURE__ */ new Map(), htmlByElement: /* @__PURE__ */ new Map() };
      for (const { el, text } of readVisibleOrderFeedbackEntries()) {
        if (!snapshot.elements.has(el)) return text;
        if (snapshot.textByElement.get(el) !== text) return text;
        if (snapshot.htmlByElement.get(el) !== el.innerHTML) return text;
      }
      return "";
    }
    function waitForOrderSubmitStartOrFailureFeedback(submitCaptureId, previousFeedbackSnapshot, timeoutMs) {
      const capture = activeLadderSubmitCapture?.captureId === submitCaptureId ? activeLadderSubmitCapture : null;
      if (!capture) throw new Error("下单结果跟踪状态异常，已停止");
      return new Promise((resolve) => {
        let settled = false;
        const finish = (result) => {
          if (settled) return;
          settled = true;
          observer.disconnect();
          window.clearTimeout(timer);
          resolve(result);
        };
        const readFailure = () => {
          const feedback = readNewVisibleOrderFeedbackText(previousFeedbackSnapshot);
          if (!feedback) return null;
          const acknowledgement = evaluateOrderSubmitAcknowledgement({
            feedback,
            isNewFeedback: true
          });
          return acknowledgement.status === "failure" ? { status: "failure", message: acknowledgement.message } : null;
        };
        const observer = new MutationObserver(() => {
          const failure2 = readFailure();
          if (failure2) finish(failure2);
        });
        const timer = window.setTimeout(() => finish({ status: "timeout" }), timeoutMs);
        observer.observe(document.body, {
          subtree: true,
          childList: true,
          characterData: true
        });
        capture.requestStarted.then(() => finish({ status: "request_started" }));
        const failure = readFailure();
        if (failure) finish(failure);
      });
    }
    function waitForOrderFailureFeedback(previousFeedbackSnapshot, timeoutMs) {
      return new Promise((resolve) => {
        let settled = false;
        const finish = (result) => {
          if (settled) return;
          settled = true;
          observer.disconnect();
          window.clearTimeout(timer);
          resolve(result);
        };
        const readFailure = () => {
          const feedback = readNewVisibleOrderFeedbackText(previousFeedbackSnapshot);
          if (!feedback) return null;
          const acknowledgement = evaluateOrderSubmitAcknowledgement({
            feedback,
            isNewFeedback: true
          });
          return acknowledgement.status === "failure" ? { status: "failure", message: acknowledgement.message } : null;
        };
        const observer = new MutationObserver(() => {
          const failure2 = readFailure();
          if (failure2) finish(failure2);
        });
        const timer = window.setTimeout(() => finish({ status: "timeout" }), timeoutMs);
        observer.observe(document.body, {
          subtree: true,
          childList: true,
          characterData: true
        });
        const failure = readFailure();
        if (failure) finish(failure);
      });
    }
    async function waitForOrderSubmitAcknowledgement(button, label, previousFeedbackSnapshot, submitCaptureId, mode, abortSignal = null) {
      const sawBusy = isSubmitButtonBusy(button);
      const activity = await waitForPromiseOrAbort(
        waitForOrderSubmitStartOrFailureFeedback(
          submitCaptureId,
          previousFeedbackSnapshot,
          LADDER_SUBMIT_START_TIMEOUT_MS
        ),
        abortSignal
      );
      const responseObservation = activity.status === "request_started" ? await waitForLadderSubmitResponseObservations(
        submitCaptureId,
        LADDER_SUBMIT_RESPONSE_TIMEOUT_MS,
        abortSignal
      ) : { settled: false, apiErrors: [], diagnostics: [] };
      const capturedApiErrors = responseObservation.apiErrors;
      const capturedApiSuccesses = readLadderSubmitApiSuccesses(submitCaptureId);
      if (capturedApiErrors.length === 1 && isBinancePostOnlyMakerRejectCode(capturedApiErrors[0].code)) {
        throw createLadderSubmitApiError(capturedApiErrors[0].code);
      }
      if (capturedApiErrors.length === 1 && isBinanceMaxOpenOrdersErrorCode(capturedApiErrors[0].code)) {
        throw createLadderMaxOpenOrdersError(capturedApiErrors[0]);
      }
      const responseRecovery = resolveBinanceSubmitResponseRecovery(
        responseObservation.diagnostics,
        capturedApiErrors
      );
      if (responseRecovery) {
        const responseDiagnostic2 = responseObservation.diagnostics.length === 0 ? "" : responseObservation.diagnostics.map(formatBinancePlaceOrderResponseDiagnostic).join(" | ");
        const reason = responseRecovery.kind === "rate_limited" ? localizedText(
          `下单请求频率受限${responseDiagnostic2 ? `：${responseDiagnostic2}` : ""}`,
          `Order request rate limited${responseDiagnostic2 ? `: ${responseDiagnostic2}` : ""}`
        ) : localizedText(
          `Binance 服务异常，订单结果未确认${responseDiagnostic2 ? `：${responseDiagnostic2}` : ""}`,
          `Binance service error; order outcome unconfirmed${responseDiagnostic2 ? `: ${responseDiagnostic2}` : ""}`
        );
        throw createContinuousRoundRecoveryError(
          responseRecovery.kind,
          reason,
          responseRecovery.cooldownMs
        );
      }
      let failureActivity = activity.status === "failure" ? activity : null;
      if (!failureActivity && capturedApiErrors.length > 0) {
        failureActivity = await waitForOrderFailureFeedback(
          previousFeedbackSnapshot,
          LADDER_SUBMIT_START_TIMEOUT_MS
        );
        if (failureActivity.status !== "failure") failureActivity = null;
      }
      if (failureActivity && capturedApiErrors.length === 0 && mode === "CLOSE" && isPostOnlyMakerRejectionFeedback(failureActivity.message)) {
        throw createLadderMakerPriceConflictError(failureActivity.message);
      }
      if (failureActivity) {
        const capturedCodes = [...new Set(capturedApiErrors.map(({ code }) => code))];
        const diagnostic = capturedCodes.length === 0 ? "未捕获错误码" : `错误码 ${capturedCodes.join(", ")}`;
        throw new Error(`${failureActivity.message}（${diagnostic}）`);
      }
      if (capturedApiSuccesses.length === 1) return;
      const responseDiagnostic = responseObservation.diagnostics.length === 0 ? "" : responseObservation.diagnostics.map(formatBinancePlaceOrderResponseDiagnostic).join(" | ");
      const settleHint = responseObservation.settled ? `下单请求已返回，但结果未识别${responseDiagnostic ? `：${responseDiagnostic}` : ""}` : sawBusy ? "下单按钮已恢复，但下单请求仍未返回" : "下单请求仍未返回";
      const englishSettleHint = responseObservation.settled ? `the request returned but its result was not recognized${responseDiagnostic ? `: ${responseDiagnostic}` : ""}` : sawBusy ? "the submit button recovered but the request has not returned" : "the request has not returned";
      throw createContinuousUnconfirmedSubmitError(localizedText(
        `未确认${label}成功（${settleHint}）；请在当前委托和历史成交中核对`,
        `Order submission was not confirmed (${englishSettleHint}); check Open Orders and Trade History`
      ));
    }
    async function executeLadderPlan(plan, progress, setExecutionStatus, abortSignal = null, options = null) {
      const priceInput = findPriceInput();
      const qtyInput = findQtyInput();
      if (!priceInput) {
        throw createContinuousRecoverableLadderError("controls_not_ready", "未找到价格输入框");
      }
      if (!qtyInput) {
        throw createContinuousRecoverableLadderError("controls_not_ready", "未找到数量输入框");
      }
      let done = 0;
      let repriceAttempts = 0;
      let consecutiveRepriceAttempts = 0;
      let lastRepriceApiErrorCode = null;
      let previousAcknowledgedInputs = null;
      let maxOpenOrdersRecoveryAttempts = 0;
      while (done < plan.orders.length) {
        throwIfAborted(abortSignal);
        if (ladderStopRequested) break;
        const order = plan.orders[done];
        try {
          assertLadderExecutionContext(plan);
          if (!await ensurePostOnlyOrderType()) throw new Error("执行中只做 Maker 已失效，请刷新页面后重试");
          throwIfAborted(abortSignal);
          assertLadderExecutionContext(plan);
          assertLadderMakerPrice(plan, order.price);
          await waitForReadyLadderSubmitButton(plan);
          throwIfAborted(abortSignal);
          assertLadderExecutionContext(plan);
          assertLadderMakerPrice(plan, order.price);
          const currentPriceInput = findPriceInput();
          const currentQtyInput = findQtyInput();
          if (!currentPriceInput) {
            throw createContinuousRecoverableLadderError(
              "controls_not_ready",
              "执行中价格输入框已消失"
            );
          }
          if (!currentQtyInput) {
            throw createContinuousRecoverableLadderError(
              "controls_not_ready",
              "执行中数量输入框已消失"
            );
          }
          const synchronizedInputs = await syncTradeInputs(order.price, order.qty, {
            priceLabel: "计划价",
            qtyLabel: "计划量",
            settleControlledForm: true,
            previousSubmittedInputs: previousAcknowledgedInputs
          });
          throwIfAborted(abortSignal);
          const submittedPrice = synchronizedInputs.submittedPrice;
          assertLadderExecutionContext(plan);
          assertLadderMakerPrice(plan, submittedPrice);
          const button = await waitForReadyLadderSubmitButton(plan);
          throwIfAborted(abortSignal);
          assertLadderExecutionContext(plan);
          assertSubmittedPriceMatchesExpectedPrice(
            order.price,
            findPriceInput()?.value || "",
            "计划价"
          );
          assertSubmittedQtyMatchesExpectedQty(
            order.qty,
            findQtyInput()?.value || "",
            "计划量"
          );
          if (!CFG.SAFE_MODE) {
            const previousFeedback = takeOrderFeedbackSnapshot();
            const submitCaptureId = beginLadderSubmitResponseCapture();
            try {
              throwIfAborted(abortSignal);
              button.click();
              setExecutionStatus(
                localizedActionStatus(
                  plan.spec.statusLabel,
                  `挂单 ${done + 1}/${plan.orders.length} 确认中`,
                  ` order ${done + 1}/${plan.orders.length} confirming`
                ),
                localizedText(
                  `第 ${done + 1} 笔确认中`,
                  `Order ${done + 1} confirming`
                )
              );
              waitForTradeUiMutation({ timeoutMs: 500 });
              await waitForOrderSubmitAcknowledgement(
                button,
                plan.spec.label,
                previousFeedback,
                submitCaptureId,
                plan.spec.mode,
                abortSignal
              );
            } finally {
              endLadderSubmitResponseCapture(submitCaptureId);
            }
            previousAcknowledgedInputs = {
              submittedPrice: synchronizedInputs.submittedPrice,
              submittedQty: synchronizedInputs.submittedQty
            };
          }
        } catch (e) {
          if (isRecoverableMaxOpenOrdersFailure(
            plan,
            e,
            options?.allowMaxOpenOrdersRecovery
          )) {
            if (maxOpenOrdersRecoveryAttempts > 0) {
              throw createContinuousRoundRecoveryError(
                "order_capacity_not_ready",
                "已释放挂单名额，但本轮仍达到最大下单限制"
              );
            }
            maxOpenOrdersRecoveryAttempts += 1;
            const recovery = await cancelCurrentSymbolOpenOrdersForPlan(
              plan,
              progress,
              setExecutionStatus,
              abortSignal,
              { strategy: "farthest_for_capacity" }
            );
            throwIfAborted(abortSignal);
            if (!recovery?.ok) {
              const message = recovery?.message || "未能释放挂单名额";
              if (["symbol_changed", "dialog_not_closed"].includes(recovery?.status)) {
                throw new Error(message);
              }
              throw createContinuousRoundRecoveryError(
                "order_capacity_not_ready",
                message
              );
            }
            continue;
          }
          if (!isRetryableLadderMakerPriceFailure(plan, e)) throw e;
          if (isBinancePostOnlyMakerRejectCode(e?.binanceCode)) {
            lastRepriceApiErrorCode = e.binanceCode;
          }
          repriceAttempts += 1;
          consecutiveRepriceAttempts += 1;
          const shouldPause = consecutiveRepriceAttempts >= LADDER_REPRICE_PAUSE_EVERY_ATTEMPTS;
          const remainingLevels = plan.orders.length - done;
          const repriceDetail = shouldPause ? localizedText(
            `盘口持续移动，3s 后继续 · 剩余 ${remainingLevels} 档 · 已刷新 ${repriceAttempts} 次`,
            `Order book keeps moving; continue in 3s · ${remainingLevels} remaining · Refreshed ${repriceAttempts} times`
          ) : localizedText(
            `盘口已移动，刷新剩余 ${remainingLevels} 档 · 已刷新 ${repriceAttempts} 次`,
            `Order book moved; refreshing ${remainingLevels} remaining · Refreshed ${repriceAttempts} times`
          );
          setExecutionStatus(
            combineLocalizedText([plan.spec.statusLabel, repriceDetail], "："),
            repriceDetail
          );
          await waitForPromiseOrAbort(
            delay(shouldPause ? LADDER_REPRICE_PAUSE_MS : LADDER_REPRICE_DELAY_MS),
            abortSignal
          );
          throwIfAborted(abortSignal);
          if (ladderStopRequested) break;
          refreshRemainingLadderOrders(plan, done);
          if (shouldPause) consecutiveRepriceAttempts = 0;
          continue;
        }
        done++;
        consecutiveRepriceAttempts = 0;
        recordLadderSubmittedOrder(progress);
        setExecutionStatus(localizedActionStatus(
          plan.spec.statusLabel,
          `已挂 ${done}/${plan.orders.length} 笔`,
          ` placed ${done}/${plan.orders.length}`
        ), null);
        throwIfAborted(abortSignal);
      }
      return { done, repriceAttempts, lastRepriceApiErrorCode };
    }
    async function startLadder(actionType, continuousProgress = null) {
      const spec = getLadderActionSpec2(actionType);
      if (!spec) {
        setLadderStatus("未知阶梯动作");
        return { status: "not_started" };
      }
      const continuousSession = continuousProgress !== null;
      const setStartStatus = (singleStatus, continuousDetail) => {
        setLadderStatus(
          continuousSession ? combineLocalizedText([localizedContinuousAction(spec.statusLabel), continuousDetail], " · ") : singleStatus
        );
      };
      const actionSymbol = getCurrentSymbol();
      if (!isCurrentObservedSymbol(actionSymbol)) {
        setStartStatus(
          localizedActionStatus(spec.statusLabel, "尚未开始：交易对正在切换", " not started: symbol is changing"),
          localizedText("尚未开始 · 交易对正在切换", "Not started · Symbol is changing")
        );
        return { status: "not_started" };
      }
      if (cancelCurrentSymbolOpenOrdersTask) {
        setStartStatus(
          localizedActionStatus(spec.statusLabel, "尚未开始：撤单处理中", " not started: cancelling orders"),
          localizedText("尚未开始 · 撤单处理中", "Not started · Cancelling orders")
        );
        return { status: "not_started" };
      }
      if (singleOrderTask) {
        return { status: "not_started" };
      }
      if (ladderTask) {
        setStartStatus(
          localizedActionStatus(spec.statusLabel, "尚未开始：已有阶梯任务正在执行，请先停止", " not started: another ladder is running; stop it first"),
          localizedText("尚未开始 · 已有阶梯任务正在执行，请先停止", "Not started · Another ladder is running; stop it first")
        );
        return { status: "not_started" };
      }
      if (continuousLadderTask && !continuousSession) {
        setLadderStatus(localizedActionStatus(
          spec.statusLabel,
          "尚未开始：连续交易正在运行，请先停止",
          " not started: continuous trading is running; stop it first"
        ));
        return { status: "not_started" };
      }
      if (spec?.mode === "CLOSE" && !isCloseSnapshotReady(actionSymbol)) {
        setStartStatus(
          localizedActionStatus(spec.statusLabel, "尚未开始：仓位确认中", " not started: confirming positions"),
          localizedText("尚未开始 · 仓位确认中", "Not started · Confirming positions")
        );
        return { status: "not_started" };
      }
      ladderStopRequested = false;
      const abortController = new AbortController();
      const progress = createLadderProgress();
      const setExecutionStatus = (singleStatus, continuousDetail) => {
        if (continuousSession) {
          setLadderStatus(formatActiveContinuousLadderProgress(
            spec.statusLabel,
            continuousDetail,
            continuousProgress,
            progress
          ));
          return;
        }
        setLadderStatus(singleStatus);
      };
      invalidateUsdtRebalanceEligibility();
      ladderAbortController = abortController;
      activeLadderActionType = actionType;
      if (continuousSession) activeContinuousLadderRoundProgress = progress;
      activeLadderPanelContext = {
        mode: spec.mode,
        symbol: actionSymbol,
        precision: readCurrentOrderbookPrecisionValue()
      };
      const feedbackStartedAt = performance.now();
      setExecutionStatus(
        localizedActionStatus(spec.statusLabel, "准备中", " preparing"),
        localizedText("准备中", "Preparing")
      );
      const executionTask = (async () => {
        const {
          plan,
          done,
          repriceAttempts,
          lastRepriceApiErrorCode
        } = await runLadderPlanWithOpenOrderReplacement(
          actionType,
          progress,
          setExecutionStatus,
          abortController.signal,
          { allowMaxOpenOrdersRecovery: continuousSession && spec.mode === "CLOSE" }
        );
        return {
          plan,
          done,
          repriceAttempts,
          lastRepriceApiErrorCode,
          wasStopped: ladderStopRequested
        };
      })();
      ladderTask = keepInteractionFeedbackVisible(executionTask, {
        startedAtMs: feedbackStartedAt,
        minimumMs: LADDER_ACTION_FEEDBACK_MIN_MS,
        now: () => performance.now(),
        delay
      }).then(({
        plan,
        done,
        repriceAttempts,
        lastRepriceApiErrorCode,
        wasStopped
      }) => {
        if (!isCurrentObservedSymbol(actionSymbol)) {
          if (!continuousSession) {
            setLadderStatus(formatInterruptedLadderProgress(
              spec.statusLabel,
              localizedText("交易对已切换", "Symbol changed"),
              progress
            ));
          }
          return {
            status: "interrupted",
            reason: "交易对已切换",
            progress: snapshotLadderProgress(progress)
          };
        }
        const diagnostics = formatLadderRepriceDiagnostics(repriceAttempts, lastRepriceApiErrorCode);
        if (!continuousSession) {
          setLadderStatus(
            wasStopped ? combineLocalizedText([formatStoppedLadderProgress(spec.statusLabel, progress), diagnostics]) : combineLocalizedText([formatCompletedLadderProgress(
              spec.statusLabel,
              done,
              plan.orders.length,
              progress
            ), diagnostics])
          );
        }
        return {
          status: wasStopped ? "stopped" : "completed",
          progress: snapshotLadderProgress(progress)
        };
      }).catch(async (e) => {
        if (isLadderStoppedError(e)) {
          if (!continuousSession && isCurrentObservedSymbol(actionSymbol)) {
            setLadderStatus(formatStoppedLadderProgress(spec.statusLabel, progress));
          }
          return {
            status: "stopped",
            progress: snapshotLadderProgress(progress)
          };
        }
        if (isClosePositionCompletedError(e)) {
          if (!continuousSession && isCurrentObservedSymbol(actionSymbol)) {
            setLadderStatus(formatPositionClosedLadderProgress(spec.statusLabel, progress));
          }
          return {
            status: "position_closed",
            reason: e.message,
            progress: snapshotLadderProgress(progress)
          };
        }
        if (spec.mode === "CLOSE" && e?.safeNoSubmit === true && e.skipImmediateCloseRecheck !== true) {
          try {
            await throwIfClosePositionCompleted(
              { spec, symbol: actionSymbol },
              abortController.signal
            );
          } catch (positionError) {
            if (isClosePositionCompletedError(positionError)) {
              if (!continuousSession && isCurrentObservedSymbol(actionSymbol)) {
                setLadderStatus(formatPositionClosedLadderProgress(spec.statusLabel, progress));
              }
              return {
                status: "position_closed",
                reason: positionError.message,
                progress: snapshotLadderProgress(progress)
              };
            }
            err("安全失败后确认当前方向持仓失败:", positionError);
          }
        }
        err("Maker 阶梯执行失败:", e);
        if (!isCurrentObservedSymbol(actionSymbol)) {
          if (!continuousSession) {
            setLadderStatus(formatInterruptedLadderProgress(
              spec.statusLabel,
              localizedText("交易对已切换", "Symbol changed"),
              progress
            ));
          }
          return {
            status: "interrupted",
            reason: "交易对已切换",
            progress: snapshotLadderProgress(progress)
          };
        }
        const failureMessage = localizeKnownUiStatus(
          e?.localizedText || e?.message || localizedText("未知错误", "Unknown error")
        );
        const failureText = formatFailedLadderProgress(spec.statusLabel, failureMessage, progress);
        const failureTitle = e?.statusTitle ? formatFailedLadderProgress(
          spec.statusLabel,
          localizeKnownUiStatus(e.localizedStatusTitle || e.statusTitle),
          progress
        ) : failureText;
        if (!continuousSession) setLadderStatus(failureText, failureTitle);
        return {
          status: "failed",
          error: e,
          reason: failureMessage,
          titleReason: e?.localizedStatusTitle || e?.statusTitle || failureMessage,
          progress: snapshotLadderProgress(progress)
        };
      }).finally(() => {
        if (ladderAbortController === abortController) ladderAbortController = null;
        if (activeContinuousLadderRoundProgress === progress) {
          activeContinuousLadderRoundProgress = null;
        }
        ladderTask = null;
        activeLadderActionType = null;
        activeLadderPanelContext = null;
        ladderStopRequested = false;
        scheduleRenderPanel();
      });
      scheduleRenderPanel();
      return await ladderTask;
    }
    async function readContinuousLadderReadiness(actionType, actionSymbol, positionCheckState) {
      const spec = getLadderActionSpec2(actionType);
      if (!spec || spec.mode !== "CLOSE") {
        throw new Error("连续交易仅支持阶梯平仓");
      }
      if (!isCurrentObservedSymbol(actionSymbol)) {
        return { status: "stopped", reason: "symbol_changed" };
      }
      if (getActiveTradeMode() !== spec.mode) {
        return { status: "stopped", reason: "mode_changed" };
      }
      if (document.hidden || ladderTask || singleOrderTask || cancelCurrentSymbolOpenOrdersTask || !readCurrentOrderbookPrecisionValue()) {
        return { status: "waiting" };
      }
      const button = spec.buttonGetter();
      if (!isCloseSnapshotReady(actionSymbol) || !button || !button.isConnected || !isVisibleElement(button) || isSubmitButtonBusy(button)) {
        const now = Date.now();
        const retryAt = positionCheckState.retryAt || 0;
        if (now >= retryAt && now - positionCheckState.checkedAt >= CONTINUOUS_CLOSE_POSITION_CHECK_MS) {
          positionCheckState.checkedAt = now;
          try {
            await throwIfClosePositionCompleted({ spec, symbol: actionSymbol });
            positionCheckState.retryAt = 0;
          } catch (error) {
            if (isClosePositionCompletedError(error)) throw error;
            const recovery = resolveContinuousLadderRecovery(error);
            if (!recovery) throw error;
            positionCheckState.retryAt = Date.now() + recovery.cooldownMs;
          }
        }
        return { status: "waiting" };
      }
      return { status: "ready" };
    }
    function getContinuousLadderStopReason(reason) {
      const reasonTextByCode = {
        symbol_changed: localizedText("交易对已切换", "Symbol changed"),
        mode_changed: localizedText("开仓/平仓模式已切换", "Trade mode changed")
      };
      const reasonText = reasonTextByCode[reason];
      if (!reasonText) throw new Error(`未知连续交易停止原因：${reason}`);
      return reasonText;
    }
    function setContinuousLadderProgressStatus(label, phase, progress, reason = null, titleReason = reason) {
      setLadderStatus(
        formatContinuousLadderProgress(label, phase, progress, reason),
        formatContinuousLadderProgress(label, phase, progress, titleReason)
      );
    }
    async function startContinuousLadder(actionType) {
      const spec = getLadderActionSpec2(actionType);
      if (!spec || spec.mode !== "CLOSE") return startLadder(actionType);
      if (continuousLadderTask) return continuousLadderTask;
      const actionSymbol = getCurrentSymbol();
      if (!isCurrentObservedSymbol(actionSymbol)) {
        setLadderStatus(localizedActionStatus(
          spec.statusLabel,
          "尚未开始：交易对正在切换",
          " not started: symbol is changing"
        ));
        return { status: "not_started" };
      }
      const abortController = new AbortController();
      const continuousProgress = createContinuousLadderProgress();
      const positionCheckState = { checkedAt: Date.now(), retryAt: 0 };
      continuousLadderAbortController = abortController;
      activeContinuousLadderActionType = actionType;
      activeContinuousLadderProgress = continuousProgress;
      const executionTask = (async () => {
        while (true) {
          throwIfAborted(abortController.signal);
          const outcome = await startLadder(actionType, continuousProgress);
          let recovery = null;
          if (!outcome?.progress) {
            if (outcome.status !== "not_started") return outcome;
            recovery = {
              cooldownMs: 3e3,
              reason: localizedText("等待交易页面就绪", "Waiting for the trading page")
            };
          } else {
            recordContinuousLadderRound(continuousProgress, outcome);
            if (outcome.status === "position_closed") {
              setLadderStatus(formatContinuousLadderPositionClosedProgress(
                spec.statusLabel,
                continuousProgress
              ));
              return outcome;
            }
            recovery = outcome.status === "completed" ? null : resolveContinuousLadderRecovery(outcome.error);
            if (outcome.status !== "completed" && !recovery) {
              setContinuousLadderProgressStatus(
                spec.statusLabel,
                outcome.status,
                continuousProgress,
                outcome.reason || null,
                outcome.titleReason || outcome.reason || null
              );
              return outcome;
            }
            if (!recovery) {
              setContinuousLadderProgressStatus(spec.statusLabel, "running", continuousProgress);
            }
          }
          const readiness = await waitForContinuousLadderNextRound({
            readReadiness: async () => {
              try {
                return await readContinuousLadderReadiness(
                  actionType,
                  actionSymbol,
                  positionCheckState
                );
              } catch (error) {
                if (isClosePositionCompletedError(error)) {
                  return { status: "stopped", reason: "position_flat" };
                }
                throw error;
              }
            },
            delay,
            signal: abortController.signal,
            cooldownMs: recovery?.cooldownMs,
            onWaitStateChange: ({ phase, cooldownMs }) => {
              const waitStatus = formatContinuousLadderWaitProgress(
                spec.statusLabel,
                continuousProgress,
                phase,
                cooldownMs
              );
              setLadderStatus(recovery ? combineLocalizedText([waitStatus, recovery.reason], " · ") : waitStatus);
            }
          });
          if (readiness.status === "stopped") {
            if (readiness.reason === "position_flat") {
              setLadderStatus(formatContinuousLadderPositionClosedProgress(
                spec.statusLabel,
                continuousProgress
              ));
              return { status: "position_closed", reason: "当前方向已无持仓" };
            }
            setContinuousLadderProgressStatus(
              spec.statusLabel,
              "stopped",
              continuousProgress,
              getContinuousLadderStopReason(readiness.reason)
            );
            return readiness;
          }
          continue;
        }
      })();
      continuousLadderTask = executionTask.catch((e) => {
        if (isLadderStoppedError(e)) {
          setContinuousLadderProgressStatus(spec.statusLabel, "stopped", continuousProgress);
          return { status: "stopped" };
        }
        err("连续阶梯交易失败:", e);
        setContinuousLadderProgressStatus(
          spec.statusLabel,
          "failed",
          continuousProgress,
          localizeKnownUiStatus(e?.localizedText || e?.message || localizedText("未知错误", "Unknown error")),
          localizeKnownUiStatus(e?.localizedStatusTitle || e?.statusTitle || e?.localizedText || e?.message || localizedText("未知错误", "Unknown error"))
        );
        return { status: "failed", error: e };
      }).finally(() => {
        if (continuousLadderAbortController === abortController) {
          continuousLadderAbortController = null;
        }
        continuousLadderTask = null;
        activeContinuousLadderActionType = null;
        activeContinuousLadderProgress = null;
        scheduleRenderPanel();
      });
      scheduleRenderPanel();
      return await continuousLadderTask;
    }
    function stopLadder() {
      if (!ladderTask && !continuousLadderTask) {
        setLadderStatus(PANEL_COPY.state.idle);
        return;
      }
      const activeActionType = activeLadderActionType || activeContinuousLadderActionType;
      const activeSpec = getLadderActionSpec2(activeActionType);
      if (!activeSpec) throw new Error("运行中的阶梯任务缺少动作类型");
      const stoppedError = createLadderStoppedError();
      if (continuousLadderAbortController && !continuousLadderAbortController.signal.aborted) {
        continuousLadderAbortController.abort(stoppedError);
      }
      if (ladderTask) {
        ladderStopRequested = true;
        if (ladderAbortController && !ladderAbortController.signal.aborted) {
          ladderAbortController.abort(stoppedError);
        }
        if (continuousLadderTask) {
          if (!activeContinuousLadderProgress || !activeContinuousLadderRoundProgress) {
            throw new Error("运行中的连续阶梯任务缺少轮次进度");
          }
          setLadderStatus(formatActiveContinuousLadderProgress(
            activeSpec.statusLabel,
            localizedText("停止中", "Stopping"),
            activeContinuousLadderProgress,
            activeContinuousLadderRoundProgress
          ));
        } else {
          setLadderStatus(localizedActionStatus(activeSpec.statusLabel, "停止中", " stopping"));
        }
      } else {
        setContinuousLadderProgressStatus(
          activeSpec.statusLabel,
          "stopping",
          activeContinuousLadderProgress
        );
      }
      scheduleRenderPanel();
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
    function getAccountOrdersTabIdentity2(tab) {
      return getAccountOrdersTabIdentity(tab);
    }
    function findAccountOrdersTabByIdentity2(identity) {
      return findAccountOrdersTabByIdentity(document, identity, { isVisibleElement });
    }
    function getAccountOrdersObservationRoot() {
      const tab = findOpenOrdersTab2();
      const tabGroup = getAccountOrdersTabGroup2(tab);
      return tabGroup?.closest(".react-grid-item") || tabGroup?.parentElement || null;
    }
    function waitForAccountOrdersState(readState, timeoutMs, abortSignal = null) {
      const observationRoot = getAccountOrdersObservationRoot() || document.body;
      return waitForAccountOrdersMutationState(
        observationRoot,
        readState,
        timeoutMs,
        abortSignal
      );
    }
    async function activateOpenOrdersTab(abortSignal = null) {
      throwIfAborted(abortSignal);
      const tab = findOpenOrdersTab2();
      if (!tab) return false;
      if (tab.getAttribute("aria-selected") === "true") return true;
      throwIfAborted(abortSignal);
      tab.click();
      const activeTab = await waitForAccountOrdersState(() => {
        const freshTab = findOpenOrdersTab2();
        return freshTab?.getAttribute("aria-selected") === "true" ? freshTab : null;
      }, 2200, abortSignal);
      return Boolean(activeTab);
    }
    async function restoreAccountOrdersTab(previousTabIdentity, symbol = null) {
      if (symbol && !isCurrentObservedSymbol(symbol)) return false;
      if (!previousTabIdentity) return true;
      const previousTab = findAccountOrdersTabByIdentity2(previousTabIdentity);
      if (!previousTab) return false;
      if (previousTab.getAttribute("aria-selected") === "true") return true;
      if (symbol && !isCurrentObservedSymbol(symbol)) return false;
      previousTab.click();
      const restoredTab = await waitForAccountOrdersState(() => {
        if (symbol && !isCurrentObservedSymbol(symbol)) return null;
        const freshTab = findAccountOrdersTabByIdentity2(previousTabIdentity);
        return freshTab?.getAttribute("aria-selected") === "true" ? freshTab : null;
      }, 2200);
      return Boolean(restoredTab) && (!symbol || isCurrentObservedSymbol(symbol));
    }
    function getActiveOpenOrdersScope2() {
      return getActiveOpenOrdersScope(document, {
        isVisibleElement,
        findHideOtherSymbolCheckbox,
        findCurrentSymbolCancelAllButton
      });
    }
    function findOpenOrdersBasicSubTab2(root) {
      return findOpenOrdersBasicSubTab(root, { isVisibleElement });
    }
    function findOpenOrdersConditionalSubTab2(root) {
      return findOpenOrdersConditionalSubTab(root, { isVisibleElement });
    }
    function findSelectedOpenOrdersSubTab2(root) {
      return findSelectedOpenOrdersSubTab(root, { isVisibleElement });
    }
    function getOpenOrdersSubTabIdentity2(tab) {
      return getOpenOrdersSubTabIdentity(tab);
    }
    function findOpenOrdersSubTabByIdentity2(root, identity) {
      return findOpenOrdersSubTabByIdentity(root, identity, { isVisibleElement });
    }
    async function waitForActiveOpenOrdersScope(abortSignal = null) {
      return waitForAccountOrdersState(
        () => getActiveOpenOrdersScope2(),
        2200,
        abortSignal
      );
    }
    async function activateOpenOrdersBasicSubTab(root, abortSignal = null) {
      throwIfAborted(abortSignal);
      const previousSubTabIdentity = getOpenOrdersSubTabIdentity2(findSelectedOpenOrdersSubTab2(root));
      const basicTab = findOpenOrdersBasicSubTab2(root);
      if (!basicTab) {
        return {
          ready: !findOpenOrdersConditionalSubTab2(root),
          previousSubTabIdentity
        };
      }
      if (basicTab.getAttribute("aria-selected") === "true") {
        return { ready: true, previousSubTabIdentity };
      }
      throwIfAborted(abortSignal);
      basicTab.click();
      const selectedBasicTab = await waitForAccountOrdersState(() => {
        const scope = getActiveOpenOrdersScope2();
        const freshBasicTab = scope ? findOpenOrdersBasicSubTab2(scope) : null;
        return freshBasicTab?.getAttribute("aria-selected") === "true" ? freshBasicTab : null;
      }, 2200, abortSignal);
      return {
        ready: Boolean(selectedBasicTab),
        previousSubTabIdentity
      };
    }
    async function restoreOpenOrdersSubTab(previousSubTabIdentity, symbol = null) {
      if (symbol && !isCurrentObservedSymbol(symbol)) return false;
      if (!previousSubTabIdentity) return true;
      const scope = getActiveOpenOrdersScope2();
      const previousSubTab = scope ? findOpenOrdersSubTabByIdentity2(scope, previousSubTabIdentity) : null;
      if (!previousSubTab) return false;
      if (previousSubTab.getAttribute("aria-selected") === "true") return true;
      if (symbol && !isCurrentObservedSymbol(symbol)) return false;
      previousSubTab.click();
      const restoredSubTab = await waitForAccountOrdersState(() => {
        if (symbol && !isCurrentObservedSymbol(symbol)) return null;
        const freshScope = getActiveOpenOrdersScope2();
        const freshSubTab = freshScope ? findOpenOrdersSubTabByIdentity2(freshScope, previousSubTabIdentity) : null;
        return freshSubTab?.getAttribute("aria-selected") === "true" ? freshSubTab : null;
      }, 2200);
      return Boolean(restoredSubTab) && (!symbol || isCurrentObservedSymbol(symbol));
    }
    function findCurrentSymbolCancelAllButton(root) {
      if (!root) return null;
      const buttons = Array.from(root.querySelectorAll('[class~="cursor-pointer"]')).filter(isVisibleElement).filter((element) => isBinanceCancelAllText(getNormalizedText2(element)));
      if (buttons.length !== 1) return null;
      const [button] = buttons;
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
        cancelAllAvailable: Boolean(cancelAllButton)
      });
    }
    async function waitForCurrentSymbolOpenOrders(symbol) {
      const readEvidence = ({ final = false } = {}) => {
        if (!isCurrentObservedSymbol(symbol)) {
          return { hasOrders: false, cancelAllButton: null };
        }
        const currentRoot = getActiveOpenOrdersScope2();
        const cancelAllButton = findCurrentSymbolCancelAllButton(currentRoot);
        const filterChecked = getCheckboxCheckedState(findHideOtherSymbolCheckbox(currentRoot));
        if (isFilteredCurrentSymbolOpenOrdersEmpty({
          scopeText: currentRoot?.textContent || "",
          symbol,
          filterChecked,
          cancelAllAvailable: Boolean(cancelAllButton)
        })) {
          return { hasOrders: false, cancelAllButton: null };
        }
        if (hasCurrentSymbolOpenOrders(currentRoot, symbol, filterChecked === true, cancelAllButton)) {
          return { hasOrders: true, cancelAllButton };
        }
        if (filterChecked === true && isOpenOrdersScopeConfirmedForSymbol(currentRoot, symbol) && isCurrentSymbolOpenOrdersDefinitivelyClear({
          scopeText: currentRoot?.textContent || "",
          symbol,
          openOrdersCount: getOpenOrdersTabCount()
        })) {
          return { hasOrders: false, cancelAllButton: null };
        }
        return final ? {
          hasOrders: hasCurrentSymbolOpenOrders(
            currentRoot,
            symbol,
            filterChecked === true,
            cancelAllButton
          ),
          cancelAllButton
        } : null;
      };
      const evidence = await waitForAccountOrdersState(readEvidence, 1600);
      return evidence || readEvidence({ final: true });
    }
    function isOpenOrdersScopeConfirmedForSymbol(root, symbol) {
      const checkbox = findHideOtherSymbolCheckbox(root);
      return isOpenOrdersScopeConfirmedForSymbolText(
        root?.textContent || "",
        symbol,
        getCheckboxCheckedState(checkbox)
      );
    }
    async function waitForCurrentSymbolOpenOrdersCleared(root, symbol) {
      const deadline = Date.now() + LADDER_REPLACE_OPEN_ORDERS_CLEAR_TIMEOUT_MS;
      let currentRoot = root;
      let clearCandidateSince = null;
      let lastStatus = currentRoot ? "symbol_filter_not_confirmed" : "scope_not_found";
      const observationRoot = getAccountOrdersObservationRoot() || document.body;
      const mutationSignal = createAccountOrdersMutationSignal(observationRoot);
      if (!mutationSignal) throw new Error("当前委托状态无法观察，已停止");
      try {
        while (true) {
          const observedVersion = mutationSignal.version;
          if (!isCurrentObservedSymbol(symbol)) {
            return { ok: false, status: "symbol_changed", root: currentRoot };
          }
          const refreshedRoot = getActiveOpenOrdersScope2();
          currentRoot = refreshedRoot;
          let clearCandidate = false;
          if (!currentRoot) {
            clearCandidateSince = null;
            lastStatus = "scope_not_found";
          } else if (!isOpenOrdersScopeConfirmedForSymbol(currentRoot, symbol)) {
            clearCandidateSince = null;
            lastStatus = "symbol_filter_not_confirmed";
          } else {
            lastStatus = "not_cleared";
            const openOrdersCount = getOpenOrdersTabCount();
            const scopeText = currentRoot.textContent || "";
            clearCandidate = isCurrentSymbolOpenOrdersClearCandidate({
              scopeText,
              symbol,
              openOrdersCount
            });
            if (isCurrentSymbolOpenOrdersDefinitivelyClear({
              scopeText,
              symbol,
              openOrdersCount
            })) {
              return {
                ok: true,
                status: "cleared",
                root: currentRoot,
                definitivelyCleared: true
              };
            }
            const stability = updateOpenOrdersClearStability({
              clearCandidate,
              clearCandidateSince,
              nowMs: Date.now(),
              settleMs: CANCEL_OPEN_ORDERS_CLEAR_SETTLE_MS
            });
            clearCandidateSince = stability.clearCandidateSince;
            if (stability.cleared) {
              return {
                ok: true,
                status: "cleared",
                root: currentRoot,
                definitivelyCleared: false
              };
            }
          }
          const nowMs = Date.now();
          if (!shouldContinueOpenOrdersClearObservation({
            nowMs,
            deadlineMs: deadline,
            clearCandidate
          })) break;
          const nextCheckAt = clearCandidate && clearCandidateSince !== null ? clearCandidateSince + CANCEL_OPEN_ORDERS_CLEAR_SETTLE_MS : deadline;
          await mutationSignal.waitForChange(
            observedVersion,
            Math.max(0, nextCheckAt - nowMs)
          );
        }
      } finally {
        mutationSignal.dispose();
      }
      if (!isCurrentObservedSymbol(symbol)) {
        return { ok: false, status: "symbol_changed", root: currentRoot };
      }
      return { ok: false, status: lastStatus, root: currentRoot };
    }
    function findOpenOrderRowCells(row) {
      return getOpenOrderRowCells(row, { isVisibleElement });
    }
    function findOpenOrderRowCancelButton(row) {
      const icon = Array.from(row.querySelectorAll("svg[aria-label]")).find((candidate) => matchesBinancePageText(
        candidate.getAttribute("aria-label"),
        BINANCE_PAGE_TEXT.accountOrders.rowCancel
      ));
      if (!icon || !isVisibleElement(icon)) return null;
      const target = icon.closest('button, [role="button"], a, [tabindex]') || icon;
      if (!target || !row.contains(target) || !isVisibleElement(target)) return null;
      if (target.disabled || target.getAttribute("aria-disabled") === "true") return null;
      return target;
    }
    function clickDomTarget(target) {
      if (!target || !target.isConnected || !isVisibleElement(target)) return false;
      if (typeof target.click === "function") {
        target.click();
        return true;
      }
      return target.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window
      }));
    }
    function createOpenOrderCancellationUnconfirmedError(message) {
      const error = new Error(message);
      error.name = "OpenOrderCancellationUnconfirmedError";
      return error;
    }
    function isOpenOrderCancellationUnconfirmedError(error) {
      return error?.name === "OpenOrderCancellationUnconfirmedError";
    }
    function getOpenOrderRowKey(cells, row) {
      const cellText = cells.slice(0, 10).map((cell) => (cell.textContent || "").replace(/\s+/g, " ").trim()).join("|");
      return cellText || (row.textContent || "").replace(/\s+/g, " ").trim();
    }
    function readOpenOrderRowElements(root) {
      return findOpenOrderRowElements(root, {
        isVisibleElement,
        isRowCancelIcon: (icon) => matchesBinancePageText(
          icon.getAttribute("aria-label"),
          BINANCE_PAGE_TEXT.accountOrders.rowCancel
        )
      });
    }
    function readCurrentSymbolOpenOrderRows(root, symbol, plan = null) {
      if (!root || !symbol) return [];
      return readOpenOrderRowElements(root).map((row) => {
        const cells = findOpenOrderRowCells(row);
        const symbolText = (cells[1]?.textContent || "").replace(/\s+/g, " ").trim();
        const sideText = (cells[3]?.textContent || "").replace(/\s+/g, " ").trim();
        const price = normalizeDecimalString((cells[4]?.textContent || "").replace(/,/g, "").trim());
        const qty = normalizeDecimalString((cells[5]?.textContent || "").replace(/,/g, "").match(/\d+(?:\.\d+)?/)?.[0] || "");
        const cancelButton = findOpenOrderRowCancelButton(row);
        return {
          root,
          row,
          cells,
          symbolText,
          sideText,
          price,
          qty,
          cancelButton,
          key: getOpenOrderRowKey(cells, row)
        };
      }).filter((row) => isOpenOrderRowCurrentSymbol(row.symbolText, symbol) && isOpenOrderRowForPlan(row.sideText, plan) && row.price && isPositiveDecimalString(row.price) && row.qty && isPositiveDecimalString(row.qty) && row.cancelButton);
    }
    function isOpenOrderRowCurrentSymbol(symbolText, symbol) {
      const tokens = String(symbolText || "").toUpperCase().match(/[A-Z0-9_]+/g) || [];
      return tokens.includes(String(symbol || "").toUpperCase());
    }
    function isOpenOrderRowForPlan(sideText, plan) {
      if (!plan) return true;
      if (plan.spec?.mode === "OPEN" && plan.spec.side === "LONG") {
        return includesCompactBinancePageText(sideText, BINANCE_PAGE_TEXT.tradeAction.OPEN_LONG);
      }
      if (plan.spec?.mode === "OPEN" && plan.spec.side === "SHORT") {
        return includesCompactBinancePageText(sideText, BINANCE_PAGE_TEXT.tradeAction.OPEN_SHORT);
      }
      if (plan.spec?.mode === "CLOSE" && plan.spec.side === "LONG") {
        return includesCompactBinancePageText(sideText, BINANCE_PAGE_TEXT.tradeAction.CLOSE_LONG);
      }
      if (plan.spec?.mode === "CLOSE" && plan.spec.side === "SHORT") {
        return includesCompactBinancePageText(sideText, BINANCE_PAGE_TEXT.tradeAction.CLOSE_SHORT);
      }
      return false;
    }
    function readCurrentSymbolOpenOrderRowsState(root, symbol, plan = null) {
      const currentRoot = getActiveOpenOrdersScope2() || root;
      if (!currentRoot) return null;
      const rows = readCurrentSymbolOpenOrderRows(currentRoot, symbol, plan);
      if (rows.length) return { root: currentRoot, rows, status: "matched" };
      const currentSymbolRows = readCurrentSymbolOpenOrderRows(currentRoot, symbol);
      if (currentSymbolRows.length) {
        return { root: currentRoot, rows: [], status: "other_direction" };
      }
      const checkbox = findHideOtherSymbolCheckbox(currentRoot);
      const cancelAllButton = findCurrentSymbolCancelAllButton(currentRoot);
      if (isFilteredCurrentSymbolOpenOrdersEmpty({
        scopeText: currentRoot.textContent || "",
        symbol,
        filterChecked: getCheckboxCheckedState(checkbox),
        cancelAllAvailable: Boolean(cancelAllButton)
      })) {
        return { root: currentRoot, rows: [], status: "empty" };
      }
      return null;
    }
    async function waitForCurrentSymbolOpenOrderRows(root, symbol, plan = null, abortSignal = null) {
      let state = await waitForAccountOrdersState(
        () => readCurrentSymbolOpenOrderRowsState(root, symbol, plan),
        1600,
        abortSignal
      );
      if (state?.status !== "other_direction") return state?.rows || [];
      const transitioned = await waitForAccountOrdersState(() => {
        const nextState = readCurrentSymbolOpenOrderRowsState(root, symbol, plan);
        return nextState?.status !== "other_direction" ? nextState : null;
      }, LADDER_REPLACE_ROW_SETTLE_MS, abortSignal);
      state = transitioned || readCurrentSymbolOpenOrderRowsState(root, symbol, plan);
      return state?.rows || [];
    }
    function findOpenOrderRowsScrollContainer(root) {
      const firstRow = readOpenOrderRowElements(root)[0] || null;
      let candidate = firstRow?.parentElement || null;
      while (candidate && root.contains(candidate)) {
        if (candidate.scrollHeight > candidate.clientHeight + 2) return candidate;
        if (candidate === root) break;
        candidate = candidate.parentElement;
      }
      return null;
    }
    function scrollOpenOrderRowsToBottom(scrollContainer) {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
      scrollContainer.dispatchEvent(new Event("scroll", { bubbles: true }));
    }
    async function loadAllCurrentSymbolOpenOrderRows(root, symbol, plan, abortSignal = null) {
      const deadline = Date.now() + OPEN_ORDERS_LAZY_LOAD_TIMEOUT_MS;
      let stableEndPasses = 0;
      let currentRoot = root;
      while (Date.now() < deadline) {
        throwIfAborted(abortSignal);
        if (!isCurrentObservedSymbol(symbol)) throw new Error("加载待撤挂单时交易对已变化");
        currentRoot = getActiveOpenOrdersScope2() || currentRoot;
        if (!currentRoot) throw new Error("加载待撤挂单时当前委托面板已消失");
        const renderRemainingMs = deadline - Date.now();
        const renderState = await waitForAccountOrdersState(() => {
          const refreshedRoot = getActiveOpenOrdersScope2();
          if (!refreshedRoot || !isCurrentObservedSymbol(symbol)) return null;
          const settledState2 = readCurrentSymbolOpenOrderRowsState(refreshedRoot, symbol, plan);
          if (!settledState2) return null;
          return {
            root: refreshedRoot,
            settledState: settledState2,
            scrollContainer: findOpenOrderRowsScrollContainer(refreshedRoot)
          };
        }, Math.min(OPEN_ORDERS_LAZY_LOAD_SETTLE_MS, renderRemainingMs), abortSignal);
        if (!renderState) continue;
        currentRoot = renderState.root;
        const { settledState, scrollContainer } = renderState;
        if (!scrollContainer && settledState) return settledState.rows;
        const beforeCount = readOpenOrderRowElements(currentRoot).length;
        scrollOpenOrderRowsToBottom(scrollContainer);
        const growthRemainingMs = deadline - Date.now();
        if (growthRemainingMs <= 0) break;
        const growth = await waitForAccountOrdersState(() => {
          const refreshedRoot = getActiveOpenOrdersScope2();
          if (!refreshedRoot || !isCurrentObservedSymbol(symbol)) return null;
          const loadedCount = readOpenOrderRowElements(refreshedRoot).length;
          return loadedCount > beforeCount ? { root: refreshedRoot, loadedCount } : null;
        }, Math.min(OPEN_ORDERS_LAZY_LOAD_SETTLE_MS, growthRemainingMs), abortSignal);
        throwIfAborted(abortSignal);
        currentRoot = growth?.root || getActiveOpenOrdersScope2() || currentRoot;
        const afterCount = readOpenOrderRowElements(currentRoot).length;
        if (afterCount > beforeCount) {
          stableEndPasses = 0;
          continue;
        }
        if (afterCount < beforeCount) {
          stableEndPasses = 0;
          continue;
        }
        const refreshedScrollContainer = findOpenOrderRowsScrollContainer(currentRoot);
        const reachedBottom = !refreshedScrollContainer || refreshedScrollContainer.scrollTop + refreshedScrollContainer.clientHeight >= refreshedScrollContainer.scrollHeight - 2;
        stableEndPasses = reachedBottom ? stableEndPasses + 1 : 0;
        if (stableEndPasses >= 2) {
          return readCurrentSymbolOpenOrderRows(currentRoot, symbol, plan);
        }
      }
      throw new Error("当前委托完整列表 7 秒内未加载完成");
    }
    function readOpenOrdersDistanceReferencePrice() {
      const referencePrice = normalizeDecimalString(getLatestTradePrices()[0] || "");
      if (!referencePrice || !isPositiveDecimalString(referencePrice)) {
        throw new Error("未读取到当前成交价，无法选择最远挂单");
      }
      return referencePrice;
    }
    function selectOpenOrderRowsToCancelForPlan(plan, rows, options = null) {
      const { allowPartial = false } = options || {};
      const rowsToCancel = [];
      let cancelQty = "0";
      for (const row of rows) {
        if (!isOpenOrderRowForPlan(row.sideText, plan)) continue;
        rowsToCancel.push(row);
        cancelQty = addDecimalStrings(cancelQty, row.qty);
        if (compareDecimalStrings(cancelQty, plan.totalQty) >= 0) break;
      }
      return compareDecimalStrings(cancelQty, plan.totalQty) >= 0 || allowPartial && rowsToCancel.length > 0 ? rowsToCancel : [];
    }
    function getPlanDirectionLabel(plan) {
      if (plan?.spec?.mode === "OPEN" && plan.spec.side === "LONG") return "开多";
      if (plan?.spec?.mode === "OPEN" && plan.spec.side === "SHORT") return "开空";
      if (plan?.spec?.mode === "CLOSE" && plan.spec.side === "LONG") return "平多";
      if (plan?.spec?.mode === "CLOSE" && plan.spec.side === "SHORT") return "平空";
      return "";
    }
    function countOpenOrderRowsByKey(root, symbol, key) {
      return readCurrentSymbolOpenOrderRows(root, symbol).filter((row) => row.key === key).length;
    }
    function readOpenOrderRowCancellationOutcome(symbol, key, previousCount, dialogsBefore) {
      if (!isCurrentObservedSymbol(symbol)) return { status: "symbol_changed" };
      const dialog = findNewVisibleDialog(dialogsBefore);
      if (dialog) return { status: "dialog_open", dialog };
      const activeRoot = getActiveOpenOrdersScope2();
      if (activeRoot && countOpenOrderRowsByKey(activeRoot, symbol, key) < previousCount) {
        return { status: "row_removed" };
      }
      return null;
    }
    async function waitForOpenOrderRowCancellationOutcome(symbol, key, previousCount, dialogsBefore, abortSignal = null) {
      const deadline = Date.now() + LADDER_REPLACE_OPEN_ORDERS_CLEAR_TIMEOUT_MS;
      while (true) {
        throwIfAborted(abortSignal);
        const currentOutcome = readOpenOrderRowCancellationOutcome(
          symbol,
          key,
          previousCount,
          dialogsBefore
        );
        if (currentOutcome) return currentOutcome;
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) return { status: "timeout" };
        const observationRoot = getAccountOrdersObservationRoot() || document.body;
        const accountSignal = createAccountOrdersMutationSignal(observationRoot);
        const dialogSignal = createDialogMutationSignal(document);
        if (!accountSignal || !dialogSignal) {
          accountSignal?.dispose();
          dialogSignal?.dispose();
          throw new Error("撤单结果无法观察，已停止");
        }
        try {
          const observedAccountVersion = accountSignal.version;
          const observedDialogVersion = dialogSignal.version;
          const observedOutcome = readOpenOrderRowCancellationOutcome(
            symbol,
            key,
            previousCount,
            dialogsBefore
          );
          if (observedOutcome) return observedOutcome;
          await waitForPromiseOrAbort(
            Promise.race([
              accountSignal.waitForChange(observedAccountVersion, remainingMs),
              dialogSignal.waitForChange(observedDialogVersion, remainingMs)
            ]),
            abortSignal
          );
        } finally {
          accountSignal.dispose();
          dialogSignal.dispose();
        }
      }
    }
    async function confirmOpenOrderRowKeyCountBelow(symbol, key, previousCount, abortSignal = null) {
      const deadline = Date.now() + LADDER_REPLACE_ROW_SETTLE_MS;
      const observationRoot = getAccountOrdersObservationRoot() || document.body;
      const mutationSignal = createAccountOrdersMutationSignal(observationRoot);
      if (!mutationSignal) throw new Error("当前委托状态无法观察，已停止");
      try {
        while (true) {
          throwIfAborted(abortSignal);
          const observedVersion = mutationSignal.version;
          if (!isCurrentObservedSymbol(symbol)) return false;
          const activeRoot = getActiveOpenOrdersScope2();
          if (!activeRoot || countOpenOrderRowsByKey(activeRoot, symbol, key) >= previousCount) {
            return false;
          }
          const remainingMs = deadline - Date.now();
          if (remainingMs <= 0) return true;
          await waitForPromiseOrAbort(
            mutationSignal.waitForChange(observedVersion, remainingMs),
            abortSignal
          );
        }
      } finally {
        mutationSignal.dispose();
      }
    }
    async function waitForOpenOrderRowKeyCountBelow(symbol, key, previousCount, abortSignal = null) {
      const deadline = Date.now() + LADDER_REPLACE_OPEN_ORDERS_CLEAR_TIMEOUT_MS;
      const observationRoot = getAccountOrdersObservationRoot() || document.body;
      const mutationSignal = createAccountOrdersMutationSignal(observationRoot);
      if (!mutationSignal) throw new Error("当前委托状态无法观察，已停止");
      try {
        while (true) {
          throwIfAborted(abortSignal);
          const observedVersion = mutationSignal.version;
          if (!isCurrentObservedSymbol(symbol)) return false;
          const activeRoot2 = getActiveOpenOrdersScope2();
          if (activeRoot2 && countOpenOrderRowsByKey(activeRoot2, symbol, key) < previousCount) {
            return true;
          }
          const remainingMs = deadline - Date.now();
          if (remainingMs <= 0) break;
          await waitForPromiseOrAbort(
            mutationSignal.waitForChange(observedVersion, remainingMs),
            abortSignal
          );
        }
      } finally {
        mutationSignal.dispose();
      }
      const activeRoot = getActiveOpenOrdersScope2();
      return Boolean(activeRoot && countOpenOrderRowsByKey(activeRoot, symbol, key) < previousCount);
    }
    async function cancelOneOpenOrderRowForPlan(row, plan, progress, setExecutionStatus, abortSignal = null) {
      if (!isCurrentObservedSymbol(plan.symbol)) throw new Error("撤销待替换挂单前交易对已变化");
      const previousKeyCount = countOpenOrderRowsByKey(row.root, plan.symbol, row.key);
      if (!row.cancelButton?.isConnected || !isVisibleElement(row.cancelButton)) {
        if (previousKeyCount === 0) return { status: "already_removed", qty: row.qty };
        throw new Error("待替换挂单的撤单按钮已失效，已停止重新挂单");
      }
      const dialogsBefore = new Set(getVisibleDialogs());
      throwIfAborted(abortSignal);
      if (!clickDomTarget(row.cancelButton)) {
        throw new Error("待替换挂单的撤单按钮点击失败，已停止重新挂单");
      }
      waitForTradeUiMutation({ timeoutMs: 800 });
      const outcome = await waitForOpenOrderRowCancellationOutcome(
        plan.symbol,
        row.key,
        previousKeyCount,
        dialogsBefore,
        abortSignal
      );
      if (outcome.status === "symbol_changed") {
        throw new Error("撤销待替换挂单时交易对已变化");
      }
      if (outcome.status === "timeout") {
        throw createOpenOrderCancellationUnconfirmedError("待替换挂单仍存在，已停止重新挂单");
      }
      if (outcome.status === "dialog_open") {
        const { dialog } = outcome;
        setExecutionStatus(
          combineLocalizedText([
            plan.spec.statusLabel,
            localizedText("单行撤单确认弹窗已打开", "Single-order cancellation dialog opened")
          ], "："),
          localizedText("单行撤单确认弹窗已打开", "Single-order cancellation dialog opened")
        );
        const dialogClosed = await waitForDialogToClose(
          dialog,
          ROW_CANCEL_DIALOG_CLOSE_TIMEOUT_MS,
          abortSignal
        );
        if (!dialogClosed) {
          const error = new Error("单行撤单确认弹窗仍未关闭，未恢复页面状态");
          error.name = "DialogNotClosedError";
          throw error;
        }
        if (!await waitForOpenOrderRowKeyCountBelow(
          plan.symbol,
          row.key,
          previousKeyCount,
          abortSignal
        )) {
          throw createOpenOrderCancellationUnconfirmedError("待替换挂单仍存在，已停止重新挂单");
        }
      }
      throwIfAborted(abortSignal);
      if (!await confirmOpenOrderRowKeyCountBelow(
        plan.symbol,
        row.key,
        previousKeyCount,
        abortSignal
      )) {
        throw createOpenOrderCancellationUnconfirmedError("待替换挂单状态未稳定，已停止重新挂单");
      }
      recordLadderCancelledOrder(progress);
      return { status: "cancelled", qty: row.qty };
    }
    async function cancelOpenOrderRowsForPlan(root, plan, progress, setExecutionStatus, abortSignal = null) {
      let cancelQty = "0";
      let currentRoot = root;
      while (compareDecimalStrings(cancelQty, plan.totalQty) < 0) {
        throwIfAborted(abortSignal);
        if (!isCurrentObservedSymbol(plan.symbol)) throw new Error("撤销待替换挂单前交易对已变化");
        const remainingQty = subtractDecimalStrings(plan.totalQty, cancelQty);
        const refreshedRoot = getActiveOpenOrdersScope2();
        if (refreshedRoot) currentRoot = refreshedRoot;
        const rows = readCurrentSymbolOpenOrderRows(currentRoot, plan.symbol, plan);
        const row = selectOpenOrderRowsToCancelForPlan(
          { ...plan, totalQty: remainingQty },
          rows,
          { allowPartial: true }
        )[0];
        if (!row) {
          throw new Error("同向可撤挂单数量不足，已停止重新挂单");
        }
        currentRoot = row.root || currentRoot;
        const result = await cancelOneOpenOrderRowForPlan(
          row,
          plan,
          progress,
          setExecutionStatus,
          abortSignal
        );
        if (result.status === "already_removed") continue;
        cancelQty = addDecimalStrings(cancelQty, result.qty);
      }
      return { ok: true, cancelQty };
    }
    async function cancelFarthestOpenOrderRowsForPlan(root, plan, targets, progress, setExecutionStatus, abortSignal = null) {
      let releasedCount = 0;
      let cancelledCount = 0;
      let unconfirmedCount = 0;
      let currentRoot = root;
      for (const target of targets) {
        throwIfAborted(abortSignal);
        if (!isCurrentObservedSymbol(plan.symbol)) throw new Error("释放挂单名额时交易对已变化");
        currentRoot = getActiveOpenOrdersScope2() || currentRoot;
        let row = readCurrentSymbolOpenOrderRows(currentRoot, plan.symbol, plan).find((candidate) => candidate.key === target.key) || null;
        if (!row) {
          const completeRows = await loadAllCurrentSymbolOpenOrderRows(
            currentRoot,
            plan.symbol,
            plan,
            abortSignal
          );
          currentRoot = getActiveOpenOrdersScope2() || currentRoot;
          row = completeRows.find((candidate) => candidate.key === target.key) || null;
        }
        if (row) {
          try {
            const result = await cancelOneOpenOrderRowForPlan(
              row,
              plan,
              progress,
              setExecutionStatus,
              abortSignal
            );
            if (result.status === "cancelled") cancelledCount += 1;
          } catch (error) {
            if (!isOpenOrderCancellationUnconfirmedError(error)) throw error;
            unconfirmedCount += 1;
            const detail2 = localizedText(
              `已释放 ${releasedCount} 个挂单名额 · 当前撤单未确认，继续本轮`,
              `Freed ${releasedCount} order slots · Current cancellation unconfirmed; continuing this round`
            );
            setExecutionStatus(combineLocalizedText([plan.spec.statusLabel, detail2], "："), detail2);
            break;
          }
        }
        releasedCount += 1;
        const detail = localizedText(
          `释放挂单名额 ${releasedCount}/${targets.length}`,
          `Freeing order slots ${releasedCount}/${targets.length}`
        );
        setExecutionStatus(combineLocalizedText([plan.spec.statusLabel, detail], "："), detail);
      }
      return { ok: true, releasedCount, cancelledCount, unconfirmedCount };
    }
    async function setHideOtherSymbolChecked(root, desiredChecked, symbol = getCurrentSymbol(), abortSignal = null) {
      throwIfAborted(abortSignal);
      if (!isCurrentObservedSymbol(symbol)) return false;
      const checkbox = findHideOtherSymbolCheckbox(root);
      if (!checkbox) return false;
      const currentChecked = getCheckboxCheckedState(checkbox);
      if (currentChecked === desiredChecked) return true;
      if (currentChecked === null) return false;
      if (!isCurrentObservedSymbol(symbol)) return false;
      throwIfAborted(abortSignal);
      checkbox.click();
      const updatedCheckbox = await waitForAccountOrdersState(() => {
        if (!isCurrentObservedSymbol(symbol)) return null;
        const currentRoot = getActiveOpenOrdersScope2();
        const currentCheckbox = findHideOtherSymbolCheckbox(currentRoot);
        return getCheckboxCheckedState(currentCheckbox) === desiredChecked ? currentCheckbox : null;
      }, 1e3, abortSignal);
      return Boolean(updatedCheckbox) && isCurrentObservedSymbol(symbol);
    }
    async function ensureOpenOrdersLimitedToCurrentSymbol(root, symbol, abortSignal = null) {
      throwIfAborted(abortSignal);
      const checkbox = findHideOtherSymbolCheckbox(root);
      if (!checkbox) {
        return {
          ok: false,
          originalChecked: null
        };
      }
      const originalChecked = getCheckboxCheckedState(checkbox);
      if (originalChecked === null) {
        return {
          ok: false,
          originalChecked
        };
      }
      if (!originalChecked && !await setHideOtherSymbolChecked(
        root,
        true,
        symbol,
        abortSignal
      )) {
        return { ok: false, originalChecked };
      }
      const settledRoot = await waitForAccountOrdersState(() => {
        if (!isCurrentObservedSymbol(symbol)) return null;
        const currentRoot = getActiveOpenOrdersScope2();
        const currentCheckbox = findHideOtherSymbolCheckbox(currentRoot);
        const cancelAllButton = findCurrentSymbolCancelAllButton(currentRoot);
        return isCurrentSymbolOpenOrdersFilterReady({
          scopeText: currentRoot?.textContent || "",
          symbol,
          filterChecked: getCheckboxCheckedState(currentCheckbox),
          cancelAllAvailable: Boolean(cancelAllButton)
        }) ? currentRoot : null;
      }, 1600, abortSignal);
      return {
        ok: Boolean(settledRoot) && isCurrentObservedSymbol(symbol),
        originalChecked
      };
    }
    async function restoreOpenOrdersSymbolFilter(root, originalChecked, symbol = getCurrentSymbol()) {
      if (originalChecked !== false) return true;
      return setHideOtherSymbolChecked(root, false, symbol);
    }
    function getVisibleDialogs() {
      return Array.from(document.querySelectorAll(
        '[role="dialog"], [class*="modal"], [class*="Modal"], [class*="popover"], [class*="Popover"], [class*="drawer"], [class*="Drawer"]'
      )).filter(isVisibleElement);
    }
    function findNewVisibleDialog(dialogsBefore) {
      const previousDialogs = dialogsBefore || /* @__PURE__ */ new Set();
      for (const dialog of getVisibleDialogs()) {
        if (previousDialogs.has(dialog)) continue;
        return dialog;
      }
      return null;
    }
    async function waitForDialogToClose(dialog, timeoutMs = ROW_CANCEL_DIALOG_CLOSE_TIMEOUT_MS, abortSignal = null) {
      return Boolean(await waitForDialogMutationState(
        document,
        () => !dialog.isConnected || !isVisibleElement(dialog) ? true : null,
        timeoutMs,
        abortSignal
      ));
    }
    function createBinanceCancelAllDialogDecisionWatcher() {
      const lifecycleController = new AbortController();
      const dialogSignal = createDialogMutationSignal(document);
      if (!dialogSignal) throw new Error("撤单确认弹窗状态无法观察，已停止");
      const watcher = {
        action: null,
        error: null,
        seenDialog: false,
        dialogSignal
      };
      const recordAction = (eventTarget) => {
        const contract = findBinanceCancelAllDialog(document, isVisibleElement);
        if (!contract) return;
        watcher.seenDialog = true;
        const action = classifyBinanceCancelAllDialogAction(contract, eventTarget);
        if (action && !watcher.action) watcher.action = action;
      };
      const rejectInvalidDialogAction = (event, error) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        watcher.error = error;
      };
      const handleClick = (event) => {
        try {
          recordAction(event.target);
        } catch (error) {
          rejectInvalidDialogAction(event, error);
        } finally {
          dialogSignal.notify();
        }
      };
      const handleKeydown = (event) => {
        if (event.key !== "Escape" && event.key !== "Enter" && event.key !== " ") return;
        try {
          const contract = findBinanceCancelAllDialog(document, isVisibleElement);
          if (!contract) return;
          watcher.seenDialog = true;
          const action = classifyBinanceCancelAllDialogKeyboardAction(
            contract,
            event.key,
            document.activeElement || event.target
          );
          if (action && !watcher.action) watcher.action = action;
        } catch (error) {
          rejectInvalidDialogAction(event, error);
        } finally {
          dialogSignal.notify();
        }
      };
      const handlePageHide = (event) => {
        if (!event.persisted) {
          lifecycleController.abort();
          dialogSignal.notify();
        }
      };
      document.addEventListener("click", handleClick, true);
      document.addEventListener("keydown", handleKeydown, true);
      window.addEventListener("pagehide", handlePageHide);
      return {
        watcher,
        lifecycleSignal: lifecycleController.signal,
        dispose() {
          document.removeEventListener("click", handleClick, true);
          document.removeEventListener("keydown", handleKeydown, true);
          window.removeEventListener("pagehide", handlePageHide);
          dialogSignal.dispose();
        }
      };
    }
    async function waitForBinanceCancelAllDialogDecision(watcher, lifecycleSignal, onDialogSeen) {
      const discoveryDeadline = Date.now() + CANCEL_DIALOG_DISCOVERY_TIMEOUT_MS;
      let reportedDialog = false;
      while (true) {
        const observedVersion = watcher.dialogSignal.version;
        if (lifecycleSignal.aborted) return { status: "aborted" };
        if (watcher.error) throw watcher.error;
        const contract = findBinanceCancelAllDialog(document, isVisibleElement);
        if (contract) {
          watcher.seenDialog = true;
          if (!reportedDialog) {
            reportedDialog = true;
            onDialogSeen();
          }
        }
        const status = resolveCancelDialogDecision({
          seenDialog: watcher.seenDialog,
          action: watcher.action,
          dialogVisible: Boolean(contract),
          aborted: lifecycleSignal.aborted,
          nowMs: Date.now(),
          discoveryDeadlineMs: discoveryDeadline
        });
        if (status !== "waiting") return { status };
        const remainingDiscoveryMs = watcher.seenDialog ? null : Math.max(0, discoveryDeadline - Date.now());
        await watcher.dialogSignal.waitForChange(observedVersion, remainingDiscoveryMs);
      }
    }
    function getBinanceChartOrdersTarget2() {
      return getBinanceChartOrdersTarget(document);
    }
    function writeChartOrdersRecoveryRecord() {
      sessionStorage.setItem(
        CHART_ORDERS_RECOVERY_STORAGE_KEY,
        createChartOrdersRecoveryRecord(Date.now())
      );
    }
    function clearChartOrdersRecoveryRecord() {
      sessionStorage.removeItem(CHART_ORDERS_RECOVERY_STORAGE_KEY);
    }
    function readChartOrdersRecoveryRecord() {
      return parseChartOrdersRecoveryRecord(
        sessionStorage.getItem(CHART_ORDERS_RECOVERY_STORAGE_KEY),
        Date.now()
      );
    }
    function dispatchChartOrdersPointerEvents(element, eventTypes, relatedTarget = null) {
      for (const type of eventTypes) {
        element.dispatchEvent(new MouseEvent(type, {
          bubbles: type !== "mouseenter" && type !== "mouseleave",
          cancelable: true,
          composed: true,
          relatedTarget,
          view: window
        }));
      }
    }
    async function waitForBinanceChartOrdersPopover(target, expectedChecked = null) {
      const deadline = Date.now() + CHART_ORDERS_MENU_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const current2 = findActiveBinanceChartOrdersPopover(
          document,
          target,
          isVisibleElement
        );
        if (current2 && (expectedChecked === null || current2.checked === expectedChecked)) {
          return current2;
        }
        await delay(CHART_ORDERS_MENU_POLL_MS);
      }
      const current = findActiveBinanceChartOrdersPopover(
        document,
        target,
        isVisibleElement
      );
      if (current && (expectedChecked === null || current.checked === expectedChecked)) {
        return current;
      }
      throw new Error(expectedChecked === null ? "图表“显示当前委托”菜单未打开" : `图表“显示当前委托”未切换为${expectedChecked ? "显示" : "隐藏"}`);
    }
    async function openBinanceChartOrdersPopover(target) {
      const currentTarget = getBinanceChartOrdersTarget2();
      assertSameBinanceChartOrdersTarget(target, currentTarget);
      dispatchChartOrdersPointerEvents(
        currentTarget.trigger,
        ["pointerover", "mouseover", "mouseenter"]
      );
      return waitForBinanceChartOrdersPopover(currentTarget);
    }
    async function closeBinanceChartOrdersPopover(target) {
      const currentTarget = getBinanceChartOrdersTarget2();
      assertSameBinanceChartOrdersTarget(target, currentTarget);
      const current = findActiveBinanceChartOrdersPopover(
        document,
        currentTarget,
        isVisibleElement
      );
      if (!current) return;
      dispatchChartOrdersPointerEvents(
        current.popover,
        ["pointerout", "mouseout", "mouseleave"],
        currentTarget.chartRoot
      );
      dispatchChartOrdersPointerEvents(
        currentTarget.trigger,
        ["pointerout", "mouseout", "mouseleave"],
        currentTarget.chartRoot
      );
      dispatchChartOrdersPointerEvents(
        currentTarget.chartRoot,
        ["pointerover", "mouseover", "mouseenter"],
        currentTarget.trigger
      );
      const deadline = Date.now() + CHART_ORDERS_MENU_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (!findActiveBinanceChartOrdersPopover(
          document,
          currentTarget,
          isVisibleElement
        )) return;
        await delay(CHART_ORDERS_MENU_POLL_MS);
      }
      if (findActiveBinanceChartOrdersPopover(
        document,
        currentTarget,
        isVisibleElement
      )) {
        throw new Error("图表“显示当前委托”菜单未关闭");
      }
    }
    async function toggleBinanceChartOrdersWithCoalescedSave(target, checkbox, expectedChecked, expectDrawingEvents) {
      if (typeof expectDrawingEvents !== "boolean") {
        throw new Error("图表委托线保存参数异常");
      }
      let popoverCloseOutcomePromise = null;
      const coalescingOutcome = await coalesceTradingViewDrawingSaves(
        target.tradingViewApi,
        async () => {
          checkbox.click();
          await waitForBinanceChartOrdersPopover(target, expectedChecked);
          popoverCloseOutcomePromise = closeBinanceChartOrdersPopover(target).then(
            () => null,
            (error) => error
          );
        },
        expectDrawingEvents ? {} : { eventDiscoveryTimeoutMs: 0 }
      ).then(
        (result2) => ({ result: result2, error: null }),
        (error) => ({ result: null, error })
      );
      const popoverCloseError = popoverCloseOutcomePromise ? await popoverCloseOutcomePromise : null;
      if (coalescingOutcome.error) throw coalescingOutcome.error;
      if (popoverCloseError) throw popoverCloseError;
      const { result } = coalescingOutcome;
      log("图表当前委托保存已合并", {
        drawingEvents: result.drawingEventCount,
        saveRequests: result.saveRequestCount,
        fullSaves: result.fullSaveCount
      });
    }
    async function hideBinanceChartOrdersForBulkCancel(target, state) {
      const current = await openBinanceChartOrdersPopover(target);
      state.originalChecked = current.checked;
      if (current.checked) {
        writeChartOrdersRecoveryRecord();
        state.changed = true;
        await toggleBinanceChartOrdersWithCoalescedSave(
          target,
          current.checkbox,
          false,
          true
        );
        return;
      }
      await closeBinanceChartOrdersPopover(target);
    }
    async function restoreBinanceChartOrdersAfterBulkCancel(target, state, expectDrawingEvents) {
      if (typeof expectDrawingEvents !== "boolean") {
        throw new Error("图表委托线保存参数异常");
      }
      assertSameBinanceChartOrdersTarget(target, getBinanceChartOrdersTarget2());
      const current = await openBinanceChartOrdersPopover(target);
      if (current.checked !== state.originalChecked) {
        await toggleBinanceChartOrdersWithCoalescedSave(
          target,
          current.checkbox,
          state.originalChecked,
          expectDrawingEvents
        );
      } else {
        await closeBinanceChartOrdersPopover(target);
      }
      clearChartOrdersRecoveryRecord();
    }
    async function recoverChartOrdersStateAfterReload() {
      const recovery = readChartOrdersRecoveryRecord();
      if (recovery.status === "missing") {
        chartOrdersRecoveryPendingAtStartup = false;
        return { status: "missing" };
      }
      if (recovery.status === "invalid") {
        emit("ERR", "图表当前委托恢复记录无效，未修改页面状态");
        clearChartOrdersRecoveryRecord();
        chartOrdersRecoveryPendingAtStartup = false;
        return { status: recovery.status };
      }
      const target = findBinanceChartOrdersTarget(document);
      if (!target) return { status: "target_not_ready" };
      await restoreBinanceChartOrdersAfterBulkCancel(target, {
        originalChecked: recovery.record.originalChecked,
        changed: true
      }, true);
      chartOrdersRecoveryPendingAtStartup = false;
      chartOrdersRecoveryLastError = null;
      log("已恢复刷新前的图表当前委托显示状态");
      return { status: "restored" };
    }
    function scheduleChartOrdersRecovery() {
      if (!chartOrdersRecoveryPendingAtStartup || chartOrdersRecoveryTask || cancelCurrentSymbolOpenOrdersTask || document.hidden || !isFuturesTradingPage()) return;
      const task = recoverChartOrdersStateAfterReload();
      chartOrdersRecoveryTask = task;
      task.catch((error) => {
        const message = String(error?.message || error);
        if (message !== chartOrdersRecoveryLastError) {
          chartOrdersRecoveryLastError = message;
          emit("ERR", "恢复刷新前的图表当前委托显示失败", error);
        }
      }).finally(() => {
        if (chartOrdersRecoveryTask === task) chartOrdersRecoveryTask = null;
      });
    }
    async function runCancelCurrentSymbolOpenOrders(options = null) {
      const { waitUntilCleared = false } = options || {};
      const symbol = getCurrentSymbol();
      if (!symbol) {
        setLadderStatus("未识别当前交易对");
        return { ok: false, status: "no_symbol", message: "未识别当前交易对" };
      }
      if (!isCurrentObservedSymbol(symbol)) {
        const message = "交易对正在切换";
        setLadderStatus(message);
        return { ok: false, status: "symbol_changing", message };
      }
      if (getOpenOrdersTabCount() === 0) {
        setLadderStatus("当前交易对无挂单");
        return { ok: true, status: "no_orders" };
      }
      const previousAccountOrdersTabIdentity = getAccountOrdersTabIdentity2(findSelectedAccountOrdersTab2());
      let openOrdersScope = null;
      let previousOpenOrdersSubTabIdentity = null;
      let symbolFilterOriginalChecked = null;
      let restoreTemporaryUiState = true;
      let chartOrdersTarget = null;
      const chartOrdersState = { originalChecked: null, changed: false };
      let restoreChartOrdersState = true;
      let chartOrdersDefinitivelyCleared = false;
      let successStatusMessage = null;
      try {
        const tabReady = await activateOpenOrdersTab();
        if (!isCurrentObservedSymbol(symbol)) {
          const message = "打开当前委托时交易对已变化";
          setLadderStatus(message);
          return { ok: false, status: "symbol_changed", message };
        }
        if (!tabReady) {
          const message = "未能打开当前委托";
          setLadderStatus(message);
          return { ok: false, status: "tab_not_ready", message };
        }
        openOrdersScope = await waitForActiveOpenOrdersScope();
        if (!openOrdersScope || !isCurrentObservedSymbol(symbol)) {
          const message = "未找到当前委托面板";
          setLadderStatus(message);
          return { ok: false, status: "scope_not_found", message };
        }
        const basicSubTabState = await activateOpenOrdersBasicSubTab(openOrdersScope);
        previousOpenOrdersSubTabIdentity = basicSubTabState.previousSubTabIdentity;
        if (!basicSubTabState.ready || !isCurrentObservedSymbol(symbol)) {
          const message = "未找到当前委托基础单";
          setLadderStatus(message);
          return { ok: false, status: "basic_tab_not_ready", message };
        }
        openOrdersScope = await waitForActiveOpenOrdersScope();
        if (!openOrdersScope || !isCurrentObservedSymbol(symbol)) {
          const message = "未找到当前委托面板";
          setLadderStatus(message);
          return { ok: false, status: "scope_not_found", message };
        }
        const symbolFilter = await ensureOpenOrdersLimitedToCurrentSymbol(openOrdersScope, symbol);
        symbolFilterOriginalChecked = symbolFilter.originalChecked;
        if (!symbolFilter.ok || !isCurrentObservedSymbol(symbol)) {
          const message = "未确认仅显示当前交易对挂单";
          setLadderStatus(message);
          return { ok: false, status: "symbol_filter_not_confirmed", message };
        }
        openOrdersScope = await waitForActiveOpenOrdersScope();
        if (!openOrdersScope || !isCurrentObservedSymbol(symbol)) {
          const message = "未找到当前委托面板";
          setLadderStatus(message);
          return { ok: false, status: "scope_not_found", message };
        }
        const openOrdersEvidence = await waitForCurrentSymbolOpenOrders(symbol);
        if (!isCurrentObservedSymbol(symbol)) {
          const message = "读取挂单时交易对已变化";
          setLadderStatus(message);
          return { ok: false, status: "symbol_changed", message };
        }
        if (!openOrdersEvidence.hasOrders) {
          setLadderStatus("当前交易对无挂单");
          return { ok: true, status: "no_orders" };
        }
        let cancelAllButton = openOrdersEvidence.cancelAllButton;
        if (!cancelAllButton) {
          const message = "未找到当前委托的全撤按钮";
          setLadderStatus(message);
          return { ok: false, status: "cancel_button_not_found", message };
        }
        if (!isCurrentObservedSymbol(symbol)) {
          const message = "撤单前交易对已变化";
          setLadderStatus(message);
          return { ok: false, status: "symbol_changed", message };
        }
        cancelCurrentSymbolOpenOrdersBlocksLadderActions = true;
        scheduleRenderPanel();
        try {
          chartOrdersTarget = getBinanceChartOrdersTarget2();
          await hideBinanceChartOrdersForBulkCancel(chartOrdersTarget, chartOrdersState);
        } catch (e) {
          emit("ERR", "撤单前隐藏图表当前委托失败", e);
          const message = "未能准备撤单页面，未打开确认弹窗";
          setLadderStatus(message);
          return { ok: false, status: "chart_orders_not_hidden", message };
        }
        if (!isCurrentObservedSymbol(symbol)) {
          const message = "准备撤单时交易对已变化";
          setLadderStatus(message);
          return { ok: false, status: "symbol_changed", message };
        }
        openOrdersScope = await waitForActiveOpenOrdersScope();
        if (!openOrdersScope || !isCurrentObservedSymbol(symbol)) {
          const message = "准备撤单时未找到当前委托面板";
          setLadderStatus(message);
          return { ok: false, status: "scope_not_found", message };
        }
        if (!isOpenOrdersScopeConfirmedForSymbol(openOrdersScope, symbol)) {
          const message = "准备撤单时未确认仅显示当前交易对挂单";
          setLadderStatus(message);
          return { ok: false, status: "symbol_filter_not_confirmed", message };
        }
        cancelAllButton = findCurrentSymbolCancelAllButton(openOrdersScope);
        if (!cancelAllButton) {
          const message = "准备撤单时未找到全撤按钮";
          setLadderStatus(message);
          return { ok: false, status: "cancel_button_not_found", message };
        }
        const dialogDecisionWatcher = createBinanceCancelAllDialogDecisionWatcher();
        let dialogDecision;
        try {
          cancelAllButton.click();
          dialogDecision = await waitForBinanceCancelAllDialogDecision(
            dialogDecisionWatcher.watcher,
            dialogDecisionWatcher.lifecycleSignal,
            () => setLadderStatus("撤单确认弹窗已打开")
          );
        } catch (error) {
          restoreTemporaryUiState = false;
          emit("ERR", "币安撤单确认弹窗结构异常", error);
          const message = "撤单确认弹窗结构异常，未执行弹窗操作";
          setLadderStatus(message);
          return { ok: false, status: "dialog_contract_invalid", message };
        } finally {
          dialogDecisionWatcher.dispose();
        }
        if (dialogDecision.status === "aborted") {
          restoreTemporaryUiState = false;
          restoreChartOrdersState = false;
          const interruptedBaseAsset = formatStatusBaseAsset(symbol);
          const message = `原交易对 ${interruptedBaseAsset} 页面已离开，撤单确认跟踪已停止`;
          setLadderStatus(message);
          return { ok: false, status: "aborted", message };
        }
        if (!isCurrentObservedSymbol(symbol)) {
          const message = "确认撤单前交易对已变化";
          setLadderStatus(message);
          return { ok: false, status: "symbol_changed", message };
        }
        if (dialogDecision.status === "not_found") {
          const message = "未识别到撤单确认弹窗，未继续撤单流程";
          setLadderStatus(message);
          return { ok: false, status: "dialog_not_found", message };
        }
        if (dialogDecision.status === "cancelled") {
          const message = "撤单已取消";
          successStatusMessage = message;
          return { ok: false, status: "cancelled", message };
        }
        waitForTradeUiMutation({ timeoutMs: 800 });
        setLadderStatus("撤单已确认，等待挂单清空");
        openOrdersScope = await waitForActiveOpenOrdersScope();
        if (!openOrdersScope || !isCurrentObservedSymbol(symbol)) {
          const message = "未找到当前委托面板";
          setLadderStatus(message);
          return { ok: false, status: "scope_not_found", message };
        }
        const clearResult = await waitForCurrentSymbolOpenOrdersCleared(openOrdersScope, symbol);
        openOrdersScope = clearResult.root || openOrdersScope;
        if (!clearResult.ok) {
          if (clearResult.status === "symbol_changed") {
            const message2 = "等待撤单完成时交易对已变化";
            setLadderStatus(message2);
            return { ok: false, status: "symbol_changed", message: message2 };
          }
          if (clearResult.status === "scope_not_found") {
            const message2 = "等待撤单完成时未找到当前委托面板";
            setLadderStatus(message2);
            return { ok: false, status: "scope_not_found", message: message2 };
          }
          if (clearResult.status === "symbol_filter_not_confirmed") {
            const message2 = "等待撤单完成时未确认仅显示当前交易对挂单";
            setLadderStatus(message2);
            return { ok: false, status: "symbol_filter_not_confirmed", message: message2 };
          }
          const message = waitUntilCleared ? "当前交易对挂单仍存在，已停止重新挂单" : "当前交易对挂单仍存在，撤单未完成";
          setLadderStatus(message);
          return { ok: false, status: "not_cleared", message };
        }
        chartOrdersDefinitivelyCleared = clearResult.definitivelyCleared === true;
        successStatusMessage = waitUntilCleared ? "原挂单已撤，继续阶梯挂单" : "撤单已完成";
        return { ok: true, status: "cleared" };
      } finally {
        let temporaryUiRestoreSucceeded = true;
        if (restoreTemporaryUiState && isCurrentObservedSymbol(symbol)) {
          openOrdersScope = await waitForActiveOpenOrdersScope();
          if (openOrdersScope && symbolFilterOriginalChecked === false) {
            const restored = await restoreOpenOrdersSymbolFilter(openOrdersScope, symbolFilterOriginalChecked, symbol);
            if (!restored) {
              temporaryUiRestoreSucceeded = false;
              setLadderStatus("未能恢复隐藏其他合约状态");
            }
          }
          if (previousOpenOrdersSubTabIdentity) {
            temporaryUiRestoreSucceeded = await restoreOpenOrdersSubTab(previousOpenOrdersSubTabIdentity, symbol) && temporaryUiRestoreSucceeded;
          }
          if (isCurrentObservedSymbol(symbol)) {
            temporaryUiRestoreSucceeded = await restoreAccountOrdersTab(previousAccountOrdersTabIdentity, symbol) && temporaryUiRestoreSucceeded;
          }
        }
        let chartOrdersRestoreSucceeded = true;
        if (restoreChartOrdersState && chartOrdersState.changed) {
          try {
            const chartOrdersStillDefinitivelyCleared = chartOrdersDefinitivelyCleared && getOpenOrdersTabCount() === 0;
            await restoreBinanceChartOrdersAfterBulkCancel(
              chartOrdersTarget,
              chartOrdersState,
              !chartOrdersStillDefinitivelyCleared
            );
          } catch (e) {
            chartOrdersRestoreSucceeded = false;
            emit("ERR", "恢复图表当前委托显示失败", e);
            setLadderStatus("未能恢复图表当前委托显示");
          }
        }
        if (restoreTemporaryUiState && isCurrentObservedSymbol(symbol) && chartOrdersRestoreSucceeded && temporaryUiRestoreSucceeded && successStatusMessage) {
          setLadderStatus(successStatusMessage);
        }
      }
    }
    async function cancelCurrentSymbolOpenOrders(options = null) {
      if (cancelCurrentSymbolOpenOrdersTask) return cancelCurrentSymbolOpenOrdersTask;
      if (singleOrderTask) {
        return { ok: false, status: "single_order_running", message: "单击下单处理中" };
      }
      if (ladderTask) {
        const message = "阶梯任务运行中，请先停止阶梯挂单";
        setLadderStatus(message);
        return { ok: false, status: "ladder_running", message };
      }
      if (continuousLadderTask) {
        const message = "连续交易运行中，请先停止阶梯挂单";
        setLadderStatus(message);
        return { ok: false, status: "ladder_running", message };
      }
      clearCancelNoOrdersFeedback();
      cancelCurrentSymbolOpenOrdersBlocksLadderActions = false;
      invalidateUsdtRebalanceEligibility();
      const task = runCancelCurrentSymbolOpenOrders(options);
      cancelCurrentSymbolOpenOrdersTask = task;
      scheduleRenderPanel();
      try {
        const result = await task;
        if (result?.status === "no_orders") showCancelNoOrdersFeedback();
        return result;
      } finally {
        if (cancelCurrentSymbolOpenOrdersTask === task) {
          cancelCurrentSymbolOpenOrdersTask = null;
          cancelCurrentSymbolOpenOrdersBlocksLadderActions = false;
        }
        scheduleRenderPanel();
      }
    }
    function clearCancelNoOrdersFeedback() {
      window.clearTimeout(cancelNoOrdersFeedbackTimer);
      cancelNoOrdersFeedbackTimer = 0;
      cancelNoOrdersFeedbackActive = false;
    }
    function showCancelNoOrdersFeedback() {
      clearCancelNoOrdersFeedback();
      cancelNoOrdersFeedbackActive = true;
      cancelNoOrdersFeedbackTimer = window.setTimeout(() => {
        cancelNoOrdersFeedbackTimer = 0;
        cancelNoOrdersFeedbackActive = false;
        scheduleRenderPanel();
      }, CANCEL_NO_ORDERS_FEEDBACK_MS);
      scheduleRenderPanel();
    }
    async function cancelCurrentSymbolOpenOrdersForPlan(plan, progress, setExecutionStatus, abortSignal = null, options = null) {
      throwIfAborted(abortSignal);
      const setPlanStepStatus = (message) => {
        const localizedMessage = localizeKnownUiStatus(message);
        setExecutionStatus(
          combineLocalizedText([plan.spec.statusLabel, localizedMessage], "："),
          localizedMessage
        );
      };
      const symbol = getCurrentSymbol();
      if (!isCurrentObservedSymbol(symbol) || symbol !== plan?.symbol) {
        const message = "撤销待替换挂单前交易对已变化";
        setPlanStepStatus(message);
        return { ok: false, status: "symbol_changed", message };
      }
      const capacityRecovery = options?.strategy === "farthest_for_capacity";
      const previousAccountOrdersTabIdentity = getAccountOrdersTabIdentity2(findSelectedAccountOrdersTab2());
      const previousOpenOrdersScrollTop = findOpenOrderRowsScrollContainer(
        getActiveOpenOrdersScope2()
      )?.scrollTop ?? null;
      let openOrdersScope = null;
      let previousOpenOrdersSubTabIdentity = null;
      let symbolFilterOriginalChecked = null;
      let restoreTemporaryUiState = true;
      try {
        setPlanStepStatus("查找当前委托");
        const tabReady = await activateOpenOrdersTab(abortSignal);
        throwIfAborted(abortSignal);
        if (!isCurrentObservedSymbol(symbol)) {
          const message = "打开当前委托时交易对已变化";
          setPlanStepStatus(message);
          return { ok: false, status: "symbol_changed", message };
        }
        if (!tabReady) {
          const message = "未能打开当前委托";
          setPlanStepStatus(message);
          return { ok: false, status: "tab_not_ready", message };
        }
        openOrdersScope = await waitForActiveOpenOrdersScope(abortSignal);
        throwIfAborted(abortSignal);
        if (!openOrdersScope) {
          const message = "未找到当前委托面板";
          setPlanStepStatus(message);
          return { ok: false, status: "scope_not_found", message };
        }
        previousOpenOrdersSubTabIdentity = getOpenOrdersSubTabIdentity2(
          findSelectedOpenOrdersSubTab2(openOrdersScope)
        );
        const basicSubTabState = await activateOpenOrdersBasicSubTab(
          openOrdersScope,
          abortSignal
        );
        throwIfAborted(abortSignal);
        if (!basicSubTabState.ready) {
          const message = "未找到当前委托基础单";
          setPlanStepStatus(message);
          return { ok: false, status: "basic_tab_not_ready", message };
        }
        openOrdersScope = await waitForActiveOpenOrdersScope(abortSignal);
        throwIfAborted(abortSignal);
        if (!openOrdersScope) {
          const message = "未找到当前委托面板";
          setPlanStepStatus(message);
          return { ok: false, status: "scope_not_found", message };
        }
        symbolFilterOriginalChecked = getCheckboxCheckedState(
          findHideOtherSymbolCheckbox(openOrdersScope)
        );
        const symbolFilter = await ensureOpenOrdersLimitedToCurrentSymbol(
          openOrdersScope,
          symbol,
          abortSignal
        );
        throwIfAborted(abortSignal);
        if (!symbolFilter.ok) {
          const message = "未确认仅显示当前交易对挂单";
          setPlanStepStatus(message);
          return { ok: false, status: "symbol_filter_not_confirmed", message };
        }
        openOrdersScope = await waitForActiveOpenOrdersScope(abortSignal);
        throwIfAborted(abortSignal);
        if (!openOrdersScope) {
          const message = "未找到当前委托面板";
          setPlanStepStatus(message);
          return { ok: false, status: "scope_not_found", message };
        }
        const rows = capacityRecovery ? await loadAllCurrentSymbolOpenOrderRows(
          openOrdersScope,
          symbol,
          plan,
          abortSignal
        ) : await waitForCurrentSymbolOpenOrderRows(
          openOrdersScope,
          symbol,
          plan,
          abortSignal
        );
        throwIfAborted(abortSignal);
        if (!rows.length) {
          const directionLabel = getPlanDirectionLabel(plan);
          const message = `未找到${directionLabel || ""}方向的可撤基础单`;
          setPlanStepStatus(message);
          return { ok: false, status: "rows_not_found", message };
        }
        if (capacityRecovery) {
          const referencePrice = readOpenOrdersDistanceReferencePrice();
          const targets = selectFarthestOpenOrders(
            rows,
            referencePrice,
            MAX_OPEN_ORDERS_RECOVERY_CANCEL_COUNT
          );
          const preparingDetail = localizedText(
            `达到挂单上限，准备撤销距当前价最远的 ${targets.length} 笔同向挂单`,
            `Order limit reached; cancelling the ${targets.length} farthest same-direction orders`
          );
          setExecutionStatus(
            combineLocalizedText([plan.spec.statusLabel, preparingDetail], "："),
            preparingDetail
          );
          const result = await cancelFarthestOpenOrderRowsForPlan(
            openOrdersScope,
            plan,
            targets,
            progress,
            setExecutionStatus,
            abortSignal
          );
          throwIfAborted(abortSignal);
          const completedDetail = result.unconfirmedCount > 0 ? localizedText(
            `已释放 ${result.releasedCount} 个挂单名额 · ${result.unconfirmedCount} 笔未确认，继续本轮`,
            `Freed ${result.releasedCount} order slots · ${result.unconfirmedCount} unconfirmed; continuing this round`
          ) : localizedText(
            `已释放 ${result.releasedCount} 个挂单名额，继续本轮`,
            `Freed ${result.releasedCount} order slots; continuing this round`
          );
          setExecutionStatus(
            combineLocalizedText([plan.spec.statusLabel, completedDetail], "："),
            completedDetail
          );
          return { ok: true, status: "capacity_released", ...result };
        }
        const rowsToCancel = selectOpenOrderRowsToCancelForPlan(plan, rows);
        if (!rowsToCancel.length) {
          const message = "未选中待替换挂单";
          setPlanStepStatus(message);
          return { ok: false, status: "rows_not_selected", message };
        }
        setPlanStepStatus(`撤销 ${rowsToCancel.length} 笔同向挂单`);
        await cancelOpenOrderRowsForPlan(
          openOrdersScope,
          plan,
          progress,
          setExecutionStatus,
          abortSignal
        );
        throwIfAborted(abortSignal);
        setPlanStepStatus("原挂单已撤，继续阶梯挂单");
        return { ok: true, status: "rows_cleared" };
      } catch (e) {
        if (isLadderStoppedError(e)) throw e;
        if (e?.name === "DialogNotClosedError") restoreTemporaryUiState = false;
        const message = e?.message || "待替换挂单撤销失败，已停止重新挂单";
        setPlanStepStatus(message);
        const status = e?.name === "DialogNotClosedError" ? "dialog_not_closed" : "row_cancel_failed";
        return { ok: false, status, message };
      } finally {
        if (restoreTemporaryUiState && isCurrentObservedSymbol(symbol)) {
          openOrdersScope = await waitForActiveOpenOrdersScope();
          if (symbolFilterOriginalChecked === false) {
            const restored = openOrdersScope ? await restoreOpenOrdersSymbolFilter(openOrdersScope, symbolFilterOriginalChecked, symbol) : false;
            if (!restored) setPlanStepStatus("未能恢复隐藏其他合约状态");
          }
          if (previousOpenOrdersSubTabIdentity) {
            await restoreOpenOrdersSubTab(previousOpenOrdersSubTabIdentity, symbol);
          }
          if (previousOpenOrdersScrollTop !== null) {
            openOrdersScope = await waitForActiveOpenOrdersScope();
            const scrollContainer = findOpenOrderRowsScrollContainer(openOrdersScope);
            if (scrollContainer) {
              scrollContainer.scrollTop = Math.min(
                previousOpenOrdersScrollTop,
                scrollContainer.scrollHeight
              );
            }
          }
          if (isCurrentObservedSymbol(symbol)) {
            await restoreAccountOrdersTab(previousAccountOrdersTabIdentity, symbol);
          }
        }
      }
    }
    function formatLadderPlanDetail(plan) {
      const zhLevelText = plan.levels === plan.requestedLevels ? `${plan.levels}档` : `${plan.levels}/${plan.requestedLevels}档`;
      const enLevelText = plan.levels === plan.requestedLevels ? `${plan.levels} orders` : `${plan.levels}/${plan.requestedLevels} orders`;
      return localizedText(
        `${plan.percent}% / ${zhLevelText} / 幅${plan.ladderStep}`,
        `${plan.percent}% / ${enLevelText} / gap ${plan.ladderStep}`
      );
    }
    function formatLadderPlanStatus(plan) {
      return combineLocalizedText([
        localizedActionStatus(plan.spec.statusLabel, "计划", " plan"),
        formatLadderPlanDetail(plan)
      ], "：");
    }
    function isReplaceableCloseLadderOpenOrdersFailure(plan, error) {
      if (plan?.spec?.mode !== "CLOSE") return false;
      return isReduceOnlyOpenOrdersConflictFeedback(error?.message || "");
    }
    function isReplaceableOpenLadderOpenOrdersFailure(plan, error) {
      if (plan?.spec?.mode !== "OPEN") return false;
      return isOpenLadderOpenOrdersCapacityFeedback(error?.message || "");
    }
    function getOpenLadderMinimumQtyReplacementPlan(error) {
      const plan = error?.openOrdersReplacementPlan;
      if (plan?.spec?.mode === "OPEN" && plan.symbol && plan.precision && plan.optionContext && plan.optionContext.percent != null && Number.isInteger(plan.optionContext.levels) && Number.isInteger(plan.optionContext.ladderStep) && plan.totalQty && isPositiveDecimalString(plan.totalQty)) {
        return plan;
      }
      return null;
    }
    function getReplaceableLadderOpenOrdersPlan(plan, error) {
      if (isReplaceableCloseLadderOpenOrdersFailure(plan, error)) return plan;
      if (isReplaceableOpenLadderOpenOrdersFailure(plan, error)) return plan;
      return getOpenLadderMinimumQtyReplacementPlan(error);
    }
    function formatOpenOrdersReplacementDetail(plan) {
      if (plan?.spec?.mode === "OPEN") {
        return localizedText(
          "同向开仓挂单可能占用可开数量，准备撤销后重新挂单",
          "Same-direction open orders may consume available quantity; cancelling before replacement"
        );
      }
      return localizedText(
        "同向平仓挂单占用可平数量，准备撤销后重新挂单",
        "Same-direction close orders consume available quantity; cancelling before replacement"
      );
    }
    function formatOpenOrdersReplacementStatus(plan) {
      return combineLocalizedText([
        plan.spec.statusLabel,
        formatOpenOrdersReplacementDetail(plan)
      ], "：");
    }
    function createLadderExpectedContext(plan) {
      return {
        symbol: plan.symbol,
        mode: plan.spec.mode,
        precision: plan.precision
      };
    }
    async function runLadderPlanWithOpenOrderReplacement(actionType, progress, setExecutionStatus, abortSignal = null, options = null) {
      let replacementContext = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        throwIfAborted(abortSignal);
        let plan = null;
        try {
          plan = await buildLadderPlan(actionType, replacementContext);
          setLadderPlannedOrders(progress, plan.orders.length);
          throwIfAborted(abortSignal);
          setExecutionStatus(formatLadderPlanStatus(plan), formatLadderPlanDetail(plan));
          const execution = await executeLadderPlan(
            plan,
            progress,
            setExecutionStatus,
            abortSignal,
            options
          );
          return { plan, ...execution };
        } catch (e) {
          const replacementPlan = getReplaceableLadderOpenOrdersPlan(plan, e);
          if (attempt > 0 || !replacementPlan) throw e;
          assertLadderExecutionContext(replacementPlan);
          setExecutionStatus(
            formatOpenOrdersReplacementStatus(replacementPlan),
            formatOpenOrdersReplacementDetail(replacementPlan)
          );
          replacementContext = createLadderExpectedContext(replacementPlan);
          const result = await cancelCurrentSymbolOpenOrdersForPlan(
            replacementPlan,
            progress,
            setExecutionStatus,
            abortSignal
          );
          throwIfAborted(abortSignal);
          if (!result?.ok) {
            if (replacementPlan.spec.mode === "CLOSE" && !["symbol_changed", "dialog_not_closed"].includes(result.status)) {
              try {
                await throwIfClosePositionCompleted(replacementPlan, abortSignal);
              } catch (positionError) {
                if (isClosePositionCompletedError(positionError)) throw positionError;
                err("替换挂单失败后确认当前方向持仓失败:", positionError);
              }
            }
            const message = result.message || "原挂单未完成替换";
            if (["symbol_changed", "dialog_not_closed"].includes(result.status)) {
              throw new Error(message);
            }
            throw createContinuousRoundRecoveryError(
              "open_orders_not_ready",
              message
            );
          }
        }
      }
      throw new Error("阶梯重挂流程异常");
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
    function readOpenableQtyByTestIds() {
      const longQty = readQtyByDataTestId("max-buy-amount");
      const shortQty = readQtyByDataTestId("max-sell-amount");
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
        if (!includesBinancePageText(text, BINANCE_PAGE_TEXT.closeableQuantity)) continue;
        const m = text.match(new RegExp(
          `(?:${BINANCE_CLOSEABLE_QUANTITY_LABEL_PATTERN})\\s*([\\d,]*\\.?\\d+)`,
          "i"
        ));
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
    function readQtyTextNearButton(button, labels, labelPattern) {
      if (!button) return null;
      const btnRect = button.getBoundingClientRect();
      const root = getButtonTextSearchRoot(button);
      if (!root) return null;
      let best = null;
      let bestScore = Infinity;
      const nodes = root.querySelectorAll("div, span, p, small");
      const re = new RegExp(`(?:${labelPattern})\\s*([\\d,]*\\.?\\d+)`, "gi");
      for (const node of nodes) {
        const text = (node.textContent || "").replace(/\s+/g, " ").trim();
        if (!includesBinancePageText(text, labels)) continue;
        re.lastIndex = 0;
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
      const fromTestId = readOpenableQtyByTestIds();
      if (fromTestId) return fromTestId;
      return {
        longQty: readQtyTextNearButton(
          openLongBtn,
          BINANCE_PAGE_TEXT.openableQuantity,
          BINANCE_OPENABLE_QUANTITY_LABEL_PATTERN
        ),
        shortQty: readQtyTextNearButton(
          openShortBtn,
          BINANCE_PAGE_TEXT.openableQuantity,
          BINANCE_OPENABLE_QUANTITY_LABEL_PATTERN
        ),
        qtySource: "near_button"
      };
    }
    function isConfirmedZeroOpenBalance(qty) {
      const available = readTradeAvailableBalance(getTradeMutationRoot(), { isVisibleElement });
      const normalizedQty = normalizeDecimalString(String(qty ?? ""));
      const normalizedBalance = normalizeDecimalString(available?.amount ?? "");
      return normalizedQty !== null && normalizedBalance !== null && compareDecimalStrings(normalizedQty, "0") === 0 && compareDecimalStrings(normalizedBalance, "0") === 0;
    }
    function loadCloseSide(symbol = getCurrentSymbol()) {
      return loadSymbolSide(localStorage, LOCAL_CLOSE_SIDE_KEY, symbol, DEFAULT_CLOSE_SIDE);
    }
    function saveCloseSide(value, symbol = getCurrentSymbol()) {
      saveSymbolSide(localStorage, LOCAL_CLOSE_SIDE_KEY, symbol, value);
    }
    function updateCloseSide(value) {
      saveCloseSide(value);
      scheduleRenderPanel();
    }
    function loadOpenSide(symbol = getCurrentSymbol()) {
      return loadSymbolSide(localStorage, LOCAL_OPEN_SIDE_KEY, symbol, DEFAULT_OPEN_SIDE);
    }
    function saveOpenSide(value, symbol = getCurrentSymbol()) {
      saveSymbolSide(localStorage, LOCAL_OPEN_SIDE_KEY, symbol, value);
    }
    function updateOpenSide(value) {
      saveOpenSide(value);
      scheduleRenderPanel();
    }
    function readCloseContext(expectedSymbol = getCurrentSymbol()) {
      const pending = {
        symbol: expectedSymbol,
        closeLongBtn: null,
        closeShortBtn: null,
        longQty: null,
        shortQty: null,
        qtySource: null,
        knowsLong: false,
        knowsShort: false,
        hasLong: false,
        hasShort: false
      };
      if (!isCurrentObservedSymbol(expectedSymbol)) return pending;
      const closeLongBtn = findCloseLongButton();
      const closeShortBtn = findCloseShortButton();
      const { longQty, shortQty, qtySource } = readCloseableQty(closeLongBtn, closeShortBtn);
      if (!isCurrentObservedSymbol(expectedSymbol)) return pending;
      const knowsLong = longQty != null;
      const knowsShort = shortQty != null;
      const hasLong = longQty > 0;
      const hasShort = shortQty > 0;
      return {
        symbol: expectedSymbol,
        closeLongBtn,
        closeShortBtn,
        longQty,
        shortQty,
        qtySource,
        knowsLong,
        knowsShort,
        hasLong,
        hasShort
      };
    }
    function getActiveCloseGuard(symbol = getCurrentSymbol()) {
      return closeGuard && closeGuard.symbol === symbol && Date.now() < closeGuard.expiresAt ? closeGuard : null;
    }
    function isCloseSnapshotReady(symbol = getCurrentSymbol()) {
      const guard = getActiveCloseGuard(symbol);
      return !guard || guard.snapshotReady;
    }
    function resolveDisplayCloseState(rawCloseContext, symbol) {
      const cache = symbol && lastConfirmedCloseState?.symbol === symbol ? lastConfirmedCloseState : null;
      const guard = getActiveCloseGuard(symbol);
      const transitionPending = Boolean(guard && !guard.snapshotReady);
      const {
        longQty,
        shortQty,
        isUsingCache,
        shouldCommit
      } = resolveCloseDisplayQuantities({
        rawLongQty: rawCloseContext.longQty,
        rawShortQty: rawCloseContext.shortQty,
        cachedLongQty: cache?.longQty ?? null,
        cachedShortQty: cache?.shortQty ?? null,
        transitionPending
      });
      const isPending = transitionPending || !rawCloseContext.knowsLong && !rawCloseContext.knowsShort;
      const knowsLong = longQty != null;
      const knowsShort = shortQty != null;
      const hasLong = longQty > 0;
      const hasShort = shortQty > 0;
      if (symbol && rawCloseContext.symbol === symbol && isCurrentObservedSymbol(symbol) && getActiveTradeMode() === "CLOSE" && shouldCommit) {
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
    function findAccountPositionTab2() {
      return findAccountPositionTab(document, { isVisibleElement });
    }
    function readAccountPositionCount() {
      const tab = findAccountPositionTab2();
      return tab ? parseAccountPositionTabCount(tab.textContent) : null;
    }
    function readCurrentLeverageFromDom() {
      const leverageButton = findCurrentLeverageButtonFromScopes(getTradeSearchScopes(), {
        panelId: PANEL_ID,
        isVisibleElement
      });
      return parseLeverageButtonText(leverageButton?.textContent);
    }
    async function waitForBncHeaders(symbol) {
      if (cachedBncHeaders) return true;
      await Promise.race([
        bncHeadersReady,
        delay(BNC_HEADERS_READY_TIMEOUT_MS)
      ]);
      return Boolean(cachedBncHeaders && isCurrentObservedSymbol(symbol));
    }
    async function fetchCurrentPositionsPayload() {
      if (!cachedBncHeaders) throw new Error("币安请求头尚未就绪");
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 5e3);
      try {
        const resp = await fetch(`${window.location.origin}${BINANCE_USER_POSITION_BAPI_PATH}`, {
          method: "POST",
          headers: getBncHeaders(),
          body: JSON.stringify({}),
          credentials: "include",
          signal: controller.signal
        });
        if (!resp.ok) {
          const error = new Error(`持仓接口异常：HTTP ${resp.status}`);
          error.httpStatus = resp.status;
          error.retryAfter = resp.headers.get("retry-after");
          throw error;
        }
        return await resp.json();
      } finally {
        window.clearTimeout(timer);
      }
    }
    async function fetchUsdtRebalanceBapi(path, options = {}) {
      if (!cachedBncHeaders) throw new Error("币安请求头尚未就绪");
      const method = options.method || "GET";
      const controller = new AbortController();
      const timer = window.setTimeout(
        () => controller.abort(),
        USDT_REBALANCE_REQUEST_TIMEOUT_MS
      );
      try {
        const request = {
          method,
          headers: getBncHeaders(),
          credentials: "include",
          signal: controller.signal
        };
        if (Object.hasOwn(options, "body")) request.body = JSON.stringify(options.body);
        const response = await fetch(`${window.location.origin}${path}`, request);
        if (response.status === 401) throw new Error("Binance 登录态已失效");
        if (!response.ok) throw new Error(`${options.label || "Binance 接口"}异常：HTTP ${response.status}`);
        return await response.json();
      } finally {
        window.clearTimeout(timer);
      }
    }
    async function readCurrentUsdtRebalanceBalances() {
      const [walletPayload, futuresPayload] = await Promise.all([
        fetchUsdtRebalanceBapi(BINANCE_WALLET_BALANCE_BAPI_PATH, {
          label: "钱包余额接口"
        }),
        fetchUsdtRebalanceBapi(BINANCE_FUTURES_MAX_WITHDRAW_BAPI_PATH, {
          method: "POST",
          body: { assetName: "USDT" },
          label: "U本位可划转余额接口"
        })
      ]);
      return withFuturesTransferableBalance(
        parseUsdtWalletBalances(walletPayload),
        futuresPayload
      );
    }
    async function assertUsdtRebalanceTradingState() {
      if (!isFuturesTradingPage() || document.hidden) throw new Error("当前不在可操作的合约页面");
      if (ladderTask || continuousLadderTask || singleOrderTask || cancelCurrentSymbolOpenOrdersTask) {
        throw new Error("当前仍有交易任务运行");
      }
      const positionCount = readAccountPositionCount();
      if (positionCount == null) throw new Error("未读取到全账户持仓数量");
      if (positionCount !== 0) throw new Error("全账户仍有持仓");
      const openOrdersCount = getOpenOrdersTabCount();
      if (openOrdersCount == null) throw new Error("未读取到全账户当前委托数量");
      if (openOrdersCount !== 0) throw new Error("全账户仍有当前委托");
      const positionState = resolveAllFuturesPositionStatus(await fetchCurrentPositionsPayload());
      if (positionState.status !== "flat") throw new Error("全账户仍有持仓");
    }
    function buildUsdtRebalanceDialogModel(plan) {
      const accountLabels = {
        FUNDING: localizedText("资金", "Funding"),
        MAIN: localizedText("现货", "Spot"),
        UMFUTURE: localizedText("U本位合约", "USDⓈ-M Futures")
      };
      const accountCodes = ["FUNDING", "MAIN", "UMFUTURE"];
      return {
        title: ui(PANEL_COPY.action.accountRebalance),
        targetSummary: ui(PANEL_COPY.rebalanceDialog.targetSummary),
        accountHeading: ui(PANEL_COPY.rebalanceDialog.accountHeading),
        currentHeading: ui(PANEL_COPY.rebalanceDialog.currentHeading),
        targetHeading: ui(PANEL_COPY.rebalanceDialog.targetHeading),
        transferHeading: ui(PANEL_COPY.rebalanceDialog.transferHeading),
        balanceRows: accountCodes.map((accountCode) => ({
          account: ui(accountLabels[accountCode]),
          current: plan.before[accountCode],
          target: plan.targets[accountCode]
        })),
        transferRows: plan.transfers.map((transfer) => ({
          route: `${ui(accountLabels[transfer.from])} → ${ui(accountLabels[transfer.to])}`,
          amount: `${transfer.amount} USDT`
        })),
        question: ui(localizedText(
          `确认执行 ${plan.transfers.length} 笔划转？`,
          `Confirm ${plan.transfers.length} transfer${plan.transfers.length === 1 ? "" : "s"}?`
        )),
        cancelLabel: ui(PANEL_COPY.rebalanceDialog.cancel),
        confirmLabel: ui(PANEL_COPY.rebalanceDialog.confirm)
      };
    }
    async function submitUsdtRebalanceTransfer(transfer) {
      const payload = await fetchUsdtRebalanceBapi(BINANCE_WALLET_TRANSFER_BAPI_PATH, {
        method: "POST",
        body: {
          asset: "USDT",
          amount: transfer.amount,
          kindType: transfer.kindType
        },
        label: "USDT 划转接口"
      });
      if (payload?.success !== true) throw new Error(payload?.message || "USDT 划转失败");
      return payload;
    }
    async function waitForUsdtRebalanceBalances(expectedBalances) {
      const deadline = Date.now() + USDT_REBALANCE_REQUEST_TIMEOUT_MS;
      while (true) {
        const actualBalances = await readCurrentUsdtRebalanceBalances();
        if (areUsdtBalancesEqual(actualBalances, expectedBalances)) return actualBalances;
        if (Date.now() >= deadline) throw new Error("划转后账户余额未及时更新");
        await delay(USDT_REBALANCE_BALANCE_POLL_MS);
      }
    }
    async function runUsdtRebalance() {
      let plan = null;
      let completed = 0;
      setLadderStatus("正在读取账户再平衡计划");
      try {
        await assertUsdtRebalanceTradingState();
        const initialBalances = await readCurrentUsdtRebalanceBalances();
        plan = buildUsdtRebalancePlan(initialBalances);
        if (plan.transfers.length === 0) {
          usdtRebalanceEligible = false;
          setLadderStatus("USDT 已按 5:4:1 分配");
          return { status: "already_balanced", plan };
        }
        if (!await showUsdtRebalanceDialog(document, buildUsdtRebalanceDialogModel(plan))) {
          setLadderStatus("账户再平衡已取消");
          return { status: "cancelled", plan };
        }
        let expectedBalances = initialBalances;
        for (const transfer of plan.transfers) {
          await assertUsdtRebalanceTradingState();
          const currentBalances = await readCurrentUsdtRebalanceBalances();
          if (!areUsdtBalancesEqual(currentBalances, expectedBalances)) {
            throw new Error("账户余额已变化，已停止账户再平衡");
          }
          setLadderStatus(`账户再平衡中 · ${completed + 1}/${plan.transfers.length} 笔`);
          await submitUsdtRebalanceTransfer(transfer);
          completed += 1;
          expectedBalances = applyUsdtTransferToBalances(expectedBalances, transfer);
          await waitForUsdtRebalanceBalances(expectedBalances);
        }
        usdtRebalanceEligible = false;
        setLadderStatus(`账户再平衡已完成 · ${completed}/${plan.transfers.length} 笔`);
        return { status: "completed", plan, completed };
      } catch (error) {
        const message = error?.name === "AbortError" ? "Binance 请求超时" : error?.message || String(error);
        const prefix = completed > 0 && plan ? `账户再平衡部分完成 · ${completed}/${plan.transfers.length} 笔` : "账户再平衡失败";
        setLadderStatus(`${prefix} · ${message}`, message);
        throw error;
      }
    }
    function startUsdtRebalance() {
      if (usdtRebalanceTask || !usdtRebalanceEligible) return usdtRebalanceTask;
      let task = null;
      task = runUsdtRebalance().catch((error) => {
        err("USDT 再平衡失败:", error);
        return { status: "failed", error };
      }).finally(() => {
        if (usdtRebalanceTask !== task) return;
        usdtRebalanceTask = null;
        scheduleRenderPanel();
      });
      usdtRebalanceTask = task;
      scheduleRenderPanel();
      return task;
    }
    async function fetchCurrentSymbolPositionState(symbol) {
      const payload = await fetchCurrentPositionsPayload();
      return {
        ...resolveSymbolPositionStatus(payload, symbol),
        source: "user_position_api"
      };
    }
    async function fetchCurrentSymbolPositionSideState(symbol, side) {
      const payload = await fetchCurrentPositionsPayload();
      return {
        ...resolveSymbolPositionSideStatus(payload, symbol, side),
        source: "user_position_api"
      };
    }
    function isStableOpenContext(symbol) {
      return getActiveTradeMode() === "OPEN" && isCurrentObservedSymbol(symbol);
    }
    async function autoResetOpenLeverageToDefault(symbol, triggerSource) {
      if (!isStableOpenContext(symbol)) return false;
      if (!await waitForBncHeaders(symbol)) {
        log("bapi header 尚未缓存，跳过杠杆重置", symbol);
        return false;
      }
      if (!isStableOpenContext(symbol)) return false;
      const currentLeverage = readCurrentLeverageFromDom();
      if (currentLeverage === DEFAULT_OPEN_LEVERAGE) {
        log("开仓杠杆已是默认值", symbol, `${DEFAULT_OPEN_LEVERAGE}x`, triggerSource);
        return true;
      }
      if (!isStableOpenContext(symbol)) return false;
      const finalPositionState = await fetchCurrentSymbolPositionState(symbol);
      if (!isStableOpenContext(symbol)) return false;
      if (finalPositionState.status !== "flat") {
        log("当前币种仍有持仓，跳过杠杆重置", symbol, finalPositionState.source);
        return false;
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
        finalPositionState.source
      );
      return true;
    }
    function queueAutoOpenLeverageReset(triggerSource) {
      const symbol = getCurrentSymbol();
      if (!isCurrentObservedSymbol(symbol)) return;
      if (autoOpenLeverageTask) {
        pendingAutoOpenLeverageReset = { symbol, triggerSource };
        return;
      }
      if (!isStableOpenContext(symbol)) return;
      const now = Date.now();
      if (lastAutoOpenLeverage.symbol === symbol && now - lastAutoOpenLeverage.at < AUTO_OPEN_LEVERAGE_DEDUPE_MS) {
        return;
      }
      lastAutoOpenLeverage = { symbol, at: now };
      let task = null;
      task = autoResetOpenLeverageToDefault(symbol, triggerSource).catch((e) => {
        err("自动重置开仓杠杆失败:", e);
        return false;
      }).finally(() => {
        if (autoOpenLeverageTask !== task) return;
        autoOpenLeverageTask = null;
        const pending = pendingAutoOpenLeverageReset;
        pendingAutoOpenLeverageReset = null;
        if (pending && isCurrentObservedSymbol(pending.symbol)) {
          queueAutoOpenLeverageReset(pending.triggerSource);
        }
      });
      autoOpenLeverageTask = task;
    }
    async function runAutoOpenLeveragePositionCheck(symbol, triggerSource, resetIfFlat) {
      if (!await waitForBncHeaders(symbol)) {
        log("bapi header 尚未缓存，跳过持仓检查", symbol, triggerSource);
        return false;
      }
      if (!isCurrentObservedSymbol(symbol)) return false;
      const positionState = await fetchCurrentSymbolPositionState(symbol);
      if (!isCurrentObservedSymbol(symbol)) return false;
      const observation = observeAutoOpenLeveragePositionState(
        lastObservedAccountPositionState,
        { symbol, status: positionState.status }
      );
      lastObservedAccountPositionState = observation.state;
      if (positionState.status === "flat" && isStableOpenContext(symbol) && (observation.shouldReset || resetIfFlat)) {
        queueAutoOpenLeverageReset(triggerSource);
      }
      return true;
    }
    function queueAutoOpenLeveragePositionCheck(triggerSource, options = {}) {
      const symbol = getCurrentSymbol();
      if (!isCurrentObservedSymbol(symbol)) return;
      const resetIfFlat = options.resetIfFlat === true;
      if (autoOpenLeveragePositionCheckTask) {
        const pending = pendingAutoOpenLeveragePositionCheck;
        pendingAutoOpenLeveragePositionCheck = {
          symbol,
          triggerSource,
          resetIfFlat: resetIfFlat || pending?.symbol === symbol && pending.resetIfFlat
        };
        return;
      }
      let task = null;
      task = runAutoOpenLeveragePositionCheck(symbol, triggerSource, resetIfFlat).catch((e) => {
        err("自动检查当前币种持仓失败:", e);
        return false;
      }).finally(() => {
        if (autoOpenLeveragePositionCheckTask !== task) return;
        autoOpenLeveragePositionCheckTask = null;
        const pending = pendingAutoOpenLeveragePositionCheck;
        pendingAutoOpenLeveragePositionCheck = null;
        if (pending && isCurrentObservedSymbol(pending.symbol)) {
          queueAutoOpenLeveragePositionCheck(pending.triggerSource, {
            resetIfFlat: pending.resetIfFlat
          });
        }
      });
      autoOpenLeveragePositionCheckTask = task;
    }
    function invalidateUsdtRebalanceEligibility() {
      const hadPendingTimer = usdtRebalanceEligibilityTimer !== 0;
      const wasEligible = usdtRebalanceEligible;
      window.clearTimeout(usdtRebalanceEligibilityTimer);
      usdtRebalanceEligibilityTimer = 0;
      usdtRebalanceEligibilityEpoch += 1;
      if (!usdtRebalanceTask) usdtRebalanceEligible = false;
      const resetFlatStatus = !usdtRebalanceTask && ladderStatusText === PANEL_COPY.state.allPositionsClosed;
      if (resetFlatStatus) {
        setLadderStatus(PANEL_COPY.state.idle);
      }
      if (hadPendingTimer || wasEligible || resetFlatStatus) scheduleRenderPanel();
    }
    async function confirmUsdtRebalanceEligibility(epoch) {
      if (epoch !== usdtRebalanceEligibilityEpoch || document.hidden) return false;
      if (readAccountPositionCount() !== 0 || getOpenOrdersTabCount() !== 0) return false;
      if (ladderTask || continuousLadderTask || singleOrderTask || cancelCurrentSymbolOpenOrdersTask) {
        return false;
      }
      const symbol = getCurrentSymbol();
      if (!symbol || !await waitForBncHeaders(symbol)) return false;
      const positionState = resolveAllFuturesPositionStatus(await fetchCurrentPositionsPayload());
      if (epoch !== usdtRebalanceEligibilityEpoch) return false;
      if (positionState.status !== "flat") return false;
      usdtRebalanceEligible = true;
      setLadderStatus(PANEL_COPY.state.allPositionsClosed);
      scheduleRenderPanel();
      return true;
    }
    function scheduleUsdtRebalanceEligibility() {
      invalidateUsdtRebalanceEligibility();
      const epoch = usdtRebalanceEligibilityEpoch;
      usdtRebalanceEligibilityTimer = window.setTimeout(() => {
        usdtRebalanceEligibilityTimer = 0;
        let task = null;
        task = confirmUsdtRebalanceEligibility(epoch).catch((error) => {
          log("USDT 再平衡资格检查未通过", error?.message || error);
          return false;
        }).finally(() => {
          if (usdtRebalanceEligibilityTask === task) usdtRebalanceEligibilityTask = null;
        });
        usdtRebalanceEligibilityTask = task;
      }, USDT_REBALANCE_FLAT_STABLE_MS);
    }
    function updateUsdtRebalanceEligibilityFromAccountCounts(positionCount, openOrdersCount) {
      if (positionCount === 0 && openOrdersCount === 0) {
        scheduleUsdtRebalanceEligibility();
        return;
      }
      invalidateUsdtRebalanceEligibility();
    }
    function handleAccountPositionObservation(triggerSource) {
      const positionCount = readAccountPositionCount();
      const openOrdersCount = getOpenOrdersTabCount();
      const positionChanged = positionCount !== lastObservedAccountPositionCount;
      const openOrdersChanged = openOrdersCount !== lastObservedAccountOpenOrdersCount;
      if (!positionChanged && !openOrdersChanged) return;
      lastObservedAccountPositionCount = positionCount;
      lastObservedAccountOpenOrdersCount = openOrdersCount;
      if (positionChanged && positionCount != null) {
        queueAutoOpenLeveragePositionCheck(triggerSource);
      }
      updateUsdtRebalanceEligibilityFromAccountCounts(positionCount, openOrdersCount);
    }
    function getAccountPositionObserverRoot() {
      const positionTab = findAccountPositionTab2();
      return positionTab ? getAccountOrdersTabGroup2(positionTab) : null;
    }
    function stopAccountPositionObserver() {
      if (accountPositionObserver) {
        accountPositionObserver.disconnect();
        accountPositionObserver = null;
      }
      accountPositionObserverRoot = null;
      lastObservedAccountPositionCount = null;
      lastObservedAccountOpenOrdersCount = null;
      invalidateUsdtRebalanceEligibility();
    }
    function ensureAccountPositionObserver() {
      if (document.hidden || !isFuturesTradingPage()) return;
      const root = getAccountPositionObserverRoot();
      if (!root) {
        stopAccountPositionObserver();
        return;
      }
      if (accountPositionObserver && accountPositionObserverRoot === root && root.isConnected) return;
      stopAccountPositionObserver();
      accountPositionObserverRoot = root;
      accountPositionObserver = new MutationObserver(() => {
        handleAccountPositionObservation("account_position_mutation");
      });
      accountPositionObserver.observe(root, {
        subtree: true,
        childList: true,
        characterData: true
      });
      handleAccountPositionObservation("account_position_ready");
    }
    function applyCachedCloseUiState() {
      if (getActiveTradeMode() !== "CLOSE") return false;
      const cache = getCachedCloseState(getCurrentSymbol());
      if (!cache) return false;
      renderPanel();
      return true;
    }
    function resolveCloseAction() {
      const currentSymbol = getCurrentSymbol();
      if (!isCloseSnapshotReady(currentSymbol)) return null;
      const rawCloseContext = readCloseContext(currentSymbol);
      if (!isCurrentObservedSymbol(currentSymbol) || rawCloseContext.symbol !== currentSymbol) return null;
      const direction = resolveConfirmedCloseDirection(rawCloseContext, loadCloseSide());
      if (!direction) return null;
      const { longQty, shortQty, qtySource, hasLong, hasShort, closeLongBtn, closeShortBtn } = rawCloseContext;
      const dual = hasLong && hasShort;
      return direction === "SHORT" ? { side: "平空", button: closeShortBtn, by: dual ? "dual_panel" : "single_short", longQty, shortQty, qtySource } : { side: "平多", button: closeLongBtn, by: dual ? "dual_panel" : "single_long", longQty, shortQty, qtySource };
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
      return parseFuturesTradingSymbolFromPathname(location.pathname);
    }
    function isCurrentObservedSymbol(symbol) {
      return !!symbol && getCurrentSymbol() === symbol && lastObservedSymbol === symbol;
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
    function multiplierKey(mode, symbol, precision) {
      return modeSymbolPrecisionOptionStorageKey(
        MULTIPLIER_STORAGE_KEYS,
        mode,
        symbol || getCurrentSymbol(),
        precision
      );
    }
    function loadMultiplier(mode, symbol, precision = readCurrentOrderbookPrecisionValue()) {
      const key = multiplierKey(mode || getActiveTradeMode(), symbol, precision);
      if (!key) return null;
      const value = localStorage.getItem(key);
      return isValidMultiplier(value) ? String(value) : DEFAULT_MULTIPLIER;
    }
    function saveMultiplier(value, mode, symbol, precision) {
      const key = multiplierKey(mode || getActiveTradeMode(), symbol, precision);
      if (!key) return false;
      localStorage.setItem(key, value);
      return true;
    }
    function sanitizeMultiplier(value) {
      return isValidMultiplier(value) ? String(value).trim() : DEFAULT_MULTIPLIER;
    }
    function getPanelOptionContext() {
      const context = {
        symbol: getCurrentSymbol(),
        mode: getActiveTradeMode(),
        precision: readCurrentOrderbookPrecisionValue()
      };
      return context.symbol && context.precision && ["OPEN", "CLOSE"].includes(context.mode) ? context : null;
    }
    function beginMultiplierEdit() {
      multiplierEditContext = getPanelOptionContext();
      if (!multiplierEditContext) return false;
      isEditingMultiplier = true;
      return true;
    }
    function isMultiplierEditContextCurrent(context = multiplierEditContext) {
      return !!context && isCurrentObservedSymbol(context.symbol) && getActiveTradeMode() === context.mode && context.precision === readCurrentOrderbookPrecisionValue();
    }
    function stopMultiplierEdit() {
      multiplierEditContext = null;
      isEditingMultiplier = false;
    }
    function updateMultiplier(nextValue, context) {
      if (!context) return false;
      if (!isCurrentObservedSymbol(context.symbol) || getActiveTradeMode() !== context.mode || context.precision !== readCurrentOrderbookPrecisionValue()) return false;
      const input = document.getElementById(INPUT_ID);
      const normalized = sanitizeMultiplier(nextValue);
      stopMultiplierEdit();
      saveMultiplier(normalized, context.mode, context.symbol, context.precision);
      if (input) input.value = normalized;
      renderPanel();
      return true;
    }
    function showMultiplierPressFeedback(button) {
      const existingTimer = multiplierPressFeedbackTimers.get(button);
      if (existingTimer) window.clearTimeout(existingTimer);
      button.setAttribute(MULTIPLIER_PRESS_FEEDBACK_ATTR, "true");
      const timer = window.setTimeout(() => {
        button.removeAttribute(MULTIPLIER_PRESS_FEEDBACK_ATTR);
        multiplierPressFeedbackTimers.delete(button);
      }, MULTIPLIER_PRESS_FEEDBACK_MS);
      multiplierPressFeedbackTimers.set(button, timer);
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
      const activeStyle = selected ? `border-color:var(--color-PrimaryYellow);background:var(--color-BadgeBg);color:${PRIMARY_EMPHASIS_COLOR};font-weight:${PRIMARY_EMPHASIS_FONT_WEIGHT};` : NEUTRAL_CONTROL_STYLE;
      return `<button type="button" data-ladder-group="${group}" data-ladder-value="${value}" style="box-sizing:border-box;width:100%;min-width:0;height:28px;padding:0;border-radius:6px;border:1px solid ${CONTROL_BORDER_COLOR};font-size:13px;line-height:26px;cursor:pointer;${activeStyle}">${label}</button>`;
    }
    function ladderOptionRow(title, tooltip, options, selected, group, suffix = "") {
      return [
        `<div style="display:grid;grid-template-columns:${activeUiLocale === "en" ? "52px" : "36px"} repeat(5,minmax(0,1fr));align-items:center;gap:4px;height:34px;margin-top:6px;overflow:hidden;">`,
        `<span title="${ui(tooltip)}" style="color:${MUTED_TEXT_COLOR};font-size:13px;white-space:nowrap;cursor:help;">${ui(title)}</span>`,
        ...options.map((value) => ladderOptionButton(`${value}${suffix}`, value, Number(value) === Number(selected), group)),
        "</div>"
      ].join("");
    }
    function ladderActionButton(actionType, label, tone, disabled = false) {
      const isBuyTone = tone === "BUY";
      const borderColor = isBuyTone ? "var(--color-Buy)" : "var(--color-Sell)";
      const background = isBuyTone ? "var(--color-GreenAlpha01)" : "var(--color-RedAlpha01)";
      const disabledAttrs = disabled ? ' disabled aria-disabled="true"' : "";
      const continuousHint = actionType.startsWith("CLOSE_") ? ` title="${ui(PANEL_COPY.tooltip.continuousClose)}"` : "";
      const cursor = disabled ? "not-allowed" : "pointer";
      return `<button type="button" data-ladder-action="${actionType}"${disabledAttrs}${continuousHint} style="min-width:0;height:${LADDER_CONTROL_BUTTON_HEIGHT}px;border:1px solid ${borderColor};border-radius:6px;background:${background};color:${borderColor};font-size:${LADDER_CONTROL_BUTTON_FONT_SIZE}px;font-weight:${CONTROL_FONT_WEIGHT};line-height:${LADDER_CONTROL_BUTTON_HEIGHT - 2}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:${cursor};opacity:1;">${ui(label)}</button>`;
    }
    function ladderExecutionButton(actionType, label, tone, disabled = false) {
      const activeActionType = activeLadderActionType || activeContinuousLadderActionType;
      if (activeActionType !== actionType) {
        return ladderActionButton(actionType, label, tone, disabled);
      }
      const stopLabel = PANEL_COPY.action.stopLadderByAction[actionType];
      return `<button type="button" data-ladder-stop="true" data-ladder-action-origin="${actionType}" style="box-sizing:border-box;min-width:0;height:${LADDER_CONTROL_BUTTON_HEIGHT}px;border:1px solid var(--color-PrimaryYellow);border-radius:6px;background:var(--color-BadgeBg);color:#9a6700;font-size:${LADDER_CONTROL_BUTTON_FONT_SIZE}px;font-weight:${CONTROL_FONT_WEIGHT};line-height:${LADDER_CONTROL_BUTTON_HEIGHT - 2}px;white-space:nowrap;overflow:hidden;cursor:pointer;">${ui(stopLabel)}</button>`;
    }
    function getLadderControlSections(tradeMode, closeContext, symbol, precision) {
      const ladderRunning = !!ladderTask || !!continuousLadderTask;
      const actionDisabled = ladderRunning || !!singleOrderTask || cancelCurrentSymbolOpenOrdersBlocksLadderActions;
      if (!["OPEN", "CLOSE"].includes(tradeMode)) {
        return {
          optionRows: [`<div style="margin-top:6px;color:${MUTED_TEXT_COLOR};font-size:12px;">${ui(PANEL_COPY.state.waitingTradeMode)}</div>`],
          actionButtons: []
        };
      }
      if (!precision) {
        return {
          optionRows: [`<div style="margin-top:6px;color:${MUTED_TEXT_COLOR};font-size:12px;">${ui(PANEL_COPY.state.waitingPricePrecision)}</div>`],
          actionButtons: []
        };
      }
      if (tradeMode === "OPEN") {
        return {
          optionRows: [
            ladderOptionRow(PANEL_COPY.field.ratio, PANEL_COPY.tooltip.ratio, LADDER_OPEN_PERCENTS, getLadderOpenPercent(symbol, precision), "percent", "%"),
            ladderOptionRow(PANEL_COPY.field.orderCount, PANEL_COPY.tooltip.orderCount, LADDER_LEVEL_OPTIONS, getLadderLevels(tradeMode, symbol, precision), "levels", ""),
            ladderOptionRow(PANEL_COPY.field.interval, PANEL_COPY.tooltip.interval, LADDER_STEP_OPTIONS, getLadderStep(tradeMode, symbol, precision), "step", "")
          ],
          actionButtons: [
            ladderExecutionButton("OPEN_LONG", PANEL_COPY.action.openLong, "BUY", actionDisabled),
            ladderExecutionButton("OPEN_SHORT", PANEL_COPY.action.openShort, "SELL", actionDisabled)
          ]
        };
      }
      const closeLongDisabled = shouldDisableCloseControl({
        actionDisabled,
        knowsPosition: closeContext?.knowsLong,
        hasPosition: closeContext?.hasLong
      });
      const closeShortDisabled = shouldDisableCloseControl({
        actionDisabled,
        knowsPosition: closeContext?.knowsShort,
        hasPosition: closeContext?.hasShort
      });
      return {
        optionRows: [
          ladderOptionRow(PANEL_COPY.field.ratio, PANEL_COPY.tooltip.ratio, LADDER_CLOSE_PERCENTS, getLadderClosePercent(symbol, precision), "percent", "%"),
          ladderOptionRow(PANEL_COPY.field.orderCount, PANEL_COPY.tooltip.orderCount, LADDER_LEVEL_OPTIONS, getLadderLevels(tradeMode, symbol, precision), "levels", ""),
          ladderOptionRow(PANEL_COPY.field.interval, PANEL_COPY.tooltip.interval, LADDER_STEP_OPTIONS, getLadderStep(tradeMode, symbol, precision), "step", "")
        ],
        actionButtons: [
          ladderExecutionButton(
            "CLOSE_LONG",
            PANEL_COPY.action.closeLong,
            "SELL",
            closeLongDisabled
          ),
          ladderExecutionButton(
            "CLOSE_SHORT",
            PANEL_COPY.action.closeShort,
            "BUY",
            closeShortDisabled
          )
        ]
      };
    }
    function refreshLadderPanel(panel, tradeMode, closeContext) {
      const body = panel.querySelector(`#${LADDER_BODY_ID}`);
      const status = panel.querySelector(`#${LADDER_STATUS_ID}`);
      const statusRow = panel.querySelector(`#${LADDER_STATUS_ROW_ID}`);
      const rebalanceButton = panel.querySelector(`#${USDT_REBALANCE_ACTION_ID}`);
      const mode = activeLadderPanelContext?.mode || (["OPEN", "CLOSE"].includes(tradeMode) ? tradeMode : null);
      const symbol = activeLadderPanelContext?.symbol || getCurrentSymbol();
      const precision = activeLadderPanelContext?.precision || readCurrentOrderbookPrecisionValue();
      if (body) {
        const ladderRunning = !!ladderTask || !!continuousLadderTask;
        const singleOrderRunning = !!singleOrderTask;
        const cancelRunning = !!cancelCurrentSymbolOpenOrdersTask;
        const cancelPresentation = resolveCancelSymbolButtonPresentation({
          ladderRunning: ladderRunning || singleOrderRunning,
          cancelRunning,
          noOrdersFeedback: cancelNoOrdersFeedbackActive
        });
        const controlSections = getLadderControlSections(mode, closeContext, symbol, precision);
        const bodyHtml = [
          ...controlSections.optionRows,
          `<div id="${ORDERBOOK_PRECISION_RECOMMENDATION_ID}" data-panel-group="precision"></div>`,
          '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;margin-top:12px;">',
          ...controlSections.actionButtons,
          `<button type="button" data-ladder-cancel-symbol="true" style="min-width:0;height:${LADDER_CONTROL_BUTTON_HEIGHT}px;border:1px solid ${CONTROL_BORDER_COLOR};border-radius:6px;font-size:${LADDER_CONTROL_BUTTON_FONT_SIZE}px;line-height:${LADDER_CONTROL_BUTTON_HEIGHT - 2}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${NEUTRAL_CONTROL_STYLE}">${ui(PANEL_COPY.action.cancel)}</button>`,
          "</div>"
        ].join("");
        if (ladderPanelBodySignature !== bodyHtml) {
          body.innerHTML = bodyHtml;
          ladderPanelBodySignature = bodyHtml;
        }
        const cancelButton = body.querySelector('[data-ladder-cancel-symbol="true"]');
        if (cancelButton) {
          const cancelLabel = ui(cancelPresentation.label);
          if (cancelButton.textContent !== cancelLabel) {
            cancelButton.textContent = cancelLabel;
          }
          if (cancelButton.disabled !== cancelPresentation.disabled) {
            cancelButton.disabled = cancelPresentation.disabled;
          }
          if (cancelPresentation.disabled) {
            if (cancelButton.getAttribute("aria-disabled") !== "true") {
              cancelButton.setAttribute("aria-disabled", "true");
            }
          } else if (cancelButton.hasAttribute("aria-disabled")) {
            cancelButton.removeAttribute("aria-disabled");
          }
        }
      }
      if (statusRow) {
        if (statusRow.style.visibility !== "visible") statusRow.style.visibility = "visible";
      }
      if (status) {
        const renderedText = ui(ladderStatusText);
        const renderedTitle = ui(ladderStatusTitle);
        if (status.textContent !== renderedText) status.textContent = renderedText;
        if (status.title !== renderedTitle) status.title = renderedTitle;
      }
      if (rebalanceButton) {
        const shouldShow = usdtRebalanceEligible || Boolean(usdtRebalanceTask);
        const hidden = !shouldShow;
        if (rebalanceButton.hidden !== hidden) rebalanceButton.hidden = hidden;
        const disabled = Boolean(usdtRebalanceTask);
        if (rebalanceButton.disabled !== disabled) rebalanceButton.disabled = disabled;
        if (disabled) rebalanceButton.setAttribute("aria-disabled", "true");
        else rebalanceButton.removeAttribute("aria-disabled");
      }
    }
    function refreshComputedInfo(panel, multiplier, qtyRuleContext) {
      const input = panel.querySelector(`#${INPUT_ID}`);
      const minEl = panel.querySelector("#jh-binance-close-qty-min");
      const finalEl = panel.querySelector("#jh-binance-close-qty-final");
      const formulaPrefixEl = panel.querySelector("[data-multiplier-formula-prefix]");
      const constraintDividerEl = panel.querySelector("[data-multiplier-constraint-divider]");
      const calculationEl = panel.querySelector("[data-multiplier-calculation]");
      const hintEl = panel.querySelector(`#${MODE_HINT_ID}`);
      const multiplierHintEl = panel.querySelector(`#${MULTIPLIER_HINT_ID}`);
      const decBtn = panel.querySelector(`#${DEC_ID}`);
      const incBtn = panel.querySelector(`#${INC_ID}`);
      const sideLongBtn = panel.querySelector(`#${SIDE_LONG_ID}`);
      const sideShortBtn = panel.querySelector(`#${SIDE_SHORT_ID}`);
      const tradeMode = getActiveTradeMode();
      const modeReady = ["OPEN", "CLOSE"].includes(tradeMode);
      const precisionReady = Boolean(readCurrentOrderbookPrecisionValue());
      const numericContextReady = modeReady && precisionReady;
      const rulesPending = qtyRuleContext?.status !== "ready";
      const effectiveMinQty = rulesPending ? null : qtyRuleContext?.effectiveMinQty || null;
      const finalQty = effectiveMinQty ? multiplyDecimalByInt(effectiveMinQty, multiplier) : null;
      const closeSide = loadCloseSide();
      const openSide = loadOpenSide();
      const rawCloseContext = readCloseContext();
      const closeContext = resolveDisplayCloseState(rawCloseContext, getCurrentSymbol());
      const { knowsLong, knowsShort, hasLong, hasShort, isUsingCache } = closeContext;
      const rawCloseReady = !closeContext.isPending && rawCloseContext.knowsLong && rawCloseContext.knowsShort;
      const closeMode = hasLong && hasShort ? "dual" : hasLong ? "single_long" : hasShort ? "single_short" : "unknown";
      let formulaPrefixText = "";
      let finalText = "";
      let constraintText = "";
      if (!precisionReady) {
        finalText = ui(PANEL_COPY.state.waitingPricePrecision);
      } else if (!modeReady) {
        finalText = ui(PANEL_COPY.state.waitingTradeMode);
      } else if (rulesPending || !effectiveMinQty) {
        finalText = ui(PANEL_COPY.state.minimumQuantityLoading);
      } else if (isValidMultiplier(multiplier) && finalQty) {
        formulaPrefixText = `${effectiveMinQty} × ${multiplier} =`;
        finalText = finalQty;
        if (tradeMode === "OPEN" && qtyRuleContext?.minNotionalQty && qtyRuleContext?.referencePrice) {
          constraintText = `≥${qtyRuleContext.minNotional}U @ ${qtyRuleContext.referencePrice}`;
        }
      } else {
        finalText = ui(PANEL_COPY.state.positiveIntegerMultiplier);
      }
      if (formulaPrefixEl) {
        if (formulaPrefixEl.textContent !== formulaPrefixText) {
          formulaPrefixEl.textContent = formulaPrefixText;
        }
        formulaPrefixEl.style.display = formulaPrefixText ? "inline" : "none";
      }
      if (finalEl) {
        if (finalEl.textContent !== finalText) finalEl.textContent = finalText;
        finalEl.style.color = formulaPrefixText ? PRIMARY_EMPHASIS_COLOR : MUTED_TEXT_COLOR;
      }
      if (constraintDividerEl) {
        constraintDividerEl.style.display = constraintText ? "block" : "none";
      }
      if (minEl) {
        if (minEl.textContent !== constraintText) minEl.textContent = constraintText;
        minEl.style.display = constraintText ? "block" : "none";
      }
      if (calculationEl) {
        const calculationTitle = [formulaPrefixText, finalText, constraintText].filter(Boolean).join(" ");
        if (calculationEl.title !== calculationTitle) calculationEl.title = calculationTitle;
      }
      let multiplierHintText = PANEL_COPY.field.minimumOrderQuantity;
      if (multiplierHintEl) {
        if (tradeMode === "OPEN") {
          multiplierHintText = PANEL_COPY.field.minimumOpenQuantity;
        } else if (tradeMode === "CLOSE") {
          multiplierHintText = PANEL_COPY.field.minimumCloseQuantity;
        }
        const renderedMultiplierHint = ui(multiplierHintText);
        if (multiplierHintEl.textContent !== renderedMultiplierHint) {
          multiplierHintEl.textContent = renderedMultiplierHint;
        }
      }
      let hintText = ui(PANEL_COPY.field.clickOrderbook);
      let hintTitle = "";
      if (hintEl) {
        if (tradeMode === "OPEN") {
          const action = openSide === "LONG" ? PANEL_COPY.side.openLong : PANEL_COPY.side.openShort;
          hintTitle = ui(localizedText(
            `开仓模式：单击订单簿价格后将${CFG.SAFE_MODE ? "填数量" : formatLocalizedText(action, "zh-CN")}`,
            `Open mode: clicking an order-book price will ${CFG.SAFE_MODE ? "fill the quantity" : formatLocalizedText(action, "en")}`
          ));
        } else if (!rawCloseReady) {
          hintTitle = ui(isUsingCache ? localizedText(
            "平仓模式：正在确认可平仓位，暂沿用上次识别结果",
            "Close mode: confirming positions; showing the last known result"
          ) : localizedText("平仓模式：正在确认可平仓位", "Close mode: confirming positions"));
        } else if (closeMode === "single_long") {
          hintTitle = ui(localizedText(
            `平仓模式：当前仅有多仓，单击订单簿价格后将${CFG.SAFE_MODE ? "填数量" : "平多"}`,
            `Close mode: long position only; clicking an order-book price will ${CFG.SAFE_MODE ? "fill the quantity" : "close long"}`
          ));
        } else if (closeMode === "single_short") {
          hintTitle = ui(localizedText(
            `平仓模式：当前仅有空仓，单击订单簿价格后将${CFG.SAFE_MODE ? "填数量" : "平空"}`,
            `Close mode: short position only; clicking an order-book price will ${CFG.SAFE_MODE ? "fill the quantity" : "close short"}`
          ));
        } else if (closeMode === "dual") {
          const action = closeSide === "LONG" ? "平多" : "平空";
          const englishAction = closeSide === "LONG" ? "close long" : "close short";
          hintTitle = ui(localizedText(
            `平仓模式：双向持仓时单击订单簿价格后将${CFG.SAFE_MODE ? "填数量" : action}`,
            `Close mode: hedged positions; clicking an order-book price will ${CFG.SAFE_MODE ? "fill the quantity" : englishAction}`
          ));
        } else {
          hintText = ui(PANEL_COPY.state.noClosablePosition);
          hintTitle = ui(localizedText(
            "平仓模式：当前交易对暂无可平仓位",
            "Close mode: no position to close for this symbol"
          ));
        }
        if (hintEl.textContent !== hintText) hintEl.textContent = hintText;
        if (hintEl.title !== hintTitle) hintEl.title = hintTitle;
      }
      if (decBtn) {
        const decrementDisabled = !numericContextReady || Number(multiplier) <= 1;
        if (decBtn.disabled !== decrementDisabled) decBtn.disabled = decrementDisabled;
      }
      if (incBtn) {
        const incrementDisabled = !numericContextReady;
        if (incBtn.disabled !== incrementDisabled) incBtn.disabled = incrementDisabled;
      }
      if (input) {
        const inputDisabled = !numericContextReady;
        if (input.disabled !== inputDisabled) input.disabled = inputDisabled;
        input.style.opacity = input.disabled ? "0.65" : "1";
        input.style.cursor = input.disabled ? "not-allowed" : "text";
      }
      if (sideLongBtn) {
        const isOpenMode = tradeMode === "OPEN";
        const isDisabled = isOpenMode ? false : shouldDisableCloseControl({
          knowsPosition: knowsLong,
          hasPosition: hasLong
        });
        const isActive = isOpenMode ? openSide === "LONG" : closeMode === "single_long" || closeMode !== "single_short" && closeSide === "LONG";
        const sideLongText = ui(localizedText(isOpenMode ? "开多" : "平多", "Long"));
        const sideLongTitle = ui(isOpenMode ? PANEL_COPY.side.openLong : PANEL_COPY.side.closeLong);
        if (sideLongBtn.textContent !== sideLongText) sideLongBtn.textContent = sideLongText;
        if (sideLongBtn.title !== sideLongTitle) sideLongBtn.title = sideLongTitle;
        sideLongBtn.style.order = "0";
        if (sideLongBtn.disabled !== isDisabled) sideLongBtn.disabled = isDisabled;
        if (sideLongBtn.getAttribute("aria-checked") !== String(isActive)) {
          sideLongBtn.setAttribute("aria-checked", String(isActive));
        }
        const desiredTabIndex = isActive ? 0 : -1;
        if (sideLongBtn.tabIndex !== desiredTabIndex) sideLongBtn.tabIndex = desiredTabIndex;
        sideLongBtn.style.boxShadow = isActive && !isDisabled ? `inset 0 0 0 1px ${isOpenMode ? "var(--color-Buy)" : "var(--color-Sell)"}` : "none";
        sideLongBtn.style.background = isActive ? isOpenMode ? "var(--color-GreenAlpha01)" : "var(--color-RedAlpha01)" : CONTROL_BACKGROUND_COLOR;
        sideLongBtn.style.color = isActive ? isOpenMode ? "var(--color-Buy)" : "var(--color-Sell)" : CONTROL_TEXT_COLOR;
      }
      if (sideShortBtn) {
        const isOpenMode = tradeMode === "OPEN";
        const isDisabled = isOpenMode ? false : shouldDisableCloseControl({
          knowsPosition: knowsShort,
          hasPosition: hasShort
        });
        const isActive = isOpenMode ? openSide === "SHORT" : closeMode === "single_short" || closeMode !== "single_long" && closeSide === "SHORT";
        const sideShortText = ui(localizedText(isOpenMode ? "开空" : "平空", "Short"));
        const sideShortTitle = ui(isOpenMode ? PANEL_COPY.side.openShort : PANEL_COPY.side.closeShort);
        if (sideShortBtn.textContent !== sideShortText) sideShortBtn.textContent = sideShortText;
        if (sideShortBtn.title !== sideShortTitle) sideShortBtn.title = sideShortTitle;
        sideShortBtn.style.order = "1";
        if (sideShortBtn.disabled !== isDisabled) sideShortBtn.disabled = isDisabled;
        if (sideShortBtn.getAttribute("aria-checked") !== String(isActive)) {
          sideShortBtn.setAttribute("aria-checked", String(isActive));
        }
        const desiredTabIndex = isActive ? 0 : -1;
        if (sideShortBtn.tabIndex !== desiredTabIndex) sideShortBtn.tabIndex = desiredTabIndex;
        sideShortBtn.style.boxShadow = isActive && !isDisabled ? `inset 0 0 0 1px ${isOpenMode ? "var(--color-Sell)" : "var(--color-Buy)"}` : "none";
        sideShortBtn.style.background = isActive ? isOpenMode ? "var(--color-RedAlpha01)" : "var(--color-GreenAlpha01)" : CONTROL_BACKGROUND_COLOR;
        sideShortBtn.style.color = isActive ? isOpenMode ? "var(--color-Sell)" : "var(--color-Buy)" : CONTROL_TEXT_COLOR;
      }
      syncNativeCloseButtons(tradeMode, rawCloseContext);
      refreshLadderPanel(panel, tradeMode, closeContext);
      refreshOrderbookPrecisionRecommendation(panel);
    }
    function findQtyFormItem(input) {
      if (!input) return null;
      return input.closest('div[target^="unitAmount-"]') || input.closest(".bn-formItem") || input.parentElement || null;
    }
    function ensureSpacer(insertionPoint, panelHeight) {
      let spacer = document.getElementById(SPACER_ID);
      if (!insertionPoint) {
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
      return placeTradePanelSpacer(spacer, insertionPoint) ? spacer : null;
    }
    function placePanelFloating(panel, anchorRect) {
      if (panel.parentElement !== document.body) {
        document.body.appendChild(panel);
      }
      panel.style.position = "fixed";
      panel.style.maxWidth = "none";
      panel.style.margin = "0";
      panel.style.zIndex = String(PANEL_Z_INDEX);
      const layout = calculateFloatingPanelLayout({
        anchorRect,
        panelHeight: panel.offsetHeight || 0,
        viewportWidth: window.innerWidth || document.documentElement.clientWidth || 0,
        viewportHeight: window.innerHeight || document.documentElement.clientHeight || 0
      });
      if (!layout) {
        panel.style.visibility = "hidden";
        panel.style.pointerEvents = "none";
        return;
      }
      panel.style.width = `${layout.width}px`;
      panel.style.left = `${layout.left}px`;
      panel.style.top = `${layout.top}px`;
      panel.style.right = "";
      panel.style.bottom = "";
      panel.style.visibility = "visible";
      panel.style.pointerEvents = "auto";
    }
    function positionPanel(panel) {
      const insertionPoint = findTradePanelInsertionPoint(document);
      const spacer = ensureSpacer(
        insertionPoint,
        Math.max((panel.offsetHeight || 0) + PANEL_BOTTOM_TOOLTIP_GAP, 76)
      );
      const anchorRect = spacer?.getBoundingClientRect() || null;
      placePanelFloating(panel, anchorRect);
      return Boolean(anchorRect?.width && anchorRect?.height);
    }
    function observePanelSize(panel) {
      panelResizeObserver?.disconnect();
      panelObservedSize = "";
      panelResizeObserver = new ResizeObserver((entries) => {
        const entry = entries.find((candidate) => candidate.target === panel);
        if (!entry) return;
        const nextSize = `${Math.round(entry.contentRect.width)}:${Math.round(entry.contentRect.height)}`;
        if (panelObservedSize === nextSize) return;
        panelObservedSize = nextSize;
        panelPositionInvalidated = true;
        scheduleRenderPanel();
      });
      panelResizeObserver.observe(panel);
    }
    function isPanelPositionCurrent(panel) {
      const spacer = document.getElementById(SPACER_ID);
      const insertionPoint = findTradePanelInsertionPoint(document);
      if (!spacer || !insertionPoint || spacer.parentElement !== insertionPoint.parent || spacer.nextElementSibling !== insertionPoint.before) {
        return false;
      }
      const layout = calculateFloatingPanelLayout({
        anchorRect: spacer.getBoundingClientRect(),
        panelHeight: panel.offsetHeight || 0,
        viewportWidth: window.innerWidth || document.documentElement.clientWidth || 0,
        viewportHeight: window.innerHeight || document.documentElement.clientHeight || 0
      });
      return Boolean(
        layout && Number.parseFloat(panel.style.width) === layout.width && Number.parseFloat(panel.style.left) === layout.left && Number.parseFloat(panel.style.top) === layout.top
      );
    }
    function ensurePanel() {
      let panel = document.getElementById(PANEL_ID);
      if (panel) return panel;
      panel = document.createElement("div");
      panel.id = PANEL_ID;
      panel.style.position = "fixed";
      panel.style.zIndex = String(PANEL_Z_INDEX);
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
      const initialStatus = ui(PANEL_COPY.state.idle);
      panel.innerHTML = [
        '<div data-panel-zone="single-order">',
        `<div title="${ui(PANEL_COPY.tooltip.singleOrder)}" style="height:20px;color:${PRIMARY_EMPHASIS_COLOR};font-size:14px;font-weight:${PRIMARY_EMPHASIS_FONT_WEIGHT};line-height:20px;cursor:help;">${ui(PANEL_COPY.section.singleOrder)}</div>`,
        '<div data-panel-group="direction" style="display:flex;align-items:center;justify-content:flex-start;gap:6px;height:32px;overflow:hidden;">',
        `<span id="${MODE_HINT_ID}" style="width:78px;flex:0 0 78px;color:${MUTED_TEXT_COLOR};font-size:13px;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${ui(PANEL_COPY.field.clickOrderbook)}</span>`,
        `<div data-side-selector role="radiogroup" aria-labelledby="${MODE_HINT_ID}" style="box-sizing:border-box;display:grid;grid-template-columns:54px 54px;height:32px;border:1px solid var(--color-InputLine);border-radius:6px;overflow:hidden;background:${CONTROL_BACKGROUND_COLOR};">`,
        `<button id="${SIDE_LONG_ID}" type="button" role="radio" aria-checked="false" style="width:54px;height:30px;padding:0;border:0;border-radius:5px 0 0 5px;background:${CONTROL_BACKGROUND_COLOR};color:${CONTROL_TEXT_COLOR};font-size:14px;font-weight:${CONTROL_FONT_WEIGHT};line-height:30px;cursor:pointer;">${ui(PANEL_COPY.side.long)}</button>`,
        `<button id="${SIDE_SHORT_ID}" type="button" role="radio" aria-checked="false" style="width:54px;height:30px;padding:0;border:0;border-left:1px solid var(--color-InputLine);border-radius:0 5px 5px 0;background:${CONTROL_BACKGROUND_COLOR};color:${CONTROL_TEXT_COLOR};font-size:14px;font-weight:${CONTROL_FONT_WEIGHT};line-height:30px;cursor:pointer;">${ui(PANEL_COPY.side.short)}</button>`,
        "</div>",
        "</div>",
        '<div data-panel-group="multiplier" style="margin-top:8px;">',
        '<div data-multiplier-controls style="display:flex;align-items:center;justify-content:flex-start;gap:6px;height:32px;overflow:hidden;">',
        `<label id="${MULTIPLIER_HINT_ID}" for="${INPUT_ID}" style="color:${MUTED_TEXT_COLOR};font-size:13px;line-height:18px;white-space:nowrap;">${ui(PANEL_COPY.field.minimumOrderQuantity)}</label>`,
        `<input id="${INPUT_ID}" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" style="width:60px;height:32px;padding:0 8px;border-radius:8px;border:1px solid ${INPUT_BORDER_COLOR};background:${INPUT_DEFAULT_BG};color:${PRIMARY_EMPHASIS_COLOR};caret-color:${INPUT_FOCUS_COLOR};outline:none;font-size:15px;font-weight:${PRIMARY_EMPHASIS_FONT_WEIGHT};line-height:32px;transition:border-color .16s ease,background-color .16s ease,box-shadow .16s ease;">`,
        `<span style="font-size:13px;font-weight:${CONTROL_FONT_WEIGHT};color:${CONTROL_TEXT_COLOR};">${ui(PANEL_COPY.field.multiplierUnit)}</span>`,
        `<button id="${DEC_ID}" type="button" aria-label="${ui(PANEL_COPY.aria.decrementMultiplier)}" style="width:32px;height:32px;padding:0;border-radius:6px;border:1px solid ${CONTROL_BORDER_COLOR};font-size:18px;line-height:30px;${NEUTRAL_CONTROL_STYLE}">-</button>`,
        `<button id="${INC_ID}" type="button" aria-label="${ui(PANEL_COPY.aria.incrementMultiplier)}" style="width:32px;height:32px;padding:0;border-radius:6px;border:1px solid ${CONTROL_BORDER_COLOR};font-size:18px;line-height:30px;${NEUTRAL_CONTROL_STYLE}">+</button>`,
        "</div>",
        '<div data-multiplier-calculation style="display:flex;align-items:center;gap:7px;height:18px;margin-top:4px;overflow:hidden;white-space:nowrap;">',
        `<span data-multiplier-formula-prefix style="flex:0 1 auto;min-width:0;color:${MUTED_TEXT_COLOR};overflow:hidden;text-overflow:ellipsis;"></span>`,
        `<span id="jh-binance-close-qty-final" style="flex:0 0 auto;font-weight:${PRIMARY_EMPHASIS_FONT_WEIGHT};color:${PRIMARY_EMPHASIS_COLOR};"></span>`,
        `<span data-multiplier-constraint-divider aria-hidden="true" style="display:none;flex:0 0 1px;width:1px;height:12px;background:${CONTROL_BORDER_COLOR};"></span>`,
        `<span id="jh-binance-close-qty-min" style="display:none;flex:1 1 auto;min-width:0;color:${MUTED_TEXT_COLOR};overflow:hidden;text-overflow:ellipsis;"></span>`,
        "</div>",
        "</div>",
        "</div>",
        `<div data-panel-group="ladder" style="margin:12px -10px 0;padding:11px 10px 0;border-top:2px solid ${PANEL_DIVIDER_COLOR};">`,
        `<div title="${ui(PANEL_COPY.tooltip.ladderMaker)}" style="height:20px;color:${PRIMARY_EMPHASIS_COLOR};font-size:14px;font-weight:${PRIMARY_EMPHASIS_FONT_WEIGHT};line-height:20px;cursor:help;">${ui(PANEL_COPY.section.ladderMaker)}</div>`,
        `<div id="${LADDER_BODY_ID}"></div>`,
        "</div>",
        `<div id="${LADDER_STATUS_ROW_ID}" style="display:flex;align-items:center;height:18px;margin-top:6px;visibility:visible;color:${MUTED_TEXT_COLOR};font-size:13px;line-height:18px;white-space:nowrap;overflow:hidden;">`,
        `<span id="${LADDER_STATUS_ID}" title="${initialStatus}" style="flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;">${initialStatus}</span>`,
        `<button id="${USDT_REBALANCE_ACTION_ID}" type="button" data-usdt-rebalance="true" hidden title="${ui(PANEL_COPY.tooltip.accountRebalance)}" style="flex:0 0 auto;height:18px;margin-left:8px;padding:0;border:0;background:transparent;color:var(--color-PrimaryYellow);font-size:13px;font-weight:500;line-height:18px;cursor:pointer;">${ui(PANEL_COPY.action.accountRebalance)}</button>`,
        "</div>"
      ].join("");
      panelPositionInvalidated = true;
      document.body.appendChild(panel);
      observePanelSize(panel);
      const input = panel.querySelector(`#${INPUT_ID}`);
      const decBtn = panel.querySelector(`#${DEC_ID}`);
      const incBtn = panel.querySelector(`#${INC_ID}`);
      const sideLongBtn = panel.querySelector(`#${SIDE_LONG_ID}`);
      const sideShortBtn = panel.querySelector(`#${SIDE_SHORT_ID}`);
      if (input) {
        const initialContext = getPanelOptionContext();
        input.value = initialContext ? loadMultiplier(initialContext.mode, initialContext.symbol, initialContext.precision) || "" : "";
        input.addEventListener("focus", () => {
          beginMultiplierEdit();
          applyInputVisualState(input, input.value);
          input.select();
        });
        input.addEventListener("input", () => {
          if (!isMultiplierEditContextCurrent()) {
            stopMultiplierEdit();
            renderPanel();
            return;
          }
          const value = String(input.value || "").replace(/[^\d]/g, "");
          if (input.value !== value) input.value = value;
          if (isValidMultiplier(value)) {
            saveMultiplier(
              value,
              multiplierEditContext.mode,
              multiplierEditContext.symbol,
              multiplierEditContext.precision
            );
          }
          const symbol = multiplierEditContext.symbol || "-";
          const qtyRuleContext = getQtyRuleContext(symbol !== "-" ? symbol : null, multiplierEditContext.mode);
          refreshComputedInfo(panel, value, qtyRuleContext);
          applyInputVisualState(input, value);
        });
        input.addEventListener("blur", () => {
          const editContext = multiplierEditContext;
          if (!isMultiplierEditContextCurrent(editContext)) {
            stopMultiplierEdit();
            renderPanel();
            return;
          }
          const value = String(input.value || "").trim();
          const normalized = sanitizeMultiplier(value);
          stopMultiplierEdit();
          saveMultiplier(normalized, editContext.mode, editContext.symbol, editContext.precision);
          input.value = normalized;
          applyInputVisualState(input, normalized);
          renderPanel();
        });
        applyInputVisualState(input, input.value);
      }
      if (decBtn) {
        decBtn.addEventListener("click", () => {
          const context = getPanelOptionContext();
          if (!context || !isCurrentObservedSymbol(context.symbol)) return;
          const current = Number(loadMultiplier(context.mode, context.symbol, context.precision));
          if (updateMultiplier(String(Math.max(1, current - 1)), context)) {
            showMultiplierPressFeedback(decBtn);
          }
        });
      }
      if (incBtn) {
        incBtn.addEventListener("click", () => {
          const context = getPanelOptionContext();
          if (!context || !isCurrentObservedSymbol(context.symbol)) return;
          const current = Number(loadMultiplier(context.mode, context.symbol, context.precision));
          if (updateMultiplier(String(current + 1), context)) {
            showMultiplierPressFeedback(incBtn);
          }
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
      const handleSideSelectorKeydown = (event) => {
        const direction = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 0;
        if (!direction) return;
        const enabledButtons = [sideLongBtn, sideShortBtn].filter((button) => button && !button.disabled);
        if (enabledButtons.length < 2) return;
        const currentIndex = enabledButtons.indexOf(event.currentTarget);
        if (currentIndex < 0) return;
        event.preventDefault();
        const nextButton = enabledButtons[(currentIndex + direction + enabledButtons.length) % enabledButtons.length];
        nextButton.focus();
        nextButton.click();
      };
      sideLongBtn?.addEventListener("keydown", handleSideSelectorKeydown);
      sideShortBtn?.addEventListener("keydown", handleSideSelectorKeydown);
      panel.addEventListener("click", (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;
        const optionBtn = target.closest("[data-ladder-group][data-ladder-value]");
        if (optionBtn) {
          const optionContext = getPanelOptionContext();
          if (!optionContext) return;
          const group = optionBtn.getAttribute("data-ladder-group");
          const value = Number(optionBtn.getAttribute("data-ladder-value"));
          if (group === "percent" && optionContext.mode === "OPEN") {
            setLadderOpenPercent(value, optionContext.symbol, optionContext.precision);
          }
          if (group === "percent" && optionContext.mode === "CLOSE") {
            setLadderClosePercent(value, optionContext.symbol, optionContext.precision);
          }
          if (group === "levels") {
            setLadderLevels(value, optionContext.mode, optionContext.symbol, optionContext.precision);
          }
          if (group === "step") {
            setLadderStep(value, optionContext.mode, optionContext.symbol, optionContext.precision);
          }
          return;
        }
        const precisionShortcutBtn = target.closest("[data-orderbook-precision-value]");
        if (precisionShortcutBtn) {
          if (precisionShortcutBtn.disabled || precisionShortcutBtn.getAttribute("aria-disabled") === "true") return;
          selectOrderbookPrecision(precisionShortcutBtn.getAttribute("data-orderbook-precision-value"));
          return;
        }
        const precisionRefreshBtn = target.closest("[data-orderbook-precision-refresh]");
        if (precisionRefreshBtn) {
          if (precisionRefreshBtn.disabled || precisionRefreshBtn.getAttribute("aria-disabled") === "true") return;
          refreshOrderbookPrecisionSamplesNow();
          return;
        }
        const actionBtn = target.closest("[data-ladder-action]");
        if (actionBtn) {
          if (actionBtn.disabled || actionBtn.getAttribute("aria-disabled") === "true") return;
          const actionType = actionBtn.getAttribute("data-ladder-action");
          if (event.altKey && getLadderActionSpec2(actionType)?.mode === "CLOSE") {
            startContinuousLadder(actionType);
          } else {
            startLadder(actionType);
          }
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
          return;
        }
        const rebalanceBtn = target.closest("[data-usdt-rebalance]");
        if (rebalanceBtn) {
          if (rebalanceBtn.disabled || rebalanceBtn.getAttribute("aria-disabled") === "true") return;
          startUsdtRebalance();
        }
      });
      return panel;
    }
    function removePanel() {
      panelResizeObserver?.disconnect();
      panelResizeObserver = null;
      panelObservedSize = "";
      document.getElementById(PANEL_ID)?.remove();
      document.getElementById(SPACER_ID)?.remove();
      ladderPanelBodySignature = "";
      panelPositionInvalidated = true;
    }
    function pauseForNonTradingPage() {
      clearCancelNoOrdersFeedback();
      cancelCurrentSymbolOpenOrdersBlocksLadderActions = false;
      removePanel();
      stopTradingTimers();
      invalidateTradeButtonCache();
      lastDisplayCloseState = null;
    }
    function renderPanel() {
      if (!isFuturesTradingPage()) {
        pauseForNonTradingPage();
        return;
      }
      ensureTradeModeTabObserver();
      ensureAccountPositionObserver();
      ensureOrderbookPrecisionObserver();
      const panel = ensurePanel();
      const input = panel.querySelector(`#${INPUT_ID}`);
      const symbol = getCurrentSymbol() || "-";
      if (symbol !== "-" && !rulesCache[symbol]) {
        ensureRules(symbol).then((rules) => {
          if (rules) scheduleRenderPanel();
        });
      }
      const optionContext = getPanelOptionContext();
      const storedMultiplier = optionContext ? loadMultiplier(optionContext.mode, optionContext.symbol, optionContext.precision) : null;
      if (input && !isEditingMultiplier && input.value !== storedMultiplier) {
        input.value = storedMultiplier || "";
      }
      const multiplier = input ? String((isEditingMultiplier ? input.value : storedMultiplier) || "").trim() : storedMultiplier || "";
      const qtyRuleContext = getQtyRuleContext(symbol !== "-" ? symbol : null, getActiveTradeMode());
      refreshComputedInfo(panel, multiplier, qtyRuleContext);
      if (input) {
        applyInputVisualState(input, multiplier);
      }
      if (panelPositionInvalidated || !isPanelPositionCurrent(panel)) {
        if (positionPanel(panel)) panelPositionInvalidated = false;
      }
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
        const closeQuantityChanged = mutations.some(mutationTouchesCloseQuantity);
        let matched = false;
        for (const mutation of mutations) {
          if (mutationTouchesTradeUi(mutation)) {
            matched = true;
            break;
          }
        }
        if (!matched) return;
        invalidateTradeButtonCache();
        let confirmedCloseSnapshot = false;
        if (closeQuantityChanged && closeGuard && closeGuard.symbol === getCurrentSymbol() && !closeGuard.snapshotReady && getActiveTradeMode() === "CLOSE" && findCloseLongButton() && findCloseShortButton()) {
          closeGuard.snapshotReady = true;
          confirmedCloseSnapshot = true;
        }
        panelPositionInvalidated = true;
        if (confirmedCloseSnapshot) {
          window.clearTimeout(tradeUiMutationDebounceTimer);
          tradeUiMutationDebounceTimer = 0;
          scheduleRenderPanel();
          return;
        }
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
    function handleTradeModeTabTransition(tab, isEnteringClose, isEnteringOpen, source) {
      if (!isEnteringClose && !isEnteringOpen) return false;
      stopMultiplierEdit();
      if (isEnteringClose) {
        invalidateTradeButtonCache();
        closeGuard = {
          symbol: getCurrentSymbol(),
          expiresAt: Date.now() + 500,
          snapshotReady: false
        };
      }
      if (isEnteringOpen) {
        invalidateTradeButtonCache();
        const reset = () => queueAutoOpenLeveragePositionCheck(source, { resetIfFlat: true });
        if (source === "click") window.requestAnimationFrame(reset);
        else reset();
      }
      const apply = () => applyCachedCloseUiState();
      if (source === "click") window.requestAnimationFrame(apply);
      else apply();
      scheduleRenderPanel();
      waitForTradeUiMutation();
      return true;
    }
    function getTradeModeObserverRoot() {
      const activeTab = getActiveTradeTab();
      return activeTab?.closest("#position-direction, .bn-tabs__buySell") || activeTab?.parentElement || document.querySelector("#position-direction") || document.querySelector(".bn-tabs__buySell") || document.querySelector('[role="tab"].bn-tab__buySell')?.parentElement || null;
    }
    function stopTradeModeTabObserver() {
      if (tradeModeTabObserver) {
        tradeModeTabObserver.disconnect();
        tradeModeTabObserver = null;
      }
      tradeModeTabObserverRoot = null;
    }
    function ensureTradeModeTabObserver() {
      if (document.hidden) return;
      const root = getTradeModeObserverRoot();
      if (!root) {
        stopTradeModeTabObserver();
        return;
      }
      if (tradeModeTabObserver && tradeModeTabObserverRoot === root && root.isConnected) return;
      stopTradeModeTabObserver();
      tradeModeTabObserverRoot = root;
      tradeModeTabObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type !== "attributes" || mutation.attributeName !== "aria-selected") continue;
          if (!isTradeModeTab2(mutation.target)) continue;
          const isSelected = mutation.target.getAttribute("aria-selected") === "true";
          const mode = parseTradeModeLabel(mutation.target.textContent);
          const isEnteringClose = isSelected && mode === "CLOSE";
          const isEnteringOpen = isSelected && mode === "OPEN";
          if (handleTradeModeTabTransition(mutation.target, isEnteringClose, isEnteringOpen, "mutation")) return;
        }
      });
      tradeModeTabObserver.observe(root, {
        subtree: true,
        attributes: true,
        attributeFilter: ["aria-selected"]
      });
    }
    function installUiSyncObservers() {
      document.addEventListener("click", (event) => {
        const tab = event.target instanceof Element ? event.target.closest('[role="tab"]') : null;
        if (!isTradeModeTab2(tab)) return;
        const mode = parseTradeModeLabel(tab.textContent);
        const isEnteringClose = mode === "CLOSE" && tab.getAttribute("aria-selected") !== "true";
        const isEnteringOpen = mode === "OPEN" && tab.getAttribute("aria-selected") !== "true";
        handleTradeModeTabTransition(tab, isEnteringClose, isEnteringOpen, "click");
        ensureTradeModeTabObserver();
      }, true);
      const startObserve = () => {
        ensureTradeModeTabObserver();
        window.setTimeout(ensureTradeModeTabObserver, 1e3);
      };
      if (document.body) {
        startObserve();
      } else {
        window.addEventListener("DOMContentLoaded", startObserve, { once: true });
      }
    }
    function resolveTargetQty(tradeMode, priceOverride) {
      const symbol = getCurrentSymbol();
      const precision = readCurrentOrderbookPrecisionValue();
      if (!precision) throw new Error("未识别价格精度");
      const qtyRuleContext = getQtyRuleContext(symbol, tradeMode, priceOverride);
      if (qtyRuleContext.status !== "ready" || !qtyRuleContext.effectiveMinQty) {
        if (symbol && !rulesCache[symbol]) ensureRules(symbol);
        return null;
      }
      const multiplier = loadMultiplier(tradeMode, symbol, precision);
      const qty = multiplyDecimalByInt(qtyRuleContext.effectiveMinQty, multiplier);
      if (!qty) return null;
      return {
        qty,
        source: `MULTIPLIER(${multiplier}x @ ${qtyRuleContext.effectiveMinQty})`,
        symbol,
        precision,
        rule: qtyRuleContext
      };
    }
    document.addEventListener("click", async (e) => {
      try {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
        const priceNode = findClickedPriceNode(e.target);
        if (!priceNode) return;
        if (!e.isTrusted) return;
        const clickedSymbol = getCurrentSymbol();
        if (!isCurrentObservedSymbol(clickedSymbol)) {
          warn("交易对正在切换，已忽略本次点击");
          setLadderStatus("单击下单未执行：交易对正在切换");
          return;
        }
        if (getActiveTradeMode() === "CLOSE" && !isCloseSnapshotReady(clickedSymbol)) {
          warn("仓位确认中");
          setLadderStatus("单击下单未执行：仓位确认中");
          return;
        }
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
          setLadderStatus("单击下单未执行：未找到数量输入框");
          return;
        }
        const priceInput = findPriceInput();
        if (!priceInput) {
          warn("未找到价格输入框");
          setLadderStatus("单击下单未执行：未找到价格输入框");
          return;
        }
        const action = resolveTradeAction();
        if (!action || !action.button) {
          const message = `未找到可用${getActiveTradeMode() === "OPEN" ? "开仓" : "平仓"}动作`;
          warn(message);
          setLadderStatus(`单击下单未执行：${message}`);
          return;
        }
        const qtyPlan = resolveTargetQty(action.mode, clickedPrice);
        if (!qtyPlan || !qtyPlan.qty) {
          warn("未找到可用数量来源（数量倍率/有效最小量）");
          setLadderStatus("单击下单未执行：数量规则读取中");
          return;
        }
        if (ladderTask || continuousLadderTask || cancelCurrentSymbolOpenOrdersTask || singleOrderTask) {
          return;
        }
        lastTs = now;
        invalidateUsdtRebalanceEligibility();
        setLadderStatus(`单击${action.side}准备中`);
        singleOrderTask = (async () => {
          await syncTradeInputs(clickedPrice, qtyPlan.qty, {
            priceLabel: "点击价",
            qtyLabel: "目标量"
          });
          const currentSymbol = getCurrentSymbol();
          if (!isCurrentObservedSymbol(qtyPlan.symbol)) {
            const clickedBaseAsset = formatStatusBaseAsset(qtyPlan.symbol);
            const currentBaseAsset = currentSymbol ? formatStatusBaseAsset(currentSymbol) : "未知";
            throw new Error(`交易对已变化，点击时 ${clickedBaseAsset}，当前 ${currentBaseAsset}`);
          }
          if (getActiveTradeMode() !== action.mode) {
            throw new Error("开仓/平仓模式已变化，已停止提交");
          }
          if (readCurrentOrderbookPrecisionValue() !== qtyPlan.precision) {
            throw new Error("价格精度已变化，已停止提交");
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
          if (!isCurrentObservedSymbol(qtyPlan.symbol)) {
            throw new Error("提交前交易对已变化，已停止");
          }
          const previousFeedback = takeOrderFeedbackSnapshot();
          const submitCaptureId = beginLadderSubmitResponseCapture();
          try {
            currentAction.button.click();
            setLadderStatus(`单击${action.side}确认中 · ${clickedPrice} × ${qtyPlan.qty}`);
            waitForTradeUiMutation({ timeoutMs: 400 });
            await waitForOrderSubmitAcknowledgement(
              currentAction.button,
              `单击${action.side}`,
              previousFeedback,
              submitCaptureId,
              action.mode
            );
          } finally {
            endLadderSubmitResponseCapture(submitCaptureId);
          }
          setLadderStatus(`单击${action.side}已提交 · ${clickedPrice} × ${qtyPlan.qty}`);
          log(`单击${action.side}已确认提交`);
        })();
        scheduleRenderPanel();
        try {
          await singleOrderTask;
        } catch (singleOrderError) {
          const message = singleOrderError?.message || "订单簿点击提交失败";
          setLadderStatus(`单击${action.side}失败：${message}`, message);
          err("single order submit failed:", singleOrderError);
          warn(message);
        } finally {
          singleOrderTask = null;
          scheduleRenderPanel();
        }
      } catch (e2) {
        err("click handler 异常:", e2);
        const message = e2?.message || "订单簿点击提交失败";
        warn(message);
        if (!ladderTask && !continuousLadderTask && !cancelCurrentSymbolOpenOrdersTask && !singleOrderTask) {
          setLadderStatus(`单击下单失败：${message}`, message);
        }
      }
    }, true);
    window.addEventListener("storage", (event) => {
      if (event.key?.startsWith(`${LOCAL_QTY_MULTIPLIER_PREFIX}:`) || isSymbolScopedSideStorageKey(event.key, [LOCAL_CLOSE_SIDE_KEY, LOCAL_OPEN_SIDE_KEY]) || event.key?.startsWith(`${LOCAL_ORDERBOOK_PRECISION_SAMPLES_PREFIX}:`) || isModeSymbolOptionStorageKey(event.key, LADDER_OPTION_STORAGE_KEYS)) scheduleRenderPanel();
    });
    installUiSyncObservers();
    function clearSymbolOwnedRuntimeState(symbol) {
      clearCancelNoOrdersFeedback();
      cancelCurrentSymbolOpenOrdersBlocksLadderActions = false;
      stopMultiplierEdit();
      lastConfirmedCloseState = null;
      lastDisplayCloseState = null;
      lastObservedAccountPositionState = null;
      closeGuard = null;
      invalidateTradeButtonCache();
      orderbookPrecisionOptionsLoadRequestedSymbol = null;
      orderbookPrecisionOptionsLoadAttemptedSymbol = null;
      const recommendation = getOrderbookPrecisionRecommendation(symbol);
      orderbookPrecisionState = {
        symbol,
        samples: readStoredOrderbookPrecisionSamples(symbol),
        recommendation,
        current: readCurrentOrderbookPrecisionValue(),
        nativeOptions: [],
        nativeOptionsStatus: null,
        status: recommendation ? "ready" : PANEL_COPY.status.precisionInsufficient
      };
    }
    function checkSymbolChangeForLeverage() {
      const symbol = getCurrentSymbol();
      if (!symbol || symbol === lastObservedSymbol) return;
      lastObservedSymbol = symbol;
      clearSymbolOwnedRuntimeState(symbol);
      scheduleRenderPanel();
      if (getActiveTradeMode() === "OPEN") {
        queueAutoOpenLeveragePositionCheck("symbol_change");
      }
    }
    let routeWatcherTimer = null;
    let removeSpaRouteChangeListener = null;
    let routeWasTrading = isFuturesTradingPage();
    function startTradingTimers() {
      if (document.hidden || !isFuturesTradingPage()) return;
      ensureTradeModeTabObserver();
      ensureAccountPositionObserver();
      ensureOrderbookPrecisionObserver();
    }
    function stopTradingTimers() {
      stopTradeModeTabObserver();
      stopAccountPositionObserver();
      stopOrderbookPrecisionObserver();
      clearTradeUiMutationWait();
    }
    function syncRouteState() {
      if (document.hidden) return;
      const nextUiLocale = resolveUiLocaleFromPathname(location.pathname);
      const uiLocaleChanged = nextUiLocale !== activeUiLocale;
      if (uiLocaleChanged) {
        activeUiLocale = nextUiLocale;
        removePanel();
      }
      const isTradingRoute = isFuturesTradingPage();
      if (!isTradingRoute) {
        if (routeWasTrading) {
          routeWasTrading = false;
          pauseForNonTradingPage();
        }
        return;
      }
      const wasTrading = routeWasTrading;
      routeWasTrading = true;
      if (!wasTrading) {
        lastObservedSymbol = getCurrentSymbol();
        clearSymbolOwnedRuntimeState(lastObservedSymbol);
      } else {
        checkSymbolChangeForLeverage();
      }
      const needsRender = uiLocaleChanged || !wasTrading || !document.getElementById(PANEL_ID);
      startTradingTimers();
      scheduleChartOrdersRecovery();
      if (needsRender) scheduleRenderPanel();
      if (!wasTrading && getActiveTradeMode() === "OPEN") {
        queueAutoOpenLeveragePositionCheck("route_return");
      }
    }
    function startRouteWatcher() {
      if (document.hidden) return;
      if (!removeSpaRouteChangeListener) {
        removeSpaRouteChangeListener = installSpaRouteChangeListener(window, syncRouteState);
      }
      if (!routeWatcherTimer) {
        routeWatcherTimer = setInterval(() => {
          ensureSpaRouteChangePatched(window);
          syncRouteState();
          if (isFuturesTradingPage()) renderPanel();
        }, ROUTE_WATCHDOG_MS);
      }
    }
    function stopRouteWatcher() {
      if (routeWatcherTimer) clearInterval(routeWatcherTimer);
      routeWatcherTimer = null;
      removeSpaRouteChangeListener?.();
      removeSpaRouteChangeListener = null;
    }
    startRouteWatcher();
    startTradingTimers();
    scheduleChartOrdersRecovery();
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        stopTradingTimers();
        stopRouteWatcher();
        return;
      }
      panelPositionInvalidated = true;
      startRouteWatcher();
      syncRouteState();
    });
    window.addEventListener("resize", () => {
      panelPositionInvalidated = true;
      scheduleRenderPanel();
    }, { passive: true });
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
      fetchCurrentSymbolPositionState,
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
      queueAutoOpenLeveragePositionCheck,
      renderPanel
    };
    log("脚本加载完成", location.href);
  })();
})();
