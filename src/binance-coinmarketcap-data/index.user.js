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

import {
  isFuturesTradingPathname,
  parseFuturesTradingSymbolFromPathname,
} from '../shared/binance-futures-route.js';
import {
  ensureSpaRouteChangePatched,
  installSpaRouteChangeListener,
} from '../shared/spa-route-change.js';
import { buildCmcMetricRows, numberOrNull } from './metrics.js';
import { CMC_COPY, formatLocalizedText, resolveUiLocaleFromPathname } from './ui-copy.js';
import { cmcPanelStyles } from './panel-styles.js';
import { calculateDataPanelLayout, DATA_PANEL_LAYOUT_EVENT, DATA_PANEL_WIDTH as PANEL_WIDTH, hasVisibleDataPanelPeer } from '../shared/data-panel-layout.js';

(function () {
  'use strict';

  function isFuturesTradingPage() {
    return isFuturesTradingPathname(location.pathname);
  }

  const PANEL_ID = 'jh-binance-cmc-data-panel';
  const STORAGE_POS_KEY = 'jh_binance_cmc_data_pos';
  const STORAGE_COLLAPSED_KEY = 'jh_binance_cmc_data_collapsed';
  const REFRESH_MS = 30 * 1000;
  const ROUTE_WATCHDOG_MS = 5_000;
  const CMC_MAP_API = 'https://api.coinmarketcap.com/data-api/v1/cryptocurrency/map';
  const CMC_DETAIL_API = 'https://api.coinmarketcap.com/data-api/v3/cryptocurrency/detail';
  const CMC_HOLDER_API = 'https://dapi.coinmarketcap.com/dex-stats/v3/dexer/crypto-holder/show_holders';

  const ASSET_OVERRIDES = {
    RAVE: { id: 38967, symbol: 'RAVE', slug: 'ravedao' },
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
  let lastRowsHtml = '';
  let lastPath = location.pathname;
  let expandedMetricId = null;
  const assetCache = Object.create(null);

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
    return symbol
      .replace(/_PERP$/i, '')
      .replace(/USDT$/i, '')
      .replace(/USDC$/i, '')
      .replace(/USD$/i, '')
      .toUpperCase();
  }

  function cmcSymbolFromBaseAsset(baseAsset) {
    if (!baseAsset) return null;
    return baseAsset.replace(/^(1000000|1000)(?=\p{L})/u, '');
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
    const localePrefix = resolveUiLocaleFromPathname(location.pathname) === 'zh-CN' ? 'zh/' : '';
    return asset && asset.slug ? 'https://coinmarketcap.com/' + localePrefix + 'currencies/' + asset.slug + '/' : null;
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
      rows: buildCmcMetricRows(detail, resolveUiLocaleFromPathname(location.pathname)),
    };
  }

  function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) {
      updatePanelLanguage(panel);
      return panel;
    }

    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.width = PANEL_WIDTH + 'px';
    const collapsed = loadCollapsed();
    panel.innerHTML = [
      '<style>', cmcPanelStyles(PANEL_ID), '</style>',
      '<div id="', PANEL_ID, '-header">',
        '<div class="cmc-heading">',
          '<span aria-hidden="true">&#9776;</span>',
          '<span class="cmc-title" data-copy="title"></span>',
          '<span id="', PANEL_ID, '-symbol"></span>',
        '</div>',
        '<div class="cmc-controls">',
          '<button type="button" id="', PANEL_ID, '-refresh">&#8635;</button>',
          '<button type="button" id="', PANEL_ID, '-collapse" aria-controls="', PANEL_ID, '-body">', collapsed ? '&#9633;' : '&#95;', '</button>',
          '<button type="button" id="', PANEL_ID, '-close">&times;</button>',
        '</div>',
      '</div>',
      '<div id="', PANEL_ID, '-body" style="display:', collapsed ? 'none' : 'block', ';">',
        '<table>',
          '<colgroup><col class="cmc-name-col"><col class="cmc-value-col"><col class="cmc-reading-col"></colgroup>',
          '<thead><tr><th scope="col" data-copy="metric"></th><th scope="col" data-copy="value"></th><th scope="col" data-copy="interpretation"></th></tr></thead>',
          '<tbody id="', PANEL_ID, '-rows"></tbody>',
        '</table>',
        '<div id="', PANEL_ID, '-footer"></div>',
      '</div>',
    ].join('');
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
    panel.setAttribute('aria-label', uiText(CMC_COPY.title));
    panel.querySelector('table').setAttribute('aria-label', uiText(CMC_COPY.title));
    panel.querySelectorAll('[data-copy]').forEach(function (element) {
      element.textContent = uiText(CMC_COPY[element.dataset.copy]);
    });
    const collapsed = panel.querySelector('#' + PANEL_ID + '-body').style.display === 'none';
    for (const [suffix, copy] of [
      ['refresh', CMC_COPY.refresh],
      ['collapse', collapsed ? CMC_COPY.expand : CMC_COPY.collapse],
      ['close', CMC_COPY.close],
    ]) {
      const button = panel.querySelector('#' + PANEL_ID + '-' + suffix);
      button.title = uiText(copy);
      button.setAttribute('aria-label', uiText(copy));
    }
    panel.querySelector('#' + PANEL_ID + '-collapse').setAttribute('aria-expanded', String(!collapsed));
  }

  function renderLoading(symbol) {
    const panel = ensurePanel();
    const symbolEl = panel.querySelector('#' + PANEL_ID + '-symbol');
    const rowsEl = panel.querySelector('#' + PANEL_ID + '-rows');
    const footerEl = panel.querySelector('#' + PANEL_ID + '-footer');
    if (symbolEl) symbolEl.textContent = symbol || '';
    if (rowsEl) rowsEl.innerHTML = '<tr><td colspan="3"><div class="cmc-status" role="status">' + escapeHtml(uiText(CMC_COPY.loading)) + '</div></td></tr>';
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
        '<tr><td colspan="3"><div class="cmc-status" role="status">',
          '<div class="cmc-error-title">', escapeHtml(uiText(CMC_COPY.failed)), '</div>',
          '<div>', escapeHtml(message), '</div>',
        '</div></td></tr>',
      ].join('');
      rowsEl.innerHTML = lastRowsHtml;
    }
    if (footerEl) footerEl.textContent = uiText(CMC_COPY.source);
  }

  function renderData(symbol, data) {
    const panel = ensurePanel();
    const symbolEl = panel.querySelector('#' + PANEL_ID + '-symbol');
    const rowsEl = panel.querySelector('#' + PANEL_ID + '-rows');
    const footerEl = panel.querySelector('#' + PANEL_ID + '-footer');
    if (symbolEl) {
      const rank = numberOrNull(data.rank) !== null ? ' #' + data.rank : '';
      symbolEl.textContent = (data.symbol || symbol || '') + rank;
    }
    if (rowsEl) {
      lastRowsHtml = data.rows.map(function (row) {
        const changeTone = row.change && row.change.startsWith('-') ? 'negative'
          : row.change && row.change.startsWith('+') ? 'positive' : 'neutral';
        const change = row.change && row.change !== '--'
          ? '<small class="cmc-change" data-tone="' + changeTone + '">' + escapeHtml(row.change) + ' · ' + escapeHtml(uiText(CMC_COPY.changePeriod)) + '</small>'
          : '';
        const detailId = PANEL_ID + '-explanation-' + row.id;
        const expanded = expandedMetricId === row.id;
        return [
          '<tr data-metric="', row.id, '" data-tone="', row.tone, '" class="', row.highlight ? 'cmc-key ' : '', row.group ? 'cmc-group' : '', '">',
            '<th scope="row" class="cmc-name">', escapeHtml(row.label), row.qualifier ? '<small>' + escapeHtml(row.qualifier) + '</small>' : '', '</th>',
            '<td class="cmc-value"><span class="cmc-number" data-role="metric-value">', escapeHtml(row.value), '</span>',
              row.unit ? '<small class="cmc-unit">' + escapeHtml(row.unit) + '</small>' : '', change,
            '</td>',
            '<td><button type="button" class="cmc-reading-button" data-expand-metric="', row.id, '" aria-expanded="', String(expanded), '" aria-controls="', detailId, '" aria-label="', escapeHtml(row.label + ' · ' + uiText(CMC_COPY.details)), '" title="', escapeHtml(row.note), '">',
              '<span class="cmc-reading-text">', escapeHtml(row.interpretation), '</span><span class="cmc-info" aria-hidden="true">ⓘ</span>',
            '</button></td>',
          '</tr>',
          '<tr id="', detailId, '" class="cmc-explanation"', expanded ? '' : ' hidden', '><td colspan="3"><strong>', escapeHtml(row.label), '</strong>', escapeHtml(row.explanation), '<small>', escapeHtml(row.note), '</small></td></tr>',
        ].join('');
      }).join('');
      rowsEl.innerHTML = lastRowsHtml;
    }
    if (footerEl) {
      lastUpdateTs = Date.now();
      const cmcClock = data.lastUpdated ? formatClock(Date.parse(data.lastUpdated)) : '--';
      const sourceLabel = uiText(data.source === 'page-snapshot' ? CMC_COPY.page : CMC_COPY.api);
      footerEl.innerHTML = [
        '<div class="cmc-source-line">',
          '<a href="', escapeHtml(data.url), '" target="_blank" rel="noopener noreferrer">', escapeHtml(sourceLabel), '</a>',
          '<span class="cmc-times"><span title="', escapeHtml(uiText(CMC_COPY.dataTime)), '">CMC ', cmcClock, '</span> / <span title="', escapeHtml(uiText(CMC_COPY.fetchedTime)), '">', escapeHtml(uiText(CMC_COPY.fetched)), ' ', formatClock(lastUpdateTs), '</span></span>',
        '</div>',
        '<small>', escapeHtml(uiText(CMC_COPY.refreshPeriod)), '</small>',
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
      refreshTimer = setInterval(function () {
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
    lastRowsHtml = '';
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
      routeTimer = setInterval(function () {
        ensureSpaRouteChangePatched(window);
        handleRouteChange();
      }, ROUTE_WATCHDOG_MS);
    }
  }

  function setupDrag(panel) {
    const header = panel.querySelector('#' + PANEL_ID + '-header');
    if (!header) return null;

    let dragging = false;
    let startX;
    let startY;
    let startLeft;
    let startTop;
    const cancelDrag = function () {
      if (!dragging) return;
      dragging = false;
      keepPanelInViewport(panel);
    };
    const onResize = function () {
      dragging = false;
      keepPanelInViewport(panel);
    };

    const onMouseDown = function (event) {
      if (event.button !== 0 || event.target.closest('button,a')) return;
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
      if ((event.buttons & 1) === 0) {
        cancelDrag();
        return;
      }
      const newLeft = Math.max(0, Math.min(startLeft + event.clientX - startX, window.innerWidth - panel.offsetWidth));
      const newTop = Math.max(0, Math.min(startTop + event.clientY - startY, window.innerHeight - panel.offsetHeight));
      panel.style.left = newLeft + 'px';
      panel.style.top = newTop + 'px';
      panel.style.setProperty('--cmc-panel-top', newTop + 'px');
      panel.style.right = 'auto';
    };

    const onMouseUp = function (event) {
      if (!dragging || event.button !== 0) return;
      dragging = false;
      const rect = panel.getBoundingClientRect();
      if (rect.left !== startLeft || rect.top !== startTop) savePanelPosition(panel);
    };

    header.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    window.addEventListener('blur', cancelDrag);
    window.addEventListener('resize', onResize);
    window.addEventListener(DATA_PANEL_LAYOUT_EVENT, onResize);

    return function cleanupDrag() {
      dragging = false;
      header.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('blur', cancelDrag);
      window.removeEventListener('resize', onResize);
      window.removeEventListener(DATA_PANEL_LAYOUT_EVENT, onResize);
    };
  }

  function setupControls(panel) {
    const refreshBtn = panel.querySelector('#' + PANEL_ID + '-refresh');
    const collapseBtn = panel.querySelector('#' + PANEL_ID + '-collapse');
    const closeBtn = panel.querySelector('#' + PANEL_ID + '-close');
    const body = panel.querySelector('#' + PANEL_ID + '-body');
    const rows = panel.querySelector('#' + PANEL_ID + '-rows');

    rows.addEventListener('click', function (event) {
      const button = event.target.closest('[data-expand-metric]');
      if (!button) return;
      expandedMetricId = expandedMetricId === button.dataset.expandMetric ? null : button.dataset.expandMetric;
      rows.querySelectorAll('[data-expand-metric]').forEach(function (control) {
        const expanded = control.dataset.expandMetric === expandedMetricId;
        control.setAttribute('aria-expanded', String(expanded));
        panel.querySelector('#' + control.getAttribute('aria-controls')).hidden = !expanded;
      });
    });

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
        updatePanelLanguage(panel);
      });
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        panel.style.display = 'none';
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
      top: clampNumber(pos.top, 0, Math.max(0, viewportHeight - 48)),
    };
  }

  /** Project the saved preference without letting smaller windows overwrite it. */
  function keepPanelInViewport(panel) {
    const width = panel.offsetWidth || PANEL_WIDTH;
    const normalized = calculateDataPanelLayout({
      kind: 'cmc', panelWidth: width,
      viewportWidth: window.innerWidth || document.documentElement.clientWidth || width,
      viewportHeight: window.innerHeight || document.documentElement.clientHeight || 80,
      savedPosition: normalizeSavedPosition(loadPosition(), width),
      hasPeer: hasVisibleDataPanelPeer(document, 'cmc'),
    });
    panel.style.left = normalized.left + 'px';
    panel.style.top = normalized.top + 'px';
    panel.style.maxHeight = normalized.maxHeight + 'px';
    panel.style.setProperty('--cmc-panel-top', normalized.top + 'px');
    panel.style.right = 'auto';
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

  startRouteWatcher();
  startDataLoop();
})();
