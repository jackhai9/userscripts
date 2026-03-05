// ==UserScript==
// @name         Binance 双击订单簿一键平多
// @namespace    binance.close.long
// @version      1.0.2
// @description  双击订单簿价格 -> 填数量 -> 自动点“平多”
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
      DASHUSDT: '0.002',
      // BTCUSDT: '0.001',
      // ETHUSDT: '0.01',
    },
    // 未配置 SYMBOL_QTY 时，是否自动使用该 symbol 的最小下单量
    AUTO_USE_MIN_QTY: true,
    // 防误触：需按住 Shift 再双击
    REQUIRE_SHIFT: true,
    // true=只填数量；false=填数量并自动点“平多”
    SAFE_MODE: false,
    // 防连点
    COOLDOWN_MS: 600,
    DEBUG: true,
  };

  let lastTs = 0;

  const PREFIX = '[双击订单簿一键平多]';

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

  function isOrderbookPriceNode(node) {
    if (!node) return null;
    return node.closest(
      '#futuresOrderbook .ask-light.emit-price, #futuresOrderbook .bid-light.emit-price'
    );
  }

  function parsePrice(node) {
    const txt = (node.textContent || '').replace(/,/g, '').trim();
    return /^\d+(\.\d+)?$/.test(txt) ? txt : null;
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
    if (symbol && CFG.SYMBOL_QTY[symbol]) {
      return { qty: String(CFG.SYMBOL_QTY[symbol]), source: `SYMBOL_QTY(${symbol})`, symbol };
    }

    if (!CFG.AUTO_USE_MIN_QTY) return null;

    const minQty = (symbol && readMinQtyFromAppData(symbol)) || readMinQtyFromQtyInput();
    if (!minQty) return null;
    return { qty: minQty, source: 'AUTO_MIN_QTY', symbol };
  }

  document.addEventListener('dblclick', (e) => {
    try {
      if (CFG.DEBUG) {
        log('捕获到 dblclick', {
          targetClass: e.target?.className || '',
          targetText: (e.target?.textContent || '').trim().slice(0, 24),
          shiftKey: e.shiftKey,
        });
      }

      const now = Date.now();
      if (now - lastTs < CFG.COOLDOWN_MS) {
        if (CFG.DEBUG) warn('跳过：cooldown');
        return;
      }
      if (CFG.REQUIRE_SHIFT && !e.shiftKey) {
        if (CFG.DEBUG) warn('跳过：需要按住 Shift');
        return;
      }

      const priceNode = isOrderbookPriceNode(e.target);
      if (!priceNode) {
        if (CFG.DEBUG) warn('跳过：不是订单簿价格节点');
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

      const closeLongBtn = findCloseLongButton();
      if (!closeLongBtn) {
        warn('未找到“平多”按钮');
        return;
      }

      const qtyPlan = resolveTargetQty();
      if (!qtyPlan || !qtyPlan.qty) {
        warn('未找到可用数量来源（SYMBOL_QTY/AUTO_MIN_QTY）');
        return;
      }
      setInputValueReact(qtyInput, qtyPlan.qty);
      log('已填数量', qtyPlan.qty, '来源', qtyPlan.source, 'symbol', qtyPlan.symbol, '触发价格', clickedPrice);

      if (CFG.SAFE_MODE) {
        lastTs = now;
        warn('SAFE_MODE=true，仅填数量，不点击平多');
        return;
      }

      closeLongBtn.click();
      lastTs = now;
      log('已点击平多');
    } catch (e2) {
      err('dblclick handler 异常:', e2);
    }
  });

  window.__TM_CLOSE_LONG_DEBUG__ = {
    cfg: CFG,
    findQtyInput,
    findCloseLongButton,
    isOrderbookPriceNode,
  };

  log('脚本加载完成', location.href);
})();
