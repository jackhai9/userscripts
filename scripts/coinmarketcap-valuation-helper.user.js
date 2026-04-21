// ==UserScript==
// @name         【自写】CoinMarketCap 估值口径命名
// @namespace    coinmarketcap.valuation.helper
// @icon         https://avatars.githubusercontent.com/u/5935568?s=128
// @version      0.2.4
// @author       jackhai9
// @description  在 CoinMarketCap 中文币种页面左上角统计区标注并高亮流通市值和FDV/总估值
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
  const HIGHLIGHT_CLASS = 'jh-cmc-valuation-highlight';
  const STYLE_ID = 'jh-cmc-valuation-helper-style';

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

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${HIGHLIGHT_CLASS} {
        outline: 2px solid rgba(56, 97, 251, 0.72) !important;
        outline-offset: 0 !important;
        box-shadow: 0 0 0 3px rgba(56, 97, 251, 0.12), 0 8px 20px rgba(56, 97, 251, 0.10) !important;
        background: linear-gradient(180deg, rgba(56, 97, 251, 0.08), rgba(22, 199, 132, 0.06)) !important;
      }
    `;
    document.head.appendChild(style);
  }

  function highlightMetricCard(element) {
    const card = element.closest('[data-role="group-item"]');
    if (!card || !isVisible(card) || !isInTopLeftStatsArea(card)) return;

    card.classList.add(HIGHLIGHT_CLASS);
  }

  function renameLabelsByExplainers() {
    for (const metric of METRICS) {
      for (const explainer of document.querySelectorAll(metric.explainerSelector)) {
        const scope = explainer.closest('dt, [data-role="group-item"]') || explainer.parentElement;
        if (!scope || !isVisible(scope) || !isInTopLeftStatsArea(scope)) continue;

        const candidates = [scope, ...scope.querySelectorAll(TEXT_SELECTOR)];
        for (const element of candidates) {
          if (element === explainer || explainer.contains(element)) continue;
          if (normalizeText(getDirectText(element)) === metric.replacement) {
            highlightMetricCard(element);
            break;
          }
          if (!metric.labels.includes(normalizeText(getDirectText(element)))) continue;

          replaceDirectText(element, metric.replacement);
          highlightMetricCard(element);
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
      if (!replacement) continue;

      replaceDirectText(element, replacement);
      highlightMetricCard(element);
    }
  }

  function renameLabels() {
    if (!isChineseCurrencyPage()) return;

    installStyles();
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
