// ==UserScript==
// @name         【自写】Binance 订单簿单击下单
// @namespace    binance.orderbook.trade
// @icon         data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%23f0b90b%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2249%22%20text-anchor%3D%22middle%22%20font-family%3D%22Arial%2C%20sans-serif%22%20font-size%3D%2242%22%20font-weight%3D%22800%22%20fill%3D%22%23111827%22%3EJ%3C%2Ftext%3E%3C%2Fsvg%3E
// @icon64       data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%23f0b90b%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2249%22%20text-anchor%3D%22middle%22%20font-family%3D%22Arial%2C%20sans-serif%22%20font-size%3D%2242%22%20font-weight%3D%22800%22%20fill%3D%22%23111827%22%3EJ%3C%2Ftext%3E%3C%2Fsvg%3E
// @version      2.7.90
// @author       jackhai9
// @description  单击订单簿价格，按当前开仓/平仓 tab 自动填数量并执行下单，内置数量倍率面板
// @match        https://www.binance.com/*/futures/*
// @match        https://www.binance.com/futures/*
// @exclude      https://www.binance.com/*/my/wallet/futures/*
// @exclude      https://www.binance.com/my/wallet/futures/*
// @updateURL    https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-orderbook-trade.user.js
// @downloadURL  https://raw.githubusercontent.com/jackhai9/userscripts/main/scripts/binance-orderbook-trade.user.js
// @run-at       document-start
// @grant        none
// ==/UserScript==

import {
  hasCurrentSymbolOpenOrdersEvidence,
  isCurrentSymbolOpenOrdersClearCandidate,
  isCurrentSymbolOpenOrdersDefinitivelyClear,
  isOpenOrdersScopeConfirmedForSymbolText,
  isOpenOrdersScopeLimitedToSymbolText,
  normalizeText,
  parseOpenOrdersTabCount,
  readVisibleOpenOrderSymbolsText,
  shouldContinueOpenOrdersClearObservation,
  updateOpenOrdersClearStability,
} from './core/cancel-orders.js';
import {
  resolveCloseDisplayQuantities,
  resolveConfirmedCloseDirection,
} from './core/close-action.js';
import {
  observeAutoOpenLeveragePositionState,
  resolveSymbolPositionStatus,
} from './core/auto-open-leverage.js';
import {
  addDecimalStrings,
  ceilQtyByNotional,
  compareDecimalStrings,
  maxDecimalString,
  multiplyDecimalByInt,
  multiplyDecimalByRatio,
  normalizeDecimalString,
  subtractDecimalStrings,
  isDecimalAtLeast,
  isPositiveDecimalString,
} from './core/decimal.js';
import {
  collectNonZeroPriceMoves,
  formatOrderbookPrecisionShortcutLabel,
  getOrderbookPrecisionShortcutOptions,
  mergePrecisionSamples,
  recommendOrderbookPrecision,
  resolveOrderbookPrecisionSampleState,
} from './core/precision.js';
import { allocateLadderQuantities } from './core/quantity.js';
import {
  fitLadderPlanForMinimumQty,
  getLadderActionSpec as getLadderActionSpecData,
  getLadderPercentForMode,
} from './core/ladder-plan.js';
import {
  evaluateOrderSubmitAcknowledgement,
  getBinanceApiErrorCode,
  isBinancePlaceOrderSuccessPayload,
  isBinancePostOnlyMakerRejectCode,
  isOpenLadderOpenOrdersCapacityFeedback,
  isPostOnlyMakerRejectionFeedback,
  isReduceOnlyOpenOrdersConflictFeedback,
  isPotentialOrderFeedbackText,
} from './core/order-feedback.js';
import {
  isFuturesTradingPathname,
  parseFuturesTradingSymbolFromPathname,
} from '../shared/binance-futures-route.js';
import {
  findAccountPositionTab as findAccountPositionTabDom,
  findOpenOrdersBasicSubTab as findOpenOrdersBasicSubTabDom,
  findOpenOrdersConditionalSubTab as findOpenOrdersConditionalSubTabDom,
  findOpenOrdersTab as findOpenOrdersTabDom,
  findSelectedAccountOrdersTab as findSelectedAccountOrdersTabDom,
  findSelectedOpenOrdersSubTab as findSelectedOpenOrdersSubTabDom,
  getAccountOrdersTabGroup as getAccountOrdersTabGroupDom,
  getActiveOpenOrdersScope as getActiveOpenOrdersScopeDom,
  parseAccountPositionTabCount,
} from './dom/account-orders.js';
import {
  collectTradeButtonsFromScopes,
  findTradeFormRoot,
  findTradePanelInsertionPoint,
  findCurrentLeverageButtonFromScopes,
  isTradeActionButton as isTradeActionButtonDom,
  isTradeModeTab as isTradeModeTabDom,
  mutationTouchesCloseQuantity,
  parseLeverageButtonText,
  placeTradePanelSpacer,
} from './dom/trade-form.js';
import {
  planBufferedMakerPrices,
  repriceRemainingLadderOrders,
} from './core/orderbook.js';
import {
  isModeSymbolOptionStorageKey,
  isSymbolScopedSideStorageKey,
  loadModeSymbolPrecisionNumberOption,
  loadSymbolSide,
  migrateModeSymbolPrecisionNumberOption,
  modeSymbolPrecisionOptionStorageKey,
  saveModeSymbolPrecisionNumberOption,
  saveSymbolSide,
} from './core/panel-options.js';
import {
  CHART_ORDERS_RECOVERY_STORAGE_KEY,
  createChartOrdersRecoveryRecord,
  parseChartOrdersRecoveryRecord,
} from './core/chart-orders-recovery.js';
import { resolveCancelDialogDecision } from './core/cancel-dialog-decision.js';
import {
  classifyBinanceCancelAllDialogAction,
  classifyBinanceCancelAllDialogKeyboardAction,
  findBinanceCancelAllDialog,
} from './dom/cancel-all-dialog.js';
import {
  assertSameBinanceChartOrdersTarget,
  findActiveBinanceChartOrdersPopover,
  findBinanceChartOrdersTarget as findBinanceChartOrdersTargetDom,
  getBinanceChartOrdersTarget as getBinanceChartOrdersTargetDom,
} from './dom/chart-orders.js';

(function () {
  'use strict';

  function isFuturesTradingPage() {
    return isFuturesTradingPathname(location.pathname);
  }

  if (!isFuturesTradingPage()) return;

  const CFG = {
    // true=只填数量；false=填数量并自动点“开多/开空/平多/平空”
    SAFE_MODE: false,
    // Only suppress duplicate dispatch from the same physical click, not deliberate fast clicks.
    COOLDOWN_MS: 150,
    DEBUG: false,
  };
  const LOCAL_QTY_MULTIPLIER_PREFIX = 'jh_binance_qty_multiplier_v2';
  const LOCAL_CLOSE_SIDE_KEY = 'jh_binance_close_side';
  const LOCAL_OPEN_SIDE_KEY = 'jh_binance_open_side';
  const LOCAL_LADDER_EXPANDED_KEY = 'jh_binance_ladder_expanded';
  const LOCAL_LADDER_OPEN_PERCENT_KEY = 'jh_binance_ladder_open_percent';
  const LOCAL_LADDER_CLOSE_PERCENT_KEY = 'jh_binance_ladder_close_percent';
  const LOCAL_LADDER_OPEN_LEVELS_KEY = 'jh_binance_ladder_open_levels';
  const LOCAL_LADDER_CLOSE_LEVELS_KEY = 'jh_binance_ladder_close_levels';
  const LOCAL_LADDER_OPEN_STEP_KEY = 'jh_binance_ladder_open_step';
  const LOCAL_LADDER_CLOSE_STEP_KEY = 'jh_binance_ladder_close_step';
  const LOCAL_ORDERBOOK_PRECISION_SAMPLES_PREFIX = 'jh_binance_orderbook_precision_samples_v3';
  const BINANCE_PERSIST_KEY = 'persist:futures-trade-ui';
  const BINANCE_POST_ONLY_ORDER_TYPE = 'POST_ONLY';
  const BINANCE_POST_ONLY_TIME_IN_FORCE = 'GTC';
  const PANEL_ID = 'jh-binance-close-qty-multiplier-panel';
  const SPACER_ID = 'jh-binance-close-qty-multiplier-spacer';
  const INPUT_ID = 'jh-binance-close-qty-multiplier-input';
  const DEC_ID = 'jh-binance-close-qty-multiplier-dec';
  const INC_ID = 'jh-binance-close-qty-multiplier-inc';
  const SIDE_LONG_ID = 'jh-binance-close-side-long';
  const SIDE_SHORT_ID = 'jh-binance-close-side-short';
  const LADDER_TOGGLE_ID = 'jh-binance-ladder-toggle';
  const LADDER_BODY_ID = 'jh-binance-ladder-body';
  const LADDER_STATUS_ID = 'jh-binance-ladder-status';
  const ORDERBOOK_PRECISION_RECOMMENDATION_ID = 'jh-binance-orderbook-precision-recommendation';
  const DEFAULT_MULTIPLIER = '1';
  const DEFAULT_CLOSE_SIDE = 'LONG';
  const DEFAULT_OPEN_SIDE = 'LONG';
  const DEFAULT_LADDER_OPEN_PERCENT = 2;
  const DEFAULT_LADDER_CLOSE_PERCENT = 0.3;
  const DEFAULT_LADDER_LEVELS = 5;
  const DEFAULT_LADDER_STEP = 5;
  const LADDER_OPEN_PERCENTS = [2, 10, 30, 50, 70];
  const LADDER_CLOSE_PERCENTS = [0.3, 1, 5, 10, 30];
  const LADDER_LEVEL_OPTIONS = [3, 5, 7, 9];
  const LADDER_STEP_MIN = 1;
  const LADDER_STEP_MAX = 5;
  const LADDER_STEP_OPTIONS = [1, 2, 3, 4, 5];
  const MULTIPLIER_STORAGE_KEYS = {
    OPEN: `${LOCAL_QTY_MULTIPLIER_PREFIX}:OPEN`,
    CLOSE: `${LOCAL_QTY_MULTIPLIER_PREFIX}:CLOSE`,
  };
  const LADDER_PERCENT_STORAGE_KEYS = {
    OPEN: LOCAL_LADDER_OPEN_PERCENT_KEY,
    CLOSE: LOCAL_LADDER_CLOSE_PERCENT_KEY,
  };
  const LADDER_LEVELS_STORAGE_KEYS = {
    OPEN: LOCAL_LADDER_OPEN_LEVELS_KEY,
    CLOSE: LOCAL_LADDER_CLOSE_LEVELS_KEY,
  };
  const LADDER_STEP_STORAGE_KEYS = {
    OPEN: LOCAL_LADDER_OPEN_STEP_KEY,
    CLOSE: LOCAL_LADDER_CLOSE_STEP_KEY,
  };
  const LADDER_OPTION_STORAGE_KEYS = [
    LOCAL_LADDER_OPEN_PERCENT_KEY,
    LOCAL_LADDER_CLOSE_PERCENT_KEY,
    LOCAL_LADDER_OPEN_LEVELS_KEY,
    LOCAL_LADDER_CLOSE_LEVELS_KEY,
    LOCAL_LADDER_OPEN_STEP_KEY,
    LOCAL_LADDER_CLOSE_STEP_KEY,
  ];
  const LADDER_ORDER_DELAY_MS = 520;
  const LADDER_SUBMIT_ACK_TIMEOUT_MS = 3500;
  const LADDER_SUBMIT_POLL_MS = 80;
  const LADDER_REPLACE_OPEN_ORDERS_CLEAR_TIMEOUT_MS = 6500;
  const CANCEL_OPEN_ORDERS_CLEAR_SETTLE_MS = 1200;
  const CANCEL_DIALOG_CLOSE_TIMEOUT_MS = 60000;
  const CANCEL_DIALOG_DISCOVERY_TIMEOUT_MS = 1800;
  const CANCEL_DIALOG_DECISION_POLL_MS = 50;
  const CHART_ORDERS_MENU_TIMEOUT_MS = 1800;
  const CHART_ORDERS_MENU_POLL_MS = 50;
  const LADDER_MAKER_BUFFER_LEVELS = 1;
  const LADDER_REPRICE_MAX_ATTEMPTS = 5;
  const LADDER_REPRICE_DELAY_MS = 180;
  const BINANCE_PLACE_ORDER_BAPI_PATH = '/bapi/futures/v1/private/future/order/place-order';
  const BINANCE_USER_POSITION_BAPI_PATH = '/bapi/futures/v6/private/future/user-data/user-position';
  const LADDER_OPEN_QTY_READY_TIMEOUT_MS = 1200;
  const LADDER_OPEN_QTY_POLL_MS = 80;
  const SINGLE_ORDER_PRICE_SYNC_DELAY_MS = 90;
  const SINGLE_ORDER_QTY_SYNC_DELAY_MS = 120;
  const ORDERBOOK_PRECISION_MANUAL_SAMPLE_DURATION_MS = 6000;
  const ORDERBOOK_PRECISION_SAMPLE_DURATION_MS = ORDERBOOK_PRECISION_MANUAL_SAMPLE_DURATION_MS;
  const ORDERBOOK_PRECISION_SAMPLE_POLL_MS = 300;
  const ORDERBOOK_PRECISION_READY_POLL_MS = 100;
  const ORDERBOOK_PRECISION_READY_TIMEOUT_MS = 5000;
  const ORDERBOOK_PRECISION_OPTION_WAIT_MS = 1200;
  const ORDERBOOK_PRECISION_MIN_TRADE_PRICE_ROWS = 6;
  const ORDERBOOK_PRECISION_SAMPLE_MAX = 96;
  const ORDERBOOK_PRECISION_SHORTCUT_LIMIT = 4;
  const ORDERBOOK_PRECISION_CANDIDATE_OPTIONS = [
    '0.00000001',
    '0.0000001',
    '0.000001',
    '0.00001',
    '0.0001',
    '0.001',
    '0.01',
    '0.1',
    '1',
    '10',
    '100',
    '1000',
  ];
  const DEFAULT_OPEN_LEVERAGE = 2;
  const AUTO_OPEN_LEVERAGE_DELAY_MS = 120;
  const AUTO_OPEN_LEVERAGE_DEDUPE_MS = 1200;
  const DOM_LOOKUP_CACHE_MS = 250;
  const INPUT_BORDER_COLOR = 'var(--color-InputLine)';
  const INPUT_ERROR_COLOR = 'var(--color-Error)';
  const INPUT_FOCUS_COLOR = 'var(--color-PrimaryYellow)';
  const INPUT_DEFAULT_BG = 'transparent';
  const PRIMARY_EMPHASIS_COLOR = '#000000';
  const PRIMARY_EMPHASIS_FONT_WEIGHT = '500';
  const CONTROL_BORDER_COLOR = '#d5d9e2';
  const CONTROL_BACKGROUND_COLOR = '#ffffff';
  const CONTROL_TEXT_COLOR = '#5e6673';
  const CONTROL_FONT_WEIGHT = '500';
  const MUTED_TEXT_COLOR = '#76808f';
  const NEUTRAL_CONTROL_STYLE = `border-color:${CONTROL_BORDER_COLOR};background:${CONTROL_BACKGROUND_COLOR};color:${CONTROL_TEXT_COLOR};font-weight:${CONTROL_FONT_WEIGHT};cursor:pointer;opacity:1;`;
  const DISABLED_CONTROL_BORDER = CONTROL_BORDER_COLOR;
  const DISABLED_CONTROL_BG = '#f5f5f5';
  const DISABLED_CONTROL_TEXT = '#b7bdc6';
  const DISABLED_CONTROL_OPACITY = '0.65';
  const LADDER_CONTROL_BUTTON_HEIGHT = 32;
  const LADDER_CONTROL_BUTTON_FONT_SIZE = 14;
  const PANEL_BOTTOM_TOOLTIP_GAP = 12;

  let lastTs = 0;
  let isEditingMultiplier = false;
  let multiplierEditContext = null;
  let renderPanelQueued = false;
  let renderPanelFollowUpTimer = 0;
  let tradeUiMutationObserver = null;
  let tradeUiMutationTimeout = 0;
  let tradeUiMutationDebounceTimer = 0;
  let tradeModeTabObserver = null;
  let tradeModeTabObserverRoot = null;
  let accountPositionObserver = null;
  let accountPositionObserverRoot = null;
  let lastObservedAccountPositionCount = null;
  let lastObservedAccountPositionState = null;
  let lastConfirmedCloseState = null;  // 第三层：已确认的稳定缓存（仅 CLOSE 模式下写入）
  let lastDisplayCloseState = null;   // 第二层：仅供脚本面板展示的缓存态
  let closeGuard = null;              // 切 tab 快照门控（OPEN→CLOSE 时创建，500ms 后过期）
  let autoOpenLeverageTask = null;
  let pendingAutoOpenLeverageReset = null;
  let autoOpenLeveragePositionCheckTask = null;
  let pendingAutoOpenLeveragePositionCheck = null;
  let lastAutoOpenLeverage = { symbol: null, at: 0 };
  let tradeButtonCache = { mode: null, expiresAt: 0, buttons: [] };
  let tradeScopeCache = { activeTab: null, expiresAt: 0, scopes: [] };
  let ladderTask = null;
  let cancelCurrentSymbolOpenOrdersTask = null;
  let chartOrdersRecoveryPendingAtStartup =
    sessionStorage.getItem(CHART_ORDERS_RECOVERY_STORAGE_KEY) !== null;
  let chartOrdersRecoveryTask = null;
  let chartOrdersRecoveryLastError = null;
  let ladderStopRequested = false;
  let ladderStatusText = '空闲';
  let ladderPanelBodySignature = '';
  let panelPositionSignature = '';
  let ladderSubmitCaptureSequence = 0;
  let activeLadderSubmitCapture = null;
  let orderbookPrecisionSampling = false;
  let orderbookPrecisionSampleTimer = 0;
  let orderbookPrecisionActiveRequest = null;
  let orderbookPrecisionPendingRequest = null;
  let orderbookPrecisionSelectionTask = null;
  let orderbookPrecisionOptionsLoadRequestedSymbol = null;
  let orderbookPrecisionOptionsLoadAttemptedSymbol = null;
  let orderbookPrecisionObserver = null;
  let orderbookPrecisionObserverRoot = null;
  let lastObservedOrderbookPrecision = null;
  const orderbookPrecisionInitialSampledSymbols = new Set();
  let orderbookPrecisionState = {
    symbol: null,
    samples: [],
    recommendation: null,
    current: null,
    nativeOptions: [],
    nativeOptionsStatus: null,
    status: '采样中',
    sampleEndsAt: 0,
  };
  const controlledNativeButtons = new Set();
  let lastObservedSymbol = getCurrentSymbol();

  const MODE_HINT_ID = 'jh-binance-trade-mode-hint';
  const MULTIPLIER_HINT_ID = 'jh-binance-qty-multiplier-hint';
  const NATIVE_ACTION_DISABLED_ATTR = 'data-jh-native-action-disabled';
  const PREFIX = '[订单簿下单]';

  // A single disabled-state contract covers controlled Binance buttons and every panel button,
  // including future controls that correctly use the native disabled attribute.
  (function injectDisabledControlStyle() {
    const styleId = 'jh-disabled-control-style';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      button[${NATIVE_ACTION_DISABLED_ATTR}="true"],
      #${PANEL_ID} button:disabled {
        background: ${DISABLED_CONTROL_BG} !important;
        color: ${DISABLED_CONTROL_TEXT} !important;
        border-color: ${DISABLED_CONTROL_BORDER} !important;
        opacity: ${DISABLED_CONTROL_OPACITY} !important;
        font-weight: ${CONTROL_FONT_WEIGHT} !important;
        cursor: not-allowed !important;
      }
      button[${NATIVE_ACTION_DISABLED_ATTR}="true"] {
        pointer-events: none !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  })();

  function emit(level, ...args) {
    if (!CFG.DEBUG && level !== 'ERR') return;
    // Do not switch this back to console.log/warn/info/debug.
    // Binance page code mutes those methods to noop when enableLog is absent,
    // so our own logs would disappear from DevTools again.
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

  function parseJsonSafe(raw) {
    if (!raw || typeof raw !== 'string') return null;
    try {
      return JSON.parse(raw);
    } catch (_e) {
      return null;
    }
  }

  function parsePersistedField(state, key) {
    const value = state?.[key];
    if (typeof value === 'string') return parseJsonSafe(value) || {};
    return value && typeof value === 'object' ? value : {};
  }

  function readPersistedBinanceOrderForm() {
    try {
      const state = parseJsonSafe(window.localStorage?.getItem(BINANCE_PERSIST_KEY));
      return parsePersistedField(state, 'futuresOrderForm');
    } catch (_e) {
      return {};
    }
  }

  function isPersistedPostOnlyOrderType() {
    const form = readPersistedBinanceOrderForm();
    return (
      form.orderType === BINANCE_POST_ONLY_ORDER_TYPE &&
      form.subOrderType === BINANCE_POST_ONLY_ORDER_TYPE
    );
  }

  function ensurePostOnlyPreferencePersisted() {
    try {
      const raw = window.localStorage?.getItem(BINANCE_PERSIST_KEY);
      const state = parseJsonSafe(raw) || {};
      const form = parsePersistedField(state, 'futuresOrderForm');
      const nextForm = {
        ...form,
        orderType: BINANCE_POST_ONLY_ORDER_TYPE,
        subOrderType: BINANCE_POST_ONLY_ORDER_TYPE,
        timeInForce: BINANCE_POST_ONLY_TIME_IN_FORCE,
      };

      if (
        form.orderType === nextForm.orderType &&
        form.subOrderType === nextForm.subOrderType &&
        form.timeInForce === nextForm.timeInForce
      ) {
        return { ok: true, changed: false };
      }

      const nextState = {
        ...state,
        futuresOrderForm: JSON.stringify(nextForm),
        _persist: state._persist || JSON.stringify({ version: 1, rehydrated: true }),
      };
      window.localStorage?.setItem(BINANCE_PERSIST_KEY, JSON.stringify(nextState));
      return { ok: true, changed: true };
    } catch (e) {
      return { ok: false, changed: false, error: e };
    }
  }

  const postOnlyPreferenceInit = ensurePostOnlyPreferencePersisted();
  if (!postOnlyPreferenceInit.ok) {
    warn('无法写入只做Maker偏好', postOnlyPreferenceInit.error);
  } else if (postOnlyPreferenceInit.changed) {
    log('已写入只做Maker偏好，Binance 会在页面初始化时读取');
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

  function delay(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function isLadderExpanded() {
    return localStorage.getItem(LOCAL_LADDER_EXPANDED_KEY) === 'true';
  }

  function setLadderExpanded(expanded) {
    localStorage.setItem(LOCAL_LADDER_EXPANDED_KEY, expanded ? 'true' : 'false');
    scheduleRenderPanel();
  }

  function getLadderOpenPercent(
    symbol = getCurrentSymbol(),
    precision = readCurrentOrderbookPrecisionValue(),
  ) {
    return loadModeSymbolPrecisionNumberOption(
      localStorage,
      LADDER_PERCENT_STORAGE_KEYS,
      'OPEN',
      symbol,
      precision,
      LADDER_OPEN_PERCENTS,
      DEFAULT_LADDER_OPEN_PERCENT
    );
  }

  function setLadderOpenPercent(
    value,
    symbol = getCurrentSymbol(),
    precision = readCurrentOrderbookPrecisionValue(),
  ) {
    const saved = saveModeSymbolPrecisionNumberOption(
      localStorage,
      LADDER_PERCENT_STORAGE_KEYS,
      'OPEN',
      symbol,
      precision,
      value,
      LADDER_OPEN_PERCENTS
    );
    if (!saved) return false;
    scheduleRenderPanel();
    return true;
  }

  function getLadderClosePercent(
    symbol = getCurrentSymbol(),
    precision = readCurrentOrderbookPrecisionValue(),
  ) {
    const migrated = migrateModeSymbolPrecisionNumberOption(
      localStorage,
      LADDER_PERCENT_STORAGE_KEYS,
      'CLOSE',
      symbol,
      precision,
      100,
      DEFAULT_LADDER_CLOSE_PERCENT,
      LADDER_CLOSE_PERCENTS,
    );
    if (migrated) {
      setLadderStatus(`平仓量 100% 已调整为 ${DEFAULT_LADDER_CLOSE_PERCENT}%`);
    }
    return loadModeSymbolPrecisionNumberOption(
      localStorage,
      LADDER_PERCENT_STORAGE_KEYS,
      'CLOSE',
      symbol,
      precision,
      LADDER_CLOSE_PERCENTS,
      DEFAULT_LADDER_CLOSE_PERCENT
    );
  }

  function setLadderClosePercent(
    value,
    symbol = getCurrentSymbol(),
    precision = readCurrentOrderbookPrecisionValue(),
  ) {
    const saved = saveModeSymbolPrecisionNumberOption(
      localStorage,
      LADDER_PERCENT_STORAGE_KEYS,
      'CLOSE',
      symbol,
      precision,
      value,
      LADDER_CLOSE_PERCENTS
    );
    if (!saved) return false;
    scheduleRenderPanel();
    return true;
  }

  function getLadderLevels(
    mode = getActiveTradeMode(),
    symbol = getCurrentSymbol(),
    precision = readCurrentOrderbookPrecisionValue(),
  ) {
    return loadModeSymbolPrecisionNumberOption(
      localStorage,
      LADDER_LEVELS_STORAGE_KEYS,
      mode,
      symbol,
      precision,
      LADDER_LEVEL_OPTIONS,
      DEFAULT_LADDER_LEVELS
    );
  }

  function setLadderLevels(
    value,
    mode = getActiveTradeMode(),
    symbol = getCurrentSymbol(),
    precision = readCurrentOrderbookPrecisionValue(),
  ) {
    const saved = saveModeSymbolPrecisionNumberOption(
      localStorage,
      LADDER_LEVELS_STORAGE_KEYS,
      mode,
      symbol,
      precision,
      value,
      LADDER_LEVEL_OPTIONS
    );
    if (!saved) return false;
    scheduleRenderPanel();
    return true;
  }

  function getLadderStep(
    mode = getActiveTradeMode(),
    symbol = getCurrentSymbol(),
    precision = readCurrentOrderbookPrecisionValue(),
  ) {
    return loadModeSymbolPrecisionNumberOption(
      localStorage,
      LADDER_STEP_STORAGE_KEYS,
      mode,
      symbol,
      precision,
      LADDER_STEP_OPTIONS,
      DEFAULT_LADDER_STEP
    );
  }

  function setLadderStep(
    value,
    mode = getActiveTradeMode(),
    symbol = getCurrentSymbol(),
    precision = readCurrentOrderbookPrecisionValue(),
  ) {
    const numericValue = Number(value);
    if (!Number.isInteger(numericValue)) return false;
    const normalizedValue = Math.max(LADDER_STEP_MIN, Math.min(numericValue, LADDER_STEP_MAX));
    const saved = saveModeSymbolPrecisionNumberOption(
      localStorage,
      LADDER_STEP_STORAGE_KEYS,
      mode,
      symbol,
      precision,
      normalizedValue,
      LADDER_STEP_OPTIONS
    );
    if (!saved) return false;
    scheduleRenderPanel();
    return true;
  }

  function setLadderStatus(text, title = null) {
    ladderStatusText = String(text || '空闲');
    const statusEl = document.getElementById(LADDER_STATUS_ID);
    if (statusEl) {
      statusEl.textContent = ladderStatusText;
      statusEl.title = String(title || ladderStatusText);
    }
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
    const activeTab = findVisibleTradeScopeElement(
      '[role="tab"][aria-selected="true"][data-tab-key]',
      (tab) => !isTradeModeTab(tab)
    );
    return String(activeTab?.getAttribute('data-tab-key') || 'LIMIT').toUpperCase();
  }

  function isPostOnlyOrderTypeActive() {
    const orderType = getCurrentOrderType();
    if (!orderType.includes('CONDITIONAL') && !orderType.includes(BINANCE_POST_ONLY_ORDER_TYPE)) return false;
    return !!findVisibleTradeScopeElement(
      '[role="tab"], [role="combobox"], .bn-select-field-input, .bn-select-trigger, .bn-select-field',
      (el) => /只做Maker|Post Only/i.test((el.textContent || '').replace(/\s+/g, ' ').trim())
    );
  }

  function getActiveTradeTab() {
    return (
      document.querySelector('#position-direction [role="tab"][aria-selected="true"]') ||
      document.querySelector('.bn-tabs__buySell [role="tab"][aria-selected="true"]') ||
      document.querySelector('[role="tab"].bn-tab__buySell[aria-selected="true"]') ||
      null
    );
  }

  function isTradeModeTab(node) {
    return isTradeModeTabDom(node, { panelId: PANEL_ID });
  }

  function isVisibleElement(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rects = Array.from(el.getClientRects());
    if (!rects.length) return false;
    if (el.offsetWidth || el.offsetHeight) return true;
    return rects.some((rect) => rect.width > 0 && rect.height > 0);
  }

  function buttonTextMatches(button, patterns) {
    const text = (button?.textContent || '').trim().toLowerCase();
    return patterns.some((pattern) => text.includes(pattern));
  }

  function isTradeActionButton(node) {
    return isTradeActionButtonDom(node, { panelId: PANEL_ID });
  }

  function isTradeUiNode(node) {
    if (!(node instanceof Element)) return false;
    if (node.closest(`#${PANEL_ID}`) || node.closest(`#${SPACER_ID}`)) return false;
    if (isTradeModeTab(node) || isTradeActionButton(node)) return true;
    return !!node.closest(
      '#position-direction, .bn-tabs__buySell, [data-testid="max-sell-amount"], [data-testid="max-buy-amount"], input[id^="unitAmount-"], input[id^="limitPrice-"]'
    );
  }

  function mutationTouchesTradeUi(mutation) {
    if (!mutation) return false;
    if (mutation.type === 'attributes') {
      return isTradeUiNode(mutation.target);
    }
    if (mutation.type === 'characterData') {
      return isTradeUiNode(mutation.target?.parentElement || null);
    }
    if (mutation.type === 'childList') {
      if (isTradeUiNode(mutation.target)) return true;
      for (const node of mutation.addedNodes || []) {
        if (isTradeUiNode(node)) return true;
        if (node instanceof Element && node.querySelector?.(
          '#position-direction [role="tab"], .bn-tabs__buySell [role="tab"], [data-testid="max-sell-amount"], [data-testid="max-buy-amount"], input[id^="unitAmount-"], input[id^="limitPrice-"], button'
        )) {
          return true;
        }
      }
    }
    return false;
  }

  function invalidateTradeButtonCache() {
    tradeButtonCache = { mode: null, expiresAt: 0, buttons: [] };
    tradeScopeCache = { activeTab: null, expiresAt: 0, scopes: [] };
  }

  function getTradeSearchScopes() {
    const now = Date.now();
    const activeTab = getActiveTradeTab();
    if (
      tradeScopeCache.activeTab === activeTab &&
      tradeScopeCache.expiresAt > now &&
      tradeScopeCache.scopes.every((scope) => scope?.isConnected)
    ) {
      return tradeScopeCache.scopes;
    }

    const scopes = [];
    const seen = new Set();
    const pushScope = (node) => {
      if (!node || seen.has(node)) return;
      seen.add(node);
      scopes.push(node);
    };

    const tradeFormRoot = findTradeFormRoot(activeTab, findQtyInput());
    pushScope(tradeFormRoot);

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

    tradeScopeCache = activeTab && scopes.length
      ? {
        activeTab,
        expiresAt: now + DOM_LOOKUP_CACHE_MS,
        scopes,
      }
      : { activeTab: null, expiresAt: 0, scopes: [] };
    return scopes;
  }

  function findVisibleElementInScopes(scopes, selector, predicate = () => true) {
    const seen = new Set();
    for (const scope of scopes) {
      if (!scope) continue;
      for (const el of scope.querySelectorAll(selector)) {
        if (seen.has(el) || !isVisibleElement(el) || el.closest(`#${PANEL_ID}`)) continue;
        seen.add(el);
        if (predicate(el)) return el;
      }
    }
    return null;
  }

  function findVisibleTradeScopeElement(selector, predicate) {
    return findVisibleElementInScopes(getTradeSearchScopes(), selector, predicate);
  }

  function getTradeMutationRoot() {
    return findTradeFormRoot(getActiveTradeTab(), findQtyInput());
  }

  function collectTradeButtons(mode) {
    const now = Date.now();
    if (tradeButtonCache.mode === mode && tradeButtonCache.expiresAt > now) {
      return tradeButtonCache.buttons;
    }

    const buttons = collectTradeButtonsFromScopes(getTradeSearchScopes(), mode, {
      panelId: PANEL_ID,
      isVisibleElement,
    });

    tradeButtonCache = {
      mode,
      expiresAt: now + DOM_LOOKUP_CACHE_MS,
      buttons,
    };
    return buttons;
  }

  function findTradeButton(patterns, mode) {
    return collectTradeButtons(mode).find((candidate) => buttonTextMatches(candidate, patterns)) || null;
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

  // ── bapi header 缓存 ──
  // Binance 前端通过内部模块在调用 fetch 时注入鉴权 header（csrftoken、bnc-uuid 等），
  // 这些值不在 cookie/localStorage 里，JS 无法直接读取。
  // 策略：拦截 window.fetch，从 Binance 自身发出的 bapi 请求里缓存 header，
  // 后续 adjustLeverageApi 复用这些 header。
  let cachedBncHeaders = null;
  const HEADER_KEYS_TO_CACHE = [
    'csrftoken', 'bnc-uuid', 'device-info', 'fvideo-id',
    'clienttype', 'x-passthrough-token',
  ];

  function readHeaderValue(headers, key) {
    if (!headers) return null;
    // Headers 实例：只能用 .get()
    if (typeof headers.get === 'function') {
      return headers.get(key) || headers.get(key.toUpperCase()) || null;
    }
    // 普通对象：直接读属性
    return headers[key]
      || headers[key.toUpperCase()]
      || headers[key.toLowerCase()]
      || null;
  }

  function extractHeadersFromFetchArgs(args) {
    // fetch(url, { headers }) 或 fetch(Request, { headers })
    const url = getFetchRequestUrl(args);
    if (!url.includes('/bapi/')) return null;

    // headers 可能在 args[1] 或 args[0]（Request 对象）上
    let headers = args[1]?.headers;
    if (!headers && args[0] instanceof Request) {
      headers = args[0].headers;
    }
    if (!headers) return null;

    const snapshot = {};
    for (const key of HEADER_KEYS_TO_CACHE) {
      const val = readHeaderValue(headers, key);
      if (val != null && val !== '') snapshot[key] = val;
    }
    return snapshot.csrftoken ? snapshot : null;
  }

  function getFetchRequestUrl(args) {
    return typeof args[0] === 'string' ? args[0]
      : (args[0] instanceof Request ? args[0].url : args[0]?.url || '');
  }

  function isBinancePlaceOrderRequestUrl(rawUrl) {
    const requestUrl = new URL(rawUrl, window.location.href);
    return (
      requestUrl.origin === window.location.origin
      && requestUrl.pathname === BINANCE_PLACE_ORDER_BAPI_PATH
    );
  }

  function getFetchRequestMethod(args) {
    const method = args[1]?.method
      || (args[0] instanceof Request ? args[0].method : null)
      || 'GET';
    return String(method).toUpperCase();
  }

  function beginLadderSubmitResponseCapture() {
    ladderSubmitCaptureSequence += 1;
    activeLadderSubmitCapture = {
      captureId: ladderSubmitCaptureSequence,
      apiErrors: [],
      apiSuccesses: [],
      responseObservations: [],
    };
    return activeLadderSubmitCapture.captureId;
  }

  function endLadderSubmitResponseCapture(captureId) {
    if (activeLadderSubmitCapture?.captureId === captureId) activeLadderSubmitCapture = null;
  }

  async function observeLadderSubmitResponse(response, capture, requestUrl) {
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return;
    const payload = await response.clone().json();
    const code = getBinanceApiErrorCode(payload);
    if (code != null) {
      capture.apiErrors.push({ requestUrl, code });
      return;
    }
    if (response.ok && isBinancePlaceOrderSuccessPayload(payload)) {
      capture.apiSuccesses.push({ requestUrl });
    }
  }

  function trackLadderSubmitResponse(request, capture, requestUrl) {
    const observation = request
      .then((response) => observeLadderSubmitResponse(response, capture, requestUrl))
      .catch(() => null);
    capture.responseObservations.push(observation);
  }

  async function waitForLadderSubmitResponseObservations(captureId, timeoutMs) {
    const capture = activeLadderSubmitCapture?.captureId === captureId
      ? activeLadderSubmitCapture
      : null;
    if (!capture) throw new Error('下单响应捕获上下文丢失');
    const observations = capture.responseObservations.slice();
    if (observations.length > 0 && timeoutMs > 0) {
      await Promise.race([
        Promise.all(observations),
        delay(timeoutMs),
      ]);
    }
    return capture.apiErrors.slice();
  }

  function readLadderSubmitApiErrors(captureId) {
    const capture = activeLadderSubmitCapture?.captureId === captureId
      ? activeLadderSubmitCapture
      : null;
    if (!capture) throw new Error('下单响应捕获上下文丢失');
    return capture.apiErrors.slice();
  }

  function readLadderSubmitApiSuccesses(captureId) {
    const capture = activeLadderSubmitCapture?.captureId === captureId
      ? activeLadderSubmitCapture
      : null;
    if (!capture) throw new Error('下单响应捕获上下文丢失');
    return capture.apiSuccesses.slice();
  }

  (function installFetchInterceptor() {
    const originalFetch = window.fetch;
    window.fetch = function (...args) {
      try {
        const snapshot = extractHeadersFromFetchArgs(args);
        if (snapshot) cachedBncHeaders = snapshot;
      } catch (_e) { /* 不干扰原始请求 */ }
      const capture = activeLadderSubmitCapture;
      const requestUrl = getFetchRequestUrl(args);
      const shouldObserveResponse = (
        capture
        && getFetchRequestMethod(args) === 'POST'
        && isBinancePlaceOrderRequestUrl(requestUrl)
      );
      const request = originalFetch.apply(this, args);
      if (shouldObserveResponse) {
        trackLadderSubmitResponse(request, capture, requestUrl);
      }
      return request;
    };
  })();

  function getBncHeaders() {
    const base = cachedBncHeaders || {};
    return {
      'content-type': 'application/json',
      ...base,
      'x-trace-id': crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      'x-ui-request-trace': crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    };
  }

  async function adjustLeverageApi(symbol, leverage) {
    if (!cachedBncHeaders) {
      throw new Error('bapi header 尚未缓存');
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 5000);
    try {
      const resp = await fetch(
        'https://www.binance.com/bapi/futures/v1/private/future/user-data/adjustLeverage',
        {
          method: 'POST',
          headers: getBncHeaders(),
          body: JSON.stringify({ symbol, leverage }),
          credentials: 'include',
          signal: controller.signal,
        }
      );
      if (!resp.ok) throw new Error(`adjustLeverage HTTP ${resp.status}`);
      const data = await resp.json();
      if (!data.success) throw new Error(data.message || `code=${data.code}`);
      return data;
    } finally {
      window.clearTimeout(timer);
    }
  }

  function findOrderbookRow(node) {
    if (!node) return null;
    return node.closest('#futuresOrderbook .row-content');
  }

  function findClickedPriceNode(node) {
    if (!node) return null;
    const priceNode = node.closest('#futuresOrderbook .ask-light.emit-price, #futuresOrderbook .bid-light.emit-price');
    if (!priceNode) return null;
    return findOrderbookRow(priceNode) ? priceNode : null;
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

  function getOrderbookPrices(side, levels) {
    const isBid = side === 'BID';
    const selector = isBid
      ? '#futuresOrderbook .bid-light.emit-price'
      : '#futuresOrderbook .ask-light.emit-price';
    let prices = Array.from(document.querySelectorAll(selector))
      .filter((node) => isVisibleElement(node) && findOrderbookRow(node))
      .map((node) => parsePrice(node))
      .filter(Boolean);
    if (!isBid) prices = prices.reverse();

    const deduped = [];
    for (const price of prices) {
      if (!deduped.includes(price)) deduped.push(price);
      if (deduped.length >= levels) break;
    }
    return deduped;
  }

  function getBestOrderbookPrice(side) {
    return getOrderbookPrices(side, 1)[0] || null;
  }

  function getLatestTradePrices(limit = 20) {
    return Array.from(document.querySelectorAll('.tradew-tradelist .price.emit-price'))
      .filter((node) => isVisibleElement(node))
      .map((node) => parsePrice(node))
      .filter(Boolean)
      .slice(0, Math.max(1, Number(limit) || 20));
  }

  async function waitForLatestTradePricesReady(symbol, timeoutMs = ORDERBOOK_PRECISION_READY_TIMEOUT_MS) {
    const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
    while (!document.hidden && isFuturesTradingPage() && isCurrentObservedSymbol(symbol)) {
      const prices = getLatestTradePrices();
      if (prices.length >= ORDERBOOK_PRECISION_MIN_TRADE_PRICE_ROWS) return prices;
      if (Date.now() >= deadline) return prices;
      await delay(ORDERBOOK_PRECISION_SAMPLE_POLL_MS);
    }
    return [];
  }

  async function waitForOrderbookPrecisionBootstrapReady(symbol, timeoutMs = ORDERBOOK_PRECISION_READY_TIMEOUT_MS) {
    const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
    while (!document.hidden && isFuturesTradingPage() && isCurrentObservedSymbol(symbol)) {
      const trigger = findOrderbookPrecisionTrigger();
      const bid = getOrderbookPrices('BID', 1)[0] || null;
      const ask = getOrderbookPrices('ASK', 1)[0] || null;
      if (trigger?.element && bid && ask) return trigger;
      if (Date.now() >= deadline) return null;
      await delay(ORDERBOOK_PRECISION_READY_POLL_MS);
    }
    return null;
  }

  function orderbookPrecisionSamplesKey(symbol = getCurrentSymbol()) {
    const normalizedSymbol = String(symbol || '').toUpperCase();
    return normalizedSymbol ? `${LOCAL_ORDERBOOK_PRECISION_SAMPLES_PREFIX}:${normalizedSymbol}` : null;
  }

  function readStoredOrderbookPrecisionSamples(symbol = getCurrentSymbol()) {
    const key = orderbookPrecisionSamplesKey(symbol);
    if (!key) return [];
    const parsed = parseJsonSafe(localStorage.getItem(key));
    return Array.isArray(parsed)
      ? parsed.map((sample) => normalizeDecimalString(sample)).filter((sample) => sample && isPositiveDecimalString(sample))
      : [];
  }

  function saveStoredOrderbookPrecisionSamples(symbol, samples) {
    const key = orderbookPrecisionSamplesKey(symbol);
    if (!key) return [];
    const merged = mergePrecisionSamples([], samples, ORDERBOOK_PRECISION_SAMPLE_MAX);
    localStorage.setItem(key, JSON.stringify(merged));
    return merged;
  }

  function getOrderbookPrecisionRecommendation(symbol = getCurrentSymbol()) {
    const samples = readStoredOrderbookPrecisionSamples(symbol);
    return recommendOrderbookPrecision({
      samples,
      options: ORDERBOOK_PRECISION_CANDIDATE_OPTIONS,
    });
  }

  function isOrderbookPrecisionNumericText(text) {
    const raw = String(text || '').replace(/,/g, '').trim();
    return /^(?:\d+|\d+\.\d+|0?\.\d+)$/.test(raw) && raw.length <= 16;
  }

  function isInsideOrderbookPriceRow(node) {
    return !!node?.closest?.('#futuresOrderbook .row-content');
  }

  function findOrderbookPrecisionTrigger() {
    const tickSize = document.querySelector('#futuresOrderbook .orderbook-tickSize');
    const tickContent = tickSize?.querySelector('.tick-content') || null;
    const text = (tickContent?.textContent || tickSize?.textContent || '').trim();
    if (!tickSize || !isOrderbookPrecisionNumericText(text)) return null;
    return {
      element: tickContent || tickSize,
      value: normalizeDecimalString(text),
    };
  }

  function readCurrentOrderbookPrecisionValue() {
    return findOrderbookPrecisionTrigger()?.value || null;
  }

  function handleOrderbookPrecisionChange() {
    const precision = readCurrentOrderbookPrecisionValue();
    const symbol = getCurrentSymbol();
    const nativeOptions = readVisibleOrderbookPrecisionOptionValues();
    const previousNativeOptions = orderbookPrecisionState.symbol === symbol
      ? orderbookPrecisionState.nativeOptions
      : [];
    const nativeOptionsChanged = nativeOptions.length > 0
      && JSON.stringify(nativeOptions) !== JSON.stringify(previousNativeOptions);
    if (nativeOptionsChanged) {
      orderbookPrecisionState = {
        ...orderbookPrecisionState,
        symbol,
        nativeOptions,
        nativeOptionsStatus: null,
      };
    }
    if (precision === lastObservedOrderbookPrecision) {
      if (nativeOptionsChanged) scheduleRenderPanel();
      return;
    }
    lastObservedOrderbookPrecision = precision;
    stopMultiplierEdit();
    ladderPanelBodySignature = '';
    scheduleRenderPanel();
  }

  function stopOrderbookPrecisionObserver() {
    if (orderbookPrecisionObserver) {
      orderbookPrecisionObserver.disconnect();
      orderbookPrecisionObserver = null;
    }
    orderbookPrecisionObserverRoot = null;
    lastObservedOrderbookPrecision = null;
  }

  function ensureOrderbookPrecisionObserver() {
    if (document.hidden || !isFuturesTradingPage()) return;
    const trigger = findOrderbookPrecisionTrigger();
    const root = trigger?.element?.closest('.orderbook-tickSize') || trigger?.element || null;
    if (!root) {
      if (orderbookPrecisionObserverRoot) stopOrderbookPrecisionObserver();
      return;
    }
    if (orderbookPrecisionObserver && orderbookPrecisionObserverRoot === root && root.isConnected) return;

    stopOrderbookPrecisionObserver();
    orderbookPrecisionObserverRoot = root;
    lastObservedOrderbookPrecision = readCurrentOrderbookPrecisionValue();
    orderbookPrecisionObserver = new MutationObserver(() => {
      handleOrderbookPrecisionChange();
    });
    orderbookPrecisionObserver.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  }

  function readOrderbookPrecisionOptionValue(node) {
    if (!node) return null;
    const item = node.matches?.('.ob-ticksize-item')
      ? node
      : node.closest?.('.ob-ticksize-item');
    const textNode = item?.querySelector('span') || node;
    return normalizeDecimalString(textNode?.textContent || '');
  }

  function getVisibleOrderbookPrecisionOverlay(triggerElement = findOrderbookPrecisionTrigger()?.element) {
    const tickSize = triggerElement?.closest?.('.orderbook-tickSize');
    if (!tickSize || !tickSize.closest('#futuresOrderbook')) return null;
    // Other numeric menus can be open simultaneously; only the overlay owned by this tick-size control is valid.
    const overlays = Array.from(tickSize.querySelectorAll('.ob-ticksize-overlay'))
      .filter((overlay) => isVisibleElement(overlay));
    return overlays.length === 1 ? overlays[0] : null;
  }

  function getVisibleOrderbookPrecisionOptionNodes(triggerElement = findOrderbookPrecisionTrigger()?.element) {
    const overlay = getVisibleOrderbookPrecisionOverlay(triggerElement);
    if (!overlay) return [];
    return Array.from(overlay.querySelectorAll('.ob-ticksize-item'))
      .filter((node) => node.closest('.ob-ticksize-overlay') === overlay)
      .filter((node) => isVisibleElement(node))
      .filter((node) => isOrderbookPrecisionNumericText(readOrderbookPrecisionOptionValue(node)));
  }

  function readVisibleOrderbookPrecisionOptionValues(triggerElement = findOrderbookPrecisionTrigger()?.element) {
    const values = new Set();
    for (const node of getVisibleOrderbookPrecisionOptionNodes(triggerElement)) {
      const value = readOrderbookPrecisionOptionValue(node);
      if (value) values.add(value);
    }
    return Array.from(values);
  }

  function findVisibleOrderbookPrecisionOption(value, triggerElement = findOrderbookPrecisionTrigger()?.element) {
    const normalized = normalizeDecimalString(value);
    if (!normalized) return null;
    return getVisibleOrderbookPrecisionOptionNodes(triggerElement)
      .find((node) => readOrderbookPrecisionOptionValue(node) === normalized) || null;
  }

  function dispatchOrderbookPrecisionOpenEvent(target, type) {
    const EventCtor = type.startsWith('pointer') && typeof PointerEvent === 'function'
      ? PointerEvent
      : MouseEvent;
    return target.dispatchEvent(new EventCtor(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      button: 0,
      buttons: type === 'pointerup' || type === 'mouseup' || type === 'click' ? 0 : 1,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
    }));
  }

  function dispatchOrderbookPrecisionToggleSequence(target) {
    dispatchOrderbookPrecisionOpenEvent(target, 'pointerdown');
    dispatchOrderbookPrecisionOpenEvent(target, 'mousedown');
    dispatchOrderbookPrecisionOpenEvent(target, 'pointerup');
    dispatchOrderbookPrecisionOpenEvent(target, 'mouseup');
    dispatchOrderbookPrecisionOpenEvent(target, 'click');
  }

  async function waitForVisibleOrderbookPrecisionOptions(triggerElement, timeoutMs = ORDERBOOK_PRECISION_OPTION_WAIT_MS) {
    const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
    while (!document.hidden && isFuturesTradingPage()) {
      if (getVisibleOrderbookPrecisionOptionNodes(triggerElement).length) return true;
      if (Date.now() >= deadline) return false;
      await delay(50);
    }
    return false;
  }

  async function openOrderbookPrecisionOptions(triggerElement) {
    if (!triggerElement || !triggerElement.isConnected) return false;
    if (getVisibleOrderbookPrecisionOptionNodes(triggerElement).length) return true;
    const clickTarget = triggerElement.closest?.('.bn-tooltips-ele');
    if (
      !triggerElement.matches?.('.tick-content')
      || !clickTarget
      || !clickTarget.closest('#futuresOrderbook .orderbook-tickSize')
      || isInsideOrderbookPriceRow(clickTarget)
    ) return false;
    await delay(0);
    if (!triggerElement.isConnected || !clickTarget.isConnected) return false;
    if (!clickDomTarget(clickTarget)) return false;
    return waitForVisibleOrderbookPrecisionOptions(triggerElement);
  }

  async function ensureVisibleOrderbookPrecisionOptions(triggerElement) {
    const currentOptions = getVisibleOrderbookPrecisionOptionNodes(triggerElement);
    if (currentOptions.length) return currentOptions;
    if (!await openOrderbookPrecisionOptions(triggerElement)) return [];
    return getVisibleOrderbookPrecisionOptionNodes(triggerElement);
  }

  async function waitForOrderbookPrecisionOptionsClosed(triggerElement, timeoutMs = ORDERBOOK_PRECISION_OPTION_WAIT_MS) {
    const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
    while (!document.hidden && isFuturesTradingPage()) {
      if (!getVisibleOrderbookPrecisionOverlay(triggerElement)) return true;
      if (Date.now() >= deadline) return false;
      await delay(50);
    }
    return !getVisibleOrderbookPrecisionOverlay(triggerElement);
  }

  async function closeOrderbookPrecisionOptions(triggerElement, currentPrecision, waitForLateOpen = false) {
    if (waitForLateOpen && !getVisibleOrderbookPrecisionOverlay(triggerElement)) {
      await waitForVisibleOrderbookPrecisionOptions(triggerElement, ORDERBOOK_PRECISION_OPTION_WAIT_MS);
    }
    if (!getVisibleOrderbookPrecisionOverlay(triggerElement)) return true;
    const currentOption = findVisibleOrderbookPrecisionOption(currentPrecision, triggerElement);
    if (currentOption) {
      if (!clickDomTarget(currentOption)) return false;
      return waitForOrderbookPrecisionOptionsClosed(triggerElement);
    }
    // Binance can expose the new symbol's displayed precision before replacing the old menu items.
    // Toggling the linked trigger closes that transitional menu without selecting an unrelated value.
    const tickSize = triggerElement?.closest?.('.orderbook-tickSize');
    const toggleTarget = tickSize?.querySelector?.('.tick-content') || triggerElement;
    if (!toggleTarget || !isVisibleElement(toggleTarget)) return false;
    dispatchOrderbookPrecisionToggleSequence(toggleTarget);
    return waitForOrderbookPrecisionOptionsClosed(triggerElement);
  }

  async function waitForOrderbookPrecisionValue(options, timeoutMs = ORDERBOOK_PRECISION_OPTION_WAIT_MS) {
    const { symbol, startPrecision, targetPrecision } = options;
    const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
    while (!document.hidden && isFuturesTradingPage()) {
      if (!isCurrentObservedSymbol(symbol)) return false;
      const current = readCurrentOrderbookPrecisionValue();
      if (current === targetPrecision) return true;
      if (current && current !== startPrecision) return false;
      if (Date.now() >= deadline) return false;
      await delay(50);
    }
    return false;
  }

  function formatOrderbookPrecisionBusyStatus(status, sampleEndsAt = orderbookPrecisionState.sampleEndsAt) {
    if (status !== '刷新中' && status !== '采样中') return status;
    const remainingMs = Number(sampleEndsAt) - Date.now();
    if (!(remainingMs > 0)) return status;
    const remainingSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
    if (status === '刷新中') return `刷新中 ${remainingSeconds}s`;
    return `采样中 ${remainingSeconds}s`;
  }

  function renderOrderbookPrecisionShortcut(value, current, recommendation, disabled) {
    const selected = value === current;
    const recommended = value === recommendation;
    const disabledAttrs = disabled ? ' disabled aria-disabled="true"' : '';
    const title = disabled
      ? '缩放调整暂不可用'
      : selected && recommended
        ? `当前且推荐的原生缩放 ${value}`
        : selected
        ? `当前原生缩放 ${value}`
        : recommended
          ? `推荐原生缩放 ${value}`
          : `切换到原生缩放 ${value}`;
    const activeStyle = selected
      ? `border-color:var(--color-PrimaryYellow);background:var(--color-BadgeBg);color:${PRIMARY_EMPHASIS_COLOR};font-weight:${PRIMARY_EMPHASIS_FONT_WEIGHT};`
      : NEUTRAL_CONTROL_STYLE;
    const recommendationMarker = recommended
      ? '<span aria-hidden="true" style="position:absolute;top:3px;right:3px;width:6px;height:6px;border-radius:50%;background:var(--color-PrimaryYellow);box-shadow:0 0 0 1px #fff;"></span>'
      : '';
    return `<button type="button" data-orderbook-precision-value="${value}"${disabledAttrs} aria-pressed="${selected}" aria-label="切换订单簿缩放到 ${value}${recommended ? '，推荐档位' : ''}" title="${title}" style="position:relative;box-sizing:border-box;width:100%;min-width:0;height:32px;padding:0;border-radius:6px;border:1px solid ${CONTROL_BORDER_COLOR};font-size:12px;line-height:30px;white-space:nowrap;overflow:hidden;cursor:pointer;${activeStyle}">${recommendationMarker}${formatOrderbookPrecisionShortcutLabel(value)}</button>`;
  }

  function renderOrderbookPrecisionShortcutSlots(options, current, recommendation, disabled) {
    const slots = options.map((value) => (
      renderOrderbookPrecisionShortcut(value, current, recommendation, disabled)
    ));
    while (slots.length < ORDERBOOK_PRECISION_SHORTCUT_LIMIT) {
      slots.push('<span aria-hidden="true" style="height:32px;visibility:hidden;"></span>');
    }
    return slots;
  }

  function refreshOrderbookPrecisionRecommendation(panel = document.getElementById(PANEL_ID)) {
    const el = panel?.querySelector?.(`#${ORDERBOOK_PRECISION_RECOMMENDATION_ID}`);
    if (!el) return;

    const symbol = getCurrentSymbol();
    if (!symbol) {
      el.textContent = '';
      return;
    }

    const samples = readStoredOrderbookPrecisionSamples(symbol);
    const recommendation = recommendOrderbookPrecision({
      samples,
      options: ORDERBOOK_PRECISION_CANDIDATE_OPTIONS,
    });
    const current = readCurrentOrderbookPrecisionValue();
    const existingStatus = orderbookPrecisionState.symbol === symbol ? orderbookPrecisionState.status : null;
    const { busy, status } = resolveOrderbookPrecisionSampleState({
      sampling: orderbookPrecisionSampling,
      scheduled: Boolean(orderbookPrecisionSampleTimer),
      status: existingStatus,
      recommendation,
    });
    orderbookPrecisionState = {
      ...orderbookPrecisionState,
      symbol,
      samples,
      recommendation,
      current,
      status,
    };

    const selectionBusy = Boolean(orderbookPrecisionSelectionTask);
    const controlsBusy = busy || selectionBusy;
    const nativeOptions = orderbookPrecisionState.symbol === symbol
      ? orderbookPrecisionState.nativeOptions
      : [];
    const nativeOptionsStatus = !nativeOptions.length && orderbookPrecisionState.symbol === symbol
      ? orderbookPrecisionState.nativeOptionsStatus
      : null;
    const shortcutOptions = getOrderbookPrecisionShortcutOptions(
      nativeOptions,
      ORDERBOOK_PRECISION_SHORTCUT_LIMIT
    );
    if (!nativeOptions.length) queueOrderbookPrecisionOptionsLoad(symbol);
    const canRefresh = !controlsBusy;
    const buttonBaseStyle = `width:68px;height:24px;padding:0;border-radius:5px;border:1px solid ${CONTROL_BORDER_COLOR};font-size:12px;line-height:22px;`;
    const recommendationText = recommendation || '--';
    const precisionMessage = selectionBusy
      ? nativeOptions.length ? '调整中' : '读取档位'
      : busy
        ? formatOrderbookPrecisionBusyStatus(status)
        : nativeOptionsStatus
          ? nativeOptionsStatus
          : status === 'ready'
            ? `推荐 ${recommendationText}${recommendation && !shortcutOptions.includes(recommendation) ? '（原生）' : ''}`
            : status;
    const recommendationHtml = [
      `<div style="margin-top:12px;color:${MUTED_TEXT_COLOR};font-size:12px;">`,
      '<div style="display:grid;grid-template-columns:78px repeat(4,minmax(0,1fr));align-items:center;gap:4px;height:32px;overflow:hidden;">',
      `<span title="当前缩放 ${current || '--'}" style="font-size:14px;white-space:nowrap;">订单簿缩放</span>`,
      ...renderOrderbookPrecisionShortcutSlots(shortcutOptions, current, recommendation, controlsBusy),
      '</div>',
      '<div style="display:grid;grid-template-columns:78px repeat(4,minmax(0,1fr));align-items:center;gap:4px;height:24px;margin-top:6px;overflow:hidden;">',
      `<span title="${precisionMessage}" style="grid-column:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${precisionMessage}</span>`,
      `<button type="button" data-orderbook-precision-refresh="true"${canRefresh ? '' : ' disabled aria-disabled="true"'} style="${buttonBaseStyle}grid-column:2;justify-self:start;${NEUTRAL_CONTROL_STYLE}">更新推荐</button>`,
      '</div>',
      '</div>',
    ].join('');
    if (el.innerHTML !== recommendationHtml) {
      el.innerHTML = recommendationHtml;
    }
    if (busy && Number(orderbookPrecisionState.sampleEndsAt) > Date.now()) {
      scheduleRenderPanel({ followUpMs: 1000 });
    }
  }

  async function clickAndConfirmOrderbookPrecisionOption(options) {
    const { symbol, startPrecision, targetPrecision, triggerElement } = options;
    if (!isCurrentObservedSymbol(symbol) || readCurrentOrderbookPrecisionValue() !== startPrecision) return false;
    const option = findVisibleOrderbookPrecisionOption(targetPrecision, triggerElement);
    if (!option || !clickDomTarget(option)) return false;
    return waitForOrderbookPrecisionValue({ symbol, startPrecision, targetPrecision });
  }

  /**
   * Accepts a native precision snapshot only when the current trigger, displayed value, and menu agree.
   * Binance updates those nodes separately during SPA symbol switches, so each bounded attempt re-resolves
   * the trigger instead of committing a transient option list from the previous symbol.
   */
  async function waitForStableOrderbookPrecisionOptions(symbol, timeoutMs = ORDERBOOK_PRECISION_READY_TIMEOUT_MS) {
    const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
    let lastPrecision = null;
    while (!document.hidden && isFuturesTradingPage() && isCurrentObservedSymbol(symbol)) {
      const remainingMs = Math.max(0, deadline - Date.now());
      const trigger = await waitForOrderbookPrecisionBootstrapReady(symbol, remainingMs);
      if (!trigger?.element) return { status: '订单簿尚未就绪' };
      const startPrecision = trigger.value;
      lastPrecision = startPrecision;
      const optionsInitiallyVisible = getVisibleOrderbookPrecisionOptionNodes(trigger.element).length > 0;
      let snapshot = null;
      let closed = true;
      try {
        const options = await ensureVisibleOrderbookPrecisionOptions(trigger.element);
        if (!isCurrentObservedSymbol(symbol)) return null;
        const currentTrigger = findOrderbookPrecisionTrigger();
        const values = readVisibleOrderbookPrecisionOptionValues(trigger.element);
        if (
          trigger.element.isConnected
          && currentTrigger?.element === trigger.element
          && currentTrigger.value === startPrecision
          && options.length > 0
          && values.includes(startPrecision)
        ) snapshot = { precision: startPrecision, values };
      } finally {
        if (!optionsInitiallyVisible) {
          const cleanupPrecision = isCurrentObservedSymbol(symbol)
            ? readCurrentOrderbookPrecisionValue()
            : startPrecision;
          closed = await closeOrderbookPrecisionOptions(trigger.element, cleanupPrecision, true);
        }
      }
      if (!closed) return { status: '无法关闭原生缩放下拉' };
      if (snapshot) return snapshot;
      if (Date.now() >= deadline) break;
      await delay(ORDERBOOK_PRECISION_READY_POLL_MS);
    }
    if (!isCurrentObservedSymbol(symbol)) return null;
    return {
      status: lastPrecision
        ? `未找到当前缩放 ${lastPrecision} 的原生档位`
        : '订单簿尚未就绪',
    };
  }

  async function runLoadOrderbookPrecisionOptions() {
    const symbol = getCurrentSymbol();
    if (!isCurrentObservedSymbol(symbol)) return false;
    const snapshot = await waitForStableOrderbookPrecisionOptions(symbol);
    if (!snapshot || !isCurrentObservedSymbol(symbol)) return false;
    if (!snapshot.values?.length) {
      orderbookPrecisionState = {
        ...orderbookPrecisionState,
        nativeOptionsStatus: snapshot.status,
      };
      scheduleRenderPanel();
      return false;
    }
    orderbookPrecisionState = {
      ...orderbookPrecisionState,
      symbol,
      current: snapshot.precision,
      nativeOptions: snapshot.values,
      nativeOptionsStatus: null,
    };
    scheduleRenderPanel();
    return true;
  }

  async function runSelectOrderbookPrecision(targetPrecision) {
    const symbol = getCurrentSymbol();
    if (!isCurrentObservedSymbol(symbol)) return false;
    const trigger = findOrderbookPrecisionTrigger();
    if (!symbol || !trigger?.element) {
      orderbookPrecisionState = { ...orderbookPrecisionState, status: '未定位到缩放下拉' };
      scheduleRenderPanel();
      return false;
    }
    const startPrecision = trigger.value;
    if (targetPrecision === startPrecision) return true;
    const options = await ensureVisibleOrderbookPrecisionOptions(trigger.element);
    if (!isCurrentObservedSymbol(symbol) || readCurrentOrderbookPrecisionValue() !== startPrecision) return false;
    const values = readVisibleOrderbookPrecisionOptionValues(trigger.element);
    if (!options.length || !values.includes(startPrecision)) {
      orderbookPrecisionState = { ...orderbookPrecisionState, status: '读取原生缩放档位失败' };
      scheduleRenderPanel();
      return false;
    }
    const shortcutOptions = getOrderbookPrecisionShortcutOptions(
      values,
      ORDERBOOK_PRECISION_SHORTCUT_LIMIT
    );
    orderbookPrecisionState = {
      ...orderbookPrecisionState,
      symbol,
      nativeOptions: values,
      nativeOptionsStatus: null,
    };
    if (!options.length || !shortcutOptions.includes(targetPrecision)) {
      orderbookPrecisionState = { ...orderbookPrecisionState, status: `未找到快捷缩放 ${targetPrecision}` };
      scheduleRenderPanel();
      return false;
    }

    const selected = await clickAndConfirmOrderbookPrecisionOption({
      symbol,
      startPrecision,
      targetPrecision,
      triggerElement: trigger.element,
    });
    if (!selected) {
      if (isCurrentObservedSymbol(symbol)) {
        orderbookPrecisionState = { ...orderbookPrecisionState, status: `未找到 ${targetPrecision} 档切换结果` };
        scheduleRenderPanel();
      }
      return false;
    }
    orderbookPrecisionState = { ...orderbookPrecisionState, current: targetPrecision, status: 'ready' };
    scheduleRenderPanel();
    return true;
  }

  async function runOrderbookPrecisionSelectionTask(operation) {
    if (orderbookPrecisionSelectionTask) return orderbookPrecisionSelectionTask;
    const task = operation();
    orderbookPrecisionSelectionTask = task;
    scheduleRenderPanel();
    try {
      return await task;
    } finally {
      if (orderbookPrecisionSelectionTask === task) orderbookPrecisionSelectionTask = null;
      scheduleRenderPanel();
    }
  }

  function selectOrderbookPrecision(value) {
    const targetPrecision = normalizeDecimalString(value);
    if (!targetPrecision || !isPositiveDecimalString(targetPrecision)) {
      throw new Error(`无效的订单簿缩放快捷值: ${value}`);
    }
    return runOrderbookPrecisionSelectionTask(() => runSelectOrderbookPrecision(targetPrecision));
  }

  function queueOrderbookPrecisionOptionsLoad(symbol, force = false) {
    if (
      !isCurrentObservedSymbol(symbol)
      || document.hidden
      || (!force && orderbookPrecisionOptionsLoadAttemptedSymbol === symbol)
      || orderbookPrecisionOptionsLoadRequestedSymbol === symbol
      || orderbookPrecisionSelectionTask
      || !findOrderbookPrecisionTrigger()?.element
    ) return;
    orderbookPrecisionOptionsLoadRequestedSymbol = symbol;
    window.setTimeout(async () => {
      try {
        if (!isCurrentObservedSymbol(symbol) || document.hidden || orderbookPrecisionSelectionTask) return;
        orderbookPrecisionOptionsLoadAttemptedSymbol = symbol;
        orderbookPrecisionState = {
          ...orderbookPrecisionState,
          symbol,
          nativeOptionsStatus: '读取档位',
        };
        scheduleRenderPanel();
        await runOrderbookPrecisionSelectionTask(runLoadOrderbookPrecisionOptions);
      } catch (error) {
        err('读取原生订单簿缩放档位失败:', error);
        if (isCurrentObservedSymbol(symbol)) {
          orderbookPrecisionState = {
            ...orderbookPrecisionState,
            nativeOptionsStatus: '读取原生缩放档位失败',
          };
          scheduleRenderPanel();
        }
      } finally {
        if (
          document.hidden
          && orderbookPrecisionOptionsLoadAttemptedSymbol === symbol
        ) orderbookPrecisionOptionsLoadAttemptedSymbol = null;
        if (orderbookPrecisionOptionsLoadRequestedSymbol === symbol) {
          orderbookPrecisionOptionsLoadRequestedSymbol = null;
        }
        scheduleRenderPanel();
      }
    }, 0);
  }

  async function runOrderbookPrecisionSampleRound(request) {
    orderbookPrecisionSampleTimer = 0;
    if (orderbookPrecisionSampling || document.hidden || !isFuturesTradingPage()) return;
    const symbol = request.symbol;
    if (!isCurrentObservedSymbol(symbol)) return false;

    orderbookPrecisionSampling = true;
    orderbookPrecisionActiveRequest = request;
    const tradeMoveSamples = [];
    const sampleDurationMs = Math.max(0, Number(request.durationMs) || ORDERBOOK_PRECISION_SAMPLE_DURATION_MS);
    try {
      const readyPrices = await waitForLatestTradePricesReady(symbol);
      if (!isCurrentObservedSymbol(symbol)) return false;
      if (readyPrices.length >= ORDERBOOK_PRECISION_MIN_TRADE_PRICE_ROWS) {
        tradeMoveSamples.push(...collectNonZeroPriceMoves(readyPrices));
      }
      const deadline = Date.now() + sampleDurationMs;
      orderbookPrecisionState = {
        ...orderbookPrecisionState,
        symbol,
        sampleEndsAt: deadline,
      };
      scheduleRenderPanel({ followUpMs: 1000 });
      while (Date.now() < deadline && !document.hidden && isFuturesTradingPage() && isCurrentObservedSymbol(symbol)) {
        tradeMoveSamples.push(...collectNonZeroPriceMoves(getLatestTradePrices()));
        await delay(ORDERBOOK_PRECISION_SAMPLE_POLL_MS);
      }

      if (!isCurrentObservedSymbol(symbol)) return false;
      const newSamples = tradeMoveSamples;
      const samples = saveStoredOrderbookPrecisionSamples(symbol, newSamples);
      const recommendation = recommendOrderbookPrecision({
        samples,
        options: ORDERBOOK_PRECISION_CANDIDATE_OPTIONS,
      });
      orderbookPrecisionState = {
        ...orderbookPrecisionState,
        symbol,
        samples,
        recommendation,
        current: readCurrentOrderbookPrecisionValue(),
        status: recommendation ? 'ready' : '数据不足',
        sampleEndsAt: 0,
      };
      if (request.initial) orderbookPrecisionInitialSampledSymbols.add(symbol);
      refreshOrderbookPrecisionRecommendation();
      scheduleRenderPanel();
      return true;
    } finally {
      orderbookPrecisionSampling = false;
      orderbookPrecisionActiveRequest = null;
      const pending = orderbookPrecisionPendingRequest;
      orderbookPrecisionPendingRequest = null;
      if (pending && isCurrentObservedSymbol(pending.symbol)) {
        scheduleOrderbookPrecisionSampleRound(0, { ...pending, force: true });
      }
    }
  }

  function scheduleOrderbookPrecisionSampleRound(delayMs = 0, options) {
    const {
      force = false,
      durationMs = ORDERBOOK_PRECISION_SAMPLE_DURATION_MS,
      initial = false,
    } = options || {};
    if (document.hidden || !isFuturesTradingPage()) return;
    const symbol = getCurrentSymbol();
    if (!isCurrentObservedSymbol(symbol)) return;
    const request = { symbol, durationMs, initial };
    if (orderbookPrecisionSampling) {
      const sameInitialIsActive = initial
        && orderbookPrecisionActiveRequest?.initial
        && orderbookPrecisionActiveRequest?.symbol === symbol;
      const sameInitialIsPending = initial
        && orderbookPrecisionPendingRequest?.initial
        && orderbookPrecisionPendingRequest?.symbol === symbol;
      if (force && !sameInitialIsActive && !sameInitialIsPending) {
        orderbookPrecisionPendingRequest = request;
      }
      return;
    }
    if (orderbookPrecisionSampling || orderbookPrecisionSampleTimer) return;
    orderbookPrecisionSampleTimer = window.setTimeout(
      () => runOrderbookPrecisionSampleRound(request),
      Math.max(0, Number(delayMs) || 0)
    );
  }

  function stopOrderbookPrecisionSampler() {
    window.clearTimeout(orderbookPrecisionSampleTimer);
    orderbookPrecisionSampleTimer = 0;
    orderbookPrecisionPendingRequest = null;
  }

  function startInitialOrderbookPrecisionSample() {
    const symbol = getCurrentSymbol();
    if (!isCurrentObservedSymbol(symbol) || orderbookPrecisionInitialSampledSymbols.has(symbol)) return;
    orderbookPrecisionState = {
      ...orderbookPrecisionState,
      symbol,
      status: '采样中',
      sampleEndsAt: Date.now() + ORDERBOOK_PRECISION_SAMPLE_DURATION_MS,
    };
    scheduleOrderbookPrecisionSampleRound(0, {
      force: true,
      durationMs: ORDERBOOK_PRECISION_SAMPLE_DURATION_MS,
      initial: true,
    });
  }

  function refreshOrderbookPrecisionSamplesNow() {
    const symbol = getCurrentSymbol();
    orderbookPrecisionState = {
      ...orderbookPrecisionState,
      symbol,
      status: '刷新中',
      sampleEndsAt: Date.now() + ORDERBOOK_PRECISION_MANUAL_SAMPLE_DURATION_MS,
    };
    stopOrderbookPrecisionSampler();
    if (!orderbookPrecisionState.nativeOptions.length) {
      queueOrderbookPrecisionOptionsLoad(symbol, true);
    }
    scheduleOrderbookPrecisionSampleRound(0, {
      force: true,
      durationMs: ORDERBOOK_PRECISION_MANUAL_SAMPLE_DURATION_MS,
    });
    scheduleRenderPanel();
  }

  function getBufferedMakerPrices(side, levels, ladderStep = DEFAULT_LADDER_STEP) {
    const step = Math.max(LADDER_STEP_MIN, Math.min(Number(ladderStep) || DEFAULT_LADDER_STEP, LADDER_STEP_MAX));
    const requiredDepth = LADDER_MAKER_BUFFER_LEVELS + (levels - 1) * step + 1;
    const prices = getOrderbookPrices(side, requiredDepth);
    return planBufferedMakerPrices({
      prices,
      side,
      levels,
      ladderStep: step,
      bufferLevels: LADDER_MAKER_BUFFER_LEVELS,
      defaultStep: DEFAULT_LADDER_STEP,
      minStep: LADDER_STEP_MIN,
      maxStep: LADDER_STEP_MAX,
    });
  }

  function getLadderActionSpec(actionType) {
    const spec = getLadderActionSpecData(actionType);
    if (!spec) return null;
    const buttonGetters = {
      OPEN_LONG: findOpenLongButton,
      OPEN_SHORT: findOpenShortButton,
      CLOSE_LONG: findCloseLongButton,
      CLOSE_SHORT: findCloseShortButton,
    };
    return {
      ...spec,
      buttonGetter: buttonGetters[actionType],
    };
  }

  function findTradeModeTabByMode(mode) {
    const label = mode === 'OPEN' ? '开仓' : '平仓';
    const tabs = document.querySelectorAll(
      '#position-direction [role="tab"], .bn-tabs__buySell [role="tab"], [role="tab"].bn-tab__buySell'
    );
    return Array.from(tabs).find((tab) => (tab.textContent || '').includes(label)) || null;
  }

  function findConditionalOrderTab() {
    return findVisibleTradeScopeElement('[role="tab"]', (tab) => {
      const text = (tab.textContent || '').trim();
      const key = String(tab.getAttribute('data-tab-key') || '').toUpperCase();
      return key === 'CONDITIONAL' || text.includes('条件委托') || /只做Maker|Post Only/i.test(text);
    });
  }

  function findConditionalSubtypeCombobox() {
    const tab = findConditionalOrderTab();
    if (!tab) return null;
    return Array.from(tab.querySelectorAll('[role="combobox"], .bn-select-trigger, .bn-select-field'))
      .find(isVisibleElement) || null;
  }

  function clickElementLikeUser(el) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const clientX = (rect.left + rect.right) / 2;
    const clientY = (rect.top + rect.bottom) / 2;
    const PointerCtor = window.PointerEvent || MouseEvent;
    el.dispatchEvent(new PointerCtor('pointerdown', { bubbles: true, clientX, clientY }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX, clientY }));
    el.dispatchEvent(new PointerCtor('pointerup', { bubbles: true, clientX, clientY }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX, clientY }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX, clientY }));
  }

  function findPostOnlyOption() {
    const options = document.querySelectorAll('[role="option"], [role="menuitem"], .bn-select-option');
    return Array.from(options).find((el) => {
      if (!isVisibleElement(el)) return false;
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      return /只做Maker|Post Only/i.test(text) && text.length < 120;
    }) || null;
  }

  async function activateTradeMode(mode) {
    if (getActiveTradeMode() === mode) return true;
    const tab = findTradeModeTabByMode(mode);
    if (!tab) return false;
    tab.click();
    await delay(260);
    invalidateTradeButtonCache();
    scheduleRenderPanel();
    return getActiveTradeMode() === mode;
  }

  async function ensurePostOnlyOrderType() {
    if (isPostOnlyOrderTypeActive()) return true;

    const tab = findConditionalOrderTab();
    if (!tab) return false;
    if (!getCurrentOrderType().includes('CONDITIONAL')) {
      tab.click();
      await delay(320);
    }
    if (isPostOnlyOrderTypeActive()) return true;

    const combo = findConditionalSubtypeCombobox();
    if (!combo) return false;
    clickElementLikeUser(combo);
    await delay(260);

    const option = findPostOnlyOption();
    if (!option) return false;
    clickElementLikeUser(option);
    await delay(360);

    return isPostOnlyOrderTypeActive();
  }

  async function readOpenBaseQtyForLadder(spec, referencePrice) {
    const priceInput = findPriceInput();
    if (!priceInput || !referencePrice) return null;
    setInputValueReact(priceInput, referencePrice);
    const startedAt = Date.now();

    while (Date.now() - startedAt < LADDER_OPEN_QTY_READY_TIMEOUT_MS) {
      const openLongBtn = findOpenLongButton();
      const openShortBtn = findOpenShortButton();
      const { longQty, shortQty, qtySource } = readOpenableQty(openLongBtn, openShortBtn);
      const qty = spec.side === 'LONG' ? longQty : shortQty;
      if (qty != null && isPositiveDecimalString(String(qty))) {
        return { qty, qtySource };
      }
      await delay(LADDER_OPEN_QTY_POLL_MS);
    }

    const openLongBtn = findOpenLongButton();
    const openShortBtn = findOpenShortButton();
    const { longQty, shortQty, qtySource } = readOpenableQty(openLongBtn, openShortBtn);
    return {
      qty: spec.side === 'LONG' ? longQty : shortQty,
      qtySource,
    };
  }

  function readCloseBaseQtyForLadder(spec) {
    const symbol = getCurrentSymbol();
    if (!isCloseSnapshotReady(symbol)) return { qty: null, qtySource: null };
    const raw = readCloseContext(symbol);
    const hasConfirmedContext = raw.knowsLong && raw.knowsShort;
    const qty = hasConfirmedContext ? (spec.side === 'LONG' ? raw.longQty : raw.shortQty) : null;
    return {
      qty: qty != null ? normalizeDecimalString(String(qty)) : null,
      qtySource: raw.qtySource,
    };
  }

  async function buildLadderPlan(actionType, expectedContext = null) {
    const spec = getLadderActionSpec(actionType);
    if (!spec) throw new Error('未知阶梯动作');

    const startSymbol = getCurrentSymbol();
    if (!startSymbol) throw new Error('未识别当前交易对');
    if (expectedContext?.symbol && startSymbol !== expectedContext.symbol) {
      throw new Error('重挂前交易对已变化，已停止');
    }
    if (expectedContext?.mode && spec.mode !== expectedContext.mode) {
      throw new Error('重挂前开仓/平仓模式已变化，已停止');
    }

    const modeReady = await activateTradeMode(spec.mode);
    if (!modeReady || getCurrentSymbol() !== startSymbol) throw new Error('切换开仓/平仓失败或交易对已变化');
    const startPrecision = readCurrentOrderbookPrecisionValue();
    if (!startPrecision) throw new Error('未识别订单簿缩放值');
    if (expectedContext?.precision && startPrecision !== expectedContext.precision) {
      throw new Error('重挂前订单簿缩放值已变化，已停止');
    }

    const postOnlyReady = await ensurePostOnlyOrderType();
    if (!postOnlyReady) throw new Error('请刷新页面让只做Maker (Post Only) 生效后重试，脚本不会用普通限价继续');

    const levels = getLadderLevels(spec.mode, startSymbol, startPrecision);
    const ladderStep = getLadderStep(spec.mode, startSymbol, startPrecision);
    const prices = getBufferedMakerPrices(spec.priceSide, levels, ladderStep);
    if (prices.length < levels) {
      throw new Error(`订单簿${spec.priceSide === 'BID' ? '买盘' : '卖盘'}不足 ${levels} 档，档幅 ${ladderStep}`);
    }

    const rules = await ensureRules(startSymbol);
    if (
      !rules ||
      getCurrentSymbol() !== startSymbol ||
      readCurrentOrderbookPrecisionValue() !== startPrecision
    ) {
      throw new Error('交易规则未就绪或交易上下文已变化');
    }

    const ruleContext = getQtyRuleContext(startSymbol, spec.mode, prices[0]);
    if (ruleContext.status !== 'ready' || !ruleContext.stepSize || !ruleContext.baseMinQty) {
      throw new Error('数量步进/最小量未就绪');
    }
    const minRequiredQtyByLevel = spec.mode === 'OPEN'
      ? prices.map((price) => getQtyRuleContext(startSymbol, spec.mode, price).effectiveMinQty || ruleContext.baseMinQty)
      : prices.map(() => ruleContext.baseMinQty);
    let minRequiredQty = minRequiredQtyByLevel
      .filter(Boolean)
      .reduce((maxQty, qty) => maxDecimalString(maxQty, qty), ruleContext.baseMinQty);

    const base = spec.mode === 'OPEN'
      ? await readOpenBaseQtyForLadder(spec, prices[0])
      : readCloseBaseQtyForLadder(spec);
    if (
      getCurrentSymbol() !== startSymbol ||
      getActiveTradeMode() !== spec.mode ||
      readCurrentOrderbookPrecisionValue() !== startPrecision ||
      !isPostOnlyOrderTypeActive()
    ) {
      throw new Error('读取可用数量后交易上下文已变化，已停止');
    }
    const baseQty = normalizeDecimalString(base?.qty || '');
    if (!baseQty || !isPositiveDecimalString(baseQty)) {
      throw new Error(`未读取到可用${spec.mode === 'OPEN' ? '可开' : '可平'}数量`);
    }

    let percent = getLadderPercentForMode(
      spec.mode,
      spec.mode === 'OPEN' ? getLadderOpenPercent(startSymbol, startPrecision) : null,
      spec.mode === 'CLOSE' ? getLadderClosePercent(startSymbol, startPrecision) : null,
    );
    if (percent == null) throw new Error('未知阶梯模式');
    const totalQty = multiplyDecimalByRatio(baseQty, percent, 100);
    let allocation = allocateLadderQuantities(totalQty, levels, ruleContext.stepSize, minRequiredQty);
    let autoFitPercent = null;
    let autoFitLevels = null;
    if (!allocation || allocation.actualLevels < levels) {
      const autoFit = fitLadderPlanForMinimumQty({
        baseQty,
        minRequiredQty,
        minRequiredQtyByLevel,
        percent,
        levels,
        stepSize: ruleContext.stepSize,
        maxPercent: getMaxAutoFitLadderPercent(spec.mode),
      });
      if (autoFit.allocation) {
        allocation = autoFit.allocation;
        percent = autoFit.percent;
        minRequiredQty = autoFit.minRequiredQty || minRequiredQty;
        autoFitPercent = autoFit.percent;
        autoFitLevels = autoFit.levels;
      } else {
        throw createLadderMinimumQtyFailure({
          spec,
          symbol: startSymbol,
          precision: startPrecision,
          mode: spec.mode,
          minRequiredQty,
          baseQty,
          percent,
          levels,
          minimumPercent: autoFit.minimumPercent,
          maxAutoFitPercent: autoFit.maxPercent,
          replacementTotalQty: spec.mode === 'OPEN' ? multiplyDecimalByInt(minRequiredQty, levels) : null,
        });
      }
    }

    const orderPrices = prices.slice(0, allocation.actualLevels);
    return {
      spec,
      symbol: startSymbol,
      precision: startPrecision,
      percent,
      ladderStep,
      levels: allocation.actualLevels,
      requestedLevels: allocation.requestedLevels,
      baseQty,
      totalQty: allocation.totalQty,
      minRequiredQty,
      autoFitPercent: autoFitPercent,
      autoFitLevels,
      prices: orderPrices,
      qtySource: base.qtySource,
      orders: orderPrices.map((price, index) => ({ price, qty: allocation.quantities[index] })),
    };
  }

  function getMaxAutoFitLadderPercent(mode) {
    if (mode === 'OPEN') return String(Math.max(...LADDER_OPEN_PERCENTS));
    if (mode === 'CLOSE') return '100';
    return null;
  }

  function createLadderMinimumQtyFailure(options) {
    const {
      spec,
      symbol,
      precision,
      mode,
      minRequiredQty,
      percent,
      levels,
      minimumPercent,
      maxAutoFitPercent,
      replacementTotalQty,
    } = options;
    const percentLabel = mode === 'OPEN' ? '开仓比例' : '平仓比例';
    const actionLabel = mode === 'OPEN' ? '开仓' : '平仓';
    const percentHint = minimumPercent ? `，需 >= ${minimumPercent}%` : '';
    const error = new Error(`数量低于最小下单量 ${minRequiredQty}${percentHint}`);
    const minimumText = minimumPercent
      ? `至少需要${percentLabel} ${minimumPercent}% 才能保持当前档位。`
      : '';
    const maxText = maxAutoFitPercent ? `自动上限 ${maxAutoFitPercent}%。` : '';
    const levelsText = levels ? `当前档位 ${levels} 档。` : '';
    const replacementText = mode === 'OPEN'
      ? '脚本只会尝试替换当前币同向开仓基础单，不会自动全撤。'
      : '脚本不会自动撤单。';
    error.statusTitle = `当前${percentLabel} ${percent}%，目标数量小于最小下单量 ${minRequiredQty}，无法阶梯${actionLabel}；${levelsText}${minimumText}${maxText}已尝试自动提高比例和自动降档；${replacementText}`;
    if (
      mode === 'OPEN' &&
      spec &&
      symbol &&
      precision &&
      replacementTotalQty &&
      isPositiveDecimalString(replacementTotalQty)
    ) {
      error.openOrdersReplacementPlan = {
        spec,
        symbol,
        precision,
        totalQty: replacementTotalQty,
      };
    }
    return error;
  }

  function assertLadderMakerPrice(plan, price) {
    const oppositeSide = plan.spec.orderSide === 'BUY' ? 'ASK' : 'BID';
    const oppositePrice = getBestOrderbookPrice(oppositeSide);
    if (!oppositePrice) throw new Error('盘口已刷新，未读取到对手盘价格');

    const cmp = compareDecimalStrings(price, oppositePrice);
    if (cmp == null) throw new Error('盘口价格校验失败');

    if (plan.spec.orderSide === 'BUY' && cmp >= 0) {
      throw createLadderMakerPriceConflictError(`盘口已移动，买单 ${price} 可能吃单，对手卖一 ${oppositePrice}`);
    }
    if (plan.spec.orderSide === 'SELL' && cmp <= 0) {
      throw createLadderMakerPriceConflictError(`盘口已移动，卖单 ${price} 可能吃单，对手买一 ${oppositePrice}`);
    }
  }

  function createLadderMakerPriceConflictError(message) {
    const error = new Error(message);
    error.ladderFailureKind = 'maker_price_conflict';
    error.safeNoSubmit = true;
    return error;
  }

  function isRetryableLadderMakerPriceFailure(plan, error) {
    if (plan?.spec?.mode !== 'OPEN' && plan?.spec?.mode !== 'CLOSE') return false;
    if (error?.ladderFailureKind === 'maker_price_conflict') return error.safeNoSubmit === true;
    return isBinancePostOnlyMakerRejectCode(error?.binanceCode) && error.safeNoSubmit === true;
  }

  function createLadderSubmitApiError(apiErrorCode) {
    const error = new Error(`Maker 挂单被拒绝（错误码 ${apiErrorCode}）`);
    error.binanceCode = apiErrorCode;
    error.safeNoSubmit = true;
    return error;
  }

  function formatLadderRepriceDiagnostics(repriceAttempts, lastRepriceApiErrorCode) {
    if (repriceAttempts <= 0) return '';
    const codeText = lastRepriceApiErrorCode == null ? '' : `，错误码 ${lastRepriceApiErrorCode}`;
    return `（刷新盘口 ${repriceAttempts} 次${codeText}）`;
  }

  function refreshRemainingLadderOrders(plan, completedCount) {
    assertLadderExecutionContext(plan);
    const remainingCount = plan.orders.length - completedCount;
    if (remainingCount <= 0) throw new Error('没有待重定价的阶梯订单');
    const prices = getBufferedMakerPrices(plan.spec.priceSide, remainingCount, plan.ladderStep);
    if (prices.length !== remainingCount) {
      throw new Error(`刷新后订单簿${plan.spec.priceSide === 'BID' ? '买盘' : '卖盘'}不足 ${remainingCount} 档`);
    }
    const repricedOrders = repriceRemainingLadderOrders({
      orders: plan.orders,
      completedCount,
      prices,
    });
    if (plan.spec.mode === 'OPEN') {
      for (let index = completedCount; index < repricedOrders.length; index += 1) {
        const order = repricedOrders[index];
        const ruleContext = getQtyRuleContext(plan.symbol, 'OPEN', order.price);
        if (ruleContext.status !== 'ready' || !ruleContext.effectiveMinQty) {
          throw new Error('刷新盘口后最小下单量未就绪，已停止');
        }
        const comparison = compareDecimalStrings(order.qty, ruleContext.effectiveMinQty);
        if (comparison == null) throw new Error('刷新盘口后数量校验失败，已停止');
        if (comparison < 0) {
          throw new Error(`刷新盘口后第 ${index + 1} 档数量 ${order.qty} 低于最小下单量 ${ruleContext.effectiveMinQty}，已停止`);
        }
      }
    }
    plan.orders = repricedOrders;
    return remainingCount;
  }

  function assertLadderExecutionContext(plan) {
    if (!isCurrentObservedSymbol(plan.symbol)) throw new Error('执行中交易对变化，已停止');
    if (getActiveTradeMode() !== plan.spec.mode) throw new Error('执行中开仓/平仓模式变化，已停止');
    if (readCurrentOrderbookPrecisionValue() !== plan.precision) {
      throw new Error('执行中订单簿缩放值变化，已停止');
    }
    if (!isPostOnlyOrderTypeActive()) throw new Error('执行中只做Maker (Post Only) 状态丢失，请刷新页面后重试');
  }

  function assertSubmittedPriceMatchesClickedPrice(clickedPrice, submittedPrice) {
    const clicked = normalizeDecimalString(clickedPrice);
    const submitted = normalizeDecimalString(submittedPrice);
    const cmp = compareDecimalStrings(clicked, submitted);
    if (cmp !== 0) {
      throw new Error(`价格框未同步，点击价 ${clicked || clickedPrice}，当前提交价 ${submitted || submittedPrice || '-'}`);
    }
  }

  function isSubmitButtonBusy(button) {
    if (!button) return false;
    const text = (button.textContent || '').toLowerCase();
    const cls = String(button.className || '').toLowerCase();
    return (
      button.disabled ||
      button.getAttribute('aria-disabled') === 'true' ||
      button.getAttribute('data-loading') === 'true' ||
      text.includes('提交中') ||
      text.includes('placing') ||
      text.includes('loading') ||
      cls.includes('loading') ||
      !!button.querySelector('[class*="loading"], [class*="spinner"], [aria-busy="true"]')
    );
  }

  function readVisibleOrderFeedbackEntries() {
    const selectors = [
      '[role="alert"]',
      '[aria-live]',
      '[class*="toast"]',
      '[class*="Toast"]',
      '[class*="message"]',
      '[class*="Message"]',
      '[class*="notification"]',
      '[class*="Notification"]',
    ];
    const seen = new Set();
    const entries = [];
    for (const el of document.querySelectorAll(selectors.join(','))) {
      if (seen.has(el) || !isVisibleElement(el)) continue;
      seen.add(el);
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 300) continue;
      if (isPotentialOrderFeedbackText(text)) entries.push({ el, text });
    }
    return entries;
  }

  function takeOrderFeedbackSnapshot() {
    const entries = readVisibleOrderFeedbackEntries();
    return {
      elements: new Set(entries.map(({ el }) => el)),
      textByElement: new Map(entries.map(({ el, text }) => [el, text])),
      htmlByElement: new Map(entries.map(({ el }) => [el, el.innerHTML])),
    };
  }

  function readNewVisibleOrderFeedbackText(previousSnapshot) {
    const snapshot = previousSnapshot || { elements: new Set(), textByElement: new Map(), htmlByElement: new Map() };
    for (const { el, text } of readVisibleOrderFeedbackEntries()) {
      if (!snapshot.elements.has(el)) return text;
      if (snapshot.textByElement.get(el) !== text) return text;
      if (snapshot.htmlByElement.get(el) !== el.innerHTML) return text;
    }
    return '';
  }

  async function waitForOrderSubmitAcknowledgement(button, label, previousFeedbackSnapshot, submitCaptureId, mode) {
    const startedAt = Date.now();
    let sawBusy = isSubmitButtonBusy(button);
    let pendingFailure = null;

    while (Date.now() - startedAt < LADDER_SUBMIT_ACK_TIMEOUT_MS) {
      const feedback = readNewVisibleOrderFeedbackText(previousFeedbackSnapshot);
      const acknowledgement = evaluateOrderSubmitAcknowledgement({
        feedback,
        isNewFeedback: Boolean(feedback),
      });
      if (acknowledgement.status === 'failure' && !pendingFailure) {
        pendingFailure = { message: acknowledgement.message };
      }
      const capturedApiErrorsNow = readLadderSubmitApiErrors(submitCaptureId);
      if (
        capturedApiErrorsNow.length === 1
        && isBinancePostOnlyMakerRejectCode(capturedApiErrorsNow[0].code)
      ) {
        throw createLadderSubmitApiError(capturedApiErrorsNow[0].code);
      }
      if (pendingFailure) {
        const remainingAckMs = Math.max(0, LADDER_SUBMIT_ACK_TIMEOUT_MS - (Date.now() - startedAt));
        const capturedApiErrors = await waitForLadderSubmitResponseObservations(
          submitCaptureId,
          remainingAckMs,
        );
        if (
          capturedApiErrors.length === 1
          && isBinancePostOnlyMakerRejectCode(capturedApiErrors[0].code)
        ) {
          throw createLadderSubmitApiError(capturedApiErrors[0].code);
        }
        if (
          capturedApiErrors.length === 0
          && mode === 'CLOSE'
          && isPostOnlyMakerRejectionFeedback(pendingFailure.message)
        ) {
          throw createLadderMakerPriceConflictError(pendingFailure.message);
        }
        const capturedCodes = [...new Set(capturedApiErrors.map(({ code }) => code))];
        const diagnostic = capturedCodes.length === 0
          ? '未捕获错误码'
          : `错误码 ${capturedCodes.join(', ')}`;
        throw new Error(`${pendingFailure.message}（${diagnostic}）`);
      }
      const capturedApiSuccessesNow = readLadderSubmitApiSuccesses(submitCaptureId);
      if (capturedApiSuccessesNow.length === 1) return;
      if (acknowledgement.status === 'success') return;

      const busy = isSubmitButtonBusy(button);
      if (busy) sawBusy = true;

      await delay(LADDER_SUBMIT_POLL_MS);
    }

    const settleHint = sawBusy ? '按钮已恢复但未收到明确成功反馈' : '未观察到提交按钮状态变化';
    throw new Error(`未收到明确${label}成功反馈（${settleHint}），已停止；请核对当前委托/历史成交`);
  }

  async function executeLadderPlan(plan) {
    const priceInput = findPriceInput();
    const qtyInput = findQtyInput();
    if (!priceInput || !qtyInput) throw new Error('未找到价格或数量输入框');

    let done = 0;
    let repriceAttempts = 0;
    let lastRepriceApiErrorCode = null;
    while (done < plan.orders.length) {
      if (ladderStopRequested) break;
      const order = plan.orders[done];
      try {
        assertLadderExecutionContext(plan);
        if (!(await ensurePostOnlyOrderType())) throw new Error('执行中只做Maker (Post Only) 状态丢失，请刷新页面后重试');
        assertLadderExecutionContext(plan);
        assertLadderMakerPrice(plan, order.price);

        const currentPriceInput = findPriceInput();
        const currentQtyInput = findQtyInput();
        if (!currentPriceInput || !currentQtyInput) throw new Error('执行中价格或数量输入框丢失');

        setInputValueReact(currentPriceInput, order.price);
        await delay(90);
        setInputValueReact(currentQtyInput, order.qty);
        await delay(120);
        const submittedPrice = normalizeDecimalString(currentPriceInput.value);
        if (!submittedPrice) throw new Error('执行中价格输入框值无效');
        assertSubmittedPriceMatchesClickedPrice(order.price, submittedPrice);
        assertLadderExecutionContext(plan);
        assertLadderMakerPrice(plan, submittedPrice);

        const button = plan.spec.buttonGetter();
        if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') {
          throw new Error(`未找到可点击的${plan.spec.label}按钮`);
        }

        if (!CFG.SAFE_MODE) {
          const previousFeedback = takeOrderFeedbackSnapshot();
          const submitCaptureId = beginLadderSubmitResponseCapture();
          try {
            button.click();
            setLadderStatus(`${plan.spec.label} ${done + 1}/${plan.orders.length} 确认中`);
            waitForTradeUiMutation({ timeoutMs: 500 });
            await waitForOrderSubmitAcknowledgement(
              button,
              plan.spec.label,
              previousFeedback,
              submitCaptureId,
              plan.spec.mode,
            );
          } finally {
            endLadderSubmitResponseCapture(submitCaptureId);
          }
        }
      } catch (e) {
        if (!isRetryableLadderMakerPriceFailure(plan, e)) throw e;
        if (isBinancePostOnlyMakerRejectCode(e?.binanceCode)) {
          lastRepriceApiErrorCode = e.binanceCode;
        }
        if (repriceAttempts >= LADDER_REPRICE_MAX_ATTEMPTS) {
          const codeText = lastRepriceApiErrorCode == null ? '' : `（错误码 ${lastRepriceApiErrorCode}）`;
          throw new Error(`盘口连续移动，已自动刷新 ${repriceAttempts} 次${codeText}；已完成 ${done}/${plan.orders.length}，已停止`);
        }
        repriceAttempts += 1;
        setLadderStatus(`盘口已移动，刷新剩余 ${plan.orders.length - done} 档 (${repriceAttempts}/${LADDER_REPRICE_MAX_ATTEMPTS})`);
        await delay(LADDER_REPRICE_DELAY_MS);
        if (ladderStopRequested) break;
        refreshRemainingLadderOrders(plan, done);
        continue;
      }
      done++;
      setLadderStatus(`${plan.spec.label} ${done}/${plan.orders.length}`);
      await delay(LADDER_ORDER_DELAY_MS);
    }
    return { done, repriceAttempts, lastRepriceApiErrorCode };
  }

  async function startLadder(actionType) {
    if (!isCurrentObservedSymbol(getCurrentSymbol())) {
      setLadderStatus('交易对正在切换');
      return;
    }
    if (cancelCurrentSymbolOpenOrdersTask) {
      setLadderStatus('撤本币挂单处理中，请等待完成');
      return;
    }
    if (ladderTask) {
      setLadderStatus('正在执行，先点停止');
      return;
    }
    ladderStopRequested = false;
    const spec = getLadderActionSpec(actionType);
    setLadderStatus(`${spec?.label || '阶梯'} 准备中`);
    ladderTask = (async () => {
      const {
        plan,
        done,
        repriceAttempts,
        lastRepriceApiErrorCode,
      } = await runLadderPlanWithOpenOrderReplacement(actionType);
      const diagnostics = formatLadderRepriceDiagnostics(repriceAttempts, lastRepriceApiErrorCode);
      setLadderStatus(
        ladderStopRequested
          ? `已停止 ${done}/${plan.orders.length}${diagnostics}`
          : `完成 ${done}/${plan.orders.length}${diagnostics}`,
      );
    })()
      .catch((e) => {
        err('Maker 阶梯执行失败:', e);
        setLadderStatus(e?.message || '执行失败', e?.statusTitle);
      })
      .finally(() => {
        ladderTask = null;
        ladderStopRequested = false;
        scheduleRenderPanel();
      });
    scheduleRenderPanel();
    await ladderTask;
  }

  function stopLadder() {
    if (!ladderTask) {
      setLadderStatus('空闲');
      return;
    }
    ladderStopRequested = true;
    setLadderStatus('停止中');
    scheduleRenderPanel();
  }

  function findVisibleElementByText(selector, patterns, root = document) {
    for (const el of root.querySelectorAll(selector)) {
      if (!isVisibleElement(el)) continue;
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (patterns.some((pattern) => pattern.test(text))) return el;
    }
    return null;
  }

  function findVisibleTextElement(patterns, root = document) {
    const candidates = Array.from(root.querySelectorAll('button, [role="button"], a, [tabindex], div, span'))
      .filter(isVisibleElement)
      .map((el) => ({
        el,
        text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
        rect: el.getBoundingClientRect(),
      }))
      .filter(({ text }) => patterns.some((pattern) => pattern.test(text)));
    candidates.sort((a, b) => (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height));
    return candidates[0]?.el || null;
  }

  function getNormalizedText(el) {
    return normalizeText(el?.textContent || '');
  }

  function getAccountOrdersTabGroup(tab) {
    return getAccountOrdersTabGroupDom(tab, { isVisibleElement });
  }

  function findOpenOrdersTab() {
    return findOpenOrdersTabDom(document, { isVisibleElement });
  }

  function getOpenOrdersTabCount() {
    const tab = findOpenOrdersTab();
    if (!tab) return null;
    return parseOpenOrdersTabCount(getNormalizedText(tab));
  }

  function findSelectedAccountOrdersTab() {
    return findSelectedAccountOrdersTabDom(document, { isVisibleElement });
  }

  async function activateOpenOrdersTab() {
    const tab = findOpenOrdersTab();
    if (!tab) return false;
    if (tab.getAttribute('aria-selected') === 'true') return true;
    tab.click();
    await delay(350);
    const activeTab = findOpenOrdersTab();
    return activeTab?.getAttribute('aria-selected') === 'true';
  }

  async function restoreAccountOrdersTab(previousTab, symbol = null) {
    if (symbol && !isCurrentObservedSymbol(symbol)) return false;
    if (!previousTab || !previousTab.isConnected || !isVisibleElement(previousTab)) return true;
    if (previousTab.getAttribute('aria-selected') === 'true') return true;
    if (symbol && !isCurrentObservedSymbol(symbol)) return false;
    previousTab.click();
    await delay(250);
    if (symbol && !isCurrentObservedSymbol(symbol)) return false;
    return previousTab.getAttribute('aria-selected') === 'true';
  }

  function getActiveOpenOrdersScope() {
    return getActiveOpenOrdersScopeDom(document, {
      isVisibleElement,
      findHideOtherSymbolCheckbox,
      findCurrentSymbolCancelAllButton,
    });
  }

  function findOpenOrdersBasicSubTab(root) {
    return findOpenOrdersBasicSubTabDom(root, { isVisibleElement });
  }

  function findOpenOrdersConditionalSubTab(root) {
    return findOpenOrdersConditionalSubTabDom(root, { isVisibleElement });
  }

  function findSelectedOpenOrdersSubTab(root) {
    return findSelectedOpenOrdersSubTabDom(root, { isVisibleElement });
  }

  async function waitForActiveOpenOrdersScope() {
    const deadline = Date.now() + 2200;
    while (Date.now() < deadline) {
      const scope = getActiveOpenOrdersScope();
      if (scope) return scope;
      await delay(100);
    }
    return getActiveOpenOrdersScope();
  }

  async function activateOpenOrdersBasicSubTab(root) {
    const previousSubTab = findSelectedOpenOrdersSubTab(root);
    const basicTab = findOpenOrdersBasicSubTab(root);
    if (!basicTab) {
      return {
        ready: !findOpenOrdersConditionalSubTab(root),
        previousSubTab,
      };
    }
    if (basicTab.getAttribute('aria-selected') === 'true') {
      return { ready: true, previousSubTab };
    }
    basicTab.click();
    await delay(250);
    return {
      ready: findOpenOrdersBasicSubTab(root)?.getAttribute('aria-selected') === 'true',
      previousSubTab,
    };
  }

  async function restoreOpenOrdersSubTab(previousSubTab, symbol = null) {
    if (symbol && !isCurrentObservedSymbol(symbol)) return false;
    if (!previousSubTab || !previousSubTab.isConnected || !isVisibleElement(previousSubTab)) return true;
    if (previousSubTab.getAttribute('aria-selected') === 'true') return true;
    if (symbol && !isCurrentObservedSymbol(symbol)) return false;
    previousSubTab.click();
    await delay(250);
    if (symbol && !isCurrentObservedSymbol(symbol)) return false;
    return previousSubTab.getAttribute('aria-selected') === 'true';
  }

  function findCurrentSymbolCancelAllButton(root) {
    if (!root) return null;
    const button = findVisibleElementByText(
      'button, [role="button"], a',
      [/^全撤$/, /^全部撤单$/, /^撤销全部$/, /^Cancel All$/i],
      root
    ) || findVisibleTextElement([/^全撤$/, /^全部撤单$/, /^撤销全部$/, /^Cancel All$/i], root);
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return null;
    return button;
  }

  function findHideOtherSymbolCheckbox(root) {
    if (!root) return null;
    return Array.from(root.querySelectorAll('[role="checkbox"][name="hideOtherSymbol"]'))
      .find(isVisibleElement) || null;
  }

  function getCheckboxCheckedState(checkbox) {
    if (!checkbox) return null;
    const ariaChecked = checkbox.getAttribute('aria-checked');
    if (ariaChecked === 'true') return true;
    if (ariaChecked === 'false') return false;
    if (typeof checkbox.checked === 'boolean') return checkbox.checked;
    const input = checkbox.matches('input[type="checkbox"]')
      ? checkbox
      : checkbox.querySelector('input[type="checkbox"]');
    if (input && typeof input.checked === 'boolean') return input.checked;
    if (checkbox.hasAttribute('checked')) return true;
    return null;
  }

  function readVisibleOpenOrderSymbols(root) {
    return readVisibleOpenOrderSymbolsText(root?.textContent || '');
  }

  function isOpenOrdersScopeLimitedToSymbol(root, symbol) {
    return isOpenOrdersScopeLimitedToSymbolText(root?.textContent || '', symbol);
  }

  function hasCurrentSymbolOpenOrders(root, symbol, symbolFilterOk, cancelAllButton) {
    return hasCurrentSymbolOpenOrdersEvidence({
      scopeText: root?.textContent || '',
      symbol,
      symbolFilterOk,
      openOrdersCount: getOpenOrdersTabCount(),
      cancelAllAvailable: Boolean(cancelAllButton),
    });
  }

  async function waitForCurrentSymbolOpenOrders(root, symbol, symbolFilterOk) {
    const deadline = Date.now() + 1600;
    while (Date.now() < deadline) {
      if (!isCurrentObservedSymbol(symbol)) return { hasOrders: false, cancelAllButton: null };
      const cancelAllButton = findCurrentSymbolCancelAllButton(root);
      if (hasCurrentSymbolOpenOrders(root, symbol, symbolFilterOk, cancelAllButton)) {
        return { hasOrders: true, cancelAllButton };
      }
      await delay(100);
    }
    if (!isCurrentObservedSymbol(symbol)) return { hasOrders: false, cancelAllButton: null };
    const cancelAllButton = findCurrentSymbolCancelAllButton(root);
    return {
      hasOrders: hasCurrentSymbolOpenOrders(root, symbol, symbolFilterOk, cancelAllButton),
      cancelAllButton,
    };
  }

  function isOpenOrdersScopeConfirmedForSymbol(root, symbol) {
    const checkbox = findHideOtherSymbolCheckbox(root);
    return isOpenOrdersScopeConfirmedForSymbolText(
      root?.textContent || '',
      symbol,
      getCheckboxCheckedState(checkbox),
    );
  }

  async function waitForCurrentSymbolOpenOrdersCleared(root, symbol) {
    const deadline = Date.now() + LADDER_REPLACE_OPEN_ORDERS_CLEAR_TIMEOUT_MS;
    let currentRoot = root;
    let clearCandidateSince = null;
    let lastStatus = currentRoot ? 'symbol_filter_not_confirmed' : 'scope_not_found';
    while (true) {
      if (!isCurrentObservedSymbol(symbol)) {
        return { ok: false, status: 'symbol_changed', root: currentRoot };
      }
      const refreshedRoot = getActiveOpenOrdersScope();
      currentRoot = refreshedRoot;
      if (!currentRoot) {
        clearCandidateSince = null;
        lastStatus = 'scope_not_found';
        if (!shouldContinueOpenOrdersClearObservation({
          nowMs: Date.now(),
          deadlineMs: deadline,
          clearCandidate: false,
        })) break;
        await delay(120);
        continue;
      }
      if (!isOpenOrdersScopeConfirmedForSymbol(currentRoot, symbol)) {
        clearCandidateSince = null;
        lastStatus = 'symbol_filter_not_confirmed';
        if (!shouldContinueOpenOrdersClearObservation({
          nowMs: Date.now(),
          deadlineMs: deadline,
          clearCandidate: false,
        })) break;
        await delay(120);
        continue;
      }
      lastStatus = 'not_cleared';
      const openOrdersCount = getOpenOrdersTabCount();
      const scopeText = currentRoot.textContent || '';
      const clearCandidate = isCurrentSymbolOpenOrdersClearCandidate({
        scopeText,
        symbol,
        openOrdersCount,
      });
      if (isCurrentSymbolOpenOrdersDefinitivelyClear({
        scopeText,
        symbol,
        openOrdersCount,
      })) {
        return { ok: true, status: 'cleared', root: currentRoot };
      }
      const stability = updateOpenOrdersClearStability({
        clearCandidate,
        clearCandidateSince,
        nowMs: Date.now(),
        settleMs: CANCEL_OPEN_ORDERS_CLEAR_SETTLE_MS,
      });
      clearCandidateSince = stability.clearCandidateSince;
      if (stability.cleared) {
        return { ok: true, status: 'cleared', root: currentRoot };
      }
      if (!shouldContinueOpenOrdersClearObservation({
        nowMs: Date.now(),
        deadlineMs: deadline,
        clearCandidate,
      })) break;
      await delay(120);
    }
    if (!isCurrentObservedSymbol(symbol)) {
      return { ok: false, status: 'symbol_changed', root: currentRoot };
    }
    return { ok: false, status: lastStatus, root: currentRoot };
  }

  function getVisibleDirectChildren(el) {
    return Array.from(el?.children || []).filter(isVisibleElement);
  }

  function findOpenOrderRowCells(row) {
    const candidates = Array.from(row.querySelectorAll(
      '.flex.items-center.typography-caption2.text-PrimaryText.w-full, .flex.items-center.typography-caption2.text-PrimaryText'
    ));
    const rowBody = candidates.find((el) => getVisibleDirectChildren(el).length >= 10) || row.firstElementChild;
    return getVisibleDirectChildren(rowBody);
  }

  function findOpenOrderRowCancelButton(row) {
    const icon = row.querySelector('svg[aria-label="撤销挂单"]');
    if (!icon || !isVisibleElement(icon)) return null;
    const target = icon.closest('button, [role="button"], a, [tabindex]') || icon;
    if (!target || !row.contains(target) || !isVisibleElement(target)) return null;
    if (target.disabled || target.getAttribute('aria-disabled') === 'true') return null;
    return target;
  }

  function clickDomTarget(target) {
    if (!target || !target.isConnected || !isVisibleElement(target)) return false;
    if (typeof target.click === 'function') {
      target.click();
      return true;
    }
    return target.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window,
    }));
  }

  function getOpenOrderRowKey(cells, row) {
    const cellText = cells
      .slice(0, 10)
      .map((cell) => (cell.textContent || '').replace(/\s+/g, ' ').trim())
      .join('|');
    return cellText || (row.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function readCurrentSymbolOpenOrderRows(root, symbol, plan = null) {
    if (!root || !symbol) return [];
    return Array.from(root.querySelectorAll('.list-item-container'))
      .filter(isVisibleElement)
      .map((row) => {
        const cells = findOpenOrderRowCells(row);
        const symbolText = (cells[1]?.textContent || '').replace(/\s+/g, ' ').trim();
        const sideText = (cells[3]?.textContent || '').replace(/\s+/g, ' ').trim();
        const qty = normalizeDecimalString((cells[5]?.textContent || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/)?.[0] || '');
        const cancelButton = findOpenOrderRowCancelButton(row);
        return {
          root,
          row,
          cells,
          symbolText,
          sideText,
          qty,
          cancelButton,
          key: getOpenOrderRowKey(cells, row),
        };
      })
      .filter((row) => (
        isOpenOrderRowCurrentSymbol(row.symbolText, symbol) &&
        isOpenOrderRowForPlan(row.sideText, plan) &&
        row.qty &&
        isPositiveDecimalString(row.qty) &&
        row.cancelButton
      ));
  }

  function isOpenOrderRowCurrentSymbol(symbolText, symbol) {
    const tokens = String(symbolText || '').toUpperCase().match(/[A-Z0-9_]+/g) || [];
    return tokens.includes(String(symbol || '').toUpperCase());
  }

  function isOpenOrderRowForPlan(sideText, plan) {
    if (!plan) return true;
    const normalized = String(sideText || '').replace(/\s+/g, '').toUpperCase();
    if (plan.spec?.mode === 'OPEN' && plan.spec.side === 'LONG') {
      return normalized.includes('开多') || normalized.includes('OPENLONG');
    }
    if (plan.spec?.mode === 'OPEN' && plan.spec.side === 'SHORT') {
      return normalized.includes('开空') || normalized.includes('OPENSHORT');
    }
    if (plan.spec?.mode === 'CLOSE' && plan.spec.side === 'LONG') {
      return normalized.includes('平多') || normalized.includes('CLOSELONG');
    }
    if (plan.spec?.mode === 'CLOSE' && plan.spec.side === 'SHORT') {
      return normalized.includes('平空') || normalized.includes('CLOSESHORT');
    }
    return false;
  }

  async function waitForCurrentSymbolOpenOrderRows(root, symbol, plan = null, options = null) {
    const { openOrdersCount = null } = options || {};
    const timeoutMs = openOrdersCount > 0 ? LADDER_REPLACE_OPEN_ORDERS_CLEAR_TIMEOUT_MS : 1600;
    const deadline = Date.now() + timeoutMs;
    let currentRoot = root;
    while (Date.now() < deadline) {
      const refreshedRoot = getActiveOpenOrdersScope();
      if (refreshedRoot) currentRoot = refreshedRoot;
      const rows = readCurrentSymbolOpenOrderRows(currentRoot, symbol, plan);
      if (rows.length) return rows;
      await delay(100);
    }
    return readCurrentSymbolOpenOrderRows(currentRoot, symbol, plan);
  }

  function selectOpenOrderRowsToCancelForPlan(plan, rows, options = null) {
    const { allowPartial = false } = options || {};
    const rowsToCancel = [];
    let cancelQty = '0';
    for (const row of rows) {
      if (!isOpenOrderRowForPlan(row.sideText, plan)) continue;
      rowsToCancel.push(row);
      cancelQty = addDecimalStrings(cancelQty, row.qty);
      if (compareDecimalStrings(cancelQty, plan.totalQty) >= 0) break;
    }
    return compareDecimalStrings(cancelQty, plan.totalQty) >= 0 || (allowPartial && rowsToCancel.length > 0)
      ? rowsToCancel
      : [];
  }

  function getPlanDirectionLabel(plan) {
    if (plan?.spec?.mode === 'OPEN' && plan.spec.side === 'LONG') return '开多';
    if (plan?.spec?.mode === 'OPEN' && plan.spec.side === 'SHORT') return '开空';
    if (plan?.spec?.mode === 'CLOSE' && plan.spec.side === 'LONG') return '平多';
    if (plan?.spec?.mode === 'CLOSE' && plan.spec.side === 'SHORT') return '平空';
    return '';
  }

  function countOpenOrderRowsByKey(root, symbol, key) {
    return readCurrentSymbolOpenOrderRows(root, symbol).filter((row) => row.key === key).length;
  }

  async function waitForOpenOrderRowKeyCountBelow(symbol, key, previousCount) {
    const deadline = Date.now() + LADDER_REPLACE_OPEN_ORDERS_CLEAR_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (!isCurrentObservedSymbol(symbol)) return false;
      const activeRoot = getActiveOpenOrdersScope();
      if (activeRoot && countOpenOrderRowsByKey(activeRoot, symbol, key) < previousCount) return true;
      await delay(120);
    }
    const activeRoot = getActiveOpenOrdersScope();
    return Boolean(activeRoot && countOpenOrderRowsByKey(activeRoot, symbol, key) < previousCount);
  }

  async function cancelOpenOrderRowsForPlan(root, plan) {
    let cancelQty = '0';
    let currentRoot = root;
    while (compareDecimalStrings(cancelQty, plan.totalQty) < 0) {
      if (!isCurrentObservedSymbol(plan.symbol)) throw new Error('逐行撤单前交易对已变化');
      const remainingQty = subtractDecimalStrings(plan.totalQty, cancelQty);
      const refreshedRoot = getActiveOpenOrdersScope();
      if (refreshedRoot) currentRoot = refreshedRoot;
      const rows = readCurrentSymbolOpenOrderRows(currentRoot, plan.symbol, plan);
      const row = selectOpenOrderRowsToCancelForPlan(
        { ...plan, totalQty: remainingQty },
        rows,
        { allowPartial: true }
      )[0];
      if (!row) {
        throw new Error(`${plan.symbol} 当前币可撤挂单数量不足，已停止重挂`);
      }
      currentRoot = row.root || currentRoot;
      const previousKeyCount = countOpenOrderRowsByKey(row.root, plan.symbol, row.key);
      if (!row.cancelButton?.isConnected || !isVisibleElement(row.cancelButton)) {
        if (previousKeyCount === 0) continue;
        throw new Error('当前币挂单撤单入口已失效，已停止重挂');
      }
      const dialogsBefore = new Set(getVisibleDialogs());
      if (!clickDomTarget(row.cancelButton)) {
        throw new Error('当前币挂单撤单入口点击失败，已停止重挂');
      }
      waitForTradeUiMutation({ timeoutMs: 800 });
      const dialog = await waitForNewVisibleDialog(dialogsBefore);
      if (dialog) {
        setLadderStatus(`${plan.symbol} 单行撤单确认弹窗已打开`);
        const dialogClosed = await waitForDialogToClose(dialog);
        if (!dialogClosed) {
          const error = new Error(`${plan.symbol} 单行撤单确认弹窗仍未关闭，未恢复页面状态`);
          error.name = 'DialogNotClosedError';
          throw error;
        }
      } else {
        await delay(260);
      }
      if (!(await waitForOpenOrderRowKeyCountBelow(plan.symbol, row.key, previousKeyCount))) {
        throw new Error(`${plan.symbol} 当前币挂单仍存在，已停止重挂`);
      }
      cancelQty = addDecimalStrings(cancelQty, row.qty);
    }
    return { ok: true, cancelQty };
  }

  async function setHideOtherSymbolChecked(root, desiredChecked, symbol = getCurrentSymbol()) {
    if (!isCurrentObservedSymbol(symbol)) return false;
    const checkbox = findHideOtherSymbolCheckbox(root);
    if (!checkbox) return false;
    const currentChecked = getCheckboxCheckedState(checkbox);
    if (currentChecked === desiredChecked) return true;
    if (currentChecked === null) return false;
    if (!isCurrentObservedSymbol(symbol)) return false;
    checkbox.click();
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline) {
      await delay(80);
      if (!isCurrentObservedSymbol(symbol)) return false;
      const nextChecked = getCheckboxCheckedState(findHideOtherSymbolCheckbox(root));
      if (nextChecked === desiredChecked) return true;
    }
    return false;
  }

  async function ensureOpenOrdersLimitedToCurrentSymbol(root, symbol) {
    const checkbox = findHideOtherSymbolCheckbox(root);
    if (!checkbox) {
      return {
        ok: isOpenOrdersScopeLimitedToSymbol(root, symbol),
        originalChecked: null,
      };
    }
    const originalChecked = getCheckboxCheckedState(checkbox);
    if (originalChecked === null) {
      return {
        ok: isOpenOrdersScopeLimitedToSymbol(root, symbol),
        originalChecked,
      };
    }
    const ok = originalChecked || await setHideOtherSymbolChecked(root, true, symbol);
    return {
      ok: ok || isOpenOrdersScopeLimitedToSymbol(root, symbol),
      originalChecked,
    };
  }

  async function restoreOpenOrdersSymbolFilter(root, originalChecked, symbol = getCurrentSymbol()) {
    if (originalChecked !== false) return true;
    return setHideOtherSymbolChecked(root, false, symbol);
  }

  function getVisibleDialogs() {
    return Array.from(document.querySelectorAll(
      '[role="dialog"], [class*="modal"], [class*="Modal"], [class*="popover"], [class*="Popover"], [class*="drawer"], [class*="Drawer"]'
    ))
      .filter(isVisibleElement);
  }

  function findNewVisibleDialog(dialogsBefore) {
    const previousDialogs = dialogsBefore || new Set();
    for (const dialog of getVisibleDialogs()) {
      if (previousDialogs.has(dialog)) continue;
      return dialog;
    }
    return null;
  }

  async function waitForNewVisibleDialog(dialogsBefore) {
    const deadline = Date.now() + 1800;
    while (Date.now() < deadline) {
      const dialog = findNewVisibleDialog(dialogsBefore);
      if (dialog) return dialog;
      await delay(100);
    }
    return findNewVisibleDialog(dialogsBefore);
  }

  async function waitForDialogToClose(dialog, timeoutMs = CANCEL_DIALOG_CLOSE_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && dialog.isConnected && isVisibleElement(dialog)) {
      await delay(500);
    }
    if (dialog.isConnected && isVisibleElement(dialog)) return false;
    return true;
  }

  function createBinanceCancelAllDialogDecisionWatcher() {
    const watcher = {
      action: null,
      error: null,
      seenDialog: false,
    };

    const recordAction = (eventTarget) => {
      try {
        const contract = findBinanceCancelAllDialog(document, isVisibleElement);
        if (!contract) return;
        watcher.seenDialog = true;
        const action = classifyBinanceCancelAllDialogAction(contract, eventTarget);
        if (action && !watcher.action) watcher.action = action;
      } catch (error) {
        watcher.error = error;
      }
    };
    const handleClick = (event) => recordAction(event.target);
    const handleKeydown = (event) => {
      if (event.key !== 'Escape' && event.key !== 'Enter' && event.key !== ' ') return;
      try {
        const contract = findBinanceCancelAllDialog(document, isVisibleElement);
        if (!contract) return;
        watcher.seenDialog = true;
        const action = classifyBinanceCancelAllDialogKeyboardAction(
          contract,
          event.key,
          document.activeElement || event.target,
        );
        if (action && !watcher.action) watcher.action = action;
      } catch (error) {
        watcher.error = error;
      }
    };

    document.addEventListener('click', handleClick, true);
    document.addEventListener('keydown', handleKeydown, true);
    return {
      watcher,
      dispose() {
        document.removeEventListener('click', handleClick, true);
        document.removeEventListener('keydown', handleKeydown, true);
      },
    };
  }

  async function waitForBinanceCancelAllDialogDecision(watcher, onDialogSeen) {
    const discoveryDeadline = Date.now() + CANCEL_DIALOG_DISCOVERY_TIMEOUT_MS;
    let closeDeadline = null;
    let reportedDialog = false;
    while (true) {
      if (watcher.error) throw watcher.error;
      const contract = findBinanceCancelAllDialog(document, isVisibleElement);
      if (contract) {
        watcher.seenDialog = true;
        closeDeadline ??= Date.now() + CANCEL_DIALOG_CLOSE_TIMEOUT_MS;
        if (!reportedDialog) {
          reportedDialog = true;
          onDialogSeen();
        }
      }

      const status = resolveCancelDialogDecision({
        seenDialog: watcher.seenDialog,
        action: watcher.action,
        dialogVisible: Boolean(contract),
        nowMs: Date.now(),
        discoveryDeadlineMs: discoveryDeadline,
        closeDeadlineMs: closeDeadline,
      });
      if (status !== 'waiting') return { status };
      await delay(CANCEL_DIALOG_DECISION_POLL_MS);
    }
  }

  function getBinanceChartOrdersTarget() {
    return getBinanceChartOrdersTargetDom(document);
  }

  function writeChartOrdersRecoveryRecord() {
    sessionStorage.setItem(
      CHART_ORDERS_RECOVERY_STORAGE_KEY,
      createChartOrdersRecoveryRecord(Date.now()),
    );
  }

  function clearChartOrdersRecoveryRecord() {
    sessionStorage.removeItem(CHART_ORDERS_RECOVERY_STORAGE_KEY);
  }

  function readChartOrdersRecoveryRecord() {
    return parseChartOrdersRecoveryRecord(
      sessionStorage.getItem(CHART_ORDERS_RECOVERY_STORAGE_KEY),
      Date.now(),
    );
  }

  function dispatchChartOrdersPointerEvents(element, eventTypes, relatedTarget = null) {
    for (const type of eventTypes) {
      element.dispatchEvent(new MouseEvent(type, {
        bubbles: type !== 'mouseenter' && type !== 'mouseleave',
        cancelable: true,
        composed: true,
        relatedTarget,
        view: window,
      }));
    }
  }

  async function waitForBinanceChartOrdersPopover(target, expectedChecked = null) {
    const deadline = Date.now() + CHART_ORDERS_MENU_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const current = findActiveBinanceChartOrdersPopover(document, target, isVisibleElement);
      if (current && (expectedChecked === null || current.checked === expectedChecked)) {
        return current;
      }
      await delay(CHART_ORDERS_MENU_POLL_MS);
    }
    const current = findActiveBinanceChartOrdersPopover(document, target, isVisibleElement);
    if (current && (expectedChecked === null || current.checked === expectedChecked)) return current;
    throw new Error(expectedChecked === null
      ? 'Binance chart OpenOrders popover did not open'
      : `Binance chart OpenOrders state did not become ${expectedChecked}`);
  }

  async function openBinanceChartOrdersPopover(target) {
    const currentTarget = getBinanceChartOrdersTarget();
    assertSameBinanceChartOrdersTarget(target, currentTarget);
    dispatchChartOrdersPointerEvents(
      currentTarget.trigger,
      ['pointerover', 'mouseover', 'mouseenter'],
    );
    return waitForBinanceChartOrdersPopover(currentTarget);
  }

  async function closeBinanceChartOrdersPopover(target) {
    const currentTarget = getBinanceChartOrdersTarget();
    assertSameBinanceChartOrdersTarget(target, currentTarget);
    const current = findActiveBinanceChartOrdersPopover(
      document,
      currentTarget,
      isVisibleElement,
    );
    if (!current) return;

    dispatchChartOrdersPointerEvents(
      current.popover,
      ['pointerout', 'mouseout', 'mouseleave'],
      currentTarget.chartRoot,
    );
    dispatchChartOrdersPointerEvents(
      currentTarget.trigger,
      ['pointerout', 'mouseout', 'mouseleave'],
      currentTarget.chartRoot,
    );
    dispatchChartOrdersPointerEvents(
      currentTarget.chartRoot,
      ['pointerover', 'mouseover', 'mouseenter'],
      currentTarget.trigger,
    );

    const deadline = Date.now() + CHART_ORDERS_MENU_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (!findActiveBinanceChartOrdersPopover(document, currentTarget, isVisibleElement)) return;
      await delay(CHART_ORDERS_MENU_POLL_MS);
    }
    if (findActiveBinanceChartOrdersPopover(document, currentTarget, isVisibleElement)) {
      throw new Error('Binance chart OpenOrders popover did not close');
    }
  }

  async function hideBinanceChartOrdersForBulkCancel(target, state) {
    const current = await openBinanceChartOrdersPopover(target);
    state.originalChecked = current.checked;
    if (current.checked) {
      writeChartOrdersRecoveryRecord();
      state.changed = true;
      current.checkbox.click();
      await waitForBinanceChartOrdersPopover(target, false);
    }
    await closeBinanceChartOrdersPopover(target);
  }

  async function restoreBinanceChartOrdersAfterBulkCancel(target, state) {
    assertSameBinanceChartOrdersTarget(target, getBinanceChartOrdersTarget());
    const current = await openBinanceChartOrdersPopover(target);
    if (current.checked !== state.originalChecked) {
      current.checkbox.click();
      await waitForBinanceChartOrdersPopover(target, state.originalChecked);
    }
    await closeBinanceChartOrdersPopover(target);
    clearChartOrdersRecoveryRecord();
  }

  async function recoverChartOrdersStateAfterReload() {
    const recovery = readChartOrdersRecoveryRecord();
    if (recovery.status === 'missing') {
      chartOrdersRecoveryPendingAtStartup = false;
      return { status: 'missing' };
    }
    if (recovery.status === 'invalid' || recovery.status === 'expired') {
      emit(
        'ERR',
        `图表当前委托恢复记录${recovery.status === 'invalid' ? '无效' : '已过期'}，未修改页面状态`,
      );
      clearChartOrdersRecoveryRecord();
      chartOrdersRecoveryPendingAtStartup = false;
      return { status: recovery.status };
    }

    const target = findBinanceChartOrdersTargetDom(document);
    if (!target) return { status: 'target_not_ready' };
    await restoreBinanceChartOrdersAfterBulkCancel(target, {
      originalChecked: recovery.record.originalChecked,
      changed: true,
    });
    chartOrdersRecoveryPendingAtStartup = false;
    chartOrdersRecoveryLastError = null;
    log('已恢复刷新前的图表当前委托显示状态');
    return { status: 'restored' };
  }

  function scheduleChartOrdersRecovery() {
    if (
      !chartOrdersRecoveryPendingAtStartup
      || chartOrdersRecoveryTask
      || cancelCurrentSymbolOpenOrdersTask
      || document.hidden
      || !isFuturesTradingPage()
    ) return;

    const task = recoverChartOrdersStateAfterReload();
    chartOrdersRecoveryTask = task;
    task.catch((error) => {
      const message = String(error?.message || error);
      if (message !== chartOrdersRecoveryLastError) {
        chartOrdersRecoveryLastError = message;
        emit('ERR', '恢复刷新前的图表当前委托显示失败', error);
      }
    }).finally(() => {
      if (chartOrdersRecoveryTask === task) chartOrdersRecoveryTask = null;
    });
  }

  async function runCancelCurrentSymbolOpenOrders(options = null) {
    const { waitUntilCleared = false } = options || {};
    const symbol = getCurrentSymbol();
    if (!symbol) {
      setLadderStatus('未识别当前交易对');
      return { ok: false, status: 'no_symbol', message: '未识别当前交易对' };
    }
    if (!isCurrentObservedSymbol(symbol)) {
      const message = '交易对正在切换';
      setLadderStatus(message);
      return { ok: false, status: 'symbol_changing', message };
    }

    const previousAccountOrdersTab = findSelectedAccountOrdersTab();
    let openOrdersScope = null;
    let previousOpenOrdersSubTab = null;
    let symbolFilterOriginalChecked = null;
    let restoreTemporaryUiState = true;
    let chartOrdersTarget = null;
    const chartOrdersState = { originalChecked: null, changed: false };
    let restoreChartOrdersState = true;
    let successStatusMessage = null;

    try {
      setLadderStatus(`查找 ${symbol} 当前委托`);
      const tabReady = await activateOpenOrdersTab();
      if (!tabReady || !isCurrentObservedSymbol(symbol)) {
        const message = '当前委托页未就绪或交易对已变化';
        setLadderStatus(message);
        return { ok: false, status: 'tab_not_ready', message };
      }
      openOrdersScope = await waitForActiveOpenOrdersScope();
      if (!openOrdersScope || !isCurrentObservedSymbol(symbol)) {
        const message = '未定位到当前委托面板';
        setLadderStatus(message);
        return { ok: false, status: 'scope_not_found', message };
      }
      const basicSubTabState = await activateOpenOrdersBasicSubTab(openOrdersScope);
      previousOpenOrdersSubTab = basicSubTabState.previousSubTab;
      if (!basicSubTabState.ready || !isCurrentObservedSymbol(symbol)) {
        const message = '未定位到当前委托基础单';
        setLadderStatus(message);
        return { ok: false, status: 'basic_tab_not_ready', message };
      }
      openOrdersScope = await waitForActiveOpenOrdersScope();
      if (!openOrdersScope || !isCurrentObservedSymbol(symbol)) {
        const message = '未定位到当前委托面板';
        setLadderStatus(message);
        return { ok: false, status: 'scope_not_found', message };
      }
      const symbolFilter = await ensureOpenOrdersLimitedToCurrentSymbol(openOrdersScope, symbol);
      symbolFilterOriginalChecked = symbolFilter.originalChecked;
      if (!symbolFilter.ok || !isCurrentObservedSymbol(symbol)) {
        const message = '未确认只显示当前币挂单';
        setLadderStatus(message);
        return { ok: false, status: 'symbol_filter_not_confirmed', message };
      }
      openOrdersScope = await waitForActiveOpenOrdersScope();
      if (!openOrdersScope || !isCurrentObservedSymbol(symbol)) {
        const message = '未定位到当前委托面板';
        setLadderStatus(message);
        return { ok: false, status: 'scope_not_found', message };
      }
      const openOrdersEvidence = await waitForCurrentSymbolOpenOrders(openOrdersScope, symbol, symbolFilter.ok);
      if (!isCurrentObservedSymbol(symbol)) {
        const message = '读取当前币挂单时交易对已变化';
        setLadderStatus(message);
        return { ok: false, status: 'symbol_changed', message };
      }
      if (!openOrdersEvidence.hasOrders) {
        setLadderStatus(`${symbol} 当前币无挂单`);
        return { ok: true, status: 'no_orders' };
      }

      let cancelAllButton = openOrdersEvidence.cancelAllButton;
      if (!cancelAllButton) {
        const message = '未找到当前委托全撤按钮';
        setLadderStatus(message);
        return { ok: false, status: 'cancel_button_not_found', message };
      }

      if (!isCurrentObservedSymbol(symbol)) {
        const message = '撤单前交易对已变化';
        setLadderStatus(message);
        return { ok: false, status: 'symbol_changed', message };
      }

      try {
        chartOrdersTarget = getBinanceChartOrdersTarget();
        setLadderStatus(`正在隐藏 ${symbol} 图表当前委托`);
        await hideBinanceChartOrdersForBulkCancel(chartOrdersTarget, chartOrdersState);
      } catch (e) {
        emit('ERR', '撤单前隐藏图表当前委托失败', e);
        const message = '未能确认图表当前委托已隐藏，未打开撤单确认框';
        setLadderStatus(message);
        return { ok: false, status: 'chart_orders_not_hidden', message };
      }

      if (!isCurrentObservedSymbol(symbol)) {
        const message = '隐藏图表当前委托后交易对已变化';
        setLadderStatus(message);
        return { ok: false, status: 'symbol_changed', message };
      }

      openOrdersScope = await waitForActiveOpenOrdersScope();
      if (!openOrdersScope || !isCurrentObservedSymbol(symbol)) {
        const message = '隐藏图表当前委托后，未定位到当前委托面板';
        setLadderStatus(message);
        return { ok: false, status: 'scope_not_found', message };
      }
      if (!isOpenOrdersScopeConfirmedForSymbol(openOrdersScope, symbol)) {
        const message = '隐藏图表当前委托后，未确认只显示当前币挂单';
        setLadderStatus(message);
        return { ok: false, status: 'symbol_filter_not_confirmed', message };
      }
      cancelAllButton = findCurrentSymbolCancelAllButton(openOrdersScope);
      if (!cancelAllButton) {
        const message = '隐藏图表当前委托后，未找到当前委托全撤按钮';
        setLadderStatus(message);
        return { ok: false, status: 'cancel_button_not_found', message };
      }

      const dialogDecisionWatcher = createBinanceCancelAllDialogDecisionWatcher();
      let dialogDecision;
      try {
        cancelAllButton.click();
        dialogDecision = await waitForBinanceCancelAllDialogDecision(
          dialogDecisionWatcher.watcher,
          () => setLadderStatus(`${symbol} 撤单确认弹窗已打开`),
        );
      } catch (error) {
        restoreTemporaryUiState = false;
        restoreChartOrdersState = false;
        emit('ERR', '币安撤单确认弹窗结构异常', error);
        const message = `${symbol} 撤单确认弹窗结构异常，图表当前委托保持隐藏`;
        setLadderStatus(message);
        return { ok: false, status: 'dialog_contract_invalid', message };
      } finally {
        dialogDecisionWatcher.dispose();
      }
      if (!isCurrentObservedSymbol(symbol)) {
        const message = '确认撤单前交易对已变化';
        setLadderStatus(message);
        return { ok: false, status: 'symbol_changed', message };
      }

      if (dialogDecision.status === 'dialog_not_closed') {
        restoreTemporaryUiState = false;
        restoreChartOrdersState = false;
        const message = `${symbol} 撤单确认弹窗仍未关闭，图表当前委托保持隐藏`;
        setLadderStatus(message);
        return { ok: false, status: 'dialog_not_closed', message };
      }
      if (dialogDecision.status === 'not_found') {
        const message = `${symbol} 未识别到撤单确认弹窗，未继续撤单流程`;
        setLadderStatus(message);
        return { ok: false, status: 'dialog_not_found', message };
      }
      if (dialogDecision.status === 'cancelled') {
        const message = `${symbol} 已取消撤单`;
        setLadderStatus(`${symbol} 已取消撤单，正在恢复页面状态`);
        successStatusMessage = `${message}，已恢复页面状态`;
        return { ok: false, status: 'cancelled', message };
      }
      waitForTradeUiMutation({ timeoutMs: 800 });
      setLadderStatus(`${symbol} 已确认撤单，等待当前币挂单清空`);

      openOrdersScope = await waitForActiveOpenOrdersScope();
      if (!openOrdersScope || !isCurrentObservedSymbol(symbol)) {
        const message = '未定位到当前委托面板';
        setLadderStatus(message);
        return { ok: false, status: 'scope_not_found', message };
      }
      const clearResult = await waitForCurrentSymbolOpenOrdersCleared(openOrdersScope, symbol);
      openOrdersScope = clearResult.root || openOrdersScope;
      if (!clearResult.ok) {
        if (clearResult.status === 'symbol_changed') {
          const message = '等待撤单完成时交易对已变化';
          setLadderStatus(message);
          return { ok: false, status: 'symbol_changed', message };
        }
        if (clearResult.status === 'scope_not_found') {
          const message = '等待撤单完成时未定位到当前委托面板';
          setLadderStatus(message);
          return { ok: false, status: 'scope_not_found', message };
        }
        if (clearResult.status === 'symbol_filter_not_confirmed') {
          const message = '等待撤单完成时未确认只显示当前币挂单';
          setLadderStatus(message);
          return { ok: false, status: 'symbol_filter_not_confirmed', message };
        }
        const message = waitUntilCleared
          ? `${symbol} 当前币挂单仍存在，已停止重挂`
          : `${symbol} 当前币挂单仍存在，撤单流程未完成`;
        setLadderStatus(message);
        return { ok: false, status: 'not_cleared', message };
      }
      setLadderStatus(`${symbol} 当前币挂单已撤，正在恢复页面状态`);
      successStatusMessage = waitUntilCleared
        ? `${symbol} 当前币挂单已撤，继续重挂`
        : `${symbol} 撤单流程结束，已恢复筛选状态`;
      return { ok: true, status: 'cleared' };
    } finally {
      let chartOrdersRestoreSucceeded = true;
      if (restoreChartOrdersState && chartOrdersState.changed) {
        try {
          await restoreBinanceChartOrdersAfterBulkCancel(
            chartOrdersTarget,
            chartOrdersState,
          );
        } catch (e) {
          chartOrdersRestoreSucceeded = false;
          emit('ERR', '恢复图表当前委托显示失败', e);
          setLadderStatus('未能恢复图表当前委托显示');
        }
      }

      if (restoreTemporaryUiState && isCurrentObservedSymbol(symbol)) {
        let restoreSucceeded = true;
        openOrdersScope = await waitForActiveOpenOrdersScope();
        if (openOrdersScope && symbolFilterOriginalChecked === false) {
          const restored = await restoreOpenOrdersSymbolFilter(openOrdersScope, symbolFilterOriginalChecked, symbol);
          if (!restored) {
            restoreSucceeded = false;
            setLadderStatus('未能恢复隐藏其他合约状态');
          }
        }
        if (previousOpenOrdersSubTab) {
          await restoreOpenOrdersSubTab(previousOpenOrdersSubTab, symbol);
        }
        if (isCurrentObservedSymbol(symbol)) {
          await restoreAccountOrdersTab(previousAccountOrdersTab, symbol);
        }
        if (chartOrdersRestoreSucceeded && restoreSucceeded && successStatusMessage) {
          setLadderStatus(successStatusMessage);
        }
      }
    }
  }

  async function cancelCurrentSymbolOpenOrders(options = null) {
    if (cancelCurrentSymbolOpenOrdersTask) return cancelCurrentSymbolOpenOrdersTask;
    if (ladderTask) {
      const message = '阶梯任务运行中，请先停止阶梯挂单';
      setLadderStatus(message);
      return { ok: false, status: 'ladder_running', message };
    }
    const task = runCancelCurrentSymbolOpenOrders(options);
    cancelCurrentSymbolOpenOrdersTask = task;
    scheduleRenderPanel();
    try {
      return await task;
    } finally {
      if (cancelCurrentSymbolOpenOrdersTask === task) cancelCurrentSymbolOpenOrdersTask = null;
      scheduleRenderPanel();
    }
  }

  async function cancelCurrentSymbolOpenOrdersForPlan(plan) {
    const symbol = getCurrentSymbol();
    if (!isCurrentObservedSymbol(symbol) || symbol !== plan?.symbol) {
      const message = '逐行撤单前交易对已变化';
      setLadderStatus(message);
      return { ok: false, status: 'symbol_changed', message };
    }

    const previousAccountOrdersTab = findSelectedAccountOrdersTab();
    let openOrdersScope = null;
    let previousOpenOrdersSubTab = null;
    let symbolFilterOriginalChecked = null;
    let restoreTemporaryUiState = true;

    try {
      setLadderStatus(`查找 ${symbol} 当前委托`);
      const tabReady = await activateOpenOrdersTab();
      if (!tabReady || !isCurrentObservedSymbol(symbol)) {
        const message = '当前委托页未就绪或交易对已变化';
        setLadderStatus(message);
        return { ok: false, status: 'tab_not_ready', message };
      }

      openOrdersScope = await waitForActiveOpenOrdersScope();
      if (!openOrdersScope) {
        const message = '未定位到当前委托面板';
        setLadderStatus(message);
        return { ok: false, status: 'scope_not_found', message };
      }

      const basicSubTabState = await activateOpenOrdersBasicSubTab(openOrdersScope);
      previousOpenOrdersSubTab = basicSubTabState.previousSubTab;
      if (!basicSubTabState.ready) {
        const message = '未定位到当前委托基础单';
        setLadderStatus(message);
        return { ok: false, status: 'basic_tab_not_ready', message };
      }

      openOrdersScope = await waitForActiveOpenOrdersScope();
      if (!openOrdersScope) {
        const message = '未定位到当前委托面板';
        setLadderStatus(message);
        return { ok: false, status: 'scope_not_found', message };
      }

      const symbolFilter = await ensureOpenOrdersLimitedToCurrentSymbol(openOrdersScope, symbol);
      symbolFilterOriginalChecked = symbolFilter.originalChecked;
      if (!symbolFilter.ok) {
        const message = '未确认只显示当前币挂单';
        setLadderStatus(message);
        return { ok: false, status: 'symbol_filter_not_confirmed', message };
      }

      openOrdersScope = await waitForActiveOpenOrdersScope();
      if (!openOrdersScope) {
        const message = '未定位到当前委托面板';
        setLadderStatus(message);
        return { ok: false, status: 'scope_not_found', message };
      }

      const openOrdersCount = getOpenOrdersTabCount();
      const rows = await waitForCurrentSymbolOpenOrderRows(openOrdersScope, symbol, plan, {
        openOrdersCount,
      });
      if (!rows.length) {
        const directionLabel = getPlanDirectionLabel(plan);
        const message = `未定位到 ${symbol}${directionLabel ? ` ${directionLabel}` : ''} 当前币可逐行撤单的基础单`;
        setLadderStatus(message);
        return { ok: false, status: 'rows_not_found', message };
      }

      const rowsToCancel = selectOpenOrderRowsToCancelForPlan(plan, rows);
      if (!rowsToCancel.length) {
        const message = `未选中 ${symbol} 当前币待撤挂单`;
        setLadderStatus(message);
        return { ok: false, status: 'rows_not_selected', message };
      }

      setLadderStatus(`${symbol} 撤销 ${rowsToCancel.length} 笔当前币挂单`);
      await cancelOpenOrderRowsForPlan(openOrdersScope, plan);
      setLadderStatus(`${symbol} 当前币挂单已替换，继续重挂`);
      return { ok: true, status: 'rows_cleared' };
    } catch (e) {
      if (e?.name === 'DialogNotClosedError') restoreTemporaryUiState = false;
      const message = e?.message || '当前币挂单逐行撤销失败，已停止重挂';
      setLadderStatus(message);
      const status = e?.name === 'DialogNotClosedError' ? 'dialog_not_closed' : 'row_cancel_failed';
      return { ok: false, status, message };
    } finally {
      if (restoreTemporaryUiState && isCurrentObservedSymbol(symbol)) {
        openOrdersScope = await waitForActiveOpenOrdersScope();
        if (symbolFilterOriginalChecked === false) {
          const restored = openOrdersScope
            ? await restoreOpenOrdersSymbolFilter(openOrdersScope, symbolFilterOriginalChecked, symbol)
            : false;
          if (!restored) setLadderStatus('未能恢复隐藏其他合约状态');
        }
        if (previousOpenOrdersSubTab) {
          await restoreOpenOrdersSubTab(previousOpenOrdersSubTab, symbol);
        }
        if (isCurrentObservedSymbol(symbol)) {
          await restoreAccountOrdersTab(previousAccountOrdersTab, symbol);
        }
      }
    }
  }

  function formatLadderPlanStatus(plan) {
    const levelText = plan.levels === plan.requestedLevels
      ? `${plan.levels}档`
      : `${plan.levels}/${plan.requestedLevels}档`;
    const stepText = plan.ladderStep === DEFAULT_LADDER_STEP ? '' : `/幅${plan.ladderStep}`;
    return `${plan.spec.label} ${plan.percent}%/${levelText}${stepText}`;
  }

  function isReplaceableCloseLadderOpenOrdersFailure(plan, error) {
    if (plan?.spec?.mode !== 'CLOSE') return false;
    return isReduceOnlyOpenOrdersConflictFeedback(error?.message || '');
  }

  function isReplaceableOpenLadderOpenOrdersFailure(plan, error) {
    if (plan?.spec?.mode !== 'OPEN') return false;
    return isOpenLadderOpenOrdersCapacityFeedback(error?.message || '');
  }

  function getOpenLadderMinimumQtyReplacementPlan(error) {
    const plan = error?.openOrdersReplacementPlan;
    if (
      plan?.spec?.mode === 'OPEN' &&
      plan.symbol &&
      plan.precision &&
      plan.totalQty &&
      isPositiveDecimalString(plan.totalQty)
    ) {
      return plan;
    }
    return null;
  }

  function getReplaceableLadderOpenOrdersPlan(plan, error) {
    if (isReplaceableCloseLadderOpenOrdersFailure(plan, error)) return plan;
    if (isReplaceableOpenLadderOpenOrdersFailure(plan, error)) return plan;
    return getOpenLadderMinimumQtyReplacementPlan(error);
  }

  function formatOpenOrdersReplacementStatus(plan) {
    if (plan?.spec?.mode === 'OPEN') return `${plan.symbol} 同向开仓挂单可能占用可开数量，准备替换`;
    return `${plan.symbol} 当前挂单占用可平数量，准备替换`;
  }

  function createLadderExpectedContext(plan) {
    return {
      symbol: plan.symbol,
      mode: plan.spec.mode,
      precision: plan.precision,
    };
  }

  async function runLadderPlanWithOpenOrderReplacement(actionType) {
    let replacementContext = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let plan = null;
      try {
        plan = await buildLadderPlan(actionType, replacementContext);
        setLadderStatus(formatLadderPlanStatus(plan));
        const execution = await executeLadderPlan(plan);
        return { plan, ...execution };
      } catch (e) {
        const replacementPlan = getReplaceableLadderOpenOrdersPlan(plan, e);
        if (attempt > 0 || !replacementPlan) throw e;
        assertLadderExecutionContext(replacementPlan);
        setLadderStatus(formatOpenOrdersReplacementStatus(replacementPlan));
        replacementContext = createLadderExpectedContext(replacementPlan);
        const result = await cancelCurrentSymbolOpenOrdersForPlan(replacementPlan);
        if (!result?.ok) throw new Error(result.message || '当前币挂单未替换，已停止重挂');
      }
    }
    throw new Error('阶梯重挂流程异常');
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

  function getButtonTextSearchRoot(button) {
    if (!button) return null;
    const localRoot = button.closest('[class*="order"], [data-testid*="order"]');
    if (localRoot && localRoot !== document.body) return localRoot;
    return getTradeSearchScopes().find((scope) => scope && scope !== document.body && scope.contains(button)) || null;
  }

  function readCloseableQtyNearButton(button) {
    if (!button) return null;
    const btnRect = button.getBoundingClientRect();
    const root = getButtonTextSearchRoot(button);
    if (!root) return null;
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

  function readQtyTextNearButton(button, label) {
    if (!button) return null;
    const btnRect = button.getBoundingClientRect();
    const root = getButtonTextSearchRoot(button);
    if (!root) return null;
    let best = null;
    let bestScore = Infinity;
    const nodes = root.querySelectorAll('div, span, p, small');
    const re = new RegExp(`${label}\\s*([\\d,]*\\.?\\d+)`, 'g');
    for (const node of nodes) {
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text.includes(label)) continue;
      const matches = Array.from(text.matchAll(re));
      if (!matches.length) continue;
      const r = node.getBoundingClientRect();
      if (!r || !Number.isFinite(r.left)) continue;
      const nodeX = (r.left + r.right) / 2;
      const btnX = (btnRect.left + btnRect.right) / 2;
      const dy = r.top - btnRect.bottom;
      if (dy < -32 || dy > 240) continue;
      const dx = Math.abs(nodeX - btnX);
      const score = dx + Math.abs(dy) * 2;
      if (score >= bestScore) continue;
      const matchIndex = matches.length > 1 && btnX < nodeX ? 0 : matches.length - 1;
      const qty = normalizeDecimalString(matches[matchIndex]?.[1] || '');
      if (!qty) continue;
      bestScore = score;
      best = qty;
    }
    return best;
  }

  function readOpenableQty(openLongBtn, openShortBtn) {
    return {
      longQty: readQtyTextNearButton(openLongBtn, '可开'),
      shortQty: readQtyTextNearButton(openShortBtn, '可开'),
      qtySource: 'near_button',
    };
  }

  function loadCloseSide(symbol = getCurrentSymbol()) {
    return loadSymbolSide(localStorage, LOCAL_CLOSE_SIDE_KEY, symbol, DEFAULT_CLOSE_SIDE);
  }

  function saveCloseSide(value, symbol = getCurrentSymbol()) {
    saveSymbolSide(localStorage, LOCAL_CLOSE_SIDE_KEY, symbol, value);
  }

  function updateCloseSide(value) {
    saveCloseSide(value);
    scheduleRenderPanel();
  }

  function loadOpenSide(symbol = getCurrentSymbol()) {
    return loadSymbolSide(localStorage, LOCAL_OPEN_SIDE_KEY, symbol, DEFAULT_OPEN_SIDE);
  }

  function saveOpenSide(value, symbol = getCurrentSymbol()) {
    saveSymbolSide(localStorage, LOCAL_OPEN_SIDE_KEY, symbol, value);
  }

  function updateOpenSide(value) {
    saveOpenSide(value);
    scheduleRenderPanel();
  }

  // ── 平仓状态三层架构 ──
  // 第一层 rawCloseContext：readCloseContext() 直接从 DOM 读取的原始值
  // 第二层 displayCloseState：resolveDisplayCloseState() 只接受已就绪的平仓快照
  // 第三层 lastConfirmedCloseState：仅在 CLOSE 模式下提交的稳定缓存
  // UI 渲染消费第二层；执行路径只接受第一层两侧都已确认的实时值。

  function readCloseContext(expectedSymbol = getCurrentSymbol()) {
    const pending = {
      symbol: expectedSymbol,
      closeLongBtn: null,
      closeShortBtn: null,
      longQty: null,
      shortQty: null,
      qtySource: null,
      knowsLong: false,
      knowsShort: false,
      hasLong: false,
      hasShort: false,
    };
    if (!isCurrentObservedSymbol(expectedSymbol)) return pending;
    const closeLongBtn = findCloseLongButton();
    const closeShortBtn = findCloseShortButton();
    const { longQty, shortQty, qtySource } = readCloseableQty(closeLongBtn, closeShortBtn);
    if (!isCurrentObservedSymbol(expectedSymbol)) return pending;
    const knowsLong = longQty != null;
    const knowsShort = shortQty != null;
    const hasLong = longQty > 0;
    const hasShort = shortQty > 0;
    return {
      symbol: expectedSymbol,
      closeLongBtn,
      closeShortBtn,
      longQty,
      shortQty,
      qtySource,
      knowsLong,
      knowsShort,
      hasLong,
      hasShort,
    };
  }

  function getActiveCloseGuard(symbol = getCurrentSymbol()) {
    return closeGuard
      && closeGuard.symbol === symbol
      && Date.now() < closeGuard.expiresAt
      ? closeGuard
      : null;
  }

  function isCloseSnapshotReady(symbol = getCurrentSymbol()) {
    const guard = getActiveCloseGuard(symbol);
    return !guard || guard.snapshotReady;
  }

  function resolveDisplayCloseState(rawCloseContext, symbol) {
    const cache = symbol && lastConfirmedCloseState?.symbol === symbol ? lastConfirmedCloseState : null;
    const guard = getActiveCloseGuard(symbol);
    const transitionPending = Boolean(guard && !guard.snapshotReady);
    const {
      longQty,
      shortQty,
      isUsingCache,
      shouldCommit,
    } = resolveCloseDisplayQuantities({
      rawLongQty: rawCloseContext.longQty,
      rawShortQty: rawCloseContext.shortQty,
      cachedLongQty: cache?.longQty ?? null,
      cachedShortQty: cache?.shortQty ?? null,
      transitionPending,
    });
    const isPending = transitionPending
      || (!rawCloseContext.knowsLong && !rawCloseContext.knowsShort);

    const knowsLong = longQty != null;
    const knowsShort = shortQty != null;
    const hasLong = longQty > 0;
    const hasShort = shortQty > 0;

    // 第三层：提交稳定缓存——仅在 CLOSE 模式下写入，避免 OPEN 模式瞬态 0/0 污染
    if (symbol && rawCloseContext.symbol === symbol && isCurrentObservedSymbol(symbol)
      && getActiveTradeMode() === 'CLOSE'
      && shouldCommit) {
      const closeMode = hasLong && hasShort ? 'dual'
        : hasLong ? 'single_long' : hasShort ? 'single_short' : 'unknown';
      lastConfirmedCloseState = {
        symbol,
        longQty,
        shortQty,
        closeMode,
        longDisabled: !hasLong,
        shortDisabled: !hasShort,
      };
    }

    const result = {
      ...rawCloseContext,
      symbol,
      longQty,
      shortQty,
      knowsLong,
      knowsShort,
      hasLong,
      hasShort,
      isUsingCache,
      isPending,
    };
    lastDisplayCloseState = result;
    return result;
  }

  function getCachedCloseState(symbol) {
    return symbol && lastConfirmedCloseState?.symbol === symbol ? lastConfirmedCloseState : null;
  }

  function findAccountPositionTab() {
    return findAccountPositionTabDom(document, { isVisibleElement });
  }

  function readAccountPositionCount() {
    const tab = findAccountPositionTab();
    return tab ? parseAccountPositionTabCount(tab.textContent) : null;
  }

  function readCurrentLeverageFromDom() {
    const leverageButton = findCurrentLeverageButtonFromScopes(getTradeSearchScopes(), {
      panelId: PANEL_ID,
      isVisibleElement,
    });
    return parseLeverageButtonText(leverageButton?.textContent);
  }

  async function waitForBncHeaders(symbol) {
    if (cachedBncHeaders) return true;
    for (let i = 0; i < 10; i++) {
      await delay(500);
      if (cachedBncHeaders || !isCurrentObservedSymbol(symbol)) break;
    }
    return Boolean(cachedBncHeaders && isCurrentObservedSymbol(symbol));
  }

  async function fetchCurrentSymbolPositionState(symbol) {
    if (!cachedBncHeaders) throw new Error('bapi header 尚未缓存');
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 5000);
    try {
      const resp = await fetch(`${window.location.origin}${BINANCE_USER_POSITION_BAPI_PATH}`, {
        method: 'POST',
        headers: getBncHeaders(),
        body: JSON.stringify({}),
        credentials: 'include',
        signal: controller.signal,
      });
      if (!resp.ok) throw new Error(`user-position HTTP ${resp.status}`);
      const payload = await resp.json();
      return {
        ...resolveSymbolPositionStatus(payload, symbol),
        source: 'user_position_api',
      };
    } finally {
      window.clearTimeout(timer);
    }
  }

  function isStableOpenContext(symbol) {
    return getActiveTradeMode() === 'OPEN' && isCurrentObservedSymbol(symbol);
  }

  async function autoResetOpenLeverageToDefault(symbol, triggerSource) {
    await delay(AUTO_OPEN_LEVERAGE_DELAY_MS);
    if (!isStableOpenContext(symbol)) return false;

    if (!await waitForBncHeaders(symbol)) {
      log('bapi header 尚未缓存，跳过杠杆重置', symbol);
      return false;
    }
    if (!isStableOpenContext(symbol)) return false;

    // 已经是目标杠杆则短路
    const currentLeverage = readCurrentLeverageFromDom();
    if (currentLeverage === DEFAULT_OPEN_LEVERAGE) {
      log('开仓杠杆已是默认值', symbol, `${DEFAULT_OPEN_LEVERAGE}x`, triggerSource);
      return true;
    }

    if (!isStableOpenContext(symbol)) return false;
    const finalPositionState = await fetchCurrentSymbolPositionState(symbol);
    if (!isStableOpenContext(symbol)) return false;
    if (finalPositionState.status !== 'flat') {
      log('当前币种仍有持仓，跳过杠杆重置', symbol, finalPositionState.source);
      return false;
    }

    try {
      await adjustLeverageApi(symbol, DEFAULT_OPEN_LEVERAGE);
    } catch (e) {
      err('自动重置杠杆失败', symbol, `${DEFAULT_OPEN_LEVERAGE}x`, e.message || e);
      return false;
    }

    log(
      '无仓切回开仓，已自动重置杠杆',
      symbol,
      `${DEFAULT_OPEN_LEVERAGE}x`,
      triggerSource,
      finalPositionState.source
    );
    return true;
  }

  function queueAutoOpenLeverageReset(triggerSource) {
    const symbol = getCurrentSymbol();
    if (!isCurrentObservedSymbol(symbol)) return;
    if (autoOpenLeverageTask) {
      pendingAutoOpenLeverageReset = { symbol, triggerSource };
      return;
    }

    if (!isStableOpenContext(symbol)) return;

    const now = Date.now();
    if (
      lastAutoOpenLeverage.symbol === symbol
      && now - lastAutoOpenLeverage.at < AUTO_OPEN_LEVERAGE_DEDUPE_MS
    ) {
      return;
    }

    lastAutoOpenLeverage = { symbol, at: now };
    let task = null;
    task = autoResetOpenLeverageToDefault(symbol, triggerSource)
      .catch((e) => {
        err('自动重置开仓杠杆失败:', e);
        return false;
      })
      .finally(() => {
        if (autoOpenLeverageTask !== task) return;
        autoOpenLeverageTask = null;
        const pending = pendingAutoOpenLeverageReset;
        pendingAutoOpenLeverageReset = null;
        if (pending && isCurrentObservedSymbol(pending.symbol)) {
          queueAutoOpenLeverageReset(pending.triggerSource);
        }
      });
    autoOpenLeverageTask = task;
  }

  async function runAutoOpenLeveragePositionCheck(symbol, triggerSource, resetIfFlat) {
    if (!await waitForBncHeaders(symbol)) {
      log('bapi header 尚未缓存，跳过持仓检查', symbol, triggerSource);
      return false;
    }
    if (!isCurrentObservedSymbol(symbol)) return false;

    const positionState = await fetchCurrentSymbolPositionState(symbol);
    if (!isCurrentObservedSymbol(symbol)) return false;
    const observation = observeAutoOpenLeveragePositionState(
      lastObservedAccountPositionState,
      { symbol, status: positionState.status }
    );
    lastObservedAccountPositionState = observation.state;
    if (
      positionState.status === 'flat'
      && isStableOpenContext(symbol)
      && (observation.shouldReset || resetIfFlat)
    ) {
      queueAutoOpenLeverageReset(triggerSource);
    }
    return true;
  }

  function queueAutoOpenLeveragePositionCheck(triggerSource, options = {}) {
    const symbol = getCurrentSymbol();
    if (!isCurrentObservedSymbol(symbol)) return;
    const resetIfFlat = options.resetIfFlat === true;
    if (autoOpenLeveragePositionCheckTask) {
      const pending = pendingAutoOpenLeveragePositionCheck;
      pendingAutoOpenLeveragePositionCheck = {
        symbol,
        triggerSource,
        resetIfFlat: resetIfFlat || (pending?.symbol === symbol && pending.resetIfFlat),
      };
      return;
    }

    let task = null;
    task = runAutoOpenLeveragePositionCheck(symbol, triggerSource, resetIfFlat)
      .catch((e) => {
        err('自动检查当前币种持仓失败:', e);
        return false;
      })
      .finally(() => {
        if (autoOpenLeveragePositionCheckTask !== task) return;
        autoOpenLeveragePositionCheckTask = null;
        const pending = pendingAutoOpenLeveragePositionCheck;
        pendingAutoOpenLeveragePositionCheck = null;
        if (pending && isCurrentObservedSymbol(pending.symbol)) {
          queueAutoOpenLeveragePositionCheck(pending.triggerSource, {
            resetIfFlat: pending.resetIfFlat,
          });
        }
      });
    autoOpenLeveragePositionCheckTask = task;
  }

  function handleAccountPositionObservation(triggerSource) {
    const positionCount = readAccountPositionCount();
    if (positionCount == null || positionCount === lastObservedAccountPositionCount) return;
    lastObservedAccountPositionCount = positionCount;
    queueAutoOpenLeveragePositionCheck(triggerSource);
  }

  function getAccountPositionObserverRoot() {
    const positionTab = findAccountPositionTab();
    return positionTab ? getAccountOrdersTabGroup(positionTab) : null;
  }

  function stopAccountPositionObserver() {
    if (accountPositionObserver) {
      accountPositionObserver.disconnect();
      accountPositionObserver = null;
    }
    accountPositionObserverRoot = null;
    lastObservedAccountPositionCount = null;
  }

  function ensureAccountPositionObserver() {
    if (document.hidden || !isFuturesTradingPage()) return;
    const root = getAccountPositionObserverRoot();
    if (!root) {
      stopAccountPositionObserver();
      return;
    }
    if (accountPositionObserver && accountPositionObserverRoot === root && root.isConnected) return;

    stopAccountPositionObserver();
    accountPositionObserverRoot = root;
    accountPositionObserver = new MutationObserver(() => {
      handleAccountPositionObservation('account_position_mutation');
    });
    accountPositionObserver.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    handleAccountPositionObservation('account_position_ready');
  }

  function applyCachedCloseUiState() {
    if (getActiveTradeMode() !== 'CLOSE') return false;
    const cache = getCachedCloseState(getCurrentSymbol());
    if (!cache) return false;
    renderPanel();
    return true;
  }

  function resolveCloseAction() {
    const currentSymbol = getCurrentSymbol();
    if (!isCloseSnapshotReady(currentSymbol)) return null;
    const rawCloseContext = readCloseContext(currentSymbol);
    if (!isCurrentObservedSymbol(currentSymbol) || rawCloseContext.symbol !== currentSymbol) return null;
    const direction = resolveConfirmedCloseDirection(rawCloseContext, loadCloseSide());
    if (!direction) return null;
    const { longQty, shortQty, qtySource, hasLong, hasShort, closeLongBtn, closeShortBtn } = rawCloseContext;
    const dual = hasLong && hasShort;
    return direction === 'SHORT'
      ? { side: '平空', button: closeShortBtn, by: dual ? 'dual_panel' : 'single_short', longQty, shortQty, qtySource }
      : { side: '平多', button: closeLongBtn, by: dual ? 'dual_panel' : 'single_long', longQty, shortQty, qtySource };
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
    return parseFuturesTradingSymbolFromPathname(location.pathname);
  }

  function isCurrentObservedSymbol(symbol) {
    return !!symbol && getCurrentSymbol() === symbol && lastObservedSymbol === symbol;
  }

  let appDataCache = { text: '', parsed: null }; // #__APP_DATA 解析缓存（仅用于 markPrice）
  let rulesCache = {}; // symbol -> { limitMinQty, limitStepSize, marketMinQty, marketStepSize, minNotional }
  let rulesInflight = {}; // symbol -> Promise（inflight 去重）
  let rulesFailedUntil = {}; // symbol -> timestamp（失败冷却，防止高频重试）
  const RULES_RETRY_COOLDOWN_MS = 5000;

  async function ensureRules(symbol) {
    if (!symbol || rulesCache[symbol]) return rulesCache[symbol];
    if (rulesInflight[symbol]) return rulesInflight[symbol];
    if (rulesFailedUntil[symbol] > Date.now()) return null;
    const promise = (async () => {
      try {
        const resp = await fetch(`https://fapi.binance.com/fapi/v1/exchangeInfo?symbol=${symbol}`);
        if (!resp.ok) {
          rulesFailedUntil[symbol] = Date.now() + RULES_RETRY_COOLDOWN_MS;
          return null;
        }
        const data = await resp.json();
        const sInfo = data.symbols?.find((s) => s.symbol === symbol);
        if (!sInfo) {
          rulesFailedUntil[symbol] = Date.now() + RULES_RETRY_COOLDOWN_MS;
          return null;
        }
        const filters = sInfo.filters || [];
        const lot = filters.find((f) => f.filterType === 'LOT_SIZE') || {};
        const marketLot = filters.find((f) => f.filterType === 'MARKET_LOT_SIZE') || {};
        const minN = filters.find((f) => f.filterType === 'MIN_NOTIONAL') || {};
        const entry = {
          limitMinQty: lot.minQty ? String(lot.minQty) : null,
          limitStepSize: lot.stepSize ? String(lot.stepSize) : null,
          marketMinQty: marketLot.minQty ? String(marketLot.minQty) : null,
          marketStepSize: marketLot.stepSize ? String(marketLot.stepSize) : null,
          minNotional: minN.notional ? String(minN.notional) : null,
        };
        rulesCache[symbol] = entry;
        delete rulesFailedUntil[symbol];
        log('exchangeInfo:', symbol, entry);
        return entry;
      } catch (_e) {
        rulesFailedUntil[symbol] = Date.now() + RULES_RETRY_COOLDOWN_MS;
        return null;
      }
      finally { delete rulesInflight[symbol]; }
    })();
    rulesInflight[symbol] = promise;
    return promise;
  }

  function readMarkPriceFromAppData(symbol) {
    try {
      const el = document.querySelector('#__APP_DATA');
      if (!el || !el.textContent) return null;
      let data;
      if (el.textContent === appDataCache.text) {
        data = appDataCache.parsed;
      } else {
        data = JSON.parse(el.textContent);
        appDataCache = { text: el.textContent, parsed: data };
      }
      if (!data) return null;
      const reactQueryData = data?.appState?.loader?.dataByRouteId?.bd56?.reactQueryData;
      const markPrice = reactQueryData?.[`queryMarkPrice,${symbol}`]?.markPrice || null;
      const toStr = (v) => {
        if (typeof v === 'string' && v) return v;
        if (typeof v === 'number' && Number.isFinite(v)) return String(v);
        return null;
      };
      return toStr(markPrice);
    } catch (_e) {
      return null;
    }
  }

  function getReferencePrice(symbol, priceOverride) {
    const fromOverride = normalizeDecimalString(priceOverride);
    if (fromOverride) return fromOverride;

    const priceInput = findPriceInput();
    const fromInput = normalizeDecimalString(priceInput?.value || '');
    if (fromInput) return fromInput;

    // markPrice 仍从 #__APP_DATA 读（实时数据，不适合 API 一次性缓存）
    const fromAppData = readMarkPriceFromAppData(symbol);
    return normalizeDecimalString(fromAppData);
  }

  function getQtyRuleContext(symbol, tradeMode, priceOverride) {
    const rules = symbol ? rulesCache[symbol] : null;
    if (!rules) return { status: 'pending' };

    const orderType = getCurrentOrderType();
    const isMarketOrder = orderType.includes('MARKET');
    const baseMinQty = normalizeDecimalString(
      (isMarketOrder ? rules.marketMinQty : rules.limitMinQty) || rules.limitMinQty
    );
    const stepSize = normalizeDecimalString(
      (isMarketOrder ? rules.marketStepSize : rules.limitStepSize) || rules.limitStepSize
    );
    if (!baseMinQty || !stepSize) return { status: 'pending' };

    const referencePrice = getReferencePrice(symbol, priceOverride);
    const minNotionalQty =
      tradeMode === 'OPEN' && rules.minNotional && referencePrice && stepSize
        ? ceilQtyByNotional(rules.minNotional, referencePrice, stepSize)
        : null;
    const effectiveMinQty = maxDecimalString(baseMinQty, minNotionalQty);

    return {
      status: 'ready',
      orderType,
      baseMinQty,
      stepSize,
      minNotional: normalizeDecimalString(rules.minNotional),
      referencePrice,
      minNotionalQty,
      effectiveMinQty,
    };
  }

  function multiplierKey(mode, symbol, precision) {
    return modeSymbolPrecisionOptionStorageKey(
      MULTIPLIER_STORAGE_KEYS,
      mode,
      symbol || getCurrentSymbol(),
      precision,
    );
  }

  function loadMultiplier(mode, symbol, precision = readCurrentOrderbookPrecisionValue()) {
    const key = multiplierKey(mode || getActiveTradeMode(), symbol, precision);
    if (!key) return null;
    const value = localStorage.getItem(key);
    return isValidMultiplier(value) ? String(value) : DEFAULT_MULTIPLIER;
  }

  function saveMultiplier(value, mode, symbol, precision) {
    const key = multiplierKey(mode || getActiveTradeMode(), symbol, precision);
    if (!key) return false;
    localStorage.setItem(key, value);
    return true;
  }

  function sanitizeMultiplier(value) {
    return isValidMultiplier(value) ? String(value).trim() : DEFAULT_MULTIPLIER;
  }

  function getPanelOptionContext() {
    const context = {
      symbol: getCurrentSymbol(),
      mode: getActiveTradeMode(),
      precision: readCurrentOrderbookPrecisionValue(),
    };
    return context.symbol && context.precision && ['OPEN', 'CLOSE'].includes(context.mode)
      ? context
      : null;
  }

  function beginMultiplierEdit() {
    multiplierEditContext = getPanelOptionContext();
    if (!multiplierEditContext) return false;
    isEditingMultiplier = true;
    return true;
  }

  function isMultiplierEditContextCurrent(context = multiplierEditContext) {
    return !!context
      && isCurrentObservedSymbol(context.symbol)
      && getActiveTradeMode() === context.mode
      && context.precision === readCurrentOrderbookPrecisionValue();
  }

  function stopMultiplierEdit() {
    multiplierEditContext = null;
    isEditingMultiplier = false;
  }

  function updateMultiplier(nextValue, context) {
    if (!context) return false;
    if (
      !isCurrentObservedSymbol(context.symbol) ||
      getActiveTradeMode() !== context.mode ||
      context.precision !== readCurrentOrderbookPrecisionValue()
    ) return false;
    const input = document.getElementById(INPUT_ID);
    const normalized = sanitizeMultiplier(nextValue);
    stopMultiplierEdit();
    saveMultiplier(normalized, context.mode, context.symbol, context.precision);
    if (input) input.value = normalized;
    renderPanel();
    return true;
  }

  function setNativeActionButtonDisabled(button, disabled) {
    if (!button) return;
    // 状态没变则不操作 DOM，避免产生多余的 mutation 触发 observer 死循环
    const alreadyDisabled = button.getAttribute(NATIVE_ACTION_DISABLED_ATTR) === 'true';
    if (disabled === alreadyDisabled) {
      if (disabled) controlledNativeButtons.add(button);
      else controlledNativeButtons.delete(button);
      return;
    }

    if (disabled) {
      button.setAttribute(NATIVE_ACTION_DISABLED_ATTR, 'true');
      button.disabled = true;
      button.setAttribute('aria-disabled', 'true');
      controlledNativeButtons.add(button);
      return;
    }

    button.removeAttribute(NATIVE_ACTION_DISABLED_ATTR);
    button.disabled = false;
    button.setAttribute('aria-disabled', 'false');
    controlledNativeButtons.delete(button);
  }

  function syncNativeCloseButtons(tradeMode, closeContext) {
    const { closeLongBtn, closeShortBtn, knowsLong, knowsShort, hasLong, hasShort } = closeContext;
    const desiredStates = new Map();
    if (tradeMode === 'CLOSE') {
      if (knowsLong) desiredStates.set(closeLongBtn, !hasLong);
      if (knowsShort) desiredStates.set(closeShortBtn, !hasShort);
    }

    for (const button of Array.from(controlledNativeButtons)) {
      if (!button.isConnected) {
        controlledNativeButtons.delete(button);
        continue;
      }
      if (desiredStates.get(button) !== true) {
        setNativeActionButtonDisabled(button, false);
      }
    }

    for (const [button, shouldDisable] of desiredStates.entries()) {
      if (!button) continue;
      const isDisabledByUs = button.getAttribute(NATIVE_ACTION_DISABLED_ATTR) === 'true';
      if (shouldDisable === isDisabledByUs) continue;
      setNativeActionButtonDisabled(button, shouldDisable);
    }
  }

  function ladderOptionButton(label, value, selected, group) {
    const activeStyle = selected
      ? `border-color:var(--color-PrimaryYellow);background:var(--color-BadgeBg);color:${PRIMARY_EMPHASIS_COLOR};font-weight:${PRIMARY_EMPHASIS_FONT_WEIGHT};`
      : NEUTRAL_CONTROL_STYLE;
    return `<button type="button" data-ladder-group="${group}" data-ladder-value="${value}" style="box-sizing:border-box;width:100%;min-width:0;height:28px;padding:0;border-radius:6px;border:1px solid ${CONTROL_BORDER_COLOR};font-size:13px;line-height:26px;cursor:pointer;${activeStyle}">${label}</button>`;
  }

  function ladderOptionRow(title, options, selected, group, suffix = '') {
    return [
      '<div style="display:grid;grid-template-columns:28px repeat(5,minmax(0,1fr));align-items:center;gap:4px;height:34px;margin-top:6px;overflow:hidden;">',
      `<span style="color:${MUTED_TEXT_COLOR};font-size:13px;">${title}</span>`,
      ...options.map((value) => ladderOptionButton(`${value}${suffix}`, value, Number(value) === Number(selected), group)),
      '</div>',
    ].join('');
  }

  function ladderActionButton(actionType, label, tone, disabled = false) {
    const isBuyTone = tone === 'BUY';
    const borderColor = isBuyTone ? 'var(--color-Buy)' : 'var(--color-Sell)';
    const background = isBuyTone ? 'var(--color-GreenAlpha01)' : 'var(--color-RedAlpha01)';
    const disabledAttrs = disabled ? ' disabled aria-disabled="true"' : '';
    return `<button type="button" data-ladder-action="${actionType}"${disabledAttrs} style="height:${LADDER_CONTROL_BUTTON_HEIGHT}px;border:1px solid ${borderColor};border-radius:6px;background:${background};color:${borderColor};font-size:${LADDER_CONTROL_BUTTON_FONT_SIZE}px;font-weight:${CONTROL_FONT_WEIGHT};line-height:${LADDER_CONTROL_BUTTON_HEIGHT - 2}px;cursor:pointer;opacity:1;">${label}</button>`;
  }

  function getLadderActionRows(tradeMode, closeContext, symbol, precision) {
    const ladderRunning = !!ladderTask;
    const actionDisabled = ladderRunning || !!cancelCurrentSymbolOpenOrdersTask;
    if (!['OPEN', 'CLOSE'].includes(tradeMode)) {
      return [`<div style="margin-top:6px;color:${MUTED_TEXT_COLOR};font-size:12px;">等待开仓/平仓状态</div>`];
    }
    if (!precision) {
      return [`<div style="margin-top:6px;color:${MUTED_TEXT_COLOR};font-size:12px;">等待订单簿缩放值</div>`];
    }
    if (tradeMode === 'OPEN') {
      return [
        ladderOptionRow('量', LADDER_OPEN_PERCENTS, getLadderOpenPercent(symbol, precision), 'percent', '%'),
        ladderOptionRow('档', LADDER_LEVEL_OPTIONS, getLadderLevels(tradeMode, symbol, precision), 'levels', ''),
        ladderOptionRow('幅', LADDER_STEP_OPTIONS, getLadderStep(tradeMode, symbol, precision), 'step', ''),
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:12px;">',
        ladderActionButton('OPEN_LONG', '阶梯开多', 'BUY', actionDisabled),
        ladderActionButton('OPEN_SHORT', '阶梯开空', 'SELL', actionDisabled),
        '</div>',
      ];
    }

    const closePending = closeContext?.isPending === true;
    const closeLongDisabled = actionDisabled || closePending
      || (closeContext?.knowsLong ? !closeContext.hasLong : false);
    const closeShortDisabled = actionDisabled || closePending
      || (closeContext?.knowsShort ? !closeContext.hasShort : false);
    return [
      ladderOptionRow('量', LADDER_CLOSE_PERCENTS, getLadderClosePercent(symbol, precision), 'percent', '%'),
      ladderOptionRow('档', LADDER_LEVEL_OPTIONS, getLadderLevels(tradeMode, symbol, precision), 'levels', ''),
      ladderOptionRow('幅', LADDER_STEP_OPTIONS, getLadderStep(tradeMode, symbol, precision), 'step', ''),
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:12px;">',
      ladderActionButton('CLOSE_LONG', '阶梯平多', 'SELL', closeLongDisabled),
      ladderActionButton('CLOSE_SHORT', '阶梯平空', 'BUY', closeShortDisabled),
      '</div>',
    ];
  }

  function refreshLadderPanel(panel, tradeMode, closeContext) {
    const toggle = panel.querySelector(`#${LADDER_TOGGLE_ID}`);
    const body = panel.querySelector(`#${LADDER_BODY_ID}`);
    const status = panel.querySelector(`#${LADDER_STATUS_ID}`);
    const expanded = isLadderExpanded();
    const mode = ['OPEN', 'CLOSE'].includes(tradeMode) ? tradeMode : null;
    const symbol = getCurrentSymbol();
    const precision = readCurrentOrderbookPrecisionValue();
    if (toggle) {
      toggle.textContent = `Maker 阶梯 ${expanded ? '▾' : '▸'}`;
    }
    if (body) {
      body.style.display = expanded ? 'block' : 'none';
      if (expanded) {
        const stopDisabled = !ladderTask;
        const stopDisabledAttrs = stopDisabled ? ' disabled aria-disabled="true"' : '';
        const cancelRunning = !!cancelCurrentSymbolOpenOrdersTask;
        const cancelDisabled = !!ladderTask || cancelRunning;
        const cancelDisabledAttrs = cancelDisabled ? ' disabled aria-disabled="true"' : '';
        const bodyHtml = [
          ...getLadderActionRows(mode, closeContext, symbol, precision),
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:4px;">',
          `<button type="button" data-ladder-stop="true"${stopDisabledAttrs} style="height:${LADDER_CONTROL_BUTTON_HEIGHT}px;border:1px solid ${CONTROL_BORDER_COLOR};border-radius:6px;font-size:${LADDER_CONTROL_BUTTON_FONT_SIZE}px;line-height:${LADDER_CONTROL_BUTTON_HEIGHT - 2}px;${NEUTRAL_CONTROL_STYLE}">停止阶梯挂单</button>`,
          `<button type="button" data-ladder-cancel-symbol="true"${cancelDisabledAttrs} style="height:${LADDER_CONTROL_BUTTON_HEIGHT}px;border:1px solid ${CONTROL_BORDER_COLOR};border-radius:6px;font-size:${LADDER_CONTROL_BUTTON_FONT_SIZE}px;line-height:${LADDER_CONTROL_BUTTON_HEIGHT - 2}px;${NEUTRAL_CONTROL_STYLE}">${cancelRunning ? '撤单处理中' : '撤本币挂单'}</button>`,
          '</div>',
        ].join('');
        if (ladderPanelBodySignature !== bodyHtml || body.innerHTML !== bodyHtml) {
          body.innerHTML = bodyHtml;
          ladderPanelBodySignature = bodyHtml;
        }
      }
    }
    if (status) {
      status.textContent = ladderStatusText;
      status.style.visibility = expanded || ladderTask || ladderStatusText !== '空闲' ? 'visible' : 'hidden';
    }
  }

  function refreshComputedInfo(panel, multiplier, qtyRuleContext) {
    const input = panel.querySelector(`#${INPUT_ID}`);
    const minEl = panel.querySelector('#jh-binance-close-qty-min');
    const finalEl = panel.querySelector('#jh-binance-close-qty-final');
    const formulaPrefixEl = panel.querySelector('[data-multiplier-formula-prefix]');
    const constraintDividerEl = panel.querySelector('[data-multiplier-constraint-divider]');
    const calculationEl = panel.querySelector('[data-multiplier-calculation]');
    const hintEl = panel.querySelector(`#${MODE_HINT_ID}`);
    const multiplierHintEl = panel.querySelector(`#${MULTIPLIER_HINT_ID}`);
    const decBtn = panel.querySelector(`#${DEC_ID}`);
    const incBtn = panel.querySelector(`#${INC_ID}`);
    const sideLongBtn = panel.querySelector(`#${SIDE_LONG_ID}`);
    const sideShortBtn = panel.querySelector(`#${SIDE_SHORT_ID}`);
    const tradeMode = getActiveTradeMode();
    const modeReady = ['OPEN', 'CLOSE'].includes(tradeMode);
    const precisionReady = Boolean(readCurrentOrderbookPrecisionValue());
    const numericContextReady = modeReady && precisionReady;
    const rulesPending = qtyRuleContext?.status !== 'ready';
    const effectiveMinQty = rulesPending ? null : (qtyRuleContext?.effectiveMinQty || null);
    const finalQty = effectiveMinQty ? multiplyDecimalByInt(effectiveMinQty, multiplier) : null;
    const closeSide = loadCloseSide();
    const openSide = loadOpenSide();
    const rawCloseContext = readCloseContext();
    const closeContext = resolveDisplayCloseState(rawCloseContext, getCurrentSymbol());
    const { knowsLong, knowsShort, hasLong, hasShort, isUsingCache } = closeContext;
    const rawCloseReady = !closeContext.isPending
      && rawCloseContext.knowsLong
      && rawCloseContext.knowsShort;
    const closeMode = hasLong && hasShort ? 'dual' : hasLong ? 'single_long' : hasShort ? 'single_short' : 'unknown';

    let formulaPrefixText = '';
    let finalText = '';
    let constraintText = '';
    if (!precisionReady) {
      finalText = '等待订单簿缩放值';
    } else if (!modeReady) {
      finalText = '等待开仓/平仓状态';
    } else if (rulesPending || !effectiveMinQty) {
      finalText = '最小量读取中';
    } else if (isValidMultiplier(multiplier) && finalQty) {
      formulaPrefixText = `${effectiveMinQty} × ${multiplier} =`;
      finalText = finalQty;
      if (tradeMode === 'OPEN' && qtyRuleContext?.minNotionalQty && qtyRuleContext?.referencePrice) {
        constraintText = `≥${qtyRuleContext.minNotional}U @ ${qtyRuleContext.referencePrice}`;
      }
    } else {
      finalText = '请输入正整数倍数';
    }
    if (formulaPrefixEl) {
      formulaPrefixEl.textContent = formulaPrefixText;
      formulaPrefixEl.style.display = formulaPrefixText ? 'inline' : 'none';
    }
    if (finalEl) {
      finalEl.textContent = finalText;
      finalEl.style.color = formulaPrefixText ? PRIMARY_EMPHASIS_COLOR : MUTED_TEXT_COLOR;
    }
    if (constraintDividerEl) {
      constraintDividerEl.style.display = constraintText ? 'block' : 'none';
    }
    if (minEl) {
      minEl.textContent = constraintText;
      minEl.style.display = constraintText ? 'block' : 'none';
    }
    if (calculationEl) {
      calculationEl.title = [formulaPrefixText, finalText, constraintText].filter(Boolean).join(' ');
    }
    if (multiplierHintEl) {
      if (tradeMode === 'OPEN') {
        multiplierHintEl.textContent = '最小开仓量的';
      } else if (tradeMode === 'CLOSE') {
        multiplierHintEl.textContent = '最小平仓量的';
      } else {
        multiplierHintEl.textContent = '最小下单量的';
      }
    }
    if (hintEl) {
      if (tradeMode === 'OPEN') {
        const action = openSide === 'LONG' ? '开多' : '开空';
        hintEl.textContent = '单击订单簿时';
        hintEl.title = `开仓模式：单击订单簿价格后将${CFG.SAFE_MODE ? '填数量' : action}`;
      } else if (!rawCloseReady) {
        hintEl.textContent = '仓位确认中';
        hintEl.title = isUsingCache
          ? '平仓模式：正在确认可平仓位，暂沿用上次识别结果'
          : '平仓模式：正在确认可平仓位';
      } else if (closeMode === 'single_long') {
        hintEl.textContent = '单击订单簿时';
        hintEl.title = `平仓模式：当前仅有多仓，单击订单簿价格后将${CFG.SAFE_MODE ? '填数量' : '平多'}`;
      } else if (closeMode === 'single_short') {
        hintEl.textContent = '单击订单簿时';
        hintEl.title = `平仓模式：当前仅有空仓，单击订单簿价格后将${CFG.SAFE_MODE ? '填数量' : '平空'}`;
      } else if (closeMode === 'dual') {
        const action = closeSide === 'LONG' ? '平多' : '平空';
        hintEl.textContent = '单击订单簿时';
        hintEl.title = `平仓模式：双向持仓时单击订单簿价格后将${CFG.SAFE_MODE ? '填数量' : action}`;
      } else {
        hintEl.textContent = '暂无可平仓位';
        hintEl.title = '平仓模式：当前币种暂无可平仓位';
      }
    }
    if (decBtn) {
      decBtn.disabled = !numericContextReady || Number(multiplier) <= 1;
    }
    if (incBtn) {
      incBtn.disabled = !numericContextReady;
    }
    if (input) {
      input.disabled = !numericContextReady;
      input.style.opacity = input.disabled ? '0.65' : '1';
      input.style.cursor = input.disabled ? 'not-allowed' : 'text';
    }
    if (sideLongBtn) {
      const isOpenMode = tradeMode === 'OPEN';
      const isDisabled = isOpenMode ? false : closeContext.isPending || (knowsLong ? !hasLong : false);
      const isActive = isOpenMode
        ? openSide === 'LONG'
        : closeMode === 'single_long' || (closeMode !== 'single_short' && closeSide === 'LONG');
      sideLongBtn.textContent = isOpenMode ? '开多' : '平多';
      sideLongBtn.style.order = '0';
      sideLongBtn.disabled = isDisabled;
      sideLongBtn.setAttribute('aria-checked', String(isActive));
      sideLongBtn.tabIndex = isActive ? 0 : -1;
      sideLongBtn.style.boxShadow = isActive && !isDisabled
        ? `inset 0 0 0 1px ${isOpenMode ? 'var(--color-Buy)' : 'var(--color-Sell)'}`
        : 'none';
      sideLongBtn.style.background = isActive
        ? isOpenMode ? 'var(--color-GreenAlpha01)' : 'var(--color-RedAlpha01)'
        : CONTROL_BACKGROUND_COLOR;
      sideLongBtn.style.color = isActive
        ? isOpenMode ? 'var(--color-Buy)' : 'var(--color-Sell)'
        : CONTROL_TEXT_COLOR;
    }
    if (sideShortBtn) {
      const isOpenMode = tradeMode === 'OPEN';
      const isDisabled = isOpenMode ? false : closeContext.isPending || (knowsShort ? !hasShort : false);
      const isActive = isOpenMode
        ? openSide === 'SHORT'
        : closeMode === 'single_short' || (closeMode !== 'single_long' && closeSide === 'SHORT');
      sideShortBtn.textContent = isOpenMode ? '开空' : '平空';
      sideShortBtn.style.order = '1';
      sideShortBtn.disabled = isDisabled;
      sideShortBtn.setAttribute('aria-checked', String(isActive));
      sideShortBtn.tabIndex = isActive ? 0 : -1;
      sideShortBtn.style.boxShadow = isActive && !isDisabled
        ? `inset 0 0 0 1px ${isOpenMode ? 'var(--color-Sell)' : 'var(--color-Buy)'}`
        : 'none';
      sideShortBtn.style.background = isActive
        ? isOpenMode ? 'var(--color-RedAlpha01)' : 'var(--color-GreenAlpha01)'
        : CONTROL_BACKGROUND_COLOR;
      sideShortBtn.style.color = isActive
        ? isOpenMode ? 'var(--color-Sell)' : 'var(--color-Buy)'
        : CONTROL_TEXT_COLOR;
    }

    syncNativeCloseButtons(tradeMode, rawCloseContext);
    refreshOrderbookPrecisionRecommendation(panel);
    refreshLadderPanel(panel, tradeMode, closeContext);
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

  function ensureSpacer(insertionPoint, panelHeight) {
    let spacer = document.getElementById(SPACER_ID);
    if (!insertionPoint) {
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

    return placeTradePanelSpacer(spacer, insertionPoint) ? spacer : null;
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
    const insertionPoint = findTradePanelInsertionPoint(document);
    const spacer = ensureSpacer(
      insertionPoint,
      Math.max((panel.offsetHeight || 0) + PANEL_BOTTOM_TOOLTIP_GAP, 76)
    );
    const anchorRect = spacer?.getBoundingClientRect() || null;
    placePanelFloating(panel, anchorRect);
    return Boolean(anchorRect?.width && anchorRect?.height);
  }

  function isPanelPositionCurrent() {
    const spacer = document.getElementById(SPACER_ID);
    const insertionPoint = findTradePanelInsertionPoint(document);
    return Boolean(
      spacer
      && insertionPoint
      && spacer.parentElement === insertionPoint.parent
      && spacer.nextElementSibling === insertionPoint.before
    );
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
    panel.style.fontSize = '13px';
    panel.style.lineHeight = '18px';
    panel.style.fontFamily = 'BinancePlex, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
    panel.style.boxShadow = 'none';
    panel.style.visibility = 'hidden';
    panel.innerHTML = [
      '<div data-panel-group="direction" style="display:flex;align-items:center;justify-content:flex-start;gap:6px;height:32px;overflow:hidden;">',
      `<span id="${MODE_HINT_ID}" style="min-width:0;color:${MUTED_TEXT_COLOR};font-size:13px;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></span>`,
      `<div data-side-selector role="radiogroup" aria-labelledby="${MODE_HINT_ID}" style="box-sizing:border-box;display:grid;grid-template-columns:54px 54px;height:32px;border:1px solid var(--color-InputLine);border-radius:6px;overflow:hidden;background:${CONTROL_BACKGROUND_COLOR};">`,
      `<button id="${SIDE_LONG_ID}" type="button" role="radio" aria-checked="false" style="width:54px;height:30px;padding:0;border:0;border-radius:5px 0 0 5px;background:${CONTROL_BACKGROUND_COLOR};color:${CONTROL_TEXT_COLOR};font-size:14px;font-weight:${CONTROL_FONT_WEIGHT};line-height:30px;cursor:pointer;">平多</button>`,
      `<button id="${SIDE_SHORT_ID}" type="button" role="radio" aria-checked="false" style="width:54px;height:30px;padding:0;border:0;border-left:1px solid var(--color-InputLine);border-radius:0 5px 5px 0;background:${CONTROL_BACKGROUND_COLOR};color:${CONTROL_TEXT_COLOR};font-size:14px;font-weight:${CONTROL_FONT_WEIGHT};line-height:30px;cursor:pointer;">平空</button>`,
      '</div>',
      '</div>',
      '<div data-panel-group="multiplier" style="margin-top:12px;">',
      '<div data-multiplier-controls style="display:flex;align-items:center;justify-content:flex-start;gap:6px;height:32px;overflow:hidden;">',
      `<label id="${MULTIPLIER_HINT_ID}" for="${INPUT_ID}" style="color:${MUTED_TEXT_COLOR};font-size:13px;line-height:18px;white-space:nowrap;">最小下单量的</label>`,
      `<input id="${INPUT_ID}" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" style="width:60px;height:32px;padding:0 8px;border-radius:8px;border:1px solid ${INPUT_BORDER_COLOR};background:${INPUT_DEFAULT_BG};color:${PRIMARY_EMPHASIS_COLOR};caret-color:${INPUT_FOCUS_COLOR};outline:none;font-size:15px;font-weight:${PRIMARY_EMPHASIS_FONT_WEIGHT};line-height:32px;transition:border-color .16s ease,background-color .16s ease,box-shadow .16s ease;">`,
      `<span style="font-size:13px;font-weight:${CONTROL_FONT_WEIGHT};color:${CONTROL_TEXT_COLOR};">倍</span>`,
      `<button id="${DEC_ID}" type="button" aria-label="减少倍数" style="width:32px;height:32px;padding:0;border-radius:6px;border:1px solid ${CONTROL_BORDER_COLOR};font-size:18px;line-height:30px;${NEUTRAL_CONTROL_STYLE}">-</button>`,
      `<button id="${INC_ID}" type="button" aria-label="增加倍数" style="width:32px;height:32px;padding:0;border-radius:6px;border:1px solid ${CONTROL_BORDER_COLOR};font-size:18px;line-height:30px;${NEUTRAL_CONTROL_STYLE}">+</button>`,
      '</div>',
      '<div data-multiplier-calculation style="display:flex;align-items:center;gap:7px;height:18px;margin-top:4px;overflow:hidden;white-space:nowrap;">',
      `<span data-multiplier-formula-prefix style="flex:0 1 auto;min-width:0;color:${MUTED_TEXT_COLOR};overflow:hidden;text-overflow:ellipsis;"></span>`,
      `<span id="jh-binance-close-qty-final" style="flex:0 0 auto;font-weight:${PRIMARY_EMPHASIS_FONT_WEIGHT};color:${PRIMARY_EMPHASIS_COLOR};"></span>`,
      `<span data-multiplier-constraint-divider aria-hidden="true" style="display:none;flex:0 0 1px;width:1px;height:12px;background:${CONTROL_BORDER_COLOR};"></span>`,
      `<span id="jh-binance-close-qty-min" style="display:none;flex:1 1 auto;min-width:0;color:${MUTED_TEXT_COLOR};overflow:hidden;text-overflow:ellipsis;"></span>`,
      '</div>',
      '</div>',
      `<div id="${ORDERBOOK_PRECISION_RECOMMENDATION_ID}" data-panel-group="precision"></div>`,
      '<div data-panel-group="ladder" style="margin-top:12px;padding-top:12px;border-top:1px solid #eef0f2;">',
      `<button id="${LADDER_TOGGLE_ID}" type="button" style="width:100%;height:28px;padding:0 8px;border-radius:6px;border:1px solid ${CONTROL_BORDER_COLOR};background:${CONTROL_BACKGROUND_COLOR};color:${PRIMARY_EMPHASIS_COLOR};text-align:left;font-size:13px;font-weight:${PRIMARY_EMPHASIS_FONT_WEIGHT};cursor:pointer;">Maker 阶梯 ▸</button>`,
      `<div id="${LADDER_BODY_ID}" style="display:none;"></div>`,
      `<div id="${LADDER_STATUS_ID}" title="空闲" style="height:18px;margin-top:6px;visibility:hidden;color:${MUTED_TEXT_COLOR};font-size:13px;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">空闲</div>`,
      '</div>',
    ].join('');
    panelPositionSignature = '';
    document.body.appendChild(panel);

    const input = panel.querySelector(`#${INPUT_ID}`);
    const decBtn = panel.querySelector(`#${DEC_ID}`);
    const incBtn = panel.querySelector(`#${INC_ID}`);
    const sideLongBtn = panel.querySelector(`#${SIDE_LONG_ID}`);
    const sideShortBtn = panel.querySelector(`#${SIDE_SHORT_ID}`);
    const ladderToggle = panel.querySelector(`#${LADDER_TOGGLE_ID}`);
    if (input) {
      const initialContext = getPanelOptionContext();
      input.value = initialContext
        ? loadMultiplier(initialContext.mode, initialContext.symbol, initialContext.precision) || ''
        : '';
      input.addEventListener('focus', () => {
        beginMultiplierEdit();
        applyInputVisualState(input, input.value);
        input.select();
      });
      input.addEventListener('input', () => {
        if (!isMultiplierEditContextCurrent()) {
          stopMultiplierEdit();
          renderPanel();
          return;
        }
        const value = String(input.value || '').replace(/[^\d]/g, '');
        if (input.value !== value) input.value = value;
        if (isValidMultiplier(value)) {
          saveMultiplier(
            value,
            multiplierEditContext.mode,
            multiplierEditContext.symbol,
            multiplierEditContext.precision,
          );
        }
        const symbol = multiplierEditContext.symbol || '-';
        const qtyRuleContext = getQtyRuleContext(symbol !== '-' ? symbol : null, multiplierEditContext.mode);
        refreshComputedInfo(panel, value, qtyRuleContext);
        applyInputVisualState(input, value);
      });
      input.addEventListener('blur', () => {
        const editContext = multiplierEditContext;
        if (!isMultiplierEditContextCurrent(editContext)) {
          stopMultiplierEdit();
          renderPanel();
          return;
        }
        const value = String(input.value || '').trim();
        const normalized = sanitizeMultiplier(value);
        stopMultiplierEdit();
        saveMultiplier(normalized, editContext.mode, editContext.symbol, editContext.precision);
        input.value = normalized;
        applyInputVisualState(input, normalized);
        renderPanel();
      });
      applyInputVisualState(input, input.value);
    }
    if (decBtn) {
      decBtn.addEventListener('click', () => {
        const context = getPanelOptionContext();
        if (!context || !isCurrentObservedSymbol(context.symbol)) return;
        const current = Number(loadMultiplier(context.mode, context.symbol, context.precision));
        updateMultiplier(String(Math.max(1, current - 1)), context);
      });
    }
    if (incBtn) {
      incBtn.addEventListener('click', () => {
        const context = getPanelOptionContext();
        if (!context || !isCurrentObservedSymbol(context.symbol)) return;
        const current = Number(loadMultiplier(context.mode, context.symbol, context.precision));
        updateMultiplier(String(current + 1), context);
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
    const handleSideSelectorKeydown = (event) => {
      const direction = ['ArrowRight', 'ArrowDown'].includes(event.key)
        ? 1
        : ['ArrowLeft', 'ArrowUp'].includes(event.key)
          ? -1
          : 0;
      if (!direction) return;
      const enabledButtons = [sideLongBtn, sideShortBtn].filter((button) => button && !button.disabled);
      if (enabledButtons.length < 2) return;
      const currentIndex = enabledButtons.indexOf(event.currentTarget);
      if (currentIndex < 0) return;
      event.preventDefault();
      const nextButton = enabledButtons[(currentIndex + direction + enabledButtons.length) % enabledButtons.length];
      nextButton.focus();
      nextButton.click();
    };
    sideLongBtn?.addEventListener('keydown', handleSideSelectorKeydown);
    sideShortBtn?.addEventListener('keydown', handleSideSelectorKeydown);
    if (ladderToggle) {
      ladderToggle.addEventListener('click', () => {
        setLadderExpanded(!isLadderExpanded());
      });
    }
    panel.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const optionBtn = target.closest('[data-ladder-group][data-ladder-value]');
      if (optionBtn) {
        const optionContext = getPanelOptionContext();
        if (!optionContext) return;
        const group = optionBtn.getAttribute('data-ladder-group');
        const value = Number(optionBtn.getAttribute('data-ladder-value'));
        if (group === 'percent' && optionContext.mode === 'OPEN') {
          setLadderOpenPercent(value, optionContext.symbol, optionContext.precision);
        }
        if (group === 'percent' && optionContext.mode === 'CLOSE') {
          setLadderClosePercent(value, optionContext.symbol, optionContext.precision);
        }
        if (group === 'levels') {
          setLadderLevels(value, optionContext.mode, optionContext.symbol, optionContext.precision);
        }
        if (group === 'step') {
          setLadderStep(value, optionContext.mode, optionContext.symbol, optionContext.precision);
        }
        return;
      }
      const precisionShortcutBtn = target.closest('[data-orderbook-precision-value]');
      if (precisionShortcutBtn) {
        if (precisionShortcutBtn.disabled || precisionShortcutBtn.getAttribute('aria-disabled') === 'true') return;
        selectOrderbookPrecision(precisionShortcutBtn.getAttribute('data-orderbook-precision-value'));
        return;
      }
      const precisionRefreshBtn = target.closest('[data-orderbook-precision-refresh]');
      if (precisionRefreshBtn) {
        if (precisionRefreshBtn.disabled || precisionRefreshBtn.getAttribute('aria-disabled') === 'true') return;
        refreshOrderbookPrecisionSamplesNow();
        return;
      }
      const actionBtn = target.closest('[data-ladder-action]');
      if (actionBtn) {
        if (actionBtn.disabled || actionBtn.getAttribute('aria-disabled') === 'true') return;
        startLadder(actionBtn.getAttribute('data-ladder-action'));
        return;
      }
      const stopBtn = target.closest('[data-ladder-stop]');
      if (stopBtn) {
        if (stopBtn.disabled || stopBtn.getAttribute('aria-disabled') === 'true') return;
        stopLadder();
        return;
      }
      const cancelSymbolBtn = target.closest('[data-ladder-cancel-symbol]');
      if (cancelSymbolBtn) {
        if (cancelSymbolBtn.disabled || cancelSymbolBtn.getAttribute('aria-disabled') === 'true') return;
        cancelCurrentSymbolOpenOrders();
      }
    });

    return panel;
  }

  function removePanel() {
    document.getElementById(PANEL_ID)?.remove();
    document.getElementById(SPACER_ID)?.remove();
    ladderPanelBodySignature = '';
    panelPositionSignature = '';
  }

  function pauseForNonTradingPage() {
    removePanel();
    stopTradingTimers();
    invalidateTradeButtonCache();
    lastDisplayCloseState = null;
    stopOrderbookPrecisionSampler();
  }

  function renderPanel() {
    if (!isFuturesTradingPage()) {
      pauseForNonTradingPage();
      return;
    }
    ensureTradeModeTabObserver();
    ensureAccountPositionObserver();
    ensureOrderbookPrecisionObserver();
    const panel = ensurePanel();
    const input = panel.querySelector(`#${INPUT_ID}`);
    const symbol = getCurrentSymbol() || '-';
    if (symbol !== '-' && !rulesCache[symbol]) {
      ensureRules(symbol).then((rules) => { if (rules) scheduleRenderPanel(); });
    }
    const optionContext = getPanelOptionContext();
    const storedMultiplier = optionContext
      ? loadMultiplier(optionContext.mode, optionContext.symbol, optionContext.precision)
      : null;
    if (input && !isEditingMultiplier && input.value !== storedMultiplier) {
      input.value = storedMultiplier || '';
    }
    const multiplier = input
      ? String((isEditingMultiplier ? input.value : storedMultiplier) || '').trim()
      : storedMultiplier || '';
    const qtyRuleContext = getQtyRuleContext(symbol !== '-' ? symbol : null, getActiveTradeMode());
    refreshComputedInfo(panel, multiplier, qtyRuleContext);
    if (input) {
      applyInputVisualState(input, multiplier);
    }
    const panelHtml = panel.innerHTML;
    if (panelPositionSignature !== panelHtml || !isPanelPositionCurrent()) {
      if (positionPanel(panel)) panelPositionSignature = panelHtml;
    }
  }

  function scheduleRenderPanel(options = {}) {
    const followUpMs = Number(options.followUpMs) > 0 ? Number(options.followUpMs) : 0;
    if (!renderPanelQueued) {
      renderPanelQueued = true;
      window.requestAnimationFrame(() => {
        renderPanelQueued = false;
        renderPanel();
      });
    }
    if (followUpMs > 0) {
      window.clearTimeout(renderPanelFollowUpTimer);
      renderPanelFollowUpTimer = window.setTimeout(() => {
        renderPanel();
      }, followUpMs);
    }
  }

  function clearTradeUiMutationWait() {
    if (tradeUiMutationObserver) {
      tradeUiMutationObserver.disconnect();
      tradeUiMutationObserver = null;
    }
    if (tradeUiMutationTimeout) {
      window.clearTimeout(tradeUiMutationTimeout);
      tradeUiMutationTimeout = 0;
    }
    if (tradeUiMutationDebounceTimer) {
      window.clearTimeout(tradeUiMutationDebounceTimer);
      tradeUiMutationDebounceTimer = 0;
    }
  }

  function waitForTradeUiMutation(options = {}) {
    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 500;
    clearTradeUiMutationWait();
    if (!document.body) {
      scheduleRenderPanel({ followUpMs: timeoutMs });
      return;
    }

    tradeUiMutationObserver = new MutationObserver((mutations) => {
      const closeQuantityChanged = mutations.some(mutationTouchesCloseQuantity);
      let matched = false;
      for (const mutation of mutations) {
        if (mutationTouchesTradeUi(mutation)) { matched = true; break; }
      }
      if (!matched) return;
      invalidateTradeButtonCache();
      if (
        closeQuantityChanged
        && closeGuard
        && closeGuard.symbol === getCurrentSymbol()
        && getActiveTradeMode() === 'CLOSE'
        && findCloseLongButton()
        && findCloseShortButton()
      ) {
        closeGuard.snapshotReady = true;
      }
      panelPositionSignature = '';

      // 防抖：React 可能短时间内触发多批 mutation，
      // 合并为一次 scheduleRenderPanel 调用。
      window.clearTimeout(tradeUiMutationDebounceTimer);
      tradeUiMutationDebounceTimer = window.setTimeout(() => {
        tradeUiMutationDebounceTimer = 0;
        scheduleRenderPanel();
      }, 50);
    });

    const mutationRoot = getTradeMutationRoot();
    if (!mutationRoot) {
      scheduleRenderPanel({ followUpMs: timeoutMs });
      return;
    }

    tradeUiMutationObserver.observe(mutationRoot, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['aria-selected', 'disabled', 'aria-disabled', 'class', 'value'],
    });

    // 窗口期结束后断开 observer。
    tradeUiMutationTimeout = window.setTimeout(() => {
      clearTradeUiMutationWait();
      scheduleRenderPanel();
    }, timeoutMs);
  }

  function handleTradeModeTabTransition(tab, isEnteringClose, isEnteringOpen, source) {
    if (!isEnteringClose && !isEnteringOpen) return false;
    stopMultiplierEdit();
    if (isEnteringClose) {
      invalidateTradeButtonCache();
      closeGuard = {
        symbol: getCurrentSymbol(),
        expiresAt: Date.now() + 500,
        snapshotReady: false,
      };
    }
    if (isEnteringOpen) {
      invalidateTradeButtonCache();
      const reset = () => queueAutoOpenLeveragePositionCheck(source, { resetIfFlat: true });
      if (source === 'click') window.requestAnimationFrame(reset);
      else reset();
    }
    const apply = () => applyCachedCloseUiState();
    if (source === 'click') window.requestAnimationFrame(apply);
    else apply();
    scheduleRenderPanel();
    waitForTradeUiMutation();
    return true;
  }

  function getTradeModeObserverRoot() {
    const activeTab = getActiveTradeTab();
    return (
      activeTab?.closest('#position-direction, .bn-tabs__buySell') ||
      activeTab?.parentElement ||
      document.querySelector('#position-direction') ||
      document.querySelector('.bn-tabs__buySell') ||
      document.querySelector('[role="tab"].bn-tab__buySell')?.parentElement ||
      null
    );
  }

  function stopTradeModeTabObserver() {
    if (tradeModeTabObserver) {
      tradeModeTabObserver.disconnect();
      tradeModeTabObserver = null;
    }
    tradeModeTabObserverRoot = null;
  }

  function ensureTradeModeTabObserver() {
    if (document.hidden) return;
    const root = getTradeModeObserverRoot();
    if (!root) {
      stopTradeModeTabObserver();
      return;
    }
    if (tradeModeTabObserver && tradeModeTabObserverRoot === root && root.isConnected) return;

    stopTradeModeTabObserver();
    tradeModeTabObserverRoot = root;
    tradeModeTabObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== 'attributes' || mutation.attributeName !== 'aria-selected') continue;
        if (!isTradeModeTab(mutation.target)) continue;
        const isSelected = mutation.target.getAttribute('aria-selected') === 'true';
        const text = mutation.target.textContent || '';
        const isEnteringClose = isSelected && text.includes('平仓');
        const isEnteringOpen = isSelected && text.includes('开仓');
        if (handleTradeModeTabTransition(mutation.target, isEnteringClose, isEnteringOpen, 'mutation')) return;
      }
    });
    tradeModeTabObserver.observe(root, {
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-selected'],
    });
  }

  function installUiSyncObservers() {
    document.addEventListener('click', (event) => {
      const tab = event.target instanceof Element ? event.target.closest('[role="tab"]') : null;
      if (!isTradeModeTab(tab)) return;
      // 仅在从非 CLOSE 状态切入平仓 tab 时开启 guard（重复点击已选中的平仓 tab 不触发）
      const text = tab.textContent || '';
      const isEnteringClose = text.includes('平仓') && tab.getAttribute('aria-selected') !== 'true';
      const isEnteringOpen = text.includes('开仓') && tab.getAttribute('aria-selected') !== 'true';
      handleTradeModeTabTransition(tab, isEnteringClose, isEnteringOpen, 'click');
      ensureTradeModeTabObserver();
    }, true);

    const startObserve = () => {
      ensureTradeModeTabObserver();
      window.setTimeout(ensureTradeModeTabObserver, 1000);
    };

    if (document.body) {
      startObserve();
    } else {
      window.addEventListener('DOMContentLoaded', startObserve, { once: true });
    }
  }

  function resolveTargetQty(tradeMode, priceOverride) {
    const symbol = getCurrentSymbol();
    const precision = readCurrentOrderbookPrecisionValue();
    if (!precision) throw new Error('未识别订单簿缩放值');
    const qtyRuleContext = getQtyRuleContext(symbol, tradeMode, priceOverride);
    if (qtyRuleContext.status !== 'ready' || !qtyRuleContext.effectiveMinQty) {
      // 规则未就绪时触发加载，下次点击即可命中缓存
      if (symbol && !rulesCache[symbol]) ensureRules(symbol);
      return null;
    }
    const multiplier = loadMultiplier(tradeMode, symbol, precision);
    const qty = multiplyDecimalByInt(qtyRuleContext.effectiveMinQty, multiplier);
    if (!qty) return null;
    return {
      qty,
      source: `MULTIPLIER(${multiplier}x @ ${qtyRuleContext.effectiveMinQty})`,
      symbol,
      precision,
      rule: qtyRuleContext,
    };
  }

  // 使用捕获阶段监听，避免页面内部在冒泡阶段 stopPropagation 导致价格点击事件丢失
  document.addEventListener('click', async (e) => {
    try {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const priceNode = findClickedPriceNode(e.target);
      if (!priceNode) return;
      // 忽略脚本触发的程序化 click，避免日志噪音
      if (!e.isTrusted) return;
      const clickedSymbol = getCurrentSymbol();
      if (!isCurrentObservedSymbol(clickedSymbol)) {
        warn('交易对正在切换，已忽略本次点击');
        return;
      }

      if (CFG.DEBUG) {
        log('命中订单簿价格 click', {
          targetClass: e.target?.className || '',
          targetText: (e.target?.textContent || '').trim().slice(0, 24),
        });
      }

      const now = Date.now();
      if (CFG.COOLDOWN_MS > 0 && now - lastTs < CFG.COOLDOWN_MS) {
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
      const priceInput = findPriceInput();
      if (!priceInput) {
        warn('未找到价格输入框');
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
      lastTs = now;

      setInputValueReact(priceInput, clickedPrice);
      await delay(SINGLE_ORDER_PRICE_SYNC_DELAY_MS);
      setInputValueReact(qtyInput, qtyPlan.qty);
      await delay(SINGLE_ORDER_QTY_SYNC_DELAY_MS);
      const submittedPriceInput = findPriceInput() || priceInput;
      assertSubmittedPriceMatchesClickedPrice(clickedPrice, submittedPriceInput.value);

      const currentSymbol = getCurrentSymbol();
      if (!isCurrentObservedSymbol(qtyPlan.symbol)) {
        throw new Error(`交易对已变化，点击时 ${qtyPlan.symbol}，当前 ${currentSymbol || '-'}`);
      }
      if (getActiveTradeMode() !== action.mode) {
        throw new Error('开仓/平仓模式已变化，已停止提交');
      }
      if (readCurrentOrderbookPrecisionValue() !== qtyPlan.precision) {
        throw new Error('订单簿缩放值已变化，已停止提交');
      }
      const currentAction = resolveTradeAction();
      if (
        !currentAction ||
        currentAction.mode !== action.mode ||
        currentAction.side !== action.side ||
        !currentAction.button ||
        currentAction.button.disabled ||
        currentAction.button.getAttribute('aria-disabled') === 'true'
      ) {
        throw new Error(`提交前${action.side}按钮状态已变化，已停止`);
      }
      log(
        '已填价格/数量',
        clickedPrice,
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
        warn(`SAFE_MODE=true，仅填价格/数量，不点击${action.side}`);
        return;
      }

      if (!isCurrentObservedSymbol(qtyPlan.symbol)) {
        throw new Error('提交前交易对已变化，已停止');
      }
      currentAction.button.click();
      scheduleRenderPanel();
      waitForTradeUiMutation({ timeoutMs: 400 });
      log(`已点击${action.side}`);
    } catch (e2) {
      err('click handler 异常:', e2);
      warn(e2?.message || '订单簿点击提交失败');
    }
  }, true);

  window.addEventListener('storage', (event) => {
    if (
      event.key?.startsWith(`${LOCAL_QTY_MULTIPLIER_PREFIX}:`) ||
      isSymbolScopedSideStorageKey(event.key, [LOCAL_CLOSE_SIDE_KEY, LOCAL_OPEN_SIDE_KEY]) ||
      event.key === LOCAL_LADDER_EXPANDED_KEY ||
      event.key?.startsWith(`${LOCAL_ORDERBOOK_PRECISION_SAMPLES_PREFIX}:`) ||
      isModeSymbolOptionStorageKey(event.key, LADDER_OPTION_STORAGE_KEYS)
    ) scheduleRenderPanel();
  });

  installUiSyncObservers();

  // ── 切换币种 / 首次进入时触发杠杆重置 ──
  function clearSymbolOwnedRuntimeState(symbol) {
    stopMultiplierEdit();
    lastConfirmedCloseState = null;
    lastDisplayCloseState = null;
    lastObservedAccountPositionState = null;
    closeGuard = null;
    invalidateTradeButtonCache();
    stopOrderbookPrecisionSampler();
    orderbookPrecisionOptionsLoadRequestedSymbol = null;
    orderbookPrecisionOptionsLoadAttemptedSymbol = null;
    const recommendation = getOrderbookPrecisionRecommendation(symbol);
    orderbookPrecisionState = {
      symbol,
      samples: readStoredOrderbookPrecisionSamples(symbol),
      recommendation,
      current: readCurrentOrderbookPrecisionValue(),
      nativeOptions: [],
      nativeOptionsStatus: null,
      status: recommendation ? 'ready' : '数据不足',
      sampleEndsAt: 0,
    };
  }

  function checkSymbolChangeForLeverage() {
    const symbol = getCurrentSymbol();
    if (!symbol || symbol === lastObservedSymbol) return;
    lastObservedSymbol = symbol;
    clearSymbolOwnedRuntimeState(symbol);
    startInitialOrderbookPrecisionSample();
    scheduleRenderPanel();
    if (getActiveTradeMode() === 'OPEN') {
      queueAutoOpenLeveragePositionCheck('symbol_change');
    }
  }

  let symbolChangeTimer = null;
  function startSymbolChangeTimer() {
    if (symbolChangeTimer || document.hidden) return;
    // Binance SPA 切换币种时 URL 变化但不触发 popstate，用前台轮询检测。
    symbolChangeTimer = window.setInterval(checkSymbolChangeForLeverage, 500);
  }

  function stopSymbolChangeTimer() {
    if (!symbolChangeTimer) return;
    window.clearInterval(symbolChangeTimer);
    symbolChangeTimer = null;
  }

  let renderPanelTimer = null;
  let routeWatcherTimer = null;
  let routeWasTrading = isFuturesTradingPage();

  function startRenderPanelTimer() {
    if (renderPanelTimer || document.hidden || !isFuturesTradingPage()) return;
    renderPanelTimer = setInterval(renderPanel, 1000);
  }

  function stopRenderPanelTimer() {
    if (renderPanelTimer) {
      clearInterval(renderPanelTimer);
      renderPanelTimer = null;
    }
  }

  function startTradingTimers() {
    if (document.hidden || !isFuturesTradingPage()) return;
    startSymbolChangeTimer();
    ensureTradeModeTabObserver();
    ensureAccountPositionObserver();
    ensureOrderbookPrecisionObserver();
    startRenderPanelTimer();
    startInitialOrderbookPrecisionSample();
  }

  function stopTradingTimers() {
    stopSymbolChangeTimer();
    stopTradeModeTabObserver();
    stopAccountPositionObserver();
    stopOrderbookPrecisionObserver();
    clearTradeUiMutationWait();
    stopRenderPanelTimer();
    stopOrderbookPrecisionSampler();
  }

  function syncRouteState() {
    if (document.hidden) return;
    const isTradingRoute = isFuturesTradingPage();
    if (!isTradingRoute) {
      if (routeWasTrading) {
        routeWasTrading = false;
        pauseForNonTradingPage();
      }
      return;
    }

    const wasTrading = routeWasTrading;
    routeWasTrading = true;
    if (!wasTrading) {
      lastObservedSymbol = getCurrentSymbol();
      clearSymbolOwnedRuntimeState(lastObservedSymbol);
    } else {
      checkSymbolChangeForLeverage();
    }

    const needsRender = !renderPanelTimer || !wasTrading;
    startTradingTimers();
    scheduleChartOrdersRecovery();
    if (needsRender) renderPanel();
    if (!wasTrading && getActiveTradeMode() === 'OPEN') {
      queueAutoOpenLeveragePositionCheck('route_return');
    }
  }

  function startRouteWatcher() {
    if (routeWatcherTimer || document.hidden) return;
    routeWatcherTimer = setInterval(syncRouteState, 1000);
  }

  function stopRouteWatcher() {
    if (!routeWatcherTimer) return;
    clearInterval(routeWatcherTimer);
    routeWatcherTimer = null;
  }

  startRouteWatcher();
  startTradingTimers();
  scheduleChartOrdersRecovery();

  window.setTimeout(() => {
    if (isFuturesTradingPage() && getActiveTradeMode() === 'OPEN') {
      queueAutoOpenLeveragePositionCheck('init');
    }
  }, 1500);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopTradingTimers();
      stopRouteWatcher();
      return;
    }
    panelPositionSignature = '';
    startRouteWatcher();
    syncRouteState();
  });

  window.addEventListener('resize', () => {
    panelPositionSignature = '';
    scheduleRenderPanel();
  }, { passive: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderPanel, { once: true });
  } else {
    renderPanel();
  }

  window.__TM_CLOSE_LONG_DEBUG__ = {
    cfg: CFG,
    get cachedCloseState() { return getCachedCloseState(getCurrentSymbol()); },
    get displayCloseState() { return lastDisplayCloseState; },
    get closeGuard() { return closeGuard; },
    findQtyInput,
    findPriceInput,
    findCloseLongButton,
    findCloseShortButton,
    findOpenLongButton,
    findOpenShortButton,
    findOrderbookRow,
    findClickedPriceNode,
    findPriceNodeFromRow,
    fetchCurrentSymbolPositionState,
    resolveCloseAction,
    resolveTradeAction,
    resolveTargetQty,
    getOrderbookPrices,
    readPersistedBinanceOrderForm,
    isPersistedPostOnlyOrderType,
    ensurePostOnlyPreferencePersisted,
    ensurePostOnlyOrderType,
    buildLadderPlan,
    startLadder,
    stopLadder,
    cancelCurrentSymbolOpenOrders,
    queueAutoOpenLeverageReset,
    queueAutoOpenLeveragePositionCheck,
    renderPanel,
  };

  log('脚本加载完成', location.href);
})();
