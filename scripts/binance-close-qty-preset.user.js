// ==UserScript==
// @name         【自写】Binance 平仓数量倍率
// @namespace    binance.close.qty.preset
// @icon         https://avatars.githubusercontent.com/u/5935568?s=128
// @version      2.3.0
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
  const DEC_ID = 'jh-binance-close-qty-multiplier-dec';
  const INC_ID = 'jh-binance-close-qty-multiplier-inc';
  const DEFAULT_MULTIPLIER = '1';
  let cachedInlineHost = null;

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

  function sanitizeMultiplier(value) {
    return /^\d+$/.test(String(value || '')) && Number(value) > 0 ? String(value) : DEFAULT_MULTIPLIER;
  }

  function updateMultiplier(nextValue) {
    const input = document.getElementById(INPUT_ID);
    const normalized = sanitizeMultiplier(nextValue);
    saveMultiplier(normalized);
    if (input) input.value = normalized;
    renderPanel();
  }

  function findQtyInput() {
    return (
      document.querySelector('input[id^="unitAmount-"]') ||
      document.querySelector('input[aria-label="数量"]') ||
      document.querySelector('input[placeholder="数量"]')
    );
  }

  function findInlineHost(input) {
    if (!input) return null;
    const inputRect = input.getBoundingClientRect();
    const minWidth = Math.max(420, Math.round(inputRect.width * 1.6));
    let node = input.parentElement;
    for (let i = 0; node && i < 6; i += 1, node = node.parentElement) {
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      if (rect.width < minWidth || rect.height > 220) continue;
      if (node.parentElement && node.parentElement.children.length > 1) return node;
    }
    return input.parentElement || null;
  }

  function placePanelInline(panel, host) {
    if (!host || !host.parentElement) return false;
    if (panel.parentElement !== host.parentElement) {
      host.parentElement.insertBefore(panel, host.nextSibling);
    } else if (panel.previousElementSibling !== host) {
      host.parentElement.insertBefore(panel, host.nextSibling);
    }

    panel.style.position = 'relative';
    panel.style.left = '';
    panel.style.top = '';
    panel.style.right = '';
    panel.style.bottom = '';
    panel.style.width = '100%';
    panel.style.maxWidth = 'none';
    panel.style.margin = '6px 0 0 0';
    panel.style.minWidth = '0';
    panel.style.zIndex = '1';
    return true;
  }

  function placePanelFloating(panel, input) {
    if (panel.parentElement !== document.body) {
      document.body.appendChild(panel);
    }
    panel.style.position = 'fixed';
    panel.style.width = '220px';
    panel.style.maxWidth = '220px';
    panel.style.margin = '0';
    panel.style.zIndex = '999999';

    if (!input) {
      panel.style.left = '';
      panel.style.top = '';
      panel.style.right = '16px';
      panel.style.bottom = '88px';
      panel.style.border = '1px solid #eaecef';
      return;
    }

    const rect = input.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      panel.style.left = '';
      panel.style.top = '';
      panel.style.right = '16px';
      panel.style.bottom = '88px';
      panel.style.border = '1px solid #eaecef';
      return;
    }

    const margin = 8;
    const panelWidth = 220;
    const estimatedHeight = 116;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;

    let left = rect.left - panelWidth - margin;
    if (left < margin) {
      left = rect.right + margin;
    }
    left = Math.max(margin, Math.min(left, viewportWidth - panelWidth - margin));

    let top = rect.top;
    if (top + estimatedHeight > viewportHeight - margin) {
      top = Math.max(margin, viewportHeight - estimatedHeight - margin);
    }

    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
    panel.style.right = '';
    panel.style.bottom = '';
  }

  function positionPanel(panel) {
    const qtyInput = findQtyInput();
    const host =
      cachedInlineHost && cachedInlineHost.isConnected
        ? cachedInlineHost
        : findInlineHost(qtyInput);
    if (host && host.isConnected) {
      cachedInlineHost = host;
    } else {
      cachedInlineHost = null;
    }
    if (placePanelInline(panel, host)) return;
    placePanelFloating(panel, qtyInput);
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
    panel.style.zIndex = '999999';
    panel.style.width = '192px';
    panel.style.padding = '8px 10px';
    panel.style.borderRadius = '10px';
    panel.style.background = '#ffffff';
    panel.style.border = '1px solid #eaecef';
    panel.style.color = '#1e2329';
    panel.style.fontSize = '12px';
    panel.style.lineHeight = '16px';
    panel.style.fontFamily = 'BinancePlex, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
    panel.style.boxShadow = 'none';
    panel.innerHTML = [
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">',
      '<span style="font-size:12px;font-weight:500;color:#5e6673;white-space:nowrap;">平仓倍率</span>',
      `<label style="display:flex;align-items:center;gap:6px;">` +
        `<button id="${DEC_ID}" type="button" style="width:24px;height:24px;padding:0;border-radius:6px;border:1px solid #d5d9e2;background:#ffffff;color:#5e6673;font-size:14px;line-height:22px;cursor:pointer;">-</button>` +
        `<input id="${INPUT_ID}" type="number" min="1" step="1" style="width:56px;height:28px;padding:0 8px;border-radius:8px;border:1px solid #d5d9e2;background:#ffffff;color:#1e2329;outline:none;font-size:14px;line-height:28px;">` +
        `<button id="${INC_ID}" type="button" style="width:24px;height:24px;padding:0;border-radius:6px;border:1px solid #d5d9e2;background:#ffffff;color:#5e6673;font-size:14px;line-height:22px;cursor:pointer;">+</button>` +
        '<span style="font-size:12px;color:#5e6673;">x</span>' +
      '</label>',
      '</div>',
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">',
      '<span id="jh-binance-close-qty-symbol" style="color:#76808f;"></span>',
      '<span id="jh-binance-close-qty-min" style="color:#76808f;"></span>',
      '<span id="jh-binance-close-qty-final" style="font-weight:600;color:#1e2329;"></span>',
      '</div>',
    ].join('');
    document.body.appendChild(panel);

    const input = panel.querySelector(`#${INPUT_ID}`);
    const decBtn = panel.querySelector(`#${DEC_ID}`);
    const incBtn = panel.querySelector(`#${INC_ID}`);
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
    if (decBtn) {
      decBtn.addEventListener('click', () => {
        const current = Number(loadMultiplier());
        updateMultiplier(String(Math.max(1, current - 1)));
      });
    }
    if (incBtn) {
      incBtn.addEventListener('click', () => {
        const current = Number(loadMultiplier());
        updateMultiplier(String(current + 1));
      });
    }

    return panel;
  }

  function renderPanel() {
    const panel = ensurePanel();
    positionPanel(panel);
    const symbolEl = panel.querySelector('#jh-binance-close-qty-symbol');
    const minEl = panel.querySelector('#jh-binance-close-qty-min');
    const finalEl = panel.querySelector('#jh-binance-close-qty-final');
    const input = panel.querySelector(`#${INPUT_ID}`);
    const symbol = getCurrentSymbol() || '-';
    const multiplier = input ? String(input.value || '').trim() : loadMultiplier();
    const minQty = (symbol !== '-' && readMinQtyFromAppData(symbol)) || readMinQtyFromQtyInput();
    const finalQty = minQty ? multiplyDecimalByInt(minQty, multiplier) : null;
    const decBtn = panel.querySelector(`#${DEC_ID}`);
    const incBtn = panel.querySelector(`#${INC_ID}`);

    if (symbolEl) symbolEl.textContent = symbol !== '-' ? symbol : '识别中';
    if (minEl) minEl.textContent = minQty ? `最小 ${minQty}` : '最小量读取中';
    if (finalEl) {
      if (/^\d+$/.test(multiplier) && Number(multiplier) > 0 && finalQty) {
        finalEl.textContent = `${minQty} x ${multiplier} = ${finalQty}`;
      } else {
        finalEl.textContent = '请输入正整数倍数';
      }
    }
    if (input) {
      input.style.borderColor =
        /^\d+$/.test(multiplier) && Number(multiplier) > 0
          ? '#d5d9e2'
          : '#f6465d';
    }
    if (decBtn) decBtn.disabled = Number(multiplier) <= 1;
    if (decBtn) {
      decBtn.style.opacity = decBtn.disabled ? '0.45' : '1';
      decBtn.style.cursor = decBtn.disabled ? 'not-allowed' : 'pointer';
    }
    if (incBtn) {
      incBtn.style.opacity = '1';
      incBtn.style.cursor = 'pointer';
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
