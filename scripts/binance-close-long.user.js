// ==UserScript==
// @name         【自写】Binance 双击下单
// @namespace    binance.close.long
// @icon         https://avatars.githubusercontent.com/u/5935568?s=128
// @version      2.3.6
// @author       jackhai9
// @description  双击订单簿任意行 -> Binance 默认单击订单簿即填价格 -> 自动填数量(通过数量倍率) -> 自动执行开仓或平仓（按当前 tab 与面板所选侧）
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
    // true=只填数量；false=填数量并自动点“开多/开空/平多/平空”
    SAFE_MODE: false,
    // 防连点
    COOLDOWN_MS: 100,
    DEBUG: true,
  };
  const LOCAL_QTY_MULTIPLIER_KEY = 'jh_binance_close_qty_multiplier';
  const LOCAL_CLOSE_SIDE_KEY = 'jh_binance_close_side';
  const LOCAL_OPEN_SIDE_KEY = 'jh_binance_open_side';
  const PANEL_ID = 'jh-binance-close-qty-multiplier-panel';
  const SPACER_ID = 'jh-binance-close-qty-multiplier-spacer';
  const INPUT_ID = 'jh-binance-close-qty-multiplier-input';
  const DEC_ID = 'jh-binance-close-qty-multiplier-dec';
  const INC_ID = 'jh-binance-close-qty-multiplier-inc';
  const SIDE_LONG_ID = 'jh-binance-close-side-long';
  const SIDE_SHORT_ID = 'jh-binance-close-side-short';
  const DEFAULT_MULTIPLIER = '1';
  const DEFAULT_CLOSE_SIDE = 'LONG';
  const DEFAULT_OPEN_SIDE = 'LONG';
  const INPUT_BORDER_COLOR = 'var(--color-InputLine)';
  const INPUT_ERROR_COLOR = 'var(--color-Error)';
  const INPUT_FOCUS_COLOR = 'var(--color-PrimaryYellow)';
  const INPUT_DEFAULT_BG = 'transparent';

  let lastTs = 0;
  let isEditingMultiplier = false;

  const MODE_HINT_ID = 'jh-binance-trade-mode-hint';
  const NATIVE_ACTION_DISABLED_ATTR = 'data-jh-native-action-disabled';
  const PREFIX = '[双击下单]';

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

  function findPriceInput() {
    return (
      document.querySelector('input[id^="limitPrice-"]') ||
      document.querySelector('input[aria-label="委托价格"]') ||
      document.querySelector('input[placeholder="委托价格"]') ||
      null
    );
  }

  function isOwnPanelButton(button) {
    return !!button?.closest?.(`#${PANEL_ID}`);
  }

  function getActiveTradeMode() {
    const activeTab =
      document.querySelector('#position-direction [role="tab"][aria-selected="true"]') ||
      document.querySelector('.bn-tabs__buySell [role="tab"][aria-selected="true"]') ||
      document.querySelector('[role="tab"].bn-tab__buySell[aria-selected="true"]');
    const text = (activeTab?.textContent || '').trim();
    if (text.includes('开仓')) return 'OPEN';
    if (text.includes('平仓')) return 'CLOSE';
    return 'UNKNOWN';
  }

  function getCurrentOrderType() {
    const activeTab = document.querySelector('[role="tab"][aria-selected="true"][data-tab-key]');
    return String(activeTab?.getAttribute('data-tab-key') || 'LIMIT').toUpperCase();
  }

  function getActiveTradeTab() {
    return (
      document.querySelector('#position-direction [role="tab"][aria-selected="true"]') ||
      document.querySelector('.bn-tabs__buySell [role="tab"][aria-selected="true"]') ||
      document.querySelector('[role="tab"].bn-tab__buySell[aria-selected="true"]') ||
      null
    );
  }

  function isVisibleElement(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return !!(el.getClientRects().length && (el.offsetWidth || el.offsetHeight));
  }

  function buttonTextMatches(button, patterns) {
    const text = (button?.textContent || '').trim().toLowerCase();
    return patterns.some((pattern) => text.includes(pattern));
  }

  function getTradeSearchScopes(mode) {
    const activeTab = getActiveTradeTab();
    const scopes = [];
    const seen = new Set();
    const pushScope = (node) => {
      if (!node || seen.has(node)) return;
      seen.add(node);
      scopes.push(node);
    };

    const paneId = activeTab?.getAttribute('aria-controls');
    if (paneId) pushScope(document.getElementById(paneId));

    const tabRoot =
      activeTab?.closest('#position-direction') ||
      activeTab?.closest('.bn-tabs__buySell') ||
      activeTab?.parentElement ||
      null;
    if (tabRoot) {
      let node = tabRoot.parentElement;
      let depth = 0;
      while (node && node !== document.body && depth < 6) {
        pushScope(node);
        node = node.parentElement;
        depth += 1;
      }
    }

    pushScope(document.body);
    return scopes.filter((scope) => {
      const buttons = Array.from(scope.querySelectorAll('button')).filter((button) => {
        if (isOwnPanelButton(button) || !isVisibleElement(button)) return false;
        return mode === 'OPEN'
          ? buttonTextMatches(button, ['开多', 'open long', '开空', 'open short'])
          : buttonTextMatches(button, ['平多', 'close long', '平空', 'close short']);
      });
      return buttons.length > 0;
    });
  }

  function findTradeButton(patterns, mode) {
    const scopes = getTradeSearchScopes(mode);
    for (const scope of scopes) {
      const button = Array.from(scope.querySelectorAll('button')).find((candidate) => {
        if (isOwnPanelButton(candidate) || !isVisibleElement(candidate)) return false;
        return buttonTextMatches(candidate, patterns);
      });
      if (button) return button;
    }
    return null;
  }

  function findCloseLongButton() {
    return findTradeButton(['平多', 'close long'], 'CLOSE');
  }

  function findCloseShortButton() {
    return findTradeButton(['平空', 'close short'], 'CLOSE');
  }

  function findOpenLongButton() {
    return findTradeButton(['开多', 'open long'], 'OPEN');
  }

  function findOpenShortButton() {
    return findTradeButton(['开空', 'open short'], 'OPEN');
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

  function pow10(exp) {
    let result = 1n;
    for (let i = 0; i < exp; i += 1) result *= 10n;
    return result;
  }

  function parseDecimalString(value) {
    const raw = String(value || '').replace(/,/g, '').trim();
    if (!/^\d+(\.\d+)?$/.test(raw)) return null;
    const [intPart, fracPart = ''] = raw.split('.');
    return {
      digits: BigInt(intPart + fracPart),
      scale: fracPart.length,
    };
  }

  function formatDecimalParts(digits, scale) {
    const negative = digits < 0n;
    const absDigits = negative ? -digits : digits;
    const raw = absDigits.toString();
    if (scale === 0) return `${negative ? '-' : ''}${raw}`;
    const padded = raw.padStart(scale + 1, '0');
    const head = padded.slice(0, -scale) || '0';
    const tail = padded.slice(-scale).replace(/0+$/, '');
    return `${negative ? '-' : ''}${tail ? `${head}.${tail}` : head}`;
  }

  function normalizeDecimalString(value) {
    const parsed = parseDecimalString(value);
    return parsed ? formatDecimalParts(parsed.digits, parsed.scale) : null;
  }

  function compareDecimalStrings(a, b) {
    const left = parseDecimalString(a);
    const right = parseDecimalString(b);
    if (!left || !right) return null;
    const scale = Math.max(left.scale, right.scale);
    const leftDigits = left.digits * pow10(scale - left.scale);
    const rightDigits = right.digits * pow10(scale - right.scale);
    if (leftDigits === rightDigits) return 0;
    return leftDigits > rightDigits ? 1 : -1;
  }

  function maxDecimalString(a, b) {
    if (!a) return normalizeDecimalString(b);
    if (!b) return normalizeDecimalString(a);
    const cmp = compareDecimalStrings(a, b);
    if (cmp == null) return normalizeDecimalString(a) || normalizeDecimalString(b);
    return cmp >= 0 ? normalizeDecimalString(a) : normalizeDecimalString(b);
  }

  function ceilQtyByNotional(notional, price, stepSize) {
    const n = parseDecimalString(notional);
    const p = parseDecimalString(price);
    const s = parseDecimalString(stepSize);
    if (!n || !p || !s || p.digits <= 0n || s.digits <= 0n) return null;

    let numerator = n.digits;
    let denominator = p.digits * s.digits;
    const exp = p.scale + s.scale - n.scale;
    if (exp >= 0) {
      numerator *= pow10(exp);
    } else {
      denominator *= pow10(-exp);
    }

    const steps = (numerator + denominator - 1n) / denominator;
    return formatDecimalParts(steps * s.digits, s.scale);
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

  function loadOpenSide() {
    return normalizeCloseSide(localStorage.getItem(LOCAL_OPEN_SIDE_KEY) || DEFAULT_OPEN_SIDE);
  }

  function saveOpenSide(value) {
    localStorage.setItem(LOCAL_OPEN_SIDE_KEY, normalizeCloseSide(value));
  }

  function updateOpenSide(value) {
    saveOpenSide(value);
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

  function resolveOpenAction() {
    const openLongBtn = findOpenLongButton();
    const openShortBtn = findOpenShortButton();
    const sideCfg = loadOpenSide();
    if (sideCfg === 'SHORT') {
      return { side: '开空', button: openShortBtn, by: 'open_panel', mode: 'OPEN' };
    }
    return { side: '开多', button: openLongBtn, by: 'open_panel', mode: 'OPEN' };
  }

  function resolveTradeAction() {
    const mode = getActiveTradeMode();
    if (mode === 'OPEN') {
      return resolveOpenAction();
    }
    const closeAction = resolveCloseAction();
    return closeAction ? { ...closeAction, mode: 'CLOSE' } : null;
  }

  function getCurrentSymbol() {
    const m = location.pathname.match(/\/futures\/([A-Z0-9_]+)/i);
    if (m && m[1]) return m[1].toUpperCase();

    const title = document.title || '';
    const t = title.match(/([A-Z0-9_]{6,})\s+U/i);
    return t && t[1] ? t[1].toUpperCase() : null;
  }

  function readTradeRulesFromAppData(symbol) {
    try {
      const el = document.querySelector('#__APP_DATA');
      if (!el || !el.textContent) return null;
      const data = JSON.parse(el.textContent);
      const reactQueryData = data?.appState?.loader?.dataByRouteId?.bd56?.reactQueryData;
      const perpetual = reactQueryData?.productFutureService?.perpetual;
      const sInfo = perpetual?.[symbol];
      if (!sInfo) return null;
      const filters = Array.isArray(sInfo.f) ? sInfo.f : [];
      const lot = filters.find((x) => x && x.filterType === 'LOT_SIZE') || {};
      const marketLot = filters.find((x) => x && x.filterType === 'MARKET_LOT_SIZE') || {};
      const minNotional = filters.find((x) => x && x.filterType === 'MIN_NOTIONAL') || {};
      const markPrice = reactQueryData?.[`queryMarkPrice,${symbol}`]?.markPrice || null;
      return {
        limitMinQty: typeof lot.minQty === 'string' && lot.minQty ? lot.minQty : null,
        limitStepSize: typeof lot.stepSize === 'string' && lot.stepSize ? lot.stepSize : null,
        marketMinQty:
          typeof marketLot.minQty === 'string' && marketLot.minQty ? marketLot.minQty : null,
        marketStepSize:
          typeof marketLot.stepSize === 'string' && marketLot.stepSize ? marketLot.stepSize : null,
        minNotional:
          typeof minNotional.notional === 'string' && minNotional.notional ? minNotional.notional : null,
        markPrice: typeof markPrice === 'string' && markPrice ? markPrice : null,
      };
    } catch (_e) {
      return null;
    }
  }

  function readStepSizeFromQtyInput() {
    const input = findQtyInput();
    if (!input) return null;
    const step = input.getAttribute('step');
    return step && /^\d+(\.\d+)?$/.test(step) ? step : null;
  }

  function getReferencePrice(symbol, priceOverride) {
    const fromOverride = normalizeDecimalString(priceOverride);
    if (fromOverride) return fromOverride;

    const priceInput = findPriceInput();
    const fromInput = normalizeDecimalString(priceInput?.value || '');
    if (fromInput) return fromInput;

    const fromAppData = readTradeRulesFromAppData(symbol)?.markPrice;
    return normalizeDecimalString(fromAppData);
  }

  function getQtyRuleContext(symbol, tradeMode, priceOverride) {
    const rules = symbol ? readTradeRulesFromAppData(symbol) : null;
    const orderType = getCurrentOrderType();
    const isMarketOrder = orderType.includes('MARKET');
    const fallbackStep = readStepSizeFromQtyInput();
    const baseMinQty = normalizeDecimalString(
      (isMarketOrder ? rules?.marketMinQty : rules?.limitMinQty) ||
      rules?.limitMinQty ||
      fallbackStep
    );
    const stepSize = normalizeDecimalString(
      (isMarketOrder ? rules?.marketStepSize : rules?.limitStepSize) ||
      rules?.limitStepSize ||
      fallbackStep ||
      baseMinQty
    );
    const referencePrice = getReferencePrice(symbol, priceOverride);
    const minNotionalQty =
      tradeMode === 'OPEN' && rules?.minNotional && referencePrice && stepSize
        ? ceilQtyByNotional(rules.minNotional, referencePrice, stepSize)
        : null;
    const effectiveMinQty = maxDecimalString(baseMinQty, minNotionalQty);

    return {
      orderType,
      baseMinQty,
      stepSize,
      minNotional: normalizeDecimalString(rules?.minNotional),
      referencePrice,
      minNotionalQty,
      effectiveMinQty,
    };
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

  function setNativeActionButtonDisabled(button, disabled) {
    if (!button) return;
    if (disabled) {
      button.setAttribute(NATIVE_ACTION_DISABLED_ATTR, 'true');
      button.disabled = true;
      button.style.opacity = '0.45';
      button.style.filter = 'grayscale(1)';
      button.style.cursor = 'not-allowed';
      button.style.pointerEvents = 'none';
      return;
    }

    button.removeAttribute(NATIVE_ACTION_DISABLED_ATTR);
    button.disabled = false;
    button.style.opacity = '';
    button.style.filter = '';
    button.style.cursor = '';
    button.style.pointerEvents = '';
  }

  function restoreNativeActionButtons() {
    const buttons = document.querySelectorAll(`button[${NATIVE_ACTION_DISABLED_ATTR}="true"]`);
    for (const button of buttons) {
      setNativeActionButtonDisabled(button, false);
    }
  }

  function syncNativeCloseButtons(tradeMode, closeContext) {
    const { closeLongBtn, closeShortBtn, hasLong, hasShort } = closeContext;
    restoreNativeActionButtons();

    if (tradeMode !== 'CLOSE') {
      return;
    }

    setNativeActionButtonDisabled(closeLongBtn, hasShort);
    setNativeActionButtonDisabled(closeShortBtn, hasLong);
  }

  function refreshComputedInfo(panel, multiplier, qtyRuleContext) {
    const minEl = panel.querySelector('#jh-binance-close-qty-min');
    const finalEl = panel.querySelector('#jh-binance-close-qty-final');
    const hintEl = panel.querySelector(`#${MODE_HINT_ID}`);
    const decBtn = panel.querySelector(`#${DEC_ID}`);
    const incBtn = panel.querySelector(`#${INC_ID}`);
    const sideLongBtn = panel.querySelector(`#${SIDE_LONG_ID}`);
    const sideShortBtn = panel.querySelector(`#${SIDE_SHORT_ID}`);
    const tradeMode = getActiveTradeMode();
    const effectiveMinQty = qtyRuleContext?.effectiveMinQty || null;
    const finalQty = effectiveMinQty ? multiplyDecimalByInt(effectiveMinQty, multiplier) : null;
    const closeSide = loadCloseSide();
    const openSide = loadOpenSide();
    const closeContext = readCloseContext();
    const { hasLong, hasShort } = closeContext;
    const closeMode = hasLong && hasShort ? 'dual' : hasLong ? 'single_long' : hasShort ? 'single_short' : 'unknown';

    if (minEl) {
      if (tradeMode === 'OPEN' && qtyRuleContext?.minNotionalQty && qtyRuleContext?.referencePrice) {
        minEl.textContent = `有效最小 ${effectiveMinQty} (>=${qtyRuleContext.minNotional}U @ ${qtyRuleContext.referencePrice})`;
      } else if (effectiveMinQty) {
        minEl.textContent = `最小 ${effectiveMinQty}`;
      } else {
        minEl.textContent = '最小量读取中';
      }
    }
    if (finalEl) {
      if (isValidMultiplier(multiplier) && finalQty && effectiveMinQty) {
        finalEl.textContent = `${effectiveMinQty} x ${multiplier} = ${finalQty}`;
      } else {
        finalEl.textContent = '请输入正整数倍数';
      }
    }
    if (hintEl) {
      if (tradeMode === 'OPEN') {
        hintEl.textContent = `开仓模式：双击订单簿后将按面板所选侧${CFG.SAFE_MODE ? '填数量' : '开仓'}`;
      } else if (closeMode === 'single_long') {
        hintEl.textContent = `平仓模式：当前仅有多仓，双击订单簿后将${CFG.SAFE_MODE ? '填数量' : '平多'}`;
      } else if (closeMode === 'single_short') {
        hintEl.textContent = `平仓模式：当前仅有空仓，双击订单簿后将${CFG.SAFE_MODE ? '填数量' : '平空'}`;
      } else if (closeMode === 'dual') {
        hintEl.textContent = `平仓模式：双向持仓时按面板所选侧${CFG.SAFE_MODE ? '填数量' : '平仓'}`;
      } else {
        hintEl.textContent = '平仓模式：暂未识别到可平仓位';
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
      const isOpenMode = tradeMode === 'OPEN';
      const isDisabled = isOpenMode ? false : closeMode === 'single_short';
      const isActive = isOpenMode
        ? openSide === 'LONG'
        : closeMode === 'single_long' || (closeMode !== 'single_short' && closeSide === 'LONG');
      sideLongBtn.textContent = isOpenMode ? '开多' : '平多';
      sideLongBtn.style.order = isOpenMode ? '0' : '1';
      sideLongBtn.disabled = isDisabled;
      sideLongBtn.style.borderColor = isActive
        ? isOpenMode ? 'var(--color-Buy)' : 'var(--color-Sell)'
        : 'var(--color-InputLine)';
      sideLongBtn.style.background = isActive
        ? isOpenMode ? 'var(--color-GreenAlpha01)' : 'var(--color-RedAlpha01)'
        : '#ffffff';
      sideLongBtn.style.color = isActive
        ? isOpenMode ? 'var(--color-Buy)' : 'var(--color-Sell)'
        : '#5e6673';
      sideLongBtn.style.opacity = isDisabled ? '0.45' : '1';
      sideLongBtn.style.cursor = isDisabled ? 'not-allowed' : 'pointer';
    }
    if (sideShortBtn) {
      const isOpenMode = tradeMode === 'OPEN';
      const isDisabled = isOpenMode ? false : closeMode === 'single_long';
      const isActive = isOpenMode
        ? openSide === 'SHORT'
        : closeMode === 'single_short' || (closeMode !== 'single_long' && closeSide === 'SHORT');
      sideShortBtn.textContent = isOpenMode ? '开空' : '平空';
      sideShortBtn.style.order = isOpenMode ? '1' : '0';
      sideShortBtn.disabled = isDisabled;
      sideShortBtn.style.borderColor = isActive
        ? isOpenMode ? 'var(--color-Sell)' : 'var(--color-Buy)'
        : 'var(--color-InputLine)';
      sideShortBtn.style.background = isActive
        ? isOpenMode ? 'var(--color-RedAlpha01)' : 'var(--color-GreenAlpha01)'
        : '#ffffff';
      sideShortBtn.style.color = isActive
        ? isOpenMode ? 'var(--color-Sell)' : 'var(--color-Buy)'
        : '#5e6673';
      sideShortBtn.style.opacity = isDisabled ? '0.45' : '1';
      sideShortBtn.style.cursor = isDisabled ? 'not-allowed' : 'pointer';
    }

    syncNativeCloseButtons(tradeMode, closeContext);
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
      `<label style="display:flex;align-items:center;gap:6px;">` +
        `<button id="${INC_ID}" type="button" style="width:24px;height:24px;padding:0;border-radius:6px;border:1px solid #d5d9e2;background:#ffffff;color:#5e6673;font-size:14px;line-height:22px;cursor:pointer;">+</button>` +
        `<button id="${DEC_ID}" type="button" style="width:24px;height:24px;padding:0;border-radius:6px;border:1px solid #d5d9e2;background:#ffffff;color:#5e6673;font-size:14px;line-height:22px;cursor:pointer;">-</button>` +
        `<input id="${INPUT_ID}" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" style="width:56px;height:28px;padding:0 8px;border-radius:8px;border:1px solid ${INPUT_BORDER_COLOR};background:${INPUT_DEFAULT_BG};color:#1e2329;caret-color:${INPUT_FOCUS_COLOR};outline:none;font-size:14px;line-height:28px;transition:border-color .16s ease,background-color .16s ease,box-shadow .16s ease;">` +
      '</label>',
      `<div style="display:flex;align-items:center;gap:4px;margin-right:2px;">` +
        `<button id="${SIDE_SHORT_ID}" type="button" style="min-width:42px;height:24px;padding:0 8px;border-radius:6px;border:1px solid var(--color-InputLine);background:#ffffff;color:#5e6673;font-size:12px;line-height:22px;cursor:pointer;">平空</button>` +
        `<button id="${SIDE_LONG_ID}" type="button" style="min-width:42px;height:24px;padding:0 8px;border-radius:6px;border:1px solid var(--color-InputLine);background:#ffffff;color:#5e6673;font-size:12px;line-height:22px;cursor:pointer;">平多</button>` +
      '</div>',
      '</div>',
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">',
      '<span id="jh-binance-close-qty-min" style="color:#76808f;"></span>',
      '<span id="jh-binance-close-qty-final" style="font-weight:600;color:#1e2329;"></span>',
      '</div>',
      `<div id="${MODE_HINT_ID}" style="margin-top:6px;color:#76808f;"></div>`,
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
        const qtyRuleContext = getQtyRuleContext(symbol !== '-' ? symbol : null, getActiveTradeMode());
        refreshComputedInfo(panel, value, qtyRuleContext);
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
        if (getActiveTradeMode() === 'OPEN') {
          updateOpenSide('LONG');
          return;
        }
        updateCloseSide('LONG');
      });
    }
    if (sideShortBtn) {
      sideShortBtn.addEventListener('click', () => {
        if (getActiveTradeMode() === 'OPEN') {
          updateOpenSide('SHORT');
          return;
        }
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
    const qtyRuleContext = getQtyRuleContext(symbol !== '-' ? symbol : null, getActiveTradeMode());
    refreshComputedInfo(panel, multiplier, qtyRuleContext);
    if (input) {
      applyInputVisualState(input, multiplier);
    }
  }

  function resolveTargetQty(tradeMode, priceOverride) {
    const symbol = getCurrentSymbol();
    const qtyRuleContext = getQtyRuleContext(symbol, tradeMode, priceOverride);
    const minQty = qtyRuleContext?.effectiveMinQty || null;
    if (!minQty) return null;
    const multiplier = loadMultiplier();
    const qty = multiplyDecimalByInt(minQty, multiplier);
    if (!qty) return null;
    return {
      qty,
      source: `MULTIPLIER(${multiplier}x @ ${minQty})`,
      symbol,
      rule: qtyRuleContext,
    };
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

      const action = resolveTradeAction();
      if (!action || !action.button) {
        warn(`未找到可用${getActiveTradeMode() === 'OPEN' ? '开仓' : '平仓'}动作`);
        return;
      }

      const qtyPlan = resolveTargetQty(action.mode, clickedPrice);
      if (!qtyPlan || !qtyPlan.qty) {
        warn('未找到可用数量来源（数量倍率/有效最小量）');
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
        'effectiveMinQty',
        qtyPlan.rule?.effectiveMinQty,
        'referencePrice',
        qtyPlan.rule?.referencePrice,
        '触发价格',
        clickedPrice,
        'mode',
        action.mode,
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
    if (
      event.key === LOCAL_QTY_MULTIPLIER_KEY ||
      event.key === LOCAL_CLOSE_SIDE_KEY ||
      event.key === LOCAL_OPEN_SIDE_KEY
    ) renderPanel();
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
    findPriceInput,
    findCloseLongButton,
    findCloseShortButton,
    findOpenLongButton,
    findOpenShortButton,
    findOrderbookRow,
    findPriceNodeFromRow,
    resolveCloseAction,
    resolveTradeAction,
    resolveTargetQty,
    renderPanel,
  };

  log('脚本加载完成', location.href);
})();
