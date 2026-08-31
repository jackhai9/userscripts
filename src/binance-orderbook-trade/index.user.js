// ==UserScript==
// @name         【自写】Binance 订单簿单击下单
// @namespace    binance.orderbook.trade
// @icon         data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%23f0b90b%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2249%22%20text-anchor%3D%22middle%22%20font-family%3D%22Arial%2C%20sans-serif%22%20font-size%3D%2242%22%20font-weight%3D%22800%22%20fill%3D%22%23111827%22%3EJ%3C%2Ftext%3E%3C%2Fsvg%3E
// @icon64       data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%23f0b90b%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2249%22%20text-anchor%3D%22middle%22%20font-family%3D%22Arial%2C%20sans-serif%22%20font-size%3D%2242%22%20font-weight%3D%22800%22%20fill%3D%22%23111827%22%3EJ%3C%2Ftext%3E%3C%2Fsvg%3E
// @version      2.7.175
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
  isFilteredCurrentSymbolOpenOrdersEmpty,
  isCurrentSymbolOpenOrdersFilterReady,
  isCurrentSymbolOpenOrdersClearCandidate,
  isCurrentSymbolOpenOrdersDefinitivelyClear,
  isOpenOrdersScopeConfirmedForSymbolText,
  isOpenOrdersScopeLimitedToSymbolText,
  normalizeText,
  parseOpenOrdersTabCount,
  readVisibleOpenOrderSymbolsText,
  resolveCancelSymbolButtonPresentation,
  shouldContinueOpenOrdersClearObservation,
  updateOpenOrdersClearStability,
} from './core/cancel-orders.js';
import {
  BINANCE_PAGE_TEXT,
  buildBinanceTextAlternation,
  includesBinancePageText,
  includesCompactBinancePageText,
  isBinanceCancelAllText,
  matchesBinancePageText,
} from './contracts/binance-page-text.js';
import {
  PANEL_COPY,
  combineLocalizedText,
  formatLocalizedText,
  formatPrecisionRefreshTooltip,
  localizedText,
  resolveUiLocaleFromPathname,
} from './contracts/panel-copy.js';
import {
  resolveCloseDisplayQuantities,
  resolveConfirmedCloseDirection,
  shouldDisableCloseControl,
} from './core/close-action.js';
import {
  observeAutoOpenLeveragePositionState,
  resolveSymbolPositionSideStatus,
  resolveSymbolPositionStatus,
} from './core/auto-open-leverage.js';
import {
  applyUsdtTransferToBalances,
  areUsdtBalancesEqual,
  buildUsdtRebalancePlan,
  parseUsdtWalletBalances,
  resolveAllFuturesPositionStatus,
  withFuturesTransferableBalance,
} from './core/usdt-rebalance.js';
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
  formatOrderbookPrecisionShortcutLabel,
  getOrderbookPrecisionShortcutOptions,
  recommendOrderbookPrecision,
  recommendOrderbookPrecisionWithExpandingWindow,
} from './core/precision.js';
import { allocateLadderQuantities } from './core/quantity.js';
import {
  fitLadderPlanForMinimumQty,
  getLadderActionSpec as getLadderActionSpecData,
  getUnavailableLadderQuantityMessage,
} from './core/ladder-plan.js';
import { keepInteractionFeedbackVisible } from './core/interaction-feedback.js';
import {
  createContinuousLadderProgress,
  formatActiveContinuousLadderProgress,
  formatContinuousLadderProgress,
  formatContinuousLadderPositionClosedProgress,
  formatContinuousLadderWaitProgress,
  recordContinuousLadderRound,
  resolveContinuousLadderRecovery,
  waitForContinuousLadderNextRound,
} from './core/continuous-ladder.js';
import {
  createLadderProgress,
  formatCompletedLadderProgress,
  formatFailedLadderProgress,
  formatInterruptedLadderProgress,
  formatPositionClosedLadderProgress,
  formatStoppedLadderProgress,
  recordLadderCancelledOrder,
  recordLadderSubmittedOrder,
  setLadderPlannedOrders,
  snapshotLadderProgress,
} from './core/ladder-progress.js';
import {
  throwIfAborted,
  waitForPromiseOrAbort,
} from './core/abort.js';
import { formatStatusBaseAsset } from './core/status-symbol.js';
import { selectFarthestOpenOrders } from './core/open-order-capacity.js';
import {
  evaluateOrderSubmitAcknowledgement,
  formatBinancePlaceOrderResponseDiagnostic,
  getBinanceApiErrorCode,
  isBinanceMaxOpenOrdersErrorCode,
  isBinancePlaceOrderSuccessPayload,
  isBinancePostOnlyMakerRejectCode,
  isOpenLadderOpenOrdersCapacityFeedback,
  isPostOnlyMakerRejectionFeedback,
  isReduceOnlyOpenOrdersConflictFeedback,
  isPotentialOrderFeedbackText,
  summarizeBinancePlaceOrderPayload,
} from './core/order-feedback.js';
import {
  isFuturesTradingPathname,
  parseFuturesTradingSymbolFromPathname,
} from '../shared/binance-futures-route.js';
import {
  ensureSpaRouteChangePatched,
  installSpaRouteChangeListener,
} from '../shared/spa-route-change.js';
import {
  createAccountOrdersMutationSignal,
  findAccountOrdersTabByIdentity as findAccountOrdersTabByIdentityDom,
  findAccountPositionTab as findAccountPositionTabDom,
  findOpenOrdersBasicSubTab as findOpenOrdersBasicSubTabDom,
  findOpenOrdersConditionalSubTab as findOpenOrdersConditionalSubTabDom,
  findOpenOrdersSubTabByIdentity as findOpenOrdersSubTabByIdentityDom,
  findOpenOrdersTab as findOpenOrdersTabDom,
  findSelectedAccountOrdersTab as findSelectedAccountOrdersTabDom,
  findSelectedOpenOrdersSubTab as findSelectedOpenOrdersSubTabDom,
  getAccountOrdersTabIdentity as getAccountOrdersTabIdentityDom,
  getAccountOrdersTabGroup as getAccountOrdersTabGroupDom,
  getActiveOpenOrdersScope as getActiveOpenOrdersScopeDom,
  getOpenOrdersSubTabIdentity as getOpenOrdersSubTabIdentityDom,
  parseAccountPositionTabCount,
  waitForAccountOrdersMutationState,
} from './dom/account-orders.js';
import {
  calculateFloatingPanelLayout,
  collectTradeButtonsFromScopes,
  createBoundedInputWriter,
  createTradeInputStateReader,
  findActiveTradeInputs as findActiveTradeInputsDom,
  findTradeFormRoot,
  findTradePanelInsertionPoint,
  findCurrentLeverageButtonFromScopes,
  isScriptOwnedTradeInputRecoveryState,
  isTradeActionButton as isTradeActionButtonDom,
  isTradeModeTab as isTradeModeTabDom,
  mutationTouchesCloseQuantity,
  parseTradeModeLabel,
  parseLeverageButtonText,
  placeTradePanelSpacer,
  readTradeAvailableBalance,
  waitForTradeActionButtonFrameState,
  waitForTradeFormFrameState,
  waitForTradeFormMutationState,
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
import { coalesceTradingViewDrawingSaves } from './core/chart-save-coalescer.js';
import { resolveCancelDialogDecision } from './core/cancel-dialog-decision.js';
import {
  classifyBinanceCancelAllDialogAction,
  classifyBinanceCancelAllDialogKeyboardAction,
  createDialogMutationSignal,
  findBinanceCancelAllDialog,
  waitForDialogMutationState,
} from './dom/cancel-all-dialog.js';
import {
  findOpenOrderRowElements,
  getOpenOrderRowCells,
} from './dom/open-order-rows.js';
import {
  assertSameBinanceChartOrdersTarget,
  findActiveBinanceChartOrdersPopover,
  findBinanceChartOrdersTarget as findBinanceChartOrdersTargetDom,
  getBinanceChartOrdersTarget as getBinanceChartOrdersTargetDom,
} from './dom/chart-orders.js';
import { showUsdtRebalanceDialog } from './dom/usdt-rebalance-dialog.js';

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
  const LOCAL_LADDER_OPEN_PERCENT_KEY = 'jh_binance_ladder_open_percent';
  const LOCAL_LADDER_CLOSE_PERCENT_KEY = 'jh_binance_ladder_close_percent';
  const LOCAL_LADDER_OPEN_LEVELS_KEY = 'jh_binance_ladder_open_levels';
  const LOCAL_LADDER_CLOSE_LEVELS_KEY = 'jh_binance_ladder_close_levels';
  const LOCAL_LADDER_OPEN_STEP_KEY = 'jh_binance_ladder_open_step';
  const LOCAL_LADDER_CLOSE_STEP_KEY = 'jh_binance_ladder_close_step';
  const LOCAL_ORDERBOOK_PRECISION_SAMPLES_PREFIX = 'jh_binance_orderbook_precision_samples_v3';
  const BINANCE_PERSIST_KEY = 'persist:futures-trade-ui';
  const BINANCE_POST_ONLY_ORDER_TYPE = 'POST_ONLY';
  const BINANCE_CLOSEABLE_QUANTITY_LABEL_PATTERN = buildBinanceTextAlternation(
    BINANCE_PAGE_TEXT.closeableQuantity,
  );
  const BINANCE_OPENABLE_QUANTITY_LABEL_PATTERN = buildBinanceTextAlternation(
    BINANCE_PAGE_TEXT.openableQuantity,
  );
  const BINANCE_POST_ONLY_TIME_IN_FORCE = 'GTC';
  const PANEL_ID = 'jh-binance-close-qty-multiplier-panel';
  // Keep the panel above the trading layout but below Binance portal overlays such as menus.
  const PANEL_Z_INDEX = 1000;
  const SPACER_ID = 'jh-binance-close-qty-multiplier-spacer';
  const INPUT_ID = 'jh-binance-close-qty-multiplier-input';
  const DEC_ID = 'jh-binance-close-qty-multiplier-dec';
  const INC_ID = 'jh-binance-close-qty-multiplier-inc';
  const SIDE_LONG_ID = 'jh-binance-close-side-long';
  const SIDE_SHORT_ID = 'jh-binance-close-side-short';
  const LADDER_BODY_ID = 'jh-binance-ladder-body';
  const LADDER_STATUS_ID = 'jh-binance-ladder-status';
  const LADDER_STATUS_ROW_ID = 'jh-binance-ladder-status-row';
  const USDT_REBALANCE_ACTION_ID = 'jh-binance-usdt-rebalance-action';
  const MULTIPLIER_PRESS_FEEDBACK_ATTR = 'data-jh-press-feedback';
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
  const LADDER_SUBMIT_START_TIMEOUT_MS = 3500;
  // Binance can take up to 10 seconds to resolve an accepted order request.
  // Once the exact fetch is observed, keep waiting for that response instead of
  // treating the original UI-start deadline as the response deadline too.
  const LADDER_SUBMIT_RESPONSE_TIMEOUT_MS = 12000;
  const LADDER_ACTION_FEEDBACK_MIN_MS = 240;
  const CONTINUOUS_CLOSE_POSITION_CHECK_MS = 1000;
  const MULTIPLIER_PRESS_FEEDBACK_MS = 140;
  const LADDER_REPLACE_OPEN_ORDERS_CLEAR_TIMEOUT_MS = 6500;
  const LADDER_REPLACE_ROW_SETTLE_MS = 240;
  const MAX_OPEN_ORDERS_RECOVERY_CANCEL_COUNT = 100;
  const OPEN_ORDERS_LAZY_LOAD_SETTLE_MS = 700;
  const OPEN_ORDERS_LAZY_LOAD_TIMEOUT_MS = 7000;
  const CANCEL_OPEN_ORDERS_CLEAR_SETTLE_MS = 1200;
  const ROW_CANCEL_DIALOG_CLOSE_TIMEOUT_MS = 60000;
  const CANCEL_DIALOG_DISCOVERY_TIMEOUT_MS = 1800;
  const CANCEL_NO_ORDERS_FEEDBACK_MS = 600;
  const CHART_ORDERS_MENU_TIMEOUT_MS = 1800;
  const CHART_ORDERS_MENU_POLL_MS = 50;
  const LADDER_MAKER_BUFFER_LEVELS = 1;
  const LADDER_REPRICE_PAUSE_EVERY_ATTEMPTS = 5;
  const LADDER_REPRICE_PAUSE_MS = 3000;
  const LADDER_REPRICE_DELAY_MS = 180;
  const BINANCE_PLACE_ORDER_BAPI_PATH = '/bapi/futures/v1/private/future/order/place-order';
  const BINANCE_USER_POSITION_BAPI_PATH = '/bapi/futures/v6/private/future/user-data/user-position';
  const BINANCE_WALLET_BALANCE_BAPI_PATH = '/bapi/asset/v2/private/asset-service/wallet/balance?needBalanceDetail=true&quoteAsset=USDT';
  const BINANCE_FUTURES_MAX_WITHDRAW_BAPI_PATH = '/bapi/futures/v1/private/future/user-data/getMaxWithdrawAmount';
  const BINANCE_WALLET_TRANSFER_BAPI_PATH = '/bapi/asset/v1/private/asset-service/wallet/transfer';
  const USDT_REBALANCE_FLAT_STABLE_MS = 3000;
  const USDT_REBALANCE_REQUEST_TIMEOUT_MS = 5000;
  const USDT_REBALANCE_BALANCE_POLL_MS = 1000;
  const LADDER_OPEN_QTY_READY_TIMEOUT_MS = 1200;
  const TRADE_INPUT_SYNC_TIMEOUT_MS = 350;
  const TRADE_INPUT_SYNC_STABLE_FRAMES = 2;
  const LADDER_INPUT_SETTLE_TIMEOUT_MS = 1200;
  const LADDER_INPUT_SETTLE_STABLE_MS = 180;
  const LADDER_INPUT_SETTLE_MAX_WRITES = 5;
  const ORDERBOOK_PRECISION_READY_POLL_MS = 100;
  const ORDERBOOK_PRECISION_READY_TIMEOUT_MS = 5000;
  const ORDERBOOK_PRECISION_OPTION_WAIT_MS = 1200;
  const ORDERBOOK_PRECISION_INITIAL_TRADE_LIMIT = 10;
  const ORDERBOOK_PRECISION_TRADE_EXPANSION_STEP = 10;
  const ORDERBOOK_PRECISION_MIN_EFFECTIVE_MOVES = 5;
  const ORDERBOOK_PRECISION_SHORTCUT_LIMIT = 4;
  const ORDERBOOK_PRECISION_REFRESH_FEEDBACK_MS = 900;
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
  const BNC_HEADERS_READY_TIMEOUT_MS = 5000;
  const AUTO_OPEN_LEVERAGE_DEDUPE_MS = 1200;
  const DOM_LOOKUP_CACHE_MS = 250;
  const INPUT_BORDER_COLOR = 'var(--color-InputLine)';
  const INPUT_ERROR_COLOR = 'var(--color-Error)';
  const INPUT_FOCUS_COLOR = 'var(--color-PrimaryYellow)';
  const INPUT_DEFAULT_BG = 'transparent';
  const PRIMARY_EMPHASIS_COLOR = '#000000';
  const PRIMARY_EMPHASIS_FONT_WEIGHT = '500';
  const CONTROL_BORDER_COLOR = '#d5d9e2';
  const PANEL_DIVIDER_COLOR = '#ededed';
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
  const TRADE_UI_STATE_TIMEOUT_MS = 1000;
  const TRADE_ACTION_BUTTON_READY_TIMEOUT_SECONDS = 3;
  const TRADE_ACTION_BUTTON_READY_TIMEOUT_MS = TRADE_ACTION_BUTTON_READY_TIMEOUT_SECONDS * 1000;
  const ROUTE_WATCHDOG_MS = 5000;

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
  let lastObservedAccountOpenOrdersCount = null;
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
  let continuousLadderTask = null;
  let singleOrderTask = null;
  let ladderAbortController = null;
  let continuousLadderAbortController = null;
  let activeLadderActionType = null;
  let activeContinuousLadderActionType = null;
  let activeContinuousLadderProgress = null;
  let activeContinuousLadderRoundProgress = null;
  let activeLadderPanelContext = null;
  let cancelCurrentSymbolOpenOrdersTask = null;
  let cancelCurrentSymbolOpenOrdersBlocksLadderActions = false;
  let cancelNoOrdersFeedbackActive = false;
  let cancelNoOrdersFeedbackTimer = 0;
  let chartOrdersRecoveryPendingAtStartup =
    sessionStorage.getItem(CHART_ORDERS_RECOVERY_STORAGE_KEY) !== null;
  let chartOrdersRecoveryTask = null;
  let chartOrdersRecoveryLastError = null;
  let ladderStopRequested = false;
  let activeUiLocale = resolveUiLocaleFromPathname(location.pathname);
  let ladderStatusText = PANEL_COPY.state.idle;
  let ladderStatusTitle = PANEL_COPY.state.idle;
  let usdtRebalanceEligibilityTimer = 0;
  let usdtRebalanceEligibilityEpoch = 0;
  let usdtRebalanceEligibilityTask = null;
  let usdtRebalanceEligible = false;
  let usdtRebalanceTask = null;
  let ladderPanelBodySignature = '';
  let panelPositionInvalidated = true;
  let panelObservedSize = '';
  let panelResizeObserver = null;
  let ladderSubmitCaptureSequence = 0;
  let activeLadderSubmitCapture = null;
  const multiplierPressFeedbackTimers = new WeakMap();
  let orderbookPrecisionSelectionTask = null;
  let orderbookPrecisionOptionsLoadRequestedSymbol = null;
  let orderbookPrecisionOptionsLoadAttemptedSymbol = null;
  let orderbookPrecisionObserver = null;
  let orderbookPrecisionObserverRoot = null;
  let lastObservedOrderbookPrecision = null;
  let orderbookPrecisionRefreshFeedback = { symbol: null, state: 'idle' };
  let orderbookPrecisionRefreshFeedbackTimer = null;
  let orderbookPrecisionState = {
    symbol: null,
    samples: [],
    recommendation: null,
    current: null,
    nativeOptions: [],
    nativeOptionsStatus: null,
    status: PANEL_COPY.status.precisionInsufficient,
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
      #${PANEL_ID} button[${MULTIPLIER_PRESS_FEEDBACK_ATTR}="true"] {
        background: ${DISABLED_CONTROL_BG} !important;
        color: ${DISABLED_CONTROL_TEXT} !important;
        border-color: ${DISABLED_CONTROL_BORDER} !important;
        opacity: ${DISABLED_CONTROL_OPACITY} !important;
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
    input.blur();
  }

  function delay(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function createLadderStoppedError() {
    const error = new Error('已停止');
    error.name = 'LadderStoppedError';
    return error;
  }

  function isLadderStoppedError(error) {
    return error?.name === 'LadderStoppedError';
  }

  function createContinuousRecoverableLadderError(kind, message) {
    const localizedMessage = localizeKnownUiStatus(message);
    const error = new Error(formatLocalizedText(localizedMessage, 'zh-CN'));
    error.safeNoSubmit = true;
    error.continuousRecoveryKind = kind;
    error.localizedText = localizedMessage;
    return error;
  }

  function createContinuousUnconfirmedSubmitError(message) {
    if (!isLocalizedText(message)) throw new Error('未确认下单结果文案必须提供中英文');
    const error = new Error(formatLocalizedText(message, 'zh-CN'));
    error.continuousRecoveryKind = 'submit_unconfirmed';
    error.localizedText = message;
    return error;
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
    migrateModeSymbolPrecisionNumberOption(
      localStorage,
      LADDER_PERCENT_STORAGE_KEYS,
      'CLOSE',
      symbol,
      precision,
      100,
      DEFAULT_LADDER_CLOSE_PERCENT,
      LADDER_CLOSE_PERCENTS,
    );
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

  function readLadderOptionContext(spec, symbol, precision) {
    const percent = spec.mode === 'OPEN'
      ? getLadderOpenPercent(symbol, precision)
      : getLadderClosePercent(symbol, precision);
    return {
      percent,
      levels: getLadderLevels(spec.mode, symbol, precision),
      ladderStep: getLadderStep(spec.mode, symbol, precision),
    };
  }

  function areLadderOptionContextsEqual(left, right) {
    return (
      left.percent === right.percent
      && left.levels === right.levels
      && left.ladderStep === right.ladderStep
    );
  }

  function hasLadderOptionContextChanged(plan) {
    const current = readLadderOptionContext(plan.spec, plan.symbol, plan.precision);
    return !areLadderOptionContextsEqual(current, plan.optionContext);
  }

  function ui(text) {
    return formatLocalizedText(text, activeUiLocale);
  }

  const LOCALIZED_STATUS_EXACT = new Map([
    ['未知阶梯动作', 'Unknown ladder action'],
    ['未识别当前交易对', 'Current symbol not recognized'],
    ['交易对正在切换', 'Symbol is changing'],
    ['当前交易对无挂单', 'No open orders for this symbol'],
    ['打开当前委托时交易对已变化', 'Symbol changed while opening Open Orders'],
    ['未能打开当前委托', 'Could not open Open Orders'],
    ['未找到当前委托面板', 'Open Orders panel not found'],
    ['未找到当前委托基础单', 'Basic Open Orders tab not found'],
    ['未确认仅显示当前交易对挂单', 'Could not confirm that only this symbol is shown'],
    ['读取挂单时交易对已变化', 'Symbol changed while reading open orders'],
    ['未找到当前委托的全撤按钮', 'Cancel All was not found in Open Orders'],
    ['撤单前交易对已变化', 'Symbol changed before cancellation'],
    ['未能准备撤单页面，未打开确认弹窗', 'Could not prepare the cancellation page; confirmation was not opened'],
    ['准备撤单时交易对已变化', 'Symbol changed while preparing cancellation'],
    ['准备撤单时未找到当前委托面板', 'Open Orders panel was not found while preparing cancellation'],
    ['准备撤单时未确认仅显示当前交易对挂单', 'Could not confirm this-symbol-only orders while preparing cancellation'],
    ['准备撤单时未找到全撤按钮', 'Cancel All was not found while preparing cancellation'],
    ['撤单确认弹窗已打开', 'Cancellation confirmation opened'],
    ['撤单确认弹窗结构异常，未执行弹窗操作', 'Cancellation dialog changed; no dialog action was taken'],
    ['确认撤单前交易对已变化', 'Symbol changed before cancellation was confirmed'],
    ['未识别到撤单确认弹窗，未继续撤单流程', 'Cancellation dialog was not detected; cancellation stopped'],
    ['撤单已取消', 'Cancellation cancelled'],
    ['撤单已确认，等待挂单清空', 'Cancellation confirmed; waiting for open orders to clear'],
    ['等待撤单完成时交易对已变化', 'Symbol changed while waiting for cancellation'],
    ['等待撤单完成时未找到当前委托面板', 'Open Orders panel was not found while waiting for cancellation'],
    ['等待撤单完成时未确认仅显示当前交易对挂单', 'Could not confirm this-symbol-only orders while waiting for cancellation'],
    ['当前交易对挂单仍存在，已停止重新挂单', 'Open orders still exist for this symbol; replacement stopped'],
    ['当前交易对挂单仍存在，撤单未完成', 'Open orders still exist for this symbol; cancellation is incomplete'],
    ['原挂单已撤，继续阶梯挂单', 'Previous orders cancelled; continuing ladder placement'],
    ['撤单已完成', 'Cancellation completed'],
    ['未能恢复图表当前委托显示', 'Could not restore chart open-order display'],
    ['阶梯任务运行中，请先停止阶梯挂单', 'A ladder task is running; stop it first'],
    ['连续交易运行中，请先停止阶梯挂单', 'Continuous trading is running; stop it first'],
    ['正在读取账户再平衡计划', 'Loading account rebalance plan'],
    ['USDT 已按 5:4:1 分配', 'USDT is already allocated at 5:4:1'],
    ['账户再平衡已取消', 'Account rebalance cancelled'],
    ['已全部平仓', 'All positions closed'],
    ['空闲', 'Idle'],
    ['单击下单未执行：交易对正在切换', 'Single order not placed: symbol is changing'],
    ['单击下单未执行：仓位确认中', 'Single order not placed: confirming positions'],
    ['单击下单未执行：未找到数量输入框', 'Single order not placed: quantity input not found'],
    ['单击下单未执行：未找到价格输入框', 'Single order not placed: price input not found'],
    ['单击下单未执行：数量规则读取中', 'Single order not placed: loading quantity rules'],
    ['交易对已切换', 'Symbol changed'],
    ['开仓/平仓模式已切换', 'Trade mode changed'],
    ['当前方向已无持仓', 'No position in this direction'],
    ['价格精度已变化，下一轮按新精度继续', 'Precision changed; the next round will use the new precision'],
    ['比例、笔数或间距已变化，下一轮按新设置继续', 'Ratio, orders, or gap changed; the next round will use the new settings'],
    ['价格框或数量框未稳定', 'Price or quantity input did not stabilize'],
    ['未找到价格输入框', 'Price input not found'],
    ['未找到数量输入框', 'Quantity input not found'],
    ['交易规则尚未就绪，请稍后重试', 'Trading rules are not ready; try again shortly'],
    ['下单数量规则尚未就绪，请稍后重试', 'Order quantity rules are not ready; try again shortly'],
    ['只做 Maker 未生效，请刷新页面后重试', 'Post Only is not active; refresh the page and try again'],
    ['未识别价格精度', 'Price precision not recognized'],
    ['重挂前价格精度已变化，已停止', 'Precision changed before replacement; stopped'],
    ['读取交易规则时价格精度已变化，已停止', 'Precision changed while reading trading rules; stopped'],
    ['读取下单数量时比例、笔数或间距已变化', 'Ratio, orders, or gap changed while reading order quantity'],
    ['盘口已刷新，未读取到对手盘价格', 'Order book refreshed, but the opposite-side price is unavailable'],
    ['刷新盘口后最小下单量未就绪', 'Minimum order quantity is not ready after refreshing the order book'],
    ['执行中价格精度已变化，已停止', 'Precision changed during execution; stopped'],
    ['执行中比例、笔数或间距已变化', 'Ratio, orders, or gap changed during execution'],
    ['未能确定唯一的当前交易表单输入框', 'Could not identify one active trade-form input set'],
    ['执行中价格输入框已消失', 'Price input disappeared during execution'],
    ['执行中数量输入框已消失', 'Quantity input disappeared during execution'],
    ['当前方向暂无可平数量', 'No closable quantity in this direction'],
    ['查找当前委托', 'Locating Open Orders'],
    ['未选中待替换挂单', 'No replacement orders were selected'],
    ['原挂单未完成替换，已停止重新挂单', 'Previous orders were not fully replaced; replacement stopped'],
    ['撤销待替换挂单前交易对已变化', 'Symbol changed before cancelling replacement orders'],
    ['撤销待替换挂单时交易对已变化', 'Symbol changed while cancelling replacement orders'],
    ['同向可撤挂单数量不足，已停止重新挂单', 'Not enough cancellable same-direction orders; replacement stopped'],
    ['待替换挂单的撤单按钮已失效，已停止重新挂单', 'Replacement-order cancel control became unavailable; replacement stopped'],
    ['待替换挂单的撤单按钮点击失败，已停止重新挂单', 'Could not click the replacement-order cancel control; replacement stopped'],
    ['待替换挂单仍存在，已停止重新挂单', 'Replacement orders still exist; replacement stopped'],
    ['待替换挂单状态未稳定，已停止重新挂单', 'Replacement-order state did not stabilize; replacement stopped'],
    ['未能恢复隐藏其他合约状态', 'Could not restore Hide Other Symbols'],
    ['账户余额已变化，已停止账户再平衡', 'Account balances changed; account rebalance stopped'],
    ['划转后账户余额未及时更新', 'Account balances did not update after the transfer'],
    ['当前不在可操作的合约页面', 'The current page is not an operable Futures trading page'],
    ['当前仍有交易任务运行', 'A trading task is still running'],
    ['未读取到全账户持仓数量', 'Could not read the account-wide position count'],
    ['全账户仍有持仓', 'Positions still exist in the account'],
    ['未读取到全账户当前委托数量', 'Could not read the account-wide open-order count'],
    ['全账户仍有当前委托', 'Open orders still exist in the account'],
    ['Binance 登录态已失效', 'Binance session has expired'],
    ['Binance 请求超时', 'Binance request timed out'],
  ]);

  function localizeKnownUiStatus(text) {
    if (typeof text !== 'string') return text;
    const exactEnglish = LOCALIZED_STATUS_EXACT.get(text);
    if (exactEnglish) return localizedText(text, exactEnglish);

    let match = /^原交易对 (.+) 页面已离开，撤单确认跟踪已停止$/.exec(text);
    if (match) return localizedText(text, `Left the original ${match[1]} page; cancellation tracking stopped`);

    match = /^账户再平衡中 · (\d+\/\d+) 笔$/.exec(text);
    if (match) return localizedText(text, `Account rebalance · ${match[1]} transfers`);
    match = /^账户再平衡已完成 · (\d+\/\d+) 笔$/.exec(text);
    if (match) return localizedText(text, `Account rebalance completed · ${match[1]} transfers`);
    match = /^账户再平衡部分完成 · (\d+\/\d+) 笔 · (.+)$/.exec(text);
    if (match) return localizedText(
      text,
      `Account rebalance partially completed · ${match[1]} transfers · ${formatLocalizedText(localizeKnownUiStatus(match[2]), 'en')}`,
    );
    match = /^账户再平衡失败 · (.+)$/.exec(text);
    if (match) return localizedText(
      text,
      `Account rebalance failed · ${formatLocalizedText(localizeKnownUiStatus(match[1]), 'en')}`,
    );

    match = /^单击下单未执行：未找到可用(开仓|平仓)动作$/.exec(text);
    if (match) return localizedText(
      text,
      `Single order not placed: no available ${match[1] === '开仓' ? 'open' : 'close'} action`,
    );

    const actionEnglish = {
      开多: 'Open Long',
      开空: 'Open Short',
      平多: 'Close Long',
      平空: 'Close Short',
    };
    match = /^单击(开多|开空|平多|平空)(准备中|确认中|已提交)(.*)$/.exec(text);
    if (match) {
      const phaseEnglish = {
        准备中: 'preparing',
        确认中: 'confirming',
        已提交: 'submitted',
      }[match[2]];
      return localizedText(text, `${actionEnglish[match[1]]} single order ${phaseEnglish}${match[3]}`);
    }
    match = /^单击(开多|开空|平多|平空)失败：(.+)$/.exec(text);
    if (match) return localizedText(
      text,
      `${actionEnglish[match[1]]} single order failed: ${formatLocalizedText(localizeKnownUiStatus(match[2]), 'en')}`,
    );
    match = /^单击下单失败：(.+)$/.exec(text);
    if (match) return localizedText(
      text,
      `Single order failed: ${formatLocalizedText(localizeKnownUiStatus(match[1]), 'en')}`,
    );

    match = /^未能切换至(开仓|平仓)$/.exec(text);
    if (match) return localizedText(text, `Could not switch to ${match[1] === '开仓' ? 'Open' : 'Close'} mode`);
    match = /^订单簿(买盘|卖盘)不足 (\d+) 档，档幅 (\d+)$/.exec(text);
    if (match) return localizedText(
      text,
      `${match[1] === '买盘' ? 'Bid' : 'Ask'} depth is below ${match[2]} levels at gap ${match[3]}`,
    );
    match = /^刷新后订单簿(买盘|卖盘)不足 (\d+) 档$/.exec(text);
    if (match) return localizedText(
      text,
      `After refresh, ${match[1] === '买盘' ? 'bid' : 'ask'} depth is below ${match[2]} levels`,
    );
    match = /^读取(可开数量|可平数量)时价格精度已变化，已停止$/.exec(text);
    if (match) return localizedText(text, `Precision changed while reading ${match[1] === '可开数量' ? 'openable' : 'closable'} quantity; stopped`);
    match = /^下单按钮 (\d+) 秒内未(渲染完成|恢复可点击|达到可点击状态)$/.exec(text);
    if (match) {
      const ending = {
        渲染完成: 'finish rendering',
        恢复可点击: 'become clickable again',
        达到可点击状态: 'become clickable',
      }[match[2]];
      return localizedText(text, `Order button did not ${ending} within ${match[1]} seconds`);
    }
    match = /^未找到(.*)方向的可撤基础单$/.exec(text);
    if (match) return localizedText(text, `No cancellable Basic orders found for ${match[1] || 'the current'} direction`);
    match = /^撤销 (\d+) 笔同向挂单$/.exec(text);
    if (match) return localizedText(text, `Cancelling ${match[1]} same-direction orders`);

    return text;
  }

  function setLadderStatus(text = PANEL_COPY.state.idle, title = null) {
    ladderStatusText = localizeKnownUiStatus(text);
    ladderStatusTitle = localizeKnownUiStatus(title ?? text);
    const renderedText = ui(ladderStatusText);
    const renderedTitle = ui(ladderStatusTitle);
    const statusEl = document.getElementById(LADDER_STATUS_ID);
    if (statusEl) {
      if (statusEl.textContent !== renderedText) statusEl.textContent = renderedText;
      if (statusEl.title !== renderedTitle) statusEl.title = renderedTitle;
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
    return findTradeInputs({ requirePrice: false })?.qtyInput || null;
  }

  function findPriceInput() {
    return findTradeInputs()?.priceInput || null;
  }

  function findTradeInputs(options = null) {
    return findActiveTradeInputsDom(document, {
      panelId: PANEL_ID,
      isVisibleElement,
      requirePrice: options?.requirePrice !== false,
    });
  }

  function isOwnPanelButton(button) {
    return !!button?.closest?.(`#${PANEL_ID}`);
  }

  function getActiveTradeMode() {
    const activeTab =
      document.querySelector('#position-direction [role="tab"][aria-selected="true"]') ||
      document.querySelector('.bn-tabs__buySell [role="tab"][aria-selected="true"]') ||
      document.querySelector('[role="tab"].bn-tab__buySell[aria-selected="true"]');
    return parseTradeModeLabel(activeTab?.textContent) || 'UNKNOWN';
  }

  function getCurrentOrderType() {
    const activeTab = findVisibleTradeScopeElement(
      '[role="tab"][aria-selected="true"][data-tab-key]',
      (tab) => !isTradeModeTab(tab)
    );
    return String(activeTab?.getAttribute('data-tab-key') || 'LIMIT').toUpperCase();
  }

  function isPostOnlyOrderTypeActive() {
    if (getCurrentOrderType() !== BINANCE_POST_ONLY_ORDER_TYPE) return false;
    return !!findVisibleTradeScopeElement(
      '[role="tab"][aria-selected="true"][data-tab-key]',
      (tab) => (
        String(tab.getAttribute('data-tab-key') || '').toUpperCase() === BINANCE_POST_ONLY_ORDER_TYPE
        && includesBinancePageText(tab.textContent, BINANCE_PAGE_TEXT.postOnly)
      )
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

  function buttonTextMatches(button, labels) {
    return includesBinancePageText(button?.textContent, labels);
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
    return findTradeInputs({ requirePrice: false })?.root || null;
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

  function findTradeButton(labels, mode) {
    return collectTradeButtons(mode).find((candidate) => buttonTextMatches(candidate, labels)) || null;
  }

  function findCloseLongButton() {
    return findTradeButton(BINANCE_PAGE_TEXT.tradeAction.CLOSE_LONG, 'CLOSE');
  }

  function findCloseShortButton() {
    return findTradeButton(BINANCE_PAGE_TEXT.tradeAction.CLOSE_SHORT, 'CLOSE');
  }

  function findOpenLongButton() {
    return findTradeButton(BINANCE_PAGE_TEXT.tradeAction.OPEN_LONG, 'OPEN');
  }

  function findOpenShortButton() {
    return findTradeButton(BINANCE_PAGE_TEXT.tradeAction.OPEN_SHORT, 'OPEN');
  }

  // ── bapi header 缓存 ──
  // Binance 前端通过内部模块在调用 fetch 时注入鉴权 header（csrftoken、bnc-uuid 等），
  // 这些值不在 cookie/localStorage 里，JS 无法直接读取。
  // 策略：拦截 window.fetch，从 Binance 自身发出的 bapi 请求里缓存 header，
  // 后续 adjustLeverageApi 复用这些 header。
  let cachedBncHeaders = null;
  let resolveBncHeadersReady;
  const bncHeadersReady = new Promise((resolve) => {
    resolveBncHeadersReady = resolve;
  });
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
    let resolveRequestStarted;
    const requestStarted = new Promise((resolve) => {
      resolveRequestStarted = resolve;
    });
    activeLadderSubmitCapture = {
      captureId: ladderSubmitCaptureSequence,
      apiErrors: [],
      apiSuccesses: [],
      responseDiagnostics: [],
      responseObservations: [],
      requestStarted,
      resolveRequestStarted,
    };
    return activeLadderSubmitCapture.captureId;
  }

  function endLadderSubmitResponseCapture(captureId) {
    if (activeLadderSubmitCapture?.captureId === captureId) activeLadderSubmitCapture = null;
  }

  function readLadderSubmitResponseDiagnosticHeaders(response) {
    return {
      httpStatus: response.status,
      contentType: response.headers.get('content-type') || '',
      retryAfter: response.headers.get('retry-after'),
      orderCount10s: response.headers.get('x-mbx-order-count-10s'),
      orderCount1m: response.headers.get('x-mbx-order-count-1m'),
      usedWeight1m: response.headers.get('x-mbx-used-weight-1m'),
    };
  }

  async function observeLadderSubmitResponse(response, capture, requestUrl) {
    const responseHeaders = readLadderSubmitResponseDiagnosticHeaders(response);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      capture.responseDiagnostics.push({
        ...responseHeaders,
        bodyKind: 'non_json',
        payloadSummary: null,
        errorName: null,
      });
      return;
    }
    let payload;
    try {
      payload = await response.clone().json();
    } catch (error) {
      capture.responseDiagnostics.push({
        ...responseHeaders,
        bodyKind: 'invalid_json',
        payloadSummary: null,
        errorName: error?.name || 'Error',
      });
      return;
    }
    const payloadSummary = summarizeBinancePlaceOrderPayload(payload);
    capture.responseDiagnostics.push({
      ...responseHeaders,
      bodyKind: 'json',
      payloadSummary,
      errorName: null,
    });
    const code = getBinanceApiErrorCode(payload);
    if (code != null) {
      capture.apiErrors.push({
        requestUrl,
        code,
        message: payloadSummary.message,
        success: payloadSummary.success,
      });
      return;
    }
    if (response.ok && isBinancePlaceOrderSuccessPayload(payload)) {
      capture.apiSuccesses.push({ requestUrl });
    }
  }

  function trackLadderSubmitResponse(request, capture, requestUrl) {
    const observation = request
      .then(
        (response) => observeLadderSubmitResponse(response, capture, requestUrl),
        (error) => {
          capture.responseDiagnostics.push({
            httpStatus: null,
            contentType: '',
            retryAfter: null,
            orderCount10s: null,
            orderCount1m: null,
            usedWeight1m: null,
            bodyKind: 'network_error',
            payloadSummary: null,
            errorName: error?.name || 'Error',
          });
        },
      )
      .catch((error) => {
        capture.responseDiagnostics.push({
          httpStatus: null,
          contentType: '',
          retryAfter: null,
          orderCount10s: null,
          orderCount1m: null,
          usedWeight1m: null,
          bodyKind: 'observation_error',
          payloadSummary: null,
          errorName: error?.name || 'Error',
        });
      });
    capture.responseObservations.push(observation);
    capture.resolveRequestStarted();
  }

  function cacheBncHeaders(snapshot) {
    const becameReady = !cachedBncHeaders;
    cachedBncHeaders = snapshot;
    if (!becameReady) return;
    resolveBncHeadersReady();
    resolveBncHeadersReady = null;
    queueMicrotask(() => {
      if (isFuturesTradingPage() && getActiveTradeMode() === 'OPEN') {
        queueAutoOpenLeveragePositionCheck('headers_ready');
      }
    });
  }

  async function waitForLadderSubmitResponseObservations(
    captureId,
    timeoutMs,
    abortSignal = null,
  ) {
    const capture = activeLadderSubmitCapture?.captureId === captureId
      ? activeLadderSubmitCapture
      : null;
    if (!capture) throw new Error('下单结果跟踪状态异常，已停止');
    const observations = capture.responseObservations.slice();
    let settled = observations.length === 0;
    if (observations.length > 0) {
      const allObservations = Promise.all(observations).then(() => {
        settled = true;
      });
      await waitForPromiseOrAbort(
        Promise.race([
          allObservations,
          delay(timeoutMs),
        ]),
        abortSignal,
      );
    }
    return {
      settled,
      apiErrors: capture.apiErrors.slice(),
      diagnostics: capture.responseDiagnostics.slice(),
    };
  }

  function readLadderSubmitApiErrors(captureId) {
    const capture = activeLadderSubmitCapture?.captureId === captureId
      ? activeLadderSubmitCapture
      : null;
    if (!capture) throw new Error('下单结果跟踪状态异常，已停止');
    return capture.apiErrors.slice();
  }

  function readLadderSubmitApiSuccesses(captureId) {
    const capture = activeLadderSubmitCapture?.captureId === captureId
      ? activeLadderSubmitCapture
      : null;
    if (!capture) throw new Error('下单结果跟踪状态异常，已停止');
    return capture.apiSuccesses.slice();
  }

  (function installFetchInterceptor() {
    const originalFetch = window.fetch;
    window.fetch = function (...args) {
      try {
        const snapshot = extractHeadersFromFetchArgs(args);
        if (snapshot) cacheBncHeaders(snapshot);
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
      throw new Error('币安请求头尚未就绪');
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
      if (!resp.ok) throw new Error(`杠杆调整接口异常：HTTP ${resp.status}`);
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

  function getLatestTradePrices() {
    return Array.from(document.querySelectorAll('.tradew-tradelist .price.emit-price'))
      .filter((node) => isVisibleElement(node))
      .map((node) => parsePrice(node))
      .filter(Boolean);
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
    if (!Array.isArray(samples)) {
      throw new Error('最新成交价样本状态异常');
    }
    const normalizedSamples = samples
      .map((sample) => normalizeDecimalString(sample))
      .filter((sample) => sample && isPositiveDecimalString(sample));
    localStorage.setItem(key, JSON.stringify(normalizedSamples));
    return normalizedSamples;
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

  function renderOrderbookPrecisionShortcut(value, current, recommendation, disabled) {
    const selected = value === current;
    const recommended = value === recommendation;
    const disabledAttrs = disabled ? ' disabled aria-disabled="true"' : '';
    const title = disabled
      ? ui(localizedText('价格精度暂不可调整', 'Precision is temporarily unavailable'))
      : selected && recommended
        ? ui(localizedText(`当前且推荐的价格精度 ${value}`, `Current and recommended precision: ${value}`))
        : selected
        ? ui(localizedText(`当前价格精度 ${value}`, `Current precision: ${value}`))
        : recommended
          ? ui(localizedText(`推荐价格精度 ${value}`, `Recommended precision: ${value}`))
          : ui(localizedText(`切换到价格精度 ${value}`, `Switch to precision ${value}`));
    const activeStyle = selected
      ? `border-color:var(--color-PrimaryYellow);background:var(--color-BadgeBg);color:${PRIMARY_EMPHASIS_COLOR};font-weight:${PRIMARY_EMPHASIS_FONT_WEIGHT};`
      : NEUTRAL_CONTROL_STYLE;
    const recommendationMarker = recommended
      ? '<span aria-hidden="true" style="position:absolute;top:3px;right:3px;width:6px;height:6px;border-radius:50%;background:var(--color-PrimaryYellow);box-shadow:0 0 0 1px #fff;"></span>'
      : '';
    const ariaLabel = ui(localizedText(
      `切换价格精度到 ${value}${recommended ? '，推荐档位' : ''}`,
      `Switch precision to ${value}${recommended ? ', recommended' : ''}`,
    ));
    return `<button type="button" data-orderbook-precision-value="${value}"${disabledAttrs} aria-pressed="${selected}" aria-label="${ariaLabel}" title="${title}" style="position:relative;box-sizing:border-box;width:100%;min-width:0;height:32px;padding:0;border-radius:6px;border:1px solid ${CONTROL_BORDER_COLOR};font-size:12px;line-height:30px;white-space:nowrap;overflow:hidden;cursor:pointer;${activeStyle}">${recommendationMarker}${formatOrderbookPrecisionShortcutLabel(value)}</button>`;
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

  function renderOrderbookPrecisionRefreshButton(symbol, disabled) {
    const feedbackState = orderbookPrecisionRefreshFeedback.symbol === symbol
      ? orderbookPrecisionRefreshFeedback.state
      : 'idle';
    const feedback = feedbackState === 'success'
      ? {
          label: PANEL_COPY.status.precisionUpdated,
          color: 'var(--color-Buy)',
          icon: '<svg viewBox="0 0 24 24" aria-hidden="true" style="width:17px;height:17px;fill:currentColor;"><path d="m9.55 16.6-4.25-4.25 1.4-1.4 2.85 2.85 7.75-7.75 1.4 1.4Z"></path></svg>',
        }
      : feedbackState === 'retry'
        ? {
            label: PANEL_COPY.status.precisionInsufficient,
            color: 'var(--color-PrimaryYellow)',
            icon: '<svg viewBox="0 0 24 24" aria-hidden="true" style="width:17px;height:17px;fill:currentColor;"><path d="M11 6h2v8h-2V6Zm0 10h2v2h-2v-2Z"></path></svg>',
          }
        : {
            label: formatPrecisionRefreshTooltip(ORDERBOOK_PRECISION_INITIAL_TRADE_LIMIT),
            color: CONTROL_TEXT_COLOR,
            icon: '<svg viewBox="0 0 24 24" aria-hidden="true" style="width:16px;height:16px;fill:currentColor;"><path d="M19.5 7.2A8 8 0 1 0 20 15h-2.25a6 6 0 1 1-.1-5.8L15 12h7V5l-2.5 2.2Z"></path></svg>',
          };
    const disabledAttrs = disabled ? ' disabled aria-disabled="true"' : '';
    const feedbackLabel = ui(feedback.label);
    return `<button type="button" data-orderbook-precision-refresh="true" data-orderbook-precision-refresh-state="${feedbackState}"${disabledAttrs} title="${feedbackLabel}" aria-label="${feedbackLabel}" aria-live="polite" style="width:32px;height:32px;padding:0;border-radius:6px;border:1px solid ${CONTROL_BORDER_COLOR};display:flex;align-items:center;justify-content:center;${NEUTRAL_CONTROL_STYLE}color:${feedback.color};">${feedback.icon}</button>`;
  }

  function showOrderbookPrecisionRefreshFeedback(symbol, state) {
    if (!['success', 'retry'].includes(state)) {
      throw new Error(`价格精度刷新反馈状态异常：${state}`);
    }
    if (orderbookPrecisionRefreshFeedbackTimer !== null) {
      window.clearTimeout(orderbookPrecisionRefreshFeedbackTimer);
    }
    orderbookPrecisionRefreshFeedback = { symbol, state };
    refreshOrderbookPrecisionRecommendation();
    orderbookPrecisionRefreshFeedbackTimer = window.setTimeout(() => {
      orderbookPrecisionRefreshFeedbackTimer = null;
      if (
        orderbookPrecisionRefreshFeedback.symbol !== symbol
        || orderbookPrecisionRefreshFeedback.state !== state
      ) return;
      orderbookPrecisionRefreshFeedback = { symbol, state: 'idle' };
      refreshOrderbookPrecisionRecommendation();
    }, ORDERBOOK_PRECISION_REFRESH_FEEDBACK_MS);
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
    const status = recommendation
      ? 'ready'
      : existingStatus && existingStatus !== 'ready'
        ? existingStatus
        : PANEL_COPY.status.precisionInsufficient;
    orderbookPrecisionState = {
      ...orderbookPrecisionState,
      symbol,
      samples,
      recommendation,
      current,
      status,
    };

    const selectionBusy = Boolean(orderbookPrecisionSelectionTask);
    const controlsBusy = selectionBusy;
    const nativeOptions = orderbookPrecisionState.symbol === symbol
      ? orderbookPrecisionState.nativeOptions
      : [];
    const shortcutOptions = getOrderbookPrecisionShortcutOptions(
      nativeOptions,
      ORDERBOOK_PRECISION_SHORTCUT_LIMIT
    );
    if (!nativeOptions.length) queueOrderbookPrecisionOptionsLoad(symbol);
    const canRefresh = !controlsBusy;
    const recommendationHtml = [
      '<div style="margin-top:10px;">',
      `<div style="display:grid;grid-template-columns:${activeUiLocale === 'en' ? '52px' : '36px'} repeat(4,minmax(0,1fr)) 32px;align-items:center;gap:4px;height:32px;overflow:hidden;">`,
      `<span title="${ui(PANEL_COPY.tooltip.pricePrecision)}" style="color:${MUTED_TEXT_COLOR};font-size:13px;white-space:nowrap;cursor:help;">${ui(PANEL_COPY.field.pricePrecision)}</span>`,
      ...renderOrderbookPrecisionShortcutSlots(shortcutOptions, current, recommendation, controlsBusy),
      renderOrderbookPrecisionRefreshButton(symbol, !canRefresh),
      '</div>',
      '</div>',
    ].join('');
    if (el.innerHTML !== recommendationHtml) {
      el.innerHTML = recommendationHtml;
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
      if (!closed) return { status: '无法关闭价格精度下拉' };
      if (snapshot) return snapshot;
      if (Date.now() >= deadline) break;
      await delay(ORDERBOOK_PRECISION_READY_POLL_MS);
    }
    if (!isCurrentObservedSymbol(symbol)) return null;
    return {
      status: lastPrecision
        ? `未找到当前价格精度 ${lastPrecision} 的选项`
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
      orderbookPrecisionState = { ...orderbookPrecisionState, status: '未找到价格精度下拉' };
      scheduleRenderPanel();
      return false;
    }
    const startPrecision = trigger.value;
    if (targetPrecision === startPrecision) return true;
    const options = await ensureVisibleOrderbookPrecisionOptions(trigger.element);
    if (!isCurrentObservedSymbol(symbol) || readCurrentOrderbookPrecisionValue() !== startPrecision) return false;
    const values = readVisibleOrderbookPrecisionOptionValues(trigger.element);
    if (!options.length || !values.includes(startPrecision)) {
      orderbookPrecisionState = { ...orderbookPrecisionState, status: '读取价格精度选项失败' };
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
      orderbookPrecisionState = { ...orderbookPrecisionState, status: `未找到快捷精度 ${targetPrecision}` };
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
        orderbookPrecisionState = { ...orderbookPrecisionState, status: `价格精度未切换到 ${targetPrecision}` };
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
      throw new Error(`无效的价格精度快捷值: ${value}`);
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
            nativeOptionsStatus: '读取价格精度选项失败',
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

  function refreshOrderbookPrecisionSamplesNow() {
    const symbol = getCurrentSymbol();
    if (!symbol || !isCurrentObservedSymbol(symbol)) {
      orderbookPrecisionState = {
        ...orderbookPrecisionState,
        symbol,
        status: '未识别当前交易对',
      };
      scheduleRenderPanel();
      return;
    }
    const {
      samples: latestSamples,
      recommendation,
    } = recommendOrderbookPrecisionWithExpandingWindow({
      prices: getLatestTradePrices(),
      options: ORDERBOOK_PRECISION_CANDIDATE_OPTIONS,
      initialLimit: ORDERBOOK_PRECISION_INITIAL_TRADE_LIMIT,
      expansionStep: ORDERBOOK_PRECISION_TRADE_EXPANSION_STEP,
      minSamples: ORDERBOOK_PRECISION_MIN_EFFECTIVE_MOVES,
    });
    const samples = saveStoredOrderbookPrecisionSamples(symbol, latestSamples);
    orderbookPrecisionState = {
      ...orderbookPrecisionState,
      symbol,
      samples,
      recommendation,
      current: readCurrentOrderbookPrecisionValue(),
      status: recommendation ? 'ready' : PANEL_COPY.status.precisionInsufficient,
    };
    if (!orderbookPrecisionState.nativeOptions.length) {
      queueOrderbookPrecisionOptionsLoad(symbol, true);
    }
    refreshOrderbookPrecisionRecommendation();
    showOrderbookPrecisionRefreshFeedback(symbol, recommendation ? 'success' : 'retry');
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
    const statusLabels = {
      OPEN_LONG: PANEL_COPY.action.openLong,
      OPEN_SHORT: PANEL_COPY.action.openShort,
      CLOSE_LONG: PANEL_COPY.action.closeLong,
      CLOSE_SHORT: PANEL_COPY.action.closeShort,
    };
    return {
      ...spec,
      statusLabel: statusLabels[actionType],
      buttonGetter: buttonGetters[actionType],
    };
  }

  function localizedActionStatus(label, zhCN, en) {
    return localizedText(
      `${formatLocalizedText(label, 'zh-CN')}${zhCN}`,
      `${formatLocalizedText(label, 'en')}${en}`,
    );
  }

  function localizedContinuousAction(label) {
    return localizedText(
      `连续${formatLocalizedText(label, 'zh-CN')}`,
      `Continuous ${formatLocalizedText(label, 'en')}`,
    );
  }

  function findTradeModeTabByMode(mode) {
    const tabs = document.querySelectorAll(
      '#position-direction [role="tab"], .bn-tabs__buySell [role="tab"], [role="tab"].bn-tab__buySell'
    );
    return Array.from(tabs).find((tab) => parseTradeModeLabel(tab.textContent) === mode) || null;
  }

  function findPostOnlyOrderTab() {
    return findVisibleTradeScopeElement('[role="tab"]', (tab) => {
      const text = (tab.textContent || '').trim();
      const key = String(tab.getAttribute('data-tab-key') || '').toUpperCase();
      return key === BINANCE_POST_ONLY_ORDER_TYPE
        && includesBinancePageText(text, BINANCE_PAGE_TEXT.postOnly);
    });
  }

  async function activateTradeMode(mode) {
    if (getActiveTradeMode() === mode) return true;
    const tab = findTradeModeTabByMode(mode);
    if (!tab) return false;
    const mutationRoot = getTradeMutationRoot();
    tab.click();
    const activeMode = await waitForTradeFormMutationState(
      mutationRoot,
      () => (getActiveTradeMode() === mode ? mode : null),
      TRADE_UI_STATE_TIMEOUT_MS,
    );
    invalidateTradeButtonCache();
    scheduleRenderPanel();
    return activeMode === mode;
  }

  async function ensurePostOnlyOrderType() {
    if (isPostOnlyOrderTypeActive()) return true;

    const tab = findPostOnlyOrderTab();
    if (!tab) return false;
    const mutationRoot = getTradeMutationRoot();
    tab.click();
    const active = await waitForTradeFormMutationState(
      mutationRoot,
      () => (isPostOnlyOrderTypeActive() ? true : null),
      TRADE_UI_STATE_TIMEOUT_MS,
    );
    return active === true;
  }

  async function readOpenBaseQtyForLadder(spec, referencePrice) {
    const priceInput = findPriceInput();
    if (!priceInput || !referencePrice) return null;
    setInputValueReact(priceInput, referencePrice);
    const readQuantity = () => {
      const openLongBtn = findOpenLongButton();
      const openShortBtn = findOpenShortButton();
      const { longQty, shortQty, qtySource } = readOpenableQty(openLongBtn, openShortBtn);
      const qty = spec.side === 'LONG' ? longQty : shortQty;
      return { qty, qtySource };
    };
    const classifyUnavailableQuantity = (quantity) => ({
      ...quantity,
      confirmedZeroOpenBalance: isConfirmedZeroOpenBalance(quantity.qty),
    });
    const mutationRoot = getTradeMutationRoot();
    const ready = await waitForTradeFormMutationState(
      mutationRoot,
      () => {
        const quantity = readQuantity();
        const { qty } = quantity;
        if (qty != null && isPositiveDecimalString(String(qty))) {
          return { ...quantity, confirmedZeroOpenBalance: false };
        }
        const classified = classifyUnavailableQuantity(quantity);
        return classified.confirmedZeroOpenBalance ? classified : null;
      },
      LADDER_OPEN_QTY_READY_TIMEOUT_MS,
    );

    return ready || classifyUnavailableQuantity(readQuantity());
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

  function createClosePositionCompletedError() {
    const error = new Error('当前方向已无持仓');
    error.name = 'ClosePositionCompletedError';
    return error;
  }

  function isClosePositionCompletedError(error) {
    return error?.name === 'ClosePositionCompletedError';
  }

  async function throwIfClosePositionCompleted(context, abortSignal = null) {
    if (context?.spec?.mode !== 'CLOSE') return;
    throwIfAborted(abortSignal);
    if (!isCurrentObservedSymbol(context.symbol)) {
      throw new Error('确认平仓结果时交易对已变化');
    }
    if (getActiveTradeMode() !== 'CLOSE') {
      throw new Error('确认平仓结果时下单模式已变化');
    }
    if (!await waitForBncHeaders(context.symbol)) {
      throw new Error('确认平仓结果时币安请求头尚未就绪');
    }
    const state = await fetchCurrentSymbolPositionSideState(
      context.symbol,
      context.spec.side,
    );
    throwIfAborted(abortSignal);
    if (!isCurrentObservedSymbol(context.symbol)) {
      throw new Error('确认平仓结果时交易对已变化');
    }
    if (getActiveTradeMode() !== 'CLOSE') {
      throw new Error('确认平仓结果时下单模式已变化');
    }
    if (state.status === 'flat') throw createClosePositionCompletedError();
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

    const modeLabel = spec.mode === 'OPEN' ? '开仓' : '平仓';
    const modeReady = await activateTradeMode(spec.mode);
    if (getCurrentSymbol() !== startSymbol) {
      throw new Error(`切换至${modeLabel}时交易对已变化，已停止`);
    }
    if (!modeReady) {
      throw createContinuousRecoverableLadderError(
        'controls_not_ready',
        `未能切换至${modeLabel}`,
      );
    }
    const startPrecision = readCurrentOrderbookPrecisionValue();
    if (!startPrecision) {
      throw createContinuousRecoverableLadderError(
        'market_data_not_ready',
        '未识别价格精度',
      );
    }
    if (expectedContext?.precision && startPrecision !== expectedContext.precision) {
      throw createContinuousRecoverableLadderError(
        'precision_changed',
        '重挂前价格精度已变化，已停止',
      );
    }

    const postOnlyReady = await ensurePostOnlyOrderType();
    if (!postOnlyReady) {
      throw createContinuousRecoverableLadderError(
        'controls_not_ready',
        '只做 Maker 未生效，请刷新页面后重试',
      );
    }

    const optionContext = readLadderOptionContext(spec, startSymbol, startPrecision);
    const levels = optionContext.levels;
    const ladderStep = optionContext.ladderStep;
    const prices = getBufferedMakerPrices(spec.priceSide, levels, ladderStep);
    if (prices.length < levels) {
      throw createContinuousRecoverableLadderError(
        'market_data_not_ready',
        `订单簿${spec.priceSide === 'BID' ? '买盘' : '卖盘'}不足 ${levels} 档，档幅 ${ladderStep}`,
      );
    }

    const rules = await ensureRules(startSymbol);
    if (getCurrentSymbol() !== startSymbol) {
      throw new Error('读取交易规则时交易对已变化，已停止');
    }
    if (readCurrentOrderbookPrecisionValue() !== startPrecision) {
      throw createContinuousRecoverableLadderError(
        'precision_changed',
        '读取交易规则时价格精度已变化，已停止',
      );
    }
    if (!rules) {
      throw createContinuousRecoverableLadderError(
        'market_data_not_ready',
        '交易规则尚未就绪，请稍后重试',
      );
    }

    const ruleContext = getQtyRuleContext(startSymbol, spec.mode, prices[0]);
    if (ruleContext.status !== 'ready' || !ruleContext.stepSize || !ruleContext.baseMinQty) {
      throw createContinuousRecoverableLadderError(
        'market_data_not_ready',
        '下单数量规则尚未就绪，请稍后重试',
      );
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
    const quantityLabel = spec.mode === 'OPEN' ? '可开数量' : '可平数量';
    if (getCurrentSymbol() !== startSymbol) {
      throw new Error(`读取${quantityLabel}时交易对已变化，已停止`);
    }
    if (getActiveTradeMode() !== spec.mode) {
      throw new Error(`读取${quantityLabel}时下单模式已变化，已停止`);
    }
    if (readCurrentOrderbookPrecisionValue() !== startPrecision) {
      throw createContinuousRecoverableLadderError(
        'precision_changed',
        `读取${quantityLabel}时价格精度已变化，已停止`,
      );
    }
    if (!isPostOnlyOrderTypeActive()) {
      throw new Error(`读取${quantityLabel}时只做 Maker 已失效，请刷新页面后重试`);
    }
    if (!areLadderOptionContextsEqual(
      readLadderOptionContext(spec, startSymbol, startPrecision),
      optionContext,
    )) {
      throw createContinuousRecoverableLadderError(
        'options_changed',
        '读取下单数量时比例、笔数或间距已变化',
      );
    }
    const baseQty = normalizeDecimalString(base?.qty ?? '');
    let unavailableQuantityMessage = getUnavailableLadderQuantityMessage(
      spec.mode,
      baseQty,
      base?.confirmedZeroOpenBalance === true,
    );
    if (unavailableQuantityMessage) {
      if (!baseQty) {
        throw createContinuousRecoverableLadderError(
          'market_data_not_ready',
          unavailableQuantityMessage,
        );
      }
      if (spec.mode === 'CLOSE') {
        await throwIfClosePositionCompleted({ spec, symbol: startSymbol });
        unavailableQuantityMessage = '当前方向暂无可平数量';
      }
      throw new Error(unavailableQuantityMessage);
    }

    let percent = optionContext.percent;
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
          optionContext,
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
      optionContext,
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

  function createLadderMinimumQtyFailure(options) {
    const {
      spec,
      symbol,
      precision,
      mode,
      minRequiredQty,
      percent,
      levels,
      optionContext,
      minimumPercent,
      maxAutoFitPercent,
      replacementTotalQty,
    } = options;
    const percentLabel = mode === 'OPEN' ? '开仓比例' : '平仓比例';
    const actionLabel = mode === 'OPEN' ? '开仓' : '平仓';
    const percentHint = minimumPercent ? `，需 >= ${minimumPercent}%` : '';
    const error = new Error(`数量低于最小下单量 ${minRequiredQty}${percentHint}`);
    error.localizedText = localizedText(
      error.message,
      `Quantity is below the minimum order quantity ${minRequiredQty}${minimumPercent ? `; requires at least ${minimumPercent}%` : ''}`,
    );
    const minimumText = minimumPercent
      ? `至少需要${percentLabel} ${minimumPercent}% 才能保持当前档位。`
      : '';
    const maxText = maxAutoFitPercent ? `自动上限 ${maxAutoFitPercent}%。` : '';
    const levelsText = levels ? `当前档位 ${levels} 档。` : '';
    const replacementText = mode === 'OPEN'
      ? '脚本只会尝试替换当前交易对的同向开仓基础单，不会自动全撤。'
      : '脚本不会自动撤单。';
    error.statusTitle = `当前${percentLabel} ${percent}%，目标数量小于最小下单量 ${minRequiredQty}，无法阶梯${actionLabel}；${levelsText}${minimumText}${maxText}已尝试自动提高比例和自动降档；${replacementText}`;
    error.localizedStatusTitle = localizedText(
      error.statusTitle,
      `Current ${mode === 'OPEN' ? 'open' : 'close'} ratio is ${percent}%. The target quantity is below the minimum order quantity ${minRequiredQty}, so the ladder cannot ${mode === 'OPEN' ? 'open' : 'close'}. ${levels ? `Current plan: ${levels} orders. ` : ''}${minimumPercent ? `At least ${minimumPercent}% is required to keep the current order count. ` : ''}${maxAutoFitPercent ? `Automatic limit: ${maxAutoFitPercent}%. ` : ''}The script tried increasing the ratio and reducing the order count. ${mode === 'OPEN' ? 'Only same-symbol, same-direction Basic open orders may be replaced; Cancel All is never automatic.' : 'Orders are not cancelled automatically.'}`,
    );
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
        optionContext,
        totalQty: replacementTotalQty,
      };
    }
    return error;
  }

  function assertLadderMakerPrice(plan, price) {
    const oppositeSide = plan.spec.orderSide === 'BUY' ? 'ASK' : 'BID';
    const oppositePrice = getBestOrderbookPrice(oppositeSide);
    if (!oppositePrice) {
      throw createContinuousRecoverableLadderError(
        'market_data_not_ready',
        '盘口已刷新，未读取到对手盘价格',
      );
    }

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

  function isRecoverableMaxOpenOrdersFailure(plan, error, allowRecovery) {
    return (
      allowRecovery === true
      && plan?.spec?.mode === 'CLOSE'
      && error?.ladderFailureKind === 'max_open_orders'
      && isBinanceMaxOpenOrdersErrorCode(error.binanceCode)
      && error.safeNoSubmit === true
    );
  }

  function createLadderSubmitApiError(apiErrorCode) {
    const error = new Error(`Maker 挂单被拒绝（错误码 ${apiErrorCode}）`);
    error.binanceCode = apiErrorCode;
    error.safeNoSubmit = true;
    return error;
  }

  function createLadderMaxOpenOrdersError(apiError) {
    if (apiError.success !== false) throw new Error('最大挂单限制响应缺少 success=false');
    const error = new Error(`${apiError.message || '达到最大下单限制'}（错误码 ${apiError.code}）`);
    error.binanceCode = apiError.code;
    error.ladderFailureKind = 'max_open_orders';
    error.safeNoSubmit = true;
    return error;
  }

  function formatLadderRepriceDiagnostics(repriceAttempts, lastRepriceApiErrorCode) {
    if (repriceAttempts <= 0) return '';
    const zhCode = lastRepriceApiErrorCode == null ? '' : `，错误码 ${lastRepriceApiErrorCode}`;
    const enCode = lastRepriceApiErrorCode == null ? '' : `, error code ${lastRepriceApiErrorCode}`;
    return localizedText(
      `（刷新盘口 ${repriceAttempts} 次${zhCode}）`,
      ` (Order book refreshed ${repriceAttempts} times${enCode})`,
    );
  }

  function refreshRemainingLadderOrders(plan, completedCount) {
    assertLadderExecutionContext(plan);
    const remainingCount = plan.orders.length - completedCount;
    if (remainingCount <= 0) throw new Error('没有待重定价的阶梯订单');
    const prices = getBufferedMakerPrices(plan.spec.priceSide, remainingCount, plan.ladderStep);
    if (prices.length !== remainingCount) {
      throw createContinuousRecoverableLadderError(
        'market_data_not_ready',
        `刷新后订单簿${plan.spec.priceSide === 'BID' ? '买盘' : '卖盘'}不足 ${remainingCount} 档`,
      );
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
          throw createContinuousRecoverableLadderError(
            'market_data_not_ready',
            '刷新盘口后最小下单量未就绪',
          );
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
    if (!isCurrentObservedSymbol(plan.symbol)) throw new Error('执行中交易对已变化，已停止');
    if (getActiveTradeMode() !== plan.spec.mode) throw new Error('执行中下单模式已变化，已停止');
    if (readCurrentOrderbookPrecisionValue() !== plan.precision) {
      throw createContinuousRecoverableLadderError(
        'precision_changed',
        '执行中价格精度已变化，已停止',
      );
    }
    if (hasLadderOptionContextChanged(plan)) {
      throw createContinuousRecoverableLadderError(
        'options_changed',
        '执行中比例、笔数或间距已变化',
      );
    }
    if (!isPostOnlyOrderTypeActive()) throw new Error('执行中只做 Maker 已失效，请刷新页面后重试');
  }

  function assertSubmittedPriceMatchesExpectedPrice(expectedPrice, submittedPrice, expectedLabel = '点击价') {
    const expected = normalizeDecimalString(expectedPrice);
    const submitted = normalizeDecimalString(submittedPrice);
    const cmp = compareDecimalStrings(expected, submitted);
    if (cmp !== 0) {
      throw createContinuousRecoverableLadderError(
        'input_unstable',
        `价格框未同步，${expectedLabel} ${expected || expectedPrice}，当前提交价 ${submitted || submittedPrice || '-'}`,
      );
    }
  }

  function assertSubmittedQtyMatchesExpectedQty(expectedQty, submittedQty, expectedLabel = '目标量') {
    const expected = normalizeDecimalString(expectedQty);
    const submitted = normalizeDecimalString(submittedQty);
    const cmp = compareDecimalStrings(expected, submitted);
    if (cmp !== 0) {
      throw createContinuousRecoverableLadderError(
        'input_unstable',
        `数量框未同步，${expectedLabel} ${expected || expectedQty}，当前提交量 ${submitted || submittedQty || '-'}`,
      );
    }
  }

  async function syncTradeInputs(expectedPrice, expectedQty, options = null) {
    const priceLabel = options?.priceLabel || '点击价';
    const qtyLabel = options?.qtyLabel || '目标量';
    const settleControlledForm = options?.settleControlledForm === true;
    const syncTimeoutMs = settleControlledForm
      ? LADDER_INPUT_SETTLE_TIMEOUT_MS
      : TRADE_INPUT_SYNC_TIMEOUT_MS;
    const stableDurationMs = settleControlledForm
      ? LADDER_INPUT_SETTLE_STABLE_MS
      : 0;
    const maxWriteAttempts = settleControlledForm
      ? LADDER_INPUT_SETTLE_MAX_WRITES
      : 2;
    const previousSubmittedInputs = settleControlledForm
      ? options?.previousSubmittedInputs || null
      : null;
    const isRecoveryWriteAllowed = settleControlledForm
      ? ({
        field,
        preWriteValue,
        rollbackValue,
        submittedValue,
      }) => {
        if (field !== 'qty' && field !== 'price') {
          throw new Error('未知交易输入字段');
        }
        return isScriptOwnedTradeInputRecoveryState({
          preWriteValue,
          rollbackValue,
          submittedValue,
          previousSubmittedValue: field === 'qty'
            ? previousSubmittedInputs?.submittedQty
            : previousSubmittedInputs?.submittedPrice,
          compareValues: compareDecimalStrings,
        });
      }
      : ({ rollbackValue, submittedValue }) => rollbackValue === submittedValue;
    const writeTradeInputValue = settleControlledForm
      ? createBoundedInputWriter({
        writeValue: setInputValueReact,
        maxWriteAttempts,
      })
      : setInputValueReact;
    const inputs = findTradeInputs();
    if (!inputs) {
      throw createContinuousRecoverableLadderError(
        'controls_not_ready',
        '未能确定唯一的当前交易表单输入框',
      );
    }

    const observationRoot = inputs.root;
    const readTradeState = createTradeInputStateReader({
      resolveInputs: findTradeInputs,
      expectedPrice,
      expectedQty,
      includePrice: true,
      normalizeValue: normalizeDecimalString,
      compareValues: compareDecimalStrings,
      writeValue: writeTradeInputValue,
      requiredStableMismatchFrames: TRADE_INPUT_SYNC_STABLE_FRAMES,
      requiredStableMismatchMs: stableDurationMs,
      requiredStableMatchFrames: settleControlledForm
        ? TRADE_INPUT_SYNC_STABLE_FRAMES
        : 1,
      requiredStableMatchMs: stableDurationMs,
      maxWriteAttempts,
      recoverProvisionalMatchRollback: settleControlledForm,
      isRecoveryWriteAllowed,
      readNowMs: () => performance.now(),
    });
    readTradeState();
    const synchronized = await waitForTradeFormFrameState(
      observationRoot,
      readTradeState,
      syncTimeoutMs,
      TRADE_INPUT_SYNC_STABLE_FRAMES,
    );
    if (synchronized) return synchronized;

    assertSubmittedPriceMatchesExpectedPrice(
      expectedPrice,
      findPriceInput()?.value || '',
      priceLabel,
    );
    assertSubmittedQtyMatchesExpectedQty(expectedQty, findQtyInput()?.value || '', qtyLabel);
    throw createContinuousRecoverableLadderError(
      'input_unstable',
      '价格框或数量框未稳定',
    );
  }

  function isSubmitButtonBusy(button) {
    if (!button) return false;
    const text = (button.textContent || '').toLowerCase();
    const cls = String(button.className || '').toLowerCase();
    return (
      button.disabled ||
      button.getAttribute('aria-disabled') === 'true' ||
      button.getAttribute('aria-busy') === 'true' ||
      button.getAttribute('data-loading') === 'true' ||
      includesBinancePageText(text, BINANCE_PAGE_TEXT.submitBusy) ||
      cls.includes('loading') ||
      !!button.querySelector('[class*="loading"], [class*="spinner"], [aria-busy="true"]')
    );
  }

  async function waitForReadyLadderSubmitButton(plan) {
    const resolveReadyButton = () => {
      const candidate = plan.spec.buttonGetter();
      return candidate && !isSubmitButtonBusy(candidate) ? candidate : null;
    };
    const button = await waitForTradeActionButtonFrameState(
      document,
      resolveReadyButton,
      isVisibleElement,
      TRADE_ACTION_BUTTON_READY_TIMEOUT_MS,
    );
    if (button) return button;

    const currentButton = plan.spec.buttonGetter();
    if (!currentButton || !currentButton.isConnected || !isVisibleElement(currentButton)) {
      throw createContinuousRecoverableLadderError(
        'controls_not_ready',
        `下单按钮 ${TRADE_ACTION_BUTTON_READY_TIMEOUT_SECONDS} 秒内未渲染完成`,
      );
    }
    if (isSubmitButtonBusy(currentButton)) {
      throw createContinuousRecoverableLadderError(
        'controls_not_ready',
        `下单按钮 ${TRADE_ACTION_BUTTON_READY_TIMEOUT_SECONDS} 秒内未恢复可点击`,
      );
    }
    throw createContinuousRecoverableLadderError(
      'controls_not_ready',
      `下单按钮 ${TRADE_ACTION_BUTTON_READY_TIMEOUT_SECONDS} 秒内未达到可点击状态`,
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

  function waitForOrderSubmitStartOrFailureFeedback(
    submitCaptureId,
    previousFeedbackSnapshot,
    timeoutMs,
  ) {
    const capture = activeLadderSubmitCapture?.captureId === submitCaptureId
      ? activeLadderSubmitCapture
      : null;
    if (!capture) throw new Error('下单结果跟踪状态异常，已停止');

    return new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        window.clearTimeout(timer);
        resolve(result);
      };
      const readFailure = () => {
        const feedback = readNewVisibleOrderFeedbackText(previousFeedbackSnapshot);
        if (!feedback) return null;
        const acknowledgement = evaluateOrderSubmitAcknowledgement({
          feedback,
          isNewFeedback: true,
        });
        return acknowledgement.status === 'failure'
          ? { status: 'failure', message: acknowledgement.message }
          : null;
      };
      const observer = new MutationObserver(() => {
        const failure = readFailure();
        if (failure) finish(failure);
      });
      const timer = window.setTimeout(() => finish({ status: 'timeout' }), timeoutMs);
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
      });
      capture.requestStarted.then(() => finish({ status: 'request_started' }));
      const failure = readFailure();
      if (failure) finish(failure);
    });
  }

  function waitForOrderFailureFeedback(previousFeedbackSnapshot, timeoutMs) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        window.clearTimeout(timer);
        resolve(result);
      };
      const readFailure = () => {
        const feedback = readNewVisibleOrderFeedbackText(previousFeedbackSnapshot);
        if (!feedback) return null;
        const acknowledgement = evaluateOrderSubmitAcknowledgement({
          feedback,
          isNewFeedback: true,
        });
        return acknowledgement.status === 'failure'
          ? { status: 'failure', message: acknowledgement.message }
          : null;
      };
      const observer = new MutationObserver(() => {
        const failure = readFailure();
        if (failure) finish(failure);
      });
      const timer = window.setTimeout(() => finish({ status: 'timeout' }), timeoutMs);
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
      });
      const failure = readFailure();
      if (failure) finish(failure);
    });
  }

  async function waitForOrderSubmitAcknowledgement(
    button,
    label,
    previousFeedbackSnapshot,
    submitCaptureId,
    mode,
    abortSignal = null,
  ) {
    const sawBusy = isSubmitButtonBusy(button);
    const activity = await waitForPromiseOrAbort(
      waitForOrderSubmitStartOrFailureFeedback(
        submitCaptureId,
        previousFeedbackSnapshot,
        LADDER_SUBMIT_START_TIMEOUT_MS,
      ),
      abortSignal,
    );
    const responseObservation = activity.status === 'request_started'
      ? await waitForLadderSubmitResponseObservations(
        submitCaptureId,
        LADDER_SUBMIT_RESPONSE_TIMEOUT_MS,
        abortSignal,
      )
      : { settled: false, apiErrors: [], diagnostics: [] };
    const capturedApiErrors = responseObservation.apiErrors;
    const capturedApiSuccesses = readLadderSubmitApiSuccesses(submitCaptureId);

    if (
      capturedApiErrors.length === 1
      && isBinancePostOnlyMakerRejectCode(capturedApiErrors[0].code)
    ) {
      throw createLadderSubmitApiError(capturedApiErrors[0].code);
    }
    if (
      capturedApiErrors.length === 1
      && isBinanceMaxOpenOrdersErrorCode(capturedApiErrors[0].code)
    ) {
      throw createLadderMaxOpenOrdersError(capturedApiErrors[0]);
    }
    let failureActivity = activity.status === 'failure' ? activity : null;
    if (!failureActivity && capturedApiErrors.length > 0) {
      failureActivity = await waitForOrderFailureFeedback(
        previousFeedbackSnapshot,
        LADDER_SUBMIT_START_TIMEOUT_MS,
      );
      if (failureActivity.status !== 'failure') failureActivity = null;
    }
    if (
      failureActivity
      && capturedApiErrors.length === 0
      && mode === 'CLOSE'
      && isPostOnlyMakerRejectionFeedback(failureActivity.message)
    ) {
      throw createLadderMakerPriceConflictError(failureActivity.message);
    }
    if (failureActivity) {
      const capturedCodes = [...new Set(capturedApiErrors.map(({ code }) => code))];
      const diagnostic = capturedCodes.length === 0
        ? '未捕获错误码'
        : `错误码 ${capturedCodes.join(', ')}`;
      throw new Error(`${failureActivity.message}（${diagnostic}）`);
    }
    if (capturedApiSuccesses.length === 1) return;

    const responseDiagnostic = responseObservation.diagnostics.length === 0
      ? ''
      : responseObservation.diagnostics
        .map(formatBinancePlaceOrderResponseDiagnostic)
        .join(' | ');
    const settleHint = responseObservation.settled
      ? `下单请求已返回，但结果未识别${responseDiagnostic ? `：${responseDiagnostic}` : ''}`
      : (sawBusy ? '下单按钮已恢复，但下单请求仍未返回' : '下单请求仍未返回');
    const englishSettleHint = responseObservation.settled
      ? `the request returned but its result was not recognized${responseDiagnostic ? `: ${responseDiagnostic}` : ''}`
      : (sawBusy
        ? 'the submit button recovered but the request has not returned'
        : 'the request has not returned');
    throw createContinuousUnconfirmedSubmitError(localizedText(
      `未确认${label}成功（${settleHint}）；请在当前委托和历史成交中核对`,
      `Order submission was not confirmed (${englishSettleHint}); check Open Orders and Trade History`,
    ));
  }

  async function executeLadderPlan(
    plan,
    progress,
    setExecutionStatus,
    abortSignal = null,
    options = null,
  ) {
    const priceInput = findPriceInput();
    const qtyInput = findQtyInput();
    if (!priceInput) {
      throw createContinuousRecoverableLadderError('controls_not_ready', '未找到价格输入框');
    }
    if (!qtyInput) {
      throw createContinuousRecoverableLadderError('controls_not_ready', '未找到数量输入框');
    }

    let done = 0;
    let repriceAttempts = 0;
    let consecutiveRepriceAttempts = 0;
    let lastRepriceApiErrorCode = null;
    let previousAcknowledgedInputs = null;
    let maxOpenOrdersRecoveryAttempts = 0;
    while (done < plan.orders.length) {
      throwIfAborted(abortSignal);
      if (ladderStopRequested) break;
      const order = plan.orders[done];
      try {
        assertLadderExecutionContext(plan);
        if (!(await ensurePostOnlyOrderType())) throw new Error('执行中只做 Maker 已失效，请刷新页面后重试');
        throwIfAborted(abortSignal);
        assertLadderExecutionContext(plan);
        assertLadderMakerPrice(plan, order.price);

        await waitForReadyLadderSubmitButton(plan);
        throwIfAborted(abortSignal);
        assertLadderExecutionContext(plan);
        assertLadderMakerPrice(plan, order.price);

        const currentPriceInput = findPriceInput();
        const currentQtyInput = findQtyInput();
        if (!currentPriceInput) {
          throw createContinuousRecoverableLadderError(
            'controls_not_ready',
            '执行中价格输入框已消失',
          );
        }
        if (!currentQtyInput) {
          throw createContinuousRecoverableLadderError(
            'controls_not_ready',
            '执行中数量输入框已消失',
          );
        }

        const synchronizedInputs = await syncTradeInputs(order.price, order.qty, {
          priceLabel: '计划价',
          qtyLabel: '计划量',
          settleControlledForm: true,
          previousSubmittedInputs: previousAcknowledgedInputs,
        });
        throwIfAborted(abortSignal);
        const submittedPrice = synchronizedInputs.submittedPrice;
        assertLadderExecutionContext(plan);
        assertLadderMakerPrice(plan, submittedPrice);

        const button = await waitForReadyLadderSubmitButton(plan);
        throwIfAborted(abortSignal);
        assertLadderExecutionContext(plan);
        assertSubmittedPriceMatchesExpectedPrice(
          order.price,
          findPriceInput()?.value || '',
          '计划价',
        );
        assertSubmittedQtyMatchesExpectedQty(
          order.qty,
          findQtyInput()?.value || '',
          '计划量',
        );

        if (!CFG.SAFE_MODE) {
          const previousFeedback = takeOrderFeedbackSnapshot();
          const submitCaptureId = beginLadderSubmitResponseCapture();
          try {
            throwIfAborted(abortSignal);
            button.click();
            setExecutionStatus(
              localizedActionStatus(
                plan.spec.statusLabel,
                `挂单 ${done + 1}/${plan.orders.length} 确认中`,
                ` order ${done + 1}/${plan.orders.length} confirming`,
              ),
              localizedText(
                `第 ${done + 1} 笔确认中`,
                `Order ${done + 1} confirming`,
              ),
            );
            waitForTradeUiMutation({ timeoutMs: 500 });
            await waitForOrderSubmitAcknowledgement(
              button,
              plan.spec.label,
              previousFeedback,
              submitCaptureId,
              plan.spec.mode,
              abortSignal,
            );
          } finally {
            endLadderSubmitResponseCapture(submitCaptureId);
          }
          previousAcknowledgedInputs = {
            submittedPrice: synchronizedInputs.submittedPrice,
            submittedQty: synchronizedInputs.submittedQty,
          };
        }
      } catch (e) {
        if (isRecoverableMaxOpenOrdersFailure(
          plan,
          e,
          options?.allowMaxOpenOrdersRecovery,
        )) {
          if (maxOpenOrdersRecoveryAttempts > 0) {
            throw new Error('已释放挂单名额，但本轮仍达到最大下单限制，已停止');
          }
          maxOpenOrdersRecoveryAttempts += 1;
          const recovery = await cancelCurrentSymbolOpenOrdersForPlan(
            plan,
            progress,
            setExecutionStatus,
            abortSignal,
            { strategy: 'farthest_for_capacity' },
          );
          throwIfAborted(abortSignal);
          if (!recovery?.ok) {
            throw new Error(recovery?.message || '未能释放挂单名额，已停止');
          }
          continue;
        }
        if (!isRetryableLadderMakerPriceFailure(plan, e)) throw e;
        if (isBinancePostOnlyMakerRejectCode(e?.binanceCode)) {
          lastRepriceApiErrorCode = e.binanceCode;
        }
        repriceAttempts += 1;
        consecutiveRepriceAttempts += 1;
        const shouldPause = consecutiveRepriceAttempts >= LADDER_REPRICE_PAUSE_EVERY_ATTEMPTS;
        const remainingLevels = plan.orders.length - done;
        const repriceDetail = shouldPause
          ? localizedText(
            `盘口持续移动，3s 后继续 · 剩余 ${remainingLevels} 档 · 已刷新 ${repriceAttempts} 次`,
            `Order book keeps moving; continue in 3s · ${remainingLevels} remaining · Refreshed ${repriceAttempts} times`,
          )
          : localizedText(
            `盘口已移动，刷新剩余 ${remainingLevels} 档 · 已刷新 ${repriceAttempts} 次`,
            `Order book moved; refreshing ${remainingLevels} remaining · Refreshed ${repriceAttempts} times`,
          );
        setExecutionStatus(
          combineLocalizedText([plan.spec.statusLabel, repriceDetail], '：'),
          repriceDetail,
        );
        await waitForPromiseOrAbort(
          delay(shouldPause ? LADDER_REPRICE_PAUSE_MS : LADDER_REPRICE_DELAY_MS),
          abortSignal,
        );
        throwIfAborted(abortSignal);
        if (ladderStopRequested) break;
        refreshRemainingLadderOrders(plan, done);
        if (shouldPause) consecutiveRepriceAttempts = 0;
        continue;
      }
      done++;
      consecutiveRepriceAttempts = 0;
      recordLadderSubmittedOrder(progress);
      setExecutionStatus(localizedActionStatus(
        plan.spec.statusLabel,
        `已挂 ${done}/${plan.orders.length} 笔`,
        ` placed ${done}/${plan.orders.length}`,
      ), null);
      throwIfAborted(abortSignal);
    }
    return { done, repriceAttempts, lastRepriceApiErrorCode };
  }

  async function startLadder(actionType, continuousProgress = null) {
    const spec = getLadderActionSpec(actionType);
    if (!spec) {
      setLadderStatus('未知阶梯动作');
      return { status: 'not_started' };
    }
    const continuousSession = continuousProgress !== null;
    const setStartStatus = (singleStatus, continuousDetail) => {
      setLadderStatus(
        continuousSession
          ? combineLocalizedText([localizedContinuousAction(spec.statusLabel), continuousDetail], ' · ')
          : singleStatus,
      );
    };
    const actionSymbol = getCurrentSymbol();
    if (!isCurrentObservedSymbol(actionSymbol)) {
      setStartStatus(
        localizedActionStatus(spec.statusLabel, '尚未开始：交易对正在切换', ' not started: symbol is changing'),
        localizedText('尚未开始 · 交易对正在切换', 'Not started · Symbol is changing'),
      );
      return { status: 'not_started' };
    }
    if (cancelCurrentSymbolOpenOrdersTask) {
      setStartStatus(
        localizedActionStatus(spec.statusLabel, '尚未开始：撤单处理中', ' not started: cancelling orders'),
        localizedText('尚未开始 · 撤单处理中', 'Not started · Cancelling orders'),
      );
      return { status: 'not_started' };
    }
    if (singleOrderTask) {
      return { status: 'not_started' };
    }
    if (ladderTask) {
      setStartStatus(
        localizedActionStatus(spec.statusLabel, '尚未开始：已有阶梯任务正在执行，请先停止', ' not started: another ladder is running; stop it first'),
        localizedText('尚未开始 · 已有阶梯任务正在执行，请先停止', 'Not started · Another ladder is running; stop it first'),
      );
      return { status: 'not_started' };
    }
    if (continuousLadderTask && !continuousSession) {
      setLadderStatus(localizedActionStatus(
        spec.statusLabel,
        '尚未开始：连续交易正在运行，请先停止',
        ' not started: continuous trading is running; stop it first',
      ));
      return { status: 'not_started' };
    }
    if (spec?.mode === 'CLOSE' && !isCloseSnapshotReady(actionSymbol)) {
      setStartStatus(
        localizedActionStatus(spec.statusLabel, '尚未开始：仓位确认中', ' not started: confirming positions'),
        localizedText('尚未开始 · 仓位确认中', 'Not started · Confirming positions'),
      );
      return { status: 'not_started' };
    }
    ladderStopRequested = false;
    const abortController = new AbortController();
    const progress = createLadderProgress();
    const setExecutionStatus = (singleStatus, continuousDetail) => {
      if (continuousSession) {
        setLadderStatus(formatActiveContinuousLadderProgress(
          spec.statusLabel,
          continuousDetail,
          continuousProgress,
          progress,
        ));
        return;
      }
      setLadderStatus(singleStatus);
    };
    invalidateUsdtRebalanceEligibility();
    ladderAbortController = abortController;
    activeLadderActionType = actionType;
    if (continuousSession) activeContinuousLadderRoundProgress = progress;
    activeLadderPanelContext = {
      mode: spec.mode,
      symbol: actionSymbol,
      precision: readCurrentOrderbookPrecisionValue(),
    };
    const feedbackStartedAt = performance.now();
    setExecutionStatus(
      localizedActionStatus(spec.statusLabel, '准备中', ' preparing'),
      localizedText('准备中', 'Preparing'),
    );
    const executionTask = (async () => {
      const {
        plan,
        done,
        repriceAttempts,
        lastRepriceApiErrorCode,
      } = await runLadderPlanWithOpenOrderReplacement(
        actionType,
        progress,
        setExecutionStatus,
        abortController.signal,
        { allowMaxOpenOrdersRecovery: continuousSession && spec.mode === 'CLOSE' },
      );
      return {
        plan,
        done,
        repriceAttempts,
        lastRepriceApiErrorCode,
        wasStopped: ladderStopRequested,
      };
    })();
    ladderTask = keepInteractionFeedbackVisible(executionTask, {
      startedAtMs: feedbackStartedAt,
      minimumMs: LADDER_ACTION_FEEDBACK_MIN_MS,
      now: () => performance.now(),
      delay,
    })
      .then(({
        plan,
        done,
        repriceAttempts,
        lastRepriceApiErrorCode,
        wasStopped,
      }) => {
        if (!isCurrentObservedSymbol(actionSymbol)) {
          if (!continuousSession) {
            setLadderStatus(formatInterruptedLadderProgress(
              spec.statusLabel,
              localizedText('交易对已切换', 'Symbol changed'),
              progress,
            ));
          }
          return {
            status: 'interrupted',
            reason: '交易对已切换',
            progress: snapshotLadderProgress(progress),
          };
        }
        const diagnostics = formatLadderRepriceDiagnostics(repriceAttempts, lastRepriceApiErrorCode);
        if (!continuousSession) {
          setLadderStatus(
            wasStopped
              ? combineLocalizedText([formatStoppedLadderProgress(spec.statusLabel, progress), diagnostics])
              : combineLocalizedText([formatCompletedLadderProgress(
                  spec.statusLabel,
                  done,
                  plan.orders.length,
                  progress,
                ), diagnostics]),
          );
        }
        return {
          status: wasStopped ? 'stopped' : 'completed',
          progress: snapshotLadderProgress(progress),
        };
      })
      .catch(async (e) => {
        if (isLadderStoppedError(e)) {
          if (!continuousSession && isCurrentObservedSymbol(actionSymbol)) {
            setLadderStatus(formatStoppedLadderProgress(spec.statusLabel, progress));
          }
          return {
            status: 'stopped',
            progress: snapshotLadderProgress(progress),
          };
        }
        if (isClosePositionCompletedError(e)) {
          if (!continuousSession && isCurrentObservedSymbol(actionSymbol)) {
            setLadderStatus(formatPositionClosedLadderProgress(spec.statusLabel, progress));
          }
          return {
            status: 'position_closed',
            reason: e.message,
            progress: snapshotLadderProgress(progress),
          };
        }
        if (spec.mode === 'CLOSE' && e?.safeNoSubmit === true) {
          try {
            await throwIfClosePositionCompleted(
              { spec, symbol: actionSymbol },
              abortController.signal,
            );
          } catch (positionError) {
            if (isClosePositionCompletedError(positionError)) {
              if (!continuousSession && isCurrentObservedSymbol(actionSymbol)) {
                setLadderStatus(formatPositionClosedLadderProgress(spec.statusLabel, progress));
              }
              return {
                status: 'position_closed',
                reason: positionError.message,
                progress: snapshotLadderProgress(progress),
              };
            }
            err('安全失败后确认当前方向持仓失败:', positionError);
          }
        }
        err('Maker 阶梯执行失败:', e);
        if (!isCurrentObservedSymbol(actionSymbol)) {
          if (!continuousSession) {
            setLadderStatus(formatInterruptedLadderProgress(
              spec.statusLabel,
              localizedText('交易对已切换', 'Symbol changed'),
              progress,
            ));
          }
          return {
            status: 'interrupted',
            reason: '交易对已切换',
            progress: snapshotLadderProgress(progress),
          };
        }
        const failureMessage = localizeKnownUiStatus(
          e?.localizedText || e?.message || localizedText('未知错误', 'Unknown error'),
        );
        const failureText = formatFailedLadderProgress(spec.statusLabel, failureMessage, progress);
        const failureTitle = e?.statusTitle
          ? formatFailedLadderProgress(
            spec.statusLabel,
            localizeKnownUiStatus(e.localizedStatusTitle || e.statusTitle),
            progress,
          )
          : failureText;
        if (!continuousSession) setLadderStatus(failureText, failureTitle);
        return {
          status: 'failed',
          error: e,
          reason: failureMessage,
          titleReason: e?.localizedStatusTitle || e?.statusTitle || failureMessage,
          progress: snapshotLadderProgress(progress),
        };
      })
      .finally(() => {
        if (ladderAbortController === abortController) ladderAbortController = null;
        if (activeContinuousLadderRoundProgress === progress) {
          activeContinuousLadderRoundProgress = null;
        }
        ladderTask = null;
        activeLadderActionType = null;
        activeLadderPanelContext = null;
        ladderStopRequested = false;
        scheduleRenderPanel();
      });
    scheduleRenderPanel();
    return await ladderTask;
  }

  async function readContinuousLadderReadiness(
    actionType,
    actionSymbol,
    positionCheckState,
  ) {
    const spec = getLadderActionSpec(actionType);
    if (!spec || spec.mode !== 'CLOSE') {
      throw new Error('连续交易仅支持阶梯平仓');
    }
    if (!isCurrentObservedSymbol(actionSymbol)) {
      return { status: 'stopped', reason: 'symbol_changed' };
    }
    if (getActiveTradeMode() !== spec.mode) {
      return { status: 'stopped', reason: 'mode_changed' };
    }
    if (
      document.hidden
      || ladderTask
      || singleOrderTask
      || cancelCurrentSymbolOpenOrdersTask
      || !readCurrentOrderbookPrecisionValue()
    ) {
      return { status: 'waiting' };
    }
    const button = spec.buttonGetter();
    if (
      !isCloseSnapshotReady(actionSymbol)
      || !button
      || !button.isConnected
      || !isVisibleElement(button)
      || isSubmitButtonBusy(button)
    ) {
      const now = Date.now();
      if (now - positionCheckState.checkedAt >= CONTINUOUS_CLOSE_POSITION_CHECK_MS) {
        positionCheckState.checkedAt = now;
        await throwIfClosePositionCompleted({ spec, symbol: actionSymbol });
      }
      return { status: 'waiting' };
    }
    return { status: 'ready' };
  }

  function getContinuousLadderStopReason(reason) {
    const reasonTextByCode = {
      symbol_changed: localizedText('交易对已切换', 'Symbol changed'),
      mode_changed: localizedText('开仓/平仓模式已切换', 'Trade mode changed'),
    };
    const reasonText = reasonTextByCode[reason];
    if (!reasonText) throw new Error(`未知连续交易停止原因：${reason}`);
    return reasonText;
  }

  function setContinuousLadderProgressStatus(
    label,
    phase,
    progress,
    reason = null,
    titleReason = reason,
  ) {
    setLadderStatus(
      formatContinuousLadderProgress(label, phase, progress, reason),
      formatContinuousLadderProgress(label, phase, progress, titleReason),
    );
  }

  async function startContinuousLadder(actionType) {
    const spec = getLadderActionSpec(actionType);
    if (!spec || spec.mode !== 'CLOSE') return startLadder(actionType);
    if (continuousLadderTask) return continuousLadderTask;

    const actionSymbol = getCurrentSymbol();
    if (!isCurrentObservedSymbol(actionSymbol)) {
      setLadderStatus(localizedActionStatus(
        spec.statusLabel,
        '尚未开始：交易对正在切换',
        ' not started: symbol is changing',
      ));
      return { status: 'not_started' };
    }

    const abortController = new AbortController();
    const continuousProgress = createContinuousLadderProgress();
    const positionCheckState = { checkedAt: Date.now() };
    continuousLadderAbortController = abortController;
    activeContinuousLadderActionType = actionType;
    activeContinuousLadderProgress = continuousProgress;

    const executionTask = (async () => {
      while (true) {
        throwIfAborted(abortController.signal);
        const outcome = await startLadder(actionType, continuousProgress);
        if (!outcome?.progress) return outcome;
        recordContinuousLadderRound(continuousProgress, outcome);
        if (outcome.status === 'position_closed') {
          setLadderStatus(formatContinuousLadderPositionClosedProgress(
            spec.statusLabel,
            continuousProgress,
          ));
          return outcome;
        }
        const recovery = outcome.status === 'completed'
          ? null
          : resolveContinuousLadderRecovery(outcome.error);
        if (outcome.status !== 'completed' && !recovery) {
          setContinuousLadderProgressStatus(
            spec.statusLabel,
            outcome.status,
            continuousProgress,
            outcome.reason || null,
            outcome.titleReason || outcome.reason || null,
          );
          return outcome;
        }
        if (!recovery) {
          setContinuousLadderProgressStatus(spec.statusLabel, 'running', continuousProgress);
        }

        const readiness = await waitForContinuousLadderNextRound({
          readReadiness: async () => {
            try {
              return await readContinuousLadderReadiness(
                actionType,
                actionSymbol,
                positionCheckState,
              );
            } catch (error) {
              if (isClosePositionCompletedError(error)) {
                return { status: 'stopped', reason: 'position_flat' };
              }
              throw error;
            }
          },
          delay,
          signal: abortController.signal,
          cooldownMs: recovery?.cooldownMs,
          onWaitStateChange: ({ phase, cooldownMs }) => {
            const waitStatus = formatContinuousLadderWaitProgress(
              spec.statusLabel,
              continuousProgress,
              phase,
              cooldownMs,
            );
            setLadderStatus(recovery
              ? combineLocalizedText([waitStatus, recovery.reason], ' · ')
              : waitStatus);
          },
        });
        if (readiness.status === 'stopped') {
          if (readiness.reason === 'position_flat') {
            setLadderStatus(formatContinuousLadderPositionClosedProgress(
              spec.statusLabel,
              continuousProgress,
            ));
            return { status: 'position_closed', reason: '当前方向已无持仓' };
          }
          setContinuousLadderProgressStatus(
            spec.statusLabel,
            'stopped',
            continuousProgress,
            getContinuousLadderStopReason(readiness.reason),
          );
          return readiness;
        }
        if (recovery) continue;
      }
    })();

    continuousLadderTask = executionTask
      .catch((e) => {
        if (isLadderStoppedError(e)) {
          setContinuousLadderProgressStatus(spec.statusLabel, 'stopped', continuousProgress);
          return { status: 'stopped' };
        }
        err('连续阶梯交易失败:', e);
        setContinuousLadderProgressStatus(
          spec.statusLabel,
          'failed',
          continuousProgress,
          localizeKnownUiStatus(e?.localizedText || e?.message || localizedText('未知错误', 'Unknown error')),
          localizeKnownUiStatus(e?.localizedStatusTitle || e?.statusTitle || e?.localizedText || e?.message || localizedText('未知错误', 'Unknown error')),
        );
        return { status: 'failed', error: e };
      })
      .finally(() => {
        if (continuousLadderAbortController === abortController) {
          continuousLadderAbortController = null;
        }
        continuousLadderTask = null;
        activeContinuousLadderActionType = null;
        activeContinuousLadderProgress = null;
        scheduleRenderPanel();
      });
    scheduleRenderPanel();
    return await continuousLadderTask;
  }

  function stopLadder() {
    if (!ladderTask && !continuousLadderTask) {
      setLadderStatus(PANEL_COPY.state.idle);
      return;
    }
    const activeActionType = activeLadderActionType || activeContinuousLadderActionType;
    const activeSpec = getLadderActionSpec(activeActionType);
    if (!activeSpec) throw new Error('运行中的阶梯任务缺少动作类型');
    const stoppedError = createLadderStoppedError();
    if (continuousLadderAbortController && !continuousLadderAbortController.signal.aborted) {
      continuousLadderAbortController.abort(stoppedError);
    }
    if (ladderTask) {
      ladderStopRequested = true;
      if (ladderAbortController && !ladderAbortController.signal.aborted) {
        ladderAbortController.abort(stoppedError);
      }
      if (continuousLadderTask) {
        if (!activeContinuousLadderProgress || !activeContinuousLadderRoundProgress) {
          throw new Error('运行中的连续阶梯任务缺少轮次进度');
        }
        setLadderStatus(formatActiveContinuousLadderProgress(
          activeSpec.statusLabel,
          localizedText('停止中', 'Stopping'),
          activeContinuousLadderProgress,
          activeContinuousLadderRoundProgress,
        ));
      } else {
        setLadderStatus(localizedActionStatus(activeSpec.statusLabel, '停止中', ' stopping'));
      }
    } else {
      setContinuousLadderProgressStatus(
        activeSpec.statusLabel,
        'stopping',
        activeContinuousLadderProgress,
      );
    }
    scheduleRenderPanel();
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

  function getAccountOrdersTabIdentity(tab) {
    return getAccountOrdersTabIdentityDom(tab);
  }

  function findAccountOrdersTabByIdentity(identity) {
    return findAccountOrdersTabByIdentityDom(document, identity, { isVisibleElement });
  }

  function getAccountOrdersObservationRoot() {
    const tab = findOpenOrdersTab();
    const tabGroup = getAccountOrdersTabGroup(tab);
    return tabGroup?.closest('.react-grid-item') || tabGroup?.parentElement || null;
  }

  /**
   * Binance replaces React descendants after tab and checkbox changes. Observe
   * the stable account-orders component and re-read the semantic state instead
   * of sleeping or retaining nodes from the previous render.
   */
  function waitForAccountOrdersState(readState, timeoutMs, abortSignal = null) {
    // The document root is observed only while React has temporarily removed
    // the verified account widget; normal waits remain scoped to that widget.
    const observationRoot = getAccountOrdersObservationRoot() || document.body;
    return waitForAccountOrdersMutationState(
      observationRoot,
      readState,
      timeoutMs,
      abortSignal,
    );
  }

  async function activateOpenOrdersTab(abortSignal = null) {
    throwIfAborted(abortSignal);
    const tab = findOpenOrdersTab();
    if (!tab) return false;
    if (tab.getAttribute('aria-selected') === 'true') return true;
    throwIfAborted(abortSignal);
    tab.click();
    const activeTab = await waitForAccountOrdersState(() => {
      const freshTab = findOpenOrdersTab();
      return freshTab?.getAttribute('aria-selected') === 'true' ? freshTab : null;
    }, 2200, abortSignal);
    return Boolean(activeTab);
  }

  async function restoreAccountOrdersTab(previousTabIdentity, symbol = null) {
    if (symbol && !isCurrentObservedSymbol(symbol)) return false;
    if (!previousTabIdentity) return true;
    const previousTab = findAccountOrdersTabByIdentity(previousTabIdentity);
    if (!previousTab) return false;
    if (previousTab.getAttribute('aria-selected') === 'true') return true;
    if (symbol && !isCurrentObservedSymbol(symbol)) return false;
    previousTab.click();
    const restoredTab = await waitForAccountOrdersState(() => {
      if (symbol && !isCurrentObservedSymbol(symbol)) return null;
      const freshTab = findAccountOrdersTabByIdentity(previousTabIdentity);
      return freshTab?.getAttribute('aria-selected') === 'true' ? freshTab : null;
    }, 2200);
    return Boolean(restoredTab) && (!symbol || isCurrentObservedSymbol(symbol));
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

  function getOpenOrdersSubTabIdentity(tab) {
    return getOpenOrdersSubTabIdentityDom(tab);
  }

  function findOpenOrdersSubTabByIdentity(root, identity) {
    return findOpenOrdersSubTabByIdentityDom(root, identity, { isVisibleElement });
  }

  async function waitForActiveOpenOrdersScope(abortSignal = null) {
    return waitForAccountOrdersState(
      () => getActiveOpenOrdersScope(),
      2200,
      abortSignal,
    );
  }

  async function activateOpenOrdersBasicSubTab(root, abortSignal = null) {
    throwIfAborted(abortSignal);
    const previousSubTabIdentity = getOpenOrdersSubTabIdentity(findSelectedOpenOrdersSubTab(root));
    const basicTab = findOpenOrdersBasicSubTab(root);
    if (!basicTab) {
      return {
        ready: !findOpenOrdersConditionalSubTab(root),
        previousSubTabIdentity,
      };
    }
    if (basicTab.getAttribute('aria-selected') === 'true') {
      return { ready: true, previousSubTabIdentity };
    }
    throwIfAborted(abortSignal);
    basicTab.click();
    const selectedBasicTab = await waitForAccountOrdersState(() => {
      const scope = getActiveOpenOrdersScope();
      const freshBasicTab = scope ? findOpenOrdersBasicSubTab(scope) : null;
      return freshBasicTab?.getAttribute('aria-selected') === 'true' ? freshBasicTab : null;
    }, 2200, abortSignal);
    return {
      ready: Boolean(selectedBasicTab),
      previousSubTabIdentity,
    };
  }

  async function restoreOpenOrdersSubTab(previousSubTabIdentity, symbol = null) {
    if (symbol && !isCurrentObservedSymbol(symbol)) return false;
    if (!previousSubTabIdentity) return true;
    const scope = getActiveOpenOrdersScope();
    const previousSubTab = scope
      ? findOpenOrdersSubTabByIdentity(scope, previousSubTabIdentity)
      : null;
    if (!previousSubTab) return false;
    if (previousSubTab.getAttribute('aria-selected') === 'true') return true;
    if (symbol && !isCurrentObservedSymbol(symbol)) return false;
    previousSubTab.click();
    const restoredSubTab = await waitForAccountOrdersState(() => {
      if (symbol && !isCurrentObservedSymbol(symbol)) return null;
      const freshScope = getActiveOpenOrdersScope();
      const freshSubTab = freshScope
        ? findOpenOrdersSubTabByIdentity(freshScope, previousSubTabIdentity)
        : null;
      return freshSubTab?.getAttribute('aria-selected') === 'true' ? freshSubTab : null;
    }, 2200);
    return Boolean(restoredSubTab) && (!symbol || isCurrentObservedSymbol(symbol));
  }

  function findCurrentSymbolCancelAllButton(root) {
    if (!root) return null;
    const buttons = Array.from(root.querySelectorAll('[class~="cursor-pointer"]'))
      .filter(isVisibleElement)
      .filter((element) => (
        isBinanceCancelAllText(getNormalizedText(element))
      ));
    if (buttons.length !== 1) return null;
    const [button] = buttons;
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
      cancelAllAvailable: Boolean(cancelAllButton),
    });
  }

  async function waitForCurrentSymbolOpenOrders(symbol) {
    const readEvidence = ({ final = false } = {}) => {
      if (!isCurrentObservedSymbol(symbol)) {
        return { hasOrders: false, cancelAllButton: null };
      }
      const currentRoot = getActiveOpenOrdersScope();
      const cancelAllButton = findCurrentSymbolCancelAllButton(currentRoot);
      const filterChecked = getCheckboxCheckedState(findHideOtherSymbolCheckbox(currentRoot));
      if (isFilteredCurrentSymbolOpenOrdersEmpty({
        scopeText: currentRoot?.textContent || '',
        symbol,
        filterChecked,
        cancelAllAvailable: Boolean(cancelAllButton),
      })) {
        return { hasOrders: false, cancelAllButton: null };
      }
      if (hasCurrentSymbolOpenOrders(currentRoot, symbol, filterChecked === true, cancelAllButton)) {
        return { hasOrders: true, cancelAllButton };
      }
      if (
        filterChecked === true &&
        isOpenOrdersScopeConfirmedForSymbol(currentRoot, symbol) &&
        isCurrentSymbolOpenOrdersDefinitivelyClear({
          scopeText: currentRoot?.textContent || '',
          symbol,
          openOrdersCount: getOpenOrdersTabCount(),
        })
      ) {
        return { hasOrders: false, cancelAllButton: null };
      }
      return final ? {
        hasOrders: hasCurrentSymbolOpenOrders(
          currentRoot,
          symbol,
          filterChecked === true,
          cancelAllButton,
        ),
        cancelAllButton,
      } : null;
    };

    const evidence = await waitForAccountOrdersState(readEvidence, 1600);
    return evidence || readEvidence({ final: true });
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
    const observationRoot = getAccountOrdersObservationRoot() || document.body;
    const mutationSignal = createAccountOrdersMutationSignal(observationRoot);
    if (!mutationSignal) throw new Error('当前委托状态无法观察，已停止');

    try {
      while (true) {
        const observedVersion = mutationSignal.version;
        if (!isCurrentObservedSymbol(symbol)) {
          return { ok: false, status: 'symbol_changed', root: currentRoot };
        }
        const refreshedRoot = getActiveOpenOrdersScope();
        currentRoot = refreshedRoot;
        let clearCandidate = false;
        if (!currentRoot) {
          clearCandidateSince = null;
          lastStatus = 'scope_not_found';
        } else if (!isOpenOrdersScopeConfirmedForSymbol(currentRoot, symbol)) {
          clearCandidateSince = null;
          lastStatus = 'symbol_filter_not_confirmed';
        } else {
          lastStatus = 'not_cleared';
          const openOrdersCount = getOpenOrdersTabCount();
          const scopeText = currentRoot.textContent || '';
          clearCandidate = isCurrentSymbolOpenOrdersClearCandidate({
            scopeText,
            symbol,
            openOrdersCount,
          });
          if (isCurrentSymbolOpenOrdersDefinitivelyClear({
            scopeText,
            symbol,
            openOrdersCount,
          })) {
            return {
              ok: true,
              status: 'cleared',
              root: currentRoot,
              definitivelyCleared: true,
            };
          }
          const stability = updateOpenOrdersClearStability({
            clearCandidate,
            clearCandidateSince,
            nowMs: Date.now(),
            settleMs: CANCEL_OPEN_ORDERS_CLEAR_SETTLE_MS,
          });
          clearCandidateSince = stability.clearCandidateSince;
          if (stability.cleared) {
            return {
              ok: true,
              status: 'cleared',
              root: currentRoot,
              definitivelyCleared: false,
            };
          }
        }

        const nowMs = Date.now();
        if (!shouldContinueOpenOrdersClearObservation({
          nowMs,
          deadlineMs: deadline,
          clearCandidate,
        })) break;
        const nextCheckAt = clearCandidate && clearCandidateSince !== null
          ? clearCandidateSince + CANCEL_OPEN_ORDERS_CLEAR_SETTLE_MS
          : deadline;
        await mutationSignal.waitForChange(
          observedVersion,
          Math.max(0, nextCheckAt - nowMs),
        );
      }
    } finally {
      mutationSignal.dispose();
    }
    if (!isCurrentObservedSymbol(symbol)) {
      return { ok: false, status: 'symbol_changed', root: currentRoot };
    }
    return { ok: false, status: lastStatus, root: currentRoot };
  }

  function findOpenOrderRowCells(row) {
    return getOpenOrderRowCells(row, { isVisibleElement });
  }

  function findOpenOrderRowCancelButton(row) {
    const icon = Array.from(row.querySelectorAll('svg[aria-label]'))
      .find((candidate) => matchesBinancePageText(
        candidate.getAttribute('aria-label'),
        BINANCE_PAGE_TEXT.accountOrders.rowCancel,
      ));
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

  function createOpenOrderCancellationUnconfirmedError(message) {
    const error = new Error(message);
    error.name = 'OpenOrderCancellationUnconfirmedError';
    return error;
  }

  function isOpenOrderCancellationUnconfirmedError(error) {
    return error?.name === 'OpenOrderCancellationUnconfirmedError';
  }

  function getOpenOrderRowKey(cells, row) {
    const cellText = cells
      .slice(0, 10)
      .map((cell) => (cell.textContent || '').replace(/\s+/g, ' ').trim())
      .join('|');
    return cellText || (row.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function readOpenOrderRowElements(root) {
    return findOpenOrderRowElements(root, {
      isVisibleElement,
      isRowCancelIcon: (icon) => matchesBinancePageText(
        icon.getAttribute('aria-label'),
        BINANCE_PAGE_TEXT.accountOrders.rowCancel,
      ),
    });
  }

  function readCurrentSymbolOpenOrderRows(root, symbol, plan = null) {
    if (!root || !symbol) return [];
    return readOpenOrderRowElements(root)
      .map((row) => {
        const cells = findOpenOrderRowCells(row);
        const symbolText = (cells[1]?.textContent || '').replace(/\s+/g, ' ').trim();
        const sideText = (cells[3]?.textContent || '').replace(/\s+/g, ' ').trim();
        const price = normalizeDecimalString((cells[4]?.textContent || '').replace(/,/g, '').trim());
        const qty = normalizeDecimalString((cells[5]?.textContent || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/)?.[0] || '');
        const cancelButton = findOpenOrderRowCancelButton(row);
        return {
          root,
          row,
          cells,
          symbolText,
          sideText,
          price,
          qty,
          cancelButton,
          key: getOpenOrderRowKey(cells, row),
        };
      })
      .filter((row) => (
        isOpenOrderRowCurrentSymbol(row.symbolText, symbol) &&
        isOpenOrderRowForPlan(row.sideText, plan) &&
        row.price &&
        isPositiveDecimalString(row.price) &&
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
    if (plan.spec?.mode === 'OPEN' && plan.spec.side === 'LONG') {
      return includesCompactBinancePageText(sideText, BINANCE_PAGE_TEXT.tradeAction.OPEN_LONG);
    }
    if (plan.spec?.mode === 'OPEN' && plan.spec.side === 'SHORT') {
      return includesCompactBinancePageText(sideText, BINANCE_PAGE_TEXT.tradeAction.OPEN_SHORT);
    }
    if (plan.spec?.mode === 'CLOSE' && plan.spec.side === 'LONG') {
      return includesCompactBinancePageText(sideText, BINANCE_PAGE_TEXT.tradeAction.CLOSE_LONG);
    }
    if (plan.spec?.mode === 'CLOSE' && plan.spec.side === 'SHORT') {
      return includesCompactBinancePageText(sideText, BINANCE_PAGE_TEXT.tradeAction.CLOSE_SHORT);
    }
    return false;
  }

  function readCurrentSymbolOpenOrderRowsState(root, symbol, plan = null) {
    const currentRoot = getActiveOpenOrdersScope() || root;
    if (!currentRoot) return null;
    const rows = readCurrentSymbolOpenOrderRows(currentRoot, symbol, plan);
    if (rows.length) return { root: currentRoot, rows, status: 'matched' };

    const currentSymbolRows = readCurrentSymbolOpenOrderRows(currentRoot, symbol);
    if (currentSymbolRows.length) {
      return { root: currentRoot, rows: [], status: 'other_direction' };
    }

    const checkbox = findHideOtherSymbolCheckbox(currentRoot);
    const cancelAllButton = findCurrentSymbolCancelAllButton(currentRoot);
    if (isFilteredCurrentSymbolOpenOrdersEmpty({
      scopeText: currentRoot.textContent || '',
      symbol,
      filterChecked: getCheckboxCheckedState(checkbox),
      cancelAllAvailable: Boolean(cancelAllButton),
    })) {
      return { root: currentRoot, rows: [], status: 'empty' };
    }
    return null;
  }

  async function waitForCurrentSymbolOpenOrderRows(
    root,
    symbol,
    plan = null,
    abortSignal = null,
  ) {
    let state = await waitForAccountOrdersState(
      () => readCurrentSymbolOpenOrderRowsState(root, symbol, plan),
      1600,
      abortSignal,
    );
    if (state?.status !== 'other_direction') return state?.rows || [];

    const transitioned = await waitForAccountOrdersState(() => {
      const nextState = readCurrentSymbolOpenOrderRowsState(root, symbol, plan);
      return nextState?.status !== 'other_direction' ? nextState : null;
    }, LADDER_REPLACE_ROW_SETTLE_MS, abortSignal);
    state = transitioned || readCurrentSymbolOpenOrderRowsState(root, symbol, plan);
    return state?.rows || [];
  }

  function findOpenOrderRowsScrollContainer(root) {
    const firstRow = readOpenOrderRowElements(root)[0] || null;
    let candidate = firstRow?.parentElement || null;
    while (candidate && root.contains(candidate)) {
      if (candidate.scrollHeight > candidate.clientHeight + 2) return candidate;
      if (candidate === root) break;
      candidate = candidate.parentElement;
    }
    return null;
  }

  function scrollOpenOrderRowsToBottom(scrollContainer) {
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
    scrollContainer.dispatchEvent(new Event('scroll', { bubbles: true }));
  }

  async function loadAllCurrentSymbolOpenOrderRows(
    root,
    symbol,
    plan,
    abortSignal = null,
  ) {
    const deadline = Date.now() + OPEN_ORDERS_LAZY_LOAD_TIMEOUT_MS;
    let stableEndPasses = 0;
    let currentRoot = root;

    while (Date.now() < deadline) {
      throwIfAborted(abortSignal);
      if (!isCurrentObservedSymbol(symbol)) throw new Error('加载待撤挂单时交易对已变化');
      currentRoot = getActiveOpenOrdersScope() || currentRoot;
      if (!currentRoot) throw new Error('加载待撤挂单时当前委托面板已消失');

      // Binance commits the active tab and symbol filter before React mounts
      // the matching rows and scroll container, so an empty DOM is not settled.
      const renderRemainingMs = deadline - Date.now();
      const renderState = await waitForAccountOrdersState(() => {
        const refreshedRoot = getActiveOpenOrdersScope();
        if (!refreshedRoot || !isCurrentObservedSymbol(symbol)) return null;
        const settledState = readCurrentSymbolOpenOrderRowsState(refreshedRoot, symbol, plan);
        if (!settledState) return null;
        return {
          root: refreshedRoot,
          settledState,
          scrollContainer: findOpenOrderRowsScrollContainer(refreshedRoot),
        };
      }, Math.min(OPEN_ORDERS_LAZY_LOAD_SETTLE_MS, renderRemainingMs), abortSignal);
      if (!renderState) continue;

      currentRoot = renderState.root;
      const { settledState, scrollContainer } = renderState;
      if (!scrollContainer && settledState) return settledState.rows;

      const beforeCount = readOpenOrderRowElements(currentRoot).length;
      scrollOpenOrderRowsToBottom(scrollContainer);
      const growthRemainingMs = deadline - Date.now();
      if (growthRemainingMs <= 0) break;
      const growth = await waitForAccountOrdersState(() => {
        const refreshedRoot = getActiveOpenOrdersScope();
        if (!refreshedRoot || !isCurrentObservedSymbol(symbol)) return null;
        const loadedCount = readOpenOrderRowElements(refreshedRoot).length;
        return loadedCount > beforeCount ? { root: refreshedRoot, loadedCount } : null;
      }, Math.min(OPEN_ORDERS_LAZY_LOAD_SETTLE_MS, growthRemainingMs), abortSignal);

      throwIfAborted(abortSignal);
      currentRoot = growth?.root || getActiveOpenOrdersScope() || currentRoot;
      const afterCount = readOpenOrderRowElements(currentRoot).length;
      if (afterCount > beforeCount) {
        stableEndPasses = 0;
        continue;
      }
      if (afterCount < beforeCount) {
        stableEndPasses = 0;
        continue;
      }

      const refreshedScrollContainer = findOpenOrderRowsScrollContainer(currentRoot);
      const reachedBottom = !refreshedScrollContainer || (
        refreshedScrollContainer.scrollTop + refreshedScrollContainer.clientHeight
        >= refreshedScrollContainer.scrollHeight - 2
      );
      stableEndPasses = reachedBottom ? stableEndPasses + 1 : 0;
      if (stableEndPasses >= 2) {
        return readCurrentSymbolOpenOrderRows(currentRoot, symbol, plan);
      }
    }
    throw new Error('当前委托完整列表 7 秒内未加载完成');
  }

  function readOpenOrdersDistanceReferencePrice() {
    const referencePrice = normalizeDecimalString(getLatestTradePrices()[0] || '');
    if (!referencePrice || !isPositiveDecimalString(referencePrice)) {
      throw new Error('未读取到当前成交价，无法选择最远挂单');
    }
    return referencePrice;
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

  function readOpenOrderRowCancellationOutcome(symbol, key, previousCount, dialogsBefore) {
    if (!isCurrentObservedSymbol(symbol)) return { status: 'symbol_changed' };
    const dialog = findNewVisibleDialog(dialogsBefore);
    if (dialog) return { status: 'dialog_open', dialog };
    const activeRoot = getActiveOpenOrdersScope();
    if (activeRoot && countOpenOrderRowsByKey(activeRoot, symbol, key) < previousCount) {
      return { status: 'row_removed' };
    }
    return null;
  }

  async function waitForOpenOrderRowCancellationOutcome(
    symbol,
    key,
    previousCount,
    dialogsBefore,
    abortSignal = null,
  ) {
    const deadline = Date.now() + LADDER_REPLACE_OPEN_ORDERS_CLEAR_TIMEOUT_MS;
    while (true) {
      throwIfAborted(abortSignal);
      const currentOutcome = readOpenOrderRowCancellationOutcome(
        symbol,
        key,
        previousCount,
        dialogsBefore,
      );
      if (currentOutcome) return currentOutcome;

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) return { status: 'timeout' };
      const observationRoot = getAccountOrdersObservationRoot() || document.body;
      const accountSignal = createAccountOrdersMutationSignal(observationRoot);
      const dialogSignal = createDialogMutationSignal(document);
      if (!accountSignal || !dialogSignal) {
        accountSignal?.dispose();
        dialogSignal?.dispose();
        throw new Error('撤单结果无法观察，已停止');
      }

      try {
        const observedAccountVersion = accountSignal.version;
        const observedDialogVersion = dialogSignal.version;
        const observedOutcome = readOpenOrderRowCancellationOutcome(
          symbol,
          key,
          previousCount,
          dialogsBefore,
        );
        if (observedOutcome) return observedOutcome;
        await waitForPromiseOrAbort(
          Promise.race([
            accountSignal.waitForChange(observedAccountVersion, remainingMs),
            dialogSignal.waitForChange(observedDialogVersion, remainingMs),
          ]),
          abortSignal,
        );
      } finally {
        accountSignal.dispose();
        dialogSignal.dispose();
      }
    }
  }

  async function confirmOpenOrderRowKeyCountBelow(
    symbol,
    key,
    previousCount,
    abortSignal = null,
  ) {
    const deadline = Date.now() + LADDER_REPLACE_ROW_SETTLE_MS;
    const observationRoot = getAccountOrdersObservationRoot() || document.body;
    const mutationSignal = createAccountOrdersMutationSignal(observationRoot);
    if (!mutationSignal) throw new Error('当前委托状态无法观察，已停止');

    try {
      while (true) {
        throwIfAborted(abortSignal);
        const observedVersion = mutationSignal.version;
        if (!isCurrentObservedSymbol(symbol)) return false;
        const activeRoot = getActiveOpenOrdersScope();
        if (!activeRoot || countOpenOrderRowsByKey(activeRoot, symbol, key) >= previousCount) {
          return false;
        }
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) return true;
        await waitForPromiseOrAbort(
          mutationSignal.waitForChange(observedVersion, remainingMs),
          abortSignal,
        );
      }
    } finally {
      mutationSignal.dispose();
    }
  }

  async function waitForOpenOrderRowKeyCountBelow(
    symbol,
    key,
    previousCount,
    abortSignal = null,
  ) {
    const deadline = Date.now() + LADDER_REPLACE_OPEN_ORDERS_CLEAR_TIMEOUT_MS;
    const observationRoot = getAccountOrdersObservationRoot() || document.body;
    const mutationSignal = createAccountOrdersMutationSignal(observationRoot);
    if (!mutationSignal) throw new Error('当前委托状态无法观察，已停止');

    try {
      while (true) {
        throwIfAborted(abortSignal);
        const observedVersion = mutationSignal.version;
        if (!isCurrentObservedSymbol(symbol)) return false;
        const activeRoot = getActiveOpenOrdersScope();
        if (activeRoot && countOpenOrderRowsByKey(activeRoot, symbol, key) < previousCount) {
          return true;
        }
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) break;
        await waitForPromiseOrAbort(
          mutationSignal.waitForChange(observedVersion, remainingMs),
          abortSignal,
        );
      }
    } finally {
      mutationSignal.dispose();
    }
    const activeRoot = getActiveOpenOrdersScope();
    return Boolean(activeRoot && countOpenOrderRowsByKey(activeRoot, symbol, key) < previousCount);
  }

  async function cancelOneOpenOrderRowForPlan(
    row,
    plan,
    progress,
    setExecutionStatus,
    abortSignal = null,
  ) {
    if (!isCurrentObservedSymbol(plan.symbol)) throw new Error('撤销待替换挂单前交易对已变化');
    const previousKeyCount = countOpenOrderRowsByKey(row.root, plan.symbol, row.key);
    if (!row.cancelButton?.isConnected || !isVisibleElement(row.cancelButton)) {
      if (previousKeyCount === 0) return { status: 'already_removed', qty: row.qty };
      throw new Error('待替换挂单的撤单按钮已失效，已停止重新挂单');
    }
    const dialogsBefore = new Set(getVisibleDialogs());
    throwIfAborted(abortSignal);
    if (!clickDomTarget(row.cancelButton)) {
      throw new Error('待替换挂单的撤单按钮点击失败，已停止重新挂单');
    }
    waitForTradeUiMutation({ timeoutMs: 800 });
    const outcome = await waitForOpenOrderRowCancellationOutcome(
      plan.symbol,
      row.key,
      previousKeyCount,
      dialogsBefore,
      abortSignal,
    );
    if (outcome.status === 'symbol_changed') {
      throw new Error('撤销待替换挂单时交易对已变化');
    }
    if (outcome.status === 'timeout') {
      throw createOpenOrderCancellationUnconfirmedError('待替换挂单仍存在，已停止重新挂单');
    }
    if (outcome.status === 'dialog_open') {
      const { dialog } = outcome;
      setExecutionStatus(
        combineLocalizedText([
          plan.spec.statusLabel,
          localizedText('单行撤单确认弹窗已打开', 'Single-order cancellation dialog opened'),
        ], '：'),
        localizedText('单行撤单确认弹窗已打开', 'Single-order cancellation dialog opened'),
      );
      const dialogClosed = await waitForDialogToClose(
        dialog,
        ROW_CANCEL_DIALOG_CLOSE_TIMEOUT_MS,
        abortSignal,
      );
      if (!dialogClosed) {
        const error = new Error('单行撤单确认弹窗仍未关闭，未恢复页面状态');
        error.name = 'DialogNotClosedError';
        throw error;
      }
      if (!(await waitForOpenOrderRowKeyCountBelow(
        plan.symbol,
        row.key,
        previousKeyCount,
        abortSignal,
      ))) {
        throw createOpenOrderCancellationUnconfirmedError('待替换挂单仍存在，已停止重新挂单');
      }
    }
    throwIfAborted(abortSignal);
    if (!(await confirmOpenOrderRowKeyCountBelow(
      plan.symbol,
      row.key,
      previousKeyCount,
      abortSignal,
    ))) {
      throw createOpenOrderCancellationUnconfirmedError('待替换挂单状态未稳定，已停止重新挂单');
    }
    recordLadderCancelledOrder(progress);
    return { status: 'cancelled', qty: row.qty };
  }

  async function cancelOpenOrderRowsForPlan(
    root,
    plan,
    progress,
    setExecutionStatus,
    abortSignal = null,
  ) {
    let cancelQty = '0';
    let currentRoot = root;
    while (compareDecimalStrings(cancelQty, plan.totalQty) < 0) {
      throwIfAborted(abortSignal);
      if (!isCurrentObservedSymbol(plan.symbol)) throw new Error('撤销待替换挂单前交易对已变化');
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
        throw new Error('同向可撤挂单数量不足，已停止重新挂单');
      }
      currentRoot = row.root || currentRoot;
      const result = await cancelOneOpenOrderRowForPlan(
        row,
        plan,
        progress,
        setExecutionStatus,
        abortSignal,
      );
      if (result.status === 'already_removed') continue;
      cancelQty = addDecimalStrings(cancelQty, result.qty);
    }
    return { ok: true, cancelQty };
  }

  async function cancelFarthestOpenOrderRowsForPlan(
    root,
    plan,
    targets,
    progress,
    setExecutionStatus,
    abortSignal = null,
  ) {
    let releasedCount = 0;
    let cancelledCount = 0;
    let unconfirmedCount = 0;
    let currentRoot = root;

    for (const target of targets) {
      throwIfAborted(abortSignal);
      if (!isCurrentObservedSymbol(plan.symbol)) throw new Error('释放挂单名额时交易对已变化');
      currentRoot = getActiveOpenOrdersScope() || currentRoot;
      let row = readCurrentSymbolOpenOrderRows(currentRoot, plan.symbol, plan)
        .find((candidate) => candidate.key === target.key) || null;
      if (!row) {
        const completeRows = await loadAllCurrentSymbolOpenOrderRows(
          currentRoot,
          plan.symbol,
          plan,
          abortSignal,
        );
        currentRoot = getActiveOpenOrdersScope() || currentRoot;
        row = completeRows.find((candidate) => candidate.key === target.key) || null;
      }

      if (row) {
        try {
          const result = await cancelOneOpenOrderRowForPlan(
            row,
            plan,
            progress,
            setExecutionStatus,
            abortSignal,
          );
          if (result.status === 'cancelled') cancelledCount += 1;
        } catch (error) {
          if (!isOpenOrderCancellationUnconfirmedError(error)) throw error;
          unconfirmedCount += 1;
          const detail = localizedText(
            `已释放 ${releasedCount} 个挂单名额 · 当前撤单未确认，继续本轮`,
            `Freed ${releasedCount} order slots · Current cancellation unconfirmed; continuing this round`,
          );
          setExecutionStatus(combineLocalizedText([plan.spec.statusLabel, detail], '：'), detail);
          // The confirmed slots already released may be enough for the unfinished ladder.
          // Do not claim this row was cancelled or discard the completed submit progress.
          break;
        }
      }
      releasedCount += 1;
      const detail = localizedText(
        `释放挂单名额 ${releasedCount}/${targets.length}`,
        `Freeing order slots ${releasedCount}/${targets.length}`,
      );
      setExecutionStatus(combineLocalizedText([plan.spec.statusLabel, detail], '：'), detail);
    }
    return { ok: true, releasedCount, cancelledCount, unconfirmedCount };
  }

  async function setHideOtherSymbolChecked(
    root,
    desiredChecked,
    symbol = getCurrentSymbol(),
    abortSignal = null,
  ) {
    throwIfAborted(abortSignal);
    if (!isCurrentObservedSymbol(symbol)) return false;
    const checkbox = findHideOtherSymbolCheckbox(root);
    if (!checkbox) return false;
    const currentChecked = getCheckboxCheckedState(checkbox);
    if (currentChecked === desiredChecked) return true;
    if (currentChecked === null) return false;
    if (!isCurrentObservedSymbol(symbol)) return false;
    throwIfAborted(abortSignal);
    checkbox.click();
    const updatedCheckbox = await waitForAccountOrdersState(() => {
      if (!isCurrentObservedSymbol(symbol)) return null;
      const currentRoot = getActiveOpenOrdersScope();
      const currentCheckbox = findHideOtherSymbolCheckbox(currentRoot);
      return getCheckboxCheckedState(currentCheckbox) === desiredChecked ? currentCheckbox : null;
    }, 1000, abortSignal);
    return Boolean(updatedCheckbox) && isCurrentObservedSymbol(symbol);
  }

  async function ensureOpenOrdersLimitedToCurrentSymbol(root, symbol, abortSignal = null) {
    throwIfAborted(abortSignal);
    const checkbox = findHideOtherSymbolCheckbox(root);
    if (!checkbox) {
      return {
        ok: false,
        originalChecked: null,
      };
    }
    const originalChecked = getCheckboxCheckedState(checkbox);
    if (originalChecked === null) {
      return {
        ok: false,
        originalChecked,
      };
    }
    if (!originalChecked && !(await setHideOtherSymbolChecked(
      root,
      true,
      symbol,
      abortSignal,
    ))) {
      return { ok: false, originalChecked };
    }
    const settledRoot = await waitForAccountOrdersState(() => {
      if (!isCurrentObservedSymbol(symbol)) return null;
      const currentRoot = getActiveOpenOrdersScope();
      const currentCheckbox = findHideOtherSymbolCheckbox(currentRoot);
      const cancelAllButton = findCurrentSymbolCancelAllButton(currentRoot);
      return isCurrentSymbolOpenOrdersFilterReady({
        scopeText: currentRoot?.textContent || '',
        symbol,
        filterChecked: getCheckboxCheckedState(currentCheckbox),
        cancelAllAvailable: Boolean(cancelAllButton),
      }) ? currentRoot : null;
    }, 1600, abortSignal);
    return {
      ok: Boolean(settledRoot) && isCurrentObservedSymbol(symbol),
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

  async function waitForDialogToClose(
    dialog,
    timeoutMs = ROW_CANCEL_DIALOG_CLOSE_TIMEOUT_MS,
    abortSignal = null,
  ) {
    return Boolean(await waitForDialogMutationState(
      document,
      () => (!dialog.isConnected || !isVisibleElement(dialog) ? true : null),
      timeoutMs,
      abortSignal,
    ));
  }

  function createBinanceCancelAllDialogDecisionWatcher() {
    const lifecycleController = new AbortController();
    const dialogSignal = createDialogMutationSignal(document);
    if (!dialogSignal) throw new Error('撤单确认弹窗状态无法观察，已停止');
    const watcher = {
      action: null,
      error: null,
      seenDialog: false,
      dialogSignal,
    };

    const recordAction = (eventTarget) => {
      const contract = findBinanceCancelAllDialog(document, isVisibleElement);
      if (!contract) return;
      watcher.seenDialog = true;
      const action = classifyBinanceCancelAllDialogAction(contract, eventTarget);
      if (action && !watcher.action) watcher.action = action;
    };
    const rejectInvalidDialogAction = (event, error) => {
      // Do not let Binance execute an action that the script can no longer classify or recover from.
      event.preventDefault();
      event.stopImmediatePropagation();
      watcher.error = error;
    };
    const handleClick = (event) => {
      try {
        recordAction(event.target);
      } catch (error) {
        rejectInvalidDialogAction(event, error);
      } finally {
        dialogSignal.notify();
      }
    };
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
        rejectInvalidDialogAction(event, error);
      } finally {
        dialogSignal.notify();
      }
    };
    // A BFCache page is only frozen and can resume the same native dialog later.
    const handlePageHide = (event) => {
      if (!event.persisted) {
        lifecycleController.abort();
        dialogSignal.notify();
      }
    };

    document.addEventListener('click', handleClick, true);
    document.addEventListener('keydown', handleKeydown, true);
    window.addEventListener('pagehide', handlePageHide);
    return {
      watcher,
      lifecycleSignal: lifecycleController.signal,
      dispose() {
        document.removeEventListener('click', handleClick, true);
        document.removeEventListener('keydown', handleKeydown, true);
        window.removeEventListener('pagehide', handlePageHide);
        dialogSignal.dispose();
      },
    };
  }

  async function waitForBinanceCancelAllDialogDecision(watcher, lifecycleSignal, onDialogSeen) {
    const discoveryDeadline = Date.now() + CANCEL_DIALOG_DISCOVERY_TIMEOUT_MS;
    let reportedDialog = false;
    while (true) {
      const observedVersion = watcher.dialogSignal.version;
      if (lifecycleSignal.aborted) return { status: 'aborted' };
      if (watcher.error) throw watcher.error;
      const contract = findBinanceCancelAllDialog(document, isVisibleElement);
      if (contract) {
        watcher.seenDialog = true;
        if (!reportedDialog) {
          reportedDialog = true;
          onDialogSeen();
        }
      }

      const status = resolveCancelDialogDecision({
        seenDialog: watcher.seenDialog,
        action: watcher.action,
        dialogVisible: Boolean(contract),
        aborted: lifecycleSignal.aborted,
        nowMs: Date.now(),
        discoveryDeadlineMs: discoveryDeadline,
      });
      if (status !== 'waiting') return { status };
      const remainingDiscoveryMs = watcher.seenDialog
        ? null
        : Math.max(0, discoveryDeadline - Date.now());
      await watcher.dialogSignal.waitForChange(observedVersion, remainingDiscoveryMs);
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
      const current = findActiveBinanceChartOrdersPopover(
        document,
        target,
        isVisibleElement,
      );
      if (current && (expectedChecked === null || current.checked === expectedChecked)) {
        return current;
      }
      await delay(CHART_ORDERS_MENU_POLL_MS);
    }
    const current = findActiveBinanceChartOrdersPopover(
      document,
      target,
      isVisibleElement,
    );
    if (current && (expectedChecked === null || current.checked === expectedChecked)) {
      return current;
    }
    throw new Error(expectedChecked === null
      ? '图表“显示当前委托”菜单未打开'
      : `图表“显示当前委托”未切换为${expectedChecked ? '显示' : '隐藏'}`);
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
      if (!findActiveBinanceChartOrdersPopover(
        document,
        currentTarget,
        isVisibleElement,
      )) return;
      await delay(CHART_ORDERS_MENU_POLL_MS);
    }
    if (findActiveBinanceChartOrdersPopover(
      document,
      currentTarget,
      isVisibleElement,
    )) {
      throw new Error('图表“显示当前委托”菜单未关闭');
    }
  }

  async function toggleBinanceChartOrdersWithCoalescedSave(
    target,
    checkbox,
    expectedChecked,
    expectDrawingEvents,
  ) {
    if (typeof expectDrawingEvents !== 'boolean') {
      throw new Error('图表委托线保存参数异常');
    }
    let popoverCloseOutcomePromise = null;
    const coalescingOutcome = await coalesceTradingViewDrawingSaves(
      target.tradingViewApi,
      async () => {
        checkbox.click();
        await waitForBinanceChartOrdersPopover(target, expectedChecked);
        // Start hiding native setup UI immediately, but keep its failure outside
        // the action so the coalescer can still replay the final chart snapshot.
        popoverCloseOutcomePromise = closeBinanceChartOrdersPopover(target).then(
          () => null,
          (error) => error,
        );
      },
      expectDrawingEvents ? {} : { eventDiscoveryTimeoutMs: 0 },
    ).then(
      (result) => ({ result, error: null }),
      (error) => ({ result: null, error }),
    );
    const popoverCloseError = popoverCloseOutcomePromise
      ? await popoverCloseOutcomePromise
      : null;
    if (coalescingOutcome.error) throw coalescingOutcome.error;
    if (popoverCloseError) throw popoverCloseError;

    const { result } = coalescingOutcome;
    log('图表当前委托保存已合并', {
      drawingEvents: result.drawingEventCount,
      saveRequests: result.saveRequestCount,
      fullSaves: result.fullSaveCount,
    });
  }

  async function hideBinanceChartOrdersForBulkCancel(target, state) {
    const current = await openBinanceChartOrdersPopover(target);
    state.originalChecked = current.checked;
    if (current.checked) {
      writeChartOrdersRecoveryRecord();
      state.changed = true;
      await toggleBinanceChartOrdersWithCoalescedSave(
        target,
        current.checkbox,
        false,
        true,
      );
      return;
    }
    await closeBinanceChartOrdersPopover(target);
  }

  async function restoreBinanceChartOrdersAfterBulkCancel(
    target,
    state,
    expectDrawingEvents,
  ) {
    if (typeof expectDrawingEvents !== 'boolean') {
      throw new Error('图表委托线保存参数异常');
    }
    assertSameBinanceChartOrdersTarget(target, getBinanceChartOrdersTarget());
    const current = await openBinanceChartOrdersPopover(target);
    if (current.checked !== state.originalChecked) {
      await toggleBinanceChartOrdersWithCoalescedSave(
        target,
        current.checkbox,
        state.originalChecked,
        expectDrawingEvents,
      );
    } else {
      await closeBinanceChartOrdersPopover(target);
    }
    clearChartOrdersRecoveryRecord();
  }

  async function recoverChartOrdersStateAfterReload() {
    const recovery = readChartOrdersRecoveryRecord();
    if (recovery.status === 'missing') {
      chartOrdersRecoveryPendingAtStartup = false;
      return { status: 'missing' };
    }
    if (recovery.status === 'invalid') {
      emit('ERR', '图表当前委托恢复记录无效，未修改页面状态');
      clearChartOrdersRecoveryRecord();
      chartOrdersRecoveryPendingAtStartup = false;
      return { status: recovery.status };
    }

    const target = findBinanceChartOrdersTargetDom(document);
    if (!target) return { status: 'target_not_ready' };
    await restoreBinanceChartOrdersAfterBulkCancel(target, {
      originalChecked: recovery.record.originalChecked,
      changed: true,
    }, true);
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
    if (getOpenOrdersTabCount() === 0) {
      setLadderStatus('当前交易对无挂单');
      return { ok: true, status: 'no_orders' };
    }

    const previousAccountOrdersTabIdentity = getAccountOrdersTabIdentity(findSelectedAccountOrdersTab());
    let openOrdersScope = null;
    let previousOpenOrdersSubTabIdentity = null;
    let symbolFilterOriginalChecked = null;
    let restoreTemporaryUiState = true;
    let chartOrdersTarget = null;
    const chartOrdersState = { originalChecked: null, changed: false };
    let restoreChartOrdersState = true;
    let chartOrdersDefinitivelyCleared = false;
    let successStatusMessage = null;

    try {
      const tabReady = await activateOpenOrdersTab();
      if (!isCurrentObservedSymbol(symbol)) {
        const message = '打开当前委托时交易对已变化';
        setLadderStatus(message);
        return { ok: false, status: 'symbol_changed', message };
      }
      if (!tabReady) {
        const message = '未能打开当前委托';
        setLadderStatus(message);
        return { ok: false, status: 'tab_not_ready', message };
      }
      openOrdersScope = await waitForActiveOpenOrdersScope();
      if (!openOrdersScope || !isCurrentObservedSymbol(symbol)) {
        const message = '未找到当前委托面板';
        setLadderStatus(message);
        return { ok: false, status: 'scope_not_found', message };
      }
      const basicSubTabState = await activateOpenOrdersBasicSubTab(openOrdersScope);
      previousOpenOrdersSubTabIdentity = basicSubTabState.previousSubTabIdentity;
      if (!basicSubTabState.ready || !isCurrentObservedSymbol(symbol)) {
        const message = '未找到当前委托基础单';
        setLadderStatus(message);
        return { ok: false, status: 'basic_tab_not_ready', message };
      }
      openOrdersScope = await waitForActiveOpenOrdersScope();
      if (!openOrdersScope || !isCurrentObservedSymbol(symbol)) {
        const message = '未找到当前委托面板';
        setLadderStatus(message);
        return { ok: false, status: 'scope_not_found', message };
      }
      const symbolFilter = await ensureOpenOrdersLimitedToCurrentSymbol(openOrdersScope, symbol);
      symbolFilterOriginalChecked = symbolFilter.originalChecked;
      if (!symbolFilter.ok || !isCurrentObservedSymbol(symbol)) {
        const message = '未确认仅显示当前交易对挂单';
        setLadderStatus(message);
        return { ok: false, status: 'symbol_filter_not_confirmed', message };
      }
      openOrdersScope = await waitForActiveOpenOrdersScope();
      if (!openOrdersScope || !isCurrentObservedSymbol(symbol)) {
        const message = '未找到当前委托面板';
        setLadderStatus(message);
        return { ok: false, status: 'scope_not_found', message };
      }
      const openOrdersEvidence = await waitForCurrentSymbolOpenOrders(symbol);
      if (!isCurrentObservedSymbol(symbol)) {
        const message = '读取挂单时交易对已变化';
        setLadderStatus(message);
        return { ok: false, status: 'symbol_changed', message };
      }
      if (!openOrdersEvidence.hasOrders) {
        setLadderStatus('当前交易对无挂单');
        return { ok: true, status: 'no_orders' };
      }

      let cancelAllButton = openOrdersEvidence.cancelAllButton;
      if (!cancelAllButton) {
        const message = '未找到当前委托的全撤按钮';
        setLadderStatus(message);
        return { ok: false, status: 'cancel_button_not_found', message };
      }

      if (!isCurrentObservedSymbol(symbol)) {
        const message = '撤单前交易对已变化';
        setLadderStatus(message);
        return { ok: false, status: 'symbol_changed', message };
      }

      cancelCurrentSymbolOpenOrdersBlocksLadderActions = true;
      scheduleRenderPanel();

      try {
        chartOrdersTarget = getBinanceChartOrdersTarget();
        await hideBinanceChartOrdersForBulkCancel(chartOrdersTarget, chartOrdersState);
      } catch (e) {
        emit('ERR', '撤单前隐藏图表当前委托失败', e);
        const message = '未能准备撤单页面，未打开确认弹窗';
        setLadderStatus(message);
        return { ok: false, status: 'chart_orders_not_hidden', message };
      }

      if (!isCurrentObservedSymbol(symbol)) {
        const message = '准备撤单时交易对已变化';
        setLadderStatus(message);
        return { ok: false, status: 'symbol_changed', message };
      }

      openOrdersScope = await waitForActiveOpenOrdersScope();
      if (!openOrdersScope || !isCurrentObservedSymbol(symbol)) {
        const message = '准备撤单时未找到当前委托面板';
        setLadderStatus(message);
        return { ok: false, status: 'scope_not_found', message };
      }
      if (!isOpenOrdersScopeConfirmedForSymbol(openOrdersScope, symbol)) {
        const message = '准备撤单时未确认仅显示当前交易对挂单';
        setLadderStatus(message);
        return { ok: false, status: 'symbol_filter_not_confirmed', message };
      }
      cancelAllButton = findCurrentSymbolCancelAllButton(openOrdersScope);
      if (!cancelAllButton) {
        const message = '准备撤单时未找到全撤按钮';
        setLadderStatus(message);
        return { ok: false, status: 'cancel_button_not_found', message };
      }

      const dialogDecisionWatcher = createBinanceCancelAllDialogDecisionWatcher();
      let dialogDecision;
      try {
        cancelAllButton.click();
        dialogDecision = await waitForBinanceCancelAllDialogDecision(
          dialogDecisionWatcher.watcher,
          dialogDecisionWatcher.lifecycleSignal,
          () => setLadderStatus('撤单确认弹窗已打开'),
        );
      } catch (error) {
        restoreTemporaryUiState = false;
        emit('ERR', '币安撤单确认弹窗结构异常', error);
        const message = '撤单确认弹窗结构异常，未执行弹窗操作';
        setLadderStatus(message);
        return { ok: false, status: 'dialog_contract_invalid', message };
      } finally {
        dialogDecisionWatcher.dispose();
      }
      if (dialogDecision.status === 'aborted') {
        restoreTemporaryUiState = false;
        restoreChartOrdersState = false;
        const interruptedBaseAsset = formatStatusBaseAsset(symbol);
        const message = `原交易对 ${interruptedBaseAsset} 页面已离开，撤单确认跟踪已停止`;
        setLadderStatus(message);
        return { ok: false, status: 'aborted', message };
      }
      if (!isCurrentObservedSymbol(symbol)) {
        const message = '确认撤单前交易对已变化';
        setLadderStatus(message);
        return { ok: false, status: 'symbol_changed', message };
      }
      if (dialogDecision.status === 'not_found') {
        const message = '未识别到撤单确认弹窗，未继续撤单流程';
        setLadderStatus(message);
        return { ok: false, status: 'dialog_not_found', message };
      }
      if (dialogDecision.status === 'cancelled') {
        const message = '撤单已取消';
        successStatusMessage = message;
        return { ok: false, status: 'cancelled', message };
      }
      waitForTradeUiMutation({ timeoutMs: 800 });
      setLadderStatus('撤单已确认，等待挂单清空');

      openOrdersScope = await waitForActiveOpenOrdersScope();
      if (!openOrdersScope || !isCurrentObservedSymbol(symbol)) {
        const message = '未找到当前委托面板';
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
          const message = '等待撤单完成时未找到当前委托面板';
          setLadderStatus(message);
          return { ok: false, status: 'scope_not_found', message };
        }
        if (clearResult.status === 'symbol_filter_not_confirmed') {
          const message = '等待撤单完成时未确认仅显示当前交易对挂单';
          setLadderStatus(message);
          return { ok: false, status: 'symbol_filter_not_confirmed', message };
        }
        const message = waitUntilCleared
          ? '当前交易对挂单仍存在，已停止重新挂单'
          : '当前交易对挂单仍存在，撤单未完成';
        setLadderStatus(message);
        return { ok: false, status: 'not_cleared', message };
      }
      chartOrdersDefinitivelyCleared = clearResult.definitivelyCleared === true;
      successStatusMessage = waitUntilCleared
        ? '原挂单已撤，继续阶梯挂单'
        : '撤单已完成';
      return { ok: true, status: 'cleared' };
    } finally {
      let temporaryUiRestoreSucceeded = true;
      if (restoreTemporaryUiState && isCurrentObservedSymbol(symbol)) {
        openOrdersScope = await waitForActiveOpenOrdersScope();
        if (openOrdersScope && symbolFilterOriginalChecked === false) {
          const restored = await restoreOpenOrdersSymbolFilter(openOrdersScope, symbolFilterOriginalChecked, symbol);
          if (!restored) {
            temporaryUiRestoreSucceeded = false;
            setLadderStatus('未能恢复隐藏其他合约状态');
          }
        }
        if (previousOpenOrdersSubTabIdentity) {
          temporaryUiRestoreSucceeded = (
            await restoreOpenOrdersSubTab(previousOpenOrdersSubTabIdentity, symbol)
          ) && temporaryUiRestoreSucceeded;
        }
        if (isCurrentObservedSymbol(symbol)) {
          temporaryUiRestoreSucceeded = (
            await restoreAccountOrdersTab(previousAccountOrdersTabIdentity, symbol)
          ) && temporaryUiRestoreSucceeded;
        }
      }

      let chartOrdersRestoreSucceeded = true;
      if (restoreChartOrdersState && chartOrdersState.changed) {
        try {
          const chartOrdersStillDefinitivelyCleared =
            chartOrdersDefinitivelyCleared && getOpenOrdersTabCount() === 0;
          await restoreBinanceChartOrdersAfterBulkCancel(
            chartOrdersTarget,
            chartOrdersState,
            !chartOrdersStillDefinitivelyCleared,
          );
        } catch (e) {
          chartOrdersRestoreSucceeded = false;
          emit('ERR', '恢复图表当前委托显示失败', e);
          setLadderStatus('未能恢复图表当前委托显示');
        }
      }

      if (
        restoreTemporaryUiState &&
        isCurrentObservedSymbol(symbol) &&
        chartOrdersRestoreSucceeded &&
        temporaryUiRestoreSucceeded &&
        successStatusMessage
      ) {
        setLadderStatus(successStatusMessage);
      }
    }
  }

  async function cancelCurrentSymbolOpenOrders(options = null) {
    if (cancelCurrentSymbolOpenOrdersTask) return cancelCurrentSymbolOpenOrdersTask;
    if (singleOrderTask) {
      return { ok: false, status: 'single_order_running', message: '单击下单处理中' };
    }
    if (ladderTask) {
      const message = '阶梯任务运行中，请先停止阶梯挂单';
      setLadderStatus(message);
      return { ok: false, status: 'ladder_running', message };
    }
    if (continuousLadderTask) {
      const message = '连续交易运行中，请先停止阶梯挂单';
      setLadderStatus(message);
      return { ok: false, status: 'ladder_running', message };
    }
    clearCancelNoOrdersFeedback();
    cancelCurrentSymbolOpenOrdersBlocksLadderActions = false;
    invalidateUsdtRebalanceEligibility();
    const task = runCancelCurrentSymbolOpenOrders(options);
    cancelCurrentSymbolOpenOrdersTask = task;
    scheduleRenderPanel();
    try {
      const result = await task;
      if (result?.status === 'no_orders') showCancelNoOrdersFeedback();
      return result;
    } finally {
      if (cancelCurrentSymbolOpenOrdersTask === task) {
        cancelCurrentSymbolOpenOrdersTask = null;
        cancelCurrentSymbolOpenOrdersBlocksLadderActions = false;
      }
      scheduleRenderPanel();
    }
  }

  function clearCancelNoOrdersFeedback() {
    window.clearTimeout(cancelNoOrdersFeedbackTimer);
    cancelNoOrdersFeedbackTimer = 0;
    cancelNoOrdersFeedbackActive = false;
  }

  function showCancelNoOrdersFeedback() {
    clearCancelNoOrdersFeedback();
    cancelNoOrdersFeedbackActive = true;
    cancelNoOrdersFeedbackTimer = window.setTimeout(() => {
      cancelNoOrdersFeedbackTimer = 0;
      cancelNoOrdersFeedbackActive = false;
      scheduleRenderPanel();
    }, CANCEL_NO_ORDERS_FEEDBACK_MS);
    scheduleRenderPanel();
  }

  async function cancelCurrentSymbolOpenOrdersForPlan(
    plan,
    progress,
    setExecutionStatus,
    abortSignal = null,
    options = null,
  ) {
    throwIfAborted(abortSignal);
    const setPlanStepStatus = (message) => {
      const localizedMessage = localizeKnownUiStatus(message);
      setExecutionStatus(
        combineLocalizedText([plan.spec.statusLabel, localizedMessage], '：'),
        localizedMessage,
      );
    };
    const symbol = getCurrentSymbol();
    if (!isCurrentObservedSymbol(symbol) || symbol !== plan?.symbol) {
      const message = '撤销待替换挂单前交易对已变化';
      setPlanStepStatus(message);
      return { ok: false, status: 'symbol_changed', message };
    }

    const capacityRecovery = options?.strategy === 'farthest_for_capacity';
    const previousAccountOrdersTabIdentity = getAccountOrdersTabIdentity(findSelectedAccountOrdersTab());
    const previousOpenOrdersScrollTop = findOpenOrderRowsScrollContainer(
      getActiveOpenOrdersScope(),
    )?.scrollTop ?? null;
    let openOrdersScope = null;
    let previousOpenOrdersSubTabIdentity = null;
    let symbolFilterOriginalChecked = null;
    let restoreTemporaryUiState = true;

    try {
      setPlanStepStatus('查找当前委托');
      const tabReady = await activateOpenOrdersTab(abortSignal);
      throwIfAborted(abortSignal);
      if (!isCurrentObservedSymbol(symbol)) {
        const message = '打开当前委托时交易对已变化';
        setPlanStepStatus(message);
        return { ok: false, status: 'symbol_changed', message };
      }
      if (!tabReady) {
        const message = '未能打开当前委托';
        setPlanStepStatus(message);
        return { ok: false, status: 'tab_not_ready', message };
      }

      openOrdersScope = await waitForActiveOpenOrdersScope(abortSignal);
      throwIfAborted(abortSignal);
      if (!openOrdersScope) {
        const message = '未找到当前委托面板';
        setPlanStepStatus(message);
        return { ok: false, status: 'scope_not_found', message };
      }

      previousOpenOrdersSubTabIdentity = getOpenOrdersSubTabIdentity(
        findSelectedOpenOrdersSubTab(openOrdersScope),
      );
      const basicSubTabState = await activateOpenOrdersBasicSubTab(
        openOrdersScope,
        abortSignal,
      );
      throwIfAborted(abortSignal);
      if (!basicSubTabState.ready) {
        const message = '未找到当前委托基础单';
        setPlanStepStatus(message);
        return { ok: false, status: 'basic_tab_not_ready', message };
      }

      openOrdersScope = await waitForActiveOpenOrdersScope(abortSignal);
      throwIfAborted(abortSignal);
      if (!openOrdersScope) {
        const message = '未找到当前委托面板';
        setPlanStepStatus(message);
        return { ok: false, status: 'scope_not_found', message };
      }

      symbolFilterOriginalChecked = getCheckboxCheckedState(
        findHideOtherSymbolCheckbox(openOrdersScope),
      );
      const symbolFilter = await ensureOpenOrdersLimitedToCurrentSymbol(
        openOrdersScope,
        symbol,
        abortSignal,
      );
      throwIfAborted(abortSignal);
      if (!symbolFilter.ok) {
        const message = '未确认仅显示当前交易对挂单';
        setPlanStepStatus(message);
        return { ok: false, status: 'symbol_filter_not_confirmed', message };
      }

      openOrdersScope = await waitForActiveOpenOrdersScope(abortSignal);
      throwIfAborted(abortSignal);
      if (!openOrdersScope) {
        const message = '未找到当前委托面板';
        setPlanStepStatus(message);
        return { ok: false, status: 'scope_not_found', message };
      }

      const rows = capacityRecovery
        ? await loadAllCurrentSymbolOpenOrderRows(
          openOrdersScope,
          symbol,
          plan,
          abortSignal,
        )
        : await waitForCurrentSymbolOpenOrderRows(
          openOrdersScope,
          symbol,
          plan,
          abortSignal,
        );
      throwIfAborted(abortSignal);
      if (!rows.length) {
        const directionLabel = getPlanDirectionLabel(plan);
        const message = `未找到${directionLabel || ''}方向的可撤基础单`;
        setPlanStepStatus(message);
        return { ok: false, status: 'rows_not_found', message };
      }

      if (capacityRecovery) {
        const referencePrice = readOpenOrdersDistanceReferencePrice();
        const targets = selectFarthestOpenOrders(
          rows,
          referencePrice,
          MAX_OPEN_ORDERS_RECOVERY_CANCEL_COUNT,
        );
        const preparingDetail = localizedText(
          `达到挂单上限，准备撤销距当前价最远的 ${targets.length} 笔同向挂单`,
          `Order limit reached; cancelling the ${targets.length} farthest same-direction orders`,
        );
        setExecutionStatus(
          combineLocalizedText([plan.spec.statusLabel, preparingDetail], '：'),
          preparingDetail,
        );
        const result = await cancelFarthestOpenOrderRowsForPlan(
          openOrdersScope,
          plan,
          targets,
          progress,
          setExecutionStatus,
          abortSignal,
        );
        throwIfAborted(abortSignal);
        const completedDetail = result.unconfirmedCount > 0
          ? localizedText(
            `已释放 ${result.releasedCount} 个挂单名额 · ${result.unconfirmedCount} 笔未确认，继续本轮`,
            `Freed ${result.releasedCount} order slots · ${result.unconfirmedCount} unconfirmed; continuing this round`,
          )
          : localizedText(
            `已释放 ${result.releasedCount} 个挂单名额，继续本轮`,
            `Freed ${result.releasedCount} order slots; continuing this round`,
          );
        setExecutionStatus(
          combineLocalizedText([plan.spec.statusLabel, completedDetail], '：'),
          completedDetail,
        );
        return { ok: true, status: 'capacity_released', ...result };
      }

      const rowsToCancel = selectOpenOrderRowsToCancelForPlan(plan, rows);
      if (!rowsToCancel.length) {
        const message = '未选中待替换挂单';
        setPlanStepStatus(message);
        return { ok: false, status: 'rows_not_selected', message };
      }

      setPlanStepStatus(`撤销 ${rowsToCancel.length} 笔同向挂单`);
      await cancelOpenOrderRowsForPlan(
        openOrdersScope,
        plan,
        progress,
        setExecutionStatus,
        abortSignal,
      );
      throwIfAborted(abortSignal);
      setPlanStepStatus('原挂单已撤，继续阶梯挂单');
      return { ok: true, status: 'rows_cleared' };
    } catch (e) {
      if (isLadderStoppedError(e)) throw e;
      if (e?.name === 'DialogNotClosedError') restoreTemporaryUiState = false;
      const message = e?.message || '待替换挂单撤销失败，已停止重新挂单';
      setPlanStepStatus(message);
      const status = e?.name === 'DialogNotClosedError' ? 'dialog_not_closed' : 'row_cancel_failed';
      return { ok: false, status, message };
    } finally {
      if (restoreTemporaryUiState && isCurrentObservedSymbol(symbol)) {
        openOrdersScope = await waitForActiveOpenOrdersScope();
        if (symbolFilterOriginalChecked === false) {
          const restored = openOrdersScope
            ? await restoreOpenOrdersSymbolFilter(openOrdersScope, symbolFilterOriginalChecked, symbol)
            : false;
          if (!restored) setPlanStepStatus('未能恢复隐藏其他合约状态');
        }
        if (previousOpenOrdersSubTabIdentity) {
          await restoreOpenOrdersSubTab(previousOpenOrdersSubTabIdentity, symbol);
        }
        if (previousOpenOrdersScrollTop !== null) {
          openOrdersScope = await waitForActiveOpenOrdersScope();
          const scrollContainer = findOpenOrderRowsScrollContainer(openOrdersScope);
          if (scrollContainer) {
            scrollContainer.scrollTop = Math.min(
              previousOpenOrdersScrollTop,
              scrollContainer.scrollHeight,
            );
          }
        }
        if (isCurrentObservedSymbol(symbol)) {
          await restoreAccountOrdersTab(previousAccountOrdersTabIdentity, symbol);
        }
      }
    }
  }

  function formatLadderPlanDetail(plan) {
    const zhLevelText = plan.levels === plan.requestedLevels
      ? `${plan.levels}档`
      : `${plan.levels}/${plan.requestedLevels}档`;
    const enLevelText = plan.levels === plan.requestedLevels
      ? `${plan.levels} orders`
      : `${plan.levels}/${plan.requestedLevels} orders`;
    return localizedText(
      `${plan.percent}% / ${zhLevelText} / 幅${plan.ladderStep}`,
      `${plan.percent}% / ${enLevelText} / gap ${plan.ladderStep}`,
    );
  }

  function formatLadderPlanStatus(plan) {
    return combineLocalizedText([
      localizedActionStatus(plan.spec.statusLabel, '计划', ' plan'),
      formatLadderPlanDetail(plan),
    ], '：');
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
      plan.optionContext &&
      plan.optionContext.percent != null &&
      Number.isInteger(plan.optionContext.levels) &&
      Number.isInteger(plan.optionContext.ladderStep) &&
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

  function formatOpenOrdersReplacementDetail(plan) {
    if (plan?.spec?.mode === 'OPEN') {
      return localizedText(
        '同向开仓挂单可能占用可开数量，准备撤销后重新挂单',
        'Same-direction open orders may consume available quantity; cancelling before replacement',
      );
    }
    return localizedText(
      '同向平仓挂单占用可平数量，准备撤销后重新挂单',
      'Same-direction close orders consume available quantity; cancelling before replacement',
    );
  }

  function formatOpenOrdersReplacementStatus(plan) {
    return combineLocalizedText([
      plan.spec.statusLabel,
      formatOpenOrdersReplacementDetail(plan),
    ], '：');
  }

  function createLadderExpectedContext(plan) {
    return {
      symbol: plan.symbol,
      mode: plan.spec.mode,
      precision: plan.precision,
    };
  }

  async function runLadderPlanWithOpenOrderReplacement(
    actionType,
    progress,
    setExecutionStatus,
    abortSignal = null,
    options = null,
  ) {
    let replacementContext = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      throwIfAborted(abortSignal);
      let plan = null;
      try {
        plan = await buildLadderPlan(actionType, replacementContext);
        setLadderPlannedOrders(progress, plan.orders.length);
        throwIfAborted(abortSignal);
        setExecutionStatus(formatLadderPlanStatus(plan), formatLadderPlanDetail(plan));
        const execution = await executeLadderPlan(
          plan,
          progress,
          setExecutionStatus,
          abortSignal,
          options,
        );
        return { plan, ...execution };
      } catch (e) {
        const replacementPlan = getReplaceableLadderOpenOrdersPlan(plan, e);
        if (attempt > 0 || !replacementPlan) throw e;
        assertLadderExecutionContext(replacementPlan);
        setExecutionStatus(
          formatOpenOrdersReplacementStatus(replacementPlan),
          formatOpenOrdersReplacementDetail(replacementPlan),
        );
        replacementContext = createLadderExpectedContext(replacementPlan);
        const result = await cancelCurrentSymbolOpenOrdersForPlan(
          replacementPlan,
          progress,
          setExecutionStatus,
          abortSignal,
        );
        throwIfAborted(abortSignal);
        if (!result?.ok) {
          if (
            replacementPlan.spec.mode === 'CLOSE'
            && !['symbol_changed', 'dialog_not_closed'].includes(result.status)
          ) {
            try {
              await throwIfClosePositionCompleted(replacementPlan, abortSignal);
            } catch (positionError) {
              if (isClosePositionCompletedError(positionError)) throw positionError;
              err('替换挂单失败后确认当前方向持仓失败:', positionError);
            }
          }
          throw new Error(result.message || '原挂单未完成替换，已停止重新挂单');
        }
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

  function readOpenableQtyByTestIds() {
    const longQty = readQtyByDataTestId('max-buy-amount');
    const shortQty = readQtyByDataTestId('max-sell-amount');
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
      if (!includesBinancePageText(text, BINANCE_PAGE_TEXT.closeableQuantity)) continue;
      const m = text.match(new RegExp(
        `(?:${BINANCE_CLOSEABLE_QUANTITY_LABEL_PATTERN})\\s*([\\d,]*\\.?\\d+)`,
        'i',
      ));
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

  function readQtyTextNearButton(button, labels, labelPattern) {
    if (!button) return null;
    const btnRect = button.getBoundingClientRect();
    const root = getButtonTextSearchRoot(button);
    if (!root) return null;
    let best = null;
    let bestScore = Infinity;
    const nodes = root.querySelectorAll('div, span, p, small');
    const re = new RegExp(`(?:${labelPattern})\\s*([\\d,]*\\.?\\d+)`, 'gi');
    for (const node of nodes) {
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (!includesBinancePageText(text, labels)) continue;
      re.lastIndex = 0;
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
    const fromTestId = readOpenableQtyByTestIds();
    if (fromTestId) return fromTestId;
    return {
      longQty: readQtyTextNearButton(
        openLongBtn,
        BINANCE_PAGE_TEXT.openableQuantity,
        BINANCE_OPENABLE_QUANTITY_LABEL_PATTERN,
      ),
      shortQty: readQtyTextNearButton(
        openShortBtn,
        BINANCE_PAGE_TEXT.openableQuantity,
        BINANCE_OPENABLE_QUANTITY_LABEL_PATTERN,
      ),
      qtySource: 'near_button',
    };
  }

  function isConfirmedZeroOpenBalance(qty) {
    const available = readTradeAvailableBalance(getTradeMutationRoot(), { isVisibleElement });
    const normalizedQty = normalizeDecimalString(String(qty ?? ''));
    const normalizedBalance = normalizeDecimalString(available?.amount ?? '');
    return (
      normalizedQty !== null
      && normalizedBalance !== null
      && compareDecimalStrings(normalizedQty, '0') === 0
      && compareDecimalStrings(normalizedBalance, '0') === 0
    );
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
    await Promise.race([
      bncHeadersReady,
      delay(BNC_HEADERS_READY_TIMEOUT_MS),
    ]);
    return Boolean(cachedBncHeaders && isCurrentObservedSymbol(symbol));
  }

  async function fetchCurrentPositionsPayload() {
    if (!cachedBncHeaders) throw new Error('币安请求头尚未就绪');
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
      if (!resp.ok) throw new Error(`持仓接口异常：HTTP ${resp.status}`);
      return await resp.json();
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function fetchUsdtRebalanceBapi(path, options = {}) {
    if (!cachedBncHeaders) throw new Error('币安请求头尚未就绪');
    const method = options.method || 'GET';
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => controller.abort(),
      USDT_REBALANCE_REQUEST_TIMEOUT_MS,
    );
    try {
      const request = {
        method,
        headers: getBncHeaders(),
        credentials: 'include',
        signal: controller.signal,
      };
      if (Object.hasOwn(options, 'body')) request.body = JSON.stringify(options.body);
      const response = await fetch(`${window.location.origin}${path}`, request);
      if (response.status === 401) throw new Error('Binance 登录态已失效');
      if (!response.ok) throw new Error(`${options.label || 'Binance 接口'}异常：HTTP ${response.status}`);
      return await response.json();
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function readCurrentUsdtRebalanceBalances() {
    const [walletPayload, futuresPayload] = await Promise.all([
      fetchUsdtRebalanceBapi(BINANCE_WALLET_BALANCE_BAPI_PATH, {
        label: '钱包余额接口',
      }),
      fetchUsdtRebalanceBapi(BINANCE_FUTURES_MAX_WITHDRAW_BAPI_PATH, {
        method: 'POST',
        body: { assetName: 'USDT' },
        label: 'U本位可划转余额接口',
      }),
    ]);
    return withFuturesTransferableBalance(
      parseUsdtWalletBalances(walletPayload),
      futuresPayload,
    );
  }

  async function assertUsdtRebalanceTradingState() {
    if (!isFuturesTradingPage() || document.hidden) throw new Error('当前不在可操作的合约页面');
    if (ladderTask || continuousLadderTask || singleOrderTask || cancelCurrentSymbolOpenOrdersTask) {
      throw new Error('当前仍有交易任务运行');
    }
    const positionCount = readAccountPositionCount();
    if (positionCount == null) throw new Error('未读取到全账户持仓数量');
    if (positionCount !== 0) throw new Error('全账户仍有持仓');
    const openOrdersCount = getOpenOrdersTabCount();
    if (openOrdersCount == null) throw new Error('未读取到全账户当前委托数量');
    if (openOrdersCount !== 0) throw new Error('全账户仍有当前委托');
    const positionState = resolveAllFuturesPositionStatus(await fetchCurrentPositionsPayload());
    if (positionState.status !== 'flat') throw new Error('全账户仍有持仓');
  }

  function buildUsdtRebalanceDialogModel(plan) {
    const accountLabels = {
      FUNDING: localizedText('资金', 'Funding'),
      MAIN: localizedText('现货', 'Spot'),
      UMFUTURE: localizedText('U本位合约', 'USDⓈ-M Futures'),
    };
    const accountCodes = ['FUNDING', 'MAIN', 'UMFUTURE'];
    return {
      title: ui(PANEL_COPY.action.accountRebalance),
      targetSummary: ui(PANEL_COPY.rebalanceDialog.targetSummary),
      accountHeading: ui(PANEL_COPY.rebalanceDialog.accountHeading),
      currentHeading: ui(PANEL_COPY.rebalanceDialog.currentHeading),
      targetHeading: ui(PANEL_COPY.rebalanceDialog.targetHeading),
      transferHeading: ui(PANEL_COPY.rebalanceDialog.transferHeading),
      balanceRows: accountCodes.map((accountCode) => ({
        account: ui(accountLabels[accountCode]),
        current: plan.before[accountCode],
        target: plan.targets[accountCode],
      })),
      transferRows: plan.transfers.map((transfer) => ({
        route: `${ui(accountLabels[transfer.from])} → ${ui(accountLabels[transfer.to])}`,
        amount: `${transfer.amount} USDT`,
      })),
      question: ui(localizedText(
        `确认执行 ${plan.transfers.length} 笔划转？`,
        `Confirm ${plan.transfers.length} transfer${plan.transfers.length === 1 ? '' : 's'}?`,
      )),
      cancelLabel: ui(PANEL_COPY.rebalanceDialog.cancel),
      confirmLabel: ui(PANEL_COPY.rebalanceDialog.confirm),
    };
  }

  async function submitUsdtRebalanceTransfer(transfer) {
    const payload = await fetchUsdtRebalanceBapi(BINANCE_WALLET_TRANSFER_BAPI_PATH, {
      method: 'POST',
      body: {
        asset: 'USDT',
        amount: transfer.amount,
        kindType: transfer.kindType,
      },
      label: 'USDT 划转接口',
    });
    if (payload?.success !== true) throw new Error(payload?.message || 'USDT 划转失败');
    return payload;
  }

  async function waitForUsdtRebalanceBalances(expectedBalances) {
    const deadline = Date.now() + USDT_REBALANCE_REQUEST_TIMEOUT_MS;
    while (true) {
      const actualBalances = await readCurrentUsdtRebalanceBalances();
      if (areUsdtBalancesEqual(actualBalances, expectedBalances)) return actualBalances;
      if (Date.now() >= deadline) throw new Error('划转后账户余额未及时更新');
      await delay(USDT_REBALANCE_BALANCE_POLL_MS);
    }
  }

  async function runUsdtRebalance() {
    let plan = null;
    let completed = 0;
    setLadderStatus('正在读取账户再平衡计划');
    try {
      await assertUsdtRebalanceTradingState();
      const initialBalances = await readCurrentUsdtRebalanceBalances();
      plan = buildUsdtRebalancePlan(initialBalances);
      if (plan.transfers.length === 0) {
        usdtRebalanceEligible = false;
        setLadderStatus('USDT 已按 5:4:1 分配');
        return { status: 'already_balanced', plan };
      }
      if (!await showUsdtRebalanceDialog(document, buildUsdtRebalanceDialogModel(plan))) {
        setLadderStatus('账户再平衡已取消');
        return { status: 'cancelled', plan };
      }

      let expectedBalances = initialBalances;
      for (const transfer of plan.transfers) {
        await assertUsdtRebalanceTradingState();
        const currentBalances = await readCurrentUsdtRebalanceBalances();
        if (!areUsdtBalancesEqual(currentBalances, expectedBalances)) {
          throw new Error('账户余额已变化，已停止账户再平衡');
        }
        setLadderStatus(`账户再平衡中 · ${completed + 1}/${plan.transfers.length} 笔`);
        await submitUsdtRebalanceTransfer(transfer);
        completed += 1;
        expectedBalances = applyUsdtTransferToBalances(expectedBalances, transfer);
        await waitForUsdtRebalanceBalances(expectedBalances);
      }
      usdtRebalanceEligible = false;
      setLadderStatus(`账户再平衡已完成 · ${completed}/${plan.transfers.length} 笔`);
      return { status: 'completed', plan, completed };
    } catch (error) {
      const message = error?.name === 'AbortError'
        ? 'Binance 请求超时'
        : (error?.message || String(error));
      const prefix = completed > 0 && plan
        ? `账户再平衡部分完成 · ${completed}/${plan.transfers.length} 笔`
        : '账户再平衡失败';
      setLadderStatus(`${prefix} · ${message}`, message);
      throw error;
    }
  }

  function startUsdtRebalance() {
    if (usdtRebalanceTask || !usdtRebalanceEligible) return usdtRebalanceTask;
    let task = null;
    task = runUsdtRebalance()
      .catch((error) => {
        err('USDT 再平衡失败:', error);
        return { status: 'failed', error };
      })
      .finally(() => {
        if (usdtRebalanceTask !== task) return;
        usdtRebalanceTask = null;
        scheduleRenderPanel();
      });
    usdtRebalanceTask = task;
    scheduleRenderPanel();
    return task;
  }

  async function fetchCurrentSymbolPositionState(symbol) {
    const payload = await fetchCurrentPositionsPayload();
    return {
      ...resolveSymbolPositionStatus(payload, symbol),
      source: 'user_position_api',
    };
  }

  async function fetchCurrentSymbolPositionSideState(symbol, side) {
    const payload = await fetchCurrentPositionsPayload();
    return {
      ...resolveSymbolPositionSideStatus(payload, symbol, side),
      source: 'user_position_api',
    };
  }

  function isStableOpenContext(symbol) {
    return getActiveTradeMode() === 'OPEN' && isCurrentObservedSymbol(symbol);
  }

  async function autoResetOpenLeverageToDefault(symbol, triggerSource) {
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

  function invalidateUsdtRebalanceEligibility() {
    const hadPendingTimer = usdtRebalanceEligibilityTimer !== 0;
    const wasEligible = usdtRebalanceEligible;
    window.clearTimeout(usdtRebalanceEligibilityTimer);
    usdtRebalanceEligibilityTimer = 0;
    usdtRebalanceEligibilityEpoch += 1;
    if (!usdtRebalanceTask) usdtRebalanceEligible = false;
    const resetFlatStatus = !usdtRebalanceTask && ladderStatusText === PANEL_COPY.state.allPositionsClosed;
    if (resetFlatStatus) {
      setLadderStatus(PANEL_COPY.state.idle);
    }
    if (hadPendingTimer || wasEligible || resetFlatStatus) scheduleRenderPanel();
  }

  async function confirmUsdtRebalanceEligibility(epoch) {
    if (epoch !== usdtRebalanceEligibilityEpoch || document.hidden) return false;
    if (readAccountPositionCount() !== 0 || getOpenOrdersTabCount() !== 0) return false;
    if (ladderTask || continuousLadderTask || singleOrderTask || cancelCurrentSymbolOpenOrdersTask) {
      return false;
    }
    const symbol = getCurrentSymbol();
    if (!symbol || !await waitForBncHeaders(symbol)) return false;
    const positionState = resolveAllFuturesPositionStatus(await fetchCurrentPositionsPayload());
    if (epoch !== usdtRebalanceEligibilityEpoch) return false;
    if (positionState.status !== 'flat') return false;
    usdtRebalanceEligible = true;
    setLadderStatus(PANEL_COPY.state.allPositionsClosed);
    scheduleRenderPanel();
    return true;
  }

  function scheduleUsdtRebalanceEligibility() {
    invalidateUsdtRebalanceEligibility();
    const epoch = usdtRebalanceEligibilityEpoch;
    usdtRebalanceEligibilityTimer = window.setTimeout(() => {
      usdtRebalanceEligibilityTimer = 0;
      let task = null;
      task = confirmUsdtRebalanceEligibility(epoch)
        .catch((error) => {
          log('USDT 再平衡资格检查未通过', error?.message || error);
          return false;
        })
        .finally(() => {
          if (usdtRebalanceEligibilityTask === task) usdtRebalanceEligibilityTask = null;
        });
      usdtRebalanceEligibilityTask = task;
    }, USDT_REBALANCE_FLAT_STABLE_MS);
  }

  function updateUsdtRebalanceEligibilityFromAccountCounts(positionCount, openOrdersCount) {
    if (positionCount === 0 && openOrdersCount === 0) {
      scheduleUsdtRebalanceEligibility();
      return;
    }
    invalidateUsdtRebalanceEligibility();
  }

  function handleAccountPositionObservation(triggerSource) {
    const positionCount = readAccountPositionCount();
    const openOrdersCount = getOpenOrdersTabCount();
    const positionChanged = positionCount !== lastObservedAccountPositionCount;
    const openOrdersChanged = openOrdersCount !== lastObservedAccountOpenOrdersCount;
    if (!positionChanged && !openOrdersChanged) return;
    lastObservedAccountPositionCount = positionCount;
    lastObservedAccountOpenOrdersCount = openOrdersCount;
    if (positionChanged && positionCount != null) {
      queueAutoOpenLeveragePositionCheck(triggerSource);
    }
    updateUsdtRebalanceEligibilityFromAccountCounts(positionCount, openOrdersCount);
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
    lastObservedAccountOpenOrdersCount = null;
    invalidateUsdtRebalanceEligibility();
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

  function showMultiplierPressFeedback(button) {
    const existingTimer = multiplierPressFeedbackTimers.get(button);
    if (existingTimer) window.clearTimeout(existingTimer);
    button.setAttribute(MULTIPLIER_PRESS_FEEDBACK_ATTR, 'true');
    const timer = window.setTimeout(() => {
      button.removeAttribute(MULTIPLIER_PRESS_FEEDBACK_ATTR);
      multiplierPressFeedbackTimers.delete(button);
    }, MULTIPLIER_PRESS_FEEDBACK_MS);
    multiplierPressFeedbackTimers.set(button, timer);
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

  function ladderOptionRow(title, tooltip, options, selected, group, suffix = '') {
    return [
      `<div style="display:grid;grid-template-columns:${activeUiLocale === 'en' ? '52px' : '36px'} repeat(5,minmax(0,1fr));align-items:center;gap:4px;height:34px;margin-top:6px;overflow:hidden;">`,
      `<span title="${ui(tooltip)}" style="color:${MUTED_TEXT_COLOR};font-size:13px;white-space:nowrap;cursor:help;">${ui(title)}</span>`,
      ...options.map((value) => ladderOptionButton(`${value}${suffix}`, value, Number(value) === Number(selected), group)),
      '</div>',
    ].join('');
  }

  function ladderActionButton(actionType, label, tone, disabled = false) {
    const isBuyTone = tone === 'BUY';
    const borderColor = isBuyTone ? 'var(--color-Buy)' : 'var(--color-Sell)';
    const background = isBuyTone ? 'var(--color-GreenAlpha01)' : 'var(--color-RedAlpha01)';
    const disabledAttrs = disabled ? ' disabled aria-disabled="true"' : '';
    const continuousHint = actionType.startsWith('CLOSE_')
      ? ` title="${ui(PANEL_COPY.tooltip.continuousClose)}"`
      : '';
    const cursor = disabled ? 'not-allowed' : 'pointer';
    return `<button type="button" data-ladder-action="${actionType}"${disabledAttrs}${continuousHint} style="min-width:0;height:${LADDER_CONTROL_BUTTON_HEIGHT}px;border:1px solid ${borderColor};border-radius:6px;background:${background};color:${borderColor};font-size:${LADDER_CONTROL_BUTTON_FONT_SIZE}px;font-weight:${CONTROL_FONT_WEIGHT};line-height:${LADDER_CONTROL_BUTTON_HEIGHT - 2}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:${cursor};opacity:1;">${ui(label)}</button>`;
  }

  function ladderExecutionButton(actionType, label, tone, disabled = false) {
    const activeActionType = activeLadderActionType || activeContinuousLadderActionType;
    if (activeActionType !== actionType) {
      return ladderActionButton(actionType, label, tone, disabled);
    }
    const stopLabel = PANEL_COPY.action.stopLadderByAction[actionType];
    return `<button type="button" data-ladder-stop="true" data-ladder-action-origin="${actionType}" style="box-sizing:border-box;min-width:0;height:${LADDER_CONTROL_BUTTON_HEIGHT}px;border:1px solid var(--color-PrimaryYellow);border-radius:6px;background:var(--color-BadgeBg);color:#9a6700;font-size:${LADDER_CONTROL_BUTTON_FONT_SIZE}px;font-weight:${CONTROL_FONT_WEIGHT};line-height:${LADDER_CONTROL_BUTTON_HEIGHT - 2}px;white-space:nowrap;overflow:hidden;cursor:pointer;">${ui(stopLabel)}</button>`;
  }

  function getLadderControlSections(tradeMode, closeContext, symbol, precision) {
    const ladderRunning = !!ladderTask || !!continuousLadderTask;
    const actionDisabled = ladderRunning
      || !!singleOrderTask
      || cancelCurrentSymbolOpenOrdersBlocksLadderActions;
    if (!['OPEN', 'CLOSE'].includes(tradeMode)) {
      return {
        optionRows: [`<div style="margin-top:6px;color:${MUTED_TEXT_COLOR};font-size:12px;">${ui(PANEL_COPY.state.waitingTradeMode)}</div>`],
        actionButtons: [],
      };
    }
    if (!precision) {
      return {
        optionRows: [`<div style="margin-top:6px;color:${MUTED_TEXT_COLOR};font-size:12px;">${ui(PANEL_COPY.state.waitingPricePrecision)}</div>`],
        actionButtons: [],
      };
    }
    if (tradeMode === 'OPEN') {
      return {
        optionRows: [
          ladderOptionRow(PANEL_COPY.field.ratio, PANEL_COPY.tooltip.ratio, LADDER_OPEN_PERCENTS, getLadderOpenPercent(symbol, precision), 'percent', '%'),
          ladderOptionRow(PANEL_COPY.field.orderCount, PANEL_COPY.tooltip.orderCount, LADDER_LEVEL_OPTIONS, getLadderLevels(tradeMode, symbol, precision), 'levels', ''),
          ladderOptionRow(PANEL_COPY.field.interval, PANEL_COPY.tooltip.interval, LADDER_STEP_OPTIONS, getLadderStep(tradeMode, symbol, precision), 'step', ''),
        ],
        actionButtons: [
          ladderExecutionButton('OPEN_LONG', PANEL_COPY.action.openLong, 'BUY', actionDisabled),
          ladderExecutionButton('OPEN_SHORT', PANEL_COPY.action.openShort, 'SELL', actionDisabled),
        ],
      };
    }

    const closeLongDisabled = shouldDisableCloseControl({
      actionDisabled,
      knowsPosition: closeContext?.knowsLong,
      hasPosition: closeContext?.hasLong,
    });
    const closeShortDisabled = shouldDisableCloseControl({
      actionDisabled,
      knowsPosition: closeContext?.knowsShort,
      hasPosition: closeContext?.hasShort,
    });
    return {
      optionRows: [
        ladderOptionRow(PANEL_COPY.field.ratio, PANEL_COPY.tooltip.ratio, LADDER_CLOSE_PERCENTS, getLadderClosePercent(symbol, precision), 'percent', '%'),
        ladderOptionRow(PANEL_COPY.field.orderCount, PANEL_COPY.tooltip.orderCount, LADDER_LEVEL_OPTIONS, getLadderLevels(tradeMode, symbol, precision), 'levels', ''),
        ladderOptionRow(PANEL_COPY.field.interval, PANEL_COPY.tooltip.interval, LADDER_STEP_OPTIONS, getLadderStep(tradeMode, symbol, precision), 'step', ''),
      ],
      actionButtons: [
        ladderExecutionButton(
          'CLOSE_LONG',
          PANEL_COPY.action.closeLong,
          'SELL',
          closeLongDisabled,
        ),
        ladderExecutionButton(
          'CLOSE_SHORT',
          PANEL_COPY.action.closeShort,
          'BUY',
          closeShortDisabled,
        ),
      ],
    };
  }

  function refreshLadderPanel(panel, tradeMode, closeContext) {
    const body = panel.querySelector(`#${LADDER_BODY_ID}`);
    const status = panel.querySelector(`#${LADDER_STATUS_ID}`);
    const statusRow = panel.querySelector(`#${LADDER_STATUS_ROW_ID}`);
    const rebalanceButton = panel.querySelector(`#${USDT_REBALANCE_ACTION_ID}`);
    const mode = activeLadderPanelContext?.mode
      || (['OPEN', 'CLOSE'].includes(tradeMode) ? tradeMode : null);
    const symbol = activeLadderPanelContext?.symbol || getCurrentSymbol();
    const precision = activeLadderPanelContext?.precision || readCurrentOrderbookPrecisionValue();
    if (body) {
      const ladderRunning = !!ladderTask || !!continuousLadderTask;
      const singleOrderRunning = !!singleOrderTask;
      const cancelRunning = !!cancelCurrentSymbolOpenOrdersTask;
      const cancelPresentation = resolveCancelSymbolButtonPresentation({
        ladderRunning: ladderRunning || singleOrderRunning,
        cancelRunning,
        noOrdersFeedback: cancelNoOrdersFeedbackActive,
      });
      const controlSections = getLadderControlSections(mode, closeContext, symbol, precision);
      const bodyHtml = [
        ...controlSections.optionRows,
        `<div id="${ORDERBOOK_PRECISION_RECOMMENDATION_ID}" data-panel-group="precision"></div>`,
        '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;margin-top:12px;">',
        ...controlSections.actionButtons,
        `<button type="button" data-ladder-cancel-symbol="true" style="min-width:0;height:${LADDER_CONTROL_BUTTON_HEIGHT}px;border:1px solid ${CONTROL_BORDER_COLOR};border-radius:6px;font-size:${LADDER_CONTROL_BUTTON_FONT_SIZE}px;line-height:${LADDER_CONTROL_BUTTON_HEIGHT - 2}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${NEUTRAL_CONTROL_STYLE}">${ui(PANEL_COPY.action.cancel)}</button>`,
        '</div>',
      ].join('');
      if (ladderPanelBodySignature !== bodyHtml) {
        body.innerHTML = bodyHtml;
        ladderPanelBodySignature = bodyHtml;
      }
      const cancelButton = body.querySelector('[data-ladder-cancel-symbol="true"]');
      if (cancelButton) {
        const cancelLabel = ui(cancelPresentation.label);
        if (cancelButton.textContent !== cancelLabel) {
          cancelButton.textContent = cancelLabel;
        }
        if (cancelButton.disabled !== cancelPresentation.disabled) {
          cancelButton.disabled = cancelPresentation.disabled;
        }
        if (cancelPresentation.disabled) {
          if (cancelButton.getAttribute('aria-disabled') !== 'true') {
            cancelButton.setAttribute('aria-disabled', 'true');
          }
        } else if (cancelButton.hasAttribute('aria-disabled')) {
          cancelButton.removeAttribute('aria-disabled');
        }
      }
    }
    if (statusRow) {
      if (statusRow.style.visibility !== 'visible') statusRow.style.visibility = 'visible';
    }
    if (status) {
      const renderedText = ui(ladderStatusText);
      const renderedTitle = ui(ladderStatusTitle);
      if (status.textContent !== renderedText) status.textContent = renderedText;
      if (status.title !== renderedTitle) status.title = renderedTitle;
    }
    if (rebalanceButton) {
      const shouldShow = usdtRebalanceEligible || Boolean(usdtRebalanceTask);
      const hidden = !shouldShow;
      if (rebalanceButton.hidden !== hidden) rebalanceButton.hidden = hidden;
      const disabled = Boolean(usdtRebalanceTask);
      if (rebalanceButton.disabled !== disabled) rebalanceButton.disabled = disabled;
      if (disabled) rebalanceButton.setAttribute('aria-disabled', 'true');
      else rebalanceButton.removeAttribute('aria-disabled');
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
      finalText = ui(PANEL_COPY.state.waitingPricePrecision);
    } else if (!modeReady) {
      finalText = ui(PANEL_COPY.state.waitingTradeMode);
    } else if (rulesPending || !effectiveMinQty) {
      finalText = ui(PANEL_COPY.state.minimumQuantityLoading);
    } else if (isValidMultiplier(multiplier) && finalQty) {
      formulaPrefixText = `${effectiveMinQty} × ${multiplier} =`;
      finalText = finalQty;
      if (tradeMode === 'OPEN' && qtyRuleContext?.minNotionalQty && qtyRuleContext?.referencePrice) {
        constraintText = `≥${qtyRuleContext.minNotional}U @ ${qtyRuleContext.referencePrice}`;
      }
    } else {
      finalText = ui(PANEL_COPY.state.positiveIntegerMultiplier);
    }
    if (formulaPrefixEl) {
      if (formulaPrefixEl.textContent !== formulaPrefixText) {
        formulaPrefixEl.textContent = formulaPrefixText;
      }
      formulaPrefixEl.style.display = formulaPrefixText ? 'inline' : 'none';
    }
    if (finalEl) {
      if (finalEl.textContent !== finalText) finalEl.textContent = finalText;
      finalEl.style.color = formulaPrefixText ? PRIMARY_EMPHASIS_COLOR : MUTED_TEXT_COLOR;
    }
    if (constraintDividerEl) {
      constraintDividerEl.style.display = constraintText ? 'block' : 'none';
    }
    if (minEl) {
      if (minEl.textContent !== constraintText) minEl.textContent = constraintText;
      minEl.style.display = constraintText ? 'block' : 'none';
    }
    if (calculationEl) {
      const calculationTitle = [formulaPrefixText, finalText, constraintText].filter(Boolean).join(' ');
      if (calculationEl.title !== calculationTitle) calculationEl.title = calculationTitle;
    }
    let multiplierHintText = PANEL_COPY.field.minimumOrderQuantity;
    if (multiplierHintEl) {
      if (tradeMode === 'OPEN') {
        multiplierHintText = PANEL_COPY.field.minimumOpenQuantity;
      } else if (tradeMode === 'CLOSE') {
        multiplierHintText = PANEL_COPY.field.minimumCloseQuantity;
      }
      const renderedMultiplierHint = ui(multiplierHintText);
      if (multiplierHintEl.textContent !== renderedMultiplierHint) {
        multiplierHintEl.textContent = renderedMultiplierHint;
      }
    }
    let hintText = ui(PANEL_COPY.field.clickOrderbook);
    let hintTitle = '';
    if (hintEl) {
      if (tradeMode === 'OPEN') {
        const action = openSide === 'LONG' ? PANEL_COPY.side.openLong : PANEL_COPY.side.openShort;
        hintTitle = ui(localizedText(
          `开仓模式：单击订单簿价格后将${CFG.SAFE_MODE ? '填数量' : formatLocalizedText(action, 'zh-CN')}`,
          `Open mode: clicking an order-book price will ${CFG.SAFE_MODE ? 'fill the quantity' : formatLocalizedText(action, 'en')}`,
        ));
      } else if (!rawCloseReady) {
        hintTitle = ui(isUsingCache
          ? localizedText(
            '平仓模式：正在确认可平仓位，暂沿用上次识别结果',
            'Close mode: confirming positions; showing the last known result',
          )
          : localizedText('平仓模式：正在确认可平仓位', 'Close mode: confirming positions'));
      } else if (closeMode === 'single_long') {
        hintTitle = ui(localizedText(
          `平仓模式：当前仅有多仓，单击订单簿价格后将${CFG.SAFE_MODE ? '填数量' : '平多'}`,
          `Close mode: long position only; clicking an order-book price will ${CFG.SAFE_MODE ? 'fill the quantity' : 'close long'}`,
        ));
      } else if (closeMode === 'single_short') {
        hintTitle = ui(localizedText(
          `平仓模式：当前仅有空仓，单击订单簿价格后将${CFG.SAFE_MODE ? '填数量' : '平空'}`,
          `Close mode: short position only; clicking an order-book price will ${CFG.SAFE_MODE ? 'fill the quantity' : 'close short'}`,
        ));
      } else if (closeMode === 'dual') {
        const action = closeSide === 'LONG' ? '平多' : '平空';
        const englishAction = closeSide === 'LONG' ? 'close long' : 'close short';
        hintTitle = ui(localizedText(
          `平仓模式：双向持仓时单击订单簿价格后将${CFG.SAFE_MODE ? '填数量' : action}`,
          `Close mode: hedged positions; clicking an order-book price will ${CFG.SAFE_MODE ? 'fill the quantity' : englishAction}`,
        ));
      } else {
        hintText = ui(PANEL_COPY.state.noClosablePosition);
        hintTitle = ui(localizedText(
          '平仓模式：当前交易对暂无可平仓位',
          'Close mode: no position to close for this symbol',
        ));
      }
      if (hintEl.textContent !== hintText) hintEl.textContent = hintText;
      if (hintEl.title !== hintTitle) hintEl.title = hintTitle;
    }
    if (decBtn) {
      const decrementDisabled = !numericContextReady || Number(multiplier) <= 1;
      if (decBtn.disabled !== decrementDisabled) decBtn.disabled = decrementDisabled;
    }
    if (incBtn) {
      const incrementDisabled = !numericContextReady;
      if (incBtn.disabled !== incrementDisabled) incBtn.disabled = incrementDisabled;
    }
    if (input) {
      const inputDisabled = !numericContextReady;
      if (input.disabled !== inputDisabled) input.disabled = inputDisabled;
      input.style.opacity = input.disabled ? '0.65' : '1';
      input.style.cursor = input.disabled ? 'not-allowed' : 'text';
    }
    if (sideLongBtn) {
      const isOpenMode = tradeMode === 'OPEN';
      const isDisabled = isOpenMode ? false : shouldDisableCloseControl({
        knowsPosition: knowsLong,
        hasPosition: hasLong,
      });
      const isActive = isOpenMode
        ? openSide === 'LONG'
        : closeMode === 'single_long' || (closeMode !== 'single_short' && closeSide === 'LONG');
      const sideLongText = ui(localizedText(isOpenMode ? '开多' : '平多', 'Long'));
      const sideLongTitle = ui(isOpenMode ? PANEL_COPY.side.openLong : PANEL_COPY.side.closeLong);
      if (sideLongBtn.textContent !== sideLongText) sideLongBtn.textContent = sideLongText;
      if (sideLongBtn.title !== sideLongTitle) sideLongBtn.title = sideLongTitle;
      sideLongBtn.style.order = '0';
      if (sideLongBtn.disabled !== isDisabled) sideLongBtn.disabled = isDisabled;
      if (sideLongBtn.getAttribute('aria-checked') !== String(isActive)) {
        sideLongBtn.setAttribute('aria-checked', String(isActive));
      }
      const desiredTabIndex = isActive ? 0 : -1;
      if (sideLongBtn.tabIndex !== desiredTabIndex) sideLongBtn.tabIndex = desiredTabIndex;
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
      const isDisabled = isOpenMode ? false : shouldDisableCloseControl({
        knowsPosition: knowsShort,
        hasPosition: hasShort,
      });
      const isActive = isOpenMode
        ? openSide === 'SHORT'
        : closeMode === 'single_short' || (closeMode !== 'single_long' && closeSide === 'SHORT');
      const sideShortText = ui(localizedText(isOpenMode ? '开空' : '平空', 'Short'));
      const sideShortTitle = ui(isOpenMode ? PANEL_COPY.side.openShort : PANEL_COPY.side.closeShort);
      if (sideShortBtn.textContent !== sideShortText) sideShortBtn.textContent = sideShortText;
      if (sideShortBtn.title !== sideShortTitle) sideShortBtn.title = sideShortTitle;
      sideShortBtn.style.order = '1';
      if (sideShortBtn.disabled !== isDisabled) sideShortBtn.disabled = isDisabled;
      if (sideShortBtn.getAttribute('aria-checked') !== String(isActive)) {
        sideShortBtn.setAttribute('aria-checked', String(isActive));
      }
      const desiredTabIndex = isActive ? 0 : -1;
      if (sideShortBtn.tabIndex !== desiredTabIndex) sideShortBtn.tabIndex = desiredTabIndex;
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
    refreshLadderPanel(panel, tradeMode, closeContext);
    refreshOrderbookPrecisionRecommendation(panel);
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
    panel.style.zIndex = String(PANEL_Z_INDEX);

    const layout = calculateFloatingPanelLayout({
      anchorRect,
      panelHeight: panel.offsetHeight || 0,
      viewportWidth: window.innerWidth || document.documentElement.clientWidth || 0,
      viewportHeight: window.innerHeight || document.documentElement.clientHeight || 0,
    });
    if (!layout) {
      panel.style.visibility = 'hidden';
      panel.style.pointerEvents = 'none';
      return;
    }

    panel.style.width = `${layout.width}px`;
    panel.style.left = `${layout.left}px`;
    panel.style.top = `${layout.top}px`;
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

  function observePanelSize(panel) {
    panelResizeObserver?.disconnect();
    panelObservedSize = '';
    panelResizeObserver = new ResizeObserver((entries) => {
      const entry = entries.find((candidate) => candidate.target === panel);
      if (!entry) return;
      const nextSize = `${Math.round(entry.contentRect.width)}:${Math.round(entry.contentRect.height)}`;
      if (panelObservedSize === nextSize) return;
      panelObservedSize = nextSize;
      panelPositionInvalidated = true;
      scheduleRenderPanel();
    });
    panelResizeObserver.observe(panel);
  }

  function isPanelPositionCurrent(panel) {
    const spacer = document.getElementById(SPACER_ID);
    const insertionPoint = findTradePanelInsertionPoint(document);
    if (
      !spacer
      || !insertionPoint
      || spacer.parentElement !== insertionPoint.parent
      || spacer.nextElementSibling !== insertionPoint.before
    ) {
      return false;
    }

    const layout = calculateFloatingPanelLayout({
      anchorRect: spacer.getBoundingClientRect(),
      panelHeight: panel.offsetHeight || 0,
      viewportWidth: window.innerWidth || document.documentElement.clientWidth || 0,
      viewportHeight: window.innerHeight || document.documentElement.clientHeight || 0,
    });
    return Boolean(
      layout
      && Number.parseFloat(panel.style.width) === layout.width
      && Number.parseFloat(panel.style.left) === layout.left
      && Number.parseFloat(panel.style.top) === layout.top
    );
  }

  function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.position = 'fixed';
    panel.style.zIndex = String(PANEL_Z_INDEX);
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
    const initialStatus = ui(PANEL_COPY.state.idle);
    panel.innerHTML = [
      '<div data-panel-zone="single-order">',
      `<div title="${ui(PANEL_COPY.tooltip.singleOrder)}" style="height:20px;color:${PRIMARY_EMPHASIS_COLOR};font-size:14px;font-weight:${PRIMARY_EMPHASIS_FONT_WEIGHT};line-height:20px;cursor:help;">${ui(PANEL_COPY.section.singleOrder)}</div>`,
      '<div data-panel-group="direction" style="display:flex;align-items:center;justify-content:flex-start;gap:6px;height:32px;overflow:hidden;">',
      `<span id="${MODE_HINT_ID}" style="width:78px;flex:0 0 78px;color:${MUTED_TEXT_COLOR};font-size:13px;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${ui(PANEL_COPY.field.clickOrderbook)}</span>`,
      `<div data-side-selector role="radiogroup" aria-labelledby="${MODE_HINT_ID}" style="box-sizing:border-box;display:grid;grid-template-columns:54px 54px;height:32px;border:1px solid var(--color-InputLine);border-radius:6px;overflow:hidden;background:${CONTROL_BACKGROUND_COLOR};">`,
      `<button id="${SIDE_LONG_ID}" type="button" role="radio" aria-checked="false" style="width:54px;height:30px;padding:0;border:0;border-radius:5px 0 0 5px;background:${CONTROL_BACKGROUND_COLOR};color:${CONTROL_TEXT_COLOR};font-size:14px;font-weight:${CONTROL_FONT_WEIGHT};line-height:30px;cursor:pointer;">${ui(PANEL_COPY.side.long)}</button>`,
      `<button id="${SIDE_SHORT_ID}" type="button" role="radio" aria-checked="false" style="width:54px;height:30px;padding:0;border:0;border-left:1px solid var(--color-InputLine);border-radius:0 5px 5px 0;background:${CONTROL_BACKGROUND_COLOR};color:${CONTROL_TEXT_COLOR};font-size:14px;font-weight:${CONTROL_FONT_WEIGHT};line-height:30px;cursor:pointer;">${ui(PANEL_COPY.side.short)}</button>`,
      '</div>',
      '</div>',
      '<div data-panel-group="multiplier" style="margin-top:8px;">',
      '<div data-multiplier-controls style="display:flex;align-items:center;justify-content:flex-start;gap:6px;height:32px;overflow:hidden;">',
      `<label id="${MULTIPLIER_HINT_ID}" for="${INPUT_ID}" style="color:${MUTED_TEXT_COLOR};font-size:13px;line-height:18px;white-space:nowrap;">${ui(PANEL_COPY.field.minimumOrderQuantity)}</label>`,
      `<input id="${INPUT_ID}" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" style="width:60px;height:32px;padding:0 8px;border-radius:8px;border:1px solid ${INPUT_BORDER_COLOR};background:${INPUT_DEFAULT_BG};color:${PRIMARY_EMPHASIS_COLOR};caret-color:${INPUT_FOCUS_COLOR};outline:none;font-size:15px;font-weight:${PRIMARY_EMPHASIS_FONT_WEIGHT};line-height:32px;transition:border-color .16s ease,background-color .16s ease,box-shadow .16s ease;">`,
      `<span style="font-size:13px;font-weight:${CONTROL_FONT_WEIGHT};color:${CONTROL_TEXT_COLOR};">${ui(PANEL_COPY.field.multiplierUnit)}</span>`,
      `<button id="${DEC_ID}" type="button" aria-label="${ui(PANEL_COPY.aria.decrementMultiplier)}" style="width:32px;height:32px;padding:0;border-radius:6px;border:1px solid ${CONTROL_BORDER_COLOR};font-size:18px;line-height:30px;${NEUTRAL_CONTROL_STYLE}">-</button>`,
      `<button id="${INC_ID}" type="button" aria-label="${ui(PANEL_COPY.aria.incrementMultiplier)}" style="width:32px;height:32px;padding:0;border-radius:6px;border:1px solid ${CONTROL_BORDER_COLOR};font-size:18px;line-height:30px;${NEUTRAL_CONTROL_STYLE}">+</button>`,
      '</div>',
      '<div data-multiplier-calculation style="display:flex;align-items:center;gap:7px;height:18px;margin-top:4px;overflow:hidden;white-space:nowrap;">',
      `<span data-multiplier-formula-prefix style="flex:0 1 auto;min-width:0;color:${MUTED_TEXT_COLOR};overflow:hidden;text-overflow:ellipsis;"></span>`,
      `<span id="jh-binance-close-qty-final" style="flex:0 0 auto;font-weight:${PRIMARY_EMPHASIS_FONT_WEIGHT};color:${PRIMARY_EMPHASIS_COLOR};"></span>`,
      `<span data-multiplier-constraint-divider aria-hidden="true" style="display:none;flex:0 0 1px;width:1px;height:12px;background:${CONTROL_BORDER_COLOR};"></span>`,
      `<span id="jh-binance-close-qty-min" style="display:none;flex:1 1 auto;min-width:0;color:${MUTED_TEXT_COLOR};overflow:hidden;text-overflow:ellipsis;"></span>`,
      '</div>',
      '</div>',
      '</div>',
      `<div data-panel-group="ladder" style="margin:12px -10px 0;padding:11px 10px 0;border-top:2px solid ${PANEL_DIVIDER_COLOR};">`,
      `<div title="${ui(PANEL_COPY.tooltip.ladderMaker)}" style="height:20px;color:${PRIMARY_EMPHASIS_COLOR};font-size:14px;font-weight:${PRIMARY_EMPHASIS_FONT_WEIGHT};line-height:20px;cursor:help;">${ui(PANEL_COPY.section.ladderMaker)}</div>`,
      `<div id="${LADDER_BODY_ID}"></div>`,
      '</div>',
      `<div id="${LADDER_STATUS_ROW_ID}" style="display:flex;align-items:center;height:18px;margin-top:6px;visibility:visible;color:${MUTED_TEXT_COLOR};font-size:13px;line-height:18px;white-space:nowrap;overflow:hidden;">`,
      `<span id="${LADDER_STATUS_ID}" title="${initialStatus}" style="flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;">${initialStatus}</span>`,
      `<button id="${USDT_REBALANCE_ACTION_ID}" type="button" data-usdt-rebalance="true" hidden title="${ui(PANEL_COPY.tooltip.accountRebalance)}" style="flex:0 0 auto;height:18px;margin-left:8px;padding:0;border:0;background:transparent;color:var(--color-PrimaryYellow);font-size:13px;font-weight:500;line-height:18px;cursor:pointer;">${ui(PANEL_COPY.action.accountRebalance)}</button>`,
      '</div>',
    ].join('');
    panelPositionInvalidated = true;
    document.body.appendChild(panel);
    observePanelSize(panel);

    const input = panel.querySelector(`#${INPUT_ID}`);
    const decBtn = panel.querySelector(`#${DEC_ID}`);
    const incBtn = panel.querySelector(`#${INC_ID}`);
    const sideLongBtn = panel.querySelector(`#${SIDE_LONG_ID}`);
    const sideShortBtn = panel.querySelector(`#${SIDE_SHORT_ID}`);
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
        if (updateMultiplier(String(Math.max(1, current - 1)), context)) {
          showMultiplierPressFeedback(decBtn);
        }
      });
    }
    if (incBtn) {
      incBtn.addEventListener('click', () => {
        const context = getPanelOptionContext();
        if (!context || !isCurrentObservedSymbol(context.symbol)) return;
        const current = Number(loadMultiplier(context.mode, context.symbol, context.precision));
        if (updateMultiplier(String(current + 1), context)) {
          showMultiplierPressFeedback(incBtn);
        }
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
        const actionType = actionBtn.getAttribute('data-ladder-action');
        if (event.altKey && getLadderActionSpec(actionType)?.mode === 'CLOSE') {
          startContinuousLadder(actionType);
        } else {
          startLadder(actionType);
        }
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
        return;
      }
      const rebalanceBtn = target.closest('[data-usdt-rebalance]');
      if (rebalanceBtn) {
        if (rebalanceBtn.disabled || rebalanceBtn.getAttribute('aria-disabled') === 'true') return;
        startUsdtRebalance();
      }
    });

    return panel;
  }

  function removePanel() {
    panelResizeObserver?.disconnect();
    panelResizeObserver = null;
    panelObservedSize = '';
    document.getElementById(PANEL_ID)?.remove();
    document.getElementById(SPACER_ID)?.remove();
    ladderPanelBodySignature = '';
    panelPositionInvalidated = true;
  }

  function pauseForNonTradingPage() {
    clearCancelNoOrdersFeedback();
    cancelCurrentSymbolOpenOrdersBlocksLadderActions = false;
    removePanel();
    stopTradingTimers();
    invalidateTradeButtonCache();
    lastDisplayCloseState = null;
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
    if (panelPositionInvalidated || !isPanelPositionCurrent(panel)) {
      if (positionPanel(panel)) panelPositionInvalidated = false;
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
      let confirmedCloseSnapshot = false;
      if (
        closeQuantityChanged
        && closeGuard
        && closeGuard.symbol === getCurrentSymbol()
        && !closeGuard.snapshotReady
        && getActiveTradeMode() === 'CLOSE'
        && findCloseLongButton()
        && findCloseShortButton()
      ) {
        closeGuard.snapshotReady = true;
        confirmedCloseSnapshot = true;
      }
      panelPositionInvalidated = true;

      if (confirmedCloseSnapshot) {
        window.clearTimeout(tradeUiMutationDebounceTimer);
        tradeUiMutationDebounceTimer = 0;
        scheduleRenderPanel();
        return;
      }

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
        const mode = parseTradeModeLabel(mutation.target.textContent);
        const isEnteringClose = isSelected && mode === 'CLOSE';
        const isEnteringOpen = isSelected && mode === 'OPEN';
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
      const mode = parseTradeModeLabel(tab.textContent);
      const isEnteringClose = mode === 'CLOSE' && tab.getAttribute('aria-selected') !== 'true';
      const isEnteringOpen = mode === 'OPEN' && tab.getAttribute('aria-selected') !== 'true';
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
    if (!precision) throw new Error('未识别价格精度');
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
        setLadderStatus('单击下单未执行：交易对正在切换');
        return;
      }
      if (getActiveTradeMode() === 'CLOSE' && !isCloseSnapshotReady(clickedSymbol)) {
        warn('仓位确认中');
        setLadderStatus('单击下单未执行：仓位确认中');
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
        setLadderStatus('单击下单未执行：未找到数量输入框');
        return;
      }
      const priceInput = findPriceInput();
      if (!priceInput) {
        warn('未找到价格输入框');
        setLadderStatus('单击下单未执行：未找到价格输入框');
        return;
      }

      const action = resolveTradeAction();
      if (!action || !action.button) {
        const message = `未找到可用${getActiveTradeMode() === 'OPEN' ? '开仓' : '平仓'}动作`;
        warn(message);
        setLadderStatus(`单击下单未执行：${message}`);
        return;
      }

      const qtyPlan = resolveTargetQty(action.mode, clickedPrice);
      if (!qtyPlan || !qtyPlan.qty) {
        warn('未找到可用数量来源（数量倍率/有效最小量）');
        setLadderStatus('单击下单未执行：数量规则读取中');
        return;
      }
      if (ladderTask || continuousLadderTask || cancelCurrentSymbolOpenOrdersTask || singleOrderTask) {
        return;
      }
      lastTs = now;
      invalidateUsdtRebalanceEligibility();
      setLadderStatus(`单击${action.side}准备中`);
      singleOrderTask = (async () => {
        await syncTradeInputs(clickedPrice, qtyPlan.qty, {
          priceLabel: '点击价',
          qtyLabel: '目标量',
        });

        const currentSymbol = getCurrentSymbol();
        if (!isCurrentObservedSymbol(qtyPlan.symbol)) {
          const clickedBaseAsset = formatStatusBaseAsset(qtyPlan.symbol);
          const currentBaseAsset = currentSymbol ? formatStatusBaseAsset(currentSymbol) : '未知';
          throw new Error(`交易对已变化，点击时 ${clickedBaseAsset}，当前 ${currentBaseAsset}`);
        }
        if (getActiveTradeMode() !== action.mode) {
          throw new Error('开仓/平仓模式已变化，已停止提交');
        }
        if (readCurrentOrderbookPrecisionValue() !== qtyPlan.precision) {
          throw new Error('价格精度已变化，已停止提交');
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
        const previousFeedback = takeOrderFeedbackSnapshot();
        const submitCaptureId = beginLadderSubmitResponseCapture();
        try {
          currentAction.button.click();
          setLadderStatus(`单击${action.side}确认中 · ${clickedPrice} × ${qtyPlan.qty}`);
          waitForTradeUiMutation({ timeoutMs: 400 });
          await waitForOrderSubmitAcknowledgement(
            currentAction.button,
            `单击${action.side}`,
            previousFeedback,
            submitCaptureId,
            action.mode,
          );
        } finally {
          endLadderSubmitResponseCapture(submitCaptureId);
        }
        setLadderStatus(`单击${action.side}已提交 · ${clickedPrice} × ${qtyPlan.qty}`);
        log(`单击${action.side}已确认提交`);
      })();
      scheduleRenderPanel();
      try {
        await singleOrderTask;
      } catch (singleOrderError) {
        const message = singleOrderError?.message || '订单簿点击提交失败';
        setLadderStatus(`单击${action.side}失败：${message}`, message);
        err('single order submit failed:', singleOrderError);
        warn(message);
      } finally {
        singleOrderTask = null;
        scheduleRenderPanel();
      }
    } catch (e2) {
      err('click handler 异常:', e2);
      const message = e2?.message || '订单簿点击提交失败';
      warn(message);
      if (!ladderTask && !continuousLadderTask && !cancelCurrentSymbolOpenOrdersTask && !singleOrderTask) {
        setLadderStatus(`单击下单失败：${message}`, message);
      }
    }
  }, true);

  window.addEventListener('storage', (event) => {
    if (
      event.key?.startsWith(`${LOCAL_QTY_MULTIPLIER_PREFIX}:`) ||
      isSymbolScopedSideStorageKey(event.key, [LOCAL_CLOSE_SIDE_KEY, LOCAL_OPEN_SIDE_KEY]) ||
      event.key?.startsWith(`${LOCAL_ORDERBOOK_PRECISION_SAMPLES_PREFIX}:`) ||
      isModeSymbolOptionStorageKey(event.key, LADDER_OPTION_STORAGE_KEYS)
    ) scheduleRenderPanel();
  });

  installUiSyncObservers();

  // ── 切换币种 / 首次进入时触发杠杆重置 ──
  function clearSymbolOwnedRuntimeState(symbol) {
    clearCancelNoOrdersFeedback();
    cancelCurrentSymbolOpenOrdersBlocksLadderActions = false;
    stopMultiplierEdit();
    lastConfirmedCloseState = null;
    lastDisplayCloseState = null;
    lastObservedAccountPositionState = null;
    closeGuard = null;
    invalidateTradeButtonCache();
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
      status: recommendation ? 'ready' : PANEL_COPY.status.precisionInsufficient,
    };
  }

  function checkSymbolChangeForLeverage() {
    const symbol = getCurrentSymbol();
    if (!symbol || symbol === lastObservedSymbol) return;
    lastObservedSymbol = symbol;
    clearSymbolOwnedRuntimeState(symbol);
    scheduleRenderPanel();
    if (getActiveTradeMode() === 'OPEN') {
      queueAutoOpenLeveragePositionCheck('symbol_change');
    }
  }

  let routeWatcherTimer = null;
  let removeSpaRouteChangeListener = null;
  let routeWasTrading = isFuturesTradingPage();

  function startTradingTimers() {
    if (document.hidden || !isFuturesTradingPage()) return;
    ensureTradeModeTabObserver();
    ensureAccountPositionObserver();
    ensureOrderbookPrecisionObserver();
  }

  function stopTradingTimers() {
    stopTradeModeTabObserver();
    stopAccountPositionObserver();
    stopOrderbookPrecisionObserver();
    clearTradeUiMutationWait();
  }

  function syncRouteState() {
    if (document.hidden) return;
    const nextUiLocale = resolveUiLocaleFromPathname(location.pathname);
    const uiLocaleChanged = nextUiLocale !== activeUiLocale;
    if (uiLocaleChanged) {
      activeUiLocale = nextUiLocale;
      removePanel();
    }
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

    const needsRender = uiLocaleChanged || !wasTrading || !document.getElementById(PANEL_ID);
    startTradingTimers();
    scheduleChartOrdersRecovery();
    if (needsRender) scheduleRenderPanel();
    if (!wasTrading && getActiveTradeMode() === 'OPEN') {
      queueAutoOpenLeveragePositionCheck('route_return');
    }
  }

  function startRouteWatcher() {
    if (document.hidden) return;
    if (!removeSpaRouteChangeListener) {
      removeSpaRouteChangeListener = installSpaRouteChangeListener(window, syncRouteState);
    }
    if (!routeWatcherTimer) {
      routeWatcherTimer = setInterval(() => {
        ensureSpaRouteChangePatched(window);
        syncRouteState();
        if (isFuturesTradingPage()) renderPanel();
      }, ROUTE_WATCHDOG_MS);
    }
  }

  function stopRouteWatcher() {
    if (routeWatcherTimer) clearInterval(routeWatcherTimer);
    routeWatcherTimer = null;
    removeSpaRouteChangeListener?.();
    removeSpaRouteChangeListener = null;
  }

  startRouteWatcher();
  startTradingTimers();
  scheduleChartOrdersRecovery();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopTradingTimers();
      stopRouteWatcher();
      return;
    }
    panelPositionInvalidated = true;
    startRouteWatcher();
    syncRouteState();
  });

  window.addEventListener('resize', () => {
    panelPositionInvalidated = true;
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
