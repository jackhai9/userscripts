// ==UserScript==
// @name         【自写】CoinMarketCap 估值口径命名
// @namespace    coinmarketcap.valuation.helper
// @icon         https://avatars.githubusercontent.com/u/5935568?s=128
// @version      0.2.3
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

  const METRICS = [
    {
      explainerSelector: '[data-test="icon-market-cap-explainer"]',
      replacement: '流通市值',
      labels: ['市值'],
    },
    {
      explainerSelector: '[data-test="icon-fully-diluted-mcap-explainer"]',
      replacement: 'FDV/总估值',
      labels: ['FDV', '完全稀释估值 (FDV)', '完全稀释后价值 (FDV)', '完全稀释的市值'],
    },
  ];

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

  function getDirectText(element) {
    return Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent || '')
      .join('');
  }

  function replaceDirectText(element, replacement) {
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && normalizeText(node.textContent || '')) {
        node.textContent = replacement;
        return;
      }
    }
  }

  function findReplacement(text) {
    for (const metric of METRICS) {
      if (metric.labels.includes(text)) return metric.replacement;
    }

    return null;
  }

  function renameLabelsByExplainers() {
    for (const metric of METRICS) {
      for (const explainer of document.querySelectorAll(metric.explainerSelector)) {
        const scope = explainer.closest('dt, [data-role="group-item"]') || explainer.parentElement;
        if (!scope || !isVisible(scope) || !isInTopLeftStatsArea(scope)) continue;

        const candidates = [scope, ...scope.querySelectorAll(TEXT_SELECTOR)];
        for (const element of candidates) {
          if (element === explainer || explainer.contains(element)) continue;
          if (normalizeText(getDirectText(element)) === metric.replacement) break;
          if (!metric.labels.includes(normalizeText(getDirectText(element)))) continue;

          replaceDirectText(element, metric.replacement);
          break;
        }
      }
    }
  }

  function renameLabelsByText() {
    for (const element of document.querySelectorAll(TEXT_SELECTOR)) {
      if (!isVisible(element)) continue;
      if (!isInTopLeftStatsArea(element)) continue;
      if (!hasMetricValueNearby(element)) continue;

      const replacement = findReplacement(normalizeText(getDirectText(element)));
      if (replacement) replaceDirectText(element, replacement);
    }
  }

  function renameLabels() {
    if (!isChineseCurrencyPage()) return;

    renameLabelsByExplainers();
    renameLabelsByText();
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
      characterData: true,
      subtree: true,
    });
  }
})();
