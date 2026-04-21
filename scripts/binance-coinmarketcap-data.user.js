// ==UserScript==
// @name         【自写】Binance CoinMarketCap 数据面板
// @namespace    binance.coinmarketcap.data
// @icon         https://avatars.githubusercontent.com/u/5935568?s=128
// @version      0.1.2
// @author       jackhai9
// @description  在 Binance 合约页面显示当前币种的 CoinMarketCap 中文页关键估值与供应量数据
// @match        https://www.binance.com/*/futures/*
// @match        https://www.binance.com/futures/*
// @connect      api.coinmarketcap.com
// @connect      coinmarketcap.com
// @updateURL    https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-coinmarketcap-data.user.js
// @downloadURL  https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-coinmarketcap-data.user.js
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function () {
  'use strict';

  const PANEL_ID = 'jh-binance-cmc-data-panel';
  const STORAGE_POS_KEY = 'jh_binance_cmc_data_pos';
  const STORAGE_COLLAPSED_KEY = 'jh_binance_cmc_data_collapsed';
  const REFRESH_MS = 30 * 1000;
  const SYMBOL_CHECK_MS = 1_500;
  const CMC_BASE = 'https://coinmarketcap.com/zh/currencies/';
  const CMC_DETAIL_API = 'https://api.coinmarketcap.com/data-api/v3/cryptocurrency/detail';

  const SYMBOL_SLUGS = {
    RAVE: 'ravedao',
    BTC: 'bitcoin',
    ETH: 'ethereum',
    BNB: 'bnb',
    SOL: 'solana',
    XRP: 'xrp',
    DOGE: 'dogecoin',
    ADA: 'cardano',
    AVAX: 'avalanche',
    LINK: 'chainlink',
    HYPE: 'hyperliquid',
    PEPE: 'pepe',
    SHIB: 'shiba-inu',
  };

  const C = {
    long: 'var(--color-Buy, #0ecb81)',
    short: 'var(--color-Sell, #f6465d)',
    bg: '#ffffff',
    text: '#1e2329',
    sub: '#5e6673',
    border: '#eaecef',
    accent: '#3861fb',
  };

  let panelClosed = false;
  let lastSymbol = null;
  let lastUpdateTs = 0;
  let refreshTimer = null;
  let symbolTimer = null;
  let inFlightSymbol = null;
  let lastRowsHtml = '';

  function getCurrentSymbol() {
    const match = location.pathname.match(/\/futures\/([A-Z0-9_]+)/i);
    if (match && match[1]) return match[1].toUpperCase();
    const titleMatch = (document.title || '').match(/([A-Z0-9_]{6,})\s+U/i);
    return titleMatch && titleMatch[1] ? titleMatch[1].toUpperCase() : null;
  }

  function baseAssetFromSymbol(symbol) {
    if (!symbol) return null;
    return symbol
      .replace(/USDT$/i, '')
      .replace(/USDC$/i, '')
      .replace(/USD$/i, '')
      .replace(/_PERP$/i, '')
      .toUpperCase();
  }

  function slugForSymbol(symbol) {
    const base = baseAssetFromSymbol(symbol);
    if (!base) return null;
    return SYMBOL_SLUGS[base] || base.toLowerCase();
  }

  function cmcUrlForSymbol(symbol) {
    const slug = slugForSymbol(symbol);
    return slug ? CMC_BASE + slug + '/' : null;
  }

  function formatUsd(value) {
    if (!Number.isFinite(value)) return '--';
    const sign = value < 0 ? '-' : '';
    const abs = Math.abs(value);
    if (abs >= 1e12) return sign + '$' + (abs / 1e12).toFixed(2) + 'T';
    if (abs >= 1e9) return sign + '$' + (abs / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(2) + 'M';
    if (abs >= 1e3) return sign + '$' + (abs / 1e3).toFixed(2) + 'K';
    return sign + '$' + abs.toFixed(4);
  }

  function formatToken(value, symbol) {
    if (!Number.isFinite(value)) return '--';
    const abs = Math.abs(value);
    let formatted;
    if (abs >= 1e12) formatted = (value / 1e12).toFixed(2) + 'T';
    else if (abs >= 1e9) formatted = (value / 1e9).toFixed(2) + 'B';
    else if (abs >= 1e6) formatted = (value / 1e6).toFixed(2) + 'M';
    else if (abs >= 1e3) formatted = (value / 1e3).toFixed(2) + 'K';
    else formatted = value.toFixed(2);
    return symbol ? formatted + ' ' + symbol : formatted;
  }

  function formatPercent(value) {
    if (!Number.isFinite(value)) return '--';
    const sign = value > 0 ? '+' : '';
    return sign + value.toFixed(2) + '%';
  }

  function formatPlainPercent(value) {
    if (!Number.isFinite(value)) return '--';
    return value.toFixed(2) + '%';
  }

  function formatCount(value) {
    if (!Number.isFinite(value)) return '--';
    if (value >= 1e6) return (value / 1e6).toFixed(2) + 'M';
    if (value >= 1e3) return (value / 1e3).toFixed(2) + 'K';
    return String(Math.round(value));
  }

  function numberOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function requestText(url) {
    return new Promise(function (resolve, reject) {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: 20_000,
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
        onload(response) {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error('CMC HTTP ' + response.status));
            return;
          }
          resolve(response.responseText || '');
        },
        onerror() {
          reject(new Error('CMC request failed'));
        },
        ontimeout() {
          reject(new Error('CMC request timeout'));
        },
      });
    });
  }

  function requestJson(url) {
    return new Promise(function (resolve, reject) {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: 20_000,
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
        onload(response) {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error('CMC API HTTP ' + response.status));
            return;
          }
          try {
            resolve(JSON.parse(response.responseText || '{}'));
          } catch (error) {
            reject(new Error('CMC API JSON parse failed'));
          }
        },
        onerror() {
          reject(new Error('CMC API request failed'));
        },
        ontimeout() {
          reject(new Error('CMC API request timeout'));
        },
      });
    });
  }

  function detailApiUrlForSymbol(symbol) {
    const slug = slugForSymbol(symbol);
    if (!slug) return null;
    const params = new URLSearchParams({
      slug,
      convertId: '2781',
      languageCode: 'zh',
      _: String(Date.now()),
    });
    return CMC_DETAIL_API + '?' + params.toString();
  }

  function extractNextData(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const script = doc.getElementById('__NEXT_DATA__');
    if (!script || !script.textContent) {
      throw new Error('CMC page missing __NEXT_DATA__');
    }
    return JSON.parse(script.textContent);
  }

  function collectDetail(nextData) {
    const detail = nextData
      && nextData.props
      && nextData.props.pageProps
      && nextData.props.pageProps.detailRes
      && nextData.props.pageProps.detailRes.detail;
    if (!detail || !detail.statistics) {
      throw new Error('CMC page missing detail statistics');
    }
    return detail;
  }

  function collectApiDetail(payload) {
    const detail = payload && payload.data;
    if (!detail || !detail.statistics) {
      throw new Error('CMC API missing detail statistics');
    }
    return detail;
  }

  function holderDisplayMetric(detail, symbol) {
    const treasuryHoldings = numberOrNull(detail.treasuryHoldings);
    if (detail.showTreasuriesFlag && treasuryHoldings !== null && treasuryHoldings > 0) {
      return {
        label: '金库资产',
        value: formatToken(treasuryHoldings, symbol),
      };
    }

    const holders = detail.holders && typeof detail.holders === 'object'
      ? numberOrNull(detail.holders.holderCount || detail.holders.total || detail.holders.count)
      : null;
    return {
      label: '持有者',
      value: formatCount(holders),
    };
  }

  function formatProfileScore(value) {
    if (value && typeof value === 'object') {
      const percentage = numberOrNull(value.percentage);
      return percentage !== null ? percentage.toFixed(0) + '%' : '--';
    }
    const percentage = numberOrNull(value);
    return percentage !== null ? percentage.toFixed(0) + '%' : '--';
  }

  function buildRows(detail) {
    const stats = detail.statistics || {};
    const symbol = detail.symbol || '';
    const volumeToMarketCap = numberOrNull(stats.turnover) !== null
      ? numberOrNull(stats.turnover) * 100
      : null;
    const liquidityToMarketCap = numberOrNull(stats.liquidityMcapRatio) !== null
      ? numberOrNull(stats.liquidityMcapRatio) * 100
      : null;
    const holderMetric = holderDisplayMetric(detail, symbol);

    return [
      {
        label: '价格',
        value: formatUsd(numberOrNull(stats.price)),
        change: formatPercent(numberOrNull(stats.priceChangePercentage24h)),
        highlight: false,
      },
      {
        label: '流通市值',
        value: formatUsd(numberOrNull(stats.marketCap)),
        change: formatPercent(numberOrNull(stats.marketCapChangePercentage24h)),
        highlight: true,
      },
      {
        label: 'Unlocked Mkt Cap',
        value: formatUsd(numberOrNull(stats.ucm)),
        highlight: false,
      },
      {
        label: '交易量(24h)',
        value: formatUsd(numberOrNull(stats.volume24h)),
        highlight: false,
      },
      {
        label: 'Vol/Mkt Cap(24h)',
        value: formatPlainPercent(volumeToMarketCap),
        highlight: false,
      },
      {
        label: 'FDV/总估值',
        value: formatUsd(numberOrNull(stats.fullyDilutedMarketCap)),
        change: formatPercent(numberOrNull(stats.fullyDilutedMarketCapChangePercentage24h)),
        highlight: true,
      },
      {
        label: 'Liq/Mkt Cap',
        value: formatPlainPercent(liquidityToMarketCap),
        highlight: false,
      },
      {
        label: '总供应量',
        value: formatToken(numberOrNull(stats.totalSupply), symbol),
        highlight: false,
      },
      {
        label: '最大供应量',
        value: formatToken(numberOrNull(stats.maxSupply), symbol),
        highlight: false,
      },
      {
        label: '流通供应量',
        value: formatToken(numberOrNull(stats.circulatingSupply), symbol),
        highlight: false,
      },
      {
        label: holderMetric.label,
        value: holderMetric.value,
        highlight: false,
      },
      {
        label: 'Profile score',
        value: formatProfileScore(detail.profileCompletionScore),
        highlight: false,
      },
    ];
  }

  async function fetchCmcApiData(symbol) {
    const url = detailApiUrlForSymbol(symbol);
    if (!url) throw new Error('无法识别当前合约');
    const payload = await requestJson(url);
    return collectApiDetail(payload);
  }

  async function fetchCmcPageData(symbol) {
    const url = cmcUrlForSymbol(symbol);
    if (!url) throw new Error('无法识别当前合约');
    const html = await requestText(url);
    const nextData = extractNextData(html);
    return collectDetail(nextData);
  }

  async function fetchCmcData(symbol) {
    const url = cmcUrlForSymbol(symbol);
    let detail;
    let source = 'data-api';
    try {
      detail = await fetchCmcApiData(symbol);
    } catch (apiError) {
      detail = await fetchCmcPageData(symbol);
      source = 'page-snapshot';
    }
    return {
      url,
      name: detail.name || '',
      symbol: detail.symbol || baseAssetFromSymbol(symbol),
      rank: detail.statistics && detail.statistics.rank,
      lastUpdated: detail.latestUpdateTime || '',
      source,
      rows: buildRows(detail),
    };
  }

  function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = PANEL_ID;

    const savedPos = loadPosition();
    const collapsed = loadCollapsed();

    Object.assign(panel.style, {
      position: 'fixed',
      top: savedPos ? savedPos.top + 'px' : '360px',
      left: savedPos ? savedPos.left + 'px' : 'auto',
      right: savedPos ? 'auto' : '16px',
      width: '320px',
      zIndex: '999997',
      background: C.bg,
      border: '1px solid ' + C.border,
      borderRadius: '8px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
      fontFamily: 'BinancePlex, system-ui, -apple-system, sans-serif',
      fontSize: '13px',
      color: C.text,
      userSelect: 'none',
      overflow: 'hidden',
    });

    panel.innerHTML = [
      '<div id="', PANEL_ID, '-header" style="',
        'display:flex;align-items:center;justify-content:space-between;',
        'padding:8px 12px;cursor:move;background:#fafafa;border-bottom:1px solid ', C.border, ';',
      '">',
        '<div style="display:flex;align-items:center;gap:6px;min-width:0;">',
          '<span style="font-size:15px;cursor:move;">&#9776;</span>',
          '<span style="font-weight:600;font-size:14px;white-space:nowrap;">CMC 数据</span>',
          '<span id="', PANEL_ID, '-symbol" style="color:', C.sub, ';font-size:13px;overflow:hidden;text-overflow:ellipsis;"></span>',
        '</div>',
        '<div style="display:flex;gap:4px;flex:0 0 auto;">',
          '<button id="', PANEL_ID, '-refresh" title="刷新" style="',
            'background:none;border:none;cursor:pointer;font-size:14px;color:', C.sub, ';padding:0 4px;line-height:1;',
          '">&#8635;</button>',
          '<button id="', PANEL_ID, '-collapse" title="折叠/展开" style="',
            'background:none;border:none;cursor:pointer;font-size:15px;color:', C.sub, ';padding:0 4px;line-height:1;',
          '">', collapsed ? '&#9633;' : '&#95;', '</button>',
          '<button id="', PANEL_ID, '-close" title="关闭" style="',
            'background:none;border:none;cursor:pointer;font-size:15px;color:', C.sub, ';padding:0 4px;line-height:1;',
          '">&times;</button>',
        '</div>',
      '</div>',
      '<div id="', PANEL_ID, '-body" style="display:', collapsed ? 'none' : 'block', ';">',
        '<div id="', PANEL_ID, '-rows" style="padding:8px 12px;"></div>',
        '<div id="', PANEL_ID, '-footer" style="padding:6px 12px;color:', C.sub, ';font-size:12px;border-top:1px solid ', C.border, ';"></div>',
      '</div>',
    ].join('');

    document.body.appendChild(panel);
    setupDrag(panel);
    setupControls(panel);
    return panel;
  }

  function renderLoading(symbol) {
    const panel = ensurePanel();
    const symbolEl = panel.querySelector('#' + PANEL_ID + '-symbol');
    const rowsEl = panel.querySelector('#' + PANEL_ID + '-rows');
    const footerEl = panel.querySelector('#' + PANEL_ID + '-footer');
    if (symbolEl) symbolEl.textContent = symbol || '';
    if (rowsEl) rowsEl.innerHTML = '<div style="color:' + C.sub + ';padding:6px 0;">正在读取 CoinMarketCap...</div>';
    if (footerEl) footerEl.textContent = '';
  }

  function renderError(symbol, message) {
    const panel = ensurePanel();
    const symbolEl = panel.querySelector('#' + PANEL_ID + '-symbol');
    const rowsEl = panel.querySelector('#' + PANEL_ID + '-rows');
    const footerEl = panel.querySelector('#' + PANEL_ID + '-footer');
    if (symbolEl) symbolEl.textContent = symbol || '';
    if (rowsEl) {
      lastRowsHtml = [
        '<div style="color:', C.short, ';font-weight:600;padding:4px 0;">读取失败</div>',
        '<div style="color:', C.sub, ';font-size:12px;line-height:1.4;">', escapeHtml(message), '</div>',
      ].join('');
      rowsEl.innerHTML = lastRowsHtml;
    }
    if (footerEl) footerEl.textContent = '来源：CoinMarketCap 中文页';
  }

  function renderData(symbol, data) {
    const panel = ensurePanel();
    const symbolEl = panel.querySelector('#' + PANEL_ID + '-symbol');
    const rowsEl = panel.querySelector('#' + PANEL_ID + '-rows');
    const footerEl = panel.querySelector('#' + PANEL_ID + '-footer');
    if (symbolEl) {
      const rank = Number.isFinite(Number(data.rank)) ? ' #' + data.rank : '';
      symbolEl.textContent = (data.symbol || symbol || '') + rank;
    }
    if (rowsEl) {
      lastRowsHtml = data.rows.map(function (row) {
        const change = row.change && row.change !== '--'
          ? '<span style="margin-left:6px;color:' + (row.change.startsWith('-') ? C.short : C.long) + ';">' + escapeHtml(row.change) + '</span>'
          : '';
        const cardStyle = row.highlight
          ? 'background:linear-gradient(180deg, rgba(56,97,251,.055), rgba(22,199,132,.045));box-shadow:inset 0 0 0 1.5px rgba(56,97,251,.62);border-radius:6px;padding:5px 6px;margin:2px -6px;'
          : 'padding:4px 0;';
        return [
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;', cardStyle, '">',
            '<span style="color:', C.sub, ';white-space:nowrap;">', escapeHtml(row.label), '</span>',
            '<span style="font-weight:600;font-variant-numeric:tabular-nums;text-align:right;">',
              escapeHtml(row.value), change,
            '</span>',
          '</div>',
        ].join('');
      }).join('');
      rowsEl.innerHTML = lastRowsHtml;
    }
    if (footerEl) {
      lastUpdateTs = Date.now();
      const cmcClock = data.lastUpdated ? formatClock(Date.parse(data.lastUpdated)) : '--';
      const sourceLabel = data.source === 'page-snapshot' ? 'CMC 页面快照' : 'CMC data-api';
      footerEl.innerHTML = [
        '<div style="display:flex;justify-content:space-between;gap:8px;">',
          '<a href="', data.url, '" target="_blank" style="color:', C.accent, ';text-decoration:none;">', sourceLabel, '</a>',
          '<span>CMC ', cmcClock, ' / 拉取 ', formatClock(lastUpdateTs), '</span>',
        '</div>',
      ].join('');
    }
  }

  async function refreshForCurrentSymbol(force, silent) {
    if (panelClosed || document.hidden) return;
    const symbol = getCurrentSymbol();
    if (!symbol) return;
    if (!force && symbol === inFlightSymbol) return;

    inFlightSymbol = symbol;
    if (!silent || !lastRowsHtml) renderLoading(symbol);
    try {
      const data = await fetchCmcData(symbol);
      if (getCurrentSymbol() !== symbol || panelClosed) return;
      renderData(symbol, data);
      lastSymbol = symbol;
    } catch (error) {
      if (getCurrentSymbol() !== symbol || panelClosed) return;
      renderError(symbol, error && error.message ? error.message : String(error));
    } finally {
      if (inFlightSymbol === symbol) inFlightSymbol = null;
    }
  }

  function startLoop() {
    ensurePanel();
    refreshForCurrentSymbol(true, false);
    refreshTimer = setInterval(function () {
      refreshForCurrentSymbol(false, true);
    }, REFRESH_MS);
    symbolTimer = setInterval(function () {
      const symbol = getCurrentSymbol();
      if (symbol && symbol !== lastSymbol && symbol !== inFlightSymbol) {
        lastRowsHtml = '';
        refreshForCurrentSymbol(true, false);
      }
    }, SYMBOL_CHECK_MS);
  }

  function stopLoop() {
    if (refreshTimer) clearInterval(refreshTimer);
    if (symbolTimer) clearInterval(symbolTimer);
    refreshTimer = null;
    symbolTimer = null;
  }

  function setupDrag(panel) {
    const header = panel.querySelector('#' + PANEL_ID + '-header');
    if (!header) return;

    let dragging = false;
    let startX;
    let startY;
    let startLeft;
    let startTop;

    header.addEventListener('mousedown', function (event) {
      const target = event.target;
      if (target && target.closest && target.closest('button,a')) return;
      dragging = true;
      const rect = panel.getBoundingClientRect();
      startX = event.clientX;
      startY = event.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      event.preventDefault();
    });

    document.addEventListener('mousemove', function (event) {
      if (!dragging) return;
      const newLeft = Math.max(0, Math.min(startLeft + event.clientX - startX, window.innerWidth - panel.offsetWidth));
      const newTop = Math.max(0, Math.min(startTop + event.clientY - startY, window.innerHeight - panel.offsetHeight));
      panel.style.left = newLeft + 'px';
      panel.style.top = newTop + 'px';
      panel.style.right = 'auto';
    });

    document.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;
      savePosition(parseInt(panel.style.left, 10), parseInt(panel.style.top, 10));
    });
  }

  function setupControls(panel) {
    const refreshBtn = panel.querySelector('#' + PANEL_ID + '-refresh');
    const collapseBtn = panel.querySelector('#' + PANEL_ID + '-collapse');
    const closeBtn = panel.querySelector('#' + PANEL_ID + '-close');
    const body = panel.querySelector('#' + PANEL_ID + '-body');

    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () {
        refreshForCurrentSymbol(true, false);
      });
    }
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
        panelClosed = true;
        stopLoop();
      });
    }
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
    return localStorage.getItem(STORAGE_COLLAPSED_KEY) === '1';
  }

  function saveCollapsed(collapsed) {
    localStorage.setItem(STORAGE_COLLAPSED_KEY, collapsed ? '1' : '0');
  }

  function formatClock(timestamp) {
    if (!Number.isFinite(timestamp)) return '--';
    const date = new Date(timestamp);
    return [
      String(date.getHours()).padStart(2, '0'),
      String(date.getMinutes()).padStart(2, '0'),
      String(date.getSeconds()).padStart(2, '0'),
    ].join(':');
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      stopLoop();
      return;
    }
    if (!panelClosed && !refreshTimer) startLoop();
  });

  startLoop();
})();
