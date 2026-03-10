// ==UserScript==
// @name         【自写】Binance 合约交易数据面板
// @namespace    binance.trading.data
// @icon         https://avatars.githubusercontent.com/u/5935568?s=128
// @version      1.0.0
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

  const REFRESH_INTERVAL = 60_000;
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
  };

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
    const resp = await fetch(url.toString());
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
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

  async function fetchAllData(symbol) {
    const keys = ['openInterest', 'topAccountRatio', 'topPositionRatio', 'globalAccountRatio', 'takerRatio', 'basis', 'fundingRate'];
    const fetchers = [
      fetchOpenInterest(symbol),
      fetchTopAccountRatio(symbol),
      fetchTopPositionRatio(symbol),
      fetchGlobalAccountRatio(symbol),
      fetchTakerRatio(symbol),
      fetchBasis(symbol),
      fetchFundingRate(symbol),
    ];
    const results = await Promise.allSettled(fetchers);
    const data = {};
    keys.forEach((key, i) => {
      if (results[i].status === 'fulfilled') {
        data[key] = results[i].value;
      } else {
        data[key] = null;
        err(`${key} 请求失败:`, results[i].reason?.message || results[i].reason);
      }
    });
    return data;
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

  function computeSignals(data) {
    const oi = parseOpenInterest(data.openInterest);
    const topAccount = parseRatio(data.topAccountRatio, 'longShortRatio');
    const topPosition = parseRatio(data.topPositionRatio, 'longShortRatio');
    const globalAccount = parseRatio(data.globalAccountRatio, 'longShortRatio');
    const taker = parseRatio(data.takerRatio, 'buySellRatio');
    const basis = parseBasis(data.basis);
    const funding = parseFundingRate(data.fundingRate);

    const indicators = [
      { name: '合约持仓量',     signal: signalOpenInterest(oi),     display: fmtOI(oi),            vote: true },
      { name: '大户账户多空比', signal: signalRatio(topAccount),     display: fmtRatio(topAccount),  vote: true },
      { name: '大户持仓多空比', signal: signalRatio(topPosition),    display: fmtRatio(topPosition), vote: true },
      { name: '多空账户数比',   signal: signalRatio(globalAccount),  display: fmtRatio(globalAccount),vote: true },
      { name: '主动买卖比',     signal: signalRatio(taker),          display: fmtRatio(taker),       vote: true },
      { name: '基差',           signal: signalBasis(basis),          display: fmtBasis(basis),       vote: true },
      { name: '资金费率',       signal: signalFundingRate(funding),  display: fmtFunding(funding),   vote: true },
      { name: '持仓量趋势',     signal: signalOpenInterest(oi),      display: fmtTrend(oi),          vote: false },
    ];

    const voters = indicators.filter(i => i.vote);
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

  function fmtTrend(parsed) {
    if (!parsed || !parsed.trend) return '--';
    if (parsed.trend === 'up') return '▲ 上升';
    if (parsed.trend === 'down') return '▼ 下降';
    return '— 持平';
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
      '  50% { background: rgba(254, 220, 86, 0.25); }',
      '}',
      '.jh-td-flash { animation: jh-td-flash 1s ease-in-out 3; }',
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
      fontSize:     '12px',
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
          '<span style="font-size:14px;cursor:move;">&#9776;</span>',
          '<span style="font-weight:600;font-size:13px;">交易数据</span>',
          '<span id="', PANEL_ID, '-symbol" style="color:', C.sub, ';font-size:12px;"></span>',
        '</div>',
        '<div style="display:flex;gap:4px;">',
          '<button id="', PANEL_ID, '-collapse" title="折叠/展开" style="',
            'background:none;border:none;cursor:pointer;font-size:14px;',
            'color:', C.sub, ';padding:0 4px;line-height:1;',
          '">', collapsed ? '&#9633;' : '&#95;', '</button>',
          '<button id="', PANEL_ID, '-close" title="关闭" style="',
            'background:none;border:none;cursor:pointer;font-size:14px;',
            'color:', C.sub, ';padding:0 4px;line-height:1;',
          '">&times;</button>',
        '</div>',
      '</div>',
      // --- body ---
      '<div id="', PANEL_ID, '-body" style="display:', collapsed ? 'none' : 'block', ';">',
        '<div id="', PANEL_ID, '-rows" style="padding:8px 12px;"></div>',
        '<div id="', PANEL_ID, '-composite" style="padding:8px 12px;border-top:1px solid ', C.border, ';"></div>',
        '<div id="', PANEL_ID, '-footer" style="padding:6px 12px;color:', C.sub, ';font-size:11px;border-top:1px solid ', C.border, ';"></div>',
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
        const flashClass = changed[ind.name] ? ' jh-td-flash' : '';
        return [
          '<div class="', flashClass, '" style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-radius:4px;">',
            '<span style="color:', C.sub, ';min-width:90px;">', ind.name, '</span>',
            '<span style="font-weight:500;font-variant-numeric:tabular-nums;flex:1;text-align:right;margin-right:8px;color:', valColor, ';">', ind.display, '</span>',
            '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:', dotColor, ';"></span>',
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
      const biasCount = neutral ? longCount : biasLong ? longCount : shortCount;
      const biasColor = neutral ? C.neutral : biasLong ? C.long : C.short;
      const pct = Math.round((neutral ? 50 : biasLong ? longCount : shortCount) / (neutral ? 1 : total) * 100);

      compositeEl.innerHTML = [
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">',
          '<span style="font-weight:600;">复合信号</span>',
          '<span style="color:', biasColor, ';font-weight:600;">', biasLabel, ' ', neutral ? longCount + ':' + shortCount : biasCount + '/' + total, '</span>',
        '</div>',
        '<div style="height:6px;background:', C.border, ';border-radius:3px;overflow:hidden;">',
          '<div style="height:100%;width:', pct, '%;border-radius:3px;background:', biasColor, ';"></div>',
        '</div>',
        '<div style="display:flex;justify-content:space-between;margin-top:3px;font-size:11px;color:', C.sub, ';">',
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
    el.textContent = '更新于 ' + hh + ':' + mm + ':' + ss + '  ' + ago + '秒前';
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

  let tickTimer = null;
  let pathTimer = null;
  let agoTimer = null;
  let lastUpdateTs = 0;
  let fetching = false;

  async function tick() {
    if (document.hidden) return;
    if (fetching) return;

    const symbol = getCurrentSymbol();
    if (!symbol) return;

    if (symbol !== lastSymbol) {
      lastSymbol = symbol;
      prevDisplayValues = {};
      log('交易对:', symbol);
    }

    fetching = true;
    try {
      const data = await fetchAllData(symbol);
      const result = computeSignals(data);
      renderPanel(result);
      log('数据更新完成');
    } catch (e) {
      err('数据拉取失败:', e);
    } finally {
      fetching = false;
    }
  }

  function stopLoop() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    if (pathTimer) { clearInterval(pathTimer); pathTimer = null; }
    if (agoTimer)  { clearInterval(agoTimer);  agoTimer = null; }
  }

  function start() {
    log('脚本启动');
    ensurePanel();
    tick();
    tickTimer = setInterval(tick, REFRESH_INTERVAL);

    // tab 隐藏时暂停，恢复时立即刷新
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && tickTimer) tick();
    });

    // SPA 切换交易对检测
    let lastPath = location.pathname;
    pathTimer = setInterval(function () {
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        tick();
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
