// ==UserScript==
// @name         【自写】Binance 双击平仓
// @namespace    binance.close.long
// @icon         https://avatars.githubusercontent.com/u/5935568?s=128
// @version      2.1.2
// @author       jackhai9
// @description  双击订单簿任意行 -> Binance 默认单击订单簿即填价格 -> 自动填数量(通过数量倍率) -> 自动平仓（双向持仓时按面板所选侧，单向持仓时按已有持仓侧）
// @match        https://www.binance.com/*/futures/*
// @match        https://www.binance.com/futures/*
// @updateURL    https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-close-long.user.js
// @downloadURL  https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-close-long.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const CFG = {
    // 按 symbol 覆盖默认数量（优先级最高）
    SYMBOL_QTY: {
      DASHUSDT: '0.003',
      // BTCUSDT: '0.001',
      // ETHUSDT: '0.01',
    },
    // 未配置 SYMBOL_QTY 时，是否自动使用该 symbol 的最小下单量
    AUTO_USE_MIN_QTY: true,
    // true=只填数量；false=填数量并自动点“平多/平空”
    SAFE_MODE: false,
    // 防连点
    COOLDOWN_MS: 100,
    DEBUG: true,
  };
  const LOCAL_QTY_MULTIPLIER_KEY = 'jh_binance_close_qty_multiplier';
  const LOCAL_CLOSE_SIDE_KEY = 'jh_binance_close_side';
  const PANEL_ID = 'jh-binance-close-qty-multiplier-panel';
  const SPACER_ID = 'jh-binance-close-qty-multiplier-spacer';
  const INPUT_ID = 'jh-binance-close-qty-multiplier-input';
  const DEC_ID = 'jh-binance-close-qty-multiplier-dec';
  const INC_ID = 'jh-binance-close-qty-multiplier-inc';
  const SIDE_LONG_ID = 'jh-binance-close-side-long';
  const SIDE_SHORT_ID = 'jh-binance-close-side-short';
  const DEFAULT_MULTIPLIER = '1';
  const DEFAULT_CLOSE_SIDE = 'LONG';
  const INPUT_BORDER_COLOR = 'var(--color-InputLine)';
  const INPUT_ERROR_COLOR = 'var(--color-Error)';
  const INPUT_FOCUS_COLOR = 'var(--color-PrimaryYellow)';
  const INPUT_DEFAULT_BG = 'transparent';

  let lastTs = 0;
  let isEditingMultiplier = false;

  const PREFIX = '[双击平仓]';

  function emit(level, ...args) {
    if (!CFG.DEBUG && level !== 'ERR') return;
    // 在部分扩展/页面 hook 场景下，console.log/warn 可能被吞；统一走 error 通道确保可见
    console.error(PREFIX, `[${level}]`, ...args);
  }

  function log(...args) {
    emit('LOG', ...args);
  }

  function warn(...args) {
    emit('WARN', ...args);
  }

  function err(...args) {
    emit('ERR', ...args);
  }

  function setInputValueReact(input, value) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function isValidMultiplier(value) {
    return /^\d+$/.test(String(value || '').trim()) && Number(value) > 0;
  }

  function applyInputVisualState(input, multiplier) {
    if (!input) return;

    const isFocused = document.activeElement === input;
    const isValid = isValidMultiplier(multiplier);

    if (!isValid) {
      input.style.borderColor = INPUT_ERROR_COLOR;
      input.style.background = INPUT_DEFAULT_BG;
      input.style.boxShadow = 'none';
      return;
    }

    input.style.borderColor = isFocused ? INPUT_FOCUS_COLOR : INPUT_BORDER_COLOR;
    input.style.background = INPUT_DEFAULT_BG;
    input.style.boxShadow = 'none';
  }

  function findQtyInput() {
    return (
      document.querySelector('input[id^="unitAmount-"]') ||
      document.querySelector('input[aria-label="数量"]') ||
      document.querySelector('input[placeholder="数量"]')
    );
  }

  function findCloseLongButton() {
    const btns = Array.from(document.querySelectorAll('button'));
    return (
      btns.find((b) => {
        const t = (b.textContent || '').trim();
        return t.includes('平多') || t.toLowerCase().includes('close long');
      }) || null
    );
  }

  function findCloseShortButton() {
    const btns = Array.from(document.querySelectorAll('button'));
    return (
      btns.find((b) => {
        const t = (b.textContent || '').trim();
        return t.includes('平空') || t.toLowerCase().includes('close short');
      }) || null
    );
  }

  function findOrderbookRow(node) {
    if (!node) return null;
    return node.closest('#futuresOrderbook .row-content');
  }

  function findPriceNodeFromRow(row) {
    if (!row) return null;
    return row.querySelector('.ask-light.emit-price, .bid-light.emit-price');
  }

  function parsePrice(node) {
    const txt = (node.textContent || '').replace(/,/g, '').trim();
    return /^\d+(\.\d+)?$/.test(txt) ? txt : null;
  }

  function parseNumber(text) {
    if (text == null) return null;
    const n = Number(String(text).replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : null;
  }

  function readQtyMultiplierFromLocal() {
    try {
      const value = localStorage.getItem(LOCAL_QTY_MULTIPLIER_KEY);
      if (!value || !/^\d+$/.test(value) || Number(value) <= 0) return null;
      return value;
    } catch (_e) {
      return null;
    }
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

  function readQtyByDataTestId(testId) {
    const el = document.querySelector(`[data-testid="${testId}"]`);
    if (!el) return null;
    const txt = (el.textContent || '').replace(/,/g, '');
    const m = txt.match(/(\d+(?:\.\d+)?)/);
    if (!m) return null;
    return parseNumber(m[1]);
  }

  function readCloseableQtyByTestIds() {
    // Binance UI:
    // max-sell-amount => 卖出可平(平多)
    // max-buy-amount  => 买入可平(平空)
    const longQty = readQtyByDataTestId('max-sell-amount');
    const shortQty = readQtyByDataTestId('max-buy-amount');
    if (longQty == null && shortQty == null) return null;
    return { longQty, shortQty, qtySource: 'testid' };
  }

  function readCloseableQtyNearButton(button) {
    if (!button) return null;
    const btnRect = button.getBoundingClientRect();
    const root = button.closest('[class*="order"], [data-testid*="order"]') || document.body;
    let best = null;
    let bestScore = Infinity;
    const nodes = root.querySelectorAll('div, span, p, small');
    for (const node of nodes) {
      const text = (node.textContent || '').trim();
      if (!text.includes('可平')) continue;
      const m = text.match(/可平\s*([\d,]*\.?\d+)/);
      if (!m) continue;
      const qty = parseNumber(m[1]);
      if (!(qty >= 0)) continue;
      const r = node.getBoundingClientRect();
      if (!r || !Number.isFinite(r.left)) continue;
      const nodeX = (r.left + r.right) / 2;
      const btnX = (btnRect.left + btnRect.right) / 2;
      const dy = r.top - btnRect.bottom;
      if (dy < -16 || dy > 200) continue;
      const dx = Math.abs(nodeX - btnX);
      const score = dx + Math.abs(dy) * 2;
      if (score < bestScore) {
        bestScore = score;
        best = qty;
      }
    }
    return best;
  }

  function readCloseableQty(closeLongBtn, closeShortBtn) {
    const fromTestId = readCloseableQtyByTestIds();
    if (fromTestId) return fromTestId;
    return {
      longQty: readCloseableQtyNearButton(closeLongBtn),
      shortQty: readCloseableQtyNearButton(closeShortBtn),
      qtySource: 'near_button',
    };
  }

  function normalizeCloseSide(value) {
    return String(value || 'LONG').toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG';
  }

  function loadCloseSide() {
    return normalizeCloseSide(localStorage.getItem(LOCAL_CLOSE_SIDE_KEY) || DEFAULT_CLOSE_SIDE);
  }

  function saveCloseSide(value) {
    localStorage.setItem(LOCAL_CLOSE_SIDE_KEY, normalizeCloseSide(value));
  }

  function updateCloseSide(value) {
    saveCloseSide(value);
    renderPanel();
  }

  function readCloseContext() {
    const closeLongBtn = findCloseLongButton();
    const closeShortBtn = findCloseShortButton();
    const { longQty, shortQty, qtySource } = readCloseableQty(closeLongBtn, closeShortBtn);
    const hasLong = longQty > 0;
    const hasShort = shortQty > 0;
    return { closeLongBtn, closeShortBtn, longQty, shortQty, qtySource, hasLong, hasShort };
  }

  function resolveCloseAction() {
    const { closeLongBtn, closeShortBtn, longQty, shortQty, qtySource, hasLong, hasShort } =
      readCloseContext();

    // 双向持仓时按面板当前选择执行
    if (hasLong && hasShort) {
      const sideCfg = loadCloseSide();
      if (sideCfg === 'SHORT') {
        return { side: '平空', button: closeShortBtn, by: 'dual_panel', longQty, shortQty, qtySource };
      }
      return { side: '平多', button: closeLongBtn, by: 'dual_panel', longQty, shortQty, qtySource };
    }

    // 单向持仓时按当前有仓侧执行
    if (hasLong) return { side: '平多', button: closeLongBtn, by: 'single_long', longQty, shortQty, qtySource };
    if (hasShort) return { side: '平空', button: closeShortBtn, by: 'single_short', longQty, shortQty, qtySource };

    // 仓位信息读取失败时不执行，避免误平错误方向
    return null;
  }

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
    const input = findQtyInput();
    if (!input) return null;
    const step = input.getAttribute('step');
    return step && /^\d+(\.\d+)?$/.test(step) ? step : null;
  }

  function loadMultiplier() {
    const value = localStorage.getItem(LOCAL_QTY_MULTIPLIER_KEY);
    return isValidMultiplier(value) ? String(value) : DEFAULT_MULTIPLIER;
  }

  function saveMultiplier(value) {
    localStorage.setItem(LOCAL_QTY_MULTIPLIER_KEY, value);
  }

  function sanitizeMultiplier(value) {
    return isValidMultiplier(value) ? String(value).trim() : DEFAULT_MULTIPLIER;
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
    const sideLongBtn = panel.querySelector(`#${SIDE_LONG_ID}`);
    const sideShortBtn = panel.querySelector(`#${SIDE_SHORT_ID}`);
    const finalQty = minQty ? multiplyDecimalByInt(minQty, multiplier) : null;
    const closeSide = loadCloseSide();
    const { hasLong, hasShort } = readCloseContext();
    const closeMode = hasLong && hasShort ? 'dual' : hasLong ? 'single_long' : hasShort ? 'single_short' : 'unknown';

    if (minEl) minEl.textContent = minQty ? `最小 ${minQty}` : '最小量读取中';
    if (finalEl) {
      if (isValidMultiplier(multiplier) && finalQty) {
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
    if (sideLongBtn) {
      const isDisabled = closeMode === 'single_short';
      const isActive = closeMode === 'single_long' || (closeMode !== 'single_short' && closeSide === 'LONG');
      sideLongBtn.disabled = isDisabled;
      sideLongBtn.style.borderColor = isActive ? 'var(--color-Sell)' : 'var(--color-InputLine)';
      sideLongBtn.style.background = isActive ? 'var(--color-RedAlpha01)' : '#ffffff';
      sideLongBtn.style.color = isActive ? 'var(--color-Sell)' : '#5e6673';
      sideLongBtn.style.opacity = isDisabled ? '0.45' : '1';
      sideLongBtn.style.cursor = isDisabled ? 'not-allowed' : 'pointer';
    }
    if (sideShortBtn) {
      const isDisabled = closeMode === 'single_long';
      const isActive = closeMode === 'single_short' || (closeMode !== 'single_long' && closeSide === 'SHORT');
      sideShortBtn.disabled = isDisabled;
      sideShortBtn.style.borderColor = isActive ? 'var(--color-Buy)' : 'var(--color-InputLine)';
      sideShortBtn.style.background = isActive ? 'var(--color-GreenAlpha01)' : '#ffffff';
      sideShortBtn.style.color = isActive ? 'var(--color-Buy)' : '#5e6673';
      sideShortBtn.style.opacity = isDisabled ? '0.45' : '1';
      sideShortBtn.style.cursor = isDisabled ? 'not-allowed' : 'pointer';
    }
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
    spacer.style.margin = '8px 0 0 0';
    spacer.style.pointerEvents = 'none';

    if (spacer.parentElement !== host.parentElement) {
      host.parentElement.insertBefore(spacer, host.nextSibling);
    } else if (spacer.previousElementSibling !== host) {
      host.parentElement.insertBefore(spacer, host.nextSibling);
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
      panel.style.visibility = 'hidden';
      panel.style.pointerEvents = 'none';
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
    panel.style.visibility = 'visible';
    panel.style.pointerEvents = 'auto';
  }

  function positionPanel(panel) {
    const qtyInput = findQtyInput();
    const host = findQtyFormItem(qtyInput);
    const spacer = ensureSpacer(host, Math.max(panel.offsetHeight || 0, 76));
    const anchorRect = spacer?.getBoundingClientRect() || qtyInput?.getBoundingClientRect() || null;
    placePanelFloating(panel, anchorRect);
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
    panel.style.visibility = 'hidden';
    panel.innerHTML = [
      '<div style="display:flex;align-items:center;justify-content:flex-start;gap:8px;margin-bottom:6px;flex-wrap:wrap;">',
      '<span style="font-size:12px;font-weight:500;color:#5e6673;white-space:nowrap;">数量倍率</span>',
      `<div style="display:flex;align-items:center;gap:4px;margin-right:2px;">` +
        `<button id="${SIDE_SHORT_ID}" type="button" style="min-width:42px;height:24px;padding:0 8px;border-radius:6px;border:1px solid var(--color-InputLine);background:#ffffff;color:#5e6673;font-size:12px;line-height:22px;cursor:pointer;">平空</button>` +
        `<button id="${SIDE_LONG_ID}" type="button" style="min-width:42px;height:24px;padding:0 8px;border-radius:6px;border:1px solid var(--color-InputLine);background:#ffffff;color:#5e6673;font-size:12px;line-height:22px;cursor:pointer;">平多</button>` +
      '</div>',
      `<label style="display:flex;align-items:center;gap:6px;">` +
        `<button id="${DEC_ID}" type="button" style="width:24px;height:24px;padding:0;border-radius:6px;border:1px solid #d5d9e2;background:#ffffff;color:#5e6673;font-size:14px;line-height:22px;cursor:pointer;">-</button>` +
        `<button id="${INC_ID}" type="button" style="width:24px;height:24px;padding:0;border-radius:6px;border:1px solid #d5d9e2;background:#ffffff;color:#5e6673;font-size:14px;line-height:22px;cursor:pointer;">+</button>` +
        `<input id="${INPUT_ID}" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" style="width:56px;height:28px;padding:0 8px;border-radius:8px;border:1px solid ${INPUT_BORDER_COLOR};background:${INPUT_DEFAULT_BG};color:#1e2329;caret-color:${INPUT_FOCUS_COLOR};outline:none;font-size:14px;line-height:28px;transition:border-color .16s ease,background-color .16s ease,box-shadow .16s ease;">` +
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
    const sideLongBtn = panel.querySelector(`#${SIDE_LONG_ID}`);
    const sideShortBtn = panel.querySelector(`#${SIDE_SHORT_ID}`);
    if (input) {
      input.value = loadMultiplier();
      input.addEventListener('focus', () => {
        isEditingMultiplier = true;
        applyInputVisualState(input, input.value);
        input.select();
      });
      input.addEventListener('input', () => {
        const value = String(input.value || '').replace(/[^\d]/g, '');
        if (input.value !== value) input.value = value;
        if (isValidMultiplier(value)) {
          saveMultiplier(value);
        }
        const symbol = getCurrentSymbol() || '-';
        const minQty = (symbol !== '-' && readMinQtyFromAppData(symbol)) || readMinQtyFromQtyInput();
        refreshComputedInfo(panel, value, minQty);
        applyInputVisualState(input, value);
      });
      input.addEventListener('blur', () => {
        const value = String(input.value || '').trim();
        const normalized = sanitizeMultiplier(value);
        isEditingMultiplier = false;
        saveMultiplier(normalized);
        input.value = normalized;
        applyInputVisualState(input, normalized);
        renderPanel();
      });
      applyInputVisualState(input, input.value);
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
    if (sideLongBtn) {
      sideLongBtn.addEventListener('click', () => {
        updateCloseSide('LONG');
      });
    }
    if (sideShortBtn) {
      sideShortBtn.addEventListener('click', () => {
        updateCloseSide('SHORT');
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
      applyInputVisualState(input, multiplier);
    }
  }

  function resolveTargetQty() {
    const symbol = getCurrentSymbol();
    const minQty = (symbol && readMinQtyFromAppData(symbol)) || readMinQtyFromQtyInput();
    const localMultiplier = readQtyMultiplierFromLocal();
    if (localMultiplier && minQty) {
      const multipliedQty = multiplyDecimalByInt(minQty, localMultiplier);
      if (multipliedQty) {
        return { qty: multipliedQty, source: `LOCAL_MULTIPLIER(${localMultiplier}x)`, symbol };
      }
    }
    if (symbol && CFG.SYMBOL_QTY[symbol]) {
      return { qty: String(CFG.SYMBOL_QTY[symbol]), source: `SYMBOL_QTY(${symbol})`, symbol };
    }

    if (!CFG.AUTO_USE_MIN_QTY) return null;

    if (!minQty) return null;
    return { qty: minQty, source: 'AUTO_MIN_QTY', symbol };
  }

  // 使用捕获阶段监听，避免页面内部在冒泡阶段 stopPropagation 导致双击事件丢失
  document.addEventListener('dblclick', (e) => {
    try {
      const row = findOrderbookRow(e.target);
      if (!row) return;
      const priceNode = findPriceNodeFromRow(row);
      if (!priceNode) return;
      // 忽略脚本触发的程序化 click，避免日志噪音
      if (!e.isTrusted) return;

      if (CFG.DEBUG) {
        log('命中订单簿整行 dblclick', {
          targetClass: e.target?.className || '',
          targetText: (e.target?.textContent || '').trim().slice(0, 24),
        });
      }

      const now = Date.now();
      if (now - lastTs < CFG.COOLDOWN_MS) {
        if (CFG.DEBUG) warn('跳过：cooldown');
        return;
      }
      const clickedPrice = parsePrice(priceNode);
      if (!clickedPrice) {
        if (CFG.DEBUG) warn('跳过：价格解析失败');
        return;
      }

      const qtyInput = findQtyInput();
      if (!qtyInput) {
        warn('未找到数量输入框');
        return;
      }

      const action = resolveCloseAction();
      if (!action || !action.button) {
        warn('未找到可用平仓动作（无法识别当前可平方向）');
        return;
      }

      const qtyPlan = resolveTargetQty();
      if (!qtyPlan || !qtyPlan.qty) {
        warn('未找到可用数量来源（SYMBOL_QTY/AUTO_MIN_QTY）');
        return;
      }
      setInputValueReact(qtyInput, qtyPlan.qty);
      log(
        '已填数量',
        qtyPlan.qty,
        '来源',
        qtyPlan.source,
        'symbol',
        qtyPlan.symbol,
        '触发价格',
        clickedPrice,
        'action',
        action.side,
        'by',
        action.by,
        'qtySource',
        action.qtySource,
        'longQty',
        action.longQty,
        'shortQty',
        action.shortQty
      );

      if (CFG.SAFE_MODE) {
        lastTs = now;
        warn(`SAFE_MODE=true，仅填数量，不点击${action.side}`);
        return;
      }

      action.button.click();
      lastTs = now;
      log(`已点击${action.side}`);
    } catch (e2) {
      err('click handler 异常:', e2);
    }
  }, true);

  window.addEventListener('storage', (event) => {
    if (event.key === LOCAL_QTY_MULTIPLIER_KEY || event.key === LOCAL_CLOSE_SIDE_KEY) renderPanel();
  });

  setInterval(renderPanel, 1000);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderPanel, { once: true });
  } else {
    renderPanel();
  }

  window.__TM_CLOSE_LONG_DEBUG__ = {
    cfg: CFG,
    findQtyInput,
    findCloseLongButton,
    findCloseShortButton,
    findOrderbookRow,
    findPriceNodeFromRow,
    resolveCloseAction,
    renderPanel,
  };

  log('脚本加载完成', location.href);
})();
