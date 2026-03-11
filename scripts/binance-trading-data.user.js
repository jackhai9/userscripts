// ==UserScript==
// @name         【自写】Binance 合约交易数据面板
// @namespace    binance.trading.data
// @icon         https://avatars.githubusercontent.com/u/5935568?s=128
// @version      1.0.8
// @author       jackhai9
// @description  在合约交易页面叠加浮动面板，定时拉取交易数据（持仓量、多空比、资金费率等）并显示当前值 + 多空信号
// @match        https://www.binance.com/*/futures/*
// @match        https://www.binance.com/futures/*
// @updateURL    https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-trading-data.user.js
// @downloadURL  https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-trading-data.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  /* ========== 常量 & 配置 ========== */

  const PREFIX = '[交易数据]';
  const PANEL_ID = 'jh-binance-trading-data-panel';
  const STORAGE_POS_KEY = 'jh_binance_trading_data_pos';
  const STORAGE_COLLAPSED_KEY = 'jh_binance_trading_data_collapsed';

  const PERIOD_MS = 5 * 60 * 1000;  // 数据周期 5 分钟
  const FIRST_DELAY = 5_000;         // 周期边界后首次等待 5s
  const RETRY_DELAYS = [10_000, 15_000, 20_000]; // 后续重试间隔，用完后按 30s 循环
  const RETRY_FALLBACK = 30_000;
  const DEFAULT_PERIOD = '5m';
  const DATA_LIMIT = 30;
  const OI_TREND_PERIODS = 6;
  const FUNDING_RATE_THRESHOLD = 0.0001; // 0.01%

  const API_BASE = 'https://www.binance.com';
  const API_PATHS = {
    openInterest:       '/futures/data/openInterestHist',
    topAccountRatio:    '/futures/data/topLongShortAccountRatio',
    topPositionRatio:   '/futures/data/topLongShortPositionRatio',
    globalAccountRatio: '/futures/data/globalLongShortAccountRatio',
    takerRatio:         '/futures/data/takerlongshortRatio',
    basis:              '/futures/data/basis',
    fundingRate:        '/fapi/v1/fundingRate',
    serverTime:         '/fapi/v1/time',
  };

  // 参与 5 分钟周期重试的接口（不含 fundingRate）
  const PERIOD_KEYS = ['openInterest', 'topAccountRatio', 'topPositionRatio', 'globalAccountRatio', 'takerRatio', 'basis'];

  /* ========== 日志 ========== */

  // Binance 屏蔽了 console.log/warn/info/debug，只能用 console.error
  function emit(level, ...args) {
    console.error(PREFIX, `[${level}]`, ...args);
  }
  function log(...args) { emit('LOG', ...args); }
  function err(...args) { emit('ERR', ...args); }

  /* ========== Symbol 检测 ========== */

  let lastSymbol = null;

  function getCurrentSymbol() {
    const m = location.pathname.match(/\/futures\/([A-Z0-9_]+)/i);
    if (m && m[1]) return m[1].toUpperCase();
    const title = document.title || '';
    const t = title.match(/([A-Z0-9_]{6,})\s+U/i);
    return t && t[1] ? t[1].toUpperCase() : null;
  }

  /* ========== API 层 ========== */

  async function fetchJson(path, params) {
    const url = new URL(path, API_BASE);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const href = url.toString();
    try {
      const resp = await fetch(href);
      if (!resp.ok) throw Object.assign(new Error(`HTTP ${resp.status}`), { status: resp.status });
      return await resp.json();
    } catch (e1) {
      // 4xx 是确定性失败（参数错误、限流），不重试
      if (e1.status && e1.status >= 400 && e1.status < 500) throw e1;
      // 网络错误或 5xx，重试一次
      log('重试:', path);
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
    return fetchJson(API_PATHS.basis, { pair: symbol, period: DEFAULT_PERIOD, limit: DATA_LIMIT, contractType: 'PERPETUAL' });
  }
  function fetchFundingRate(symbol) {
    return fetchJson(API_PATHS.fundingRate, { symbol, limit: 1 });
  }

  // key -> fetcher 映射
  const FETCHER_MAP = {
    openInterest:       fetchOpenInterest,
    topAccountRatio:    fetchTopAccountRatio,
    topPositionRatio:   fetchTopPositionRatio,
    globalAccountRatio: fetchGlobalAccountRatio,
    takerRatio:         fetchTakerRatio,
    basis:              fetchBasis,
  };

  /* ========== 服务器时间 ========== */

  let serverOffset = 0; // serverTime - localTime

  async function syncServerTime() {
    try {
      const resp = await fetch(API_BASE + API_PATHS.serverTime);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const json = await resp.json();
      serverOffset = json.serverTime - Date.now();
      log('服务器时间偏移:', serverOffset + 'ms');
    } catch (e) {
      err('获取服务器时间失败，使用本地时间');
      serverOffset = 0;
    }
  }

  function serverNow() {
    return Date.now() + serverOffset;
  }

  /* ========== 数据存储 ========== */

  let dataStore = {};   // symbol -> { key: responseData } 当前展示用
  let dataCache = {};   // symbol -> { key: responseData } 失败回退用
  let failedKeys = new Set(); // 当前使用回退缓存的 key

  // 提取接口返回的最新数据点时间戳
  function extractEndpointTs(data) {
    if (!Array.isArray(data) || data.length === 0) return 0;
    return Number(data[data.length - 1].timestamp) || 0;
  }

  // 纯函数：拉取指定 5m 接口，返回结果但不写全局状态
  async function fetchPeriodData(symbol, keys) {
    if (!keys || keys.length === 0) return {};
    var fetchers = keys.map(function (k) { return FETCHER_MAP[k](symbol); });
    var results = await Promise.allSettled(fetchers);
    var backup = dataCache[symbol] || {};
    var entries = {};

    keys.forEach(function (key, i) {
      if (results[i].status === 'fulfilled') {
        entries[key] = { data: results[i].value, cached: false };
      } else {
        err(key + ' 请求失败:', results[i].reason?.message || results[i].reason);
        if (backup[key]) {
          entries[key] = { data: backup[key], cached: true };
          log(key + ' 使用缓存数据');
        } else {
          entries[key] = { data: null, cached: true };
        }
      }
    });
    return entries;
  }

  // 纯函数：拉取 fundingRate
  async function fetchFundingRateData(symbol) {
    var backup = dataCache[symbol] || {};
    try {
      var data = await fetchFundingRate(symbol);
      return { data: data, cached: false };
    } catch (e) {
      err('fundingRate 请求失败:', e);
      return { data: backup.fundingRate || null, cached: true };
    }
  }

  // 将 fetch 结果写入全局状态（仅在 epoch 校验通过后调用）
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
        failedKeys.delete('fundingRate');
      } else {
        failedKeys.add('fundingRate');
      }
    }
  }

  // 哪些 5m 接口的最新数据时间戳还没到 targetTs
  function getPendingKeys(symbol, targetTs) {
    var store = dataStore[symbol] || {};
    return PERIOD_KEYS.filter(function (key) {
      return extractEndpointTs(store[key]) < targetTs;
    });
  }

  /* ========== 数据处理 ========== */

  function parseOpenInterest(data) {
    if (!Array.isArray(data) || data.length === 0) return null;
    const latest = data[data.length - 1];
    const value = parseFloat(latest.sumOpenInterest);
    const valueUsd = parseFloat(latest.sumOpenInterestValue);
    let trend = null;
    if (data.length > OI_TREND_PERIODS) {
      const prev = parseFloat(data[data.length - 1 - OI_TREND_PERIODS].sumOpenInterest);
      trend = value > prev ? 'up' : value < prev ? 'down' : 'neutral';
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

  /* ========== 信号计算 ========== */

  function signalOpenInterest(parsed) {
    if (!parsed || !parsed.trend) return 'neutral';
    return parsed.trend === 'up' ? 'long' : parsed.trend === 'down' ? 'short' : 'neutral';
  }

  function signalRatio(parsed) {
    if (!parsed) return 'neutral';
    return parsed.value > 1 ? 'long' : parsed.value < 1 ? 'short' : 'neutral';
  }

  function signalBasis(parsed) {
    if (!parsed) return 'neutral';
    return parsed.value > 0 ? 'long' : parsed.value < 0 ? 'short' : 'neutral';
  }

  function signalFundingRate(parsed) {
    if (!parsed) return 'neutral';
    // 反向指标：高正费率 = 偏空，高负费率 = 偏多
    if (parsed.value < -FUNDING_RATE_THRESHOLD) return 'long';
    if (parsed.value > FUNDING_RATE_THRESHOLD) return 'short';
    return 'neutral';
  }

  function computeSignals(data, cachedKeys) {
    const oi = parseOpenInterest(data.openInterest);
    const oiMcRatio = parseOIMarketCapRatio(data.openInterest);
    const topAccount = parseRatio(data.topAccountRatio, 'longShortRatio');
    const topPosition = parseRatio(data.topPositionRatio, 'longShortRatio');
    const globalAccount = parseRatio(data.globalAccountRatio, 'longShortRatio');
    const taker = parseRatio(data.takerRatio, 'buySellRatio');
    const basis = parseBasis(data.basis);
    const funding = parseFundingRate(data.fundingRate);
    const c = cachedKeys || new Set();

    const indicators = [
      { name: '合约持仓量',     signal: signalOpenInterest(oi),     display: fmtOI(oi),             vote: true,  cached: c.has('openInterest') },
      { name: '大户账户多空比', signal: signalRatio(topAccount),     display: fmtRatio(topAccount),   vote: true,  cached: c.has('topAccountRatio') },
      { name: '大户持仓多空比', signal: signalRatio(topPosition),    display: fmtRatio(topPosition),  vote: true,  cached: c.has('topPositionRatio') },
      { name: '多空账户数比',   signal: signalRatio(globalAccount),  display: fmtRatio(globalAccount), vote: true, cached: c.has('globalAccountRatio') },
      { name: '主动买卖比',     signal: signalRatio(taker),          display: fmtRatio(taker),        vote: true,  cached: c.has('takerRatio') },
      { name: '基差',           signal: signalBasis(basis),          display: fmtBasis(basis),        vote: true,  cached: c.has('basis') },
      { name: '资金费率',       signal: signalFundingRate(funding),  display: fmtFunding(funding),    vote: true,  cached: c.has('fundingRate') },
      { name: '未平仓量/市值',  signal: 'neutral',                   display: fmtOIMarketCap(oiMcRatio), vote: false, cached: c.has('openInterest') },
    ];

    const voters = indicators.filter(i => i.vote && !i.cached);
    const total = voters.length;
    const longCount = voters.filter(i => i.signal === 'long').length;
    const shortCount = voters.filter(i => i.signal === 'short').length;

    return { indicators, longCount, shortCount, total };
  }

  /* ========== 格式化 ========== */

  function fmtOI(parsed) {
    if (!parsed) return '--';
    const v = parsed.value;
    const arrow = parsed.trend === 'up' ? ' ▲' : parsed.trend === 'down' ? ' ▼' : '';
    if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B' + arrow;
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M' + arrow;
    if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K' + arrow;
    return v.toFixed(2) + arrow;
  }

  function fmtRatio(parsed) {
    if (!parsed) return '--';
    return parsed.value.toFixed(4);
  }

  function fmtBasis(parsed) {
    if (!parsed) return '--';
    const sign = parsed.value >= 0 ? '+' : '';
    return sign + (parsed.value * 100).toFixed(4) + '%';
  }

  function fmtFunding(parsed) {
    if (!parsed) return '--';
    return (parsed.value * 100).toFixed(4) + '%';
  }

  function fmtOIMarketCap(parsed) {
    if (!parsed) return '--';
    return (parsed.value * 100).toFixed(2) + '%';
  }

  /* ========== 闪烁样式注入 ========== */

  const FLASH_STYLE_ID = 'jh-trading-data-flash-style';
  function injectFlashStyle() {
    if (document.getElementById(FLASH_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = FLASH_STYLE_ID;
    style.textContent = [
      '@keyframes jh-td-flash {',
      '  0%, 100% { background: transparent; }',
      '  50% { background: rgba(240, 160, 0, 0.45); }',
      '}',
      '.jh-td-flash { animation: jh-td-flash 1s ease-in-out 5; }',
    ].join('\n');
    (document.head || document.documentElement).appendChild(style);
  }

  /* ========== 数据变化追踪 ========== */

  let prevDisplayValues = {}; // name -> display string

  /* ========== 颜色 ========== */

  const C = {
    long:    'var(--color-Buy, #0ecb81)',
    short:   'var(--color-Sell, #f6465d)',
    neutral: '#76808f',
    bg:      '#ffffff',
    text:    '#1e2329',
    sub:     '#5e6673',
    border:  '#eaecef',
  };

  function signalColor(s) {
    return s === 'long' ? C.long : s === 'short' ? C.short : C.neutral;
  }

  /* ========== 面板 UI ========== */

  function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;

    injectFlashStyle();

    panel = document.createElement('div');
    panel.id = PANEL_ID;

    const savedPos = loadPosition();
    const collapsed = loadCollapsed();

    Object.assign(panel.style, {
      position: 'fixed',
      top:    savedPos ? savedPos.top + 'px'  : '60px',
      left:   savedPos ? savedPos.left + 'px' : 'auto',
      right:  savedPos ? 'auto' : '16px',
      width:  '280px',
      zIndex: '999998',
      background:   C.bg,
      border:       '1px solid ' + C.border,
      borderRadius: '8px',
      boxShadow:    '0 2px 8px rgba(0,0,0,0.08)',
      fontFamily:   'BinancePlex, system-ui, -apple-system, sans-serif',
      fontSize:     '13px',
      color:        C.text,
      userSelect:   'none',
      overflow:     'hidden',
    });

    panel.innerHTML = [
      // --- header ---
      '<div id="', PANEL_ID, '-header" style="',
        'display:flex;align-items:center;justify-content:space-between;',
        'padding:8px 12px;cursor:move;',
        'background:#fafafa;border-bottom:1px solid ', C.border, ';',
      '">',
        '<div style="display:flex;align-items:center;gap:6px;">',
          '<span style="font-size:15px;cursor:move;">&#9776;</span>',
          '<span style="font-weight:600;font-size:14px;">交易数据</span>',
          '<span id="', PANEL_ID, '-symbol" style="color:', C.sub, ';font-size:13px;"></span>',
        '</div>',
        '<div style="display:flex;gap:4px;">',
          '<button id="', PANEL_ID, '-collapse" title="折叠/展开" style="',
            'background:none;border:none;cursor:pointer;font-size:15px;',
            'color:', C.sub, ';padding:0 4px;line-height:1;',
          '">', collapsed ? '&#9633;' : '&#95;', '</button>',
          '<button id="', PANEL_ID, '-close" title="关闭" style="',
            'background:none;border:none;cursor:pointer;font-size:15px;',
            'color:', C.sub, ';padding:0 4px;line-height:1;',
          '">&times;</button>',
        '</div>',
      '</div>',
      // --- body ---
      '<div id="', PANEL_ID, '-body" style="display:', collapsed ? 'none' : 'block', ';">',
        '<div id="', PANEL_ID, '-rows" style="padding:8px 12px;"></div>',
        '<div id="', PANEL_ID, '-composite" style="padding:8px 12px;border-top:1px solid ', C.border, ';"></div>',
        '<div id="', PANEL_ID, '-footer" style="padding:6px 12px;color:', C.sub, ';font-size:12px;border-top:1px solid ', C.border, ';"></div>',
      '</div>',
    ].join('');

    document.body.appendChild(panel);
    setupDrag(panel);
    setupCollapseAndClose(panel);

    return panel;
  }

  function renderPanel(result) {
    const panel = ensurePanel();
    const { indicators, longCount, shortCount, total } = result;
    const symbol = getCurrentSymbol();

    // 检测哪些指标的值发生了变化
    const changed = {};
    for (const ind of indicators) {
      if (prevDisplayValues[ind.name] !== undefined && prevDisplayValues[ind.name] !== ind.display) {
        changed[ind.name] = true;
      }
    }
    // 更新缓存
    for (const ind of indicators) {
      prevDisplayValues[ind.name] = ind.display;
    }

    // symbol
    const symbolEl = panel.querySelector('#' + PANEL_ID + '-symbol');
    if (symbolEl) symbolEl.textContent = symbol || '';

    // rows
    const rowsEl = panel.querySelector('#' + PANEL_ID + '-rows');
    if (rowsEl) {
      rowsEl.innerHTML = indicators.map(function (ind) {
        const valColor = ind.signal === 'long' ? C.long : ind.signal === 'short' ? C.short : C.text;
        const dotColor = signalColor(ind.signal);
        const dotStyle = ind.cached
          ? 'display:inline-block;width:10px;height:10px;border-radius:50%;border:2px solid ' + dotColor + ';background:transparent;'
          : 'display:inline-block;width:10px;height:10px;border-radius:50%;background:' + dotColor + ';';
        const flashClass = changed[ind.name] ? ' jh-td-flash' : '';
        return [
          '<div class="', flashClass, '" style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-radius:4px;">',
            '<span style="color:', C.sub, ';min-width:90px;">', ind.name, '</span>',
            '<span style="font-weight:500;font-variant-numeric:tabular-nums;flex:1;text-align:right;margin-right:8px;color:', valColor, ';">', ind.display, '</span>',
            '<span style="', dotStyle, '"></span>',
          '</div>',
        ].join('');
      }).join('');
    }

    // composite
    const compositeEl = panel.querySelector('#' + PANEL_ID + '-composite');
    if (compositeEl) {
      const neutral = longCount === shortCount;
      const biasLong = longCount > shortCount;
      const biasLabel = neutral ? '中性' : biasLong ? '偏多' : '偏空';
      const biasColor = neutral ? C.neutral : biasLong ? C.long : C.short;
      const longPct = total > 0 ? Math.round(longCount / total * 100) : 0;
      const shortPct = total > 0 ? Math.round(shortCount / total * 100) : 0;

      compositeEl.innerHTML = [
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">',
          '<span style="font-weight:600;">复合信号</span>',
          '<span style="color:', biasColor, ';font-weight:600;">', biasLabel, ' ', longCount, ':', shortCount, '</span>',
        '</div>',
        '<div style="display:flex;height:6px;border-radius:3px;overflow:hidden;background:', C.border, ';">',
          '<div style="height:100%;width:', longPct, '%;border-radius:3px 0 0 3px;background:', C.long, ';"></div>',
          '<div style="flex:1;"></div>',
          '<div style="height:100%;width:', shortPct, '%;border-radius:0 3px 3px 0;background:', C.short, ';"></div>',
        '</div>',
        '<div style="display:flex;justify-content:space-between;margin-top:3px;font-size:12px;color:', C.sub, ';">',
          '<span style="color:', C.long, ';">多 ', longCount, '</span>',
          '<span style="color:', C.short, ';">空 ', shortCount, '</span>',
        '</div>',
      ].join('');
    }

    // footer
    const footerEl = panel.querySelector('#' + PANEL_ID + '-footer');
    if (footerEl) {
      lastUpdateTs = Date.now();
      updateFooter(footerEl);
      if (!agoTimer) {
        agoTimer = setInterval(function () {
          const el = document.querySelector('#' + PANEL_ID + '-footer');
          if (el && lastUpdateTs) updateFooter(el);
        }, 1000);
      }
    }
  }

  function updateFooter(el) {
    const d = new Date(lastUpdateTs);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    const ago = Math.floor((Date.now() - lastUpdateTs) / 1000);
    el.innerHTML = '<div style="display:flex;justify-content:space-between;">' +
      '<span>更新于 ' + hh + ':' + mm + ':' + ss + '</span>' +
      '<span>' + ago + '秒前</span></div>';
  }

  /* ========== 拖拽 ========== */

  function setupDrag(panel) {
    const header = panel.querySelector('#' + PANEL_ID + '-header');
    if (!header) return;

    let dragging = false, startX, startY, startLeft, startTop;

    header.addEventListener('mousedown', function (e) {
      if (e.target.tagName === 'BUTTON') return;
      dragging = true;
      const rect = panel.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      e.preventDefault();
    });

    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      const newLeft = Math.max(0, Math.min(startLeft + (e.clientX - startX), window.innerWidth - panel.offsetWidth));
      const newTop  = Math.max(0, Math.min(startTop + (e.clientY - startY), window.innerHeight - panel.offsetHeight));
      panel.style.left  = newLeft + 'px';
      panel.style.top   = newTop + 'px';
      panel.style.right = 'auto';
    });

    document.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;
      savePosition(parseInt(panel.style.left, 10), parseInt(panel.style.top, 10));
    });
  }

  /* ========== 折叠 & 关闭 ========== */

  function setupCollapseAndClose(panel) {
    const collapseBtn = panel.querySelector('#' + PANEL_ID + '-collapse');
    const closeBtn    = panel.querySelector('#' + PANEL_ID + '-close');
    const body        = panel.querySelector('#' + PANEL_ID + '-body');

    if (collapseBtn && body) {
      collapseBtn.addEventListener('click', function () {
        const isHidden = body.style.display === 'none';
        body.style.display = isHidden ? 'block' : 'none';
        collapseBtn.innerHTML = isHidden ? '&#95;' : '&#9633;';
        saveCollapsed(!isHidden);
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        panel.style.display = 'none';
        stopLoop();
      });
    }
  }

  /* ========== localStorage ========== */

  function loadPosition() {
    try {
      const raw = localStorage.getItem(STORAGE_POS_KEY);
      if (!raw) return null;
      const pos = JSON.parse(raw);
      if (typeof pos.left === 'number' && typeof pos.top === 'number') return pos;
    } catch (_) { /* ignore */ }
    return null;
  }

  function savePosition(left, top) {
    localStorage.setItem(STORAGE_POS_KEY, JSON.stringify({ left: left, top: top }));
  }

  function loadCollapsed() {
    return localStorage.getItem(STORAGE_COLLAPSED_KEY) === '1';
  }

  function saveCollapsed(collapsed) {
    localStorage.setItem(STORAGE_COLLAPSED_KEY, collapsed ? '1' : '0');
  }

  /* ========== 主循环 ========== */

  let cycleTimer = null;
  let retryTimer = null;
  let pathTimer = null;
  let agoTimer = null;
  let lastUpdateTs = 0;
  let fetching = 0; // 0=空闲, 非零=正在拉取的 epoch
  let epoch = 0; // 递增计数器，用于作废过期的异步回调

  function renderAll(symbol) {
    var data = dataStore[symbol] || {};
    var result = computeSignals(data, failedKeys);
    renderPanel(result);
  }

  // 首次全量拉取（启动 / 切交易对 / tab 恢复）
  async function initialFetch(symbol) {
    // 作废所有正在进行的异步操作
    epoch++;
    var myEpoch = epoch;
    clearTimeout(cycleTimer);
    clearTimeout(retryTimer);

    if (symbol !== lastSymbol) {
      lastSymbol = symbol;
      failedKeys = new Set();
      prevDisplayValues = {};
      log('交易对:', symbol);
    }
    fetching = myEpoch;
    try {
      var [periodEntries, fundingEntry] = await Promise.all([
        fetchPeriodData(symbol, PERIOD_KEYS),
        fetchFundingRateData(symbol),
      ]);
      if (epoch !== myEpoch) return; // 已被更新的调用取代
      applyResults(symbol, periodEntries, fundingEntry);
      renderAll(symbol);
    } catch (e) { err('拉取失败:', e); }
    finally { if (fetching === myEpoch) fetching = 0; }
  }

  // boundary = 刚过去的 5 分钟边界（floor）
  // targetTs = boundary = Binance 数据 timestamp 推进到关闭边界
  // 重试窗口 = boundary ~ boundary + PERIOD_MS

  function scheduleCycle(forceNext) {
    clearTimeout(cycleTimer);
    clearTimeout(retryTimer);

    var now = serverNow();
    var boundary = Math.floor(now / PERIOD_MS) * PERIOD_MS;

    if (!forceNext) {
      var targetTs = boundary;
      var symbol = getCurrentSymbol();
      var pending = symbol ? getPendingKeys(symbol, targetTs) : [];

      if (pending.length > 0 && now < boundary + PERIOD_MS) {
        // 当前周期还有数据没拿到，异步进入重试
        var delay = Math.max(0, boundary + FIRST_DELAY - now);
        cycleTimer = setTimeout(function () {
          runCycleAttempt(boundary, 0);
        }, delay);
        return;
      }
    }

    // 当前周期已完成 / 被强制跳过，调度下一个周期
    var nextBound = boundary + PERIOD_MS;
    var delay = Math.max(0, nextBound - now + FIRST_DELAY);
    log('下次拉取:', new Date(nextBound + FIRST_DELAY - serverOffset).toLocaleTimeString());

    cycleTimer = setTimeout(function () {
      runCycleAttempt(nextBound, 0);
    }, delay);
  }

  async function runCycleAttempt(boundary, attempt) {
    if (document.hidden) {
      scheduleCycle(true);
      return;
    }
    if (fetching) return;

    var symbol = getCurrentSymbol();
    if (!symbol) { scheduleCycle(true); return; }

    if (symbol !== lastSymbol) {
      lastSymbol = symbol;
      failedKeys = new Set();
      prevDisplayValues = {};
      log('交易对:', symbol);
    }

    var targetTs = boundary;
    var myEpoch = epoch;

    fetching = myEpoch;
    try {
      var periodEntries, fundingEntry;
      if (attempt === 0) {
        [periodEntries, fundingEntry] = await Promise.all([
          fetchPeriodData(symbol, PERIOD_KEYS),
          fetchFundingRateData(symbol),
        ]);
      } else {
        var pending = getPendingKeys(symbol, targetTs);
        if (pending.length === 0) {
          log('所有 5m 接口已更新');
          renderAll(symbol);
          scheduleCycle();
          return;
        }
        periodEntries = await fetchPeriodData(symbol, pending);
      }

      // await 返回后检查：是否已被 initialFetch 取代
      if (epoch !== myEpoch) return;

      applyResults(symbol, periodEntries, fundingEntry || null);
      renderAll(symbol);

      var stillPending = getPendingKeys(symbol, targetTs);

      if (stillPending.length === 0) {
        log('所有 5m 接口已更新');
        scheduleCycle();
        return;
      }

      // 计算重试间隔
      var retryDelay = attempt < RETRY_DELAYS.length ? RETRY_DELAYS[attempt] : RETRY_FALLBACK;
      var retryTime = serverNow() + retryDelay;
      var cycleEnd = boundary + PERIOD_MS;

      if (retryTime >= cycleEnd) {
        log('本周期时间用完，待更新:', stillPending.join(', '));
        scheduleCycle(true);
        return;
      }

      log(stillPending.length + ' 个接口未更新，' + (retryDelay / 1000) + '秒后重试:', stillPending.join(', '));
      retryTimer = setTimeout(function () {
        runCycleAttempt(boundary, attempt + 1);
      }, retryDelay);
    } catch (e) {
      err('数据拉取失败:', e);
      scheduleCycle();
    } finally {
      if (fetching === myEpoch) fetching = 0;
    }
  }

  function stopLoop() {
    clearTimeout(cycleTimer);  cycleTimer = null;
    clearTimeout(retryTimer);  retryTimer = null;
    if (pathTimer) { clearInterval(pathTimer); pathTimer = null; }
    if (agoTimer)  { clearInterval(agoTimer);  agoTimer = null; }
  }

  async function start() {
    log('脚本启动');
    await syncServerTime();
    ensurePanel();

    var symbol = getCurrentSymbol();
    if (symbol) await initialFetch(symbol);
    scheduleCycle();

    // tab 恢复时：重同步服务器时间 + 立即拉取 + 补抓当前周期
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) {
        syncServerTime();
        var sym = getCurrentSymbol();
        if (sym) {
          initialFetch(sym).then(function () { scheduleCycle(); });
        }
      }
    });

    // 每小时重同步服务器时间，防止长驻页面时钟漂移
    setInterval(syncServerTime, 60 * 60 * 1000);

    // SPA 切换交易对检测
    var lastPath = location.pathname;
    pathTimer = setInterval(function () {
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        var sym = getCurrentSymbol();
        if (sym && sym !== lastSymbol) {
          initialFetch(sym).then(function () { scheduleCycle(); });
        }
      }
    }, 1000);
  }

  // 等待 DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
