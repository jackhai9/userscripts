// ==UserScript==
// @name         【自写】Binance 合约交易数据面板
// @namespace    binance.trading.data
// @icon         data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2064%2064%22%3E%3Crect%20width=%2264%22%20height=%2264%22%20rx=%2214%22%20fill=%22%23f0b90b%22/%3E%3Cpath%20d=%22M18%2018h28v8H34v20h-8V26h-8z%22%20fill=%22%231e2329%22/%3E%3C/svg%3E
// @icon64       data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2064%2064%22%3E%3Crect%20width=%2264%22%20height=%2264%22%20rx=%2214%22%20fill=%22%23f0b90b%22/%3E%3Cpath%20d=%22M18%2018h28v8H34v20h-8V26h-8z%22%20fill=%22%231e2329%22/%3E%3C/svg%3E
// @version      1.1.8
// @author       jackhai9
// @description  在合约交易页面叠加浮动面板，定时拉取交易数据（持仓量、多空比、资金费率等）并显示当前值 + 多空信号
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
  // src/shared/binance-futures-route.js
  var FUTURES_TRADING_PATH_RE = /^\/(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?futures\/([A-Z0-9_]{3,})\/?$/;
  function parseFuturesTradingSymbolFromPathname(pathname) {
    const normalized = String(pathname || "").split(/[?#]/, 1)[0];
    const match = normalized.match(FUTURES_TRADING_PATH_RE);
    return match?.[1] ? match[1].toUpperCase() : null;
  }
  function isFuturesTradingPathname(pathname) {
    return Boolean(parseFuturesTradingSymbolFromPathname(pathname));
  }

  // src/binance-trading-data/index.user.js
  (function() {
    "use strict";
    function isFuturesTradingPage() {
      return isFuturesTradingPathname(location.pathname);
    }
    if (!isFuturesTradingPage()) return;
    const PREFIX = "[交易数据]";
    const PANEL_ID = "jh-binance-trading-data-panel";
    const STORAGE_POS_KEY = "jh_binance_trading_data_pos";
    const STORAGE_COLLAPSED_KEY = "jh_binance_trading_data_collapsed";
    const PANEL_WIDTH = 280;
    const DEBUG = false;
    const PERIOD_MS = 5 * 60 * 1e3;
    const FIRST_DELAY = 5e3;
    const RETRY_DELAYS = [1e4, 15e3, 2e4];
    const RETRY_FALLBACK = 3e4;
    const DEFAULT_PERIOD = "5m";
    const DATA_LIMIT = 30;
    const OI_TREND_PERIODS = 6;
    const FUNDING_RATE_THRESHOLD = 1e-4;
    const API_BASE = "https://www.binance.com";
    const API_PATHS = {
      openInterest: "/futures/data/openInterestHist",
      topAccountRatio: "/futures/data/topLongShortAccountRatio",
      topPositionRatio: "/futures/data/topLongShortPositionRatio",
      globalAccountRatio: "/futures/data/globalLongShortAccountRatio",
      takerRatio: "/futures/data/takerlongshortRatio",
      basis: "/futures/data/basis",
      fundingRate: "/fapi/v1/fundingRate",
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
    function getCurrentSymbol() {
      return parseFuturesTradingSymbolFromPathname(location.pathname);
    }
    function isActiveTradingPage() {
      return !panelClosed && !document.hidden && isFuturesTradingPage();
    }
    async function fetchJson(path, params) {
      const url = new URL(path, API_BASE);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      const href = url.toString();
      try {
        const resp = await fetch(href);
        if (!resp.ok) throw Object.assign(new Error(`HTTP ${resp.status}`), { status: resp.status });
        return await resp.json();
      } catch (e1) {
        if (e1.status && e1.status >= 400 && e1.status < 500) throw e1;
        log("重试:", path);
        const resp = await fetch(href);
        if (!resp.ok) throw new Error(`HTTP ${resp.status} (retry)`);
        return await resp.json();
      }
    }
    function fetchOpenInterest(symbol) {
      return fetchJson(API_PATHS.openInterest, { symbol, period: DEFAULT_PERIOD, limit: DATA_LIMIT });
    }
    function fetchTopAccountRatio(symbol) {
      return fetchJson(API_PATHS.topAccountRatio, { symbol, period: DEFAULT_PERIOD, limit: DATA_LIMIT });
    }
    function fetchTopPositionRatio(symbol) {
      return fetchJson(API_PATHS.topPositionRatio, { symbol, period: DEFAULT_PERIOD, limit: DATA_LIMIT });
    }
    function fetchGlobalAccountRatio(symbol) {
      return fetchJson(API_PATHS.globalAccountRatio, { symbol, period: DEFAULT_PERIOD, limit: DATA_LIMIT });
    }
    function fetchTakerRatio(symbol) {
      return fetchJson(API_PATHS.takerRatio, { symbol, period: DEFAULT_PERIOD, limit: DATA_LIMIT });
    }
    function fetchBasis(symbol) {
      return fetchJson(API_PATHS.basis, { pair: symbol, period: DEFAULT_PERIOD, limit: DATA_LIMIT, contractType: "PERPETUAL" });
    }
    function fetchFundingRate(symbol) {
      return fetchJson(API_PATHS.fundingRate, { symbol, limit: 1 });
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
    async function syncServerTime() {
      try {
        const resp = await fetch(API_BASE + API_PATHS.serverTime);
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        const json = await resp.json();
        serverOffset = json.serverTime - Date.now();
        log("服务器时间偏移:", serverOffset + "ms");
      } catch (e) {
        err("获取服务器时间失败，使用本地时间");
        serverOffset = 0;
      }
    }
    function serverNow() {
      return Date.now() + serverOffset;
    }
    let dataStore = {};
    let dataCache = {};
    let failedKeys = /* @__PURE__ */ new Set();
    function extractEndpointTs(data) {
      if (!Array.isArray(data) || data.length === 0) return 0;
      return Number(data[data.length - 1].timestamp) || 0;
    }
    async function fetchPeriodData(symbol, keys) {
      if (!keys || keys.length === 0) return {};
      var fetchers = keys.map(function(k) {
        return FETCHER_MAP[k](symbol);
      });
      var results = await Promise.allSettled(fetchers);
      var backup = dataCache[symbol] || {};
      var entries = {};
      keys.forEach(function(key, i) {
        if (results[i].status === "fulfilled") {
          entries[key] = { data: results[i].value, cached: false };
        } else {
          err(key + " 请求失败:", results[i].reason?.message || results[i].reason);
          if (backup[key]) {
            entries[key] = { data: backup[key], cached: true };
            log(key + " 使用缓存数据");
          } else {
            entries[key] = { data: null, cached: true };
          }
        }
      });
      return entries;
    }
    async function fetchFundingRateData(symbol) {
      var backup = dataCache[symbol] || {};
      try {
        var data = await fetchFundingRate(symbol);
        return { data, cached: false };
      } catch (e) {
        err("fundingRate 请求失败:", e);
        return { data: backup.fundingRate || null, cached: true };
      }
    }
    function applyResults(symbol, periodEntries, fundingEntry) {
      if (!dataStore[symbol]) dataStore[symbol] = {};
      if (!dataCache[symbol]) dataCache[symbol] = {};
      if (periodEntries) {
        for (var key in periodEntries) {
          var e = periodEntries[key];
          dataStore[symbol][key] = e.data;
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
        if (!fundingEntry.cached) {
          dataCache[symbol].fundingRate = fundingEntry.data;
          failedKeys.delete("fundingRate");
        } else {
          failedKeys.add("fundingRate");
        }
      }
    }
    function getPendingKeys(symbol, targetTs) {
      var store = dataStore[symbol] || {};
      return PERIOD_KEYS.filter(function(key) {
        return extractEndpointTs(store[key]) < targetTs;
      });
    }
    function parseOpenInterest(data) {
      if (!Array.isArray(data) || data.length === 0) return null;
      const latest = data[data.length - 1];
      const value = parseFloat(latest.sumOpenInterest);
      const valueUsd = parseFloat(latest.sumOpenInterestValue);
      let trend = null;
      if (data.length > OI_TREND_PERIODS) {
        const prev = parseFloat(data[data.length - 1 - OI_TREND_PERIODS].sumOpenInterest);
        trend = value > prev ? "up" : value < prev ? "down" : "neutral";
      }
      return { value, valueUsd, trend };
    }
    function parseOIMarketCapRatio(data) {
      if (!Array.isArray(data) || data.length === 0) return null;
      const latest = data[data.length - 1];
      const oi = parseFloat(latest.sumOpenInterest);
      const supply = parseFloat(latest.CMCCirculatingSupply);
      if (!supply || supply === 0) return null;
      return { value: oi / supply };
    }
    function parseRatio(data, field) {
      if (!Array.isArray(data) || data.length === 0) return null;
      const latest = data[data.length - 1];
      return { value: parseFloat(latest[field]) };
    }
    function parseBasis(data) {
      if (!Array.isArray(data) || data.length === 0) return null;
      const latest = data[data.length - 1];
      return { value: parseFloat(latest.basisRate) };
    }
    function parseFundingRate(data) {
      if (!Array.isArray(data) || data.length === 0) return null;
      return { value: parseFloat(data[0].fundingRate) };
    }
    function signalOpenInterest(parsed) {
      if (!parsed || !parsed.trend) return "neutral";
      return parsed.trend === "up" ? "long" : parsed.trend === "down" ? "short" : "neutral";
    }
    function signalRatio(parsed) {
      if (!parsed) return "neutral";
      return parsed.value > 1 ? "long" : parsed.value < 1 ? "short" : "neutral";
    }
    function signalBasis(parsed) {
      if (!parsed) return "neutral";
      return parsed.value > 0 ? "long" : parsed.value < 0 ? "short" : "neutral";
    }
    function signalFundingRate(parsed) {
      if (!parsed) return "neutral";
      if (parsed.value < -FUNDING_RATE_THRESHOLD) return "long";
      if (parsed.value > FUNDING_RATE_THRESHOLD) return "short";
      return "neutral";
    }
    function computeSignals(data, cachedKeys) {
      const oi = parseOpenInterest(data.openInterest);
      const oiMcRatio = parseOIMarketCapRatio(data.openInterest);
      const topAccount = parseRatio(data.topAccountRatio, "longShortRatio");
      const topPosition = parseRatio(data.topPositionRatio, "longShortRatio");
      const globalAccount = parseRatio(data.globalAccountRatio, "longShortRatio");
      const taker = parseRatio(data.takerRatio, "buySellRatio");
      const basis = parseBasis(data.basis);
      const funding = parseFundingRate(data.fundingRate);
      const c = cachedKeys || /* @__PURE__ */ new Set();
      const indicators = [
        { name: "合约持仓量", signal: signalOpenInterest(oi), display: fmtOI(oi), vote: true, cached: c.has("openInterest") },
        { name: "大户账户多空比", signal: signalRatio(topAccount), display: fmtRatio(topAccount), vote: true, cached: c.has("topAccountRatio") },
        { name: "大户持仓多空比", signal: signalRatio(topPosition), display: fmtRatio(topPosition), vote: true, cached: c.has("topPositionRatio") },
        { name: "多空账户数比", signal: signalRatio(globalAccount), display: fmtRatio(globalAccount), vote: true, cached: c.has("globalAccountRatio") },
        { name: "主动买卖比", signal: signalRatio(taker), display: fmtRatio(taker), vote: true, cached: c.has("takerRatio") },
        { name: "基差", signal: signalBasis(basis), display: fmtBasis(basis), vote: true, cached: c.has("basis") },
        { name: "资金费率", signal: signalFundingRate(funding), display: fmtFunding(funding), vote: true, cached: c.has("fundingRate") },
        { name: "未平仓量/市值", signal: "neutral", display: fmtOIMarketCap(oiMcRatio), vote: false, cached: c.has("openInterest") }
      ];
      const voters = indicators.filter((i) => i.vote && !i.cached);
      const total = voters.length;
      const longCount = voters.filter((i) => i.signal === "long").length;
      const shortCount = voters.filter((i) => i.signal === "short").length;
      return { indicators, longCount, shortCount, total };
    }
    function fmtOI(parsed) {
      if (!parsed) return "--";
      const v = parsed.value;
      const arrow = parsed.trend === "up" ? " ▲" : parsed.trend === "down" ? " ▼" : "";
      if (v >= 1e9) return (v / 1e9).toFixed(2) + "B" + arrow;
      if (v >= 1e6) return (v / 1e6).toFixed(2) + "M" + arrow;
      if (v >= 1e3) return (v / 1e3).toFixed(0) + "K" + arrow;
      return v.toFixed(2) + arrow;
    }
    function fmtRatio(parsed) {
      if (!parsed) return "--";
      return parsed.value.toFixed(4);
    }
    function fmtBasis(parsed) {
      if (!parsed) return "--";
      const sign = parsed.value >= 0 ? "+" : "";
      return sign + (parsed.value * 100).toFixed(4) + "%";
    }
    function fmtFunding(parsed) {
      if (!parsed) return "--";
      return (parsed.value * 100).toFixed(4) + "%";
    }
    function fmtOIMarketCap(parsed) {
      if (!parsed) return "--";
      return (parsed.value * 100).toFixed(2) + "%";
    }
    const FLASH_STYLE_ID = "jh-trading-data-flash-style";
    function injectFlashStyle() {
      if (document.getElementById(FLASH_STYLE_ID)) return;
      const style = document.createElement("style");
      style.id = FLASH_STYLE_ID;
      style.textContent = [
        "@keyframes jh-td-flash {",
        "  0%, 100% { background: transparent; }",
        "  50% { background: rgba(240, 160, 0, 0.45); }",
        "}",
        ".jh-td-flash { animation: jh-td-flash 1s ease-in-out 5; }"
      ].join("\n");
      (document.head || document.documentElement).appendChild(style);
    }
    let prevDisplayValues = {};
    const C = {
      long: "var(--color-Buy, #0ecb81)",
      short: "var(--color-Sell, #f6465d)",
      neutral: "#76808f",
      bg: "#ffffff",
      text: "#1e2329",
      sub: "#5e6673",
      border: "#eaecef"
    };
    function signalColor(s) {
      return s === "long" ? C.long : s === "short" ? C.short : C.neutral;
    }
    function ensurePanel() {
      let panel = document.getElementById(PANEL_ID);
      if (panel) return panel;
      injectFlashStyle();
      panel = document.createElement("div");
      panel.id = PANEL_ID;
      const savedPos = normalizeSavedPosition(loadPosition(), PANEL_WIDTH);
      const collapsed = loadCollapsed();
      Object.assign(panel.style, {
        position: "fixed",
        top: savedPos ? savedPos.top + "px" : "60px",
        left: savedPos ? savedPos.left + "px" : "auto",
        right: savedPos ? "auto" : "16px",
        width: PANEL_WIDTH + "px",
        zIndex: "999998",
        background: C.bg,
        border: "1px solid " + C.border,
        borderRadius: "8px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        fontFamily: "BinancePlex, system-ui, -apple-system, sans-serif",
        fontSize: "13px",
        color: C.text,
        userSelect: "none",
        overflow: "hidden"
      });
      panel.innerHTML = [
        // --- header ---
        '<div id="',
        PANEL_ID,
        '-header" style="',
        "display:flex;align-items:center;justify-content:space-between;",
        "padding:8px 12px;cursor:move;",
        "background:#fafafa;border-bottom:1px solid ",
        C.border,
        ";",
        '">',
        '<div style="display:flex;align-items:center;gap:6px;">',
        '<span style="font-size:15px;cursor:move;">&#9776;</span>',
        '<span style="font-weight:600;font-size:14px;">交易数据</span>',
        '<span id="',
        PANEL_ID,
        '-symbol" style="color:',
        C.sub,
        ';font-size:13px;"></span>',
        "</div>",
        '<div style="display:flex;gap:4px;">',
        '<button id="',
        PANEL_ID,
        '-collapse" title="折叠/展开" style="',
        "background:none;border:none;cursor:pointer;font-size:15px;",
        "color:",
        C.sub,
        ";padding:0 4px;line-height:1;",
        '">',
        collapsed ? "&#9633;" : "&#95;",
        "</button>",
        '<button id="',
        PANEL_ID,
        '-close" title="关闭" style="',
        "background:none;border:none;cursor:pointer;font-size:15px;",
        "color:",
        C.sub,
        ";padding:0 4px;line-height:1;",
        '">&times;</button>',
        "</div>",
        "</div>",
        // --- body ---
        '<div id="',
        PANEL_ID,
        '-body" style="display:',
        collapsed ? "none" : "block",
        ';">',
        '<div id="',
        PANEL_ID,
        '-rows" style="padding:8px 12px;"></div>',
        '<div id="',
        PANEL_ID,
        '-composite" style="padding:8px 12px;border-top:1px solid ',
        C.border,
        ';"></div>',
        '<div id="',
        PANEL_ID,
        '-footer" style="padding:6px 12px;color:',
        C.sub,
        ";font-size:12px;border-top:1px solid ",
        C.border,
        ';"></div>',
        "</div>"
      ].join("");
      document.body.appendChild(panel);
      keepPanelInViewport(panel);
      savePanelPosition(panel);
      cleanupPanelDrag();
      dragCleanup = setupDrag(panel);
      setupCollapseAndClose(panel);
      cleanupPanelUnload();
      const onBeforeUnload = function() {
        savePanelPosition(panel);
      };
      window.addEventListener("beforeunload", onBeforeUnload);
      unloadCleanup = function cleanupUnload() {
        window.removeEventListener("beforeunload", onBeforeUnload);
      };
      return panel;
    }
    function renderPanel(result, symbolOverride) {
      if (!isActiveTradingPage()) return;
      const panel = ensurePanel();
      const { indicators, longCount, shortCount, total } = result;
      const symbol = symbolOverride || getCurrentSymbol();
      if (!symbol) return;
      const changed = {};
      for (const ind of indicators) {
        if (prevDisplayValues[ind.name] !== void 0 && prevDisplayValues[ind.name] !== ind.display) {
          changed[ind.name] = true;
        }
      }
      for (const ind of indicators) {
        prevDisplayValues[ind.name] = ind.display;
      }
      const symbolEl = panel.querySelector("#" + PANEL_ID + "-symbol");
      if (symbolEl) symbolEl.textContent = symbol || "";
      const rowsEl = panel.querySelector("#" + PANEL_ID + "-rows");
      if (rowsEl) {
        rowsEl.innerHTML = indicators.map(function(ind) {
          const valColor = ind.signal === "long" ? C.long : ind.signal === "short" ? C.short : C.text;
          const dotColor = signalColor(ind.signal);
          const dotStyle = ind.cached ? "display:inline-block;width:10px;height:10px;border-radius:50%;border:2px solid " + dotColor + ";background:transparent;" : "display:inline-block;width:10px;height:10px;border-radius:50%;background:" + dotColor + ";";
          const flashClass = changed[ind.name] ? " jh-td-flash" : "";
          return [
            '<div class="',
            flashClass,
            '" style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-radius:4px;">',
            '<span style="color:',
            C.sub,
            ';min-width:90px;">',
            ind.name,
            "</span>",
            '<span style="font-weight:500;font-variant-numeric:tabular-nums;flex:1;text-align:right;margin-right:8px;color:',
            valColor,
            ';">',
            ind.display,
            "</span>",
            '<span style="',
            dotStyle,
            '"></span>',
            "</div>"
          ].join("");
        }).join("");
      }
      const compositeEl = panel.querySelector("#" + PANEL_ID + "-composite");
      if (compositeEl) {
        const neutral = longCount === shortCount;
        const biasLong = longCount > shortCount;
        const biasLabel = neutral ? "中性" : biasLong ? "偏多" : "偏空";
        const biasColor = neutral ? C.neutral : biasLong ? C.long : C.short;
        const longPct = total > 0 ? Math.round(longCount / total * 100) : 0;
        const shortPct = total > 0 ? Math.round(shortCount / total * 100) : 0;
        compositeEl.innerHTML = [
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">',
          '<span style="font-weight:600;">复合信号</span>',
          '<span style="color:',
          biasColor,
          ';font-weight:600;">',
          biasLabel,
          " ",
          longCount,
          ":",
          shortCount,
          "</span>",
          "</div>",
          '<div style="display:flex;height:6px;border-radius:3px;overflow:hidden;background:',
          C.border,
          ';">',
          '<div style="height:100%;width:',
          longPct,
          "%;border-radius:3px 0 0 3px;background:",
          C.long,
          ';"></div>',
          '<div style="flex:1;"></div>',
          '<div style="height:100%;width:',
          shortPct,
          "%;border-radius:0 3px 3px 0;background:",
          C.short,
          ';"></div>',
          "</div>"
        ].join("");
      }
      const footerEl = panel.querySelector("#" + PANEL_ID + "-footer");
      if (footerEl) {
        lastUpdateTs = Date.now();
        updateFooter(footerEl);
        if (!agoTimer && !document.hidden) {
          agoTimer = setInterval(function() {
            const el = document.querySelector("#" + PANEL_ID + "-footer");
            if (el && lastUpdateTs) updateFooter(el);
          }, 1e3);
        }
      }
    }
    function updateFooter(el) {
      const d = new Date(lastUpdateTs);
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      const ss = String(d.getSeconds()).padStart(2, "0");
      const ago = Math.floor((Date.now() - lastUpdateTs) / 1e3);
      el.innerHTML = '<div style="display:flex;justify-content:space-between;"><span>更新于 ' + hh + ":" + mm + ":" + ss + "</span><span>" + ago + "秒前</span></div>";
    }
    function setupDrag(panel) {
      const header = panel.querySelector("#" + PANEL_ID + "-header");
      if (!header) return null;
      let dragging = false, startX, startY, startLeft, startTop, saveQueued = false;
      const queuePositionSave = function() {
        if (saveQueued) return;
        saveQueued = true;
        window.requestAnimationFrame(function() {
          saveQueued = false;
          savePanelPosition(panel);
        });
      };
      const onMouseDown = function(e) {
        if (e.target.tagName === "BUTTON") return;
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
        const newLeft = Math.max(0, Math.min(startLeft + (e.clientX - startX), window.innerWidth - panel.offsetWidth));
        const newTop = Math.max(0, Math.min(startTop + (e.clientY - startY), window.innerHeight - panel.offsetHeight));
        panel.style.left = newLeft + "px";
        panel.style.top = newTop + "px";
        panel.style.right = "auto";
        queuePositionSave();
      };
      const onMouseUp = function() {
        if (!dragging) return;
        dragging = false;
        savePanelPosition(panel);
      };
      header.addEventListener("mousedown", onMouseDown);
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      return function cleanupDrag() {
        dragging = false;
        header.removeEventListener("mousedown", onMouseDown);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };
    }
    function setupCollapseAndClose(panel) {
      const collapseBtn = panel.querySelector("#" + PANEL_ID + "-collapse");
      const closeBtn = panel.querySelector("#" + PANEL_ID + "-close");
      const body = panel.querySelector("#" + PANEL_ID + "-body");
      if (collapseBtn && body) {
        collapseBtn.addEventListener("click", function() {
          const isHidden = body.style.display === "none";
          body.style.display = isHidden ? "block" : "none";
          collapseBtn.innerHTML = isHidden ? "&#95;" : "&#9633;";
          saveCollapsed(!isHidden);
        });
      }
      if (closeBtn) {
        closeBtn.addEventListener("click", function() {
          panel.style.display = "none";
          panelClosed = true;
          stopLoop();
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
      const rect = panel.getBoundingClientRect();
      const normalized = normalizeSavedPosition({ left: rect.left, top: rect.top }, panel.offsetWidth || PANEL_WIDTH);
      if (!normalized) return;
      panel.style.left = normalized.left + "px";
      panel.style.top = normalized.top + "px";
      panel.style.right = "auto";
      savePosition(normalized.left, normalized.top);
    }
    function savePanelPosition(panel) {
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      const normalized = normalizeSavedPosition({ left: rect.left, top: rect.top }, panel.offsetWidth || PANEL_WIDTH);
      if (!normalized) return;
      savePosition(normalized.left, normalized.top);
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
    let agoTimer = null;
    let dragCleanup = null;
    let unloadCleanup = null;
    let panelClosed = false;
    let lastUpdateTs = 0;
    let fetching = 0;
    let epoch = 0;
    let lastPath = location.pathname;
    function renderAll(symbol) {
      if (!isActiveTradingPage() || getCurrentSymbol() !== symbol) return;
      var data = dataStore[symbol] || {};
      var result = computeSignals(data, failedKeys);
      renderPanel(result, symbol);
    }
    async function initialFetch(symbol) {
      epoch++;
      var myEpoch = epoch;
      clearTimeout(cycleTimer);
      clearTimeout(retryTimer);
      if (symbol !== lastSymbol) {
        lastSymbol = symbol;
        failedKeys = /* @__PURE__ */ new Set();
        prevDisplayValues = {};
        log("交易对:", symbol);
      }
      fetching = myEpoch;
      try {
        var [periodEntries, fundingEntry] = await Promise.all([
          fetchPeriodData(symbol, PERIOD_KEYS),
          fetchFundingRateData(symbol)
        ]);
        if (epoch !== myEpoch || !isActiveTradingPage() || getCurrentSymbol() !== symbol) return;
        applyResults(symbol, periodEntries, fundingEntry);
        renderAll(symbol);
      } catch (e) {
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
      if (panelClosed || document.hidden) return;
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
      if (document.hidden || panelClosed) return;
      if (!isFuturesTradingPage()) {
        pauseForNonTradingPage();
        return;
      }
      if (fetching) return;
      var symbol = getCurrentSymbol();
      if (!symbol) {
        scheduleCycle(true);
        return;
      }
      if (symbol !== lastSymbol) {
        lastSymbol = symbol;
        failedKeys = /* @__PURE__ */ new Set();
        prevDisplayValues = {};
        log("交易对:", symbol);
      }
      var targetTs = boundary;
      var myEpoch = ++epoch;
      fetching = myEpoch;
      try {
        var periodEntries, fundingEntry;
        if (attempt === 0) {
          [periodEntries, fundingEntry] = await Promise.all([
            fetchPeriodData(symbol, PERIOD_KEYS),
            fetchFundingRateData(symbol)
          ]);
        } else {
          var pending = getPendingKeys(symbol, targetTs);
          if (pending.length === 0) {
            log("所有 5m 接口已更新");
            renderAll(symbol);
            scheduleCycle();
            return;
          }
          periodEntries = await fetchPeriodData(symbol, pending);
        }
        if (epoch !== myEpoch || !isActiveTradingPage() || getCurrentSymbol() !== symbol) return;
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
        err("数据拉取失败:", e);
        scheduleCycle();
      } finally {
        if (fetching === myEpoch) fetching = 0;
      }
    }
    function stopBusinessLoop() {
      clearTimeout(cycleTimer);
      cycleTimer = null;
      clearTimeout(retryTimer);
      retryTimer = null;
      if (agoTimer) {
        clearInterval(agoTimer);
        agoTimer = null;
      }
    }
    function stopRouteWatcher() {
      if (pathTimer) {
        clearInterval(pathTimer);
        pathTimer = null;
      }
    }
    function stopLoop() {
      epoch++;
      stopBusinessLoop();
      stopRouteWatcher();
    }
    function cleanupPanelDrag() {
      if (!dragCleanup) return;
      dragCleanup();
      dragCleanup = null;
    }
    function cleanupPanelUnload() {
      if (!unloadCleanup) return;
      unloadCleanup();
      unloadCleanup = null;
    }
    function removePanel() {
      cleanupPanelDrag();
      cleanupPanelUnload();
      var panel = document.getElementById(PANEL_ID);
      if (panel) panel.remove();
    }
    function pauseForNonTradingPage() {
      epoch++;
      stopBusinessLoop();
      lastSymbol = null;
      removePanel();
    }
    function handlePathChange() {
      if (document.hidden || panelClosed) return;
      if (location.pathname === lastPath) return;
      lastPath = location.pathname;
      if (!isFuturesTradingPage()) {
        pauseForNonTradingPage();
        return;
      }
      var s = getCurrentSymbol();
      if (s && s !== lastSymbol) {
        initialFetch(s).then(function() {
          scheduleCycle();
        });
      }
    }
    function startRouteWatcher() {
      if (pathTimer || document.hidden || panelClosed) return;
      lastPath = location.pathname;
      pathTimer = setInterval(handlePathChange, 1e3);
    }
    async function start() {
      if (!isFuturesTradingPage()) return;
      log("脚本启动");
      await syncServerTime();
      ensurePanel();
      if (!document.hidden) {
        var symbol = getCurrentSymbol();
        if (symbol) await initialFetch(symbol);
        scheduleCycle();
      }
      document.addEventListener("visibilitychange", function() {
        if (!document.hidden) {
          if (panelClosed) return;
          startRouteWatcher();
          if (!isFuturesTradingPage()) {
            pauseForNonTradingPage();
            return;
          }
          syncServerTime();
          var sym = getCurrentSymbol();
          if (sym) {
            initialFetch(sym).then(function() {
              scheduleCycle();
            });
          }
          if (!agoTimer) {
            var el = document.querySelector("#" + PANEL_ID + "-footer");
            if (el && lastUpdateTs) updateFooter(el);
            agoTimer = setInterval(function() {
              var el2 = document.querySelector("#" + PANEL_ID + "-footer");
              if (el2 && lastUpdateTs) updateFooter(el2);
            }, 1e3);
          }
        } else {
          stopLoop();
        }
      });
      setInterval(syncServerTime, 60 * 60 * 1e3);
      window.addEventListener("resize", function() {
        var panel = document.getElementById(PANEL_ID);
        if (panel) keepPanelInViewport(panel);
      });
      if (!document.hidden) {
        startRouteWatcher();
      }
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start);
    } else {
      start();
    }
  })();
})();
