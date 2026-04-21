// ==UserScript==
// @name         【自写】CoinMarketCap 估值口径增强
// @namespace    coinmarketcap.valuation.helper
// @icon         https://s2.coinmarketcap.com/static/cloud/img/coinmarketcap_1.svg
// @version      0.1.0
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

  function textOf(node) {
    return node ? (node.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  function parseNumber(text) {
    if (!text) return null;
    const normalized = text
      .replace(/,/g, '')
      .replace(/[$¥€£]/g, '')
      .replace(/USD|USDT|RAVE/gi, '')
      .trim();
    const match = normalized.match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const raw = Number(match[0]);
    if (!Number.isFinite(raw)) return null;
    if (/万亿|兆|T\b/i.test(normalized)) return raw * 1e12;
    if (/十亿|B\b/i.test(normalized)) return raw * 1e9;
    if (/亿/.test(normalized)) return raw * 1e8;
    if (/百万|M\b/i.test(normalized)) return raw * 1e6;
    if (/万/.test(normalized)) return raw * 1e4;
    if (/千|K\b/i.test(normalized)) return raw * 1e3;
    return raw;
  }

  function formatUsd(value) {
    if (!Number.isFinite(value)) return 'n/a';
    if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
    if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
    if (value >= 1e3) return `$${(value / 1e3).toFixed(2)}K`;
    return `$${value.toFixed(2)}`;
  }

  function formatToken(value) {
    if (!Number.isFinite(value)) return 'n/a';
    if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
    if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
    if (value >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
    return value.toFixed(2);
  }

  function findMetricValue(labels) {
    const labelSet = labels.map((label) => label.toLowerCase());
    const nodes = Array.from(document.querySelectorAll('body *'));
    for (const node of nodes) {
      const text = textOf(node);
      if (!text || text.length > 80) continue;
      const lower = text.toLowerCase();
      if (!labelSet.some((label) => lower === label || lower.includes(label))) continue;

      let current = node;
      for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
        const candidates = Array.from(current.querySelectorAll('span, div, dd, p'))
          .map(textOf)
          .filter((value) => value && value !== text);
        for (const candidate of candidates) {
          if (/[$¥€£]/.test(candidate) || /\d/.test(candidate)) {
            const parsed = parseNumber(candidate);
            if (parsed !== null) return { text: candidate, value: parsed };
          }
        }
      }
    }
    return null;
  }

  function findPrice() {
    const candidates = Array.from(document.querySelectorAll('[data-test="text-cdp-price-display"], h1, span, div'))
      .map(textOf)
      .filter((value) => /^[$¥€£]?\d+(?:,\d{3})*(?:\.\d+)?$/.test(value) || /^[$¥€£]\d/.test(value));
    for (const candidate of candidates) {
      const value = parseNumber(candidate);
      if (value !== null && value > 0) return { text: candidate, value };
    }
    return null;
  }

  function collectMetrics() {
    const price = findPrice();
    const marketCap = findMetricValue(['Market cap', '市值']);
    const fdv = findMetricValue(['FDV', '完全稀释估值', 'Fully diluted']);
    const circulatingSupply = findMetricValue(['Circulating supply', '流通量', '流通供应量']);
    const maxSupply = findMetricValue(['Max. supply', 'Max supply', '最大供应量']);

    const computedMarketCap = price && circulatingSupply ? price.value * circulatingSupply.value : null;
    const computedFdv = price && maxSupply ? price.value * maxSupply.value : null;

    return { price, marketCap, fdv, circulatingSupply, maxSupply, computedMarketCap, computedFdv };
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

    const marketCapDisplay = data.marketCap ? data.marketCap.text : formatUsd(data.computedMarketCap);
    const fdvDisplay = data.fdv ? data.fdv.text : formatUsd(data.computedFdv);
    const circulatingDisplay = data.circulatingSupply ? data.circulatingSupply.text : 'n/a';
    const maxSupplyDisplay = data.maxSupply ? data.maxSupply.text : 'n/a';

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
      ${row('价格', data.price ? data.price.text : 'n/a')}
      ${row('流通市值', marketCapDisplay, data.computedMarketCap ? `计算: price × circulating = ${formatUsd(data.computedMarketCap)}` : '')}
      ${row('FDV / 总估值', fdvDisplay, data.computedFdv ? `计算: price × max = ${formatUsd(data.computedFdv)}` : '')}
      ${row('流通量', circulatingDisplay, data.circulatingSupply ? formatToken(data.circulatingSupply.value) : '')}
      ${row('最大供应量', maxSupplyDisplay, data.maxSupply ? formatToken(data.maxSupply.value) : '')}
      <div class="jh-cmc-note">页面字段优先；缺失时用页面价格和供应量现场计算。</div>
    `;
  }

  render();
  setInterval(render, REFRESH_MS);
})();
