// ==UserScript==
// @name         【自写】CoinMarketCap 估值口径增强
// @namespace    coinmarketcap.valuation.helper
// @icon         https://s2.coinmarketcap.com/static/cloud/img/coinmarketcap_1.svg
// @version      0.1.1
// @author       jackhai9
// @description  在 CoinMarketCap 币种页面明确显示流通市值、FDV、流通量、最大供应量和计算口径
// @match        https://coinmarketcap.com/currencies/*
// @match        https://coinmarketcap.com/*/currencies/*
// @updateURL    https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/coinmarketcap-valuation-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/coinmarketcap-valuation-helper.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const PANEL_ID = 'jh-cmc-valuation-helper';
  const REFRESH_MS = 2000;

  function asNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function formatUsd(value) {
    if (!Number.isFinite(value)) return 'n/a';
    if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
    if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
    if (value >= 1e3) return `$${(value / 1e3).toFixed(2)}K`;
    return `$${value.toFixed(2)}`;
  }

  function formatToken(value, symbol) {
    if (!Number.isFinite(value)) return 'n/a';
    let formatted;
    if (value >= 1e9) formatted = `${(value / 1e9).toFixed(2)}B`;
    else if (value >= 1e6) formatted = `${(value / 1e6).toFixed(2)}M`;
    else if (value >= 1e3) formatted = `${(value / 1e3).toFixed(2)}K`;
    else formatted = value.toFixed(2);
    return symbol ? `${formatted} ${symbol}` : formatted;
  }

  function findStatisticsInObject(value) {
    if (!value || typeof value !== 'object') return null;
    if (
      typeof value.marketCap !== 'undefined' &&
      typeof value.fullyDilutedMarketCap !== 'undefined' &&
      typeof value.circulatingSupply !== 'undefined'
    ) {
      return value;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findStatisticsInObject(item);
        if (found) return found;
      }
      return null;
    }
    for (const item of Object.values(value)) {
      const found = findStatisticsInObject(item);
      if (found) return found;
    }
    return null;
  }

  function readNextData() {
    const script = document.getElementById('__NEXT_DATA__');
    if (!script || !script.textContent) return null;
    try {
      return JSON.parse(script.textContent);
    } catch (error) {
      return null;
    }
  }

  function collectMetrics() {
    const nextData = readNextData();
    const detail = nextData && nextData.props && nextData.props.pageProps && nextData.props.pageProps.detailRes && nextData.props.pageProps.detailRes.detail;
    const statistics = detail && detail.statistics ? detail.statistics : findStatisticsInObject(nextData);
    if (!statistics) return null;

    const symbol = detail && detail.symbol ? String(detail.symbol) : '';
    const price = asNumber(statistics.price);
    const marketCap = asNumber(statistics.marketCap);
    const fdv = asNumber(statistics.fullyDilutedMarketCap);
    const circulatingSupply = asNumber(statistics.circulatingSupply);
    const maxSupply = asNumber(statistics.maxSupply);
    const totalSupply = asNumber(statistics.totalSupply);
    const displayMaxSupply = maxSupply || totalSupply;
    const computedMarketCap = price && circulatingSupply ? price * circulatingSupply : null;
    const computedFdv = price && displayMaxSupply ? price * displayMaxSupply : null;

    return {
      symbol,
      price,
      marketCap,
      fdv,
      circulatingSupply,
      maxSupply: displayMaxSupply,
      computedMarketCap,
      computedFdv,
    };
  }

  function row(label, value, subtext) {
    return `<div class="jh-cmc-row"><span>${label}</span><strong>${value}</strong>${subtext ? `<small>${subtext}</small>` : ''}</div>`;
  }

  function render() {
    const data = collectMetrics();
    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement('section');
      panel.id = PANEL_ID;
      document.body.appendChild(panel);
    }

    const symbol = data && data.symbol ? data.symbol : '';
    panel.innerHTML = `
      <style>
        #${PANEL_ID} {
          position: fixed; right: 18px; bottom: 18px; z-index: 2147483647;
          width: 320px; padding: 14px; border: 1px solid rgba(56, 97, 251, .35);
          border-radius: 8px; background: rgba(255,255,255,.96); color: #111827;
          box-shadow: 0 12px 36px rgba(15,23,42,.18); font: 13px/1.35 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;
        }
        #${PANEL_ID} h2 { margin: 0 0 10px; font-size: 15px; font-weight: 700; }
        #${PANEL_ID} .jh-cmc-row { display: grid; grid-template-columns: 112px 1fr; gap: 4px 8px; padding: 7px 0; border-top: 1px solid #eef2f7; }
        #${PANEL_ID} .jh-cmc-row:first-of-type { border-top: 0; }
        #${PANEL_ID} span { color: #64748b; }
        #${PANEL_ID} strong { text-align: right; font-variant-numeric: tabular-nums; }
        #${PANEL_ID} small { grid-column: 1 / -1; color: #64748b; text-align: right; }
        #${PANEL_ID} .jh-cmc-note { margin-top: 8px; color: #64748b; font-size: 12px; }
        @media (prefers-color-scheme: dark) {
          #${PANEL_ID} { background: rgba(15,23,42,.96); color: #f8fafc; border-color: rgba(96,165,250,.45); }
          #${PANEL_ID} .jh-cmc-row { border-top-color: rgba(148,163,184,.25); }
          #${PANEL_ID} span, #${PANEL_ID} small, #${PANEL_ID} .jh-cmc-note { color: #94a3b8; }
        }
      </style>
      <h2>估值口径</h2>
      ${row('价格', data ? formatUsd(data.price) : 'n/a')}
      ${row('流通市值', data ? formatUsd(data.marketCap) : 'n/a', data && data.computedMarketCap ? `price × circulating = ${formatUsd(data.computedMarketCap)}` : '')}
      ${row('FDV / 总估值', data ? formatUsd(data.fdv) : 'n/a', data && data.computedFdv ? `price × max = ${formatUsd(data.computedFdv)}` : '')}
      ${row('流通量', data ? formatToken(data.circulatingSupply, symbol) : 'n/a')}
      ${row('最大供应量', data ? formatToken(data.maxSupply, symbol) : 'n/a')}
      <div class="jh-cmc-note">读取 CoinMarketCap 页面内置数据；不抓取正文文案，不调用 API。</div>
    `;
  }

  render();
  setInterval(render, REFRESH_MS);
})();
