// ==UserScript==
// @name         【自写】Binance CoinMarketCap 数据面板
// @namespace    binance.coinmarketcap.data
// @icon         data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%23f0b90b%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2249%22%20text-anchor%3D%22middle%22%20font-family%3D%22Arial%2C%20sans-serif%22%20font-size%3D%2242%22%20font-weight%3D%22800%22%20fill%3D%22%23111827%22%3EJ%3C%2Ftext%3E%3C%2Fsvg%3E
// @icon64       data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%23f0b90b%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2249%22%20text-anchor%3D%22middle%22%20font-family%3D%22Arial%2C%20sans-serif%22%20font-size%3D%2242%22%20font-weight%3D%22800%22%20fill%3D%22%23111827%22%3EJ%3C%2Ftext%3E%3C%2Fsvg%3E
// @version      0.3.0
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

  // src/shared/ui-locale.js
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

  // src/binance-coinmarketcap-data/ui-copy.js
  var CMC_COPY = Object.freeze({
    title: localizedText("CMC 数据", "CMC"),
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
    changePeriod: localizedText("24h", "24h")
  });
  var CMC_METRIC_COPY = Object.freeze({
    price: {
      label: localizedText("价格", "Price"),
      note: localizedText("7日涨跌 + 30日区间位置", "7d move + 30d range position"),
      explanation: localizedText(
        "按30日最高、最低价算出当前所处位置。处在区间下部20%且7日下跌记为偏空，处在上部20%且7日上涨记为偏多，其余为中性。缺少7日或30日数据时只看24小时涨跌。",
        "Position is measured inside the 30-day high/low range. Bottom 20% with a 7-day decline is bearish, top 20% with a 7-day gain is bullish, otherwise neutral. Without 7-day or 30-day data, only the 24h change is used."
      )
    },
    "market-cap": {
      label: localizedText("流通市值", "Mkt cap"),
      note: localizedText("CMC 市值排名", "CMC rank"),
      explanation: localizedText(
        "价格 × 流通供应量。排名前10为大盘、前100为中盘、其余为小盘（小盘波动大，记偏空）；前3名且市占率达50%记偏多。",
        "Price × circulating supply. Top 10 is large cap, top 100 mid cap, the rest small cap (volatile, bearish). A top-3 asset with at least 50% dominance is bullish."
      )
    },
    fdv: {
      label: localizedText("FDV", "FDV"),
      note: localizedText("FDV ÷ 流通市值", "FDV ÷ market cap"),
      explanation: localizedText(
        "倍数 = FDV ÷ 流通市值，代表未流通筹码的稀释空间。低于1.2倍偏多，1.2–2倍中性，2倍以上偏空。",
        "Multiple = FDV ÷ market cap, the dilution still to come. Below 1.2× is bullish, 1.2–2× neutral, 2× and above bearish."
      )
    },
    unlocked: {
      label: localizedText("已解锁市值", "Unlocked"),
      note: localizedText("已解锁 ÷ 流通市值", "Unlocked ÷ market cap"),
      explanation: localizedText(
        "价格 × 已解锁供应量。已解锁却未流通的筹码随时可能卖出；已解锁市值超过流通市值20%以上记偏空。",
        "Price × unlocked supply. Unlocked but non-circulating tokens can be sold at any time; more than 20% above market cap is bearish."
      )
    },
    volume: {
      label: localizedText("24h 成交额", "Volume"),
      note: localizedText("对比7日日均成交额", "Compared with the 7-day daily average"),
      explanation: localizedText(
        "24小时成交额对比 CMC 7日成交额的日均值。高出30%以上为放量：价格同时下跌记偏空，否则偏多；低30%以上为缩量。",
        "24h volume against the daily average of CMC 7-day volume. 30% or more above is a surge: bearish if price fell, otherwise bullish. 30% or more below is cooling."
      )
    },
    turnover: {
      label: localizedText("换手率", "Turnover"),
      note: localizedText("24h 成交额 ÷ 流通市值", "24h volume ÷ market cap"),
      explanation: localizedText(
        "CMC turnover 字段 × 100。低于3%筹码稳定，3–15%一般，15–50%活跃（偏多），50%以上为投机过热（偏空）。",
        "CMC turnover × 100. Below 3% is stable, 3–15% normal, 15–50% active (bullish), 50% and above overheated speculation (bearish)."
      )
    },
    liquidity: {
      label: localizedText("链上流动性", "DEX liq."),
      note: localizedText("DEX 池子 ÷ 流通市值", "DEX pools ÷ market cap"),
      explanation: localizedText(
        "CMC liquidityMcapRatio × 100，只统计 CMC 收录的 DEX 池子，与币安订单簿无关。低于1%容易被砸盘（偏空），1–5%偏薄，5%以上充足（偏多）。",
        "CMC liquidityMcapRatio × 100, covering CMC-tracked DEX pools only, unrelated to the Binance order book. Below 1% is easy to dump (bearish), 1–5% thin, 5% and above deep (bullish)."
      )
    },
    "total-supply": {
      label: localizedText("总供应量", "Total"),
      note: localizedText("总供应量 ÷ 最大供应量", "Total ÷ max supply"),
      explanation: localizedText(
        "已发行并扣除销毁后的数量，与最大供应量比较得出已铸造比例；没有上限的代币记偏空。",
        "Issued supply net of burns, compared with max supply for the minted share. Uncapped tokens are bearish."
      )
    },
    "circulating-supply": {
      label: localizedText("流通供应量", "Circ."),
      note: localizedText("流通 ÷ 总供应量", "Circulating ÷ total"),
      explanation: localizedText(
        "流通供应量 ÷ 总供应量。95%以上基本无解锁抛压（偏多），70–95%中性，低于70%解锁压力大（偏空）。",
        "Circulating ÷ total supply. 95% and above means little unlock pressure (bullish), 70–95% neutral, below 70% heavy unlock pressure (bearish)."
      )
    },
    "max-supply": {
      label: localizedText("最大供应量", "Max"),
      note: localizedText("剩余可发行比例", "Share left to issue"),
      explanation: localizedText(
        "项目规则下的供应上限，与总供应量比较得出剩余可发行比例。剩余不足10%偏多，10%以上或无上限偏空。",
        "The supply cap under project rules, compared with total supply. Less than 10% left to issue is bullish; 10% or more, or no cap, is bearish."
      )
    },
    holders: {
      label: localizedText("持币地址", "Holders"),
      note: localizedText("最大持币地址占比", "Largest holder share"),
      explanation: localizedText(
        "CMC 统计的持币地址数；解读看 CMC 持币榜第一名的占比，交易所和销毁地址未剔除。超过20%筹码集中（偏空），低于5%分散（偏多）。",
        "CMC holder address count. The reading uses the largest address on the CMC holder list, without excluding exchange or burn addresses. Above 20% is concentrated (bearish), below 5% dispersed (bullish)."
      )
    },
    treasury: {
      label: localizedText("金库持仓", "Treasuries"),
      note: localizedText("上市公司与机构金库", "Corporate and institutional treasuries"),
      explanation: localizedText(
        "CMC 统计的上市公司和机构金库持有数量，这部分筹码长期锁定，记偏多。",
        "Tokens held by corporate and institutional treasuries according to CMC. These holdings are locked long term, which is bullish."
      )
    },
    profile: {
      label: localizedText("资料评分", "Profile"),
      note: localizedText("资料完整度与更新时效", "Completeness and freshness"),
      explanation: localizedText(
        "CMC 资料披露评分。80%以上较完整，50–80%一般，低于50%透明度差（偏空）。",
        "CMC profile disclosure score. 80% and above is well disclosed, 50–80% partial, below 50% poor transparency (bearish)."
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
  function absPercent(value, digits = 0) {
    return `${Math.abs(value).toFixed(digits)}%`;
  }
  function topHolderShare(detail) {
    const list = detail.holders && typeof detail.holders === "object" ? detail.holders.holderList : null;
    return Array.isArray(list) && list.length > 0 ? numberOrNull(list[0].share) : null;
  }
  function buildCmcMetricRows(detail, locale) {
    const text = (value) => formatLocalizedText(value, locale);
    const pair = (zh, en) => text(localizedText(zh, en));
    const stats = detail.statistics;
    const values = Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, numberOrNull(value)]));
    const numeric = (key) => values[key] === void 0 ? null : values[key];
    const price = numeric("price");
    const marketCap = numeric("marketCap");
    const priceChange = numeric("priceChangePercentage24h");
    const fdvRatio = positiveRatio(numeric("fullyDilutedMarketCap"), marketCap);
    const unlockRatio = positiveRatio(numeric("ucm"), marketCap);
    const supplyRatio = positiveRatio(numeric("circulatingSupply"), numeric("totalSupply"));
    const rawTurnover = numeric("turnover");
    const turnover = rawTurnover !== null && rawTurnover >= 0 ? rawTurnover * 100 : null;
    const rawLiquidity = numeric("liquidityMcapRatio");
    const liquidity = rawLiquidity !== null && rawLiquidity >= 0 ? rawLiquidity * 100 : null;
    const holder = holderMetric(detail);
    const rawProfile = numberOrNull(detail.profileCompletionScore && typeof detail.profileCompletionScore === "object" ? detail.profileCompletionScore.percentage : detail.profileCompletionScore);
    const profile = rawProfile !== null && rawProfile >= 0 && rawProfile <= 100 ? rawProfile : null;
    const comparableCap = marketCap !== null && marketCap > 0;
    const symbol = detail.symbol || "";
    function row(id, value, options = {}) {
      const copy = CMC_METRIC_COPY[id];
      return {
        id,
        label: text(copy.label),
        value,
        unit: "",
        change: null,
        highlight: false,
        group: false,
        tone: "missing",
        interpretation: "--",
        note: text(copy.note),
        explanation: text(copy.explanation),
        ...options
      };
    }
    function read(target, tone, zh, en) {
      target.tone = tone;
      target.interpretation = pair(zh, en);
    }
    const priceRow = row("price", compactNumber(price, locale, true));
    const change7d = numeric("priceChangePercentage7d");
    const high30d = numeric("high30d");
    const low30d = numeric("low30d");
    if (price !== null) priceRow.change = priceChange === null ? null : percent(priceChange, true);
    if (price !== null && change7d !== null && high30d !== null && low30d !== null && high30d > low30d) {
      const position = (price - low30d) / (high30d - low30d);
      const move = { zh: `7日${change7d >= 0 ? "涨" : "跌"}${absPercent(change7d)}`, en: `${change7d >= 0 ? "Up" : "Down"} ${absPercent(change7d)} in 7d` };
      if (position < 0.2 && change7d < 0) read(priceRow, "negative", `${move.zh}，贴近30日低点`, `${move.en}, near 30d low`);
      else if (position > 0.8 && change7d > 0) read(priceRow, "positive", `${move.zh}，逼近30日高点`, `${move.en}, near 30d high`);
      else {
        const zone = position < 1 / 3 ? ["偏下", "lower"] : position > 2 / 3 ? ["偏上", "upper"] : ["中部", "middle"];
        read(priceRow, "neutral", `${move.zh}，处30日区间${zone[0]}`, `${move.en}, ${zone[1]} 30d range`);
      }
    } else if (price !== null && priceChange === 0) {
      read(priceRow, "neutral", "24小时持平", "Flat in 24h");
    } else if (price !== null && priceChange !== null) {
      read(
        priceRow,
        priceChange > 0 ? "positive" : "negative",
        `24小时${priceChange > 0 ? "涨" : "跌"}${absPercent(priceChange, 1)}`,
        `${priceChange > 0 ? "Up" : "Down"} ${absPercent(priceChange, 1)} in 24h`
      );
    }
    const capRow = row("market-cap", compactNumber(marketCap, locale, true), { highlight: true });
    const rank = numeric("rank");
    const dominance = numeric("marketCapDominance");
    if (comparableCap && rank !== null && rank > 0) {
      if (rank <= 3 && dominance !== null && dominance >= 50) read(capRow, "positive", `市占率${absPercent(dominance)}，资金抱团龙头`, `${absPercent(dominance)} dominance, money in the leader`);
      else if (rank <= 10) read(capRow, "neutral", `第${rank}名，大盘币`, `#${rank}, large cap`);
      else if (rank <= 100) read(capRow, "neutral", `第${rank}名，中盘币`, `#${rank}, mid cap`);
      else read(capRow, "negative", `第${rank}名，小盘币波动大`, `#${rank}, volatile small cap`);
    }
    const fdv = row("fdv", compactNumber(numeric("fullyDilutedMarketCap"), locale, true), { highlight: true });
    if (fdvRatio !== null) {
      const multiple = fdvRatio.toFixed(2);
      if (fdvRatio < 1.2) read(fdv, "positive", `仅为流通的${multiple}倍，几乎无稀释`, `${multiple}× cap, little dilution`);
      else if (fdvRatio < 2) read(fdv, "neutral", `流通的${multiple}倍，稀释压力中等`, `${multiple}× cap, moderate dilution`);
      else if (fdvRatio < 5) read(fdv, "negative", `流通的${multiple}倍，稀释压力大`, `${multiple}× cap, heavy dilution`);
      else read(fdv, "negative", `流通的${multiple}倍，稀释极重`, `${multiple}× cap, extreme dilution`);
    }
    const unlocked = row("unlocked", compactNumber(numeric("ucm"), locale, true));
    if (unlockRatio !== null) {
      if (unlockRatio > 1.2) read(unlocked, "negative", `比流通多${absPercent((unlockRatio - 1) * 100)}，潜在抛压大`, `${absPercent((unlockRatio - 1) * 100)} above cap, sell pressure`);
      else read(unlocked, "neutral", "解锁部分基本已流通", "Unlocked supply mostly circulating");
    }
    const volume24h = numeric("volume24h");
    const volume7d = numeric("volume7d");
    const volume = row("volume", compactNumber(volume24h, locale, true), { group: true });
    if (volume24h !== null && volume7d !== null && volume7d > 0) {
      const versus = (volume24h / (volume7d / 7) - 1) * 100;
      const delta = { zh: `比7日均量${versus >= 0 ? "高" : "低"}${absPercent(versus)}`, en: `${versus >= 0 ? "+" : "-"}${absPercent(versus)} vs 7d avg` };
      if (versus >= 30 && priceChange !== null && priceChange < 0) read(volume, "negative", `${delta.zh}，放量下跌`, `${delta.en}, selling volume`);
      else if (versus >= 30) read(volume, "positive", `${delta.zh}，资金涌入`, `${delta.en}, money flowing in`);
      else if (versus <= -30) read(volume, "neutral", `${delta.zh}，交投降温`, `${delta.en}, cooling off`);
      else read(volume, "neutral", `${delta.zh}，量能平稳`, `${delta.en}, steady`);
    }
    const turnoverRow = row("turnover", percent(turnover));
    if (turnover !== null && comparableCap) {
      if (turnover < 3) read(turnoverRow, "neutral", "换手低，筹码稳定", "Low turnover, stable holders");
      else if (turnover < 15) read(turnoverRow, "neutral", "交投一般", "Normal trading");
      else if (turnover < 50) read(turnoverRow, "positive", "交投活跃", "Active trading");
      else read(turnoverRow, "negative", "换手过高，投机过热", "Overheated speculation");
    }
    const liquidityRow = row("liquidity", percent(liquidity));
    if (liquidity !== null && comparableCap) {
      if (liquidity < 1) read(liquidityRow, "negative", "链上池子很薄，易砸盘", "Very thin DEX pools");
      else if (liquidity < 5) read(liquidityRow, "neutral", "链上池子偏薄", "Thin DEX pools");
      else read(liquidityRow, "positive", "链上流动性充足", "Deep DEX pools");
    }
    const totalSupply = numeric("totalSupply");
    const maxSupply = numeric("maxSupply");
    const infinite = detail.isInfiniteMaxSupply === 1 || detail.isInfiniteMaxSupply === true;
    const total = row("total-supply", compactNumber(totalSupply, locale), { unit: totalSupply === null ? "" : symbol, group: true });
    const exceedsCap = totalSupply !== null && maxSupply !== null && maxSupply > 0 && totalSupply > maxSupply * 1.0005;
    if (totalSupply !== null && totalSupply <= 0 || exceedsCap) read(total, "neutral", "供应量数据异常", "Invalid supply data");
    else if (totalSupply !== null && maxSupply !== null && maxSupply > 0) {
      const minted = totalSupply / maxSupply * 100;
      if (minted >= 99.95) read(total, "neutral", "已达上限，全部铸造", "Fully minted");
      else read(total, "neutral", `已铸造上限的${minted.toFixed(1)}%`, `${minted.toFixed(1)}% of cap minted`);
    } else if (totalSupply !== null && infinite) read(total, "negative", "无上限，持续增发", "Uncapped, still inflating");
    const circulating = row("circulating-supply", compactNumber(numeric("circulatingSupply"), locale), {
      unit: numeric("circulatingSupply") === null ? "" : symbol
    });
    if (supplyRatio !== null && supplyRatio > 1.0005) read(circulating, "neutral", "流通量超过总量，数据异常", "Exceeds total supply, invalid");
    else if (supplyRatio !== null) {
      const locked = Math.max(0, (1 - supplyRatio) * 100);
      if (supplyRatio >= 0.95) read(circulating, "positive", "基本全部流通，无解锁抛压", "Nearly all circulating");
      else if (supplyRatio >= 0.7) read(circulating, "neutral", `还有${locked.toFixed(0)}%未流通`, `${locked.toFixed(0)}% not yet circulating`);
      else read(circulating, "negative", `还有${locked.toFixed(0)}%未流通，解锁压力大`, `${locked.toFixed(0)}% locked, unlock pressure`);
    }
    const max = row("max-supply", compactNumber(maxSupply, locale), { unit: maxSupply === null ? "" : symbol });
    if (maxSupply !== null && maxSupply <= 0 || exceedsCap) read(max, "neutral", "供应量数据异常", "Invalid supply data");
    else if (maxSupply !== null && totalSupply !== null && totalSupply > 0) {
      const remaining = (maxSupply - totalSupply) / maxSupply * 100;
      if (remaining <= 0.05) read(max, "positive", "封顶，不再增发", "Capped, no new issuance");
      else if (remaining < 10) read(max, "positive", `仅剩${remaining.toFixed(1)}%待发行，通胀低`, `${remaining.toFixed(1)}% left to issue`);
      else read(max, "negative", `还有${remaining.toFixed(0)}%待发行，有增发压力`, `${remaining.toFixed(0)}% left to issue`);
    } else if (infinite) read(max, "negative", "无上限，长期通胀", "No cap, long-term inflation");
    const holderRow = row(holder.id, compactNumber(holder.number, locale), { group: true, unit: holder.id === "treasury" ? symbol : "" });
    if (holder.id === "treasury") read(holderRow, "positive", "机构金库持仓，筹码锁定", "Held by corporate treasuries");
    else {
      const share = topHolderShare(detail);
      if (share !== null && share > 20) read(holderRow, "negative", `最大地址占${share.toFixed(0)}%，筹码集中`, `Top address ${share.toFixed(0)}%, concentrated`);
      else if (share !== null && share < 5) read(holderRow, "positive", `最大地址占${share.toFixed(1)}%，筹码分散`, `Top address ${share.toFixed(1)}%, dispersed`);
      else if (share !== null) read(holderRow, "neutral", `最大地址占${share.toFixed(0)}%`, `Top address holds ${share.toFixed(0)}%`);
    }
    const profileRow = row("profile", profile === null ? "--" : `${profile.toFixed(0)}%`);
    if (profile !== null) {
      if (profile >= 80) read(profileRow, "neutral", "披露较完整", "Well disclosed");
      else if (profile >= 50) read(profileRow, "neutral", "披露一般", "Partly disclosed");
      else read(profileRow, "negative", "透明度差", "Poor transparency");
    }
    return [
      priceRow,
      capRow,
      fdv,
      unlocked,
      volume,
      turnoverRow,
      liquidityRow,
      total,
      circulating,
      max,
      holderRow,
      profileRow
    ];
  }
  function summarizeCmcStance(rows, locale) {
    const bulls = rows.filter((row) => row.tone === "positive").length;
    const bears = rows.filter((row) => row.tone === "negative").length;
    const tone = bulls - bears >= 3 ? "positive" : bears - bulls >= 3 ? "negative" : "neutral";
    const label = { positive: ["偏多", "Bullish"], negative: ["偏空", "Bearish"], neutral: ["中性", "Neutral"] }[tone];
    return {
      tone,
      label: formatLocalizedText(localizedText(label[0], label[1]), locale),
      detail: formatLocalizedText(localizedText(`多${bulls} / 空${bears}`, `${bulls} bull / ${bears} bear`), locale)
    };
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
    ${scope} #${panelId}-stance { flex: 0 0 auto; padding: 0 6px; border: 1px solid currentColor; border-radius: 999px; font-size: 11px; font-weight: 600; color: var(--cmc-muted); }
    ${scope} #${panelId}-stance[data-tone="positive"] { color: var(--cmc-buy); }
    ${scope} #${panelId}-stance[data-tone="negative"] { color: var(--cmc-sell); }
    ${scope} .cmc-controls { display: flex; gap: 2px; flex: 0 0 auto; }
    ${scope} button { font: inherit; cursor: pointer; color: inherit; background: transparent; border: 0; }
    ${scope} .cmc-controls button { min-width: 24px; min-height: 24px; font-size: 16px; padding: 2px 4px; color: var(--cmc-muted); }
    ${scope} button:focus-visible, ${scope} a:focus-visible { outline: 2px solid var(--cmc-accent); outline-offset: 2px; border-radius: 3px; }
    ${scope} #${panelId}-body { min-height: 0; overflow: auto; overscroll-behavior: contain; }
    /* Reserve space for complete prices and changes before wrapping the surrounding prose. */
    ${scope} table { width: 100%; table-layout: auto; border-collapse: collapse; }
    ${scope} .cmc-name-col { width: 24%; }
    ${scope} .cmc-value-col { width: 33%; }
    ${scope} .cmc-reading-col { width: 43%; }
    ${scope} thead { position: sticky; top: 0; z-index: 1; background: var(--cmc-head); }
    ${scope} thead th { color: var(--cmc-muted); font-size: 11px; font-weight: 500; padding: 4px 3px; text-align: left; }
    ${scope} thead th:nth-child(2) { text-align: right; }
    ${scope} thead th:last-child { text-align: right; }
    ${scope} tbody th, ${scope} tbody td { padding: 4px 3px; border-top: 1px solid var(--cmc-border); vertical-align: middle; overflow-wrap: anywhere; }
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
    ${scope} .cmc-reading-button { display: flex; align-items: center; justify-content: flex-end; gap: 3px; width: 100%; min-height: 24px; padding: 0; line-height: inherit; text-align: right; }
    ${scope} .cmc-reading-text { font-size: 11px; font-weight: 500; line-height: 1.3; }
    ${scope} [data-tone="missing"] .cmc-reading-text { color: var(--cmc-muted); }
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
      ${scope} .cmc-info { display: none; }
    }
  `;
  }

  // src/shared/data-panel-layout.js
  var DATA_PANEL_LAYOUT_EVENT = "jh-data-panels-layout-change";
  var DATA_PANEL_WIDTHS = Object.freeze({ trading: 236, cmc: 280 });
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

  // src/binance-coinmarketcap-data/index.user.js
  (function() {
    "use strict";
    function isFuturesTradingPage() {
      return isFuturesTradingPathname(location.pathname);
    }
    const PANEL_ID = "jh-binance-cmc-data-panel";
    const PANEL_WIDTH = DATA_PANEL_WIDTHS.cmc;
    const STORAGE_POS_KEY = "jh_binance_cmc_data_pos";
    const STORAGE_COLLAPSED_KEY = "jh_binance_cmc_data_collapsed";
    const REFRESH_MS = 30 * 1e3;
    const BACKGROUND_REFRESH_MS = 5 * 60 * 1e3;
    const ROUTE_WATCHDOG_MS = 5e3;
    const CMC_MAP_API = "https://api.coinmarketcap.com/data-api/v1/cryptocurrency/map";
    const CMC_DETAIL_API = "https://api.coinmarketcap.com/data-api/v3/cryptocurrency/detail";
    const CMC_HOLDER_API = "https://dapi.coinmarketcap.com/dex-stats/v3/dexer/crypto-holder/show_holders";
    const ASSET_OVERRIDES = {
      RAVE: { id: 38967, symbol: "RAVE", slug: "ravedao" }
    };
    let panelClosed = false;
    let pageSuspended = false;
    let resumeAfterPageShow = false;
    let activePath = null;
    let lastUpdateTs = 0;
    let lastRefreshCompletedAt = null;
    let refreshTimer = null;
    let routeTimer = null;
    let removeSpaRouteChangeListener = null;
    let dragCleanup = null;
    let inFlightSymbol = null;
    let refreshEpoch = 0;
    let refreshController = null;
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
      return !panelClosed && !pageSuspended && isFuturesTradingPage();
    }
    function assertRefreshActive(signal) {
      signal.throwIfAborted();
      if (!isActiveTradingPage() || activePath !== location.pathname) {
        throw new DOMException("CMC refresh is no longer active", "AbortError");
      }
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
    async function resolveCmcAsset(symbol, signal) {
      assertRefreshActive(signal);
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
      const payload = await requestJson(url, signal);
      assertRefreshActive(signal);
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
    function requestText(url, signal) {
      assertRefreshActive(signal);
      return new Promise(function(resolve, reject) {
        const abort = function() {
          request.abort();
        };
        const cleanup = function() {
          signal.removeEventListener("abort", abort);
        };
        const request = GM_xmlhttpRequest({
          method: "GET",
          url,
          timeout: 2e4,
          headers: {
            Accept: "text/html,application/xhtml+xml",
            "Cache-Control": "no-cache",
            Pragma: "no-cache"
          },
          onload(response) {
            cleanup();
            if (signal.aborted) {
              reject(signal.reason);
              return;
            }
            if (response.status < 200 || response.status >= 300) {
              reject(new Error("CMC HTTP " + response.status));
              return;
            }
            resolve(response.responseText || "");
          },
          onerror() {
            cleanup();
            reject(new Error("CMC request failed"));
          },
          ontimeout() {
            cleanup();
            reject(new Error("CMC request timeout"));
          },
          onabort() {
            cleanup();
            reject(new DOMException("CMC request aborted", "AbortError"));
          }
        });
        signal.addEventListener("abort", abort, { once: true });
      });
    }
    function requestJson(url, signal) {
      assertRefreshActive(signal);
      return new Promise(function(resolve, reject) {
        const abort = function() {
          request.abort();
        };
        const cleanup = function() {
          signal.removeEventListener("abort", abort);
        };
        const request = GM_xmlhttpRequest({
          method: "GET",
          url,
          timeout: 2e4,
          headers: {
            Accept: "application/json, text/plain, */*",
            "Cache-Control": "no-cache",
            Pragma: "no-cache"
          },
          onload(response) {
            cleanup();
            if (signal.aborted) {
              reject(signal.reason);
              return;
            }
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
            cleanup();
            reject(new Error("CMC API request failed"));
          },
          ontimeout() {
            cleanup();
            reject(new Error("CMC API request timeout"));
          },
          onabort() {
            cleanup();
            reject(new DOMException("CMC request aborted", "AbortError"));
          }
        });
        signal.addEventListener("abort", abort, { once: true });
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
    async function fetchCmcApiData(asset, signal) {
      const url = detailApiUrlForAsset(asset);
      if (!url) throw new Error(uiText(CMC_COPY.unidentifiedContract));
      const payload = await requestJson(url, signal);
      assertRefreshActive(signal);
      return collectApiDetail(payload);
    }
    async function fetchCmcHolderData(cryptoId, signal) {
      const url = holderApiUrlForCryptoId(cryptoId);
      if (!url) return null;
      const payload = await requestJson(url, signal);
      assertRefreshActive(signal);
      const data = payload && payload.data;
      if (!data || !data.showFlag) return null;
      return numberOrNull(data.count);
    }
    async function fetchCmcPageData(asset, signal) {
      const url = cmcUrlForAsset(asset);
      if (!url) throw new Error(uiText(CMC_COPY.unidentifiedContract));
      const html = await requestText(url, signal);
      assertRefreshActive(signal);
      const nextData = extractNextData(html);
      return collectDetail(nextData);
    }
    async function fetchCmcData(symbol, signal) {
      const asset = await resolveCmcAsset(symbol, signal);
      assertRefreshActive(signal);
      const url = cmcUrlForAsset(asset);
      let detail;
      let source = "data-api";
      try {
        detail = await fetchCmcApiData(asset, signal);
      } catch (apiError) {
        assertRefreshActive(signal);
        if (apiError.name === "AbortError") throw apiError;
        detail = await fetchCmcPageData(asset, signal);
        source = "page-snapshot";
      }
      assertRefreshActive(signal);
      let holderCount = null;
      if (!detail.showTreasuriesFlag) {
        try {
          holderCount = await fetchCmcHolderData(detail.id, signal);
        } catch (holderError) {
          assertRefreshActive(signal);
          if (holderError.name === "AbortError") throw holderError;
          holderCount = null;
        }
      }
      assertRefreshActive(signal);
      if (holderCount !== null) detail = { ...detail, cmcHolderCount: holderCount };
      const locale = resolveUiLocaleFromPathname(location.pathname);
      const rows = buildCmcMetricRows(detail, locale);
      return {
        url,
        name: detail.name || "",
        symbol: detail.symbol || asset && asset.symbol || baseAssetFromSymbol(symbol),
        rank: detail.statistics && detail.statistics.rank,
        lastUpdated: detail.latestUpdateTime || "",
        source,
        rows,
        stance: summarizeCmcStance(rows, locale)
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
      panel.style.width = PANEL_WIDTH + "px";
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
        '<span id="',
        PANEL_ID,
        '-stance" hidden></span>',
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
      renderStance(panel, null);
      if (rowsEl) rowsEl.innerHTML = '<tr><td colspan="3"><div class="cmc-status" role="status">' + escapeHtml(uiText(CMC_COPY.loading)) + "</div></td></tr>";
      if (footerEl) footerEl.textContent = "";
    }
    function renderError(symbol, message) {
      const panel = ensurePanel();
      const symbolEl = panel.querySelector("#" + PANEL_ID + "-symbol");
      const rowsEl = panel.querySelector("#" + PANEL_ID + "-rows");
      const footerEl = panel.querySelector("#" + PANEL_ID + "-footer");
      if (symbolEl) symbolEl.textContent = symbol || "";
      renderStance(panel, null);
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
    function renderStance(panel, stance) {
      const stanceEl = panel.querySelector("#" + PANEL_ID + "-stance");
      stanceEl.hidden = stance === null;
      if (stance === null) return;
      stanceEl.dataset.tone = stance.tone;
      stanceEl.textContent = stance.label;
      stanceEl.title = stance.detail;
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
      renderStance(panel, data.stance);
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
          "</div>"
        ].join("");
      }
    }
    async function refreshForCurrentSymbol(force, silent) {
      if (panelClosed || pageSuspended) return;
      if (!isFuturesTradingPage()) {
        pauseForNonTradingPage();
        return;
      }
      const path = location.pathname;
      if (activePath !== path) return;
      const symbol = getCurrentSymbol();
      if (!symbol) return;
      if (!force && symbol === inFlightSymbol) return;
      const myEpoch = ++refreshEpoch;
      if (refreshController) refreshController.abort();
      const controller = new AbortController();
      refreshController = controller;
      const refreshIsCurrent = function() {
        return myEpoch === refreshEpoch && activePath === path && location.pathname === path && isActiveTradingPage() && getCurrentSymbol() === symbol;
      };
      clearTimeout(refreshTimer);
      refreshTimer = null;
      inFlightSymbol = symbol;
      if (!silent || !lastRowsHtml) renderLoading(symbol);
      try {
        const data = await fetchCmcData(symbol, controller.signal);
        if (!refreshIsCurrent()) return;
        renderData(symbol, data);
      } catch (error) {
        if (!refreshIsCurrent() || error.name === "AbortError") return;
        renderError(symbol, error && error.message ? error.message : String(error));
      } finally {
        if (refreshController === controller) refreshController = null;
        if (refreshIsCurrent()) {
          inFlightSymbol = null;
          lastRefreshCompletedAt = Date.now();
          scheduleDataRefresh();
        }
      }
    }
    function scheduleDataRefresh() {
      clearTimeout(refreshTimer);
      refreshTimer = null;
      if (!isActiveTradingPage() || activePath !== location.pathname || inFlightSymbol || lastRefreshCompletedAt === null) return;
      const interval = document.hidden ? BACKGROUND_REFRESH_MS : REFRESH_MS;
      const delay = Math.max(0, lastRefreshCompletedAt + interval - Date.now());
      refreshTimer = setTimeout(function() {
        refreshTimer = null;
        refreshForCurrentSymbol(false, true);
      }, delay);
    }
    function startDataLoop() {
      if (!isActiveTradingPage()) return;
      if (activePath === location.pathname) {
        scheduleDataRefresh();
        return;
      }
      stopDataLoop();
      activePath = location.pathname;
      lastPath = location.pathname;
      ensurePanel();
      refreshForCurrentSymbol(true, false);
    }
    function stopDataLoop() {
      refreshEpoch++;
      activePath = null;
      if (refreshController) {
        refreshController.abort();
        refreshController = null;
      }
      inFlightSymbol = null;
      lastRefreshCompletedAt = null;
      clearTimeout(refreshTimer);
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
    }
    function handleRouteChange() {
      if (panelClosed || pageSuspended) return;
      if (location.pathname === lastPath) return;
      lastPath = location.pathname;
      if (!isFuturesTradingPage()) {
        pauseForNonTradingPage();
        return;
      }
      startDataLoop();
    }
    function startRouteWatcher() {
      if (panelClosed || pageSuspended) return;
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
      const width = panel.offsetWidth || PANEL_WIDTH;
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
      const normalized = normalizeSavedPosition({ left: rect.left, top: rect.top }, panel.offsetWidth || PANEL_WIDTH);
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
    function resumeDataPage() {
      if (panelClosed || pageSuspended) return;
      startRouteWatcher();
      if (location.pathname !== lastPath) {
        handleRouteChange();
        return;
      }
      if (isFuturesTradingPage()) startDataLoop();
      else pauseForNonTradingPage();
    }
    document.addEventListener("visibilitychange", function() {
      if (panelClosed || pageSuspended) return;
      if (document.hidden) {
        scheduleDataRefresh();
        return;
      }
      resumeDataPage();
    });
    window.addEventListener("pagehide", function() {
      if (pageSuspended) return;
      resumeAfterPageShow = routeTimer !== null;
      pageSuspended = true;
      stopLoop();
    });
    window.addEventListener("pageshow", function() {
      if (!pageSuspended) return;
      pageSuspended = false;
      if (resumeAfterPageShow || !document.hidden) resumeDataPage();
      resumeAfterPageShow = false;
    });
    if (!document.hidden) {
      startRouteWatcher();
      startDataLoop();
    }
  })();
})();
