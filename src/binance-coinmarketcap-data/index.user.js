// ==UserScript==
// @name         【自写】Binance CoinMarketCap 数据面板
// @namespace    binance.coinmarketcap.data
// @icon         data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2064%2064%22%3E%3Crect%20width=%2264%22%20height=%2264%22%20rx=%2214%22%20fill=%22%23f0b90b%22/%3E%3Cpath%20d=%22M18%2018h28v8H34v20h-8V26h-8z%22%20fill=%22%231e2329%22/%3E%3C/svg%3E
// @icon64       data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2064%2064%22%3E%3Crect%20width=%2264%22%20height=%2264%22%20rx=%2214%22%20fill=%22%23f0b90b%22/%3E%3Cpath%20d=%22M18%2018h28v8H34v20h-8V26h-8z%22%20fill=%22%231e2329%22/%3E%3C/svg%3E
// @version      0.1.11
// @author       jackhai9
// @description  在 Binance 合约页面显示当前币种的 CoinMarketCap 中文页关键估值与供应量数据
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

import {
  isFuturesTradingPathname,
  parseFuturesTradingSymbolFromPathname,
} from '../shared/binance-futures-route.js';

(function () {
  'use strict';

  function isFuturesTradingPage() {
    return isFuturesTradingPathname(location.pathname);
  }

  if (!isFuturesTradingPage()) return;

  const PANEL_ID = 'jh-binance-cmc-data-panel';
  const STORAGE_POS_KEY = 'jh_binance_cmc_data_pos';
  const STORAGE_COLLAPSED_KEY = 'jh_binance_cmc_data_collapsed';
  const PANEL_WIDTH = 240;
  const REFRESH_MS = 30 * 1000;
  const SYMBOL_CHECK_MS = 1_500;
  const CMC_BASE = 'https://coinmarketcap.com/zh/currencies/';
  const CMC_MAP_API = 'https://api.coinmarketcap.com/data-api/v1/cryptocurrency/map';
  const CMC_DETAIL_API = 'https://api.coinmarketcap.com/data-api/v3/cryptocurrency/detail';
  const CMC_HOLDER_API = 'https://dapi.coinmarketcap.com/dex-stats/v3/dexer/crypto-holder/show_holders';

  const ASSET_OVERRIDES = {
    RAVE: { id: 38967, symbol: 'RAVE', slug: 'ravedao' },
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
  let routeTimer = null;
  let dragCleanup = null;
  let unloadCleanup = null;
  let inFlightSymbol = null;
  let lastRowsHtml = '';
  let lastPath = location.pathname;
  const assetCache = Object.create(null);

  function getCurrentSymbol() {
    return parseFuturesTradingSymbolFromPathname(location.pathname);
  }

  function baseAssetFromSymbol(symbol) {
    if (!symbol) return null;
    return symbol
      .replace(/_PERP$/i, '')
      .replace(/USDT$/i, '')
      .replace(/USDC$/i, '')
      .replace(/USD$/i, '')
      .toUpperCase();
  }

  function cmcSymbolFromBaseAsset(baseAsset) {
    if (!baseAsset) return null;
    return baseAsset.replace(/^(1000000|1000)(?=[A-Z])/, '');
  }

  function normalizeCmcAsset(rawAsset, fallbackBaseAsset) {
    if (!rawAsset || typeof rawAsset !== 'object') return null;
    const id = numberOrNull(rawAsset.id);
    const symbol = typeof rawAsset.symbol === 'string' ? rawAsset.symbol.trim().toUpperCase() : '';
    const slug = typeof rawAsset.slug === 'string' ? rawAsset.slug.trim() : '';
    if (id === null || !symbol || !slug) return null;
    return {
      id,
      symbol,
      slug,
      baseAsset: fallbackBaseAsset || symbol,
    };
  }

  function mapApiUrlForBaseAsset(baseAsset) {
    const cmcSymbol = cmcSymbolFromBaseAsset(baseAsset);
    if (!cmcSymbol) return null;
    const params = new URLSearchParams({
      symbol: cmcSymbol,
      listing_status: 'active',
      _: String(Date.now()),
    });
    return CMC_MAP_API + '?' + params.toString();
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
    const matches = Array.isArray(payload && payload.data)
      ? payload.data.filter(function (row) {
        return row
          && row.is_active === 1
          && String(row.symbol || '').trim().toUpperCase() === cmcSymbol;
      })
      : [];
    if (matches.length !== 1) {
      throw new Error(
        matches.length > 1
          ? 'CMC symbol ambiguous: ' + cmcSymbol
          : 'CMC symbol not found: ' + cmcSymbol
      );
    }
    assetCache[base] = normalizeCmcAsset(matches[0], base);
    return assetCache[base];
  }

  function cmcUrlForAsset(asset) {
    return asset && asset.slug ? CMC_BASE + asset.slug + '/' : null;
  }

  function formatUsd(value) {
    if (!Number.isFinite(value)) return '--';
    const sign = value < 0 ? '-' : '';
    const abs = Math.abs(value);
    if (abs >= 1e12) return sign + '$' + formatCompactNumber(abs / 1e12, 4) + '万亿';
    if (abs >= 1e8) return sign + '$' + formatCompactNumber(abs / 1e8, 4) + '亿';
    if (abs >= 1e4) return sign + '$' + formatCompactNumber(abs / 1e4, 4) + '万';
    return sign + '$' + formatCompactNumber(abs, 4);
  }

  function formatToken(value, symbol) {
    if (!Number.isFinite(value)) return '--';
    const sign = value < 0 ? '-' : '';
    const abs = Math.abs(value);
    let formatted;
    if (abs >= 1e12) formatted = sign + formatCompactNumber(abs / 1e12, 4) + '万亿';
    else if (abs >= 1e8) formatted = sign + formatCompactNumber(abs / 1e8, 4) + '亿';
    else if (abs >= 1e4) formatted = sign + formatCompactNumber(abs / 1e4, 4) + '万';
    else formatted = sign + formatCompactNumber(abs, 4);
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
    return formatToken(value, '');
  }

  function formatCompactNumber(value, maxDecimals) {
    if (!Number.isFinite(value)) return '--';
    return value.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: maxDecimals,
      useGrouping: false,
    });
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

  function detailApiUrlForAsset(asset) {
    if (!asset) return null;
    const params = new URLSearchParams({
      id: String(asset.id),
      convertId: '2781',
      languageCode: 'zh',
      _: String(Date.now()),
    });
    return CMC_DETAIL_API + '?' + params.toString();
  }

  function holderApiUrlForCryptoId(cryptoId) {
    const id = numberOrNull(cryptoId);
    if (id === null) return null;
    const params = new URLSearchParams({
      cryptoId: String(id),
      _: String(Date.now()),
    });
    return CMC_HOLDER_API + '?' + params.toString();
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

    const holdersFromPageMetric = numberOrNull(detail.cmcHolderCount);
    const holders = holdersFromPageMetric !== null
      ? holdersFromPageMetric
      : (
        detail.holders && typeof detail.holders === 'object'
          ? numberOrNull(detail.holders.holderCount || detail.holders.total || detail.holders.count)
          : null
      );
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

  async function fetchCmcApiData(asset) {
    const url = detailApiUrlForAsset(asset);
    if (!url) throw new Error('无法识别当前合约');
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
    if (!url) throw new Error('无法识别当前合约');
    const html = await requestText(url);
    const nextData = extractNextData(html);
    return collectDetail(nextData);
  }

  async function fetchCmcData(symbol) {
    const asset = await resolveCmcAsset(symbol);
    const url = cmcUrlForAsset(asset);
    let detail;
    let source = 'data-api';
    try {
      detail = await fetchCmcApiData(asset);
    } catch (apiError) {
      detail = await fetchCmcPageData(asset);
      source = 'page-snapshot';
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
      name: detail.name || '',
      symbol: detail.symbol || (asset && asset.symbol) || baseAssetFromSymbol(symbol),
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

    const savedPos = normalizeSavedPosition(loadPosition(), PANEL_WIDTH);
    const collapsed = loadCollapsed();

    Object.assign(panel.style, {
      position: 'fixed',
      top: savedPos ? savedPos.top + 'px' : '360px',
      left: savedPos ? savedPos.left + 'px' : 'auto',
      right: savedPos ? 'auto' : '16px',
      width: PANEL_WIDTH + 'px',
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
        'padding:8px 10px;cursor:move;background:#fafafa;border-bottom:1px solid ', C.border, ';',
      '">',
        '<div style="display:flex;align-items:center;gap:5px;min-width:0;">',
          '<span style="font-size:15px;cursor:move;">&#9776;</span>',
          '<span style="font-weight:600;font-size:14px;white-space:nowrap;">CMC 数据</span>',
          '<span id="', PANEL_ID, '-symbol" style="color:', C.sub, ';font-size:13px;overflow:hidden;text-overflow:ellipsis;"></span>',
        '</div>',
        '<div style="display:flex;gap:2px;flex:0 0 auto;">',
          '<button id="', PANEL_ID, '-refresh" title="刷新" style="',
            'background:none;border:none;cursor:pointer;font-size:14px;color:', C.sub, ';padding:0 3px;line-height:1;',
          '">&#8635;</button>',
          '<button id="', PANEL_ID, '-collapse" title="折叠/展开" style="',
            'background:none;border:none;cursor:pointer;font-size:15px;color:', C.sub, ';padding:0 3px;line-height:1;',
          '">', collapsed ? '&#9633;' : '&#95;', '</button>',
          '<button id="', PANEL_ID, '-close" title="关闭" style="',
            'background:none;border:none;cursor:pointer;font-size:15px;color:', C.sub, ';padding:0 3px;line-height:1;',
          '">&times;</button>',
        '</div>',
      '</div>',
      '<div id="', PANEL_ID, '-body" style="display:', collapsed ? 'none' : 'block', ';">',
        '<div id="', PANEL_ID, '-rows" style="padding:8px 10px;"></div>',
        '<div id="', PANEL_ID, '-footer" style="padding:6px 10px;color:', C.sub, ';font-size:12px;border-top:1px solid ', C.border, ';"></div>',
      '</div>',
    ].join('');

    document.body.appendChild(panel);
    keepPanelInViewport(panel);
    savePanelPosition(panel);
    cleanupPanelDrag();
    dragCleanup = setupDrag(panel);
    setupControls(panel);
    cleanupPanelUnload();
    const onBeforeUnload = function () {
      savePanelPosition(panel);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    unloadCleanup = function cleanupUnload() {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
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
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;', cardStyle, '">',
            '<span style="color:', C.sub, ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;">', escapeHtml(row.label), '</span>',
            '<span style="font-weight:600;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap;flex:0 0 auto;">',
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
        '<div style="display:flex;justify-content:space-between;gap:6px;align-items:center;">',
          '<a href="', escapeHtml(data.url), '" target="_blank" style="color:', C.accent, ';text-decoration:none;">', sourceLabel, '</a>',
          '<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right;">CMC ', cmcClock, ' / 拉取 ', formatClock(lastUpdateTs), '</span>',
        '</div>',
      ].join('');
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

  function startDataLoop() {
    if (panelClosed || document.hidden || !isFuturesTradingPage()) return;
    ensurePanel();
    refreshForCurrentSymbol(true, false);
    if (!refreshTimer) {
      refreshTimer = setInterval(function () {
        refreshForCurrentSymbol(false, true);
      }, REFRESH_MS);
    }
    if (!symbolTimer) {
      symbolTimer = setInterval(function () {
        if (!isFuturesTradingPage()) {
          pauseForNonTradingPage();
          return;
        }
        const symbol = getCurrentSymbol();
        if (symbol && symbol !== lastSymbol && symbol !== inFlightSymbol) {
          lastRowsHtml = '';
          refreshForCurrentSymbol(true, false);
        }
      }, SYMBOL_CHECK_MS);
    }
  }

  function stopDataLoop() {
    if (refreshTimer) clearInterval(refreshTimer);
    if (symbolTimer) clearInterval(symbolTimer);
    refreshTimer = null;
    symbolTimer = null;
  }

  function stopRouteWatcher() {
    if (routeTimer) clearInterval(routeTimer);
    routeTimer = null;
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

  function cleanupPanelUnload() {
    if (!unloadCleanup) return;
    unloadCleanup();
    unloadCleanup = null;
  }

  function removePanel() {
    cleanupPanelDrag();
    cleanupPanelUnload();
    const panel = document.getElementById(PANEL_ID);
    if (panel) panel.remove();
    lastRowsHtml = '';
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
    if (routeTimer || document.hidden || panelClosed) return;
    lastPath = location.pathname;
    routeTimer = setInterval(handleRouteChange, SYMBOL_CHECK_MS);
  }

  function setupDrag(panel) {
    const header = panel.querySelector('#' + PANEL_ID + '-header');
    if (!header) return null;

    let dragging = false;
    let startX;
    let startY;
    let startLeft;
    let startTop;
    let saveQueued = false;
    const queuePositionSave = function () {
      if (saveQueued) return;
      saveQueued = true;
      window.requestAnimationFrame(function () {
        saveQueued = false;
        savePanelPosition(panel);
      });
    };

    const onMouseDown = function (event) {
      const target = event.target;
      if (target && target.closest && target.closest('button,a')) return;
      dragging = true;
      const rect = panel.getBoundingClientRect();
      startX = event.clientX;
      startY = event.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      event.preventDefault();
    };

    const onMouseMove = function (event) {
      if (!dragging) return;
      const newLeft = Math.max(0, Math.min(startLeft + event.clientX - startX, window.innerWidth - panel.offsetWidth));
      const newTop = Math.max(0, Math.min(startTop + event.clientY - startY, window.innerHeight - panel.offsetHeight));
      panel.style.left = newLeft + 'px';
      panel.style.top = newTop + 'px';
      panel.style.right = 'auto';
      queuePositionSave();
    };

    const onMouseUp = function () {
      if (!dragging) return;
      dragging = false;
      savePanelPosition(panel);
    };

    header.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    return function cleanupDrag() {
      dragging = false;
      header.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
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

  function clampNumber(value, min, max) {
    return Math.max(min, Math.min(value, max));
  }

  function normalizeSavedPosition(pos, panelWidth) {
    if (!pos || !Number.isFinite(pos.left) || !Number.isFinite(pos.top)) return null;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || panelWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 80;
    return {
      left: clampNumber(pos.left, 0, Math.max(0, viewportWidth - panelWidth)),
      top: clampNumber(pos.top, 0, Math.max(0, viewportHeight - 48)),
    };
  }

  function keepPanelInViewport(panel) {
    const rect = panel.getBoundingClientRect();
    const normalized = normalizeSavedPosition({ left: rect.left, top: rect.top }, panel.offsetWidth || PANEL_WIDTH);
    if (!normalized) return;
    panel.style.left = normalized.left + 'px';
    panel.style.top = normalized.top + 'px';
    panel.style.right = 'auto';
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
    if (panelClosed) return;
    startRouteWatcher();
    if (isFuturesTradingPage()) startDataLoop();
    else pauseForNonTradingPage();
  });

  window.addEventListener('resize', function () {
    const panel = document.getElementById(PANEL_ID);
    if (panel) keepPanelInViewport(panel);
  });

  startRouteWatcher();
  startDataLoop();
})();
