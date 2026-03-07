// ==UserScript==
// @name         【自写】Binance 平仓数量倍率
// @namespace    binance.close.qty.preset
// @icon         https://avatars.githubusercontent.com/u/5935568?s=128
// @version      2.0.0
// @author       jackhai9
// @description  自动读取当前币种最小下单量，并用倍率输入框生成平仓数量
// @match        https://www.binance.com/*/futures/*
// @match        https://www.binance.com/futures/*
// @updateURL    https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-close-qty-preset.user.js
// @downloadURL  https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-close-qty-preset.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'jh_binance_close_qty_multiplier';
  const PANEL_ID = 'jh-binance-close-qty-multiplier-panel';
  const INPUT_ID = 'jh-binance-close-qty-multiplier-input';
  const DEFAULT_MULTIPLIER = '1';

  function getCurrentSymbol() {
    const m = location.pathname.match(/\/futures\/([A-Z0-9_]+)/i);
    if (m && m[1]) return m[1].toUpperCase();

    const title = document.title || '';
    const t = title.match(/([A-Z0-9_]{6,})\s+U/i);
    return t && t[1] ? t[1].toUpperCase() : null;
  }

  function readMinQtyFromAppData(symbol) {
    try {
      const el = document.querySelector('#__APP_DATA');
      if (!el || !el.textContent) return null;
      const data = JSON.parse(el.textContent);
      const perpetual =
        data?.appState?.loader?.dataByRouteId?.bd56?.reactQueryData?.productFutureService?.perpetual;
      const sInfo = perpetual?.[symbol];
      if (!sInfo) return null;
      const filters = Array.isArray(sInfo.f) ? sInfo.f : [];
      const lot = filters.find((x) => x && x.filterType === 'LOT_SIZE') || {};
      return typeof lot.minQty === 'string' && lot.minQty ? lot.minQty : null;
    } catch (_e) {
      return null;
    }
  }

  function readMinQtyFromQtyInput() {
    const input =
      document.querySelector('input[id^="unitAmount-"]') ||
      document.querySelector('input[aria-label="数量"]') ||
      document.querySelector('input[placeholder="数量"]');
    if (!input) return null;
    const step = input.getAttribute('step');
    return step && /^\d+(\.\d+)?$/.test(step) ? step : null;
  }

  function loadMultiplier() {
    const value = localStorage.getItem(STORAGE_KEY);
    return /^\d+$/.test(String(value || '')) && Number(value) > 0 ? String(value) : DEFAULT_MULTIPLIER;
  }

  function saveMultiplier(value) {
    localStorage.setItem(STORAGE_KEY, value);
  }

  function multiplyDecimalByInt(decimalValue, intValue) {
    const raw = String(decimalValue || '').trim();
    const multiplier = String(intValue || '').trim();
    if (!/^\d+(\.\d+)?$/.test(raw)) return null;
    if (!/^\d+$/.test(multiplier) || Number(multiplier) <= 0) return null;

    const parts = raw.split('.');
    const intPart = parts[0];
    const fracPart = parts[1] || '';
    const scale = fracPart.length;
    const base = BigInt(intPart + fracPart);
    const multi = BigInt(multiplier);
    const product = (base * multi).toString();

    if (scale === 0) return product;

    const padded = product.padStart(scale + 1, '0');
    const head = padded.slice(0, -scale) || '0';
    const tail = padded.slice(-scale).replace(/0+$/, '');
    return tail ? `${head}.${tail}` : head;
  }

  function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.position = 'fixed';
    panel.style.right = '16px';
    panel.style.bottom = '88px';
    panel.style.zIndex = '999999';
    panel.style.width = '192px';
    panel.style.padding = '10px 12px';
    panel.style.borderRadius = '12px';
    panel.style.background = 'rgba(15, 23, 42, 0.92)';
    panel.style.color = '#f8fafc';
    panel.style.fontSize = '12px';
    panel.style.lineHeight = '16px';
    panel.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
    panel.style.boxShadow = '0 8px 24px rgba(15, 23, 42, 0.24)';
    panel.style.backdropFilter = 'blur(8px)';
    panel.innerHTML = [
      '<div style="font-weight:600;margin-bottom:8px;">平仓数量倍率</div>',
      '<div id="jh-binance-close-qty-symbol" style="opacity:.9;margin-bottom:6px;"></div>',
      '<label style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">',
      '<span>倍数</span>',
      `<input id="${INPUT_ID}" type="number" min="1" step="1" style="width:72px;padding:4px 6px;border-radius:8px;border:1px solid rgba(148,163,184,.35);background:rgba(255,255,255,.08);color:#f8fafc;outline:none;">`,
      '</label>',
      '<div id="jh-binance-close-qty-min" style="opacity:.9;margin-bottom:4px;"></div>',
      '<div id="jh-binance-close-qty-final" style="font-weight:600;"></div>',
    ].join('');
    document.body.appendChild(panel);

    const input = panel.querySelector(`#${INPUT_ID}`);
    if (input) {
      input.value = loadMultiplier();
      input.addEventListener('input', () => {
        const value = String(input.value || '').trim();
        if (/^\d+$/.test(value) && Number(value) > 0) {
          saveMultiplier(value);
          renderPanel();
          return;
        }
        renderPanel();
      });
      input.addEventListener('blur', () => {
        const value = String(input.value || '').trim();
        if (/^\d+$/.test(value) && Number(value) > 0) {
          saveMultiplier(value);
          renderPanel();
          return;
        }
        input.value = loadMultiplier();
        renderPanel();
      });
    }

    return panel;
  }

  function renderPanel() {
    const panel = ensurePanel();
    const symbolEl = panel.querySelector('#jh-binance-close-qty-symbol');
    const minEl = panel.querySelector('#jh-binance-close-qty-min');
    const finalEl = panel.querySelector('#jh-binance-close-qty-final');
    const input = panel.querySelector(`#${INPUT_ID}`);
    const symbol = getCurrentSymbol() || '-';
    const multiplier = input ? String(input.value || '').trim() : loadMultiplier();
    const minQty = (symbol !== '-' && readMinQtyFromAppData(symbol)) || readMinQtyFromQtyInput();
    const finalQty = minQty ? multiplyDecimalByInt(minQty, multiplier) : null;

    if (symbolEl) symbolEl.textContent = `币种 ${symbol}`;
    if (minEl) minEl.textContent = minQty ? `最小量 ${minQty}` : '最小量 读取中...';
    if (finalEl) {
      if (/^\d+$/.test(multiplier) && Number(multiplier) > 0 && finalQty) {
        finalEl.textContent = `数量 ${minQty} x ${multiplier} = ${finalQty}`;
      } else {
        finalEl.textContent = '数量 请输入正整数倍数';
      }
    }
    if (input) {
      input.style.borderColor =
        /^\d+$/.test(multiplier) && Number(multiplier) > 0
          ? 'rgba(148,163,184,.35)'
          : 'rgba(248,113,113,.75)';
    }
  }

  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) renderPanel();
  });

  setInterval(renderPanel, 1000);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderPanel, { once: true });
  } else {
    renderPanel();
  }
})();
