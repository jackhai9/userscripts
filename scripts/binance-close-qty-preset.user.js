// ==UserScript==
// @name         【自写】Binance 平仓数量倍率
// @namespace    binance.close.qty.preset
// @icon         https://avatars.githubusercontent.com/u/5935568?s=128
// @version      2.4.2
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
  const SPACER_ID = 'jh-binance-close-qty-multiplier-spacer';
  const INPUT_ID = 'jh-binance-close-qty-multiplier-input';
  const DEC_ID = 'jh-binance-close-qty-multiplier-dec';
  const INC_ID = 'jh-binance-close-qty-multiplier-inc';
  const DEFAULT_MULTIPLIER = '1';
  let isEditingMultiplier = false;

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
    isEditingMultiplier = false;
    saveMultiplier(normalized);
    if (input) input.value = normalized;
    renderPanel();
  }

  function refreshComputedInfo(panel, multiplier, minQty) {
    const minEl = panel.querySelector('#jh-binance-close-qty-min');
    const finalEl = panel.querySelector('#jh-binance-close-qty-final');
    const decBtn = panel.querySelector(`#${DEC_ID}`);
    const incBtn = panel.querySelector(`#${INC_ID}`);
    const finalQty = minQty ? multiplyDecimalByInt(minQty, multiplier) : null;

    if (minEl) minEl.textContent = minQty ? `最小 ${minQty}` : '最小量读取中';
    if (finalEl) {
      if (/^\d+$/.test(multiplier) && Number(multiplier) > 0 && finalQty) {
        finalEl.textContent = `${minQty} x ${multiplier} = ${finalQty}`;
      } else {
        finalEl.textContent = '请输入正整数倍数';
      }
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

  function findQtyInput() {
    return (
      document.querySelector('input[id^="unitAmount-"]') ||
      document.querySelector('input[aria-label="数量"]') ||
      document.querySelector('input[placeholder="数量"]')
    );
  }

  function findQtyFormItem(input) {
    if (!input) return null;
    return (
      input.closest('div[target^="unitAmount-"]') ||
      input.closest('.bn-formItem') ||
      input.parentElement ||
      null
    );
  }

  function ensureSpacer(host, panelHeight) {
    let spacer = document.getElementById(SPACER_ID);
    if (!host || !host.parentElement) {
      if (spacer) spacer.remove();
      return null;
    }
    if (!spacer) {
      spacer = document.createElement('div');
      spacer.id = SPACER_ID;
    }
    spacer.style.width = '100%';
    spacer.style.height = `${panelHeight}px`;
    spacer.style.margin = '0 0 8px 0';
    spacer.style.pointerEvents = 'none';

    if (spacer.parentElement !== host.parentElement) {
      host.parentElement.insertBefore(spacer, host);
    } else if (spacer.nextElementSibling !== host) {
      host.parentElement.insertBefore(spacer, host);
    }
    return spacer;
  }

  function placePanelFloating(panel, anchorRect) {
    if (panel.parentElement !== document.body) {
      document.body.appendChild(panel);
    }
    panel.style.position = 'fixed';
    panel.style.maxWidth = 'none';
    panel.style.margin = '0';
    panel.style.zIndex = '999999';

    if (!anchorRect || !anchorRect.width || !anchorRect.height) {
      panel.style.left = '';
      panel.style.top = '';
      panel.style.right = '16px';
      panel.style.bottom = '88px';
      panel.style.border = '1px solid #eaecef';
      return;
    }

    const margin = 8;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const panelWidth = Math.min(Math.max(anchorRect.width, 280), viewportWidth - margin * 2);
    const estimatedHeight = Math.max(panel.offsetHeight || 0, 76);

    let left = anchorRect.left;
    left = Math.max(margin, Math.min(left, viewportWidth - panelWidth - margin));

    let top = anchorRect.top;
    top = Math.max(margin, Math.min(top, viewportHeight - estimatedHeight - margin));

    panel.style.width = `${Math.round(panelWidth)}px`;
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
    panel.style.right = '';
    panel.style.bottom = '';
  }

  function positionPanel(panel) {
    const qtyInput = findQtyInput();
    const host = findQtyFormItem(qtyInput);
    const spacer = ensureSpacer(host, Math.max(panel.offsetHeight || 0, 76));
    const anchorRect = spacer?.getBoundingClientRect() || qtyInput?.getBoundingClientRect() || null;
    placePanelFloating(panel, anchorRect);
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
    panel.style.width = '320px';
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
      '<div style="display:flex;align-items:center;justify-content:flex-start;gap:8px;margin-bottom:6px;flex-wrap:wrap;">',
      '<span style="font-size:12px;font-weight:500;color:#5e6673;white-space:nowrap;">平仓倍率</span>',
      `<label style="display:flex;align-items:center;gap:6px;">` +
        `<button id="${DEC_ID}" type="button" style="width:24px;height:24px;padding:0;border-radius:6px;border:1px solid #d5d9e2;background:#ffffff;color:#5e6673;font-size:14px;line-height:22px;cursor:pointer;">-</button>` +
        `<input id="${INPUT_ID}" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" style="width:56px;height:28px;padding:0 8px;border-radius:8px;border:1px solid #d5d9e2;background:#ffffff;color:#1e2329;outline:none;font-size:14px;line-height:28px;">` +
        `<button id="${INC_ID}" type="button" style="width:24px;height:24px;padding:0;border-radius:6px;border:1px solid #d5d9e2;background:#ffffff;color:#5e6673;font-size:14px;line-height:22px;cursor:pointer;">+</button>` +
      '</label>',
      '</div>',
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">',
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
      input.addEventListener('focus', () => {
        isEditingMultiplier = true;
        input.select();
      });
      input.addEventListener('input', () => {
        const value = String(input.value || '').replace(/[^\d]/g, '');
        if (input.value !== value) input.value = value;
        if (/^\d+$/.test(value) && Number(value) > 0) {
          saveMultiplier(value);
        }
        const symbol = getCurrentSymbol() || '-';
        const minQty = (symbol !== '-' && readMinQtyFromAppData(symbol)) || readMinQtyFromQtyInput();
        refreshComputedInfo(panel, value, minQty);
      });
      input.addEventListener('blur', () => {
        const value = String(input.value || '').trim();
        const normalized = sanitizeMultiplier(value);
        isEditingMultiplier = false;
        saveMultiplier(normalized);
        input.value = normalized;
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
    const input = panel.querySelector(`#${INPUT_ID}`);
    const symbol = getCurrentSymbol() || '-';
    const storedMultiplier = loadMultiplier();
    if (input && !isEditingMultiplier && input.value !== storedMultiplier) {
      input.value = storedMultiplier;
    }
    const multiplier = input
      ? String((isEditingMultiplier ? input.value : storedMultiplier) || '').trim()
      : storedMultiplier;
    const minQty = (symbol !== '-' && readMinQtyFromAppData(symbol)) || readMinQtyFromQtyInput();
    refreshComputedInfo(panel, multiplier, minQty);
    if (input) {
      input.style.borderColor =
        /^\d+$/.test(multiplier) && Number(multiplier) > 0
          ? '#d5d9e2'
          : '#f6465d';
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
