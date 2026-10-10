// ==UserScript==
// @name         【自写】Binance 合约交易数据面板
// @namespace    binance.trading.data
// @icon         data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%23f0b90b%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2249%22%20text-anchor%3D%22middle%22%20font-family%3D%22Arial%2C%20sans-serif%22%20font-size%3D%2242%22%20font-weight%3D%22800%22%20fill%3D%22%23111827%22%3EJ%3C%2Ftext%3E%3C%2Fsvg%3E
// @icon64       data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%23f0b90b%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2249%22%20text-anchor%3D%22middle%22%20font-family%3D%22Arial%2C%20sans-serif%22%20font-size%3D%2242%22%20font-weight%3D%22800%22%20fill%3D%22%23111827%22%3EJ%3C%2Ftext%3E%3C%2Fsvg%3E
// @version      1.2.4
// @author       jackhai9
// @description  Bilingual futures metrics with historical trends, current funding, settlement countdown, and indicator signals.
// @match        https://www.binance.com/*/futures/*
// @match        https://www.binance.com/futures/*
// @exclude      https://www.binance.com/*/my/wallet/futures/*
// @exclude      https://www.binance.com/my/wallet/futures/*
// @updateURL    https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-trading-data.user.js
// @downloadURL  https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-trading-data.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==
(() => {
  // src/shared/binance-symbol.js
  var BINANCE_SYMBOL_CHARACTERS = "\\p{L}\\p{N}_";
  var SYMBOL_PATTERN = new RegExp(`^[${BINANCE_SYMBOL_CHARACTERS}]+$`, "u");

  // src/shared/binance-futures-route.js
  var FUTURES_TRADING_PATH_RE = /^\/(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?futures\/([^/]+)\/?$/;
  var TRADING_SYMBOL_RE = new RegExp(`^[${BINANCE_SYMBOL_CHARACTERS}]+(?:USDT|USDC)$`, "iu");
  function parseFuturesTradingSymbolFromPathname(pathname) {
    const normalized = String(pathname || "").split(/[?#]/, 1)[0];
    const match = normalized.match(FUTURES_TRADING_PATH_RE);
    if (!match || match[0] !== normalized) return null;
    let symbol;
    try {
      symbol = decodeURIComponent(match[1]);
    } catch (error) {
      if (error instanceof URIError) return null;
      throw error;
    }
    const symbolMatch = symbol.match(TRADING_SYMBOL_RE);
    return symbolMatch && symbolMatch[0] === symbol ? symbol.toUpperCase() : null;
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
      waitingPrecisionOptions: localizedText("等待精度档位", "Waiting for options"),
      loadingPrecisionOptions: localizedText("读取精度档位", "Loading options"),
      minimumQuantityLoading: localizedText("最小量读取中", "Loading minimum qty"),
      positiveIntegerMultiplier: localizedText("请输入正整数倍数", "Enter a positive integer"),
      noClosablePosition: localizedText("暂无可平仓位", "No position to close")
    }),
    status: freezeCopy({
      precisionUpdated: localizedText("精度推荐已更新", "Precision recommendation updated"),
      precisionOptionsUnavailable: localizedText("档位读取失败，请刷新", "Options unavailable. Refresh."),
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
    automaticRebalance: freezeCopy({
      waitingForFlat: localizedText("自动再平衡：等待账户持续无持仓、无挂单", "Automatic USDT transfer: waiting for stable flat account"),
      waitingForAccess: localizedText("自动再平衡：等待账户操作完成", "Automatic USDT transfer: waiting for account access"),
      checkingAccount: localizedText("自动再平衡：正在检查账户", "Automatic USDT transfer: checking account"),
      blocked: localizedText("自动再平衡已阻止：请先核实上次划转结果", "Automatic USDT transfer blocked: previous outcome requires account review"),
      completed: localizedText("已自动进行账户再平衡", "Account automatically rebalanced"),
      notRepeated: localizedText("本轮不再自动执行账户再平衡", "No further automatic rebalance in this round"),
      noTransfer: localizedText("自动再平衡：无需划转", "Automatic account rebalance: no transfer needed"),
      paused: localizedText("自动再平衡已暂停：执行条件已变化", "Automatic USDT transfer paused: eligibility changed"),
      stopped: localizedText("自动再平衡已停止：", "Automatic USDT transfer stopped: "),
      eligibilityFailed: localizedText("自动再平衡资格检查失败：", "Automatic USDT eligibility check failed: "),
      accountBusy: localizedText("账户操作已阻止：其他标签页正在划转资金", "Account operation blocked: another tab is transferring funds")
    }),
    rebalanceErrors: freezeCopy({
      pageIneligible: localizedText("当前合约页面不符合账户划转条件", "Current futures page is not eligible for account transfers"),
      ordinaryAccountRequired: localizedText("自动划转仅支持普通 U 本位合约账户", "Automatic transfers require an ordinary USD-M Futures account"),
      eligibilityChanged: localizedText("划转前账户执行条件已变化", "Account eligibility changed before transfer"),
      tradingTaskRunning: localizedText("当前仍有交易任务运行", "A trading task is still running"),
      identityUnverified: localizedText("账户身份或模式不受支持或尚未核实", "Unsupported or unverified account identity"),
      identityChanged: localizedText("账户身份已变化", "Account identity changed"),
      identityChangedAfterConfirmation: localizedText("确认后账户身份已变化", "Account identity changed after confirmation"),
      reviewRequired: localizedText("请先核实上次划转结果", "Previous transfer outcome requires account review"),
      flatRequired: localizedText("全账户持仓和当前委托必须为零", "Account-wide positions and open orders must be zero"),
      accountNotFlat: localizedText("全账户仍有持仓或当前委托", "Positions or open orders still exist in the account"),
      invalidOutcome: localizedText("自动再平衡结果记录无效", "Invalid automatic rebalance episode outcome")
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

  // src/binance-trading-data/market-data.js
  var HISTORY_FIELDS = Object.freeze({
    topAccountRatio: "longShortRatio",
    topPositionRatio: "longShortRatio",
    globalAccountRatio: "longShortRatio",
    takerRatio: "buySellRatio",
    basis: "basisRate",
    fundingRate: "fundingRate"
  });
  function numeric(value, field) {
    if (typeof value !== "number" && typeof value !== "string" || value === "" || typeof value === "string" && value.trim() === "") {
      throw new TypeError(`Missing numeric ${field}`);
    }
    const result = Number(value);
    if (!Number.isFinite(result)) throw new TypeError(`Invalid numeric ${field}`);
    return result;
  }
  function timestamp(value, field) {
    const result = numeric(value, field);
    if (!Number.isSafeInteger(result) || result <= 0) throw new TypeError(`Invalid timestamp ${field}`);
    return result;
  }
  function parseHistory(key, payload, symbol) {
    if (!Array.isArray(payload)) throw new TypeError(`${key} must be an array`);
    let previousTime = 0;
    return payload.map((row) => {
      if (!row || typeof row !== "object") throw new TypeError(`Invalid ${key} record`);
      if (row.symbol !== void 0 && row.symbol !== symbol) throw new Error(`${key} symbol mismatch`);
      if (row.pair !== void 0 && row.pair !== symbol) throw new Error(`${key} pair mismatch`);
      const time = timestamp(row[key === "fundingRate" ? "fundingTime" : "timestamp"], key);
      if (time <= previousTime) throw new Error(`${key} history must have increasing timestamps`);
      previousTime = time;
      if (key === "openInterest") {
        const value = numeric(row.sumOpenInterest, "sumOpenInterest");
        if (value < 0) throw new RangeError("Open interest cannot be negative");
        const rawSupply = row.CMCCirculatingSupply;
        const supply = rawSupply === null || rawSupply === void 0 || rawSupply === "" ? null : numeric(rawSupply, "CMCCirculatingSupply");
        return { timestamp: time, value, supply };
      }
      const field = HISTORY_FIELDS[key];
      if (!field) throw new Error(`Unknown historical endpoint: ${key}`);
      const point = { timestamp: time, value: numeric(row[field], field) };
      if (key === "takerRatio") {
        point.buy = numeric(row.buyVol, "buyVol");
        point.sell = numeric(row.sellVol, "sellVol");
        if (point.buy < 0 || point.sell < 0) throw new RangeError("Taker volume cannot be negative");
      }
      return point;
    });
  }
  function parseCurrentFunding(payload, symbol) {
    if (!payload || Array.isArray(payload) || payload.symbol !== symbol) throw new Error("Current funding symbol mismatch");
    return {
      value: numeric(payload.lastFundingRate, "lastFundingRate"),
      time: timestamp(payload.time, "premiumIndex.time"),
      nextFundingTime: timestamp(payload.nextFundingTime, "nextFundingTime")
    };
  }
  function parseFundingInterval(payload, symbol) {
    if (!Array.isArray(payload)) throw new TypeError("Funding information must be an array");
    const matches = payload.filter((row) => row && row.symbol === symbol);
    if (matches.length === 0) return null;
    if (matches.length !== 1) throw new Error("Funding interval symbol is ambiguous");
    const hours = numeric(matches[0].fundingIntervalHours, "fundingIntervalHours");
    if (!Number.isInteger(hours) || hours <= 0) throw new RangeError("Invalid funding interval");
    return hours;
  }
  function formatFundingPercent(value) {
    if (value === null) return "--";
    if (!Number.isFinite(value)) throw new TypeError("Invalid funding rate");
    const percent = value * 100;
    if (percent === 0) return "0%";
    const magnitude = Math.abs(percent);
    if (magnitude < 1e-12) return percent.toExponential(2) + "%";
    const decimals = Math.max(6, Math.min(14, 2 - Math.floor(Math.log10(magnitude))));
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: decimals, useGrouping: false }).format(percent) + "%";
  }
  function compactQuantity(value, locale) {
    const scales = locale === "zh-CN" ? [[1e12, "万亿"], [1e8, "亿"], [1e4, "万"]] : [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]];
    const scale = scales.find(([base]) => Math.abs(value) >= base);
    const amount = scale ? value / scale[0] : value;
    const decimals = locale === "zh-CN" ? 4 : 2;
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: decimals, useGrouping: false }).format(amount) + (scale ? scale[1] : "");
  }
  function formatMetricValue(id, value, locale) {
    if (value === null) return "--";
    if (!Number.isFinite(value)) throw new TypeError(`Invalid ${id} value`);
    if (id === "funding") return formatFundingPercent(value);
    if (id === "oi" || id === "volume") return compactQuantity(value, locale);
    if (id === "basis" || id === "oi-supply") {
      return (id === "basis" && value > 0 ? "+" : "") + (value * 100).toFixed(2) + "%";
    }
    return value.toFixed(2);
  }
  var INDICATORS = Object.freeze([
    ["oi", "openInterest"],
    ["top-accounts", "topAccountRatio"],
    ["top-positions", "topPositionRatio"],
    ["global-accounts", "globalAccountRatio"],
    ["taker", "takerRatio"],
    ["basis", "basis"],
    ["funding", "fundingRate"],
    ["oi-supply", "openInterest"]
  ]);
  function computeTradingSignals(data, cachedKeys, locale, symbol, endpointErrors = {}) {
    const unit = symbol.replace(/USDT$|USDC$/, "");
    const indicators = INDICATORS.map(([id, key]) => {
      const source = data[key] || [];
      const history = id === "oi-supply" ? source.map((point) => ({ timestamp: point.timestamp, value: point.supply > 0 ? point.value / point.supply : null })) : source;
      const value = history.length ? history.at(-1).value : null;
      let signal = "neutral";
      let arrow = "";
      if (value !== null) {
        if (id === "oi" && history.length > 6) {
          const previous = history.at(-7).value;
          signal = value > previous ? "long" : value < previous ? "short" : "neutral";
          arrow = value > previous ? " ▲" : value < previous ? " ▼" : "";
        } else if (id === "basis") {
          signal = value > 0 ? "long" : value < 0 ? "short" : "neutral";
        } else if (id === "funding") {
          signal = value < -1e-4 ? "long" : value > 1e-4 ? "short" : "neutral";
        } else if (id !== "oi" && id !== "oi-supply") {
          signal = value > 1 ? "long" : value < 1 ? "short" : "neutral";
        }
      }
      return {
        id,
        signal,
        value,
        history,
        display: formatMetricValue(id, value, locale) + arrow,
        unit: id === "oi" || id === "taker" ? unit : "",
        cached: cachedKeys.has(key),
        error: endpointErrors[key] || null,
        vote: id !== "oi-supply" && value !== null
      };
    });
    const voters = indicators.filter((indicator) => indicator.vote && !indicator.cached);
    return {
      symbol,
      indicators,
      longCount: voters.filter((indicator) => indicator.signal === "long").length,
      shortCount: voters.filter((indicator) => indicator.signal === "short").length,
      total: voters.length
    };
  }

  // src/binance-trading-data/ui-copy.js
  var COPY = Object.freeze({
    title: localizedText("交易数据", "Trading data"),
    metric: localizedText("指标", "Metric"),
    history: localizedText("历史趋势", "History"),
    value: localizedText("数值", "Value"),
    collapse: localizedText("收起面板", "Collapse panel"),
    expand: localizedText("展开面板", "Expand panel"),
    close: localizedText("关闭", "Close"),
    loading: localizedText("加载中", "Loading"),
    missing: localizedText("数据缺失", "Data unavailable"),
    loadFailed: localizedText("加载失败", "Load failed"),
    cached: localizedText("缓存", "Cached"),
    cachedFailure: localizedText("缓存 · 更新失败", "Cached · refresh failed"),
    intervalCached: localizedText("周期缓存", "Cached interval"),
    intervalCachedFailure: localizedText("周期缓存 · 更新失败", "Cached interval · refresh failed"),
    intervalLoadFailed: localizedText("周期加载失败", "Interval load failed"),
    refreshFailed: localizedText("更新失败", "Refresh failed"),
    noHistory: localizedText("暂无历史", "No history"),
    inspect: localizedText("查看历史数据", "Inspect history"),
    keyboard: localizedText("左右方向键切换历史点；Esc 关闭明细", "Use left and right arrows to inspect points; Esc closes details"),
    historyRecord: localizedText("历史数据", "Historical data"),
    settledRecord: localizedText("历史结算", "Settled funding"),
    last: localizedText("上次", "Last"),
    current: localizedText("当前", "Current"),
    intervalPending: localizedText("周期待确认", "Interval pending"),
    countdown: localizedText("倒计时", "Countdown"),
    clockUnavailable: localizedText("校时不可用", "Clock unavailable"),
    waitingUpdate: localizedText("等待更新", "Waiting for update"),
    buy: localizedText("买", "Buy"),
    sell: localizedText("卖", "Sell"),
    buySellRatio: localizedText("买/卖比", "Buy/sell ratio"),
    basisRate: localizedText("比率", "Rate"),
    composite: localizedText("综合信号", "Composite signal"),
    long: localizedText("偏多", "Bullish"),
    short: localizedText("偏空", "Bearish"),
    neutral: localizedText("中性", "Neutral"),
    fundingNote: localizedText(
      "当前费率在结算前仍可能变化；历史曲线只含已结算记录。",
      "The current rate may change before settlement. History contains settled rates only."
    ),
    simplifiedNote: localizedText(
      "简化规则；资金费率投票使用最新已结算值。缓存及未平仓量与市值比率不参与投票。",
      "Simplified rules; the funding vote uses the latest settled rate. Cached data and the open-interest-to-market-cap ratio do not vote."
    )
  });
  var METRICS = Object.freeze({
    oi: {
      name: localizedText("合约持仓量", "Open Interest"),
      detail: localizedText(
        "尚未平仓的合约规模，以当前交易币种计量。持仓量是存量，成交量是一段时间内的交易量。",
        "Outstanding contract quantity in the current asset. Open interest measures open contracts; volume measures trading during a period."
      )
    },
    "top-accounts": {
      name: localizedText("大户账户数多空比", "Top Trader Long/Short Ratio (Accounts)"),
      detail: localizedText(
        "大户净多头账户数 ÷ 净空头账户数。大户按保证金余额前 20% 定义。",
        "Top-trader net-long accounts divided by net-short accounts. Top traders are the top 20% by margin balance."
      )
    },
    "top-positions": {
      name: localizedText("大户持仓量多空比", "Top Trader Long/Short Ratio (Positions)"),
      detail: localizedText(
        "大户多头持仓量 ÷ 空头持仓量，按仓位规模统计。",
        "Top-trader long position quantity divided by short position quantity, weighted by position size."
      )
    },
    "global-accounts": {
      name: localizedText("多空账户数比", "Long/Short Ratio"),
      detail: localizedText(
        "统计账户中的净多头账户数 ÷ 净空头账户数。",
        "Net-long accounts divided by net-short accounts across the reported trading population."
      )
    },
    taker: {
      name: localizedText("合约主动买卖量", "Taker Buy/Sell Volume"),
      detail: localizedText(
        "柱图分别显示主动买入量与主动卖出量；右侧数值是买入量 ÷ 卖出量。",
        "Bars show taker buy and sell volumes separately. The value at right is buy volume divided by sell volume."
      )
    },
    basis: {
      name: localizedText("基差", "Basis"),
      detail: localizedText(
        "以比率展示：（合约价格 − 现货指数价格）÷ 现货指数价格。",
        "Shown as a rate: (futures price minus spot index price) divided by spot index price."
      )
    },
    funding: {
      name: localizedText("资金费率", "Funding Rate"),
      detail: COPY.fundingNote
    },
    "oi-supply": {
      name: localizedText("未平仓量与市值比率", "Open Interest to Market Cap Ratio"),
      detail: localizedText(
        "未平仓币数 ÷ CMC 流通供应量，分子与分母按同一币种计量。这一项不参与综合信号投票。",
        "Open-interest token quantity divided by CMC circulating supply, measured in the same asset. This row does not vote in the composite signal."
      )
    }
  });
  function tradingText(key, locale) {
    return formatLocalizedText(COPY[key], locale);
  }
  function tradingMetricText(id, key, locale) {
    return formatLocalizedText(METRICS[id][key], locale);
  }
  function formatFundingPeriod(hours, locale) {
    const period = hours === null ? COPY.intervalPending : localizedText(`${hours}小时`, `${hours}h`);
    return `${tradingText("current", locale)} · ${formatLocalizedText(period, locale)}`;
  }
  function formatHistoryCount(id, count, locale) {
    return formatLocalizedText(id === "funding" ? localizedText(`已结算 · ${count}次`, `Settled · ${count} points`) : localizedText(`5分钟 · ${count}点`, `5m · ${count} points`), locale);
  }
  function formatVotes({ longCount, shortCount, total }, locale) {
    const neutral = total - longCount - shortCount;
    return formatLocalizedText(localizedText(
      `指标票数：${longCount}多 · ${shortCount}空 · ${neutral}中性`,
      `Votes: ${longCount} long · ${shortCount} short · ${neutral} neutral`
    ), locale);
  }
  function formatHistoryTime(timestamp2, locale) {
    return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en-GB", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "short"
    }).format(timestamp2);
  }

  // src/binance-trading-data/sparkline.js
  var SVG_NS = "http://www.w3.org/2000/svg";
  var WIDTH = 144;
  var HEIGHT = 44;
  var PADDING = 4;
  var RATIO_METRICS = /* @__PURE__ */ new Set(["top-accounts", "top-positions", "global-accounts"]);
  function createHistoryChart({ document: document2, indicator, locale, onInspect }) {
    const { history, id, unit } = indicator;
    const volume = id === "taker";
    const listeners = [];
    const listen = (node, type, listener) => {
      node.addEventListener(type, listener);
      listeners.push(() => node.removeEventListener(type, listener));
    };
    const destroy = () => listeners.splice(0).forEach((remove) => remove());
    const svgElement = (tag, attributes) => {
      const node = document2.createElementNS(SVG_NS, tag);
      for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
      return node;
    };
    const points = history.map((point, index) => ({ ...point, index }));
    for (const point of points) {
      if (!Number.isFinite(point.timestamp) || point.value !== null && !Number.isFinite(point.value)) {
        throw new Error(`Invalid historical observation for ${id}`);
      }
    }
    const available = (point) => volume ? Number.isFinite(point.buy) && Number.isFinite(point.sell) : point.value !== null;
    const observations = points.filter(available);
    if (observations.length === 0) {
      const empty = document2.createElement("span");
      empty.className = "td-no-history";
      empty.textContent = tradingText("noHistory", locale);
      return { element: empty, count: 0, destroy };
    }
    const button = document2.createElement("button");
    button.type = "button";
    button.className = "td-spark-button";
    const name = tradingMetricText(id, "name", locale);
    button.setAttribute("aria-label", `${name} · ${tradingText("inspect", locale)}`);
    button.setAttribute("aria-description", tradingText("keyboard", locale));
    button.setAttribute("aria-expanded", "false");
    const svg = svgElement("svg", {
      class: "td-sparkline",
      viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
      preserveAspectRatio: "none",
      "aria-hidden": "true"
    });
    const chartTitle = svgElement("title", {});
    chartTitle.textContent = `${name} · ${tradingText(id === "funding" ? "settledRecord" : "historyRecord", locale)}`;
    svg.append(chartTitle);
    button.append(svg);
    const reference = RATIO_METRICS.has(id) ? 1 : volume || id === "funding" || id === "basis" ? 0 : null;
    const values = observations.flatMap((point) => volume ? [point.buy, point.sell] : [point.value]);
    if (reference !== null) values.push(reference);
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const firstTime = Math.min(...points.map((point) => point.timestamp));
    const lastTime = Math.max(...points.map((point) => point.timestamp));
    const x = (point) => firstTime === lastTime ? WIDTH / 2 : PADDING + (point.timestamp - firstTime) * (WIDTH - PADDING * 2) / (lastTime - firstTime);
    const y = (value) => maximum === minimum ? HEIGHT / 2 : PADDING + (maximum - value) * (HEIGHT - PADDING * 2) / (maximum - minimum);
    const coordinate = (value) => Number(value.toFixed(3));
    if (reference !== null) {
      svg.append(svgElement("line", {
        x1: 0,
        x2: WIDTH,
        y1: y(reference),
        y2: y(reference),
        class: "td-spark-reference"
      }));
    }
    if (volume) {
      for (let index = 0; index < observations.length; index += 1) {
        const point = observations[index];
        const previousGap = index === 0 ? WIDTH : x(point) - x(observations[index - 1]);
        const nextGap = index === observations.length - 1 ? WIDTH : x(observations[index + 1]) - x(point);
        const pairWidth = Math.min(12, previousGap * 0.8, nextGap * 0.8);
        const barWidth = pairWidth * 0.42;
        for (const [side, offset] of [["buy", -pairWidth / 2], ["sell", pairWidth * 0.08]]) {
          svg.append(svgElement("rect", {
            x: coordinate(x(point) + offset),
            y: coordinate(y(point[side])),
            width: coordinate(barWidth),
            height: coordinate(y(0) - y(point[side])),
            class: side === "buy" ? "td-buy-bar" : "td-sell-bar"
          }));
        }
      }
    } else {
      const segments = [];
      let segment = [];
      for (const point of points) {
        if (point.value === null) {
          if (segment.length > 0) segments.push(segment);
          segment = [];
        } else {
          segment.push(point);
        }
      }
      if (segment.length > 0) segments.push(segment);
      for (const observed of segments) {
        if (observed.length > 1) {
          const path = observed.map((point, index) => `${index === 0 ? "M" : "L"}${coordinate(x(point))},${coordinate(y(point.value))}`).join(" ");
          svg.append(svgElement("path", { d: path, class: "td-spark-path" }));
        }
        const last = observed[observed.length - 1];
        svg.append(svgElement("circle", {
          cx: coordinate(x(last)),
          cy: coordinate(y(last.value)),
          r: 2,
          class: "td-spark-point"
        }));
      }
    }
    const guide = svgElement("line", { y1: 1, y2: HEIGHT - 1, class: "td-spark-guide", opacity: 0 });
    svg.append(guide);
    let selected = observations.length - 1;
    function record(point) {
      const label = tradingText(id === "funding" ? "settledRecord" : "historyRecord", locale);
      const quantity = (value2) => `${formatMetricValue("oi", value2, locale)}${unit ? ` ${unit}` : ""}`;
      const value = volume ? `${tradingText("buy", locale)} ${quantity(point.buy)} · ${tradingText("sell", locale)} ${quantity(point.sell)} · ${tradingText("buySellRatio", locale)} ${formatMetricValue("taker", point.value, locale)}` : `${id === "funding" ? formatFundingPercent(point.value) : formatMetricValue(id, point.value, locale)}${id === "oi" && unit ? ` ${unit}` : ""}`;
      return {
        name,
        label,
        value,
        timestamp: point.timestamp,
        time: formatHistoryTime(point.timestamp, locale)
      };
    }
    function select(index, action) {
      selected = index;
      const point = observations[index];
      const item = record(point);
      button.title = `${name} · ${item.label}
${item.time}
${item.value}`;
      button.setAttribute("aria-label", `${name} · ${tradingText("inspect", locale)} · ${item.time} · ${item.value}`);
      guide.setAttribute("x1", String(x(point)));
      guide.setAttribute("x2", String(x(point)));
      guide.setAttribute("opacity", action === "initial" ? "0" : "0.65");
      if (action !== "initial") onInspect(item, action);
    }
    for (let index = 0; index < observations.length; index += 1) {
      const point = observations[index];
      const left = index === 0 ? 0 : (x(observations[index - 1]) + x(point)) / 2;
      const right = index === observations.length - 1 ? WIDTH : (x(point) + x(observations[index + 1])) / 2;
      const hit = svgElement("rect", {
        x: coordinate(left),
        y: 0,
        width: coordinate(right - left),
        height: HEIGHT,
        class: "td-spark-hit",
        "data-history-index": index,
        "data-timestamp": point.timestamp
      });
      const title = svgElement("title", {});
      const item = record(point);
      title.textContent = `${item.time}
${item.value}`;
      hit.append(title);
      listen(hit, "pointerenter", () => select(index, "hover"));
      listen(hit, "pointerdown", () => select(index, "hover"));
      svg.append(hit);
    }
    listen(button, "click", (event) => {
      const hit = event.target.closest("[data-history-index]");
      select(hit ? Number(hit.dataset.historyIndex) : selected, "toggle");
    });
    listen(button, "keydown", (event) => {
      const movement = { ArrowLeft: -1, ArrowRight: 1 };
      if (event.key in movement) {
        event.preventDefault();
        select(Math.max(0, Math.min(observations.length - 1, selected + movement[event.key])), "open");
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        select(event.key === "Home" ? 0 : observations.length - 1, "open");
      } else if (event.key === "Escape") {
        event.preventDefault();
        onInspect(record(observations[selected]), "close");
      }
    });
    listen(button, "pointerleave", () => {
      if (button.getAttribute("aria-expanded") === "false") guide.setAttribute("opacity", "0");
    });
    select(selected, "initial");
    return { element: button, count: observations.length, destroy };
  }

  // src/shared/data-panel-layout.js
  var DATA_PANEL_LAYOUT_EVENT = "jh-data-panels-layout-change";
  var DATA_PANEL_WIDTHS = Object.freeze({ trading: 320, cmc: 336 });
  var PANEL_IDS = Object.freeze({
    trading: "jh-binance-trading-data-panel",
    cmc: "jh-binance-cmc-data-panel"
  });
  var TWO_COLUMN_WIDTH = DATA_PANEL_WIDTHS.trading + DATA_PANEL_WIDTHS.cmc + 48;
  function hasVisibleDataPanelPeer(document2, kind) {
    const peer = document2.getElementById(PANEL_IDS[kind === "trading" ? "cmc" : "trading"]);
    return peer !== null && peer.style.display !== "none";
  }
  function calculateDataPanelLayout({ kind, panelWidth, viewportWidth, viewportHeight, savedPosition, hasPeer }) {
    if (kind !== "trading" && kind !== "cmc") throw new Error("Unknown data panel kind");
    if (savedPosition !== null) {
      return { ...savedPosition, maxHeight: Math.max(48, viewportHeight - savedPosition.top - 8) };
    }
    const stacked = hasPeer && viewportWidth < TWO_COLUMN_WIDTH;
    const sectionHeight = Math.max(48, Math.floor((viewportHeight - 24) / 2));
    const targetTop = stacked ? kind === "trading" ? 8 : 16 + sectionHeight : 60;
    const top = Math.max(0, Math.min(targetTop, viewportHeight - 48));
    const peerWidth = hasPeer && !stacked && kind === "cmc" ? DATA_PANEL_WIDTHS.trading + 16 : 0;
    const targetLeft = viewportWidth - panelWidth - 16 - peerWidth;
    const left = Math.max(0, Math.min(Math.max(stacked ? 8 : 16, targetLeft), viewportWidth - panelWidth));
    const availableHeight = Math.max(48, viewportHeight - top - 8);
    return { left, top, maxHeight: stacked ? Math.min(sectionHeight, availableHeight) : availableHeight };
  }

  // src/binance-trading-data/panel-view.js
  var PANEL_ID = "jh-binance-trading-data-panel";
  var INITIAL_FUNDING_STATE = Object.freeze({
    current: null,
    intervalHours: null,
    receivedAt: null,
    cached: false,
    error: null,
    intervalCached: false,
    intervalError: null
  });
  function styles() {
    const scope = `#${PANEL_ID}`;
    return `
    ${scope} {
      --td-bg: var(--color-PrimaryBg, light-dark(#ffffff, #1e2329));
      --td-head: var(--color-SecondaryBg, light-dark(#fafbfc, #242a32));
      --td-text: var(--color-TextPrimary, light-dark(#202630, #eaecef));
      --td-muted: var(--color-TextSecondary, light-dark(#626c7d, #a6b0bf));
      --td-border: var(--color-Line, light-dark(#e4e8ef, #353d48));
      --td-buy: var(--color-Buy, light-dark(#24865e, #65c59c));
      --td-sell: var(--color-Sell, light-dark(#db3a50, #ff7c8f));
      --td-chart: var(--color-PrimaryYellow, light-dark(#b68208, #f0b90b));
      --td-highlight: color-mix(in srgb, var(--td-chart) 7%, var(--td-bg));
      --td-focus: light-dark(#315fe8, #9bb7ff);
      color-scheme: light dark;
      box-sizing: border-box;
      background: var(--td-bg);
      color: var(--td-text);
      border: 1px solid var(--td-border);
      border-radius: 10px;
      box-shadow: 0 6px 24px #00000020;
      font: 400 13px/1.35 BinancePlex, system-ui, -apple-system, sans-serif;
      text-align: left;
      overflow: hidden;
    }
    ${scope} * { box-sizing: border-box; }
    ${scope} [hidden] { display: none !important; }
    ${scope} #${PANEL_ID}-header {
      display: flex; align-items: center; gap: 6px; min-height: 35px;
      padding: 5px 8px; flex: 0 0 auto; cursor: move; user-select: none;
      border-bottom: 1px solid var(--td-border); background: var(--td-head);
    }
    ${scope} .td-grip { color: var(--td-muted); font-size: 14px; flex: 0 0 auto; }
    ${scope} .td-title { margin: 0; font-size: 14px; font-weight: 600; white-space: nowrap; }
    ${scope} #${PANEL_ID}-symbol {
      min-width: 0; color: var(--td-muted); font-size: 12px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    ${scope} .td-actions { display: flex; gap: 3px; margin-left: auto; flex: 0 0 auto; }
    ${scope} button { font: inherit; cursor: pointer; border: 0; color: inherit; background: transparent; }
    ${scope} .td-actions button {
      display: flex; align-items: center; justify-content: center;
      width: 24px; height: 24px; padding: 2px; border-radius: 4px;
      color: var(--td-muted); font-size: 17px;
    }
    ${scope} button:hover { background: var(--td-highlight); }
    ${scope} button:focus-visible { outline: 2px solid var(--td-focus); outline-offset: 2px; }
    ${scope} #${PANEL_ID}-body { min-height: 0; overflow: auto; overscroll-behavior: contain; }
    ${scope} table { width: 100%; table-layout: fixed; border-collapse: collapse; }
    ${scope} .td-name-col { width: 40%; }
    ${scope} .td-trend-col { width: 30%; }
    ${scope} .td-value-col { width: 30%; }
    ${scope} thead { position: sticky; top: 0; z-index: 1; background: var(--td-head); }
    ${scope} thead th { color: var(--td-muted); font-size: 11px; font-weight: 500; padding: 4px; text-align: left; }
    ${scope} thead th:nth-child(2) { text-align: center; }
    ${scope} thead th:last-child { text-align: right; }
    ${scope} tbody th, ${scope} tbody td { padding: 4px; vertical-align: middle; border-top: 1px solid var(--td-border); }
    ${scope} .td-name { color: var(--td-muted); text-align: left; font-weight: 400; overflow-wrap: anywhere; }
    ${scope} .td-trend { padding: 4px 2px; text-align: center; }
    ${scope} .td-value { text-align: right; font-variant-numeric: tabular-nums; }
    ${scope} .td-number { font-weight: 500; overflow-wrap: anywhere; }
    ${scope} .jh-td-flash { animation: jh-td-value-change 1s ease-out; }
    @keyframes jh-td-value-change { from { background: color-mix(in srgb, var(--td-chart) 25%, transparent); } to { background: transparent; } }
    ${scope} small { display: block; margin-top: 1px; font-size: 11px; font-weight: 400; color: var(--td-muted); }
    ${scope} .td-value small { line-height: 1.35; }
    ${scope} .td-spark-button { display: block; width: 100%; padding: 0; border-radius: 4px; color: var(--td-chart); touch-action: pan-y; }
    ${scope} .td-sparkline { display: block; width: 100%; height: 26px; overflow: visible; }
    ${scope} .td-spark-path { fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
    ${scope} .td-spark-reference { stroke: var(--td-border); stroke-width: 1; }
    ${scope} .td-spark-guide { stroke: var(--td-muted); stroke-width: 1; pointer-events: none; }
    ${scope} .td-spark-point { fill: currentColor; }
    ${scope} .td-spark-hit { fill: transparent; pointer-events: all; }
    ${scope} .td-buy-bar { fill: var(--td-buy); }
    ${scope} .td-sell-bar { fill: var(--td-sell); }
    ${scope} .td-no-history { display: block; padding: 3px 0; color: var(--td-muted); font-size: 11px; }
    ${scope} .td-trend-caption, ${scope} .td-last-settled { font-size: 11px; }
    ${scope} .td-last-settled { display: block; margin-top: 2px; color: var(--td-text); font-variant-numeric: tabular-nums; }
    ${scope} .td-last-value { display: inline-block; white-space: nowrap; }
    ${scope} .td-legend { display: flex; justify-content: center; gap: 6px; margin-top: 1px; color: var(--td-muted); font-size: 11px; }
    ${scope} .td-legend span { display: inline-flex; align-items: center; gap: 3px; }
    ${scope} .td-legend i { display: inline-block; width: 5px; height: 7px; background: var(--td-buy); }
    ${scope} .td-legend span:last-child i { background: var(--td-sell); }
    ${scope} .td-signal-long { color: var(--td-buy); }
    ${scope} .td-signal-short { color: var(--td-sell); }
    ${scope} .td-signal-neutral { color: var(--td-text); }
    ${scope} .td-dot { display: inline-block; width: 7px; height: 7px; margin-left: 5px; border-radius: 50%; border: 1px solid currentColor; background: currentColor; }
    ${scope} .td-signal-neutral .td-dot { color: var(--td-muted); }
    ${scope} .td-cached .td-dot { background: transparent; }
    ${scope} .td-data-status { color: var(--td-muted); }
    ${scope} .td-funding-row { background: var(--td-highlight); }
    ${scope} .td-funding-row .td-name { color: var(--td-text); font-weight: 500; }
    ${scope} .td-funding-row .td-number { font-size: 14px; font-weight: 600; }
    ${scope} .td-current-label { color: var(--td-text); margin: 0 0 1px; }
    ${scope} .td-countdown { font-variant-numeric: tabular-nums; }
    ${scope} .td-history-detail td { padding: 6px 8px; background: var(--td-head); }
    ${scope} .td-history-inspection { display: flex; flex-wrap: wrap; gap: 5px 12px; font-size: 11px; color: var(--td-muted); user-select: text; }
    ${scope} .td-history-inspection strong { flex: 1 0 100%; color: var(--td-text); font-size: 12px; font-weight: 500; }
    ${scope} .td-history-value { color: var(--td-text); font-variant-numeric: tabular-nums; }
    ${scope} #${PANEL_ID}-composite { padding: 6px 8px; border-top: 1px solid var(--td-border); }
    ${scope} .td-composite-line { display: flex; justify-content: space-between; gap: 6px; font-weight: 600; list-style: none; cursor: pointer; }
    ${scope} .td-composite-line::-webkit-details-marker { display: none; }
    ${scope} .td-composite-line:focus-visible { outline: 2px solid var(--td-focus); outline-offset: 2px; }
    ${scope} .td-composite-info { margin-left: 4px; color: var(--td-muted); font-size: 11px; font-weight: 400; }
    ${scope} .td-bias { white-space: nowrap; }
    ${scope} .td-vote-track { display: flex; height: 3px; margin-top: 4px; border-radius: 3px; overflow: hidden; background: var(--td-border); }
    ${scope} .td-vote-track span:first-child { background: var(--td-buy); }
    ${scope} .td-vote-track span:last-child { background: var(--td-sell); margin-left: auto; }
    ${scope} .td-composite-votes { margin-top: 3px; }
    ${scope} .td-method-note { margin-top: 4px; line-height: 1.4; }
    ${scope} #${PANEL_ID}-footer { padding: 5px 8px; color: var(--td-muted); font-size: 11px; border-top: 1px solid var(--td-border); font-variant-numeric: tabular-nums; }
    ${scope} .td-footer-line { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 3px 8px; }
    @media (max-width: 540px) {
      ${scope} { font-size: 12px; }
      ${scope} .td-funding-row .td-number { font-size: 13px; }
    }
  `;
  }
  function createTradingDataView({ document: document2, panel, locale, collapsed, onCollapse, onClose }) {
    const style = document2.createElement("style");
    style.textContent = styles();
    panel.append(style);
    Object.assign(panel.style, {
      width: `${DATA_PANEL_WIDTHS.trading}px`,
      maxWidth: "calc(100vw - 16px)",
      maxHeight: "calc(100vh - 24px)",
      display: "flex",
      flexDirection: "column"
    });
    const node = (tag, className = "", text = "") => {
      const element = document2.createElement(tag);
      element.className = className;
      element.textContent = text;
      return element;
    };
    const setText = (element, value) => {
      if (element.textContent !== value) element.textContent = value;
    };
    const identify = (element, suffix) => {
      element.id = `${PANEL_ID}-${suffix}`;
      return element;
    };
    const role = (element, value) => {
      element.dataset.role = value;
      return element;
    };
    const header = identify(node("header"), "header");
    const grip = node("span", "td-grip", "☰");
    grip.setAttribute("aria-hidden", "true");
    const title = node("h2", "td-title");
    const symbol = identify(node("span"), "symbol");
    const actions = node("div", "td-actions");
    const collapseButton = identify(node("button"), "collapse");
    const closeButton = identify(node("button", "", "×"), "close");
    collapseButton.type = closeButton.type = "button";
    collapseButton.setAttribute("aria-controls", `${PANEL_ID}-body`);
    actions.append(collapseButton, closeButton);
    header.append(grip, title, symbol, actions);
    const body = identify(node("div"), "body");
    const table = node("table");
    const columns = node("colgroup");
    for (const name of ["name", "trend", "value"]) columns.append(node("col", `td-${name}-col`));
    const tableHead = node("thead");
    const headingRow = node("tr");
    const headings = ["metric", "history", "value"].map((key) => {
      const heading = node("th");
      heading.scope = "col";
      heading.dataset.copy = key;
      headingRow.append(heading);
      return heading;
    });
    tableHead.append(headingRow);
    const rows = identify(node("tbody"), "rows");
    table.append(columns, tableHead, rows);
    const composite = identify(node("div"), "composite");
    const footer = identify(node("footer"), "footer");
    const footerLine = node("div", "td-footer-line");
    footerLine.append(role(node("span"), "updated-at"), role(node("span"), "elapsed"));
    footer.append(footerLine);
    body.append(table, composite, footer);
    panel.append(header, body);
    let currentModel = null;
    let currentFunding = INITIAL_FUNDING_STATE;
    let currentClock = null;
    let fundingNodes = null;
    let charts = [];
    let openDetail = null;
    function closeDetails() {
      if (openDetail !== null) {
        openDetail.row.remove();
        openDetail.button.setAttribute("aria-expanded", "false");
        openDetail = null;
      }
    }
    function updateHeading() {
      const panelTitle = tradingText("title", locale);
      panel.lang = locale;
      panel.setAttribute("aria-label", panelTitle);
      table.setAttribute("aria-label", panelTitle);
      setText(title, panelTitle);
      for (const heading of headings) setText(heading, tradingText(heading.dataset.copy, locale));
      const collapseTitle = tradingText(collapsed ? "expand" : "collapse", locale);
      collapseButton.title = collapseTitle;
      collapseButton.setAttribute("aria-label", collapseTitle);
      collapseButton.setAttribute("aria-expanded", String(!collapsed));
      setText(collapseButton, collapsed ? "□" : "−");
      closeButton.title = tradingText("close", locale);
      closeButton.setAttribute("aria-label", closeButton.title);
      body.style.display = collapsed ? "none" : "block";
    }
    function collapse() {
      collapsed = !collapsed;
      updateHeading();
      onCollapse(collapsed);
    }
    function close() {
      onClose();
    }
    collapseButton.addEventListener("click", collapse);
    closeButton.addEventListener("click", close);
    function showStatus(element, key, error) {
      const text = key === null ? "" : tradingText(key, locale);
      setText(element, text);
      element.hidden = text === "";
      element.title = error ? `${text}: ${error}` : text;
    }
    function updateCountdown() {
      if (fundingNodes === null || !fundingNodes.number.isConnected) return;
      let value;
      if (currentClock === null || !currentClock.calibrated) {
        value = tradingText("clockUnavailable", locale);
      } else if (currentFunding.current === null) {
        value = "--";
      } else {
        const remaining = currentFunding.current.nextFundingTime - currentClock.now;
        if (remaining <= 0) {
          value = tradingText("waitingUpdate", locale);
        } else {
          const seconds = Math.ceil(remaining / 1e3);
          const hours = Math.floor(seconds / 3600);
          const minutes = Math.floor(seconds % 3600 / 60);
          value = [hours, minutes, seconds % 60].map((part) => String(part).padStart(2, "0")).join(":");
        }
      }
      setText(fundingNodes.countdown, `${tradingText("countdown", locale)} ${value}`);
    }
    function updateFunding() {
      if (fundingNodes === null || !fundingNodes.number.isConnected) return;
      const state = currentFunding;
      const expired = state.current !== null && currentClock !== null && currentClock.calibrated && state.current.nextFundingTime <= currentClock.now;
      setText(fundingNodes.number, formatFundingPercent(state.current === null || expired ? null : state.current.value));
      setText(fundingNodes.period, formatFundingPeriod(state.intervalHours, locale));
      fundingNodes.number.title = tradingText("fundingNote", locale);
      if (state.current !== null) fundingNodes.number.title += `
${formatHistoryTime(state.current.time, locale)}`;
      const status = expired && state.error === null ? "waitingUpdate" : state.current === null ? state.error ? "loadFailed" : "loading" : state.cached ? state.error ? "cachedFailure" : "cached" : state.error ? "refreshFailed" : null;
      const intervalStatus = state.intervalHours !== null && state.intervalCached ? state.intervalError ? "intervalCachedFailure" : "intervalCached" : state.intervalError ? "intervalLoadFailed" : null;
      showStatus(fundingNodes.status, status, state.error);
      showStatus(fundingNodes.intervalStatus, intervalStatus, state.intervalError);
      updateCountdown();
    }
    function renderIndicator(indicator, previousValue) {
      const { id } = indicator;
      const isFunding = id === "funding";
      const row = node("tr", isFunding ? "td-funding-row" : "");
      row.dataset.metric = id;
      row.classList.toggle("td-cached", indicator.cached && indicator.value !== null);
      const name = node("th", "td-name", tradingMetricText(id, "name", locale));
      name.scope = "row";
      name.title = tradingMetricText(id, "detail", locale);
      const trend = node("td", "td-trend");
      const detailRow = node("tr", "td-history-detail");
      detailRow.id = `${PANEL_ID}-history-${id}`;
      const detailCell = node("td");
      detailCell.colSpan = 3;
      const inspection = node("div", "td-history-inspection");
      inspection.setAttribute("role", "status");
      inspection.setAttribute("aria-atomic", "true");
      const detailTitle = node("strong");
      const detailTime = node("time");
      const detailValue = node("span", "td-history-value");
      inspection.append(detailTitle, detailTime, detailValue);
      detailCell.append(inspection);
      detailRow.append(detailCell);
      const chart = createHistoryChart({
        document: document2,
        indicator,
        locale,
        onInspect(record, action) {
          setText(detailTitle, `${record.name} · ${formatHistoryCount(id, chart.count, locale)}`);
          setText(detailTime, record.time);
          detailTime.dateTime = new Date(record.timestamp).toISOString();
          setText(detailValue, record.value);
          if (action === "hover") return;
          const shouldClose = action === "close" || action === "toggle" && openDetail?.row === detailRow;
          closeDetails();
          if (shouldClose) return;
          row.after(detailRow);
          chart.element.setAttribute("aria-expanded", "true");
          openDetail = { row: detailRow, button: chart.element };
        }
      });
      charts.push(chart);
      if (chart.count > 0) chart.element.setAttribute("aria-controls", detailRow.id);
      trend.append(chart.element);
      if (isFunding) {
        trend.append(node("small", "td-trend-caption", formatHistoryCount(id, chart.count, locale)));
        const settled = node("span", "td-last-settled");
        settled.append(document2.createTextNode(`${tradingText("last", locale)} `), node("span", "td-last-value", indicator.display));
        trend.append(settled);
      }
      if (id === "taker") {
        const legend = node("div", "td-legend");
        for (const side of ["buy", "sell"]) {
          const item = node("span");
          const swatch = node("i");
          swatch.setAttribute("aria-hidden", "true");
          item.append(swatch, document2.createTextNode(tradingText(side, locale)));
          legend.append(item);
        }
        trend.append(legend);
      }
      const value = node("td", `td-value td-signal-${isFunding ? "neutral" : indicator.signal}`);
      const number = node("span", "td-number", isFunding ? "--" : indicator.display);
      if (!isFunding && previousValue !== void 0 && previousValue !== null && indicator.value !== null && previousValue !== indicator.value) {
        number.classList.add("jh-td-flash");
      }
      if (isFunding) {
        const period = role(node("small", "td-current-label"), "funding-period");
        const countdown = role(node("small", "td-countdown"), "funding-countdown");
        const status = role(node("small", "td-data-status"), "funding-status");
        const intervalStatus = role(node("small", "td-data-status"), "funding-interval-status");
        role(number, "current-funding");
        value.append(period, number, countdown, status, intervalStatus);
        fundingNodes = { number, period, countdown, status, intervalStatus };
      } else {
        const reading = node("div");
        const dot = node("span", "td-dot");
        dot.setAttribute("role", "img");
        dot.setAttribute("aria-label", tradingText(indicator.signal, locale));
        reading.append(number, dot);
        value.append(reading);
        const unit = id === "taker" ? tradingText("buySellRatio", locale) : id === "basis" ? tradingText("basisRate", locale) : indicator.unit;
        if (unit) value.append(node("small", "td-unit", unit));
      }
      const dataStatus = node("small", "td-data-status");
      const statusKey = indicator.value === null ? indicator.error ? "loadFailed" : "missing" : indicator.cached ? indicator.error ? "cachedFailure" : "cached" : null;
      showStatus(dataStatus, statusKey, indicator.error);
      (isFunding ? trend : value).append(dataStatus);
      row.append(name, trend, value);
      rows.append(row);
    }
    function renderComposite(model) {
      const signal = model.longCount === model.shortCount ? "neutral" : model.longCount > model.shortCount ? "long" : "short";
      const method = node("details", "td-method");
      method.open = composite.querySelector(".td-method")?.open === true;
      const line = node("summary", "td-composite-line");
      const label = node("span", "", tradingText("composite", locale));
      const info = node("span", "td-composite-info", "ⓘ");
      info.setAttribute("aria-hidden", "true");
      label.append(info);
      line.append(label, node("span", `td-bias td-signal-${signal}`, `${tradingText(signal, locale)} ${model.longCount}:${model.shortCount}`));
      method.append(line, node("small", "td-method-note", tradingText("simplifiedNote", locale)));
      const track = node("div", "td-vote-track");
      const votes = formatVotes(model, locale);
      track.setAttribute("role", "img");
      track.setAttribute("aria-label", votes);
      for (const count of [model.longCount, model.shortCount]) {
        const bar = node("span");
        bar.style.width = `${model.total > 0 ? count / model.total * 100 : 0}%`;
        track.append(bar);
      }
      composite.replaceChildren(method, track, node("small", "td-composite-votes", votes));
    }
    function render(model) {
      const previousValues = new Map(currentModel !== null && currentModel.symbol === model.symbol ? currentModel.indicators.map((indicator) => [indicator.id, indicator.value]) : []);
      currentModel = model;
      if (![symbol, rows, composite, footer].every((element) => element.isConnected)) return;
      setText(symbol, model.symbol);
      symbol.title = model.symbol;
      closeDetails();
      charts.forEach((chart) => chart.destroy());
      charts = [];
      rows.replaceChildren();
      fundingNodes = null;
      for (const indicator of model.indicators) renderIndicator(indicator, previousValues.get(indicator.id));
      renderComposite(model);
      updateFunding();
    }
    updateHeading();
    return {
      render,
      setFunding(state, clock) {
        currentFunding = state;
        currentClock = clock;
        updateFunding();
      },
      updateClock(clock) {
        currentClock = clock;
        updateFunding();
      },
      setLocale(nextLocale) {
        if (locale === nextLocale) return;
        locale = nextLocale;
        updateHeading();
        if (currentModel !== null) render(currentModel);
      },
      destroy() {
        collapseButton.removeEventListener("click", collapse);
        closeButton.removeEventListener("click", close);
        charts.forEach((chart) => chart.destroy());
        charts = [];
        closeDetails();
        style.remove();
      }
    };
  }

  // src/binance-trading-data/index.user.js
  (function() {
    "use strict";
    function isFuturesTradingPage() {
      return isFuturesTradingPathname(location.pathname);
    }
    const PREFIX = "[交易数据]";
    const PANEL_ID2 = "jh-binance-trading-data-panel";
    const PANEL_WIDTH = DATA_PANEL_WIDTHS.trading;
    const STORAGE_POS_KEY = "jh_binance_trading_data_pos";
    const STORAGE_COLLAPSED_KEY = "jh_binance_trading_data_collapsed";
    const DEBUG = false;
    const PERIOD_MS = 5 * 60 * 1e3;
    const FIRST_DELAY = 5e3;
    const RETRY_DELAYS = [1e4, 15e3, 2e4];
    const RETRY_FALLBACK = 3e4;
    const ROUTE_WATCHDOG_MS = 5e3;
    const DEFAULT_PERIOD = "5m";
    const DATA_LIMIT = 30;
    const FUNDING_HISTORY_LIMIT = 40;
    const CURRENT_FUNDING_REFRESH_MS = 15e3;
    const BACKGROUND_FUNDING_REFRESH_MS = 6e4;
    const FUNDING_REQUEST_TIMEOUT_MS = 1e4;
    const CLOCK_REQUEST_TIMEOUT_MS = 5e3;
    const CLOCK_MAX_ROUND_TRIP_MS = 2e3;
    const API_BASE = "https://www.binance.com";
    const API_PATHS = {
      openInterest: "/futures/data/openInterestHist",
      topAccountRatio: "/futures/data/topLongShortAccountRatio",
      topPositionRatio: "/futures/data/topLongShortPositionRatio",
      globalAccountRatio: "/futures/data/globalLongShortAccountRatio",
      takerRatio: "/futures/data/takerlongshortRatio",
      basis: "/futures/data/basis",
      fundingRate: "/fapi/v1/fundingRate",
      currentFunding: "/fapi/v1/premiumIndex",
      fundingInterval: "/fapi/v1/fundingInfo",
      serverTime: "/fapi/v1/time"
    };
    const PERIOD_KEYS = ["openInterest", "topAccountRatio", "topPositionRatio", "globalAccountRatio", "takerRatio", "basis"];
    function emit(level, ...args) {
      if (!DEBUG && level !== "ERR") return;
      console.error(PREFIX, `[${level}]`, ...args);
    }
    function log(...args) {
      emit("LOG", ...args);
    }
    function err(...args) {
      emit("ERR", ...args);
    }
    let lastSymbol = null;
    let activePath = null;
    function getCurrentSymbol() {
      return parseFuturesTradingSymbolFromPathname(location.pathname);
    }
    function isActiveTradingPage() {
      return !panelClosed && !pageSuspended && isFuturesTradingPage();
    }
    async function fetchJson(path, params, signal) {
      signal.throwIfAborted();
      const url = new URL(path, API_BASE);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      const href = url.toString();
      try {
        const resp = await fetch(href, { signal });
        if (!resp.ok) throw Object.assign(new Error(`HTTP ${resp.status}`), { status: resp.status });
        return await resp.json();
      } catch (e1) {
        if (signal.aborted || e1.name === "AbortError") throw e1;
        if (e1.status && e1.status >= 400 && e1.status < 500) throw e1;
        log("重试:", path);
        const resp = await fetch(href, { signal });
        if (!resp.ok) throw new Error(`HTTP ${resp.status} (retry)`);
        return await resp.json();
      }
    }
    function fetchOpenInterest(symbol, signal) {
      return fetchJson(API_PATHS.openInterest, { symbol, period: DEFAULT_PERIOD, limit: DATA_LIMIT }, signal);
    }
    function fetchTopAccountRatio(symbol, signal) {
      return fetchJson(API_PATHS.topAccountRatio, { symbol, period: DEFAULT_PERIOD, limit: DATA_LIMIT }, signal);
    }
    function fetchTopPositionRatio(symbol, signal) {
      return fetchJson(API_PATHS.topPositionRatio, { symbol, period: DEFAULT_PERIOD, limit: DATA_LIMIT }, signal);
    }
    function fetchGlobalAccountRatio(symbol, signal) {
      return fetchJson(API_PATHS.globalAccountRatio, { symbol, period: DEFAULT_PERIOD, limit: DATA_LIMIT }, signal);
    }
    function fetchTakerRatio(symbol, signal) {
      return fetchJson(API_PATHS.takerRatio, { symbol, period: DEFAULT_PERIOD, limit: DATA_LIMIT }, signal);
    }
    function fetchBasis(symbol, signal) {
      return fetchJson(API_PATHS.basis, { pair: symbol, period: DEFAULT_PERIOD, limit: DATA_LIMIT, contractType: "PERPETUAL" }, signal);
    }
    function fetchFundingRate(symbol, signal) {
      return fetchJson(API_PATHS.fundingRate, { symbol, limit: FUNDING_HISTORY_LIMIT }, signal);
    }
    const FETCHER_MAP = {
      openInterest: fetchOpenInterest,
      topAccountRatio: fetchTopAccountRatio,
      topPositionRatio: fetchTopPositionRatio,
      globalAccountRatio: fetchGlobalAccountRatio,
      takerRatio: fetchTakerRatio,
      basis: fetchBasis
    };
    let serverOffset = 0;
    let clockCalibrated = false;
    let sessionGeneration = 0;
    let clockRequestId = 0;
    let serverTimeRequest = null;
    let historyController = null;
    function currentSession() {
      return { generation: sessionGeneration, path: location.pathname, symbol: getCurrentSymbol(), historyController };
    }
    function sessionIsCurrent(session) {
      return session.generation === sessionGeneration && session.path === location.pathname && session.path === activePath && session.symbol === getCurrentSymbol() && isActiveTradingPage();
    }
    async function syncServerTime(session) {
      const requestId = ++clockRequestId;
      const startedAt = Date.now();
      const request = { controller: new AbortController(), timeout: null };
      serverTimeRequest = request;
      request.timeout = setTimeout(function() {
        request.controller.abort(new DOMException("Server time request timed out", "TimeoutError"));
      }, CLOCK_REQUEST_TIMEOUT_MS);
      try {
        const resp = await fetch(API_BASE + API_PATHS.serverTime, { signal: request.controller.signal });
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        const json = await resp.json();
        if (!Number.isSafeInteger(json.serverTime) || json.serverTime <= 0) throw new TypeError("Invalid server time");
        if (!sessionIsCurrent(session) || requestId !== clockRequestId) return;
        const receivedAt = Date.now();
        const roundTrip = receivedAt - startedAt;
        if (roundTrip < 0 || roundTrip > CLOCK_MAX_ROUND_TRIP_MS) throw new Error("Server time round trip exceeded the calibration limit");
        serverOffset = json.serverTime - (startedAt + receivedAt) / 2;
        clockCalibrated = true;
        log("服务器时间偏移:", serverOffset + "ms");
      } catch (e) {
        if (!sessionIsCurrent(session) || requestId !== clockRequestId) return;
        err("获取服务器时间失败，使用本地时间", e.message);
        serverOffset = 0;
        clockCalibrated = false;
      } finally {
        clearTimeout(request.timeout);
        if (serverTimeRequest === request) serverTimeRequest = null;
      }
    }
    function serverNow() {
      return Date.now() + serverOffset;
    }
    let dataStore = {};
    let dataCache = {};
    let failedKeys = /* @__PURE__ */ new Set();
    let endpointErrors = {};
    const historyUpdatedAt = {};
    function extractEndpointTs(data) {
      if (!Array.isArray(data) || data.length === 0) return 0;
      return Number(data[data.length - 1].timestamp) || 0;
    }
    async function fetchPeriodData(symbol, keys, signal) {
      signal.throwIfAborted();
      if (!keys || keys.length === 0) return {};
      var fetchers = keys.map(async function(k) {
        return parseHistory(k, await FETCHER_MAP[k](symbol, signal), symbol);
      });
      var results = await Promise.allSettled(fetchers);
      signal.throwIfAborted();
      const aborted = results.find((result) => result.status === "rejected" && result.reason.name === "AbortError");
      if (aborted) throw aborted.reason;
      var backup = dataCache[symbol] || {};
      var entries = {};
      keys.forEach(function(key, i) {
        if (results[i].status === "fulfilled") {
          entries[key] = { data: results[i].value, cached: false, error: null };
        } else {
          err(key + " 请求失败:", results[i].reason?.message || results[i].reason);
          if (backup[key]) {
            entries[key] = { data: backup[key], cached: true, error: String(results[i].reason?.message || results[i].reason) };
            log(key + " 使用缓存数据");
          } else {
            entries[key] = { data: null, cached: true, error: String(results[i].reason?.message || results[i].reason) };
          }
        }
      });
      return entries;
    }
    async function fetchFundingRateData(symbol, signal) {
      var backup = dataCache[symbol] || {};
      try {
        var data = parseHistory("fundingRate", await fetchFundingRate(symbol, signal), symbol);
        signal.throwIfAborted();
        return { data, cached: false, error: null };
      } catch (e) {
        signal.throwIfAborted();
        if (e.name === "AbortError") throw e;
        err("fundingRate 请求失败:", e);
        return { data: backup.fundingRate || null, cached: true, error: String(e.message || e) };
      }
    }
    function applyResults(symbol, periodEntries, fundingEntry) {
      if (!dataStore[symbol]) dataStore[symbol] = {};
      if (!dataCache[symbol]) dataCache[symbol] = {};
      if (periodEntries) {
        for (var key in periodEntries) {
          var e = periodEntries[key];
          dataStore[symbol][key] = e.data;
          endpointErrors[key] = e.error;
          if (!e.cached) {
            dataCache[symbol][key] = e.data;
            failedKeys.delete(key);
          } else {
            failedKeys.add(key);
          }
        }
      }
      if (fundingEntry) {
        dataStore[symbol].fundingRate = fundingEntry.data;
        endpointErrors.fundingRate = fundingEntry.error;
        if (!fundingEntry.cached) {
          dataCache[symbol].fundingRate = fundingEntry.data;
          failedKeys.delete("fundingRate");
        } else {
          failedKeys.add("fundingRate");
        }
      }
      const freshHistory = periodEntries && Object.values(periodEntries).some((entry) => !entry.cached) || fundingEntry && !fundingEntry.cached;
      if (freshHistory) historyUpdatedAt[symbol] = Date.now();
      lastUpdateTs = historyUpdatedAt[symbol] || 0;
    }
    function getPendingKeys(symbol, targetTs) {
      var store = dataStore[symbol] || {};
      return PERIOD_KEYS.filter(function(key) {
        return extractEndpointTs(store[key]) < targetTs;
      });
    }
    let panelView = null;
    function uiLocale() {
      return resolveUiLocaleFromPathname(location.pathname);
    }
    function fundingClock() {
      return { now: serverNow(), calibrated: clockCalibrated, localNow: Date.now() };
    }
    function ensurePanel() {
      let panel = document.getElementById(PANEL_ID2);
      if (panel) return panel;
      panel = document.createElement("section");
      panel.id = PANEL_ID2;
      Object.assign(panel.style, { position: "fixed", top: "60px", right: "16px", zIndex: "999998" });
      document.body.appendChild(panel);
      panelView = createTradingDataView({
        document,
        panel,
        locale: uiLocale(),
        collapsed: loadCollapsed(),
        onCollapse(collapsed) {
          saveCollapsed(collapsed);
          keepPanelInViewport(panel);
        },
        onClose() {
          panel.style.display = "none";
          panelClosed = true;
          stopLoop();
          cleanupPanelDrag();
          panelView.destroy();
          window.dispatchEvent(new CustomEvent(DATA_PANEL_LAYOUT_EVENT));
        }
      });
      keepPanelInViewport(panel);
      cleanupPanelDrag();
      dragCleanup = setupDrag(panel);
      window.dispatchEvent(new CustomEvent(DATA_PANEL_LAYOUT_EVENT));
      return panel;
    }
    function renderPanel(result, symbol) {
      if (!isActiveTradingPage() || getCurrentSymbol() !== symbol) return;
      const panel = ensurePanel();
      panelView.setLocale(uiLocale());
      panelView.render(result);
      panelView.setFunding(currentFundingState, fundingClock());
      const footer = panel.querySelector("#" + PANEL_ID2 + "-footer");
      if (footer) updateFooter(footer);
    }
    function updateDisplayClock() {
      if (document.hidden || !isActiveTradingPage() || !panelView) return;
      const footer = document.getElementById(PANEL_ID2 + "-footer");
      if (footer) updateFooter(footer);
      panelView.updateClock(fundingClock());
    }
    function startDisplayClock() {
      if (document.hidden || agoTimer) return;
      updateDisplayClock();
      agoTimer = setInterval(updateDisplayClock, 1e3);
    }
    function stopDisplayClock() {
      clearInterval(agoTimer);
      agoTimer = null;
    }
    function updateFooter(el) {
      const locale = uiLocale();
      let updatedText = locale === "zh-CN" ? "等待数据" : "Waiting for data";
      let elapsedText = "";
      if (lastUpdateTs) {
        const clock = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(lastUpdateTs);
        const ago = Math.max(0, Math.floor((Date.now() - lastUpdateTs) / 1e3));
        updatedText = (locale === "zh-CN" ? "更新于 " : "Updated ") + clock;
        elapsedText = locale === "zh-CN" ? ago + "秒前" : ago + "s ago";
      }
      const updated = el.querySelector('[data-role="updated-at"]');
      const elapsed = el.querySelector('[data-role="elapsed"]');
      if (updated.textContent !== updatedText) updated.textContent = updatedText;
      if (elapsed.textContent !== elapsedText) elapsed.textContent = elapsedText;
    }
    let currentFundingTimer = null;
    let currentFundingRequest = null;
    let currentFundingCompletedAt = null;
    let fundingIntervalRequest = null;
    let currentFundingState = emptyCurrentFundingState(null);
    function emptyCurrentFundingState(symbol) {
      const interval = symbol ? dataCache[symbol]?.fundingInterval : null;
      return {
        current: null,
        intervalHours: interval ?? null,
        receivedAt: null,
        cached: false,
        error: null,
        intervalCached: interval !== void 0 && interval !== null,
        intervalError: null
      };
    }
    function scheduleCurrentFunding(session) {
      clearTimeout(currentFundingTimer);
      currentFundingTimer = null;
      if (!sessionIsCurrent(session) || currentFundingRequest || currentFundingCompletedAt === null) return;
      const interval = document.hidden ? BACKGROUND_FUNDING_REFRESH_MS : CURRENT_FUNDING_REFRESH_MS;
      const delay = Math.max(0, currentFundingCompletedAt + interval - Date.now());
      currentFundingTimer = setTimeout(function() {
        currentFundingTimer = null;
        refreshCurrentFunding(session);
      }, delay);
    }
    async function refreshCurrentFunding(session) {
      if (!sessionIsCurrent(session) || currentFundingRequest) return;
      clearTimeout(currentFundingTimer);
      currentFundingTimer = null;
      const request = { controller: new AbortController(), timeout: null };
      currentFundingRequest = request;
      request.timeout = setTimeout(function() {
        request.controller.abort(new DOMException("Funding request timed out", "TimeoutError"));
      }, FUNDING_REQUEST_TIMEOUT_MS);
      try {
        const payload = await fetchJson(API_PATHS.currentFunding, { symbol: session.symbol }, request.controller.signal);
        const current = parseCurrentFunding(payload, session.symbol);
        if (!sessionIsCurrent(session) || currentFundingRequest !== request) return;
        currentFundingState = { ...currentFundingState, current, receivedAt: Date.now(), cached: false, error: null };
      } catch (error) {
        if (!sessionIsCurrent(session) || currentFundingRequest !== request) return;
        currentFundingState = { ...currentFundingState, cached: currentFundingState.current !== null, error: String(error.message || error) };
        err("Current funding request failed:", error.message);
      } finally {
        clearTimeout(request.timeout);
        if (sessionIsCurrent(session) && currentFundingRequest === request) {
          currentFundingRequest = null;
          currentFundingCompletedAt = Date.now();
          panelView.setFunding(currentFundingState, fundingClock());
          scheduleCurrentFunding(session);
        }
      }
    }
    async function refreshFundingInterval(session) {
      if (!sessionIsCurrent(session) || fundingIntervalRequest) return;
      const request = { controller: new AbortController(), timeout: null };
      fundingIntervalRequest = request;
      request.timeout = setTimeout(function() {
        request.controller.abort(new DOMException("Funding interval request timed out", "TimeoutError"));
      }, FUNDING_REQUEST_TIMEOUT_MS);
      try {
        const payload = await fetchJson(API_PATHS.fundingInterval, {}, request.controller.signal);
        const intervalHours = parseFundingInterval(payload, session.symbol);
        if (!sessionIsCurrent(session) || fundingIntervalRequest !== request) return;
        if (!dataCache[session.symbol]) dataCache[session.symbol] = {};
        dataCache[session.symbol].fundingInterval = intervalHours;
        currentFundingState = { ...currentFundingState, intervalHours, intervalCached: false, intervalError: null };
      } catch (error) {
        if (!sessionIsCurrent(session) || fundingIntervalRequest !== request) return;
        const intervalHours = dataCache[session.symbol]?.fundingInterval ?? null;
        currentFundingState = { ...currentFundingState, intervalHours, intervalCached: intervalHours !== null, intervalError: String(error.message || error) };
        err("Funding interval request failed:", error.message);
      } finally {
        clearTimeout(request.timeout);
        if (sessionIsCurrent(session) && fundingIntervalRequest === request) {
          fundingIntervalRequest = null;
          panelView.setFunding(currentFundingState, fundingClock());
        }
      }
    }
    function setupDrag(panel) {
      const header = panel.querySelector("#" + PANEL_ID2 + "-header");
      if (!header) return null;
      let dragging = false, startX, startY, startLeft, startTop;
      const cancelDrag = function() {
        if (!dragging) return;
        dragging = false;
        keepPanelInViewport(panel);
      };
      const onResize = function() {
        dragging = false;
        keepPanelInViewport(panel);
      };
      const onMouseDown = function(e) {
        if (e.button !== 0 || e.target.closest("button,a")) return;
        dragging = true;
        const rect = panel.getBoundingClientRect();
        startX = e.clientX;
        startY = e.clientY;
        startLeft = rect.left;
        startTop = rect.top;
        e.preventDefault();
      };
      const onMouseMove = function(e) {
        if (!dragging) return;
        if ((e.buttons & 1) === 0) {
          cancelDrag();
          return;
        }
        const newLeft = Math.max(0, Math.min(startLeft + (e.clientX - startX), window.innerWidth - panel.offsetWidth));
        const newTop = Math.max(0, Math.min(startTop + (e.clientY - startY), window.innerHeight - panel.offsetHeight));
        panel.style.left = newLeft + "px";
        panel.style.top = newTop + "px";
        panel.style.right = "auto";
      };
      const onMouseUp = function(e) {
        if (!dragging || e.button !== 0) return;
        dragging = false;
        const rect = panel.getBoundingClientRect();
        if (rect.left !== startLeft || rect.top !== startTop) savePanelPosition(panel);
      };
      header.addEventListener("mousedown", onMouseDown);
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      window.addEventListener("blur", cancelDrag);
      window.addEventListener("resize", onResize);
      window.addEventListener(DATA_PANEL_LAYOUT_EVENT, onResize);
      return function cleanupDrag() {
        dragging = false;
        header.removeEventListener("mousedown", onMouseDown);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        window.removeEventListener("blur", cancelDrag);
        window.removeEventListener("resize", onResize);
        window.removeEventListener(DATA_PANEL_LAYOUT_EVENT, onResize);
      };
    }
    function clampNumber(value, min, max) {
      return Math.max(min, Math.min(value, max));
    }
    function normalizeSavedPosition(pos, panelWidth) {
      if (!pos || !Number.isFinite(pos.left) || !Number.isFinite(pos.top)) return null;
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || panelWidth;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 80;
      return {
        left: clampNumber(pos.left, 0, Math.max(0, viewportWidth - panelWidth)),
        top: clampNumber(pos.top, 0, Math.max(0, viewportHeight - 48))
      };
    }
    function keepPanelInViewport(panel) {
      const width = panel.offsetWidth || PANEL_WIDTH;
      const normalized = calculateDataPanelLayout({
        kind: "trading",
        panelWidth: width,
        viewportWidth: window.innerWidth || document.documentElement.clientWidth || width,
        viewportHeight: window.innerHeight || document.documentElement.clientHeight || 80,
        savedPosition: normalizeSavedPosition(loadPosition(), width),
        hasPeer: hasVisibleDataPanelPeer(document, "trading")
      });
      panel.style.left = normalized.left + "px";
      panel.style.top = normalized.top + "px";
      panel.style.maxHeight = normalized.maxHeight + "px";
      panel.style.right = "auto";
    }
    function savePanelPosition(panel) {
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      const normalized = normalizeSavedPosition({ left: rect.left, top: rect.top }, panel.offsetWidth || PANEL_WIDTH);
      if (!normalized) return;
      savePosition(normalized.left, normalized.top);
      keepPanelInViewport(panel);
    }
    function loadPosition() {
      try {
        const raw = localStorage.getItem(STORAGE_POS_KEY);
        if (!raw) return null;
        const pos = JSON.parse(raw);
        if (typeof pos.left === "number" && typeof pos.top === "number") return pos;
      } catch (_) {
      }
      return null;
    }
    function savePosition(left, top) {
      if (!Number.isFinite(left) || !Number.isFinite(top)) return;
      localStorage.setItem(STORAGE_POS_KEY, JSON.stringify({ left, top }));
    }
    function loadCollapsed() {
      return localStorage.getItem(STORAGE_COLLAPSED_KEY) === "1";
    }
    function saveCollapsed(collapsed) {
      localStorage.setItem(STORAGE_COLLAPSED_KEY, collapsed ? "1" : "0");
    }
    let cycleTimer = null;
    let retryTimer = null;
    let pathTimer = null;
    let removeSpaRouteChangeListener = null;
    let agoTimer = null;
    let serverTimeTimer = null;
    let dragCleanup = null;
    let panelClosed = false;
    let pageSuspended = false;
    let resumeAfterPageShow = false;
    let lastUpdateTs = 0;
    let fetching = 0;
    let epoch = 0;
    let lastPath = location.pathname;
    function renderAll(symbol) {
      if (!isActiveTradingPage() || getCurrentSymbol() !== symbol) return;
      var data = dataStore[symbol] || {};
      var result = computeTradingSignals(data, failedKeys, uiLocale(), symbol, endpointErrors);
      renderPanel(result, symbol);
    }
    async function initialFetch(symbol) {
      const session = currentSession();
      if (!sessionIsCurrent(session)) return;
      const signal = session.historyController.signal;
      epoch++;
      var myEpoch = epoch;
      const boundary = Math.floor(serverNow() / PERIOD_MS) * PERIOD_MS;
      clearTimeout(cycleTimer);
      clearTimeout(retryTimer);
      if (symbol !== lastSymbol) {
        lastSymbol = symbol;
        log("交易对:", symbol);
      }
      fetching = myEpoch;
      try {
        var history = Promise.all([
          fetchPeriodData(symbol, PERIOD_KEYS, signal),
          fetchFundingRateData(symbol, signal)
        ]);
        refreshFundingInterval(session);
        var [periodEntries, fundingEntry] = await history;
        if (epoch !== myEpoch || !sessionIsCurrent(session)) return;
        if (serverNow() >= boundary + PERIOD_MS) return;
        applyResults(symbol, periodEntries, fundingEntry);
        renderAll(symbol);
      } catch (e) {
        if (!sessionIsCurrent(session) || signal.aborted || e.name === "AbortError") return;
        err("拉取失败:", e);
      } finally {
        if (fetching === myEpoch) fetching = 0;
      }
    }
    function scheduleCycle(forceNext) {
      clearTimeout(cycleTimer);
      clearTimeout(retryTimer);
      cycleTimer = null;
      retryTimer = null;
      if (panelClosed || pageSuspended) return;
      if (!isFuturesTradingPage()) {
        pauseForNonTradingPage();
        return;
      }
      var now = serverNow();
      var boundary = Math.floor(now / PERIOD_MS) * PERIOD_MS;
      if (!forceNext) {
        var targetTs = boundary;
        var symbol = getCurrentSymbol();
        var pending = symbol ? getPendingKeys(symbol, targetTs) : [];
        if (pending.length > 0 && now < boundary + PERIOD_MS) {
          var delay = Math.max(0, boundary + FIRST_DELAY - now);
          cycleTimer = setTimeout(function() {
            runCycleAttempt(boundary, 0);
          }, delay);
          return;
        }
      }
      var nextBound = boundary + PERIOD_MS;
      var delay = Math.max(0, nextBound - now + FIRST_DELAY);
      log("下次拉取:", new Date(nextBound + FIRST_DELAY - serverOffset).toLocaleTimeString());
      cycleTimer = setTimeout(function() {
        runCycleAttempt(nextBound, 0);
      }, delay);
    }
    async function runCycleAttempt(boundary, attempt) {
      if (panelClosed || pageSuspended) return;
      if (!isFuturesTradingPage()) {
        pauseForNonTradingPage();
        return;
      }
      if (activePath !== location.pathname) {
        handlePathChange();
        return;
      }
      if (serverNow() >= boundary + PERIOD_MS) {
        scheduleCycle();
        return;
      }
      if (fetching) return;
      const session = currentSession();
      const signal = session.historyController.signal;
      var symbol = getCurrentSymbol();
      if (!symbol) {
        scheduleCycle(true);
        return;
      }
      if (symbol !== lastSymbol) {
        lastSymbol = symbol;
        failedKeys = /* @__PURE__ */ new Set();
        log("交易对:", symbol);
      }
      var targetTs = boundary;
      var myEpoch = ++epoch;
      fetching = myEpoch;
      try {
        var periodEntries, fundingEntry;
        if (attempt === 0) {
          var history = Promise.all([
            fetchPeriodData(symbol, PERIOD_KEYS, signal),
            fetchFundingRateData(symbol, signal)
          ]);
          refreshFundingInterval(session);
          [periodEntries, fundingEntry] = await history;
        } else {
          var pending = getPendingKeys(symbol, targetTs);
          if (pending.length === 0) {
            log("所有 5m 接口已更新");
            renderAll(symbol);
            scheduleCycle();
            return;
          }
          periodEntries = await fetchPeriodData(symbol, pending, signal);
        }
        if (epoch !== myEpoch || !sessionIsCurrent(session)) return;
        if (serverNow() >= boundary + PERIOD_MS) {
          scheduleCycle();
          return;
        }
        applyResults(symbol, periodEntries, fundingEntry || null);
        renderAll(symbol);
        var stillPending = getPendingKeys(symbol, targetTs);
        if (stillPending.length === 0) {
          log("所有 5m 接口已更新");
          scheduleCycle();
          return;
        }
        var retryDelay = attempt < RETRY_DELAYS.length ? RETRY_DELAYS[attempt] : RETRY_FALLBACK;
        var retryTime = serverNow() + retryDelay;
        var cycleEnd = boundary + PERIOD_MS;
        if (retryTime >= cycleEnd) {
          log("本周期时间用完，待更新:", stillPending.join(", "));
          scheduleCycle(true);
          return;
        }
        log(stillPending.length + " 个接口未更新，" + retryDelay / 1e3 + "秒后重试:", stillPending.join(", "));
        retryTimer = setTimeout(function() {
          runCycleAttempt(boundary, attempt + 1);
        }, retryDelay);
      } catch (e) {
        if (epoch !== myEpoch || !sessionIsCurrent(session) || signal.aborted || e.name === "AbortError") return;
        err("数据拉取失败:", e);
        scheduleCycle();
      } finally {
        if (fetching === myEpoch) fetching = 0;
      }
    }
    function stopBusinessLoop() {
      activePath = null;
      if (historyController) {
        historyController.abort();
        historyController = null;
      }
      clearTimeout(cycleTimer);
      cycleTimer = null;
      clearTimeout(retryTimer);
      retryTimer = null;
      stopDisplayClock();
      if (serverTimeTimer) {
        clearInterval(serverTimeTimer);
        serverTimeTimer = null;
      }
      if (serverTimeRequest) {
        clearTimeout(serverTimeRequest.timeout);
        serverTimeRequest.controller.abort();
        serverTimeRequest = null;
      }
      clearTimeout(currentFundingTimer);
      currentFundingTimer = null;
      currentFundingCompletedAt = null;
      if (currentFundingRequest) {
        clearTimeout(currentFundingRequest.timeout);
        currentFundingRequest.controller.abort();
        currentFundingRequest = null;
      }
      if (fundingIntervalRequest) {
        clearTimeout(fundingIntervalRequest.timeout);
        fundingIntervalRequest.controller.abort();
        fundingIntervalRequest = null;
      }
      clockCalibrated = false;
    }
    function startServerTimeLoop() {
      if (serverTimeTimer) return;
      serverTimeTimer = setInterval(function() {
        if (isActiveTradingPage()) syncServerTime(currentSession());
      }, 60 * 60 * 1e3);
    }
    function stopRouteWatcher() {
      if (pathTimer) {
        clearInterval(pathTimer);
        pathTimer = null;
      }
      if (removeSpaRouteChangeListener) {
        removeSpaRouteChangeListener();
        removeSpaRouteChangeListener = null;
      }
    }
    function stopLoop() {
      sessionGeneration++;
      epoch++;
      stopBusinessLoop();
      stopRouteWatcher();
    }
    function cleanupPanelDrag() {
      if (!dragCleanup) return;
      dragCleanup();
      dragCleanup = null;
    }
    function removePanel() {
      cleanupPanelDrag();
      if (panelView) panelView.destroy();
      panelView = null;
      var panel = document.getElementById(PANEL_ID2);
      if (panel) {
        panel.remove();
        window.dispatchEvent(new CustomEvent(DATA_PANEL_LAYOUT_EVENT));
      }
    }
    function pauseForNonTradingPage() {
      sessionGeneration++;
      epoch++;
      stopBusinessLoop();
      lastSymbol = null;
      removePanel();
    }
    async function activateTradingPage() {
      if (!isActiveTradingPage()) return;
      sessionGeneration++;
      epoch++;
      stopBusinessLoop();
      fetching = 0;
      historyController = new AbortController();
      const session = currentSession();
      const symbol = session.symbol;
      if (!symbol) return;
      activePath = session.path;
      lastPath = session.path;
      failedKeys = /* @__PURE__ */ new Set([...PERIOD_KEYS, "fundingRate"]);
      endpointErrors = {};
      currentFundingState = emptyCurrentFundingState(symbol);
      lastUpdateTs = historyUpdatedAt[symbol] || 0;
      ensurePanel();
      renderAll(symbol);
      await syncServerTime(session);
      if (!sessionIsCurrent(session)) return;
      startServerTimeLoop();
      startDisplayClock();
      refreshCurrentFunding(session);
      await initialFetch(symbol);
      if (!sessionIsCurrent(session)) return;
      scheduleCycle();
    }
    function handlePathChange() {
      if (panelClosed || pageSuspended) return;
      if (location.pathname === lastPath) return;
      lastPath = location.pathname;
      if (!isFuturesTradingPage()) {
        pauseForNonTradingPage();
        return;
      }
      activateTradingPage();
    }
    function startRouteWatcher() {
      if (panelClosed || pageSuspended) return;
      if (!removeSpaRouteChangeListener) {
        removeSpaRouteChangeListener = installSpaRouteChangeListener(window, handlePathChange);
      }
      if (!pathTimer) {
        pathTimer = setInterval(function() {
          ensureSpaRouteChangePatched(window);
          handlePathChange();
        }, ROUTE_WATCHDOG_MS);
      }
    }
    function resumeTradingPage() {
      if (panelClosed || pageSuspended) return;
      startRouteWatcher();
      if (location.pathname !== lastPath) {
        handlePathChange();
        return;
      }
      if (!isFuturesTradingPage()) {
        pauseForNonTradingPage();
        return;
      }
      if (activePath !== location.pathname) {
        activateTradingPage();
        return;
      }
      startDisplayClock();
      scheduleCurrentFunding(currentSession());
    }
    function start() {
      log("脚本启动");
      document.addEventListener("visibilitychange", function() {
        if (panelClosed || pageSuspended) return;
        if (document.hidden) {
          stopDisplayClock();
          scheduleCurrentFunding(currentSession());
          return;
        }
        resumeTradingPage();
      });
      window.addEventListener("pagehide", function() {
        if (pageSuspended) return;
        resumeAfterPageShow = pathTimer !== null;
        pageSuspended = true;
        stopLoop();
      });
      window.addEventListener("pageshow", function() {
        if (!pageSuspended) return;
        pageSuspended = false;
        if (resumeAfterPageShow || !document.hidden) resumeTradingPage();
        resumeAfterPageShow = false;
      });
      if (!document.hidden) {
        startRouteWatcher();
        if (isFuturesTradingPage()) activateTradingPage();
      }
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start);
    } else {
      start();
    }
  })();
})();
