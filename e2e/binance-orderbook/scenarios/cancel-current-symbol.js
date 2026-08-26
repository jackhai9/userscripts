export const CURRENT_SYMBOL = 'HYPEUSDT';
export const OTHER_SYMBOL = 'BTCUSDT';

function position(symbol, side, quantity) {
  return { symbol, side, quantity: String(quantity) };
}

function order(id, symbol, side = 'SELL') {
  return {
    id,
    symbol,
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
      ladderExpanded: true,
      ...overrides.ui,
    },
    host: {
      mutationDelayMs: 0,
      clearDelayMs: 0,
      ...overrides.host,
    },
  };

  if (!['positions', 'openOrders', 'history'].includes(scenario.ui.accountTab)) {
    throw new Error(`Unsupported account tab: ${scenario.ui.accountTab}`);
  }
  if (!['basic', 'conditional'].includes(scenario.ui.openOrdersSubTab)) {
    throw new Error(`Unsupported open-orders sub-tab: ${scenario.ui.openOrdersSubTab}`);
  }
  if (!Array.isArray(scenario.positions) || !Array.isArray(scenario.orders)) {
    throw new Error('Scenario positions and orders must be arrays');
  }
  return scenario;
}
