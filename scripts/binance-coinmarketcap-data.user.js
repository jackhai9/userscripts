// ==UserScript==
// @name         【自写】Binance CoinMarketCap 数据面板
// @namespace    binance.coinmarketcap.data
// @icon         data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%23f0b90b%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2249%22%20text-anchor%3D%22middle%22%20font-family%3D%22Arial%2C%20sans-serif%22%20font-size%3D%2242%22%20font-weight%3D%22800%22%20fill%3D%22%23111827%22%3EJ%3C%2Ftext%3E%3C%2Fsvg%3E
// @icon64       data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%23f0b90b%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2249%22%20text-anchor%3D%22middle%22%20font-family%3D%22Arial%2C%20sans-serif%22%20font-size%3D%2242%22%20font-weight%3D%22800%22%20fill%3D%22%23111827%22%3EJ%3C%2Ftext%3E%3C%2Fsvg%3E
// @version      0.2.1
// @author       jackhai9
// @description  Show localized CoinMarketCap valuation, supply, and metric interpretations on Binance futures pages
// @match        https://www.binance.com/*/futures/*
// @match        https://www.binance.com/futures/*
// @exclude      https://www.binance.com/*/my/wallet/futures/*
// @exclude      https://www.binance.com/my/wallet/futures/*
// @connect      api.coinmarketcap.com
// @connect      dapi.coinmarketcap.com
// @connect      coinmarketcap.com
// @updateURL    https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-coinmarketcap-data.user.js
// @downloadURL  https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-coinmarketcap-data.user.js
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
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

  // src/binance-coinmarketcap-data/ui-copy.js
  var CMC_COPY = Object.freeze({
    title: localizedText("CMC 数据", "CMC data"),
    metric: localizedText("指标", "Metric"),
    value: localizedText("数值", "Value"),
    interpretation: localizedText("解读", "Interpretation"),
    refresh: localizedText("刷新", "Refresh"),
    collapse: localizedText("折叠", "Collapse"),
    expand: localizedText("展开", "Expand"),
    close: localizedText("关闭", "Close"),
    details: localizedText("查看解读依据", "View interpretation basis"),
    loading: localizedText("正在读取 CoinMarketCap...", "Loading CoinMarketCap..."),
    failed: localizedText("读取失败", "Unable to load data"),
    unidentifiedContract: localizedText("无法识别当前合约", "Unable to identify the current contract"),
    source: localizedText("来源：CoinMarketCap", "Source: CoinMarketCap"),
    api: localizedText("CMC data-api", "CMC data-api"),
    page: localizedText("CMC 页面快照", "CMC page snapshot"),
    fetched: localizedText("拉取", "Fetched"),
    dataTime: localizedText("CMC 数据时间", "CMC data time"),
    fetchedTime: localizedText("本次拉取时间", "Fetch time"),
    refreshPeriod: localizedText("每 30 秒刷新", "Refreshes every 30s"),
    changePeriod: localizedText("24小时", "24h"),
    unavailable: localizedText("暂无数据", "Data unavailable"),
    comparisonUnavailable: localizedText("暂无可比数据", "Comparison unavailable"),
    supplyInvalid: localizedText("供应量口径需核实", "Supply needs verification")
  });
  var CMC_METRIC_COPY = Object.freeze({
    price: {
      label: localizedText("价格", "Price"),
      note: localizedText("过去变动不预测后续方向", "Past change does not predict direction"),
      explanation: localizedText(
        "价格与24小时涨跌幅由 CMC 提供。涨跌幅描述已经发生的变动，不能单独判断情绪或后续方向。",
        "CMC provides the price and its 24-hour change. The change describes a past move and does not establish sentiment or predict direction."
      )
    },
    "market-cap": {
      label: localizedText("流通市值", "Market cap"),
      qualifier: localizedText("流通部分", "Circulating supply"),
      interpretation: localizedText("需与同类项目比较", "Needs peer comparison"),
      note: localizedText("规模不等于估值贵贱", "Size alone does not show value"),
      explanation: localizedText(
        "流通市值是价格乘以流通供应量得到的名义估值；判断高估或低估需要同类项目与基本面参照。各字段可能来自不同更新时间。",
        "Circulating market cap is the nominal value of price multiplied by circulating supply. Valuation needs peer and fundamental comparisons. Fields may have different update times."
      )
    },
    fdv: {
      label: localizedText("总估值（FDV）", "Total valuation"),
      qualifier: localizedText("供应估值", "FDV"),
      note: localizedText("更大供应口径下的估值", "Values a broader token supply"),
      explanation: localizedText(
        "展示 CMC 提供的 FDV；倍数为本次 FDV ÷ 流通市值。FDV 使用的供应口径需结合项目资料核实，最大供应量缺失时不能确认最终发行上限。",
        "The value is CMC-reported FDV; its multiple is this snapshot’s FDV divided by circulating market cap. Verify the supply basis against project disclosures. Missing max supply does not establish a final issuance cap."
      )
    },
    unlocked: {
      label: localizedText("已解锁市值", "Unlocked market cap"),
      interpretation: localizedText("已解锁不等于已流通", "Unlocked is not circulating"),
      unavailable: localizedText("暂无解锁数据", "Unlock data unavailable"),
      note: localizedText("单项数值不说明解锁压力", "Unlock pressure needs more context"),
      explanation: localizedText(
        "已解锁市值为价格乘以已解锁供应量。已解锁代币不一定进入公众流通，缺少解锁计划时不判断未来解锁压力。",
        "Unlocked market cap is price multiplied by unlocked supply. Unlocked tokens are not necessarily in public circulation; future unlock pressure requires the unlock schedule."
      )
    },
    volume: {
      label: localizedText("成交额", "Volume"),
      qualifier: localizedText("24小时", "24h · USD value"),
      interpretation: localizedText("需与历史成交比较", "Needs historical context"),
      note: localizedText("成交额不等于净流入", "Trading value is not net inflow"),
      explanation: localizedText(
        "这里统计过去24小时的累计美元成交金额。同一批代币可以反复成交；缺少历史基准时不能断言放量或缩量。",
        "This is cumulative USD trading value over 24 hours. Tokens can trade repeatedly; identifying unusual volume requires a historical baseline."
      )
    },
    turnover: {
      label: localizedText("成交额 / 流通市值", "Volume / market cap"),
      qualifier: localizedText("24小时", "24h · circulating cap"),
      note: localizedText("需结合历史基准", "Needs a historical baseline"),
      explanation: localizedText(
        "展示 CMC turnover 字段乘以100后的百分比，口径为24小时成交额 / 流通市值；不假定同屏字段具有相同更新时间。50%及以上描述为“交投较活跃”，仅是描述阈值；是否异常仍需历史基准，不表示净流入或买盘更强。",
        "This is the CMC-reported turnover field multiplied by 100: 24h volume / circulating market cap. Displayed fields may have different update times. At least 50% is described as relatively active, a descriptive threshold only. Unusual activity requires a historical baseline and does not establish net inflow or buying pressure."
      )
    },
    liquidity: {
      label: localizedText("链上流动性 / 流通市值", "DEX liquidity / cap"),
      qualifier: localizedText("DEX 流动性", "Circulating cap"),
      interpretation: localizedText("仅反映 CMC 统计池", "Limited to CMC-tracked pools"),
      unavailable: localizedText("暂无流动性数据", "Liquidity data unavailable"),
      note: localizedText("不代表币安订单簿深度", "Not Binance order-book depth"),
      explanation: localizedText(
        "展示 CMC liquidityMcapRatio 字段乘以100后的百分比。分子为 CMC 统计的相关 DEX 池流动性金额，分母为流通市值；不代表币安订单簿深度，缺失值也不等于零流动性。",
        "The value is CMC’s liquidityMcapRatio multiplied by 100. The numerator is liquidity in CMC-tracked DEX pools and the denominator is circulating market cap. This does not measure Binance order-book depth; missing data does not mean zero liquidity."
      )
    },
    "total-supply": {
      label: localizedText("总供应量", "Total supply"),
      interpretation: localizedText("包含未流通部分", "Includes non-circulating tokens"),
      note: localizedText("已发行量，扣除已销毁部分", "Issued supply, net of burns"),
      explanation: localizedText(
        "总供应量是已发行、扣除已销毁部分后的数量。未流通部分可能包含团队、金库等持币，不能全部当作下一次解锁量。",
        "Total supply is issued supply net of burns. Non-circulating tokens can include team and treasury holdings; this is not the next unlock amount."
      )
    },
    "circulating-supply": {
      label: localizedText("流通供应量", "Circulating supply"),
      note: localizedText("未流通部分不等于待解锁", "The remainder is not all locked"),
      explanation: localizedText(
        "占比为本次流通供应量 ÷ 总供应量。流通与已解锁供应量的口径不同，未流通部分不能直接当作未来解锁压力；缺失或非正供应量不计算占比。",
        "The share is this snapshot’s circulating supply divided by total supply. Circulating and unlocked supply use different definitions, so the remainder is not automatically future unlock pressure. Missing or non-positive supplies do not produce a share."
      )
    },
    "max-supply": {
      label: localizedText("最大供应量", "Max supply"),
      interpretation: localizedText("项目规则下的供应上限", "Supply cap under project rules"),
      unavailable: localizedText("暂无上限数据", "Supply cap unavailable"),
      note: localizedText("缺失不代表无限增发", "Missing does not imply unlimited issuance"),
      explanation: localizedText(
        "最大供应量是按项目规则最终可能存在的数量上限。该字段缺失时，不据此推断供应是否无限。",
        "Max supply is the eventual upper bound defined by project rules. An unavailable field does not establish unlimited supply."
      )
    },
    holders: {
      label: localizedText("持币地址数", "Holder addresses"),
      interpretation: localizedText("地址数不等于人数", "Addresses are not people"),
      note: localizedText("一人可多址，交易所可代管", "Multiple addresses and custodians"),
      explanation: localizedText(
        "这是 CMC 统计范围内的持币地址数。一个用户可以拥有多个地址，一个交易所托管地址也可能代表多个用户；地址数不衡量独立投资者人数。",
        "This is the holder address count within CMC coverage. A person can own multiple addresses, and an exchange custody address can represent multiple users. Address count does not measure unique investors."
      )
    },
    treasury: {
      label: localizedText("金库资产", "Treasury holdings"),
      interpretation: localizedText("这是金库持仓数量", "Treasury token holdings"),
      note: localizedText("不表示持币地址数", "Not a holder address count"),
      explanation: localizedText(
        "该资产的 CMC 页面使用金库资产字段。这里保留 CMC 的金库持仓数量与代币单位，不能当作持币地址数或独立用户数。",
        "CMC uses its treasury-holdings field for this asset. The value retains the reported token quantity and unit; it is not a holder address count or a count of unique users."
      )
    },
    profile: {
      label: localizedText("资料披露评分", "Profile score"),
      note: localizedText("衡量完整性与更新时效", "Completeness and freshness"),
      explanation: localizedText(
        "评分衡量项目资料的完整程度和更新及时程度，不表示项目安全性或投资胜率。有效范围为0%至100%；缺失或超出范围时显示暂无数据。",
        "The score measures the completeness and freshness of project information, not project safety or investment success. Valid scores range from 0% to 100%; missing or out-of-range scores are unavailable."
      )
    }
  });

  // src/binance-coinmarketcap-data/metrics.js
  function numberOrNull(value) {
    if (typeof value !== "number" && typeof value !== "string") return null;
    if (typeof value === "string" && value.trim() === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  function compactNumber(value, locale, usd = false) {
    if (value === null) return "--";
    const magnitude = Math.abs(value);
    const units = locale === "zh-CN" ? [[1e12, "万亿"], [1e8, "亿"], [1e4, "万"]] : [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]];
    const unit = units.find(([scale]) => magnitude >= scale);
    const scaled = unit ? magnitude / unit[0] : magnitude;
    const decimals = scaled > 0 && scaled < 1 ? Math.max(4, 3 - Math.floor(Math.log10(scaled))) : 4;
    const number = decimals > 14 ? scaled.toExponential(3) : scaled.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: decimals,
      useGrouping: false
    });
    return `${value < 0 ? "-" : ""}${usd ? "$" : ""}${number}${unit ? unit[1] : ""}`;
  }
  function percent(value, signed = false) {
    if (value === null) return "--";
    return `${signed && value > 0 ? "+" : ""}${value.toFixed(2)}%`;
  }
  function positiveRatio(numerator, denominator) {
    return numerator !== null && denominator !== null && numerator > 0 && denominator > 0 ? numerator / denominator : null;
  }
  function holderMetric(detail) {
    const treasury = numberOrNull(detail.treasuryHoldings);
    if (detail.showTreasuriesFlag && treasury !== null && treasury > 0) {
      return { id: "treasury", number: treasury };
    }
    const pageCount = numberOrNull(detail.cmcHolderCount);
    if (pageCount !== null) return { id: "holders", number: pageCount };
    const holders = detail.holders;
    const count = holders && typeof holders === "object" ? [holders.holderCount, holders.total, holders.count].map(numberOrNull).find((value) => value !== null) : void 0;
    return { id: "holders", number: count === void 0 ? null : count };
  }
  function buildCmcMetricRows(detail, locale) {
    const text = (value) => formatLocalizedText(value, locale);
    const pair = (zh, en) => text(localizedText(zh, en));
    const stats = detail.statistics;
    const values = Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, numberOrNull(value)]));
    const numeric = (key) => values[key] === void 0 ? null : values[key];
    const priceChange = numeric("priceChangePercentage24h");
    const fdvRatio = positiveRatio(numeric("fullyDilutedMarketCap"), numeric("marketCap"));
    const supplyRatio = positiveRatio(numeric("circulatingSupply"), numeric("totalSupply"));
    const rawTurnover = numeric("turnover");
    const turnover = rawTurnover !== null && rawTurnover >= 0 ? rawTurnover * 100 : null;
    const rawLiquidity = numeric("liquidityMcapRatio");
    const liquidity = rawLiquidity !== null && rawLiquidity >= 0 ? rawLiquidity * 100 : null;
    const holder = holderMetric(detail);
    const rawProfile = numberOrNull(detail.profileCompletionScore && typeof detail.profileCompletionScore === "object" ? detail.profileCompletionScore.percentage : detail.profileCompletionScore);
    const profile = rawProfile !== null && rawProfile >= 0 && rawProfile <= 100 ? rawProfile : null;
    const comparableCap = numeric("marketCap") !== null && numeric("marketCap") > 0;
    const symbol = detail.symbol || "";
    function row(id, value, options = {}) {
      const copy = CMC_METRIC_COPY[id];
      const available = value !== "--";
      return {
        id,
        label: text(copy.label),
        qualifier: copy.qualifier ? text(copy.qualifier) : "",
        value,
        unit: "",
        change: null,
        highlight: false,
        group: false,
        tone: available ? "neutral" : "missing",
        interpretation: available && copy.interpretation ? text(copy.interpretation) : text(copy.unavailable || CMC_COPY.unavailable),
        note: text(copy.note),
        explanation: text(copy.explanation),
        ...options
      };
    }
    const price = row("price", compactNumber(numeric("price"), locale, true));
    if (numeric("price") !== null && priceChange !== null) {
      price.change = percent(priceChange, true);
      price.interpretation = priceChange === 0 ? pair("24小时价格持平", "Unchanged over 24h") : pair(
        `24小时${priceChange > 0 ? "上涨" : "下跌"}${Math.abs(priceChange).toFixed(2)}%`,
        `${priceChange > 0 ? "Up" : "Down"} ${Math.abs(priceChange).toFixed(2)}% over 24h`
      );
      price.tone = priceChange > 0 ? "positive" : priceChange < 0 ? "negative" : "neutral";
      price.explanation = `${price.interpretation}${locale === "zh-CN" ? "。" : "."} ${price.explanation}`;
    } else if (numeric("price") !== null) {
      price.interpretation = pair("暂无24小时变动", "24h change unavailable");
    }
    const fdv = row("fdv", compactNumber(numeric("fullyDilutedMarketCap"), locale, true), { highlight: true });
    fdv.interpretation = fdvRatio === null ? text(CMC_COPY.comparisonUnavailable) : pair(`流通市值的${fdvRatio.toFixed(2)}倍`, `${fdvRatio.toFixed(2)}× market cap`);
    if (fdvRatio !== null) fdv.explanation = `${fdv.interpretation}${locale === "zh-CN" ? "。" : "."} ${fdv.explanation}`;
    const turnoverRow = row("turnover", percent(turnover));
    if (turnover !== null && comparableCap) {
      turnoverRow.interpretation = turnover >= 50 ? pair("交投较活跃", "Relatively active trading") : pair("低于50%描述阈值", "Below the 50% threshold");
      turnoverRow.note = pair(`CMC 报告比值 ${percent(turnover)}`, `CMC reports ${percent(turnover)}`);
      turnoverRow.tone = turnover >= 50 ? "active" : "neutral";
    } else if (turnover !== null) {
      turnoverRow.interpretation = text(CMC_COPY.comparisonUnavailable);
    }
    const liquidityRow = row("liquidity", percent(liquidity));
    if (liquidity !== null && !comparableCap) liquidityRow.interpretation = text(CMC_COPY.comparisonUnavailable);
    const total = row("total-supply", compactNumber(numeric("totalSupply"), locale), {
      unit: numeric("totalSupply") === null ? "" : symbol,
      group: true
    });
    if (numeric("totalSupply") !== null && numeric("totalSupply") <= 0) total.interpretation = text(CMC_COPY.supplyInvalid);
    const circulating = row("circulating-supply", compactNumber(numeric("circulatingSupply"), locale), {
      unit: numeric("circulatingSupply") === null ? "" : symbol
    });
    circulating.interpretation = supplyRatio === null ? text(CMC_COPY.comparisonUnavailable) : pair(`约占总供应量${(supplyRatio * 100).toFixed(1)}%`, `About ${(supplyRatio * 100).toFixed(1)}% of total supply`);
    if (supplyRatio !== null && supplyRatio > 1) {
      circulating.interpretation = pair("流通量高于总供应量", "Circulating supply exceeds total");
      circulating.note = text(CMC_COPY.supplyInvalid);
    } else if (supplyRatio !== null) {
      circulating.explanation = `${circulating.interpretation}${locale === "zh-CN" ? "。" : "."} ${circulating.explanation}`;
    }
    const max = row("max-supply", compactNumber(numeric("maxSupply"), locale), {
      unit: numeric("maxSupply") === null ? "" : symbol
    });
    if (numeric("maxSupply") !== null && numeric("maxSupply") <= 0) max.interpretation = text(CMC_COPY.supplyInvalid);
    const profileRow = row("profile", profile === null ? "--" : `${profile.toFixed(0)}%`);
    if (profile !== null) {
      profileRow.interpretation = profile < 100 ? pair("资料仍有完善空间", "Room to improve disclosure") : pair("资料评分已满分", "Full profile score");
    }
    return [
      price,
      row("market-cap", compactNumber(numeric("marketCap"), locale, true), {
        highlight: true,
        change: numeric("marketCap") === null ? null : percent(numeric("marketCapChangePercentage24h"), true)
      }),
      { ...fdv, change: numeric("fullyDilutedMarketCap") === null ? null : percent(numeric("fullyDilutedMarketCapChangePercentage24h"), true) },
      row("unlocked", compactNumber(numeric("ucm"), locale, true)),
      row("volume", compactNumber(numeric("volume24h"), locale, true), { group: true }),
      turnoverRow,
      liquidityRow,
      total,
      circulating,
      max,
      row(holder.id, compactNumber(holder.number, locale), { group: true, unit: holder.id === "treasury" ? symbol : "" }),
      profileRow
    ];
  }

  // src/binance-coinmarketcap-data/panel-styles.js
  function cmcPanelStyles(panelId) {
    const scope = `#${panelId}`;
    return `
    ${scope} {
      --cmc-bg: var(--color-PrimaryBg, light-dark(#ffffff, #181a20));
      --cmc-head: var(--color-SecondaryBg, light-dark(#fafafa, #20232b));
      --cmc-text: var(--color-TextPrimary, light-dark(#1e2329, #eaecef));
      --cmc-muted: var(--color-TextSecondary, light-dark(#5e6673, #a6afbb));
      --cmc-border: var(--color-Line, light-dark(#eaecef, #33383f));
      --cmc-accent: light-dark(#315fe8, #8aaaff);
      --cmc-buy: var(--color-Buy, light-dark(#087f5b, #0ecb81));
      --cmc-sell: var(--color-Sell, light-dark(#c42e45, #f6465d));
      position: fixed;
      top: 360px;
      right: 16px;
      max-width: calc(100vw - 16px);
      max-height: calc(100vh - var(--cmc-panel-top, 360px) - 8px);
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      z-index: 999997;
      color: var(--cmc-text);
      background: var(--cmc-bg);
      border: 1px solid var(--cmc-border);
      border-radius: 10px;
      box-shadow: 0 6px 24px #00000020;
      font-family: BinancePlex, system-ui, -apple-system, sans-serif;
      font-size: 12px;
      line-height: 1.35;
      text-align: left;
      overflow: hidden;
      user-select: none;
    }
    ${scope} * { box-sizing: border-box; }
    ${scope} [hidden] { display: none !important; }
    ${scope} #${panelId}-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      padding: 5px 8px;
      flex: 0 0 auto;
      cursor: move;
      background: var(--cmc-head);
      border-bottom: 1px solid var(--cmc-border);
    }
    ${scope} .cmc-heading { display: flex; align-items: center; gap: 7px; min-width: 0; }
    ${scope} .cmc-title { font-size: 14px; font-weight: 600; white-space: nowrap; }
    ${scope} #${panelId}-symbol { color: var(--cmc-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    ${scope} .cmc-controls { display: flex; gap: 2px; flex: 0 0 auto; }
    ${scope} button { font: inherit; cursor: pointer; color: inherit; background: transparent; border: 0; }
    ${scope} .cmc-controls button { min-width: 24px; min-height: 24px; font-size: 16px; padding: 2px 4px; color: var(--cmc-muted); }
    ${scope} button:focus-visible, ${scope} a:focus-visible { outline: 2px solid var(--cmc-accent); outline-offset: 2px; border-radius: 3px; }
    ${scope} #${panelId}-body { min-height: 0; overflow: auto; overscroll-behavior: contain; }
    /* Reserve space for complete prices and changes before wrapping the surrounding prose. */
    ${scope} table { width: 100%; table-layout: auto; border-collapse: collapse; }
    ${scope} .cmc-name-col { width: 33%; }
    ${scope} .cmc-value-col { width: 26%; }
    ${scope} .cmc-reading-col { width: 41%; }
    ${scope} thead { position: sticky; top: 0; z-index: 1; background: var(--cmc-head); }
    ${scope} thead th { color: var(--cmc-muted); font-size: 11px; font-weight: 500; padding: 4px 6px; text-align: left; }
    ${scope} thead th:nth-child(2) { text-align: right; }
    ${scope} tbody th, ${scope} tbody td { padding: 4px 6px; border-top: 1px solid var(--cmc-border); vertical-align: middle; overflow-wrap: anywhere; }
    ${scope} .cmc-name { text-align: left; font-weight: 500; }
    ${scope} small { display: block; margin-top: 1px; font-size: 11px; line-height: 1.35; color: var(--cmc-muted); }
    ${scope} .cmc-value { text-align: right; font-variant-numeric: tabular-nums; }
    ${scope} .cmc-number { display: inline-block; font-weight: 650; white-space: nowrap; }
    ${scope} .cmc-unit { display: inline-block; margin: 0 0 0 4px; }
    ${scope} .cmc-change { font-size: 11px; white-space: nowrap; }
    ${scope} .cmc-change[data-tone="positive"], ${scope} [data-tone="positive"] .cmc-reading-text { color: var(--cmc-buy); }
    ${scope} .cmc-change[data-tone="negative"], ${scope} [data-tone="negative"] .cmc-reading-text { color: var(--cmc-sell); }
    ${scope} .cmc-change[data-tone="neutral"] { color: var(--cmc-muted); }
    ${scope} .cmc-key { background: color-mix(in srgb, var(--color-PrimaryYellow, #f0b90b) 7%, var(--cmc-bg)); }
    ${scope} .cmc-group th, ${scope} .cmc-group td { border-top-width: 2px; }
    ${scope} .cmc-reading-button { display: flex; align-items: center; justify-content: space-between; gap: 3px; width: 100%; min-height: 24px; padding: 0; line-height: inherit; text-align: left; }
    ${scope} .cmc-reading-text { font-weight: 500; }
    ${scope} [data-tone="missing"] .cmc-reading-text { color: var(--cmc-muted); }
    ${scope} [data-tone="active"] .cmc-reading-text { color: var(--cmc-accent); }
    ${scope} .cmc-info { color: var(--cmc-muted); flex: 0 0 auto; font-size: 11px; }
    ${scope} .cmc-explanation td { padding: 6px 8px; color: var(--cmc-muted); background: var(--cmc-head); font-size: 11px; line-height: 1.5; user-select: text; }
    ${scope} .cmc-explanation strong { color: var(--cmc-text); margin-right: 8px; font-weight: 600; }
    ${scope} .cmc-status { padding: 10px 0; color: var(--cmc-muted); }
    ${scope} .cmc-error-title { font-weight: 600; color: var(--cmc-sell); margin-bottom: 4px; }
    ${scope} #${panelId}-footer { padding: 5px 8px; color: var(--cmc-muted); font-size: 11px; border-top: 1px solid var(--cmc-border); }
    ${scope} .cmc-source-line { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 3px 8px; }
    ${scope} #${panelId}-footer a { color: var(--cmc-accent); text-decoration: none; }
    ${scope} .cmc-times { font-variant-numeric: tabular-nums; }
    @media (max-width: 540px) {
      ${scope} { font-size: 11px; }
      ${scope} tbody th, ${scope} tbody td { padding: 4px; }
      ${scope} thead th { padding: 4px; }
      ${scope} .cmc-info { display: none; }
    }
  `;
  }

  // src/shared/data-panel-layout.js
  var DATA_PANEL_LAYOUT_EVENT = "jh-data-panels-layout-change";
  var DATA_PANEL_WIDTH = 384;
  var PANEL_IDS = Object.freeze({
    trading: "jh-binance-trading-data-panel",
    cmc: "jh-binance-cmc-data-panel"
  });
  var TWO_COLUMN_WIDTH = DATA_PANEL_WIDTH * 2 + 48;
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
    const peerWidth = hasPeer && !stacked && kind === "cmc" ? DATA_PANEL_WIDTH + 16 : 0;
    const targetLeft = viewportWidth - panelWidth - 16 - peerWidth;
    const left = Math.max(0, Math.min(Math.max(stacked ? 8 : 16, targetLeft), viewportWidth - panelWidth));
    const availableHeight = Math.max(48, viewportHeight - top - 8);
    return { left, top, maxHeight: stacked ? Math.min(sectionHeight, availableHeight) : availableHeight };
  }

  // src/binance-coinmarketcap-data/index.user.js
  (function() {
    "use strict";
    function isFuturesTradingPage() {
      return isFuturesTradingPathname(location.pathname);
    }
    const PANEL_ID = "jh-binance-cmc-data-panel";
    const STORAGE_POS_KEY = "jh_binance_cmc_data_pos";
    const STORAGE_COLLAPSED_KEY = "jh_binance_cmc_data_collapsed";
    const REFRESH_MS = 30 * 1e3;
    const ROUTE_WATCHDOG_MS = 5e3;
    const CMC_MAP_API = "https://api.coinmarketcap.com/data-api/v1/cryptocurrency/map";
    const CMC_DETAIL_API = "https://api.coinmarketcap.com/data-api/v3/cryptocurrency/detail";
    const CMC_HOLDER_API = "https://dapi.coinmarketcap.com/dex-stats/v3/dexer/crypto-holder/show_holders";
    const ASSET_OVERRIDES = {
      RAVE: { id: 38967, symbol: "RAVE", slug: "ravedao" }
    };
    let panelClosed = false;
    let lastSymbol = null;
    let lastUpdateTs = 0;
    let refreshTimer = null;
    let routeTimer = null;
    let removeSpaRouteChangeListener = null;
    let dragCleanup = null;
    let inFlightSymbol = null;
    let refreshEpoch = 0;
    let lastRowsHtml = "";
    let lastPath = location.pathname;
    let expandedMetricId = null;
    const assetCache = /* @__PURE__ */ Object.create(null);
    function uiText(value) {
      return formatLocalizedText(value, resolveUiLocaleFromPathname(location.pathname));
    }
    function getCurrentSymbol() {
      return parseFuturesTradingSymbolFromPathname(location.pathname);
    }
    function isActiveTradingPage() {
      return !panelClosed && !document.hidden && isFuturesTradingPage();
    }
    function baseAssetFromSymbol(symbol) {
      if (!symbol) return null;
      return symbol.replace(/_PERP$/i, "").replace(/USDT$/i, "").replace(/USDC$/i, "").replace(/USD$/i, "").toUpperCase();
    }
    function cmcSymbolFromBaseAsset(baseAsset) {
      if (!baseAsset) return null;
      return baseAsset.replace(/^(1000000|1000)(?=\p{L})/u, "");
    }
    function normalizeCmcAsset(rawAsset, fallbackBaseAsset) {
      if (!rawAsset || typeof rawAsset !== "object") return null;
      const id = numberOrNull(rawAsset.id);
      const symbol = typeof rawAsset.symbol === "string" ? rawAsset.symbol.trim().toUpperCase() : "";
      const slug = typeof rawAsset.slug === "string" ? rawAsset.slug.trim() : "";
      if (id === null || !symbol || !slug) return null;
      return {
        id,
        symbol,
        slug,
        baseAsset: fallbackBaseAsset || symbol
      };
    }
    function mapApiUrlForBaseAsset(baseAsset) {
      const cmcSymbol = cmcSymbolFromBaseAsset(baseAsset);
      if (!cmcSymbol) return null;
      const params = new URLSearchParams({
        symbol: cmcSymbol,
        listing_status: "active",
        _: String(Date.now())
      });
      return CMC_MAP_API + "?" + params.toString();
    }
    async function resolveCmcAsset(symbol) {
      const base = baseAssetFromSymbol(symbol);
      if (!base) return null;
      if (assetCache[base]) return assetCache[base];
      const override = ASSET_OVERRIDES[base];
      if (override) {
        assetCache[base] = normalizeCmcAsset(override, base);
        return assetCache[base];
      }
      const url = mapApiUrlForBaseAsset(base);
      if (!url) return null;
      const payload = await requestJson(url);
      const cmcSymbol = cmcSymbolFromBaseAsset(base);
      const matches = Array.isArray(payload && payload.data) ? payload.data.filter(function(row) {
        return row && row.is_active === 1 && String(row.symbol || "").trim().toUpperCase() === cmcSymbol;
      }) : [];
      if (matches.length !== 1) {
        throw new Error(
          matches.length > 1 ? "CMC symbol ambiguous: " + cmcSymbol : "CMC symbol not found: " + cmcSymbol
        );
      }
      assetCache[base] = normalizeCmcAsset(matches[0], base);
      return assetCache[base];
    }
    function cmcUrlForAsset(asset) {
      const localePrefix = resolveUiLocaleFromPathname(location.pathname) === "zh-CN" ? "zh/" : "";
      return asset && asset.slug ? "https://coinmarketcap.com/" + localePrefix + "currencies/" + asset.slug + "/" : null;
    }
    function requestText(url) {
      return new Promise(function(resolve, reject) {
        GM_xmlhttpRequest({
          method: "GET",
          url,
          timeout: 2e4,
          headers: {
            Accept: "text/html,application/xhtml+xml",
            "Cache-Control": "no-cache",
            Pragma: "no-cache"
          },
          onload(response) {
            if (response.status < 200 || response.status >= 300) {
              reject(new Error("CMC HTTP " + response.status));
              return;
            }
            resolve(response.responseText || "");
          },
          onerror() {
            reject(new Error("CMC request failed"));
          },
          ontimeout() {
            reject(new Error("CMC request timeout"));
          }
        });
      });
    }
    function requestJson(url) {
      return new Promise(function(resolve, reject) {
        GM_xmlhttpRequest({
          method: "GET",
          url,
          timeout: 2e4,
          headers: {
            Accept: "application/json, text/plain, */*",
            "Cache-Control": "no-cache",
            Pragma: "no-cache"
          },
          onload(response) {
            if (response.status < 200 || response.status >= 300) {
              reject(new Error("CMC API HTTP " + response.status));
              return;
            }
            try {
              resolve(JSON.parse(response.responseText || "{}"));
            } catch (error) {
              reject(new Error("CMC API JSON parse failed"));
            }
          },
          onerror() {
            reject(new Error("CMC API request failed"));
          },
          ontimeout() {
            reject(new Error("CMC API request timeout"));
          }
        });
      });
    }
    function detailApiUrlForAsset(asset) {
      if (!asset) return null;
      const params = new URLSearchParams({
        id: String(asset.id),
        convertId: "2781",
        languageCode: "zh",
        _: String(Date.now())
      });
      return CMC_DETAIL_API + "?" + params.toString();
    }
    function holderApiUrlForCryptoId(cryptoId) {
      const id = numberOrNull(cryptoId);
      if (id === null) return null;
      const params = new URLSearchParams({
        cryptoId: String(id),
        _: String(Date.now())
      });
      return CMC_HOLDER_API + "?" + params.toString();
    }
    function extractNextData(html) {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const script = doc.getElementById("__NEXT_DATA__");
      if (!script || !script.textContent) {
        throw new Error("CMC page missing __NEXT_DATA__");
      }
      return JSON.parse(script.textContent);
    }
    function collectDetail(nextData) {
      const detail = nextData && nextData.props && nextData.props.pageProps && nextData.props.pageProps.detailRes && nextData.props.pageProps.detailRes.detail;
      if (!detail || !detail.statistics) {
        throw new Error("CMC page missing detail statistics");
      }
      return detail;
    }
    function collectApiDetail(payload) {
      const detail = payload && payload.data;
      if (!detail || !detail.statistics) {
        throw new Error("CMC API missing detail statistics");
      }
      return detail;
    }
    async function fetchCmcApiData(asset) {
      const url = detailApiUrlForAsset(asset);
      if (!url) throw new Error(uiText(CMC_COPY.unidentifiedContract));
      const payload = await requestJson(url);
      return collectApiDetail(payload);
    }
    async function fetchCmcHolderData(cryptoId) {
      const url = holderApiUrlForCryptoId(cryptoId);
      if (!url) return null;
      const payload = await requestJson(url);
      const data = payload && payload.data;
      if (!data || !data.showFlag) return null;
      return numberOrNull(data.count);
    }
    async function fetchCmcPageData(asset) {
      const url = cmcUrlForAsset(asset);
      if (!url) throw new Error(uiText(CMC_COPY.unidentifiedContract));
      const html = await requestText(url);
      const nextData = extractNextData(html);
      return collectDetail(nextData);
    }
    async function fetchCmcData(symbol) {
      const asset = await resolveCmcAsset(symbol);
      const url = cmcUrlForAsset(asset);
      let detail;
      let source = "data-api";
      try {
        detail = await fetchCmcApiData(asset);
      } catch (apiError) {
        detail = await fetchCmcPageData(asset);
        source = "page-snapshot";
      }
      let holderCount = null;
      if (!detail.showTreasuriesFlag) {
        try {
          holderCount = await fetchCmcHolderData(detail.id);
        } catch (holderError) {
          holderCount = null;
        }
      }
      if (holderCount !== null) detail = { ...detail, cmcHolderCount: holderCount };
      return {
        url,
        name: detail.name || "",
        symbol: detail.symbol || asset && asset.symbol || baseAssetFromSymbol(symbol),
        rank: detail.statistics && detail.statistics.rank,
        lastUpdated: detail.latestUpdateTime || "",
        source,
        rows: buildCmcMetricRows(detail, resolveUiLocaleFromPathname(location.pathname))
      };
    }
    function ensurePanel() {
      let panel = document.getElementById(PANEL_ID);
      if (panel) {
        updatePanelLanguage(panel);
        return panel;
      }
      panel = document.createElement("div");
      panel.id = PANEL_ID;
      panel.style.width = DATA_PANEL_WIDTH + "px";
      const collapsed = loadCollapsed();
      panel.innerHTML = [
        "<style>",
        cmcPanelStyles(PANEL_ID),
        "</style>",
        '<div id="',
        PANEL_ID,
        '-header">',
        '<div class="cmc-heading">',
        '<span aria-hidden="true">&#9776;</span>',
        '<span class="cmc-title" data-copy="title"></span>',
        '<span id="',
        PANEL_ID,
        '-symbol"></span>',
        "</div>",
        '<div class="cmc-controls">',
        '<button type="button" id="',
        PANEL_ID,
        '-refresh">&#8635;</button>',
        '<button type="button" id="',
        PANEL_ID,
        '-collapse" aria-controls="',
        PANEL_ID,
        '-body">',
        collapsed ? "&#9633;" : "&#95;",
        "</button>",
        '<button type="button" id="',
        PANEL_ID,
        '-close">&times;</button>',
        "</div>",
        "</div>",
        '<div id="',
        PANEL_ID,
        '-body" style="display:',
        collapsed ? "none" : "block",
        ';">',
        "<table>",
        '<colgroup><col class="cmc-name-col"><col class="cmc-value-col"><col class="cmc-reading-col"></colgroup>',
        '<thead><tr><th scope="col" data-copy="metric"></th><th scope="col" data-copy="value"></th><th scope="col" data-copy="interpretation"></th></tr></thead>',
        '<tbody id="',
        PANEL_ID,
        '-rows"></tbody>',
        "</table>",
        '<div id="',
        PANEL_ID,
        '-footer"></div>',
        "</div>"
      ].join("");
      document.body.appendChild(panel);
      updatePanelLanguage(panel);
      keepPanelInViewport(panel);
      cleanupPanelDrag();
      dragCleanup = setupDrag(panel);
      setupControls(panel);
      window.dispatchEvent(new CustomEvent(DATA_PANEL_LAYOUT_EVENT));
      return panel;
    }
    function updatePanelLanguage(panel) {
      panel.lang = resolveUiLocaleFromPathname(location.pathname);
      panel.setAttribute("aria-label", uiText(CMC_COPY.title));
      panel.querySelector("table").setAttribute("aria-label", uiText(CMC_COPY.title));
      panel.querySelectorAll("[data-copy]").forEach(function(element) {
        element.textContent = uiText(CMC_COPY[element.dataset.copy]);
      });
      const collapsed = panel.querySelector("#" + PANEL_ID + "-body").style.display === "none";
      for (const [suffix, copy] of [
        ["refresh", CMC_COPY.refresh],
        ["collapse", collapsed ? CMC_COPY.expand : CMC_COPY.collapse],
        ["close", CMC_COPY.close]
      ]) {
        const button = panel.querySelector("#" + PANEL_ID + "-" + suffix);
        button.title = uiText(copy);
        button.setAttribute("aria-label", uiText(copy));
      }
      panel.querySelector("#" + PANEL_ID + "-collapse").setAttribute("aria-expanded", String(!collapsed));
    }
    function renderLoading(symbol) {
      const panel = ensurePanel();
      const symbolEl = panel.querySelector("#" + PANEL_ID + "-symbol");
      const rowsEl = panel.querySelector("#" + PANEL_ID + "-rows");
      const footerEl = panel.querySelector("#" + PANEL_ID + "-footer");
      if (symbolEl) symbolEl.textContent = symbol || "";
      if (rowsEl) rowsEl.innerHTML = '<tr><td colspan="3"><div class="cmc-status" role="status">' + escapeHtml(uiText(CMC_COPY.loading)) + "</div></td></tr>";
      if (footerEl) footerEl.textContent = "";
    }
    function renderError(symbol, message) {
      const panel = ensurePanel();
      const symbolEl = panel.querySelector("#" + PANEL_ID + "-symbol");
      const rowsEl = panel.querySelector("#" + PANEL_ID + "-rows");
      const footerEl = panel.querySelector("#" + PANEL_ID + "-footer");
      if (symbolEl) symbolEl.textContent = symbol || "";
      if (rowsEl) {
        lastRowsHtml = [
          '<tr><td colspan="3"><div class="cmc-status" role="status">',
          '<div class="cmc-error-title">',
          escapeHtml(uiText(CMC_COPY.failed)),
          "</div>",
          "<div>",
          escapeHtml(message),
          "</div>",
          "</div></td></tr>"
        ].join("");
        rowsEl.innerHTML = lastRowsHtml;
      }
      if (footerEl) footerEl.textContent = uiText(CMC_COPY.source);
    }
    function renderData(symbol, data) {
      const panel = ensurePanel();
      const symbolEl = panel.querySelector("#" + PANEL_ID + "-symbol");
      const rowsEl = panel.querySelector("#" + PANEL_ID + "-rows");
      const footerEl = panel.querySelector("#" + PANEL_ID + "-footer");
      if (symbolEl) {
        const rank = numberOrNull(data.rank) !== null ? " #" + data.rank : "";
        symbolEl.textContent = (data.symbol || symbol || "") + rank;
      }
      if (rowsEl) {
        lastRowsHtml = data.rows.map(function(row) {
          const changeTone = row.change && row.change.startsWith("-") ? "negative" : row.change && row.change.startsWith("+") ? "positive" : "neutral";
          const change = row.change && row.change !== "--" ? '<small class="cmc-change" data-tone="' + changeTone + '">' + escapeHtml(row.change) + " · " + escapeHtml(uiText(CMC_COPY.changePeriod)) + "</small>" : "";
          const detailId = PANEL_ID + "-explanation-" + row.id;
          const expanded = expandedMetricId === row.id;
          return [
            '<tr data-metric="',
            row.id,
            '" data-tone="',
            row.tone,
            '" class="',
            row.highlight ? "cmc-key " : "",
            row.group ? "cmc-group" : "",
            '">',
            '<th scope="row" class="cmc-name">',
            escapeHtml(row.label),
            row.qualifier ? "<small>" + escapeHtml(row.qualifier) + "</small>" : "",
            "</th>",
            '<td class="cmc-value"><span class="cmc-number" data-role="metric-value">',
            escapeHtml(row.value),
            "</span>",
            row.unit ? '<small class="cmc-unit">' + escapeHtml(row.unit) + "</small>" : "",
            change,
            "</td>",
            '<td><button type="button" class="cmc-reading-button" data-expand-metric="',
            row.id,
            '" aria-expanded="',
            String(expanded),
            '" aria-controls="',
            detailId,
            '" aria-label="',
            escapeHtml(row.label + " · " + uiText(CMC_COPY.details)),
            '" title="',
            escapeHtml(row.note),
            '">',
            '<span class="cmc-reading-text">',
            escapeHtml(row.interpretation),
            '</span><span class="cmc-info" aria-hidden="true">ⓘ</span>',
            "</button></td>",
            "</tr>",
            '<tr id="',
            detailId,
            '" class="cmc-explanation"',
            expanded ? "" : " hidden",
            '><td colspan="3"><strong>',
            escapeHtml(row.label),
            "</strong>",
            escapeHtml(row.explanation),
            "<small>",
            escapeHtml(row.note),
            "</small></td></tr>"
          ].join("");
        }).join("");
        rowsEl.innerHTML = lastRowsHtml;
      }
      if (footerEl) {
        lastUpdateTs = Date.now();
        const cmcClock = data.lastUpdated ? formatClock(Date.parse(data.lastUpdated)) : "--";
        const sourceLabel = uiText(data.source === "page-snapshot" ? CMC_COPY.page : CMC_COPY.api);
        footerEl.innerHTML = [
          '<div class="cmc-source-line">',
          '<a href="',
          escapeHtml(data.url),
          '" target="_blank" rel="noopener noreferrer">',
          escapeHtml(sourceLabel),
          "</a>",
          '<span class="cmc-times"><span title="',
          escapeHtml(uiText(CMC_COPY.dataTime)),
          '">CMC ',
          cmcClock,
          '</span> / <span title="',
          escapeHtml(uiText(CMC_COPY.fetchedTime)),
          '">',
          escapeHtml(uiText(CMC_COPY.fetched)),
          " ",
          formatClock(lastUpdateTs),
          "</span></span>",
          "</div>",
          "<small>",
          escapeHtml(uiText(CMC_COPY.refreshPeriod)),
          "</small>"
        ].join("");
      }
    }
    async function refreshForCurrentSymbol(force, silent) {
      if (panelClosed || document.hidden) return;
      if (!isFuturesTradingPage()) {
        pauseForNonTradingPage();
        return;
      }
      const symbol = getCurrentSymbol();
      if (!symbol) return;
      if (!force && symbol === inFlightSymbol) return;
      const myEpoch = ++refreshEpoch;
      inFlightSymbol = symbol;
      if (!silent || !lastRowsHtml) renderLoading(symbol);
      try {
        const data = await fetchCmcData(symbol);
        if (myEpoch !== refreshEpoch || !isActiveTradingPage() || getCurrentSymbol() !== symbol) return;
        renderData(symbol, data);
        lastSymbol = symbol;
      } catch (error) {
        if (myEpoch !== refreshEpoch || !isActiveTradingPage() || getCurrentSymbol() !== symbol) return;
        renderError(symbol, error && error.message ? error.message : String(error));
      } finally {
        if (myEpoch === refreshEpoch) inFlightSymbol = null;
      }
    }
    function startDataLoop() {
      if (panelClosed || document.hidden || !isFuturesTradingPage()) return;
      ensurePanel();
      refreshForCurrentSymbol(true, false);
      if (!refreshTimer) {
        refreshTimer = setInterval(function() {
          refreshForCurrentSymbol(false, true);
        }, REFRESH_MS);
      }
    }
    function stopDataLoop() {
      refreshEpoch++;
      inFlightSymbol = null;
      if (refreshTimer) clearInterval(refreshTimer);
      refreshTimer = null;
    }
    function stopRouteWatcher() {
      if (routeTimer) clearInterval(routeTimer);
      routeTimer = null;
      if (removeSpaRouteChangeListener) {
        removeSpaRouteChangeListener();
        removeSpaRouteChangeListener = null;
      }
    }
    function stopLoop() {
      stopDataLoop();
      stopRouteWatcher();
    }
    function cleanupPanelDrag() {
      if (!dragCleanup) return;
      dragCleanup();
      dragCleanup = null;
    }
    function removePanel() {
      cleanupPanelDrag();
      const panel = document.getElementById(PANEL_ID);
      if (panel) {
        panel.remove();
        window.dispatchEvent(new CustomEvent(DATA_PANEL_LAYOUT_EVENT));
      }
      lastRowsHtml = "";
      expandedMetricId = null;
    }
    function pauseForNonTradingPage() {
      stopDataLoop();
      removePanel();
      lastSymbol = null;
    }
    function handleRouteChange() {
      if (document.hidden || panelClosed) return;
      if (location.pathname === lastPath) return;
      lastPath = location.pathname;
      if (!isFuturesTradingPage()) {
        pauseForNonTradingPage();
        return;
      }
      startDataLoop();
    }
    function startRouteWatcher() {
      if (document.hidden || panelClosed) return;
      lastPath = location.pathname;
      if (!removeSpaRouteChangeListener) {
        removeSpaRouteChangeListener = installSpaRouteChangeListener(window, handleRouteChange);
      }
      if (!routeTimer) {
        routeTimer = setInterval(function() {
          ensureSpaRouteChangePatched(window);
          handleRouteChange();
        }, ROUTE_WATCHDOG_MS);
      }
    }
    function setupDrag(panel) {
      const header = panel.querySelector("#" + PANEL_ID + "-header");
      if (!header) return null;
      let dragging = false;
      let startX;
      let startY;
      let startLeft;
      let startTop;
      const cancelDrag = function() {
        if (!dragging) return;
        dragging = false;
        keepPanelInViewport(panel);
      };
      const onResize = function() {
        dragging = false;
        keepPanelInViewport(panel);
      };
      const onMouseDown = function(event) {
        if (event.button !== 0 || event.target.closest("button,a")) return;
        dragging = true;
        const rect = panel.getBoundingClientRect();
        startX = event.clientX;
        startY = event.clientY;
        startLeft = rect.left;
        startTop = rect.top;
        event.preventDefault();
      };
      const onMouseMove = function(event) {
        if (!dragging) return;
        if ((event.buttons & 1) === 0) {
          cancelDrag();
          return;
        }
        const newLeft = Math.max(0, Math.min(startLeft + event.clientX - startX, window.innerWidth - panel.offsetWidth));
        const newTop = Math.max(0, Math.min(startTop + event.clientY - startY, window.innerHeight - panel.offsetHeight));
        panel.style.left = newLeft + "px";
        panel.style.top = newTop + "px";
        panel.style.setProperty("--cmc-panel-top", newTop + "px");
        panel.style.right = "auto";
      };
      const onMouseUp = function(event) {
        if (!dragging || event.button !== 0) return;
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
    function setupControls(panel) {
      const refreshBtn = panel.querySelector("#" + PANEL_ID + "-refresh");
      const collapseBtn = panel.querySelector("#" + PANEL_ID + "-collapse");
      const closeBtn = panel.querySelector("#" + PANEL_ID + "-close");
      const body = panel.querySelector("#" + PANEL_ID + "-body");
      const rows = panel.querySelector("#" + PANEL_ID + "-rows");
      rows.addEventListener("click", function(event) {
        const button = event.target.closest("[data-expand-metric]");
        if (!button) return;
        expandedMetricId = expandedMetricId === button.dataset.expandMetric ? null : button.dataset.expandMetric;
        rows.querySelectorAll("[data-expand-metric]").forEach(function(control) {
          const expanded = control.dataset.expandMetric === expandedMetricId;
          control.setAttribute("aria-expanded", String(expanded));
          panel.querySelector("#" + control.getAttribute("aria-controls")).hidden = !expanded;
        });
      });
      if (refreshBtn) {
        refreshBtn.addEventListener("click", function() {
          refreshForCurrentSymbol(true, false);
        });
      }
      if (collapseBtn && body) {
        collapseBtn.addEventListener("click", function() {
          const isHidden = body.style.display === "none";
          body.style.display = isHidden ? "block" : "none";
          collapseBtn.innerHTML = isHidden ? "&#95;" : "&#9633;";
          saveCollapsed(!isHidden);
          updatePanelLanguage(panel);
        });
      }
      if (closeBtn) {
        closeBtn.addEventListener("click", function() {
          panel.style.display = "none";
          panelClosed = true;
          stopLoop();
          cleanupPanelDrag();
          window.dispatchEvent(new CustomEvent(DATA_PANEL_LAYOUT_EVENT));
        });
      }
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
      const width = panel.offsetWidth || DATA_PANEL_WIDTH;
      const normalized = calculateDataPanelLayout({
        kind: "cmc",
        panelWidth: width,
        viewportWidth: window.innerWidth || document.documentElement.clientWidth || width,
        viewportHeight: window.innerHeight || document.documentElement.clientHeight || 80,
        savedPosition: normalizeSavedPosition(loadPosition(), width),
        hasPeer: hasVisibleDataPanelPeer(document, "cmc")
      });
      panel.style.left = normalized.left + "px";
      panel.style.top = normalized.top + "px";
      panel.style.maxHeight = normalized.maxHeight + "px";
      panel.style.setProperty("--cmc-panel-top", normalized.top + "px");
      panel.style.right = "auto";
    }
    function savePanelPosition(panel) {
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      const normalized = normalizeSavedPosition({ left: rect.left, top: rect.top }, panel.offsetWidth || DATA_PANEL_WIDTH);
      if (!normalized) return;
      savePosition(normalized.left, normalized.top);
      keepPanelInViewport(panel);
    }
    function loadPosition() {
      try {
        const raw = localStorage.getItem(STORAGE_POS_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (error) {
        return null;
      }
    }
    function savePosition(left, top) {
      if (Number.isFinite(left) && Number.isFinite(top)) {
        localStorage.setItem(STORAGE_POS_KEY, JSON.stringify({ left, top }));
      }
    }
    function loadCollapsed() {
      return localStorage.getItem(STORAGE_COLLAPSED_KEY) === "1";
    }
    function saveCollapsed(collapsed) {
      localStorage.setItem(STORAGE_COLLAPSED_KEY, collapsed ? "1" : "0");
    }
    function formatClock(timestamp) {
      if (!Number.isFinite(timestamp)) return "--";
      const date = new Date(timestamp);
      return [
        String(date.getHours()).padStart(2, "0"),
        String(date.getMinutes()).padStart(2, "0"),
        String(date.getSeconds()).padStart(2, "0")
      ].join(":");
    }
    function escapeHtml(value) {
      return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }
    document.addEventListener("visibilitychange", function() {
      if (document.hidden) {
        stopLoop();
        return;
      }
      if (panelClosed) return;
      startRouteWatcher();
      if (isFuturesTradingPage()) startDataLoop();
      else pauseForNonTradingPage();
    });
    startRouteWatcher();
    startDataLoop();
  })();
})();
