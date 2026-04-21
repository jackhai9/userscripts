// ==UserScript==
// @name         【自写】CoinMarketCap 估值口径命名
// @namespace    coinmarketcap.valuation.helper
// @icon         https://avatars.githubusercontent.com/u/5935568?s=128
// @version      0.2.1
// @author       jackhai9
// @description  在 CoinMarketCap 中文币种页面左上角统计区把“市值”标注为“流通市值”，把“FDV”标注为“FDV/总估值”
// @match        https://coinmarketcap.com/zh/currencies/*
// @updateURL    https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/coinmarketcap-valuation-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/coinmarketcap-valuation-helper.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const RENAMES = new Map([
    ['市值', '流通市值'],
    ['FDV', 'FDV/总估值'],
  ]);

  const CURRENCY_PATH_PATTERN = /^\/zh\/currencies\/[^/]+(?:\/.*)?$/;
  const MAX_LABEL_PAGE_TOP = 720;
  const MAX_LABEL_PAGE_LEFT = 430;

  const TEXT_SELECTOR = [
    'span',
    'p',
    'div',
  ].join(',');

  function isChineseCurrencyPage() {
    return CURRENCY_PATH_PATTERN.test(window.location.pathname);
  }

  function normalizeText(value) {
    return value.replace(/\s+/g, ' ').trim();
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;

    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function isInTopLeftStatsArea(element) {
    const rect = element.getBoundingClientRect();
    const pageTop = rect.top + window.scrollY;
    const pageLeft = rect.left + window.scrollX;
    const viewportLimit = Math.min(MAX_LABEL_PAGE_LEFT, window.innerWidth * 0.35);

    return pageTop > 110 && pageTop < MAX_LABEL_PAGE_TOP && pageLeft < viewportLimit;
  }

  function hasMetricValueNearby(element) {
    let current = element.parentElement;
    for (let depth = 0; current && depth < 4; depth += 1) {
      const text = normalizeText(current.textContent || '');
      if (/\$\s?[\d,.]+/.test(text) || /[\d,.]+\s?[KMBT]/i.test(text)) return true;
      current = current.parentElement;
    }

    return false;
  }

  function renameLabels() {
    if (!isChineseCurrencyPage()) return;

    for (const element of document.querySelectorAll(TEXT_SELECTOR)) {
      if (element.children.length > 0) continue;
      if (!isVisible(element)) continue;
      if (!isInTopLeftStatsArea(element)) continue;
      if (!hasMetricValueNearby(element)) continue;

      const replacement = RENAMES.get(normalizeText(element.textContent || ''));
      if (replacement) element.textContent = replacement;
    }
  }

  function safeRenameLabels() {
    try {
      renameLabels();
    } catch (error) {
      // CoinMarketCap changes its DOM frequently. A missed rename should never affect the page.
    }
  }

  safeRenameLabels();

  if (document.body) {
    const observer = new MutationObserver(safeRenameLabels);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }
})();
