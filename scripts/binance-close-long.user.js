// ==UserScript==
// @name         【自写】Binance 双击平仓
// @namespace    binance.close.long
// @icon         https://avatars.githubusercontent.com/u/5935568?s=128
// @version      1.2.9
// @author       jackhai9
// @description  双击订单簿任意列 -> 填数量 -> 自动平仓（双向持仓按配置侧，单向持仓按当前有仓侧）
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
    // 当同一币种 LONG/SHORT 同时有仓时(双向持仓时)，按此方向平仓：LONG 或 SHORT
    CLOSE_SIDE: 'LONG',
    // 防连点
    COOLDOWN_MS: 100,
    DEBUG: true,
  };
  const LOCAL_QTY_KEY = 'jh_binance_close_qty_preset';

  let lastTs = 0;

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

  function readQtyPresetFromLocal() {
    try {
      const value = localStorage.getItem(LOCAL_QTY_KEY);
      if (!value || !/^\d+(\.\d+)?$/.test(value)) return null;
      return value;
    } catch (_e) {
      return null;
    }
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

  function resolveCloseAction() {
    const closeLongBtn = findCloseLongButton();
    const closeShortBtn = findCloseShortButton();
    const { longQty, shortQty, qtySource } = readCloseableQty(closeLongBtn, closeShortBtn);
    const hasLong = longQty > 0;
    const hasShort = shortQty > 0;

    // 双向持仓时按配置侧执行
    if (hasLong && hasShort) {
      const sideCfg = normalizeCloseSide(CFG.CLOSE_SIDE);
      if (sideCfg === 'SHORT') {
        return { side: '平空', button: closeShortBtn, by: 'dual_cfg', longQty, shortQty, qtySource };
      }
      return { side: '平多', button: closeLongBtn, by: 'dual_cfg', longQty, shortQty, qtySource };
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

  function resolveTargetQty() {
    const symbol = getCurrentSymbol();
    const localPreset = readQtyPresetFromLocal();
    if (localPreset) {
      return { qty: localPreset, source: 'LOCAL_PRESET', symbol };
    }
    if (symbol && CFG.SYMBOL_QTY[symbol]) {
      return { qty: String(CFG.SYMBOL_QTY[symbol]), source: `SYMBOL_QTY(${symbol})`, symbol };
    }

    if (!CFG.AUTO_USE_MIN_QTY) return null;

    const minQty = (symbol && readMinQtyFromAppData(symbol)) || readMinQtyFromQtyInput();
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

  window.__TM_CLOSE_LONG_DEBUG__ = {
    cfg: CFG,
    findQtyInput,
    findCloseLongButton,
    findCloseShortButton,
    findOrderbookRow,
    findPriceNodeFromRow,
    resolveCloseAction,
  };

  log('脚本加载完成', location.href);
})();
