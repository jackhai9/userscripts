export const CURRENT_SYMBOL = 'HYPEUSDT';
export const OTHER_SYMBOL = 'BTCUSDT';

function position(symbol, side, quantity) {
  return { symbol, side, quantity: String(quantity) };
}

function order(id, symbol, side = 'SELL') {
  return {
    id,
    symbol,
    kind: 'basic',
    side,
    price: symbol === CURRENT_SYMBOL ? '90.0' : '120000.0',
    quantity: '0.01',
  };
}

export const POSITION_SETS = Object.freeze({
  none: [],
  current: [position(CURRENT_SYMBOL, 'LONG', '0.1')],
  other: [position(OTHER_SYMBOL, 'LONG', '0.001')],
  both: [
    position(CURRENT_SYMBOL, 'LONG', '0.1'),
    position(OTHER_SYMBOL, 'SHORT', '0.001'),
  ],
});

export const ORDER_SETS = Object.freeze({
  none: [],
  current: [order('current-1', CURRENT_SYMBOL)],
  other: [order('other-1', OTHER_SYMBOL)],
  both: [order('current-1', CURRENT_SYMBOL), order('other-1', OTHER_SYMBOL, 'BUY')],
});

export function createCancelScenario(overrides = {}) {
  const scenario = {
    name: 'cancel-current-symbol',
    currentSymbol: CURRENT_SYMBOL,
    positions: POSITION_SETS.none,
    orders: ORDER_SETS.none,
    ...overrides,
    ui: {
      accountTab: 'positions',
      openOrdersSubTab: 'basic',
      hideOtherSymbols: false,
      showOrders: true,
      tradeMode: 'OPEN',
      orderbookPrecision: '0.1',
      leverage: 2,
      ...overrides.ui,
    },
    host: {
      mutationDelayMs: 0,
      clearDelayMs: 0,
      dialogMode: 'normal',
      dialogReplacementDelayMs: null,
      clearMode: 'capturedScope',
      chartOrdersPopoverCloseMode: 'normal',
      submitFeedbackDelayMs: 0,
      submitButtonBusyMs: 0,
      submitButtonBusyAttribute: 'data-loading',
      submitButtonClearsInputsWhenReady: false,
      submitApiResponses: Array.from({ length: 5 }, () => ({
        outcome: 'success', delivery: 'immediate',
      })),
      precisionOptions: ['0.001', '0.01', '0.1', '1'],
      ...overrides.host,
    },
  };

  if (!['positions', 'openOrders', 'history'].includes(scenario.ui.accountTab)) {
    throw new Error(`Unsupported account tab: ${scenario.ui.accountTab}`);
  }
  if (!['basic', 'conditional'].includes(scenario.ui.openOrdersSubTab)) {
    throw new Error(`Unsupported open-orders sub-tab: ${scenario.ui.openOrdersSubTab}`);
  }
  if (!['OPEN', 'CLOSE'].includes(scenario.ui.tradeMode)) {
    throw new Error(`Unsupported trade mode: ${scenario.ui.tradeMode}`);
  }
  if (!Number.isInteger(scenario.ui.leverage) || scenario.ui.leverage <= 0) {
    throw new Error('Leverage must be a positive integer');
  }
  if (!scenario.host.precisionOptions.includes(scenario.ui.orderbookPrecision)) {
    throw new Error('Current orderbook precision must be one of the native options');
  }
  if (!Array.isArray(scenario.positions) || !Array.isArray(scenario.orders)) {
    throw new Error('Scenario positions and orders must be arrays');
  }
  if (scenario.orders.some((order) => !['basic', 'conditional'].includes(order.kind))) {
    throw new Error('Every scenario order must declare its basic or conditional kind');
  }
  if (!['normal', 'missing', 'extraAction', 'missingPrimary'].includes(scenario.host.dialogMode)) {
    throw new Error(`Unsupported dialog mode: ${scenario.host.dialogMode}`);
  }
  if (!['capturedScope', 'none'].includes(scenario.host.clearMode)) {
    throw new Error(`Unsupported clear mode: ${scenario.host.clearMode}`);
  }
  if (!['normal', 'stuck'].includes(scenario.host.chartOrdersPopoverCloseMode)) {
    throw new Error(
      `Unsupported chart-orders popover close mode: ${scenario.host.chartOrdersPopoverCloseMode}`,
    );
  }
  for (const key of ['submitFeedbackDelayMs', 'submitButtonBusyMs']) {
    if (!Number.isInteger(scenario.host[key]) || scenario.host[key] < 0) {
      throw new Error(`${key} must be a non-negative integer`);
    }
  }
  if (!['data-loading', 'aria-busy'].includes(scenario.host.submitButtonBusyAttribute)) {
    throw new Error(`Unsupported submit button busy attribute: ${scenario.host.submitButtonBusyAttribute}`);
  }
  if (typeof scenario.host.submitButtonClearsInputsWhenReady !== 'boolean') {
    throw new Error('submitButtonClearsInputsWhenReady must be a boolean');
  }
  if (
    !Array.isArray(scenario.host.submitApiResponses)
    || scenario.host.submitApiResponses.length === 0
  ) {
    throw new Error('submitApiResponses must declare at least one response');
  }
  for (const response of scenario.host.submitApiResponses) {
    if (!['success', 'rejected', 'unknown'].includes(response.outcome)) {
      throw new Error('Submit response outcome must be success, rejected, or unknown');
    }
    if (!['immediate', 'manual'].includes(response.delivery)) {
      throw new Error('Submit response delivery must be immediate or manual');
    }
    if (response.outcome === 'unknown' && response.delivery !== 'manual') {
      throw new Error('An unknown submit response must remain pending until explicitly released');
    }
    if (response.outcome === 'rejected' && (
      typeof response.code !== 'string' || !response.code
      || typeof response.message !== 'string' || !response.message
    )) {
      throw new Error('A rejected submit response must declare its code and message');
    }
  }
  if (
    scenario.host.dialogReplacementDelayMs !== null
    && (!Number.isInteger(scenario.host.dialogReplacementDelayMs)
      || scenario.host.dialogReplacementDelayMs < 0)
  ) {
    throw new Error('Dialog replacement delay must be a non-negative integer or null');
  }
  return scenario;
}
